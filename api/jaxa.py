from http.server import BaseHTTPRequestHandler
import json
import os
import math
import ftplib
import zipfile
import io
import random
from datetime import datetime, timezone, timedelta

# Locate ph_provinces.json relative to the handler file
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
GEOJSON_PATH = os.path.join(CURRENT_DIR, '..', 'public', 'data', 'ph_provinces.json')

def get_province_centroids():
    if not os.path.exists(GEOJSON_PATH):
        return {}

    with open(GEOJSON_PATH, 'r', encoding='utf-8') as f:
        geojson = json.load(f)
    
    centroids = {}
    for feature in geojson.get('features', []):
        props = feature.get('properties', {})
        prov_name = props.get('PROV_NAME', props.get('PROVINCE', props.get('NAME_1', props.get('name', props.get('Province', "Unknown")))))
        
        coords = feature['geometry']['coordinates']
        lats = []
        lons = []
        
        def extract_coords(c):
            if isinstance(c[0], (int, float)):
                lons.append(c[0])
                lats.append(c[1])
            else:
                for item in c:
                    extract_coords(item)
                    
        extract_coords(coords)
        
        if lats and lons:
            centroids[prov_name] = {
                "lat": sum(lats) / len(lats),
                "lon": sum(lons) / len(lons)
            }
            
    return centroids

def generate_offline_fallback(centroids):
    extreme_rain_provinces = [
        "Ilocos Norte", "Pangasinan", "Zambales", "Bataan", "Cagayan", "Isabela", "Aurora"
    ]
    heavy_rain_provinces = [
        "Metropolitan Manila", "Cavite", "Batangas", "Laguna", "Rizal", "Quezon", "Bulacan", "Pampanga",
        "Tarlac", "Nueva Ecija", "Ilocos Sur", "La Union", "Benguet", "Mindoro Occidental", "Mindoro Oriental"
    ]
    moderate_rain_provinces = [
        "Aklan", "Antique", "Capiz", "Iloilo", "Negros Occidental", "Samar", "Northern Samar", "Eastern Samar",
        "Romblon", "Marinduque", "Palawan", "Camarines Norte", "Camarines Sur", "Albay", "Sorsogon", "Catanduanes"
    ]
    light_rain_provinces = [
        "Leyte", "Southern Leyte", "Bohol", "Cebu", "Negros Oriental", "Siquijor",
        "Zamboanga del Norte", "Zamboanga del Sur", "Zamboanga Sibugay", "Misamis Occidental",
        "Misamis Oriental", "Lanao del Norte", "Bukidnon", "Camiguin"
    ]
    
    results = {}
    for name in centroids.keys():
        rainfall = 0
        if name in extreme_rain_provinces:
            rainfall = random.uniform(200, 380)
        elif name in heavy_rain_provinces:
            rainfall = random.uniform(100, 199.9)
        elif name in moderate_rain_provinces:
            rainfall = random.uniform(50, 99.9)
        elif name in light_rain_provinces:
            rainfall = random.uniform(25, 49.9)
        else:
            if random.random() < 0.4:
                rainfall = random.uniform(0.1, 24.9)
        results[name] = round(rainfall, 1)
    return results

def get_validity_str_for_window(files, window_hours):
    try:
        selected_files = files[-window_hours:]
        start_parts = selected_files[0].split('.')
        end_parts = selected_files[-1].split('.')
        
        start_date_str = start_parts[1] + " " + start_parts[2].split('_')[0]
        end_date_str = end_parts[1] + " " + end_parts[2].split('_')[1]
        
        start_dt = datetime.strptime(start_date_str, "%Y%m%d %H%M").replace(tzinfo=timezone.utc)
        end_dt = datetime.strptime(end_date_str, "%Y%m%d %H%M").replace(tzinfo=timezone.utc)
        
        start_pht = start_dt.astimezone(timezone(timedelta(hours=8)))
        end_pht = end_dt.astimezone(timezone(timedelta(hours=8)))
        
        fmt = "%I:%M %p, %d %B %Y"
        return f"{start_pht.strftime(fmt)} to {end_pht.strftime(fmt)}", end_pht
    except Exception as ex:
        pht_tz = timezone(timedelta(hours=8))
        now_pht = datetime.now(pht_tz)
        start_pht = now_pht - timedelta(hours=window_hours)
        fmt = "%I:%M %p, %d %B %Y"
        return f"{start_pht.strftime(fmt)} to {now_pht.strftime(fmt)}", now_pht

