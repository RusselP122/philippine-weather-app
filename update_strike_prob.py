import subprocess
import base64
import gzip
import xarray as xr
import os
import glob
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
import matplotlib.image as mpimg
import matplotlib.patches as patches
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch
import matplotlib.patheffects as patheffects
from matplotlib.colors import LinearSegmentedColormap, ListedColormap, BoundaryNorm
import scipy.ndimage
from scipy.interpolate import RegularGridInterpolator, splprep, splev
import urllib.request
import geojsoncontour
import pandas as pd
from shapely.geometry import shape, Point
from shapely.prepared import prep
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

LOGO_PATHS = [
    "public/images/logo.png",
    "../public/images/logo.png",
    os.path.join(os.path.dirname(__file__), "public", "images", "logo.png"),
    "public/logo512.png"
]

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
    """
    Load Google WeatherNext 3 (WNV3 / WNCv3) spaghetti tracks (individual ensemble member tracks)
    in the Western Pacific, with fallback to FNV3 tracks.
    """
    candidate_paths = [
        "public/data/wnv3_latest.dat",
        "public/data/wnv3_latest.csv",
        "../public/data/wnv3_latest.dat",
        "../public/data/wnv3_latest.csv",
        os.path.join(os.path.dirname(__file__), "public", "data", "wnv3_latest.dat"),
        os.path.join(os.path.dirname(__file__), "public", "data", "wnv3_latest.csv"),
    ]
    
    # Also check any local WNV3 cyclogenesis CSV files
    data_dir = os.path.join(os.path.dirname(__file__), "public", "data")
    local_wnv3_csvs = sorted(glob.glob(os.path.join(data_dir, "WNV3_*_cyclogenesis.csv")), reverse=True)
    candidate_paths.extend(local_wnv3_csvs)
    
    # Fallback to FNV3 paths if WNV3 not present
    candidate_paths.extend([
        "public/data/fnv3p2_latest.dat",
        "../public/data/fnv3p2_latest.dat",
        os.path.join(data_dir, "fnv3p2_latest.dat"),
    ])

    found_path = next((p for p in candidate_paths if os.path.exists(p) and os.path.getsize(p) > 1000), None)

    if not found_path:
        # Attempt online download of latest WNV3 cyclogenesis CSV if remote is reachable
        try:
            today = datetime.now(timezone.utc).date()
            dates = [today - timedelta(days=i) for i in range(4)]
            hours = ["18", "12", "06", "00"]
            base_url = "https://deepmind.google.com/science/weatherlab/download/cyclones/WNV3/ensemble/cyclogenesis/csv"
            for d in dates:
                d_str = d.strftime("%Y_%m_%d")
                for h in hours:
                    fn = f"WNV3_{d_str}T{h}_00_cyclogenesis.csv"
                    test_url = f"{base_url}/{fn}"
                    if curl_status(test_url) == 200:
                        dl_path = os.path.join(data_dir, fn)
                        logger.info(f"Downloading latest WNv3 cyclogenesis from {test_url}...")
                        subprocess.run(["curl", "-s", "-L", "-o", dl_path, test_url], timeout=30)
                        if os.path.exists(dl_path) and os.path.getsize(dl_path) > 100000:
                            found_path = dl_path
                            break
                if found_path:
                    break
        except Exception as e_dl:
            logger.warning(f"Online WNv3 fetch check notice: {e_dl}")

    if not found_path:
        logger.warning("No WeatherNext 3 (WNV3) or FNV3 spaghetti tracks found. No tracks plotted.")
        return []

    try:
        if str(found_path).endswith('.dat'):
            with open(found_path, 'r', encoding='utf-8') as f:
                content = f.read().strip()
            encrypted_bytes = base64.b64decode(content)
            decrypted_bytes = bytes([b ^ 0xAA for b in encrypted_bytes])
            csv_text = decrypted_bytes.decode('utf-8', errors='ignore')
            df = pd.read_csv(io.StringIO(csv_text), comment='#')
        else:
            df = pd.read_csv(found_path, comment='#')

        # Ensure lead_time_hours exists
        if 'lead_time_hours' not in df.columns and 'lead_time' in df.columns:
            df['lead_time_hours'] = pd.to_timedelta(df['lead_time']).dt.total_seconds() / 3600.0

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

        logger.info(f"Loaded {len(tracks)} Western Pacific WNv3 spaghetti tracks from {found_path}")
        return tracks
    except Exception as e:
        logger.warning(f"Error loading WNv3 spaghetti tracks from {found_path}: {e}")
        return []

