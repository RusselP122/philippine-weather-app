import os
import json
import re
import time
import sys
import imageio
import requests
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.lines as mlines
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from shapely.geometry import shape
import numpy as np
from pydap.client import open_url
from datetime import datetime, timedelta, timezone

# Import standardized visualization system
try:
    from weather_viz_styles import (
        RAINFALL_DAILY_LEVELS, RAINFALL_DAILY_CMAP, RAINFALL_DAILY_NORM,
        load_ph_provinces, setup_map_ax, draw_par_boundary,
        add_styled_colorbar, draw_header_banner,
        DEFAULT_EXTENT, PAR_LONS, PAR_LATS
    )
except ImportError:
    DEFAULT_EXTENT = [112.0, 138.0, 4.0, 26.0]
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

OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "rainfall")
DATA_DIR   = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR,   exist_ok=True)

LAT_MIN, LAT_MAX = 4, 22
LON_MIN, LON_MAX = 116, 128


def parse_pydap_time(time_data, units_str):
    match = re.match(r"(\w+) since (.+)", units_str)
    if not match:
        raise ValueError(f"Unknown time units format: {units_str}")

    unit = match.group(1).lower()
    if unit.endswith('s'):
        unit = unit[:-1]

    base_date_str = match.group(2)
    try:
        base_date = datetime.strptime(base_date_str, "%Y-%m-%d %H:%M:%SZ")
    except ValueError:
        try:
            base_date = datetime.strptime(base_date_str, "%Y-%m-%d %H:%M:%S")
        except:
            base_date = datetime.fromisoformat(base_date_str.replace('Z', '+00:00'))

    base_date = base_date.replace(tzinfo=timezone.utc)

    dates = []
    for val in time_data:
        if unit == 'hour':
            dt = base_date + timedelta(hours=float(val))
        elif unit == 'day':
            dt = base_date + timedelta(days=float(val))
        elif unit == 'minute':
            dt = base_date + timedelta(minutes=float(val))
        else:
            dt = base_date
        dates.append(dt)

    return dates


def get_latest_run_url(session):
    base_url = "https://thredds.ucar.edu/thredds/dodsC/grib/NCEP/GFS/Global_0p25deg"
    now = datetime.now(timezone.utc)
    possible_times = []

    for hours_back in range(0, 30):
        t = now - timedelta(hours=hours_back)
        if t.hour % 6 == 0:
            run_time = t.replace(minute=0, second=0, microsecond=0)
            if run_time not in possible_times:
                possible_times.append(run_time)

    print(f"Checking for GFS runs: {[t.strftime('%Y%m%d_%H%M') for t in possible_times[:4]]}...")

    for t in possible_times:
        datestr = t.strftime("%Y%m%d_%H%M")
        filename = f"GFS_Global_0p25deg_{datestr}.grib2"
        url = f"{base_url}/{filename}"

        try:
            check_url = url + ".dds"
            r = session.head(check_url, timeout=5)
            if r.status_code == 200:
                print(f"Found Run: {filename}")
                return url, t
        except:
            continue

    raise Exception("Critical: Could not find any recent 00z, 06z, 12z, or 18z GFS run after 30 hours of checking.")


