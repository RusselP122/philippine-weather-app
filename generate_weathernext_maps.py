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
        PRECIP_6H_LEVELS, PRECIP_6H_CMAP, PRECIP_6H_NORM,
        load_ph_provinces, setup_map_ax, draw_par_boundary,
        add_mslp_contours, add_thickness_contours,
        add_styled_colorbar, draw_header_banner,
        DEFAULT_EXTENT, PAR_LONS, PAR_LATS
    )
except ImportError:
    # Fallback definition if run in isolated environment
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
OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "precip_mslp_weathernext")
OUTPUT_OVERLAY_DIR = os.path.join(os.getcwd(), "public", "images", "precip_mslp_weathernext_overlay")
DATA_DIR = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(OUTPUT_OVERLAY_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

LAT_MIN, LAT_MAX = 2.0, 28.0
LON_MIN, LON_MAX = 112.0, 140.0


def main():
    print("=== WeatherNext 2 Precip + MSLP + Thickness Generator ===")

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

    X, Y = np.meshgrid(ds_ph.lon, ds_ph.lat)

    valid_frames = []
    total_steps = len(ds_ph.time)

    for i in range(total_steps):
        ds_target = ds_ph.isel(time=i)
        lead_hours = int(ds_target.time.values / np.timedelta64(1, 'h'))

        if lead_hours == 0:
            continue

        frame_id = f"precip_mslp_{lead_hours:03d}"
        init_time_val = str(ds_target.init_time.values)[:16]
        init_dt = datetime.strptime(init_time_val.replace("T", " "), "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        valid_dt = init_dt + timedelta(hours=lead_hours)

        print(f"Generating frame {i+1}/{total_steps} (Forecast Hour f{lead_hours:03d})...")

        precip_rate = (ds_target['total_precipitation_6hr'] * 1000.0).values
        msl_data = (ds_target['mean_sea_level_pressure'] / 100.0).values

        phi_500 = ds_target['geopotential'].sel(level=500)
        phi_1000 = ds_target['geopotential'].sel(level=1000)
        thickness = ((phi_500 - phi_1000) / 98.0665).values

        # ── 1. Standard Forecast Map ─────────────────────────────────────────
        fig = plt.figure(figsize=(14, 11), dpi=120)
        fig.subplots_adjust(top=0.88)
        ax = plt.axes(projection=ccrs.PlateCarree())

        if setup_map_ax:
            setup_map_ax(ax, extent=[LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], provinces=province_shapely_geometries)
        else:
            ax.set_extent([LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], crs=ccrs.PlateCarree())
            ax.add_feature(cfeature.LAND, facecolor='#edf2f7', zorder=0)
            ax.add_feature(cfeature.OCEAN, facecolor='#d9e8f5', zorder=0)
            ax.add_feature(cfeature.COASTLINE, linewidth=0.9, edgecolor='#1e293b', zorder=5)
            ax.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.55, edgecolor='#64748b', zorder=5)

        # Precipitation Fill
        if np.nanmax(precip_rate) > 0.05:
            cf = ax.contourf(
                X, Y, precip_rate,
                levels=PRECIP_6H_LEVELS,
                cmap=PRECIP_6H_CMAP,
                norm=PRECIP_6H_NORM,
                extend='max',
                transform=ccrs.PlateCarree(),
                zorder=2
            )
            if add_styled_colorbar:
                add_styled_colorbar(fig, cf, ax, label='6-hr Precipitation (mm)', ticks=PRECIP_6H_LEVELS)
            else:
                cb = fig.colorbar(cf, ax=ax, orientation='vertical', pad=0.02, shrink=0.85, aspect=25)
                cb.set_ticks(PRECIP_6H_LEVELS)

        # MSLP Isobars
        if add_mslp_contours:
            add_mslp_contours(ax, X, Y, msl_data, levels=range(900, 1050, 4), sigma=1.0)
        else:
            msl_smooth = scipy.ndimage.gaussian_filter(msl_data, sigma=1)
            cs = ax.contour(X, Y, msl_smooth, levels=range(900, 1050, 4), colors='#0f172a', linewidths=1.1, transform=ccrs.PlateCarree(), zorder=3)
            ax.clabel(cs, inline=True, fontsize=8.5, fmt='%d', colors='#0f172a')

        # Thickness Contours (1000-500 mb)
        if add_thickness_contours:
            add_thickness_contours(ax, X, Y, thickness, sigma=1.5)
        else:
            thick_smooth = scipy.ndimage.gaussian_filter(thickness, sigma=1.5)
            ct = ax.contour(X, Y, thick_smooth, levels=list(range(492, 600, 6)), colors='#2563eb', linewidths=0.85, linestyles='dashed', transform=ccrs.PlateCarree(), zorder=3)
            ax.clabel(ct, inline=True, fontsize=8, fmt='%d', colors='#2563eb')
            ct540 = ax.contour(X, Y, thick_smooth, levels=[540], colors='#dc2626', linewidths=2.2, linestyles='solid', transform=ccrs.PlateCarree(), zorder=4)
            ax.clabel(ct540, inline=True, fontsize=9, fmt='%d', colors='#dc2626')

        # PAR Boundary
        if draw_par_boundary:
            draw_par_boundary(ax)
        else:
            ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(), color='#dc2626', linestyle='-', linewidth=2.2, zorder=7)

        # Modern Header Banner
        time_fmt = "%Hz %a, %b %d, %Y"
        init_str = init_dt.strftime(time_fmt)
        valid_str = valid_dt.strftime(time_fmt)
        fh_str = f"f{lead_hours:03d}"

        if draw_header_banner:
            draw_header_banner(
                fig, ax,
                left_title="Philippine T/W",
                right_title="6-hr Precip (mm), MSLP (hPa) & 1000-500 mb Thickness (dam)",
                model_sub=f"Model: Google WeatherNext 2 (0.25°)   |   Forecast Hour: {fh_str}",
                time_sub=f"Init: {init_str} / Valid: {valid_str}"
            )

        filepath = os.path.join(OUTPUT_DIR, f"{frame_id}.png")
        plt.savefig(filepath, dpi=120, bbox_inches='tight', facecolor='white')
        plt.close(fig)

        # ── 2. Leaflet Overlay Frame (Transparent & Borderless) ──────────────
        fig_ol = plt.figure(figsize=(10, 10), facecolor='none')
        ax_ol = fig_ol.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree(), facecolor='none')
        ax_ol.set_extent([LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], crs=ccrs.PlateCarree())
        ax_ol.axis('off')

        if np.nanmax(precip_rate) > 0.05:
            ax_ol.contourf(
                X, Y, precip_rate,
                levels=PRECIP_6H_LEVELS,
                cmap=PRECIP_6H_CMAP,
                norm=PRECIP_6H_NORM,
                extend='max',
                transform=ccrs.PlateCarree(),
                zorder=2
            )

        if add_mslp_contours:
            add_mslp_contours(ax_ol, X, Y, msl_data, levels=range(900, 1050, 4), sigma=1.0)
        if add_thickness_contours:
            add_thickness_contours(ax_ol, X, Y, thickness, sigma=1.5)

        filepath_ol = os.path.join(OUTPUT_OVERLAY_DIR, f"{frame_id}.png")
        fig_ol.savefig(filepath_ol, dpi=120, transparent=True)
        plt.close(fig_ol)

        valid_frames.append(frame_id)

    meta = {
        "model": "WeatherNext 2",
        "source": "Google DeepMind / GCS",
        "generated_at": datetime.now().strftime("%Y-%m-%d %I:%M %p"),
        "run_time": init_dt.strftime("%Y-%m-%d %H:%M UTC"),
        "animation_frames": valid_frames
    }
    meta_path = os.path.join(DATA_DIR, "precip_mslp_weathernext_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\nSaved metadata to {meta_path}")
    print(f"Successfully generated {len(valid_frames)} frames. Done!")


if __name__ == "__main__":
    main()
