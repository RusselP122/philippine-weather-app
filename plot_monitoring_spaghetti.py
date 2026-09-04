import os
import sys
from collections import deque
import io
import math
import re
import json
import base64
import argparse
import shutil
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')  # Headless mode
import matplotlib.pyplot as plt
import matplotlib.patheffects as path_effects
import matplotlib.patches as mpatches
from matplotlib.collections import LineCollection
import matplotlib.colors as mcolors
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from shapely.geometry import shape
from scipy.cluster.hierarchy import linkage, fcluster
from scipy.spatial.distance import squareform
import urllib.request
from datetime import datetime, timezone, timedelta

def parse_atcf_latlon(val_str):
    """
    Parses ATCF latitude/longitude string like '135N' or '1205E' to numeric float.
    Handles 'S' and 'W' as negative values.
    """
    if not val_str or val_str.strip() == '':
        return float('nan')
    val_str = val_str.strip()
    try:
        num = float(val_str[:-1]) / 10.0
        direction = val_str[-1].upper()
        if direction in ('S', 'W'):
            num = -num
        return num
    except (ValueError, IndexError):
        return float('nan')

def fetch_knack_active_storms():
    """
    Fetches active tropical cyclones from the Knack API.
    Returns a list of dicts: {'atcf_id': ..., 'name': ..., 'lat': ..., 'lon': ..., 'init_time': ...}
    """
    url = "https://api.knackwx.com/atcf/v2"
    try:
        print(f"Fetching active storms from Knack API: {url} ...")
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            
        storms = []
        for item in data:
            lat = item.get('latitude')
            lon = item.get('longitude')
            if lat is None or lon is None:
                continue
                
            lat = float(lat)
            lon = float(lon)
            
            # Clean longitude to standard [-180, 180]
            if lon > 180:
                lon -= 360
            elif lon < -180:
                lon += 360
                
            analysis_time = item.get('analysis_time', '')
            init_time = analysis_time
            if 'T' in analysis_time:
                try:
                    dt = datetime.strptime(analysis_time.split('.')[0], "%Y-%m-%dT%H:%M:%S")
                    init_time = dt.strftime("%Y-%m-%d %H:%M:%S")
                except (ValueError, TypeError):
                    pass
                    
            atcf_id = item.get('atcf_id', '')
            # Filter only Western Pacific storms
            if not (atcf_id.upper().endswith('W') or atcf_id.upper().startswith('WP')):
                continue
                
            storms.append({
                'atcf_id': atcf_id,
                'name': item.get('storm_name', 'INVEST'),
                'lat': lat,
                'lon': lon,
                'init_time': init_time
            })
        print(f"Successfully fetched {len(storms)} active storms from Knack API.")
        return storms
    except Exception as e:
        print(f"Warning: Failed to fetch from Knack API: {e}")
        return []

def haversine_km(lat1, lon1, lat2, lon2):
    """
    Calculates great-circle distance between two points in kilometers.
    """
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2.0)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0)**2
    return R * 2.0 * math.asin(math.sqrt(a))

def mean_geo_center(points):
    """
    Computes the geographic centroid of a list of {'lat': ..., 'lon': ...} dicts
    using spherical (3D Cartesian) averaging.
    """
    if len(points) == 0:
        return {'lat': 0.0, 'lon': 0.0}
    sum_x = 0.0
    sum_y = 0.0
    sum_z = 0.0
    for pt in points:
        lat_rad = math.radians(pt['lat'])
        lon_rad = math.radians(pt['lon'])
        sum_x += math.cos(lat_rad) * math.cos(lon_rad)
        sum_y += math.cos(lat_rad) * math.sin(lon_rad)
        sum_z += math.sin(lat_rad)
    n = len(points)
    avg_x = sum_x / n
    avg_y = sum_y / n
    avg_z = sum_z / n
    hyp = math.sqrt(avg_x * avg_x + avg_y * avg_y)
    lat = math.degrees(math.atan2(avg_z, hyp))
    lon = math.degrees(math.atan2(avg_y, avg_x))
    return {'lat': lat, 'lon': lon}

def load_track_file(file_path):
    """
    Loads storm tracks from a CSV file, XOR-encrypted DAT file, or raw ATCF file.
    """
    print(f"Loading data from {file_path} ...")
    if not os.path.exists(file_path):
        print(f"Error: File not found {file_path}")
        return pd.DataFrame()

    if file_path.endswith('.dat'):
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                b64_content = f.read().strip()
            xored_bytes = base64.b64decode(b64_content)
            decrypted_bytes = bytearray([b ^ 0xAA for b in xored_bytes])
            csv_text = decrypted_bytes.decode('utf-8')
            df = pd.read_csv(io.StringIO(csv_text), comment='#')
            return df
        except Exception as e:
            print(f"Failed to decrypt and read .dat file {file_path}: {e}")
            return pd.DataFrame()

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            first_line = f.readline()
    except Exception as e:
        print(f"Failed to read file {file_path}: {e}")
        return pd.DataFrame()

    if first_line.startswith('#'):
        try:
            df = pd.read_csv(file_path, comment='#')
            return df
        except (ValueError, pd.errors.ParserError):
            pass

    if ',' in first_line and ('init_time' in first_line or 'track_id' in first_line or 'lat' in first_line or 'sample' in first_line):
        try:
            df = pd.read_csv(file_path)
            return df
        except Exception as e:
            print(f"Error reading CSV {file_path}: {e}")
            return pd.DataFrame()

    rows = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip() == '' or line.startswith('#'):
                    continue
                parts = [p.strip() for p in line.split(',')]
                if len(parts) < 10:
                    continue
                basin = parts[0]
                cy = parts[1]
                ymdh = parts[2]
                tech = parts[4]
                tau = parts[5]
                lat_str = parts[6]
                lon_str = parts[7]
                vmax = parts[8]
                mslp = parts[9]
                
                lat = parse_atcf_latlon(lat_str)
                lon = parse_atcf_latlon(lon_str)
                
                try:
                    lead_time = int(tau)
                except (ValueError, TypeError):
                    lead_time = 0
                    
                try:
                    wind = float(vmax)
                except (ValueError, TypeError):
                    wind = np.nan
                    
                try:
                    pressure = float(mslp)
                except (ValueError, TypeError):
                    pressure = np.nan
                
                rows.append({
                    'basin': basin,
                    'cyclone_number': cy,
                    'init_time': ymdh,
                    'tech': tech,
                    'lead_time_hours': lead_time,
                    'lat': lat,
                    'lon': lon,
                    'maximum_sustained_wind_speed_knots': wind,
                    'minimum_sea_level_pressure_hpa': pressure
                })
        df = pd.DataFrame(rows)
        return df
    except Exception as e:
        print(f"Failed to parse raw ATCF file {file_path}: {e}")
        return pd.DataFrame()

