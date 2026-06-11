import os
import json
from shapely.geometry import shape
import os
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

def cluster_origins_greedy(origins, dist_km=300, max_genesis_spread=96):
    if not origins:
        return []
    sorted_origins = sorted(origins, key=lambda o: o['h'])
    clusters = []
    for o in sorted_origins:
        best_cluster = None
        min_dist = float('inf')
        for c in clusters:
            new_min_h = min(c['min_h'], o['h'])
            new_max_h = max(c['max_h'], o['h'])
            if new_max_h - new_min_h > max_genesis_spread:
                continue
            for member in c['origins']:
                d = haversine_km(member['lat'], member['lon'], o['lat'], o['lon'])
                if d <= dist_km and d < min_dist:
                    min_dist = d
                    best_cluster = c
        if best_cluster:
            best_cluster['origins'].append(o)
            best_cluster['min_h'] = min(best_cluster['min_h'], o['h'])
            best_cluster['max_h'] = max(best_cluster['max_h'], o['h'])
        else:
            clusters.append({
                'origins': [o],
                'min_h': o['h'],
                'max_h': o['h']
            })
    for c in clusters:
        sum_lat = sum(o['lat'] for o in c['origins'])
        sum_lon = sum(o['lon'] + 360 if o['lon'] < 0 else o['lon'] for o in c['origins'])
        avg_lon = sum_lon / len(c['origins'])
        if avg_lon > 180:
            avg_lon -= 360
        c['center'] = {
            'lat': sum_lat / len(c['origins']),
            'lon': avg_lon,
            'h': c['min_h']
        }
    return clusters

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
    grouped = {}
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
        llon = lon - 360 if lon > 180 else lon
        init_time = row.get('init_time', 'latest')
        key = f"{init_time}__{row['track_id']}__{row['sample']}"
        if key not in grouped:
            grouped[key] = []
        grouped[key].append({'lat': lat, 'lon': llon, 'p': pres, 'windKmh': wind_kmh, 'h': lead_h, 'track_id': str(row['track_id']), 'sample': int(row['sample'])})

    # Basin filtering: Standard PlateCarree bounds
    basin_filtered = []
    for points in grouped.values():
        if not points:
            continue
        points_sorted = sorted(points, key=lambda p: p['h'])
        origin = next((p for p in points_sorted if p['h'] == 0), points_sorted[0])
        # filter to 100 to 180 E, -5 to 45 N (align with React wpac basin)
        if 100 <= origin['lon'] <= 180 and -5 <= origin['lat'] <= 45:
            basin_filtered.append(points_sorted)

    # Gather origins for clustering
    all_origins = []
    unique_origins = set()
    for points in basin_filtered:
        if len(points) < 2:
            continue
        # check jumps (align with React)
        bad = False
        for i in range(1, len(points)):
            if abs(points[i]['lat'] - points[i-1]['lat']) > 10 or abs(points[i]['lon'] - points[i-1]['lon']) > 10:
                bad = True
                break
        if bad:
            continue
        origin = next((p for p in points if p['h'] == 0), points[0])
        okey = f"{origin['lat']:.1f},{origin['lon']:.1f}"
        if okey not in unique_origins:
            unique_origins.add(okey)
            all_origins.append({'lat': origin['lat'], 'lon': origin['lon'], 'h': origin['h'], 'okey': okey})

    clusters = cluster_origins_greedy(all_origins, 300)
    for idx, c in enumerate(clusters):
        c['distId'] = idx + 1

    tracks_by_dist = {}
    for points in basin_filtered:
        if len(points) < 2:
            continue
        # check jumps
        bad = False
        for i in range(1, len(points)):
            if abs(points[i]['lat'] - points[i-1]['lat']) > 10 or abs(points[i]['lon'] - points[i-1]['lon']) > 10:
                bad = True
                break
        if bad:
            continue
        origin = next((p for p in points if p['h'] == 0), points[0])
        dist_id = None
        best_dist = float('inf')
        for c in clusters:
            d = haversine_km(c['center']['lat'], c['center']['lon'], origin['lat'], origin['lon'])
            if d < best_dist:
                best_dist = d
                dist_id = c['distId']
        if best_dist > 666:
            dist_id = None
            
        if dist_id is not None:
            if dist_id not in tracks_by_dist:
                tracks_by_dist[dist_id] = []
            tracks_by_dist[dist_id].append(points)

    paired_mean_by_track_id = {}
    if paired_csv_text:
        pf_in = io.StringIO(paired_csv_text)
        pdf = pd.read_csv(pf_in, comment='#')
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
            'meanPoints': None
        })

    # Sort & Renumber deterministically (descending by trackCount, then lat, then lon)
    disturbance_list.sort(key=lambda d: (-d['trackCount'], -d['lat'], -d['lon']))
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
        num_match = re.search(r'WP(\d{2})', c['tId'], re.IGNORECASE)
        paired_assignment[c['dist']['id']] = {
            'paired': c['paired'],
            'trackName': f"{num_match.group(1)}W" if num_match else c['tId']
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
                m_lat = np.median(d['lats'])
                m_lon = np.median(d['lons'])
                m_w = np.median([w for w in d['winds'] if not np.isnan(w)])
                m_p = np.median([p for p in d['ps'] if not np.isnan(p)])
                
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
        # RI is defined as wind speed increase of >= 30 knots (55 km/h) within 24 hours.
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
    parser.add_argument('--is-wide', required=True, choices=['True', 'False'])
    parser.add_argument('--disturbance-id', required=True, type=int)
    parser.add_argument('--output', required=True)
    parser.add_argument('--lat', type=float, default=None)
    parser.add_argument('--lon', type=float, default=None)
    args = parser.parse_args()
    
    is_wide = args.is_wide == 'True'
    dataset = args.dataset
    disturbance_id = args.disturbance_id
    
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
        
    # Match Selected Disturbance across cycles
    # Trace starting from selected disturbance ID/coordinates in latest cycle (index 0)
    latest_cycle = parsed_cycles[0]
    selected_dist = None
    if args.lat is not None and args.lon is not None:
        best_d = float('inf')
        for d in latest_cycle['disturbances']:
            d_km = haversine_km(args.lat, args.lon, d['lat'], d['lon'])
            if d_km < 450 and d_km < best_d:
                best_d = d_km
                selected_dist = d
                
    if not selected_dist:
        selected_dist = next((d for d in latest_cycle['disturbances'] if d['id'] == disturbance_id), None)
        
    if not selected_dist:
        raise ValueError(f"Selected disturbance not found in latest cycle")
        
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
    
    # Process chain in chronological order for charts (oldest to newest)
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
                'genesis_time': 'N/A'
            })
            continue
            
        prob = min(100, round((dist['trackCount'] / total_members) * 100))
        
        # Use pre-computed Peak Wind Intensity Spread and Mean Wind
        min_w = dist.get('minWind', 0)
        max_w = dist.get('maxWind', 0)
        computed_mean_wind = dist.get('computedMeanWind', 0)
        
        paired_wind = 0
        if dist.get('pairedTrackName') and dist.get('meanPoints'):
            winds = [pt['windKmh'] for pt in dist['meanPoints'] if not np.isnan(pt['windKmh'])]
            if winds:
                paired_wind = max(winds)
                
        # Calculate estimated genesis date and time in PH Time (PHT, UTC+8)
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
            'genesis_time': genesis_time_str
        })

    # PLOTTING TIME
    # Combined Layout: Map on left (2/3 width), 2 subplots on right (1/3 width)
    fig = plt.figure(figsize=(18, 10))
    gs = gridspec.GridSpec(2, 3, figure=fig, width_ratios=[1.2, 1.2, 1.0])
    
    # 1. SETUP MAP PROJECTION
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
    # Add Philippine province boundaries from ph_provinces.json
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

    
    # Gridlines and ticks
    gl = ax_map.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
    gl.ylocator = plt.FixedLocator(np.arange(0, 41, 5))
    gl.xlabel_style = {'size': 10, 'weight': 'bold'}
    gl.ylabel_style = {'size': 10, 'weight': 'bold'}
    gl.top_labels = False
    gl.right_labels = False
    
    if is_wide:
        gl.xlocator = plt.FixedLocator(list(range(110, 181, 10)) + [-170])
        # labels for wide sea
        ax_map.text(118 - 180, 13, 'West Philippine\nSea', fontsize=5, color='navy', weight='bold',
                    transform=projection, ha='center', va='center', style='italic', alpha=0.5)
        ax_map.text(130 - 180, 20, 'Philippine\nSea', fontsize=9, color='navy', weight='bold',
                    transform=projection, ha='center', va='center', style='italic', alpha=0.5)
        
        # PAR Boundary
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
                                 
    # Color-coded runs: Sky Blue (Latest), Emerald Green (-6h), Amber (-12h), Coral Red (-18h)
    cycle_colors = ["#38bdf8", "#34d399", "#fbbf24", "#f87171"]
    
    # Rules: If paired track is present in ANY of the cycles, do not draw ensemble mean fallback for cycles that don't have it
    has_any_paired = any(item['disturbance'].get('pairedTrackName') is not None for item in chain if item['disturbance'])
    
    # Plot oldest first, so newest (Sky Blue) renders on top
    for idx, item in reversed(list(enumerate(chain))):
        dist = item['disturbance']
        if not dist or not dist.get('meanPoints') or len(dist['meanPoints']) < 2:
            continue
            
        # If there's an official paired track anywhere, and this cycle lacks one: skip it!
        if has_any_paired and not dist.get('pairedTrackName'):
            continue
            
        color = cycle_colors[idx]
        mean_points = dist['meanPoints']
        
        lats = [p['lat'] for p in mean_points]
        lons = [p['lon'] for p in mean_points]
        winds = [p['windKmh'] for p in mean_points]
        
        if is_wide:
            lons = [lon - 180.0 if lon > 0 else lon for lon in lons]
            
        # Determine track line color and visibility based on the run cycle index
        # Current run: 100% opacity black line
        # Older runs: respective Run Cycle Colors, stepping down in visibility (60%, 40%, 20%)
        if idx == 0:
            line_color = 'black'
            line_alpha = 1.0
        else:
            line_color = cycle_colors[idx]
            if idx == 1:
                line_alpha = 0.6
            elif idx == 2:
                line_alpha = 0.4
            else:
                line_alpha = 0.2
            
        # Draw Segment lines
        ax_map.plot(lons, lats, color=line_color, linewidth=3.5, alpha=line_alpha, transform=projection)
        
        # Colored donut rings using the wind intensity color (PAGASA categories)
        for i in range(len(lons)):
            if np.isnan(lats[i]) or np.isnan(lons[i]):
                continue
            # shadow scaled with cycle visibility
            ax_map.plot(lons[i], lats[i], color='black', marker='o', markersize=8,
                        markeredgewidth=0, alpha=0.2 * line_alpha, transform=projection)
            # Colored donut ring with wind intensity color
            pt_wind = winds[i]
            ring_color = get_pagasa_wind_color(pt_wind) or cycle_colors[idx]
            ax_map.plot(lons[i], lats[i], markerfacecolor='none', markeredgecolor=ring_color,
                        marker='o', markersize=5, markeredgewidth=1.8, alpha=line_alpha, transform=projection)

    # Top-Left Map Legend (PAGASA wind categories)
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
    
    # Run Cycle History Display in bottom-left
    cycle_lines = []
    # chart_data is from oldest to newest. We want newest (index -1) on top.
    for idx, d in enumerate(reversed(chart_data)):
        is_current = (idx == 0)
        suffix = " [CURRENT]" if is_current else ""
        line_text = f"{d['name']} ({d['memberCount']}/{d['totalMembers']}){suffix}"
        
        # Line color matches the map (black for current, cycle color for previous)
        line_color = 'black' if is_current else cycle_colors[idx]
        text_color = 'black' if is_current else cycle_colors[idx] # text is black for current run on the white background, cycle color for previous
        
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
    
    # Bottom-Right Credit
    credit_text = "Philippine Typhoon/Weather"
    ax_map.text(0.98, 0.02, credit_text, transform=ax_map.transAxes, fontsize=8,
                verticalalignment='bottom', horizontalalignment='right', weight='bold')
                
    # Title on the Map axes
    latest_run_with_dist = next((item for item in chain if item['disturbance']), None)
    latest_run = latest_run_with_dist if latest_run_with_dist else chain[0]
    
    storm_label = ""
    latest_dist = next((item['disturbance'] for item in chain if item['disturbance']), None)
    if latest_dist:
        if latest_dist.get('pairedTrackName'):
            try:
                is_invest = int(latest_dist['pairedTrackName']) >= 90
            except:
                is_invest = False
            storm_label = f" ({'Invest' if is_invest else 'TC'} {latest_dist['pairedTrackName']})"
        else:
            storm_label = f" (Disturbance {latest_dist['id']})"
            
    member_count = 1000 if dataset == "large" else 50
    days_lbl = "5-Day" if args.horizon == "5day" else "15-Day"
    ensemble_lbl = f"{member_count} Ensemble {days_lbl}"
    cycle_time_clean = latest_run['cycle_time'].replace('T', ' ')
    cycle_date = cycle_time_clean.split(' ')[0]
    title_text = f"FNV3 {ensemble_lbl} Track Trends{storm_label}\nWestern Pacific ({cycle_date})"
    ax_map.set_title(title_text, fontsize=12, weight='bold', pad=10)
    
    # 2. SUBPLOT 1: GENESIS PROBABILITY CHART (Upper Right)
    ax_gen = fig.add_subplot(gs[0, 2])
    ax_gen.set_facecolor('none')
    ax_gen.grid(True, linestyle=':', alpha=0.6, color='gray')
    
    if is_latest_tc:
        latest_dist = latest_item['disturbance']
        ri_probs = latest_dist.get('ri_probs', {}) if latest_dist else {}
        sorted_hours = sorted(ri_probs.keys())
        ri_x = [f"{h}h" for h in sorted_hours]
        ri_y = [ri_probs[h] for h in sorted_hours]
        
        ax_gen.plot(ri_x, ri_y, color='#ef4444', linewidth=2, marker='o', markersize=6, markerfacecolor='#ef4444')
        ax_gen.set_ylim(-5, 105)
        ax_gen.set_ylabel("RI Probability (%)", fontsize=10, weight='bold')
        ax_gen.set_title("RI Probability by Lead Time", fontsize=11, weight='bold', pad=8)
        ax_gen.tick_params(axis='both', labelsize=9)
        
        # Add RI probability bubble labels next to each marker
        for i, h in enumerate(sorted_hours):
            prob_val = ri_probs[h]
            label_text = f"{prob_val}%"
            ax_gen.annotate(label_text, (ri_x[i], prob_val), textcoords="offset points",
                            xytext=(0, 10), ha='center', fontsize=6.5, weight='bold', color='#0f172a',
                            bbox=dict(boxstyle="round,pad=0.3", fc="#fee2e2", alpha=0.9, ec="#ef4444", lw=0.5))
    else:
        x_names = [d['name'] for d in chart_data]
        probs = [d['probability'] for d in chart_data]
        
        ax_gen.plot(x_names, probs, color='#10b981', linewidth=2, marker='o', markersize=6, markerfacecolor='#10b981')
        ax_gen.set_ylim(-5, 105)
        ax_gen.set_ylabel("Genesis Probability (%)", fontsize=10, weight='bold')
        ax_gen.set_title("Genesis Probability Trend", fontsize=11, weight='bold', pad=8)
        ax_gen.tick_params(axis='both', labelsize=9)
        
        # Add member ratio and estimated genesis time text labels next to each marker
        for i, d in enumerate(chart_data):
            if d['detected']:
                label_text = f"{d['memberCount']}/{d['totalMembers']}\n{d['genesis_time']}"
                ax_gen.annotate(label_text, (x_names[i], probs[i]), textcoords="offset points",
                                xytext=(0, 10), ha='center', fontsize=6.5, weight='bold', color='#0f172a',
                                bbox=dict(boxstyle="round,pad=0.3", fc="yellow", alpha=0.8, ec="gray", lw=0.5))
                            
    # 3. SUBPLOT 2: WIND INTENSITY CHART (Lower Right)
    ax_wind = fig.add_subplot(gs[1, 2])
    ax_wind.set_facecolor('none')
    ax_wind.grid(True, linestyle=':', alpha=0.6, color='gray')
    
    means = [d['computedMeanWind'] if d['detected'] else np.nan for d in chart_data]
    paired = [d['pairedWind'] if d['detected'] and d['pairedWind'] > 0 else np.nan for d in chart_data]
    mins = [d['minWind'] if d['detected'] else np.nan for d in chart_data]
    maxs = [d['maxWind'] if d['detected'] else np.nan for d in chart_data]
    
    # Fill range spread
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
    
    # Add wind peak text labels next to each marker
    for i, d in enumerate(chart_data):
        if d['detected']:
            mean_val = d['computedMeanWind']
            label_text = f"{mean_val:.0f} km/h"
            ax_wind.annotate(label_text, (x_names[i], mean_val), textcoords="offset points",
                             xytext=(0, 10), ha='center', fontsize=6.5, weight='bold', color='#0f172a',
                             bbox=dict(boxstyle="round,pad=0.3", fc="#e0f2fe", alpha=0.9, ec="#0284c7", lw=0.5))
    
    # Tight layout and save
    plt.tight_layout()
    plt.savefig(args.output, dpi=300, bbox_inches='tight')
    plt.close()
    print(f"Trends map successfully generated and saved to: {args.output}")

if __name__ == "__main__":
    main()
