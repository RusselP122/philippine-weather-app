import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import pandas as pd
import numpy as np
from matplotlib.path import Path
from matplotlib.patches import PathPatch
import matplotlib.patches as mpatches
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


def get_latest_run_url():
    base = (
        "https://deepmind.google.com/science/weatherlab/download/"
        "cyclones/FNV3_LARGE_ENSEMBLE/ensemble/cyclogenesis/csv"
    )

    today = datetime.now(timezone.utc).date()
    dates = [today, today - timedelta(days=1), today - timedelta(days=2)]
    hours_desc = ["18", "12", "06", "00"]

    for d in dates:
        date_str = d.strftime("%Y_%m_%d")
        for h in hours_desc:
            url = f"{base}/FNV3_LARGE_ENSEMBLE_{date_str}T{h}_00_cyclogenesis.csv"
            try:
                resp = requests.head(url, allow_redirects=True, timeout=10)
            except requests.RequestException:
                continue
            if resp.status_code == 200:
                print(f"Latest available run found: {date_str}T{h}:00")
                return date_str, h, url

    raise RuntimeError("No available FNV3_LARGE_ENSEMBLE cyclogenesis runs found in the last 3 days.")


# Load the CSV file, skipping comment lines
try:
    date_str, hour_str, latest_url = get_latest_run_url()
    local_csv = fr"C:\Users\Russel\Desktop\Weather alert\FNV3_LARGE_ENSEMBLE_{date_str}T{hour_str}_00_cyclogenesis.csv"
    print(f"Downloading latest run with curl to: {local_csv}")
    subprocess.run([
        "curl",
        "-L",
        "-o",
        local_csv,
        latest_url,
    ], check=True)
    data = pd.read_csv(local_csv, comment="#")
    data.columns = data.columns.str.strip()
    if 'lead_time' in data.columns and 'lead_time_hours' not in data.columns:
        data['lead_time_hours'] = pd.to_timedelta(data['lead_time']).dt.total_seconds() / 3600

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
    forecast_end_date_text = (latest_ph + timedelta(days=5)).strftime("%Y-%m-%d")
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

# Filter for 5-day forecast (lead_time_hours <= 120)
wp_data = data[data['lead_time_hours'] <= 120].copy()

# Get all unique track IDs
all_track_ids = sorted(wp_data['track_id'].unique())
print(f"Processing all track IDs: {all_track_ids}")

# Check if any data remains
if wp_data.empty:
    print("Error: No data found in the CSV file for lead_time_hours <= 120.")
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
projection = ccrs.PlateCarree(central_longitude=180)
fig = plt.figure(figsize=(12, 12))
ax = plt.axes(projection=projection)
ax.set_extent([-75, 10, 0, 40], crs=projection)

# Add land, ocean, and coastlines
ax.set_facecolor('#87CEEB')
ax.add_feature(cfeature.LAND, facecolor='#DEB887', edgecolor='#8B4513', linewidth=0.8)
ax.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.8, alpha=0.7, color='#654321')

# Add gridlines
gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
gl.xlocator = plt.FixedLocator(list(range(105, 181, 5)) + [-175, -170])
gl.ylocator = plt.FixedLocator(np.arange(0, 41, 5))
gl.xlabel_style = {'size': 12, 'weight': 'bold'}
gl.ylabel_style = {'size': 12, 'weight': 'bold'}
gl.top_labels = False
gl.right_labels = False

ax.text(
    118 - 180, 13, 'West Philippine\nSea', fontsize=5, color='navy', weight='bold',
    transform=projection, ha='center', va='center', style='italic', alpha=0.5
)
ax.text(
    130 - 180, 20, 'Philippine\nSea', fontsize=9, color='navy', weight='bold',
    transform=projection, ha='center', va='center', style='italic', alpha=0.5
)

# Add Philippine Area of Responsibility (PAR) boundary
par_vertices = [
    (115.0 - 180, 5.0), (115.0 - 180, 15.0), (120.0 - 180, 21.0), (120.0 - 180, 25.0),
    (135.0 - 180, 25.0), (135.0 - 180, 5.0), (115.0 - 180, 5.0)
]
ax.add_patch(mpatches.Polygon(par_vertices, facecolor='none', edgecolor='#FF6B35', 
                             linestyle='-', linewidth=3, alpha=0.8, 
                             transform=projection))

