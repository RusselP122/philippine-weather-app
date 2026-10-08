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
import matplotlib.dates as mdates
import matplotlib.patheffects as path_effects
import matplotlib.patches as mpatches
from matplotlib.collections import LineCollection
import matplotlib.colors as mcolors
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from shapely.geometry import shape
from scipy.cluster.hierarchy import linkage, fcluster
from scipy.spatial.distance import squareform
from scipy.stats import gaussian_kde
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
    if 'large' in name:
        return 'GDM WNC Large'
    elif 'aifs' in name:
        return 'ECMWF AIFS'
    elif 'ifs' in name:
        return 'ECMWF IFS'
    elif 'wnv3' in name or 'wnc' in name or 'fnv3' in name or 'oper' in name:
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

def load_atcf_storms_index():
    """
    Loads active and historical storms from local tc_storms_index.json.
    """
    paths = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public', 'data', 'tc_storms_index.json'),
        'public/data/tc_storms_index.json',
        'd:/philippine-weather-app/public/data/tc_storms_index.json'
    ]
    for p in paths:
        if os.path.exists(p):
            try:
                with open(p, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"Warning: Failed to load {p}: {e}")
    return []

def is_atcf_storm_or_invest(tracks, knack_storms=None, atcf_index_storms=None):
    """
    Determines if a candidate cluster belongs to an official ATCF storm or invest.
    Clusters with official ATCF status must NOT have monitoring graphics generated.
    """
    atcf_patterns = [
        re.compile(r'^(WP|EP|AL|CP|IO|SH)\d{2}\d{4}', re.I),                                 # e.g. WP272026, EP152026, AL092026
        re.compile(r'^(WP|EP|AL|CP|IO|SH)?(0[1-9]|[1-4][0-9]|9[0-9])[A-Z](\(\d+\))?$', re.I), # e.g. 27W, 93W, WP27, WP93
        re.compile(r'^(WP|EP|AL|CP|IO|SH)(0[1-9]|[1-4][0-9]|9[0-9])(\(\d+\))?$', re.I),       # e.g. WP27, WP93
        re.compile(r'^(TC|INVEST)\s*\d+[A-Z]?', re.I)                                      # e.g. TC 27W, INVEST 93W
    ]

    known_official_identifiers = set()
    if knack_storms:
        for s in knack_storms:
            if s.get('atcf_id'):
                known_official_identifiers.add(str(s['atcf_id']).upper().strip())
            if s.get('name') and s['name'].upper() != 'INVEST':
                known_official_identifiers.add(str(s['name']).upper().strip())

    if atcf_index_storms:
        for s in atcf_index_storms:
            if s.get('track_id'):
                known_official_identifiers.add(str(s['track_id']).upper().strip())
            if s.get('storm_name'):
                name_clean = str(s['storm_name']).upper().replace('TC', '').replace('INVEST', '').strip()
                if name_clean:
                    known_official_identifiers.add(name_clean)
                full_name = str(s['storm_name']).upper().strip()
                known_official_identifiers.add(full_name)

    # 1. Check track IDs in this cluster
    for t in tracks:
        tid = str(t.get('track_id', '')).strip().upper()
        if not tid or tid in ('UNKNOWN', 'STORM', 'NONE', 'NAN'):
            continue

        # Purely numeric track IDs (e.g. '1', '2', '12' in WNCv3/GDM) are internal ensemble cluster IDs, not ATCF storms
        if tid.isdigit():
            continue

        # ECMWF synthetic trackers are 70W-79W or 80W-89W - these are candidate disturbances, NOT official ATCF storms
        if re.match(r'^[78]\d[A-Z]$', tid):
            continue

        # Check against known official IDs/names
        for ident in known_official_identifiers:
            if not ident or ident in ('UNKNOWN', 'STORM', 'NONE', 'NAN', 'INVEST', 'TC'):
                continue
            if ident == tid:
                return True, f"Track ID '{tid}' matches official ATCF storm identifier '{ident}'"
            if len(ident) >= 4 and ident in tid:
                return True, f"Track ID '{tid}' contains official ATCF storm identifier '{ident}'"
            if len(tid) >= 4 and tid in ident:
                return True, f"Track ID '{tid}' matches official ATCF storm identifier '{ident}'"

        # Check regex patterns
        for pat in atcf_patterns:
            if pat.search(tid):
                return True, f"Track ID '{tid}' matches ATCF format pattern"

    # 2. Check spatial proximity to active ATCF storms (<= 450 km within first 48h)
    active_storm_locations = []
    if knack_storms:
        for s in knack_storms:
            lat = s.get('lat')
            lon = s.get('lon')
            if lat is not None and lon is not None and not (np.isnan(lat) or np.isnan(lon)):
                active_storm_locations.append((lat, lon, s.get('atcf_id', s.get('name', 'Active ATCF Storm'))))

    if atcf_index_storms:
        for s in atcf_index_storms:
            if s.get('active'):
                lat = s.get('latest_lat')
                lon = s.get('latest_lon')
                if lat is not None and lon is not None and not (np.isnan(lat) or np.isnan(lon)):
                    active_storm_locations.append((lat, lon, s.get('storm_name', s.get('track_id', 'Active ATCF Storm'))))

    for t in tracks:
        p_dict = t.get('points_dict', {})
        for h, (p_lat, p_lon) in p_dict.items():
            if h <= 48:
                for a_lat, a_lon, a_name in active_storm_locations:
                    d = haversine_km(p_lat, p_lon, a_lat, a_lon)
                    if d < 450.0:
                        return True, f"Cluster track is within {d:.0f}km of active ATCF storm {a_name} at T+{h}h"

    return False, ""

