import os
import io
import urllib.request
import re
import pandas as pd
import base64
import time
from datetime import datetime, timedelta, timezone

def parse_atcf_latlon(val_str):
    if not val_str or val_str.strip() == '':
        return float('nan')
    val_str = val_str.strip()
    try:
        num = float(val_str[:-1]) / 10.0
        if val_str[-1] == 'S' or val_str[-1] == 'W':
            num = -num
        return num
    except:
        return float('nan')

def download_and_parse_atcf():
    base_url = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/ens_tracker/prod/"
    now_utc = datetime.now(timezone.utc)
    run_times = ['18', '12', '06', '00']
    
    selected_url = None
    selected_rt = None
    
    # Try to find the latest available cycle by checking up to 4 days back
    for day_offset in range(15):  # check up to 15 days back just in case (e.g. testing with 20260511)
        if selected_url:
            break
        check_date = (now_utc - timedelta(days=day_offset))
        date_str = check_date.strftime('%Y%m%d')
        
        for rt in run_times:
            test_url = f"{base_url}aigefs.{date_str}/{rt}/tctrack/"
            # To verify if it exists, check for the presence of aimn file
            file_test_url = f"{test_url}aimn.t{rt}z.cyclone.trackatcfunix"
            try:
                req = urllib.request.Request(file_test_url, method='HEAD', headers={'User-Agent': 'Mozilla/5.0'})
                urllib.request.urlopen(req, timeout=10)
                selected_url = test_url
                selected_rt = rt
                print(f"Latest available cycle found: {test_url}")
                break
            except Exception as e:
                continue
                
    if not selected_url:
        print("Could not find any available AIGEFS ATCF cycle.")
        return pd.DataFrame()

    print(f"Using tracking URL: {selected_url}")
    
    try:
        req = urllib.request.Request(selected_url, headers={'User-Agent': 'Mozilla/5.0'})
        html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
        files = re.findall(r'href=[\'\"]?([a-zA-Z0-9_.]+\.trackatcfunix)', html)
        files = list(set(files))
    except Exception as e:
        print(f"Could not list directory {selected_url}, error: {e}")
        # Manual fallback list (a000 to a030 and aimn)
        files = [f"a{str(i).zfill(3)}.t{selected_rt}z.cyclone.trackatcfunix" for i in range(31)] + [f"aimn.t{selected_rt}z.cyclone.trackatcfunix"]

    if not files:
        print("No ATCF files found.")
        return pd.DataFrame()

    all_rows = []
    
    for fname in files:
        # We only want the ensemble members and mean, ignore "p" (perturbed?) tracks if any, to keep it standard
        if not re.match(r'^a\d{3}\.', fname) and not fname.startswith('aimn.'):
            continue
            
        file_url = f"{selected_url}{fname}"
        print(f"Downloading {file_url} ...")
        try:
            req = urllib.request.Request(file_url, headers={'User-Agent': 'Mozilla/5.0'})
            content = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
            for line in content.splitlines():
                parts = [p.strip() for p in line.split(',')]
                if len(parts) < 11:
                    continue
                
                basin = parts[0]
                cy = parts[1]
                ymdh = parts[2]
                tech = parts[4] # e.g. A001
                tau = parts[5]
                lat_str = parts[6]
                lon_str = parts[7]
                vmax = parts[8]
                mslp = parts[9]
                
                track_id = f"{basin}{cy}"
                try:
                    init_dt = datetime.strptime(ymdh, "%Y%m%d%H")
                    init_time_str = init_dt.strftime("%Y-%m-%d %H:%M:%S")
                except:
                    init_time_str = ymdh
                
                sample = -1 if 'mn' in tech.lower() else int(re.sub(r'[^0-9]', '', tech)) if re.sub(r'[^0-9]', '', tech) else 0
                
                lat = parse_atcf_latlon(lat_str)
                lon = parse_atcf_latlon(lon_str)
                
                try:
                    lead_time = int(tau)
                except:
                    lead_time = 0
                    
                try:
                    wind = float(vmax)
                except:
                    wind = float('nan')
                    
                try:
                    pressure = float(mslp)
                except:
                    pressure = float('nan')
                    
                all_rows.append({
                    'track_id': track_id,
                    'sample': sample,
                    'init_time': init_time_str,
                    'lead_time_hours': lead_time,
                    'lat': lat,
                    'lon': lon,
                    'minimum_sea_level_pressure_hpa': pressure,
                    'maximum_sustained_wind_speed_knots': wind
                })
        except Exception as e:
            print(f"Failed to fetch or parse {fname}: {e}")
            
    df = pd.DataFrame(all_rows)
    return df

def process_aigefs_tc():
    df = download_and_parse_atcf()
    if df.empty:
        print("No AIGEFS data parsed.")
        return
        
    print(f"Parsed {len(df)} total track points.")
    
    os.makedirs("public/data", exist_ok=True)
    csv_file = "public/data/aigefs_tc_latest.csv"
    enc_file = "public/data/aigefs_tc_latest.dat"
    
    df.to_csv(csv_file, index=False)
    print(f"Saved CSV to {csv_file}")
    
    csv_bytes = df.to_csv(index=False).encode('utf-8')
    key = "CalauanWeather2026".encode('utf-8')
    xored = bytearray([csv_bytes[i] ^ key[i % len(key)] for i in range(len(csv_bytes))])
    b64_str = base64.b64encode(xored).decode('utf-8')
    
    with open(enc_file, 'w', encoding='utf-8') as f:
        f.write(b64_str)
    print(f"Saved encrypted data to {enc_file}")

if __name__ == "__main__":
    process_aigefs_tc()