# Alias for backwards compatibility
load_wnv3_base_spaghetti_tracks = load_fnv3_base_spaghetti_tracks

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
    """
    Renders 16:9 TV Broadcast Weather Graphics for Strike / Track Probabilities
    matching the Fox Weather 'TROPICAL THREAT' reference styling.
    Uses continuous 2D filled probability contours, dark base cartography (ai_precip_outlook),
    spaghetti tracks, active cyclone badges, and a broadcast top banner with rainbow gradient threat bar.
    """
    logger.info("Loading province boundaries for broadcast map rendering...")
    geojson_paths = [
        "public/data/ph_provinces.json",
        "../public/data/ph_provinces.json",
        os.path.join(os.path.dirname(__file__), "public", "data", "ph_provinces.json")
    ]
    found_geojson = next((p for p in geojson_paths if os.path.exists(p)), None)
    province_geoms = []
    if found_geojson:
        try:
            with open(found_geojson, 'r', encoding='utf-8') as f:
                prov_geojson = json.load(f)
            for feat in prov_geojson.get('features', []):
                if feat.get('geometry'):
                    province_geoms.append(shape(feat['geometry']))
            logger.info(f"Loaded {len(province_geoms)} province geometries from {found_geojson}")
        except Exception as e:
            logger.warning(f"Error loading {found_geojson}: {e}")

    # Load base spaghetti tracks (Western Pacific basin)
    tracks_to_plot = load_fnv3_base_spaghetti_tracks()

    # Active storm identification (JTWC / WP track IDs)
    active_storm_badges = []
    seen_storms = set()
    for t in tracks_to_plot:
        tid = str(t['track_id']).strip().upper()
        if tid.startswith("WP") and tid not in seen_storms:
            seen_storms.add(tid)
            matching = [tr for tr in tracks_to_plot if str(tr['track_id']).strip().upper() == tid]
            f_lons = [m['lons'][0] for m in matching if len(m['lons']) > 0]
            f_lats = [m['lats'][0] for m in matching if len(m['lats']) > 0]
            if f_lons and f_lats:
                c_lon = float(np.mean(f_lons))
                c_lat = float(np.mean(f_lats))
                short_name = tid.split("(")[0]
                if short_name.startswith("WP") and len(short_name) >= 4 and short_name[2:4].isdigit():
                    short_name = f"WP{short_name[2:4]}"
                active_storm_badges.append((short_name, c_lon, c_lat))

    # Calculate valid time window
    try:
        init_dt = datetime.strptime(f"{date_str}_{hour_str}", "%Y_%m_%d_%H").replace(tzinfo=timezone.utc)
        ph_tz = timezone(timedelta(hours=8))
        init_dt_ph = init_dt.astimezone(ph_tz)
        valid_dt_ph = init_dt_ph + timedelta(days=15)
        valid_str = valid_dt_ph.strftime("%a %b %d").upper()
        date_display = init_dt_ph.strftime("%B %d, %Y")
    except Exception:
        valid_str = "15-DAY WINDOW"
        date_display = date_str

    # Threat Colormap matching Fox Weather reference
    THREAT_LEVELS = [0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.70, 0.85, 1.01]
    THREAT_COLORS = [
        '#93c5fd',  # 5% - 10%: Light Periwinkle Blue
        '#2563eb',  # 10% - 20%: Royal Blue
        '#06b6d4',  # 20% - 30%: Vibrant Cyan
        '#22c55e',  # 30% - 40%: Bright Lime Green
        '#facc15',  # 40% - 50%: Warm Yellow
        '#f97316',  # 50% - 70%: Bright Orange
        '#ef4444',  # 70% - 85%: Crimson Red
        '#7f1d1d'   # >= 85%: Deep Dark Maroon
    ]
    threat_cmap = ListedColormap(THREAT_COLORS)
    threat_norm = BoundaryNorm(THREAT_LEVELS, ncolors=len(THREAT_COLORS), clip=False)

    var_meta = {
        'track_probability': {
            'headline': 'TROPICAL THREAT',
            'subtitle': '15-DAY TRACK PROBABILITY'
        },
        '34_knot_strike_probability': {
            'headline': 'TROPICAL THREAT',
            'subtitle': '34-KT (TROPICAL STORM) STRIKE PROB'
        },
        '50_knot_strike_probability': {
            'headline': 'TROPICAL THREAT',
            'subtitle': '50-KT (STS FORCE) STRIKE PROB'
        },
        '64_knot_strike_probability': {
            'headline': 'TROPICAL THREAT',
            'subtitle': '64-KT (TYPHOON FORCE) STRIKE PROB'
        }
    }

    stroke_dark = [patheffects.withStroke(linewidth=3.2, foreground='#09182b', alpha=0.95)]

    # 16:9 Western Pacific Extent with generous top headroom for the header bar
    # lon_span = 60.0 deg -> lat_span = 33.75 deg
    DEFAULT_EXTENT = [106.0, 166.0, 2.0, 35.75]

    for var_name in variables:
        if var_name not in ds.data_vars:
            continue

        logger.info(f"Generating 16:9 Broadcast Map for {var_name}...")
        ds_day15 = ds.isel({time_dim: n_steps - 1})

        raw_data = ds_day15[var_name].values
        ds_lons = ds.lon.values
        ds_lats = ds.lat.values

        # Normalize lons if 0..360
        if np.any(ds_lons > 180):
            ds_lons = np.where(ds_lons > 180, ds_lons - 360, ds_lons)
            sort_idx = np.argsort(ds_lons)
            ds_lons = ds_lons[sort_idx]
            raw_data = raw_data[:, sort_idx]

        # Ensure lats are ascending
        if len(ds_lats) > 1 and ds_lats[0] > ds_lats[-1]:
            ds_lats = ds_lats[::-1]
            raw_data = raw_data[::-1, :]

        raw_data = np.nan_to_num(raw_data, nan=0.0)

        # Dynamic extent calculation preserving exact 16:9
        extent = list(DEFAULT_EXTENT)
        high_risk = np.where(raw_data >= 0.05)
        if len(high_risk[0]) > 0:
            active_lats = ds_lats[high_risk[0]]
            active_lons = ds_lons[high_risk[1]]
            min_lon = min(108.0, float(np.min(active_lons)) - 3.5)
            max_lon = max(142.0, float(np.max(active_lons)) + 4.0)
            min_lat = min(3.0, float(np.min(active_lats)) - 2.5)
            max_lat = max(24.0, float(np.max(active_lats)) + 5.0)

            lon_span = max_lon - min_lon
            lat_span = max_lat - min_lat

            target_lat_span = lon_span * 9.0 / 16.0
            if target_lat_span < lat_span:
                target_lon_span = lat_span * 16.0 / 9.0
                center_lon = (max_lon + min_lon) / 2.0
                extent = [
                    center_lon - target_lon_span / 2.0,
                    center_lon + target_lon_span / 2.0,
                    min_lat,
                    max_lat
                ]
            else:
                center_lat = (max_lat + min_lat) / 2.0
                extent = [
                    min_lon,
                    max_lon,
                    center_lat - target_lat_span / 2.0,
                    center_lat + target_lat_span / 2.0
                ]

        # Clamp bounds
        extent[0] = max(extent[0], 104.0)
        extent[1] = min(extent[1], 175.0)
        extent[2] = max(extent[2], -3.0)
        extent[3] = min(extent[3], 42.0)
        cur_lon_span = extent[1] - extent[0]
        cur_lat_span = cur_lon_span * 9.0 / 16.0
        extent[3] = extent[2] + cur_lat_span

        # Build fine interpolation grid for smooth contours
        fine_lons = np.arange(extent[0] - 2.0, extent[1] + 2.0, 0.15)
        fine_lats = np.arange(extent[2] - 2.0, extent[3] + 2.0, 0.15)

        try:
            interp_func = RegularGridInterpolator((ds_lats, ds_lons), raw_data, bounds_error=False, fill_value=0.0)
            mesh_lats, mesh_lons = np.meshgrid(fine_lats, fine_lons, indexing='ij')
            interp_pts = np.column_stack([mesh_lats.ravel(), mesh_lons.ravel()])
            fine_grid = interp_func(interp_pts).reshape(mesh_lats.shape)
            fine_grid = scipy.ndimage.gaussian_filter(fine_grid, sigma=1.1)
        except Exception as e:
            logger.warning(f"Interpolation notice: {e}. Falling back to raw grid.")
            fine_lons = ds_lons
            fine_lats = ds_lats
            fine_grid = scipy.ndimage.gaussian_filter(raw_data, sigma=0.8)

        # ── Setup 16:9 Figure & Cartopy Map ───────────────────────────────────
        fig = plt.figure(figsize=(16, 9), dpi=140)
        fig.patch.set_facecolor('#08172b')
        ax = fig.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree())
        ax.set_extent(extent, crs=ccrs.PlateCarree())

        # Base Cartography (ai_precip_outlook styling)
        ax.add_feature(cfeature.OCEAN, facecolor='#122030', zorder=0)
        ax.add_feature(cfeature.LAND, facecolor='#243328', zorder=1)

        # Subtle Gridlines
        ax.gridlines(draw_labels=False, linewidth=0.5, color='#475569', alpha=0.22, linestyle=':', zorder=2)

        # ── Continuous Threat Heatmap Contours ────────────────────────────────
        if np.nanmax(fine_grid) >= THREAT_LEVELS[0]:
            ax.contourf(
                fine_lons, fine_lats, fine_grid,
                levels=THREAT_LEVELS, cmap=threat_cmap, norm=threat_norm,
                extend='neither', transform=ccrs.PlateCarree(),
                alpha=0.76, zorder=3
            )
            ax.contour(
                fine_lons, fine_lats, fine_grid,
                levels=THREAT_LEVELS, colors='#ffffff',
                linewidths=0.45, alpha=0.22,
                transform=ccrs.PlateCarree(), zorder=4
            )

        # Subtle Land Mask overlay so land silhouette is clearly visible through threat shading
        ax.add_feature(cfeature.LAND, facecolor='#1c2a21', alpha=0.18, zorder=5)

        # Draw Philippine Provinces on top of shading
        if province_geoms:
            ax.add_geometries(province_geoms, crs=ccrs.PlateCarree(),
                              facecolor='none', edgecolor='#94a3b8',
                              linewidth=0.60, alpha=0.80, zorder=6)

        # Crisp White Coastlines & Borders on top of threat shading (Fox Weather style)
        ax.add_feature(cfeature.COASTLINE, linewidth=1.3, edgecolor='#ffffff', zorder=7)
        ax.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.80, edgecolor='#cbd5e1', alpha=0.85, zorder=7)

        # Solid PAR Boundary in strict #7c2d12 on top of shading (no text label)
        par_lons = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
        par_lats = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]
        ax.plot(par_lons, par_lats, color="#7c2d12", linewidth=2.4, linestyle="-",
                transform=ccrs.PlateCarree(), zorder=8)

        # ── Spaghetti Ensemble Tracks ─────────────────────────────────────────
        for t in tracks_to_plot:
            lons_t = t['lons']
            lats_t = t['lats']
            if len(lons_t) < 4:
                ax.plot(lons_t, lats_t, color='#94a3b8', linewidth=0.85, alpha=0.28,
                        linestyle='-', zorder=12, transform=ccrs.PlateCarree())
                continue
            try:
                clons = [lons_t[0]]
                clats = [lats_t[0]]
                for idx_pt in range(1, len(lons_t)):
                    if lons_t[idx_pt] != lons_t[idx_pt-1] or lats_t[idx_pt] != lats_t[idx_pt-1]:
                        clons.append(lons_t[idx_pt])
                        clats.append(lats_t[idx_pt])
                if len(clons) >= 4:
                    tck, u = splprep([clons, clats], s=0)
                    u_new = np.linspace(0, 1, 80)
                    s_lons, s_lats = splev(u_new, tck)
                    ax.plot(s_lons, s_lats, color='#94a3b8', linewidth=0.85, alpha=0.28,
                            linestyle='-', zorder=12, transform=ccrs.PlateCarree())
                else:
                    ax.plot(clons, clats, color='#94a3b8', linewidth=0.85, alpha=0.28,
                            linestyle='-', zorder=12, transform=ccrs.PlateCarree())
            except Exception:
                ax.plot(lons_t, lats_t, color='#94a3b8', linewidth=0.85, alpha=0.28,
                        linestyle='-', zorder=12, transform=ccrs.PlateCarree())

        # ── Geographic Reference Labels ───────────────────────────────────────
        geo_labels = [
            ("CHINA", 115.0, 27.5, 14.5, "heavy"),
            ("TAIWAN", 121.0, 23.8, 13.0, "heavy"),
            ("PHILIPPINES", 122.5, 12.8, 14.0, "heavy"),
            ("GUAM", 144.8, 13.5, 11.5, "heavy"),
            ("NORTHERN\nMARIANA\nISLANDS", 145.8, 18.2, 10.5, "heavy"),
            ("PALAU", 134.5, 7.5, 10.0, "heavy"),
            ("YAP", 138.1, 9.5, 10.0, "heavy"),
            ("PACIFIC  OCEAN", 148.0, 23.5, 13.5, "bold"),
            ("PHILIPPINE  SEA", 131.0, 17.5, 12.5, "bold"),
            ("WEST  PHILIPPINE  SEA", 115.5, 15.0, 10.5, "bold"),
        ]

        for lbl, clon, clat, fsize, fweight in geo_labels:
            if (extent[0] + 1.0 <= clon <= extent[1] - 1.0) and (extent[2] + 1.0 <= clat <= extent[3] - 1.0):
                if "OCEAN" in lbl or "SEA" in lbl:
                    ax.text(clon, clat, lbl, transform=ccrs.PlateCarree(),
                            fontsize=fsize, fontweight=fweight, fontstyle='italic',
                            color='#64748b', alpha=0.60, ha='center', va='center', zorder=5)
                else:
                    txt_obj = ax.text(clon, clat, lbl, transform=ccrs.PlateCarree(),
                                      fontsize=fsize, fontweight=fweight,
                                      color='#ffffff', ha='center', va='center', zorder=14)
                    txt_obj.set_path_effects(stroke_dark)

        # ── Active Storm Badges (e.g. BAVI style pill) ────────────────────────
        for sname, slon, slat in active_storm_badges:
            if (extent[0] <= slon <= extent[1]) and (extent[2] <= slat <= extent[3]):
                offset_y = -1.8 if slat > (extent[3] - 6.5) else 1.8
                ax.text(slon, slat + offset_y, sname, transform=ccrs.PlateCarree(),
                        fontsize=11.5, fontweight="heavy", color="#ffffff", ha="center", va="center",
                        bbox=dict(boxstyle="round,pad=0.35,rounding_size=0.25", facecolor="#0b2344", edgecolor="#ffffff", lw=1.5, alpha=0.96),
                        zorder=16)

        # ── Fox Weather Top Header Bar ─────────────────────────────────────────
        header_bg = patches.Rectangle((0, 0.880), 1.0, 0.120, transform=fig.transFigure,
                                      facecolor='#08172b', alpha=0.96, zorder=40)
        fig.patches.append(header_bg)

        header_border = patches.Rectangle((0, 0.877), 1.0, 0.003, transform=fig.transFigure,
                                          facecolor='#0284c7', zorder=41)
        fig.patches.append(header_border)

        # Left Container (Threat Outlook + Through Date)
        excl_pill = FancyBboxPatch((0.022, 0.942), 0.145, 0.046,
                                   boxstyle="round,pad=0.004,rounding_size=0.012",
                                   transform=fig.transFigure, facecolor="#0284c7", edgecolor="#38bdf8", lw=1.5, zorder=42)
        fig.patches.append(excl_pill)
        fig.text(0.0945, 0.965, "THREAT OUTLOOK", fontsize=11.5, fontweight="heavy", color="#ffffff", ha="center", va="center", zorder=44)

        valid_box = FancyBboxPatch((0.022, 0.892), 0.145, 0.038,
                                   boxstyle="round,pad=0.003,rounding_size=0.008",
                                   transform=fig.transFigure, facecolor="#0b2344", edgecolor="#1e3a8a", lw=1.0, zorder=42)
        fig.patches.append(valid_box)
        fig.text(0.0945, 0.911, f"THROUGH {valid_str}", fontsize=9.5, fontweight="heavy", color="#f8fafc", ha="center", va="center", zorder=44)

        # Center Headline Pill: "TROPICAL THREAT"
        v_meta = var_meta.get(var_name, {'headline': 'TROPICAL THREAT', 'subtitle': var_name.upper()})
        title_pill = FancyBboxPatch((0.185, 0.936), 0.440, 0.054,
                                    boxstyle="round,pad=0.004,rounding_size=0.012",
                                    transform=fig.transFigure, facecolor="#0b2344", edgecolor="#ffffff", lw=1.6, zorder=42)
        fig.patches.append(title_pill)
        fig.text(0.405, 0.963, v_meta['headline'], fontsize=20.5, fontweight="heavy", color="#ffffff", ha="center", va="center", zorder=44)

        # Continuous Rainbow Threat Gradient Bar (LOW to HIGH)
        cbar_ax = fig.add_axes([0.222, 0.898, 0.366, 0.020], zorder=43)
        threat_grad = LinearSegmentedColormap.from_list("tg", THREAT_COLORS)
        cbar_ax.imshow(np.linspace(0, 1, 256).reshape(1, -1), aspect='auto', cmap=threat_grad)
        cbar_ax.set_axis_off()
        cbar_ax.add_patch(patches.Rectangle((0, 0), 1, 1, transform=cbar_ax.transAxes, fill=False, edgecolor='#ffffff', linewidth=1.2))

        fig.text(0.214, 0.908, "LOW", fontsize=10.5, fontweight="heavy", color="#ffffff", ha="right", va="center", zorder=44)
        fig.text(0.596, 0.908, "HIGH", fontsize=10.5, fontweight="heavy", color="#ffffff", ha="left", va="center", zorder=44)

        # Right Brand Pill: "PHILIPPINE TYPHOON WEATHER"
        brand_pill = FancyBboxPatch((0.685, 0.916), 0.292, 0.062,
                                    boxstyle="round,pad=0.005,rounding_size=0.014",
                                    transform=fig.transFigure, facecolor="#ffffff", edgecolor="#0284c7", lw=1.6, zorder=42)
        fig.patches.append(brand_pill)

        red_badge = FancyBboxPatch((0.884, 0.920), 0.088, 0.054,
                                   boxstyle="round,pad=0.003,rounding_size=0.010",
                                   transform=fig.transFigure, facecolor="#dc2626", edgecolor="none", zorder=43)
        fig.patches.append(red_badge)

        fig.text(0.785, 0.947, "PHILIPPINE TYPHOON", fontsize=12.5, fontweight="heavy", color="#0a1d37", ha="center", va="center", zorder=44)
        fig.text(0.928, 0.947, "WEATHER", fontsize=12.5, fontweight="heavy", color="#ffffff", ha="center", va="center", zorder=44)

        # Subtitle right under brand pill
        fig.text(0.977, 0.895, f"{v_meta['subtitle']} · {date_display}",
                 fontsize=8.5, fontweight="bold", color="#94a3b8", ha="right", va="center", zorder=42)

        # ── Bottom-Left Brand Logo (Direct on Canvas, No White Card) ──────────
        found_logo = next((p for p in LOGO_PATHS if os.path.exists(p)), None)
        logo_w, logo_h = 0.085, 0.085
        logo_x, logo_y = 0.022, 0.028
        if found_logo:
            try:
                l_img = mpimg.imread(found_logo)
                logo_ax = fig.add_axes([logo_x, logo_y, logo_w, logo_h], zorder=50)
                logo_ax.imshow(l_img)
                logo_ax.axis("off")
            except Exception:
                fig.text(logo_x + logo_w / 2.0, logo_y + logo_h / 2.0, "PHIL\nWX",
                         fontsize=12, fontweight="heavy", color="#38bdf8", ha="center", va="center", zorder=50)
        else:
            fig.text(logo_x + logo_w / 2.0, logo_y + logo_h / 2.0, "PHIL\nWX",
                     fontsize=12, fontweight="heavy", color="#38bdf8", ha="center", va="center", zorder=50)

        # ── Bottom-Right Guidance & Disclaimer Card ───────────────────────────
        leg_x, leg_y, leg_w, leg_h = 0.680, 0.028, 0.298, 0.095
        leg_bg = FancyBboxPatch((leg_x, leg_y), leg_w, leg_h,
                                boxstyle="round,pad=0.005,rounding_size=0.012",
                                transform=fig.transFigure, facecolor="#09182b", edgecolor="#0284c7",
                                lw=1.2, alpha=0.94, zorder=50)
        fig.patches.append(leg_bg)

        fig.text(leg_x + leg_w / 2.0, leg_y + 0.068, "15-DAY CUMULATIVE GUIDANCE · GOOGLE WEATHERNEXT 3",
                 fontsize=8.8, fontweight="heavy", color="#38bdf8", ha="center", va="center", zorder=52)
        fig.text(leg_x + leg_w / 2.0, leg_y + 0.030, "EXPERIMENTAL GUIDANCE PRODUCT · NOT AN OFFICIAL FORECAST\nREFER TO PAGASA FOR OFFICIAL WARNINGS AND ADVISORIES",
                 fontsize=6.8, fontweight="bold", color="#94a3b8", ha="center", va="center", multialignment="center", zorder=52)

        # ── Save Outputs ──────────────────────────────────────────────────────
        out_path = os.path.join(MAPS_OUT_DIR, f"risk_map_{var_name}.png")
        plt.savefig(out_path, dpi=140, facecolor="#08172b")
        plt.close(fig)
        logger.info(f"Saved 16:9 Broadcast Map to {out_path}")

if __name__ == '__main__':
    try:
        process_strike_probabilities()
        logger.info("Strike probability processing complete.")
    except Exception as e:
        logger.exception("Failed to process strike probabilities:")
        sys.exit(1)