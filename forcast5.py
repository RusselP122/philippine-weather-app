import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import cartopy.io.img_tiles as cimgt  # For satellite tiles
import pandas as pd
import numpy as np
from matplotlib.path import Path
from matplotlib.patches import PathPatch
from sklearn.cluster import DBSCAN
from scipy.stats import gaussian_kde
import urllib.request
import json
from datetime import datetime, timedelta, timezone  # Added for time calculations
import warnings
import matplotlib.patches as patches  # Added for Patch
from matplotlib.patches import Circle, Ellipse
import requests
import sys
import subprocess

init_text = None
MIN_GENESIS_WIND_KT = 25.0


# Define function to get color based on pressure (unchanged)
def get_pressure_color(pressure):
    try:
        p = float(pressure)
    except:
        return None
    if p > 1000:
        return 'yellow'  # Weak
    elif 980 < p <= 1000:
        return 'orange'  # Moderate
    elif p <= 980:
        return 'red'  # Strong
    else:
        return None

def safe_gaussian_kde(xy, bandwidth_factor=1.0):
    """
    Safely create a gaussian_kde with fallback options for singular data
    """
    try:
        # First, check if we have enough unique points
        unique_points = np.unique(xy, axis=1)
        if unique_points.shape[1] < 3:
            return None, "Insufficient unique points"
        
        # Check for duplicate points and add small random noise if needed
        if xy.shape[1] != unique_points.shape[1]:
            print(f"Warning: Found duplicate points, adding small noise")
            xy = xy + np.random.normal(0, 0.01, xy.shape)
        
        # Try creating KDE with default bandwidth
        kde = gaussian_kde(xy)
        
        # Optionally adjust bandwidth
        if bandwidth_factor != 1.0:
            kde.covariance_factor = lambda: kde.silverman_factor() * bandwidth_factor
            kde._compute_covariance()
            
        return kde, "Success"
        
    except np.linalg.LinAlgError as e:
        print(f"LinAlgError: {e}")
        try:
            # Add more noise to spread out the points
            print("Adding more noise to resolve singular matrix...")
            xy_noisy = xy + np.random.normal(0, 0.1, xy.shape)
            kde = gaussian_kde(xy_noisy)
            return kde, "Success with noise"
        except:
            return None, "Failed even with noise"
    except Exception as e:
        print(f"Other KDE error: {e}")
        return None, f"Error: {e}"

# Added: Get category (low/medium/high) based on probability
def get_category(prob):
    if prob < 40:
        return 'low'
    elif prob <= 60:
        return 'medium'
    else:
        return 'high'

# Added: Get area color based on category
def get_area_color(cat):
    if cat == 'low':
        return 'yellow'
    elif cat == 'medium':
        return 'orange'
    else:
        return 'red'

def classify_tc_stage(max_wind_kt):
    """Classify the system stage based on maximum sustained wind (knots)."""
    try:
        w = float(max_wind_kt)
    except Exception:
        return 'Unknown'

    if w < 20:
        return 'Disturbance / LPA'
    elif w < 25:
        return 'Low Pressure Area'
    elif w < 34:
        return 'Tropical Depression'
    elif w < 48:
        return 'Tropical Storm'
    elif w < 64:
        return 'Severe Tropical Storm'
    else:
        return 'Typhoon'

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
    local_csv = fr"C:\Users\Russel\Desktop\Weather alert\FNV3\FNV3_{date_str}T{hour_str}_00_cyclogenesis.csv"
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

    init_text = f"{time_label} PHT, {latest_ph.strftime('%B %d, %Y')}"
except subprocess.CalledProcessError as e:
    print(f"Error: curl failed to download CSV: {e}")
    sys.exit(1)
except pd.errors.ParserError:
    print("Error: Failed to parse CSV. Ensure the file is correctly formatted and contains the expected columns.")
    sys.exit(1)
except Exception as e:
    print(f"Error loading CSV: {str(e)}")
    sys.exit(1)

