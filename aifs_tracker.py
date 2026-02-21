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
from concurrent.futures import ThreadPoolExecutor, as_completed

# === Advanced Tracking Parameters ===
MSL_THRESHOLD = 1012.0                # hPa (relaxed to capture developing/weak systems)
VORTICITY_THRESHOLD = 2.0e-5          # s^-1 (850hPa Relative Vorticity cyclonic spin)
THICKNESS_ANOMALY_THRESHOLD = 5.0     # geopotential meters (Warm-core signal)
MAX_TRANSLATION_SPEED = 75.0          # km/h max movement between steps
MAX_MISSING_STEPS = 2                 # Allow storm to temporarily disappear/weaken for 12 hours
MIN_TRACK_LENGTH = 4                  # minimum number of 6-hour steps to filter out short-lived noise
TRACKING_DOMAIN = [100, 160, 0, 45]   # [lon_min, lon_max, lat_min, lat_max]
DEG2KM = 111.32                       # approx km per degree lat

def get_pressure_color(pressure):
    if pressure < 920: return '#5B0E2D'  # Super Typhoon
    elif 920 <= pressure <= 945: return '#A83232'  # Typhoon
    elif 945 < pressure <= 970: return '#E67E22'  # Severe Tropical Storm
    elif 970 < pressure <= 990: return '#F1C40F'  # Tropical Storm
    elif 990 < pressure <= 1005: return '#2ECC71'  # Tropical Depression
    else: return '#3498DB'  # Low Pressure Area

def haversine_dist(lat1, lon1, lat2, lon2):
    """Returns rough distance in km"""
    # Simple Euclidean mapped to km for small degree tropical distances
    dx = (lon2 - lon1) * np.cos(np.radians((lat1 + lat2)/2.0))
    dy = lat2 - lat1
    return np.sqrt(dx**2 + dy**2) * DEG2KM

def compute_relative_vorticity(u, v, lats, lons):
    """
    Compute relative vorticity from u, v winds on a lat/lon grid.
    zeta = dv/dx - du/dy
    """
    dx = np.gradient(lons) * DEG2KM * 1000.0 # meters
    dy = np.gradient(lats) * DEG2KM * 1000.0 # meters
    
    # Cosine latitude weighting for dx
    cos_lat = np.cos(np.radians(lats))
    dx_2d = dx[np.newaxis, :] * cos_lat[:, np.newaxis]
    
    # Central difference approximation
    dv_dx = np.gradient(v, axis=1) / dx_2d
    du_dy = np.gradient(u, axis=0) / dy[:, np.newaxis]
    
    zeta = dv_dx - du_dy
    return zeta

def get_thickness_anomaly(z850, z500, c_y, c_x, radius=12):
    """
    Calculate 850-500 hPa thickness anomaly to confirm warm core.
    radius of 12 grid points = 3 degrees.
    """
    thickness = z500 - z850
    center_thickness = thickness[c_y, c_x]
    
    # Get annulus surrounding the center
    y_slice = slice(max(0, c_y - radius), min(thickness.shape[0], c_y + radius + 1))
    x_slice = slice(max(0, c_x - radius), min(thickness.shape[1], c_x + radius + 1))
    
    local_thickness = thickness[y_slice, x_slice]
    env_thickness = np.mean(local_thickness)
    
    return center_thickness - env_thickness

def find_candidate_centers(mslp, u850, v850, z850, z500, lons, lats):
    """
    Find local MSLP minima that pass meteorological checks (Vorticity, Warm Core).
    """
    box_size = 11 # 2.75 degree window for mslp min
    local_min = ndimage.minimum_filter(mslp, size=box_size) == mslp
    is_cyclone = (mslp < MSL_THRESHOLD) & local_min
    
    indices = np.argwhere(is_cyclone)
    candidates = []
    
    if len(indices) == 0:
        return candidates
        
    zeta850 = compute_relative_vorticity(u850, v850, lats, lons)
    
    for idx in indices:
        y, x = idx[0], idx[1]
        lat = float(lats[y])
        lon = float(lons[x])
        if lon < 0: lon += 360
            
        if not (TRACKING_DOMAIN[0] <= lon <= TRACKING_DOMAIN[1] and 
                TRACKING_DOMAIN[2] <= lat <= TRACKING_DOMAIN[3]):
            continue
            
        pressure = float(mslp[y, x])
        
        # 1. Vorticity Check
        y_v_slice = slice(max(0, y-4), min(mslp.shape[0], y+5))
        x_v_slice = slice(max(0, x-4), min(mslp.shape[1], x+5))
        local_max_zeta = float(np.max(zeta850[y_v_slice, x_v_slice]))
        
        if local_max_zeta < VORTICITY_THRESHOLD:
            continue
            
        # 2. Warm Core Check (Thickness Anomaly)
        tanom = get_thickness_anomaly(z850, z500, y, x)
        if tanom < THICKNESS_ANOMALY_THRESHOLD:
            continue
            
        candidates.append({
            'lat': lat,
            'lon': lon,
            'mslp': pressure,
            'vorticity': local_max_zeta,
            'thickness_anom': float(tanom)
        })
                
    # Deduplicate grouped candidates
    merged_candidates = []
    for cand in candidates:
        is_duplicate = False
        for m_cand in merged_candidates:
            if haversine_dist(cand['lat'], cand['lon'], m_cand['lat'], m_cand['lon']) < 300.0:
                is_duplicate = True
                if cand['mslp'] < m_cand['mslp']:
                    m_cand.update(cand)
                break
        if not is_duplicate:
            merged_candidates.append(cand)
            
    return merged_candidates

