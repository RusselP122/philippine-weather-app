import os
import json
import scipy.ndimage
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.lines as mlines
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from shapely.geometry import shape
import numpy as np
import gcsfs
import xarray as xr
from datetime import datetime, timezone, timedelta

# ── Directories ────────────────────────────────────────────────────────────
OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "rainfall_weathernext")
OUTPUT_OVERLAY_DIR = os.path.join(os.getcwd(), "public", "images", "rainfall_weathernext_overlay")
DATA_DIR = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(OUTPUT_OVERLAY_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# ── Region ─────────────────────────────────────────────────────────────────
LAT_MIN, LAT_MAX = 2.0, 28.0
LON_MIN, LON_MAX = 112.0, 140.0

# ── PAR boundary ───────────────────────────────────────────────────────────
PAR_LONS = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
PAR_LATS = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]


def plot_rainfall(lons, lats, precip_grid, filename_id, init_dt, valid_dt_start, valid_dt_end, forecast_hour, province_shapely_geometries):
    fig = plt.figure(figsize=(14, 11))
    fig.subplots_adjust(top=0.88)
    ax = plt.axes(projection=ccrs.PlateCarree())
    ax.set_extent([112, 138, 4, 26], crs=ccrs.PlateCarree())

    # Map Features
    ax.add_feature(cfeature.LAND, facecolor="#eaeaea", zorder=0)
    ax.add_feature(cfeature.OCEAN, facecolor="#d4e5ed", zorder=0)
    ax.add_feature(cfeature.COASTLINE, linewidth=1.0, edgecolor="#222222", zorder=3)
    ax.add_feature(cfeature.BORDERS, linestyle="-", linewidth=0.6, edgecolor="#555555", zorder=3)

    if province_shapely_geometries:
        ax.add_geometries(province_shapely_geometries, crs=ccrs.PlateCarree(),
                          facecolor='none', edgecolor='#555555', linewidth=0.4, alpha=0.6, zorder=3)

    # Gridlines
    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color="gray", alpha=0.4, linestyle=":", zorder=5)
    gl.top_labels = False
    gl.right_labels = False
    gl.xlabel_style = {"size": 10, "color": "#333"}
    gl.ylabel_style = {"size": 10, "color": "#333"}

    # ── Precipitation colormap (Custom Thunderstorm & WeatherNext daily) ──────
    levels = [0.1, 0.5, 1.0, 1.5, 2.5, 5.0, 10.0, 15.0, 20.0, 25.0, 30.0, 35.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0, 125.0, 150.0, 175.0, 200.0, 250.0, 300.0, 400.0]
    colors = [
        "#F0F8FF",   # 0.1 - 0.5 (White / Ice Blue)
        "#C8E6FF",   # 0.5 - 1.0 (Very Light Cyan)
        "#A0D0FF",   # 1.0 - 1.5 (Light Cyan)
        "#78BAFF",   # 1.5 - 2.5 (Light Blue)
        "#4A9EFF",   # 2.5 - 5.0 (Soft Blue)
        "#1E7EFF",   # 5.0 - 10.0 (Medium Blue)
        "#0066DD",   # 10.0 - 15.0 (Deep Blue)
        "#008F8F",   # 15.0 - 20.0 (Teal / Blue-Green)
        "#00B366",   # 20.0 - 25.0 (Green)
        "#4CC700",   # 25.0 - 30.0 (Yellow-Green)
        "#8CDB00",   # 30.0 - 35.0 (Light Yellow-Green)
        "#C8E600",   # 35.0 - 40.0 (Yellow)
        "#FFEA00",   # 40.0 - 50.0 (Bright Yellow)
        "#FFCC00",   # 50.0 - 60.0 (Golden Yellow)
        "#FF9F00",   # 60.0 - 70.0 (Orange)
        "#FF6A00",   # 70.0 - 80.0 (Dark Orange)
        "#FF3A00",   # 80.0 - 90.0 (Orange-Red)
        "#FF1A00",   # 90.0 - 100.0 (Red)
        "#E6006E",   # 100.0 - 125.0 (Red-Magenta)
        "#C8009E",   # 125.0 - 150.0 (Magenta)
        "#A600C8",   # 150.0 - 175.0 (Purple-Magenta)
        "#8500E6",   # 175.0 - 200.0 (Purple)
        "#5F00E6",   # 200.0 - 250.0 (Deep Purple)
        "#3F00B3",   # 250.0 - 300.0 (Dark Violet)
        "#1F005C"    # 300.0 - 400.0 (Midnight Violet)
    ]
    cmap = ListedColormap(colors)
    cmap.set_over('#0F0030') # >= 400.0 (Deep Indigo Black)
    norm = BoundaryNorm(levels, ncolors=len(colors), clip=False)

    LONS, LATS = np.meshgrid(lons, lats)
    
    if np.nanmax(precip_grid) > 0.05:
        cf = ax.contourf(LONS, LATS, precip_grid, levels=levels, cmap=cmap, norm=norm,
                         extend="max", transform=ccrs.PlateCarree(), zorder=2)
        cb = fig.colorbar(cf, ax=ax, orientation="vertical", pad=0.02, shrink=0.85, aspect=25)
        cb.set_ticks(levels)
        cb.ax.tick_params(labelsize=10)
        cb.outline.set_edgecolor("black")
        cb.outline.set_linewidth(1)

    # ── PAR boundary ─────────────────────────────────────────────────────────
    ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(),
            color="#d62728", linestyle="-", linewidth=2.5, zorder=4)

    # ── Banner header ────────────────────────────────────────────────────────
    time_fmt = "%Hz %a, %b %d, %Y"
    init_str = init_dt.strftime(time_fmt)
    valid_str = valid_dt_end.strftime(time_fmt)
    fh_str = f"f{forecast_hour:03d}"

    period_lbl = "Accumulated"
    if "24h" in filename_id: period_lbl = "24-hr Accumulated"
    elif "3d" in filename_id: period_lbl = "72-hr Accumulated"
    elif "7d" in filename_id: period_lbl = "168-hr Accumulated"
    elif "15d" in filename_id: period_lbl = "360-hr Accumulated"
    elif "day" in filename_id: period_lbl = "24-hr (Daily) Accumulated"

    fig.canvas.draw()
    pos = ax.get_position()
    left, right = pos.x0, pos.x1
    y_top = pos.y1 + 0.045
    y_bottom = pos.y1 + 0.015
    y_line = pos.y1 + 0.005

    fig.text(left, y_top, "Philippine T/W", ha="left", va="bottom", fontsize=14, weight="bold", color="#888")
    fig.text(right, y_top, f"WeatherNext 2 {period_lbl} Precip (mm)", ha="right", va="bottom", fontsize=12, weight="bold", color="black")
    fig.text(left, y_bottom, f"Model: WeatherNext 2   |   Forecast Hour: {fh_str}", ha="left", va="bottom", fontsize=11, color="black")
    fig.text(right, y_bottom, f"Init: {init_str} / Valid: {valid_str}", ha="right", va="bottom", fontsize=11, color="black")

    sep = mlines.Line2D((left, right), (y_line, y_line), color="black",
                        linewidth=1, transform=fig.transFigure)
    fig.add_artist(sep)

    filepath = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(filepath, dpi=120, bbox_inches="tight", facecolor="white")
    plt.close()
    print(f"  Saved {filepath}")

    # --- Overlay Frame (Transparent & Borderless for Leaflet) ---
    fig_ol = plt.figure(figsize=(10, 10 * (26 - 4) / (138 - 112)), facecolor='none')
    ax_ol = fig_ol.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree(), facecolor='none')
    ax_ol.set_extent([112, 138, 4, 26], crs=ccrs.PlateCarree())
    ax_ol.set_aspect('auto')
    ax_ol.axis('off')

    if np.nanmax(precip_grid) > 0.05:
        ax_ol.contourf(LONS, LATS, precip_grid, levels=levels, cmap=cmap, norm=norm,
                       extend="max", transform=ccrs.PlateCarree(), zorder=2)

    filepath_ol = os.path.join(OUTPUT_OVERLAY_DIR, f"{filename_id}.png")
    fig_ol.savefig(filepath_ol, dpi=120, transparent=True)
    plt.close(fig_ol)