def normalize_dataframe(df):
    """
    Standardizes the loaded dataframe columns to a common naming convention:
    'init_time', 'track_id', 'sample', 'lead_time_hours', 'lat', 'lon', 'pressure', 'wind'
    """
    if df.empty:
        return df
        
    df.columns = df.columns.str.strip()
    
    rename_dict = {}
    for col in df.columns:
        col_lower = col.lower()
        if col_lower in ('lat', 'latitude', 'lat_str'):
            rename_dict[col] = 'lat'
        elif col_lower in ('lon', 'longitude', 'lon_str'):
            rename_dict[col] = 'lon'
        elif col_lower in ('pressure', 'minimum_sea_level_pressure_hpa', 'mslp', 'minimum_sea_level_pressure_mb'):
            rename_dict[col] = 'pressure'
        elif col_lower in ('wind', 'maximum_sustained_wind_speed_knots', 'vmax', 'maximum_sustained_wind_speed_kph'):
            rename_dict[col] = 'wind'
        elif col_lower in ('lead_time_hours', 'tau'):
            rename_dict[col] = 'lead_time_hours'
            
    df = df.rename(columns=rename_dict)
    
    if 'track_id' not in df.columns:
        if 'basin' in df.columns and 'cyclone_number' in df.columns:
            df['track_id'] = df['basin'].astype(str) + df['cyclone_number'].astype(str).str.zfill(2)
        else:
            df['track_id'] = 'STORM'
            
    if 'lead_time_hours' not in df.columns and 'lead_time' in df.columns:
        try:
            df['lead_time_hours'] = pd.to_timedelta(df['lead_time']).dt.total_seconds() / 3600.0
        except (ValueError, TypeError):
            df['lead_time_hours'] = np.nan
            
    if 'sample' not in df.columns and 'tech' in df.columns:
        samples = []
        for tech_val in df['tech'].astype(str):
            if 'mn' in tech_val.lower() or 'mean' in tech_val.lower():
                samples.append(-1)
            else:
                match = re.search(r'\d+', tech_val)
                samples.append(int(match.group()) if match else 0)
        df['sample'] = samples
        
    required_cols = ['init_time', 'track_id', 'sample', 'lead_time_hours', 'lat', 'lon', 'pressure', 'wind']
    for col in required_cols:
        if col not in df.columns:
            df[col] = np.nan
            
    df['lat'] = pd.to_numeric(df['lat'], errors='coerce')
    df['lon'] = pd.to_numeric(df['lon'], errors='coerce')
    df['pressure'] = pd.to_numeric(df['pressure'], errors='coerce')
    df['wind'] = pd.to_numeric(df['wind'], errors='coerce')
    df['lead_time_hours'] = pd.to_numeric(df['lead_time_hours'], errors='coerce')
    
    # Clean longitude to standard [-180, 180]
    df['lon'] = np.where(df['lon'] > 180, df['lon'] - 360, df['lon'])
    
    return df[required_cols]

def filter_western_pacific(df):
    """
    Retains only tracks whose INITIAL position lies within the Western Pacific bounds: Lon [100, 180], Lat [0, 50].
    """
    if df.empty:
        return df

    wp_tracks = []
    for (t_id, s_val), track_points in df.groupby(['track_id', 'sample']):
        track_points = track_points.sort_values('lead_time_hours')
        if track_points.empty:
            continue
        first_pt = track_points.iloc[0]
        f_lat = first_pt['lat']
        f_lon = first_pt['lon']
        
        if not np.isnan(f_lat) and not np.isnan(f_lon):
            if 100.0 <= f_lon <= 180.0 and 0.0 <= f_lat <= 50.0:
                wp_tracks.append((t_id, s_val))
                
    if not wp_tracks:
        return pd.DataFrame(columns=df.columns)
        
    df = df.copy()
    wp_set = {f"{tid}_{sid}" for tid, sid in wp_tracks}
    df_keys = df['track_id'].astype(str) + "_" + df['sample'].astype(str)
    mask = df_keys.isin(wp_set)
    
    return df[mask]

def detect_model_name(file_path):
    name = os.path.basename(file_path).lower()
    if 'aifs' in name:
        return 'ECMWF AIFS'
    elif 'ifs' in name:
        return 'ECMWF IFS'
    elif 'wnv3' in name:
        return 'GDM WNCv3'
    elif 'fnv3' in name:
        return 'GDM WNC'
    elif 'oper' in name:
        return 'GDM WNCv3'
    else:
        return 'Ensemble Model'

