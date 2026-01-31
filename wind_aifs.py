from ecmwf.opendata import Client
import xarray as xr
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import numpy as np
import os
import sys
from datetime import datetime
import json

# Output Directories
OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "wind")
DATA_DIR = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

def fetch_and_plot_aifs():
    print("--- Starting ECMWF AIFS Wind Generation (Cloud/Linux Mode) ---")
    try:
        client = Client(source="ecmwf", model="aifs-single", resol="0p25")
        
        # Parameters: 10m U-component of wind, 10m V-component of wind, Mean sea level pressure
        # ecmwf-opendata uses these names. cfgrib will map them to u10, v10, msl.
        parameters = ['10u', '10v', 'msl']
        # Steps: 0 to 168 hours (Every 6 hours)
        steps = list(range(0, 169, 6)) # 0, 6, 12, ..., 168
        
        # Track successfully generated frames for metadata
        valid_frames = []
        
        # Download all steps in one go if possible, or loop. Loop is safer for memory/stability.
        # But to be cleaner, let's try downloading all and slicing Xarray.
        # Although slicing a big GRIB can be slow if only needing few steps.
        # Let's loop.
        
        for step in steps:
            print(f"\nProcessing Step {step}h...")
            target_file = f"aifs_{step:03d}.grib2"
            
            try:
                # 1. Download
                client.retrieve(
                    date=-1,
                    time=0,
                    step=step,
                    type="fc",
                    param=parameters,
                    target=target_file
                )
                
                # 2. Open with CFGRIB (Requires libeccodes - Works on Linux/GH Actions)
                # filter_by_keys={'typeOfLevel': 'surface'} might be needed if multiple levels mixed.
                # But '10u', '10v' are single levels. 'msl' is single level.
                ds = xr.open_dataset(target_file, engine='cfgrib')
                
                # Variables: u10, v10, msl
                u10 = ds['u10']
                v10 = ds['v10']
                msl = ds['msl']
                
                # 3. Calculate
                # Wind Speed (kph)
                ws = np.sqrt(u10**2 + v10**2) * 3.6
                
                # MSLP (hPa)
                msl_hpa = msl / 100.0
                
                # 4. Plot
                filename_id = f"aifs_wind_{step:03d}"
                print(f"Plotting {filename_id}...")
                
                plot_wind_pressure(ds.latitude, ds.longitude, ws, u10, v10, msl_hpa, filename_id)
                
                valid_frames.append(filename_id)
                
                ds.close()
                if os.path.exists(target_file):
                    os.remove(target_file)
                    
            except Exception as e:
                print(f"Error processing step {step}: {e}")
                # If cfgrib missing (Local Windows fallback warning)
                if "cfgrib" in str(e) or "eccodes" in str(e):
                    print("NOTE: This script requires 'eccodes' and 'cfgrib'. It is designed to run on GitHub Actions.")

        # Save Metadata
        meta_info = {
            "model": "ECMWF AIFS",
            "source": "ECMWF Open Data",
            "generated_at": datetime.now().strftime("%Y-%m-%d %I:%M %p"),
            "run_time": datetime.now().strftime("%Y-%m-%d 00:00 UTC"),
            "animation_frames": valid_frames
        }
        
        with open(os.path.join(DATA_DIR, "wind_meta.json"), "w") as f:
            json.dump(meta_info, f, indent=2)

    except Exception as e:
        print(f"CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()

def plot_wind_pressure(lats, lons, ws, u, v, msl, filename_id):
    fig = plt.figure(figsize=(16, 10))
    ax = plt.axes(projection=ccrs.PlateCarree())
    
    extent = [114, 138, 3, 27]
    ax.set_extent(extent, crs=ccrs.PlateCarree())
    
    ax.add_feature(cfeature.LAND, facecolor='#f8f9fa')
    ax.add_feature(cfeature.COASTLINE, linewidth=0.8, edgecolor='#444')
    ax.add_feature(cfeature.BORDERS, linestyle=':', linewidth=0.5)
    
    # Wind Speed Levels (kph)
    levels = [0, 20, 30, 40, 50, 60, 80, 100, 120, 150, 185, 220]
    cols = [
        '#ffffff00', '#dbeafe', '#93c5fd', '#3b82f6', '#22c55e', 
        '#eab308', '#f97316', '#ef4444', '#dc2626', '#a855f7', '#7e22ce'
    ]
    
    from matplotlib.colors import ListedColormap, BoundaryNorm
    cmap = ListedColormap(cols)
    norm = BoundaryNorm(levels, ncolors=len(cols), clip=False)
    
    cf = ax.contourf(lons, lats, ws, levels=levels, cmap=cmap, norm=norm, extend='max', transform=ccrs.PlateCarree())
    
    cb = fig.colorbar(cf, ax=ax, orientation='vertical', pad=0.01, shrink=0.7, aspect=35)
    cb.set_label('Wind Speed (kph)', fontsize=9)
    
    # Streamlines (Quiver)
    # Downsample
    skip = 6 # Fine tune for 0.25 deg grid
    
    # Xarray coords are 1D usually. Meshgrid needed for Quiver if using 1D.
    # Cartopy handles 1D if matches data shape.
    # But usually safe to meshgrid.
    if len(lons.shape) == 1:
        X, Y = np.meshgrid(lons, lats)
        U = u.values
        V = v.values
    else:
        X, Y = lons.values, lats.values
        U, V = u.values, v.values
        
    ax.quiver(X[::skip, ::skip], Y[::skip, ::skip], 
              U[::skip, ::skip], V[::skip, ::skip], 
              transform=ccrs.PlateCarree(), 
              color='black', alpha=0.3, 
              width=0.0015, scale=400, headwidth=3)

    # MSLP Isobars
    import scipy.ndimage
    msl_val = msl.values
    msl_smooth = scipy.ndimage.gaussian_filter(msl_val, sigma=1)
    
    cs = ax.contour(lons, lats, msl_smooth, levels=range(900, 1040, 4), colors='black', linewidths=1.0, transform=ccrs.PlateCarree())
    ax.clabel(cs, inline=True, fontsize=9, fmt='%d')

    # PAR
    par_lons = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
    par_lats = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]
    ax.plot(par_lons, par_lats, transform=ccrs.PlateCarree(), color='red', linestyle='-', linewidth=1.5, alpha=0.6)

    filepath = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(filepath, dpi=120, bbox_inches='tight', facecolor='white')
    print(f"Saved {filepath}")
    plt.close()

if __name__ == "__main__":
    fetch_and_plot_aifs()
