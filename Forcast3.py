import os
import json
from shapely.geometry import shape
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import pandas as pd
import numpy as np
from matplotlib.path import Path
from matplotlib.patches import PathPatch
import matplotlib.patches as mpatches
import requests
import subprocess
from datetime import datetime, timedelta, timezone
from sklearn.cluster import HDBSCAN

# Initialize counters for tracking plotted and skipped tracks
plotted_tracks = 0
skipped_tracks = 0
skipped_details = []

latest_runtime_text = None
forecast_start_date_text = None
forecast_end_date_text = None


def get_latest_run_url():
    base = (
        "https://deepmind.google.com/science/weatherlab/download/"
        "cyclones/FNV3_LARGE_ENSEMBLE/ensemble/cyclogenesis/csv"
    )

    today = datetime.now(timezone.utc).date()
    dates = [today, today - timedelta(days=1), today - timedelta(days=2)]
    hours_desc = ["18", "12", "06", "00"]

    for d in dates:
        date_str = d.strftime("%Y_%m_%d")
        for h in hours_desc:
            url = f"{base}/FNV3_LARGE_ENSEMBLE_{date_str}T{h}_00_cyclogenesis.csv"
            try:
                resp = requests.head(url, allow_redirects=True, timeout=10)
            except requests.RequestException:
                continue
            if resp.status_code == 200:
                print(f"Latest available run found: {date_str}T{h}:00")
                return date_str, h, url

    raise RuntimeError("No available FNV3_LARGE_ENSEMBLE cyclogenesis runs found in the last 3 days.")


# Load the CSV file, skipping comment lines
try:
    date_str, hour_str, latest_url = get_latest_run_url()
    local_csv = f"temp_data/FNV3_LARGE_ENSEMBLE_{date_str}T{hour_str}_00_cyclogenesis.csv"
    if os.path.exists(local_csv) and os.path.getsize(local_csv) > 1000000:
        print(f"Local file {local_csv} found with valid size. Skipping download.")
    else:
        # Fallback to copy from C:\Users\Russel\Desktop\Weather alert\ if available and valid
        fallback_path = fr"C:\Users\Russel\Desktop\Weather alert\FNV3_LARGE_ENSEMBLE_{date_str}T{hour_str}_00_cyclogenesis.csv"
        if os.path.exists(fallback_path) and os.path.getsize(fallback_path) > 1000000:
            print(f"Copying valid fallback from {fallback_path} to {local_csv}")
            import shutil
            shutil.copy(fallback_path, local_csv)
        else:
            print(f"Downloading latest run with curl to: {local_csv}")
            os.makedirs("temp_data", exist_ok=True)
            subprocess.run([
                "curl",
                "-L",
                "-o",
                local_csv,
                latest_url,
            ], check=True)
            
    data = pd.read_csv(local_csv, comment="#")
    data.columns = data.columns.str.strip()
    if 'lead_time' in data.columns and 'lead_time_hours' not in data.columns:
        data['lead_time_hours'] = pd.to_timedelta(data['lead_time']).dt.total_seconds() / 3600

    latest_utc = datetime.strptime(f"{date_str} {hour_str}", "%Y_%m_%d %H").replace(tzinfo=timezone.utc)
    ph_zone = timezone(timedelta(hours=8))
    latest_ph = latest_utc.astimezone(ph_zone)

    time_label = latest_ph.strftime("%I:%M %p").lstrip("0")

    latest_runtime_text = f"{time_label} PHT, {latest_ph.strftime('%B %d, %Y')}"
    forecast_start_date_text = latest_ph.strftime("%Y-%m-%d")
    forecast_end_date_text = (latest_ph + timedelta(days=5)).strftime("%Y-%m-%d")
except subprocess.CalledProcessError as e:
    print(f"Error: curl failed to download CSV: {e}")
    exit()
except pd.errors.ParserError:
    print("Error: Failed to parse CSV. Ensure the file is correctly formatted and contains the expected columns.")
    exit()
except Exception as e:
    print(f"Error loading CSV: {str(e)}")
    exit()

