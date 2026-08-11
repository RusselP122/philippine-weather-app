import os
import sys
sys.setrecursionlimit(20000)
import json
from shapely.geometry import shape
import io
import json
import base64
import argparse
import gc
import urllib.request
import math
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.gridspec as gridspec
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from datetime import datetime, timezone, timedelta

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2.0)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0)**2
    return R * 2.0 * math.asin(math.sqrt(a))

def calculate_bearing(lat1, lon1, lat2, lon2):
    lat1_rad = math.radians(lat1)
    lon1_rad = math.radians(lon1)
    lat2_rad = math.radians(lat2)
    lon2_rad = math.radians(lon2)
    dlon = lon2_rad - lon1_rad
    y = math.sin(dlon) * math.cos(lat2_rad)
    x = math.cos(lat1_rad) * math.sin(lat2_rad) - math.sin(lat1_rad) * math.cos(lat2_rad) * math.cos(dlon)
    bearing = math.degrees(math.atan2(y, x))
    return (bearing + 360) % 360

def bearing_to_compass(bearing):
    dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    ix = int((bearing + 11.25) / 22.5)
    return dirs[ix % 16]

def decode_obfuscated_data(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read().strip()
    encrypted_bytes = base64.b64decode(content)
    decrypted_bytes = bytes([b ^ 0xAA for b in encrypted_bytes])
    return decrypted_bytes.decode('utf-8')

def decode_obfuscated_url(url):
    """Fetch an obfuscated data file from a URL and decode it."""
    req = urllib.request.Request(url, headers={'User-Agent': 'TrendsMapGenerator/1.0'})
    with urllib.request.urlopen(req, timeout=30) as response:
        content = response.read().decode('utf-8').strip()
    encrypted_bytes = base64.b64decode(content)
    decrypted_bytes = bytes([b ^ 0xAA for b in encrypted_bytes])
    return decrypted_bytes.decode('utf-8')

def parse_lead_time(row):
    if 'lead_time_hours' in row and not pd.isna(row['lead_time_hours']):
        return float(row['lead_time_hours'])
    if 'lead_time' in row and not pd.isna(row['lead_time']):
        val = str(row['lead_time'])
        import re
        m = re.match(r'(?:(\d+)\s+days\s+)?(\d+):(\d+):(\d+)', val)
        if m:
            days = int(m.group(1)) if m.group(1) else 0
            hours = int(m.group(2))
            return days * 24 + hours
    return np.nan

def mean_geo_center(points):
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

def stitch_member_tracks(member_rows):
    by_hour = {}
    for row in member_rows:
        h = row['h']
        if h not in by_hour:
            by_hour[h] = []
        by_hour[h].append(row)
        
    hours = sorted(by_hour.keys())
    if not hours:
        return []
        
    closed_tracks = []
    active_tracks = []
    
    for h in hours:
        # Close stale tracks whose last point is >24h behind current hour
        still_active = []
        for track in active_tracks:
            last_pt = track[-1]
            if h - last_pt['h'] > 24:
                closed_tracks.append(track)
            else:
                still_active.append(track)
        active_tracks = still_active

        candidates = by_hour[h]
        matches = []
        
        for t_idx, track in enumerate(active_tracks):
            last_pt = track[-1]
            dt = h - last_pt['h']
            
            guess_lat = last_pt['lat']
            guess_lon = last_pt['lon']
            
            if len(track) >= 2:
                prev_pt = track[-2]
                prev_dt = last_pt['h'] - prev_pt['h']
                if prev_dt > 0:
                    v_lat = (last_pt['lat'] - prev_pt['lat']) / prev_dt
                    d_lon = last_pt['lon'] - prev_pt['lon']
                    if d_lon > 180:
                        d_lon -= 360
                    if d_lon < -180:
                        d_lon += 360
                    v_lon = d_lon / prev_dt
                    
                    guess_lat = last_pt['lat'] + v_lat * dt
                    guess_lon = last_pt['lon'] + v_lon * dt
                    if guess_lon > 180:
                        guess_lon -= 360
                    if guess_lon < -180:
                        guess_lon += 360
                    guess_lat = max(-90.0, min(90.0, guess_lat))
                    
            max_dist_km = min(800.0, max(400.0, 100.0 * dt))
            
            for c_idx, cand in enumerate(candidates):
                dist_km = haversine_km(guess_lat, guess_lon, cand['lat'], cand['lon'])
                if dist_km <= max_dist_km:
                    dp = 0.0 if (np.isnan(last_pt['p']) or np.isnan(cand['p'])) else abs(last_pt['p'] - cand['p'])
                    score = dist_km / 100.0 + dp
                    matches.append({'t_idx': t_idx, 'c_idx': c_idx, 'score': score, 'dist': dist_km})
                    
        matches.sort(key=lambda x: x['score'])
        matched_tracks = set()
        matched_candidates = set()
        new_active_tracks = []
        
        for m in matches:
            if m['t_idx'] not in matched_tracks and m['c_idx'] not in matched_candidates:
                matched_tracks.add(m['t_idx'])
                matched_candidates.add(m['c_idx'])
                track = active_tracks[m['t_idx']]
                track.append(candidates[m['c_idx']])
                new_active_tracks.append(track)
                
        for t_idx, track in enumerate(active_tracks):
            if t_idx not in matched_tracks:
                last_pt = track[-1]
                if h - last_pt['h'] <= 24:
                    new_active_tracks.append(track)
                else:
                    closed_tracks.append(track)
                    
        for c_idx, cand in enumerate(candidates):
            if c_idx not in matched_candidates:
                new_active_tracks.append([cand])
                
        active_tracks = new_active_tracks
        
    for track in active_tracks:
        closed_tracks.append(track)
        
    return [t for t in closed_tracks if len(t) >= 2]

def get_track_distance(track_a, track_b):
    points_a = {p['h']: p for p in track_a}
    sum_dist = 0.0
    count = 0
    for p_b in track_b:
        p_a = points_a.get(p_b['h'])
        if p_a:
            sum_dist += haversine_km(p_a['lat'], p_a['lon'], p_b['lat'], p_b['lon'])
            count += 1
    return 5000.0 if count == 0 else sum_dist / count

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
    
    def condense(node_id, parent_cluster_id):
        nonlocal next_cluster_id
        node = nodes[node_id]
        if node['left'] is None and node['right'] is None:
            return
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
            condense(left['id'], left_cluster_id)
            condense(right['id'], right_cluster_id)
        elif left_count >= min_cluster_size:
            condense(left['id'], parent_cluster_id)
        elif right_count >= min_cluster_size:
            condense(right['id'], parent_cluster_id)
            
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
    condense(root_node_id, root_cluster_id)
    
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
            queue = list(children)
            while queue:
                qnode = queue.pop(0)
                qnode['selected'] = False
                queue.extend([n for n in condensed_nodes.values() if n['parent'] == qnode['id']])
                
    labels = [-1] * n
    for cid, cnode in condensed_nodes.items():
        if cnode['selected']:
            lbl = cid if cid != 0 else 1
            for pt in cnode['points']:
                labels[pt] = lbl
                
    return labels

def split_cluster_kmedoids(track_indices, distance_matrix, limit):
    if len(track_indices) <= limit:
        return [track_indices]
        
    n = len(track_indices)
    m1 = track_indices[0]
    m2 = track_indices[0]
    max_dist = -1.0
    for i in range(n):
        for j in range(i + 1, n):
            d = distance_matrix[track_indices[i]][track_indices[j]]
            if d > max_dist:
                max_dist = d
                m1 = track_indices[i]
                m2 = track_indices[j]
                
    if max_dist <= 0:
        mid = n // 2
        part1 = track_indices[:mid]
        part2 = track_indices[mid:]
        return (split_cluster_kmedoids(part1, distance_matrix, limit) + 
                split_cluster_kmedoids(part2, distance_matrix, limit))
                
    cluster1 = []
    cluster2 = []
    
    for iter_idx in range(10):
        cluster1 = []
        cluster2 = []
        for idx in track_indices:
            d1 = distance_matrix[idx][m1]
            d2 = distance_matrix[idx][m2]
            if d1 <= d2:
                cluster1.append(idx)
            else:
                cluster2.append(idx)
                
        if len(cluster1) == 0 or len(cluster2) == 0:
            break
            
        best_m1 = m1
        min_dist_sum1 = float('inf')
        for candidate in cluster1:
            sum_dist = sum(distance_matrix[candidate][other] for other in cluster1)
            if sum_dist < min_dist_sum1:
                min_dist_sum1 = sum_dist
                best_m1 = candidate
                
        best_m2 = m2
        min_dist_sum2 = float('inf')
        for candidate in cluster2:
            sum_dist = sum(distance_matrix[candidate][other] for other in cluster2)
            if sum_dist < min_dist_sum2:
                min_dist_sum2 = sum_dist
                best_m2 = candidate
                
        if best_m1 == m1 and best_m2 == m2:
            break
        m1 = best_m1
        m2 = best_m2
        
    if len(cluster1) == 0 or len(cluster2) == 0 or len(cluster1) == n or len(cluster2) == n:
        mid = n // 2
        cluster1 = track_indices[:mid]
        cluster2 = track_indices[mid:]
        
    return (split_cluster_kmedoids(cluster1, distance_matrix, limit) + 
            split_cluster_kmedoids(cluster2, distance_matrix, limit))

def group_and_cluster_tracks(basin_filtered, num_members, dataset_name):
    if len(basin_filtered) == 0:
        return {'clusters': [], 'track_labels': []}
        
    n = len(basin_filtered)
    distance_matrix = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i, n):
            if i == j:
                distance_matrix[i][j] = 0.0
            else:
                dist = get_track_distance(basin_filtered[i], basin_filtered[j])
                distance_matrix[i][j] = dist
                distance_matrix[j][i] = dist
                
    min_cluster_size = max(4, int(round(num_members * (0.03 if num_members > 100 else 0.08))))
    labels = run_hdbscan(distance_matrix, min_cluster_size)
    
    clusters_by_label = {}
    for i in range(n):
        label = labels[i]
        if label == -1:
            continue
        if label not in clusters_by_label:
            clusters_by_label[label] = []
        clusters_by_label[label].append(i)
        
    def get_dataset_limit(ds_name):
        if not ds_name:
            return 50
        ds = ds_name.lower()
        if ds == "large":
            return 1000
        if ds == "aigefs":
            return 31
        if ds in ("ifs", "aifs"):
            return 51
        if ds == "base":
            return 50
        return 50
        
    limit = get_dataset_limit(dataset_name)
    
    final_groups = []
    for label, track_indices in clusters_by_label.items():
        if len(track_indices) > limit:
            split_groups = split_cluster_kmedoids(track_indices, distance_matrix, limit)
            final_groups.extend(split_groups)
        else:
            final_groups.append(track_indices)
            
    clusters = []
    next_dist_id = 1
    for track_indices in final_groups:
        cluster_tracks = [basin_filtered[idx] for idx in track_indices]
        origins = [t[0] for t in cluster_tracks]
        min_h = min(o['h'] for o in origins)
        max_h = max(o['h'] for o in origins)
        center = mean_geo_center(origins)
        clusters.append({
            'distId': next_dist_id,
            'origins': origins,
            'minH': min_h,
            'maxH': max_h,
            'center': center,
            'trackIndices': track_indices
        })
        next_dist_id += 1
        
    track_labels = [None] * n
    for c in clusters:
        for idx in c['trackIndices']:
            track_labels[idx] = c['distId']
            
    return {'clusters': clusters, 'track_labels': track_labels}

