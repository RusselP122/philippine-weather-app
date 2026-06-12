import subprocess
import base64
import gzip
import xarray as xr
import os
import io
import json
import numpy as np
from datetime import datetime, timedelta, timezone
import matplotlib.pyplot as plt
import geojsoncontour
import pandas as pd
from shapely.geometry import shape, Point
from shapely.prepared import prep
import matplotlib.patches as mpatches
import cartopy.crs as ccrs
import cartopy.feature as cfeature

# Ensure output directory exists
OUT_DIR = "public/data/strike_prob"
os.makedirs(OUT_DIR, exist_ok=True)

# Correct URL structure (discovered from WeatherLab):
# .../netcdf/cumulative_probability_fields/FNV3_LARGE_ENSEMBLE_{date}T{hour}_00_cumulative_probability_fields.nc.gz.base64
BASE = (
    "https://deepmind.google.com/science/weatherlab/download/cyclones/"
    "FNV3_LARGE_ENSEMBLE/ensemble/cyclogenesis/netcdf/cumulative_probability_fields"
)

def curl_status(url):
    """Return HTTP status code for a URL using curl."""
    try:
        result = subprocess.run(
            ["curl", "-s", "-o", os.devnull, "-w", "%{http_code}",
             "--max-time", "20", "-L", "--retry", "2", url],
            capture_output=True, text=True, timeout=35
        )
        return int(result.stdout.strip())
    except Exception:
        return 0

def get_latest_run_url():
    today = datetime.now(timezone.utc).date()
    # Check today and previous 4 days in case of server delays
    dates = [today - timedelta(days=i) for i in range(5)]
    hours_desc = ["18", "12", "06", "00"]

    for d in dates:
        date_str = d.strftime("%Y_%m_%d")
        for h in hours_desc:
            filename = f"FNV3_LARGE_ENSEMBLE_{date_str}T{h}_00_cumulative_probability_fields.nc.gz.base64"
            url = f"{BASE}/{filename}"
            print(f"  Checking {date_str}T{h}...")
            status = curl_status(url)
            if status == 200:
                print(f"  Found: {date_str}T{h}:00 UTC (HTTP 200)")
                return date_str, h, url
            else:
                print(f"  {date_str}T{h}: HTTP {status}, skipping.")

    raise RuntimeError("No available cumulative probability runs found in the last 5 days.")

print("Fetching latest cumulative probability URL...")
date_str, hour_str, url = get_latest_run_url()

local_b64 = f"strike_prob_{date_str}_{hour_str}.nc.gz.base64"
local_nc  = f"strike_prob_{date_str}_{hour_str}.nc"

if os.path.exists(local_nc):
    print(f"Using cached {local_nc} (skip download).")
else:
    # 1. Download the base64-encoded gzipped NetCDF
    print(f"Downloading {url} ...")
    subprocess.run(
        ["curl", "-L", "-o", local_b64, "--retry", "3", "--max-time", "1200", url],
        check=True
    )
    print("Download complete.")

    # 2. Decode base64 → gzip → NetCDF bytes, write as .nc
    print("Decoding base64 + decompressing gzip...")
    with open(local_b64, "rb") as f:
        b64_data = f.read()

    gz_data = base64.b64decode(b64_data)
    nc_data  = gzip.decompress(gz_data)

    with open(local_nc, "wb") as f:
        f.write(nc_data)
    print(f"Decoded NetCDF written to {local_nc}")

    # Clean up the base64 file immediately to save disk space
    os.remove(local_b64)

# 3. Process with xarray
# Non-linear levels anchored to operational thresholds (matches frontend color logic):
# 5%=low signal, 10%=baseline, 20%=emerging, 30%=watch, 50%=high, 70%=dominant
# Top level must be 1.01 (not 0.80) otherwise Matplotlib leaves >80% regions blank!
levels = [0.05, 0.10, 0.20, 0.30, 0.50, 0.70, 1.01]

print("Processing NetCDF with xarray...")
ds = xr.open_dataset(local_nc)
print("Variables in dataset:", list(ds.data_vars))
print("Dimensions:", dict(ds.dims))

