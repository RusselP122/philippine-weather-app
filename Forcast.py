import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import pandas as pd
import numpy as np
from matplotlib.path import Path
from matplotlib.patches import PathPatch
import requests
import subprocess
from datetime import datetime, timedelta, timezone

# Initialize counters for tracking plotted and skipped tracks
plotted_tracks = 0
skipped_tracks = 0
skipped_details = []

latest_runtime_text = None
forecast_start_date_text = None
forecast_end_date_text = None

# Define function to get latest run URL
def get_latest_run_url():
    base = (
        "https://deepmind.google.com/science/weatherlab/download/"
        "cyclones/FNV3/ensemble/cyclogenesis/csv"
    )

    today = datetime.now(timezone.utc).date()
    dates = [today, today - timedelta(days=1), today - timedelta(days=2)]
    hours_desc = ["18", "12", "06", "00"]

    for d in dates:
        date_str = d.strftime("%Y_%m_%d")
        for h in hours_desc:
            url = f"{base}/FNV3_{date_str}T{h}_00_cyclogenesis.csv"
            try:
                resp = requests.head(url, allow_redirects=True, timeout=10)
            except requests.RequestException:
                continue
            if resp.status_code == 200:
                print(f"Latest available run found: {date_str}T{h}:00")
                return date_str, h, url

    raise RuntimeError("No available FNV3 cyclogenesis runs found in the last 3 days.")

# Load the CSV file, skipping comment lines
try:
    date_str, hour_str, latest_url = get_latest_run_url()
    import os
    os.makedirs("temp_data", exist_ok=True)
    local_csv = f"temp_data/FNV3_{date_str}T{hour_str}_00_cyclogenesis.csv"
    print(f"Downloading latest run with curl to: {local_csv}")
    subprocess.run([
        "curl",
        "-L",
        "-o",
        local_csv,
        latest_url,
    ], check=True)
    data = pd.read_csv(local_csv, comment="#")

    latest_utc = datetime.strptime(f"{date_str} {hour_str}", "%Y_%m_%d %H").replace(tzinfo=timezone.utc)
    ph_zone = timezone(timedelta(hours=8))
    latest_ph = latest_utc.astimezone(ph_zone)

    if hour_str == "00":
        time_label = "4:00 PM"
    elif hour_str == "06":
        time_label = "10:00 PM"
    elif hour_str == "12":
        time_label = "4:00 AM"
    elif hour_str == "18":
        time_label = "10:00 AM"
    else:
        time_label = latest_ph.strftime("%I:%M %p").lstrip("0")

    latest_runtime_text = f"{time_label} PHT, {latest_ph.strftime('%B %d, %Y')}"

    forecast_start_date_text = latest_ph.strftime("%Y-%m-%d")
    forecast_end_date_text = (latest_ph + timedelta(days=15)).strftime("%Y-%m-%d")
except subprocess.CalledProcessError as e:
    print(f"Error: curl failed to download CSV: {e}")
    exit()
except pd.errors.ParserError:
    print("Error: Failed to parse CSV. Ensure the file is correctly formatted and contains the expected columns.")
    exit()
except Exception as e:
    print(f"Error loading CSV: {str(e)}")
    exit()

# Validate required columns
required_columns = ['init_time', 'track_id', 'sample', 'lead_time_hours', 'lat', 'lon', 'minimum_sea_level_pressure_hpa']
missing_columns = [col for col in required_columns if col not in data.columns]
if missing_columns:
    print(f"Error: Missing required columns in CSV: {missing_columns}")
    exit()

# Filter for 15-day forecast (lead_time_hours <= 360)
wp_data = data[data['lead_time_hours'] <= 360].copy()

# Get all unique track IDs
all_track_ids = sorted(wp_data['track_id'].unique())
print(f"Processing all track IDs: {all_track_ids}")

# Check if any data remains
if wp_data.empty:
    print("Error: No data found in the CSV file for lead_time_hours <= 360.")
    exit()

