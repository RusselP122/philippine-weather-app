import os
import json
from shapely.geometry import shape
"""
precip_mslp_aifs.py
===================
Generates 6-hour average precipitation rate (mm/hr) maps overlaid with
MSLP isobars and 1000-500 mb thickness contours from ECMWF AIFS data.

Output: public/images/precip_mslp_aifs/  (PNGs)
        public/data/precip_mslp_aifs_meta.json
"""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.lines as mlines
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import numpy as np
import scipy.ndimage
import os
import sys
import json
import xarray as xr
from datetime import datetime, timedelta, timezone
from ecmwf.opendata import Client

# ── Directories ────────────────────────────────────────────────────────────
OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "precip_mslp_aifs")
OUTPUT_OVERLAY_DIR = os.path.join(os.getcwd(), "public", "images", "precip_mslp_aifs_overlay")
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


# ═══════════════════════════════════════════════════════════════════════════
# Plot one frame
# ═══════════════════════════════════════════════════════════════════════════

def plot_frame(
    lons, lats, precip_rate, msl_data, thickness,
    filename_id, init_time, valid_time, forecast_hour
):
    fig = plt.figure(figsize=(14, 11))
    fig.subplots_adjust(top=0.88)
    ax = plt.axes(projection=ccrs.PlateCarree())
    ax.set_extent([LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], crs=ccrs.PlateCarree())

    # Base map
    ax.add_feature(cfeature.LAND, facecolor="#eaeaea", zorder=0)
    ax.add_feature(cfeature.OCEAN, facecolor="#d4e5ed", zorder=0)
    ax.add_feature(cfeature.COASTLINE, linewidth=1.0, edgecolor="#222", zorder=5)
    ax.add_feature(cfeature.BORDERS, linestyle="-", linewidth=0.6, edgecolor="#555", zorder=5)
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


    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color="gray", alpha=0.4, linestyle=":", zorder=6)
    gl.top_labels = False
    gl.right_labels = False
    gl.xlabel_style = {"size": 10, "color": "#333"}
    gl.ylabel_style = {"size": 10, "color": "#333"}

    # Meshgrid
    if lons.ndim == 1:
        X, Y = np.meshgrid(lons, lats)
    else:
        X, Y = lons, lats

    # ── 1. Precipitation fill ────────────────────────────────────────────
    # Levels scaled for 6-hour accumulation (typical tropical: 0-100mm)
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

    if np.nanmax(precip_rate) > 0:
        cf = ax.contourf(
            X, Y, precip_rate, levels=pr_levels, cmap=pr_cmap, norm=pr_norm,
            extend="max", transform=ccrs.PlateCarree(), zorder=2
        )
        cb = fig.colorbar(cf, ax=ax, orientation="vertical", pad=0.02, shrink=0.85, aspect=25)
        cb.set_ticks(pr_levels)
        cb.ax.tick_params(labelsize=9)
        cb.set_label("6-hr Precipitation (mm)", fontsize=10)
        cb.outline.set_edgecolor("black")
        cb.outline.set_linewidth(1)

    # ── 2. MSLP isobars ───────────────────────────────────────────────────
    if msl_data is not None:
        msl_smooth = scipy.ndimage.gaussian_filter(msl_data, sigma=1)
        cs = ax.contour(
            X, Y, msl_smooth, levels=range(900, 1050, 4),
            colors="black", linewidths=1.2, transform=ccrs.PlateCarree(), zorder=3
        )
        ax.clabel(cs, inline=True, fontsize=9, fmt="%d", colors="black")

    # ── 3. 1000-500 mb thickness ──────────────────────────────────────────
    if thickness is not None:
        thick_smooth = scipy.ndimage.gaussian_filter(thickness, sigma=1.5)
        thick_levels = list(range(492, 600, 6))

        ct = ax.contour(
            X, Y, thick_smooth, levels=thick_levels,
            colors="#2563eb", linewidths=0.8, linestyles="dashed",
            transform=ccrs.PlateCarree(), zorder=3
        )
        ax.clabel(ct, inline=True, fontsize=8, fmt="%d", colors="#2563eb")

        # 540 dam line
        ct540 = ax.contour(
            X, Y, thick_smooth, levels=[540],
            colors="#dc2626", linewidths=2.5, linestyles="solid",
            transform=ccrs.PlateCarree(), zorder=4
        )
        ax.clabel(ct540, inline=True, fontsize=10, fmt="%d", colors="#dc2626")

    # ── 4. PAR boundary ──────────────────────────────────────────────────
    ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(),
            color="#d62728", linestyle="-", linewidth=2.5, zorder=7)

    # ── 5. Banner header ─────────────────────────────────────────────────
    time_fmt = "%Hz %a, %b %d, %Y"
    init_str = init_time.strftime(time_fmt) if init_time else "Unknown"
    valid_str = valid_time.strftime(time_fmt) if valid_time else "Unknown"
    fh_str = f"f{forecast_hour:03d}" if forecast_hour is not None else "f---"

    fig.canvas.draw()
    pos = ax.get_position()
    left, right = pos.x0, pos.x1
    y_top = pos.y1 + 0.045
    y_bottom = pos.y1 + 0.015
    y_line = pos.y1 + 0.005

    fig.text(left, y_top, "Philippine T/W", ha="left", va="bottom",
             fontsize=14, weight="bold", color="#888")
    fig.text(right, y_top,
             "AIFS v2 6-hr Precip (mm), MSLP (hPa) & 1000\u2013500 mb Thickness (dam)",
             ha="right", va="bottom", fontsize=12, weight="bold", color="black")
    fig.text(left, y_bottom, f"Model: ECMWF AIFS v2 (0.25\u00b0)   |   Forecast Hour: {fh_str}",
             ha="left", va="bottom", fontsize=11, color="black")
    fig.text(right, y_bottom, f"Init: {init_str} / Valid: {valid_str}",
             ha="right", va="bottom", fontsize=11, color="black")

    sep = mlines.Line2D((left, right), (y_line, y_line), color="black",
                        linewidth=1, transform=fig.transFigure)
    fig.add_artist(sep)

    filepath = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(filepath, dpi=120, bbox_inches="tight", facecolor="white")
    print(f"  Saved {filepath}")
    plt.close()

    # --- Overlay Frame (Transparent & Borderless for Leaflet) ---
    fig_ol = plt.figure(figsize=(10, 10 * (LAT_MAX - LAT_MIN) / (LON_MAX - LON_MIN)), facecolor='none')
    ax_ol = fig_ol.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree(), facecolor='none')
    ax_ol.set_extent([LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], crs=ccrs.PlateCarree())
    ax_ol.set_aspect('auto')
    ax_ol.axis('off')

    # 1. Precipitation fill
    if np.nanmax(precip_rate) > 0:
        ax_ol.contourf(
            X, Y, precip_rate, levels=pr_levels, cmap=pr_cmap, norm=pr_norm,
            extend="max", transform=ccrs.PlateCarree(), zorder=2
        )

    # 2. MSLP isobars
    if msl_data is not None:
        msl_smooth = scipy.ndimage.gaussian_filter(msl_data, sigma=1)
        cs_ol = ax_ol.contour(
            X, Y, msl_smooth, levels=range(900, 1050, 4),
            colors="black", linewidths=1.2, transform=ccrs.PlateCarree(), zorder=3
        )
        ax_ol.clabel(cs_ol, inline=True, fontsize=9, fmt="%d", colors="black")

    # 3. Thickness
    if thickness is not None:
        thick_smooth = scipy.ndimage.gaussian_filter(thickness, sigma=1.5)
        thick_levels = list(range(492, 600, 6))

        ct_ol = ax_ol.contour(
            X, Y, thick_smooth, levels=thick_levels,
            colors="#2563eb", linewidths=0.8, linestyles="dashed",
            transform=ccrs.PlateCarree(), zorder=3
        )
        ax_ol.clabel(ct_ol, inline=True, fontsize=8, fmt="%d", colors="#2563eb")

        ct540_ol = ax_ol.contour(
            X, Y, thick_smooth, levels=[540],
            colors="#dc2626", linewidths=2.5, linestyles="solid",
            transform=ccrs.PlateCarree(), zorder=4
        )
        ax_ol.clabel(ct540_ol, inline=True, fontsize=10, fmt="%d", colors="#dc2626")

    filepath_ol = os.path.join(OUTPUT_OVERLAY_DIR, f"{filename_id}.png")
    fig_ol.savefig(filepath_ol, dpi=120, transparent=True)
    plt.close(fig_ol)


