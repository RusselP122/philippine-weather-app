import subprocess
import base64
import gzip
import xarray as xr
import os
import math
import sys
sys.setrecursionlimit(10000)
import io
import json
import time
import logging
import numpy as np
from datetime import datetime, timedelta, timezone
import matplotlib.pyplot as plt
import urllib.request
import geojsoncontour
import pandas as pd
from shapely.geometry import shape, Point
from shapely.prepared import prep
import matplotlib.patches as mpatches   
import cartopy.crs as ccrs
import cartopy.feature as cfeature

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Ensure output directories exist
OUT_DIR = "public/data/strike_prob"
MAPS_OUT_DIR = "public/assets/risk_maps"
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(MAPS_OUT_DIR, exist_ok=True)

# Correct URL structure (discovered from WeatherLab):
BASE = (
    "https://deepmind.google.com/science/weatherlab/download/cyclones/"
    "FNV3_LARGE_ENSEMBLE/ensemble/cyclogenesis/netcdf/cumulative_probability_fields"
)

def curl_status(url):
    """Return HTTP status code for a URL using urllib HEAD request with fallbacks."""
    try:
        req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'WeatherApp/1.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as e:
        if e.code in (404, 403, 500, 502, 503, 504):
            return e.code
        try:
            req = urllib.request.Request(url, method='GET', headers={'User-Agent': 'WeatherApp/1.0'})
            with urllib.request.urlopen(req, timeout=10) as response:
                return response.status
        except urllib.error.HTTPError as e_inner:
            return e_inner.code
        except Exception:
            return 0
    except Exception:
        try:
            result = subprocess.run(
                ["curl", "-s", "-I", "-o", os.devnull, "-w", "%{http_code}",
                 "--max-time", "15", "-L", url],
                capture_output=True, text=True, timeout=20
            )
            return int(result.stdout.strip())
        except Exception:
            return 0

def load_fnv3_base_spaghetti_tracks():
    """Load and decrypt FNV3 Base spaghetti tracks (individual ensemble member tracks) in the Western Pacific."""
    base_dat_paths = [
        "public/data/fnv3p2_latest.dat",
        "../public/data/fnv3p2_latest.dat",
        os.path.join(os.path.dirname(__file__), "public", "data", "fnv3p2_latest.dat")
    ]
    found_path = None
    for p in base_dat_paths:
        if os.path.exists(p):
            found_path = p
            break
            
    if not found_path:
        logger.warning("fnv3p2_latest.dat not found. No spaghetti tracks plotted.")
        return []
        
    try:
        # Decode obfuscated DAT to CSV text
        with open(found_path, 'r', encoding='utf-8') as f:
            content = f.read().strip()
        encrypted_bytes = base64.b64decode(content)
        decrypted_bytes = bytes([b ^ 0xAA for b in encrypted_bytes])
        csv_text = decrypted_bytes.decode('utf-8')
        
        # Read with pandas
        df = pd.read_csv(io.StringIO(csv_text), comment='#')
        # Filter for ensemble members (sample >= 0)
        df = df[df['sample'] >= 0]
        
        tracks = []
        # Group by (track_id, sample) to get individual member tracks
        for (track_id, sample), group in df.groupby(['track_id', 'sample']):
            group = group.sort_values(by='lead_time_hours')
            group = group.dropna(subset=['lat', 'lon'])
            
            lons = group['lon'].values
            lats = group['lat'].values
            # Normalize longitude to -180..180 range
            lons = np.where(lons > 180, lons - 360, lons)
            
            if len(lons) == 0:
                continue
                
            # Filter to Western Pacific region (either starts with WP or has points in WP region: 100..180E, -5..45N)
            is_wp = str(track_id).upper().startswith('WP') or (100 <= lons[0] <= 180 and -5 <= lats[0] <= 45)
            if not is_wp:
                continue
                
            tracks.append({
                'track_id': track_id,
                'sample': sample,
                'lons': lons,
                'lats': lats
            })
            
        logger.info(f"Loaded {len(tracks)} Western Pacific base spaghetti tracks from {found_path}")
        return tracks
    except Exception as e:
        logger.warning(f"Error loading base spaghetti tracks: {e}")
        return []

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
            logger.info(f"  Checking {date_str}T{h}...")
            status = curl_status(url)
            if status == 200:
                logger.info(f"  Found: {date_str}T{h}:00 UTC (HTTP 200)")
                return date_str, h, url
            else:
                logger.info(f"  {date_str}T{h}: HTTP {status}, skipping.")

    raise RuntimeError("No available cumulative probability runs found in the last 5 days.")