# Ensure data is sorted by init_time, track_id, sample, and lead_time_hours
wp_data = wp_data.sort_values(by=['init_time', 'track_id', 'sample', 'lead_time_hours'])

# Identify unique initialization times
init_times = wp_data['init_time'].unique()
if len(init_times) == 0:
    print("Error: No valid init_time values found in the data.")
    exit()
print(f"Found {len(init_times)} forecast initialization times: {init_times}")

# Set up the figure and map projection
fig = plt.figure(figsize=(12, 12))
ax = plt.axes(projection=ccrs.PlateCarree())
ax.set_extent([105, 155, 0, 40], crs=ccrs.PlateCarree())  # Wider Western Pacific view

# Add land, ocean, and coastlines
ax.add_feature(cfeature.LAND, facecolor='lightgray')
ax.add_feature(cfeature.COASTLINE, linewidth=1.5)
ax.add_feature(cfeature.BORDERS, linestyle=':', linewidth=1)
ax.add_feature(cfeature.OCEAN, facecolor='aliceblue')

# Add gridlines with emphasized labels at 5° intervals
gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
gl.xlocator = plt.FixedLocator(np.arange(105, 156, 5))
gl.ylocator = plt.FixedLocator(np.arange(0, 41, 5))
gl.xlabel_style = {'size': 12, 'weight': 'bold'}
gl.ylabel_style = {'size': 12, 'weight': 'bold'}
gl.top_labels = False
gl.right_labels = False