# ═══════════════════════════════════════════════════════════════════════════
# Main pipeline
# ═══════════════════════════════════════════════════════════════════════════

def main():
    print("\n=== AIFS v2 6-hr Precip Rate + MSLP + Thickness Generator ===\n")

    client = Client(source="azure", model="aifs-single", resol="0p25")

    steps = list(range(0, 361, 6))  # 0 … 360 (15 days)

    run_time_dt = None
    run_time_str = "Latest"
    valid_frames = []

    # We accumulate TP per step, then difference consecutive pairs
    prev_tp = None
    prev_step = None

    for step in steps:
        print(f"\nStep T+{step}h ...")
        target_file = f"aifs_precip_{step:03d}.grib2"

        try:
            # ── 1. Download single-level fields (tp + msl) ────────────────
            client.retrieve(
                step=step,
                type="fc",
                param=["tp", "msl"],
                target=target_file,
            )

            ds_sfc = xr.open_dataset(target_file, engine="cfgrib")

            # Extract run time once
            if "time" in ds_sfc and run_time_dt is None:
                try:
                    rt = ds_sfc["time"].values
                    if rt.ndim == 0:
                        ts = (rt - np.datetime64("1970-01-01T00:00:00Z")) / np.timedelta64(1, "s")
                    else:
                        ts = (rt[-1] - np.datetime64("1970-01-01T00:00:00Z")) / np.timedelta64(1, "s")
                    run_time_dt = datetime.utcfromtimestamp(float(ts))
                    run_time_str = run_time_dt.strftime("%Y-%m-%d %H:%M UTC")
                    print(f"  Run time: {run_time_str}")
                except Exception as e:
                    print(f"  Metadata warning: {e}")

            valid_time_dt = run_time_dt + timedelta(hours=step) if run_time_dt else None

            # Handle multiple times
            if "time" in ds_sfc.dims and ds_sfc.sizes["time"] > 1:
                ds_sfc = ds_sfc.isel(time=-1)

            # TP (total precipitation) — accumulated in metres from T=0
            tp_var = ds_sfc["tp"]  # metres of water equivalent
            tp_grid = tp_var.values.squeeze()

            # MSLP
            msl_var = ds_sfc["msl"]
            msl_grid = msl_var.values.squeeze()
            if np.nanmean(msl_grid) > 50000:
                msl_grid = msl_grid / 100.0  # Pa → hPa

            # Extract coords BEFORE closing dataset
            lat_vals = tp_var.coords["latitude"].values.copy()
            lon_vals = tp_var.coords["longitude"].values.copy()

            ds_sfc.close()
            if os.path.exists(target_file):
                os.remove(target_file)

            # ── 2. Download pressure-level geopotential (500 + 1000 hPa) ──
            thick_grid = None
            pl_file = f"aifs_pl_{step:03d}.grib2"
            try:
                client_pl = Client(source="azure", model="aifs-single", resol="0p25")
                client_pl.retrieve(
                    step=step,
                    type="fc",
                    param=["z"],
                    levelist=[500, 1000],
                    levtype="pl",
                    target=pl_file,
                )

                ds_pl = xr.open_dataset(pl_file, engine="cfgrib")

                if "isobaricInhPa" in ds_pl.dims:
                    z500 = ds_pl["z"].sel(isobaricInhPa=500).values.squeeze()
                    z1000 = ds_pl["z"].sel(isobaricInhPa=1000).values.squeeze()
                elif "level" in ds_pl.dims:
                    z500 = ds_pl["z"].sel(level=500).values.squeeze()
                    z1000 = ds_pl["z"].sel(level=1000).values.squeeze()
                else:
                    # Single level file — try opening multiple datasets
                    datasets = xr.open_datasets(pl_file, engine="cfgrib")
                    z500, z1000 = None, None
                    for d in datasets:
                        if "isobaricInhPa" in d.coords:
                            lev = float(d["isobaricInhPa"].values)
                            if abs(lev - 500) < 1:
                                z500 = d["z"].values.squeeze()
                            elif abs(lev - 1000) < 1:
                                z1000 = d["z"].values.squeeze()
                        d.close()

                if z500 is not None and z1000 is not None:
                    # Geopotential (m²/s²) → geopotential height (m) → dam
                    if np.nanmean(z500) > 100000:
                        z500 = z500 / 9.80665  # m²/s² → m
                        z1000 = z1000 / 9.80665
                    if np.nanmean(z500) > 10000:
                        z500 = z500 / 10.0  # m → dam
                        z1000 = z1000 / 10.0

                    thick_grid = z500 - z1000

                ds_pl.close()
            except Exception as e:
                print(f"  Thickness fetch warning: {e}")
            finally:
                if os.path.exists(pl_file):
                    os.remove(pl_file)

            # ── 3. Compute 6h precip rate ─────────────────────────────────
            if step == 0:
                # No rate at T=0, just store for differencing
                prev_tp = tp_grid.copy()
                prev_step = step
                continue

            if prev_tp is not None:
                delta_tp = tp_grid - prev_tp
                delta_tp = np.maximum(delta_tp, 0)

                # Auto-detect units: if max accumulated tp < 1, it's in metres → convert to mm
                # If > 1, it's already in mm (or kg/m²)
                if np.nanmax(tp_grid) < 1.0:
                    delta_tp_mm = delta_tp * 1000.0  # metres → mm
                else:
                    delta_tp_mm = delta_tp  # already mm

                precip_rate = delta_tp_mm
                print(f"  Precip 6h: max={np.nanmax(precip_rate):.1f} mm")
            else:
                if np.nanmax(tp_grid) < 1.0:
                    precip_rate = tp_grid * 1000.0
                else:
                    precip_rate = tp_grid

            prev_tp = tp_grid.copy()
            prev_step = step

            # ── 4. Subset to region ───────────────────────────────────────
            lat_mask = (lat_vals >= LAT_MIN) & (lat_vals <= LAT_MAX)
            lon_mask = (lon_vals >= LON_MIN) & (lon_vals <= LON_MAX)

            sub_lats = lat_vals[lat_mask]
            sub_lons = lon_vals[lon_mask]

            pr_sub = precip_rate[np.ix_(lat_mask, lon_mask)] if precip_rate.ndim == 2 else precip_rate
            msl_sub = msl_grid[np.ix_(lat_mask, lon_mask)] if msl_grid.ndim == 2 else msl_grid
            thick_sub = thick_grid[np.ix_(lat_mask, lon_mask)] if thick_grid is not None and thick_grid.ndim == 2 else thick_grid

            # ── 5. Plot ──────────────────────────────────────────────────
            frame_id = f"aifs_precip_mslp_{step:03d}"
            plot_frame(
                sub_lons, sub_lats, pr_sub, msl_sub, thick_sub,
                frame_id, run_time_dt, valid_time_dt, step
            )
            valid_frames.append(frame_id)

        except Exception as e:
            print(f"  Error at step {step}: {e}")
            import traceback
            traceback.print_exc()
            if os.path.exists(target_file):
                os.remove(target_file)

    # ── Metadata ──────────────────────────────────────────────────────────
    meta = {
        "model": "ECMWF AIFS v2",
        "source": "ECMWF Open Data via Azure",
        "generated_at": datetime.now().strftime("%Y-%m-%d %I:%M %p"),
        "run_time": run_time_str,
        "animation_frames": valid_frames,
    }
    meta_path = os.path.join(DATA_DIR, "precip_mslp_aifs_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"\nSaved metadata to {meta_path}")
    print(f"Generated {len(valid_frames)} frames. Done!")


if __name__ == "__main__":
    main()