# Validate required columns
required_columns = [
    'init_time',
    'track_id',
    'sample',
    'lead_time_hours',
    'lat',
    'lon',
    'minimum_sea_level_pressure_hpa',
    'maximum_sustained_wind_speed_knots',
]
missing_columns = [col for col in required_columns if col not in data.columns]
if missing_columns:
    print(f"Error: Missing required columns in CSV: {missing_columns}")
    sys.exit(1)

# Use all data up to 7 days (168 hours); adjust if data exceeds
wp_data = data[
    (data['lead_time_hours'] <= 168)
    & (data['maximum_sustained_wind_speed_knots'] >= MIN_GENESIS_WIND_KT)
].copy()

# Get total number of unique samples (ensembles)
num_samples = len(wp_data['sample'].unique())
if num_samples == 0:
    print("Error: No samples found in the data.")
    sys.exit(1)
print(f"Total samples: {num_samples}")

# Get all unique track IDs, filter to potential (numerical) tracks only
all_track_ids = [tid for tid in wp_data['track_id'].unique() if str(tid).isdigit()]
all_track_ids = sorted(all_track_ids, key=int)  # Sort numerically
print(f"Processing potential track IDs: {all_track_ids}")

# Check if any data remains
if wp_data.empty:
    print("Error: No data found in the CSV file.")
    sys.exit(1)

# Ensure data is sorted by init_time, track_id, sample, and lead_time_hours
wp_data = wp_data.sort_values(by=['init_time', 'track_id', 'sample', 'lead_time_hours'])

# Extract genesis points (earliest lead_time per init_time, track_id, sample)
genesis_data = wp_data.loc[wp_data.groupby(['init_time', 'track_id', 'sample'])['lead_time_hours'].idxmin()]

# Filter genesis_data to potential tracks only
genesis_data = genesis_data[genesis_data['track_id'].isin(all_track_ids)]

# Identify unique initialization times
init_times = wp_data['init_time'].unique()
if len(init_times) == 0:
    print("Error: No valid init_time values found in the data.")
    sys.exit(1)
print(f"Found {len(init_times)} forecast initialization times: {init_times}")

# Use latest_ph as the initialization datetime in Philippine time
init_dt = latest_utc  # keep UTC reference if needed
init_ph = latest_ph

# Compute day names for 2-day and 7-day periods based on PH time
two_day_day = (init_ph + timedelta(days=2)).strftime('%a')
seven_day_day = (init_ph + timedelta(days=7)).strftime('%a')

# Set up the figure and map projection
fig = plt.figure(figsize=(14, 11))  # Slightly wider than tall
ax = plt.axes(projection=ccrs.PlateCarree())
ax.set_extent([105, 155, 0, 40], crs=ccrs.PlateCarree())

# Add satellite background (like Zoom Earth)
tiles = cimgt.GoogleTiles(style='satellite')
ax.add_image(tiles, 6)  # Zoom level 6 for regional detail; adjust as needed

# Add coastlines and borders (overlaid on satellite)
ax.add_feature(cfeature.COASTLINE, linewidth=1.5)
ax.add_feature(cfeature.BORDERS, linestyle=':', linewidth=1)

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

# Prepare data for clustering (using all potential genesis points)
lons = genesis_data['lon'].values
lats = genesis_data['lat'].values

# Filter points within the map extent
mask = (lons >= 105) & (lons <= 155) & (lats >= 0) & (lats <= 40)
lons = lons[mask]
lats = lats[mask]
genesis_data = genesis_data.iloc[mask]

print(f"Total genesis points: {len(lons)}")

