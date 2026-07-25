import os
import warnings
from datetime import datetime, timedelta, timezone
import collections
from eccodes import *
import numpy as np
import pandas as pd
from ecmwf.opendata import Client

warnings.filterwarnings('ignore')

import urllib.request
import urllib.error

def download_latest_aifs_tc():
    import time as _time
    print("Downloading latest AIFS TC Tracks from ECMWF Open Data directly...")

    now_utc = datetime.now(timezone.utc)
    run_times = [18, 12, 6, 0]

    # --- Step 1: Find the latest cycle URL that actually exists (skip 404s only) ---
    latest_url = None
    latest_bufr_file = None
    latest_date_str = None
    latest_rt = None
    latest_step = None

    for day_offset in range(3):
        if latest_url:
            break
        check_date = (now_utc - timedelta(days=day_offset))
        date_str = check_date.strftime('%Y%m%d')

        for rt in run_times:
            step = 360
            url = f"https://data.ecmwf.int/forecasts/{date_str}/{rt:02d}z/aifs-ens/0p25/enfo/{date_str}{rt:02d}0000-{step}h-enfo-tf.bufr"

            try:
                req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'Mozilla/5.0'})
                urllib.request.urlopen(req, timeout=10)
                # HEAD succeeded — this cycle exists
                latest_url = url
                latest_bufr_file = f"temp_data/aifs_tc_{date_str}_{rt:02d}.bufr"
                latest_date_str = check_date.strftime("%Y-%m-%d")
                latest_rt = rt
                latest_step = step
                print(f"Latest available cycle found: {url}")
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    # Server is busy but the file EXISTS — use this as the target
                    print(f"429 on HEAD {url} — file exists but server busy, will retry download.")
                    latest_url = url
                    latest_bufr_file = f"temp_data/aifs_tc_{date_str}_{rt:02d}.bufr"
                    latest_date_str = check_date.strftime("%Y-%m-%d")
                    latest_rt = rt
                    latest_step = step
                    break
                elif e.code == 404:
                    continue   # This cycle simply doesn't exist yet
                else:
                    print(f"HEAD check HTTP {e.code}: {url}")
                    continue
            except Exception as e:
                print(f"HEAD check error: {e}")
                continue

    if not latest_url:
        raise RuntimeError("Could not find any available AIFS TC cycle after checking 3 days.")

    # --- Step 2: Retry the SAME (latest) URL with exponential back-off on 429 ---
    os.makedirs("temp_data", exist_ok=True)
    max_retries = 12
    wait_seconds = 30

    for attempt in range(1, max_retries + 1):
        try:
            print(f"Attempt {attempt}/{max_retries}: downloading {latest_url} ...")
            req = urllib.request.Request(latest_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=120) as response, open(latest_bufr_file, 'wb') as out_file:
                out_file.write(response.read())

            if os.path.exists(latest_bufr_file) and os.path.getsize(latest_bufr_file) > 0:
                print(f"Successfully downloaded AIFS to {latest_bufr_file}")
                return latest_bufr_file, latest_date_str, f"{latest_rt:02d}:00:00"
            else:
                print("Downloaded file is empty, retrying...")
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"429 Too Many Requests — waiting {wait_seconds}s before retry {attempt}/{max_retries}...")
                _time.sleep(wait_seconds)
                wait_seconds = min(wait_seconds * 2, 300)   # cap at 5 min
            else:
                print(f"HTTP {e.code} on download — aborting retries.")
                break
        except Exception as e:
            print(f"Download error: {e} — retrying in {wait_seconds}s...")
            _time.sleep(wait_seconds)
        finally:
            # Clean up partial file if it exists and is empty
            if os.path.exists(latest_bufr_file) and os.path.getsize(latest_bufr_file) == 0:
                os.remove(latest_bufr_file)

    raise RuntimeError(f"Failed to download AIFS TC data from {latest_url} after {max_retries} attempts.")

