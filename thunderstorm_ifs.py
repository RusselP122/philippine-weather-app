import os
import json
from shapely.geometry import shape
import matplotlib
matplotlib.use("Agg")

import matplotlib.pyplot as plt
import matplotlib.lines as mlines
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import numpy as np
import os
import json
import scipy.ndimage
import pandas as pd
from datetime import datetime, timezone
from matplotlib.colors import ListedColormap, BoundaryNorm
import xarray as xr
from ecmwf.opendata import Client

# ── Directories ─────────────────────────────────────────────────────────────
OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "thunderstorm_ifs")
OUTPUT_OVERLAY_DIR = os.path.join(os.getcwd(), "public", "images", "thunderstorm_ifs_overlay")
DATA_DIR = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(OUTPUT_OVERLAY_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# ── Regions ─────────────────────────────────────────────────────────────────
REGIONS = {
    "ph": {"lat_min": 2.0, "lat_max": 28.0, "lon_min": 112.0, "lon_max": 140.0, "title": "Philippine T/W"},
    "luzon": {"lat_min": 11.5, "lat_max": 20.0, "lon_min": 118.5, "lon_max": 126.0, "title": "Luzon, PH"},
    "visayas": {"lat_min": 8.0, "lat_max": 13.5, "lon_min": 120.0, "lon_max": 127.0, "title": "Visayas, PH"},
    "mindanao": {"lat_min": 4.5, "lat_max": 11.0, "lon_min": 118.0, "lon_max": 127.5, "title": "Mindanao, PH"}
}

# ── PAR boundary ────────────────────────────────────────────────────────────
PAR_LONS = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
PAR_LATS = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]

# ═══════════════════════════════════════════════════════════════════════════
# Plotting
# ═══════════════════════════════════════════════════════════════════════════

