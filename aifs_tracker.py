import os
import sys
import numpy as np
import scipy.ndimage as ndimage
import xarray as xr
from ecmwf.opendata import Client
from datetime import datetime, timezone, timedelta
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from matplotlib.patches import PathPatch
from matplotlib.path import Path

# Tracking parameters
MSL_THRESHOLD = 1005.0 # hPa
WIND_THRESHOLD = 17.0 # knots (~8.7 m/s)
MAX_NEAREST_NEIGHBOR_DIST = 4.0 # degrees max movement per 6 hours (approx 70 km/h)
MIN_TRACK_LENGTH = 4 # minimum number of 6-hour steps to be considered a real cyclone
TRACKING_DOMAIN = [100, 160, 0, 40] # [lon_min, lon_max, lat_min, lat_max]

def get_pressure_color(pressure):
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

def haversine_dist(lat1, lon1, lat2, lon2):
    # Rough degree distance is sufficient for nearest neighbor in tropics
    return np.sqrt((lat1 - lat2)**2 + (lon1 - lon2)**2)

def find_candidate_centers(mslp, wind_speed, lons, lats):
    """
    Find local MSLP minima that also meet the wind threshold.
    """
    # 2D minimum filter to find local minima (window of roughly 3.75x3.75 degrees for 0.25 res)
    box_size = 15
    local_min = ndimage.minimum_filter(mslp, size=box_size) == mslp
    is_cyclone = (mslp < MSL_THRESHOLD) & local_min
    
    indices = np.argwhere(is_cyclone)
    
    candidates = []
    for idx in indices:
        y, x = idx[0], idx[1]
        lat = float(lats[y])
        lon = float(lons[x])
        if lon < 0:
            lon += 360
            
        pressure = float(mslp[y, x])
        max_wind = float(wind_speed[y, x]) * 1.94384 # convert m/s to knots
        
        # We can also check a small window around the center for max wind
        y_slice = slice(max(0, y-5), min(mslp.shape[0], y+6))
        x_slice = slice(max(0, x-5), min(mslp.shape[1], x+6))
        local_max_wind = float(np.max(wind_speed[y_slice, x_slice])) * 1.94384
        
        if (TRACKING_DOMAIN[0] <= lon <= TRACKING_DOMAIN[1] and 
            TRACKING_DOMAIN[2] <= lat <= TRACKING_DOMAIN[3]):
            if local_max_wind >= WIND_THRESHOLD:
                candidates.append({
                    'lat': lat,
                    'lon': lon,
                    'mslp': pressure,
                    'wind': local_max_wind
                })
                
    return candidates

def generate_aifs_tracks():
    client = Client(source="ecmwf", model="aifs-single", resol="0p25")
    
    # We will track from step 0 to 360 every 6 hours (15 days)
    steps = list(range(0, 361, 6))
    
    print("Initiating Lightweight AIFS Cyclone Tracker...")
    
    active_tracks = [] # List of currently tracked storms
    completed_tracks = [] # Tracks that have died out or left domain
    
    track_id_counter = 1
    
    tmp_dir = "temp_aifs_gribs"
    os.makedirs(tmp_dir, exist_ok=True)
    
    latest_run_time = datetime.now(timezone.utc) # Approximate, as ECMWF doesn't strictly provide run time in opendata client directly without query
    # We will format it as midnight UTC of today for the filename if we can't get exact
    
    for step in steps:
        print(f"Downloading and processing step {step}/360...")
        target_file = os.path.join(tmp_dir, f"aifs_surface_{step:03d}.grib2")
        
        try:
            # Download MSLP and 10m Wind components
            client.retrieve(
                step=step,
                type="fc",
                param=['msl', '10u', '10v'],
                target=target_file
            )
            
            ds = xr.open_dataset(target_file, engine="cfgrib")
            
            if 'time' in ds.dims and ds.sizes['time'] > 1:
                ds = ds.isel(time=-1)
                
            mslp = ds['msl'].values / 100.0 # convert Pa to hPa
            u10 = ds['10u'].values
            v10 = ds['10v'].values
            wind_speed = np.sqrt(u10**2 + v10**2)
            
            lats = ds.latitude.values
            lons = ds.longitude.values
            
            # Keep track of latest run time for labeling
            if step == 0 and 'time' in ds.coords:
                latest_run_time = pd.to_datetime(ds.time.values).replace(tzinfo=timezone.utc)
            
            # Find candidate centers at this step
            candidates = find_candidate_centers(mslp, wind_speed, lons, lats)
            
            # Match candidates to active tracks (Nearest Neighbor)
            unmatched_candidates = candidates.copy()
            next_active_tracks = []
            
            for track in active_tracks:
                last_pos = track['path'][-1]
                
                # Find closest candidate
                best_dist = float('inf')
                best_candidate = None
                
                for cand in unmatched_candidates:
                    dist = haversine_dist(last_pos['lat'], last_pos['lon'], cand['lat'], cand['lon'])
                    if dist < best_dist and dist <= MAX_NEAREST_NEIGHBOR_DIST:
                        best_dist = dist
                        best_candidate = cand
                        
                if best_candidate:
                    # Append to track
                    track['path'].append({
                        'step': step,
                        'lat': best_candidate['lat'],
                        'lon': best_candidate['lon'],
                        'mslp': best_candidate['mslp'],
                        'wind': best_candidate['wind']
                    })
                    next_active_tracks.append(track)
                    unmatched_candidates.remove(best_candidate)
                else:
                    # Storm died or moved out
                    completed_tracks.append(track)
            
            # Any unmatched candidates become new potential tracks
            for cand in unmatched_candidates:
                new_track = {
                    'id': track_id_counter,
                    'start_step': step,
                    'path': [{
                        'step': step,
                        'lat': cand['lat'],
                        'lon': cand['lon'],
                        'mslp': cand['mslp'],
                        'wind': cand['wind']
                    }]
                }
                next_active_tracks.append(new_track)
                track_id_counter += 1
                
            active_tracks = next_active_tracks
            
            ds.close()
            os.remove(target_file)
            
        except Exception as e:
            print(f"Failed at step {step}: {e}")
            break
            
    # Add any remaining active tracks to completed
    completed_tracks.extend(active_tracks)
    
    # Clean up temp dir
    try:
        os.rmdir(tmp_dir)
    except:
        pass
        
    # Filter out noise (tracks too short)
    valid_tracks = [t for t in completed_tracks if len(t['path']) >= MIN_TRACK_LENGTH]
    print(f"Tracking complete. Found {len(valid_tracks)} valid cyclone tracks.")
    
    plot_tracks(valid_tracks, latest_run_time)

