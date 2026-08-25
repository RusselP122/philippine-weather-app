import os
import json
import numpy as np
import scipy.ndimage
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.lines as mlines
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from shapely.geometry import shape
from datetime import datetime, timedelta
import imageio
import xarray as xr
from ecmwf.opendata import Client

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
    DEFAULT_EXTENT = [112.0, 138.0, 4.0, 26.0]
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

OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "wind")
DATA_DIR = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)


def plot_wind_pressure(lats, lons, ws, u, v, msl, filename_id, init_time=None, valid_time=None, forecast_hour=None, province_shapely_geometries=None):
    fig = plt.figure(figsize=(14, 11), dpi=120)
    fig.subplots_adjust(top=0.88)
    ax = plt.axes(projection=ccrs.PlateCarree())

    extent = [112.0, 138.0, 4.0, 26.0]
    if setup_map_ax:
        setup_map_ax(ax, extent=extent, provinces=province_shapely_geometries)
    else:
        ax.set_extent(extent, crs=ccrs.PlateCarree())
        ax.add_feature(cfeature.LAND, facecolor='#edf2f7', zorder=0)
        ax.add_feature(cfeature.OCEAN, facecolor='#d9e8f5', zorder=0)
        ax.add_feature(cfeature.COASTLINE, linewidth=0.9, edgecolor='#1e293b', zorder=5)
        ax.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.55, edgecolor='#64748b', zorder=5)

    if len(lons.shape) == 1:
        X, Y = np.meshgrid(lons, lats)
        U, V = (u.values, v.values) if hasattr(u, 'values') else (u, v)
        ws_vals = ws.values if hasattr(ws, 'values') else ws
        msl_vals = msl.values if hasattr(msl, 'values') else msl
    else:
        X, Y = (lons.values, lats.values) if hasattr(lons, 'values') else (lons, lats)
        U, V = (u.values, v.values) if hasattr(u, 'values') else (u, v)
        ws_vals = ws.values if hasattr(ws, 'values') else ws
        msl_vals = msl.values if hasattr(msl, 'values') else msl

    cf = ax.contourf(
        X, Y, ws_vals,
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
        add_mslp_contours(ax, X, Y, msl_vals, levels=range(900, 1040, 4), sigma=1.0)
    else:
        msl_smooth = scipy.ndimage.gaussian_filter(msl_vals, sigma=1)
        cs = ax.contour(X, Y, msl_smooth, levels=range(900, 1040, 4), colors='#0f172a', linewidths=1.1, transform=ccrs.PlateCarree(), zorder=3)
        ax.clabel(cs, inline=True, fontsize=8.5, fmt='%d', colors='#0f172a')

    # Wind Arrows
    if add_wind_vectors:
        add_wind_vectors(ax, X, Y, U, V, skip=6, scale=400, alpha=0.38)
    else:
        ax.quiver(X[::6, ::6], Y[::6, ::6], U[::6, ::6], V[::6, ::6], transform=ccrs.PlateCarree(), color='#0f172a', alpha=0.35, width=0.0016, scale=400, headwidth=3.5, zorder=4)

    # PAR
    if draw_par_boundary:
        draw_par_boundary(ax)
    else:
        ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(), color='#dc2626', linestyle='-', linewidth=2.2, zorder=7)

    # Banner
    time_fmt = "%Hz %a, %b %d, %Y"
    init_str = init_time.strftime(time_fmt) if init_time else "Unknown"
    valid_str = valid_time.strftime(time_fmt) if valid_time else "Unknown"

    if draw_header_banner:
        draw_header_banner(
            fig, ax,
            left_title="Philippine T/W",
            right_title="AIFS v2 10m Wind Speed (kph) & MSLP (hPa)",
            model_sub=f"Model: ECMWF AIFS v2 (0.25°)   |   Forecast Hour: f{forecast_hour:03d}",
            time_sub=f"Init: {init_str} / Valid: {valid_str}"
        )

    plt.savefig(os.path.join(OUTPUT_DIR, f"{filename_id}.png"), dpi=120, bbox_inches='tight', facecolor='white')
    print(f"Saved {filename_id}.png")
    plt.close(fig)