# Define function to assign custom colors based on pressure
def get_pressure_color(pressure):
    if np.isnan(pressure):
        return None
    if pressure < 920:
        return '#FF007F'  # Super Typhoon
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
            # Convert negative longitudes to 0-360 range first
            raw_lons = sample_data['lon'].values
            raw_lons = np.where(raw_lons < 0, raw_lons + 360, raw_lons)
            
            # Now filter using the 0-360 longitudes
            mask = (raw_lons >= 105) & (raw_lons <= 190) & (sample_data['lat'] >= 0) & (sample_data['lat'] <= 40)
            sample_data = sample_data[mask]
            if sample_data.empty:
                continue
            lons = raw_lons[mask]
            lats = sample_data['lat'].values
            pressures = sample_data['minimum_sea_level_pressure_hpa'].values
            
            # Shift longitudes by 180 for projection=ccrs.PlateCarree(central_longitude=180)
            lons_shifted = lons - 180.0
            
            # Validate data
            if len(lons_shifted) < 2 or np.any(np.isnan(lons_shifted)) or np.any(np.isnan(lats)):
                print(f"Warning: Invalid data for track_id {track_id}, sample {sample}, init_time {init_time}. Skipping.")
                skipped_tracks += 1
                skipped_details.append(f"track_id {track_id}, sample {sample}, init_time {init_time}")
                continue
            lon_diffs = np.abs(np.diff(lons_shifted))
            lat_diffs = np.abs(np.diff(lats))
            if np.any(lon_diffs > 10) or np.any(lat_diffs > 10):
                print(f"Warning: Large jump in track_id {track_id}, sample {sample}, init_time {init_time}. Skipping.")
                skipped_tracks += 1
                skipped_details.append(f"track_id {track_id}, sample {sample}, init_time {init_time}")
                continue
            # Plot gray lines for segments
            ax.plot(
                lons_shifted, lats,
                color='#404040',
                linewidth=2.5,
                alpha=0.7,
                transform=projection
            )
            # Plot donut markers at each point
            for i in range(len(lons_shifted)):
                color = get_pressure_color(pressures[i])
                if color is None:
                    continue
                # Shadow
                ax.plot(lons_shifted[i], lats[i], color='black', marker='o', markersize=8,
                        markeredgewidth=0, alpha=0.2, transform=projection)
                # Colored donut ring (transparent center)
                ax.plot(lons_shifted[i], lats[i], markerfacecolor='none', markeredgecolor=color,
                        marker='o', markersize=5, markeredgewidth=1.5,
                        transform=projection)
            plotted_tracks += 1

# Define pressure ranges with custom colors
pressure_ranges = [
    {'pressure_range': '< 920 hPa', 'color': '#FF007F'},
    {'pressure_range': '920–945 hPa', 'color': '#A83232'},
    {'pressure_range': '945–970 hPa', 'color': '#E67E22'},
    {'pressure_range': '970–990 hPa', 'color': '#F1C40F'},
    {'pressure_range': '990–1005 hPa', 'color': '#2ECC71'},
    {'pressure_range': '> 1005 hPa', 'color': '#3498DB'}
]

# Create legend elements
legend_elements = [
    plt.Line2D(
        [0], [0], marker='o', color='none', markerfacecolor='none',
        markeredgecolor=range_info['color'], markeredgewidth=2,
        markersize=8, label=range_info['pressure_range']
    )
    for range_info in pressure_ranges
]

# Position the legend in the top-left corner
legend = ax.legend(
    handles=legend_elements, loc='upper left', bbox_to_anchor=(0.02, 0.98),
    frameon=False, fontsize=10
)

# Update legend text with current date and time
runtime_text = latest_runtime_text or "Runtime unavailable"
legend_text = (
    f"Runtime: {runtime_text}\n"
    "Processed By: Philippine Typhoon/Weather"
)
plt.text(
    0.98, 0.02, legend_text,
    transform=ax.transAxes, fontsize=10, verticalalignment='bottom', horizontalalignment='right'
)

# Add title
start_date = forecast_start_date_text or "Start"
end_date = forecast_end_date_text or "End"
ax.set_title(f"FNV3 1000 Ensemble 5-Day Forecast Tropical Cyclone Tracks\nWestern Pacific ({start_date} to {end_date})", fontsize=14, weight='bold')

# Save the plot to a file
try:
    init_time_str = init_times[0].replace(':', '').replace(' ', 'T') if len(init_times) > 0 else '20250728T0953'
    output_dir = "public/assets"
    import os
    os.makedirs(output_dir, exist_ok=True)
    output_file = f"{output_dir}/fnv3_tropical_cyclone_5day_forecast_{init_time_str}.png"
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