import os
import sys
from collections import deque
import io
import math
import re
import json
import base64
import argparse
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
        # Latitude is usually e.g., '135N' -> 13.5
        # Longitude is usually e.g., '1205E' -> 120.5
        # ATCF divides by 10.
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
    Returns a list of dicts: {'atcf_id': ..., 'name': ..., 'lat': ..., 'lon': ..., 'init_time': ..., 'winds': ..., 'pressure': ...}
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
                
            raw_w = item.get('winds')
            raw_p = item.get('pressure')
            storms.append({
                'atcf_id': atcf_id,
                'name': item.get('storm_name', 'INVEST'),
                'lat': lat,
                'lon': lon,
                'init_time': init_time,
                'winds': float(raw_w) if raw_w is not None else None,
                'pressure': float(raw_p) if raw_p is not None else None
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

def run_hdbscan(distance_matrix, min_cluster_size):
    n = len(distance_matrix)
    if n == 0:
        return []
        
    k = min(n - 1, max(1, min_cluster_size - 1))
    core_dist = [0.0] * n
    for i in range(n):
        sorted_dists = sorted(distance_matrix[i])
        core_dist[i] = sorted_dists[k]
        
    in_mst = [False] * n
    min_dist = [float('inf')] * n
    parent = [-1] * n
    min_dist[0] = 0.0
    edges = []
    
    for step in range(n):
        u = -1
        best = float('inf')
        for i in range(n):
            if not in_mst[i] and min_dist[i] < best:
                best = min_dist[i]
                u = i
        if u == -1:
            break
        in_mst[u] = True
        if parent[u] != -1:
            edges.append({'u': parent[u], 'v': u, 'weight': best})
        for v in range(n):
            if not in_mst[v]:
                weight = max(core_dist[u], core_dist[v], distance_matrix[u][v])
                if weight < min_dist[v]:
                    min_dist[v] = weight
                    parent[v] = u
                    
    edges.sort(key=lambda x: x['weight'])
    
    next_node_id = n
    uf_parent = list(range(n * 2))
    
    nodes = []
    for i in range(n * 2):
        nodes.append({
            'id': i,
            'left': None,
            'right': None,
            'weight': 0.0,
            'birth': 0.0,
            'death': float('inf'),
            'points': [i] if i < n else []
        })
        
    def find_uf(i):
        root = i
        while uf_parent[root] != root:
            root = uf_parent[root]
        curr = i
        while curr != root:
            nxt = uf_parent[curr]
            uf_parent[curr] = root
            curr = nxt
        return root
        
    for edge in edges:
        root_u = find_uf(edge['u'])
        root_v = find_uf(edge['v'])
        if root_u != root_v:
            new_id = next_node_id
            next_node_id += 1
            uf_parent[root_u] = new_id
            uf_parent[root_v] = new_id
            nodes[new_id]['left'] = nodes[root_u]
            nodes[new_id]['right'] = nodes[root_v]
            nodes[new_id]['weight'] = edge['weight']
            nodes[new_id]['points'] = nodes[root_u]['points'] + nodes[root_v]['points']
            nodes[root_u]['death'] = edge['weight']
            nodes[root_v]['death'] = edge['weight']
            
    root_node_id = next_node_id - 1
    if root_node_id < n:
        return [0] * n
        
    next_cluster_id = 1
    condensed_nodes = {}
    
    # Iterative condensed tree construction (avoids stack overflow on large ensembles)
    root_cluster_id = 0
    condensed_nodes[root_cluster_id] = {
        'id': root_cluster_id,
        'parent': None,
        'birth': 0.0,
        'death': nodes[root_node_id]['weight'],
        'points': nodes[root_node_id]['points'],
        'stability': 0.0,
        'selected': False
    }
    condense_stack = [(root_node_id, root_cluster_id)]
    while condense_stack:
        node_id, parent_cluster_id = condense_stack.pop()
        node = nodes[node_id]
        if node['left'] is None and node['right'] is None:
            continue
        left = node['left']
        right = node['right']
        left_count = len(left['points'])
        right_count = len(right['points'])
        
        if left_count >= min_cluster_size and right_count >= min_cluster_size:
            left_cluster_id = next_cluster_id
            next_cluster_id += 1
            right_cluster_id = next_cluster_id
            next_cluster_id += 1
            
            condensed_nodes[left_cluster_id] = {
                'id': left_cluster_id,
                'parent': parent_cluster_id,
                'birth': node['weight'],
                'death': left['death'],
                'points': left['points'],
                'stability': 0.0,
                'selected': False
            }
            condensed_nodes[right_cluster_id] = {
                'id': right_cluster_id,
                'parent': parent_cluster_id,
                'birth': node['weight'],
                'death': right['death'],
                'points': right['points'],
                'stability': 0.0,
                'selected': False
            }
            condense_stack.append((left['id'], left_cluster_id))
            condense_stack.append((right['id'], right_cluster_id))
        elif left_count >= min_cluster_size:
            condense_stack.append((left['id'], parent_cluster_id))
        elif right_count >= min_cluster_size:
            condense_stack.append((right['id'], parent_cluster_id))
    
    for cid, cnode in condensed_nodes.items():
        lambda_birth = 1.0 / (cnode['birth'] if cnode['birth'] > 0.0001 else 0.0001)
        sum_stability = 0.0
        for pt in cnode['points']:
            death_weight = cnode['death']
            curr = nodes[pt]
            while curr and curr['death'] < cnode['death']:
                death_weight = curr['death']
                curr = nodes[uf_parent[curr['id']]]
            lambda_death = 1.0 / (death_weight if death_weight > 0.0001 else 0.0001)
            sum_stability += max(0.0, lambda_death - lambda_birth)
        cnode['stability'] = sum_stability
        
    cluster_ids = sorted(condensed_nodes.keys(), reverse=True)
    subtree_stability = {}
    for cid in cluster_ids:
        cnode = condensed_nodes[cid]
        children = [n for n in condensed_nodes.values() if n['parent'] == cid]
        child_stability_sum = sum(subtree_stability.get(child['id'], 0.0) for child in children)
        if child_stability_sum > cnode['stability']:
            subtree_stability[cid] = child_stability_sum
            cnode['selected'] = False
        else:
            subtree_stability[cid] = cnode['stability']
            cnode['selected'] = True
            bfs_queue = deque(children)
            while bfs_queue:
                qnode = bfs_queue.popleft()
                qnode['selected'] = False
                bfs_queue.extend([n for n in condensed_nodes.values() if n['parent'] == qnode['id']])
                
    labels = [-1] * n
    for cid, cnode in condensed_nodes.items():
        if cnode['selected']:
            lbl = cid if cid != 0 else 1
            for pt in cnode['points']:
                labels[pt] = lbl
                
    return labels

def load_track_file(file_path):
    """
    Loads storm tracks from a CSV file, XOR-encrypted DAT file, or raw ATCF file.
    """
    print(f"Loading data from {file_path} ...")
    if not os.path.exists(file_path):
        print(f"Error: File not found {file_path}")
        return pd.DataFrame()

    # Handle XOR encrypted .dat files
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

    # Read the first line to identify format
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            first_line = f.readline()
    except Exception as e:
        print(f"Failed to read file {file_path}: {e}")
        return pd.DataFrame()

    # If first line starts with comment symbol '#', skip comment lines and read as CSV
    if first_line.startswith('#'):
        try:
            df = pd.read_csv(file_path, comment='#')
            return df
        except (ValueError, pd.errors.ParserError) as e:
            pass

    # If it is a normal CSV file
    if ',' in first_line and ('init_time' in first_line or 'track_id' in first_line or 'lat' in first_line or 'sample' in first_line):
        try:
            df = pd.read_csv(file_path)
            return df
        except Exception as e:
            print(f"Error reading CSV {file_path}: {e}")
            return pd.DataFrame()

    # Parse raw ATCF format
    # Columns in ATCF: basin, cy, ymdh, check, tech, tau, lat_str, lon_str, vmax, mslp
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
    
    # Rename maps
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
    
    # Extract track_id if not present
    if 'track_id' not in df.columns:
        if 'basin' in df.columns and 'cyclone_number' in df.columns:
            # e.g., WP09
            df['track_id'] = df['basin'].astype(str) + df['cyclone_number'].astype(str).str.zfill(2)
        else:
            df['track_id'] = 'STORM'
            
    # Calculate lead_time_hours from lead_time if not present
    if 'lead_time_hours' not in df.columns and 'lead_time' in df.columns:
        try:
            df['lead_time_hours'] = pd.to_timedelta(df['lead_time']).dt.total_seconds() / 3600.0
        except (ValueError, TypeError):
            df['lead_time_hours'] = np.nan
            
    # If sample is not present but tech represents ensemble member
    if 'sample' not in df.columns and 'tech' in df.columns:
        samples = []
        for tech_val in df['tech'].astype(str):
            if 'mn' in tech_val.lower() or 'mean' in tech_val.lower():
                samples.append(-1)
            else:
                match = re.search(r'\d+', tech_val)
                samples.append(int(match.group()) if match else 0)
        df['sample'] = samples
        
    # Standardize column existence and datatypes
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
    
    extra_cols = [c for c in ['is_control', 'forecast_type'] if c in df.columns]
    return df[required_cols + extra_cols]

def filter_western_pacific(df):
    """
    Retains only tracks whose INITIAL position (first available point)
    lies within the Western Pacific basin bounds: Lon [100, 180], Lat [0, 50].
    """
    if df.empty:
        return df

    # Find the first point of each unique track (grouped by track_id and sample)
    wp_tracks = []
    for (t_id, s_val), track_points in df.groupby(['track_id', 'sample']):
        track_points = track_points.sort_values('lead_time_hours')
        if track_points.empty:
            continue
        first_pt = track_points.iloc[0]
        f_lat = first_pt['lat']
        f_lon = first_pt['lon']
        
        # Check if the initial position is inside the Western Pacific boundary
        if not np.isnan(f_lat) and not np.isnan(f_lon):
            if 100.0 <= f_lon <= 180.0 and 0.0 <= f_lat <= 50.0:
                wp_tracks.append((t_id, s_val))
                
    if not wp_tracks:
        return pd.DataFrame(columns=df.columns)
        
    df = df.copy()
    # Fast vectorized search using string keys
    wp_set = {f"{tid}_{sid}" for tid, sid in wp_tracks}
    df_keys = df['track_id'].astype(str) + "_" + df['sample'].astype(str)
    mask = df_keys.isin(wp_set)
    
    return df[mask]

def filter_tracks_near_active_storms(df, knack_storms, max_dist_deg=8.0):
    """
    Retains only tracks whose early positions (within first 60 hours)
    lie within max_dist_deg of at least one active Knack storm position.
    """
    if df.empty or not knack_storms:
        return pd.DataFrame(columns=df.columns)
        
    keep_groups = set()
    for (t_id, s_val), track_points in df.groupby(['track_id', 'sample']):
        track_points = track_points.sort_values('lead_time_hours')
        if track_points.empty:
            continue
        early_pts = track_points[track_points['lead_time_hours'] <= 60.0].dropna(subset=['lat', 'lon'])
        if early_pts.empty:
            continue
            
        near_any = False
        for _, pt in early_pts.iterrows():
            f_lat = pt['lat']
            f_lon = pt['lon']
            for k_storm in knack_storms:
                k_lat = k_storm['lat']
                k_lon = k_storm['lon']
                if np.isnan(k_lat) or np.isnan(k_lon):
                    continue
                d_lat = f_lat - k_lat
                d_lon = (f_lon - k_lon) * math.cos(math.radians((f_lat + k_lat)/2))
                dist = math.sqrt(d_lat**2 + d_lon**2)
                if dist <= max_dist_deg:
                    near_any = True
                    break
            if near_any:
                break
                
        if near_any:
            keep_groups.add(f"{t_id}_{s_val}")
            
    if not keep_groups:
        return pd.DataFrame(columns=df.columns)
        
    df = df.copy()
    df_keys = df['track_id'].astype(str) + "_" + df['sample'].astype(str)
    mask = df_keys.isin(keep_groups)
    return df[mask]

def detect_model_name(file_path):
    """
    Determines the ensemble model group name from the filename.
    """
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
    """
    Converts init_time representation to standard formatted string: '18Z Jul 16 2026'.
    Handles multiple date formats.
    """
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

def get_storm_display_name(track_id):
    """
    Returns standard storm/disturbance names (e.g. 90W INVEST, 01W STORM, 11W STORM, or WP112026).
    Handles both INVEST storms (90-99) and numbered TCs (01-89).
    """
    track_str = str(track_id).upper().strip()
    
    # Check if this is an invest number (90-99)
    def is_invest_num(s):
        m = re.search(r'\d{2}', s)
        if m:
            val = int(m.group(0))
            return 90 <= val <= 99
        return False
        
    is_invest = 'INVEST' in track_str or is_invest_num(track_str)
    
    num = None
    letter = "W"
    
    # 1. Matches "WP902026", "WP012026", "WP112026"
    m = re.match(r'^([A-Z]{2})(\d{2})\d{4}$', track_str)
    if m:
        num = m.group(2)
        letter = 'W' if m.group(1) == 'WP' else m.group(1)[0]
    else:
        # 2. Matches "90W", "01W", "11W"
        m = re.match(r'^(\d{2})([A-Z])$', track_str)
        if m:
            num = m.group(1)
            letter = m.group(2)
        else:
            # 3. Matches "WP90", "WP01", "WP11"
            m = re.match(r'^([A-Z]{2})(\d{2})$', track_str)
            if m:
                num = m.group(2)
                letter = 'W' if m.group(1) == 'WP' else m.group(1)[0]
            else:
                # 4. Matches "W90", "W01", "W11"
                m = re.match(r'^([A-Z])(\d{2})$', track_str)
                if m:
                    num = m.group(2)
                    letter = m.group(1)
                else:
                    # 5. Matches digits only "90", "01", "11"
                    m = re.match(r'^(\d{2})$', track_str)
                    if m:
                        num = m.group(1)

    if num:
        if is_invest:
            return f"{num}{letter} INVEST"
        else:
            return f"{num}{letter} STORM"

    return track_str


def cluster_genesis_locations(df, dist_threshold=6.0):
    """
    Groups tracks within the same init_time using the custom HDBSCAN implementation.
    """
    if df.empty:
        return df
        
    df = df.copy()
    df['storm_group'] = 'UNKNOWN'
    df['storm_group_name'] = 'UNKNOWN'
    df['rep_track_id'] = 'UNKNOWN'
    
    # Process each unique init_time separately
    for init_val in df['init_time'].unique():
        init_df = df[df['init_time'] == init_val]
        
        # Identify individual member tracks and group their points
        tracks = []
        for (t_id, s_val), track_points in init_df.groupby(['track_id', 'sample']):
            track_points = track_points.sort_values('lead_time_hours')
            if track_points.empty:
                continue
            
            # Create a dictionary of lead_time_hours -> (lat, lon)
            points_dict = {}
            for _, row in track_points.iterrows():
                h = row['lead_time_hours']
                lat, lon = row['lat'], row['lon']
                if not np.isnan(lat) and not np.isnan(lon):
                    points_dict[h] = (lat, lon)
                    
            if not points_dict:
                continue
                
            tracks.append({
                'track_id': t_id,
                'sample': s_val,
                'points_dict': points_dict,
                'points_index': track_points.index.tolist()
            })
            
        n_tracks = len(tracks)
        if n_tracks == 0:
            continue
            
        # Build distance matrix using average haversine distance with genesis proximity constraint
        distance_matrix = [[0.0] * n_tracks for _ in range(n_tracks)]
        for i in range(n_tracks):
            for j in range(i, n_tracks):
                if i == j:
                    distance_matrix[i][j] = 0.0
                else:
                    t1, t2 = tracks[i], tracks[j]
                    
                    # Hard genesis proximity constraint to prevent the single-linkage chaining effect
                    h1 = min(t1['points_dict'].keys())
                    h2 = min(t2['points_dict'].keys())
                    lat1_start, lon1_start = t1['points_dict'][h1]
                    lat2_start, lon2_start = t2['points_dict'][h2]
                    start_dist_km = haversine_km(lat1_start, lon1_start, lat2_start, lon2_start)
                    
                    if start_dist_km > 600.0:
                        dist = 5000.0
                    else:
                        # Find overlapping forecast hours
                        overlap = set(t1['points_dict'].keys()).intersection(set(t2['points_dict'].keys()))
                        if not overlap:
                            dist = 5000.0
                        else:
                            sum_d = 0.0
                            count_d = 0
                            for h in overlap:
                                lat1, lon1 = t1['points_dict'][h]
                                lat2, lon2 = t2['points_dict'][h]
                                sum_d += haversine_km(lat1, lon1, lat2, lon2)
                                count_d += 1
                            dist = 5000.0 if count_d == 0 else sum_d / count_d
                    
                    distance_matrix[i][j] = dist
                    distance_matrix[j][i] = dist
                    
        # Compute min_cluster_size based on ensemble member count
        num_members = len(init_df['sample'].unique())
        min_cluster_size = max(4, int(round(num_members * (0.03 if num_members > 100 else 0.08))))
        min_cluster_size = min(n_tracks, max(2, min_cluster_size))
        
        # Run custom HDBSCAN
        labels = run_hdbscan(distance_matrix, min_cluster_size)
        
        # For any tracks marked as noise (-1), we group them in individual single-track clusters 
        # to ensure that fallback is available
        next_label = max(labels) + 1 if labels else 1
        for idx in range(n_tracks):
            if labels[idx] == -1:
                labels[idx] = next_label
                next_label += 1
                
        # Group track indices by label
        cluster_tracks = {}
        for idx, lbl in enumerate(labels):
            if lbl not in cluster_tracks:
                cluster_tracks[lbl] = []
            cluster_tracks[lbl].append(tracks[idx])
            
        # Assign storm group IDs and names
        for lbl, cl_tracks in cluster_tracks.items():
            group_id = f"group_{str(init_val).replace(':', '').replace(' ', '_')}_{lbl}"
            
            # Determine best track display name
            track_counts = {}
            for t in cl_tracks:
                tid = t['track_id']
                track_counts[tid] = track_counts.get(tid, 0) + 1
                
            best_tid = None
            max_score = -1
            for tid, count in track_counts.items():
                is_invest = False
                match = re.search(r'WP(\d{2})', str(tid).upper())
                if match:
                    num = int(match.group(1))
                    if 90 <= num <= 99:
                        is_invest = True
                elif str(tid).isdigit():
                    num = int(tid)
                    if 90 <= num <= 99:
                        is_invest = True
                score = count + (0 if is_invest else 1000)
                if score > max_score:
                    max_score = score
                    best_tid = tid
                    
            if not best_tid:
                best_tid = cl_tracks[0]['track_id']
                
            group_name = get_storm_display_name(best_tid)
            
            for t in cl_tracks:
                df.loc[t['points_index'], 'storm_group'] = group_id
                df.loc[t['points_index'], 'storm_group_name'] = group_name
                df.loc[t['points_index'], 'rep_track_id'] = best_tid
                
    return df

def haversine_km(lat1, lon1, lat2, lon2):
    """
    Computes great-circle distance between two points in kilometers.
    """
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def find_control_track_for_storm(df_storm, df_model, model_name, storm_name, atcf_pos=None, color_by='pressure'):
    """
    Identifies the official deterministic control track for the storm cluster:
    1. For ECMWF (IFS/AIFS):
       - Checks explicit flags: 'is_control' == True or 'forecast_type' == 0.
       - Checks AIFS convention: sample == 52 (fallback to 51).
       - Checks IFS convention: sample == 51.
       - Checks standard control: sample == 0 or sample == -1.
    2. For other models: checks sample == 0 or sample == -1.
    First looks within df_storm (the clustered disturbance).
    If not found in df_storm, looks within the full df_model within 600 km of storm reference position.
    Returns (control_df, control_indices, has_control) where control_df has columns [lead_time_hours, lat, lon, pressure, wind].
    """
    is_ecmwf = any(k in model_name.lower() for k in ['ecmwf', 'ifs', 'aifs'])
    ctrl_mask = pd.Series(False, index=df_storm.index)
    if 'is_control' in df_storm.columns:
        ctrl_mask = ctrl_mask | (df_storm['is_control'] == True)
    if 'forecast_type' in df_storm.columns:
        ctrl_mask = ctrl_mask | (df_storm['forecast_type'] == 0)
    if 'sample' in df_storm.columns:
        if (df_storm['sample'] == 0).any():
            ctrl_mask = ctrl_mask | (df_storm['sample'] == 0)
        if (df_storm['sample'] == -1).any():
            ctrl_mask = ctrl_mask | (df_storm['sample'] == -1)
        if is_ecmwf:
            if 'aifs' in model_name.lower():
                if (df_storm['sample'] == 52).any():
                    ctrl_mask = ctrl_mask | (df_storm['sample'] == 52)
                elif (df_storm['sample'] == 51).any() and not ctrl_mask.any():
                    ctrl_mask = ctrl_mask | (df_storm['sample'] == 51)
            elif 'ifs' in model_name.lower():
                if (df_storm['sample'] == 51).any():
                    ctrl_mask = ctrl_mask | (df_storm['sample'] == 51)
                    
    ctrl_candidates = df_storm[ctrl_mask].copy()
    ref_lat, ref_lon = (atcf_pos[0], atcf_pos[1]) if atcf_pos else (None, None)
    if ref_lat is None:
        first_valid = df_storm.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
        if not first_valid.empty:
            ref_lat, ref_lon = first_valid.iloc[0]['lat'], first_valid.iloc[0]['lon']

    # If not found inside the clustered storm group, search the full model dataset
    if ctrl_candidates.empty and df_model is not None and not df_model.empty and ref_lat is not None and ref_lon is not None:
        m_mask = pd.Series(False, index=df_model.index)
        if 'is_control' in df_model.columns:
            m_mask = m_mask | (df_model['is_control'] == True)
        if 'forecast_type' in df_model.columns:
            m_mask = m_mask | (df_model['forecast_type'] == 0)
        if 'sample' in df_model.columns:
            if (df_model['sample'] == 0).any():
                m_mask = m_mask | (df_model['sample'] == 0)
            if (df_model['sample'] == -1).any():
                m_mask = m_mask | (df_model['sample'] == -1)
            if is_ecmwf:
                if 'aifs' in model_name.lower():
                    if (df_model['sample'] == 52).any():
                        m_mask = m_mask | (df_model['sample'] == 52)
                    elif (df_model['sample'] == 51).any() and not m_mask.any():
                        m_mask = m_mask | (df_model['sample'] == 51)
                elif 'ifs' in model_name.lower():
                    if (df_model['sample'] == 51).any():
                        m_mask = m_mask | (df_model['sample'] == 51)
        m_candidates = df_model[m_mask].copy()
        if not m_candidates.empty:
            if color_by == 'wind' and 'wind' in m_candidates.columns:
                m_candidates['wind'] = m_candidates['wind'] * 1.852
            best_tid, best_d = None, 600.0
            for tid, t_df in m_candidates.groupby('track_id'):
                t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
                if len(t_df) < 2:
                    continue
                t_early = t_df[t_df['lead_time_hours'] <= 48.0]
                if t_early.empty:
                    t_early = t_df.head(1)
                dists = [haversine_km(r['lat'], r['lon'], ref_lat, ref_lon) for _, r in t_early.iterrows()]
                min_d = min(dists) if dists else float('inf')
                if min_d < best_d:
                    best_d, best_tid = min_d, tid
            if best_tid is not None:
                ctrl_candidates = m_candidates[m_candidates['track_id'] == best_tid].copy()

    if not ctrl_candidates.empty:
        best_ctrl, best_dist = None, float('inf')
        for tid, t_df in ctrl_candidates.groupby('track_id'):
            t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
            if len(t_df) < 2:
                continue
            if ref_lat is not None and ref_lon is not None:
                t_early = t_df[t_df['lead_time_hours'] <= 48.0]
                if t_early.empty:
                    t_early = t_df.head(1)
                dists = [haversine_km(r['lat'], r['lon'], ref_lat, ref_lon) for _, r in t_early.iterrows()]
                min_d = min(dists) if dists else float('inf')
            else:
                min_d = 0.0
            if min_d < best_dist:
                best_dist, best_ctrl = min_d, t_df
        if best_ctrl is not None and len(best_ctrl) >= 2:
            cols = ['lead_time_hours', 'lat', 'lon', 'pressure', 'wind']
            res_df = best_ctrl[cols].sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
            return res_df, best_ctrl.index, True

    return pd.DataFrame(columns=['lead_time_hours', 'lat', 'lon', 'pressure', 'wind']), pd.Index([]), False

def clean_storm_ensemble_tracks(df_storm, df_model, model_name, storm_name, atcf_pos=None, df_paired=None, df_mean=None, ctrl_indices=None, has_control=False):
    """
    Filters out extraneous tracks that belong to other storms/invests or secondary disturbances
    in the same batch ensemble dataset, ensuring strictly at most one most-plausible track per ensemble member (sample).
    """
    if df_storm.empty:
        return df_storm

    # Build reference track lookup {lead_time_hours: (lat, lon)}
    ref_by_h = {}
    if has_control and df_mean is not None and not df_mean.empty:
        for _, r in df_mean.iterrows():
            ref_by_h[r['lead_time_hours']] = (r['lat'], r['lon'])
    else:
        # Check paired data for ensemble mean near storm
        if df_paired is not None and not df_paired.empty and 'sample' in df_paired.columns:
            paired_ctrl = df_paired[df_paired['sample'] == -1]
            if not paired_ctrl.empty and atcf_pos:
                for tid, t_df in paired_ctrl.groupby('track_id'):
                    t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
                    if not t_df.empty:
                        d = math.sqrt((t_df.iloc[0]['lat'] - atcf_pos[0])**2 + (t_df.iloc[0]['lon'] - atcf_pos[1])**2)
                        if d < 6.0:
                            for _, r in t_df.iterrows():
                                ref_by_h[r['lead_time_hours']] = (r['lat'], r['lon'])
                            break
        # If still empty, use median of early tracks (lead <= 36h)
        if not ref_by_h:
            early_tracks = []
            for (tid, sample), pts in df_storm.groupby(['track_id', 'sample']):
                pts = pts.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
                if not pts.empty and pts.iloc[0]['lead_time_hours'] <= 36.0:
                    early_tracks.append(pts)
            if early_tracks:
                df_early = pd.concat(early_tracks)
                med = df_early.groupby('lead_time_hours')[['lat', 'lon']].median()
                for h, r in med.iterrows():
                    ref_by_h[h] = (r['lat'], r['lon'])

    candidates = []
    for (tid, sample), pts in df_storm.groupby(['track_id', 'sample']):
        # If this is control track, preserve it separately
        if has_control and ctrl_indices is not None and any(idx in ctrl_indices for idx in pts.index):
            continue

        pts = pts.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
        if len(pts) < 2:
            continue

        first = pts.iloc[0]
        lead_start = first['lead_time_hours']
        # Discard tracks that only appear 3+ days into the future (secondary downstream genesis)
        if lead_start > 72.0:
            continue

        # Determine reference point for genesis / early position
        if lead_start in ref_by_h:
            rlat, rlon = ref_by_h[lead_start]
        elif ref_by_h:
            closest_h = min(ref_by_h.keys(), key=lambda h: abs(h - lead_start))
            rlat, rlon = ref_by_h[closest_h]
        elif atcf_pos:
            rlat, rlon = atcf_pos
        else:
            rlat, rlon = first['lat'], first['lon']

        dlat = first['lat'] - rlat
        dlon = (first['lon'] - rlon)
        if dlon > 180:
            dlon -= 360
        elif dlon < -180:
            dlon += 360
        init_dist = math.sqrt(dlat**2 + dlon**2)

        # Check that track starts within reasonable proximity to active storm
        if init_dist > 6.5:
            continue

        # Check early lead hours (lead <= 60h) to ensure track doesn't diverge to another basin
        early_dists = []
        for _, r in pts.iterrows():
            h = r['lead_time_hours']
            if h <= 60.0 and h in ref_by_h:
                clat, clon = ref_by_h[h]
                dl = (r['lon'] - clon)
                if dl > 180:
                    dl -= 360
                elif dl < -180:
                    dl += 360
                d = math.sqrt((r['lat'] - clat)**2 + dl**2)
                early_dists.append(d)

        if early_dists and max(early_dists) > 7.0:
            continue

        mean_early = sum(early_dists) / len(early_dists) if early_dists else init_dist
        candidates.append({
            'track_id': tid,
            'sample': sample,
            'init_dist': init_dist,
            'score': init_dist + mean_early,
            'indices': pts.index.tolist()
        })

    if not candidates:
        return df_storm

    cand_df = pd.DataFrame(candidates)
    # Strictly choose at most ONE best track per ensemble member (sample)
    best_cand = cand_df.sort_values('score').groupby('sample').first().reset_index()

    valid_indices = []
    for idx_list in best_cand['indices']:
        valid_indices.extend(idx_list)

    if has_control and ctrl_indices is not None:
        valid_indices.extend(ctrl_indices.tolist() if hasattr(ctrl_indices, 'tolist') else list(ctrl_indices))

    return df_storm.loc[df_storm.index.intersection(valid_indices)].copy()

def plot_model_tracks(
    df_model, model_name, storm_group_id, output_path,
    storm_name_override=None, color_by='wind', atcf_pos=None, df_paired=None,
    knack_storms=None, total_ensemble_members=None
):
    """
    Generates a 16:9 broadcast-grade dark dashboard spaghetti plot for an active ATCF storm or invest.
    Features:
      - Left column: Cartopy map with dark theme, province boundaries, PAR, canonical sea labels (zorder=3),
        translucent member tracks, high-visibility control/mean track with 24h milestone nodes, and active storm position marker.
      - Docked legend bar: Track wind colormap (knots), primary track indicator, and official status badge.
      - Top broadcast header: Storm title, model information, initialization time, and brand logo.
      - Right column:
        * Card 1: Active Storm & Intensity Overview (Current/Initial status, member tracking support, peak forecast intensity & window, category breakdown)
        * Card 2: Member Intensity Plume (0-160 kt, TD/TS/C1-C5 bands, member lines, 10-90% & 25-75% envelopes, median, mean, control line, AI caution note)
        * Card 3: Cumulative Category Probabilities (TS, Typhoon, Major curves over time)
    """
    # Filter for the specific storm cluster
    df_storm = df_model[df_model['storm_group'] == storm_group_id].copy()
    if df_storm.empty:
        print(f"No tracks found for storm group {storm_group_id} under model {model_name}")
        return

    # Drop coordinate NaNs
    df_storm = df_storm.dropna(subset=['lat', 'lon'])
    if df_storm.empty:
        print(f"No valid coordinate positions for storm group {storm_group_id}")
        return

    # Extract init time
    init_time_raw = df_storm['init_time'].dropna().iloc[0] if not df_storm['init_time'].isna().all() else 'Unknown'
    try:
        init_dt = pd.to_datetime(init_time_raw)
        if init_dt.tzinfo is not None:
            init_dt = init_dt.tz_convert(timezone.utc)
        else:
            init_dt = init_dt.replace(tzinfo=timezone.utc)
    except Exception:
        init_dt = datetime.now(timezone.utc)

    init_date_str = init_dt.strftime('%d %b %Y').upper()
    cycle_str = f"{(init_dt.hour // 6) * 6:02d}Z"
    local_dt = init_dt + timedelta(hours=8)
    local_time_str = local_dt.strftime('%I:%M %p PHT').lstrip('0')

    # Determine storm name and identify active Knack metadata
    group_name = df_storm['storm_group_name'].dropna().iloc[0] if not df_storm['storm_group_name'].isna().all() else 'Unknown'
    storm_name = storm_name_override if storm_name_override else group_name

    active_storm_info = None
    atcf_id_clean = storm_group_id.replace('knack_', '').upper() if storm_group_id.startswith('knack_') else ''
    if knack_storms:
        for ks in knack_storms:
            ks_id = str(ks.get('atcf_id', '')).upper()
            if ks_id == atcf_id_clean or atcf_id_clean in ks_id or ks_id in atcf_id_clean:
                active_storm_info = ks
                break
            if ks.get('name') and str(ks['name']).upper() == storm_name.upper():
                active_storm_info = ks
                break

    if active_storm_info:
        real_name = active_storm_info.get('name', storm_name).strip()
        real_id = active_storm_info.get('atcf_id', atcf_id_clean).strip().upper()
        if real_name.upper() not in ('INVEST', 'UNKNOWN', ''):
            storm_title_display = f"{real_name.upper()} ({real_id})"
            is_invest = False
        else:
            storm_title_display = f"INVEST {real_id}"
            is_invest = True
        current_winds = active_storm_info.get('winds')
        current_pres = active_storm_info.get('pressure')
    else:
        is_invest = ('9' in atcf_id_clean and len(atcf_id_clean) == 3) or 'INVEST' in storm_name.upper()
        storm_title_display = storm_name.upper()
        current_winds = None
        current_pres = None

    # Forecast Processing & Grouping by Member
    df_mean, ctrl_indices, has_control = find_control_track_for_storm(
        df_storm, df_model, model_name, storm_name, atcf_pos=atcf_pos, color_by=color_by
    )

    df_storm = clean_storm_ensemble_tracks(
        df_storm, df_model, model_name, storm_name,
        atcf_pos=atcf_pos, df_paired=df_paired, df_mean=df_mean,
        ctrl_indices=ctrl_indices, has_control=has_control
    )

    if has_control:
        print(f"Using official {model_name} control track ({len(df_mean)} points) for {storm_name}")
        ensemble_data = df_storm[~df_storm.index.isin(ctrl_indices) & (df_storm['sample'] > 0)].copy()
        if ensemble_data.empty:
            ensemble_data = df_storm[~df_storm.index.isin(ctrl_indices)].copy()
        has_ensemble_tracks = ensemble_data['sample'].nunique() >= 2 if not ensemble_data.empty else False
        deterministic_data = pd.DataFrame()
    else:
        print(f"No official control track found for {model_name} {storm_name}; using calculated ensemble mean.")
        deterministic_data = df_storm[df_storm['sample'] == 0]
        ensemble_data = df_storm[df_storm['sample'] > 0]
        has_ensemble_tracks = ensemble_data['sample'].nunique() >= 2 if not ensemble_data.empty else False
        if ensemble_data.empty:
            unique_samples = df_storm['sample'].unique()
            if len(unique_samples) > 1:
                ensemble_data = df_storm[df_storm['sample'] != 0]
                has_ensemble_tracks = ensemble_data['sample'].nunique() >= 2
            else:
                ensemble_data = df_storm

    # Compute Ensemble Mean Track if no control track was present
    if not has_control:
        if has_ensemble_tracks:
            calc_mean_df = ensemble_data[ensemble_data['sample'] != -1]
            if calc_mean_df.empty:
                calc_mean_df = ensemble_data

            matched_paired = None
            if df_paired is not None and not df_paired.empty:
                ref_lat, ref_lon = None, None
                if atcf_pos is not None:
                    ref_lat, ref_lon = atcf_pos[0], atcf_pos[1]
                else:
                    first_pts = calc_mean_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
                    if not first_pts.empty:
                        ref_lat, ref_lon = first_pts.iloc[0]['lat'], first_pts.iloc[0]['lon']

                if ref_lat is not None and ref_lon is not None:
                    df_paired_mean = df_paired[df_paired['sample'] == -1].copy()
                    best_paired_tid = None
                    best_dist = 500.0

                    for tid, t_df in df_paired_mean.groupby('track_id'):
                        t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
                        if len(t_df) < 2:
                            continue
                        first_row = t_df.iloc[0]
                        d_km = haversine_km(first_row['lat'], first_row['lon'], ref_lat, ref_lon)
                        if d_km < best_dist:
                            best_dist = d_km
                            best_paired_tid = tid

                    if best_paired_tid is not None:
                        paired_df = df_paired_mean[df_paired_mean['track_id'] == best_paired_tid].sort_values('lead_time_hours')
                        matched_paired = []
                        for _, row in paired_df.iterrows():
                            matched_paired.append({
                                'h': row['lead_time_hours'],
                                'lat': row['lat'],
                                'lon': row['lon'],
                                'wind': row['wind'],
                                'pressure': row['pressure']
                            })

            model_total_members = df_model[df_model['sample'] > 0]['sample'].nunique()
            effective_total = min(100, model_total_members) if model_total_members > 0 else 1
            required_support = max(1, effective_total // 2)

            by_hour = {}
            for _, row in calc_mean_df.iterrows():
                h = row['lead_time_hours']
                if np.isnan(row['lat']) or np.isnan(row['lon']):
                    continue
                if h not in by_hour:
                    by_hour[h] = {'lats': [], 'lons': [], 'ps': [], 'winds': []}
                by_hour[h]['lats'].append(row['lat'])
                by_hour[h]['lons'].append(row['lon'])
                by_hour[h]['ps'].append(row['pressure'])
                by_hour[h]['winds'].append(row['wind'])

            hours = sorted(by_hour.keys())
            mean_points = []
            for h in hours:
                d = by_hour[h]
                if len(d['lats']) < required_support:
                    continue

                if matched_paired:
                    paired_pt = min(matched_paired, key=lambda pt: abs(pt['h'] - h))
                    if abs(paired_pt['h'] - h) <= 3:
                        m_lat = paired_pt['lat']
                        m_lon = paired_pt['lon']
                        m_wind = paired_pt['wind']
                        m_press = paired_pt['pressure']
                    else:
                        continue
                else:
                    pts_at_hour = [{'lat': lat, 'lon': lon} for lat, lon in zip(d['lats'], d['lons'])]
                    geo_mean = mean_geo_center(pts_at_hour)
                    m_lat = geo_mean['lat']
                    m_lon = geo_mean['lon']
                    valid_winds = [w for w in d['winds'] if not np.isnan(w)]
                    m_wind = np.median(valid_winds) if valid_winds else np.nan
                    valid_ps = [p for p in d['ps'] if not np.isnan(p)]
                    m_press = np.median(valid_ps) if valid_ps else np.nan

                mean_points.append({
                    'lead_time_hours': h,
                    'lat': m_lat,
                    'lon': m_lon,
                    'pressure': m_press,
                    'wind': m_wind
                })

            df_mean = pd.DataFrame(mean_points)
            if not df_mean.empty:
                df_mean = df_mean.sort_values('lead_time_hours')
            else:
                df_mean = pd.DataFrame(columns=['lead_time_hours', 'lat', 'lon', 'pressure', 'wind'])
        else:
            df_mean = pd.DataFrame(columns=['lead_time_hours', 'lat', 'lon', 'pressure', 'wind'])

    # Deduplicate member tracks to 1 representative track per sample
    deduped_track_dfs = []
    for (t_id, s_val), m_df in ensemble_data.groupby(['track_id', 'sample']):
        m_df = m_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
        if len(m_df) >= 2:
            deduped_track_dfs.append(m_df)
    if not deduped_track_dfs and not df_mean.empty:
        deduped_track_dfs = [df_mean]

    plotted_members = len(deduped_track_dfs)
    if total_ensemble_members is None or total_ensemble_members < plotted_members:
        total_ensemble_members = max(plotted_members, 51)

    # Determine if live ATCF point should connect to track
    first_track_lat, first_track_lon = None, None
    if not df_mean.empty:
        first_track_lat, first_track_lon = df_mean.iloc[0]['lat'], df_mean.iloc[0]['lon']
    elif deduped_track_dfs:
        first_track_lat = deduped_track_dfs[0].iloc[0]['lat']
        first_track_lon = deduped_track_dfs[0].iloc[0]['lon']

    use_live_atcf = False
    if atcf_pos is not None and first_track_lat is not None and first_track_lon is not None:
        gap_deg = np.sqrt((atcf_pos[0] - first_track_lat)**2 + (atcf_pos[1] - first_track_lon)**2)
        if gap_deg <= 3.0:
            use_live_atcf = True

    # Geographic region description
    all_first_lats = [tdf.iloc[0]['lat'] for tdf in deduped_track_dfs if not tdf.empty]
    all_first_lons = [tdf.iloc[0]['lon'] for tdf in deduped_track_dfs if not tdf.empty]
    mean_gen_lat = np.mean(all_first_lats) if all_first_lats else 15.0
    mean_gen_lon = np.mean(all_first_lons) if all_first_lons else 135.0

    if 112.0 <= mean_gen_lon <= 121.0 and 10.0 <= mean_gen_lat <= 22.0:
        region_desc = "in the West Philippine Sea"
    elif 121.0 <= mean_gen_lon <= 138.0 and 5.0 <= mean_gen_lat <= 25.0:
        region_desc = "in the Philippine Sea"
    elif mean_gen_lon < 120.0 and mean_gen_lat < 12.0:
        region_desc = "in the Sulu / Celebes Sea"
    elif mean_gen_lon >= 152.0 and mean_gen_lat <= 20.0:
        region_desc = "in Eastern Caroline Islands / WestPac"
    elif 138.0 <= mean_gen_lon < 152.0 and mean_gen_lat <= 25.0:
        region_desc = "east of the Marianas / WestPac"
    elif mean_gen_lat > 25.0:
        region_desc = "in the East China Sea / Northwest Pacific"
    else:
        region_desc = "in the Western Pacific"

    # Compute Statistics across members
    max_lead_h = max(tdf['lead_time_hours'].max() for tdf in deduped_track_dfs if not tdf.empty) if deduped_track_dfs else 120.0
    end_run_dt = init_dt + timedelta(hours=float(max_lead_h))
    end_run_str = end_run_dt.strftime('%b %d').upper()

    ts_count = sum(1 for tdf in deduped_track_dfs if tdf['wind'].max() >= 34)
    ty_count = sum(1 for tdf in deduped_track_dfs if tdf['wind'].max() >= 64)
    major_count = sum(1 for tdf in deduped_track_dfs if tdf['wind'].max() >= 96)

    ts_pct = int(round((ts_count / total_ensemble_members) * 100))
    ty_pct = int(round((ty_count / total_ensemble_members) * 100))
    major_pct = int(round((major_count / total_ensemble_members) * 100))

    # Lead time intensity envelope statistics
    all_leads = sorted(list(set(df_storm['lead_time_hours'].dropna().astype(int).values)))
    lead_stats = []
    for lh in all_leads:
        winds_at_h = []
        pressures_at_h = []
        for tdf in deduped_track_dfs:
            row = tdf[tdf['lead_time_hours'] == lh]
            if not row.empty:
                w = row.iloc[0]['wind']
                if not np.isnan(w):
                    winds_at_h.append(w)
                p = row.iloc[0]['pressure']
                if not np.isnan(p):
                    pressures_at_h.append(p)
        if winds_at_h:
            lead_stats.append({
                'h': lh,
                'dt': init_dt + timedelta(hours=float(lh)),
                'median': float(np.median(winds_at_h)),
                'mean': float(np.mean(winds_at_h)),
                'p10': float(np.percentile(winds_at_h, 10)),
                'p25': float(np.percentile(winds_at_h, 25)),
                'p75': float(np.percentile(winds_at_h, 75)),
                'p90': float(np.percentile(winds_at_h, 90)),
                'p_median': float(np.median(pressures_at_h)) if pressures_at_h else 1010.0
            })

    if lead_stats:
        peak_entry = max(lead_stats, key=lambda s: s['median'])
        peak_median_val = int(round(peak_entry['median']))
        peak_dt = peak_entry['dt']
        peak_median_str = f"PEAK MEDIAN {peak_median_val} KT · {peak_dt.strftime('%b %d %HZ').upper()}"
        if peak_median_val >= 137:
            peak_cat_str = "CATEGORY 5 SUPER TYPHOON"
        elif peak_median_val >= 113:
            peak_cat_str = "CATEGORY 4 TYPHOON"
        elif peak_median_val >= 96:
            peak_cat_str = "CATEGORY 3 MAJOR"
        elif peak_median_val >= 83:
            peak_cat_str = "CATEGORY 2 TYPHOON"
        elif peak_median_val >= 64:
            peak_cat_str = "CATEGORY 1 TYPHOON"
        elif peak_median_val >= 34:
            peak_cat_str = "TROPICAL STORM"
        elif peak_median_val >= 25:
            peak_cat_str = "TROPICAL DEPRESSION"
        else:
            peak_cat_str = "LOW PRESSURE AREA"
    else:
        peak_median_val = 0
        peak_median_str = "PEAK MEDIAN N/A"
        peak_cat_str = "N/A"
        peak_dt = init_dt

    if current_winds is None or current_winds == 0:
        if lead_stats:
            current_winds = int(round(lead_stats[0]['median']))
            current_pres = int(round(lead_stats[0]['p_median']))
        else:
            current_winds = 30
            current_pres = 1004
    else:
        current_winds = int(round(current_winds))
        current_pres = int(round(current_pres)) if current_pres else 1000

    # Viewport boundaries calculation
    all_lons = [p for tdf in deduped_track_dfs for p in tdf['lon'].dropna().values if 90 <= p <= 180]
    all_lats = [p for tdf in deduped_track_dfs for p in tdf['lat'].dropna().values if 0 <= p <= 55]
    if atcf_pos is not None:
        all_lons.append(atcf_pos[1])
        all_lats.append(atcf_pos[0])
    if not df_mean.empty:
        all_lons.extend(df_mean['lon'].dropna().values)
        all_lats.extend(df_mean['lat'].dropna().values)

    if all_lons and all_lats:
        min_lon, max_lon = min(all_lons), max(all_lons)
        min_lat, max_lat = min(all_lats), max(all_lats)
        pad_lon = max(4.0, (max_lon - min_lon) * 0.18)
        pad_lat = max(3.0, (max_lat - min_lat) * 0.18)
        view_lon_min = max(100.0, min_lon - pad_lon)
        view_lon_max = min(180.0, max_lon + pad_lon)
        view_lat_min = max(0.0, min_lat - pad_lat)
        view_lat_max = min(50.0, max_lat + pad_lat)
    else:
        view_lon_min, view_lon_max, view_lat_min, view_lat_max = 110.0, 160.0, 5.0, 35.0

    print(f"Generating broadcast-grade ensemble track graphic for {model_name} • {storm_title_display} ...")

    # Setup the 16:9 widescreen canvas
    fig = plt.figure(figsize=(16, 9.5), facecolor='#070a0f')

    # Map Axis
    ax_map = fig.add_axes([0.035, 0.20, 0.585, 0.70], projection=ccrs.PlateCarree())
    ax_map.set_facecolor('#0b1329')

    # Cartopy features
    ax_map.add_feature(cfeature.LAND, facecolor='#1e293b', edgecolor='#334155', linewidth=0.8, zorder=1)
    ax_map.add_feature(cfeature.COASTLINE, edgecolor='#475569', linewidth=0.8, zorder=2)
    ax_map.add_feature(cfeature.BORDERS, linestyle='-', edgecolor='#475569', linewidth=0.8, zorder=2)

    # Philippine Province Overlay
    try:
        geojson_paths = [
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "data", "ph_provinces.json"),
            "public/data/ph_provinces.json"
        ]
        found_geojson = next((p for p in geojson_paths if os.path.exists(p)), None)
        if found_geojson:
            with open(found_geojson, 'r', encoding='utf-8') as gf:
                geojson_data = json.load(gf)
            prov_geoms = [shape(feature['geometry']) for feature in geojson_data['features']]
            ax_map.add_geometries(prov_geoms, crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#334155', linewidth=0.45, alpha=0.6, zorder=3)
    except Exception as e:
        print(f"Warning: Province boundary overlay skipped: {e}")

    # PAR Boundary Overlay
    par_vertices = [
        (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
        (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
    ]
    ax_map.add_patch(mpatches.Polygon(
        par_vertices, facecolor='none', edgecolor='#f97316', linestyle='-', linewidth=1.6,
        alpha=0.75, transform=ccrs.PlateCarree(), zorder=4, label='PAR'
    ))

    # Canonical Sea Text Labels (zorder=3 so track lines pass over them)
    if view_lon_min + 1.0 <= 118.0 <= view_lon_max - 1.0 and view_lat_min + 1.0 <= 14.0 <= view_lat_max - 1.0:
        ax_map.text(
            118.0, 14.0, 'West Philippine\nSea', fontsize=8.0, color='#94a3b8', weight='bold',
            transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.65, zorder=3, clip_on=True
        )

    if view_lon_min + 1.5 <= 130.5 <= view_lon_max - 1.5 and view_lat_min + 1.0 <= 18.5 <= view_lat_max - 1.0:
        ax_map.text(
            130.5, 18.5, 'Philippine\nSea', fontsize=9.0, color='#94a3b8', weight='bold',
            transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.65, zorder=3, clip_on=True
        )

    # Gridlines
    gl = ax_map.gridlines(draw_labels=True, linewidth=0.4, color='#334155', alpha=0.4, linestyle=':')
    gl.top_labels = False
    gl.right_labels = False
    gl.xlabel_style = {'size': 8.0, 'color': '#64748b', 'weight': 'bold'}
    gl.ylabel_style = {'size': 8.0, 'color': '#64748b', 'weight': 'bold'}

    # Colormap & Norm setup
    if color_by == 'pressure':
        bounds = [930, 940, 950, 960, 970, 980, 990, 1000, 1005, 1010]
        colors = ['#311b92', '#4a148c', '#d500f9', '#880e4f', '#d50000', '#ff6d00', '#ffd600', '#00c853', '#00b0ff', '#2962ff', '#1a237e']
        track_cmap = mcolors.ListedColormap(colors)
        track_norm = mcolors.BoundaryNorm(bounds, track_cmap.N, extend='both')
    else:
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

    # Line styling based on ensemble size
    is_large = (total_ensemble_members is not None and total_ensemble_members >= 200) or ('large' in model_name.lower())
    if is_large:
        track_lw = 0.95
        track_alpha = 0.40
        halo_alpha = 0.10
        halo_lw = 2.0
    else:
        track_lw = 1.3
        track_alpha = 0.85
        halo_alpha = 0.30
        halo_lw = 2.8

    # Render Member Tracks
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
                p_avg = np.nanmean([pressures[i], pressures[i+1]]) if not np.isnan(pressures[i]) else 1008.0
                seg_vals.append(p_avg)
            else:
                w_avg = np.nanmean([winds[i], winds[i+1]]) if not np.isnan(winds[i]) else 25.0
                seg_vals.append(w_avg)

        if not segments:
            continue

        if halo_alpha > 0:
            lc_halo = LineCollection(
                segments, cmap=track_cmap, norm=track_norm,
                linewidth=halo_lw, alpha=halo_alpha, transform=ccrs.PlateCarree(), zorder=5
            )
            lc_halo.set_array(np.array(seg_vals))
            ax_map.add_collection(lc_halo)

        lc = LineCollection(
            segments, cmap=track_cmap, norm=track_norm,
            linewidth=track_lw, alpha=track_alpha, capstyle='round', joinstyle='round',
            transform=ccrs.PlateCarree(), zorder=6
        )
        lc.set_array(np.array(seg_vals))
        ax_map.add_collection(lc)

    # Render Primary Track (Official Control or Calculated Ensemble Mean)
    plot_primary_track = len(df_mean) >= 2
    if plot_primary_track:
        m_lons = list(df_mean['lon'].dropna().values)
        m_lats = list(df_mean['lat'].dropna().values)

        if atcf_pos is not None and use_live_atcf:
            m_lats = [atcf_pos[0]] + m_lats
            m_lons = [atcf_pos[1]] + m_lons

        # Double-pass stroke: white outline with dark core
        ax_map.plot(m_lons, m_lats, color='#ffffff', linewidth=5.2, zorder=7, transform=ccrs.PlateCarree())
        ax_map.plot(m_lons, m_lats, color='#090d14', linewidth=3.0, zorder=8, transform=ccrs.PlateCarree())

        # Forecast Milestone Nodes every 24h
        last_annot_pos = None
        for idx, row in df_mean.iterrows():
            hour = int(row['lead_time_hours'])
            if hour > 0 and hour % 24 == 0:
                mx, my = row['lon'], row['lat']
                if np.isnan(mx) or np.isnan(my):
                    continue
                if last_annot_pos is not None:
                    dist = np.sqrt((mx - last_annot_pos[0])**2 + (my - last_annot_pos[1])**2)
                    if dist < 2.5:
                        continue
                last_annot_pos = (mx, my)

                # Node circle
                ax_map.plot(
                    mx, my, marker='o', markerfacecolor='#ffffff', markeredgecolor='#090d14',
                    markersize=5.0, markeredgewidth=1.5, zorder=9, transform=ccrs.PlateCarree()
                )

                if color_by == 'pressure':
                    mp = row['pressure']
                    val_str = f"{int(round(mp))}mb\n+{hour}h" if not np.isnan(mp) else f"+{hour}h"
                else:
                    mw = row['wind']
                    val_str = f"{int(round(mw))}kt\n+{hour}h" if not np.isnan(mw) else f"+{hour}h"

                t_node = ax_map.text(
                    mx + 0.35, my + 0.35, val_str, color='#f8fafc', weight='bold',
                    fontsize=7.5, ha='left', va='bottom', transform=ccrs.PlateCarree(), zorder=10
                )
                t_node.set_path_effects([path_effects.withStroke(linewidth=2.5, foreground='#090d14')])

    # Live ATCF / Analysis Position Marker
    if atcf_pos is not None:
        ax_map.plot(
            atcf_pos[1], atcf_pos[0], 'o', color='#38bdf8', markersize=9,
            markeredgecolor='#ffffff', markeredgewidth=1.8, zorder=11, transform=ccrs.PlateCarree()
        )
        t_init = ax_map.text(
            atcf_pos[1] + 0.35, atcf_pos[0] - 0.45, "CURRENT", color='#38bdf8', weight='heavy',
            fontsize=7.5, transform=ccrs.PlateCarree(), zorder=11
        )
        t_init.set_path_effects([path_effects.withStroke(linewidth=2.5, foreground='#090d14')])

    # Set Map Extent & Frame
    ax_map.set_extent([view_lon_min, view_lon_max, view_lat_min, view_lat_max], crs=ccrs.PlateCarree())
    for spine in ax_map.spines.values():
        spine.set_edgecolor('#334155')
        spine.set_linewidth(1.2)

    # Docked Legends Axis below the Map
    leg_bottom = 0.045
    leg_h = 0.125
    ax_leg = fig.add_axes([0.035, leg_bottom, 0.585, leg_h])
    ax_leg.set_facecolor('#0d121c')
    ax_leg.set_xticks([])
    ax_leg.set_yticks([])
    for spine in ax_leg.spines.values():
        spine.set_edgecolor('#222d3d')
        spine.set_linewidth(1.0)

    # Section 1: Track Wind (KT) Colormap blocks
    ax_leg.text(
        0.04, 0.72, "TRACK WIND (KT)" if color_by == 'wind' else "MIN MSLP (HPA)",
        transform=ax_leg.transAxes, fontsize=6.8, weight='heavy', color='#e2e8f0', va='center'
    )
    tw_x = 0.04
    tw_w = 0.038
    tw_h = 0.28
    tw_y = 0.26
    for idx, col in enumerate(wind_colors if color_by == 'wind' else colors[:9]):
        rect = mpatches.Rectangle(
            (tw_x + idx * tw_w, tw_y), tw_w, tw_h,
            transform=ax_leg.transAxes, facecolor=col, edgecolor='#090d14', linewidth=0.5
        )
        ax_leg.add_patch(rect)
    tw_ticks = [
        (0, '20'), (2, '40'), (4, '60'), (6, '80'), (7, '100'), (8, '120'), (10, '140+')
    ] if color_by == 'wind' else [
        (0, '930'), (2, '950'), (4, '970'), (6, '990'), (8, '1010')
    ]
    for idx, lbl in tw_ticks:
        ax_leg.text(
            tw_x + idx * tw_w, tw_y - 0.06, lbl,
            transform=ax_leg.transAxes, fontsize=6.2, color='#94a3b8', ha='center', va='top'
        )

    # Section 2: Primary Track legend
    trk_type_lbl = "OFFICIAL CONTROL TRACK" if has_control else "ENSEMBLE MEAN TRACK"
    ax_leg.text(
        0.58, 0.72, trk_type_lbl,
        transform=ax_leg.transAxes, fontsize=6.8, weight='heavy', color='#e2e8f0', ha='center', va='center'
    )
    ax_leg.plot([0.50, 0.66], [tw_y + tw_h / 2, tw_y + tw_h / 2], transform=ax_leg.transAxes, color='#ffffff', linewidth=4.0)
    ax_leg.plot([0.50, 0.66], [tw_y + tw_h / 2, tw_y + tw_h / 2], transform=ax_leg.transAxes, color='#090d14', linewidth=2.2)
    ax_leg.plot([0.58], [tw_y + tw_h / 2], transform=ax_leg.transAxes, marker='o', markerfacecolor='#ffffff', markeredgecolor='#090d14', markersize=4.8)

    # Section 3: Status Badge
    status_box = mpatches.Rectangle(
        (0.74, tw_y), 0.22, tw_h, transform=ax_leg.transAxes,
        facecolor='#1e293b', edgecolor='#334155', linewidth=0.8
    )
    ax_leg.add_patch(status_box)
    status_text = "OFFICIAL ATCF INVEST" if is_invest else "ACTIVE TROPICAL CYCLONE"
    status_color = '#fbbf24' if is_invest else '#38bdf8'
    ax_leg.text(
        0.85, tw_y + tw_h / 2, status_text,
        transform=ax_leg.transAxes, fontsize=6.6, weight='bold', color=status_color,
        ha='center', va='center'
    )

    # Top Broadcast Header
    fig.text(0.035, 0.955, f"{storm_title_display} FORECAST TRACKS", fontsize=21, weight='heavy', color='#ffffff', fontfamily='sans-serif')
    sub_title = f"{model_name.upper()} {total_ensemble_members}-MEMBER ENSEMBLE  |  INIT {init_date_str} {cycle_str} ({local_time_str})"
    fig.text(0.035, 0.925, sub_title, fontsize=10, weight='bold', color='#94a3b8', fontfamily='monospace')

    fig.text(0.965, 0.955, "PHILIPPINE TYPHOON WEATHER", fontsize=13, weight='heavy', color='#ffffff', ha='right', fontfamily='sans-serif')
    fig.text(0.965, 0.928, "ENSEMBLE TRACK & INTENSITY OUTLOOK", fontsize=8.5, weight='bold', color='#94a3b8', ha='right', fontfamily='monospace')

    # Right Column Cards
    card_x = 0.640
    card_w = 0.325

    # Card 1: Active Storm Overview & Status Box
    card1_bottom = 0.675
    card1_h = 0.235
    ax_card1 = fig.add_axes([card_x, card1_bottom, card_w, card1_h])
    ax_card1.set_facecolor('#0d121c')
    ax_card1.set_xticks([])
    ax_card1.set_yticks([])
    for spine in ax_card1.spines.values():
        spine.set_edgecolor('#222d3d')
        spine.set_linewidth(1.0)

    headline_intensity = f"{current_winds} KT · {current_pres} HPA" if current_winds else f"{storm_title_display}"
    ax_card1.text(
        0.06, 0.90, headline_intensity,
        fontsize=22, weight='heavy', color='#ffffff', fontfamily='sans-serif', va='top'
    )
    ax_card1.text(
        0.06, 0.69, f"({plotted_members} OF {total_ensemble_members} MEMBERS TRACKING · FULL RUN TO {end_run_str})",
        fontsize=9.2, weight='bold', color='#38bdf8', fontfamily='monospace', va='top'
    )
    ax_card1.text(
        0.06, 0.50, f"active tropical cyclone ensemble track spread\n{region_desc}",
        fontsize=9.0, weight='bold', color='#cbd5e1', fontfamily='sans-serif', va='top'
    )
    ax_card1.text(
        0.06, 0.30, f"{peak_median_str} ({peak_cat_str})",
        fontsize=8.5, weight='bold', color='#fbbf24', fontfamily='monospace', va='top'
    )
    ax_card1.text(
        0.06, 0.15, f"{ts_count} OF {total_ensemble_members} ({ts_pct}%) REACH TS  ·  {ty_count} TYPHOON  ·  {major_count} MAJOR",
        fontsize=8.0, weight='bold', color='#e2e8f0', fontfamily='monospace', va='top'
    )

    # Card 2: Intensity Plume (True Date Axis)
    card2_bottom = 0.365
    card2_h = 0.245
    ax_card2 = fig.add_axes([card_x, card2_bottom, card_w, card2_h])
    ax_card2.set_facecolor('#0a0e17')

    cats = [
        ('LPA', 0, 25, '#080d1a', '#64748b'),
        ('TD', 25, 34, '#0f172a', '#38bdf8'),
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

        if has_control and not df_mean.empty:
            ctrl_dts = [init_dt + timedelta(hours=float(h)) for h in df_mean['lead_time_hours']]
            ax_card2.plot(
                ctrl_dts, df_mean['wind'],
                color='#facc15', linewidth=2.0, label='CONTROL', zorder=6
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

    # Card 2 Header & Caveats
    ax_card2.text(
        0.03, 1.14, "MEMBER INTENSITY (KT - 1-MIN SUSTAINED)",
        transform=ax_card2.transAxes, fontsize=8.0, weight='heavy', color='#f8fafc'
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

    # Multi-color legend on line y = 1.05
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    inv_c2 = ax_card2.transAxes.inverted()

    leg2_items = [
        ("—", "#ffffff", " MED", "#ffffff"),
        ("---", "#cbd5e1", " MEAN", "#94a3b8"),
        ("■", "#38bdf8", " 25-75%", "#94a3b8"),
        ("■", "#0284c7", " 10-90%", "#94a3b8")
    ]
    if has_control:
        leg2_items.append(("—", "#facc15", " CONTROL", "#facc15"))

    cur_x = 0.03
    for sym, sym_col, lbl, lbl_col in leg2_items:
        t_sym = ax_card2.text(cur_x, 1.05, sym, transform=ax_card2.transAxes,
                              fontsize=6.8, weight='heavy', color=sym_col, va='baseline')
        bb_sym = t_sym.get_window_extent(renderer=renderer)
        w_sym = inv_c2.transform((bb_sym.width, 0))[0] - inv_c2.transform((0, 0))[0]
        cur_x += w_sym + 0.003

        t_lbl = ax_card2.text(cur_x, 1.05, lbl, transform=ax_card2.transAxes,
                              fontsize=6.3, weight='bold', color=lbl_col, va='baseline')
        bb_lbl = t_lbl.get_window_extent(renderer=renderer)
        w_lbl = inv_c2.transform((bb_lbl.width, 0))[0] - inv_c2.transform((0, 0))[0]
        cur_x += w_lbl + 0.014

    for spine in ax_card2.spines.values():
        spine.set_edgecolor('#222d3d')
        spine.set_linewidth(1.0)

    # Card 3: Probability Trend across forecast run
    card3_bottom = 0.045
    card3_h = 0.240
    ax_card3 = fig.add_axes([card_x, card3_bottom, card_w, card3_h])
    ax_card3.set_facecolor('#0a0e17')

    max_eval_h = max(48.0, df_storm['lead_time_hours'].max())
    eval_hours = np.arange(0, max_eval_h + 1, 12.0)
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

    ax_card3.plot(eval_dts, ts_by_lead, color='#38bdf8', linewidth=2.8, label='TS', marker='o', markersize=3.6, zorder=4)
    ax_card3.plot(eval_dts, ty_by_lead, color='#f59e0b', linewidth=2.0, label='TYPHOON', marker='D', markersize=3.4, zorder=5)
    ax_card3.plot(eval_dts, maj_by_lead, color='#ef4444', linewidth=1.3, label='MAJOR', marker='^', markersize=3.6, zorder=6)

    # Direct line label at end point
    if ts_by_lead and ts_by_lead[-1] > 0:
        ax_card3.text(
            eval_dts[-1] + timedelta(hours=3), ts_by_lead[-1], f"{ts_by_lead[-1]}%",
            color='#38bdf8', fontsize=7.2, weight='bold', va='center'
        )
    if ty_by_lead and ty_by_lead[-1] > 0:
        ax_card3.text(
            eval_dts[-1] + timedelta(hours=3), ty_by_lead[-1], f"{ty_by_lead[-1]}%",
            color='#f59e0b', fontsize=7.2, weight='bold', va='center'
        )
    if maj_by_lead and maj_by_lead[-1] > 0:
        ax_card3.text(
            eval_dts[-1] + timedelta(hours=3), maj_by_lead[-1], f"{maj_by_lead[-1]}%",
            color='#ef4444', fontsize=7.2, weight='bold', va='center'
        )

    max_prob = max(ts_by_lead + ty_by_lead + maj_by_lead + [10])
    ax_card3.set_ylim(0, min(100, max(25, int(math.ceil(max_prob / 10.0)) * 10 + 5)))
    ax_card3.yaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(xmax=100, decimals=0))
    ax_card3.tick_params(axis='y', labelsize=7.2, colors='#64748b')
    ax_card3.yaxis.tick_right()

    if eval_dts:
        ax_card3.set_xlim(min(eval_dts), max(eval_dts) + timedelta(hours=14))
        ax_card3.xaxis.set_major_locator(mdates.DayLocator(interval=2))
        ax_card3.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))
        ax_card3.tick_params(axis='x', labelsize=7.2, colors='#94a3b8')

    ax_card3.grid(True, linestyle=':', alpha=0.25, color='#64748b')

    # Card 3 Header
    ax_card3.text(
        0.03, 1.14, f"CUMULATIVE PROBABILITY (THROUGH {end_run_str})",
        transform=ax_card3.transAxes, fontsize=8.0, weight='heavy', color='#f8fafc'
    )
    inv_c3 = ax_card3.transAxes.inverted()
    leg3_items = [
        ("— TS", "#38bdf8"),
        ("— TYPHOON", "#f59e0b"),
        ("— MAJOR", "#ef4444")
    ]
    cur_x3 = 0.03
    for lbl, col in leg3_items:
        t = ax_card3.text(cur_x3, 1.05, lbl, transform=ax_card3.transAxes,
                          fontsize=7.2, weight='heavy', color=col, va='baseline')
        bb = t.get_window_extent(renderer=renderer)
        w_axes = inv_c3.transform((bb.width, 0))[0] - inv_c3.transform((0, 0))[0]
        cur_x3 += w_axes + 0.035

    for spine in ax_card3.spines.values():
        spine.set_edgecolor('#222d3d')
        spine.set_linewidth(1.0)

    # Save output publication image
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    plt.savefig(output_path, dpi=300, facecolor='#070a0f', edgecolor='none')
    plt.close()

    print(f"Broadcast-grade spaghetti plot saved to: {output_path}")
    print(f"Stats: {plotted_members} tracks plotted out of {total_ensemble_members} members.")

def map_hdbscan_clusters_to_knack_storms(df, knack_storms, dist_threshold=4.0):
    """
    Maps HDBSCAN clusters to Knack active storms by comparing positions at the corresponding forecast hour.
    If a very close cluster exists (<= 3.0 deg), only maps clusters <= 3.0 deg (filtering out far/malayo ones).
    If no clusters are <= 3.0 deg but exist under 4.0 deg, maps only the single closest cluster as a fallback.
    """
    if df.empty or not knack_storms:
        return df, False
        
    df = df.copy()
    
    # Store candidate matches: knack_atcf_id -> list of candidates
    candidates_by_storm = {}
    
    # Process each unique init_time and storm_group (excluding 'UNKNOWN')
    for (init_val, group_id), group_df in df.groupby(['init_time', 'storm_group']):
        if group_id == 'UNKNOWN':
            continue
            
        try:
            f_init_dt = datetime.strptime(str(init_val).strip(), "%Y-%m-%d %H:%M:%S")
        except (ValueError, TypeError):
            f_init_dt = None
            
        for k_storm in knack_storms:
            k_lat = k_storm['lat']
            k_lon = k_storm['lon']
            k_atcf_id = k_storm['atcf_id']
            k_name = k_storm['name']
            k_time_str = k_storm['init_time']
            
            if np.isnan(k_lat) or np.isnan(k_lon):
                continue
                
            k_dt = None
            if k_time_str:
                for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"]:
                    try:
                        k_dt = datetime.strptime(k_time_str.strip(), fmt)
                        break
                    except ValueError:
                        continue
                        
            target_lead_time = 0.0
            if f_init_dt and k_dt:
                time_diff = k_dt - f_init_dt
                target_lead_time = time_diff.total_seconds() / 3600.0
                
            # If the forecast initialization differs from the active storm time by more than 48 hours,
            # or is in the future (< -24h), it cannot be mapped to the current active storm.
            if target_lead_time > 48.0 or target_lead_time < -24.0:
                continue

            if target_lead_time < 0:
                target_lead_time = 0.0
                
            # Filter all points in this cluster close to target lead time
            diffs = (group_df['lead_time_hours'] - target_lead_time).abs()
            
            if not diffs.empty and diffs.min() <= 12.0:
                # Compute average position of the cluster at the target lead time
                target_pts = group_df[diffs <= 6.0]
                if target_pts.empty:
                    target_pts = group_df[diffs == diffs.min()]
            else:
                # Fall back to the cluster's earliest available lead time if reasonably early
                closest_lead = group_df['lead_time_hours'].min()
                if closest_lead > 36.0:
                    continue
                target_pts = group_df[group_df['lead_time_hours'] == closest_lead]
                
            avg_lat = target_pts['lat'].mean()
            avg_lon = target_pts['lon'].mean()
            
            if np.isnan(avg_lat) or np.isnan(avg_lon):
                continue
                
            d_lat = avg_lat - k_lat
            d_lon = (avg_lon - k_lon) * math.cos(math.radians((avg_lat + k_lat)/2))
            dist = math.sqrt(d_lat**2 + d_lon**2)
            
            if dist <= dist_threshold:
                if k_atcf_id not in candidates_by_storm:
                    candidates_by_storm[k_atcf_id] = []
                candidates_by_storm[k_atcf_id].append({
                    'group_id': group_id,
                    'dist': dist,
                    'lead_time': target_lead_time,
                    'name': k_name,
                    'atcf_id': k_atcf_id
                })

    # Filter and apply the best candidate matches
    mapped_groups = {}
    has_mapped = False
    
    for k_atcf_id, candidates in candidates_by_storm.items():
        if not candidates:
            continue
            
        # Find the absolute closest cluster to this storm
        closest_cand = min(candidates, key=lambda c: c['dist'])
        min_dist = closest_cand['dist']
        
        # Calculate maximum allowed distance:
        # - If closest candidate is very close (<= 3.0 deg), allow everything up to 3.0 deg.
        # - Otherwise, allow candidates within min_dist + 1.5 deg (to gather all fallback ensemble groups).
        # - In all cases, cap at dist_threshold (6.0 deg).
        allowed_max_dist = max(3.0, min_dist + 1.5) if min_dist <= 3.0 else min_dist + 1.5
        allowed_max_dist = min(dist_threshold, allowed_max_dist)
        
        for cand in candidates:
            if cand['dist'] <= allowed_max_dist:
                group_id = cand['group_id']
                k_name = cand['name']
                
                new_group_id = f"knack_{k_atcf_id}"
                display_name = get_storm_display_name(k_atcf_id)
                if k_name and not k_name.upper().startswith('INVEST') and not k_name.upper().startswith('WP') and k_name.upper() != k_atcf_id.upper():
                    display_name = f"{k_name.upper()} ({k_atcf_id})"
                    
                mapped_groups[group_id] = {
                    'storm_group': new_group_id,
                    'storm_group_name': display_name,
                    'rep_track_id': k_atcf_id,
                    'atcf_id': k_atcf_id,
                    'dist': cand['dist'],
                    'lead_time': cand['lead_time']
                }
                has_mapped = True

    # Apply the mappings to the dataframe
    for orig_group_id, mapping in mapped_groups.items():
        mask = df['storm_group'] == orig_group_id
        df.loc[mask, 'storm_group'] = mapping['storm_group']
        df.loc[mask, 'storm_group_name'] = mapping['storm_group_name']
        df.loc[mask, 'rep_track_id'] = mapping['rep_track_id']
        print(f"Mapped HDBSCAN cluster {orig_group_id} to Knack storm {mapping['atcf_id']} (dist: {mapping['dist']:.2f} deg, target lead: {mapping['lead_time']:.1f}h)")
        
    return df, has_mapped

def main():
    parser = argparse.ArgumentParser(description="Ensemble Track Visualization System")
    parser.add_argument('--input', type=str, nargs='*', help="Input DAT, CSV, or ATCF files")
    parser.add_argument('--storm-id', type=str, help="Specific track_id to plot (e.g. WP092026)")
    parser.add_argument('--storm-name', type=str, help="Storm display name (e.g. 90W INVEST)")
    parser.add_argument('--output-dir', type=str, default='public/assets', help="Directory to save generated plots")
    parser.add_argument('--color-by', type=str, default='wind', choices=['wind', 'pressure'], help="Parameter to color lines by and display in colorbar")
    args = parser.parse_args()

    # If no files passed, scan public/data for standard latest runs
    input_files = args.input
    if not input_files:
        search_dir = 'public/data'
        # Default operational models to visualize: ECMWF AIFS, ECMWF IFS, and GDM WNCv3
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

    # Fetch active storms from Knack API
    knack_storms = fetch_knack_active_storms()
    if knack_storms:
        # Filter Knack active storms geographically to Western Pacific only
        knack_storms = [
            s for s in knack_storms 
            if (s['lon'] >= 100 and s['lon'] <= 180 and s['lat'] >= 0 and s['lat'] <= 50)
        ]

    print(f"Processing files: {input_files}")
    
    latest_plotted_init = {}
    
    for f_path in input_files:
        raw_df = load_track_file(f_path)
        if raw_df.empty:
            print(f"Skipping empty file: {f_path}")
            continue

        normalized_df = normalize_dataframe(raw_df)
        total_members = normalized_df['sample'].nunique()
        wp_df = filter_western_pacific(normalized_df)
        
        if wp_df.empty:
            print(f"No Western Pacific tracks found in: {f_path}")
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
            
        # Filter tracks to only those near active storms (prevents chaining effect of separate storms)
        if knack_storms:
            wp_df = filter_tracks_near_active_storms(wp_df, knack_storms, max_dist_deg=8.0)
            if wp_df.empty:
                print(f"No tracks near active Knack storms found in: {f_path}")
                continue
                
        model = detect_model_name(f_path)
        
        # Load corresponding paired file if available (for GDM WNCv3 / Large)
        df_paired = pd.DataFrame()
        if any(k in f_path.lower() for k in ['wnv3', 'wnc', 'fnv3', 'oper', 'large']):
            if 'fnv3_large_latest.dat' in f_path:
                paired_path = f_path.replace('fnv3_large_latest.dat', 'fnv3_large_paired_latest.dat')
            elif 'fnv3_large_latest.csv' in f_path:
                paired_path = f_path.replace('fnv3_large_latest.csv', 'fnv3_large_paired_latest.csv')
            elif 'wnv3_latest.dat' in f_path:
                paired_path = f_path.replace('wnv3_latest.dat', 'wnv3_paired_latest.dat')
            elif 'wnv3_latest.csv' in f_path:
                paired_path = f_path.replace('wnv3_latest.csv', 'wnv3_paired_latest.csv')
            elif 'oper_latest.dat' in f_path:
                paired_path = f_path.replace('oper_latest.dat', 'oper_paired_latest.dat')
            elif 'oper_latest.csv' in f_path:
                paired_path = f_path.replace('oper_latest.csv', 'oper_paired_latest.csv')
            elif 'fnv3p2_latest.dat' in f_path:
                paired_path = f_path.replace('fnv3p2_latest.dat', 'fnv3p2_paired_latest.dat')
            elif 'fnv3p2_latest.csv' in f_path:
                paired_path = f_path.replace('fnv3p2_latest.csv', 'fnv3p2_paired_latest.csv')
            else:
                base = os.path.basename(f_path)
                dir_name = os.path.dirname(f_path)
                paired_base = base.replace('wnv3', 'wnv3_paired').replace('oper', 'oper_paired').replace('fnv3', 'fnv3_paired')
                paired_path = os.path.join(dir_name, paired_base)
                
            if os.path.exists(paired_path):
                print(f"Found corresponding paired file: {paired_path}")
                raw_paired_df = load_track_file(paired_path)
                if not raw_paired_df.empty:
                    df_paired = normalize_dataframe(raw_paired_df)
        
        # First, run custom HDBSCAN trajectory clustering to find forecast disturbances
        wp_df = cluster_genesis_locations(wp_df)
        
        # Next, map these HDBSCAN clusters to the Knack active storms
        wp_df, has_mapped = map_hdbscan_clusters_to_knack_storms(wp_df, knack_storms)
        if has_mapped:
            # Focus only on tracks that belong to clusters mapped to real Knack storms
            wp_df = wp_df[wp_df['storm_group'].str.startswith('knack_')].copy()
        else:
            print(f"No HDBSCAN clusters matched Knack active storms in: {f_path}. Skipping.")
            continue
            
        # Group and plot by storm_group
        storm_groups = wp_df['storm_group'].dropna().unique()
        print(f"Found storm groups {storm_groups} in {f_path}")
        
        for sg_id in storm_groups:
            if sg_id == 'UNKNOWN':
                continue
                
            group_df = wp_df[wp_df['storm_group'] == sg_id]
            rep_track_id = group_df['rep_track_id'].dropna().iloc[0]
            
            # Track initialization time to determine date (YYYYMMDD) and cycle (00Z, 06Z, 12Z, 18Z)
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
                
            # Extract storm identifiers (e.g. WP922026 -> WP92 & 92W)
            match_wp = re.search(r'WP(\d{2})', rep_track_id.upper())
            match_w = re.search(r'(\d{2})W', rep_track_id.upper())
            if match_wp:
                num_str = match_wp.group(1)
                wp_id = f"WP{num_str}"
                num_w_id = f"{num_str}W"
            elif match_w:
                num_str = match_w.group(1)
                wp_id = f"WP{num_str}"
                num_w_id = f"{num_str}W"
            else:
                wp_id = rep_track_id.upper()
                num_w_id = rep_track_id.upper()
                
            # If the user specified a storm-id, only plot that one
            if args.storm_id:
                s_target = args.storm_id.upper().strip()
                if s_target not in (wp_id, num_w_id, rep_track_id.upper()):
                    continue
                
            model_clean = model.replace(' ', '_').lower()
            
            # Primary filename format: WP92_20260721_00Z_gdm_fnv3.png
            primary_filename = f"{wp_id}_{ymd}_{cycle_str}_{model_clean}.png"
            out_file = os.path.join(args.output_dir, primary_filename)
            
            # Track initialization time to prevent older runs from overwriting newer runs for the exact same file
            if out_file in latest_plotted_init:
                if current_init_dt < latest_plotted_init[out_file]:
                    print(f"Skipping older run for {out_file} (current init: {init_time_raw}, already plotted newer: {latest_plotted_init[out_file]})")
                    continue
            
            # Find matching active storm coordinates to pass as atcf_pos
            atcf_pos = None
            if sg_id.startswith('knack_'):
                atcf_id_clean = sg_id.replace('knack_', '')
                for s in knack_storms:
                    if s['atcf_id'] == atcf_id_clean:
                        atcf_pos = (s['lat'], s['lon'])
                        break
            
            plot_model_tracks(
                wp_df, model, sg_id, out_file,
                storm_name_override=args.storm_name,
                color_by=args.color_by,
                atcf_pos=atcf_pos,
                df_paired=df_paired,
                knack_storms=knack_storms,
                total_ensemble_members=total_members
            )
            latest_plotted_init[out_file] = current_init_dt
            
            # Update manifest JSON
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
                    'timestamp': datetime.now(timezone.utc).isoformat()
                })
                
            os.makedirs(os.path.dirname(manifest_file), exist_ok=True)
            with open(manifest_file, 'w', encoding='utf-8') as mf:
                json.dump(manifest_data, mf, indent=2)

if __name__ == '__main__':
    main()