# Validate required columns
required_columns = ['init_time', 'track_id', 'sample', 'lead_time_hours', 'lat', 'lon', 'minimum_sea_level_pressure_hpa']
missing_columns = [col for col in required_columns if col not in data.columns]
if missing_columns:
    print(f"Error: Missing required columns in CSV: {missing_columns}")
    exit()

# Filter for 5-day forecast (lead_time_hours <= 120)
wp_data = data[data['lead_time_hours'] <= 120].copy()
wp_data['track_id'] = wp_data['track_id'].astype(str)

# Get all unique track IDs
all_track_ids = sorted(wp_data['track_id'].unique())
print(f"Processing all track IDs: {all_track_ids}")

# Check if any data remains
if wp_data.empty:
    print("Error: No data found in the CSV file for lead_time_hours <= 120.")
    exit()

# Ensure data is sorted by init_time, track_id, sample, and lead_time_hours
wp_data = wp_data.sort_values(by=['init_time', 'track_id', 'sample', 'lead_time_hours'])

# Identify unique initialization times
init_times = wp_data['init_time'].unique()
if len(init_times) == 0:
    print("Error: No valid init_time values found in the data.")
    exit()
print(f"Found {len(init_times)} forecast initialization times: {init_times}")

# Set up the figure and map projection
projection = ccrs.PlateCarree(central_longitude=180)
fig = plt.figure(figsize=(14, 11), facecolor='white')
ax = plt.axes(projection=projection)
ax.set_extent([-75, 10, 0, 40], crs=projection)

# Add land, ocean, and coastlines
ax.set_facecolor('#87CEEB')
ax.add_feature(cfeature.LAND, facecolor='#DEB887', edgecolor='#8B4513', linewidth=0.8)
ax.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.8, alpha=0.7, color='#654321')
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
        ax.add_geometries(province_shapely_geometries, crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#654321', linewidth=0.4, alpha=0.5, zorder=3)
except Exception as province_load_error:
    print(f"Warning: Failed to overlay province boundaries: {province_load_error}")


# Add gridlines
gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
gl.xlocator = plt.FixedLocator(list(range(110, 181, 10)) + [-170])
gl.ylocator = plt.FixedLocator(np.arange(0, 41, 5))
gl.xlabel_style = {'size': 12, 'weight': 'bold'}
gl.ylabel_style = {'size': 12, 'weight': 'bold'}
gl.top_labels = False
gl.right_labels = False

ax.text(
    118 - 180, 13, 'West Philippine\nSea', fontsize=5, color='navy', weight='bold',
    transform=projection, ha='center', va='center', style='italic', alpha=0.5
)
ax.text(
    130 - 180, 20, 'Philippine\nSea', fontsize=9, color='navy', weight='bold',
    transform=projection, ha='center', va='center', style='italic', alpha=0.5
)

# Add Philippine Area of Responsibility (PAR) boundary
par_vertices = [
    (115.0 - 180, 5.0), (115.0 - 180, 15.0), (120.0 - 180, 21.0), (120.0 - 180, 25.0),
    (135.0 - 180, 25.0), (135.0 - 180, 5.0), (115.0 - 180, 5.0)
]
ax.add_patch(mpatches.Polygon(par_vertices, facecolor='none', edgecolor='#FF6B35', 
                             linestyle='-', linewidth=3, alpha=0.8, 
                             transform=projection))

# Define function to assign custom colors based on pressure
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

# Helper function for overlap-only weighted Haversine distance (NaN-aware)
def compute_dist_matrix_nan(lats, lons, w, min_overlap=3):
    """
    lats, lons: shape (N, T) with NaN where data is missing
    w: shape (T,) weights per lead time
    min_overlap: minimum number of common forecast times required
    Returns: (N, N) symmetric distance matrix
    """
    N, T = lats.shape
    dist = np.zeros((N, N))
    r_lat = np.radians(lats)
    r_lon = np.radians(lons)
    
    for i in range(N):
        for j in range(i + 1, N):
            valid = ~np.isnan(lats[i]) & ~np.isnan(lats[j])
            if np.sum(valid) < min_overlap:
                dist[i, j] = dist[j, i] = 1e6
                continue
            dlat = r_lat[j, valid] - r_lat[i, valid]
            dlon = r_lon[j, valid] - r_lon[i, valid]
            dlon = (dlon + np.pi) % (2 * np.pi) - np.pi
            a = np.sin(dlat / 2) ** 2 + np.cos(r_lat[i, valid]) * np.cos(r_lat[j, valid]) * np.sin(dlon / 2) ** 2
            c = 2 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))
            d = 6371.0 * c
            wv = w[valid]
            dist[i, j] = dist[j, i] = np.sum(wv * d) / np.sum(wv)
    return dist

