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
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2.0)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0)**2
    return R * 2.0 * math.asin(math.sqrt(a))

def mean_geo_center(points):
    """
    Computes the geographic centroid of a list of {'lat': ..., 'lon': ...} dicts
    using spherical (3D Cartesian) averaging. Matches generate_trends_map.py.
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
    
    return df[required_cols]

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

def filter_tracks_near_active_storms(df, knack_storms, max_dist_deg=6.0):
    """
    Retains only tracks whose initial position (first available point)
    lies within max_dist_deg of at least one active Knack storm position.
    """
    if df.empty or not knack_storms:
        return pd.DataFrame(columns=df.columns)
        
    keep_groups = set()
    for (t_id, s_val), track_points in df.groupby(['track_id', 'sample']):
        track_points = track_points.sort_values('lead_time_hours')
        if track_points.empty:
            continue
        first_pt = track_points.iloc[0]
        f_lat = first_pt['lat']
        f_lon = first_pt['lon']
        if np.isnan(f_lat) or np.isnan(f_lon):
            continue
            
        near_any = False
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
    if 'aifs' in name:
        return 'ECMWF AIFS'
    elif 'ifs' in name:
        return 'ECMWF IFS'
    elif 'fnv3' in name:
        return 'GDM WNC'
    elif 'oper' in name:
        return 'GDM OPER'
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
    Groups tracks within the same init_time using the custom HDBSCAN implementation from generate_trends_map.py.
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
                    
        # Compute min_cluster_size (same formula as generate_trends_map.py)
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

def plot_model_tracks(df_model, model_name, storm_group_id, output_path, storm_name_override=None, color_by='pressure', atcf_pos=None, df_paired=None):
    """
    Generates a publication-quality spaghetti plot for a given model and storm cluster.
    """
    # Filter for the specific storm cluster
    df_storm = df_model[df_model['storm_group'] == storm_group_id].copy()
    if color_by == 'wind':
        df_storm['wind'] = df_storm['wind'] * 1.852
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
    init_time_str = format_init_time(init_time_raw)

    # Determine storm name
    group_name = df_storm['storm_group_name'].dropna().iloc[0] if not df_storm['storm_group_name'].isna().all() else 'Unknown'
    storm_name = storm_name_override if storm_name_override else group_name

    # Forecast Processing & Grouping by Member
    deterministic_data = df_storm[df_storm['sample'] == 0]
    ensemble_data = df_storm[df_storm['sample'] > 0]
    # Only treat as real ensemble if there are at least 2 distinct ensemble members
    has_ensemble_tracks = ensemble_data['sample'].nunique() >= 2 if not ensemble_data.empty else False
    
    if ensemble_data.empty:
        unique_samples = df_storm['sample'].unique()
        if len(unique_samples) > 1:
            ensemble_data = df_storm[df_storm['sample'] != 0]
            has_ensemble_tracks = ensemble_data['sample'].nunique() >= 2
        else:
            ensemble_data = df_storm

    # Limit displayed ensemble members to at most 100 for visual clarity (e.g. for fnv3p2's large ensembles)
    ensemble_samples = ensemble_data['sample'].unique()
    if len(ensemble_samples) > 100:
        # Systematic downsampling to keep a representative spread of 100 members
        indices = np.linspace(0, len(ensemble_samples) - 1, 100, dtype=int)
        selected_samples = [ensemble_samples[idx] for idx in indices]
        ensemble_data = ensemble_data[ensemble_data['sample'].isin(selected_samples)]

    # Compute Ensemble Mean Track early to calculate dynamic viewport extent and aspect ratio
    # Logic aligned with generate_trends_map.py: geodesic mean for position, median for wind/pressure
    if has_ensemble_tracks:
        calc_mean_df = ensemble_data[ensemble_data['sample'] != -1]
        if calc_mean_df.empty:
            calc_mean_df = ensemble_data

        # Find matched paired track (if available) for per-hour override (same as generate_trends_map.py)
        matched_paired = None
        if df_paired is not None and not df_paired.empty:
            ref_lat, ref_lon = None, None
            if atcf_pos is not None:
                ref_lat, ref_lon = atcf_pos[0], atcf_pos[1]
            else:
                # Use first ensemble point as reference
                first_pts = calc_mean_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
                if not first_pts.empty:
                    ref_lat, ref_lon = first_pts.iloc[0]['lat'], first_pts.iloc[0]['lon']

            if ref_lat is not None and ref_lon is not None:
                # Build paired points list from sample == -1 entries (same filter as generate_trends_map.py)
                df_paired_mean = df_paired[df_paired['sample'] == -1].copy()
                if color_by == 'wind':
                    df_paired_mean['wind'] = df_paired_mean['wind'] * 1.852

                best_paired_tid = None
                best_dist = 500.0  # km threshold (matching generate_trends_map.py)

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
                    print(f"Using official paired ensemble mean from track {best_paired_tid} for {storm_name}")

        # Group ensemble data by hour (same structure as generate_trends_map.py)
        model_total_members = df_model[df_model['sample'] > 0]['sample'].nunique()
        if model_total_members > 0:
            effective_total = min(100, model_total_members)
            required_support = max(1, effective_total // 2)
        else:
            required_support = 1

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
            n = len(d['lats'])
            if n < required_support:
                continue

            m_lat, m_lon, m_wind, m_press = np.nan, np.nan, np.nan, np.nan
            if matched_paired:
                # Per-hour paired mean override (matching generate_trends_map.py ±3hr tolerance)
                paired_pt = min(matched_paired, key=lambda pt: abs(pt['h'] - h))
                if abs(paired_pt['h'] - h) <= 3:
                    m_lat = paired_pt['lat']
                    m_lon = paired_pt['lon']
                    m_wind = paired_pt['wind']
                    m_press = paired_pt['pressure']
                else:
                    continue
            else:
                # Spherical geodesic mean for position (matching generate_trends_map.py)
                pts_at_hour = [{'lat': lat, 'lon': lon} for lat, lon in zip(d['lats'], d['lons'])]
                geo_mean = mean_geo_center(pts_at_hour)
                m_lat = geo_mean['lat']
                m_lon = geo_mean['lon']
                # Median for wind and pressure (matching generate_trends_map.py)
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
        # No ensemble tracks: use deterministic track positions for viewport calculation only
        df_mean = pd.DataFrame(columns=['lead_time_hours', 'lat', 'lon', 'pressure', 'wind'])

    # Determine the model forecast track start point to see if live ATCF is too far
    first_track_lat, first_track_lon = None, None
    if not df_mean.empty:
        first_track_lat, first_track_lon = df_mean.iloc[0]['lat'], df_mean.iloc[0]['lon']
    elif not deterministic_data.empty:
        det_first = deterministic_data.sort_values('lead_time_hours').dropna(subset=['lat', 'lon']).iloc[0]
        first_track_lat, first_track_lon = det_first['lat'], det_first['lon']

    use_live_atcf = False
    if atcf_pos is not None and first_track_lat is not None and first_track_lon is not None:
        gap_deg = np.sqrt((atcf_pos[0] - first_track_lat)**2 + (atcf_pos[1] - first_track_lon)**2)
        if gap_deg <= 2.0:
            use_live_atcf = True

    # Determine boundaries and aspect ratio
    # For viewport calculation, use ensemble mean if available, otherwise use all storm data
    if not df_mean.empty:
        lons_to_fit = list(df_mean['lon'].dropna().values)
        lats_to_fit = list(df_mean['lat'].dropna().values)
    else:
        lons_to_fit = list(df_storm['lon'].dropna().values)
        lats_to_fit = list(df_storm['lat'].dropna().values)
    if atcf_pos is not None and use_live_atcf:
        lats_to_fit.append(atcf_pos[0])
        lons_to_fit.append(atcf_pos[1])
        
    if lons_to_fit and lats_to_fit:
        min_lon, max_lon = min(lons_to_fit), max(lons_to_fit)
        min_lat, max_lat = min(lats_to_fit), max(lats_to_fit)
        
        lon_pad = max(8.0, (max_lon - min_lon) * 0.3)
        lat_pad = max(6.0, (max_lat - min_lat) * 0.3)
        
        lon_min = max(100.0, min_lon - lon_pad)
        lon_max = min(180.0, max_lon + lon_pad)
        lat_min = max(0.0, min_lat - lat_pad)
        lat_max = min(50.0, max_lat + lat_pad)
    else:
        lon_min, lon_max, lat_min, lat_max = 105.0, 155.0, 0.0, 40.0

    lon_span = lon_max - lon_min
    lat_span = lat_max - lat_min
    aspect = lon_span / lat_span

    # Calculate dynamic figure height based on width of 12 inches
    fig_width = 12
    fig_height = (fig_width - 2.5) / aspect + 1.8
    fig_height = max(5.0, min(10.0, fig_height))
    
    print(f"Generating spaghetti track plot for {model_name} storm {storm_name} (Group: {storm_group_id}, Color by: {color_by}) ...")

    # Setup the plot canvas
    fig = plt.figure(figsize=(fig_width, fig_height), facecolor='white')
    
    # Custom axes configuration to save margins for annotations and colorbar
    ax = fig.add_axes([0.08, 0.08, 0.78, 0.80], projection=ccrs.PlateCarree())
    
    # 1. Base Map Setup (ocean background, land features)
    ax.set_facecolor('#87CEEB')  # Sky blue ocean background
    
    # Standard Cartopy high-resolution features styled like Forcast.py
    ax.add_feature(cfeature.LAND, facecolor='#DEB887', edgecolor='#8B4513', linewidth=0.8, zorder=1)
    ax.add_feature(cfeature.OCEAN, facecolor='#87CEEB', zorder=0)
    ax.add_feature(cfeature.COASTLINE, edgecolor='#8B4513', linewidth=0.8, zorder=2)
    ax.add_feature(cfeature.BORDERS, linestyle='-', edgecolor='#654321', linewidth=0.8, zorder=2)

    # Philippine Province Overlay styled like Forcast.py
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

    # Add Sea Text Labels from Forcast.py
    ax.text(
        118, 13, 'West Philippine\nSea', fontsize=5, color='navy', weight='bold',
        transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5, zorder=3
    )
    ax.text(
        130, 20, 'Philippine\nSea', fontsize=7, color='navy', weight='bold',
        transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5, zorder=3
    )

    # PAR Boundary Overlay styled like Forcast.py
    par_vertices = [
        (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
        (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
    ]
    ax.add_patch(mpatches.Polygon(par_vertices, facecolor='none', edgecolor='#FF6B35', 
                                 linestyle='-', linewidth=3.0, alpha=0.8, 
                                 transform=ccrs.PlateCarree(), zorder=3, label='PAR'))

    # Gridlines Configuration styled like Forcast.py
    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
    gl.xlocator = plt.FixedLocator(np.arange(90, 181, 5))
    gl.ylocator = plt.FixedLocator(np.arange(-10, 51, 5))
    gl.xlabel_style = {'size': 10, 'weight': 'bold', 'color': '#475569'}
    gl.ylabel_style = {'size': 10, 'weight': 'bold', 'color': '#475569'}
    gl.top_labels = False
    gl.right_labels = False

    # Setup Colormap and Normalization based on selected parameter
    if color_by == 'pressure':
        bounds = [930, 940, 950, 960, 970, 980, 990, 1000, 1005, 1010]
        # Colors selected to match Levi Cowan's style perfectly (11 colors for 11 bins including extend='both'):
        colors = [
            '#311b92',  # <930 (very deep violet)
            '#4a148c',  # 930 - 940 (dark purple)
            '#d500f9',  # 940 - 950 (magenta/pink)
            '#880e4f',  # 950 - 960 (deep maroon)
            '#d50000',  # 960 - 970 (bright red)
            '#ff6d00',  # 970 - 980 (vibrant orange)
            '#ffd600',  # 980 - 990 (yellow)
            '#00c853',  # 990 - 1000 (vibrant green)
            '#00b0ff',  # 1000 - 1005 (light blue)
            '#2962ff',  # 1005 - 1010 (blue)
            '#1a237e'   # >1010 (very dark blue)
        ]
        cmap = mcolors.ListedColormap(colors)
        norm = mcolors.BoundaryNorm(bounds, cmap.N, extend='both')
    else:
        bounds = [30, 60, 90, 120, 150, 180, 210, 240]
        colors = [
            '#00d2ff',  # <30 (light cyan)
            '#00a8ff',  # 30 - 60 (blue)
            '#00e676',  # 60 - 90 (green)
            '#ffd600',  # 90 - 120 (yellow)
            '#ff9100',  # 120 - 150 (orange)
            '#ff3d00',  # 150 - 180 (red)
            '#c51162',  # 180 - 210 (magenta/deep pink)
            '#aa00ff',  # 210 - 240 (purple)
            '#311b92'   # >240 (dark violet)
        ]
        cmap = mcolors.ListedColormap(colors)
        norm = mcolors.BoundaryNorm(bounds, cmap.N, extend='both')

    # Plot Ensemble Members (reusing ensemble_data and deterministic_data computed above)
    plotted_members = 0
    ignored_members = 0
    
    for (t_id, m_id), member_df in ensemble_data.groupby(['track_id', 'sample']):
        member_df = member_df.sort_values('lead_time_hours')
        if len(member_df) < 3:
            ignored_members += 1
            continue
            
        lons = member_df['lon'].values
        lats = member_df['lat'].values
        winds = member_df['wind'].values
        pressures = member_df['pressure'].values
        
        # Build segments for LineCollection
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
            
        lc = LineCollection(segments, cmap=cmap, norm=norm, linewidth=1.5, alpha=0.95, 
                            capstyle='round', joinstyle='round', transform=ccrs.PlateCarree(), zorder=4)
        lc.set_array(np.array(seg_vals))
        ax.add_collection(lc)
        plotted_members += 1

    # Plot Deterministic Runs
    if not deterministic_data.empty:
        for t_id, det_df in deterministic_data.groupby('track_id'):
            det_df = det_df.sort_values('lead_time_hours')
            if len(det_df) >= 3:
                lons = det_df['lon'].values
                lats = det_df['lat'].values
                winds = det_df['wind'].values
                pressures = det_df['pressure'].values
                
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
                    
                if segments:
                    lc = LineCollection(segments, cmap=cmap, norm=norm, linewidth=2.5, alpha=0.9, 
                                        capstyle='round', joinstyle='round', transform=ccrs.PlateCarree(), zorder=5)
                    lc.set_array(np.array(seg_vals))
                    ax.add_collection(lc)
                    print(f"Plotted deterministic run (sample 0, track {t_id}) for {model_name}")

    # 3. Plot Ensemble Mean Track (only when real ensemble tracks exist and there are enough of them)
    
    if has_ensemble_tracks and len(df_mean) >= 2 and plotted_members >= 25:
        m_lons = list(df_mean['lon'].values)
        m_lats = list(df_mean['lat'].values)

        # Prepend ATCF position to the mean track so the black line starts from the genesis marker
        # Only prepend if gap is within 2.0 degrees
        if atcf_pos is not None and use_live_atcf:
            atcf_lat, atcf_lon = atcf_pos
            m_lats = [atcf_lat] + m_lats
            m_lons = [atcf_lon] + m_lons

        # Plot the ensemble mean as a thick black line with a white outline for maximum contrast
        ax.plot(m_lons, m_lats, color='white', linewidth=6.5, zorder=6, transform=ccrs.PlateCarree())
        ax.plot(m_lons, m_lats, color='black', linewidth=4.0, zorder=7, transform=ccrs.PlateCarree())

        # 4. Forecast Hour and Parameter Annotations at every 24-hour interval
        last_labeled_pos = None
        for idx, row in df_mean.iterrows():
            hour = int(row['lead_time_hours'])
            if hour > 0 and hour % 24 == 0:
                mx, my = row['lon'], row['lat']
                
                # Prevent overlapping labels by enforcing a minimum physical distance of 3.0 degrees from the last label
                if last_labeled_pos is not None:
                    dist = np.sqrt((mx - last_labeled_pos[0])**2 + (my - last_labeled_pos[1])**2)
                    if dist < 3.0:
                        continue
                        
                last_labeled_pos = (mx, my)
                
                if color_by == 'pressure':
                    mp = row['pressure']
                    pressure_label = f"{int(round(mp))}mb" if not np.isnan(mp) else "N/A"
                    label_text = f"{pressure_label}\n{hour}"
                else:
                    mw = row['wind']
                    wind_label = f"{int(round(mw))} km/h" if not np.isnan(mw) else "N/A"
                    label_text = f"{wind_label}\n{hour}"
                
                # Draw small node circle on mean track
                ax.plot(mx, my, marker='o', markerfacecolor='white', markeredgecolor='black', 
                        markersize=5, markeredgewidth=1.5, zorder=8, transform=ccrs.PlateCarree())
                
                # Place bold text with a thick white halo outline
                text = ax.text(mx + 0.3, my + 0.3, label_text, color='black', weight='bold',
                               fontsize=9, ha='left', va='bottom', transform=ccrs.PlateCarree(),
                               zorder=10)
                text.set_path_effects([path_effects.withStroke(linewidth=3, foreground='white')])

    # 5. Live ATCF Marker (replaces old Genesis Marker)
    if atcf_pos is not None and use_live_atcf:
        atcf_lat, atcf_lon = atcf_pos
        # Plot a black circle for the live current ATCF position
        ax.plot(atcf_lon, atcf_lat, 'o', color='black', markersize=10, markeredgecolor='white', markeredgewidth=1.5, zorder=10, transform=ccrs.PlateCarree())
    elif len(df_mean) >= 1:
        # Fallback if no ATCF position available or live position too far: use ensemble mean first point
        gen_lon = df_mean.iloc[0]['lon']
        gen_lat = df_mean.iloc[0]['lat']
        ax.plot(gen_lon, gen_lat, 'o', color='black', markersize=10, markeredgecolor='white', markeredgewidth=1.5, zorder=9, transform=ccrs.PlateCarree())
    elif not deterministic_data.empty:
        # Fallback for non-ensemble models: use deterministic track's first point
        det_first = deterministic_data.sort_values('lead_time_hours').dropna(subset=['lat', 'lon']).iloc[0]
        gen_lon = det_first['lon']
        gen_lat = det_first['lat']
        ax.plot(gen_lon, gen_lat, 'o', color='black', markersize=10, markeredgecolor='white', markeredgewidth=1.5, zorder=9, transform=ccrs.PlateCarree())


    # Set precalculated map boundaries
    ax.set_extent([lon_min, lon_max, lat_min, lat_max], crs=ccrs.PlateCarree())

    # Add Colorbar for Scale
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
    sm.set_array([])
    cax = fig.add_axes([0.88, 0.15, 0.025, 0.66]) # Placed on the right margin
    cbar = fig.colorbar(sm, cax=cax, orientation='vertical')
    if color_by == 'pressure':
        cbar.set_label('Min. MSLP (hPa)', fontsize=11, weight='bold', color='#1e293b', labelpad=8)
    else:
        cbar.set_label('Wind Speed (km/h)', fontsize=11, weight='bold', color='#1e293b', labelpad=8)
    cbar.ax.tick_params(labelsize=9, colors='#1e293b')

    # Add Plot Headers
    # Top-Left lines
    if color_by == 'pressure':
        fig.text(0.08, 0.94, f"{storm_name} – {model_name} Tracks and Min. MSLP (hPa)", fontsize=13, weight='bold', color='black', ha='left', va='bottom')
    else:
        fig.text(0.08, 0.94, f"{storm_name} – {model_name} Tracks and Wind Speed (km/h)", fontsize=13, weight='bold', color='black', ha='left', va='bottom')
    fig.text(0.08, 0.90, f"Initialized at {init_time_str}", fontsize=11, color='#475569', ha='left', va='bottom')
    
    # Top-Right source label
    fig.text(0.86, 0.94, f"Philippine Typhoon/Weather", fontsize=11, weight='bold', color='black', ha='right', va='bottom')
    fig.text(0.86, 0.90, f"Data: {model_name} {'Ensemble' if has_ensemble_tracks else 'Deterministic'}", fontsize=10, color='#475569', ha='right', va='bottom')

    # Save output publication image
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    plt.savefig(output_path, dpi=300, facecolor='white', edgecolor='none')
    plt.close()
    
    print(f"Publication-quality spaghetti plot saved to: {output_path}")
    print(f"Stats: {plotted_members} tracks plotted, {ignored_members} incomplete members ignored.")

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
                # Fall back to the cluster's earliest available lead time
                closest_lead = group_df['lead_time_hours'].min()
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
        possible_files = [
            'aifs_tc_latest.dat', 'aifs_tc_latest.csv',
            'ifs_tc_latest.dat', 'ifs_tc_latest.csv',
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
        wp_df = filter_western_pacific(normalized_df)
        
        if wp_df.empty:
            print(f"No Western Pacific tracks found in: {f_path}")
            continue
            
        # Filter tracks to only those near active storms (prevents chaining effect of separate storms)
        if knack_storms:
            wp_df = filter_tracks_near_active_storms(wp_df, knack_storms, max_dist_deg=6.0)
            if wp_df.empty:
                print(f"No tracks near active Knack storms found in: {f_path}")
                continue
                
        model = detect_model_name(f_path)
        
        # Load corresponding paired file if available (only for GDM FNV3)
        df_paired = pd.DataFrame()
        if 'fnv3' in f_path.lower():
            if 'fnv3p2_latest.dat' in f_path:
                paired_path = f_path.replace('fnv3p2_latest.dat', 'fnv3p2_paired_latest.dat')
            elif 'fnv3p2_latest.csv' in f_path:
                paired_path = f_path.replace('fnv3p2_latest.csv', 'fnv3p2_paired_latest.csv')
            else:
                base = os.path.basename(f_path)
                dir_name = os.path.dirname(f_path)
                paired_base = base.replace('fnv3p2', 'fnv3p2_paired')
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
            
            plot_model_tracks(wp_df, model, sg_id, out_file, storm_name_override=args.storm_name, color_by=args.color_by, atcf_pos=atcf_pos, df_paired=df_paired)
            latest_plotted_init[out_file] = current_init_dt
            
            # Also save copies for 92W format and legacy filename format
            import shutil
            alt_filename = f"{num_w_id}_{ymd}_{cycle_str}_{model_clean}.png"
            if alt_filename != primary_filename:
                shutil.copyfile(out_file, os.path.join(args.output_dir, alt_filename))
                
            legacy_filename = f"{wp_id.lower()}_{model_clean}_spaghetti.png"
            shutil.copyfile(out_file, os.path.join(args.output_dir, legacy_filename))
            
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
                    entry['alt_filename'] = alt_filename
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
                    'timestamp': datetime.now(timezone.utc).isoformat()
                })
                
            os.makedirs(os.path.dirname(manifest_file), exist_ok=True)
            with open(manifest_file, 'w', encoding='utf-8') as mf:
                json.dump(manifest_data, mf, indent=2)

if __name__ == '__main__':
    main()