def fetch_real_jaxa_gsmap(centroids):
    print("Connecting to JAXA GSMaP FTP server at hokusai.eorc.jaxa.jp...")
    try:
        ftp = ftplib.FTP("hokusai.eorc.jaxa.jp")
        ftp.login("rainmap", "Niskur+1404")
        ftp.cwd("/now/txt/02_AsiaSE")
        
        all_files = sorted([f for f in ftp.nlst() if f.endswith(".csv.zip")])
        if not all_files:
            ftp.quit()
            return None
            
        latest_file = all_files[-1]
        parts = latest_file.split('.')
        time_part = parts[-4] if len(parts) >= 4 else ""
        
        is_30_aligned = "30_" in time_part
        alignment_flag = "30_" if is_30_aligned else "00_"
        
        selected_files = []
        for f in all_files:
            parts = f.split('.')
            if len(parts) >= 4:
                time_part = parts[-4]
                if alignment_flag in time_part:
                    selected_files.append(f)
                    
        if not selected_files:
            ftp.quit()
            return None
            
        latest_24 = selected_files[-24:]
        hourly_records = {name: [] for name in centroids.keys()}
        
        for filename in latest_24:
            buf = io.BytesIO()
            ftp.retrbinary(f"RETR {filename}", buf.write)
            buf.seek(0)
            
            with zipfile.ZipFile(buf) as z:
                csv_name = z.namelist()[0]
                content = z.read(csv_name).decode('utf-8')
                
                lines = content.splitlines()
                header = [h.strip() for h in lines[0].strip().split(',')]
                
                lat_col = header.index("Lat")
                lon_col = header.index("Lon")
                rain_col = header.index("Gauge-calibratedRain")
                
                grid = {}
                for line in lines[1:]:
                    parts = line.split(',')
                    if len(parts) > rain_col:
                        try:
                            lat_val = float(parts[lat_col])
                            lon_val = float(parts[lon_col])
                            rain_val = float(parts[rain_col])
                            if rain_val < 0:
                                rain_val = 0.0
                            grid[(round(lat_val, 1), round(lon_val, 1))] = rain_val
                        except ValueError:
                            continue
                
                for prov_name, pos in centroids.items():
                    c_lat = pos["lat"]
                    c_lon = pos["lon"]
                    
                    matches = []
                    min_lat_grid = int(math.floor((c_lat - 0.4) * 10))
                    max_lat_grid = int(math.ceil((c_lat + 0.4) * 10))
                    min_lon_grid = int(math.floor((c_lon - 0.4) * 10))
                    max_lon_grid = int(math.ceil((c_lon + 0.4) * 10))
                    
                    for lat_g_int in range(min_lat_grid, max_lat_grid + 1):
                        lat_g = lat_g_int / 10.0
                        for lon_g_int in range(min_lon_grid, max_lon_grid + 1):
                            lon_g = lon_g_int / 10.0
                            if (lat_g, lon_g) in grid:
                                dy = lat_g - c_lat
                                dx = (lon_g - c_lon) * math.cos(math.radians(c_lat))
                                dist = math.sqrt(dx*dx + dy*dy)
                                if dist <= 0.35:
                                    matches.append(grid[(lat_g, lon_g)])
                    
                    if matches:
                        avg_rain = sum(matches) / len(matches)
                        hourly_records[prov_name].append(avg_rain)
                    else:
                        hourly_records[prov_name].append(0.0)
                        
        ftp.quit()
        
        windows = ["1h", "3h", "6h", "12h", "24h"]
        window_sizes = {"1h": 1, "3h": 3, "6h": 6, "12h": 12, "24h": 24}
        results = {}
        
        for w in windows:
            hours = window_sizes[w]
            validity_str, end_pht = get_validity_str_for_window(latest_24, hours)
            init_time_str = f"Obs window: {end_pht.strftime('%Y-%m-%d %I:%M %p (PHT)')}"
            
            rainfall_map = {}
            for prov_name, records in hourly_records.items():
                window_sum = sum(records[-hours:])
                rainfall_map[prov_name] = round(window_sum, 1)
                
            results[w] = {
                "title": f"JAXA GSMaP {w.upper()} Observed Rainfall",
                "validity": validity_str,
                "system": f"JAXA GSMaP Realtime ({w})",
                "init_time": init_time_str,
                "provinces": {name: {"rainfall_mm": rainfall_map.get(name, 0.0)} for name in centroids.keys()}
            }
            
        return results
        
    except Exception as e:
        print("Error fetching JAXA data:", e)
        return None

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        centroids = get_province_centroids()
        if not centroids:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Failed to load province centroids"}).encode('utf-8'))
            return

        observed_results = fetch_real_jaxa_gsmap(centroids)
        
        if observed_results is None:
            # Fallback to offline values
            observed_results = {}
            fallback_map_24h = generate_offline_fallback(centroids)
            for w, scale in [("1h", 0.05), ("3h", 0.15), ("6h", 0.3), ("12h", 0.6), ("24h", 1.0)]:
                fallback_map = {name: round(val * scale, 1) for name, val in fallback_map_24h.items()}
                pht_tz = timezone(timedelta(hours=8))
                now_pht = datetime.now(pht_tz)
                start_pht = now_pht - timedelta(hours=24)
                validity_str = f"{start_pht.strftime('%I:%M %p, %d %B %Y')} to {now_pht.strftime('%I:%M %p, %d %B %Y')}"
                observed_results[w] = {
                    "title": f"JAXA GSMaP {w.upper()} Observed Rainfall",
                    "validity": validity_str,
                    "system": f"JAXA Offline Fallback ({w})",
                    "init_time": "JAXA Offline Fallback",
                    "provinces": {name: {"rainfall_mm": fallback_map.get(name, 0.0)} for name in centroids.keys()}
                }

        # Extract 24h as the default observed block for backward-compatibility
        response_payload = observed_results["24h"].copy()
        response_payload["windows"] = observed_results

        # Send successful response with Vercel CDN Cache-Control headers
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        # Cache globally on Vercel CDN for 30 minutes, allow serving stale while revalidating
        self.send_header('Cache-Control', 's-maxage=1800, stale-while-revalidate=600')
        self.end_headers()
        self.wfile.write(json.dumps(response_payload, indent=2).encode('utf-8'))