def format_init_time(init_time_val):
    if pd.isna(init_time_val):
        return 'Unknown'
    
    init_str = str(init_time_val).strip()
    formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d",
        "%Y%m%d%H",
        "%Y%m%d%H%M"
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(init_str, fmt)
            return dt.strftime("%HZ %b %d %Y")
        except ValueError:
            continue
            
    return init_str

def cluster_and_validate_lpas(df_wp, knack_storms, total_members=50, min_members=8, min_wind_kt=25.0, max_mslp_hpa=1004.0, min_duration=36.0, max_dist=450.0):
    """
    Identifies, clusters, and validates tropical disturbances under monitoring using Average-Linkage
    spatio-temporal clustering. Prevents chaining and survivor bias.
    """
    if df_wp.empty:
        return df_wp, []
        
    df_wp = df_wp.copy()
    df_wp['storm_group'] = 'UNKNOWN'
    df_wp['storm_group_name'] = 'UNKNOWN'
    df_wp['rep_track_id'] = 'UNKNOWN'
    df_wp['is_monitoring'] = False
    
    # 1. Extract valid track sequences
    tracks = []
    for (t_id, s_val), track_points in df_wp.groupby(['track_id', 'sample']):
        track_points = track_points.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
        if len(track_points) < 3:
            continue
        h_min = track_points['lead_time_hours'].min()
        h_max = track_points['lead_time_hours'].max()
        f_lat = track_points.iloc[0]['lat']
        f_lon = track_points.iloc[0]['lon']
        max_w = track_points['wind'].max()
        min_p = track_points['pressure'].min()
        points_dict = {row['lead_time_hours']: (row['lat'], row['lon']) for _, row in track_points.iterrows()}
        wind_dict = {row['lead_time_hours']: row['wind'] for _, row in track_points.iterrows()}
        press_dict = {row['lead_time_hours']: row['pressure'] for _, row in track_points.iterrows()}
        tracks.append({
            'track_id': t_id,
            'sample': s_val,
            'h_min': h_min,
            'h_max': h_max,
            'f_lat': f_lat,
            'f_lon': f_lon,
            'max_w': max_w,
            'min_p': min_p,
            'points_dict': points_dict,
            'wind_dict': wind_dict,
            'press_dict': press_dict,
            'index': track_points.index.tolist()
        })
        
    n = len(tracks)
    if n == 0:
        return df_wp, []
        
    # 2. Spatio-temporal distance matrix
    dist_matrix = np.full((n, n), 100000.0)
    np.fill_diagonal(dist_matrix, 0.0)
    
    for i in range(n):
        t1 = tracks[i]
        for j in range(i+1, n):
            t2 = tracks[j]
            overlap = set(t1['points_dict'].keys()).intersection(set(t2['points_dict'].keys()))
            if not overlap:
                continue
            
            # Genesis lead hour difference
            dh = abs(t1['h_min'] - t2['h_min'])
            if dh > 48:
                continue
                
            sorted_overlap = sorted(overlap)
            early_overlap = sorted_overlap[:min(8, len(sorted_overlap))]
            
            d_early_sum = 0.0
            for h in early_overlap:
                p1 = t1['points_dict'][h]
                p2 = t2['points_dict'][h]
                d = haversine_km(p1[0], p1[1], p2[0], p2[1])
                d_early_sum += d
            d_early_mean = d_early_sum / len(early_overlap)
            
            d_gen = haversine_km(t1['f_lat'], t1['f_lon'], t2['f_lat'], t2['f_lon'])
            
            if d_gen > 600.0 or d_early_mean > 500.0:
                continue
                
            d_all_sum = sum(haversine_km(t1['points_dict'][h][0], t1['points_dict'][h][1],
                                         t2['points_dict'][h][0], t2['points_dict'][h][1]) for h in sorted_overlap)
            d_all_mean = d_all_sum / len(sorted_overlap)
            
            combined_dist = 0.40 * d_gen + 0.40 * d_early_mean + 0.20 * min(600.0, d_all_mean) + (dh * 2.0)
            dist_matrix[i, j] = combined_dist
            dist_matrix[j, i] = combined_dist
            
    condensed = squareform(dist_matrix, checks=False)
    # Average linkage prevents chaining across disconnected geographic basins
    Z = linkage(condensed, method='average')
    labels = fcluster(Z, t=max_dist, criterion='distance')
    
    clusters = {}
    for idx, lbl in enumerate(labels):
        if lbl not in clusters:
            clusters[lbl] = []
        clusters[lbl].append(tracks[idx])
        
    validated_lpas = []
    for lbl, cl_tracks in clusters.items():
        # Member deduplication: Keep at most 1 representative trajectory per ensemble member
        by_member = {}
        for t in cl_tracks:
            sid = t['sample']
            if sid not in by_member:
                by_member[sid] = []
            by_member[sid].append(t)
            
        deduped_tracks = []
        for sid, m_tracks in by_member.items():
            if len(m_tracks) == 1:
                deduped_tracks.append(m_tracks[0])
            else:
                best_t = max(m_tracks, key=lambda tr: (len(tr['points_dict']), tr['max_w']))
                deduped_tracks.append(best_t)
                
        num_members = len(deduped_tracks)
        if num_members < min_members:
            continue
            
        avg_lat = float(np.mean([t['f_lat'] for t in deduped_tracks]))
        avg_lon = float(np.mean([t['f_lon'] for t in deduped_tracks]))
        avg_h = float(np.mean([t['h_min'] for t in deduped_tracks]))
        max_w = float(max(t['max_w'] for t in deduped_tracks))
        min_p = float(min(t['min_p'] for t in deduped_tracks))
        
        # Duration check
        earliest_h = min(t['h_min'] for t in deduped_tracks)
        latest_h = max(t['h_max'] for t in deduped_tracks)
        duration = latest_h - earliest_h
        if duration < min_duration:
            continue
            
        # Intensity check
        if (np.isnan(max_w) or max_w < min_wind_kt) and (np.isnan(min_p) or min_p > max_mslp_hpa):
            continue
            
        # Spatial domain check (Lat 0-38N, Lon 100-180E)
        if not (0.0 <= avg_lat <= 38.0 and 100.0 <= avg_lon <= 180.0):
            continue
            
        # Check active Knack storms
        matched_active = False
        if knack_storms:
            for k in knack_storms:
                k_lat, k_lon = k['lat'], k['lon']
                if not (np.isnan(k_lat) or np.isnan(k_lon)):
                    d_k = haversine_km(avg_lat, avg_lon, k_lat, k_lon)
                    if d_k < 450.0 and avg_h <= 18:
                        matched_active = True
                        break
        if matched_active:
            continue
            
        validated_lpas.append({
            'cluster_label': lbl,
            'tracks': deduped_tracks,
            'members': num_members,
            'max_w': max_w,
            'min_p': min_p,
            'duration': duration,
            'avg_lat': avg_lat,
            'avg_lon': avg_lon,
            'avg_h': avg_h
        })
        
    # Sort validated LPAs by member support, then intensity
    validated_lpas.sort(key=lambda x: (x['members'], x['max_w'] if not np.isnan(x['max_w']) else 0), reverse=True)
    
    lpa_clusters_info = []
    for idx, lpa in enumerate(validated_lpas):
        lpa_num = idx + 1
        sg_id = f"monitoring_lpa{lpa_num:02d}"
        display_name = f"LPA {lpa_num:02d} (UNDER MONITORING - {lpa['members']} MEMBERS)"
        rep_id = f"LPA{lpa_num:02d}"
        
        # Mark dataframe
        for t in lpa['tracks']:
            df_wp.loc[t['index'], 'storm_group'] = sg_id
            df_wp.loc[t['index'], 'storm_group_name'] = display_name
            df_wp.loc[t['index'], 'rep_track_id'] = rep_id
            df_wp.loc[t['index'], 'is_monitoring'] = True
            
        lpa_clusters_info.append({
            'storm_group': sg_id,
            'storm_group_name': display_name,
            'rep_track_id': rep_id,
            'members': lpa['members'],
            'tracks': lpa['tracks'],
            'max_w': lpa['max_w'],
            'min_p': lpa['min_p'],
            'duration': lpa['duration']
        })
        print(f"Validated Under-Monitoring Candidate: {sg_id} ({display_name}) with {lpa['members']} members, max wind {lpa['max_w']:.1f}kt, min MSLP {lpa['min_p']:.1f}hPa, duration {lpa['duration']:.0f}h")
        
    return df_wp, lpa_clusters_info

