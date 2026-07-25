import os
import json
from shapely.geometry import shape
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import cartopy.io.shapereader as shpreader
import numpy as np
import os
import requests
from pydap.client import open_url
from datetime import datetime, timedelta, timezone
import re
import time
import sys
import imageio
from matplotlib.colors import ListedColormap, BoundaryNorm

# Output directory
OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "rainfall")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Philippines Bounds
LAT_MIN, LAT_MAX = 4, 22
LON_MIN, LON_MAX = 116, 128

def parse_pydap_time(time_data, units_str):
    """
    Manually parses time units like 'hours since 2023-01-01 00:00:00Z'
    Returns a list of datetime objects (UTC).
    """
    # Regex to parse "hours since YYYY-MM-DD HH:MM:SS..."
    match = re.match(r"(\w+) since (.+)", units_str)
    if not match:
        raise ValueError(f"Unknown time units format: {units_str}")
    
    unit = match.group(1).lower() # e.g. "hours", "days"
    if unit.endswith('s'):
        unit = unit[:-1]
        
    base_date_str = match.group(2)
    
    # Clean up timezone info if strictly needed, but simple parse often works
    # "2025-01-30 12:00:00Z" -> remove Z or handles it
    try:
        base_date = datetime.strptime(base_date_str, "%Y-%m-%d %H:%M:%SZ")
    except ValueError:
        try:
            base_date = datetime.strptime(base_date_str, "%Y-%m-%d %H:%M:%S")
        except:
             # Try date parsing with dateutil if available, otherwise strict fallback
             # For GFS it's usually standard ISO
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
             dt = base_date # Fallback
        dates.append(dt)
        
    return dates

def get_latest_run_url(session):
    """
    Finds the latest available GFS run on THREDDS.
    Returns: (url, run_datetime)
    """
    base_url = "https://thredds.ucar.edu/thredds/dodsC/grib/NCEP/GFS/Global_0p25deg"
    
    # Check last 24 hours of possible runs (00, 06, 12, 18)
    # Start from now and go back
    now = datetime.now(timezone.utc)
    possible_times = []
    
    # Look back up to 30 hours to be safe
    for hours_back in range(0, 30):
        t = now - timedelta(hours=hours_back)
        if t.hour % 6 == 0:
            # Round to nearest 6h
            run_time = t.replace(minute=0, second=0, microsecond=0)
            if run_time not in possible_times:
                possible_times.append(run_time)
                
    print(f"Checking for GFS runs: {[t.strftime('%Y%m%d_%H%M') for t in possible_times[:4]]}...")

    for t in possible_times:
        datestr = t.strftime("%Y%m%d_%H%M") # e.g. 20250130_0600
        # URL pattern: GFS_Global_0p25deg_YYYYMMDD_HHmm.grib2
        filename = f"GFS_Global_0p25deg_{datestr}.grib2"
        url = f"{base_url}/{filename}"
        
        # Probe existence (HEAD request)
        # Note: OPeNDAP headers check might be tricky, try .dds or just open
        try:
            # Strip dodsC from URL for http check or append .dds
            check_url = url + ".dds"
            r = session.head(check_url, timeout=5)
            if r.status_code == 200:
                print(f"Found Run: {filename}")
                return url, t
        except:
            continue
            
    raise Exception("Critical: Could not find any recent 00z, 06z, 12z, or 18z GFS run after 30 hours of checking.")