def main():
    print("=== WeatherNext 2 Daily & Cumulative Precipitation Generator ===")

    # 1. Initialize Google Cloud Storage FileSystem
    print("Connecting to Google Cloud Storage...")
    fs = gcsfs.GCSFileSystem()

    parent_path = 'gs://weathernext/weathernext_2_0_0_mean/zarr/2025_to_present'
    all_items = fs.ls(parent_path)
    run_folders = [f'gs://{item}' for item in all_items if item.endswith('_preds')]

    if not run_folders:
        raise RuntimeError("No forecast run folders found in 2025_to_present!")

    # 2. Get the latest available run folder
    run_folders.sort()
    latest_run_path = run_folders[-1]
    latest_zarr_path = f"{latest_run_path}/predictions.zarr"
    print(f"Opening Zarr dataset at: {latest_zarr_path}")

    # 3. Load Dataset
    store = fs.get_mapper(latest_zarr_path)
    ds = xr.open_zarr(store, consolidated=True)

    # 4. Slice to the Philippine region
    if ds.lat[0] < ds.lat[-1]:
        ds_ph = ds.sel(lat=slice(LAT_MIN, LAT_MAX), lon=slice(LON_MIN, LON_MAX))
    else:
        ds_ph = ds.sel(lat=slice(LAT_MAX, LAT_MIN), lon=slice(LON_MIN, LON_MAX))

    # Load province boundaries
    province_shapely_geometries = []
    geojson_paths = [
        os.path.join(DATA_DIR, "ph_provinces.json"),
        os.path.join(os.getcwd(), "ph_provinces.json"),
        "ph_provinces.json"
    ]
    for p_path in geojson_paths:
        if os.path.exists(p_path):
            try:
                with open(p_path, 'r', encoding='utf-8') as f:
                    geojson_content_dict = json.load(f)
                province_shapely_geometries = [
                    shape(prov_feat['geometry']) for prov_feat in geojson_content_dict['features']
                ]
                print(f"Successfully loaded province boundaries from: {p_path}")
                break
            except Exception as e:
                print(f"Failed to load {p_path}: {e}")

    lats = ds_ph.lat.values
    lons = ds_ph.lon.values

    # Determine time coordinates
    init_time_val = str(ds_ph.init_time.values)[:16]
    init_dt = datetime.strptime(init_time_val.replace("T", " "), "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)

    # We will generate daily frames: day_1, day_2, ..., day_15 (each 24 hours non-cumulative)
    all_periods = []
    
    # Sequential daily periods
    for day in range(1, 16):
        all_periods.append({
            "name": f"weathernext_day_{day}",
            "start_hour": (day - 1) * 24,
            "end_hour": day * 24
        })

    animation_frames = [f"weathernext_day_{i}" for i in range(1, 16)]

    # 5. Extract and Plot each period
    for item in all_periods:
        period_name = item["name"]
        start_hour = item["start_hour"]
        end_hour = item["end_hour"]

        # Indices in steps of 6 hours
        # WeatherNext steps: time values are timedelta64 hours
        start_idx = start_hour // 6
        end_idx = end_hour // 6

        # Sub-selection from ds_ph['total_precipitation_6hr']
        # The variables are: time range slice (start_idx to end_idx)
        # Note: GCS dataset has steps: index 0 is T+6h, index 1 is T+12h, etc.
        # So start_idx should be 0 for Day 1 (forecast step hours: 6, 12, 18, 24) -> slice(0, 4)
        precip_slice = ds_ph['total_precipitation_6hr'].isel(time=slice(start_idx, end_idx))
        total_precip = (precip_slice.sum(dim='time') * 1000.0).values
        total_precip = np.maximum(total_precip, 0)

        valid_dt_start = init_dt + timedelta(hours=start_hour)
        valid_dt_end = init_dt + timedelta(hours=end_hour)

        plot_rainfall(
            lons, lats, total_precip, period_name,
            init_dt, valid_dt_start, valid_dt_end, end_hour, province_shapely_geometries
        )

    # 6. Save Metadata file
    meta = {
        "model": "WeatherNext 2",
        "source": "Google DeepMind / GCS",
        "generated_at": datetime.now().strftime("%Y-%m-%d %I:%M %p"),
        "run_time": init_dt.strftime("%Y-%m-%d %H:%M UTC"),
        "animation_frames": animation_frames
    }
    meta_path = os.path.join(DATA_DIR, "rainfall_weathernext_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
        
    print(f"\nSaved metadata to {meta_path}")
    print("Done!")


if __name__ == "__main__":
    main()
