from ecmwf.opendata import Client
import xarray as xr
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import numpy as np
import os
from datetime import datetime, timedelta
import json
import imageio

# Output Directories
OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "wind")
DATA_DIR = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

def fetch_and_plot_aifs():
    print("--- Starting ECMWF AIFS Wind Generation (Cloud/Linux Mode) ---")
    try:
        client = Client(source="ecmwf", model="aifs-single", resol="0p25")

        parameters = ['10u', '10v', 'msl']
        steps = list(range(0, 361, 6))  # 0, 6, 12, ..., 360 (15 days)

        valid_frames = []
        run_time_dt = None

        for step in steps:
            print(f"\nProcessing Step {step}h...")
            target_file = f"aifs_{step:03d}.grib2"

            try:
                # 1. Download
                client.retrieve(
                    step=step,
                    type="fc",
                    param=parameters,
                    target=target_file
                )

                # 2. Open with CFGRIB
                ds = xr.open_dataset(target_file, engine='cfgrib')

                # Extract Run Time (only once)
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

                # Variables
                u10 = ds['u10']
                v10 = ds['v10']
                msl_var = ds['msl']

                # Handle multiple times (pick latest)
                if "time" in u10.dims and u10.sizes["time"] > 1:
                    print("Multiple runs found, selecting latest.")
                    u10 = u10.isel(time=-1)
                    v10 = v10.isel(time=-1)
                    msl_var = msl_var.isel(time=-1)

                # Calculate
                ws = np.sqrt(u10**2 + v10**2) * 3.6
                msl_hpa = msl_var / 100.0

                # Plot
                filename_id = f"aifs_wind_{step:03d}"
                print(f"Plotting {filename_id}...")
                plot_wind_pressure(
                    ds.latitude, ds.longitude, ws, u10, v10, msl_hpa, filename_id,
                    init_time=run_time_dt,
                    valid_time=valid_time_dt,
                    forecast_hour=step
                )

                valid_frames.append(filename_id)
                ds.close()
                if os.path.exists(target_file):
                    os.remove(target_file)

            except Exception as e:
                print(f"Error processing step {step}: {e}")
                if "cfgrib" in str(e):
                    print("NOTE: Requires cfgrib/eccodes (Linux Only).")

        # Save Metadata
        meta_info = {
            "model": "ECMWF AIFS",
            "source": "ECMWF Open Data",
            "generated_at": datetime.now().strftime("%Y-%m-%d %I:%M %p"),
            "run_time": run_time_str if 'run_time_str' in locals() else "Unknown",
            "animation_frames": valid_frames
        }
        with open(os.path.join(DATA_DIR, "wind_meta.json"), "w") as f:
            json.dump(meta_info, f, indent=2)
        print(f"Saved wind_meta.json")

        # Generate GIF
        if valid_frames:
            print("Generating GIF...")
            gif_path = os.path.join(OUTPUT_DIR, "wind_forecast.gif")
            generate_gif(valid_frames, OUTPUT_DIR, gif_path)

    except Exception as e:
        print(f"CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()


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


def plot_wind_pressure(lats, lons, ws, u, v, msl, filename_id, init_time=None, valid_time=None, forecast_hour=None):
    import scipy.ndimage
    import matplotlib.lines as mlines
    from matplotlib.colors import ListedColormap, BoundaryNorm

    fig = plt.figure(figsize=(14, 11))
    fig.subplots_adjust(top=0.88)
    ax = plt.axes(projection=ccrs.PlateCarree())
    ax.set_extent([112, 138, 4, 26], crs=ccrs.PlateCarree())

    ax.add_feature(cfeature.LAND, facecolor='#eaeaea', zorder=0)
    ax.add_feature(cfeature.OCEAN, facecolor='#d4e5ed', zorder=0)
    ax.add_feature(cfeature.COASTLINE, linewidth=1.0, edgecolor='#222222', zorder=5)
    ax.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.6, edgecolor='#555555', zorder=5)

    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.4, linestyle=':', zorder=6)
    gl.top_labels = False
    gl.right_labels = False
    gl.xlabel_style = {'size': 10, 'color': '#333'}
    gl.ylabel_style = {'size': 10, 'color': '#333'}

    # --- Wind Speed Colormap ---
    # 12 levels = 11 intervals. extend='max' adds 1 extension bin = 12 total.
    # ListedColormap needs exactly 11 colors. set_over covers the extension.
    levels = [0, 20, 30, 40, 50, 60, 80, 100, 120, 150, 185, 220]
    cols = [
        '#ffffff00', '#dbeafe', '#93c5fd', '#3b82f6', '#22c55e',
        '#eab308', '#f97316', '#ef4444', '#dc2626', '#a855f7', '#7e22ce'
    ]
    cmap = ListedColormap(cols)
    cmap.set_over('#4b0082')
    norm = BoundaryNorm(levels, ncolors=len(cols), clip=False)

    # Meshgrid
    if len(lons.shape) == 1:
        X, Y = np.meshgrid(lons, lats)
        U, V = u.values, v.values
    else:
        X, Y = lons.values, lats.values
        U, V = u.values, v.values

    cf = ax.contourf(X, Y, ws, levels=levels, cmap=cmap, norm=norm, extend='max', transform=ccrs.PlateCarree(), zorder=2)
    cb = fig.colorbar(cf, ax=ax, orientation='vertical', pad=0.02, shrink=0.85, aspect=25)
    cb.set_ticks(levels)
    cb.ax.tick_params(labelsize=10)
    cb.set_label('Wind Speed (kph)', fontsize=10)
    cb.outline.set_edgecolor('black')
    cb.outline.set_linewidth(1)

    # --- MSLP Isobars ---
    msl_smooth = scipy.ndimage.gaussian_filter(msl.values, sigma=1)
    cs = ax.contour(X, Y, msl_smooth, levels=range(900, 1040, 4), colors='black', linewidths=1.2, transform=ccrs.PlateCarree(), zorder=3)
    ax.clabel(cs, inline=True, fontsize=10, fmt='%d', colors='black')

    # --- Wind Arrows ---
    skip = 6
    ax.quiver(X[::skip, ::skip], Y[::skip, ::skip],
              U[::skip, ::skip], V[::skip, ::skip],
              transform=ccrs.PlateCarree(),
              color='black', alpha=0.4,
              width=0.0015, scale=400, headwidth=3, zorder=4)

    # --- PAR ---
    par_lons = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
    par_lats = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]
    ax.plot(par_lons, par_lats, transform=ccrs.PlateCarree(), color='#d62728', linestyle='-', linewidth=2.5, zorder=7)

    # --- Banner ---
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

    fig.text(left, y_top, "Philippine T/W", ha='left', va='bottom', fontsize=14, weight='bold', color='#888888')
    fig.text(right, y_top, "AIFS 10m Wind Speed (kph) & Mean Sea Level Pressure (hPa)", ha='right', va='bottom', fontsize=14, weight='bold', color='black')
    fig.text(left, y_bottom, "Model: ECMWF AIFS (0.25\u00b0)", ha='left', va='bottom', fontsize=11, color='black')
    fig.text(left + 0.22, y_bottom, f"Forecast Hour: {fh_str}", ha='left', va='bottom', fontsize=11, color='black')
    fig.text(right, y_bottom, f"Init: {init_str} / Valid: {valid_str}", ha='right', va='bottom', fontsize=11, color='black')

    sep = mlines.Line2D((left, right), (y_line, y_line), color='black', linewidth=1, transform=fig.transFigure)
    fig.add_artist(sep)

    plt.savefig(os.path.join(OUTPUT_DIR, f"{filename_id}.png"), dpi=120, bbox_inches='tight', facecolor='white')
    print(f"Saved {filename_id}.png")
    plt.close()


if __name__ == "__main__":
    fetch_and_plot_aifs()
