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

# Import standardized visualization system
try:
    from weather_viz_styles import (
        RAINFALL_DAILY_LEVELS, RAINFALL_DAILY_CMAP, RAINFALL_DAILY_NORM,
        load_ph_provinces, setup_map_ax, draw_par_boundary,
        add_styled_colorbar, draw_header_banner,
        DEFAULT_EXTENT, PAR_LONS, PAR_LATS
    )
except ImportError:
    DEFAULT_EXTENT = [112.0, 138.0, 4.0, 26.0]
    PAR_LONS = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
    PAR_LATS = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]
    RAINFALL_DAILY_LEVELS = [
        0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 15.0, 20.0, 30.0, 40.0,
        50.0, 65.0, 80.0, 100.0, 125.0, 150.0, 175.0, 200.0, 250.0, 300.0, 400.0
    ]
    _rf_colors = [
        '#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0284c7',
        '#0369a1', '#0d9488', '#10b981', '#16a34a', '#84cc16',
        '#eab308', '#f97316', '#ea580c', '#ef4444', '#dc2626',
        '#b91c1c', '#db2777', '#c026d3', '#9333ea', '#6b21a8'
    ]
    RAINFALL_DAILY_CMAP = ListedColormap(_rf_colors)
    RAINFALL_DAILY_CMAP.set_over('#2e1065')
    RAINFALL_DAILY_NORM = BoundaryNorm(RAINFALL_DAILY_LEVELS, ncolors=len(_rf_colors), clip=False)
    load_ph_provinces = lambda d=None: []
    setup_map_ax = None
    draw_par_boundary = None
    add_styled_colorbar = None
    draw_header_banner = None

# ── Directories ────────────────────────────────────────────────────────────
OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "rainfall_weathernext")
DATA_DIR = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

LAT_MIN, LAT_MAX = 2.0, 28.0
LON_MIN, LON_MAX = 112.0, 140.0


def plot_rainfall(lons, lats, precip_grid, filename_id, init_dt, valid_dt_start, valid_dt_end, forecast_hour, province_shapely_geometries):
    fig = plt.figure(figsize=(14, 11), dpi=120)
    fig.subplots_adjust(top=0.88)
    ax = plt.axes(projection=ccrs.PlateCarree())

    extent = [112.0, 138.0, 4.0, 26.0]
    if setup_map_ax:
        setup_map_ax(ax, extent=extent, provinces=province_shapely_geometries)
    else:
        ax.set_extent(extent, crs=ccrs.PlateCarree())
        ax.add_feature(cfeature.LAND, facecolor="#edf2f7", zorder=0)
        ax.add_feature(cfeature.OCEAN, facecolor="#d9e8f5", zorder=0)
        ax.add_feature(cfeature.COASTLINE, linewidth=0.9, edgecolor="#1e293b", zorder=3)
        ax.add_feature(cfeature.BORDERS, linestyle="-", linewidth=0.55, edgecolor="#64748b", zorder=3)

    LONS, LATS = np.meshgrid(lons, lats) if lons.ndim == 1 else (lons, lats)

    if np.nanmax(precip_grid) > 0.05:
        cf = ax.contourf(
            LONS, LATS, precip_grid,
            levels=RAINFALL_DAILY_LEVELS,
            cmap=RAINFALL_DAILY_CMAP,
            norm=RAINFALL_DAILY_NORM,
            extend="max",
            transform=ccrs.PlateCarree(),
            zorder=2
        )
        if add_styled_colorbar:
            add_styled_colorbar(fig, cf, ax, label="Accumulated Precipitation (mm)", ticks=RAINFALL_DAILY_LEVELS)
        else:
            cb = fig.colorbar(cf, ax=ax, orientation="vertical", pad=0.02, shrink=0.85, aspect=25)
            cb.set_ticks(RAINFALL_DAILY_LEVELS)

    # PAR boundary
    if draw_par_boundary:
        draw_par_boundary(ax)
    else:
        ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(), color="#dc2626", linestyle="-", linewidth=2.2, zorder=4)

    # Header banner
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

    if draw_header_banner:
        draw_header_banner(
            fig, ax,
            left_title="Philippine T/W",
            right_title=f"WeatherNext 2 {period_lbl} Precip (mm)",
            model_sub=f"Model: Google WeatherNext 2 (0.25°)   |   Forecast Hour: {fh_str}",
            time_sub=f"Init: {init_str} / Valid: {valid_str}"
        )

    filepath = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(filepath, dpi=120, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"  Saved {filepath}")


def main():
    print("=== WeatherNext 2 Daily & Cumulative Precipitation Generator ===")

    print("Connecting to Google Cloud Storage...")
    fs = gcsfs.GCSFileSystem()

    parent_path = 'gs://weathernext/weathernext_2_0_0_mean/zarr/2025_to_present'
    all_items = fs.ls(parent_path)
    run_folders = [f'gs://{item}' for item in all_items if item.endswith('_preds')]

    if not run_folders:
        raise RuntimeError("No forecast run folders found in 2025_to_present!")

    run_folders.sort()
    latest_run_path = run_folders[-1]
    latest_zarr_path = f"{latest_run_path}/predictions.zarr"
    print(f"Opening Zarr dataset at: {latest_zarr_path}")

    store = fs.get_mapper(latest_zarr_path)
    ds = xr.open_zarr(store, consolidated=True)

    if ds.lat[0] < ds.lat[-1]:
        ds_ph = ds.sel(lat=slice(LAT_MIN, LAT_MAX), lon=slice(LON_MIN, LON_MAX))
    else:
        ds_ph = ds.sel(lat=slice(LAT_MAX, LAT_MIN), lon=slice(LON_MIN, LON_MAX))

    province_shapely_geometries = load_ph_provinces(DATA_DIR)
    if province_shapely_geometries:
        print(f"Successfully loaded {len(province_shapely_geometries)} province boundaries.")

    lats = ds_ph.lat.values
    lons = ds_ph.lon.values

    init_time_val = str(ds_ph.init_time.values)[:16]
    init_dt = datetime.strptime(init_time_val.replace("T", " "), "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)

    all_periods = []
    for day in range(1, 16):
        all_periods.append({
            "name": f"weathernext_day_{day}",
            "start_hour": (day - 1) * 24,
            "end_hour": day * 24
        })

    animation_frames = [f"weathernext_day_{i}" for i in range(1, 16)]

    for item in all_periods:
        period_name = item["name"]
        start_hour = item["start_hour"]
        end_hour = item["end_hour"]

        start_idx = start_hour // 6
        end_idx = end_hour // 6

        precip_slice = ds_ph['total_precipitation_6hr'].isel(time=slice(start_idx, end_idx))
        total_precip = (precip_slice.sum(dim='time') * 1000.0).values
        total_precip = np.maximum(total_precip, 0)

        valid_dt_start = init_dt + timedelta(hours=start_hour)
        valid_dt_end = init_dt + timedelta(hours=end_hour)

        plot_rainfall(
            lons, lats, total_precip, period_name,
            init_dt, valid_dt_start, valid_dt_end, end_hour, province_shapely_geometries
        )

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
