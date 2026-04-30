import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
from matplotlib.colors import LinearSegmentedColormap
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
from shapely.geometry import MultiPoint, Polygon
from shapely.ops import unary_union
from matplotlib.patches import Polygon as MplPolygon

import requests
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

# Added: Get category (low/medium/high) based on probability
def get_category(prob):
    if prob < 40:
        return 'low'
    elif prob <= 60:
        return 'medium'
    else:
        return 'high'

import matplotlib.colors as mcolors
import numpy as np

# Added: Get area color based on exact probability with blending
def get_area_color(prob):
    yellow = np.array(mcolors.to_rgb('yellow'))
    orange = np.array(mcolors.to_rgb('orange'))
    red = np.array(mcolors.to_rgb('red'))
    
    if prob <= 30:
        c = yellow # Pure Low
    elif prob < 40:
        ratio = (prob - 30) / 10.0
        c = yellow * (1 - ratio) + orange * ratio # Blend Low to Medium
    elif prob <= 55:
        c = orange # Pure Medium
    elif prob < 65:
        ratio = (prob - 55) / 10.0
        c = orange * (1 - ratio) + red * ratio # Blend Medium to High
    else:
        c = red # Pure High
        
    return mcolors.to_hex(c)

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
    import os
    date_str, hour_str, latest_url = get_latest_run_url()
    csv_dir = os.path.join(os.path.dirname(__file__), "public", "data")
    os.makedirs(csv_dir, exist_ok=True)
    local_csv = os.path.join(csv_dir, f"FNV3_{date_str}T{hour_str}_00_cyclogenesis.csv")
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
    exit()
except pd.errors.ParserError:
    print("Error: Failed to parse CSV. Ensure the file is correctly formatted and contains the expected columns.")
    exit()
except Exception as e:
    print(f"Error loading CSV: {str(e)}")
    exit()

# DeepMind format change compatibility: convert timedelta string to hours
if 'lead_time' in data.columns and 'lead_time_hours' not in data.columns:
    data['lead_time_hours'] = pd.to_timedelta(data['lead_time']).dt.total_seconds() / 3600.0

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
    exit()

# Use all data up to 7 days (168 hours); adjust if data exceeds
wp_data = data[
    (data['lead_time_hours'] <= 168)
    & (data['maximum_sustained_wind_speed_knots'] >= MIN_GENESIS_WIND_KT)
].copy()

# Get total number of unique samples (ensembles) from the raw data
num_samples = len(data[data['lead_time_hours'] <= 168]['sample'].unique())
if num_samples == 0:
    print("Warning: No samples found in the data. Proceeding to generate 'no formation' map.")
    num_samples = 1  # Prevent division by zero later

# Check if any data remains meeting the criteria
if wp_data.empty:
    print("No valid storm tracks found in the data. Proceeding to generate 'no formation' map.")
    all_track_ids = []
    genesis_data = pd.DataFrame(columns=required_columns)
    init_times = [latest_utc.strftime("%Y-%m-%d %H:%M:%S")]
else:
    # Get all unique track IDs, filter to potential (numerical) tracks only
    all_track_ids = [tid for tid in wp_data['track_id'].unique() if str(tid).isdigit()]
    all_track_ids = sorted(all_track_ids, key=int)  # Sort numerically
    print(f"Processing potential track IDs: {all_track_ids}")
    
    # Ensure data is sorted by init_time, track_id, sample, and lead_time_hours
    wp_data = wp_data.sort_values(by=['init_time', 'track_id', 'sample', 'lead_time_hours'])
    
    # Extract genesis points (earliest lead_time per init_time, track_id, sample)
    genesis_data = wp_data.loc[wp_data.groupby(['init_time', 'track_id', 'sample'])['lead_time_hours'].idxmin()]
    
    # Filter genesis_data to potential tracks only
    genesis_data = genesis_data[genesis_data['track_id'].isin(all_track_ids)]
    
    # Identify unique initialization times
    init_times = wp_data['init_time'].unique()

if len(init_times) == 0:
    init_times = [latest_utc.strftime("%Y-%m-%d %H:%M:%S")]

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
ax.add_feature(cfeature.COASTLINE, edgecolor='white', alpha=0.7, linewidth=1.0)
ax.add_feature(cfeature.BORDERS, edgecolor='white', alpha=0.5, linestyle=':', linewidth=0.8)

# Add gridlines with emphasized labels at 5° intervals
gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='white', alpha=0.3, linestyle='--')
gl.xlocator = plt.FixedLocator(np.arange(105, 156, 5))
gl.ylocator = plt.FixedLocator(np.arange(0, 41, 5))
gl.xlabel_style = {'size': 11, 'weight': 'bold', 'color': 'white'}
gl.ylabel_style = {'size': 11, 'weight': 'bold', 'color': 'white'}
gl.top_labels = False
gl.right_labels = False