def plot_tracks(tracks, run_time):
    print("Plotting tracks...")
    fig = plt.figure(figsize=(12, 12))
    ax = plt.axes(projection=ccrs.PlateCarree())
    ax.set_extent([105, 155, 0, 40], crs=ccrs.PlateCarree())
    
    ax.add_feature(cfeature.LAND, facecolor='lightgray')
    ax.add_feature(cfeature.COASTLINE, linewidth=1.5)
    ax.add_feature(cfeature.BORDERS, linestyle=':', linewidth=1)
    ax.add_feature(cfeature.OCEAN, facecolor='aliceblue')
    
    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
    gl.top_labels = False
    gl.right_labels = False
    
    # PAR Boundary
    par_vertices = [
        (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
        (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
    ]
    par_path = Path(par_vertices)
    par_patch = PathPatch(par_path, edgecolor='blue', linestyle='--', linewidth=2, facecolor='none', transform=ccrs.PlateCarree())
    ax.add_patch(par_patch)
    
    # Plot each track
    for track in tracks:
        lats = [p['lat'] for p in track['path']]
        lons = [p['lon'] for p in track['path']]
        pressures = [p['mslp'] for p in track['path']]
        
        # Draw line
        ax.plot(lons, lats, color='#404040', linewidth=2.5, alpha=0.7, transform=ccrs.PlateCarree())
        
        # Draw points
        for lon, lat, p in zip(lons, lats, pressures):
            color = get_pressure_color(p)
            ax.plot(lon, lat, color='white', marker='o', markersize=8, markeredgewidth=0, transform=ccrs.PlateCarree())
            ax.plot(lon, lat, color=color, marker='o', markersize=6, transform=ccrs.PlateCarree())
            
    # Legend
    pressure_ranges = [
        {'pressure_range': '< 920 hPa', 'color': '#5B0E2D'},
        {'pressure_range': '920–945 hPa', 'color': '#A83232'},
        {'pressure_range': '945–970 hPa', 'color': '#E67E22'},
        {'pressure_range': '970–990 hPa', 'color': '#F1C40F'},
        {'pressure_range': '990–1005 hPa', 'color': '#2ECC71'},
        {'pressure_range': '> 1005 hPa', 'color': '#3498DB'}
    ]
    
    legend_elements = [
        plt.Line2D([0], [0], marker='o', color='#404040', markerfacecolor=r['color'], markersize=10, label=r['pressure_range'])
        for r in pressure_ranges
    ]
    legend = ax.legend(handles=legend_elements, loc='upper left', bbox_to_anchor=(0.02, 0.98), frameon=True)
    legend.get_frame().set_facecolor('white')
    legend.get_frame().set_alpha(0.9)
    
    # Legend Box Text
    ph_time = run_time + timedelta(hours=8)
    time_str = ph_time.strftime("%I:%M %p").lstrip("0")
    date_str = ph_time.strftime("%B %d, %Y")
    
    legend_text = (
        "Forecast: ECMWF AIFS TC Tracks (15-Day)\n"
        f"Runtime: {time_str} PHT, {date_str}\n"
        "Processed By: Philippine Typhoon/Weather"
    )
    plt.text(0.98, 0.02, legend_text, transform=ax.transAxes, fontsize=10, verticalalignment='bottom', horizontalalignment='right',
             bbox=dict(facecolor='white', alpha=0.8, edgecolor='black', boxstyle='round,pad=0.3'))
             
    # Title
    start_date = ph_time.strftime("%Y-%m-%d")
    end_date = (ph_time + timedelta(days=15)).strftime("%Y-%m-%d")
    ax.set_title(f"15-Day Forecast Tropical Cyclone Tracks - ECMWF AIFS ({start_date} to {end_date})", fontsize=16, weight='bold')
    
    # Save
    date_formatted = run_time.strftime("%Y-%m-%dT000000") # simplified to midnight UTC for filenames
    # Check if a 00, 06, 12, 18 time is closer
    hour = run_time.hour
    rounded_hour = (hour // 6) * 6
    date_formatted = run_time.strftime(f"%Y-%m-%dT{rounded_hour:02d}0000")
    
    out_dir = "public/assets"
    os.makedirs(out_dir, exist_ok=True)
    
    out_file_15day = os.path.join(out_dir, f"aifs_tropical_cyclone_15day_forecast_{date_formatted}.png")
    plt.savefig(out_file_15day, dpi=300, bbox_inches='tight')
    print(f"Saved: {out_file_15day}")
    
    # Save a copy for 5-day just to match FNV3 UI expectations if needed
    out_file_5day = os.path.join(out_dir, f"aifs_tropical_cyclone_5day_forecast_{date_formatted}.png")
    plt.savefig(out_file_5day, dpi=300, bbox_inches='tight')
    
    plt.close()

if __name__ == "__main__":
    generate_aifs_tracks()
