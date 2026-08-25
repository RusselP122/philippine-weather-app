import os
import sys
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.lines as mlines
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from shapely.geometry import shape
import numpy as np
import scipy.ndimage
import xarray as xr
from datetime import datetime, timedelta, timezone
from ecmwf.opendata import Client

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
OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "precip_mslp_aifs")
DATA_DIR = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

LAT_MIN, LAT_MAX = 2.0, 28.0
LON_MIN, LON_MAX = 112.0, 140.0


def plot_frame(
    lons, lats, precip_rate, msl_data, thickness,
    filename_id, init_time, valid_time, forecast_hour,
    province_shapely_geometries=None
):
    fig = plt.figure(figsize=(14, 11), dpi=120)
    fig.subplots_adjust(top=0.88)
    ax = plt.axes(projection=ccrs.PlateCarree())

    if setup_map_ax:
        setup_map_ax(ax, extent=[LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], provinces=province_shapely_geometries)
    else:
        ax.set_extent([LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], crs=ccrs.PlateCarree())
        ax.add_feature(cfeature.LAND, facecolor="#edf2f7", zorder=0)
        ax.add_feature(cfeature.OCEAN, facecolor="#d9e8f5", zorder=0)
        ax.add_feature(cfeature.COASTLINE, linewidth=0.9, edgecolor="#1e293b", zorder=5)
        ax.add_feature(cfeature.BORDERS, linestyle="-", linewidth=0.55, edgecolor="#64748b", zorder=5)

    if lons.ndim == 1:
        X, Y = np.meshgrid(lons, lats)
    else:
        X, Y = lons, lats

    # 1. Precipitation fill
    if np.nanmax(precip_rate) > 0.05:
        cf = ax.contourf(
            X, Y, precip_rate,
            levels=PRECIP_6H_LEVELS,
            cmap=PRECIP_6H_CMAP,
            norm=PRECIP_6H_NORM,
            extend="max",
            transform=ccrs.PlateCarree(),
            zorder=2
        )
        if add_styled_colorbar:
            add_styled_colorbar(fig, cf, ax, label="6-hr Precipitation (mm)", ticks=PRECIP_6H_LEVELS)
        else:
            cb = fig.colorbar(cf, ax=ax, orientation="vertical", pad=0.02, shrink=0.85, aspect=25)
            cb.set_ticks(PRECIP_6H_LEVELS)

    # 2. MSLP isobars
    if msl_data is not None:
        if add_mslp_contours:
            add_mslp_contours(ax, X, Y, msl_data, levels=range(900, 1050, 4), sigma=1.0)
        else:
            msl_smooth = scipy.ndimage.gaussian_filter(msl_data, sigma=1)
            cs = ax.contour(X, Y, msl_smooth, levels=range(900, 1050, 4), colors="#0f172a", linewidths=1.1, transform=ccrs.PlateCarree(), zorder=3)
            ax.clabel(cs, inline=True, fontsize=8.5, fmt="%d", colors="#0f172a")

    # 3. 1000-500 mb thickness
    if thickness is not None:
        if add_thickness_contours:
            add_thickness_contours(ax, X, Y, thickness, sigma=1.5)
        else:
            thick_smooth = scipy.ndimage.gaussian_filter(thickness, sigma=1.5)
            ct = ax.contour(X, Y, thick_smooth, levels=list(range(492, 600, 6)), colors="#2563eb", linewidths=0.85, linestyles="dashed", transform=ccrs.PlateCarree(), zorder=3)
            ax.clabel(ct, inline=True, fontsize=8, fmt="%d", colors="#2563eb")
            ct540 = ax.contour(X, Y, thick_smooth, levels=[540], colors="#dc2626", linewidths=2.2, linestyles="solid", transform=ccrs.PlateCarree(), zorder=4)
            ax.clabel(ct540, inline=True, fontsize=9, fmt="%d", colors="#dc2626")

    # 4. PAR boundary
    if draw_par_boundary:
        draw_par_boundary(ax)
    else:
        ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(), color="#dc2626", linestyle="-", linewidth=2.2, zorder=7)

    # 5. Header banner
    time_fmt = "%Hz %a, %b %d, %Y"
    init_str = init_time.strftime(time_fmt) if init_time else "Unknown"
    valid_str = valid_time.strftime(time_fmt) if valid_time else "Unknown"
    fh_str = f"f{forecast_hour:03d}" if forecast_hour is not None else "f---"

    if draw_header_banner:
        draw_header_banner(
            fig, ax,
            left_title="Philippine T/W",
            right_title="AIFS v2 6-hr Precip (mm), MSLP (hPa) & 1000-500 mb Thickness (dam)",
            model_sub=f"Model: ECMWF AIFS v2 (0.25°)   |   Forecast Hour: {fh_str}",
            time_sub=f"Init: {init_str} / Valid: {valid_str}"
        )

    filepath = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(filepath, dpi=120, bbox_inches="tight", facecolor="white")
    print(f"  Saved {filepath}")
    plt.close(fig)