def process_strike_probabilities():
    logger.info("Fetching latest cumulative probability URL...")
    date_str, hour_str, url = get_latest_run_url()
    
    local_b64 = f"strike_prob_{date_str}_{hour_str}.nc.gz.base64"
    local_nc  = f"strike_prob_{date_str}_{hour_str}.nc"
    
    # Check if cached NetCDF exists
    if os.path.exists(local_nc):
        logger.info(f"Using cached {local_nc} (skip download).")
    else:
        # 1. Download the base64-encoded gzipped NetCDF
        logger.info(f"Downloading {url} ...")
        subprocess.run(
            ["curl", "-L", "-o", local_b64, "--retry", "3", "--max-time", "1200", url],
            check=True
        )
        logger.info("Download complete.")
        
        # 2. Decode base64 → gzip → NetCDF bytes, write as .nc
        logger.info("Decoding base64 + decompressing gzip...")
        try:
            with open(local_b64, "rb") as f:
                b64_data = f.read()
            gz_data = base64.b64decode(b64_data)
            nc_data  = gzip.decompress(gz_data)
            with open(local_nc, "wb") as f:
                f.write(nc_data)
            logger.info(f"Decoded NetCDF written to {local_nc}")
        finally:
            # Clean up base64 file
            if os.path.exists(local_b64):
                os.remove(local_b64)
                
    # 3. Process dataset with xarray
    levels = [0.05, 0.10, 0.20, 0.30, 0.50, 0.70, 1.01]
    
    logger.info("Processing NetCDF with xarray...")
    ds = xr.open_dataset(local_nc)
    
    try:
        logger.info(f"Variables in dataset: {list(ds.data_vars)}")
        logger.info(f"Dimensions: {dict(ds.dims)}")
        
        # Detect time dimension
        time_dim = None
        for candidate in ['lead_time', 'max_lead_time', 'time']:
            if candidate in ds.dims:
                time_dim = candidate
                break
        if time_dim is None:
            raise RuntimeError(f"Cannot find time dimension. Dims: {dict(ds.dims)}")
        logger.info(f"Using time dimension: '{time_dim}' with {ds.dims[time_dim]} steps")
        
        # Step size
        n_steps = ds.dims[time_dim]
        step_hours = 360 // (n_steps - 1) if n_steps > 1 else 6
        logger.info(f"Inferred step size: {step_hours}h")
        
        variables = [
            'track_probability',
            '34_knot_strike_probability',
            '50_knot_strike_probability',
            '64_knot_strike_probability',
        ]
        
        for var_name in variables:
            if var_name not in ds.data_vars:
                logger.warning(f"{var_name} not found in dataset. Skipping.")
                continue
                
            logger.info(f"Processing {var_name}...")
            
            for day in range(1, 16):
                target_hours = day * 24
                idx = min(target_hours // step_hours, n_steps - 1)
                ds_upto_day = ds.isel({time_dim: idx})
                
                data = ds_upto_day[var_name].values
                lons = ds.lon.values
                lats = ds.lat.values
                
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
                logger.info(f"  Saved {out_path}")
                
        # Write metadata for frontend
        meta = {
            "init_date": date_str,
            "init_hour": hour_str,
            "generated_at": datetime.now(timezone.utc).isoformat()
        }
        with open(os.path.join(OUT_DIR, "meta.json"), 'w') as f:
            json.dump(meta, f)
            
        # Pre-render maps
        pre_render_maps(ds, date_str, hour_str, time_dim, n_steps, variables)
        
    finally:
        ds.close()
        if os.path.exists(local_nc):
            try:
                os.remove(local_nc)
                logger.info(f"Removed temporary NetCDF file: {local_nc}")
            except PermissionError:
                logger.warning(f"Could not remove {local_nc} (PermissionError)")

def pre_render_maps(ds, date_str, hour_str, time_dim, n_steps, variables):
    logger.info("Loading province boundaries for map rendering...")
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
        logger.warning("ph_provinces.json not found. Map rendering skipped.")
        return
        
    with open(found_geojson, 'r', encoding='utf-8') as f:
        prov_geojson = json.load(f)
        
    try:
        laguna_feat = next(f for f in prov_geojson['features'] if f['properties'].get('PROVINCE') == 'Laguna' or f['properties'].get('NAME_1') == 'Laguna')
        if len(laguna_feat['geometry']['coordinates']) > 2:
            laguna_de_bay_coords = laguna_feat['geometry']['coordinates'][2]
    except Exception as e:
        logger.warning(f"Failed to extract Laguna de Bay coords: {e}")

    try:
        batangas_feat = next(f for f in prov_geojson['features'] if f['properties'].get('PROVINCE') == 'Batangas' or f['properties'].get('NAME_1') == 'Batangas')
        b_coords = batangas_feat['geometry']['coordinates']
        if len(b_coords) > 2 and len(b_coords[2]) > 1:
            taal_lake_coords = b_coords[2][1]
        if len(b_coords) > 3:
            volcano_island_coords = b_coords[3]
    except Exception as e:
        logger.warning(f"Failed to extract Taal coords: {e}")
        
    provinces_data = []
    for feat in prov_geojson['features']:
        if feat.get('geometry') is None:
            continue
        name = feat['properties'].get('PROVINCE', feat['properties'].get('NAME_1', 'Unknown'))
        geom = shape(feat['geometry'])
        provinces_data.append({
            'name': name,
            'geometry': geom,
            'prep_geometry': prep(geom)
        })

    muni_geojson_paths = [
        "public/data/ph_municipalities.json",
        "../public/data/ph_municipalities.json",
        os.path.join(os.path.dirname(__file__), "public", "data", "ph_municipalities.json")
    ]
    found_muni_geojson = None
    for p in muni_geojson_paths:
        if os.path.exists(p):
            found_muni_geojson = p
            break

    municipalities_data = []
    if found_muni_geojson:
        logger.info(f"Loading municipality boundaries from {found_muni_geojson}...")
        with open(found_muni_geojson, 'r', encoding='utf-8') as f:
            muni_geojson = json.load(f)
        for feat in muni_geojson['features']:
            if feat.get('geometry') is None:
                continue
            prov = feat['properties'].get('PROVINCE', feat['properties'].get('NAME_1', 'Unknown'))
            name = feat['properties'].get('NAME_2', 'Unknown')
            key = f"{prov}_{name}"
            geom = shape(feat['geometry'])
            municipalities_data.append({
                'key': key,
                'name': name,
                'province': prov,
                'geometry': geom,
                'prep_geometry': prep(geom)
            })
    else:
        logger.warning("ph_municipalities.json not found.")
        return

    # Cache grid mapping parameters
    cache_path = "public/data/strike_prob/muni_grid_mapping.json"
    grid_params = {
        "lat_min": 4.0,
        "lat_max": 22.0,
        "lat_step": 0.05,
        "lon_min": 115.0,
        "lon_max": 128.0,
        "lon_step": 0.05
    }
    
    municipality_grid_indices = None
    if os.path.exists(cache_path):
        logger.info("Checking precomputed municipality grid mapping cache...")
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                cache_data = json.load(f)
            if cache_data.get("grid_params") == grid_params:
                municipality_grid_indices = cache_data.get("mapping")
                logger.info("Loaded grid mapping from cache successfully.")
            else:
                logger.info("Cache parameters mismatch. Recomputing...")
        except Exception as e:
            logger.warning(f"Failed to load cache: {e}. Recomputing...")

    if municipality_grid_indices is None:
        logger.info("Precomputing grid mapping for municipalities (this may take a few seconds)...")
        t_start = time.time()
        grid_lats = np.arange(grid_params["lat_min"], grid_params["lat_max"], grid_params["lat_step"])
        grid_lons = np.arange(grid_params["lon_min"], grid_params["lon_max"], grid_params["lon_step"])
        grid_lon_mesh, grid_lat_mesh = np.meshgrid(grid_lons, grid_lats)
        grid_points = np.column_stack((grid_lon_mesh.ravel(), grid_lat_mesh.ravel()))
        
        municipality_grid_indices = {}
        for muni in municipalities_data:
            geom = muni['geometry']
            prep_geom = muni['prep_geometry']
            minx, miny, maxx, maxy = geom.bounds
            
            bbox_mask = (grid_points[:, 0] >= minx) & (grid_points[:, 0] <= maxx) & \
                        (grid_points[:, 1] >= miny) & (grid_points[:, 1] <= maxy)
            indices_in_bbox = np.where(bbox_mask)[0]
            
            inside_indices = []
            for idx in indices_in_bbox:
                pt = Point(grid_points[idx])
                if prep_geom.contains(pt):
                    lat_idx = idx // len(grid_lons)
                    lon_idx = idx % len(grid_lons)
                    inside_indices.append((int(lat_idx), int(lon_idx)))
                    
            if not inside_indices:
                centroid = geom.centroid
                cx, cy = centroid.x, centroid.y
                dists = (grid_points[:, 0] - cx)**2 + (grid_points[:, 1] - cy)**2
                nearest_idx = np.argmin(dists)
                lat_idx = nearest_idx // len(grid_lons)
                lon_idx = nearest_idx % len(grid_lons)
                inside_indices.append((int(lat_idx), int(lon_idx)))
                
            municipality_grid_indices[muni['key']] = inside_indices
        logger.info(f"Precompute finished in {time.time() - t_start:.3f}s")
        
        try:
            with open(cache_path, 'w', encoding='utf-8') as f:
                json.dump({"grid_params": grid_params, "mapping": municipality_grid_indices}, f)
            logger.info(f"Saved municipality grid mapping cache to {cache_path}")
        except Exception as e:
            logger.warning(f"Failed to save cache: {e}")

    # Load base spaghetti tracks (strictly WP basin only)
    tracks_to_plot = load_fnv3_base_spaghetti_tracks()

    # Color mapping for probability values
    def get_probability_color(val):
        if val < 0.05: return '#DEB887' # blends with land background
        if val < 0.10: return "#1d4ed8" # Royal Blue
        if val < 0.20: return "#38bdf8" # Light Blue
        if val < 0.30: return "#34d399" # Emerald Green
        if val < 0.50: return "#facc15" # Yellow
        if val < 0.70: return "#f97316" # Orange
        return "#dc2626"                # Red

    var_labels = {
        'track_probability': 'Track Probability',
        '34_knot_strike_probability': '34-knot (TS) Strike Probability',
        '50_knot_strike_probability': '50-knot (STS) Strike Probability',
        '64_knot_strike_probability': '64-knot (TY) Strike Probability'
    }

    grid_lats = np.arange(grid_params["lat_min"], grid_params["lat_max"], grid_params["lat_step"])
    grid_lons = np.arange(grid_params["lon_min"], grid_params["lon_max"], grid_params["lon_step"])

    # Generate map for each variable (15-day cumulative)
    for var_name in variables:
        if var_name not in ds.data_vars:
            continue
            
        logger.info(f"Generating 15-day cumulative map for {var_name}...")
        
        ds_day15 = ds.isel({time_dim: n_steps - 1})
        grid_ds = ds_day15[var_name].interp(lat=grid_lats, lon=grid_lons, method='linear')
        grid_values = grid_ds.values
        grid_values = np.nan_to_num(grid_values, nan=0.0)
        
        # Calculate maximum probability for each municipality
        muni_colors = {}
        for key, indices in municipality_grid_indices.items():
            vals = [grid_values[lat_idx, lon_idx] for lat_idx, lon_idx in indices]
            max_val = np.max(vals) if vals else 0.0
            muni_colors[key] = get_probability_color(max_val)
            
        # Determine zoom extent
        lat_min, lat_max = 4.0, 22.0
        lon_min, lon_max = 114.0, 131.0
        
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
                
        # Clamp bounds
        lat_min = max(lat_min, 4.0)
        lat_max = min(lat_max, 25.0)
        lon_min = max(lon_min, 112.0)
        lon_max = min(lon_max, 138.0)
        
        min_span = 8.0
        if (lat_max - lat_min) < min_span:
            center_lat = (lat_max + lat_min) / 2.0
            lat_min = max(center_lat - (min_span / 2.0), 4.0)
            lat_max = min(center_lat + (min_span / 2.0), 25.0)
        if (lon_max - lon_min) < min_span:
            center_lon = (lon_max + lon_min) / 2.0
            lon_min = max(center_lon - (min_span / 2.0), 112.0)
            lon_max = min(center_lon + (min_span / 2.0), 138.0)

        # Create plot
        fig = plt.figure(figsize=(10, 10), facecolor='white')
        ax = fig.add_axes([0.08, 0.05, 0.88, 0.85], projection=ccrs.PlateCarree())
        ax.set_extent([lon_min, lon_max, lat_min, lat_max], crs=ccrs.PlateCarree())
        
        # Ocean background
        ax.set_facecolor('#87CEEB')
        
        # Land features
        ax.add_feature(cfeature.LAND, facecolor='#DEB887', edgecolor='#8B4513', linewidth=0.8, zorder=1)
        ax.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.8, alpha=0.7, color='#654321', zorder=2)
        
        # Group municipalities by color to batch add_geometries
        color_groups = {}
        for muni in municipalities_data:
            key = muni['key']
            color = muni_colors.get(key, '#DEB887')
            if color != '#DEB887':
                color_groups.setdefault(color, []).append(muni['geometry'])
                
        # Draw batch-grouped municipalities
        for color, geoms in color_groups.items():
            ax.add_geometries(geoms, crs=ccrs.PlateCarree(),
                              facecolor=color, edgecolor='#451a03',
                              linewidth=0.25, alpha=0.85, zorder=3)

        # Add province outlines on top
        province_geoms = [prov['geometry'] for prov in provinces_data]
        ax.add_geometries(province_geoms, crs=ccrs.PlateCarree(),
                          facecolor='none', edgecolor='#654321',
                          linewidth=0.6, zorder=3.2)

        # Draw Laguna de Bay
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
                logger.warning(f"Failed to render Laguna de Bay: {e}")

        # Draw Taal Lake
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
                logger.warning(f"Failed to render Taal Lake: {e}")

        # Draw Volcano Island
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
                logger.warning(f"Failed to render Volcano Island: {e}")
                              
        # PAR Boundary
        par_vertices = [
            (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
            (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
        ]
        ax.add_patch(mpatches.Polygon(par_vertices, facecolor='none', edgecolor='#FF6B35', 
                                     linestyle='-', linewidth=3, alpha=0.8, 
                                     transform=ccrs.PlateCarree(), zorder=4))
                                     
        # Plot tracks (Solid light gray spaghetti lines)
        for t in tracks_to_plot:
            line_style = '-'
            line_color = '#475569'  # slate-600 (darker blue-gray for visibility on blue ocean)
            line_width = 1.1        # slightly thicker to show spread clearly
            line_alpha = 0.55       # more opaque to stand out
            
            # Smooth coordinates using B-spline interpolation (requires smooth_track helper to be imported/defined)
            from scipy.interpolate import splprep, splev
            # Re-define smooth_track inline here to ensure it's available since we removed it from top
            def smooth_track_local(lons, lats):
                if len(lons) < 4:
                    return lons, lats
                try:
                    clean_lons = [lons[0]]
                    clean_lats = [lats[0]]
                    for i in range(1, len(lons)):
                        if lons[i] != lons[i-1] or lats[i] != lats[i-1]:
                            clean_lons.append(lons[i])
                            clean_lats.append(lats[i])
                    if len(clean_lons) < 4:
                        return lons, lats
                    tck, u = splprep([clean_lons, clean_lats], s=0)
                    u_new = np.linspace(0, 1, 100)
                    return splev(u_new, tck)
                except Exception:
                    return lons, lats
            
            smooth_lons, smooth_lats = smooth_track_local(t['lons'], t['lats'])
            
            ax.plot(smooth_lons, smooth_lats, color=line_color, linewidth=line_width, alpha=line_alpha,
                    linestyle=line_style, zorder=5, transform=ccrs.PlateCarree())
                    
        # Gridlines
        gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
        
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
        
        # Draw horizontal colorbar for strike probabilities
        import matplotlib.colors as mcolors
        cb_levels = [0.05, 0.10, 0.20, 0.30, 0.50, 0.70, 1.01]
        cb_colors = ["#1d4ed8", "#38bdf8", "#34d399", "#facc15", "#f97316", "#dc2626"]
        cb_cmap = mcolors.ListedColormap(cb_colors)
        cb_norm = mcolors.BoundaryNorm(cb_levels, ncolors=len(cb_colors))
        
        sm = plt.cm.ScalarMappable(cmap=cb_cmap, norm=cb_norm)
        sm.set_array([])
        
        cb = fig.colorbar(sm, ax=ax, orientation='horizontal', pad=0.04, shrink=0.75, extend='neither')
        cb.set_ticks(cb_levels)
        cb.set_ticklabels(['5%', '10%', '20%', '30%', '50%', '70%', '100%'])
        cb.ax.tick_params(labelsize=9, colors='#1e293b')
        for label in cb.ax.get_xticklabels():
            label.set_weight('bold')
        cb.set_label("Strike Probability", fontsize=9, weight='bold', color='#1e293b', labelpad=4)
        cb.outline.set_edgecolor("#cbd5e1")
        cb.outline.set_linewidth(1.5)
        
        # Legend: tracks
        track_handles = []
        if len(tracks_to_plot) > 0:
            track_handles.append(plt.Line2D([0], [0], color='#94a3b8', linewidth=1.5, alpha=0.7, linestyle='-', label='Ensemble Tracks'))
            
        if track_handles:
            leg_mean = ax.legend(handles=track_handles, loc='upper right', frameon=True, facecolor='white', edgecolor='#cbd5e1', fontsize=8)
            leg_mean.set_zorder(10)
        
        # Warnings & Watermarks
        warning_text = (
            "This is an experimental guidance product and should\n"
            "not be used for critical decision-making.\n"
            "Always refer to PAGASA for official warnings."
        )
        ax.text(0.98, 0.08, warning_text, transform=ax.transAxes, fontsize=6.5,
                color='red', weight='bold', verticalalignment='bottom', horizontalalignment='right',
                bbox=dict(facecolor='white', alpha=0.85, edgecolor='#cbd5e1', boxstyle='round,pad=0.2'),
                zorder=10)
                  
        var_label = var_labels.get(var_name, var_name)
        
        # Title (Top-Left)
        ax.text(0.0, 1.07, "POTENTIAL RISK AREA", transform=ax.transAxes,
                fontsize=9, color='#4f46e5', weight='black', va='bottom', ha='left', zorder=10)
        ax.text(0.0, 1.01, f"15-Day Cumulative {var_label}", transform=ax.transAxes,
                fontsize=13, color='#0f172a', weight='bold', va='bottom', ha='left', zorder=10)
                
        # Metadata (Top-Right)
        ax.text(1.0, 1.07, "Model: GDM-WNC", transform=ax.transAxes,
                fontsize=8.5, color='#475569', weight='bold', va='bottom', ha='right', zorder=10)
        ax.text(1.0, 1.01, f"Run: {date_str.replace('_', '-')} {hour_str}:00 UTC", transform=ax.transAxes,
                fontsize=8.5, color='#475569', weight='bold', va='bottom', ha='right', zorder=10)
                
        ax.text(0.98, 0.02, "Philippine Typhoon/Weather", transform=ax.transAxes,
                fontsize=10, color='#1e293b', weight='bold', alpha=0.6,
                ha='right', va='bottom', zorder=100)
                
        out_path = os.path.join(MAPS_OUT_DIR, f"risk_map_{var_name}.png")
        plt.savefig(out_path, dpi=200, bbox_inches='tight', facecolor='white', edgecolor='none')
        plt.close(fig)
        logger.info(f"Saved pre-rendered map to {out_path}")

if __name__ == '__main__':
    try:
        process_strike_probabilities()
        logger.info("Strike probability processing complete.")
    except Exception as e:
        logger.exception("Failed to process strike probabilities:")
        sys.exit(1)