def aggregate_nursery_lpas(validated_lpas, max_nursery_dist=600.0, max_genesis_gap_h=96.0, min_motion_cos=0.50):
    """
    Groups validated LPA candidate clusters originating within the same spatial nursery (<= 600km)
    with compatible trajectory heading vectors and overlapping/adjacent genesis time windows.
    Deduplicates tracks per ensemble member to maintain statistical integrity.
    """
    if len(validated_lpas) <= 1:
        return validated_lpas

    lpas_with_meta = []
    for idx, c in enumerate(validated_lpas):
        tracks = c['tracks']
        avg_lat = c.get('avg_lat', float(np.mean([t['f_lat'] for t in tracks])))
        avg_lon = c.get('avg_lon', float(np.mean([t['f_lon'] for t in tracks])))
        avg_h = c.get('avg_h', float(np.mean([t['h_min'] for t in tracks])))

        dx_list, dy_list = [], []
        for t in tracks:
            p_dict = t.get('points_dict', {})
            if not p_dict:
                continue
            sorted_h = sorted(p_dict.keys())
            if len(sorted_h) < 2:
                continue
            p_start = p_dict[sorted_h[0]]
            candidates = [h for h in sorted_h if h <= sorted_h[0] + 48]
            target_h = candidates[-1] if len(candidates) > 1 else sorted_h[-1]
            p_end = p_dict[target_h]
            dlat_km = (p_end[0] - p_start[0]) * 111.0
            dlon_km = (p_end[1] - p_start[1]) * 111.0 * math.cos(math.radians(p_start[0]))
            dx_list.append(dlon_km)
            dy_list.append(dlat_km)

        mean_dx = np.mean(dx_list) if dx_list else 0.0
        mean_dy = np.mean(dy_list) if dy_list else 0.0
        norm = math.sqrt(mean_dx**2 + mean_dy**2)
        dir_vec = (mean_dx / norm, mean_dy / norm) if norm > 0 else (0.0, 0.0)

        lpas_with_meta.append({
            'tracks': tracks,
            'members': c['members'],
            'avg_lat': avg_lat,
            'avg_lon': avg_lon,
            'avg_h': avg_h,
            'dir_vec': dir_vec,
            'max_w': c['max_w'],
            'min_p': c['min_p'],
            'duration': c['duration']
        })

    sorted_lpas = sorted(lpas_with_meta, key=lambda x: x['members'], reverse=True)
    merged = []
    used = set()

    for i, anchor in enumerate(sorted_lpas):
        if i in used:
            continue
        group = [anchor]
        used.add(i)

        for j, candidate in enumerate(sorted_lpas):
            if j in used:
                continue
            # 1. Spatial distance between nursery genesis centers
            dist_gen = haversine_km(anchor['avg_lat'], anchor['avg_lon'], candidate['avg_lat'], candidate['avg_lon'])
            if dist_gen > max_nursery_dist:
                continue

            # 2. Timing gap between genesis lead hours
            dh = abs(anchor['avg_h'] - candidate['avg_h'])
            if dh > max_genesis_gap_h:
                continue

            # 3. Trajectory heading compatibility
            cos_sim = anchor['dir_vec'][0] * candidate['dir_vec'][0] + anchor['dir_vec'][1] * candidate['dir_vec'][1]
            if cos_sim < min_motion_cos:
                continue

            group.append(candidate)
            used.add(j)

        if len(group) == 1:
            merged.append(anchor)
            continue

        # Combine tracks across group and deduplicate per ensemble member
        combined_tracks = []
        for item in group:
            combined_tracks.extend(item['tracks'])

        by_member = {}
        for t in combined_tracks:
            sid = t['sample']
            if sid not in by_member:
                by_member[sid] = []
            by_member[sid].append(t)

        deduped = []
        for sid, m_tracks in by_member.items():
            if len(m_tracks) == 1:
                deduped.append(m_tracks[0])
            else:
                deduped.append(max(m_tracks, key=lambda tr: (len(tr.get('points_dict', {})), tr.get('max_w', 0))))

        num_mems = len(deduped)
        c_lat = float(np.mean([t['f_lat'] for t in deduped]))
        c_lon = float(np.mean([t['f_lon'] for t in deduped]))
        c_h = float(np.mean([t['h_min'] for t in deduped]))
        c_max_w = float(max(t['max_w'] for t in deduped))
        c_min_p = float(min(t['min_p'] for t in deduped))
        c_duration = float(max(t['h_max'] for t in deduped) - min(t['h_min'] for t in deduped))

        print(f"Spatial Nursery Aggregation: Merged {len(group)} candidate clusters near ({c_lat:.1f}N, {c_lon:.1f}E) into unified signal with {num_mems} members")
        merged.append({
            'tracks': deduped,
            'members': num_mems,
            'avg_lat': c_lat,
            'avg_lon': c_lon,
            'avg_h': c_h,
            'max_w': c_max_w,
            'min_p': c_min_p,
            'duration': c_duration
        })

    return merged

def cluster_and_validate_lpas(
    df_wp, 
    knack_storms, 
    atcf_index_storms=None, 
    total_members=50, 
    min_members=5, 
    min_wind_kt=25.0, 
    max_mslp_hpa=1004.0, 
    min_duration=36.0, 
    max_dist=450.0,
    enable_nursery_aggregation=True,
    max_nursery_dist=600.0,
    max_nursery_gap_h=96.0
):
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
    
    # Build known official storm names (e.g. KOGUMA, CHOI-WAN) to skip immediately
    known_official_names = set()
    if knack_storms:
        for s in knack_storms:
            if s.get('atcf_id'):
                known_official_names.add(str(s['atcf_id']).upper().strip())
            if s.get('name') and str(s['name']).upper() not in ('INVEST', 'UNKNOWN'):
                known_official_names.add(str(s['name']).upper().strip())
    if atcf_index_storms:
        for s in atcf_index_storms:
            if s.get('track_id'):
                known_official_names.add(str(s['track_id']).upper().strip())
            if s.get('storm_name'):
                name_clean = str(s['storm_name']).upper().replace('TC', '').replace('INVEST', '').strip()
                if name_clean:
                    known_official_names.add(name_clean)

    # Fast pre-filter regex for official ATCF storms/invests:
    # 1. Full ATCF names: WP262026, EP152026, AL092026 (optionally with (2))
    # 2. Designated TC numbers: 01W to 49W (or WP01 to WP49)
    # 3. Official Invest numbers: 90W to 99W (or WP90 to WP99)
    # Note: ECMWF disturbance trackers (70W-89W, 70B, etc.) and GDM disturbance IDs (digits) must be KEPT!
    atcf_prefilter_pat = re.compile(
        r'^(?:WP|EP|AL|CP|IO|SH)\d{2}\d{4}(?:\(\d+\))?'
        r'|^(?:WP|EP|AL|CP|IO|SH)?(?:0[1-9]|[1-4]\d|9\d)[A-Z](?:\(\d+\))?$'
        r'|^(?:WP|EP|AL|CP|IO|SH)(?:0[1-9]|[1-4]\d|9\d)(?:\(\d+\))?$',
        re.I
    )

    # 1. Extract valid track sequences
    tracks = []
    for (t_id, s_val), track_points in df_wp.groupby(['track_id', 'sample']):
        t_id_str = str(t_id).strip().upper()
        # Fast pre-filter: Skip tracks that represent official ATCF storms/invests
        if t_id_str in known_official_names or atcf_prefilter_pat.match(t_id_str):
            continue
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
            
        # Check if this cluster corresponds to an official ATCF storm or invest
        is_atcf, reason = is_atcf_storm_or_invest(deduped_tracks, knack_storms=knack_storms, atcf_index_storms=atcf_index_storms)
        if is_atcf:
            print(f"Skipping cluster candidate {lbl}: {reason} (Official ATCF storm/invest - no monitoring plot needed)")
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
    # Spatial Nursery Aggregation: Combine clusters from the same geographic nursery
    if enable_nursery_aggregation and len(validated_lpas) > 1:
        validated_lpas = aggregate_nursery_lpas(
            validated_lpas,
            max_nursery_dist=max_nursery_dist,
            max_genesis_gap_h=max_nursery_gap_h
        )

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

