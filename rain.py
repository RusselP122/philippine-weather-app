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
from matplotlib.colors import ListedColormap, BoundaryNorm

# Output directory
OUTPUT_DIR = r"C:\Users\Russel\Desktop\philippine-weather-app\public\images\rainfall"
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
            
    # Fallback
    print("Warning: Could not find specific run, falling back to Best Time Series")
    return f"{base_url}/Best", None

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
        # Note: In single run files, accumulation variable often same name
        var_name = "Total_precipitation_surface_Mixed_intervals_Accumulation"
        if var_name not in ds:
            # Try alternates
            print(f"Variable {var_name} not found. checking keys...")
            candidates = [k for k in ds.keys() if "precipitation" in k.lower()]
            print(f"Candidates: {candidates}")
            # Fallback to rate? No, want accumulation.
            # Usually it exists.
            if not candidates:
                 raise ValueError("No precipitation variable found")
            var_name = candidates[0] # taking first guess if exact mismatch
            
        print(f"Variable found: {var_name}")
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
             
        # 6. Forecast Window Logic (Existing)
        now = datetime.now(timezone.utc)
        end_time = now + timedelta(hours=24)
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
            "model": "GFS Seamless",
            "source": "NOAA NOMADS / THREDDS",
            "generated_at": datetime.now().strftime("%Y-%m-%d %I:%M %p"),
            "run_time": all_dates[0].strftime("%Y-%m-%d %H:%M UTC") if all_dates else "Unknown",
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
            
            end_time_period = now + timedelta(hours=end_hour_offset)
            start_time_period = now + timedelta(hours=start_hour_offset)
            
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
                
                # Fetch Start Grid
                grid_start = precip_var[idx_start, lat_min_idx:lat_max_idx+1, lon_min_idx:lon_max_idx+1].data
                grid_start = np.array(grid_start).astype(float).squeeze()
                
                # Mask artifacts
                grid_end[grid_end > 3000] = 0
                grid_end[grid_end < 0] = 0
                grid_start[grid_start > 3000] = 0 
                grid_start[grid_start < 0] = 0
                
                # Calculate Difference
                total_precip = grid_end - grid_start
                total_precip = np.maximum(total_precip, 0)
                
            except Exception as slice_err:
                print(f"Data fetch error for {period_name}: {slice_err}")
                continue
            
            # Cap Total
            total_precip = np.clip(total_precip, 0, 3000)

            max_val = np.nanmax(total_precip)
            print(f"Max Precip ({period_name}): {max_val} mm")
            
            # Plot
            plot_rainfall(subset_lons, subset_lats, total_precip, f"gfs_{period_name}")

        # Save Metadata
        import json
        meta_path = os.path.join(r"C:\Users\Russel\Desktop\philippine-weather-app\public\data", "rainfall_meta.json")
        with open(meta_path, "w") as f:
            json.dump(meta_info, f, indent=2)
        print(f"Saved metadata to {meta_path}")

    except Exception as e:
        print(f"CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()
    
def plot_rainfall(lons, lats, data, filename_id):
    # Landscape
    fig = plt.figure(figsize=(16, 10))
    ax = plt.axes(projection=ccrs.PlateCarree())
    
    # Extent: Includes PAR (115-135), Palau (134), Excludes mostly Vietnam (<109)
    # [LonMin, LonMax, LatMin, LatMax]
    ax.set_extent([114, 138, 3, 27], crs=ccrs.PlateCarree())

    # Features
    ax.add_feature(cfeature.LAND, facecolor='#f0f0f0') # Lighter land
    ax.add_feature(cfeature.COASTLINE, linewidth=1.0, edgecolor='#555')
    ax.add_feature(cfeature.BORDERS, linestyle=':', linewidth=0.8, edgecolor='#777')
    ax.add_feature(cfeature.OCEAN, facecolor='#e0f7fa') # Light cyan ocean
    
    # Plot PAR (Philippine Area of Responsibility)
    # Polygon Logic: [Lon, Lat]
    par_lons = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
    par_lats = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]
    
    ax.plot(par_lons, par_lats, transform=ccrs.PlateCarree(), 
            color='red', linestyle='-', linewidth=2, label='PAR', alpha=0.7)
    
    # Gridlines
    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.3, linestyle='--')
    gl.top_labels = False
    gl.right_labels = False
    gl.xlabel_style = {'size': 9, 'color': 'gray'}
    gl.ylabel_style = {'size': 9, 'color': 'gray'}

    # Extended Rainfall Levels (Granular scale as requested)
    levels = [0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 70, 100, 125, 150, 175, 200, 250, 300, 400, 500]
    
    # Custom Distinct Colors corresponding to intervals (19 colors needed for 20 levels)
    colors = [
        '#ffffff00', # 0-5 (Transparent)
        '#e0f2fe',   # 5-10
        '#bae6fd',   # 10-15
        '#7dd3fc',   # 15-20
        '#38bdf8',   # 20-25
        '#0ea5e9',   # 25-30
        '#0284c7',   # 30-35
        '#0369a1',   # 35-40
        '#4ade80',   # 40-50
        '#22c55e',   # 50-70
        '#16a34a',   # 70-100
        '#facc15',   # 100-125
        '#eab308',   # 125-150
        '#fb923c',   # 150-175
        '#f97316',   # 175-200
        '#ef4444',   # 200-250
        '#dc2626',   # 250-300
        '#d946ef',   # 300-400
        '#a21caf',   # 400-500
        '#581c87'    # > 500
    ]
    
    cmap_cols = colors[:-1] 
    cmap = ListedColormap(cmap_cols)
    cmap.set_over(colors[-1])
    
    norm = BoundaryNorm(levels, ncolors=len(cmap_cols), clip=False)

    # Meshgrid
    if len(lons.shape) == 1:
        LONS, LATS = np.meshgrid(lons, lats)
    else:
        LONS, LATS = lons, lats

    if np.nanmax(data) > 0:
        contour = ax.contourf(LONS, LATS, data, levels=levels, cmap=cmap, norm=norm, extend='max', transform=ccrs.PlateCarree())
        
        # Colorbar (Horizontal for landscape?)
        # Vertical usually saves space on side for landscape if ratio is wide.
        # But let's stick to vertical right.
        cb = fig.colorbar(contour, ax=ax, orientation='vertical', pad=0.01, shrink=0.7, aspect=35)
        cb.ax.tick_params(labelsize=9)
    
    # Save
    filename = f"{filename_id}.png"
    filepath = os.path.join(OUTPUT_DIR, filename)
    plt.savefig(filepath, dpi=100, bbox_inches='tight', facecolor='white', transparent=False)
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
