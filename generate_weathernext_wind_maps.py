"""
generate_weathernext_wind_maps.py
=================================
Generates high-resolution 10m Wind Speed (kph), Wind Direction Streamlines/Quivers,
and Mean Sea Level Pressure (MSLP) Isobars out to 15 Days (f006 to f360) for the
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
        WIND_SPEED_LEVELS, WIND_SPEED_CMAP, WIND_SPEED_NORM,
        load_ph_provinces, setup_map_ax, draw_par_boundary,
        add_mslp_contours, add_wind_vectors,
        add_styled_colorbar, draw_header_banner,
        DEFAULT_EXTENT, PAR_LONS, PAR_LATS,
        find_latest_weathernext_run, regrid_01_to_025, batch_cat_gcs
    )
except ImportError:
    DEFAULT_EXTENT = [112.0, 140.0, 2.0, 28.0]
    PAR_LONS = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
    PAR_LATS = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]
    WIND_SPEED_LEVELS = [0, 5, 10, 20, 30, 40, 50, 60, 75, 90, 105, 120, 140, 165, 185, 220]
    _ws_colors = [
        '#ffffff00', '#f0f9ff', '#bae6fd', '#60a5fa', '#2563eb',
        '#10b981', '#84cc16', '#eab308', '#f97316', '#ea580c',
        '#ef4444', '#dc2626', '#991b1b', '#c026d3', '#7c3aed'
    ]
    WIND_SPEED_CMAP = ListedColormap(_ws_colors)
    WIND_SPEED_CMAP.set_over('#3b0764')
    WIND_SPEED_NORM = BoundaryNorm(WIND_SPEED_LEVELS, ncolors=len(_ws_colors), clip=False)
    load_ph_provinces = lambda d=None: []
    setup_map_ax = None
    draw_par_boundary = None
    add_mslp_contours = None
    add_wind_vectors = None
    add_styled_colorbar = None
    draw_header_banner = None

# ── Directories ────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "public", "images", "wind_weathernext")
OUTPUT_OVERLAY_DIR = os.path.join(BASE_DIR, "public", "images", "wind_weathernext_overlay")
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(OUTPUT_OVERLAY_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

LAT_MIN, LAT_MAX = 2.0, 28.0
LON_MIN, LON_MAX = 112.0, 140.0


def plot_wind_frame(X, Y, ws_kph, u_grid, v_grid, mslp_hpa, lead_hours, init_dt, valid_dt, province_shapely_geometries):
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

    # Wind speed color fill
    cf = ax.contourf(
        X, Y, ws_kph,
        levels=WIND_SPEED_LEVELS,
        cmap=WIND_SPEED_CMAP,
        norm=WIND_SPEED_NORM,
        extend="max",
        transform=ccrs.PlateCarree(),
        zorder=2
    )

    if add_styled_colorbar:
        add_styled_colorbar(fig, cf, ax, label="10m Wind Speed (km/h)", ticks=WIND_SPEED_LEVELS)
    else:
        cb = fig.colorbar(cf, ax=ax, orientation="vertical", pad=0.02, shrink=0.85, aspect=25)
        cb.set_ticks(WIND_SPEED_LEVELS)

    # MSLP Isobars
    if add_mslp_contours:
        add_mslp_contours(ax, X, Y, mslp_hpa, levels=np.arange(980, 1032, 2))
    else:
        smoothed_mslp = scipy.ndimage.gaussian_filter(mslp_hpa, sigma=1.2)
        cs = ax.contour(X, Y, smoothed_mslp, levels=np.arange(980, 1032, 2), colors="#0f172a", linewidths=1.0, transform=ccrs.PlateCarree(), zorder=5)
        ax.clabel(cs, inline=True, fontsize=8, fmt="%d")

    # Wind Vectors / Quivers
    if add_wind_vectors:
        add_wind_vectors(ax, X, Y, u_grid, v_grid, skip=14)
    else:
        skip = 14
        ax.quiver(X[::skip, ::skip], Y[::skip, ::skip], u_grid[::skip, ::skip], v_grid[::skip, ::skip],
                  transform=ccrs.PlateCarree(), scale=400, color="#1e293b", width=0.002, zorder=6)

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
            right_title="WeatherNext 3 10m Wind & MSLP (km/h)",
            model_sub=f"Model: Google WeatherNext 3 (10 km)   |   Forecast Hour: {fh_str}",
            time_sub=f"Init: {init_str} / Valid: {valid_str}"
        )

    out_file = os.path.join(OUTPUT_DIR, f"weathernext_wind_f{lead_hours:03d}.png")
    plt.savefig(out_file, dpi=120, bbox_inches="tight", facecolor="white")
    plt.close(fig)

    # 2. Transparent Web Overlay (for interactive Leaflet / Cyclone visualizer)
    fig_ov, ax_ov = plt.subplots(figsize=(10, 8), dpi=100)
    fig_ov.patch.set_alpha(0.0)
    ax_ov.patch.set_alpha(0.0)
    ax_ov.axis('off')
    plt.subplots_adjust(top=1, bottom=0, right=1, left=0, hspace=0, wspace=0)
    plt.margins(0, 0)
    ax_ov.xaxis.set_major_locator(plt.NullLocator())
    ax_ov.yaxis.set_major_locator(plt.NullLocator())

    ax_ov.contourf(
        X, Y, ws_kph,
        levels=WIND_SPEED_LEVELS,
        cmap=WIND_SPEED_CMAP,
        norm=WIND_SPEED_NORM,
        extend="max",
        alpha=0.85
    )

    overlay_file = os.path.join(OUTPUT_OVERLAY_DIR, f"wind_weathernext_{lead_hours:03d}.png")
    plt.savefig(overlay_file, dpi=100, transparent=True, bbox_inches='tight', pad_inches=0)
    plt.close(fig_ov)
    print(f"  Generated +{lead_hours:03d}h wind map & overlay.", flush=True)


def main(project_id="affable-ring-442402-j2"):
    print("=== Google WeatherNext 3 Wind & MSLP Generator ===", flush=True)

    client = storage.Client(project=project_id)
    fs = gcsfs.GCSFileSystem(project=project_id, token=getattr(client, '_credentials', None))
    latest_run, avail_hours = find_latest_weathernext_run(client, fs, project_id=project_id, min_hours=360, var_check="u_component_of_wind_10m_mean")
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
    X, Y = np.meshgrid(sub_lons, sub_lats)

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

    print(f"Batch loading 10m Wind & MSLP chunks for {len(target_steps)} forecast timesteps on native 0.1° (~10 km) grid...", flush=True)
    ws_paths = [f'{base}/wind_speed_10m_mean/c/{t}/0/0' for t in target_steps]
    u_paths = [f'{base}/u_component_of_wind_10m_mean/c/{t}/0/0' for t in target_steps]
    v_paths = [f'{base}/v_component_of_wind_10m_mean/c/{t}/0/0' for t in target_steps]
    mslp_paths = [f'{base}/mean_sea_level_pressure_mean/c/{t}/0/0' for t in target_steps]

    all_paths = ws_paths + u_paths + v_paths + mslp_paths
    raw_dict = batch_cat_gcs(fs, all_paths, batch_size=20, desc="Wind chunks")

    valid_frames = []

    for t in target_steps:
        p_ws = f'{base}/wind_speed_10m_mean/c/{t}/0/0'
        p_u = f'{base}/u_component_of_wind_10m_mean/c/{t}/0/0'
        p_v = f'{base}/v_component_of_wind_10m_mean/c/{t}/0/0'
        p_mslp = f'{base}/mean_sea_level_pressure_mean/c/{t}/0/0'

        if p_ws in raw_dict and p_u in raw_dict and p_v in raw_dict and p_mslp in raw_dict:
            ws_arr = np.frombuffer(codec.decode(raw_dict[p_ws]), dtype='<f4').reshape((1801, 3600))[lat_slice, lon_slice]
            u_arr = np.frombuffer(codec.decode(raw_dict[p_u]), dtype='<f4').reshape((1801, 3600))[lat_slice, lon_slice]
            v_arr = np.frombuffer(codec.decode(raw_dict[p_v]), dtype='<f4').reshape((1801, 3600))[lat_slice, lon_slice]
            mslp_arr = np.frombuffer(codec.decode(raw_dict[p_mslp]), dtype='<f4').reshape((1801, 3600))[lat_slice, lon_slice]

            ws_kph = ws_arr * 3.6  # m/s to kph
            mslp_hpa = mslp_arr / 100.0  # Pa to hPa
            valid_dt = init_dt + timedelta(hours=t)

            plot_wind_frame(
                X, Y, ws_kph, u_arr, v_arr, mslp_hpa,
                t, init_dt, valid_dt, province_shapely_geometries
            )
            valid_frames.append(f"weathernext_wind_f{t:03d}")

    # Metadata
    meta = {
        "model": "Google WeatherNext 3",
        "resolution": "0.1° (~10 km native)",
        "source": "Google DeepMind / GCS",
        "generated_at": datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %I:%M %p PHT"),
        "run_time": init_dt.strftime("%Y-%m-%d %H:%M UTC"),
        "total_timesteps": len(valid_frames),
        "step_hours": 6,
        "max_hour": target_steps[-1] if target_steps else 360,
        "animation_frames": valid_frames
    }
    meta_path = os.path.join(DATA_DIR, "wind_weathernext_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\nWeatherNext 3 Wind Maps generation completed successfully! Metadata saved to {meta_path}", flush=True)


if __name__ == "__main__":
    main()
