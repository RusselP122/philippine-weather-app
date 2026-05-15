import os
import warnings
from datetime import datetime, timedelta, timezone
import collections
from eccodes import *
import numpy as np
import pandas as pd
from ecmwf.opendata import Client

warnings.filterwarnings('ignore')

def download_latest_ifs_tc():
    print("Downloading latest IFS TC Tracks from ECMWF Open Data (Azure mirror)...")
    client = Client(source="azure")
    
    # Try the last 4 run times to find the latest available
    now_utc = datetime.now(timezone.utc)
    # The step depends on run_time: 00z/12z -> 360, 06z/18z -> 144
    run_times = [18, 12, 6, 0]
    
    for day_offset in range(3):
        check_date = (now_utc - timedelta(days=day_offset)).date()
        for rt in run_times:
            step = 360 if rt in (0, 12) else 144
            bufr_file = f"temp_data/ifs_tc_{check_date.strftime('%Y%m%d')}_{rt:02d}.bufr"
            os.makedirs("temp_data", exist_ok=True)
            
            try:
                print(f"Trying {check_date} {rt:02d}z (step={step})...")
                client.retrieve(
                    date=check_date,
                    time=rt,
                    model='ifs',
                    stream='enfo',
                    type='tf',
                    step=step,
                    target=bufr_file
                )
                if os.path.exists(bufr_file) and os.path.getsize(bufr_file) > 0:
                    print(f"Successfully downloaded to {bufr_file}")
                    return bufr_file, check_date.strftime("%Y-%m-%d"), f"{rt:02d}:00:00"
            except Exception as e:
                if os.path.exists(bufr_file):
                    os.remove(bufr_file)
                continue
                
    raise RuntimeError("Failed to find any recent IFS TC track data on Azure mirror.")

def extract_tc_data(filename):
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
    
    # For SpaghettiPlot.jsx, ensemble mean is usually 'sample'=-1, but IFS separates 'oper' vs 'enfo'. 
    # For now, let's keep all members. SpaghettiPlot will plot them all.
    return df

def process_ifs_tc():
    bufr_file, date_str, time_str = download_latest_ifs_tc()
    print("Extracting BUFR data...")
    df = extract_tc_data(bufr_file)
    
    # Filter for valid tracks only (named storms or WP storms can be filtered here if needed, 
    # but the frontend filters by basin automatically based on lat/lon)
    
    os.makedirs("public/data", exist_ok=True)
    out_csv = "public/data/ifs_tc_latest.csv"
    df.to_csv(out_csv, index=False)
    print(f"Saved extracted tracks to {out_csv}")
    
if __name__ == "__main__":
    process_ifs_tc()