def get_pressure_color(pressure):
    if np.isnan(pressure):
        return None
    if pressure < 920:
        return '#FF007F'  # Super Typhoon
    elif 920 <= pressure <= 945:
        return '#A83232'  # Typhoon
    elif 945 < pressure <= 970:
        return '#E67E22'  # Severe Tropical Storm
    elif 970 < pressure <= 990:
        return '#F1C40F'  # Tropical Storm
    elif 990 < pressure <= 1005:
        return '#2ECC71'  # Tropical Depression
    else:
        return '#3498DB'  # Low Pressure Area

def get_pagasa_wind_color(wind_kmh):
    if np.isnan(wind_kmh):
        return None
    if wind_kmh >= 185:
        return '#FF007F'  # Super Typhoon
    elif 118 <= wind_kmh < 185:
        return '#A83232'  # Typhoon
    elif 89 <= wind_kmh < 118:
        return '#E67E22'  # Severe Tropical Storm
    elif 62 <= wind_kmh < 89:
        return '#F1C40F'  # Tropical Storm
    elif 39 <= wind_kmh < 62:
        return '#2ECC71'  # Tropical Depression
    else:
        return '#3498DB'  # Low Pressure Area

def parse_cycle_stats(csv_text, paired_csv_text, dataset_name, max_hours=360):
    f_in = io.StringIO(csv_text)
    df = pd.read_csv(f_in, comment='#')
    df.columns = df.columns.str.strip()
    
    if 'lead_time_hours' not in df.columns:
        df['lead_time_hours'] = df.apply(parse_lead_time, axis=1)
        
    raw_rows = df[df['lead_time_hours'].notna() & df['lat'].notna()]
    member_groups = {}
    for row in raw_rows.to_dict('records'):
        lead_h = float(row['lead_time_hours'])
        if lead_h > max_hours:
            continue
        lat = float(row['lat'])
        lon = float(row['lon'])
        pres = float(row['minimum_sea_level_pressure_hpa'])
        wind_kt = float(row['maximum_sustained_wind_speed_knots'])
        wind_kmh = np.nan if np.isnan(wind_kt) else round(wind_kt * 1.852)
        if np.isnan(lat) or np.isnan(lon):
            continue
        llon = lon - 360.0 if lon > 180.0 else lon
        init_time = row.get('init_time', 'latest')
        sample = row.get('sample', 'default')
        sample_key = str(sample)
        
        if sample_key not in member_groups:
            member_groups[sample_key] = []
        member_groups[sample_key].append({
            'lat': lat,
            'lon': llon,
            'p': pres,
            'windKmh': wind_kmh,
            'h': lead_h,
            'initTime': init_time,
            'sample': sample,
            'track_id': str(row.get('track_id', ''))
        })

    stitched_tracks = []
    for sample_key, member_rows in member_groups.items():
        member_tracks = stitch_member_tracks(member_rows)
        stitched_tracks.extend(member_tracks)

    # Basin filtering: 100 to 180 E, -5 to 45 N (align with React wpac basin)
    basin_filtered = []
    for points in stitched_tracks:
        if not points:
            continue
        origin = next((p for p in points if p['h'] == 0), points[0])
        if 100 <= origin['lon'] <= 180 and -5 <= origin['lat'] <= 45:
            basin_filtered.append(points)

    num_members = len(set(str(r.get('sample', 'default')) for r in raw_rows.to_dict('records')))
    if num_members == 0:
        num_members = 50

    res = group_and_cluster_tracks(basin_filtered, num_members, dataset_name)
    clusters = res['clusters']
    track_labels = res['track_labels']

    tracks_by_dist = {}
    for idx, track in enumerate(basin_filtered):
        dist_id = track_labels[idx]
        if dist_id is not None:
            if dist_id not in tracks_by_dist:
                tracks_by_dist[dist_id] = []
            tracks_by_dist[dist_id].append(track)

    paired_mean_by_track_id = {}
    if paired_csv_text and paired_csv_text.strip():
        try:
            pf_in = io.StringIO(paired_csv_text)
            pdf = pd.read_csv(pf_in, comment='#')
            if not pdf.empty:
                pdf.columns = pdf.columns.str.strip()
                if 'lead_time_hours' not in pdf.columns:
                    pdf['lead_time_hours'] = pdf.apply(parse_lead_time, axis=1)
                    
                for row in pdf.to_dict('records'):
                    track_id = str(row.get('track_id', '')).strip()
                    sample_val = str(row.get('sample', '')).strip()
                    if sample_val != "-1" or not track_id.upper().startswith("WP"):
                        continue
                    lead_h = float(row['lead_time_hours'])
                    if lead_h > max_hours:
                        continue
                    lat = float(row['lat'])
                    lon = float(row['lon'])
                    pres = float(row['minimum_sea_level_pressure_hpa'])
                    wind_kt = float(row['maximum_sustained_wind_speed_knots'])
                    wind_kmh = np.nan if np.isnan(wind_kt) else round(wind_kt * 1.852)
                    if np.isnan(lat) or np.isnan(lon):
                        continue
                    
                    if track_id not in paired_mean_by_track_id:
                        paired_mean_by_track_id[track_id] = {'points': [], 'trackId': track_id}
                    paired_mean_by_track_id[track_id]['points'].append({'lat': lat, 'lon': lon - 360 if lon > 180 else lon, 'p': pres, 'windKmh': wind_kmh, 'h': lead_h})
                    
                for key in paired_mean_by_track_id:
                    paired_mean_by_track_id[key]['points'].sort(key=lambda p: p['h'])
        except Exception as e:
            print(f"Warning: Failed to parse paired CSV: {e}")

    disturbance_list = []
    for cluster in clusters:
        dist_tracks = tracks_by_dist.get(cluster['distId'], [])
        all_max_w = []
        for pts in dist_tracks:
            winds = [p['windKmh'] for p in pts if not np.isnan(p['windKmh'])]
            all_max_w.append(max(winds) if winds else 0)
        peak_w = max(all_max_w) if all_max_w else 0
        
        disturbance_list.append({
            'id': cluster['distId'],
            'lat': cluster['center']['lat'],
            'lon': cluster['center']['lon'],
            'trackCount': len(dist_tracks),
            'peakW': peak_w,
            'pairedTrackName': None,
            'agreement': 0,
            'meanPoints': None,
            'minH': cluster['minH']
        })

    # Sort & Renumber deterministically (ascending by minH, then descending by trackCount, then lat, then lon)
    disturbance_list.sort(key=lambda d: (d['minH'], -d['trackCount'], -d['lat'], -d['lon']))
    old_to_new = {}
    for idx, d in enumerate(disturbance_list):
        new_id = idx + 1
        old_to_new[d['id']] = new_id
        d['id'] = new_id

    updated_tracks_by_dist = {}
    for old_id, trks in tracks_by_dist.items():
        new_id = old_to_new.get(old_id, old_id)
        updated_tracks_by_dist[new_id] = trks

    paired_assignment = {}
    used_paired = set()
    used_dist = set()
    candidates = []
    for t_id, paired in paired_mean_by_track_id.items():
        if len(paired['points']) < 2:
            continue
        p_origin = paired['points'][0]
        for dist in disturbance_list:
            tracks = updated_tracks_by_dist.get(dist['id'], [])
            if len(tracks) < 2:
                continue
            d_km = haversine_km(dist['lat'], dist['lon'], p_origin['lat'], p_origin['lon'])
            if d_km < 500:
                candidates.append({'tId': t_id, 'paired': paired, 'dist': dist, 'dKm': d_km})
                
    candidates.sort(key=lambda c: c['dKm'])
    for c in candidates:
        if c['tId'] in used_paired or c['dist']['id'] in used_dist:
            continue
        used_paired.add(c['tId'])
        used_dist.add(c['dist']['id'])
        import re
        num_match = re.match(r'^([A-Za-z]{2})(\d{2})', c['tId'])
        if num_match:
            track_name = f"{num_match.group(2)}{num_match.group(1)[0].upper()}"
        else:
            track_name = c['tId']
        paired_assignment[c['dist']['id']] = {
            'paired': c['paired'],
            'trackName': track_name
        }

    for dist in disturbance_list:
        tracks = updated_tracks_by_dist.get(dist['id'], [])
        min_required = 100 if dataset_name == "large" else 25
        if len(tracks) < min_required:
            continue
            
        # Calculate genesis hour for estimated genesis time
        genesis_hours = []
        for track in tracks:
            valid_pts = [pt for pt in track if not np.isnan(pt['lat']) and not np.isnan(pt['lon'])]
            if valid_pts:
                sorted_pts = sorted(valid_pts, key=lambda pt: pt['h'])
                genesis_hours.append(sorted_pts[0]['h'])
        dist['genesis_h'] = np.median(genesis_hours) if genesis_hours else 0

        assignment = paired_assignment.get(dist['id'])
        matched_paired = None
        if assignment:
            matched_paired = assignment['paired']
            dist['pairedTrackName'] = assignment['trackName']
            
        by_hour = {}
        for t_idx, track in enumerate(tracks):
            for pt in track:
                h = pt['h']
                if h not in by_hour:
                    by_hour[h] = {'lats': [], 'lons': [], 'ps': [], 'winds': [], 'track_indices': []}
                by_hour[h]['lats'].append(pt['lat'])
                by_hour[h]['lons'].append(pt['lon'])
                by_hour[h]['ps'].append(pt['p'])
                by_hour[h]['winds'].append(pt['windKmh'])
                by_hour[h]['track_indices'].append(t_idx)

        hours = sorted(by_hour.keys())
        mean_pts = []
        total_agreement = 0
        agreement_steps = 0
        
        for h in hours:
            d = by_hour[h]
            n = len(d['lats'])
            if n == 0:
                continue
            
            m_lat, m_lon, m_w, m_p = np.nan, np.nan, np.nan, np.nan
            if matched_paired:
                paired_pt = min(matched_paired['points'], key=lambda pt: abs(pt['h'] - h))
                if abs(paired_pt['h'] - h) <= 3:
                    m_lat = paired_pt['lat']
                    m_lon = paired_pt['lon']
                    m_w = paired_pt['windKmh']
                    m_p = paired_pt['p']
                else:
                    continue
            else:
                pts_at_hour = [{'lat': lat, 'lon': lon} for lat, lon in zip(d['lats'], d['lons'])]
                geo_mean = mean_geo_center(pts_at_hour)
                m_lat = geo_mean['lat']
                m_lon = geo_mean['lon']
                valid_winds = [w for w in d['winds'] if not np.isnan(w)]
                m_w = np.median(valid_winds) if valid_winds else np.nan
                valid_ps = [p for p in d['ps'] if not np.isnan(p)]
                m_p = np.median(valid_ps) if valid_ps else np.nan
                
            dists_km = [haversine_km(lat, lon, m_lat, m_lon) for lat, lon in zip(d['lats'], d['lons'])]
            inside = sum(1 for dist_val in dists_km if dist_val <= (2 * 111.32))
            total_agreement += inside / n
            agreement_steps += 1
            
            mean_pts.append({'lat': m_lat, 'lon': m_lon, 'windKmh': m_w, 'p': m_p, 'h': h})
            
        dist['agreement'] = round((total_agreement / agreement_steps) * 100) if agreement_steps > 0 else 0
        dist['meanPoints'] = mean_pts

        # Compute peak and ensemble mean wind statistics
        peak_winds = []
        for track in tracks:
            winds = [pt['windKmh'] for pt in track if not np.isnan(pt['windKmh'])]
            if winds:
                peak_winds.append(max(winds))
        min_w = min(peak_winds) if peak_winds else 0
        max_w = max(peak_winds) if peak_winds else 0
        median_w = np.median(peak_winds) if peak_winds else 0

        hourly_medians = []
        for h in hours:
            valid_winds = [w for w in by_hour[h]['winds'] if not np.isnan(w)]
            if valid_winds:
                hourly_medians.append(np.median(valid_winds))
        computed_mean_wind = max(hourly_medians) if hourly_medians else median_w

        dist['minWind'] = min_w
        dist['maxWind'] = max_w
        dist['computedMeanWind'] = computed_mean_wind

        # Calculate Rapid Intensification (RI) Probability by lead time
        intervals = list(range(24, int(max_hours) + 1, 24))
        ri_counts = {h: 0 for h in intervals}
        for track in tracks:
            valid_pts = sorted([pt for pt in track if not np.isnan(pt['windKmh']) and not np.isnan(pt['h'])], key=lambda pt: pt['h'])
            if len(valid_pts) < 2:
                continue
            for H in intervals:
                has_ri = False
                for i in range(len(valid_pts)):
                    p1 = valid_pts[i]
                    if p1['h'] > H:
                        break
                    for j in range(i + 1, len(valid_pts)):
                        p2 = valid_pts[j]
                        if p2['h'] > H:
                            break
                        if p2['h'] - p1['h'] <= 24:
                            if p2['windKmh'] - p1['windKmh'] >= 55:
                                has_ri = True
                                break
                    if has_ri:
                        break
                if has_ri:
                    ri_counts[H] += 1
                    
        total_tracks = len(tracks)
        dist['ri_probs'] = {h: round((ri_counts[h] / total_tracks) * 100) if total_tracks > 0 else 0 for h in intervals}

    # Set default values for any disturbances that did not get processed
    for dist in disturbance_list:
        if 'minWind' not in dist:
            dist['minWind'] = 0
            dist['maxWind'] = 0
            dist['computedMeanWind'] = 0
            dist['genesis_h'] = 0
            dist['ri_probs'] = {}

    return disturbance_list

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset', required=True, choices=['base', 'large'])
    parser.add_argument('--horizon', required=True, choices=['5day', '15day'])
    parser.add_argument('--is-wide', choices=['True', 'False'])
    parser.add_argument('--disturbance-id', type=int)
    parser.add_argument('--output')
    parser.add_argument('--lat', type=float, default=None)
    parser.add_argument('--lon', type=float, default=None)
    parser.add_argument('--all', action='store_true', help='Generate maps for all valid disturbances')
    args = parser.parse_args()
    
    if not args.all:
        if args.disturbance_id is None:
            parser.error("--disturbance-id is required when not using --all")
        if args.output is None:
            parser.error("--output is required when not using --all")
        if args.is_wide is None:
            parser.error("--is-wide is required when not using --all")
            
    dataset = args.dataset
    
    # Check for DATA_SOURCE_URL environment variable to fetch latest data from Vercel CDN
    # instead of reading from (potentially stale) local filesystem in the Docker container.
    # Falls back to local files for local development.
    data_source_url = os.environ.get('DATA_SOURCE_URL')
    
    project_root = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(project_root, "public", "data")
    
    if data_source_url:
        print(f"Fetching latest data from: {data_source_url}")
        manifest_url = f"{data_source_url.rstrip('/')}/data/cycles_manifest.json"
        req = urllib.request.Request(manifest_url, headers={'User-Agent': 'TrendsMapGenerator/1.0'})
        with urllib.request.urlopen(req, timeout=30) as response:
            manifest = json.loads(response.read().decode('utf-8'))
    else:
        manifest_path = os.path.join(data_dir, "cycles_manifest.json")
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)
        
    active_cycles = manifest['large'] if dataset == 'large' else manifest['base']
    if not active_cycles:
        raise ValueError("No active cycles in manifest")
        
    # Process all cycles
    parsed_cycles = []
    for c in active_cycles:
        if data_source_url:
            tracks_url = f"{data_source_url.rstrip('/')}/data/{c['tracks']}"
            paired_url = f"{data_source_url.rstrip('/')}/data/{c['paired']}" if c.get('paired') else None
            csv_text = decode_obfuscated_url(tracks_url)
            paired_csv_text = None
            if paired_url:
                try:
                    paired_csv_text = decode_obfuscated_url(paired_url)
                except Exception:
                    paired_csv_text = None
        else:
            tracks_path = os.path.join(data_dir, c['tracks'])
            paired_path = os.path.join(data_dir, c['paired']) if c.get('paired') else None
            csv_text = decode_obfuscated_data(tracks_path)
            paired_csv_text = decode_obfuscated_data(paired_path) if paired_path and os.path.exists(paired_path) else None
        
        # Max hours matches the frontend (5-day: 120h, 15-day: 312h)
        max_h = 120 if args.horizon == '5day' else 312
        disturbances = parse_cycle_stats(csv_text, paired_csv_text, dataset, max_h)
        parsed_cycles.append({
            'cycle_time': c['cycle'],
            'disturbances': disturbances
        })
        # Explicitly run garbage collection to free memory from large strings/dataframes/arrays
        gc.collect()
        
    # Load previous manifest context to propagate IDs and maintain persistence
    prev_manifest = {}
    manifest_key = f"{dataset}_{args.horizon}"
    manifest_path = os.path.join(data_dir, "trends", "manifest.json")
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, 'r', encoding='utf-8') as f:
                prev_manifest = json.load(f)
        except Exception as e:
            print(f"Warning: Failed to load previous manifest for ID tracking: {e}")

    prev_cycle_time = prev_manifest.get(f"{manifest_key}_cycle")
    prev_entries = prev_manifest.get(manifest_key, [])

    # Assign persistent IDs to latest cycle's disturbances
    latest_cycle = parsed_cycles[0]
    latest_paired_names = set(d.get('pairedTrackName') for d in latest_cycle['disturbances'] if d.get('pairedTrackName'))
    for selected_dist in latest_cycle['disturbances']:
        # Trace this disturbance backwards through all cycles to build its history chain
        chain_dists = [selected_dist]
        current_center = {'lat': selected_dist['lat'], 'lon': selected_dist['lon']}
        current_paired = selected_dist.get('pairedTrackName')
        
        for i in range(1, len(parsed_cycles)):
            cycle = parsed_cycles[i]
            match = None
            if current_paired:
                match = next((d for d in cycle['disturbances'] if d.get('pairedTrackName') == current_paired), None)
            if not match:
                best_dist = float('inf')
                for d in cycle['disturbances']:
                    # Prevent matching a past storm that is already owned by a different active system
                    p_name = d.get('pairedTrackName')
                    if p_name and p_name in latest_paired_names and p_name != current_paired:
                        continue
                    d_km = haversine_km(current_center['lat'], current_center['lon'], d['lat'], d['lon'])
                    if d_km < 450 and d_km < best_dist:
                        best_dist = d_km
                        match = d
            if match:
                chain_dists.append(match)
                current_center = {'lat': match['lat'], 'lon': match['lon']}
                if match.get('pairedTrackName'):
                    current_paired = match['pairedTrackName']
            else:
                break
                
        # Now find the most authoritative name in this chain
        best_tc_name = None
        best_invest_name = None
        for d in chain_dists:
            paired_name = d.get('pairedTrackName')
            if paired_name:
                import re
                m_num = re.search(r'(\d+)', paired_name)
                if m_num and int(m_num.group(1)) >= 90:
                    best_invest_name = paired_name
                else:
                    best_tc_name = paired_name
                    
        # Assign persistent ID and name to this disturbance in the latest cycle
        if best_tc_name:
            persistent_id = best_tc_name
            persistent_name = f"TC {best_tc_name}"
        elif best_invest_name:
            persistent_id = best_invest_name
            persistent_name = f"Invest {best_invest_name}"
        else:
            # Entirely unpaired chain. Let's find the oldest cycle in the chain where it was detected
            oldest_match = chain_dists[-1]
            oldest_cycle_idx = len(chain_dists) - 1
            oldest_cycle_time = parsed_cycles[oldest_cycle_idx]['cycle_time']
            
            # Try to lookup in previous manifest using its local ID if cycle time matches
            looked_up = False
            if oldest_cycle_time == prev_cycle_time and prev_entries:
                prev_entry = next((e for e in prev_entries if str(e.get('local_id')) == str(oldest_match['id'])), None)
                if prev_entry:
                    persistent_id = prev_entry['id']
                    persistent_name = prev_entry.get('name', f"Disturbance {selected_dist['id']}")
                    looked_up = True
            
            if not looked_up:
                # Format detection timestamp
                import re
                dt_match = re.search(r'(\d{4})-(\d{2})-(\d{2})\s+(\d{2})', oldest_cycle_time)
                if dt_match:
                    time_id_part = f"{dt_match.group(1)}{dt_match.group(2)}{dt_match.group(3)}_{dt_match.group(4)}"
                else:
                    time_id_part = oldest_cycle_time.replace(" ", "_").replace(":", "")
                persistent_id = f"dist_{time_id_part}_{oldest_match['id']}"
                persistent_name = f"Disturbance {selected_dist['id']}"
                
        # Write persistent_id and persistent_name to all matched disturbances in the chain
        # so they all have access to it
        for d in chain_dists:
            d['persistent_id'] = persistent_id
            d['persistent_name'] = persistent_name

    # Match Selected Disturbance across cycles
    latest_cycle = parsed_cycles[0]
    
    # Identify targets
    targets = []
    valid_dists = []
    if args.all:
        valid_dists = [d for d in latest_cycle['disturbances'] if d.get('meanPoints') is not None]
        for dist in valid_dists:
            targets.append((dist, True))  # (disturbance, is_wide=True)
            targets.append((dist, False)) # (disturbance, is_wide=False)
        print(f"Generating trend maps for {len(valid_dists)} disturbances in --all mode.")
    else:
        selected_dist = None
        if args.lat is not None and args.lon is not None:
            best_d = float('inf')
            for d in latest_cycle['disturbances']:
                d_km = haversine_km(args.lat, args.lon, d['lat'], d['lon'])
                if d_km < 450 and d_km < best_d:
                    best_d = d_km
                    selected_dist = d
                    
        if not selected_dist:
            selected_dist = next((d for d in latest_cycle['disturbances'] if d['id'] == args.disturbance_id), None)
            
        if not selected_dist:
            raise ValueError(f"Selected disturbance not found in latest cycle")
            
        targets.append((selected_dist, args.is_wide == 'True'))

    for selected_dist, is_wide in targets:
        chain = []
        current_center = {'lat': selected_dist['lat'], 'lon': selected_dist['lon']}
        current_paired = selected_dist.get('pairedTrackName')
        
        for i, cycle in enumerate(parsed_cycles):
            match = None
            if current_paired:
                match = next((d for d in cycle['disturbances'] if d.get('pairedTrackName') == current_paired), None)
            if not match:
                best_dist = float('inf')
                for d in cycle['disturbances']:
                    # Prevent matching a past storm that is already owned by a different active system
                    p_name = d.get('pairedTrackName')
                    if p_name and p_name in latest_paired_names and p_name != current_paired:
                        continue
                    d_km = haversine_km(current_center['lat'], current_center['lon'], d['lat'], d['lon'])
                    if d_km < 450 and d_km < best_dist:
                        best_dist = d_km
                        match = d
            if match:
                chain.append({
                    'cycle_index': i,
                    'cycle_time': cycle['cycle_time'],
                    'disturbance': match
                })
                current_center = {'lat': match['lat'], 'lon': match['lon']}
                if match.get('pairedTrackName'):
                    current_paired = match['pairedTrackName']
            else:
                chain.append({
                    'cycle_index': i,
                    'cycle_time': cycle['cycle_time'],
                    'disturbance': None
                })
    
        # Detect if the disturbance is already an active TC in the latest cycle
        is_latest_tc = False
        latest_item = chain[0] if chain else None
        if latest_item and latest_item['disturbance']:
            dist = latest_item['disturbance']
            paired_name = dist.get('pairedTrackName')
            if paired_name:
                import re
                m_num = re.search(r'(\d+)', paired_name)
                if m_num:
                    num_val = int(m_num.group(1))
                    if num_val < 90:
                        is_latest_tc = True
        
        # Prepare Recharts-like chart data
        total_members = 1000 if dataset == 'large' else 50
        chart_data = []
        
        for item in reversed(chain):
            label = item['cycle_time']
            import re
            m = re.match(r'(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):00', label)
            if m:
                label = f"{m.group(2)}/{m.group(3)} {m.group(4)}Z"
                
            dist = item['disturbance']
            if not dist:
                chart_data.append({
                    'name': label,
                    'probability': 0,
                    'memberCount': 0,
                    'totalMembers': total_members,
                    'minWind': 0,
                    'maxWind': 0,
                    'computedMeanWind': 0,
                    'pairedWind': 0,
                    'detected': False,
                    'genesis_time': 'N/A',
                    'forecast_bearing': np.nan,
                    'compass_dir': 'N/A'
                })
                continue
                
            prob = min(100, round((dist['trackCount'] / total_members) * 100))
            min_w = dist.get('minWind', 0)
            max_w = dist.get('maxWind', 0)
            computed_mean_wind = dist.get('computedMeanWind', 0)
            
            paired_wind = 0
            if dist.get('pairedTrackName') and dist.get('meanPoints'):
                winds = [pt['windKmh'] for pt in dist['meanPoints'] if not np.isnan(pt['windKmh'])]
                if winds:
                    paired_wind = max(winds)
                    
            genesis_time_str = 'N/A'
            if dist.get('meanPoints') is not None:
                try:
                    clean_time = item['cycle_time'].replace('T', ' ').strip()
                    if len(clean_time) > 16:
                        clean_time = clean_time[:16]
                    base_dt = datetime.strptime(clean_time, '%Y-%m-%d %H:%M')
                    gen_hours = dist.get('genesis_h', 0)
                    
                    gen_dt = base_dt + timedelta(hours=gen_hours)
                    ph_dt = gen_dt + timedelta(hours=8)
                    genesis_time_str = ph_dt.strftime('%b %d %I:%M %p')
                except Exception as e:
                    print(f"Error parsing genesis time: {e}")
                    genesis_time_str = 'N/A'
            
            forecast_bearing = np.nan
            compass_dir = "N/A"
            if dist.get('meanPoints') and len(dist['meanPoints']) >= 2:
                pts = dist['meanPoints']
                start_pt = pts[0]
                target_pt = pts[-1]
                bearing_val = calculate_bearing(start_pt['lat'], start_pt['lon'], target_pt['lat'], target_pt['lon'])
                forecast_bearing = bearing_val
                compass_dir = bearing_to_compass(bearing_val)
    
            chart_data.append({
                'name': label,
                'probability': prob,
                'memberCount': dist['trackCount'],
                'totalMembers': total_members,
                'minWind': min_w,
                'maxWind': max_w,
                'computedMeanWind': computed_mean_wind,
                'pairedWind': paired_wind,
                'detected': dist.get('meanPoints') is not None,
                'genesis_time': genesis_time_str,
                'forecast_bearing': forecast_bearing,
                'compass_dir': compass_dir
            })
            
        fig = plt.figure(figsize=(18, 10))
        gs = gridspec.GridSpec(2, 3, figure=fig, width_ratios=[1.2, 1.2, 1.0])
        
        if is_wide:
            projection = ccrs.PlateCarree(central_longitude=180)
            ax_map = fig.add_subplot(gs[:, 0:2], projection=projection)
            ax_map.set_extent([-75, 10, 0, 40], crs=projection)
        else:
            projection = ccrs.PlateCarree()
            ax_map = fig.add_subplot(gs[:, 0:2], projection=projection)
            ax_map.set_extent([105, 155, 0, 40], crs=projection)
            
        ax_map.set_facecolor('#87CEEB')
        ax_map.add_feature(cfeature.LAND, facecolor='#DEB887', edgecolor='#8B4513', linewidth=0.8)
        ax_map.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.8, alpha=0.7, color='#654321')
        
        try:
            script_dir_path = os.path.dirname(os.path.abspath(__file__))
            geojson_paths_list = [
                os.path.join(script_dir_path, "public", "data", "ph_provinces.json"),
                os.path.join(os.getcwd(), "public", "data", "ph_provinces.json"),
                "public/data/ph_provinces.json"
            ]
            found_geojson_path = None
            for p_path in geojson_paths_list:
                if os.path.exists(p_path):
                    found_geojson_path = p_path
                    break
            if found_geojson_path:
                with open(found_geojson_path, 'r', encoding='utf-8') as geojson_file_handle:
                    geojson_content_dict = json.load(geojson_file_handle)
                province_shapely_geometries = [shape(prov_feat['geometry']) for prov_feat in geojson_content_dict['features']]
                ax_map.add_geometries(province_shapely_geometries, crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#654321', linewidth=0.4, alpha=0.5, zorder=3)
        except Exception as province_load_error:
            print(f"Warning: Failed to overlay province boundaries: {province_load_error}")
            
        gl = ax_map.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
        gl.ylocator = plt.FixedLocator(np.arange(0, 41, 5))
        gl.xlabel_style = {'size': 10, 'weight': 'bold'}
        gl.ylabel_style = {'size': 10, 'weight': 'bold'}
        gl.top_labels = False
        gl.right_labels = False
        
        if is_wide:
            gl.xlocator = plt.FixedLocator(list(range(110, 181, 10)) + [-170])
            ax_map.text(118 - 180, 13, 'West Philippine\nSea', fontsize=5, color='navy', weight='bold',
                        transform=projection, ha='center', va='center', style='italic', alpha=0.5)
            ax_map.text(130 - 180, 20, 'Philippine\nSea', fontsize=9, color='navy', weight='bold',
                        transform=projection, ha='center', va='center', style='italic', alpha=0.5)
            par_vertices = [
                (115.0 - 180, 5.0), (115.0 - 180, 15.0), (120.0 - 180, 21.0), (120.0 - 180, 25.0),
                (135.0 - 180, 25.0), (135.0 - 180, 5.0), (115.0 - 180, 5.0)
            ]
        else:
            gl.xlocator = plt.FixedLocator(np.arange(105, 156, 5))
            ax_map.text(118, 13, 'West Philippine\nSea', fontsize=5, color='navy', weight='bold',
                        transform=projection, ha='center', va='center', style='italic', alpha=0.5)
            ax_map.text(130, 20, 'Philippine\nSea', fontsize=9, color='navy', weight='bold',
                        transform=projection, ha='center', va='center', style='italic', alpha=0.5)
            par_vertices = [
                (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
                (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
            ]
            
        ax_map.add_patch(mpatches.Polygon(par_vertices, facecolor='none', edgecolor='#FF6B35', 
                                     linestyle='-', linewidth=3, alpha=0.8, 
                                     transform=projection))
                                     
        cycle_colors = ["#38bdf8", "#34d399", "#fbbf24", "#f87171", "#a855f7", "#64748b"]
        has_any_paired = any(item['disturbance'].get('pairedTrackName') is not None for item in chain if item['disturbance'])
        
        for idx, item in reversed(list(enumerate(chain))):
            dist = item['disturbance']
            if not dist or not dist.get('meanPoints') or len(dist['meanPoints']) < 2:
                continue
                
            # if has_any_paired and not dist.get('pairedTrackName'):
            #     continue
                
            color = cycle_colors[idx % len(cycle_colors)]
            mean_points = dist['meanPoints']
            lats = [p['lat'] for p in mean_points]
            lons = [p['lon'] for p in mean_points]
            winds = [p['windKmh'] for p in mean_points]
            
            if is_wide:
                lons = [lon - 180.0 if lon > 0 else lon for lon in lons]
                
            if idx == 0:
                line_color = 'black'
                line_alpha = 1.0
            else:
                line_color = cycle_colors[idx % len(cycle_colors)]
                if idx == 1:
                    line_alpha = 0.6
                elif idx == 2:
                    line_alpha = 0.4
                else:
                    line_alpha = 0.2
                
            ax_map.plot(lons, lats, color=line_color, linewidth=3.5, alpha=line_alpha, transform=projection)
            
            for i in range(len(lons)):
                if np.isnan(lats[i]) or np.isnan(lons[i]):
                    continue
                ax_map.plot(lons[i], lats[i], color='black', marker='o', markersize=8,
                            markeredgewidth=0, alpha=0.2 * line_alpha, transform=projection)
                pt_wind = winds[i]
                ring_color = get_pagasa_wind_color(pt_wind) or cycle_colors[idx % len(cycle_colors)]
                ax_map.plot(lons[i], lats[i], markerfacecolor='none', markeredgecolor=ring_color,
                            marker='o', markersize=5, markeredgewidth=1.8, alpha=line_alpha, transform=projection)
                            
        wind_categories = [
            {'label': 'Super Typhoon (≥ 185 km/h)', 'color': '#FF007F'},
            {'label': 'Typhoon (118–184 km/h)', 'color': '#A83232'},
            {'label': 'Severe Tropical Storm (89–117 km/h)', 'color': '#E67E22'},
            {'label': 'Tropical Storm (62–88 km/h)', 'color': '#F1C40F'},
            {'label': 'Tropical Depression (≤ 61 km/h)', 'color': '#2ECC71'}
        ]
        legend_elements = [
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='none',
                       markeredgecolor=r['color'], markeredgewidth=2,
                       markersize=8, label=r['label'])
            for r in wind_categories
        ]
        leg_wind = ax_map.legend(handles=legend_elements, loc='upper left', frameon=False, fontsize=8)
        ax_map.add_artist(leg_wind)
        
        cycle_lines = []
        for idx, d in enumerate(reversed(chart_data)):
            is_current = (idx == 0)
            suffix = " [CURRENT]" if is_current else ""
            line_text = f"{d['name']} ({d['memberCount']}/{d['totalMembers']}){suffix}"
            line_color = 'black' if is_current else cycle_colors[idx % len(cycle_colors)]
            text_color = 'black' if is_current else cycle_colors[idx % len(cycle_colors)]
            cycle_lines.append((line_text, line_color, text_color))
            
        cycle_legend_elements = [
            plt.Line2D([0], [0], color=c_line_color, linewidth=2.5, label=c_text)
            for c_text, c_line_color, _ in cycle_lines
        ]
        leg_history = ax_map.legend(
            handles=cycle_legend_elements,
            loc='lower left',
            frameon=True,
            facecolor='#ffffff',
            framealpha=0.95,
            fontsize=8,
            title="Run Cycle History"
        )
        leg_history.get_frame().set_edgecolor('#cbd5e1')
        leg_history.get_title().set_color('#0f172a')
        plt.setp(leg_history.get_title(), fontsize=8, weight='bold')
        for text, (_, _, c_text_color) in zip(leg_history.get_texts(), cycle_lines):
            text.set_color(c_text_color)
            text.set_weight('bold')
        ax_map.add_artist(leg_history)
        
        credit_text = "Philippine Typhoon/Weather"
        ax_map.text(0.98, 0.02, credit_text, transform=ax_map.transAxes, fontsize=8,
                    verticalalignment='bottom', horizontalalignment='right', weight='bold')
                    
        latest_run_with_dist = next((item for item in chain if item['disturbance']), None)
        latest_run = latest_run_with_dist if latest_run_with_dist else chain[0]
        
        storm_label = ""
        latest_dist = next((item['disturbance'] for item in chain if item['disturbance']), None)
        if latest_dist:
            dist_name = latest_dist.get('persistent_name')
            if not dist_name:
                dist_name = f"Disturbance {latest_dist['id']}"
            storm_label = f" ({dist_name})"
                
        member_count = 1000 if dataset == "large" else 50
        days_lbl = "5-Day" if args.horizon == "5day" else "15-Day"
        ensemble_lbl = f"{member_count} Ensemble {days_lbl}"
        cycle_time_clean = latest_run['cycle_time'].replace('T', ' ')
        cycle_date = cycle_time_clean.split(' ')[0]
        title_text = f"WNC {ensemble_lbl} Track Trends{storm_label}\nWestern Pacific ({cycle_date})"
        ax_map.set_title(title_text, fontsize=12, weight='bold', pad=10)
        
        ax_gen = fig.add_subplot(gs[0, 2])
        ax_gen.set_facecolor('none')
        ax_gen.grid(True, linestyle=':', alpha=0.6, color='gray')
        
        x_names = [d['name'] for d in chart_data]
        
        if is_latest_tc:
            valid_x = []
            valid_y = []
            valid_labels = []
            for d in chart_data:
                if d['detected'] and not np.isnan(d['forecast_bearing']):
                    valid_x.append(d['name'])
                    valid_y.append(d['forecast_bearing'])
                    valid_labels.append(d['compass_dir'])
                    
            if valid_y:
                ax_gen.plot(valid_x, valid_y, color='#ef4444', linewidth=2, marker='o', markersize=6, markerfacecolor='#ef4444')
                for i, val in enumerate(valid_y):
                    lbl = valid_labels[i]
                    ax_gen.annotate(lbl, (valid_x[i], val), textcoords="offset points",
                                    xytext=(0, 10), ha='center', fontsize=6.5, weight='bold', color='#0f172a',
                                    bbox=dict(boxstyle="round,pad=0.3", fc="#fee2e2", alpha=0.9, ec="#ef4444", lw=0.5))
                                    
            ax_gen.set_yticks([0, 45, 90, 135, 180, 225, 270, 315, 360])
            ax_gen.set_yticklabels(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'])
            ax_gen.set_ylim(-15, 375)
            ax_gen.set_ylabel("Forecast Heading", fontsize=10, weight='bold')
            ax_gen.set_title("Forecast Track Direction Trend", fontsize=11, weight='bold', pad=8)
            ax_gen.tick_params(axis='both', labelsize=9)
        else:
            x_names = [d['name'] for d in chart_data]
            probs = [d['probability'] for d in chart_data]
            
            ax_gen.plot(x_names, probs, color='#10b981', linewidth=2, marker='o', markersize=6, markerfacecolor='#10b981')
            ax_gen.set_ylim(-5, 105)
            ax_gen.set_ylabel("Genesis Probability (%)", fontsize=10, weight='bold')
            ax_gen.set_title("Genesis Probability Trend", fontsize=11, weight='bold', pad=8)
            ax_gen.tick_params(axis='both', labelsize=9)
            
            for i, d in enumerate(chart_data):
                if d['detected']:
                    label_text = f"{d['memberCount']}/{d['totalMembers']}\n{d['genesis_time']}"
                    ax_gen.annotate(label_text, (x_names[i], probs[i]), textcoords="offset points",
                                    xytext=(0, 10), ha='center', fontsize=6.5, weight='bold', color='#0f172a',
                                    bbox=dict(boxstyle="round,pad=0.3", fc="yellow", alpha=0.8, ec="gray", lw=0.5))
                                
        ax_wind = fig.add_subplot(gs[1, 2])
        ax_wind.set_facecolor('none')
        ax_wind.grid(True, linestyle=':', alpha=0.6, color='gray')
        
        means = [d['computedMeanWind'] if d['detected'] else np.nan for d in chart_data]
        paired = [d['pairedWind'] if d['detected'] and d['pairedWind'] > 0 else np.nan for d in chart_data]
        mins = [d['minWind'] if d['detected'] else np.nan for d in chart_data]
        maxs = [d['maxWind'] if d['detected'] else np.nan for d in chart_data]
        
        has_spread = any(not np.isnan(m) for m in mins)
        if has_spread:
            ax_wind.fill_between(x_names, mins, maxs, color='#00d4ff', alpha=0.15, label='Member Range')
            
        ax_wind.plot(x_names, means, color='#00d4ff', linewidth=2.5, marker='o', markersize=5, label='Ensemble Mean')
        
        has_paired_wind = any(not np.isnan(p) for p in paired)
        if has_paired_wind:
            ax_wind.plot(x_names, paired, color='#0f172a', linestyle='--', linewidth=1.8, marker='s', markersize=4, label='Paired Track')
            
        ax_wind.set_ylabel("Peak Wind Speed (km/h)", fontsize=10, weight='bold')
        ax_wind.set_title("Peak Wind Intensity Trend", fontsize=11, weight='bold', pad=8)
        ax_wind.legend(loc='lower left', fontsize=8)
        ax_wind.tick_params(axis='both', labelsize=9)
        
        for i, d in enumerate(chart_data):
            if d['detected']:
                mean_val = d['computedMeanWind']
                label_text = f"{mean_val:.0f} km/h"
                ax_wind.annotate(label_text, (x_names[i], mean_val), textcoords="offset points",
                                 xytext=(0, 10), ha='center', fontsize=6.5, weight='bold', color='#0f172a',
                                 bbox=dict(boxstyle="round,pad=0.3", fc="#e0f2fe", alpha=0.9, ec="#0284c7", lw=0.5))
        
        plt.tight_layout()
        
        if args.all:
            trends_out_dir = os.path.join(data_dir, "trends")
            os.makedirs(trends_out_dir, exist_ok=True)
            suffix = "wide" if is_wide else "standard"
            output_path = os.path.join(trends_out_dir, f"{dataset}_{args.horizon}_{selected_dist['persistent_id']}_{suffix}.png")
        else:
            output_path = args.output
            
        plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor=fig.get_facecolor(), edgecolor='none')
        plt.close(fig)
        print(f"Trends map successfully generated and saved to: {output_path}")

    # Write or update trends/manifest.json
    if args.all:
        trends_out_dir = os.path.join(data_dir, "trends")
        manifest_path = os.path.join(trends_out_dir, "manifest.json")
        manifest_data = {}
        if os.path.exists(manifest_path):
            try:
                with open(manifest_path, 'r', encoding='utf-8') as f:
                    manifest_data = json.load(f)
            except Exception:
                manifest_data = {}

        key = f"{dataset}_{args.horizon}"
        manifest_data[f"{key}_cycle"] = latest_cycle['cycle_time']
        manifest_data[key] = []
        for dist in valid_dists:
            manifest_data[key].append({
                "id": dist['persistent_id'],
                "local_id": dist['id'],
                "name": dist.get('persistent_name', f"Disturbance {dist['id']}"),
                "trackCount": dist['trackCount'],
                "standard": f"/data/trends/{dataset}_{args.horizon}_{dist['persistent_id']}_standard.png",
                "wide": f"/data/trends/{dataset}_{args.horizon}_{dist['persistent_id']}_wide.png"
            })

        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest_data, f, indent=2)
        print(f"Successfully updated trends manifest: {manifest_path}")

if __name__ == "__main__":
    main()