def fetch_and_plot_gfs(target_url=None, target_run_time=None):
    print("\n--- Starting GFS Rainfall Generation ---")
    
    try:
        session = requests.Session()
        session.headers.update({'User-Agent': 'Mozilla/5.0 (WeatherApp)'})
        
        # 1. Get URL (if not provided)
        if target_url:
            dataset_url = target_url
            run_time = target_run_time
            print(f"Using Provided Dataset: {dataset_url}")
        else:
            dataset_url, run_time = get_latest_run_url(session)
            print(f"Dataset URL: {dataset_url}")
        
        ds = open_url(dataset_url, session=session)
        
        # 2. Variable Selection
        # Prefer rate variable to avoid accumulation bucket resets after hour 120
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
        
        # 3. Coordinates
        # Single run usually has `time`, `lat`, `lon`
        # Identify them dynamically
        print(f"Dimensions: {precip_var.dimensions}") # e.g. ('time', 'lat', 'lon')
        
        time_dim = precip_var.dimensions[0]
        lat_dim = precip_var.dimensions[1]
        lon_dim = precip_var.dimensions[2]
        
        # Need to read coordinates
        lat_data = ds[lat_dim][:]
        lon_data = ds[lon_dim][:]
        
        # Normalize Longitude (0-360) same as before 
        
        # 4. Filter Region (Expanded for PAR + Palau, excluding Vietnam)
        # PAR: 5-25N, 115-135E. Palau: ~7N, 134E.
        # Fetch slightly larger to avoid edge artifacts
        lat_min, lat_max = 2.0, 28.0
        lon_min, lon_max = 112.0, 140.0

        lat_indices = np.where((lat_data >= lat_min) & (lat_data <= lat_max))[0]
        lon_indices = np.where((lon_data >= lon_min) & (lon_data <= lon_max))[0]
        
        lat_min_idx, lat_max_idx = lat_indices[0], lat_indices[-1]
        lon_min_idx, lon_max_idx = lon_indices[0], lon_indices[-1]
        
        # Slice Sort fix (if lat decreasing)
        if lat_min_idx > lat_max_idx:
            lat_min_idx, lat_max_idx = lat_max_idx, lat_min_idx
            
        subset_lats = lat_data[lat_min_idx:lat_max_idx+1]
        subset_lons = lon_data[lon_min_idx:lon_max_idx+1]
        
        print(f"Region: Lat[{lat_min_idx}:{lat_max_idx}], Lon[{lon_min_idx}:{lon_max_idx}]")
        
        # 5. Time Parsing
        # In Single Run, time is "Hours since Run Start" usually
        # We need to compute absolute datetimes to match our 24h/3d logic
        time_var = ds[time_dim]
        time_vals = time_var[:]
        time_units = time_var.attributes.get('units', '')
        print(f"Time Units: {time_units}") 
        
        # Parse CF time
        from netCDF4 import num2date
        # num2date returns dates
        # Try simplified parsing if netCDF4 not heavy dependency? 
        # Actually pydap doesn't do it auto?
        # Let's simple parse: "Hour since YYYY-MM-DD..."
        
        all_dates = []
        if "since" in time_units:
            # naive parse
            u_str = time_units.split(" since ")
            step_unit = u_str[0].lower() # hour
            ref_str = u_str[1]
            # Clean ref_str (remove Z etc)
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
             print("Time units not standard, defaulting to Best logic or failure.")
             # Fallback logic if needed
             
        # 6. Forecast Window Logic
        init_time = all_dates[0] if all_dates else datetime.now(timezone.utc)
        
        # Define Periods to Generate (Cumulative Summaries)
        periods = {
            "24h": 24,
            "3d": 72,
            "7d": 168
        }
        
        # Animation Frames: Daily Increments (Day 1, Day 2 ... Day 7)
        # We will generate these as well.
        animation_frames = []

        all_periods = []
        # Add Summary Periods
        for p_name, hours in periods.items():
            all_periods.append({"name": p_name, "hours": hours, "type": "cumulative"})
            
        # Add Daily Frames
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
            
            # Determine Time Window
            if item["type"] == "cumulative":
                # From Start (0) to Hours
                start_hour_offset = 0
                end_hour_offset = item["hours"]
            else:
                # Sequential (e.g. Day 2: 24h to 48h)
                start_hour_offset = item["prev_hours"]
                end_hour_offset = item["hours"]
                
            print(f"\nGenerating {period_name} ({start_hour_offset}h - {end_hour_offset}h)...")
            
            end_time_period = init_time + timedelta(hours=end_hour_offset)
            start_time_period = init_time + timedelta(hours=start_hour_offset)
            
            # Find indices
            # Need to span from Start Time to End Time
            # For cumulative, start is 'now'.
            # For sequential, start is 'now + offset'.
            
            # Indices in all_dates that cover this range
            # We need the value at Start and Value at End.
            # GFS Single Run is cumulative from T=0 (Model Run Start).
            # So Rain_in_Window = Accum(End) - Accum(Start).
            # We need index for End Time and index for Start Time.
            
            # Find closest index for start and end
            errors = []
            
            # Helper to find index
            def find_idx(target_time):
                # Find closest
                times = [t for t in all_dates]
                # Assuming sorted
                # Bisect or just min diff
                # We need exact or closest forward?
                # Let's find index where time is closest
                deltas = [abs((t - target_time).total_seconds()) for t in times]
                min_delta = min(deltas)
                idx = deltas.index(min_delta)
                return idx, times[idx]

            idx_start, t_start = find_idx(start_time_period)
            idx_end, t_end = find_idx(end_time_period)
            
            # Safety check
            if idx_end <= idx_start and item["type"] == "sequential" and idx_end != idx_start:
                 # Should not happen unless resolution is coarse
                 if start_hour_offset != end_hour_offset:
                     print(f"Warning: Start index {idx_start} >= End index {idx_end}. Skipping {period_name}")
                     continue

            # Fetch data at these two points
            # Optimized: Just fetch two slices 
            # Or fetch generic slice if close? 
            # Actually, `precip_var[idx]` gets the 2D grid at that time.
            
            try:
                # Fetch End Grid
                grid_end = precip_var[idx_end, lat_min_idx:lat_max_idx+1, lon_min_idx:lon_max_idx+1].data
                grid_end = np.array(grid_end).astype(float).squeeze()

                if is_rate_var:
                    # Rate variable (kg/m²/s): multiply by the window duration in seconds
                    window_seconds = (end_hour_offset - start_hour_offset) * 3600
                    grid_end[grid_end < 0] = 0
                    total_precip = grid_end * window_seconds
                else:
                    # Accumulation variable: difference end - start
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
            
            # Cap Total
            total_precip = np.clip(total_precip, 0, 3000)

            max_val = np.nanmax(total_precip)
            print(f"Max Precip ({period_name}): {max_val} mm")
            
            # Plot
            plot_rainfall(
                subset_lons, 
                subset_lats, 
                total_precip, 
                f"gfs_{period_name}",
                init_time=all_dates[0] if all_dates else now,
                valid_time_start=start_time_period,
                valid_time_end=end_time_period,
                forecast_hour=end_hour_offset
            )

        # Save Metadata
        import json
        meta_path = os.path.join(os.getcwd(), "public", "data", "rainfall_meta.json")
        with open(meta_path, "w") as f:
            json.dump(meta_info, f, indent=2)
        print(f"Saved metadata to {meta_path}")

        # Generate GIF
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

