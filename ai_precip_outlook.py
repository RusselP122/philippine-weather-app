import os
import json
import requests
import numpy as np
import scipy.ndimage
from scipy.interpolate import griddata
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.lines as mlines
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import shapely
from shapely.geometry import shape
from shapely.validation import make_valid
from shapely.ops import unary_union
from datetime import datetime, timedelta, timezone
from eccodes import codes_grib_new_from_file, codes_get, codes_get_double_array, codes_get_values, codes_release
from ecmwf.opendata import Client
import xarray as xr
import gcsfs

# ── Directories ────────────────────────────────────────────────────────────
OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "ai_precip_outlook")
DATA_DIR = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# ── Region & Master Grid ───────────────────────────────────────────────────
# Zoomed specifically to the Philippines domain
LAT_MIN, LAT_MAX = 4.5, 21.5
LON_MIN, LON_MAX = 116.0, 127.0

# High-resolution master grid (0.02° ≈ 2.2 km resolution for smooth, crisp contours)
GRID_RES = 0.02
MASTER_LATS = np.arange(LAT_MIN, LAT_MAX + GRID_RES, GRID_RES)
MASTER_LONS = np.arange(LON_MIN, LON_MAX + GRID_RES, GRID_RES)
M_LONS, M_LATS = np.meshgrid(MASTER_LONS, MASTER_LATS)

# ── Colormaps ─────────────────────────────────────────────────────────────
# Precip Colormap (Accumulated totals)
MEAN_LEVELS = [0.1, 5, 10, 25, 50, 100, 150, 200, 300, 400, 500, 750]
MEAN_COLORS = [
    "#F0F8FF", "#C8E6FF", "#78BAFF", "#1E7EFF", "#00B366", "#8CDB00",
    "#FFEA00", "#FF9F00", "#FF3A00", "#E6006E", "#8500E6", "#1F005C"
]
mean_cmap = ListedColormap(MEAN_COLORS)
mean_cmap.set_over('#0F0030')
mean_norm = BoundaryNorm(MEAN_LEVELS, ncolors=len(MEAN_COLORS), clip=False)


# ═══════════════════════════════════════════════════════════════════════════
# Regridding
# ═══════════════════════════════════════════════════════════════════════════
def regrid_to_master(lats, lons, values):
    """
    Interpolates coarse model data (0.25° ~28km) onto the high-resolution master grid
    (0.02° ~2.2km) using bounding-box optimization and cubic interpolation.
    """
    # Crop source coordinates to target domain + 1.5° buffer for fast interpolation
    mask = (
        (lats >= LAT_MIN - 1.5) & (lats <= LAT_MAX + 1.5) &
        (lons >= LON_MIN - 1.5) & (lons <= LON_MAX + 1.5)
    )
    if np.any(mask):
        sub_lats = lats[mask]
        sub_lons = lons[mask]
        sub_vals = values[mask]
    else:
        sub_lats, sub_lons, sub_vals = lats, lons, values

    pts = np.column_stack((sub_lons.ravel(), sub_lats.ravel()))
    vals = sub_vals.ravel()
    valid = ~np.isnan(vals)
    if not np.any(valid):
        return np.zeros_like(M_LATS)

    # Perform cubic interpolation for continuous smooth gradients
    regridded = griddata(pts[valid], vals[valid], (M_LONS, M_LATS), method='cubic', fill_value=np.nan)
    
    # Fill edge NaNs outside convex hull with linear interpolation
    if np.any(np.isnan(regridded)):
        linear_fill = griddata(pts[valid], vals[valid], (M_LONS, M_LATS), method='linear', fill_value=0.0)
        regridded = np.where(np.isnan(regridded), linear_fill, regridded)

    regridded = np.nan_to_num(regridded, nan=0.0)
    regridded = np.clip(regridded, 0, None)
    return regridded

# ═══════════════════════════════════════════════════════════════════════════
# Fetchers
# ═══════════════════════════════════════════════════════════════════════════

def get_latest_aigfs_run(session):
    base_url = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/aigfs/prod"
    now = datetime.now(timezone.utc)
    for days_back in range(0, 3):
        t_date = now - timedelta(days=days_back)
        date_str = t_date.strftime("%Y%m%d")
        date_url = f"{base_url}/aigfs.{date_str}/"
        try:
            if session.get(date_url, timeout=6).status_code != 200: continue
            for cycle in ["18", "12", "06", "00"]:
                cycle_url = f"{date_url}{cycle}/model/atmos/grib2/"
                test_idx = f"{cycle_url}aigfs.t{cycle}z.sfc.f120.grib2.idx"
                try:
                    if session.head(test_idx, timeout=5).status_code == 200:
                        run_dt = datetime.strptime(f"{date_str}{cycle}", "%Y%m%d%H").replace(tzinfo=timezone.utc)
                        print(f"Found latest AIGFS run: {date_str} {cycle}Z")
                        return cycle_url, run_dt, date_str, cycle
                except: continue
        except: continue
    return None, None, None, None

