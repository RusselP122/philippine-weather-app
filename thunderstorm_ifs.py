import os
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.lines as mlines
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import numpy as np
import scipy.ndimage
import pandas as pd
from datetime import datetime, timezone
from matplotlib.colors import ListedColormap, BoundaryNorm
import xarray as xr
from ecmwf.opendata import Client
from shapely.geometry import shape

# Import standardized visualization system
try:
    from weather_viz_styles import (
        RAINFALL_DAILY_LEVELS, RAINFALL_DAILY_CMAP, RAINFALL_DAILY_NORM,
        load_ph_provinces, setup_map_ax, draw_par_boundary,
        add_styled_colorbar, draw_header_banner,
        PAR_LONS, PAR_LATS
    )
except ImportError:
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

# ── Directories ─────────────────────────────────────────────────────────────
OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "thunderstorm_ifs")
DATA_DIR = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# ── Regions ─────────────────────────────────────────────────────────────────
REGIONS = {
    "ph": {"lat_min": 2.0, "lat_max": 28.0, "lon_min": 112.0, "lon_max": 140.0, "title": "Philippine T/W"},
    "luzon": {"lat_min": 11.5, "lat_max": 20.0, "lon_min": 118.5, "lon_max": 126.0, "title": "Luzon, PH"},
    "visayas": {"lat_min": 8.0, "lat_max": 13.5, "lon_min": 120.0, "lon_max": 127.0, "title": "Visayas, PH"},
    "mindanao": {"lat_min": 4.5, "lat_max": 11.0, "lon_min": 118.0, "lon_max": 127.5, "title": "Mindanao, PH"}
}


def plot_thunderstorm_frame(lons, lats, precip_grid, region_id, filename_id,
                            init_time, valid_time, forecast_hour, province_shapely_geometries=None):
    bounds = REGIONS[region_id]
    extent = [bounds["lon_min"], bounds["lon_max"], bounds["lat_min"], bounds["lat_max"]]

    fig = plt.figure(figsize=(14, 11), dpi=120)
    fig.subplots_adjust(top=0.88)
    ax = plt.axes(projection=ccrs.PlateCarree())

    if setup_map_ax:
        setup_map_ax(ax, extent=extent, provinces=province_shapely_geometries)
    else:
        ax.set_extent(extent, crs=ccrs.PlateCarree())
        ax.add_feature(cfeature.LAND, facecolor="#edf2f7", zorder=0)
        ax.add_feature(cfeature.OCEAN, facecolor="#d9e8f5", zorder=0)
        ax.add_feature(cfeature.COASTLINE, linewidth=0.9, edgecolor="#1e293b", zorder=5)
        ax.add_feature(cfeature.BORDERS, linestyle="-", linewidth=0.55, edgecolor="#64748b", zorder=5)

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
            add_styled_colorbar(fig, cf, ax, label="Accumulated Precip (mm)", ticks=RAINFALL_DAILY_LEVELS)
        else:
            cb = fig.colorbar(cf, ax=ax, orientation="vertical", pad=0.02, shrink=0.85, aspect=25)
            cb.set_ticks(RAINFALL_DAILY_LEVELS)

    # PAR boundary
    if region_id == "ph":
        if draw_par_boundary:
            draw_par_boundary(ax)
        else:
            ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(), color="#dc2626", linestyle="-", linewidth=2.2, zorder=7)

    # Header banner
    time_fmt = "%Hz %b %d, %Y"
    init_str = init_time.strftime(time_fmt) if init_time else "Unknown"
    valid_str = valid_time.strftime(time_fmt) if valid_time else "Unknown"
    fh_str = f"f{forecast_hour:03d}"

    if draw_header_banner:
        draw_header_banner(
            fig, ax,
            left_title=bounds["title"],
            right_title="Accumulated Precipitation (mm)",
            model_sub=f"Model: ECMWF IFS v2 (0.25°)   |   Init: {init_str}",
            time_sub=f"Valid: {valid_str}   |   FH: {fh_str}"
        )

    filepath = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(filepath, dpi=120, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def main():
    print("\n=== ECMWF IFS v2 Accumulated Precipitation Generator ===\n")

    province_shapely_geometries = load_ph_provinces(DATA_DIR)
    client = Client(source="azure", model="ifs", resol="0p25")
    steps = [12]

    valid_frames = {"ph": [], "luzon": [], "visayas": [], "mindanao": []}
    init_time = None
    run_time_str = "Unknown"

    for step in steps:
        print(f"\nStep T+{step}h ...")

        target_file = f"ifs_mucape_{step:03d}.grib2"
        try:
            client.retrieve(
                step=step,
                type="fc",
                param="tp",
                target=target_file
            )
        except Exception as e:
            print(f"  Error downloading step {step}: {e}")
            continue

        try:
            import cfgrib
            ds = xr.open_dataset(target_file, engine="cfgrib")

            if init_time is None:
                init_time = pd.to_datetime(ds.time.values)
                run_time_str = init_time.strftime("%Y-%m-%d %H:%M UTC")

            valid_time = pd.to_datetime(ds.valid_time.values)

            lats = ds.latitude.values
            lons = ds.longitude.values

            tp_data = ds['tp'].values * 1000
            precip_acc = np.maximum(tp_data, 0)

            for region_id, bounds in REGIONS.items():
                lat_idx = np.where((lats >= bounds["lat_min"] - 1) & (lats <= bounds["lat_max"] + 1))[0]
                lon_idx = np.where((lons >= bounds["lon_min"] - 1) & (lons <= bounds["lon_max"] + 1))[0]

                sub_lats = lats[lat_idx]
                sub_lons = lons[lon_idx]

                if lat_idx[0] > lat_idx[-1]:
                    sub_precip = precip_acc[lat_idx[-1]:lat_idx[0]+1, lon_idx[0]:lon_idx[-1]+1]
                else:
                    sub_precip = precip_acc[lat_idx[0]:lat_idx[-1]+1, lon_idx[0]:lon_idx[-1]+1]

                frame_id = f"ifs_thunderstorm_{region_id}_{step:03d}"
                plot_thunderstorm_frame(
                    sub_lons, sub_lats, sub_precip, region_id, frame_id,
                    init_time, valid_time, step,
                    province_shapely_geometries=province_shapely_geometries
                )
                valid_frames[region_id].append(frame_id)
                print(f"  Generated {region_id} max Precip: {np.nanmax(sub_precip):.1f} mm")

        except Exception as e:
            print(f"  Error parsing/plotting step {step}: {e}")
        finally:
            if 'ds' in locals():
                ds.close()
            if os.path.exists(target_file):
                try:
                    os.remove(target_file)
                except Exception as e:
                    print(f"  Could not remove {target_file}: {e}")

    meta = {
        "model": "ECMWF IFS v2",
        "source": "ECMWF Open Data via Azure",
        "generated_at": datetime.now().strftime("%Y-%m-%d %I:%M %p"),
        "run_time": run_time_str,
        "animation_frames": valid_frames
    }

    meta_path = os.path.join(DATA_DIR, "thunderstorm_ifs_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\nSaved metadata to {meta_path}")
    print("Done!")


if __name__ == "__main__":
    main()