def plot_monitoring_tracks(
    df_model, 
    model_name, 
    storm_group_id, 
    output_path, 
    storm_name_override=None, 
    color_by='wind', 
    min_mean_members=25,
    total_ensemble_members=None,
    knack_storms=None,
    atcf_index_storms=None
):
    """
    Renders an elite broadcast-grade infographic for an under-monitoring cluster
    matching the reference development signal layout.
    Filters out any cluster that belongs to an official ATCF storm or invest.
    """
    df_storm = df_model[df_model['storm_group'] == storm_group_id].copy()
    if df_storm.empty:
        print(f"No tracks found for under-monitoring group {storm_group_id}")
        return

    df_storm = df_storm.dropna(subset=['lat', 'lon'])
    if df_storm.empty:
        print(f"No valid coordinate positions for under-monitoring group {storm_group_id}")
        return

    # Extract deduplicated member tracks (1 trajectory per ensemble member)
    by_member = {}
    for (t_id, s_val), g in df_storm.groupby(['track_id', 'sample']):
        if s_val not in by_member:
            by_member[s_val] = []
        by_member[s_val].append(g)

    deduped_track_dfs = []
    track_meta_list = []
    for s_val, t_list in by_member.items():
        if len(t_list) == 1:
            best_df = t_list[0]
        else:
            best_df = max(t_list, key=lambda x: (len(x), x['wind'].max()))
        sorted_tdf = best_df.sort_values('lead_time_hours')
        deduped_track_dfs.append(sorted_tdf)

        track_meta_list.append({
            'track_id': sorted_tdf['track_id'].iloc[0] if not sorted_tdf.empty else '',
            'sample': s_val,
            'points_dict': {r['lead_time_hours']: (r['lat'], r['lon']) for _, r in sorted_tdf.iterrows()},
            'max_w': sorted_tdf['wind'].max(),
            'f_lat': sorted_tdf.iloc[0]['lat'] if not sorted_tdf.empty else np.nan,
            'f_lon': sorted_tdf.iloc[0]['lon'] if not sorted_tdf.empty else np.nan
        })

    # ATCF Verification: Strict check to ensure no ATCF storm gets plotted here
    is_atcf, reason = is_atcf_storm_or_invest(track_meta_list, knack_storms=knack_storms, atcf_index_storms=atcf_index_storms)
    if is_atcf:
        print(f"Skipping plot generation for {storm_group_id}: {reason} (Official ATCF storm/invest - no monitoring plot needed)")
        return

    cluster_members = len(deduped_track_dfs)
    if cluster_members == 0:
        return

    if total_ensemble_members is None or total_ensemble_members <= 0:
        total_ensemble_members = max(cluster_members, 50)

    # Init time
    init_time_raw = df_storm['init_time'].dropna().iloc[0] if not df_storm['init_time'].isna().all() else 'Unknown'
    try:
        init_dt = pd.to_datetime(init_time_raw)
    except Exception:
        init_dt = datetime.now(timezone.utc)

    # Format PHT (UTC+8)
    pht_dt = init_dt + timedelta(hours=8)
    pht_time_str = pht_dt.strftime('%I:%M %p').lstrip('0')
    init_str = f"INIT {init_dt.strftime('%d %b %H').upper()}Z ({pht_time_str} PHT)"

    # Region naming and natural description
    all_first_lats = [tdf.iloc[0]['lat'] for tdf in deduped_track_dfs if not tdf.empty]
    all_first_lons = [tdf.iloc[0]['lon'] for tdf in deduped_track_dfs if not tdf.empty]
    mean_gen_lat = np.mean(all_first_lats) if all_first_lats else 15.0
    mean_gen_lon = np.mean(all_first_lons) if all_first_lons else 135.0

    if 112.0 <= mean_gen_lon <= 121.0 and 10.0 <= mean_gen_lat <= 22.0:
        region_name = "WEST PHILIPPINE SEA"
        region_friendly = "in the West Philippine Sea"
    elif 121.0 <= mean_gen_lon <= 138.0 and 5.0 <= mean_gen_lat <= 25.0:
        region_name = "PHILIPPINE SEA"
        region_friendly = "in the Philippine Sea"
    elif mean_gen_lon < 120.0 and mean_gen_lat < 12.0:
        region_name = "SULU / CELEBES SEA"
        region_friendly = "in the Sulu / Celebes Sea"
    elif mean_gen_lon >= 152.0 and mean_gen_lat <= 20.0:
        region_name = "EASTERN CAROLINE / WESTPAC"
        region_friendly = "in Eastern Caroline Islands / WestPac"
    elif 138.0 <= mean_gen_lon < 152.0 and mean_gen_lat <= 25.0:
        region_name = "EAST OF MARIANAS / WESTPAC"
        region_friendly = "east of the Marianas"
    elif mean_gen_lat > 25.0:
        region_name = "EAST CHINA SEA / RYUKYU"
        region_friendly = "in the East China Sea / Ryukyu"
    else:
        region_name = "WESTERN PACIFIC"
        region_friendly = "in the Western Pacific"

    # Full forecast horizon calculations
    max_lead_h = max(tdf['lead_time_hours'].max() for tdf in deduped_track_dfs if not tdf.empty)
    end_run_dt = init_dt + timedelta(hours=float(max_lead_h))
    end_run_str = end_run_dt.strftime('%b %d').upper()

    dev_full_pct = int(round((cluster_members / total_ensemble_members) * 100))
    dev_full_pct = min(100, max(1, dev_full_pct))

    # 7-day potential (genesis within 168h reaching >= 25 kt)
    dev_7d_count = sum(1 for tdf in deduped_track_dfs if (not tdf.empty and tdf['lead_time_hours'].min() <= 168 and tdf[tdf['lead_time_hours'] <= 168]['wind'].max() >= 25))
    dev_7d_pct = int(round((dev_7d_count / total_ensemble_members) * 100))
    dev_7d_pct = min(100, max(1, dev_7d_pct))

    ts_count = sum(1 for tdf in deduped_track_dfs if tdf['wind'].max() >= 34)
    ty_count = sum(1 for tdf in deduped_track_dfs if tdf['wind'].max() >= 64)
    major_count = sum(1 for tdf in deduped_track_dfs if tdf['wind'].max() >= 96)

    ts_pct = int(round((ts_count / total_ensemble_members) * 100))
    ty_pct = int(round((ty_count / total_ensemble_members) * 100))
    major_pct = int(round((major_count / total_ensemble_members) * 100))

    gen_hours = [tdf.iloc[0]['lead_time_hours'] for tdf in deduped_track_dfs if not tdf.empty]
    p25_gen_h = float(np.percentile(gen_hours, 25)) if gen_hours else 12.0
    p75_gen_h = float(np.percentile(gen_hours, 75)) if gen_hours else 48.0

    gen_start_dt = init_dt + timedelta(hours=float(p25_gen_h))
    gen_end_dt = init_dt + timedelta(hours=float(max(p75_gen_h, p25_gen_h + 24)))
    if gen_start_dt.strftime('%b %d') == gen_end_dt.strftime('%b %d'):
        peak_window_str = f"{gen_start_dt.strftime('%b %d').upper()}"
    else:
        peak_window_str = f"{gen_start_dt.strftime('%b %d').upper()} - {gen_end_dt.strftime('%b %d').upper()}"

    # Intensity plume
    all_leads = sorted(list(set(df_storm['lead_time_hours'].dropna().astype(int).values)))
    lead_stats = []
    for lh in all_leads:
        winds_at_h = []
        for tdf in deduped_track_dfs:
            row = tdf[tdf['lead_time_hours'] == lh]
            if not row.empty:
                w = row.iloc[0]['wind']
                if not np.isnan(w):
                    winds_at_h.append(w)
        if len(winds_at_h) >= max(3, int(cluster_members * 0.15)):
            lead_stats.append({
                'lead_hour': lh,
                'dt': init_dt + timedelta(hours=float(lh)),
                'p10': np.percentile(winds_at_h, 10),
                'p25': np.percentile(winds_at_h, 25),
                'median': np.median(winds_at_h),
                'mean': np.mean(winds_at_h),
                'p75': np.percentile(winds_at_h, 75),
                'p90': np.percentile(winds_at_h, 90)
            })

    if lead_stats:
        peak_stat = max(lead_stats, key=lambda s: s['median'])
        peak_median_kt = int(round(peak_stat['median']))
        peak_median_str = f"PEAK MEDIAN {peak_median_kt} KT · {peak_stat['dt'].strftime('%b %d %H').upper()}Z"
    else:
        peak_median_str = "PEAK MEDIAN N/A"

    print(f"Generating broadcast-grade development signal graphic for {model_name} – {storm_group_id} ({region_name}) ...")

    fig = plt.figure(figsize=(16, 10), facecolor='#090d14')

    # Top Header
    fig.text(
        0.035, 0.958, f"{region_name} DEVELOPMENT SIGNAL",
        fontsize=22, weight='heavy', color='#ffffff', fontfamily='sans-serif'
    )
    fig.text(
        0.035, 0.932, f"{model_name.upper()} {total_ensemble_members}-MEMBER ENSEMBLE  |  {init_str}",
        fontsize=10.5, weight='bold', color='#94a3b8', fontfamily='monospace'
    )

    fig.text(
        0.965, 0.958, "PHILIPPINE TYPHOON WEATHER",
        fontsize=13.0, weight='heavy', color='#f1f5f9', ha='right', fontfamily='sans-serif'
    )
    fig.text(
        0.965, 0.934, "ENSEMBLE CLUSTER GENESIS SIGNAL",
        fontsize=9.0, weight='bold', color='#64748b', ha='right', fontfamily='monospace'
    )

    # Coordinates
    map_left = 0.035
    map_w = 0.575
    map_bottom = 0.108
    map_h = 0.800

    ax_map = fig.add_axes([map_left, map_bottom, map_w, map_h], projection=ccrs.PlateCarree())
    ax_map.set_facecolor('#090d14')

    all_lons = df_storm['lon'].dropna().values
    all_lats = df_storm['lat'].dropna().values
    min_lon = float(np.percentile(all_lons, 1))
    max_lon = float(np.percentile(all_lons, 99))
    min_lat = float(np.percentile(all_lats, 1))
    max_lat = float(np.percentile(all_lats, 99))

    lon_pad = max(8.0, (max_lon - min_lon) * 0.25)
    lat_pad = max(5.0, (max_lat - min_lat) * 0.25)
    view_lon_min = max(105.0, min_lon - lon_pad)
    view_lon_max = min(180.0, max_lon + lon_pad)
    view_lat_min = max(3.0, min_lat - lat_pad)
    view_lat_max = min(44.0, max_lat + lat_pad)

    # Ensure full eastern coverage if cluster sits far east
    if max_lon > 150.0 and view_lon_max < 176.0:
        view_lon_max = min(180.0, 178.0)

    if view_lon_max - view_lon_min < 26:
        mid_lon = (view_lon_min + view_lon_max) / 2
        view_lon_min = max(105.0, mid_lon - 13)
        view_lon_max = min(180.0, mid_lon + 13)
    if view_lat_max - view_lat_min < 18:
        mid_lat = (view_lat_min + view_lat_max) / 2
        view_lat_min = max(3.0, mid_lat - 9)
        view_lat_max = min(44.0, mid_lat + 9)

    ax_map.set_extent([view_lon_min, view_lon_max, view_lat_min, view_lat_max], crs=ccrs.PlateCarree())

    ocean_color = '#0b111b'
    land_color = '#181e29'
    border_color = '#334155'
    coast_color = '#64748b'

    ax_map.add_feature(cfeature.OCEAN, facecolor=ocean_color, zorder=1)
    ax_map.add_feature(cfeature.LAND, facecolor=land_color, edgecolor=border_color, linewidth=0.6, zorder=2)
    ax_map.add_feature(cfeature.COASTLINE, edgecolor=coast_color, linewidth=0.8, zorder=3)
    ax_map.add_feature(cfeature.BORDERS, linestyle='-', edgecolor=border_color, linewidth=0.6, zorder=3)

    try:
        geojson_paths = [
            "d:/philippine-weather-app/public/data/ph_provinces.json",
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "data", "ph_provinces.json")
        ]
        found_geojson = next((p for p in geojson_paths if os.path.exists(p)), None)
        if found_geojson:
            with open(found_geojson, 'r', encoding='utf-8') as gf:
                geojson_data = json.load(gf)
            prov_geoms = [shape(feature['geometry']) for feature in geojson_data['features']]
            ax_map.add_geometries(prov_geoms, crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#334155', linewidth=0.45, alpha=0.6, zorder=3)
    except Exception as e:
        print(f"Warning: Province boundary overlay skipped: {e}")

    par_vertices = [
        (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
        (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
    ]
    ax_map.add_patch(mpatches.Polygon(
        par_vertices, facecolor='none', edgecolor='#f97316', linestyle='-', linewidth=1.6,
        alpha=0.75, transform=ccrs.PlateCarree(), zorder=4, label='PAR'
    ))
    if view_lon_min + 1 <= 118 <= view_lon_max - 1 and view_lat_min + 1 <= 14 <= view_lat_max - 1:
        wps_lbl = ax_map.text(118, 14, 'West Philippine\nSea', fontsize=8.0, color='#94a3b8', weight='bold',
                    transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.85, zorder=7)
        wps_lbl.set_path_effects([path_effects.withStroke(linewidth=2.5, foreground='#090d14')])
    if view_lon_min + 1 <= 131 <= view_lon_max - 1 and view_lat_min + 1 <= 19 <= view_lat_max - 1:
        ps_lbl = ax_map.text(131, 19, 'Philippine\nSea', fontsize=9.0, color='#94a3b8', weight='bold',
                    transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.85, zorder=7)
        ps_lbl.set_path_effects([path_effects.withStroke(linewidth=2.5, foreground='#090d14')])

    gl = ax_map.gridlines(draw_labels=True, linewidth=0.4, color='#334155', alpha=0.4, linestyle=':')
    gl.top_labels = False
    gl.right_labels = False
    gl.xlabel_style = {'size': 8.0, 'color': '#64748b', 'weight': 'bold'}
    gl.ylabel_style = {'size': 8.0, 'color': '#64748b', 'weight': 'bold'}

    # Genesis contours
    early_pts = []
    for tdf in deduped_track_dfs:
        early_sub = tdf[tdf['lead_time_hours'] <= (tdf['lead_time_hours'].min() + 36)]
        for _, r in early_sub.iterrows():
            if not np.isnan(r['lon']) and not np.isnan(r['lat']):
                early_pts.append((r['lon'], r['lat']))

    if len(early_pts) >= 6:
        e_lons = [p[0] for p in early_pts]
        e_lats = [p[1] for p in early_pts]

        g_min_x, g_max_x = min(e_lons) - 3.5, max(e_lons) + 3.5
        g_min_y, g_max_y = min(e_lats) - 3.5, max(e_lats) + 3.5
        gx, gy = np.mgrid[g_min_x:g_max_x:120j, g_min_y:g_max_y:120j]
        positions = np.vstack([gx.ravel(), gy.ravel()])
        values = np.vstack([e_lons, e_lats])

        kde = gaussian_kde(values, bw_method=0.40)
        gz = np.reshape(kde(positions).T, gx.shape)
        gz_norm = (gz / gz.max()) * 100.0

        levels = [15, 30, 45, 60, 80, 100]
        kde_colors = ['#0c2340', '#133e68', '#1a5994', '#1f78c1', '#28a0f0']
        ax_map.contourf(
            gx, gy, gz_norm, levels=levels,
            colors=kde_colors, alpha=0.40,
            transform=ccrs.PlateCarree(), zorder=3
        )
        cs_lines = ax_map.contour(
            gx, gy, gz_norm, levels=[20, 40, 60, 80],
            colors=['#60a5fa', '#93c5fd', '#bfdbfe', '#ffffff'],
            linewidths=[0.8, 1.0, 1.2, 1.5],
            transform=ccrs.PlateCarree(), zorder=4
        )
        # Keep two clean, uncollided labels (20% and 60%)
        clabels = ax_map.clabel(
            cs_lines, levels=[20, 60], inline=True,
            fontsize=7.5, fmt='%1.0f%%', colors='#ffffff', zorder=5
        )
        for cl in clabels:
            cl.set_rotation(0)  # Horizontal labels
            cl.set_weight('bold')
            cl.set_path_effects([path_effects.withStroke(linewidth=2.5, foreground='#090d14')])

        gen_center_lon = np.median(e_lons)
        gen_center_lat = np.median(e_lats)
        lon_spread = max(3.0, np.std(e_lons) * 2.2)
        lat_spread = max(2.5, np.std(e_lats) * 2.2)

        # Dynamic color based on 7-day potential: Amber for <60%, Red for >=60%
        if dev_7d_pct >= 60:
            threat_color = '#ef4444'
        elif dev_7d_pct >= 30:
            threat_color = '#f97316'
        else:
            threat_color = '#fbbf24'

        envelope = mpatches.Ellipse(
            (gen_center_lon, gen_center_lat),
            width=lon_spread * 2.4, height=lat_spread * 2.4,
            angle=15, facecolor=threat_color, alpha=0.07,
            edgecolor=threat_color, linestyle='--', linewidth=1.6,
            transform=ccrs.PlateCarree(), zorder=4
        )
        ax_map.add_patch(envelope)

    # Tracks
    wind_bounds = [20, 30, 40, 50, 60, 70, 80, 100, 120, 140]
    wind_colors = [
        '#0f766e',  # < 20: dark teal
        '#14b8a6',  # 20-30: teal
        '#06b6d4',  # 30-40: cyan
        '#22c55e',  # 40-50: green
        '#84cc16',  # 50-60: lime
        '#eab308',  # 60-70: yellow
        '#f97316',  # 70-80: orange
        '#ef4444',  # 80-100: red
        '#ec4899',  # 100-120: hot pink
        '#a855f7',  # 120-140: purple
        '#f3e8ff'   # > 140: light lilac
    ]
    track_cmap = mcolors.ListedColormap(wind_colors)
    track_norm = mcolors.BoundaryNorm(wind_bounds, track_cmap.N, extend='both')

    for member_df in deduped_track_dfs:
        member_df = member_df.sort_values('lead_time_hours')
        if len(member_df) < 2:
            continue
        lons = member_df['lon'].values
        lats = member_df['lat'].values
        winds = member_df['wind'].values

        segments = []
        seg_winds = []
        for i in range(len(lons) - 1):
            if np.isnan(lons[i]) or np.isnan(lons[i+1]) or np.isnan(lats[i]) or np.isnan(lats[i+1]):
                continue
            if abs(lons[i+1] - lons[i]) > 180:
                continue
            segments.append([[lons[i], lats[i]], [lons[i+1], lats[i+1]]])
            w_avg = np.nanmean([winds[i], winds[i+1]]) if not np.isnan(winds[i]) else 25.0
            seg_winds.append(w_avg)

        if not segments:
            continue

        lc_halo = LineCollection(
            segments, cmap=track_cmap, norm=track_norm,
            linewidth=2.8, alpha=0.30, transform=ccrs.PlateCarree(), zorder=5
        )
        lc_halo.set_array(np.array(seg_winds))
        ax_map.add_collection(lc_halo)

        lc = LineCollection(
            segments, cmap=track_cmap, norm=track_norm,
            linewidth=1.2, alpha=0.85, capstyle='round', joinstyle='round',
            transform=ccrs.PlateCarree(), zorder=6
        )
        lc.set_array(np.array(seg_winds))
        ax_map.add_collection(lc)

    for spine in ax_map.spines.values():
        spine.set_edgecolor('#334155')
        spine.set_linewidth(1.2)

    # Docked Legends Axis below the Map (Prevents map overlap)
    leg_bottom = 0.045
    leg_h = 0.052
    ax_leg = fig.add_axes([map_left, leg_bottom, map_w, leg_h])
    ax_leg.set_facecolor('#0d121c')
    ax_leg.set_xticks([])
    ax_leg.set_yticks([])
    for spine in ax_leg.spines.values():
        spine.set_edgecolor('#1e293b')
        spine.set_linewidth(1.0)

    # Section 1: Genesis within 60 NM (%)
    ax_leg.text(
        0.02, 0.72, "GENESIS WITHIN 60 NM (%)",
        transform=ax_leg.transAxes, fontsize=6.8, weight='heavy', color='#e2e8f0', va='center'
    )
    step_x = 0.02
    step_w = 0.034
    step_h = 0.28
    step_y = 0.26
    density_steps = [20, 40, 60, 80, 100]
    dens_colors = ['#133e68', '#1a5994', '#1f78c1', '#28a0f0', '#93c5fd']
    ax_leg.text(
        step_x, step_y - 0.06, "0",
        transform=ax_leg.transAxes, fontsize=6.2, color='#94a3b8', ha='center', va='top'
    )
    for idx, (val, col) in enumerate(zip(density_steps, dens_colors)):
        rect = mpatches.Rectangle(
            (step_x + idx * step_w, step_y), step_w, step_h,
            transform=ax_leg.transAxes, facecolor=col, edgecolor='#090d14', linewidth=0.5
        )
        ax_leg.add_patch(rect)
        ax_leg.text(
            step_x + idx * step_w + step_w / 2, step_y - 0.06, f"{val}",
            transform=ax_leg.transAxes, fontsize=6.2, color='#94a3b8', ha='center', va='top'
        )

    # Section 2: Track Wind (KT)
    ax_leg.text(
        0.24, 0.72, "TRACK WIND (KT)",
        transform=ax_leg.transAxes, fontsize=6.8, weight='heavy', color='#e2e8f0', va='center'
    )
    tw_x = 0.24
    tw_w = 0.040
    tw_h = 0.28
    tw_y = 0.26
    for idx, col in enumerate(wind_colors):
        rect = mpatches.Rectangle(
            (tw_x + idx * tw_w, tw_y), tw_w, tw_h,
            transform=ax_leg.transAxes, facecolor=col, edgecolor='#090d14', linewidth=0.5
        )
        ax_leg.add_patch(rect)
    tw_ticks = [
        (0, '20'),
        (2, '40'),
        (4, '60'),
        (6, '80'),
        (7, '100'),
        (8, '120'),
        (10, '140+')
    ]
    for idx, lbl in tw_ticks:
        ax_leg.text(
            tw_x + idx * tw_w, tw_y - 0.06, lbl,
            transform=ax_leg.transAxes, fontsize=6.2, color='#94a3b8', ha='center', va='top'
        )

    # Section 3: Monitoring Status
    ax_leg.text(
        0.74, 0.72, "MONITORING STATUS",
        transform=ax_leg.transAxes, fontsize=6.8, weight='heavy', color='#e2e8f0', va='center'
    )
    status_box = mpatches.Rectangle(
        (0.74, tw_y), 0.23, tw_h, transform=ax_leg.transAxes,
        facecolor='#1e293b', edgecolor='#334155', linewidth=0.8
    )
    ax_leg.add_patch(status_box)
    ax_leg.text(
        0.855, tw_y + tw_h / 2, "POTENTIAL GENESIS CLUSTER",
        transform=ax_leg.transAxes, fontsize=6.6, weight='bold', color='#38bdf8',
        ha='center', va='center'
    )

    # Right Column Cards
    card_x = 0.640
    # Right Column Cards
    card_x = 0.640
    card_w = 0.325

    # Card 1: Summary Box (Comfortable padding, generous spacing)
    card1_bottom = 0.675
    card1_h = 0.235
    ax_card1 = fig.add_axes([card_x, card1_bottom, card_w, card1_h])
    ax_card1.set_facecolor('#0d121c')
    ax_card1.set_xticks([])
    ax_card1.set_yticks([])
    for spine in ax_card1.spines.values():
        spine.set_edgecolor('#222d3d')
        spine.set_linewidth(1.0)

    ax_card1.text(
        0.06, 0.90, f"{dev_full_pct}% OF MEMBERS",
        fontsize=24, weight='heavy', color='#ffffff', fontfamily='sans-serif', va='top'
    )
    ax_card1.text(
        0.06, 0.70, f"({cluster_members} OF {total_ensemble_members} MEMBERS · FULL RUN TO {end_run_str})",
        fontsize=9.2, weight='bold', color='#38bdf8', fontfamily='monospace', va='top'
    )
    ax_card1.text(
        0.06, 0.52, f"of members develop a tropical cyclone\n{region_friendly}",
        fontsize=9.0, weight='bold', color='#cbd5e1', fontfamily='sans-serif', va='top'
    )
    ax_card1.text(
        0.06, 0.30, f"PEAK GENESIS WINDOW: {peak_window_str}",
        fontsize=8.5, weight='bold', color='#94a3b8', fontfamily='monospace', va='top'
    )
    ax_card1.text(
        0.06, 0.16, f"{ts_count} OF {total_ensemble_members} ({ts_pct}%) REACH TS  ·  {ty_count} TYPHOON  ·  {major_count} MAJOR",
        fontsize=8.0, weight='bold', color='#e2e8f0', fontfamily='monospace', va='top'
    )

    # Card 2: Intensity Plume (True Date Axis, Clear Top Gap)
    card2_bottom = 0.365
    card2_h = 0.245
    ax_card2 = fig.add_axes([card_x, card2_bottom, card_w, card2_h])
    ax_card2.set_facecolor('#0a0e17')

    cats = [
        ('TD', 0, 34, '#0f172a', '#38bdf8'),
        ('TS', 34, 64, '#064e3b', '#34d399'),
        ('C1', 64, 83, '#713f12', '#facc15'),
        ('C2', 83, 96, '#7c2d12', '#fb923c'),
        ('C3', 96, 113, '#7f1d1d', '#f87171'),
        ('C4', 113, 137, '#701a75', '#e879f9'),
        ('C5', 137, 160, '#3b0764', '#c084fc')
    ]
    for c_label, c_low, c_high, c_bg, c_txt in cats:
        ax_card2.axhspan(c_low, c_high, facecolor=c_bg, alpha=0.55, edgecolor='none', zorder=1)
        ax_card2.text(
            0.015, (c_low + c_high) / 2, c_label,
            color=c_txt, fontsize=7.2, weight='heavy', va='center', ha='left',
            transform=ax_card2.get_yaxis_transform(), zorder=4
        )

    if lead_stats:
        ls_dts = [s['dt'] for s in lead_stats]
        ls_p10 = [s['p10'] for s in lead_stats]
        ls_p25 = [s['p25'] for s in lead_stats]
        ls_med = [s['median'] for s in lead_stats]
        ls_mean = [s['mean'] for s in lead_stats]
        ls_p75 = [s['p75'] for s in lead_stats]
        ls_p90 = [s['p90'] for s in lead_stats]

        for tdf in deduped_track_dfs:
            tdf_dts = [init_dt + timedelta(hours=float(h)) for h in tdf['lead_time_hours']]
            ax_card2.plot(
                tdf_dts, tdf['wind'],
                color='#94a3b8', alpha=0.10, linewidth=0.8, zorder=2
            )

        ax_card2.fill_between(
            ls_dts, ls_p10, ls_p90,
            color='#0284c7', alpha=0.20, label='10-90%', zorder=3
        )
        ax_card2.fill_between(
            ls_dts, ls_p25, ls_p75,
            color='#38bdf8', alpha=0.35, label='25-75%', zorder=3
        )

        ax_card2.plot(
            ls_dts, ls_med,
            color='#ffffff', linewidth=2.4, label='MEDIAN', zorder=5
        )
        ax_card2.plot(
            ls_dts, ls_mean,
            color='#f1f5f9', linestyle='--', linewidth=1.6, label='MEAN', zorder=5
        )

        min_c2_dt = min(ls_dts)
        max_c2_dt = max(ls_dts)
        ax_card2.set_xlim(min_c2_dt, max_c2_dt)
        ax_card2.xaxis.set_major_locator(mdates.DayLocator(interval=2))
        ax_card2.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))
        ax_card2.tick_params(axis='x', labelsize=7.2, colors='#94a3b8')
    else:
        ax_card2.set_xlim(init_dt, init_dt + timedelta(days=7))
        ax_card2.xaxis.set_major_locator(mdates.DayLocator(interval=2))
        ax_card2.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))

    ax_card2.set_ylim(0, 160)
    ax_card2.set_yticks([0, 25, 50, 75, 100, 125, 150])
    ax_card2.set_yticklabels(['0', '25', '50', '75', '100', '125', '150'], fontsize=7.2, color='#64748b')
    ax_card2.yaxis.tick_right()
    ax_card2.grid(True, linestyle=':', alpha=0.25, color='#64748b')

    # Card 2 Header & Caveats (Clear 2-line structure with credibility note)
    ax_card2.text(
        0.03, 1.14, "MEMBER INTENSITY (KT - 1-MIN SUSTAINED)",
        transform=ax_card2.transAxes, fontsize=8.0, weight='heavy', color='#f8fafc'
    )
    leg_txt = "— MEDIAN   --- MEAN   ■ 25-75%   ■ 10-90%"
    ax_card2.text(
        0.03, 1.05, leg_txt,
        transform=ax_card2.transAxes, fontsize=6.8, weight='bold', color='#cbd5e1'
    )
    ax_card2.text(
        0.97, 1.14, peak_median_str,
        transform=ax_card2.transAxes, fontsize=7.6, weight='bold', color='#fbbf24', ha='right'
    )
    is_ai_model = any(k in model_name.lower() for k in ['wnc', 'wnv3', 'aifs', 'large'])
    if is_ai_model:
        ax_card2.text(
            0.97, 1.05, "* AI intensity, treat with caution",
            transform=ax_card2.transAxes, fontsize=6.8, weight='bold', color='#fbbf24', style='italic', ha='right'
        )

    for spine in ax_card2.spines.values():
        spine.set_edgecolor('#222d3d')
        spine.set_linewidth(1.0)

    # Card 3: Probability Trend across forecast run (True Date Axis & Direct Line Labels)
    card3_bottom = 0.045
    card3_h = 0.240
    ax_card3 = fig.add_axes([card_x, card3_bottom, card_w, card3_h])
    ax_card3.set_facecolor('#0a0e17')

    max_lead_h = max(48.0, df_storm['lead_time_hours'].max())
    eval_hours = np.arange(0, max_lead_h + 1, 12.0)
    eval_dts = [init_dt + timedelta(hours=float(h)) for h in eval_hours]

    ts_by_lead = []
    ty_by_lead = []
    maj_by_lead = []

    for h in eval_hours:
        ts_m = sum(1 for tdf in deduped_track_dfs if tdf[tdf['lead_time_hours'] <= h]['wind'].max() >= 34)
        ty_m = sum(1 for tdf in deduped_track_dfs if tdf[tdf['lead_time_hours'] <= h]['wind'].max() >= 64)
        maj_m = sum(1 for tdf in deduped_track_dfs if tdf[tdf['lead_time_hours'] <= h]['wind'].max() >= 96)

        ts_by_lead.append(round((ts_m / total_ensemble_members) * 100))
        ty_by_lead.append(round((ty_m / total_ensemble_members) * 100))
        maj_by_lead.append(round((maj_m / total_ensemble_members) * 100))

    # Distinct layered line widths & markers so overlapping curves are visible
    ax_card3.plot(eval_dts, ts_by_lead, color='#38bdf8', linewidth=2.8, label='TS', marker='o', markersize=3.6, zorder=4)
    ax_card3.plot(eval_dts, ty_by_lead, color='#f59e0b', linewidth=2.0, label='TYPHOON', marker='D', markersize=3.4, zorder=5)
    ax_card3.plot(eval_dts, maj_by_lead, color='#ef4444', linewidth=1.3, label='MAJOR', marker='^', markersize=3.6, zorder=6)

    # Dynamic y-axis scale based on signal strength
    max_prob = max(ts_by_lead + ty_by_lead + maj_by_lead + [10])
    if max_prob <= 25:
        y_top = 30
        y_ticks = [0, 10, 20, 30]
        y_labels = ['0%', '10%', '20%', '30%']
    elif max_prob <= 45:
        y_top = 50
        y_ticks = [0, 10, 20, 30, 40, 50]
        y_labels = ['0%', '10%', '20%', '30%', '40%', '50%']
    elif max_prob <= 70:
        y_top = 75
        y_ticks = [0, 25, 50, 75]
        y_labels = ['0%', '25%', '50%', '75%']
    else:
        y_top = 100
        y_ticks = [0, 25, 50, 75, 100]
        y_labels = ['0%', '25%', '50%', '75%', '100%']

    # End percentage labels (clean text, no boxes or inline labels)
    badge_dt = eval_dts[-1] + timedelta(hours=5)
    ax_card3.text(
        badge_dt, ts_by_lead[-1], f"{ts_by_lead[-1]}%",
        color='#38bdf8', fontsize=7.8, weight='heavy', va='center', ha='left', zorder=7
    )
    ax_card3.text(
        badge_dt, ty_by_lead[-1], f"{ty_by_lead[-1]}%",
        color='#f59e0b', fontsize=7.8, weight='heavy', va='center', ha='left', zorder=8
    )
    if maj_by_lead[-1] > 0:
        ax_card3.text(
            badge_dt, maj_by_lead[-1], f"{maj_by_lead[-1]}%",
            color='#ef4444', fontsize=7.8, weight='heavy', va='center', ha='left', zorder=9
        )

    ax_card3.set_xlim(eval_dts[0] - timedelta(hours=8), eval_dts[-1] + timedelta(hours=28))
    ax_card3.set_ylim(-1, y_top + 2)
    ax_card3.set_yticks(y_ticks)
    ax_card3.set_yticklabels(y_labels, fontsize=7.2, color='#64748b')
    ax_card3.xaxis.set_major_locator(mdates.DayLocator(interval=2))
    ax_card3.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))
    ax_card3.tick_params(axis='x', labelsize=7.2, colors='#94a3b8')
    ax_card3.grid(True, linestyle=':', alpha=0.25, color='#64748b')

    # Card 3 Header: Title on left, colored line legend on right
    ax_card3.text(
        0.03, 1.10, f"CUMULATIVE PROBABILITY (THROUGH {end_run_str})",
        transform=ax_card3.transAxes, fontsize=8.0, weight='heavy', color='#f8fafc'
    )
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    inv = ax_card3.transAxes.inverted()

    leg_x = 0.98
    for lbl, col in reversed([('— TS', '#38bdf8'), ('— TYPHOON', '#f59e0b'), ('— MAJOR', '#ef4444')]):
        t = ax_card3.text(leg_x, 1.10, lbl, transform=ax_card3.transAxes, fontsize=7.2, weight='heavy', color=col, ha='right')
        bb = t.get_window_extent(renderer=renderer)
        p0 = inv.transform((0, 0))
        p1 = inv.transform((bb.width, 0))
        w_axes = p1[0] - p0[0]
        leg_x -= (w_axes + 0.035)

    for spine in ax_card3.spines.values():
        spine.set_edgecolor('#222d3d')
        spine.set_linewidth(1.0)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    plt.savefig(output_path, dpi=200, bbox_inches='tight', pad_inches=0.15, facecolor='#090d14', edgecolor='none')
    plt.close()
    print(f"Broadcast-grade under-monitoring plot saved to: {output_path}")

