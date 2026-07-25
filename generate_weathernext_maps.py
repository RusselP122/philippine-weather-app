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
OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "precip_mslp_weathernext")
OUTPUT_OVERLAY_DIR = os.path.join(os.getcwd(), "public", "images", "precip_mslp_weathernext_overlay")
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


def main():
    print("=== WeatherNext 2 Precip + MSLP + Thickness Generator ===")

    # 1. Initialize Google Cloud Storage FileSystem
    # In GitHub Actions, GOOGLE_APPLICATION_CREDENTIALS env var will be set
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

    # Build coordinate grid
    X, Y = np.meshgrid(ds_ph.lon, ds_ph.lat)

    # Precipitation color styling
    pr_levels = [0, 0.5, 1, 2, 5, 8, 12, 18, 25, 35, 45, 55, 70, 85, 100, 150]
    pr_colors = [
        '#ffffff00',  # 0-0.5 (Transparent)
        '#dbe9f6',    # 0.5-1
        '#a6cbe3',    # 1-2
        '#5ba3d0',    # 2-5
        '#227abb',    # 5-8
        '#4ac15e',    # 8-12
        '#2ea946',    # 12-18
        '#1a862f',    # 18-25
        '#ffdb00',    # 25-35
        '#f7a800',    # 35-45
        '#ea7200',    # 45-55
        '#df4000',    # 55-70
        '#d41c00',    # 70-85
        '#b40047',    # 85-100
        '#c432b4',    # 100-150
    ]
    pr_cmap = ListedColormap(pr_colors)
    pr_cmap.set_over('#4b0082')
    pr_norm = BoundaryNorm(pr_levels, ncolors=len(pr_colors), clip=False)

    valid_frames = []
    total_steps = len(ds_ph.time)

    # 5. Generate and Save PNG frames
    for i in range(total_steps):
        ds_target = ds_ph.isel(time=i)
        lead_hours = int(ds_target.time.values / np.timedelta64(1, 'h'))
        
        # Format filename to match GFS structure: precip_mslp_006.png ...
        frame_id = f"precip_mslp_{lead_hours:03d}"
        
        init_time_val = str(ds_target.init_time.values)[:16]
        # Parse datetime strings to datetime objects for format helper
        init_dt = datetime.strptime(init_time_val.replace("T", " "), "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        valid_dt = init_dt + timedelta(hours=lead_hours)

        # Skip rendering the very first step f000 (usually zero precip rates / analysis only)
        if lead_hours == 0:
            continue

        print(f"Generating frame {i+1}/{total_steps} (Forecast Hour f{lead_hours:03d})...")

        # Variables extraction & scaling
        precip_rate = (ds_target['total_precipitation_6hr'] * 1000.0).values
        msl_data = (ds_target['mean_sea_level_pressure'] / 100.0).values
        
        # Calculate thickness: Z500 - Z1000 in dam
        phi_500 = ds_target['geopotential'].sel(level=500)
        phi_1000 = ds_target['geopotential'].sel(level=1000)
        thickness = ((phi_500 - phi_1000) / 98.0665).values

        # Plot setup
        fig = plt.figure(figsize=(14, 11))
        fig.subplots_adjust(top=0.88)
        ax = plt.axes(projection=ccrs.PlateCarree())
        ax.set_extent([LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], crs=ccrs.PlateCarree())

        # Layer mapping features
        ax.add_feature(cfeature.LAND, facecolor='#eaeaea', zorder=0)
        ax.add_feature(cfeature.OCEAN, facecolor='#d4e5ed', zorder=0)
        ax.add_feature(cfeature.COASTLINE, linewidth=1.0, edgecolor='#222', zorder=5)
        ax.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.6, edgecolor='#555', zorder=5)

        if province_shapely_geometries:
            ax.add_geometries(province_shapely_geometries, crs=ccrs.PlateCarree(),
                              facecolor='none', edgecolor='#555555', linewidth=0.4, alpha=0.6, zorder=3)

        gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.4, linestyle=':', zorder=6)
        gl.top_labels = False
        gl.right_labels = False
        gl.xlabel_style = {'size': 10, 'color': '#333'}
        gl.ylabel_style = {'size': 10, 'color': '#333'}

        # 1. Draw Precipitation rate
        if np.nanmax(precip_rate) > 0.05:
            cf = ax.contourf(
                X, Y, precip_rate, levels=pr_levels, cmap=pr_cmap, norm=pr_norm,
                extend='max', transform=ccrs.PlateCarree(), zorder=2
            )
            cb = fig.colorbar(cf, ax=ax, orientation='vertical', pad=0.02, shrink=0.85, aspect=25)
            cb.set_ticks(pr_levels)
            cb.ax.tick_params(labelsize=9)
            cb.set_label('6-hr Precipitation (mm)', fontsize=10)
            cb.outline.set_edgecolor('black')
            cb.outline.set_linewidth(1)

        # 2. Draw MSLP Isobars
        msl_smooth = scipy.ndimage.gaussian_filter(msl_data, sigma=1)
        cs = ax.contour(
            X, Y, msl_smooth, levels=range(900, 1050, 4),
            colors='black', linewidths=1.2, transform=ccrs.PlateCarree(), zorder=3
        )
        ax.clabel(cs, inline=True, fontsize=9, fmt='%d', colors='black')

        # 3. Draw Thickness
        thick_smooth = scipy.ndimage.gaussian_filter(thickness, sigma=1.5)
        thick_levels = list(range(492, 600, 6))
        ct = ax.contour(
            X, Y, thick_smooth, levels=thick_levels,
            colors='#2563eb', linewidths=0.8, linestyles='dashed',
            transform=ccrs.PlateCarree(), zorder=3
        )
        ax.clabel(ct, inline=True, fontsize=8, fmt='%d', colors='#2563eb')

        # Highlight 540 dam
        ct540 = ax.contour(
            X, Y, thick_smooth, levels=[540],
            colors='#dc2626', linewidths=2.5, linestyles='solid',
            transform=ccrs.PlateCarree(), zorder=4
        )
        ax.clabel(ct540, inline=True, fontsize=10, fmt='%d', colors='#dc2626')

        # 4. Draw PAR Boundary
        ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(),
                color='#d62728', linestyle='-', linewidth=2.5, zorder=7)

        # 5. Text details banner
        time_fmt = "%Hz %a, %b %d, %Y"
        init_str = init_dt.strftime(time_fmt)
        valid_str = valid_dt.strftime(time_fmt)
        fh_str = f"f{lead_hours:03d}"

        pos = ax.get_position()
        left, right = pos.x0, pos.x1
        y_top = pos.y1 + 0.045
        y_bottom = pos.y1 + 0.015
        y_line = pos.y1 + 0.005

        fig.text(left, y_top, 'Philippine T/W', ha='left', va='bottom', fontsize=14, weight='bold', color='#888')
        fig.text(right, y_top, '6-hr Precip (mm), MSLP (hPa) & 1000-500 mb Thickness (dam)',
                 ha='right', va='bottom', fontsize=12, weight='bold', color='black')
        fig.text(left, y_bottom, f'Model: WeatherNext 2 | Forecast Hour: {fh_str}',
                 ha='left', va='bottom', fontsize=11, color='black')
        fig.text(right, y_bottom, f'Init: {init_str} / Valid: {valid_str}',
                 ha='right', va='bottom', fontsize=11, color='black')

        sep = mlines.Line2D((left, right), (y_line, y_line), color='black', linewidth=1, transform=fig.transFigure)
        fig.add_artist(sep)

        # Save frame
        filepath = os.path.join(OUTPUT_DIR, f"{frame_id}.png")
        plt.savefig(filepath, dpi=120, bbox_inches='tight', facecolor='white')
        plt.close()
        
        # --- Overlay Frame (Transparent & Borderless for Leaflet) ---
        fig_ol = plt.figure(figsize=(10, 10), facecolor='none')
        ax_ol = fig_ol.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree(), facecolor='none')
        ax_ol.set_extent([LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], crs=ccrs.PlateCarree())
        ax_ol.axis('off')

        # 1. Draw Precipitation rate
        if np.nanmax(precip_rate) > 0.05:
            ax_ol.contourf(
                X, Y, precip_rate, levels=pr_levels, cmap=pr_cmap, norm=pr_norm,
                extend='max', transform=ccrs.PlateCarree(), zorder=2
            )

        # 2. Draw MSLP Isobars
        msl_smooth = scipy.ndimage.gaussian_filter(msl_data, sigma=1)
        cs_ol = ax_ol.contour(
            X, Y, msl_smooth, levels=range(900, 1050, 4),
            colors='black', linewidths=1.2, transform=ccrs.PlateCarree(), zorder=3
        )
        ax_ol.clabel(cs_ol, inline=True, fontsize=9, fmt='%d', colors='black')

        # 3. Draw Thickness
        thick_smooth = scipy.ndimage.gaussian_filter(thickness, sigma=1.5)
        thick_levels = list(range(492, 600, 6))
        ct_ol = ax_ol.contour(
            X, Y, thick_smooth, levels=thick_levels,
            colors='#2563eb', linewidths=0.8, linestyles='dashed',
            transform=ccrs.PlateCarree(), zorder=3
        )
        ax_ol.clabel(ct_ol, inline=True, fontsize=8, fmt='%d', colors='#2563eb')

        # Highlight 540 dam
        ct540_ol = ax_ol.contour(
            X, Y, thick_smooth, levels=[540],
            colors='#dc2626', linewidths=2.5, linestyles='solid',
            transform=ccrs.PlateCarree(), zorder=4
        )
        ax_ol.clabel(ct540_ol, inline=True, fontsize=10, fmt='%d', colors='#dc2626')

        # Save overlay frame
        filepath_ol = os.path.join(OUTPUT_OVERLAY_DIR, f"{frame_id}.png")
        fig_ol.savefig(filepath_ol, dpi=120, transparent=True)
        plt.close(fig_ol)
        
        valid_frames.append(frame_id)

    # 6. Save Metadata file
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