# Detect the time dimension name (may be 'lead_time' or 'max_lead_time')
time_dim = None
for candidate in ['lead_time', 'max_lead_time', 'time']:
    if candidate in ds.dims:
        time_dim = candidate
        break
if time_dim is None:
    raise RuntimeError(f"Cannot find time dimension. Dims: {dict(ds.dims)}")
print(f"Using time dimension: '{time_dim}' with {ds.dims[time_dim]} steps")

# Determine step size in hours (dataset is 6-hourly → 61 steps for 0-360h)
n_steps = ds.dims[time_dim]
# 15 days = 360h; steps-1 covers 0..360h if 6-hourly
# step index for Day N (hour N*24): index = N*24 // step_hours
step_hours = 360 // (n_steps - 1) if n_steps > 1 else 6  # usually 6
print(f"Inferred step size: {step_hours}h")

variables = [
    'track_probability',
    '34_knot_strike_probability',
    '50_knot_strike_probability',
    '64_knot_strike_probability',
]

for var_name in variables:
    if var_name not in ds.data_vars:
        print(f"Warning: {var_name} not found in dataset. Skipping.")
        continue

    print(f"Processing {var_name}...")

    # File is already CUMULATIVE — select the index closest to Day N * 24h
    for day in range(1, 16):
        target_hours = day * 24
        # Convert target hour to positional index (clamp to last available step)
        idx = min(target_hours // step_hours, n_steps - 1)

        # Select this single time slice (already cumulative at this point)
        ds_upto_day = ds.isel({time_dim: idx})

        # ds_upto_day is now a 2D (lat, lon) slice — already cumulative at this step
        data = ds_upto_day[var_name].values
        lons = ds.lon.values
        lats = ds.lat.values

        # Skip if no data reaches our lowest threshold
        if np.nanmax(data) < levels[0]:
            empty_geojson = {"type": "FeatureCollection", "features": []}
            with open(os.path.join(OUT_DIR, f"{var_name}_day{day}.json"), 'w') as f:
                json.dump(empty_geojson, f)
            continue

        fig, ax = plt.subplots()
        data[np.isnan(data)] = 0.0
        try:
            contour = ax.contourf(lons, lats, data, levels=levels)
        except (ValueError, TypeError):
            plt.close(fig)
            empty_geojson = {"type": "FeatureCollection", "features": []}
            with open(os.path.join(OUT_DIR, f"{var_name}_day{day}.json"), 'w') as f:
                json.dump(empty_geojson, f)
            continue

        geojson_str = geojsoncontour.contourf_to_geojson(contourf=contour, ndigits=3)
        plt.close(fig)

        out_path = os.path.join(OUT_DIR, f"{var_name}_day{day}.json")
        with open(out_path, 'w') as f:
            f.write(geojson_str)
        print(f"  Saved {out_path}")

# 4. Write metadata for frontend
meta = {
    "init_date": date_str,
    "init_hour": hour_str,
    "generated_at": datetime.now(timezone.utc).isoformat()
}
with open(os.path.join(OUT_DIR, "meta.json"), 'w') as f:
    json.dump(meta, f)

# ==============================================================================
# Map Pre-rendering Section
# ==============================================================================
MAPS_OUT_DIR = "public/assets/risk_maps"
os.makedirs(MAPS_OUT_DIR, exist_ok=True)

# 1. Load the provinces GeoJSON
print("Loading province boundaries for map rendering...")
geojson_paths = [
    "public/data/ph_provinces.json",
    "../public/data/ph_provinces.json",
    os.path.join(os.path.dirname(__file__), "public", "data", "ph_provinces.json")
]
found_geojson = None
for p in geojson_paths:
    if os.path.exists(p):
        found_geojson = p
        break

laguna_de_bay_coords = None
taal_lake_coords = None
volcano_island_coords = None

if not found_geojson:
    print("Warning: ph_provinces.json not found. Map rendering skipped.")
else:
    with open(found_geojson, 'r', encoding='utf-8') as f:
        prov_geojson = json.load(f)
    
    # Extract geometries for Laguna de Bay, Taal Lake, and Volcano Island
    try:
        laguna_feat = next(f for f in prov_geojson['features'] if f['properties'].get('PROVINCE') == 'Laguna' or f['properties'].get('NAME_1') == 'Laguna')
        if len(laguna_feat['geometry']['coordinates']) > 2:
            laguna_de_bay_coords = laguna_feat['geometry']['coordinates'][2]
    except Exception as e:
        print(f"Warning: Failed to extract Laguna de Bay coords: {e}")

    try:
        batangas_feat = next(f for f in prov_geojson['features'] if f['properties'].get('PROVINCE') == 'Batangas' or f['properties'].get('NAME_1') == 'Batangas')
        b_coords = batangas_feat['geometry']['coordinates']
        if len(b_coords) > 2 and len(b_coords[2]) > 1:
            taal_lake_coords = b_coords[2][1]
        if len(b_coords) > 3:
            volcano_island_coords = b_coords[3]
    except Exception as e:
        print(f"Warning: Failed to extract Taal coords: {e}")
    
    provinces_data = []
    for feat in prov_geojson['features']:
        name = feat['properties'].get('PROVINCE', feat['properties'].get('NAME_1', 'Unknown'))
        geom = shape(feat['geometry'])
        provinces_data.append({
            'name': name,
            'geometry': geom,
            'prep_geometry': prep(geom)
        })

    # 2. Precompute province grid point indices on a 0.05-degree grid
    print("Precomputing grid mapping for provinces...")
    grid_lats = np.arange(4.0, 22.0, 0.05)
    grid_lons = np.arange(115.0, 128.0, 0.05)
    grid_lon_mesh, grid_lat_mesh = np.meshgrid(grid_lons, grid_lats)
    grid_points = np.column_stack((grid_lon_mesh.ravel(), grid_lat_mesh.ravel()))
    
    province_grid_indices = {}
    for prov in provinces_data:
        geom = prov['geometry']
        prep_geom = prov['prep_geometry']
        minx, miny, maxx, maxy = geom.bounds
        
        # Filter grid points to bounding box first for speed
        bbox_mask = (grid_points[:, 0] >= minx) & (grid_points[:, 0] <= maxx) & \
                    (grid_points[:, 1] >= miny) & (grid_points[:, 1] <= maxy)
        indices_in_bbox = np.where(bbox_mask)[0]
        
        inside_indices = []
        for idx in indices_in_bbox:
            pt = Point(grid_points[idx])
            if prep_geom.contains(pt):
                lat_idx = idx // len(grid_lons)
                lon_idx = idx % len(grid_lons)
                inside_indices.append((lat_idx, lon_idx))
                
        # If the province is very small and contains no grid points, find the nearest grid point to its centroid
        if not inside_indices:
            centroid = geom.centroid
            cx, cy = centroid.x, centroid.y
            dists = (grid_points[:, 0] - cx)**2 + (grid_points[:, 1] - cy)**2
            nearest_idx = np.argmin(dists)
            lat_idx = nearest_idx // len(grid_lons)
            lon_idx = nearest_idx % len(grid_lons)
            inside_indices.append((lat_idx, lon_idx))
            
        province_grid_indices[prov['name']] = inside_indices

    # 3. Load tracks (paired active storms or ensemble mean fallbacks)
    def load_encrypted_dat(p_path):
        try:
            with open(p_path, 'r', encoding='utf-8') as f:
                content = f.read().strip()
            encrypted_bytes = base64.b64decode(content)
            decrypted_bytes = bytes([b ^ 0xAA for b in encrypted_bytes])
            csv_text = decrypted_bytes.decode('utf-8')
            df = pd.read_csv(io.StringIO(csv_text), comment='#')
            return df
        except Exception as e:
            print(f"Error loading {p_path}: {e}")
            return None

    tracks_to_plot = []
    
    # Try loading paired tracks first
    paired_df = None
    paired_paths = [
        "public/data/fnv3_large_paired_latest.dat",
        "public/data/fnv3_paired_latest.dat",
        os.path.join(os.path.dirname(__file__), "public/data/fnv3_large_paired_latest.dat")
    ]
    for p_path in paired_paths:
        if os.path.exists(p_path):
            try:
                paired_df = load_encrypted_dat(p_path)
                if paired_df is not None and not paired_df.empty:
                    # Check if it has actual data rows and is in Western Pacific basin
                    has_wp_active = False
                    for track_id, group in paired_df.groupby('track_id'):
                        glons = group['lon'].values
                        glons = np.where(glons > 180, glons - 360, glons)
                        glats = group['lat'].values
                        if np.any((glons >= 100) & (glons <= 165) & (glats >= -5) & (glats <= 45)):
                            has_wp_active = True
                            break
                    if has_wp_active:
                        print(f"Using paired tracks from {p_path}")
                        break
                    else:
                        paired_df = None
            except Exception:
                paired_df = None

    def get_pagasa_wind_color(wind_kmh):
        if pd.isna(wind_kmh) or np.isnan(wind_kmh):
            return '#64748b'
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

    if paired_df is not None and not paired_df.empty:
        print(f"Loaded active tracks. Columns: {list(paired_df.columns)}, Rows: {len(paired_df)}")
        for track_id, group in paired_df.groupby('track_id'):
            track_pts = group.sort_values(by='lead_time')
            track_lons = track_pts['lon'].values
            track_lats = track_pts['lat'].values
            track_lons = np.where(track_lons > 180, track_lons - 360, track_lons)
            
            # Check if in basin
            in_basin = (track_lons >= 100) & (track_lons <= 165) & (track_lats >= -5) & (track_lats <= 45)
            if not np.any(in_basin):
                continue
            
            track_lons = track_lons[in_basin]
            track_lats = track_lats[in_basin]
            
            colors = []
            for idx, row in track_pts[in_basin].iterrows():
                wind_kt = row.get('maximum_sustained_wind_speed_knots', float('nan'))
                wind_kmh = np.nan if np.isnan(wind_kt) else round(wind_kt * 1.852)
                colors.append(get_pagasa_wind_color(wind_kmh))
            
            tracks_to_plot.append({
                'id': track_id,
                'lons': track_lons,
                'lats': track_lats,
                'colors': colors,
                'is_paired': True
            })
    else:
        # Fallback to ensemble tracks from fnv3_large_latest.dat
        print("No active paired storm found. Loading ensemble mean tracks from fnv3_large_latest.dat...")
        large_paths = [
            "public/data/fnv3_large_latest.dat",
            "public/data/fnv3_base_latest.dat",
            os.path.join(os.path.dirname(__file__), "public/data/fnv3_large_latest.dat")
        ]
        large_df = None
        for l_path in large_paths:
            if os.path.exists(l_path):
                large_df = load_encrypted_dat(l_path)
                if large_df is not None and not large_df.empty:
                    break
        
        if large_df is not None:
            candidate_tracks = []
            # Group by track_id
            for track_id, group in large_df.groupby('track_id'):
                group = group.dropna(subset=['lat', 'lon'])
                if len(group) < 30: # Skip very minor development signals
                    continue
                
                # Compute member count
                member_count = len(group['sample'].unique())
                if member_count < 100: # Require at least 10% member support (100 out of 1000)
                    continue
                
                # Compute mean starting coordinates
                min_lt = group['lead_time_hours'].min()
                start_pts = group[group['lead_time_hours'] == min_lt]
                start_lon = start_pts['lon'].median()
                start_lat = start_pts['lat'].median()
                if start_lon > 180:
                    start_lon -= 360
                    
                # Only plot if start point is in the broad Western Pacific area
                if not (100 <= start_lon <= 165 and -5 <= start_lat <= 45):
                    continue
                    
                # Normalize group longitudes to [-180, 180] before computing median
                group_lons = group['lon'].values
                group['lon'] = np.where(group_lons > 180, group_lons - 360, group_lons)
                
                # Compute median track at each lead hour
                mean_track = group.groupby('lead_time_hours')[['lat', 'lon', 'maximum_sustained_wind_speed_knots']].median().reset_index()
                mean_track = mean_track.sort_values(by='lead_time_hours')
                
                track_lons = mean_track['lon'].values
                track_lats = mean_track['lat'].values
                
                # Filter track coordinates strictly to the Eastern Hemisphere/Western Pacific [100, 180]
                in_basin = (track_lons >= 100) & (track_lons <= 180) & (track_lats >= -5) & (track_lats <= 45)
                if not np.any(in_basin):
                    continue
                    
                track_lons = track_lons[in_basin]
                track_lats = track_lats[in_basin]
                
                # Compute colors based on median wind speed
                colors = []
                for idx, row in mean_track[in_basin].iterrows():
                    wind_kt = row.get('maximum_sustained_wind_speed_knots', float('nan'))
                    wind_kmh = np.nan if np.isnan(wind_kt) else round(wind_kt * 1.852)
                    colors.append(get_pagasa_wind_color(wind_kmh))
                    
                candidate_tracks.append({
                    'id': f"Mean Track {track_id}",
                    'lons': track_lons,
                    'lats': track_lats,
                    'colors': colors,
                    'is_paired': False,
                    'member_count': member_count
                })
            
            # Sort candidate tracks by member agreement descending
            candidate_tracks.sort(key=lambda t: t['member_count'], reverse=True)
            
            # Only keep the top 1 most significant track to keep the map clean!
            tracks_to_plot.extend(candidate_tracks[:1])

    # Color mapping for probability values
    def get_probability_color(val):
        if val < 0.05: return '#DEB887' # Same as land color so it blends!
        if val < 0.10: return "#1d4ed8" # Royal Blue
        if val < 0.20: return "#38bdf8" # Light Blue
        if val < 0.30: return "#34d399" # Emerald Green
        if val < 0.50: return "#facc15" # Yellow
        if val < 0.70: return "#f97316" # Orange
        return "#dc2626"                # Red

    # Variable labels for the map display
    var_labels = {
        'track_probability': 'Track Probability',
        '34_knot_strike_probability': '34-knot (TS) Strike Probability',
        '50_knot_strike_probability': '50-knot (STS) Strike Probability',
        '64_knot_strike_probability': '64-knot (TY) Strike Probability'
    }

    # 4. Generate map for each variable (15-day cumulative)
    for var_name in variables:
        if var_name not in ds.data_vars:
            continue
        
        print(f"Generating 15-day cumulative map for {var_name}...")
        
        # Select the 15-day (index 60 or last) time slice
        ds_day15 = ds.isel({time_dim: n_steps - 1})
        
        # Interpolate the NetCDF data to our 0.05-degree grid
        grid_ds = ds_day15[var_name].interp(lat=grid_lats, lon=grid_lons, method='linear')
        grid_values = grid_ds.values
        grid_values = np.nan_to_num(grid_values, nan=0.0)
        
        # Calculate maximum probability for each province
        prov_colors = {}
        for name, indices in province_grid_indices.items():
            vals = [grid_values[lat_idx, lon_idx] for lat_idx, lon_idx in indices]
            max_val = np.max(vals) if vals else 0.0
            prov_colors[name] = get_probability_color(max_val)
            
        # Determine zoom extent (defaults centered on Philippines)
        lat_min, lat_max = 4.0, 22.0
        lon_min, lon_max = 114.0, 131.0
        
        # 1. Expand to frame areas with >= 5% cumulative probability
        high_risk_indices = np.where(grid_values >= 0.05)
        has_risk_area = False
        if len(high_risk_indices[0]) > 0:
            matching_lats = grid_lats[high_risk_indices[0]]
            matching_lons = grid_lons[high_risk_indices[1]]
            lat_min = np.min(matching_lats) - 2.5
            lat_max = np.max(matching_lats) + 2.5
            lon_min = np.min(matching_lons) - 2.5
            lon_max = np.max(matching_lons) + 2.5
            has_risk_area = True
            
        # 2. Expand to frame track coordinates
        track_lats_all = []
        track_lons_all = []
        for t in tracks_to_plot:
            track_lons_all.extend(t['lons'])
            track_lats_all.extend(t['lats'])
            
        if track_lons_all and track_lats_all:
            if not has_risk_area:
                lat_min = np.min(track_lats_all) - 2.5
                lat_max = np.max(track_lats_all) + 2.5
                lon_min = np.min(track_lons_all) - 2.5
                lon_max = np.max(track_lons_all) + 2.5
            else:
                lat_min = min(lat_min, np.min(track_lats_all) - 2.5)
                lat_max = max(lat_max, np.max(track_lats_all) + 2.5)
                lon_min = min(lon_min, np.min(track_lons_all) - 2.5)
                lon_max = max(lon_max, np.max(track_lons_all) + 2.5)
                
        # 3. Clamp final bounds to PlateCarree domain bounds / Philippines region focus
        lat_min = max(lat_min, 4.0)
        lat_max = min(lat_max, 25.0)
        lon_min = max(lon_min, 112.0)
        lon_max = min(lon_max, 138.0)
        
        # Enforce minimum span (at least 8.0 degrees)
        min_span = 8.0
        if (lat_max - lat_min) < min_span:
            center_lat = (lat_max + lat_min) / 2.0
            lat_min = max(center_lat - (min_span / 2.0), 4.0)
            lat_max = min(center_lat + (min_span / 2.0), 25.0)
        if (lon_max - lon_min) < min_span:
            center_lon = (lon_max + lon_min) / 2.0
            lon_min = max(center_lon - (min_span / 2.0), 112.0)
            lon_max = min(center_lon + (min_span / 2.0), 138.0)

        # Create map plot
        fig = plt.figure(figsize=(10, 10))
        ax = plt.axes(projection=ccrs.PlateCarree())
        ax.set_extent([lon_min, lon_max, lat_min, lat_max], crs=ccrs.PlateCarree())
        
        # Set ocean background color
        ax.set_facecolor('#87CEEB')
        
        # Add basic geography features
        ax.add_feature(cfeature.LAND, facecolor='#DEB887', edgecolor='#8B4513', linewidth=0.8, zorder=1)
        ax.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.8, alpha=0.7, color='#654321', zorder=2)
        
        # Add colored provinces
        for prov in provinces_data:
            name = prov['name']
            geom = prov['geometry']
            color = prov_colors.get(name, '#DEB887')
            
            # Use borders matching forecast.py
            ax.add_geometries([geom], crs=ccrs.PlateCarree(),
                              facecolor=color, edgecolor='#654321',
                              linewidth=0.4, alpha=0.85, zorder=3)

        # Draw Laguna de Bay (filled with ocean background color #87CEEB, zorder=3.5)
        if laguna_de_bay_coords is not None:
            try:
                laguna_de_bay = shape({
                    "type": "Polygon",
                    "coordinates": [laguna_de_bay_coords]
                })
                ax.add_geometries([laguna_de_bay], crs=ccrs.PlateCarree(),
                                  facecolor='#87CEEB', edgecolor='#654321',
                                  linewidth=0.4, zorder=3.5)
            except Exception as e:
                print(f"Warning: Failed to render Laguna de Bay: {e}")

        # Draw Taal Lake (filled with ocean background color #87CEEB, zorder=3.6)
        if taal_lake_coords is not None:
            try:
                taal_lake = shape({
                    "type": "Polygon",
                    "coordinates": [taal_lake_coords]
                })
                ax.add_geometries([taal_lake], crs=ccrs.PlateCarree(),
                                  facecolor='#87CEEB', edgecolor='#654321',
                                  linewidth=0.4, zorder=3.6)
            except Exception as e:
                print(f"Warning: Failed to render Taal Lake: {e}")

        # Draw Volcano Island (filled with land background color #DEB887, zorder=3.7)
        if volcano_island_coords is not None:
            try:
                volcano_island = shape({
                    "type": "Polygon",
                    "coordinates": volcano_island_coords
                })
                ax.add_geometries([volcano_island], crs=ccrs.PlateCarree(),
                                  facecolor='#DEB887', edgecolor='#654321',
                                  linewidth=0.4, zorder=3.7)
            except Exception as e:
                print(f"Warning: Failed to render Volcano Island: {e}")
                              
        # Add PAR (Philippine Area of Responsibility) boundary
        par_vertices = [
            (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
            (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
        ]
        ax.add_patch(mpatches.Polygon(par_vertices, facecolor='none', edgecolor='#FF6B35', 
                                     linestyle='-', linewidth=3, alpha=0.8, 
                                     transform=ccrs.PlateCarree(), zorder=4))
                                     
        # Plot tracks
        for t in tracks_to_plot:
            line_style = '-' if t['is_paired'] else '--'
            line_color = '#1e293b' if t['is_paired'] else '#475569'
            line_width = 2.5 if t['is_paired'] else 2.0
            
            # Plot track line
            ax.plot(t['lons'], t['lats'], color=line_color, linewidth=line_width, 
                    linestyle=line_style, zorder=5, transform=ccrs.PlateCarree())
            
            # Plot markers along the track
            for i, (lon, lat) in enumerate(zip(t['lons'], t['lats'])):
                color = t['colors'][i]
                # Outer shadow, then hollow colored circle
                ax.plot(lon, lat, color='black', marker='o', markersize=6 if t['is_paired'] else 5, 
                        markeredgewidth=0, alpha=0.3, zorder=6, transform=ccrs.PlateCarree())
                ax.plot(lon, lat, markerfacecolor='none', markeredgecolor=color, marker='o', 
                        markersize=5 if t['is_paired'] else 4, markeredgewidth=1.8 if t['is_paired'] else 1.3, 
                        zorder=7, transform=ccrs.PlateCarree())
                    
        # Add nice clean gridlines
        gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
        
        # Select grid step dynamically based on final spans
        lon_span = lon_max - lon_min
        lat_span = lat_max - lat_min
        if max(lon_span, lat_span) <= 12.0:
            step = 2
        elif max(lon_span, lat_span) <= 25.0:
            step = 5
        else:
            step = 10
            
        gl.xlocator = plt.FixedLocator(np.arange(100, 160, step))
        gl.ylocator = plt.FixedLocator(np.arange(-10, 50, step))
        gl.xlabel_style = {'size': 12, 'weight': 'bold', 'color': '#64748b'}
        gl.ylabel_style = {'size': 12, 'weight': 'bold', 'color': '#64748b'}
        gl.top_labels = False
        gl.right_labels = False
        
        # Add elegant legend
        legend_patches = [
            mpatches.Patch(color='#1d4ed8', label='5% – 10%'),
            mpatches.Patch(color='#38bdf8', label='10% – 20%'),
            mpatches.Patch(color='#34d399', label='20% – 30%'),
            mpatches.Patch(color='#facc15', label='30% – 50%'),
            mpatches.Patch(color='#f97316', label='50% – 70%'),
            mpatches.Patch(color='#dc2626', label='≥ 70%')
        ]
        leg = ax.legend(handles=legend_patches, loc='lower left', title='Strike Probability',
                        frameon=False, fontsize=8, title_fontsize=9)
        leg.set_zorder(10)
        leg.get_title().set_weight('bold')
        leg.get_title().set_color('#1e293b')
        for text in leg.get_texts():
            text.set_weight('bold')
            text.set_color('#1e293b')
                  
        # Add metadata text box
        init_dt_str = f"{date_str} {hour_str}:00 UTC"
        var_label = var_labels.get(var_name, var_name)
        text_box_content = (
            f"Potential Risk Area\n"
            f"15-Day Cumulative {var_label}\n"
            f"Model: GDM-FNV3 Large\n"
            f"Run: {init_dt_str}"
        )
        ax.text(0.97, 0.97, text_box_content, transform=ax.transAxes, fontsize=8,
                verticalalignment='top', horizontalalignment='right',
                color='#1e293b', weight='bold',
                zorder=10)
                
        # Add watermark on the bottom right
        ax.text(0.98, 0.02, "Philippine Typhoon/Weather", transform=ax.transAxes,
                fontsize=10, color='#1e293b', weight='bold', alpha=0.6,
                ha='right', va='bottom', zorder=100)
                
        # Save high quality PNG
        out_path = os.path.join(MAPS_OUT_DIR, f"risk_map_{var_name}.png")
        plt.savefig(out_path, dpi=200, bbox_inches='tight')
        plt.close(fig)
        print(f"Saved pre-rendered map to {out_path}")

print("Strike probability processing complete.")

# 5. Cleanup NetCDF to save space (GitHub Actions runner)
ds.close()
if os.path.exists(local_nc):
    try:
        os.remove(local_nc)
    except PermissionError:
        pass  # Non-critical on Windows; GitHub Actions (Linux) won't have this issue