# Add Philippine Area of Responsibility (PAR) boundary
par_vertices = [
    (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
    (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
]
par_path = Path(par_vertices)
# Use a glowing cyan color for better visibility against dark ocean background
par_patch = PathPatch(par_path, edgecolor='#00E5FF', linestyle='-', linewidth=2.0, facecolor='none', alpha=0.8, transform=ccrs.PlateCarree())
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

has_active_tc = False
active_wp_ids = [tid for tid in wp_data['track_id'].unique() if str(tid).startswith('WP')]
if active_wp_ids:
    print(f"Found active FNV3 tracks: {active_wp_ids}")
    for tid in active_wp_ids:
        # Filter track points within window
        tc_pts_raw = wp_data[(wp_data['track_id'] == tid) & (wp_data['lead_time_hours'] <= 168)]
        if tc_pts_raw.empty:
            continue
            
        # Get coordinates within map extent
        mask = (tc_pts_raw['lon'] >= 105) & (tc_pts_raw['lon'] <= 155) & (tc_pts_raw['lat'] >= 0) & (tc_pts_raw['lat'] <= 40)
        tc_pts = tc_pts_raw[mask]
        
        if not tc_pts.empty:
            has_active_tc = True
            area_color = '#d811ad'
            line_style = '-'
            center_lon = tc_pts['lon'].mean()
            center_lat = tc_pts['lat'].mean()
            
            # Create a time-varying cone using ensemble spread
            lead_times = sorted(tc_pts['lead_time_hours'].unique())
            hour_polygons = {}
            
            for lt in lead_times:
                pts = tc_pts[tc_pts['lead_time_hours'] == lt]
                points = np.column_stack((pts['lon'].values, pts['lat'].values))
                if len(points) == 1:
                    hour_polygons[lt] = MultiPoint(points).buffer(0.5)
                else:
                    hour_polygons[lt] = MultiPoint(points).convex_hull.buffer(0.8, join_style='round')

            if len(lead_times) > 1:
                segments = []
                for idx in range(len(lead_times)-1):
                    poly1 = hour_polygons[lead_times[idx]]
                    poly2 = hour_polygons[lead_times[idx+1]]
                    segment = unary_union([poly1, poly2]).convex_hull
                    segments.append(segment)
                buffered_geom = unary_union(segments)
            else:
                buffered_geom = hour_polygons[lead_times[0]]

            # Plot the cone geometry
            if buffered_geom.geom_type == 'Polygon':
                ext_coords = list(buffered_geom.exterior.coords)
                patch = MplPolygon(ext_coords, facecolor=area_color, edgecolor='none', alpha=0.4, transform=ccrs.PlateCarree(), zorder=50)
                ax.add_patch(patch)
                outline_patch = MplPolygon(ext_coords, fill=False, edgecolor=area_color, linewidth=2.5, linestyle=line_style, transform=ccrs.PlateCarree(), zorder=51)
                ax.add_patch(outline_patch)
            elif buffered_geom.geom_type == 'MultiPolygon':
                for poly in buffered_geom.geoms:
                    ext_coords = list(poly.exterior.coords)
                    patch = MplPolygon(ext_coords, facecolor=area_color, edgecolor='none', alpha=0.4, transform=ccrs.PlateCarree(), zorder=50)
                    ax.add_patch(patch)
                    outline_patch = MplPolygon(ext_coords, fill=False, edgecolor=area_color, linewidth=2.5, linestyle=line_style, transform=ccrs.PlateCarree(), zorder=51)
                    ax.add_patch(outline_patch)
            else:
                patch = Circle((center_lon, center_lat), radius=2.5, facecolor=area_color, lw=0, alpha=0.4, transform=ccrs.PlateCarree(), zorder=50)
                ax.add_patch(patch)

            y_label_pos = center_lat + 4.5
            x_norm = (center_lon - 105.0) / (155.0 - 105.0)
            y_norm = (y_label_pos - 0.0) / (40.0 - 0.0)
            x_norm = min(max(x_norm, 0.12), 0.88)
            y_norm = min(max(y_norm, 0.15), 0.90)
            
            label_title = "Active Tropical Cyclone Area"
            ax.text(x_norm, y_norm, f"{label_title}", fontsize=9, ha='center', va='bottom',
                    fontweight='bold', color='white', 
                    bbox=dict(facecolor='#1c1e22', alpha=0.85, edgecolor=area_color, linewidth=1.5, boxstyle='round,pad=0.6'), 
                    transform=ax.transAxes, zorder=100)


if len(lons) < 2:
    print("Insufficient points for density estimation. Creating visualization with no formation message.")
    
    if not has_active_tc:
        # Add central message box with end date
        end_date_str = (init_ph + timedelta(days=7)).strftime("%m/%d/%Y")
        message_text = f"NO TROPICAL CYCLONE\nFORMATION EXPECTED\n\nUNTIL {end_date_str}"
        ax.text(0.5, 0.5, message_text, transform=ax.transAxes, fontsize=22, weight='heavy', ha='center', va='center', color='white', 
                bbox=dict(boxstyle='round,pad=1.2', facecolor='#1c1e22', edgecolor='#00E5FF', linewidth=2, alpha=0.9))
    
    # Add prepared by information with initialization line
    init_line = init_text or "Initialization unavailable"
    legend_text = (
        "Potential Area of Development\n"
        f"Initialization: {init_line}\n"
        "Prepared By: Philippine Typhoon/Weather"
    )
    ax.text(
        0.98, 0.02, legend_text,
        transform=ax.transAxes, fontsize=10, verticalalignment='bottom', horizontalalignment='right',
        color='white', weight='bold',
        bbox=dict(facecolor='#1c1e22', alpha=0.85, edgecolor='gray', boxstyle='round,pad=0.5')
    )
    

    
    # Add disclaimer
    disclaimer = (
        "WARNING: EXPERIMENTAL GUIDANCE PRODUCT\n"
        "Should not be used for critical decision making. This is not an official forecast.\n"
        "Refer to PAGASA and official meteorological agencies for official warnings and advisories."
    )
    ax.text(0.01, 0.01, disclaimer, transform=ax.transAxes, fontsize=9, ha='left', va='bottom', weight='bold', color='#FFD700', bbox=dict(facecolor='#111111', alpha=0.85, edgecolor='none', boxstyle='round,pad=0.5'))

    # Add title banner
    ax.set_title("7-Day Tropical Weather Outlook - Western Pacific", fontsize=18, weight='heavy', pad=15,
                 color='white', bbox=dict(facecolor='#001f3f', edgecolor='none', alpha=0.9, pad=10, boxstyle='square,pad=0.4'))
    fig.patch.set_facecolor('#111111') # Set figure background
    # Save the plot to a file
    try:
        import os
        output_dir = os.path.join(os.path.dirname(__file__), "public", "images")
        os.makedirs(output_dir, exist_ok=True)
        output_file = os.path.join(output_dir, "tropical_outlook_week1_latest.png")
        plt.savefig(output_file, dpi=300, bbox_inches='tight')
        print(f"Plot saved to {output_file}")
    except Exception as e:
        print(f"Error saving plot: {str(e)}")
    
    plt.close()
    exit()

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
    area_color = get_area_color(prob_7day)

    # Create smooth polygon blob around the cluster points
    points = np.column_stack((cluster_lons, cluster_lats))
    if len(points) == 1:
        # Single point, just a circle
        patch = Circle((center_lon, center_lat), radius=2.5, facecolor=area_color, lw=0, alpha=0.4, transform=ccrs.PlateCarree(), zorder=50)
        ax.add_patch(patch)
        outline_patch = Circle((center_lon, center_lat), radius=2.5, facecolor='none', edgecolor=area_color, linewidth=2.5, linestyle='--', transform=ccrs.PlateCarree(), zorder=51)
        ax.add_patch(outline_patch)
        kde_success = True
    else:
        try:
            # Use shapely to create a convex hull and buffer it for beautifully rounded edges (NHC style)
            geom = MultiPoint(points).convex_hull
            # Add a 2.5-degree padding (approx 275km) around the outermost points
            buffered_geom = geom.buffer(2.5, join_style='round')
            
            # If it's a valid polygon, extract outer coords
            if buffered_geom.geom_type == 'Polygon':
                ext_coords = list(buffered_geom.exterior.coords)
                patch = MplPolygon(ext_coords, facecolor=area_color, edgecolor='none', alpha=0.4, transform=ccrs.PlateCarree(), zorder=50)
                ax.add_patch(patch)
                # Add crisp dashed outline
                outline_patch = MplPolygon(ext_coords, fill=False, edgecolor=area_color, linewidth=2.5, linestyle='--', transform=ccrs.PlateCarree(), zorder=51)
                ax.add_patch(outline_patch)
                kde_success = True
            elif buffered_geom.geom_type == 'MultiPolygon':
                for poly in buffered_geom.geoms:
                    ext_coords = list(poly.exterior.coords)
                    patch = MplPolygon(ext_coords, facecolor=area_color, edgecolor='none', alpha=0.4, transform=ccrs.PlateCarree(), zorder=50)
                    ax.add_patch(patch)
                    outline_patch = MplPolygon(ext_coords, fill=False, edgecolor=area_color, linewidth=2.5, linestyle='--', transform=ccrs.PlateCarree(), zorder=51)
                    ax.add_patch(outline_patch)
                kde_success = True
        except Exception as e:
            print(f"Error plotting buffer blob for cluster {label}: {e}")
            patch = Circle((center_lon, center_lat), radius=2.5, facecolor=area_color, edgecolor='none', alpha=0.4, transform=ccrs.PlateCarree(), zorder=50)
            ax.add_patch(patch)

    # Add NHC-style text for potentials near cluster center
    # Convert cluster center position to normalized axes coordinates (0-1)
    # Give a larger vertical offset (+4.5 degrees) so the box doesn't overlap the glowing contours
    center_lat_text = center_lat + 4.5
    x_norm = (center_lon - 105.0) / (155.0 - 105.0)
    y_norm = (center_lat_text - 0.0) / (40.0 - 0.0)

    # Clamp inside the axes to keep the entire label off the outer frame
    x_norm = min(max(x_norm, 0.12), 0.88)
    y_norm = min(max(y_norm, 0.15), 0.90)

    # Use average genesis wind in this cluster to infer stage
    if 'maximum_sustained_wind_speed_knots' in cluster_genesis.columns:
        mean_wind = cluster_genesis['maximum_sustained_wind_speed_knots'].mean()
        stage = classify_tc_stage(mean_wind)
    else:
        mean_wind = float('nan')
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
        f"Stage at genesis (avg wind {mean_wind:.1f} kt): {stage} | "
        f"2-day: ({two_day_day}) {cat_2day} ({int(prob_2day_rounded)}%), "
        f"7-day: ({seven_day_day}) {cat_7day} ({int(prob_7day_rounded)}%)"
    )
    ax.text(
        x_norm, y_norm, area_text,
        fontsize=9, ha='center', va='bottom',
        fontweight='bold', color='white',
        bbox=dict(facecolor='#1c1e22', alpha=0.85, edgecolor=area_color, linewidth=1.5, boxstyle='round,pad=0.6'),
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
# Make the legend look more premium with a dark background and white text
legend.get_title().set_color('white')
legend.get_title().set_weight('bold')
for text in legend.get_texts():
    text.set_color('white')
legend.get_frame().set_facecolor('#1c1e22')
legend.get_frame().set_edgecolor('gray')
legend.get_frame().set_alpha(0.85)

# Update legend text with initialization line
init_line = init_text or "Initialization unavailable"
legend_text = (
    "Potential Area of Development\n"
    f"Initialization: {init_line}\n"
    "Prepared By: Philippine Typhoon/Weather"
)
ax.text(
    0.98, 0.02, legend_text,
    transform=ax.transAxes, fontsize=10, verticalalignment='bottom', horizontalalignment='right',
    color='white', weight='bold',
    bbox=dict(facecolor='#1c1e22', alpha=0.85, edgecolor='gray', boxstyle='round,pad=0.5')
)

# Add disclaimer
disclaimer = (
    "WARNING: EXPERIMENTAL GUIDANCE PRODUCT\n"
    "Should not be used for critical decision making. This is not an official forecast.\n"
    "Refer to PAGASA and official meteorological agencies for official warnings and advisories."
)

ax.text(0.01, 0.01, disclaimer, transform=ax.transAxes, fontsize=9,
       ha='left', va='bottom', weight='bold', color='#FFD700',
       bbox=dict(facecolor='#111111', alpha=0.85, edgecolor='none', boxstyle='round,pad=0.5'))


# Add title banner
ax.set_title("7-Day Tropical Weather Outlook - Western Pacific", fontsize=18, weight='heavy', pad=15,
             color='white', bbox=dict(facecolor='#001f3f', edgecolor='none', alpha=0.9, pad=10, boxstyle='square,pad=0.4'))
fig.patch.set_facecolor('#111111') # Set figure background

# Save the plot to a file
try:
    import os
    output_dir = os.path.join(os.path.dirname(__file__), "public", "images")
    os.makedirs(output_dir, exist_ok=True)
    output_file = os.path.join(output_dir, "tropical_outlook_week1_latest.png")
    plt.savefig(output_file, dpi=300, bbox_inches='tight')
    print(f"Plot saved to {output_file}")
except Exception as e:
    print(f"Error saving plot: {str(e)}")

# Print summary
print(f"Summary: Density areas computed from {len(lons)} genesis points with {len(unique_labels)} clusters.")

plt.close()