def plot_rainfall(lons, lats, data, filename_id, init_time=None, valid_time_start=None, valid_time_end=None, forecast_hour=None, province_shapely_geometries=None):
    fig = plt.figure(figsize=(14, 11), dpi=120)
    fig.subplots_adjust(top=0.88)
    ax = plt.axes(projection=ccrs.PlateCarree())

    extent = [112.0, 138.0, 4.0, 26.0]
    if setup_map_ax:
        setup_map_ax(ax, extent=extent, provinces=province_shapely_geometries)
    else:
        ax.set_extent(extent, crs=ccrs.PlateCarree())
        ax.add_feature(cfeature.LAND, facecolor="#edf2f7", zorder=0)
        ax.add_feature(cfeature.OCEAN, facecolor="#d9e8f5", zorder=0)
        ax.add_feature(cfeature.COASTLINE, linewidth=0.9, edgecolor="#1e293b", zorder=3)
        ax.add_feature(cfeature.BORDERS, linestyle="-", linewidth=0.55, edgecolor="#64748b", zorder=3)

    if len(lons.shape) == 1:
        LONS, LATS = np.meshgrid(lons, lats)
    else:
        LONS, LATS = lons, lats

    if np.nanmax(data) > 0.05:
        cf = ax.contourf(
            LONS, LATS, data,
            levels=RAINFALL_DAILY_LEVELS,
            cmap=RAINFALL_DAILY_CMAP,
            norm=RAINFALL_DAILY_NORM,
            extend="max",
            transform=ccrs.PlateCarree(),
            zorder=2
        )
        if add_styled_colorbar:
            add_styled_colorbar(fig, cf, ax, label="Accumulated Precipitation (mm)", ticks=RAINFALL_DAILY_LEVELS)
        else:
            cb = fig.colorbar(cf, ax=ax, orientation="vertical", pad=0.02, shrink=0.85, aspect=25)
            cb.set_ticks(RAINFALL_DAILY_LEVELS)

    # PAR Boundary
    if draw_par_boundary:
        draw_par_boundary(ax)
    else:
        ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(), color="#dc2626", linestyle="-", linewidth=2.2, zorder=4)

    # Header banner
    time_fmt_init = "%Hz %a, %b %d, %Y"
    time_fmt_val = "%Hz %a, %b %d, %Y"

    init_str = init_time.strftime(time_fmt_init) if init_time else "Unknown"
    valid_str = valid_time_end.strftime(time_fmt_val) if valid_time_end else "Unknown"
    fh_str = f"f{forecast_hour:03d}" if forecast_hour is not None else "f---"

    period_lbl = "Accumulated"
    if "24h" in filename_id: period_lbl = "24-hr Accumulated"
    elif "3d" in filename_id: period_lbl = "72-hr Accumulated"
    elif "7d" in filename_id: period_lbl = "168-hr Accumulated"
    elif "day" in filename_id: period_lbl = "24-hr (Daily) Accumulated"

    if draw_header_banner:
        draw_header_banner(
            fig, ax,
            left_title="Philippine T/W",
            right_title=f"GFS {period_lbl} Precipitation (mm)",
            model_sub=f"Model: GFS (0.25°)   |   Forecast Hour: {fh_str}",
            time_sub=f"Init: {init_str} / Valid: {valid_str}"
        )

    filename = f"{filename_id}.png"
    filepath = os.path.join(OUTPUT_DIR, filename)
    plt.savefig(filepath, dpi=120, bbox_inches="tight", facecolor="white", transparent=False)
    print(f"Saved {filepath}")
    plt.close(fig)


