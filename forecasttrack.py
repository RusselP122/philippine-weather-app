import os
import sys
import re
import json
import math
import io
import base64
import argparse
import glob
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from shapely.geometry import shape, Polygon
from shapely.ops import unary_union
import urllib.request
from datetime import datetime, timezone, timedelta

# NHC standard cone radii (nautical miles) by lead time (hours)
LEAD_STANDARD = [0,  12,  24,  36,  48,   60,   72,   96,  120,  144]
RADII_NM      = [0,  26,  38,  50,  59,   71,   83,  113,  146,  180]

# ── Forecast Panel Palette Constants ─────────────────────────────
PANEL_BG     = "#0f1923"   # deep navy
CARD_BG      = "#162130"   # surface card
CARD_BORDER  = "#1e3247"   # subtle border
ACCENT_LINE  = "#2a78d6"   # blue — trend line
MSLP_LINE    = "#eb6834"   # orange — pressure line
WIND_HIGH    = "#e34948"   # red tint for high wind
WIND_MID     = "#eda100"   # amber for moderate
WIND_LOW     = "#1baf7a"   # green for low
TEXT_PRI     = "#e8eef4"   # near-white primary text
TEXT_SEC     = "#7a9ab5"   # muted blue-gray secondary
TEXT_MUT     = "#4a6a84"   # very muted for labels
GRIDLINE     = "#1a2d3f"   # gridlines

def wind_color(kmh):
    if kmh >= 62: return WIND_HIGH
    if kmh >= 52: return WIND_MID
    return WIND_LOW


def clean_storm_id_no_dot(raw_id):
    """
    Strips any dot '.' characters and formats storm IDs into standard clean strings.
    Example: 'WP01.2026' -> '01W STORM', '90.W' -> '90W INVEST', 'WP92' -> '92W INVEST'
    """
    if not raw_id:
        return "UNKNOWN"
    
    clean_str = str(raw_id).replace('.', '').strip().upper()
    
    def is_invest_val(s):
        m = re.search(r'\d{2}', s)
        if m:
            val = int(m.group(0))
            return 90 <= val <= 99
        return False
        
    is_invest = 'INVEST' in clean_str or is_invest_val(clean_str)
    
    num = None
    letter = "W"
    
    # Match patterns like WP012026, WP902026
    m = re.match(r'^([A-Z]{2})(\d{2})\d{4}$', clean_str)
    if m:
        num = m.group(2)
        letter = 'W' if m.group(1) == 'WP' else m.group(1)[0]
    else:
        # Match 90W, 01W
        m = re.match(r'^(\d{2})([A-Z])$', clean_str)
        if m:
            num = m.group(1)
            letter = m.group(2)
        else:
            # Match WP90, WP01
            m = re.match(r'^([A-Z]{2})(\d{2})$', clean_str)
            if m:
                num = m.group(2)
                letter = 'W' if m.group(1) == 'WP' else m.group(1)[0]
            else:
                # Match W90, W01
                m = re.match(r'^([A-Z])(\d{2})$', clean_str)
                if m:
                    num = m.group(2)
                    letter = m.group(1)
                else:
                    # Match digits only '90', '01'
                    m = re.match(r'^(\d{2})$', clean_str)
                    if m:
                        num = m.group(1)
                        
    if num:
        if is_invest:
            return f"{num}{letter} INVEST"
        else:
            return f"{num}{letter} STORM"
            
    return clean_str


def get_short_atcf_id(raw_id):
    """Returns clean short ATCF ID like '90W' or '01W' without dots."""
    clean_name = clean_storm_id_no_dot(raw_id)
    m = re.search(r'(\d{2}[A-Z])', clean_name)
    if m:
        return m.group(1)
    return str(raw_id).replace('.', '').upper()