if len(lons) < 2:
    print("Insufficient points for density estimation. Creating visualization with no formation message.")
    
    # Add central message box with end date
    end_date_str = (init_ph + timedelta(days=7)).strftime("%m/%d/%Y")
    message_text = (
        f"NO TROPICAL CYCLONE\n"
        f"FORMATION EXPECTED\n\n"
        f"UNTIL {end_date_str}"
    )
    
    # Create a cleaner, modern message box in the center
    ax.text(
        0.5, 0.5, message_text,
        transform=ax.transAxes,
        fontsize=22,
        weight='bold',
        ha='center',
        va='center',
        color='#003366', # Dark blue text
        bbox=dict(
            boxstyle='round,pad=1.0',
            facecolor='#F0F8FF', # AliceBlue background
            edgecolor='#003366',
            linewidth=2,
            alpha=0.9
        )
    )
    
    # Add prepared by information with initialization line
    init_line = init_text or "Initialization unavailable"
    legend_text = (
        "Potential Area of Development\n"
        f"Initialization: {init_line}\n"
        "Prepared By: Philippine Typhoon/Weather"
    )
    plt.text(
        0.98, 0.02, legend_text,
        transform=ax.transAxes, fontsize=10, verticalalignment='bottom', horizontalalignment='right',
        bbox=dict(facecolor='white', alpha=0.8, edgecolor='black', boxstyle='round,pad=0.3')
    )
    

    
    # Add title
    ax.set_title("7-Day Tropical Weather Outlook - Western Pacific", fontsize=16, weight='bold')
    
    # Save the plot to a file
    try:
        init_time_str = init_times[0].replace(':', '').replace(' ', 'T') if len(init_times) > 0 else '20251029T0000'
        output_file = f"C:\\Users\\Russel\\Desktop\\Weather alert\\Potential\\cyclone_development_areas_{init_time_str}.png"
        plt.savefig(output_file, dpi=300, bbox_inches='tight')
        print(f"Plot saved to {output_file}")
    except Exception as e:
        print(f"Error saving plot: {str(e)}")
    
    plt.close()
    sys.exit(0)

# Cluster the points using DBSCAN to separate distinct regions
coords = np.column_stack((lons, lats))
db = DBSCAN(eps=4.0, min_samples=3).fit(coords)  # eps=3.5 degrees (approx 385km), tuned for better separation
labels = db.labels_

# Unique cluster labels (excluding noise -1)
unique_labels = sorted(set(labels) - {-1})  # Sorted for consistent ordering

print(f"Found {len(unique_labels)} clusters")

# Flag to track if KDE worked for any cluster
kde_success = False

# Collect per-area forecast summary lines for display on the map
forecast_summaries = []