def main():
    parser = argparse.ArgumentParser(description="Ensemble Under-Monitoring LPA / Invest Candidate Tracking System")
    parser.add_argument('--input', type=str, nargs='*', help="Input DAT, CSV, or ATCF files")
    parser.add_argument('--lpa-id', type=str, help="Specific LPA ID to plot (e.g. LPA01, MONITORING_LPA01)")
    parser.add_argument('--output-dir', type=str, default='public/assets', help="Directory to save generated plots")
    parser.add_argument('--color-by', type=str, default='wind', choices=['wind', 'pressure'], help="Parameter to color lines by and display in colorbar")
    parser.add_argument('--min-members', type=int, default=5, help="Minimum ensemble members for a monitoring disturbance")
    parser.add_argument('--min-mean-members', type=int, default=25, help="Minimum ensemble members required to compute and render the ensemble mean track")
    parser.add_argument('--min-wind', type=float, default=25.0, help="Minimum maximum wind in knots for monitoring disturbance")
    parser.add_argument('--min-duration', type=float, default=36.0, help="Minimum duration in hours for monitoring disturbance")
    parser.add_argument('--nursery-aggregation', action='store_true', default=True, help="Aggregate compatible candidate clusters in the same spatial nursery")
    parser.add_argument('--no-nursery-aggregation', action='store_false', dest='nursery_aggregation', help="Disable spatial nursery aggregation")
    parser.add_argument('--nursery-dist', type=float, default=600.0, help="Maximum distance in km between genesis centers to aggregate into a single nursery signal")
    args = parser.parse_args()

    input_files = args.input
    if not input_files:
        search_dir = 'public/data'
        # Operational models to monitor: ECMWF AIFS, ECMWF IFS, and GDM WNCv3
        # Excludes older GDM WNC (fnv3p2).
        model_prefixes = [
            'aifs_tc_latest',
            'ifs_tc_latest',
            'wnv3_latest',
            'fnv3_large_latest'
        ]
        input_files = []
        for prefix in model_prefixes:
            dat_path = os.path.join(search_dir, f"{prefix}.dat")
            csv_path = os.path.join(search_dir, f"{prefix}.csv")
            # Strictly prefer .dat file; only check .csv if .dat is not present
            if os.path.exists(dat_path):
                input_files.append(dat_path)
            elif os.path.exists(csv_path):
                input_files.append(csv_path)

    if not input_files:
        print("No input files specified and no default datasets found in public/data.")
        return

    knack_storms = fetch_knack_active_storms()
    if knack_storms:
        knack_storms = [
            s for s in knack_storms 
            if (s['lon'] >= 100 and s['lon'] <= 180 and s['lat'] >= 0 and s['lat'] <= 50)
        ]
    atcf_index_storms = load_atcf_storms_index()

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

        # Validate initialization age: reject runs older than 5 days (120 hours) from current UTC time
        # to prevent ancient archived files from being mistakenly processed.
        if 'init_time' in wp_df.columns and not wp_df['init_time'].dropna().empty:
            latest_run_init = wp_df['init_time'].dropna().max()
            try:
                run_dt = pd.to_datetime(latest_run_init)
                if run_dt.tzinfo is None:
                    run_dt = run_dt.replace(tzinfo=timezone.utc)
                age_days = (datetime.now(timezone.utc) - run_dt).total_seconds() / 86400.0
                if age_days > 5.0:
                    print(f"Skipping outdated file {f_path}: initialization {latest_run_init} is {age_days:.1f} days old.")
                    continue
            except Exception:
                pass

        model = detect_model_name(f_path)
        total_members = wp_df['sample'].nunique()

        eff_min_members = max(args.min_members, int(total_members * 0.015)) if total_members >= 500 else args.min_members
        eff_min_mean_members = max(args.min_mean_members, int(total_members * 0.05)) if total_members >= 500 else args.min_mean_members

        # Cluster, validate, and identify LPA disturbance candidates (filtering out official ATCF storms)
        wp_df, lpa_clusters = cluster_and_validate_lpas(
            wp_df, 
            knack_storms, 
            atcf_index_storms=atcf_index_storms,
            total_members=total_members,
            min_members=eff_min_members,
            min_wind_kt=args.min_wind,
            min_duration=args.min_duration,
            enable_nursery_aggregation=args.nursery_aggregation,
            max_nursery_dist=args.nursery_dist
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

            plot_monitoring_tracks(
                monitoring_df, 
                model, 
                sg_id, 
                out_file, 
                color_by=args.color_by, 
                min_mean_members=eff_min_mean_members,
                total_ensemble_members=total_members,
                knack_storms=knack_storms,
                atcf_index_storms=atcf_index_storms
            )
            latest_plotted_init[out_file] = current_init_dt

            # Only register in manifest if image was actually generated (not skipped due to ATCF)
            if not os.path.exists(out_file):
                continue

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
                    entry['alt_filename'] = primary_filename
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
                    'alt_filename': primary_filename,
                    'is_monitoring': True,
                    'timestamp': datetime.now(timezone.utc).isoformat()
                })

            os.makedirs(os.path.dirname(manifest_file), exist_ok=True)
            with open(manifest_file, 'w', encoding='utf-8') as mf:
                json.dump(manifest_data, mf, indent=2)

if __name__ == '__main__':
    main()