def download_aigfs_apcp(grib_url, idx_url, session, target_day):
    r = session.get(idx_url, timeout=10)
    if r.status_code != 200: return None
    lines = r.text.splitlines()
    
    target_str = f"0-{target_day} day acc fcst"
    start_byte, end_byte = None, ""
    for i, line in enumerate(lines):
        if "APCP" in line and target_str in line:
            start_byte = int(line.split(":")[1])
            if i < len(lines) - 1:
                end_byte = int(lines[i + 1].split(":")[1]) - 1
            break
            
    if start_byte is None: return None
    temp_path = os.path.join(os.getcwd(), f"temp_aigfs_apcp_{os.getpid()}_{np.random.randint(1000,9999)}.grib2")
    headers = {"Range": f"bytes={start_byte}-{end_byte}"}
    gr = session.get(grib_url, headers=headers, timeout=25)
    with open(temp_path, "wb") as f:
        f.write(gr.content)
    return temp_path

def read_aigfs_apcp(grib_file_path):
    lats, lons, apcp = None, None, None
    with open(grib_file_path, "rb") as f:
        gid = codes_grib_new_from_file(f)
        if gid:
            ni = codes_get(gid, "Ni")
            nj = codes_get(gid, "Nj")
            lats = codes_get_double_array(gid, "latitudes").reshape(nj, ni)
            lons = codes_get_double_array(gid, "longitudes").reshape(nj, ni)
            apcp = codes_get_values(gid).reshape(nj, ni)
            codes_release(gid)
    if lons is not None and np.max(lons) > 180:
        lons = np.where(lons > 180, lons - 360, lons)
    return lats, lons, apcp

def get_aifs_tp(client, step):
    target_file = f"temp_aifs_precip_{step:03d}_{os.getpid()}.grib2"
    try:
        client.retrieve(step=step, type="fc", param=["tp"], target=target_file)
        ds_sfc = xr.open_dataset(target_file, engine="cfgrib")
        if "time" in ds_sfc.dims and ds_sfc.sizes["time"] > 1:
            ds_sfc = ds_sfc.isel(time=-1)
        tp_var = ds_sfc["tp"]
        tp_grid = tp_var.values.squeeze()
        lats = tp_var.coords["latitude"].values
        lons = tp_var.coords["longitude"].values
        if np.nanmax(tp_grid) < 2.0: tp_grid = tp_grid * 1000.0
        ds_sfc.close()
        LONS, LATS = np.meshgrid(lons, lats)
        return LATS, LONS, tp_grid
    except Exception as e:
        print(f"AIFS fetch error step {step}: {e}")
        return None, None, None
    finally:
        if os.path.exists(target_file): os.remove(target_file)

def load_weathernext_dataset():
    try:
        fs = gcsfs.GCSFileSystem()
        parent_path = 'gs://weathernext/weathernext_2_0_0/zarr/2025_to_present'
        all_items = fs.ls(parent_path)
        run_folders = [f'gs://{item}' for item in all_items if item.endswith('_preds')]
        if not run_folders: return None
        run_folders.sort()
        latest_run_path = run_folders[-1]
        print(f"WeatherNext2: Reading from {latest_run_path}")
        store = fs.get_mapper(f"{latest_run_path}/predictions.zarr")
        ds = xr.open_zarr(store, consolidated=True)
        if ds.lat[0] < ds.lat[-1]:
            ds_ph = ds.sel(lat=slice(LAT_MIN, LAT_MAX), lon=slice(LON_MIN, LON_MAX))
        else:
            ds_ph = ds.sel(lat=slice(LAT_MAX, LAT_MIN), lon=slice(LON_MIN, LON_MAX))
        return ds_ph
    except Exception as e:
        print(f"WeatherNext2 error: {e}")
        return None

# ═══════════════════════════════════════════════════════════════════════════
# Plotting 1 Unified True Land-Masked Map with Contours
# ═══════════════════════════════════════════════════════════════════════════