def generate_gif(frame_names, input_dir, output_path, fps=4):
    try:
        images = []
        for frame in frame_names:
            file_path = os.path.join(input_dir, f"{frame}.png")
            if os.path.exists(file_path):
                images.append(imageio.imread(file_path))
        if images:
            imageio.mimsave(output_path, images, fps=fps, loop=0)
            print(f"Saved GIF: {output_path}")
    except Exception as e:
        print(f"GIF Generation Failed: {e}")


def fetch_and_plot_aifs():
    print("--- Starting ECMWF AIFS v2 Wind Generation (Cloud/Linux Mode) ---")
    try:
        province_shapely_geometries = load_ph_provinces(DATA_DIR)
        client = Client(source="azure", model="aifs-single", resol="0p25")

        parameters = ['10u', '10v', 'msl']
        steps = list(range(0, 361, 6))

        valid_frames = []
        run_time_dt = None

        for step in steps:
            print(f"\nProcessing Step {step}h...")
            target_file = f"aifs_{step:03d}.grib2"

            try:
                client.retrieve(
                    step=step,
                    type="fc",
                    param=parameters,
                    target=target_file
                )

                ds = xr.open_dataset(target_file, engine='cfgrib')

                if "time" in ds and run_time_dt is None:
                    try:
                        rt = ds['time'].values
                        if rt.ndim == 0:
                            ts = (rt - np.datetime64('1970-01-01T00:00:00Z')) / np.timedelta64(1, 's')
                        else:
                            ts = (rt[-1] - np.datetime64('1970-01-01T00:00:00Z')) / np.timedelta64(1, 's')
                        run_time_dt = datetime.utcfromtimestamp(float(ts))
                        run_time_str = run_time_dt.strftime("%Y-%m-%d %H:%M UTC")
                        print(f"Run time: {run_time_str}")
                    except Exception as e:
                        print(f"Metadata extraction warning: {e}")
                        run_time_str = "Latest"

                valid_time_dt = run_time_dt + timedelta(hours=step) if run_time_dt else None

                u10 = ds['u10']
                v10 = ds['v10']
                msl_var = ds['msl']

                if "time" in u10.dims and u10.sizes["time"] > 1:
                    u10 = u10.isel(time=-1)
                    v10 = v10.isel(time=-1)
                    msl_var = msl_var.isel(time=-1)

                ws = np.sqrt(u10**2 + v10**2) * 3.6
                msl_hpa = msl_var / 100.0

                filename_id = f"aifs_wind_{step:03d}"
                print(f"Plotting {filename_id}...")
                plot_wind_pressure(
                    ds.latitude, ds.longitude, ws, u10, v10, msl_hpa, filename_id,
                    init_time=run_time_dt,
                    valid_time=valid_time_dt,
                    forecast_hour=step,
                    province_shapely_geometries=province_shapely_geometries
                )

                valid_frames.append(filename_id)
                ds.close()
                if os.path.exists(target_file):
                    os.remove(target_file)

            except Exception as e:
                print(f"Error processing step {step}: {e}")
                if "cfgrib" in str(e):
                    print("NOTE: Requires cfgrib/eccodes (Linux Only).")

        meta_info = {
            "model": "ECMWF AIFS v2",
            "source": "ECMWF Open Data via Azure",
            "generated_at": datetime.now().strftime("%Y-%m-%d %I:%M %p"),
            "run_time": run_time_str if 'run_time_str' in locals() else "Unknown",
            "animation_frames": valid_frames
        }
        with open(os.path.join(DATA_DIR, "wind_meta.json"), "w") as f:
            json.dump(meta_info, f, indent=2)
        print(f"Saved wind_meta.json")

        if valid_frames:
            print("Generating GIF...")
            gif_path = os.path.join(OUTPUT_DIR, "wind_forecast.gif")
            generate_gif(valid_frames, OUTPUT_DIR, gif_path)

    except Exception as e:
        print(f"CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    fetch_and_plot_aifs()
