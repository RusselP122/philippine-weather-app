import os
import sys
import numpy as np
import scipy.ndimage as ndimage
import xarray as xr
from ecmwf.opendata import Client
from datetime import datetime
import pandas as pd

def find_mslp_minima(mslp, lons, lats, box_size=15, threshold=1005.0):
    """
    Find local MSLP minima using a 2D minimum filter.
    box_size defines the sliding window (e.g. 15 grid points = 3.75 degrees at 0.25 res)
    """
    # Create an array of local minima
    local_min = ndimage.minimum_filter(mslp, size=box_size) == mslp
    # Only keep those below a certain threshold (e.g., 1005 hPa)
    is_cyclone = (mslp < threshold) & local_min
    
    # Get coordinates
    indices = np.argwhere(is_cyclone)
    
    # Filter for the Western Pacific roughly
    # PAR: 115E to 135E, 5N to 25N, we can extend to 100E..160E, 0..40N
    points = []
    for idx in indices:
        lat = float(lats[idx[0]])
        lon = float(lons[idx[1]])
        if lon < 0:
            lon += 360  # Handle -180..180 if any
            
        pressure = mslp[idx[0], idx[1]]
        
        # Keep if inside a broad WPAC box
        if 100 <= lon <= 160 and 0 <= lat <= 40:
            points.append({
                'lat': lat,
                'lon': lon,
                'mslp': float(pressure)
            })
    return points

def test_aifs():
    client = Client(source="ecmwf", model="aifs-single", resol="0p25")
    
    print("Testing step 0 and 6...")
    steps = [0, 6]
    results_by_step = {}
    
    for step in steps:
        target = f"aifs_msl_{step:03d}.grib2"
        # Download MSLP only for the test to save time
        try:
            client.retrieve(
                step=step,
                type="fc",
                param=['msl'],
                target=target
            )
            
            ds = xr.open_dataset(target, engine="cfgrib")
            msl = ds['msl']
            
            # Handle multiple time dimensions if present
            if "time" in msl.dims and msl.sizes["time"] > 1:
                msl = msl.isel(time=-1)
                
            mslp_hpa = msl.values / 100.0
            lats = ds.latitude.values
            lons = ds.longitude.values
            
            points = find_mslp_minima(mslp_hpa, lons, lats)
            print(f"Step {step}: Found {len(points)} possible centers")
            for p in points:
                print(f"  -> Lat: {p['lat']}, Lon: {p['lon']}, MSLP: {p['mslp']:.1f} hPa")
            
            results_by_step[step] = points
            
            ds.close()
            os.remove(target)
            
        except Exception as e:
            print(f"Error at step {step}: {e}")
            
if __name__ == "__main__":
    test_aifs()