def plot_single_consensus_map(consensus_grid, models_used, filename_id, init_dt, cmap, norm, levels, unit_label, days=5):
    """
    Renders 1 single high-resolution map of the combined AI precipitation forecast,
    strictly masked to Philippine landmasses with clean, elegant layout formatting.
    """
    # ── Load Philippine Province Geometries & Create Exact Land Mask ────────
    prov_geoms = []
    is_land = None
    try:
        geojson_paths = [os.path.join(DATA_DIR, "ph_provinces.json"), "public/data/ph_provinces.json"]
        found_geo = next((p for p in geojson_paths if os.path.exists(p)), None)
        if found_geo:
            with open(found_geo, "r", encoding="utf-8") as f:
                geo_data = json.load(f)
            prov_geoms = [make_valid(shape(feat["geometry"])) for feat in geo_data["features"]]
            ph_union = unary_union(prov_geoms)
            is_land = shapely.contains_xy(ph_union, M_LONS, M_LATS)
    except Exception as e:
        print(f"Notice during land mask polygon creation: {e}")

    # Smooth the continuous rain field first, then strictly mask to land
    smoothed_grid = scipy.ndimage.gaussian_filter(consensus_grid, sigma=1.0)
    if is_land is not None:
        land_rain = np.where(is_land, smoothed_grid, np.nan)
    else:
        land_rain = smoothed_grid

    # ── Setup Matplotlib Figure & Map Axes ───────────────────────────────────
    fig = plt.figure(figsize=(11, 13.5), dpi=150)
    fig.subplots_adjust(top=0.90, bottom=0.09, left=0.06, right=0.94)
    ax = fig.add_subplot(1, 1, 1, projection=ccrs.PlateCarree())
    ax.set_extent([LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], crs=ccrs.PlateCarree())

    # Base background
    ax.add_feature(cfeature.OCEAN, facecolor="#dce9f2", zorder=0)
    ax.add_feature(cfeature.LAND, facecolor="#f1f3f5", zorder=1)

    # 1. Filled Precipitation Contours (STRICTLY ON LAND)
    cf = ax.contourf(
        M_LONS, M_LATS, land_rain,
        levels=levels, cmap=cmap, norm=norm,
        extend="max", transform=ccrs.PlateCarree(), zorder=2
    )

    # 2. Isohyet Contour Lines (STRICTLY ON LAND, clean line outlines)
    contour_line_levels = [10, 25, 50, 100, 150, 200, 300, 400, 500, 750]
    max_land_val = np.nanmax(land_rain) if not np.isnan(np.nanmax(land_rain)) else 0.0
    active_line_levels = [lvl for lvl in contour_line_levels if lvl <= max_land_val]
    
    if active_line_levels:
        ax.contour(
            M_LONS, M_LATS, land_rain,
            levels=active_line_levels,
            colors='#1e293b', linewidths=0.8, linestyles='solid',
            transform=ccrs.PlateCarree(), zorder=3
        )

    # 3. High-Definition Province Borders & Coastlines
    if prov_geoms:
        ax.add_geometries(
            prov_geoms, crs=ccrs.PlateCarree(),
            facecolor='none', edgecolor='#64748b', linewidth=0.5, alpha=0.7, zorder=4
        )
    ax.add_feature(cfeature.COASTLINE, linewidth=1.0, edgecolor="#1e293b", zorder=5)

    # 4. Lat/Lon Gridlines
    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color="#94a3b8", alpha=0.4, linestyle=":", zorder=6)
    gl.top_labels = False
    gl.right_labels = False
    gl.xlabel_style = {'size': 9.5, 'color': '#334155'}
    gl.ylabel_style = {'size': 9.5, 'color': '#334155'}

    # 5. Colorbar
    cbar_ax = fig.add_axes([0.15, 0.04, 0.70, 0.018])
    cb = fig.colorbar(cf, cax=cbar_ax, orientation="horizontal")
    cb.set_ticks(levels)
    cb.ax.tick_params(labelsize=9)
    cb.set_label(unit_label, fontsize=10.5, fontweight="bold", labelpad=6)
    cb.outline.set_edgecolor("#1e293b")

    # 6. Dates & Titles
    ph_tz = timezone(timedelta(hours=8))
    init_dt_ph = init_dt.astimezone(ph_tz) if init_dt else None
    start_str = init_dt_ph.strftime("%a, %b %d, %Y") if init_dt_ph else "Start"
    end_str = (init_dt_ph + timedelta(days=days)).strftime("%a, %b %d, %Y") if init_dt_ph else "End"

    fig.text(0.5, 0.958, f"AI MULTI-MODEL PRECIPITATION OUTLOOK ({days}-DAY ACCUMULATION)", fontsize=15, weight="bold", ha="center", color="#0f172a")
    fig.text(0.5, 0.932, f"Valid: {start_str} to {end_str} (PHT)", fontsize=11, ha="center", color="#475569")

    # Watermark
    fig.text(0.95, 0.012, 'Philippine Typhoon/Weather', fontsize=11, color='#64748b', ha='right', weight='bold')

    out_path = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(out_path, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close()
    print(f"  Successfully saved {out_path}")


# ═══════════════════════════════════════════════════════════════════════════
# Main Pipeline
# ═══════════════════════════════════════════════════════════════════════════

def main():
    print("=== AI Multi-Model Precip Outlook (Combined 3-Day & 5-Day Land-Masked Maps) ===")
    
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})
    aifs_client = Client(source="azure", model="aifs-single", resol="0p25")
    
    aigfs_url, init_dt, _, aigfs_cycle = get_latest_aigfs_run(session)
    if not init_dt:
        init_dt = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        
    wn2_ds = load_weathernext_dataset()
    if wn2_ds is not None:
        wn_lats = wn2_ds.lat.values
        wn_lons = wn2_ds.lon.values
        WN_LONS, WN_LATS = np.meshgrid(wn_lons, wn_lats)
    
    valid_frames = []

    # ═══════════════════════════════════════════════════════════════════════
    # 1. Process 3-Day (72-hr) Accumulation
    # ═══════════════════════════════════════════════════════════════════════
    print(f"\nProcessing 3-Day (72-hr) Accumulation...")
    
    # AIGFS 3-Day
    aigfs_3day_master = np.zeros_like(M_LATS)
    if aigfs_url:
        grib_file_72 = f"aigfs.t{aigfs_cycle}z.sfc.f072.grib2"
        grib_url_72 = f"{aigfs_url}{grib_file_72}"
        idx_url_72 = f"{grib_url_72}.idx"
        print("Downloading NOAA AIGFS 0-3 day...")
        tmp_path = download_aigfs_apcp(grib_url_72, idx_url_72, session, 3)
        if tmp_path:
            lats, lons, current_total = read_aigfs_apcp(tmp_path)
            if current_total is not None:
                aigfs_3day_master = regrid_to_master(lats, lons, current_total)
            if os.path.exists(tmp_path): os.remove(tmp_path)

    # AIFS 3-Day
    aifs_3day_master = np.zeros_like(M_LATS)
    print("Downloading ECMWF AIFS 72h...")
    lats, lons, current_total = get_aifs_tp(aifs_client, 72)
    if current_total is not None:
        aifs_3day_master = regrid_to_master(lats, lons, current_total)

    # WeatherNext 2 3-Day
    wn2_3day_master = np.zeros_like(M_LATS)
    if wn2_ds is not None:
        print("Extracting Google WeatherNext 2 0-72h...")
        try:
            precip_slice = wn2_ds['total_precipitation_6hr'].isel(time=slice(0, 12))
            total_72h = (precip_slice.sum(dim='time') * 1000.0).values
            total_72h = np.maximum(total_72h, 0)
            if total_72h.ndim == 3:
                total_72h = total_72h[0]
            wn2_3day_master = regrid_to_master(WN_LATS, WN_LONS, total_72h)
        except Exception as e:
            print(f"WeatherNext2 3-day extraction error: {e}")

    # Combine 3-Day
    valid_models_3day = []
    models_used_3day = []
    if np.nanmax(wn2_3day_master) > 0:
        valid_models_3day.append(wn2_3day_master)
        models_used_3day.append("WeatherNext 2")
    if np.nanmax(aifs_3day_master) > 0:
        valid_models_3day.append(aifs_3day_master)
        models_used_3day.append("ECMWF AIFS")
    if np.nanmax(aigfs_3day_master) > 0:
        valid_models_3day.append(aigfs_3day_master)
        models_used_3day.append("NOAA AIGFS")

    consensus_3day = np.mean(valid_models_3day, axis=0) if valid_models_3day else np.zeros_like(M_LATS)

    print("Plotting 3-Day AI Consensus Map...")
    plot_single_consensus_map(
        consensus_3day,
        models_used_3day if models_used_3day else ["AI Model Consensus"],
        "ai_precip_3day_all_models",
        init_dt,
        mean_cmap,
        mean_norm,
        MEAN_LEVELS,
        "3-Day Total Accumulated Precipitation (mm)",
        days=3
    )
    plot_single_consensus_map(
        consensus_3day,
        models_used_3day if models_used_3day else ["AI Model Consensus"],
        "ai_precip_3day_consensus",
        init_dt,
        mean_cmap,
        mean_norm,
        MEAN_LEVELS,
        "3-Day Total Accumulated Precipitation (mm)",
        days=3
    )
    valid_frames.append("ai_precip_3day_all_models")

    # ═══════════════════════════════════════════════════════════════════════
    # 2. Process 5-Day (120-hr) Accumulation
    # ═══════════════════════════════════════════════════════════════════════
    print(f"\nProcessing 5-Day (120-hr) Accumulation...")
    
    # AIGFS 5-Day
    aigfs_5day_master = np.zeros_like(M_LATS)
    if aigfs_url:
        grib_file_120 = f"aigfs.t{aigfs_cycle}z.sfc.f120.grib2"
        grib_url_120 = f"{aigfs_url}{grib_file_120}"
        idx_url_120 = f"{grib_url_120}.idx"
        print("Downloading NOAA AIGFS 0-5 day...")
        tmp_path = download_aigfs_apcp(grib_url_120, idx_url_120, session, 5)
        if tmp_path:
            lats, lons, current_total = read_aigfs_apcp(tmp_path)
            if current_total is not None:
                aigfs_5day_master = regrid_to_master(lats, lons, current_total)
            if os.path.exists(tmp_path): os.remove(tmp_path)

    # AIFS 5-Day
    aifs_5day_master = np.zeros_like(M_LATS)
    print("Downloading ECMWF AIFS 120h...")
    lats, lons, current_total = get_aifs_tp(aifs_client, 120)
    if current_total is not None:
        aifs_5day_master = regrid_to_master(lats, lons, current_total)
        
    # WeatherNext2 5-Day
    wn2_5day_master = np.zeros_like(M_LATS)
    if wn2_ds is not None:
        print("Extracting Google WeatherNext 2 0-120h...")
        try:
            precip_slice = wn2_ds['total_precipitation_6hr'].isel(time=slice(0, 20))
            total_120h = (precip_slice.sum(dim='time') * 1000.0).values
            total_120h = np.maximum(total_120h, 0)
            if total_120h.ndim == 3:
                total_120h = total_120h[0]
            wn2_5day_master = regrid_to_master(WN_LATS, WN_LONS, total_120h)
        except Exception as e:
            print(f"WeatherNext2 5-day extraction error: {e}")

    # Combine 5-Day
    valid_models_5day = []
    models_used_5day = []
    if np.nanmax(wn2_5day_master) > 0:
        valid_models_5day.append(wn2_5day_master)
        models_used_5day.append("WeatherNext 2")
    if np.nanmax(aifs_5day_master) > 0:
        valid_models_5day.append(aifs_5day_master)
        models_used_5day.append("ECMWF AIFS")
    if np.nanmax(aigfs_5day_master) > 0:
        valid_models_5day.append(aigfs_5day_master)
        models_used_5day.append("NOAA AIGFS")
        
    consensus_5day = np.mean(valid_models_5day, axis=0) if valid_models_5day else np.zeros_like(M_LATS)

    print("Plotting 5-Day AI Consensus Map...")
    plot_single_consensus_map(
        consensus_5day,
        models_used_5day if models_used_5day else ["AI Model Consensus"],
        "ai_precip_5day_all_models",
        init_dt,
        mean_cmap,
        mean_norm,
        MEAN_LEVELS,
        "5-Day Total Accumulated Precipitation (mm)",
        days=5
    )
    plot_single_consensus_map(
        consensus_5day,
        models_used_5day if models_used_5day else ["AI Model Consensus"],
        "ai_precip_5day_consensus",
        init_dt,
        mean_cmap,
        mean_norm,
        MEAN_LEVELS,
        "5-Day Total Accumulated Precipitation (mm)",
        days=5
    )
    valid_frames.append("ai_precip_5day_all_models")

    # Metadata
    ph_tz = timezone(timedelta(hours=8))
    init_dt_ph = init_dt.astimezone(ph_tz) if init_dt else None
    
    meta = {
        "title": "AI Multi-Model Precipitation Outlook (3-Day & 5-Day)",
        "models_used": list(set(models_used_3day + models_used_5day)) if (models_used_3day or models_used_5day) else ["AI Models"],
        "generated_at": datetime.now(ph_tz).strftime("%Y-%m-%d %I:%M %p PHT"),
        "run_time": init_dt_ph.strftime("%Y-%m-%d %I:%M %p PHT") if init_dt_ph else "Unknown",
        "max_predicted_rain_3day_mm": float(np.nanmax(consensus_3day)),
        "max_predicted_rain_5day_mm": float(np.nanmax(consensus_5day)),
        "animation_frames": valid_frames
    }
    with open(os.path.join(DATA_DIR, "ai_precip_outlook_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
        
    print("\nGeneration complete! Both 3-Day & 5-Day Land-Masked Maps created successfully.")

if __name__ == "__main__":
    main()
