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
        WIND_SPEED_LEVELS, WIND_SPEED_CMAP, WIND_SPEED_NORM,
        load_ph_provinces, setup_map_ax, draw_par_boundary,
        add_mslp_contours, add_wind_vectors,
        add_styled_colorbar, draw_header_banner,
        DEFAULT_EXTENT, PAR_LONS, PAR_LATS
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
OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "wind_weathernext")
OUTPUT_OVERLAY_DIR = os.path.join(os.getcwd(), "public", "images", "wind_weathernext_overlay")
DATA_DIR = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(OUTPUT_OVERLAY_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

LAT_MIN, LAT_MAX = 2.0, 28.0
LON_MIN, LON_MAX = 112.0, 140.0


def main():
    print("=== WeatherNext 2 Wind + MSLP Generator ===")

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

        frame_id = f"wind_weathernext_{lead_hours:03d}"
        init_time_val = str(ds_target.init_time.values)[:16]
        init_dt = datetime.strptime(init_time_val.replace("T", " "), "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        valid_dt = init_dt + timedelta(hours=lead_hours)

        print(f"Generating frame {i+1}/{total_steps} (Forecast Hour f{lead_hours:03d})...")

        ws_kph = (ds_target['10m_wind_speed'] * 3.6).values
        u_ms = ds_target['10m_u_component_of_wind'].values
        v_ms = ds_target['10m_v_component_of_wind'].values
        msl_data = (ds_target['mean_sea_level_pressure'] / 100.0).values

        # ── 1. Standard Map Frame ────────────────────────────────────────────
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

        # Wind Speed contourf
        cf = ax.contourf(
            X, Y, ws_kph,
            levels=WIND_SPEED_LEVELS,
            cmap=WIND_SPEED_CMAP,
            norm=WIND_SPEED_NORM,
            extend='max',
            transform=ccrs.PlateCarree(),
            zorder=2
        )
        if add_styled_colorbar:
            add_styled_colorbar(fig, cf, ax, label='10m Wind Speed (kph)', ticks=WIND_SPEED_LEVELS)
        else:
            cb = fig.colorbar(cf, ax=ax, orientation='vertical', pad=0.02, shrink=0.85, aspect=25)
            cb.set_ticks(WIND_SPEED_LEVELS)

        # MSLP Isobars
        if add_mslp_contours:
            add_mslp_contours(ax, X, Y, msl_data, levels=range(900, 1050, 4), sigma=1.0)
        else:
            msl_smooth = scipy.ndimage.gaussian_filter(msl_data, sigma=1)
            cs = ax.contour(X, Y, msl_smooth, levels=range(900, 1050, 4), colors='#0f172a', linewidths=1.1, transform=ccrs.PlateCarree(), zorder=3)
            ax.clabel(cs, inline=True, fontsize=8.5, fmt='%d', colors='#0f172a')

        # Wind vectors
        if add_wind_vectors:
            add_wind_vectors(ax, X, Y, u_ms, v_ms, skip=8, scale=400, alpha=0.38)
        else:
            ax.quiver(X[::8, ::8], Y[::8, ::8], u_ms[::8, ::8], v_ms[::8, ::8], transform=ccrs.PlateCarree(), color="#0f172a", alpha=0.35, width=0.0016, scale=400, headwidth=3.5, zorder=4)

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
                right_title="WeatherNext 2 10m Wind Speed (kph) & MSLP (hPa)",
                model_sub=f"Model: Google WeatherNext 2 (0.25°)   |   Forecast Hour: {fh_str}",
                time_sub=f"Init: {init_str} / Valid: {valid_str}"
            )

        filepath = os.path.join(OUTPUT_DIR, f"{frame_id}.png")
        plt.savefig(filepath, dpi=120, bbox_inches='tight', facecolor='white')
        plt.close(fig)

        # ── 2. Leaflet Overlay Frame (Transparent) ───────────────────────────
        fig_ol = plt.figure(figsize=(10, 10), facecolor='none')
        ax_ol = fig_ol.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree(), facecolor='none')
        ax_ol.set_extent([LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], crs=ccrs.PlateCarree())
        ax_ol.axis('off')

        ax_ol.contourf(
            X, Y, ws_kph,
            levels=WIND_SPEED_LEVELS,
            cmap=WIND_SPEED_CMAP,
            norm=WIND_SPEED_NORM,
            extend='max',
            transform=ccrs.PlateCarree(),
            zorder=2
        )

        if add_mslp_contours:
            add_mslp_contours(ax_ol, X, Y, msl_data, levels=range(900, 1050, 4), sigma=1.0)
        if add_wind_vectors:
            add_wind_vectors(ax_ol, X, Y, u_ms, v_ms, skip=8, scale=400, alpha=0.38)

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
    meta_path = os.path.join(DATA_DIR, "wind_weathernext_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\nSaved metadata to {meta_path}")
    print(f"Successfully generated {len(valid_frames)} frames. Done!")


if __name__ == "__main__":
    main()