def fetch_and_plot_gfs(target_url=None, target_run_time=None):
    print("\n--- Starting GFS Rainfall Generation ---")

    try:
        session = requests.Session()
        session.headers.update({'User-Agent': 'Mozilla/5.0 (WeatherApp)'})

        province_shapely_geometries = load_ph_provinces(DATA_DIR)

        if target_url:
            dataset_url = target_url
            run_time = target_run_time
            print(f"Using Provided Dataset: {dataset_url}")
        else:
            dataset_url, run_time = get_latest_run_url(session)
            print(f"Dataset URL: {dataset_url}")

        ds = open_url(dataset_url, session=session)

        pref_names = [
            "Precipitation_rate_surface_Mixed_intervals_Average",
            "Precipitation_rate_surface",
            "Total_precipitation_surface_Mixed_intervals_Accumulation",
        ]
        var_name = None
        for pref in pref_names:
            if pref in ds:
                var_name = pref
                break
        if var_name is None:
            candidates = [k for k in ds.keys() if "precipitation" in k.lower()]
            if not candidates:
                raise ValueError("No precipitation variable found")
            var_name = candidates[0]

        is_rate_var = "rate" in var_name.lower()
        print(f"Variable found: {var_name} ({'rate' if is_rate_var else 'accumulation'})")
        precip_var = ds[var_name]

        time_dim = precip_var.dimensions[0]
        lat_dim = precip_var.dimensions[1]
        lon_dim = precip_var.dimensions[2]

        lat_data = ds[lat_dim][:]
        lon_data = ds[lon_dim][:]

        lat_min, lat_max = 2.0, 28.0
        lon_min, lon_max = 112.0, 140.0

        lat_indices = np.where((lat_data >= lat_min) & (lat_data <= lat_max))[0]
        lon_indices = np.where((lon_data >= lon_min) & (lon_data <= lon_max))[0]

        lat_min_idx, lat_max_idx = lat_indices[0], lat_indices[-1]
        lon_min_idx, lon_max_idx = lon_indices[0], lon_indices[-1]

        if lat_min_idx > lat_max_idx:
            lat_min_idx, lat_max_idx = lat_max_idx, lat_min_idx

        subset_lats = lat_data[lat_min_idx:lat_max_idx+1]
        subset_lons = lon_data[lon_min_idx:lon_max_idx+1]

        print(f"Region: Lat[{lat_min_idx}:{lat_max_idx}], Lon[{lon_min_idx}:{lon_max_idx}]")

        time_var = ds[time_dim]
        time_vals = time_var[:]
        time_units = time_var.attributes.get('units', '')
        print(f"Time Units: {time_units}")

        all_dates = []
        if "since" in time_units:
            u_str = time_units.split(" since ")
            step_unit = u_str[0].lower()
            ref_str = u_str[1]
            ref_str = ref_str.replace("Z", "").replace("T", " ")
            try:
                ref_time = datetime.strptime(ref_str, "%Y-%m-%d %H:%M:%S")
            except:
                ref_time = datetime.strptime(ref_str, "%Y-%m-%d %H:%M")

            ref_time = ref_time.replace(tzinfo=timezone.utc)

            for v in time_vals:
                if step_unit.startswith("hour"):
                    all_dates.append(ref_time + timedelta(hours=float(v)))
                elif step_unit.startswith("minute"):
                    all_dates.append(ref_time + timedelta(minutes=float(v)))
        else:
            print("Time units not standard.")

        init_time = all_dates[0] if all_dates else datetime.now(timezone.utc)

        periods = {
            "24h": 24,
            "3d": 72,
            "7d": 168
        }

        all_periods = []
        for p_name, hours in periods.items():
            all_periods.append({"name": p_name, "hours": hours, "type": "cumulative"})

        for day in range(1, 8):
            all_periods.append({
                "name": f"day_{day}",
                "hours": day*24,
                "prev_hours": (day-1)*24,
                "type": "sequential"
            })

        meta_info = {
            "model": "GFS 0.25°",
            "source": "NOAA NOMADS / THREDDS",
            "generated_at": datetime.now().strftime("%Y-%m-%d %I:%M %p"),
            "run_time": init_time.strftime("%Y-%m-%d %H:%M UTC"),
            "animation_frames": [f"gfs_day_{i}" for i in range(1, 8)]
        }

        for item in all_periods:
            period_name = item["name"]

            if item["type"] == "cumulative":
                start_hour_offset = 0
                end_hour_offset = item["hours"]
            else:
                start_hour_offset = item["prev_hours"]
                end_hour_offset = item["hours"]

            print(f"\nGenerating {period_name} ({start_hour_offset}h - {end_hour_offset}h)...")

            end_time_period = init_time + timedelta(hours=end_hour_offset)
            start_time_period = init_time + timedelta(hours=start_hour_offset)

            def find_idx(target_time):
                times = [t for t in all_dates]
                deltas = [abs((t - target_time).total_seconds()) for t in times]
                min_delta = min(deltas)
                idx = deltas.index(min_delta)
                return idx, times[idx]

            idx_start, t_start = find_idx(start_time_period)
            idx_end, t_end = find_idx(end_time_period)

            if idx_end <= idx_start and item["type"] == "sequential" and idx_end != idx_start:
                if start_hour_offset != end_hour_offset:
                    print(f"Warning: Start index {idx_start} >= End index {idx_end}. Skipping {period_name}")
                    continue

            try:
                grid_end = precip_var[idx_end, lat_min_idx:lat_max_idx+1, lon_min_idx:lon_max_idx+1].data
                grid_end = np.array(grid_end).astype(float).squeeze()

                if is_rate_var:
                    window_seconds = (end_hour_offset - start_hour_offset) * 3600
                    grid_end[grid_end < 0] = 0
                    total_precip = grid_end * window_seconds
                else:
                    grid_start = precip_var[idx_start, lat_min_idx:lat_max_idx+1, lon_min_idx:lon_max_idx+1].data
                    grid_start = np.array(grid_start).astype(float).squeeze()
                    grid_end[grid_end > 3000] = 0
                    grid_end[grid_end < 0] = 0
                    grid_start[grid_start > 3000] = 0
                    grid_start[grid_start < 0] = 0
                    total_precip = np.maximum(grid_end - grid_start, 0)

            except Exception as slice_err:
                print(f"Data fetch error for {period_name}: {slice_err}")
                continue

            total_precip = np.clip(total_precip, 0, 3000)
            max_val = np.nanmax(total_precip)
            print(f"Max Precip ({period_name}): {max_val} mm")

            plot_rainfall(
                subset_lons,
                subset_lats,
                total_precip,
                f"gfs_{period_name}",
                init_time=all_dates[0] if all_dates else datetime.now(timezone.utc),
                valid_time_start=start_time_period,
                valid_time_end=end_time_period,
                forecast_hour=end_hour_offset,
                province_shapely_geometries=province_shapely_geometries
            )

        meta_path = os.path.join(DATA_DIR, "rainfall_meta.json")
        with open(meta_path, "w") as f:
            json.dump(meta_info, f, indent=2)
        print(f"Saved metadata to {meta_path}")

        animation_frames = meta_info.get("animation_frames", [])
        if animation_frames:
            print("Generating GIF...")
            gif_path = os.path.join(OUTPUT_DIR, "rainfall_forecast.gif")
            generate_gif(animation_frames, OUTPUT_DIR, gif_path)

    except Exception as e:
        print(f"CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()


def generate_gif(frame_names, input_dir, output_path, fps=2):
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


def scheduler_loop():
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] --- GFS Scheduler Started ---")
    print("Checking for new model runs every 15 minutes...")

    last_run_time = None

    while True:
        try:
            session = requests.Session()
            session.headers.update({'User-Agent': 'WeatherApp-Scheduler/1.0'})

            print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Checking THREDDS for updates...")
            latest_url, latest_time = get_latest_run_url(session)

            should_run = False
            if last_run_time is None:
                print("First run of scheduler. Executing...")
                should_run = True
            elif latest_time and latest_time > last_run_time:
                print(f"New GFS Run Detected: {latest_time} (Previous: {last_run_time})")
                should_run = True
            else:
                print(f"No new run. Latest is still {latest_time}. Sleeping...")

            if should_run:
                print(">>> Starting Generation Job")
                fetch_and_plot_gfs(target_url=latest_url, target_run_time=latest_time)

                if latest_time:
                    last_run_time = latest_time
                print(">>> Job Complete. Waiting for next cycle.")

            sys.stdout.flush()

        except Exception as e:
            print(f"Scheduler Error: {e}")
            import traceback
            traceback.print_exc()

        time.sleep(900)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == '--daemon':
        scheduler_loop()
    else:
        fetch_and_plot_gfs()