def download_step_data(client, step, tmp_dir):
    """Thread target to download data for a specific 6h step"""
    sfc_file = os.path.join(tmp_dir, f"aifs_sfc_{step:03d}.grib2")
    pl_file = os.path.join(tmp_dir, f"aifs_pl_{step:03d}.grib2")
    
    try:
        # Download MSLP
        client.retrieve(step=step, type="fc", param=['msl'], target=sfc_file)
        # Download 850, 500 hPa U, V, Z
        client.retrieve(step=step, type="fc", levtype="pl", levelist=[850, 500], param=['u', 'v', 'z'], target=pl_file)
        return step, sfc_file, pl_file, None
    except Exception as e:
        return step, None, None, e

def generate_aifs_tracks():
    client = Client(source="ecmwf", model="aifs-single", resol="0p25")
    steps = list(range(0, 361, 6)) # 15 days
    
    print("Initiating Advanced Meteorological AIFS Cyclone Tracker...")
    tmp_dir = "temp_aifs_gribs"
    os.makedirs(tmp_dir, exist_ok=True)
    
    active_tracks = [] 
    completed_tracks = []
    track_id_counter = 1
    latest_run_time = datetime.now(timezone.utc)
    
    # We download in batches to manage ECMWF conn limits & memory
    BATCH_SIZE = 4
    for i in range(0, len(steps), BATCH_SIZE):
        batch_steps = steps[i:i+BATCH_SIZE]
        print(f"Processing steps: {batch_steps}")
        
        results = {}
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = {executor.submit(download_step_data, client, st, tmp_dir): st for st in batch_steps}
            for fut in as_completed(futures):
                step, sfc, pl, err = fut.result()
                if err:
                    print(f"Error downloading step {step}: {err}")
                else:
                    results[step] = (sfc, pl)
        
        # Process sequential steps in this batch
        for step in batch_steps:
            if step not in results:
                continue
                
            sfc_file, pl_file = results[step]
            
            try:
                ds_sfc = xr.open_dataset(sfc_file, engine="cfgrib")
                ds_pl = xr.open_dataset(pl_file, engine="cfgrib")
                
                # Setup Time Label
                if step == 0:
                    if 'valid_time' in ds_sfc.coords:
                        latest_run_time = pd.to_datetime(ds_sfc.valid_time.values).replace(tzinfo=timezone.utc)
                    elif 'time' in ds_sfc.coords:
                        latest_run_time = pd.to_datetime(ds_sfc.time.values).replace(tzinfo=timezone.utc)
                        
                mslp = ds_sfc['msl'].values / 100.0 # hPa
                u850 = ds_pl['u'].sel(isobaricInhPa=850).values
                v850 = ds_pl['v'].sel(isobaricInhPa=850).values
                z850 = ds_pl['z'].sel(isobaricInhPa=850).values / 9.80665 # gpm
                z500 = ds_pl['z'].sel(isobaricInhPa=500).values / 9.80665 # gpm
                
                lats = ds_sfc.latitude.values
                lons = ds_sfc.longitude.values
                
                candidates = find_candidate_centers(mslp, u850, v850, z850, z500, lons, lats)
                
                # --- Tracker Association Logic ---
                unmatched_candidates = candidates.copy()
                next_active_tracks = []
                
                for track in active_tracks:
                    last_pos = track['path'][-1]
                    hours_since_last = step - last_pos['step']
                    
                    if hours_since_last <= 0:
                        continue # should never happen
                        
                    max_allowed_dist = (hours_since_last) * MAX_TRANSLATION_SPEED
                    
                    best_dist = float('inf')
                    best_candidate = None
                    
                    for cand in unmatched_candidates:
                        dist = haversine_dist(last_pos['lat'], last_pos['lon'], cand['lat'], cand['lon'])
                        if dist < best_dist and dist <= max_allowed_dist:
                            best_dist = dist
                            best_candidate = cand
                            
                    if best_candidate:
                        track['path'].append({
                            'step': step,
                            'lat': best_candidate['lat'],
                            'lon': best_candidate['lon'],
                            'mslp': best_candidate['mslp']
                        })
                        track['missing_steps'] = 0
                        next_active_tracks.append(track)
                        unmatched_candidates.remove(best_candidate)
                    else:
                        track['missing_steps'] += 6 # Missed 6 hours
                        if track['missing_steps'] <= (MAX_MISSING_STEPS * 6):
                            next_active_tracks.append(track)
                        else:
                            completed_tracks.append(track)
                
                # New Tracks
                for cand in unmatched_candidates:
                    next_active_tracks.append({
                        'id': track_id_counter,
                        'start_step': step,
                        'missing_steps': 0,
                        'path': [{
                            'step': step,
                            'lat': cand['lat'], 'lon': cand['lon'], 'mslp': cand['mslp']
                        }]
                    })
                    track_id_counter += 1
                    
                active_tracks = next_active_tracks
                
                ds_sfc.close()
                ds_pl.close()
                os.remove(sfc_file)
                os.remove(pl_file)
                
            except Exception as e:
                print(f"Error processing step {step}: {e}")
                
    completed_tracks.extend(active_tracks)
    
    # Cleanup
    try:
        os.rmdir(tmp_dir)
    except: pass
    
    valid_tracks = [t for t in completed_tracks if len(t['path']) >= MIN_TRACK_LENGTH]
    print(f"Tracking complete. Found {len(valid_tracks)} robust cyclone tracks.")
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
    
    par_vertices = [
        (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
        (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
    ]
    par_patch = PathPatch(Path(par_vertices), edgecolor='blue', linestyle='--', linewidth=2, facecolor='none', transform=ccrs.PlateCarree())
    ax.add_patch(par_patch)
    
    for track in tracks:
        lats = [p['lat'] for p in track['path']]
        lons = [p['lon'] for p in track['path']]
        pressures = [p['mslp'] for p in track['path']]
        
        ax.plot(lons, lats, color='#404040', linewidth=2.5, alpha=0.7, transform=ccrs.PlateCarree())
        for lon, lat, p in zip(lons, lats, pressures):
            color = get_pressure_color(p)
            ax.plot(lon, lat, color='white', marker='o', markersize=8, markeredgewidth=0, transform=ccrs.PlateCarree())
            ax.plot(lon, lat, color=color, marker='o', markersize=6, transform=ccrs.PlateCarree())
            
    pressure_ranges = [
        {'range': '< 920 hPa', 'color': '#5B0E2D'},
        {'range': '920–945 hPa', 'color': '#A83232'},
        {'range': '945–970 hPa', 'color': '#E67E22'},
        {'range': '970–990 hPa', 'color': '#F1C40F'},
        {'range': '990–1005 hPa', 'color': '#2ECC71'},
        {'range': '> 1005 hPa', 'color': '#3498DB'}
    ]
    
    legend_elements = [plt.Line2D([0],[0], marker='o', color='#404040', markerfacecolor=r['color'], markersize=10, label=r['range']) for r in pressure_ranges]
    legend = ax.legend(handles=legend_elements, loc='upper left', bbox_to_anchor=(0.02, 0.98), frameon=True)
    legend.get_frame().set_facecolor('white')
    legend.get_frame().set_alpha(0.9)
    
    ph_time = run_time + timedelta(hours=8)
    hour_str = run_time.strftime("%H")
    time_label = "4:00 PM" if hour_str == "00" else "10:00 PM" if hour_str == "06" else "4:00 AM" if hour_str == "12" else "10:00 AM" if hour_str == "18" else ph_time.strftime("%I:%M %p").lstrip("0")
    date_str = ph_time.strftime("%B %d, %Y")
    
    legend_text = f"Forecast: ECMWF AIFS TC Tracks (15-Day)\nRuntime: {time_label} PHT, {date_str}\nProcessed By: Philippine Typhoon/Weather"
    plt.text(0.98, 0.02, legend_text, transform=ax.transAxes, fontsize=10, verticalalignment='bottom', horizontalalignment='right',
             bbox=dict(facecolor='white', alpha=0.8, edgecolor='black', boxstyle='round,pad=0.3'))
             
    start_date = ph_time.strftime("%Y-%m-%d")
    end_date = (ph_time + timedelta(days=15)).strftime("%Y-%m-%d")
    ax.set_title(f"15-Day Forecast Tropical Cyclone Tracks - Western Pacific ({start_date} to {end_date})", fontsize=16, weight='bold')
    
    hour = run_time.hour
    rounded_hour = (hour // 6) * 6
    if rounded_hour == 0:
        date_formatted = run_time.strftime("%Y-%m-%d")
    else:
        date_formatted = run_time.strftime(f"%Y-%m-%dT{rounded_hour:02d}0000")
    
    out_dir = "public/assets"
    os.makedirs(out_dir, exist_ok=True)
    
    plt.savefig(os.path.join(out_dir, f"aifs_tropical_cyclone_15day_forecast_{date_formatted}.png"), dpi=300, bbox_inches='tight')
    plt.savefig(os.path.join(out_dir, f"aifs_tropical_cyclone_5day_forecast_{date_formatted}.png"), dpi=300, bbox_inches='tight')
    plt.close()

if __name__ == "__main__":
    generate_aifs_tracks()