def plot_thunderstorm_frame(lons, lats, precip_grid, region_id, filename_id,
                            init_time, valid_time, forecast_hour):
    bounds = REGIONS[region_id]
    
    fig = plt.figure(figsize=(14, 11))
    fig.subplots_adjust(top=0.88)
    ax = plt.axes(projection=ccrs.PlateCarree())
    ax.set_extent([bounds["lon_min"], bounds["lon_max"], bounds["lat_min"], bounds["lat_max"]], crs=ccrs.PlateCarree())

    # Map Features
    ax.add_feature(cfeature.LAND, facecolor="#eaeaea", zorder=0)
    ax.add_feature(cfeature.OCEAN, facecolor="#d4e5ed", zorder=0)
    ax.add_feature(cfeature.COASTLINE, linewidth=1.0, edgecolor="#222222", zorder=5)
    ax.add_feature(cfeature.BORDERS, linestyle="-", linewidth=0.6, edgecolor="#555555", zorder=5)
    # Add Philippine province boundaries from ph_provinces.json
    try:

        script_dir_path = os.path.dirname(os.path.abspath(__file__))
        geojson_paths_list = [
            os.path.join(script_dir_path, "public", "data", "ph_provinces.json"),
            os.path.join(os.getcwd(), "public", "data", "ph_provinces.json"),
            "public/data/ph_provinces.json"
        ]
        found_geojson_path = None
        for p_path in geojson_paths_list:
            if os.path.exists(p_path):
                found_geojson_path = p_path
                break
        if found_geojson_path:
            with open(found_geojson_path, 'r', encoding='utf-8') as geojson_file_handle:
                geojson_content_dict = json.load(geojson_file_handle)
            province_shapely_geometries = [shape(prov_feat['geometry']) for prov_feat in geojson_content_dict['features']]
            ax.add_geometries(province_shapely_geometries, crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#555555', linewidth=0.4, alpha=0.6, zorder=3)
    except Exception as province_load_error:
        print(f"Warning: Failed to overlay province boundaries: {province_load_error}")


    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color="gray",
                      alpha=0.4, linestyle=":", zorder=6)
    gl.top_labels = False
    gl.right_labels = False
    gl.xlabel_style = {"size": 10, "color": "#333"}
    gl.ylabel_style = {"size": 10, "color": "#333"}

    # ── Precipitation colormap (Main Layer - High Resolution) ────────────────
    precip_levels = [0.1, 0.5, 1.0, 1.5, 2.5, 5.0, 10.0, 15.0, 20.0, 25.0, 30.0, 35.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0, 125.0, 150.0, 175.0, 200.0, 250.0]
    precip_colors = [
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
        "#5F00E6"    # 200.0 - 250.0 (Deep Purple)
    ]
    p_cmap = ListedColormap(precip_colors)
    p_cmap.set_over("#3F00B3")  # >= 250 (Dark Violet)
    p_norm = BoundaryNorm(precip_levels, ncolors=len(precip_colors), clip=False)

    LONS, LATS = np.meshgrid(lons, lats)
    cf = ax.contourf(LONS, LATS, precip_grid, levels=precip_levels, cmap=p_cmap, norm=p_norm,
                     extend="max", transform=ccrs.PlateCarree(), zorder=2)

    cb = fig.colorbar(cf, ax=ax, orientation="vertical", pad=0.02, shrink=0.85, aspect=25)
    cb_ticks = [0.1, 1.0, 2.5, 5.0, 10.0, 15.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0, 150.0, 200.0, 250.0]
    cb.set_ticks(cb_ticks)
    cb.ax.tick_params(labelsize=9)
    cb.set_label("Accumulated Precip (mm)", fontsize=10)
    cb.outline.set_edgecolor("black")
    cb.outline.set_linewidth(1)



    # ── PAR boundary ─────────────────────────────────────────────────────────
    ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(),
            color="#d62728", linestyle="-", linewidth=2.5, zorder=7)

    # ── Banner header ────────────────────────────────────────────────────────
    time_fmt = "%Hz %b %d, %Y"
    init_str = init_time.strftime(time_fmt) if init_time else "Unknown"
    valid_str = valid_time.strftime(time_fmt) if valid_time else "Unknown"
    fh_str = f"f{forecast_hour:03d}"

    fig.canvas.draw()
    pos = ax.get_position()
    left, right = pos.x0, pos.x1
    y_top = pos.y1 + 0.045
    y_bottom = pos.y1 + 0.015
    y_line = pos.y1 + 0.005

    fig.text(left, y_top, bounds["title"], ha="left", va="bottom", fontsize=14, weight="bold", color="#888")
    fig.text(right, y_top, "Accumulated Precipitation (mm)", ha="right", va="bottom", fontsize=12, weight="bold", color="black")
    
    fig.text(left, y_bottom, f"ECMWF IFS v2   |   Init: {init_str}", ha="left", va="bottom", fontsize=10, color="black")
    fig.text(right, y_bottom, f"Valid: {valid_str}   |   FH: {fh_str}", ha="right", va="bottom", fontsize=10, color="black")

    sep = mlines.Line2D((left, right), (y_line, y_line), color="black",
                        linewidth=1, transform=fig.transFigure)
    fig.add_artist(sep)

    filepath = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(filepath, dpi=120, bbox_inches="tight", facecolor="white")
    plt.close()

    # --- Overlay Frame (Transparent & Borderless for Leaflet) ---
    lon_span = bounds["lon_max"] - bounds["lon_min"]
    lat_span = bounds["lat_max"] - bounds["lat_min"]
    fig_ol = plt.figure(figsize=(10, 10 * lat_span / lon_span), facecolor='none')
    ax_ol = fig_ol.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree(), facecolor='none')
    ax_ol.set_extent([bounds["lon_min"], bounds["lon_max"], bounds["lat_min"], bounds["lat_max"]], crs=ccrs.PlateCarree())
    ax_ol.set_aspect('auto')
    ax_ol.axis('off')

    LONS, LATS = np.meshgrid(lons, lats)
    ax_ol.contourf(LONS, LATS, precip_grid, levels=precip_levels, cmap=p_cmap, norm=p_norm,
                   extend="max", transform=ccrs.PlateCarree(), zorder=2)

    filepath_ol = os.path.join(OUTPUT_OVERLAY_DIR, f"{filename_id}.png")
    fig_ol.savefig(filepath_ol, dpi=120, transparent=True)
    plt.close(fig_ol)

# ═══════════════════════════════════════════════════════════════════════════
# Main Pipeline
# ═══════════════════════════════════════════════════════════════════════════

def main():
    print("\n=== ECMWF IFS v2 Accumulated Precipitation Generator ===\n")

    client = Client(source="azure", model="ifs", resol="0p25")
    steps = [12]  # Only generate the 12-hour accumulation

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

            # tp variable
            tp_data = ds['tp'].values * 1000  # Convert meters to mm
            
            # Filter out negative precipitation due to floating point
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
                    init_time, valid_time, step
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

    # ── Metadata ──────────────────────────────────────────────────────────
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