def main():
    print("\n=== AIFS v2 6-hr Precip Rate + MSLP + Thickness Generator ===\n")

    province_shapely_geometries = load_ph_provinces(DATA_DIR)
    client = Client(source="azure", model="aifs-single", resol="0p25")
    steps = list(range(0, 361, 6))

    run_time_dt = None
    run_time_str = "Latest"
    valid_frames = []

    prev_tp = None
    prev_step = None

    for step in steps:
        print(f"\nStep T+{step}h ...")
        target_file = f"aifs_precip_{step:03d}.grib2"

        try:
            client.retrieve(
                step=step,
                type="fc",
                param=["tp", "msl"],
                target=target_file,
            )

            ds_sfc = xr.open_dataset(target_file, engine="cfgrib")

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

            if "time" in ds_sfc.dims and ds_sfc.sizes["time"] > 1:
                ds_sfc = ds_sfc.isel(time=-1)

            tp_var = ds_sfc["tp"]
            tp_grid = tp_var.values.squeeze()

            msl_var = ds_sfc["msl"]
            msl_grid = msl_var.values.squeeze()
            if np.nanmean(msl_grid) > 50000:
                msl_grid = msl_grid / 100.0

            lat_vals = tp_var.coords["latitude"].values.copy()
            lon_vals = tp_var.coords["longitude"].values.copy()

            ds_sfc.close()
            if os.path.exists(target_file):
                os.remove(target_file)

            # Thickness
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
                    if np.nanmean(z500) > 100000:
                        z500 = z500 / 9.80665
                        z1000 = z1000 / 9.80665
                    if np.nanmean(z500) > 10000:
                        z500 = z500 / 10.0
                        z1000 = z1000 / 10.0

                    thick_grid = z500 - z1000

                ds_pl.close()
            except Exception as e:
                print(f"  Thickness fetch warning: {e}")
            finally:
                if os.path.exists(pl_file):
                    os.remove(pl_file)

            if step == 0:
                prev_tp = tp_grid.copy()
                prev_step = step
                continue

            if prev_tp is not None:
                delta_tp = tp_grid - prev_tp
                delta_tp = np.maximum(delta_tp, 0)
                if np.nanmax(tp_grid) < 1.0:
                    delta_tp_mm = delta_tp * 1000.0
                else:
                    delta_tp_mm = delta_tp
                precip_rate = delta_tp_mm
                print(f"  Precip 6h: max={np.nanmax(precip_rate):.1f} mm")
            else:
                precip_rate = tp_grid * 1000.0 if np.nanmax(tp_grid) < 1.0 else tp_grid

            prev_tp = tp_grid.copy()
            prev_step = step

            lat_mask = (lat_vals >= LAT_MIN) & (lat_vals <= LAT_MAX)
            lon_mask = (lon_vals >= LON_MIN) & (lon_vals <= LON_MAX)

            sub_lats = lat_vals[lat_mask]
            sub_lons = lon_vals[lon_mask]

            pr_sub = precip_rate[np.ix_(lat_mask, lon_mask)] if precip_rate.ndim == 2 else precip_rate
            msl_sub = msl_grid[np.ix_(lat_mask, lon_mask)] if msl_grid.ndim == 2 else msl_grid
            thick_sub = thick_grid[np.ix_(lat_mask, lon_mask)] if thick_grid is not None and thick_grid.ndim == 2 else thick_grid

            frame_id = f"aifs_precip_mslp_{step:03d}"
            plot_frame(
                sub_lons, sub_lats, pr_sub, msl_sub, thick_sub,
                frame_id, run_time_dt, valid_time_dt, step,
                province_shapely_geometries=province_shapely_geometries
            )
            valid_frames.append(frame_id)

        except Exception as e:
            print(f"  Error at step {step}: {e}")
            import traceback
            traceback.print_exc()
            if os.path.exists(target_file):
                os.remove(target_file)

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