def compute_clean_mean_track_df(deduped_tracks, min_member_ratio=0.25, min_members=4):
    """
    Computes a clean, smooth, physical ensemble mean track.
    Includes forward trajectory continuity, survivor bias prevention, and outlier rejection.
    """
    total_members = len(deduped_tracks)
    required_quorum = max(min_members, int(math.ceil(total_members * min_member_ratio)))
    
    hours_set = set()
    for t in deduped_tracks:
        hours_set.update(t['points_dict'].keys())
    all_hours = sorted(hours_set)
    
    mean_points = []
    prev_pos = None
    prev_h = None
    
    for h in all_hours:
        pts_at_h = []
        winds_at_h = []
        press_at_h = []
        for t in deduped_tracks:
            if h in t['points_dict']:
                pt = t['points_dict'][h]
                pts_at_h.append(pt)
                if 'wind_dict' in t and h in t['wind_dict']:
                    winds_at_h.append(t['wind_dict'][h])
                if 'press_dict' in t and h in t['press_dict']:
                    press_at_h.append(t['press_dict'][h])
                    
        # Check quorum
        if len(pts_at_h) < required_quorum:
            if mean_points:
                # Quorum lost after genesis: consensus track ends cleanly
                break
            else:
                continue
                
        # If we already have a previous position, filter members within consistent forward window
        if prev_pos is not None:
            dh = h - prev_h
            max_step_dist = max(350.0, 75.0 * dh)
            pts_near_prev = []
            winds_near_prev = []
            press_near_prev = []
            for idx, p in enumerate(pts_at_h):
                d_p = haversine_km(prev_pos[0], prev_pos[1], p[0], p[1])
                if d_p <= max_step_dist:
                    pts_near_prev.append(p)
                    if idx < len(winds_at_h):
                        winds_near_prev.append(winds_at_h[idx])
                    if idx < len(press_at_h):
                        press_near_prev.append(press_at_h[idx])
                        
            if len(pts_near_prev) < max(3, required_quorum // 2):
                break
            pts_at_h = pts_near_prev
            winds_at_h = winds_near_prev
            press_at_h = press_near_prev
            
        med_lat = np.median([p[0] for p in pts_at_h])
        med_lon = np.median([p[1] for p in pts_at_h])
        
        # Filter spatial outliers (> 450km from step median)
        valid_pts = []
        valid_w = []
        valid_p = []
        for idx, p in enumerate(pts_at_h):
            d_med = haversine_km(p[0], p[1], med_lat, med_lon)
            if d_med <= 450.0:
                valid_pts.append({'lat': p[0], 'lon': p[1]})
                if idx < len(winds_at_h):
                    valid_w.append(winds_at_h[idx])
                if idx < len(press_at_h):
                    valid_p.append(press_at_h[idx])
                    
        if len(valid_pts) < max(3, required_quorum // 2):
            if mean_points:
                break
            continue
            
        geo_mean = mean_geo_center(valid_pts)
        m_lat = geo_mean['lat']
        m_lon = geo_mean['lon']
        valid_w_clean = [w for w in valid_w if not np.isnan(w)]
        valid_p_clean = [p for p in valid_p if not np.isnan(p)]
        m_wind = float(np.median(valid_w_clean)) if valid_w_clean else float('nan')
        m_press = float(np.median(valid_p_clean)) if valid_p_clean else float('nan')
        
        # Velocity and direction continuity check
        if prev_pos is not None and prev_h is not None:
            dh = h - prev_h
            if dh > 0:
                dist_km = haversine_km(prev_pos[0], prev_pos[1], m_lat, m_lon)
                speed_kmh = dist_km / dh
                if speed_kmh > 75.0:
                    break
                # Check for unnatural reverse jumps
                if prev_pos[0] >= 24.0 and (m_lat - prev_pos[0]) < -1.2:
                    break
                    
        prev_pos = (m_lat, m_lon)
        prev_h = h
        
        mean_points.append({
            'lead_time_hours': h,
            'lat': m_lat,
            'lon': m_lon,
            'pressure': m_press,
            'wind': m_wind,
            'members': len(valid_pts)
        })
        
    df_mean = pd.DataFrame(mean_points)
    if len(df_mean) >= 4:
        # Smooth slight jitter while preserving endpoints
        lats = df_mean['lat'].values
        lons = df_mean['lon'].values
        smooth_lats = np.convolve(lats, [0.2, 0.6, 0.2], mode='same')
        smooth_lons = np.convolve(lons, [0.2, 0.6, 0.2], mode='same')
        smooth_lats[0], smooth_lats[-1] = lats[0], lats[-1]
        smooth_lons[0], smooth_lons[-1] = lons[0], lons[-1]
        df_mean['lat'] = smooth_lats
        df_mean['lon'] = smooth_lons
        
    return df_mean

def plot_monitoring_tracks(df_model, model_name, storm_group_id, output_path, storm_name_override=None, color_by='wind', min_mean_members=25):
    """
    Generates a publication-quality spaghetti plot for a validated Under-Monitoring candidate disturbance.
    """
    df_storm = df_model[df_model['storm_group'] == storm_group_id].copy()
    if df_storm.empty:
        print(f"No tracks found for under-monitoring group {storm_group_id}")
        return

    df_storm = df_storm.dropna(subset=['lat', 'lon'])
    if df_storm.empty:
        print(f"No valid coordinate positions for under-monitoring group {storm_group_id}")
        return

    if color_by == 'wind':
        df_storm['wind'] = df_storm['wind'] * 1.852

    init_time_raw = df_storm['init_time'].dropna().iloc[0] if not df_storm['init_time'].isna().all() else 'Unknown'
    init_time_str = format_init_time(init_time_raw)

    group_name = df_storm['storm_group_name'].dropna().iloc[0] if not df_storm['storm_group_name'].isna().all() else 'Unknown'
    storm_name = storm_name_override if storm_name_override else group_name

    # Member deduplication: Keep at most 1 representative trajectory per ensemble member
    by_member = {}
    for (t_id, s_val), g in df_storm.groupby(['track_id', 'sample']):
        if s_val not in by_member:
            by_member[s_val] = []
        by_member[s_val].append((t_id, g))
        
    deduped_track_dfs = []
    deduped_track_dicts = []
    for s_val, t_list in by_member.items():
        if len(t_list) == 1:
            best_tid, best_df = t_list[0]
        else:
            best_tid, best_df = max(t_list, key=lambda x: (len(x[1]), x[1]['wind'].max()))
        deduped_track_dfs.append(best_df)
        
        best_df_sorted = best_df.sort_values('lead_time_hours')
        deduped_track_dicts.append({
            'sample': s_val,
            'points_dict': {r['lead_time_hours']: (r['lat'], r['lon']) for _, r in best_df_sorted.iterrows()},
            'wind_dict': {r['lead_time_hours']: r['wind'] for _, r in best_df_sorted.iterrows()},
            'press_dict': {r['lead_time_hours']: r['pressure'] for _, r in best_df_sorted.iterrows()}
        })
        
    df_storm_deduped = pd.concat(deduped_track_dfs, ignore_index=True) if deduped_track_dfs else df_storm
    
    # Compute clean mean track only if cluster has sufficient member support (>= min_mean_members, default 25)
    if len(deduped_track_dfs) >= min_mean_members:
        df_mean = compute_clean_mean_track_df(deduped_track_dicts, min_member_ratio=0.25, min_members=4)
    else:
        df_mean = pd.DataFrame()
    has_ensemble_tracks = len(deduped_track_dfs) >= 2

    # Viewport determination focused on core track spread
    lons_to_fit = []
    lats_to_fit = []
    for t_dict in deduped_track_dicts:
        for h, (lat, lon) in t_dict['points_dict'].items():
            if h <= 240:
                lats_to_fit.append(lat)
                lons_to_fit.append(lon)
                
    if not lons_to_fit:
        lons_to_fit = list(df_storm_deduped['lon'].dropna().values)
        lats_to_fit = list(df_storm_deduped['lat'].dropna().values)
        
    if not df_mean.empty:
        lons_to_fit.extend(list(df_mean['lon'].dropna().values))
        lats_to_fit.extend(list(df_mean['lat'].dropna().values))
        
    min_lon = float(np.percentile(lons_to_fit, 1))
    max_lon = float(np.percentile(lons_to_fit, 99))
    min_lat = float(np.percentile(lats_to_fit, 1))
    max_lat = float(np.percentile(lats_to_fit, 99))
    
    lon_pad = max(5.0, (max_lon - min_lon) * 0.15)
    lat_pad = max(4.0, (max_lat - min_lat) * 0.15)
    
    lon_min = max(108.0, min_lon - lon_pad)
    lon_max = min(160.0, max_lon + lon_pad)
    lat_min = max(5.0, min_lat - lat_pad)
    lat_max = min(45.0, max_lat + lat_pad)

    lon_span = lon_max - lon_min
    lat_span = lat_max - lat_min
    aspect = lon_span / lat_span

    fig_width = 12
    fig_height = (fig_width - 2.5) / aspect + 1.8
    fig_height = max(6.0, min(10.0, fig_height))
    
    print(f"Generating under-monitoring spaghetti plot for {model_name} – {storm_name} (Color by: {color_by}) ...")

    fig = plt.figure(figsize=(fig_width, fig_height), facecolor='white')
    ax = fig.add_axes([0.08, 0.08, 0.78, 0.80], projection=ccrs.PlateCarree())
    
    ax.set_facecolor('#87CEEB')
    ax.add_feature(cfeature.LAND, facecolor='#DEB887', edgecolor='#8B4513', linewidth=0.8, zorder=1)
    ax.add_feature(cfeature.OCEAN, facecolor='#87CEEB', zorder=0)
    ax.add_feature(cfeature.COASTLINE, edgecolor='#8B4513', linewidth=0.8, zorder=2)
    ax.add_feature(cfeature.BORDERS, linestyle='-', edgecolor='#654321', linewidth=0.8, zorder=2)

    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        geojson_paths = [
            os.path.join(script_dir, "public", "data", "ph_provinces.json"),
            "public/data/ph_provinces.json"
        ]
        found_geojson = None
        for p in geojson_paths:
            if os.path.exists(p):
                found_geojson = p
                break
        if found_geojson:
            with open(found_geojson, 'r', encoding='utf-8') as gf:
                geojson_data = json.load(gf)
            prov_geoms = [shape(feature['geometry']) for feature in geojson_data['features']]
            ax.add_geometries(prov_geoms, crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#654321', linewidth=0.4, alpha=0.5, zorder=3)
    except Exception as e:
        print(f"Warning: Province boundary overlay skipped: {e}")

    # Sea labels - bounds-checked
    if lon_min + 1 <= 118 <= lon_max - 1 and lat_min + 1 <= 13 <= lat_max - 1:
        ax.text(118, 13, 'West Philippine\nSea', fontsize=6, color='navy', weight='bold', transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5, zorder=3)
    if lon_min + 1 <= 130 <= lon_max - 1 and lat_min + 1 <= 20 <= lat_max - 1:
        ax.text(130, 20, 'Philippine\nSea', fontsize=7, color='navy', weight='bold', transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5, zorder=3)

    par_vertices = [
        (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
        (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
    ]
    ax.add_patch(mpatches.Polygon(par_vertices, facecolor='none', edgecolor='#FF6B35', linestyle='-', linewidth=2.5, alpha=0.85, transform=ccrs.PlateCarree(), zorder=3, label='PAR'))

    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
    gl.xlocator = plt.FixedLocator(np.arange(90, 181, 5))
    gl.ylocator = plt.FixedLocator(np.arange(-10, 51, 5))
    gl.xlabel_style = {'size': 10, 'weight': 'bold', 'color': '#475569'}
    gl.ylabel_style = {'size': 10, 'weight': 'bold', 'color': '#475569'}
    gl.top_labels = False
    gl.right_labels = False

    if color_by == 'pressure':
        bounds = [930, 940, 950, 960, 970, 980, 990, 1000, 1005, 1010]
        colors = ['#311b92', '#4a148c', '#d500f9', '#880e4f', '#d50000', '#ff6d00', '#ffd600', '#00c853', '#00b0ff', '#2962ff', '#1a237e']
        cmap = mcolors.ListedColormap(colors)
        norm = mcolors.BoundaryNorm(bounds, cmap.N, extend='both')
    else:
        bounds = [30, 60, 90, 120, 150, 180, 210, 240]
        colors = ['#00d2ff', '#00a8ff', '#00e676', '#ffd600', '#ff9100', '#ff3d00', '#c51162', '#aa00ff', '#311b92']
        cmap = mcolors.ListedColormap(colors)
        norm = mcolors.BoundaryNorm(bounds, cmap.N, extend='both')

    # Plot Ensemble Member Lines
    for member_df in deduped_track_dfs:
        member_df = member_df.sort_values('lead_time_hours')
        if len(member_df) < 2:
            continue
            
        lons = member_df['lon'].values
        lats = member_df['lat'].values
        winds = member_df['wind'].values
        pressures = member_df['pressure'].values
        
        segments = []
        seg_vals = []
        for i in range(len(lons) - 1):
            if np.isnan(lons[i]) or np.isnan(lons[i+1]) or np.isnan(lats[i]) or np.isnan(lats[i+1]):
                continue
            if abs(lons[i+1] - lons[i]) > 180:
                continue
                
            segments.append([[lons[i], lats[i]], [lons[i+1], lats[i+1]]])
            if color_by == 'pressure':
                p1 = pressures[i] if not np.isnan(pressures[i]) else 1010.0
                p2 = pressures[i+1] if not np.isnan(pressures[i+1]) else 1010.0
                seg_vals.append((p1 + p2) / 2.0)
            else:
                w1 = winds[i] if not np.isnan(winds[i]) else 20.0
                w2 = winds[i+1] if not np.isnan(winds[i+1]) else 20.0
                seg_vals.append((w1 + w2) / 2.0)
            
        if not segments:
            continue
            
        lc = LineCollection(segments, cmap=cmap, norm=norm, linewidth=1.5, alpha=0.85, 
                            capstyle='round', joinstyle='round', transform=ccrs.PlateCarree(), zorder=4)
        lc.set_array(np.array(seg_vals))
        ax.add_collection(lc)

    # Plot Clean Ensemble Mean Track
    if not df_mean.empty and len(df_mean) >= 2:
        m_lons = list(df_mean['lon'].values)
        m_lats = list(df_mean['lat'].values)

        ax.plot(m_lons, m_lats, color='white', linewidth=6.5, zorder=6, transform=ccrs.PlateCarree())
        ax.plot(m_lons, m_lats, color='black', linewidth=4.0, zorder=7, transform=ccrs.PlateCarree())

        # Genesis Origin Marker (Centroid of earliest consensus points)
        gen_lon = df_mean.iloc[0]['lon']
        gen_lat = df_mean.iloc[0]['lat']
        ax.plot(gen_lon, gen_lat, 'o', color='black', markersize=9, markeredgecolor='white', markeredgewidth=1.5, zorder=9, transform=ccrs.PlateCarree())

        last_labeled_pos = None
        for idx, row in df_mean.iterrows():
            hour = int(row['lead_time_hours'])
            if hour > 0 and hour % 24 == 0:
                mx, my = row['lon'], row['lat']
                if last_labeled_pos is not None:
                    dist = np.sqrt((mx - last_labeled_pos[0])**2 + (my - last_labeled_pos[1])**2)
                    if dist < 2.5:
                        continue
                        
                last_labeled_pos = (mx, my)
                if color_by == 'pressure':
                    mp = row['pressure']
                    label_text = f"{int(round(mp))}mb\n{hour}" if not np.isnan(mp) else f"{hour}h"
                else:
                    mw = row['wind']
                    label_text = f"{int(round(mw))} km/h\n{hour}" if not np.isnan(mw) else f"{hour}h"
                
                ax.plot(mx, my, marker='o', markerfacecolor='white', markeredgecolor='black', 
                        markersize=5, markeredgewidth=1.5, zorder=8, transform=ccrs.PlateCarree())
                text = ax.text(mx + 0.3, my + 0.3, label_text, color='black', weight='bold',
                               fontsize=9, ha='left', va='bottom', transform=ccrs.PlateCarree(), zorder=10)
                text.set_path_effects([path_effects.withStroke(linewidth=3, foreground='white')])

    ax.set_extent([lon_min, lon_max, lat_min, lat_max], crs=ccrs.PlateCarree())

    sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
    sm.set_array([])
    cax = fig.add_axes([0.88, 0.15, 0.025, 0.66])
    cbar = fig.colorbar(sm, cax=cax, orientation='vertical')
    if color_by == 'pressure':
        cbar.set_label('Min. MSLP (hPa)', fontsize=11, weight='bold', color='#1e293b', labelpad=8)
    else:
        cbar.set_label('Wind Speed (km/h)', fontsize=11, weight='bold', color='#1e293b', labelpad=8)
    cbar.ax.tick_params(labelsize=9, colors='#1e293b')

    # Top Headers
    param_text = "Min. MSLP (hPa)" if color_by == 'pressure' else "Wind Speed (km/h)"
    title_text = f"{storm_name} – {model_name} Tracks"
    title_fontsize = 12 if len(title_text) > 42 else 13
    fig.text(0.08, 0.94, title_text, fontsize=title_fontsize, weight='bold', color='black', ha='left', va='bottom')
    
    sub_text = f"Colored by: {param_text} | Status: Under Monitoring | Initialized at {init_time_str}"
    fig.text(0.08, 0.90, sub_text, fontsize=10.0, color='#475569', ha='left', va='bottom')
    
    fig.text(0.86, 0.94, f"Philippine Typhoon/Weather", fontsize=11, weight='bold', color='black', ha='right', va='bottom')
    fig.text(0.86, 0.90, f"Data: {model_name} Ensemble", fontsize=10, color='#475569', ha='right', va='bottom')

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    plt.savefig(output_path, dpi=300, facecolor='white', edgecolor='none')
    plt.close()
    
    print(f"Publication-quality under-monitoring plot saved to: {output_path}")

def main():
    parser = argparse.ArgumentParser(description="Ensemble Under-Monitoring LPA / Invest Candidate Tracking System")
    parser.add_argument('--input', type=str, nargs='*', help="Input DAT, CSV, or ATCF files")
    parser.add_argument('--lpa-id', type=str, help="Specific LPA ID to plot (e.g. LPA01, MONITORING_LPA01)")
    parser.add_argument('--output-dir', type=str, default='public/assets', help="Directory to save generated plots")
    parser.add_argument('--color-by', type=str, default='wind', choices=['wind', 'pressure'], help="Parameter to color lines by and display in colorbar")
    parser.add_argument('--min-members', type=int, default=8, help="Minimum ensemble members for a monitoring disturbance")
    parser.add_argument('--min-mean-members', type=int, default=25, help="Minimum ensemble members required to compute and render the ensemble mean track")
    parser.add_argument('--min-wind', type=float, default=25.0, help="Minimum maximum wind in knots for monitoring disturbance")
    parser.add_argument('--min-duration', type=float, default=36.0, help="Minimum duration in hours for monitoring disturbance")
    args = parser.parse_args()

    input_files = args.input
    if not input_files:
        search_dir = 'public/data'
        possible_files = [
            'aifs_tc_latest.dat', 'aifs_tc_latest.csv',
            'ifs_tc_latest.dat', 'ifs_tc_latest.csv',
            'wnv3_latest.dat', 'wnv3_latest.csv',
            'fnv3p2_latest.dat', 'fnv3p2_latest.csv'
        ]
        input_files = []
        for pf in possible_files:
            p_path = os.path.join(search_dir, pf)
            if os.path.exists(p_path):
                input_files.append(p_path)

    if not input_files:
        print("No input files specified and no default datasets found in public/data.")
        return

    knack_storms = fetch_knack_active_storms()
    if knack_storms:
        knack_storms = [
            s for s in knack_storms 
            if (s['lon'] >= 100 and s['lon'] <= 180 and s['lat'] >= 0 and s['lat'] <= 50)
        ]

    print(f"Processing under-monitoring disturbances from files: {input_files}")
    latest_plotted_init = {}

    for f_path in input_files:
        raw_df = load_track_file(f_path)
        if raw_df.empty:
            continue

        normalized_df = normalize_dataframe(raw_df)
        wp_df = filter_western_pacific(normalized_df)
        if wp_df.empty:
            continue

        model = detect_model_name(f_path)
        total_members = wp_df['sample'].nunique()

        # Cluster, validate, and identify LPA disturbance candidates
        wp_df, lpa_clusters = cluster_and_validate_lpas(
            wp_df, 
            knack_storms, 
            total_members=total_members,
            min_members=args.min_members,
            min_wind_kt=args.min_wind,
            min_duration=args.min_duration
        )

        monitoring_df = wp_df[wp_df['storm_group'].str.startswith('monitoring_')].copy()
        if monitoring_df.empty:
            print(f"No under-monitoring LPA candidate clusters found in: {f_path}")
            continue

        storm_groups = monitoring_df['storm_group'].dropna().unique()
        print(f"Found under-monitoring groups {storm_groups} in {f_path}")

        for sg_id in storm_groups:
            group_df = monitoring_df[monitoring_df['storm_group'] == sg_id]
            rep_track_id = str(group_df['rep_track_id'].dropna().iloc[0])

            init_time_raw = group_df['init_time'].dropna().iloc[0] if not group_df['init_time'].isna().all() else 'Unknown'
            try:
                current_init_dt = pd.to_datetime(init_time_raw)
                ymd = current_init_dt.strftime('%Y%m%d')
                cycle_hour = current_init_dt.hour
                cycle_str = f"{(cycle_hour // 6) * 6:02d}Z"
            except (ValueError, TypeError):
                current_init_dt = datetime.min
                ymd = datetime.now(timezone.utc).strftime('%Y%m%d')
                cycle_str = "00Z"

            wp_id = f"MONITORING_{rep_track_id.upper()}"
            num_w_id = rep_track_id.upper()

            if args.lpa_id:
                s_target = args.lpa_id.upper().strip()
                if s_target not in (wp_id, num_w_id, rep_track_id.upper()):
                    continue

            model_clean = model.replace(' ', '_').lower()
            primary_filename = f"{wp_id}_{ymd}_{cycle_str}_{model_clean}.png"
            out_file = os.path.join(args.output_dir, primary_filename)

            if out_file in latest_plotted_init:
                if current_init_dt < latest_plotted_init[out_file]:
                    continue

            plot_monitoring_tracks(monitoring_df, model, sg_id, out_file, color_by=args.color_by, min_mean_members=args.min_mean_members)
            latest_plotted_init[out_file] = current_init_dt

            alt_filename = f"{num_w_id}_{ymd}_{cycle_str}_{model_clean}.png"
            if alt_filename != primary_filename:
                shutil.copyfile(out_file, os.path.join(args.output_dir, alt_filename))

            legacy_filename = f"{wp_id.lower()}_{model_clean}_spaghetti.png"
            shutil.copyfile(out_file, os.path.join(args.output_dir, legacy_filename))

            unique_key = f"{wp_id}_{ymd}T{cycle_str}"
            manifest_file = os.path.join('public', 'data', 'spaghetti_manifest.json')
            manifest_data = []
            if os.path.exists(manifest_file):
                try:
                    with open(manifest_file, 'r', encoding='utf-8') as mf:
                        manifest_data = json.load(mf)
                except Exception:
                    manifest_data = []

            entry_exists = False
            for entry in manifest_data:
                if entry.get('unique_key') == unique_key and entry.get('model') == model_clean:
                    entry['filename'] = primary_filename
                    entry['alt_filename'] = alt_filename
                    entry['is_monitoring'] = True
                    entry['timestamp'] = datetime.now(timezone.utc).isoformat()
                    entry_exists = True
                    break
            if not entry_exists:
                manifest_data.append({
                    'storm_id': wp_id,
                    'atcf_id': num_w_id,
                    'init_date': ymd,
                    'cycle': cycle_str,
                    'model': model_clean,
                    'unique_key': unique_key,
                    'filename': primary_filename,
                    'alt_filename': alt_filename,
                    'is_monitoring': True,
                    'timestamp': datetime.now(timezone.utc).isoformat()
                })

            os.makedirs(os.path.dirname(manifest_file), exist_ok=True)
            with open(manifest_file, 'w', encoding='utf-8') as mf:
                json.dump(manifest_data, mf, indent=2)

if __name__ == '__main__':
    main()
