import os
import json
import base64
from shapely.geometry import shape
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

def get_latest_run_datetime():
    models = ["FNV3P2", "FNV3P1", "OPER"]
    today = datetime.now(timezone.utc).date()
    dates = [today, today - timedelta(days=1), today - timedelta(days=2), today - timedelta(days=3)]
    hours_desc = ["18", "12", "06", "00"]

    for d in dates:
        date_str = d.strftime("%Y_%m_%d")
        for h in hours_desc:
            for model in models:
                url = f"https://deepmind.google.com/science/weatherlab/download/cyclones/{model}/ensemble/cyclogenesis/csv/{model}_{date_str}T{h}_00_cyclogenesis.csv"
                try:
                    resp = requests.head(url, allow_redirects=True, timeout=10)
                    if resp.status_code == 200:
                        print(f"Latest available run found: {model} {date_str}T{h}:00")
                        return date_str, h
                except requests.RequestException:
                    continue

    raise RuntimeError("No available cyclogenesis runs found in the last 4 days.")

def obfuscate_and_save(input_path, output_path):
    XOR_KEY = 0xAA
    try:
        with open(input_path, 'rb') as f:
            content_bytes = f.read()
        xored = bytearray([b ^ XOR_KEY for b in content_bytes])
        b64 = base64.b64encode(xored).decode('utf-8')
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(b64)
        print(f"Obfuscated and saved to: {output_path}")
    except Exception as e:
        print(f"Error obfuscating {input_path}: {e}")

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