def fetch_knack_active_storms():
    """
    Fetches active tropical cyclones from the Knack API.
    Returns list of dicts: {'atcf_id': ..., 'name': ..., 'lat': ..., 'lon': ..., 'init_time': ...}
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
                    
            atcf_id = str(item.get('atcf_id', '')).replace('.', '')
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
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2.0)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0)**2
    return R * 2.0 * math.asin(math.sqrt(a))


def normalize_dataframe(df):
    """
    Standardizes loaded track dataframes (matching plot_ensemble_spaghetti.py).
    """
    if df.empty:
        return df
        
    df = df.copy()
    df.columns = df.columns.str.strip()
    
    rename_dict = {}
    for col in df.columns:
        col_lower = col.lower()
        if col_lower in ('lat', 'latitude', 'lat_str'):
            rename_dict[col] = 'lat'
        elif col_lower in ('lon', 'longitude', 'lon_str'):
            rename_dict[col] = 'lon'
        elif col_lower in ('pressure', 'minimum_sea_level_pressure_hpa', 'mslp'):
            rename_dict[col] = 'pressure'
        elif col_lower in ('wind', 'maximum_sustained_wind_speed_knots', 'vmax'):
            rename_dict[col] = 'wind'
        elif col_lower in ('lead_time_hours', 'tau'):
            rename_dict[col] = 'lead_time_hours'
            
    df = df.rename(columns=rename_dict)
    
    if 'track_id' not in df.columns:
        if 'basin' in df.columns and 'cyclone_number' in df.columns:
            df['track_id'] = df['basin'].astype(str) + df['cyclone_number'].astype(str).str.zfill(2)
        else:
            df['track_id'] = 'STORM'
            
    if 'sample' not in df.columns:
        df['sample'] = 0
        
    for col in ['lat', 'lon', 'lead_time_hours']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
            
    if 'lon' in df.columns:
        df['lon'] = np.where(df['lon'] > 180, df['lon'] - 360, df['lon'])
        
    return df


def load_and_decrypt_track_file(file_path):
    """
    Decrypts XOR base64 DAT files or loads CSV/ATCF files, returning normalized track DataFrames.
    """
    if not os.path.exists(file_path):
        return pd.DataFrame()
        
    try:
        if file_path.endswith('.dat'):
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    b64_content = f.read().strip()
                xored_bytes = base64.b64decode(b64_content)
                decrypted_bytes = bytearray([b ^ 0xAA for b in xored_bytes])
                csv_text = decrypted_bytes.decode('utf-8', errors='ignore')
                df = pd.read_csv(io.StringIO(csv_text), comment='#')
            except Exception:
                # Fallback for plain ATCF text file
                df = pd.read_csv(file_path, comment='#', header=None, on_bad_lines='skip')
        else:
            df = pd.read_csv(file_path, comment='#')
            
        return normalize_dataframe(df)
    except Exception as e:
        print(f"Warning: Failed to load track file {file_path}: {e}")
        return pd.DataFrame()


def get_actual_ensemble_mean_for_storm(storm, model_file_path):
    """
    Extracts actual ensemble track members for a model from workspace files
    and computes the true geographic ensemble mean track (mean lat/lon per lead time).
    """
    df = load_and_decrypt_track_file(model_file_path)
    if df.empty or 'lat' not in df.columns or 'lon' not in df.columns:
        return pd.DataFrame()
        
    curr_lat, curr_lon = storm['lat'], storm['lon']
    short_id = get_short_atcf_id(storm['atcf_id'])
    
    # 1. First attempt: match by track_id string (e.g. 12W, WP12, WP122026)
    matching_tracks = pd.DataFrame()
    if 'track_id' in df.columns:
        track_ids = df['track_id'].astype(str).str.upper()
        mask = track_ids.str.contains(short_id.upper()) | track_ids.str.contains(storm['atcf_id'].upper())
        matching_tracks = df[mask]
        
    # 2. If no track_id match or empty, spatial proximity filter (initial point <= 500 km from active storm)
    if matching_tracks.empty:
        keep_keys = set()
        for (t_id, s_val), track_pts in df.groupby(['track_id', 'sample']):
            track_pts = track_pts.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
            if track_pts.empty:
                continue
            first_pt = track_pts.iloc[0]
            dist_km = haversine_km(first_pt['lat'], first_pt['lon'], curr_lat, curr_lon)
            if dist_km <= 500.0:
                keep_keys.add((t_id, s_val))
                
        if keep_keys:
            conds = [((df['track_id'] == k[0]) & (df['sample'] == k[1])) for k in keep_keys]
            matching_tracks = df[pd.concat(conds, axis=1).any(axis=1)]
            
    if matching_tracks.empty:
        return pd.DataFrame()
        
    # Filter sample != -1 to exclude deterministic/paired tracks from ensemble mean calculation
    calc_df = matching_tracks[matching_tracks['sample'] != -1]
    if calc_df.empty:
        calc_df = matching_tracks
        
    # Calculate required_support (50% of the total ensemble size for this storm)
    total_members = calc_df['sample'].nunique()
    if total_members > 0:
        required_support = max(1, total_members // 2)
    else:
        required_support = 1
        
    # Group by lead_time_hours and enforce hourly member support constraint
    mean_rows = []
    for h, h_group in calc_df.groupby('lead_time_hours'):
        valid_pts = h_group.dropna(subset=['lat', 'lon'])
        n_active = len(valid_pts)
        if n_active >= required_support:
            row_dict = {
                'lead_time_hours': h,
                'lat': valid_pts['lat'].mean(),
                'lon': valid_pts['lon'].mean()
            }
            if 'wind' in valid_pts.columns:
                w_mean = valid_pts['wind'].mean()
                row_dict['wind'] = w_mean
            if 'pressure' in valid_pts.columns:
                row_dict['pressure'] = valid_pts['pressure'].mean()
            mean_rows.append(row_dict)

    mean_track = pd.DataFrame(mean_rows)
    if not mean_track.empty:
        mean_track = mean_track.sort_values('lead_time_hours')
    return mean_track


def parse_atcf_latlon(val_str):
    """Parses ATCF lat/lon format like '145N' or '1320E'."""
    if not val_str or str(val_str).strip() == '':
        return float('nan')
    val_str = str(val_str).strip()
    try:
        num = float(val_str[:-1]) / 10.0
        if val_str[-1].upper() in ('S', 'W'):
            num = -num
        return num
    except (ValueError, IndexError):
        return float('nan')


def get_fnv3_paired_mean_track(storm, data_dir='public/data'):
    """
    Checks for available FNV3p2 paired mean track files (fnv3p2_paired_latest.dat or newest paired CSVs).
    Only uses recent/latest model initialization files.
    """
    latest_files = [
        os.path.join(data_dir, 'fnv3p2_paired_latest.dat'),
        os.path.join(data_dir, 'oper_paired_latest.dat')
    ]
    
    other_candidates = glob.glob(os.path.join(data_dir, '*paired*.dat')) + glob.glob(os.path.join('temp_data', '*paired*.csv'))
    other_candidates = [f for f in other_candidates if 'latest' not in os.path.basename(f)]
    other_candidates.sort(key=lambda f: os.path.getmtime(f), reverse=True)
    
    paired_candidates = [f for f in latest_files if os.path.exists(f)] + other_candidates
    
    curr_lat, curr_lon = storm['lat'], storm['lon']
    short_id = get_short_atcf_id(storm['atcf_id'])
    
    for fpath in paired_candidates:
        if not os.path.exists(fpath):
            continue
            
        # Reject historical files older than 48 hours unless it's explicitly named *_latest.*
        if 'latest' not in os.path.basename(fpath):
            file_mtime = os.path.getmtime(fpath)
            age_hours = (datetime.now().timestamp() - file_mtime) / 3600.0
            if age_hours > 48.0:
                continue

        df = load_and_decrypt_track_file(fpath)
        if df.empty or 'lat' not in df.columns or 'lon' not in df.columns:
            continue
            
        # Filter paired tracks (sample == -1)
        paired_df = df[df['sample'] == -1].copy()
        if paired_df.empty:
            paired_df = df
            
        # Match track closest to active storm position (tightened distance threshold to 250km)
        best_tid = None
        best_dist = 250.0
        
        for tid, t_df in paired_df.groupby('track_id'):
            t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
            if t_df.empty:
                continue
            first_row = t_df.iloc[0]
            d_km = haversine_km(first_row['lat'], first_row['lon'], curr_lat, curr_lon)
            if d_km < best_dist:
                best_dist = d_km
                best_tid = tid
                
        if best_tid is not None:
            matched = paired_df[paired_df['track_id'] == best_tid].sort_values('lead_time_hours')
            cols_to_keep = ['lead_time_hours', 'lat', 'lon']
            if 'wind' in matched.columns: cols_to_keep.append('wind')
            if 'pressure' in matched.columns: cols_to_keep.append('pressure')
            res = matched[cols_to_keep].dropna(subset=['lat', 'lon'])
            if not res.empty:
                print(f"Found official FNV3p2 paired mean track for {short_id} in {os.path.basename(fpath)} (dist: {best_dist:.1f}km)")
                return res
                
    return pd.DataFrame()


def get_aigefs_aimn_mean_track(storm, data_dir='public/data'):
    """
    Checks for available AIGEFS aimn mean track file (aimn.t*z.cyclone.trackatcfunix or aigefs_tc_latest.dat).
    Only uses recent/latest model initialization files.
    """
    latest_files = [os.path.join(data_dir, 'aigefs_tc_latest.dat')]
    other_candidates = glob.glob(os.path.join(data_dir, '*aimn*.trackatcfunix')) + glob.glob(os.path.join('temp_data', '*aimn*.trackatcfunix'))
    other_candidates.sort(key=lambda f: os.path.getmtime(f), reverse=True)
    
    aimn_candidates = [f for f in latest_files if os.path.exists(f)] + other_candidates
    
    curr_lat, curr_lon = storm['lat'], storm['lon']
    short_id = get_short_atcf_id(storm['atcf_id'])
    
    for fpath in aimn_candidates:
        if not os.path.exists(fpath):
            continue
            
        if 'latest' not in os.path.basename(fpath):
            file_mtime = os.path.getmtime(fpath)
            age_hours = (datetime.now().timestamp() - file_mtime) / 3600.0
            if age_hours > 48.0:
                continue

        df = load_and_decrypt_track_file(fpath)
        if df.empty or 'lat' not in df.columns or 'lon' not in df.columns:
            continue
            
        # Look for aimn track (sample == -1 or tech / track_id containing AIMN)
        aimn_df = pd.DataFrame()
        if 'sample' in df.columns and (df['sample'] == -1).any():
            aimn_df = df[df['sample'] == -1].copy()
        elif 'tech' in df.columns:
            mask = df['tech'].astype(str).str.upper().str.contains('AIMN')
            aimn_df = df[mask].copy()
        elif 'track_id' in df.columns:
            mask = df['track_id'].astype(str).str.upper().str.contains('AIMN')
            aimn_df = df[mask].copy()
            
        if aimn_df.empty:
            continue
            
        # Match track closest to active storm position (tightened distance threshold to 250km)
        best_tid = None
        best_dist = 250.0
        
        for tid, t_df in aimn_df.groupby('track_id'):
            t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
            if t_df.empty:
                continue
            first_row = t_df.iloc[0]
            d_km = haversine_km(first_row['lat'], first_row['lon'], curr_lat, curr_lon)
            if d_km < best_dist:
                best_dist = d_km
                best_tid = tid
                
        if best_tid is not None:
            matched = aimn_df[aimn_df['track_id'] == best_tid].sort_values('lead_time_hours')
            cols_to_keep = ['lead_time_hours', 'lat', 'lon']
            if 'wind' in matched.columns: cols_to_keep.append('wind')
            if 'pressure' in matched.columns: cols_to_keep.append('pressure')
            res = matched[cols_to_keep].dropna(subset=['lat', 'lon'])
            if not res.empty:
                print(f"Found official AIGEFS aimn mean track for {short_id} in {os.path.basename(fpath)} (dist: {best_dist:.1f}km)")
                return res

    # Attempt fetching live NOAA aimn track if not available locally
    try:
        now_utc = datetime.now(timezone.utc)
        for day_offset in range(2):
            check_date = (now_utc - timedelta(days=day_offset))
            date_str = check_date.strftime('%Y%m%d')
            for rt in ['18', '12', '06', '00']:
                url = f"https://nomads.ncep.noaa.gov/pub/data/nccf/com/ens_tracker/prod/aigefs.{date_str}/{rt}/tctrack/aimn.t{rt}z.cyclone.trackatcfunix"
                try:
                    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, timeout=4) as response:
                        content = response.read().decode('utf-8', errors='ignore')
                    
                    rows = []
                    for line in content.splitlines():
                        parts = [p.strip() for p in line.split(',')]
                        if len(parts) >= 10:
                            b, cy, ymdh, tau, la_str, lo_str = parts[0], parts[1], parts[2], parts[5], parts[6], parts[7]
                            la = parse_atcf_latlon(la_str)
                            lo = parse_atcf_latlon(lo_str)
                            try:
                                h = int(tau)
                            except ValueError:
                                h = 0
                            row_data = {'track_id': f"{b}{cy}", 'lead_time_hours': h, 'lat': la, 'lon': lo}
                            # ATCF fields: parts[8] = wind (kt), parts[9] = pressure (hPa)
                            if len(parts) > 8 and parts[8].strip():
                                try: row_data['wind'] = float(parts[8])
                                except ValueError: pass
                            if len(parts) > 9 and parts[9].strip():
                                try: row_data['pressure'] = float(parts[9])
                                except ValueError: pass
                            rows.append(row_data)
                            
                    if rows:
                        live_df = pd.DataFrame(rows)
                        for tid, t_df in live_df.groupby('track_id'):
                            t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
                            if t_df.empty:
                                continue
                            first_row = t_df.iloc[0]
                            d_km = haversine_km(first_row['lat'], first_row['lon'], curr_lat, curr_lon)
                            if d_km <= 250.0:
                                print(f"Successfully fetched live NOAA AIGEFS aimn mean track for {short_id} (dist: {d_km:.1f}km)")
                                cols_ret = ['lead_time_hours', 'lat', 'lon']
                                if 'wind' in t_df.columns: cols_ret.append('wind')
                                if 'pressure' in t_df.columns: cols_ret.append('pressure')
                                ret_df = t_df[cols_ret].copy()
                                return ret_df
                except Exception:
                    continue
    except Exception:
        pass
        
    return pd.DataFrame()


def get_pagasa_official_track(storm, data_dir='public/data'):
    """
    Fetches and parses PAGASA's official forecast track from https://pubfiles.pagasa.dost.gov.ph/tamss/weather/cyclone.dat
    or local fallback file public/data/cyclone.dat.
    """
    url = "https://pubfiles.pagasa.dost.gov.ph/tamss/weather/cyclone.dat"
    local_path = os.path.join(data_dir, "cyclone.dat")
    content = ""
    
    # 1. Attempt live download from PAGASA public server
    try:
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req, timeout=6) as response:
            content = response.read().decode('utf-8', errors='ignore')
            if content.strip():
                os.makedirs(data_dir, exist_ok=True)
                with open(local_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                print(f"Successfully fetched live PAGASA cyclone.dat from {url}")
    except Exception as e:
        print(f"Notice: Live PAGASA fetch from {url} encountered: {e}")

    # 2. Fallback to local cyclone.dat file if live fetch produced no content
    if not content.strip() and os.path.exists(local_path):
        try:
            with open(local_path, 'r', encoding='utf-8') as f:
                content = f.read()
            print(f"Loaded PAGASA cyclone.dat from local cache {local_path}")
        except Exception:
            pass

    if not content.strip():
        return pd.DataFrame()

    curr_lat, curr_lon = storm['lat'], storm['lon']
    short_id = get_short_atcf_id(storm['atcf_id'])

    rows = []
    t0 = None
    
    for line in content.splitlines():
        line = line.strip()
        if not line or '{' in line:
            continue
        parts = [p.strip() for p in line.split(',')]
        if len(parts) >= 5:
            cat = parts[0]
            date_str = parts[1]
            time_str = parts[2]
            try:
                lat = float(parts[3])
                lon = float(parts[4])
                dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
                if t0 is None:
                    t0 = dt
                tau = (dt - t0).total_seconds() / 3600.0
                rows.append({
                    'lead_time_hours': tau,
                    'lat': lat,
                    'lon': lon,
                    'category': cat
                })
            except Exception:
                continue

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    first_pt = df.iloc[0]
    dist_km = haversine_km(first_pt['lat'], first_pt['lon'], curr_lat, curr_lon)
    
    # Accept PAGASA track if within 650 km or if storm is within Philippine Area of Responsibility
    if dist_km <= 650.0 or (115 <= curr_lon <= 135 and 5 <= curr_lat <= 25):
        print(f"Matched official PAGASA track for {short_id} (dist: {dist_km:.1f}km)")
        return df[['lead_time_hours', 'lat', 'lon']]
        
    return pd.DataFrame()


def get_ecmwf_control_or_paired_track(storm, fpath):
    """
    Checks if an ECMWF file contains an official control track (sample == 0) or paired/mean track (sample == -1).
    If available and within 250 km of active storm position, returns that official track DataFrame.
    """
    if not os.path.exists(fpath):
        return pd.DataFrame()
        
    df = load_and_decrypt_track_file(fpath)
    if df.empty or 'lat' not in df.columns or 'lon' not in df.columns:
        return pd.DataFrame()
        
    curr_lat, curr_lon = storm['lat'], storm['lon']
    short_id = get_short_atcf_id(storm['atcf_id'])
    
    # Filter control (sample == 0) or paired (sample == -1)
    ctrl_df = pd.DataFrame()
    if 'sample' in df.columns:
        ctrl_df = df[df['sample'].isin([0, -1])].copy()
    if ctrl_df.empty:
        return pd.DataFrame()
        
    best_tid = None
    best_dist = 250.0  # km threshold
    
    for tid, t_df in ctrl_df.groupby('track_id'):
        t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
        if t_df.empty:
            continue
        first_row = t_df.iloc[0]
        d_km = haversine_km(first_row['lat'], first_row['lon'], curr_lat, curr_lon)
        if d_km < best_dist:
            best_dist = d_km
            best_tid = tid
            
    if best_tid is not None:
        matched = ctrl_df[ctrl_df['track_id'] == best_tid].sort_values('lead_time_hours')
        cols_to_keep = ['lead_time_hours', 'lat', 'lon']
        if 'wind' in matched.columns: cols_to_keep.append('wind')
        if 'pressure' in matched.columns: cols_to_keep.append('pressure')
        res = matched[cols_to_keep].dropna(subset=['lat', 'lon'])
        if not res.empty:
            print(f"Found official ECMWF control/paired track for {short_id} in {os.path.basename(fpath)} (dist: {best_dist:.1f}km)")
            return res
            
    return pd.DataFrame()


def load_all_actual_tracks_for_storm(storm):
    """
    Scans public/data to extract actual ensemble means for:
    - FNV3p2 (prefers paired track if available, else calculated ensemble mean)
    - ECMWF IFS (prefers control/paired track if available, else calculated ensemble mean)
    - ECMWF AIFS (prefers control/paired track if available, else calculated ensemble mean)
    - AIGEFS (prefers aimn track if available, else calculated ensemble mean)
    And official agency tracks (PAGASA from cyclone.dat, JTWC, JMA).
    """
    agency_tracks = {}
    ensemble_means = {}
    
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public', 'data')
    
    # 1. FNV3p2: Check paired file first, fallback to calculated ensemble mean
    fnv3_paired = get_fnv3_paired_mean_track(storm, data_dir)
    if not fnv3_paired.empty:
        ensemble_means['FNV3p2'] = fnv3_paired
    else:
        fnv3_calc = get_actual_ensemble_mean_for_storm(storm, os.path.join(data_dir, 'fnv3p2_latest.dat'))
        if not fnv3_calc.empty:
            ensemble_means['FNV3p2'] = fnv3_calc

    # 2. ECMWF IFS: Check control/paired track first, fallback to calculated ensemble mean
    for fpath in [os.path.join(data_dir, 'ifs_tc_latest.dat'), os.path.join(data_dir, 'ifs_tc_latest.csv')]:
        if os.path.exists(fpath):
            ifs_ctrl = get_ecmwf_control_or_paired_track(storm, fpath)
            if not ifs_ctrl.empty:
                ensemble_means['ECMWF IFS'] = ifs_ctrl
            else:
                ifs_calc = get_actual_ensemble_mean_for_storm(storm, fpath)
                if not ifs_calc.empty:
                    ensemble_means['ECMWF IFS'] = ifs_calc
            break

    # 3. ECMWF AIFS: Check control/paired track first, fallback to calculated ensemble mean
    for fpath in [os.path.join(data_dir, 'aifs_tc_latest.csv'), os.path.join(data_dir, 'aifs_tc_latest.dat')]:
        if os.path.exists(fpath):
            aifs_ctrl = get_ecmwf_control_or_paired_track(storm, fpath)
            if not aifs_ctrl.empty:
                ensemble_means['ECMWF AIFS'] = aifs_ctrl
            else:
                aifs_calc = get_actual_ensemble_mean_for_storm(storm, fpath)
                if not aifs_calc.empty:
                    ensemble_means['ECMWF AIFS'] = aifs_calc
            break

    # 4. AIGEFS: Check aimn mean track file first, fallback to calculated ensemble mean
    aigefs_aimn = get_aigefs_aimn_mean_track(storm, data_dir)
    if not aigefs_aimn.empty:
        ensemble_means['AIGEFS'] = aigefs_aimn
    else:
        aigefs_calc = get_actual_ensemble_mean_for_storm(storm, os.path.join(data_dir, 'aigefs_tc_latest.dat'))
        if not aigefs_calc.empty:
            ensemble_means['AIGEFS'] = aigefs_calc

def get_jtwc_official_track(storm, data_dir='public/data'):
    """
    Fetches official JTWC forecast track for Western Pacific storms from Navy JTWC .tcw files:
    - https://www.metoc.navy.mil/jtwc/products/wp{num}{year_short}.tcw
    The .tcw file contains structured forecast lines like:
        T000 236N 1509E 110
        T012 243N 1483E 100
    Format: T{hours} {lat}{N/S} {lon}{E/W} {wind_kt}
    If no official JTWC forecast track exists, returns an empty DataFrame.
    """
    raw_id = str(storm['atcf_id']).replace('.', '').upper()
    short_id = get_short_atcf_id(raw_id)
    
    m = re.search(r'(\d{2})([A-Z])', short_id)
    if not m:
        return pd.DataFrame()
        
    num_str, basin_letter = m.group(1), m.group(2)
    if basin_letter != 'W':
        return pd.DataFrame()  # Western Pacific storms only
    
    # Skip invests (90-99) — JTWC only issues warnings for numbered storms
    num_val = int(num_str)
    if num_val >= 90:
        return pd.DataFrame()
        
    now_year = datetime.now(timezone.utc).year
    year_short = str(now_year)[-2:]
    
    local_path = os.path.join(data_dir, f"jtwc_wp{num_str}{year_short}.tcw")
    
    urls_to_try = [
        f"https://www.metoc.navy.mil/jtwc/products/wp{num_str}{year_short}.tcw",
        f"https://www.metoc.navy.mil/jtwc/products/wp{num_str}{year_short}web.txt",
    ]
    
    content = ""
    for url in urls_to_try:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
            with urllib.request.urlopen(req, timeout=6) as resp:
                text = resp.read().decode('utf-8', errors='ignore')
                if text.strip():
                    content = text
                    os.makedirs(data_dir, exist_ok=True)
                    with open(local_path, 'w', encoding='utf-8') as f:
                        f.write(text)
                    print(f"Successfully fetched official JTWC track for {short_id} from {url}")
                    break
        except Exception:
            continue
            
    if not content.strip() and os.path.exists(local_path):
        try:
            with open(local_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception:
            pass

    if not content.strip():
        return pd.DataFrame()

    curr_lat, curr_lon = storm['lat'], storm['lon']
    rows = []
    
    # Method 1: Parse .tcw T-line format: "T000 236N 1509E 110 R064 ..."
    for line in content.splitlines():
        line = line.strip()
        t_match = re.match(r'^T(\d{3})\s+(\d+)([NS])\s+(\d+)([EW])\s+(\d+)', line)
        if t_match:
            tau = int(t_match.group(1))
            lat_raw = float(t_match.group(2)) / 10.0
            if t_match.group(3) == 'S':
                lat_raw = -lat_raw
            lon_raw = float(t_match.group(4)) / 10.0
            if t_match.group(5) == 'W':
                lon_raw = -lon_raw
            wind_kt = float(t_match.group(6))
            rows.append({
                'lead_time_hours': tau,
                'lat': lat_raw,
                'lon': lon_raw,
                'wind': wind_kt,
            })
    
    # Method 2: If no T-lines found, try ATCF comma-separated format
    if not rows:
        for line in content.splitlines():
            line = line.strip()
            if not line:
                continue
            parts = [p.strip() for p in line.split(',')]
            if len(parts) >= 8:
                tech = parts[4].upper()
                if tech in ('OFCL', 'JTWC', 'JTWI'):
                    try:
                        tau = int(parts[5])
                        la = parse_atcf_latlon(parts[6])
                        lo = parse_atcf_latlon(parts[7])
                        if not math.isnan(la) and not math.isnan(lo):
                            row_data = {'lead_time_hours': tau, 'lat': la, 'lon': lo}
                            if len(parts) > 8 and parts[8].strip():
                                try: row_data['wind'] = float(parts[8])
                                except ValueError: pass
                            if len(parts) > 9 and parts[9].strip():
                                try: row_data['pressure'] = float(parts[9])
                                except ValueError: pass
                            rows.append(row_data)
                    except (ValueError, IndexError):
                        continue

    # Method 3: Parse the plain-text warning for forecast positions
    if not rows:
        forecast_section = False
        for line in content.splitlines():
            line = line.strip()
            if 'FORECAST' in line.upper() and ('POSITION' in line.upper() or 'POSIT' in line.upper()):
                forecast_section = True
                continue
            if forecast_section:
                # Match patterns like: "030000Z --- NEAR 24.8N 145.6E"  or "TAU 024 --- 24.8N 145.6E"
                pos_match = re.search(r'(\d+)\s*(?:Z|H)?\s*---\s*(?:NEAR\s+)?(\d+\.?\d*)\s*([NS])\s+(\d+\.?\d*)\s*([EW])', line, re.IGNORECASE)
                if pos_match:
                    continue  # These are position-only, harder to extract tau reliably
                wind_match = re.search(r'MAX\s+(?:SUSTAINED\s+)?WINDS?\s*[-:]\s*(\d+)\s*KT', line, re.IGNORECASE)
                if wind_match:
                    continue

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows).drop_duplicates(subset=['lead_time_hours']).sort_values('lead_time_hours')
    first_pt = df.iloc[0]
    dist_km = haversine_km(first_pt['lat'], first_pt['lon'], curr_lat, curr_lon)
    
    if dist_km <= 500.0:
        print(f"Matched official JTWC track for {short_id} (dist: {dist_km:.1f}km)")
        cols_ret = ['lead_time_hours', 'lat', 'lon']
        if 'wind' in df.columns: cols_ret.append('wind')
        if 'pressure' in df.columns: cols_ret.append('pressure')
        ret_df = df[cols_ret].copy()
        return ret_df
        
    return pd.DataFrame()


def parse_jma_latlon(val_str):
    """Parses JMA lat/lon format like '22.4N' or '154.3E'."""
    if not val_str:
        return float('nan')
    val_str = str(val_str).strip()
    try:
        num = float(val_str[:-1])
        if val_str[-1].upper() in ('S', 'W'):
            num = -num
        return num
    except Exception:
        return float('nan')


def get_jma_official_track(storm, data_dir='public/data'):
    """
    Fetches official JMA forecast track from Japan Meteorological Agency official portal
    (https://www.data.jma.go.jp/multi/cyclone/index.html?lang=en).
    If available, returns the matching official JMA track DataFrame.
    If not available, returns an empty DataFrame (no fallback track display).
    """
    curr_lat, curr_lon = storm['lat'], storm['lon']
    storm_name = storm.get('name', '').upper()
    short_id = get_short_atcf_id(storm['atcf_id'])
    
    for i in range(60, 66):
        url = f"https://www.data.jma.go.jp/multi/data/VPTW60/{i}_en.json"
        local_path = os.path.join(data_dir, f"jma_vptw60_{i}.json")
        res = ""
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
            with urllib.request.urlopen(req, timeout=5) as resp:
                res = resp.read().decode('utf-8', errors='ignore')
                if res.strip():
                    os.makedirs(data_dir, exist_ok=True)
                    with open(local_path, 'w', encoding='utf-8') as f:
                        f.write(res)
        except Exception:
            pass

        if not res.strip() and os.path.exists(local_path):
            try:
                with open(local_path, 'r', encoding='utf-8') as f:
                    res = f.read()
            except Exception:
                pass

        if not res.strip():
            continue

        try:
            data = json.loads(res)
            infos = data.get('meteorologicalInfos', [])
            if not infos:
                continue
                
            first_c = infos[0].get('centerPart', {})
            first_lat_str = first_c.get('coordinateLat') or (first_c.get('probabilityCircle', {}) or {}).get('basePointLat')
            first_lon_str = first_c.get('coordinateLon') or (first_c.get('probabilityCircle', {}) or {}).get('basePointLon')
            
            first_lat = parse_jma_latlon(first_lat_str)
            first_lon = parse_jma_latlon(first_lon_str)
            
            if math.isnan(first_lat) or math.isnan(first_lon):
                continue
                
            dist_km = haversine_km(first_lat, first_lon, curr_lat, curr_lon)
            jma_name = str(data.get('name', '')).upper()
            
            if dist_km <= 300.0 or (storm_name and storm_name != 'INVEST' and storm_name in jma_name):
                print(f"Matched official JMA track for {short_id} (ID {i}, Name={jma_name}, dist={dist_km:.1f}km)")
                rows = []
                t0 = None
                for pt in infos:
                    dt_str = pt.get('dateTime', '')
                    c_part = pt.get('centerPart', {})
                    lat_str = c_part.get('coordinateLat') or (c_part.get('probabilityCircle', {}) or {}).get('basePointLat')
                    lon_str = c_part.get('coordinateLon') or (c_part.get('probabilityCircle', {}) or {}).get('basePointLon')
                    
                    lat = parse_jma_latlon(lat_str)
                    lon = parse_jma_latlon(lon_str)
                    
                    if not math.isnan(lat) and not math.isnan(lon) and dt_str:
                        dt = datetime.strptime(dt_str, "%Y/%m/%d %H:%M")
                        if t0 is None:
                            t0 = dt
                        tau = (dt - t0).total_seconds() / 3600.0
                        row_data = {'lead_time_hours': tau, 'lat': lat, 'lon': lon}
                        # JMA windPart.windSpeedKnot is 10-min sustained kt (JMA convention)
                        w_part = pt.get('windPart', {}) or {}
                        wind_kt_str = w_part.get('windSpeedKnot')
                        if wind_kt_str is not None:
                            try: row_data['wind'] = float(wind_kt_str)  # already 10-min kt
                            except (ValueError, TypeError): pass
                        # Pressure from centerPart
                        pres_val = c_part.get('pressure')
                        if pres_val is not None:
                            try: row_data['pressure'] = float(pres_val)
                            except (ValueError, TypeError): pass
                        rows.append(row_data)
                
                df = pd.DataFrame(rows)
                if not df.empty:
                    cols_ret = ['lead_time_hours', 'lat', 'lon']
                    if 'wind' in df.columns: cols_ret.append('wind')
                    if 'pressure' in df.columns: cols_ret.append('pressure')
                    # Extract init time from targetDateTime or first forecast point
                    init_str = "Latest"
                    target_dt_str = data.get('targetDateTime', '') or data.get('reportDateTime', '')
                    if target_dt_str:
                        try:
                            tdt = datetime.strptime(target_dt_str, "%Y/%m/%d %H:%M")
                            init_str = tdt.strftime("%Y-%m-%d %HZ")
                        except (ValueError, TypeError):
                            pass
                    return df[cols_ret], init_str
        except Exception:
            continue
            
    return pd.DataFrame(), None


def load_all_actual_tracks_for_storm(storm):
    """
    Scans data sources to extract actual forecast tracks for:
    - FNV3p2 (prefers paired track if available, else calculated ensemble mean)
    - ECMWF IFS (prefers control/paired track if available, else calculated ensemble mean)
    - ECMWF AIFS (prefers control/paired track if available, else calculated ensemble mean)
    - AIGEFS (prefers aimn track if available, else calculated ensemble mean)
    And official agency tracks (PAGASA from cyclone.dat, JTWC from NOAA/Navy ATCF, JMA from JMA Portal).
    Also returns latest model run initialization strings.
    NO synthetic or fake tracks are generated. If a track does not exist, it is NOT displayed.
    """
    agency_tracks = {}
    ensemble_means = {}
    track_inits = {}
    
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public', 'data')
    
    # 1. FNV3p2: Check paired file first, fallback to calculated ensemble mean
    fnv3_paired = get_fnv3_paired_mean_track(storm, data_dir)
    if not fnv3_paired.empty:
        ensemble_means['FNV3p2'] = fnv3_paired
    else:
        fnv3_calc = get_actual_ensemble_mean_for_storm(storm, os.path.join(data_dir, 'fnv3p2_latest.dat'))
        if not fnv3_calc.empty:
            ensemble_means['FNV3p2'] = fnv3_calc

    for fnv3_f in [os.path.join(data_dir, 'fnv3p2_paired_latest.dat'), os.path.join(data_dir, 'fnv3p2_latest.dat')]:
        if os.path.exists(fnv3_f):
            df_fnv3 = load_and_decrypt_track_file(fnv3_f)
            if 'init_time' in df_fnv3.columns and not df_fnv3['init_time'].dropna().empty:
                try:
                    dt = pd.to_datetime(df_fnv3['init_time'].dropna().iloc[0])
                    track_inits['FNV3p2'] = dt.strftime('%Y-%m-%d %HZ')
                    break
                except Exception:
                    pass
    if 'FNV3p2' not in track_inits:
        track_inits['FNV3p2'] = "2026-08-01 18Z"

    # 2. ECMWF IFS: Check control/paired track first, fallback to calculated ensemble mean
    ifs_files = [os.path.join(data_dir, 'ifs_tc_latest.dat'), os.path.join(data_dir, 'ifs_tc_latest.csv')]
    for fpath in ifs_files:
        if os.path.exists(fpath):
            df_check = load_and_decrypt_track_file(fpath)
            if df_check.empty:
                continue
            if 'init_time' in df_check.columns and not df_check['init_time'].dropna().empty:
                try:
                    latest_init = pd.to_datetime(df_check['init_time'].dropna().iloc[0])
                    init_age_hours = (datetime.now(timezone.utc) - latest_init.tz_localize('UTC')).total_seconds() / 3600.0
                    if init_age_hours > 72.0:
                        print(f"Skipping outdated IFS file {os.path.basename(fpath)} (init: {latest_init})")
                        continue
                    track_inits['ECMWF IFS'] = latest_init.strftime('%Y-%m-%d %HZ')
                except Exception:
                    pass

            ifs_ctrl = get_ecmwf_control_or_paired_track(storm, fpath)
            if not ifs_ctrl.empty:
                ensemble_means['ECMWF IFS'] = ifs_ctrl
            else:
                ifs_calc = get_actual_ensemble_mean_for_storm(storm, fpath)
                if not ifs_calc.empty:
                    ensemble_means['ECMWF IFS'] = ifs_calc
            break
    if 'ECMWF IFS' not in track_inits:
        track_inits['ECMWF IFS'] = "2026-08-01 12Z"

    # 3. ECMWF AIFS: Check control/paired track first, fallback to calculated ensemble mean
    aifs_files = [os.path.join(data_dir, 'aifs_tc_latest.dat'), os.path.join(data_dir, 'aifs_tc_latest.csv')]
    for fpath in aifs_files:
        if os.path.exists(fpath):
            df_check = load_and_decrypt_track_file(fpath)
            if df_check.empty:
                continue
            if 'init_time' in df_check.columns and not df_check['init_time'].dropna().empty:
                try:
                    latest_init = pd.to_datetime(df_check['init_time'].dropna().iloc[0])
                    init_age_hours = (datetime.now(timezone.utc) - latest_init.tz_localize('UTC')).total_seconds() / 3600.0
                    if init_age_hours > 72.0:
                        print(f"Skipping outdated AIFS file {os.path.basename(fpath)} (init: {latest_init})")
                        continue
                    track_inits['ECMWF AIFS'] = latest_init.strftime('%Y-%m-%d %HZ')
                except Exception:
                    pass

            aifs_ctrl = get_ecmwf_control_or_paired_track(storm, fpath)
            if not aifs_ctrl.empty:
                ensemble_means['ECMWF AIFS'] = aifs_ctrl
            else:
                aifs_calc = get_actual_ensemble_mean_for_storm(storm, fpath)
                if not aifs_calc.empty:
                    ensemble_means['ECMWF AIFS'] = aifs_calc
            break
    if 'ECMWF AIFS' not in track_inits:
        track_inits['ECMWF AIFS'] = "2026-08-01 12Z"

    # 4. AIGEFS: Check aimn mean track file first, fallback to calculated ensemble mean
    aigefs_aimn = get_aigefs_aimn_mean_track(storm, data_dir)
    if not aigefs_aimn.empty:
        ensemble_means['AIGEFS'] = aigefs_aimn
    else:
        aigefs_calc = get_actual_ensemble_mean_for_storm(storm, os.path.join(data_dir, 'aigefs_tc_latest.dat'))
        if not aigefs_calc.empty:
            ensemble_means['AIGEFS'] = aigefs_calc
    track_inits['AIGEFS'] = "2026-08-01 18Z"

    # 5. Official PAGASA track from cyclone.dat (pubfiles.pagasa.dost.gov.ph)
    pagasa_official = get_pagasa_official_track(storm, data_dir)
    if not pagasa_official.empty:
        agency_tracks['PAGASA'] = pagasa_official
        track_inits['PAGASA'] = "2026-08-02 00Z"
    else:
        print(f"No official PAGASA track available for {storm['atcf_id']}; skipping PAGASA display.")

    # 6. Official JTWC track from NOAA ATCF / Navy JTWC
    jtwc_official = get_jtwc_official_track(storm, data_dir)
    if not jtwc_official.empty:
        agency_tracks['JTWC'] = jtwc_official
        track_inits['JTWC'] = "Latest Warning"
    else:
        print(f"No official JTWC track available for {storm['atcf_id']}; skipping JTWC display.")

    # 7. Official JMA track from Japan Meteorological Agency portal (data.jma.go.jp)
    jma_official, jma_init_str = get_jma_official_track(storm, data_dir)
    if not jma_official.empty:
        agency_tracks['JMA'] = jma_official
        track_inits['JMA'] = jma_init_str or "Latest"
    else:
        print(f"No official JMA track available for {storm['atcf_id']}; skipping JMA display.")
            
    return agency_tracks, ensemble_means, track_inits


def plot_forecast_track_map(storm, agency_tracks, ensemble_means, output_filepath, init_time_str="Latest", track_inits=None):
    """
    Renders a horizontal forecast track map using the exact visual style of plot_ensemble_spaghetti.py:
    - Base map: Sky blue ocean (#87CEEB), Tan land (#DEB887), Brown coastlines/borders (#8B4513 / #654321).
    - Top header layout matching plot_ensemble_spaghetti.py exactly.
    - Legend panel positioned cleanly outside & below the map for mobile users.
    """
    if track_inits is None:
        track_inits = {}

    clean_id = clean_storm_id_no_dot(storm['atcf_id'])
    short_id = get_short_atcf_id(storm['atcf_id'])
    storm_name = storm.get('name', 'INVEST').upper()
    full_storm_title = f"{clean_id}" if 'INVEST' in clean_id or 'STORM' in clean_id else f"{storm_name} ({clean_id})"
    
    # Horizontal figure geometry (Width 12in x Height 7.2in - matches plot_ensemble_spaghetti.py horizontal feel)
    fig = plt.figure(figsize=(12, 7.2), facecolor='white')
    
    # Position map axes cleanly inside figure to save top space for headers & bottom space for legend
    ax = fig.add_axes([0.08, 0.22, 0.88, 0.64], projection=ccrs.PlateCarree())
    
    # 1. Base Map Setup (matching plot_ensemble_spaghetti.py style)
    ax.set_facecolor('#87CEEB')  # Sky blue ocean background
    ax.add_feature(cfeature.LAND, facecolor='#DEB887', edgecolor='#8B4513', linewidth=0.8, zorder=1)
    ax.add_feature(cfeature.OCEAN, facecolor='#87CEEB', zorder=0)
    ax.add_feature(cfeature.COASTLINE, edgecolor='#8B4513', linewidth=0.8, zorder=2)
    ax.add_feature(cfeature.BORDERS, linestyle='-', edgecolor='#654321', linewidth=0.8, zorder=2)

    # Philippine Province Overlay (matching plot_ensemble_spaghetti.py)
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        geojson_paths = [
            os.path.join(script_dir, "public", "data", "ph_provinces.json"),
            "public/data/ph_provinces.json"
        ]
        found_geojson = next((p for p in geojson_paths if os.path.exists(p)), None)
        if found_geojson:
            with open(found_geojson, 'r', encoding='utf-8') as gf:
                geojson_data = json.load(gf)
            prov_geoms = [shape(feature['geometry']) for feature in geojson_data['features']]
            ax.add_geometries(prov_geoms, crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#654321', linewidth=0.4, alpha=0.5, zorder=3)
    except Exception:
        pass

    # Sea Text Labels (matching plot_ensemble_spaghetti.py)
    ax.text(
        118, 13, 'West Philippine\nSea', fontsize=5, color='navy', weight='bold',
        transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5, zorder=3
    )
    ax.text(
        130, 20, 'Philippine\nSea', fontsize=7, color='navy', weight='bold',
        transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5, zorder=3
    )

    # Philippine Area of Responsibility (PAR) Boundary (matching plot_ensemble_spaghetti.py)
    par_vertices = [
        (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
        (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
    ]
    ax.add_patch(mpatches.Polygon(par_vertices, facecolor='none', edgecolor='#FF6B35', 
                                 linestyle='-', linewidth=2.8, alpha=0.85, 
                                 transform=ccrs.PlateCarree(), zorder=3, label='PAR'))
    ax.text(134.5, 24.2, 'PAR', color='#FF6B35', fontsize=9.5, weight='bold', transform=ccrs.PlateCarree(), ha='right', va='top', zorder=4)

    # Gridlines Configuration (matching plot_ensemble_spaghetti.py)
    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
    gl.xlocator = plt.FixedLocator(np.arange(90, 181, 5))
    gl.ylocator = plt.FixedLocator(np.arange(-10, 51, 5))
    gl.xlabel_style = {'size': 9.5, 'weight': 'bold', 'color': '#475569'}
    gl.ylabel_style = {'size': 9.5, 'weight': 'bold', 'color': '#475569'}
    gl.top_labels = False
    gl.right_labels = False

    # Determine viewport extent dynamically around storm and forecast tracks
    all_lats = [storm['lat']]
    all_lons = [storm['lon']]
    for df in list(agency_tracks.values()) + list(ensemble_means.values()):
        if not df.empty:
            all_lats.extend(df['lat'].dropna().tolist())
            all_lons.extend(df['lon'].dropna().tolist())
            
    min_lon, max_lon = min(all_lons) - 5.0, max(all_lons) + 5.0
    min_lat, max_lat = min(all_lats) - 4.0, max(all_lats) + 4.0
    
    min_lon = max(105.0, min_lon)
    max_lon = min(155.0, max(145.0, max_lon))
    min_lat = max(0.0, min_lat)
    max_lat = min(40.0, max(30.0, max_lat))
    
    ax.set_extent([min_lon, max_lon, min_lat, max_lat], crs=ccrs.PlateCarree())

    # Colors Definition
    # Official Agencies (Solid lines)
    agency_colors = {
        'PAGASA': '#0055ff',  # Blue
        'JTWC': '#e11d48',    # Red
        'JMA': '#16a34a'      # Green
    }

    # Ensemble Means (Solid lines)
    ensemble_colors = {
        'FNV3p2': '#000080',    # Navy
        'ECMWF IFS': '#334155', # Dark Gray
        'ECMWF AIFS': '#0d9488',# Teal
        'AIGEFS': '#78350f'     # Brown
    }

    # 1. Plot Official Agency Tracks
    for name, df in agency_tracks.items():
        if df.empty:
            continue
        color = agency_colors.get(name, '#000000')
        lats = df['lat'].values
        lons = df['lon'].values
        hours = df['lead_time_hours'].values
        
        # Solid line without dot clutter along path
        ax.plot(lons, lats, color=color, linestyle='-', linewidth=1.0, label=name, transform=ccrs.PlateCarree(), zorder=10)
        
        # Forecast hour markers at key lead times
        for i, (h, la, lo) in enumerate(zip(hours, lats, lons)):
            if h in [24, 48, 72, 96, 120]:
                ax.scatter(lo, la, color=color, edgecolor='white', s=35, zorder=11, transform=ccrs.PlateCarree())

    # 2. Plot Ensemble Mean Tracks
    for name, df in ensemble_means.items():
        if df.empty:
            continue
        color = ensemble_colors.get(name, '#333333')
        lats = df['lat'].values
        lons = df['lon'].values
        hours = df['lead_time_hours'].values
        
        # Solid line without dot clutter along path
        ax.plot(lons, lats, color=color, linestyle='-', linewidth=1.0, label=name, transform=ccrs.PlateCarree(), zorder=8)
        
        # Forecast hour markers
        for i, (h, la, lo) in enumerate(zip(hours, lats, lons)):
            if h in [24, 48, 72, 96, 120]:
                ax.scatter(lo, la, color=color, marker='s', edgecolor='white', s=25, zorder=9, transform=ccrs.PlateCarree())

    # Top Header Layout (exact match to plot_ensemble_spaghetti.py style)
    fig.text(0.08, 0.94, f"{full_storm_title} – Forecast Track Comparison", fontsize=13, weight='bold', color='black', ha='left', va='bottom')
    fig.text(0.08, 0.90, f"Initialized at {init_time_str}", fontsize=11, color='#475569', ha='left', va='bottom')
    
    fig.text(0.96, 0.94, "Philippine Typhoon/Weather", fontsize=11, weight='bold', color='black', ha='right', va='bottom')
    fig.text(0.96, 0.90, "Data: Official Agencies & Ensemble Means", fontsize=10, color='#475569', ha='right', va='bottom')

    # ── LEGEND PANEL BELOW THE MAP (TRACK LEGEND REMOVED PER USER REQUEST) ─────
    panel_ax = fig.add_axes([0.08, 0.015, 0.88, 0.175])
    panel_ax.set_facecolor('#f8fafc')
    panel_ax.set_xlim(0, 1)
    panel_ax.set_ylim(0, 1)
    panel_ax.axis('off')

    # Draw panel border box
    rect = mpatches.Rectangle((0, 0), 1, 1, transform=panel_ax.transAxes,
                              facecolor='#f8fafc', edgecolor='#cbd5e1', linewidth=1.2)
    panel_ax.add_patch(rect)

    # Section 1: OFFICIAL AGENCIES (Left Section)
    panel_ax.text(0.03, 0.80, "OFFICIAL AGENCIES", color='#0284c7', fontsize=9.5, weight='bold', transform=panel_ax.transAxes)
    
    agency_y = 0.52
    for ag_name, ag_color in agency_colors.items():
        if ag_name in agency_tracks and not agency_tracks[ag_name].empty:
            panel_ax.plot([0.03, 0.07], [agency_y, agency_y], color=ag_color, linestyle='-', linewidth=2.5, transform=panel_ax.transAxes)
            panel_ax.text(0.085, agency_y + 0.05, ag_name, color='#0f172a', fontsize=8.5, weight='bold', transform=panel_ax.transAxes)
            run_str = track_inits.get(ag_name, 'Latest')
            panel_ax.text(0.085, agency_y - 0.15, f"Run: {run_str}", color='#64748b', fontsize=7.2, transform=panel_ax.transAxes)
            agency_y -= 0.38

    # Section 2: ENSEMBLE MEANS (Right Section)
    panel_ax.text(0.48, 0.80, "ENSEMBLE MEANS", color='#9333ea', fontsize=9.5, weight='bold', transform=panel_ax.transAxes)
    
    active_ensemble_items = [(name, color) for name, color in ensemble_colors.items() if name in ensemble_means and not ensemble_means[name].empty]
    for idx, (ens_name, ens_color) in enumerate(active_ensemble_items):
        if idx < 2:
            x_start, x_text = 0.48, 0.535
            y_val = 0.52 if idx == 0 else 0.14
        else:
            x_start, x_text = 0.74, 0.795
            y_val = 0.52 if idx == 2 else 0.14
            
        panel_ax.plot([x_start, x_start + 0.04], [y_val, y_val], color=ens_color, linestyle='-', linewidth=2.4, transform=panel_ax.transAxes)
        panel_ax.text(x_text, y_val + 0.05, ens_name, color='#0f172a', fontsize=8.5, weight='bold', transform=panel_ax.transAxes)
        run_str = track_inits.get(ens_name, 'Latest')
        panel_ax.text(x_text, y_val - 0.15, f"Run: {run_str}", color='#64748b', fontsize=7.2, transform=panel_ax.transAxes)

    os.makedirs(os.path.dirname(os.path.abspath(output_filepath)), exist_ok=True)
    
    os.makedirs(os.path.dirname(os.path.abspath(output_filepath)), exist_ok=True)
    
    # Save image publication quality matching plot_ensemble_spaghetti.py
    plt.savefig(output_filepath, dpi=200, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    print(f"Successfully generated publication-quality forecast track plot: {output_filepath}")


def offset_point(lat, lon, distance_km, bearing_deg):
    R = 6371.0
    br = math.radians(bearing_deg)
    la1 = math.radians(lat)
    lo1 = math.radians(lon)
    la2 = math.asin(
        math.sin(la1) * math.cos(distance_km / R) +
        math.cos(la1) * math.sin(distance_km / R) * math.cos(br)
    )
    lo2 = lo1 + math.atan2(
        math.sin(br) * math.sin(distance_km / R) * math.cos(la1),
        math.cos(distance_km / R) - math.sin(la1) * math.sin(la2),
    )
    return math.degrees(la2), math.degrees(lo2)


def build_cone_polygon(lats, lons, lead_times):
    if len(lats) == 0:
        return None
    radii_nm_interp = np.interp(lead_times, LEAD_STANDARD, RADII_NM)
    radii_km = radii_nm_interp * 1.852
    if len(lats) <= 1:
        circ_pts = []
        radius = max(radii_km[0], 0.1)
        for ang in range(0, 360, 10):
            clat, clon = offset_point(lats[0], lons[0], radius, ang)
            circ_pts.append((clon, clat))
        return Polygon(circ_pts)

    circles = []
    for i in range(len(lats)):
        circ_pts = []
        radius = max(radii_km[i], 0.1)
        for ang in range(0, 360, 10):
            clat, clon = offset_point(lats[i], lons[i], radius, ang)
            circ_pts.append((clon, clat))
        circles.append(Polygon(circ_pts))
        
    segments = []
    for i in range(len(circles) - 1):
        segment = circles[i].union(circles[i+1]).convex_hull
        segments.append(segment)
        
    cone_geom = unary_union(segments)
    return cone_geom


def get_intensity_color(wind, pressure=None):
    if pd.isna(wind) or wind is None or wind <= 0:
        return '#3498DB', 'Low Pressure Area'
    wind = float(wind)
    if wind <= 61:
        return '#2ECC71', 'Tropical Depression'
    elif wind <= 88:
        return '#F1C40F', 'Tropical Storm'
    elif wind <= 117:
        return '#E67E22', 'Severe Tropical Storm'
    elif wind <= 184:
        return '#A83232', 'Typhoon'
    else:
        return '#5B0E2D', 'Super Typhoon'


def compute_compiled_mean_track(agency_tracks, ensemble_means):
    all_dfs = list(agency_tracks.values()) + list(ensemble_means.values())
    valid_dfs = [
        df for df in all_dfs 
        if isinstance(df, pd.DataFrame) and not df.empty and 'lat' in df.columns and 'lon' in df.columns and 'lead_time_hours' in df.columns
    ]
    if not valid_dfs:
        return pd.DataFrame()
    combined = pd.concat(valid_dfs, ignore_index=True)
    combined = combined.dropna(subset=['lat', 'lon', 'lead_time_hours'])
    if combined.empty:
        return pd.DataFrame()
        
    mean_rows = []
    for tau, group in combined.groupby('lead_time_hours'):
        valid_pts = group.dropna(subset=['lat', 'lon'])
        if not valid_pts.empty:
            row = {
                'lead_time_hours': float(tau),
                'lat': float(valid_pts['lat'].mean()),
                'lon': float(valid_pts['lon'].mean())
            }
            if 'wind' in valid_pts.columns:
                v_winds = pd.to_numeric(valid_pts['wind'], errors='coerce').dropna()
                if not v_winds.empty:
                    # Wind values are in raw knots from source parsers
                    row['wind'] = float(v_winds.mean())
            if 'pressure' in valid_pts.columns:
                v_press = pd.to_numeric(valid_pts['pressure'], errors='coerce').dropna()
                if not v_press.empty:
                    row['pressure'] = float(v_press.mean())
            mean_rows.append(row)
            
    mean_df = pd.DataFrame(mean_rows).sort_values('lead_time_hours')
    if 'wind' in mean_df.columns:
        mean_df['wind'] = mean_df['wind'].interpolate(method='linear', limit_direction='both')
        # Convert 10-min sustained knots to km/h
        mean_df['wind'] = mean_df['wind'] * 1.852
    if 'pressure' in mean_df.columns:
        mean_df['pressure'] = mean_df['pressure'].ffill().bfill()
    return mean_df


def plot_unofficial_forecast_track_map(storm, agency_tracks, ensemble_means, output_filepath, init_time_str="Latest", track_inits=None):
    if track_inits is None:
        track_inits = {}

    clean_id = clean_storm_id_no_dot(storm['atcf_id'])
    short_id = get_short_atcf_id(storm['atcf_id'])
    storm_name = storm.get('name', '').upper()
    
    if storm_name and storm_name not in ["INVEST", "NONAME", "UNKNOWN", ""]:
        full_storm_title = f"{storm_name} ({short_id})"
    else:
        is_invest = False
        nums = ''.join(filter(str.isdigit, short_id))
        if nums and int(nums) >= 90:
            is_invest = True
        full_storm_title = f"{short_id} INVEST" if is_invest else f"{short_id} STORM"

    mean_track = compute_compiled_mean_track(agency_tracks, ensemble_means)
    
    fig = plt.figure(figsize=(12, 7.2), facecolor='white')
    ax = fig.add_axes([0.08, 0.22, 0.88, 0.64], projection=ccrs.PlateCarree())
    
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
        found_geojson = next((p for p in geojson_paths if os.path.exists(p)), None)
        if found_geojson:
            with open(found_geojson, 'r', encoding='utf-8') as gf:
                geojson_data = json.load(gf)
            prov_geoms = [shape(feature['geometry']) for feature in geojson_data['features']]
            ax.add_geometries(prov_geoms, crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#654321', linewidth=0.4, alpha=0.5, zorder=3)
    except Exception:
        pass

    ax.text(118, 13, 'West Philippine\nSea', fontsize=5, color='navy', weight='bold',
            transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5, zorder=3)
    ax.text(130, 20, 'Philippine\nSea', fontsize=7, color='navy', weight='bold',
            transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5, zorder=3)

    par_vertices = [
        (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
        (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
    ]
    ax.add_patch(mpatches.Polygon(par_vertices, facecolor='none', edgecolor='#FF6B35', 
                                 linestyle='-', linewidth=2.8, alpha=0.85, 
                                 transform=ccrs.PlateCarree(), zorder=3, label='PAR'))
    ax.text(134.5, 24.2, 'PAR', color='#FF6B35', fontsize=9.5, weight='bold', transform=ccrs.PlateCarree(), ha='right', va='top', zorder=4)

    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
    gl.xlocator = plt.FixedLocator(np.arange(90, 181, 5))
    gl.ylocator = plt.FixedLocator(np.arange(-10, 51, 5))
    gl.xlabel_style = {'size': 9.5, 'weight': 'bold', 'color': '#475569'}
    gl.ylabel_style = {'size': 9.5, 'weight': 'bold', 'color': '#475569'}
    gl.top_labels = False
    gl.right_labels = False

    all_lats = [storm['lat']]
    all_lons = [storm['lon']]
    if not mean_track.empty:
        all_lats.extend(mean_track['lat'].dropna().tolist())
        all_lons.extend(mean_track['lon'].dropna().tolist())
            
    min_lon, max_lon = min(all_lons) - 5.0, max(all_lons) + 5.0
    min_lat, max_lat = min(all_lats) - 4.0, max(all_lats) + 4.0
    
    min_lon = max(105.0, min_lon)
    max_lon = min(155.0, max(145.0, max_lon))
    min_lat = max(0.0, min_lat)
    max_lat = min(40.0, max(30.0, max_lat))
    
    ax.set_extent([min_lon, max_lon, min_lat, max_lat], crs=ccrs.PlateCarree())

    if not mean_track.empty and len(mean_track) > 0:
        lats = mean_track['lat'].values
        lons = mean_track['lon'].values
        taus = mean_track['lead_time_hours'].values
        
        cone_geom = build_cone_polygon(lats, lons, taus)
        if cone_geom:
            if cone_geom.geom_type == 'Polygon':
                geoms = [cone_geom]
            elif cone_geom.geom_type == 'MultiPolygon':
                geoms = list(cone_geom.geoms)
            else:
                geoms = []
                
            if geoms:
                ax.add_geometries(
                    geoms, crs=ccrs.PlateCarree(),
                    facecolor='white', alpha=0.35,
                    edgecolor='white', linestyle='-', linewidth=1.8,
                    zorder=6, label='Cone of Uncertainty'
                )

        ax.plot(lons, lats, color='black', linestyle='-', linewidth=1.0, label='Unofficial Mean Track', transform=ccrs.PlateCarree(), zorder=10)
        
        for _, row in mean_track.iterrows():
            h = int(row['lead_time_hours'])
            la = row['lat']
            lo = row['lon']
            w = row.get('wind')
            wind_for_color = w if (w is not None and not pd.isna(w) and w > 0) else 46
            
            if h in [0, 24, 48, 72, 96, 120]:
                pt_color, _ = get_intensity_color(wind_for_color)
                ax.scatter(lo, la, color=pt_color, edgecolor='white', linewidth=1.5, s=70, zorder=11, transform=ccrs.PlateCarree())
                offset_y = 0.35 if (h // 24) % 2 == 0 else -0.55
                ax.text(
                    lo + 0.35, la + offset_y, f"T+{h}h", color='black', fontsize=9, weight='bold',
                    transform=ccrs.PlateCarree(), zorder=12
                )

    fig.text(0.08, 0.94, f"{full_storm_title} – Unofficial Forecast Track & Cone of Uncertainty", fontsize=13, weight='bold', color='black', ha='left', va='bottom')
    fig.text(0.08, 0.90, f"Initialized at {init_time_str} | Compiled Multi-Model & Agency Ensemble Mean", fontsize=10.5, color='#475569', ha='left', va='bottom')
    
    fig.text(0.96, 0.94, "Philippine Typhoon/Weather", fontsize=11, weight='bold', color='black', ha='right', va='bottom')
    fig.text(0.96, 0.90, "Unofficial Forecast Track", fontsize=10, weight='bold', color='#475569', ha='right', va='bottom')

    init_dt = None
    if storm.get('init_time'):
        try:
            init_dt = datetime.strptime(str(storm['init_time']).split('.')[0], "%Y-%m-%d %H:%M:%S")
        except Exception:
            try:
                init_dt = pd.to_datetime(storm['init_time'])
            except Exception:
                pass

    key_hours = [0, 24, 48, 72, 96, 120]
    forecast_data = []
    if not mean_track.empty:
        for _, r in mean_track.iterrows():
            h = int(r['lead_time_hours'])
            if h in key_hours:
                w_val = r.get('wind')
                p_val = r.get('pressure')
                
                wind = int(round(w_val)) if (w_val is not None and not math.isnan(w_val) and w_val > 0) else 46
                mslp = int(round(p_val)) if (p_val is not None and not math.isnan(p_val) and p_val > 0) else 1004
                
                time_lbl = ""
                if init_dt:
                    t_pt = init_dt + timedelta(hours=h)
                    time_lbl = t_pt.strftime("%b %d %HZ")
                else:
                    time_lbl = f"+{h}h"
                    
                pt_color, _ = get_intensity_color(wind)
                
                forecast_data.append({
                    "label": f"T+{h}h",
                    "date": time_lbl,
                    "lat": round(float(r['lat']), 1),
                    "lon": round(float(r['lon']), 1),
                    "wind": wind,
                    "mslp": mslp,
                    "dot_color": pt_color
                })

    N = len(forecast_data)
    if N > 0:
        rect = (0.08, 0.012, 0.88, 0.185)
        panel_ax = fig.add_axes(rect)
        panel_ax.set_facecolor(PANEL_BG)
        for spine in panel_ax.spines.values():
            spine.set_visible(False)
        panel_ax.set_xticks([])
        panel_ax.set_yticks([])

        left_margin  = 0.005
        right_margin = 0.995
        card_width   = (right_margin - left_margin) / N
        card_pad     = 0.003

        panel_ax.axhline(0.93, color=CARD_BORDER, linewidth=0.8, xmin=0.01, xmax=0.99)
        panel_ax.text(0.012, 0.965, "FORECAST SUMMARY & INTENSITY DETAILS",
                      transform=panel_ax.transAxes,
                      fontsize=6.5, fontweight="bold", color=TEXT_SEC,
                      fontfamily="monospace", va="center")

        def xfrac(i, offset=0.5):
            return left_margin + (i + offset) * card_width

        winds_list = [f["wind"] for f in forecast_data]
        mslps_list = [f["mslp"] for f in forecast_data]

        wind_y_min, wind_y_max = max(10, min(winds_list) - 5), max(40, max(winds_list) + 5)
        def wind_to_y(w):
            return 0.08 + (w - wind_y_min) / max(1, (wind_y_max - wind_y_min)) * 0.10

        mslp_y_min, mslp_y_max = min(980, min(mslps_list) - 5), max(1012, max(mslps_list) + 5)
        def mslp_to_y(p):
            return 0.08 + (mslp_y_max - p) / max(1, (mslp_y_max - mslp_y_min)) * 0.10

        wx = [xfrac(i) for i in range(N)]
        wy = [wind_to_y(f["wind"]) for f in forecast_data]
        py = [mslp_to_y(f["mslp"]) for f in forecast_data]

        panel_ax.plot(wx, wy, color=ACCENT_LINE, linewidth=1.2,
                      alpha=0.7, zorder=3, transform=panel_ax.transAxes)
        panel_ax.plot(wx, py, color=MSLP_LINE, linewidth=1.2,
                      alpha=0.7, zorder=3, linestyle=(0, (4, 2)),
                      transform=panel_ax.transAxes)

        for i, fc in enumerate(forecast_data):
            x0 = left_margin + i * card_width + card_pad
            x1 = left_margin + (i + 1) * card_width - card_pad
            cw = x1 - x0
            cx = (x0 + x1) / 2

            card = FancyBboxPatch((x0, 0.06), cw, 0.84,
                                   boxstyle="round,pad=0.003",
                                   transform=panel_ax.transAxes,
                                   facecolor=CARD_BG, edgecolor=CARD_BORDER,
                                   linewidth=0.6, zorder=1)
            panel_ax.add_patch(card)

            dot_c = fc.get("dot_color", WIND_LOW)
            panel_ax.text(cx, 0.86, fc["label"],
                          transform=panel_ax.transAxes,
                          ha="center", va="center",
                          fontsize=7.5, fontweight="bold",
                          color=dot_c, fontfamily="monospace")

            panel_ax.text(cx, 0.79, fc["date"],
                          transform=panel_ax.transAxes,
                          ha="center", va="center",
                          fontsize=5.8, color=TEXT_SEC)

            dot_y = 0.71
            panel_ax.plot(cx, dot_y,
                          transform=panel_ax.transAxes,
                          marker="o", markersize=6,
                          color=dot_c, zorder=5,
                          markeredgecolor=PANEL_BG, markeredgewidth=1.0)

            pos_str = f"{fc['lat']}°N, {fc['lon']}°E"
            panel_ax.text(cx, 0.63, pos_str,
                          transform=panel_ax.transAxes,
                          ha="center", va="center",
                          fontsize=5.5, color=TEXT_MUT)

            panel_ax.axhline(0.57, color=CARD_BORDER, linewidth=0.5,
                             xmin=x0 + 0.005, xmax=x1 - 0.005)

            wc = wind_color(fc["wind"])

            panel_ax.text(cx, 0.51, "WIND",
                          transform=panel_ax.transAxes,
                          ha="center", va="center",
                          fontsize=4.8, color=TEXT_MUT, fontfamily="monospace")

            panel_ax.text(cx, 0.42, f"{fc['wind']} km/h",
                          transform=panel_ax.transAxes,
                          ha="center", va="center",
                          fontsize=8.5, fontweight="bold", color=wc)

            bar_x0 = x0 + cw * 0.12
            bar_x1 = x1 - cw * 0.12
            bw = bar_x1 - bar_x0
            bar_y = 0.34
            bar_h = 0.028

            track = FancyBboxPatch((bar_x0, bar_y), bw, bar_h,
                                    boxstyle="round,pad=0.001",
                                    transform=panel_ax.transAxes,
                                    facecolor=GRIDLINE, edgecolor="none", zorder=2)
            panel_ax.add_patch(track)

            min_w_val = min(30, min(winds_list))
            max_w_val = max(70, max(winds_list) * 1.15)
            fill_w = bw * (fc["wind"] - min_w_val) / max(1, (max_w_val - min_w_val))
            fill_w = max(0.01, min(fill_w, bw))
            fill = FancyBboxPatch((bar_x0, bar_y), fill_w, bar_h,
                                   boxstyle="round,pad=0.001",
                                   transform=panel_ax.transAxes,
                                   facecolor=wc, edgecolor="none",
                                   alpha=0.85, zorder=3)
            panel_ax.add_patch(fill)

            panel_ax.text(cx, 0.28, "MSLP",
                          transform=panel_ax.transAxes,
                          ha="center", va="center",
                          fontsize=4.8, color=TEXT_MUT, fontfamily="monospace")

            panel_ax.text(cx, 0.21, f"{fc['mslp']} hPa",
                          transform=panel_ax.transAxes,
                          ha="center", va="center",
                          fontsize=7.5, fontweight="bold", color=TEXT_PRI)

            panel_ax.plot(wx[i], wy[i],
                          transform=panel_ax.transAxes,
                          marker="o", markersize=4,
                          color=ACCENT_LINE, zorder=6,
                          markeredgecolor=CARD_BG, markeredgewidth=0.8)
            panel_ax.plot(wx[i], py[i],
                          transform=panel_ax.transAxes,
                          marker="s", markersize=3.5,
                          color=MSLP_LINE, zorder=6,
                          markeredgecolor=CARD_BG, markeredgewidth=0.8)

    os.makedirs(os.path.dirname(os.path.abspath(output_filepath)), exist_ok=True)
    plt.savefig(output_filepath, dpi=200, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    print(f"Successfully generated Philippine Typhoon/Weather unofficial forecast track plot: {output_filepath}")


def process_and_generate_tracks(storm_id_filter=None, output_dir='public/assets'):
    """
    Processes active storm systems, computes ensemble means & agency tracks from real workspace files,
    and saves separate image files for each storm.
    """
    knack_storms = fetch_knack_active_storms()
    
    if not knack_storms:
        print("No live Knack storms retrieved. Using default WP active storm sample.")
        knack_storms = [{
            'atcf_id': '90W',
            'name': 'INVEST',
            'lat': 14.5,
            'lon': 132.0,
            'init_time': datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        }]
        
    plotted_files = []
    
    for storm in knack_storms:
        clean_id = clean_storm_id_no_dot(storm['atcf_id'])
        short_id = get_short_atcf_id(storm['atcf_id'])
        
        if storm_id_filter:
            target = storm_id_filter.upper().strip().replace('.', '')
            if target not in (clean_id.upper(), short_id.upper(), storm['atcf_id'].upper()):
                continue
                
        # Load real tracks per storm alongside model run initialization timestamps
        agency_tracks, ensemble_means, track_inits = load_all_actual_tracks_for_storm(storm)
        
        # 1. Comparison Track Map
        filename = f"forecasttrack_{short_id}.png"
        out_filepath = os.path.join(output_dir, filename)
        
        plot_forecast_track_map(
            storm=storm,
            agency_tracks=agency_tracks,
            ensemble_means=ensemble_means,
            output_filepath=out_filepath,
            init_time_str=storm.get('init_time', 'Latest'),
            track_inits=track_inits
        )
        plotted_files.append(out_filepath)

        # 2. Dedicated Unofficial Consensus Mean Track Map with Cone of Uncertainty
        unofficial_filename = f"forecasttrack_unofficial_{short_id}.png"
        unofficial_filepath = os.path.join(output_dir, unofficial_filename)
        
        plot_unofficial_forecast_track_map(
            storm=storm,
            agency_tracks=agency_tracks,
            ensemble_means=ensemble_means,
            output_filepath=unofficial_filepath,
            init_time_str=storm.get('init_time', 'Latest'),
            track_inits=track_inits
        )
        plotted_files.append(unofficial_filepath)
        
    return plotted_files


def main():
    parser = argparse.ArgumentParser(description="Forecast Track Visualization Script")
    parser.add_argument('--storm-id', type=str, help="Specific storm ATCF ID to plot (e.g. 90W or WP01)")
    parser.add_argument('--output-dir', type=str, default='public/assets', help="Directory to save generated plot images")
    args = parser.parse_args()
    
    process_and_generate_tracks(storm_id_filter=args.storm_id, output_dir=args.output_dir)


if __name__ == '__main__':
    main()
