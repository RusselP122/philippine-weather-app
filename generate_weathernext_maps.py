"""
generate_weathernext_maps.py
============================
Generates 6-hourly Synoptic Maps (6h Precip Accumulation + MSLP Isobars + 1000-500 mb Thickness)
out to 15 Days (f006 to f360) for the Philippine Area of Responsibility (PAR)
using Google WeatherNext 3 (Zarr v3).
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
        PRECIP_6H_LEVELS, PRECIP_6H_CMAP, PRECIP_6H_NORM,
        load_ph_provinces, setup_map_ax, draw_par_boundary,
        add_mslp_contours, add_thickness_contours,
        add_styled_colorbar, draw_header_banner,
        DEFAULT_EXTENT, PAR_LONS, PAR_LATS,
        find_latest_weathernext_run, regrid_01_to_025, batch_cat_gcs
    )
except ImportError:
    DEFAULT_EXTENT = [112.0, 140.0, 2.0, 28.0]
    PAR_LONS = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
    PAR_LATS = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]
    PRECIP_6H_LEVELS = [0, 0.5, 1, 2, 5, 8, 12, 18, 25, 35, 45, 55, 70, 85, 100, 150]
    _pr_colors = [
        '#ffffff00', '#d4e6f6', '#a3c9e8', '#5b9cd6', '#246bb4',
        '#2db87a', '#1b964f', '#107536', '#f7d028', '#f59e0b',
        '#ea580c', '#dc2626', '#b91c1c', '#991b1b', '#c026d3'
    ]
    PRECIP_6H_CMAP = ListedColormap(_pr_colors)
    PRECIP_6H_CMAP.set_over('#4c1d95')
    PRECIP_6H_NORM = BoundaryNorm(PRECIP_6H_LEVELS, ncolors=len(_pr_colors), clip=False)
    load_ph_provinces = lambda d=None: []
    setup_map_ax = None
    draw_par_boundary = None
    add_mslp_contours = None
    add_thickness_contours = None
    add_styled_colorbar = None
    draw_header_banner = None

# ── Directories ────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "public", "images", "precip_mslp_weathernext")
OUTPUT_OVERLAY_DIR = os.path.join(BASE_DIR, "public", "images", "precip_mslp_weathernext_overlay")
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(OUTPUT_OVERLAY_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

LAT_MIN, LAT_MAX = 2.0, 28.0
LON_MIN, LON_MAX = 112.0, 140.0


def plot_precip_mslp_frame(X, Y, precip_6h, mslp_hpa, lead_hours, init_dt, valid_dt, province_shapely_geometries):
    # 1. Main Broadcast Map
    fig = plt.figure(figsize=(14, 11), dpi=120)
    fig.subplots_adjust(top=0.88)
    ax = plt.axes(projection=ccrs.PlateCarree())

    extent = [112.0, 140.0, 2.0, 28.0]
    if setup_map_ax:
        setup_map_ax(ax, extent=extent, provinces=province_shapely_geometries)
    else:
        ax.set_extent(extent, crs=ccrs.PlateCarree())
        ax.add_feature(cfeature.LAND, facecolor="#edf2f7", zorder=0)
        ax.add_feature(cfeature.OCEAN, facecolor="#d9e8f5", zorder=0)
        ax.add_feature(cfeature.COASTLINE, linewidth=0.9, edgecolor="#1e293b", zorder=3)
        ax.add_feature(cfeature.BORDERS, linestyle="-", linewidth=0.55, edgecolor="#64748b", zorder=3)

    # 6h Precipitation fill
    smoothed_precip = scipy.ndimage.gaussian_filter(precip_6h, sigma=0.6)
    if np.nanmax(smoothed_precip) > 0.1:
        cf = ax.contourf(
            X, Y, smoothed_precip,
            levels=PRECIP_6H_LEVELS,
            cmap=PRECIP_6H_CMAP,
            norm=PRECIP_6H_NORM,
            extend="max",
            transform=ccrs.PlateCarree(),
            zorder=2
        )
        if add_styled_colorbar:
            add_styled_colorbar(fig, cf, ax, label="6-hr Accumulated Precip (mm)", ticks=PRECIP_6H_LEVELS)
        else:
            cb = fig.colorbar(cf, ax=ax, orientation="vertical", pad=0.02, shrink=0.85, aspect=25)
            cb.set_ticks(PRECIP_6H_LEVELS)

    # MSLP Isobars
    if add_mslp_contours:
        add_mslp_contours(ax, X, Y, mslp_hpa, levels=np.arange(980, 1032, 2))
    else:
        smoothed_mslp = scipy.ndimage.gaussian_filter(mslp_hpa, sigma=1.2)
        cs = ax.contour(X, Y, smoothed_mslp, levels=np.arange(980, 1032, 2), colors="#0f172a", linewidths=1.0, transform=ccrs.PlateCarree(), zorder=5)
        ax.clabel(cs, inline=True, fontsize=8, fmt="%d")

    # PAR Boundary
    if draw_par_boundary:
        draw_par_boundary(ax)
    else:
        ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(), color="#dc2626", linestyle="-", linewidth=2.2, zorder=7)

    # Header banner
    time_fmt = "%Hz %a, %b %d, %Y"
    init_str = init_dt.strftime(time_fmt)
    valid_str = valid_dt.strftime(time_fmt)
    fh_str = f"f{lead_hours:03d}"

    if draw_header_banner:
        draw_header_banner(
            fig, ax,
            left_title="Philippine T/W",
            right_title="WeatherNext 3 6h Precip + MSLP (mm)",
            model_sub=f"Model: Google WeatherNext 3 (0.25°)   |   Forecast Hour: {fh_str}",
            time_sub=f"Init: {init_str} / Valid: {valid_str}"
        )

    out_file = os.path.join(OUTPUT_DIR, f"precip_mslp_weathernext_f{lead_hours:03d}.png")
    plt.savefig(out_file, dpi=120, bbox_inches="tight", facecolor="white")
    plt.close(fig)

    # 2. Transparent Web Overlay (for Cyclone visualizer: /images/precip_mslp_weathernext_overlay/precip_mslp_{hour:03d}.png)
    fig_ov, ax_ov = plt.subplots(figsize=(10, 8), dpi=100)
    fig_ov.patch.set_alpha(0.0)
    ax_ov.patch.set_alpha(0.0)
    ax_ov.axis('off')
    plt.subplots_adjust(top=1, bottom=0, right=1, left=0, hspace=0, wspace=0)
    plt.margins(0, 0)
    ax_ov.xaxis.set_major_locator(plt.NullLocator())
    ax_ov.yaxis.set_major_locator(plt.NullLocator())

    if np.nanmax(smoothed_precip) > 0.1:
        ax_ov.contourf(
            X, Y, smoothed_precip,
            levels=PRECIP_6H_LEVELS,
            cmap=PRECIP_6H_CMAP,
            norm=PRECIP_6H_NORM,
            extend="max",
            alpha=0.85
        )

    overlay_file = os.path.join(OUTPUT_OVERLAY_DIR, f"precip_mslp_{lead_hours:03d}.png")
    plt.savefig(overlay_file, dpi=100, transparent=True, bbox_inches='tight', pad_inches=0)
    plt.close(fig_ov)
    print(f"  Generated +{lead_hours:03d}h Precip+MSLP map & overlay.", flush=True)


def main(project_id="affable-ring-442402-j2"):
    print("=== Google WeatherNext 3 Precip + MSLP Generator ===", flush=True)

    client = storage.Client(project=project_id)
    fs = gcsfs.GCSFileSystem(project=project_id, token=getattr(client, '_credentials', None))
    latest_run, avail_hours = find_latest_weathernext_run(client, fs, project_id=project_id, min_hours=360, var_check="mean_sea_level_pressure_mean")
    print(f"Opening WeatherNext 3 dataset at: {latest_run} ({avail_hours} forecast hours available)", flush=True)

    base = f"weathernext3_statistics_spatial/{latest_run}predictions.zarr"
    codec = numcodecs.Zstd()

    # Read coordinates
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

    # Standardized 0.25 deg grid (matching GFS/AIFS standards)
    dst_lons = np.arange(LON_MIN, LON_MAX + 0.01, 0.25)
    dst_lats = np.arange(LAT_MIN, LAT_MAX + 0.01, 0.25)
    X, Y = np.meshgrid(dst_lons, dst_lats)

    province_shapely_geometries = load_ph_provinces(DATA_DIR)

    folder_clean = latest_run.strip('/').split('/')[-1]
    try:
        date_part = folder_clean.split('_')[0]
        hour_part = folder_clean.split('_')[1].replace('hr', '')
        init_dt = datetime.strptime(f"{date_part}{hour_part}", "%Y%m%d%H").replace(tzinfo=timezone.utc)
    except Exception:
        init_dt = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

    # 6-hourly steps out to available hours (up to 360 hours / 60 steps)
    target_steps = [t for t in range(6, min(361, avail_hours + 1), 6)]
    max_hour_fetch = target_steps[-1] if target_steps else avail_hours

    print(f"Batch loading 1-hr precipitation and MSLP chunks out to {max_hour_fetch}h on 0.25° grid...", flush=True)
    precip_paths = [f'{base}/total_precipitation_1hr_mean/c/{t}/0/0' for t in range(max_hour_fetch)]
    mslp_paths = [f'{base}/mean_sea_level_pressure_mean/c/{t}/0/0' for t in target_steps]

    all_paths = precip_paths + mslp_paths
    raw_dict = batch_cat_gcs(fs, all_paths, batch_size=20, desc="Precip+MSLP chunks")

    p_chunks = []
    for p in precip_paths:
        if p in raw_dict:
            arr = np.frombuffer(codec.decode(raw_dict[p]), dtype='<f4').reshape((1801, 3600))[lat_slice, lon_slice]
            _, _, arr_025 = regrid_01_to_025(sub_lats, sub_lons, arr, dst_lats=dst_lats, dst_lons=dst_lons)
            p_chunks.append(arr_025 * 1000.0) # meters to mm
        else:
            p_chunks.append(np.zeros((len(dst_lats), len(dst_lons)), dtype=np.float32))

    valid_frames = []

    for t in target_steps:
        # Sum 6 hourly chunks leading up to t (t-6 to t)
        p_6h = np.maximum(np.sum(p_chunks[t-6:t], axis=0), 0)

        p_mslp = f'{base}/mean_sea_level_pressure_mean/c/{t}/0/0'
        if p_mslp in raw_dict:
            mslp_arr = np.frombuffer(codec.decode(raw_dict[p_mslp]), dtype='<f4').reshape((1801, 3600))[lat_slice, lon_slice]
            _, _, mslp_arr_025 = regrid_01_to_025(sub_lats, sub_lons, mslp_arr, dst_lats=dst_lats, dst_lons=dst_lons)
            mslp_hpa = mslp_arr_025 / 100.0
        else:
            mslp_hpa = np.full_like(X, 1012.0)

        valid_dt = init_dt + timedelta(hours=t)

        plot_precip_mslp_frame(
            X, Y, p_6h, mslp_hpa,
            t, init_dt, valid_dt, province_shapely_geometries
        )
        valid_frames.append(f"precip_mslp_{t:03d}")

    # Metadata
    meta = {
        "model": "Google WeatherNext 3",
        "resolution": "0.25° (~28 km)",
        "source": "Google DeepMind / GCS",
        "generated_at": datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %I:%M %p PHT"),
        "run_time": init_dt.strftime("%Y-%m-%d %H:%M UTC"),
        "total_timesteps": len(valid_frames),
        "step_hours": 6,
        "max_hour": target_steps[-1] if target_steps else 360,
        "animation_frames": valid_frames
    }
    meta_path = os.path.join(DATA_DIR, "precip_mslp_weathernext_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\nWeatherNext 3 Precip+MSLP Maps generation completed successfully! Metadata saved to {meta_path}", flush=True)


if __name__ == "__main__":
    main()