# Precompute and align track data, and run clustering once
track_plot_data = []
cluster_colors = [
    '#E05A47', '#3B75AF', '#4A9B5D', '#F29F05', '#9163B6',
    '#2E9F9B', '#D96B27', '#5E72E4', '#2DCE89', '#F5365C',
    '#A569BD', '#34495E', '#16A085', '#D35400', '#2C3E50',
    '#E74C3C', '#1ABC9C', '#2ECC71', '#9B59B6', '#3498DB',
    '#e377c2', '#8c564b', '#bcbd22', '#ad494a'
]
global_cluster_idx = 0

# Helper function for Haversine distance
def haversine_dist(lat1, lon1, lat2, lon2):
    r_lat1, r_lon1, r_lat2, r_lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat = r_lat2 - r_lat1
    dlon = (r_lon2 - r_lon1 + np.pi) % (2 * np.pi) - np.pi
    a = np.sin(dlat / 2) ** 2 + np.cos(r_lat1) * np.cos(r_lat2) * np.sin(dlon / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))

# Precompute and align track data, and run clustering once
track_plot_data = []
cluster_colors = [
    '#E05A47', '#3B75AF', '#4A9B5D', '#F29F05', '#9163B6',
    '#2E9F9B', '#D96B27', '#5E72E4', '#2DCE89', '#F5365C',
    '#A569BD', '#34495E', '#16A085', '#D35400', '#2C3E50',
    '#E74C3C', '#1ABC9C', '#2ECC71', '#9B59B6', '#3498DB',
    '#e377c2', '#8c564b', '#bcbd22', '#ad494a'
]
global_cluster_idx = 0