def process_and_plot(model, latest_url, date_str, hour_str, is_base_model):
    plotted_tracks = 0
    skipped_tracks = 0
    skipped_details = []

    import os
    import shutil
    os.makedirs("temp_data", exist_ok=True)
    local_csv = f"temp_data/{model}_{date_str}T{hour_str}_00_cyclogenesis.csv"
    print(f"Downloading latest run for {model} with curl to: {local_csv}")
    try:
        subprocess.run([
            "curl",
            "-L",
            "-o",
            local_csv,
            latest_url,
        ], check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error: curl failed to download CSV for {model}: {e}")
        return

    try:
        data = pd.read_csv(local_csv, comment="#")
        data.columns = data.columns.str.strip()
        if 'lead_time' in data.columns and 'lead_time_hours' not in data.columns:
            data['lead_time_hours'] = pd.to_timedelta(data['lead_time']).dt.total_seconds() / 3600
    except Exception as e:
        print(f"Error loading CSV for {model}: {e}")
        return

    # Validate required columns
    required_columns = ['init_time', 'track_id', 'sample', 'lead_time_hours', 'lat', 'lon', 'minimum_sea_level_pressure_hpa']
    missing_columns = [col for col in required_columns if col not in data.columns]
    if missing_columns:
        print(f"Error: Missing required columns in CSV for {model}: {missing_columns}")
        return

    # Copy model-specific CSV and DAT to public/data/
    os.makedirs("public/data", exist_ok=True)
    model_lower = model.lower()
    
    # Save cyclogenesis CSV and DAT
    shutil.copy(local_csv, f"public/data/{model_lower}_latest.csv")
    obfuscate_and_save(local_csv, f"public/data/{model_lower}_latest.dat")
    print(f"Saved model-specific latest CSV and DAT for {model}")

    # Download corresponding paired CSV
    paired_url = latest_url.replace("/ensemble/cyclogenesis/csv/", "/ensemble_mean/paired/csv/").replace("_cyclogenesis.csv", "_paired.csv")
    paired_local_csv = f"temp_data/{model}_{date_str}T{hour_str}_00_paired.csv"
    print(f"Downloading paired run for {model} with curl to: {paired_local_csv}")
    try:
        subprocess.run([
            "curl",
            "-L",
            "-o",
            paired_local_csv,
            paired_url,
        ], check=True)
        # Save paired CSV and DAT
        shutil.copy(paired_local_csv, f"public/data/{model_lower}_paired_latest.csv")
        obfuscate_and_save(paired_local_csv, f"public/data/{model_lower}_paired_latest.dat")
        print(f"Saved model-specific paired latest CSV and DAT for {model}")
    except Exception as e:
        print(f"Warning: Failed to download paired CSV for {model} from {paired_url}: {e}")
        paired_local_csv = None

    # Filter for 15-day forecast (lead_time_hours <= 360)
    wp_data = data[data['lead_time_hours'] <= 360].copy()

    # Get all unique track IDs
    all_track_ids = sorted(wp_data['track_id'].unique())
    print(f"Processing all track IDs for {model}: {all_track_ids}")

    # Check if any data remains
    if wp_data.empty:
        print(f"Warning: No data found in the CSV file for {model} for lead_time_hours <= 360.")
        return

    # Ensure data is sorted by init_time, track_id, sample, and lead_time_hours
    wp_data = wp_data.sort_values(by=['init_time', 'track_id', 'sample', 'lead_time_hours'])

    # Identify unique initialization times
    init_times = wp_data['init_time'].unique()
    if len(init_times) == 0:
        print(f"Warning: No valid init_time values found in the data for {model}.")
        return

    latest_utc = datetime.strptime(f"{date_str} {hour_str}", "%Y_%m_%d %H").replace(tzinfo=timezone.utc)
    ph_zone = timezone(timedelta(hours=8))
    latest_ph = latest_utc.astimezone(ph_zone)

    time_label = latest_ph.strftime("%I:%M %p").lstrip("0")

    latest_runtime_text = f"{time_label} PHT, {latest_ph.strftime('%B %d, %Y')}"
    forecast_start_date_text = latest_ph.strftime("%Y-%m-%d")
    forecast_end_date_text = (latest_ph + timedelta(days=15)).strftime("%Y-%m-%d")

    # Set up the figure and map projection
    fig = plt.figure(figsize=(12, 12))
    ax = plt.axes(projection=ccrs.PlateCarree())
    ax.set_extent([105, 155, 0, 40], crs=ccrs.PlateCarree())

    # Add land, ocean, and coastlines
    ax.set_facecolor('#87CEEB')
    ax.add_feature(cfeature.LAND, facecolor='#DEB887', edgecolor='#8B4513', linewidth=0.8)
    ax.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.8, alpha=0.7, color='#654321')

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
            ax.add_geometries(province_shapely_geometries, crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#654321', linewidth=0.4, alpha=0.5, zorder=3)
    except Exception as province_load_error:
        print(f"Warning: Failed to overlay province boundaries: {province_load_error}")

    # Add gridlines
    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
    gl.xlocator = plt.FixedLocator(np.arange(105, 156, 5))
    gl.ylocator = plt.FixedLocator(np.arange(0, 41, 5))
    gl.xlabel_style = {'size': 12, 'weight': 'bold'}
    gl.ylabel_style = {'size': 12, 'weight': 'bold'}
    gl.top_labels = False
    gl.right_labels = False

    ax.text(
        118, 13, 'West Philippine\nSea', fontsize=5, color='navy', weight='bold',
        transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5
    )
    ax.text(
        130, 20, 'Philippine\nSea', fontsize=9, color='navy', weight='bold',
        transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5
    )

    # Add Philippine Area of Responsibility (PAR) boundary
    par_vertices = [
        (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
        (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
    ]
    ax.add_patch(mpatches.Polygon(par_vertices, facecolor='none', edgecolor='#FF6B35', 
                                 linestyle='-', linewidth=3, alpha=0.8, 
                                 transform=ccrs.PlateCarree()))

    # Plot tracks for each init_time, track_id, and sample
    for init_time in init_times:
        init_data = wp_data[wp_data['init_time'] == init_time]
        if init_data.empty:
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
                    skipped_tracks += 1
                    skipped_details.append(f"track_id {track_id}, sample {sample}, init_time {init_time}")
                    continue
                lon_diffs = np.abs(np.diff(lons))
                lat_diffs = np.abs(np.diff(lats))
                if np.any(lon_diffs > 10) or np.any(lat_diffs > 10):
                    skipped_tracks += 1
                    skipped_details.append(f"track_id {track_id}, sample {sample}, init_time {init_time}")
                    continue
                # Plot gray lines for segments
                ax.plot(
                    lons, lats,
                    color='#404040',
                    linewidth=2.5,
                    alpha=0.7,
                    transform=ccrs.PlateCarree()
                )
                # Plot donut markers at each point
                for i in range(len(lons)):
                    color = get_pressure_color(pressures[i])
                    if color is None:
                        continue
                    # Shadow
                    ax.plot(lons[i], lats[i], color='black', marker='o', markersize=8,
                            markeredgewidth=0, alpha=0.2, transform=ccrs.PlateCarree())
                    # Colored donut ring (transparent center)
                    ax.plot(lons[i], lats[i], markerfacecolor='none', markeredgecolor=color,
                            marker='o', markersize=5, markeredgewidth=1.5,
                            transform=ccrs.PlateCarree())
                plotted_tracks += 1

    # Plot paired (ensemble mean) tracks if available
    if paired_local_csv and os.path.exists(paired_local_csv):
        try:
            p_data = pd.read_csv(paired_local_csv, comment="#")
            p_data.columns = p_data.columns.str.strip()
            if 'lead_time' in p_data.columns and 'lead_time_hours' not in p_data.columns:
                p_data['lead_time_hours'] = pd.to_timedelta(p_data['lead_time']).dt.total_seconds() / 3600
            p_data = p_data[p_data['lead_time_hours'] <= 360].copy()
            
            p_data = p_data.sort_values(by=['init_time', 'track_id', 'lead_time_hours'])
            for p_track_id in p_data['track_id'].unique():
                p_track = p_data[p_data['track_id'] == p_track_id]
                p_track = p_track[(p_track['lon'] >= 105) & (p_track['lon'] <= 155) & (p_track['lat'] >= 0) & (p_track['lat'] <= 40)]
                p_lons = p_track['lon'].values
                p_lats = p_track['lat'].values
                p_lons = np.where(p_lons > 180, p_lons - 360, p_lons)
                
                if len(p_lons) >= 2:
                    ax.plot(p_lons, p_lats, color='white', linewidth=5.0, zorder=4, transform=ccrs.PlateCarree())
                    ax.plot(p_lons, p_lats, color='#111111', linewidth=3.0, zorder=5, transform=ccrs.PlateCarree())
                    ax.plot(p_lons, p_lats, color='#111111', marker='o', markersize=4, linestyle='None', zorder=6, transform=ccrs.PlateCarree())
                    print(f"Plotted paired (ensemble mean) track for {p_track_id}")
        except Exception as e:
            print(f"Warning: Failed to plot paired tracks for {model}: {e}")

    # Define pressure ranges with custom colors (only pressure ranges, no category labels)
    pressure_ranges = [
        {'pressure_range': '< 920 hPa', 'color': '#FF007F'},
        {'pressure_range': '920–945 hPa', 'color': '#A83232'},
        {'pressure_range': '945–970 hPa', 'color': '#E67E22'},
        {'pressure_range': '970–990 hPa', 'color': '#F1C40F'},
        {'pressure_range': '990–1005 hPa', 'color': '#2ECC71'},
        {'pressure_range': '> 1005 hPa', 'color': '#3498DB'}
    ]

    # Create legend elements with only pressure ranges (Ensemble Mean Track removed as requested)
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

    model_display = {
        "FNV3P2": "GDM WNCP2",
        "FNV3P1": "GDM WNCP1",
        "OPER": "GDM OPER"
    }.get(model, model)

    # Add small legend with forecast info
    legend_text = (
        f"Runtime: {latest_runtime_text}\n"
        f"Model: {model_display}\n"
        "Processed By: Philippine Typhoon/Weather"
    )
    plt.text(
        0.98, 0.02, legend_text,
        transform=ax.transAxes, fontsize=10, verticalalignment='bottom', horizontalalignment='right'
    )

    # Add title
    start_date = forecast_start_date_text or "Start"
    end_date = forecast_end_date_text or "End"
    ax.set_title(f"{model_display} 50 Ensemble 15-Day Forecast Tropical Cyclone Tracks\nWestern Pacific ({start_date} to {end_date})", fontsize=14, weight='bold')

    # Save the plot
    try:
        init_time_str = init_times[0].replace(':', '').replace(' ', 'T') if len(init_times) > 0 else '20250621T1200'
        output_dir = "public/assets"
        os.makedirs(output_dir, exist_ok=True)
        
        # Save model-specific plot
        output_file_model = f"{output_dir}/tropical_cyclone_15day_forecast_{model}_{init_time_str}.png"
        plt.savefig(output_file_model, dpi=300, bbox_inches='tight')
        print(f"Saved model-specific plot to {output_file_model}")

    except Exception as e:
        print(f"Error saving plot for {model}: {str(e)}")

    print(f"Summary for {model}: {plotted_tracks} tracks plotted, {skipped_tracks} tracks skipped.")
    plt.close()

def main():
    try:
        date_str, hour_str = get_latest_run_datetime()
    except Exception as e:
        print(f"Error finding latest run: {e}")
        exit()

    models = ["FNV3P2", "FNV3P1", "OPER"]
    base_model_candidates = [m for m in models if m != "OPER"]

    found_models = []
    base_model_identified = None

    for model in models:
        url = f"https://deepmind.google.com/science/weatherlab/download/cyclones/{model}/ensemble/cyclogenesis/csv/{model}_{date_str}T{hour_str}_00_cyclogenesis.csv"
        try:
            resp = requests.head(url, allow_redirects=True, timeout=10)
            if resp.status_code == 200:
                found_models.append((model, url))
                if model in base_model_candidates and base_model_identified is None:
                    base_model_identified = model
        except requests.RequestException:
            continue

    if not found_models:
        print(f"Error: No model datasets found for cycle {date_str}T{hour_str}:00")
        exit()

    print(f"Models found with data for cycle {date_str}T{hour_str}:00: {[m[0] for m in found_models]}")
    print(f"Identified primary base model: {base_model_identified}")

    for model, url in found_models:
        is_base = (model == base_model_identified)
        process_and_plot(model, url, date_str, hour_str, is_base)

if __name__ == "__main__":
    main()