# Add Philippine Area of Responsibility (PAR) boundary
par_vertices = [
    (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
    (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
]
par_path = Path(par_vertices)
par_patch = PathPatch(par_path, edgecolor='blue', linestyle='--', linewidth=2, facecolor='none', transform=ccrs.PlateCarree())
ax.add_patch(par_patch)

# Define function to assign custom colors based on pressure
def get_pressure_color(pressure):
    if np.isnan(pressure):
        return None
    if pressure < 920:
        return '#5B0E2D'  # Super Typhoon
    elif 920 <= pressure <= 945:
        return '#A83232'  # Typhoon
    elif 945 < pressure <= 970:
        return '#E67E22'  # Severe Tropical Storm
    elif 970 < pressure <= 990:
        return '#F1C40F'  # Tropical Storm
    elif 990 < pressure <= 1005:
        return '#2ECC71'  # Tropical Depression
    else:
        return '#3498DB'  # Low Pressure Area

# Plot tracks for each init_time, track_id, and sample
init_time_alphas = {init_time: max(0.4, 1.0 - i * 0.2) for i, init_time in enumerate(init_times)}
for init_time in init_times:
    init_data = wp_data[wp_data['init_time'] == init_time]
    if init_data.empty:
        print(f"Warning: No data for init_time {init_time}. Skipping.")
        continue
    for track_id in all_track_ids:
        track_data = init_data[init_data['track_id'] == track_id]
        if track_data.empty:
            continue
        for sample in track_data['sample'].unique():
            sample_data = track_data[track_data['sample'] == sample]
            if sample_data.empty:
                continue
            # Filter within map extent
            sample_data = sample_data[(sample_data['lon'] >= 105) & (sample_data['lon'] <= 155) & (sample_data['lat'] >= 0) & (sample_data['lat'] <= 40)]
            lons = sample_data['lon'].values
            lats = sample_data['lat'].values
            pressures = sample_data['minimum_sea_level_pressure_hpa'].values
            # Handle longitude wraparound
            lons = np.where(lons > 180, lons - 360, lons)
            # Validate data
            if len(lons) < 2 or np.any(np.isnan(lons)) or np.any(np.isnan(lats)):
                print(f"Warning: Invalid data for track_id {track_id}, sample {sample}, init_time {init_time}. Skipping.")
                skipped_tracks += 1
                skipped_details.append(f"track_id {track_id}, sample {sample}, init_time {init_time}")
                continue
            lon_diffs = np.abs(np.diff(lons))
            lat_diffs = np.abs(np.diff(lats))
            if np.any(lon_diffs > 10) or np.any(lat_diffs > 10):
                print(f"Warning: Large jump in track_id {track_id}, sample {sample}, init_time {init_time}. Skipping.")
                skipped_tracks += 1
                skipped_details.append(f"track_id {track_id}, sample {sample}, init_time {init_time}")
                continue
            # Plot gray lines for segments
            ax.plot(
                lons, lats,
                color='#404040',
                linewidth=2.5,
                alpha=0.7,  # Reduced opacity for clarity
                transform=ccrs.PlateCarree()
            )
            # Plot colored markers
            for i in range(len(lons)):
                color = get_pressure_color(pressures[i])
                if color is None:
                    continue
                ax.plot(
                    lons[i], lats[i],
                    color='white',
                    marker='o',
                    markersize=8,
                    markeredgewidth=0,
                    transform=ccrs.PlateCarree()
                )
                ax.plot(
                    lons[i], lats[i],
                    color=color,
                    marker='o',
                    markersize=6,
                    transform=ccrs.PlateCarree()
                )
            plotted_tracks += 1

# Define pressure ranges with custom colors (only pressure ranges, no category labels)
pressure_ranges = [
    {'pressure_range': '< 920 hPa', 'color': '#5B0E2D'},
    {'pressure_range': '920–945 hPa', 'color': '#A83232'},
    {'pressure_range': '945–970 hPa', 'color': '#E67E22'},
    {'pressure_range': '970–990 hPa', 'color': '#F1C40F'},
    {'pressure_range': '990–1005 hPa', 'color': '#2ECC71'},
    {'pressure_range': '> 1005 hPa', 'color': '#3498DB'}
]

# Create legend elements with only pressure ranges
legend_elements = [
    plt.Line2D(
        [0], [0], marker='o', color='#404040', markerfacecolor=range_info['color'],
        markersize=10, label=range_info['pressure_range']
    )
    for range_info in pressure_ranges
]

# Position the legend in the top-left corner
legend = ax.legend(
    handles=legend_elements, loc='upper left', bbox_to_anchor=(0.02, 0.98),
    frameon=True, fancybox=True, shadow=True, fontsize=10
)
legend.get_frame().set_facecolor('white')
legend.get_frame().set_alpha(0.9)

# Add small legend with forecast info
runtime_text = latest_runtime_text or "Runtime unavailable"
legend_text = (
    "Forecast: All Tropical Cyclone Tracks (15-Day)\n"
    f"Runtime: {runtime_text}\n"
    "Processed By: Philippine Typhoon/Weather"
)
plt.text(
    0.98, 0.02, legend_text,
    transform=ax.transAxes, fontsize=10, verticalalignment='bottom', horizontalalignment='right',
    bbox=dict(facecolor='white', alpha=0.8, edgecolor='black', boxstyle='round,pad=0.3')
)

# Add title
start_date = forecast_start_date_text or "Start"
end_date = forecast_end_date_text or "End"
ax.set_title(f"15-Day Forecast Tropical Cyclone Tracks - Western Pacific ({start_date} to {end_date})", fontsize=16, weight='bold')

# Save the plot to a file
try:
    # Generate filename based on init_time
    init_time_str = init_times[0].replace(':', '').replace(' ', 'T') if len(init_times) > 0 else '20250621T1200'
    output_dir = "public/assets"
    os.makedirs(output_dir, exist_ok=True)
    output_file = f"{output_dir}/tropical_cyclone_15day_forecast_{init_time_str}.png"
    plt.savefig(output_file, dpi=300, bbox_inches='tight')
    print(f"Plot saved to {output_file}")
except Exception as e:
    print(f"Error saving plot: {str(e)}")

# Print summary of plotted and skipped tracks
print(f"Summary: {plotted_tracks} tracks plotted, {skipped_tracks} tracks skipped.")
if skipped_tracks > 0:
    print("Skipped tracks details:")
    for detail in skipped_details:
        print(f"  - {detail}")

plt.close()