for i, label in enumerate(unique_labels, start=1):
    # Get points in this cluster
    cluster_mask = (labels == label)
    cluster_lons = lons[cluster_mask]
    cluster_lats = lats[cluster_mask]
    cluster_genesis = genesis_data.iloc[cluster_mask]

    print(f"Processing cluster {label} with {len(cluster_lons)} points")

    if len(cluster_lons) < 1:
        print(f"Skipping cluster {label}: insufficient points")
        continue

    # Compute probabilities for this cluster
    samples_7day = cluster_genesis['sample'].unique()
    prob_7day = len(samples_7day) / num_samples * 100
    samples_2day = cluster_genesis[cluster_genesis['lead_time_hours'] <= 48]['sample'].unique()
    prob_2day = len(samples_2day) / num_samples * 100

    # Round to nearest 10%
    prob_2day_rounded = 10 * round(prob_2day / 10)
    prob_7day_rounded = 10 * round(prob_7day / 10)

    # Get categories
    cat_2day = get_category(prob_2day)
    cat_7day = get_category(prob_7day)

    # Compute ensemble mean center
    center_lon = np.mean(cluster_lons)
    center_lat = np.mean(cluster_lats)
    area_color = get_area_color(cat_7day)

    # Compute KDE for this cluster
    xy = np.vstack([cluster_lons, cluster_lats])
    kde, status = safe_gaussian_kde(xy, bandwidth_factor=1.2)
    
    if kde is None:
        print(f"KDE failed for cluster {label}: {status}")
        if len(cluster_lons) == 1:
            # Fixed circle for single point
            radius = 2.0
            patch = Circle((center_lon, center_lat), radius, facecolor=area_color, edgecolor='black', linewidth=2, alpha=0.6, transform=ccrs.PlateCarree())
            ax.add_patch(patch)
        continue

    kde_success = True
    print(f"KDE successful for cluster {label}: {status}")

    # Create grid for contouring
    lon_grid, lat_grid = np.mgrid[105:155:200j, 0:40:200j]
    positions = np.vstack([lon_grid.ravel(), lat_grid.ravel()])
    
    try:
        densities = kde.evaluate(positions)
        densities = densities.reshape(lon_grid.shape)

        # Normalize densities for this cluster
        densities_norm = densities / densities.max() if densities.max() > 0 else densities

        # Plot filled contours for this cluster
        cs = ax.contourf(
            lon_grid, lat_grid, densities_norm,
            levels=[0.1, 1.0], colors=[area_color], alpha=0.6,
            transform=ccrs.PlateCarree(), extend='max'
        )

        # Add contour lines for boundaries
        ax.contour(
            lon_grid, lat_grid, densities_norm,
            levels=[0.1], colors='black', linewidths=2.0, linestyles='solid',
            transform=ccrs.PlateCarree()
        )
    except Exception as e:
        print(f"Error plotting contours for cluster {label}: {e}")

    # Add NHC-style text for potentials near cluster center
    # Convert cluster center position to normalized axes coordinates (0-1)
    center_lat_text = center_lat + 2
    x_norm = (center_lon - 105.0) / (155.0 - 105.0)
    y_norm = (center_lat_text - 0.0) / (40.0 - 0.0)

    # Clamp inside the axes to keep the entire label off the outer frame
    x_norm = min(max(x_norm, 0.12), 0.88)
    y_norm = min(max(y_norm, 0.15), 0.90)

    # Use maximum genesis wind in this cluster to infer stage
    if 'maximum_sustained_wind_speed_knots' in cluster_genesis.columns:
        max_wind = cluster_genesis['maximum_sustained_wind_speed_knots'].max()
        stage = classify_tc_stage(max_wind)
    else:
        max_wind = float('nan')
        stage = 'Unknown'

    area_text = (
        f"Area {i}\n"
        f"48-Hour Potential: ({two_day_day}) {cat_2day} ({int(prob_2day_rounded)}%)\n"
        f"7-Day Potential: ({seven_day_day}) {cat_7day} ({int(prob_7day_rounded)}%)"
    )

    # Build a short natural-language summary line for this area (for map top text box)
    conf_word = {
        'low': 'Low',
        'medium': 'Moderate',
        'high': 'High',
    }.get(cat_7day, 'Unknown')
    if stage in ['Disturbance / LPA', 'Low Pressure Area']:
        system_wording = 'low pressure area / disturbance'
    else:
        system_wording = 'tropical cyclone'

    summary_line = (
        f"Area {i}: {conf_word} confidence of {system_wording} formation within 7 days "
        f"(Stage at genesis: {stage}, 7-day probability: {int(prob_7day_rounded)}%)"
    )
    forecast_summaries.append(summary_line)

    # Print a summary of this potential formation area to the terminal
    print(
        f"Area {i}: Possible tropical cyclone formation area | "
        f"Stage at genesis (max wind {max_wind:.1f} kt): {stage} | "
        f"2-day: ({two_day_day}) {cat_2day} ({int(prob_2day_rounded)}%), "
        f"7-day: ({seven_day_day}) {cat_7day} ({int(prob_7day_rounded)}%)"
    )
    ax.text(
        x_norm, y_norm, area_text,
        fontsize=9, ha='center', va='bottom',
        fontweight='bold',
        bbox=dict(facecolor='white', alpha=0.9, edgecolor='gray', boxstyle='round,pad=0.5'),
        transform=ax.transAxes,
        zorder=100
    )

# If no clusters plotted, perhaps add a message
if not kde_success:
    print("No clusters plotted")

