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
        
        # 4. Filter Region (PH)
        lat_min, lat_max = 4.0, 22.0
        lon_min, lon_max = 116.0, 128.0

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
        
        # Define Periods to Generate
        periods = {
            "24h": 24,
            "3d": 72,
            "7d": 168
        }
        
        meta_info = {
            "model": "GFS Seamless",
            "source": "NOAA NOMADS / THREDDS",
            "generated_at": datetime.now().strftime("%Y-%m-%d %I:%M %p"),
            "run_time": all_dates[0].strftime("%Y-%m-%d %H:%M UTC") if all_dates else "Unknown" # Approximation
        }

        for period_name, hours in periods.items():
            print(f"\nGenerating {period_name} ({hours}h) map...")
            
            end_time_period = now + timedelta(hours=hours)
            
            # Find time indices for this specific period
            # Note: We can reuse the parsed dates
            period_indices = [i for i, t in enumerate(all_dates) if now <= t <= end_time_period]
            
            if not period_indices:
                print(f"Skipping {period_name}: No data in range.")
                continue
                
            p_start, p_end = min(period_indices), max(period_indices)
            
            # Fetch slice
            # Warning: Pydap might be slow if we fetch 3 times. 
            # Optimization: Fetch max range (7d) once, then slice in memory?
            # 7 Days is 168 hours = ~56 steps (3h intervals). 56x72x144 floats is small.
            # Let's fetch each time to be safe on memory if grid is huge, but it's small enough here.
            
            print(f"Fetching data slice {p_start}-{p_end}...")
            precip_data = precip_var[p_start:p_end+1, lat_min_idx:lat_max_idx+1, lon_min_idx:lon_max_idx+1].data
            precip_data = np.array(precip_data).astype(float)
            
            # Mask improbable values (artifacts)
            precip_data[precip_data > 2000] = 0 
            precip_data[precip_data < 0] = 0
            
            # Simplified/Correct Calculation for Cumulative Variable
            # GFS "Mixed_intervals_Accumulation" in a Single Run is cumulative from Run Start
            # So: Total Rain in Window = Value[End] - Value[Start]
            
            # Check if we have data points
            if precip_data.shape[0] > 0:
                # Value at end of period
                end_val = precip_data[-1]
                
                # Value at start of period (baseline)
                # If the period starts at the beginning of available data, use 0? 
                # No, we fetched a slice. precip_data[0] is the accumulation at t=now.
                # So forecast from Now to End = Acc(End) - Acc(Now).
                start_val = precip_data[0]
                
                # Total precip is the difference
                total_precip = end_val - start_val
                
                # Handle any negative values (if reset happened contrary to assumption)
                # In strict cumulative, diff should be >= 0.
                # If negative, it implies a reset occurred (End < Start). 
                # Result would be negative. 
                # Fallback: if negative, just take End val (assuming Start was from prev cycle)? 
                # Or stick to diff sum if robust. 
                # User requested Subtraction. Let's enforce non-negative.
                total_precip = np.maximum(total_precip, 0)
                
            else:
                total_precip = np.zeros((subset_lats.shape[0], subset_lons.shape[0]))
            
            # Cap Total (Artifact Removal)
            # Clip at 3000mm to prevent scale compression by anomalies
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
    fig = plt.figure(figsize=(12, 12))
    ax = plt.axes(projection=ccrs.PlateCarree())
    ax.set_extent([116, 127, 4, 21], crs=ccrs.PlateCarree())

    # Features
    ax.add_feature(cfeature.LAND, facecolor='lightgray')
    ax.add_feature(cfeature.COASTLINE, linewidth=1.5)
    ax.add_feature(cfeature.BORDERS, linestyle=':', linewidth=1)
    ax.add_feature(cfeature.OCEAN, facecolor='aliceblue')
    
    # Gridlines
    gl = ax.gridlines(draw_labels=False, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')

    # Extended Rainfall Levels (Granular scale as requested)
    levels = [0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 70, 100, 125, 150, 175, 200, 250, 300, 400, 500]
    
    # Custom Distinct Colors corresponding to intervals (19 colors needed for 20 levels)
    colors = [
        '#ffffff00', # 0-5 (Transparent)
        '#e0f2fe',   # 5-10 (Very Light Blue)
        '#bae6fd',   # 10-15
        '#7dd3fc',   # 15-20
        '#38bdf8',   # 20-25
        '#0ea5e9',   # 25-30 (Sky Blue)
        '#0284c7',   # 30-35
        '#0369a1',   # 35-40 (Deep Blue)
        '#4ade80',   # 40-50 (Light Green)
        '#22c55e',   # 50-70 (Green)
        '#16a34a',   # 70-100 (Dark Green)
        '#facc15',   # 100-125 (Yellow)
        '#eab308',   # 125-150 (Dark Yellow)
        '#fb923c',   # 150-175 (Orange)
        '#f97316',   # 175-200 (Dark Orange)
        '#ef4444',   # 200-250 (Red)
        '#dc2626',   # 250-300 (Dark Red)
        '#d946ef',   # 300-400 (Fuchsia)
        '#a21caf',   # 400-500 (Purple)
        '#581c87'    # > 500 (Deep Purple - Max)
    ]
    
    # Ensure color list matches level intervals (N levels -> N-1 colors usually, or N+1 with extend)
    # Contourf usually uses N-1 colors for N levels.
    # We have 20 levels, so we need 19 colors for the intervals between them.
    # The 'extend="max"' will use the last color or a separate one for >500.
    # Let's verify lengths: len(levels) = 20. Intervals = 19.
    # len(colors) = 20. 
    # We will slice colors[1:] if needed, or pass full list if it aligns with "extend".
    # Standard matplotlib: colors should be len(levels)-1.
    # We have 20 levels -> 19 intervals.
    # 0-5, 5-10, ..., 400-500.
    # The list above has 20 colors. 
    # Use colors[1:] to skip the transparent one if we want 0-5 to be the first colored syntax?
    # Actually, usually index 0 is 0-5.
    
    # Let's explicitly define the cmap.
    from matplotlib.colors import ListedColormap, BoundaryNorm
    
    # We want 0-5 to be Transparent (#ffffff00).
    # 5-10 to be #e0f2fe, etc.
    # If we pass `colors`, we have 20 items.
    # We need 19 items for 19 intervals.
    # The last color in my list '#581c87' is for >500 (extend).
    # So for the main intervals, we use colors[:-1] (19 items).
    
    cmap_cols = colors[:-1] 
    cmap = ListedColormap(cmap_cols)
    cmap.set_over(colors[-1]) # Set >500 color
    
    norm = BoundaryNorm(levels, ncolors=len(cmap_cols), clip=False)

    # Meshgrid
    if len(lons.shape) == 1:
        LONS, LATS = np.meshgrid(lons, lats)
    else:
        LONS, LATS = lons, lats

    if np.nanmax(data) > 0:
        # Extend max to handle > 500
        contour = ax.contourf(LONS, LATS, data, levels=levels, cmap=cmap, norm=norm, extend='max', transform=ccrs.PlateCarree())
        
        # Colorbar
        cb = fig.colorbar(contour, ax=ax, orientation='vertical', pad=0.02, shrink=0.8, aspect=30)
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
