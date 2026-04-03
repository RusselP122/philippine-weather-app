import subprocess
import base64
import gzip
import xarray as xr
import os
import io
import json
import numpy as np
from datetime import datetime, timedelta, timezone
import matplotlib.pyplot as plt
import geojsoncontour

# Ensure output directory exists
OUT_DIR = "public/data/strike_prob"
os.makedirs(OUT_DIR, exist_ok=True)

# Correct URL structure (discovered from WeatherLab):
# .../netcdf/cumulative_probability_fields/FNV3_LARGE_ENSEMBLE_{date}T{hour}_00_cumulative_probability_fields.nc.gz.base64
BASE = (
    "https://deepmind.google.com/science/weatherlab/download/cyclones/"
    "FNV3_LARGE_ENSEMBLE/ensemble/cyclogenesis/netcdf/cumulative_probability_fields"
)

def curl_status(url):
    """Return HTTP status code for a URL using curl."""
    try:
        result = subprocess.run(
            ["curl", "-s", "-o", os.devnull, "-w", "%{http_code}",
             "--max-time", "20", "-L", "--retry", "2", url],
            capture_output=True, text=True, timeout=35
        )
        return int(result.stdout.strip())
    except Exception:
        return 0

def get_latest_run_url():
    today = datetime.now(timezone.utc).date()
    # Check today and previous 4 days in case of server delays
    dates = [today - timedelta(days=i) for i in range(5)]
    hours_desc = ["18", "12", "06", "00"]

    for d in dates:
        date_str = d.strftime("%Y_%m_%d")
        for h in hours_desc:
            filename = f"FNV3_LARGE_ENSEMBLE_{date_str}T{h}_00_cumulative_probability_fields.nc.gz.base64"
            url = f"{BASE}/{filename}"
            print(f"  Checking {date_str}T{h}...")
            status = curl_status(url)
            if status == 200:
                print(f"  Found: {date_str}T{h}:00 UTC (HTTP 200)")
                return date_str, h, url
            else:
                print(f"  {date_str}T{h}: HTTP {status}, skipping.")

    raise RuntimeError("No available cumulative probability runs found in the last 5 days.")

print("Fetching latest cumulative probability URL...")
date_str, hour_str, url = get_latest_run_url()

local_b64 = f"strike_prob_{date_str}_{hour_str}.nc.gz.base64"
local_nc  = f"strike_prob_{date_str}_{hour_str}.nc"

if os.path.exists(local_nc):
    print(f"Using cached {local_nc} (skip download).")
else:
    # 1. Download the base64-encoded gzipped NetCDF
    print(f"Downloading {url} ...")
    subprocess.run(
        ["curl", "-L", "-o", local_b64, "--retry", "3", "--max-time", "1200", url],
        check=True
    )
    print("Download complete.")

    # 2. Decode base64 → gzip → NetCDF bytes, write as .nc
    print("Decoding base64 + decompressing gzip...")
    with open(local_b64, "rb") as f:
        b64_data = f.read()

    gz_data = base64.b64decode(b64_data)
    nc_data  = gzip.decompress(gz_data)

    with open(local_nc, "wb") as f:
        f.write(nc_data)
    print(f"Decoded NetCDF written to {local_nc}")

    # Clean up the base64 file immediately to save disk space
    os.remove(local_b64)

# 3. Process with xarray
# Non-linear levels anchored to operational thresholds (matches frontend color logic):
# 5%=low signal, 10%=baseline, 20%=emerging, 30%=watch, 50%=high, 70%=dominant
# Top level must be 1.01 (not 0.80) otherwise Matplotlib leaves >80% regions blank!
levels = [0.05, 0.10, 0.20, 0.30, 0.50, 0.70, 1.01]

print("Processing NetCDF with xarray...")
ds = xr.open_dataset(local_nc)
print("Variables in dataset:", list(ds.data_vars))
print("Dimensions:", dict(ds.dims))

# Detect the time dimension name (may be 'lead_time' or 'max_lead_time')
time_dim = None
for candidate in ['lead_time', 'max_lead_time', 'time']:
    if candidate in ds.dims:
        time_dim = candidate
        break
if time_dim is None:
    raise RuntimeError(f"Cannot find time dimension. Dims: {dict(ds.dims)}")
print(f"Using time dimension: '{time_dim}' with {ds.dims[time_dim]} steps")

# Determine step size in hours (dataset is 6-hourly → 61 steps for 0-360h)
n_steps = ds.dims[time_dim]
# 15 days = 360h; steps-1 covers 0..360h if 6-hourly
# step index for Day N (hour N*24): index = N*24 // step_hours
step_hours = 360 // (n_steps - 1) if n_steps > 1 else 6  # usually 6
print(f"Inferred step size: {step_hours}h")

variables = [
    'track_probability',
    '34_knot_strike_probability',
    '50_knot_strike_probability',
    '64_knot_strike_probability',
]

for var_name in variables:
    if var_name not in ds.data_vars:
        print(f"Warning: {var_name} not found in dataset. Skipping.")
        continue

    print(f"Processing {var_name}...")

    # File is already CUMULATIVE — select the index closest to Day N * 24h
    for day in range(1, 16):
        target_hours = day * 24
        # Convert target hour to positional index (clamp to last available step)
        idx = min(target_hours // step_hours, n_steps - 1)

        # Select this single time slice (already cumulative at this point)
        ds_upto_day = ds.isel({time_dim: idx})

        # ds_upto_day is now a 2D (lat, lon) slice — already cumulative at this step
        data = ds_upto_day[var_name].values
        lons = ds.lon.values
        lats = ds.lat.values

        # Skip if no data reaches our lowest threshold
        if np.nanmax(data) < levels[0]:
            empty_geojson = {"type": "FeatureCollection", "features": []}
            with open(os.path.join(OUT_DIR, f"{var_name}_day{day}.json"), 'w') as f:
                json.dump(empty_geojson, f)
            continue

        fig, ax = plt.subplots()
        data[np.isnan(data)] = 0.0
        try:
            contour = ax.contourf(lons, lats, data, levels=levels)
        except (ValueError, TypeError):
            plt.close(fig)
            empty_geojson = {"type": "FeatureCollection", "features": []}
            with open(os.path.join(OUT_DIR, f"{var_name}_day{day}.json"), 'w') as f:
                json.dump(empty_geojson, f)
            continue

        geojson_str = geojsoncontour.contourf_to_geojson(contourf=contour, ndigits=3)
        plt.close(fig)

        out_path = os.path.join(OUT_DIR, f"{var_name}_day{day}.json")
        with open(out_path, 'w') as f:
            f.write(geojson_str)
        print(f"  Saved {out_path}")

# 4. Write metadata for frontend
meta = {
    "init_date": date_str,
    "init_hour": hour_str,
    "generated_at": datetime.now(timezone.utc).isoformat()
}
with open(os.path.join(OUT_DIR, "meta.json"), 'w') as f:
    json.dump(meta, f)

print("Strike probability processing complete.")

# 5. Cleanup NetCDF to save space (GitHub Actions runner)
ds.close()
if os.path.exists(local_nc):
    try:
        os.remove(local_nc)
    except PermissionError:
        pass  # Non-critical on Windows; GitHub Actions (Linux) won't have this issue
