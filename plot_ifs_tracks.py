import os
import json
from shapely.geometry import shape
import os
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import pandas as pd
import numpy as np
from matplotlib.path import Path
from matplotlib.patches import PathPatch
import matplotlib.patches as mpatches
from datetime import datetime, timedelta, timezone

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

def generate_plot(data, max_lead_time, output_file, title, runtime_text):
    plotted_tracks = 0
    skipped_tracks = 0

    wp_data = data[data['lead_time_hours'] <= max_lead_time].copy()
    if wp_data.empty:
        print(f"No data for max lead time {max_lead_time}")
        return

    all_track_ids = sorted(wp_data['track_id'].unique())
    wp_data = wp_data.sort_values(by=['init_time', 'track_id', 'sample', 'lead_time_hours'])
    init_times = wp_data['init_time'].unique()

    fig = plt.figure(figsize=(14, 11), facecolor='#87CEEB')
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

    for init_time in init_times:
        init_data = wp_data[wp_data['init_time'] == init_time]
        for track_id in all_track_ids:
            track_data = init_data[init_data['track_id'] == track_id]
            for sample in track_data['sample'].unique():
                sample_data = track_data[track_data['sample'] == sample]
                sample_data = sample_data[(sample_data['lon'] >= 105) & (sample_data['lon'] <= 155) & (sample_data['lat'] >= 0) & (sample_data['lat'] <= 40)]
                if sample_data.empty: continue
                lons = sample_data['lon'].values
                lats = sample_data['lat'].values
                pressures = sample_data['minimum_sea_level_pressure_hpa'].values
                lons = np.where(lons > 180, lons - 360, lons)

                if len(lons) < 2 or np.any(np.isnan(lons)) or np.any(np.isnan(lats)):
                    skipped_tracks += 1
                    continue
                lon_diffs = np.abs(np.diff(lons))
                lat_diffs = np.abs(np.diff(lats))
                if np.any(lon_diffs > 10) or np.any(lat_diffs > 10):
                    skipped_tracks += 1
                    continue

                ax.plot(lons, lats, color='#1a1a1a', linewidth=2.0, alpha=0.55, transform=ccrs.PlateCarree())
                for i in range(len(lons)):
                    color = get_pressure_color(pressures[i])
                    if color is None: continue
                    # Shadow
                    ax.plot(lons[i], lats[i], color='black', marker='o', markersize=8,
                            markeredgewidth=0, alpha=0.2, transform=ccrs.PlateCarree(), zorder=4)
                    # Colored donut ring (transparent center)
                    ax.plot(lons[i], lats[i], markerfacecolor='none', markeredgecolor=color,
                            marker='o', markersize=5, markeredgewidth=1.5,
                            transform=ccrs.PlateCarree(), zorder=5)
                plotted_tracks += 1

    pressure_ranges = [
        {'pressure_range': '< 920 hPa', 'color': '#FF007F'},
        {'pressure_range': '920–945 hPa', 'color': '#A83232'},
        {'pressure_range': '945–970 hPa', 'color': '#E67E22'},
        {'pressure_range': '970–990 hPa', 'color': '#F1C40F'},
        {'pressure_range': '990–1005 hPa', 'color': '#2ECC71'},
        {'pressure_range': '> 1005 hPa', 'color': '#3498DB'}
    ]
    legend_elements = [
        plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='none',
                   markeredgecolor=r['color'], markeredgewidth=2, markersize=8, label=r['pressure_range'])
        for r in pressure_ranges
    ]
    legend = ax.legend(handles=legend_elements, loc='upper left', bbox_to_anchor=(0.02, 0.98), frameon=False, fontsize=10)

    legend_text = f"Runtime: {runtime_text}\nProcessed By: Philippine Typhoon/Weather"
    plt.text(0.98, 0.02, legend_text, transform=ax.transAxes, fontsize=10, verticalalignment='bottom', horizontalalignment='right')
    
    ax.set_title(title, fontsize=16, weight='bold')

    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    plt.savefig(output_file, dpi=300, bbox_inches='tight', facecolor=fig.get_facecolor(), edgecolor='none')
    print(f"Plot saved to {output_file} ({plotted_tracks} plotted, {skipped_tracks} skipped)")
    plt.close()

if __name__ == "__main__":
    import io
    import base64
    
    csv_file = "public/data/ifs_tc_latest.csv"
    dat_file = "public/data/ifs_tc_latest.dat"
    
    if os.path.exists(csv_file):
        data = pd.read_csv(csv_file)
    elif os.path.exists(dat_file):
        with open(dat_file, 'r', encoding='utf-8') as f:
            b64_str = f.read()
        xored = base64.b64decode(b64_str)
        csv_bytes = bytearray([b ^ 0xAA for b in xored])
        csv_text = csv_bytes.decode('utf-8')
        data = pd.read_csv(io.StringIO(csv_text))
    else:
        print(f"File not found: {csv_file} or {dat_file}")
        exit()

    if data.empty:
        print("Data is empty.")
        exit()

    init_times = sorted(data['init_time'].unique())
    if not init_times:
        print("No init_time found.")
        exit()

    latest_init = init_times[-1]
    # init_time is something like '2026-05-14 06:00:00'
    dt = datetime.strptime(latest_init, "%Y-%m-%d %H:%M:%S")
    init_time_str = dt.strftime("%Y-%m-%dT%H%M%S") # 2026-05-14T060000

    latest_utc = dt.replace(tzinfo=timezone.utc)
    ph_zone = timezone(timedelta(hours=8))
    latest_ph = latest_utc.astimezone(ph_zone)
    time_label = latest_ph.strftime("%I:%M %p").lstrip("0")
    runtime_text = f"{time_label} PHT, {latest_ph.strftime('%B %d, %Y')}"

    forecast_start = latest_ph.strftime("%Y-%m-%d")

    max_hours_in_data = int(data['lead_time_hours'].max()) if not data.empty and 'lead_time_hours' in data else 0

    # 5-day plot (max 120h)
    actual_5day_hours = min(120, max_hours_in_data) if max_hours_in_data > 0 else 120
    actual_5day_days = actual_5day_hours / 24
    days_5day_str = f"{int(actual_5day_days)}" if actual_5day_hours % 24 == 0 else f"{actual_5day_days:.3g}"
    
    end_5day = (latest_ph + timedelta(hours=actual_5day_hours)).strftime("%Y-%m-%d")
    title_5day = f"{days_5day_str}-Day Forecast Tropical Cyclone Tracks - ECMWF IFS ({forecast_start} to {end_5day})"
    out_5day = f"public/assets/ifs_tropical_cyclone_5day_forecast_{init_time_str}.png"
    generate_plot(data, 120, out_5day, title_5day, runtime_text)

    # 15-day plot (max 360h)
    actual_15day_hours = min(360, max_hours_in_data) if max_hours_in_data > 0 else 360
    actual_15day_days = actual_15day_hours / 24
    days_15day_str = f"{int(actual_15day_days)}" if actual_15day_hours % 24 == 0 else f"{actual_15day_days:.3g}"
    
    end_15day = (latest_ph + timedelta(hours=actual_15day_hours)).strftime("%Y-%m-%d")
    title_15day = f"{days_15day_str}-Day Forecast Tropical Cyclone Tracks - ECMWF IFS ({forecast_start} to {end_15day})"
    out_15day = f"public/assets/ifs_tropical_cyclone_15day_forecast_{init_time_str}.png"
    generate_plot(data, 360, out_15day, title_15day, runtime_text)