def plot_rainfall(lons, lats, data, filename_id, init_time=None, valid_time_start=None, valid_time_end=None, forecast_hour=None):
    # Set up figure with a ratio closer to the classic weather map style
    fig = plt.figure(figsize=(14, 11))
    
    # Push the map down slightly to make room for the header text
    fig.subplots_adjust(top=0.88)
    
    ax = plt.axes(projection=ccrs.PlateCarree())
    
    # Extent: Includes PAR (115-135)
    ax.set_extent([112, 138, 4, 26], crs=ccrs.PlateCarree())

    # --- 1. Tropicaltidbits Map Features ---
    LAND_COLOR = '#eaeaea'
    OCEAN_COLOR = '#d4e5ed'
    
    ax.add_feature(cfeature.LAND, facecolor=LAND_COLOR, zorder=0)
    ax.add_feature(cfeature.OCEAN, facecolor=OCEAN_COLOR, zorder=0)
    ax.add_feature(cfeature.COASTLINE, linewidth=1.0, edgecolor='#222222', zorder=3)
    ax.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.6, edgecolor='#555555', zorder=3)
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

    
    # Plot PAR (Philippine Area of Responsibility)
    par_lons = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
    par_lats = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]
    ax.plot(par_lons, par_lats, transform=ccrs.PlateCarree(), 
            color='#d62728', linestyle='-', linewidth=2.5, label='PAR', zorder=4)
    
    # Gridlines
    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.4, linestyle=':', zorder=5)
    gl.top_labels = False
    gl.right_labels = False
    gl.xlabel_style = {'size': 10, 'color': '#333'}
    gl.ylabel_style = {'size': 10, 'color': '#333'}

    # --- 2. The Tropicaltidbits Colormap ---
    levels = [0, 5, 10, 20, 30, 40, 50, 75, 100, 125, 150, 175, 200, 250, 300, 400]
    
    colors = [
        '#ffffff00', # 0-5 (Transparent)
        '#dbe9f6',   # 5-10
        '#a6cbe3',   # 10-20
        '#5ba3d0',   # 20-30
        '#227abb',   # 30-40
        '#4ac15e',   # 40-50
        '#2ea946',   # 50-75
        '#1a862f',   # 75-100
        '#ffdb00',   # 100-125
        '#f7a800',   # 125-150
        '#ea7200',   # 150-175
        '#df4000',   # 175-200
        '#d41c00',   # 200-250
        '#b40047',   # 250-300
        '#c432b4',   # 300-400
    ]
    
    cmap = ListedColormap(colors)
    cmap.set_over('#4b0082') # > 400
    norm = BoundaryNorm(levels, ncolors=len(colors), clip=False)

    if len(lons.shape) == 1:
        LONS, LATS = np.meshgrid(lons, lats)
    else:
        LONS, LATS = lons, lats

    if np.nanmax(data) > 0:
        contour = ax.contourf(LONS, LATS, data, levels=levels, cmap=cmap, norm=norm, 
                              extend='max', transform=ccrs.PlateCarree(), zorder=2)
        
        cb = fig.colorbar(contour, ax=ax, orientation='vertical', pad=0.02, shrink=0.85, aspect=25)
        cb.set_ticks(levels)
        cb.ax.tick_params(labelsize=10)
        cb.outline.set_edgecolor('black')
        cb.outline.set_linewidth(1)

    # --- 3. Header & Banner Styling (Fixed Placement) ---
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

    title_center = f"GFS {period_lbl} Precipitation (mm)"
    sub_left = "Model: GFS (0.25°)"
    sub_center = f"Forecast Hour: {fh_str}"
    sub_right = f"Init: {init_str} / Valid: {valid_str}"

    # Force a draw so we can get the exact pixel/figure coordinates of the map area
    fig.canvas.draw()
    pos = ax.get_position()
    left = pos.x0
    right = pos.x1
    
    # Adjust Y coordinates for the text above the map
    y_top = pos.y1 + 0.045
    y_bottom = pos.y1 + 0.015
    y_line = pos.y1 + 0.005

    # Top line
    fig.text(left, y_top, "Philippine T/W", ha='left', va='bottom', fontsize=14, weight='bold', color='#888')
    fig.text(right, y_top, title_center, ha='right', va='bottom', fontsize=14, weight='bold', color='black')
    
    # Bottom line
    fig.text(left, y_bottom, f"{sub_left}   |   {sub_center}", ha='left', va='bottom', fontsize=11, color='black')
    fig.text(right, y_bottom, sub_right, ha='right', va='bottom', fontsize=11, color='black')
    
    # Separator Line drawn perfectly from the left edge of the map to the right edge
    import matplotlib.lines as lines
    line = lines.Line2D((left, right), (y_line, y_line), color='black', linewidth=1, transform=fig.transFigure)
    fig.add_artist(line)

    # Save
    filename = f"{filename_id}.png"
    filepath = os.path.join(OUTPUT_DIR, filename)
    plt.savefig(filepath, dpi=120, bbox_inches='tight', facecolor='white', transparent=False)
    print(f"Saved {filepath}")
    plt.close()

def scheduler_loop():
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] --- GFS Scheduler Started ---")
    print("Checking for new model runs every 15 minutes...")
    
    last_run_time = None
    
    while True:
        try:
            # Create session for lightweight checks
            session = requests.Session()
            session.headers.update({'User-Agent': 'WeatherApp-Scheduler/1.0'})
            
            # Check for latest run
            print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Checking THREDDS for updates...")
            latest_url, latest_time = get_latest_run_url(session)
            
            if latest_time is None:
                 print("Could not determine specific run time. Using Best Series.")
                 # Just run periodically if no specific time found? 
                 # Or skip. Best series updates continuously.
                 # Let's run every cycle if fallback.
                 pass

            # Determine if we should run
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
        
        # Sleep for 15 minutes
        time.sleep(900)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == '--daemon':
        scheduler_loop()
    else:
        # Default: Run once (for GitHub Actions / Cron)
        fetch_and_plot_gfs()