for init_time in init_times:
    init_data = wp_data[wp_data['init_time'] == init_time]
    if init_data.empty:
        continue
        
    # Phase 1: Extract and validate trajectories for all track IDs
    validated_tracks = {}
    for track_id in all_track_ids:
        track_data = init_data[init_data['track_id'] == track_id]
        if track_data.empty:
            continue
            
        valid_samples = []
        for sample in track_data['sample'].unique():
            sample_data = track_data[track_data['sample'] == sample]
            if sample_data.empty:
                continue
            
            raw_lons = sample_data['lon'].values
            raw_lons = np.where(raw_lons < 0, raw_lons + 360, raw_lons)
            lons_shifted = raw_lons - 180.0
            lats = sample_data['lat'].values
            lead_times = sample_data['lead_time_hours'].values
            pressures = sample_data['minimum_sea_level_pressure_hpa'].values
            
            if len(lons_shifted) < 2 or np.any(np.isnan(lons_shifted)) or np.any(np.isnan(lats)):
                skipped_tracks += 1
                skipped_details.append(f"track_id {track_id}, sample {sample}, init_time {init_time}")
                continue
            lon_diffs = np.abs(np.diff(lons_shifted))
            lat_diffs = np.abs(np.diff(lats))
            if np.any(lon_diffs > 15) or np.any(lat_diffs > 15):
                skipped_tracks += 1
                skipped_details.append(f"track_id {track_id}, sample {sample}, init_time {init_time}")
                continue
                
            valid_samples.append({
                'track_id': track_id,
                'sample': sample,
                'lons_shifted': lons_shifted,
                'lats': lats,
                'lead_times': lead_times,
                'pressures': pressures
            })
            
        if len(valid_samples) > 0:
            validated_tracks[track_id] = valid_samples

    # Phase 2: Compute genesis start positions for grouping non-WP candidates
    genesis_starts = {}
    for track_id, samples in validated_tracks.items():
        if track_id.startswith('WP'):
            continue
        starts = []
        for s in samples:
            starts.append((s['lats'][0], s['lons_shifted'][0]))
        if starts:
            avg_lat = np.mean([pt[0] for pt in starts])
            avg_lon = np.mean([pt[1] for pt in starts])
            avg_lon = (avg_lon + 180) % 360 - 180
            genesis_starts[track_id] = (avg_lat, avg_lon)

    # Union-find to group geographically close genesis candidates (within 300 km)
    parent = {tid: tid for tid in genesis_starts}
    def find_root(i):
        if parent[i] == i:
            return i
        parent[i] = find_root(parent[i])
        return parent[i]
        
    def union_nodes(i, j):
        root_i = find_root(i)
        root_j = find_root(j)
        if root_i != root_j:
            parent[root_j] = root_i

    tids = list(genesis_starts.keys())
    for i in range(len(tids)):
        for j in range(i + 1, len(tids)):
            tid_i = tids[i]
            tid_j = tids[j]
            pos_i = genesis_starts[tid_i]
            pos_j = genesis_starts[tid_j]
            if haversine_dist(pos_i[0], pos_i[1], pos_j[0], pos_j[1]) < 200.0:
                union_nodes(tid_i, tid_j)

    genesis_groups = {}
    for tid in genesis_starts:
        root = find_root(tid)
        if root not in genesis_groups:
            genesis_groups[root] = []
        genesis_groups[root].append(tid)

    # Phase 3: Build consolidated Meteorological Systems
    systems = []
    # 1. Mature systems (WP track IDs)
    for track_id in validated_tracks:
        if track_id.startswith('WP'):
            import re
            m = re.search(r'WP(\d+)', track_id)
            if m:
                storm_no = int(m.group(1))
                name = f"{storm_no:02d}W"
            else:
                name = track_id
            systems.append({
                'type': 'mature',
                'name': name,
                'track_ids': [track_id]
            })
            
    # 2. Grouped genesis systems
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    for idx, (root, group_tids) in enumerate(genesis_groups.items()):
        if idx < 26:
            suffix = letters[idx]
        else:
            first = letters[(idx // 26) - 1]
            second = letters[idx % 26]
            suffix = first + second
        systems.append({
            'type': 'genesis',
            'name': f"Potential Disturbance {suffix}",
            'track_ids': group_tids
        })

    # Phase 4: Cluster each system independently
    for sys in systems:
        system_valid_samples = []
        for tid in sys['track_ids']:
            system_valid_samples.extend(validated_tracks[tid])
            
        n_valid_total = len(system_valid_samples)
        if n_valid_total == 0:
            continue
            
        # Build union of lead times and align tracks
        all_lead_set = sorted(set().union(*(s['lead_times'].tolist() for s in system_valid_samples)))
        lead_grid = np.array(all_lead_set)
        n_times = len(lead_grid)
        lead_lookup = {lt: i for i, lt in enumerate(lead_grid)}
        
        complete_samples = []
        for s in system_valid_samples:
            aligned_lon = np.full(n_times, np.nan)
            aligned_lat = np.full(n_times, np.nan)
            for i, lt in enumerate(s['lead_times']):
                idx = lead_lookup.get(lt)
                if idx is not None:
                    aligned_lon[idx] = s['lons_shifted'][i]
                    aligned_lat[idx] = s['lats'][i]
            
            complete_samples.append({
                'track_id': s['track_id'],
                'sample': s['sample'],
                'lons_shifted': s['lons_shifted'],
                'lats': s['lats'],
                'lead_times': s['lead_times'],
                'aligned_lon': aligned_lon,
                'aligned_lat': aligned_lat,
                'pressures': s['pressures']
            })
            
        n_complete = len(complete_samples)
        
        total_ensemble_members = init_data['sample'].nunique() if not init_data.empty else 1000
        is_wp = (sys['type'] == 'mature')
        min_complete_to_cluster = 20 if is_wp else max(80, int(0.08 * total_ensemble_members))
        should_cluster = n_complete >= min_complete_to_cluster
        
        labels = np.full(n_complete, -1, dtype=int)
        if should_cluster:
            lons_grid = np.array([s['aligned_lon'] for s in complete_samples])
            lats_grid = np.array([s['aligned_lat'] for s in complete_samples])
            
            w = np.exp(-0.015 * lead_grid)
            
            dist_matrix = compute_dist_matrix_nan(lats_grid, lons_grid, w)
            epsilon = 100.0
            
            if is_wp:
                min_cluster_size = max(15, int(0.025 * n_complete))
                min_samples = max(7, int(0.012 * n_complete))
                allow_single = True
            else:
                min_cluster_size = max(10, int(0.015 * n_complete))
                min_samples = max(5, int(0.008 * n_complete))
                allow_single = False
                
            try:
                hdb = HDBSCAN(
                    min_cluster_size=min_cluster_size,
                    min_samples=min_samples,
                    metric='precomputed',
                    cluster_selection_method='eom',
                    allow_single_cluster=allow_single,
                    cluster_selection_epsilon=epsilon
                )
                labels = hdb.fit_predict(dist_matrix)
            except Exception as cluster_err:
                print(f"Clustering error for system {sys['name']}: {cluster_err}. Defaulting to noise.")
                labels = np.full(n_complete, -1, dtype=int)
                
            # Second pass on noise to capture minor scenarios
            noise_mask = (labels == -1)
            n_noise = np.sum(noise_mask)
            if n_noise >= 2 * min_cluster_size:
                noise_indices = np.where(noise_mask)[0]
                noise_dist = dist_matrix[np.ix_(noise_indices, noise_indices)]
                try:
                    hdb2 = HDBSCAN(
                        min_cluster_size=max(8, int(0.02 * n_noise)),
                        min_samples=max(4, int(0.01 * n_noise)),
                        metric='precomputed',
                        cluster_selection_method='eom',
                        allow_single_cluster=False,
                        cluster_selection_epsilon=epsilon
                    )
                    noise_labels = hdb2.fit_predict(noise_dist)
                    next_label = labels.max() + 1 if labels.max() >= 0 else 0
                    for nl in np.unique(noise_labels):
                        if nl == -1:
                            continue
                        for ni, orig_idx in enumerate(noise_indices):
                            if noise_labels[ni] == nl:
                                labels[orig_idx] = next_label
                        next_label += 1
                except Exception:
                    pass

            # Centroid-track merging
            unique_labels = np.unique(labels)
            active_labels = [l for l in unique_labels if l != -1]
            if len(active_labels) > 1:
                mean_lats = []
                mean_lons = []
                import warnings
                for l in active_labels:
                    mask = (labels == l)
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore", category=RuntimeWarning)
                        mean_lats.append(np.nanmean(lats_grid[mask], axis=0))
                        mean_lons.append(np.nanmean(lons_grid[mask], axis=0))
                mean_lats = np.array(mean_lats)
                mean_lons = np.array(mean_lons)
                
                mean_dist = compute_dist_matrix_nan(mean_lats, mean_lons, w, min_overlap=3)
                merge_threshold = 150.0
                label_map_merge = {l: l for l in active_labels}
                for i in range(len(active_labels)):
                    for j in range(i + 1, len(active_labels)):
                        if mean_dist[i, j] < merge_threshold:
                            root_i = label_map_merge[active_labels[i]]
                            while root_i != label_map_merge[root_i]:
                                root_i = label_map_merge[root_i]
                            label_map_merge[active_labels[j]] = root_i
                            
                for idx in range(len(labels)):
                    l = labels[idx]
                    if l != -1:
                        root = label_map_merge[l]
                        while root != label_map_merge[root]:
                            root = label_map_merge[root]
                        labels[idx] = root
                        
            # Remove tiny clusters under size 15
            unique_labels = np.unique(labels)
            for label in unique_labels:
                if label == -1:
                    continue
                c_mask = (labels == label)
                c_size = np.sum(c_mask)
                if c_size < max(15, int(0.02 * n_complete)):
                    labels[c_mask] = -1
                    
        unique_valid_labels = [l for l in np.unique(labels) if l != -1]
        cluster_sizes = {l: np.sum(labels == l) for l in unique_valid_labels}
        sorted_labels = sorted(unique_valid_labels, key=lambda l: cluster_sizes[l], reverse=True)
        
        label_mapping = {}
        for idx, orig_label in enumerate(sorted_labels):
            color = cluster_colors[global_cluster_idx % len(cluster_colors)]
            c_name = f"{sys['name']} C{idx + 1}"
            label_mapping[orig_label] = {
                'name': c_name,
                'color': color,
                'size': cluster_sizes[orig_label]
            }
            global_cluster_idx += 1
            
        track_plot_data.append({
            'system_name': sys['name'],
            'system_type': sys['type'],
            'valid_samples': system_valid_samples,
            'complete_samples': complete_samples,
            'labels': labels.tolist(),
            'should_cluster': should_cluster,
            'n_complete': n_complete,
            'label_mapping': label_mapping,
            'sorted_labels': sorted_labels
        })

# Generate both plots
for mode in ['standard', 'cluster']:
    plotted_tracks = 0
    legend = None
    projection = ccrs.PlateCarree(central_longitude=180)
    fig = plt.figure(figsize=(14, 11), facecolor='white')
    ax = plt.axes(projection=projection)
    fig.subplots_adjust(left=0.05, right=0.78, top=0.92, bottom=0.08)
    ax.set_extent([-75, 10, 0, 40], crs=projection)
    
    ax.set_facecolor('#87CEEB')
    ax.add_feature(cfeature.LAND, facecolor='#DEB887', edgecolor='#8B4513', linewidth=0.8)
    ax.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.8, alpha=0.7, color='#654321')
    
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
            ax.add_geometries(province_shapely_geometries, crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#654321', linewidth=0.4, alpha=0.5, zorder=3)
    except Exception as province_load_error:
        print(f"Warning: Failed to overlay province boundaries: {province_load_error}")
        
    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
    gl.xlocator = plt.FixedLocator(list(range(110, 181, 10)) + [-170])
    gl.ylocator = plt.FixedLocator(np.arange(0, 41, 5))
    gl.xlabel_style = {'size': 12, 'weight': 'bold'}
    gl.ylabel_style = {'size': 12, 'weight': 'bold'}
    gl.top_labels = False
    gl.right_labels = False
    
    ax.text(
        118 - 180, 13, 'West Philippine\nSea', fontsize=5, color='navy', weight='bold',
        transform=projection, ha='center', va='center', style='italic', alpha=0.5
    )
    ax.text(
        130 - 180, 20, 'Philippine\nSea', fontsize=9, color='navy', weight='bold',
        transform=projection, ha='center', va='center', style='italic', alpha=0.5
    )
    
    par_vertices = [
        (115.0 - 180, 5.0), (115.0 - 180, 15.0), (120.0 - 180, 21.0), (120.0 - 180, 25.0),
        (135.0 - 180, 25.0), (135.0 - 180, 5.0), (115.0 - 180, 5.0)
    ]
    ax.add_patch(mpatches.Polygon(par_vertices, facecolor='none', edgecolor='#FF6B35', 
                                 linestyle='-', linewidth=3, alpha=0.8, 
                                 transform=projection))
                                 
    if mode == 'standard':
        for item in track_plot_data:
            valid_samples = item['valid_samples']
            for s in valid_samples:
                mask = (s['lons_shifted'] + 180.0 >= 105) & (s['lons_shifted'] + 180.0 <= 190) & (s['lats'] >= 0) & (s['lats'] <= 40)
                lons_crop = s['lons_shifted'][mask]
                lats_crop = s['lats'][mask]
                pressures_crop = s['pressures'][mask]
                
                if len(lons_crop) < 2:
                    continue
                    
                ax.plot(
                    lons_crop, lats_crop,
                    color='#404040',
                    linewidth=2.5,
                    alpha=0.7,
                    zorder=3,
                    transform=projection
                )
                
                for i in range(len(lons_crop)):
                    color = get_pressure_color(pressures_crop[i])
                    if color is None:
                        continue
                    ax.plot(lons_crop[i], lats_crop[i], color='black', marker='o', markersize=8,
                            markeredgewidth=0, alpha=0.2, zorder=4, transform=projection)
                    ax.plot(lons_crop[i], lats_crop[i], markerfacecolor='none', markeredgecolor=color,
                            marker='o', markersize=5, markeredgewidth=1.5,
                            zorder=4, transform=projection)
                plotted_tracks += 1
                
        pressure_ranges = [
            {'pressure_range': '< 920 hPa', 'color': '#FF007F'},
            {'pressure_range': '920–945 hPa', 'color': '#A83232'},
            {'pressure_range': '945–970 hPa', 'color': '#E67E22'},
            {'pressure_range': '970–990 hPa', 'color': '#F1C40F'},
            {'pressure_range': '990–1005 hPa', 'color': '#2ECC71'},
            {'pressure_range': '> 1005 hPa', 'color': '#3498DB'}
        ]
        legend_elements = [
            plt.Line2D(
                [0], [0], marker='o', color='none', markerfacecolor='none',
                markeredgecolor=range_info['color'], markeredgewidth=2,
                markersize=8, label=range_info['pressure_range']
            )
            for range_info in pressure_ranges
        ]
        legend = ax.legend(
            handles=legend_elements, loc='upper left', bbox_to_anchor=(0.02, 0.98),
            frameon=False, fontsize=10
        )
        
    else:  # mode == 'cluster'
        cluster_legend_elements = []
        total_ensemble_members = wp_data['sample'].nunique() if not wp_data.empty else 1000
        
        for item in track_plot_data:
            valid_samples = item['valid_samples']
            complete_samples = item['complete_samples']
            labels = np.array(item['labels'])
            should_cluster = item['should_cluster']
            n_complete = item['n_complete']
            label_mapping = item['label_mapping']
            sorted_labels = item['sorted_labels']
            
            complete_sample_ids = {(s['track_id'], s['sample']): (idx, labels[idx]) for idx, s in enumerate(complete_samples)}
            
            for s in valid_samples:
                mask = (s['lons_shifted'] + 180.0 >= 105) & (s['lons_shifted'] + 180.0 <= 190) & (s['lats'] >= 0) & (s['lats'] <= 40)
                lons_crop = s['lons_shifted'][mask]
                lats_crop = s['lats'][mask]
                
                if len(lons_crop) < 2:
                    continue
                    
                sample_id = s['sample']
                t_id = s['track_id']
                l_val = -1
                if (t_id, sample_id) in complete_sample_ids:
                    _, l_val = complete_sample_ids[(t_id, sample_id)]
                    
                if l_val == -1:
                    ax.plot(
                        lons_crop, lats_crop,
                        color='#808080',
                        linewidth=0.5,
                        alpha=0.07,
                        zorder=3,
                        transform=projection
                    )
                else:
                    c_info = label_mapping[l_val]
                    ax.plot(
                        lons_crop, lats_crop,
                        color=c_info['color'],
                        linewidth=0.8,
                        alpha=0.35,
                        zorder=4,
                        transform=projection
                    )
                    plotted_tracks += 1
                    
            if should_cluster:
                # Filter active clusters by MIN_DISPLAY = 3%
                MIN_DISPLAY = 3.0
                displayed_clusters = []
                for orig_label in sorted_labels:
                    c_info = label_mapping[orig_label]
                    global_c_pct = (c_info['size'] / total_ensemble_members) * 100
                    if global_c_pct >= MIN_DISPLAY:
                        displayed_clusters.append((orig_label, global_c_pct))
                
                if len(displayed_clusters) > 0:
                    # System header
                    header_line = plt.Line2D(
                        [], [], color='none',
                        label=item['system_name']
                    )
                    cluster_legend_elements.append(header_line)
                    
                    # Compute per-system noise
                    system_clustered = sum(label_mapping[ol]['size'] for ol, _ in displayed_clusters)
                    system_noise = n_complete - system_clustered
                    system_noise_pct = (system_noise / total_ensemble_members) * 100 if total_ensemble_members > 0 else 0
                    has_noise = system_noise > 0 and system_noise_pct >= 1.0
                    total_sub_items = len(displayed_clusters) + (1 if has_noise else 0)
                    
                    for c_idx, (orig_label, global_c_pct) in enumerate(displayed_clusters):
                        c_info = label_mapping[orig_label]
                        sub_pos = c_idx + 1  # 1-based position
                        is_last = (sub_pos == total_sub_items)
                        prefix = "└──" if is_last else "├──"
                        track_label = f"Cluster {c_idx + 1}"
                        within_sys_pct = (c_info['size'] / n_complete) * 100 if n_complete > 0 else 0
                            
                        legend_line = plt.Line2D(
                            [0], [0], color=c_info['color'], linewidth=2.5,
                            label=f"   {prefix} {track_label} ({global_c_pct:.0f}% | {within_sys_pct:.0f}% of sys)"
                        )
                        cluster_legend_elements.append(legend_line)
                    
                    # Per-system noise entry
                    if has_noise:
                        within_sys_noise_pct = (system_noise / n_complete) * 100 if n_complete > 0 else 0
                        noise_line = plt.Line2D(
                            [0], [0], color='#808080', linewidth=1.5, linestyle='--',
                            label=f"   └── Noise ({system_noise_pct:.0f}% | {within_sys_noise_pct:.0f}% of sys)"
                        )
                        cluster_legend_elements.append(noise_line)
            
        legend = ax.legend(
            handles=cluster_legend_elements, loc='upper left', bbox_to_anchor=(1.02, 1.0),
            frameon=True, facecolor='white', framealpha=0.9, edgecolor='gray',
            title="Ensemble Cluster Support", title_fontsize=9, fontsize=8
        )
        
    runtime_text = latest_runtime_text or "Runtime unavailable"
    legend_text = (
        f"Runtime: {runtime_text}\n"
        "Processed By: Philippine Typhoon/Weather"
    )
    plt.text(
        0.98, 0.02, legend_text,
        transform=ax.transAxes, fontsize=10, verticalalignment='bottom', horizontalalignment='right'
    )
    
    start_date = forecast_start_date_text or "Start"
    end_date = forecast_end_date_text or "End"
    title_suffix = " (Clusters)" if mode == 'cluster' else ""
    title_obj = ax.set_title(f"WNC 1000 Ensemble 5-Day Forecast Tropical Cyclone Tracks{title_suffix}\nWestern Pacific ({start_date} to {end_date})", fontsize=14, weight='bold')
    
    try:
        init_time_str = init_times[0].replace(':', '').replace(' ', 'T') if len(init_times) > 0 else '20250728T0953'
        output_dir = "public/assets"
        os.makedirs(output_dir, exist_ok=True)
        suffix = "_cluster" if mode == 'cluster' else ""
        output_file = f"{output_dir}/fnv3_tropical_cyclone_5day_forecast_{init_time_str}{suffix}.png"
        extra_artists = [title_obj, gl]
        if legend is not None:
            extra_artists.append(legend)
        plt.savefig(output_file, dpi=300, bbox_inches='tight', facecolor=fig.get_facecolor(), edgecolor='none', bbox_extra_artists=extra_artists)
        print(f"Plot saved to {output_file}")
    except Exception as e:
        print(f"Error saving plot: {str(e)}")
        
    print(f"Summary ({mode} mode): {plotted_tracks} tracks plotted.")
    plt.close()

if skipped_tracks > 0:
    print(f"Skipped {skipped_tracks} tracks details:")
    for detail in skipped_details[:10]:
        print(f"  - {detail}")
