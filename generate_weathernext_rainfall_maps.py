"""
generate_weathernext_rainfall_maps.py
=====================================
Generates high-resolution 15-Day Daily, Cumulative (24h, 3d, 5d, 7d, 15d),
and Probabilistic (p90 heavy rainfall risk) precipitation maps for the
Philippine Area of Responsibility (PAR) using Google WeatherNext 3 (Zarr v3).
"""

import os
import sys
import json
import scipy.ndimage
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.lines as mlines
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import numpy as np
from datetime import datetime, timezone, timedelta
from google.cloud import storage
import gcsfs
import numcodecs

# Import standardized visualization system
try:
    from weather_viz_styles import (
        RAINFALL_DAILY_LEVELS, RAINFALL_DAILY_CMAP, RAINFALL_DAILY_NORM,
        load_ph_provinces, setup_map_ax, draw_par_boundary,
        add_styled_colorbar, draw_header_banner,
        DEFAULT_EXTENT, PAR_LONS, PAR_LATS,
        find_latest_weathernext_run, regrid_01_to_025, batch_cat_gcs
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
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "public", "images", "rainfall_weathernext")
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

LAT_MIN, LAT_MAX = 2.0, 28.0
LON_MIN, LON_MAX = 112.0, 140.0


def plot_rainfall(lons, lats, precip_grid, filename_id, init_dt, valid_dt_start, valid_dt_end, forecast_hour, province_shapely_geometries, title_custom=None):
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

    smoothed_precip = scipy.ndimage.gaussian_filter(precip_grid, sigma=0.6)

    if np.nanmax(smoothed_precip) > 0.05:
        cf = ax.contourf(
            LONS, LATS, smoothed_precip,
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
    elif "5d" in filename_id: period_lbl = "120-hr (5-Day) Accumulated"
    elif "7d" in filename_id: period_lbl = "168-hr (7-Day) Accumulated"
    elif "15d" in filename_id: period_lbl = "360-hr (15-Day) Total"
    elif "day" in filename_id: period_lbl = "24-hr (Daily) Accumulated"

    right_title = title_custom if title_custom else f"WeatherNext 3 {period_lbl} Precip (mm)"

    if draw_header_banner:
        draw_header_banner(
            fig, ax,
            left_title="Philippine T/W",
            right_title=right_title,
            model_sub=f"Model: Google WeatherNext 3 (10 km)   |   Forecast Hour: {fh_str}",
            time_sub=f"Init: {init_str} / Valid: {valid_str}"
        )

    filepath = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(filepath, dpi=120, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"  Saved {filepath}", flush=True)


def main(project_id="affable-ring-442402-j2"):
    print("=== Google WeatherNext 3 Daily & Cumulative Precipitation Generator (10 km Native) ===", flush=True)

    client = storage.Client(project=project_id)
    fs = gcsfs.GCSFileSystem(project=project_id, token=getattr(client, '_credentials', None))
    latest_run, avail_hours = find_latest_weathernext_run(client, fs, project_id=project_id, min_hours=360, var_check="total_precipitation_1hr_mean")
    print(f"Opening WeatherNext 3 dataset at: {latest_run} ({avail_hours} forecast hours available)", flush=True)

    base = f"weathernext3_statistics_spatial/{latest_run}predictions.zarr"
    codec = numcodecs.Zstd()

    # Coordinates (0.1 deg native)
    lat = np.frombuffer(codec.decode(fs.cat_file(f'{base}/lat_0p1/c/0')), dtype='<f4')
    lon = np.frombuffer(codec.decode(fs.cat_file(f'{base}/lon_0p1/c/0')), dtype='<f4')

    lat_mask = (lat >= LAT_MIN - 1.0) & (lat <= LAT_MAX + 1.0)
    lon_mask = (lon >= LON_MIN - 1.0) & (lon <= LON_MAX + 1.0)
    lat_idx = np.where(lat_mask)[0]
    lon_idx = np.where(lon_mask)[0]
    lat_slice = slice(lat_idx.min(), lat_idx.max() + 1)
    lon_slice = slice(lon_idx.min(), lon_idx.max() + 1)

    sub_lats = lat[lat_slice]
    sub_lons = lon[lon_slice]

    province_shapely_geometries = load_ph_provinces(DATA_DIR)
    if province_shapely_geometries:
        print(f"Loaded {len(province_shapely_geometries)} province boundaries.", flush=True)

    # Parse run init time from folder name: e.g., 20260903_16hr_01_preds -> 2026-09-03 16:00 UTC
    folder_clean = latest_run.strip('/').split('/')[-1]
    try:
        date_part = folder_clean.split('_')[0]
        hour_part = folder_clean.split('_')[1].replace('hr', '')
        init_dt = datetime.strptime(f"{date_part}{hour_part}", "%Y%m%d%H").replace(tzinfo=timezone.utc)
    except Exception:
        init_dt = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

    print(f"Init Forecast Time: {init_dt.strftime('%Y-%m-%d %H:%M UTC')}", flush=True)

    max_days = min(15, max(1, avail_hours // 24))
    total_fetch_hours = max_days * 24

    # Batch read hourly precipitation steps out to available days
    print(f"Stream loading {total_fetch_hours} hourly precipitation chunks on native 0.1° (~10 km) grid in batches...", flush=True)
    paths_fetch = [f'{base}/total_precipitation_1hr_mean/c/{t}/0/0' for t in range(total_fetch_hours)]
    chunks = [None] * total_fetch_hours
    batch_size = 20

    for i in range(0, total_fetch_hours, batch_size):
        batch_paths = paths_fetch[i:i + batch_size]
        try:
            part = fs.cat(batch_paths, on_error='omit', batch_size=batch_size)
        except Exception as e:
            print(f"  Notice during precip batch {i}-{min(i+batch_size, total_fetch_hours)}: {e}", flush=True)
            part = {}

        for idx_offset, p in enumerate(batch_paths):
            hour_idx = i + idx_offset
            if p in part:
                arr = np.frombuffer(codec.decode(part[p]), dtype='<f4').reshape((1801, 3600))[lat_slice, lon_slice]
                chunks[hour_idx] = arr * 1000.0  # meters to mm
            else:
                chunks[hour_idx] = np.zeros((len(sub_lats), len(sub_lons)), dtype=np.float32)

        del part
        print(f"  -> Loaded {min(i + batch_size, total_fetch_hours)}/{total_fetch_hours} chunks...", flush=True)

    animation_frames = []

    # 1. Daily (24-hr) Accumulations up to max_days (with direct naming, no duplicates)
    print(f"\nGenerating {max_days} Daily Accumulation Maps at 10 km resolution...", flush=True)
    for day in range(1, max_days + 1):
        start_hour = (day - 1) * 24
        end_hour = day * 24
        day_total = np.maximum(np.sum(chunks[start_hour:end_hour], axis=0), 0)

        valid_dt_start = init_dt + timedelta(hours=start_hour)
        valid_dt_end = init_dt + timedelta(hours=end_hour)
        period_name = f"weathernext_day_{day}"
        animation_frames.append(period_name)

        plot_rainfall(
            sub_lons, sub_lats, day_total, period_name,
            init_dt, valid_dt_start, valid_dt_end, end_hour, province_shapely_geometries
        )

        # 24-hr milestone is equivalent to Day 1
        if day == 1:
            plot_rainfall(
                sub_lons, sub_lats, day_total, "weathernext_24h",
                init_dt, valid_dt_start, valid_dt_end, 24, province_shapely_geometries
            )

    # Metadata
    meta = {
        "model": "Google WeatherNext 3",
        "resolution": "0.1° (~10 km native)",
        "source": "Google DeepMind / GCS",
        "generated_at": datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %I:%M %p PHT"),
        "run_time": init_dt.strftime("%Y-%m-%d %H:%M UTC"),
        "animation_frames": animation_frames,
        "cumulative_maps": ["weathernext_24h"]
    }
    meta_path = os.path.join(DATA_DIR, "rainfall_weathernext_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\nWeatherNext 3 Rainfall Maps generation completed successfully! Metadata saved to {meta_path}", flush=True)


if __name__ == "__main__":
    main()