def extract_tc_data(filename, force_init_time=None):
    cnt = 0
    unpacked_data = []
    
    f = open(filename, 'rb')
    while 1:
        bufr = codes_bufr_new_from_file(f)
        if bufr is None:
            break
            
        codes_set(bufr, 'unpack', 1)
        data = collections.defaultdict(dict)
        
        year = codes_get(bufr, "year")
        month = codes_get(bufr, "month")
        day = codes_get(bufr, "day")
        hour = codes_get(bufr, "hour")
        minute = codes_get(bufr, "minute")
        
        if force_init_time:
            init_time = force_init_time
        else:
            init_time = f"{year:04d}-{month:02d}-{day:02d} {hour:02d}:{minute:02d}:00"
            
        stormIdentifier = codes_get(bufr, "stormIdentifier")
        try:
            long_name = codes_get(bufr, "longStormName").strip()
        except Exception:
            long_name = ''
        storm_id = long_name if long_name else stormIdentifier
        
        # Determine number of periods
        numberOfPeriods = 0
        while True:
            numberOfPeriods += 1
            try:
                codes_get_array(bufr, f"#{numberOfPeriods}#timePeriod")
            except CodesInternalError:
                break
                
        memberNumber = codes_get_array(bufr, "ensembleMemberNumber")
        
        # Code 3: LOCATION OF MAXIMUM WIND
        latitudeMaxWind0 = codes_get_array(bufr, '#3#latitude')
        longitudeMaxWind0 = codes_get_array(bufr, '#3#longitude')
        windMaxWind0 = codes_get_array(bufr, '#1#windSpeedAt10M')
        
        # Code 4 & 5: STORM ANALYSIS LOCATION
        latitudeAnalysis = codes_get_array(bufr, '#2#latitude')
        longitudeAnalysis = codes_get_array(bufr, '#2#longitude')
        pressureAnalysis = codes_get_array(bufr, '#1#pressureReducedToMeanSeaLevel')
        
        for k in range(len(memberNumber)):
            data[k][0] = [
                latitudeAnalysis[k] if len(latitudeAnalysis) == len(memberNumber) else latitudeAnalysis[0],
                longitudeAnalysis[k] if len(longitudeAnalysis) == len(memberNumber) else longitudeAnalysis[0],
                pressureAnalysis[k] if len(pressureAnalysis) == len(memberNumber) else pressureAnalysis[0],
                latitudeMaxWind0[k] if len(latitudeMaxWind0) == len(memberNumber) else latitudeMaxWind0[0],
                longitudeMaxWind0[k] if len(longitudeMaxWind0) == len(memberNumber) else longitudeMaxWind0[0],
                windMaxWind0[k] if len(windMaxWind0) == len(memberNumber) else windMaxWind0[0]
            ]
            
        timePeriod = [0] * numberOfPeriods
        for i in range(1, numberOfPeriods):
            rank1 = i * 2 + 2
            rank3 = i * 2 + 3
            
            ivalues = codes_get_array(bufr, f"#{i}#timePeriod")
            if len(ivalues) == 1:
                timePeriod[i] = ivalues[0]
            else:
                for j in range(len(ivalues)):
                    if ivalues[j] != CODES_MISSING_LONG:
                        timePeriod[i] = ivalues[j]
                        break
                        
            # Code 1: STORM CENTER
            lat = codes_get_array(bufr, f"#{rank1}#latitude")
            lon = codes_get_array(bufr, f"#{rank1}#longitude")
            press = codes_get_array(bufr, f"#{i+1}#pressureReducedToMeanSeaLevel")
            
            # Code 3: MAX WIND
            latWind = codes_get_array(bufr, f"#{rank3}#latitude")
            lonWind = codes_get_array(bufr, f"#{rank3}#longitude")
            wind10m = codes_get_array(bufr, f"#{i+1}#windSpeedAt10M")
            
            if len(lat) == 1 and (lat[0] == CODES_MISSING_DOUBLE or lat[0] == -1e+100):
                continue
                
            for k in range(len(memberNumber)):
                data[k][i] = [
                    lat[k] if len(lat) == len(memberNumber) else lat[0],
                    lon[k] if len(lon) == len(memberNumber) else lon[0],
                    press[k] if len(press) == len(memberNumber) else press[0],
                    latWind[k] if len(latWind) == len(memberNumber) else latWind[0],
                    lonWind[k] if len(lonWind) == len(memberNumber) else lonWind[0],
                    wind10m[k] if len(wind10m) == len(memberNumber) else wind10m[0]
                ]
                
        # Format for output
        init_time = f"{year}-{month:02d}-{day:02d} {hour:02d}:{minute:02d}:00"
        
        for m in range(len(memberNumber)):
            for s in range(len(timePeriod)):
                if s not in data[m]:
                    continue
                if data[m][s][0] != CODES_MISSING_DOUBLE and data[m][s][1] != CODES_MISSING_DOUBLE:
                    
                    pres_pa = data[m][s][2]
                    wind_ms = data[m][s][5]
                    
                    pres_hpa = pres_pa / 100.0 if pres_pa not in (CODES_MISSING_DOUBLE, -1e+100) else np.nan
                    wind_kt = wind_ms * 1.94384 if wind_ms not in (CODES_MISSING_DOUBLE, -1e+100) else np.nan
                    
                    unpacked_data.append({
                        'init_time': init_time,
                        'track_id': storm_id,
                        'sample': memberNumber[m],
                        'lead_time_hours': timePeriod[s],
                        'lat': data[m][s][0],
                        'lon': data[m][s][1],
                        'minimum_sea_level_pressure_hpa': pres_hpa,
                        'maximum_sustained_wind_speed_knots': wind_kt
                    })
                    
        codes_release(bufr)
    f.close()
    
    df = pd.DataFrame(unpacked_data)
    return df

def process_aifs_tc():
    bufr_file, date_str, time_str = download_latest_aifs_tc()
    print("Extracting BUFR data...")
    force_time = f"{date_str} {time_str}"
    df = extract_tc_data(bufr_file, force_init_time=force_time)
    
    os.makedirs("public/data", exist_ok=True)
    out_csv = "public/data/aifs_tc_latest.csv"
    df.to_csv(out_csv, index=False)
    print(f"Saved extracted tracks to {out_csv}")
    
if __name__ == "__main__":
    process_aifs_tc()