# Create legend elements for categories
legend_elements = [
    patches.Patch(facecolor='yellow', edgecolor='black', label='Low (<40%)'),
    patches.Patch(facecolor='orange', edgecolor='black', label='Medium (40-60%)'),
    patches.Patch(facecolor='red', edgecolor='black', label='High (>60%)')
]

# Position the legend in the top-left corner
legend = ax.legend(
    handles=legend_elements, loc='upper left', bbox_to_anchor=(0.02, 0.98),
    frameon=True, fancybox=True, shadow=True, fontsize=10, title='Development Potential'
)
legend.get_frame().set_facecolor('white')
legend.get_frame().set_alpha(0.9)

# Update legend text with initialization line
init_line = init_text or "Initialization unavailable"
legend_text = (
    "Potential Area of Development\n"
    f"Initialization: {init_line}\n"
    "Prepared By: Philippine Typhoon/Weather"
)
plt.text(
    0.98, 0.02, legend_text,
    transform=ax.transAxes, fontsize=10, verticalalignment='bottom', horizontalalignment='right',
    bbox=dict(facecolor='white', alpha=0.8, edgecolor='black', boxstyle='round,pad=0.3')
)

# Add disclaimer
disclaimer = (
    "This is an experimental guidance product and should not be used for critical decision making\n"
    "Please do not treat this as an official forecast.\n"
    "Refer to PAGASA and other official meteorological agencies for official forecasts, warnings, and advisories."
)

ax.text(0.01, 0.01, disclaimer, transform=ax.transAxes, fontsize=9,
       ha='left', va='bottom', style='italic', color='black',
       bbox=dict(facecolor='yellow', alpha=0.9, edgecolor='black', linewidth=1.5))

# Fetch current positions from ATCF API (unchanged, for existing systems)
try:
    url = "https://api.knackwx.com/atcf/v2"
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json'
    })
    with urllib.request.urlopen(req) as response:
        atcf_data = json.loads(response.read().decode())
    # Plot markers for current systems in WPAC
    for system in atcf_data:
        lat = system.get('latitude')
        lon = system.get('longitude')
        pressure = system.get('pressure')
        storm_name = system.get('storm_name', '').upper()
        atcf_id = system.get('atcf_id', '')
        atcf_sector = system.get('atcf_sector_file', '')
        if lon is None or lat is None or pressure is None:
            continue
        if lon < 0 or 'WPAC' not in atcf_sector.upper():  # Skip non-WPAC
            continue
        if not (105 <= lon <= 155 and 0 <= lat <= 40):
            continue
        if storm_name == 'INVEST':
            label = f"LPA {atcf_id}"
        else:
            label = storm_name
        color = get_pressure_color(pressure)
        if color is None:
            continue
        # Plot larger marker with white outline for current position
        ax.plot(
            lon, lat,
            color='white',
            marker='X',
            markersize=14,
            markeredgewidth=0,
            transform=ccrs.PlateCarree()
        )
        ax.plot(
            lon, lat,
            color='black',
            marker='X',
            markersize=12,
            transform=ccrs.PlateCarree()
        )
        # Add label
        ax.text(
            lon + 0.5, lat + 0.5,
            label,
            fontsize=12,
            weight='bold',
            color='black',
            transform=ccrs.PlateCarree()
        )
except Exception as e:
    print(f"Error fetching or plotting ATCF data: {str(e)}")

# Add title
ax.set_title("7-Day Tropical Weather Outlook - Western Pacific", fontsize=16, weight='bold')

# Save the plot to a file
try:
    # Use relative path for GitHub Actions
    import os
    output_dir = "public/images"
    os.makedirs(output_dir, exist_ok=True)
    
    output_file = os.path.join(output_dir, "tropical_outlook_week1_latest.png")
    plt.savefig(output_file, dpi=300, bbox_inches='tight')
    print(f"Plot saved to {output_file}")
except Exception as e:
    print(f"Error saving plot: {str(e)}")

# Print summary
print(f"Summary: Density areas computed from {len(lons)} genesis points with {len(unique_labels)} clusters.")

plt.close()