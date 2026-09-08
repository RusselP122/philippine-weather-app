import os
import json
import requests
import datetime
from dateutil import parser
import re
import hmac
import hashlib
import time
import secrets
import warnings

warnings.filterwarnings("ignore", category=UserWarning)

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.image as mpimg
import matplotlib.patches as patches
from matplotlib.patches import FancyBboxPatch
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import shapely
from shapely.geometry import shape, box, Point, Polygon, MultiPolygon
from shapely.validation import make_valid
from shapely.ops import unary_union

GEOJSON_PATH = "public/data/ph_provinces.json"
OUTPUT_PATH = "public/facebook_alert_post.png"
LOGO_PATHS = [
    os.path.join(os.getcwd(), "public", "images", "logo.png"),
    os.path.join(os.getcwd(), "public", "logo512.png"),
    os.path.join(os.getcwd(), "public", "logo192.png")
]

# Regional Definitions with Exact 16:9 Aspect Ratio Extents (matching ai_precip_outlook.py)
BROADCAST_REGIONS = {
    "luzon": {
        "title": "LUZON",
        "extent": [114.46, 127.94, 12.0, 19.3],
    },
    "visayas": {
        "title": "VISAYAS",
        "extent": [120.08, 127.32, 9.0, 13.0],
    },
    "mindanao": {
        "title": "MINDANAO",
        "extent": [120.02, 128.98, 5.2, 10.2],
    }
}

# Color mappings (matching ai_precip_outlook.py and PAGASA levels)
COLORS = {
    'red': '#ef4444',
    'orange': '#f97316',
    'yellow': '#facc15',
    'affecting': '#38bdf8',
    'expecting': '#10b981',
    'default': '#25342a',
    'bg': '#0d1821',
}

def parse_warning_level(text):
    text = str(text).lower()
    if 'red' in text: return 'red'
    if 'orange' in text: return 'orange'
    if 'yellow' in text: return 'yellow'
    return None

def normalize_provinces(provinces_data):
    if not provinces_data:
        return []
    if isinstance(provinces_data, list):
        return provinces_data
    if isinstance(provinces_data, dict):
        return [v for k, v in provinces_data.items() if isinstance(v, dict)]
    return []

def extract_cookies(res, existing=None):
    cookie_map = dict(existing) if existing else {}
    set_cookies = res.raw.headers.getlist('Set-Cookie') if hasattr(res, 'raw') and hasattr(res.raw, 'headers') and hasattr(res.raw.headers, 'getlist') else []
    if not set_cookies and 'set-cookie' in res.headers:
        raw_header = res.headers.get('set-cookie', '')
        for m in re.finditer(r'(?:^|,\s*)([a-zA-Z0-9_\-]+)=([^;]+?)(?=;|,|\s*$)', raw_header):
            name, val = m.group(1).strip(), m.group(2).strip()
            if name.lower() not in ['expires', 'path', 'domain', 'samesite', 'max-age', 'secure', 'httponly']:
                cookie_map[name] = f"{name}={val}"
    else:
        for sc in set_cookies:
            part = sc.split(';')[0].strip()
            eq_idx = part.find('=')
            if eq_idx > 0:
                name = part[:eq_idx].strip()
                cookie_map[name] = part
    return cookie_map

def get_signed_headers(api_sig_secret, csrf_token, cookie_header, pathname, base_url):
    ts = str(int(time.time()))
    nonce = secrets.token_hex(16)
    string_to_sign = f"GET\n{pathname}\n{ts}\n{nonce}".encode("utf-8")
    sig = hmac.new(api_sig_secret.encode("utf-8"), string_to_sign, hashlib.sha256).hexdigest()
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9,fil;q=0.8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": f"{base_url}/",
        "Origin": base_url,
        "Cookie": cookie_header,
        "X-CSRF-TOKEN": csrf_token,
        "X-Ts": ts,
        "X-Nonce": nonce,
        "X-Sig": sig,
    }

def get_alerts():
    base_candidates = ["https://panahon.gov.ph", "https://www.panahon.gov.ph"]
    data = None
    last_error = None

    for base in base_candidates:
        try:
            home = requests.get(
                f"{base}/",
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
                timeout=12
            )
            if not home.ok:
                continue

            cookie_map = extract_cookies(home)
            csrf_match = re.search(r'<meta name="csrf-token" content="([^"]+)"', home.text)
            api_sig_match = re.search(r'<meta name="api-sig" content="([^"]+)"', home.text)
            api_sig_handle_match = re.search(r'<meta name="api-sig-handle" content="([^"]+)"', home.text)

            csrf_token = csrf_match.group(1) if csrf_match else None
            api_sig_secret = api_sig_match.group(1) if api_sig_match else None
            api_sig_handle = api_sig_handle_match.group(1) if api_sig_handle_match else None

            if not csrf_token:
                continue

            # Exchange api-sig-handle if secret is not directly embedded
            if not api_sig_secret and api_sig_handle:
                sig_url = f"{base}/api/v1/sig?token={csrf_token}"
                sig_res = requests.get(
                    sig_url,
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Cookie": "; ".join(cookie_map.values()),
                        "X-Sig-Handle": api_sig_handle,
                        "Referer": f"{base}/",
                    },
                    timeout=12
                )
                if sig_res.ok:
                    cookie_map = extract_cookies(sig_res, cookie_map)
                    try:
                        sig_json = sig_res.json()
                        api_sig_secret = sig_json.get("secret")
                    except Exception:
                        pass

            if not api_sig_secret:
                continue

            cookie_header = "; ".join(cookie_map.values())

            # Acquire asset-ticket
            asset_res = requests.get(
                f"{base}/api/v1/asset-ticket?token={csrf_token}",
                headers=get_signed_headers(api_sig_secret, csrf_token, cookie_header, "api/v1/asset-ticket", base),
                timeout=12
            )
            if asset_res.ok:
                cookie_map = extract_cookies(asset_res, cookie_map)
                cookie_header = "; ".join(cookie_map.values())

            # Fetch live CAP alerts
            alerts_url = f"{base}/api/v1/cap-alerts?token={csrf_token}"
            alerts_res = requests.get(
                alerts_url,
                headers=get_signed_headers(api_sig_secret, csrf_token, cookie_header, "api/v1/cap-alerts", base),
                timeout=15
            )
            alerts_res.raise_for_status()
            data = alerts_res.json()

            # Sanitize alerts: remove defacement scripts and dummy notes
            if data and isinstance(data.get("data"), dict) and isinstance(data["data"].get("alert_data"), list):
                data["data"]["alert_data"] = [
                    a for a in data["data"]["alert_data"]
                    if a and not (
                        "<script" in str(a.get("headline", "")) or
                        "<script" in str(a.get("message", "")) or
                        (a.get("event") == "NOTE" and a.get("subtype") == "NOTE")
                    )
                ]

            # Cache freshly fetched alerts to public/data/cap_alerts.json
            try:
                os.makedirs("public/data", exist_ok=True)
                with open("public/data/cap_alerts.json", "w", encoding="utf-8") as cf:
                    json.dump(data, cf, ensure_ascii=False, indent=2)
            except Exception:
                pass

            break
        except Exception as e:
            last_error = e

    if not data:
        print(f"Warning: Failed to fetch live alerts ({last_error}). Falling back to cached cap_alerts.json if available.")
        if os.path.exists("public/data/cap_alerts.json"):
            with open("public/data/cap_alerts.json", "r", encoding="utf-8") as f:
                data = json.load(f)
        else:
            data = {"data": {"alert_data": []}}
    
    alerts = data.get('data', {}).get('alert_data', [])
    filtered_alerts = []
    now = datetime.datetime.now(datetime.timezone.utc)
    
    for a in alerts:
        if not a: continue
        
        event = str(a.get('event', '')).upper()
        type_ = str(a.get('type', '')).upper()
        headline = str(a.get('headline', ''))
        
        event_lower = event.lower()
        subtype_lower = str(a.get('subtype', '')).lower()
        message_lower = str(a.get('message', '')).lower()
        headline_lower = headline.lower()
        
        if 'general flood advisory' in headline_lower or 'general flood advisory' in subtype_lower or 'general flood advisory' in event_lower:
            continue
        if 'thunderstorm information' in headline_lower or 'thunderstorm information' in subtype_lower or 'thunderstorm information' in event_lower:
            continue
        if 'thunderstorm watch' in headline_lower or 'thunderstorm watch' in subtype_lower or 'thunderstorm watch' in event_lower:
            continue
        if 'tropical cyclone' in headline_lower or 'tropical cyclone' in event_lower or 'tropical cyclone' in subtype_lower or 'signal no.' in headline_lower or 'signal no.' in message_lower or 'tcws' in headline_lower:
            continue
            
        if 'final' in subtype_lower:
            continue
            
        if event == "THUNDERSTORM" or type_ == "THUNDERSTORM":
            continue
            
        is_rainfall_related = (
            event == "RAINFALL" or
            event == "FLOOD" or
            'flood' in subtype_lower or
            'rain' in message_lower
        )
        
        if not is_rainfall_related:
            continue
            
        # Check expiry
        if a.get('expires'):
            try:
                expires_dt = parser.parse(a['expires'])
                if expires_dt.tzinfo is None:
                    expires_dt = expires_dt.replace(tzinfo=datetime.timezone(datetime.timedelta(hours=8)))
                if expires_dt < now:
                    continue
            except Exception:
                pass
                
        if a.get('issued_date'):
            try:
                issued_dt = parser.parse(a['issued_date'])
                if issued_dt.tzinfo is None:
                    issued_dt = issued_dt.replace(tzinfo=datetime.timezone(datetime.timedelta(hours=8)))
                diff = (now - issued_dt).total_seconds()
                if diff < -300 or diff > 4 * 3600:
                    continue
            except Exception:
                pass
        
        filtered_alerts.append(a)
        
    return filtered_alerts

def polygon_str_to_shapely(poly_str):
    if not poly_str or not isinstance(poly_str, str): return None
    try:
        parts = poly_str.strip().split()
        ring = []
        for p in parts:
            if ',' in p:
                lat_str, lon_str = p.split(',')
                ring.append((float(lon_str), float(lat_str)))
        if len(ring) >= 3:
            return Polygon(ring)
    except Exception:
        pass
    return None

def shape_str_to_shapely(shape_str):
    if not shape_str or not isinstance(shape_str, str): return None
    try:
        coords_data = json.loads(shape_str)
        if not isinstance(coords_data, list) or len(coords_data) == 0:
            return None

        def get_depth(c):
            if isinstance(c, (list, tuple)) and len(c) > 0:
                return 1 + get_depth(c[0])
            return 0

        depth = get_depth(coords_data)

        # Depth 2: [[lat, lon], [lat, lon], ...] -> Single Ring
        if depth == 2:
            pts = [(p[1], p[0]) for p in coords_data if len(p) >= 2]
            if len(pts) >= 3:
                return make_valid(Polygon(pts))

        # Depth 3: [[[lat, lon], ...], [interior ring...]] -> Polygon with rings
        elif depth == 3:
            rings = []
            for ring in coords_data:
                pts = [(p[1], p[0]) for p in ring if len(p) >= 2]
                if len(pts) >= 3:
                    rings.append(pts)
            if rings:
                return make_valid(Polygon(rings[0], rings[1:]))

        # Depth 4: [[[[lat, lon], ...]]]] -> MultiPolygon
        elif depth == 4:
            polys = []
            for poly_rings in coords_data:
                rings = []
                for ring in poly_rings:
                    pts = [(p[1], p[0]) for p in ring if len(p) >= 2]
                    if len(pts) >= 3:
                        rings.append(pts)
                if rings:
                    polys.append(Polygon(rings[0], rings[1:]))
            if len(polys) == 1:
                return make_valid(polys[0])
            elif len(polys) > 1:
                return make_valid(MultiPolygon(polys))

    except Exception:
        pass
    return None

def load_regional_geometries():
    LUZON_REGIONS = [
        'Bicol Region (Region V)', 'CALABARZON (Region IV-A)', 'Cagayan Valley (Region II)',
        'Central Luzon (Region III)', 'Cordillera Administrative Region (CAR)',
        'Ilocos Region (Region I)', 'MIMAROPA (Region IV-B)', 'Metropolitan Manila'
    ]
    VISAYAS_REGIONS = [
        'Central Visayas (Region VII)', 'Eastern Visayas (Region VIII)', 'Western Visayas (Region VI)'
    ]
    MINDANAO_REGIONS = [
        'Autonomous Region of Muslim Mindanao (ARMM)', 'Caraga (Region XIII)',
        'Davao Region (Region XI)', 'Northern Mindanao (Region X)',
        'SOCCSKSARGEN (Region XII)', 'Zamboanga Peninsula (Region IX)'
    ]

    all_provs = []
    luzon_main_geoms = []
    palawan_geoms = []
    batanes_babuyan_geoms = []
    visayas_geoms = []
    mindanao_geoms = []
    prov_lookup = {}

    bb_box = box(120.8, 18.7, 122.6, 21.4)
    with open(GEOJSON_PATH, "r", encoding="utf-8") as f:
        geo_data = json.load(f)

    for feat in geo_data["features"]:
        reg = feat["properties"].get("REGION", "")
        pname = feat["properties"].get("NAME_1", feat["properties"].get("PROVINCE", ""))
        geom = make_valid(shape(feat["geometry"]))
        all_provs.append(geom)

        clean_pname = pname.strip().lower()
        if 'manila' in clean_pname: clean_pname = 'metropolitan manila'
        prov_lookup[clean_pname] = geom

        if reg in LUZON_REGIONS:
            if pname.lower() == "palawan":
                palawan_geoms.append(geom)
            elif pname.lower() == "batanes":
                batanes_babuyan_geoms.append(geom)
            elif pname.lower() == "cagayan":
                babuyan_part = geom.intersection(bb_box)
                cagayan_main = geom.difference(bb_box)
                if not babuyan_part.is_empty:
                    batanes_babuyan_geoms.append(babuyan_part)
                if not cagayan_main.is_empty:
                    luzon_main_geoms.append(cagayan_main)
            else:
                luzon_main_geoms.append(geom)
        elif reg in VISAYAS_REGIONS:
            visayas_geoms.append(geom)
        elif reg in MINDANAO_REGIONS:
            mindanao_geoms.append(geom)

    return {
        "all": all_provs,
        "luzon_main": luzon_main_geoms,
        "palawan": palawan_geoms,
        "batanes_babuyan": batanes_babuyan_geoms,
        "visayas": visayas_geoms,
        "mindanao": mindanao_geoms,
        "prov_lookup": prov_lookup
    }

def get_ph_lakes():
    """
    Extracts the exact geometry of Laguna de Bay and Taal Lake directly from ph_provinces.json
    so inland water bodies match the surrounding province boundaries with 100% precision
    and are never covered by rainfall alert colors.
    """
    try:
        with open(GEOJSON_PATH, "r", encoding="utf-8") as f:
            geo_data = json.load(f)

        target_provs = ['Batangas', 'Cavite', 'Laguna', 'Rizal', 'Metropolitan Manila', 'Quezon', 'Bulacan']
        calabarzon_geoms = []
        for f in geo_data.get("features", []):
            pname = f.get("properties", {}).get("NAME_1") or f.get("properties", {}).get("PROVINCE")
            if pname in target_provs:
                calabarzon_geoms.append(make_valid(shape(f["geometry"])))

        if not calabarzon_geoms:
            return None

        u_calabarzon = unary_union(calabarzon_geoms)

        bay_box = box(121.0, 14.15, 121.5, 14.55)
        taal_box = box(120.9, 13.90, 121.1, 14.10)

        laguna_de_bay = bay_box.difference(u_calabarzon)
        taal_lake = taal_box.difference(u_calabarzon)

        lakes = []
        if not laguna_de_bay.is_empty:
            lakes.append(laguna_de_bay)
        if not taal_lake.is_empty:
            lakes.append(taal_lake)

        if lakes:
            return unary_union(lakes)
    except Exception as e:
        print(f"Notice loading inland lakes: {e}")
        return None

def main():
    print("Loading geographic data...")
    if not os.path.exists(GEOJSON_PATH):
        print(f"Error: Could not find {GEOJSON_PATH}")
        return
        
    geoms_dict = load_regional_geometries()
    u_lakes = get_ph_lakes()
    
    print("Fetching alerts...")
    alerts = get_alerts()
    print(f"Found {len(alerts)} active alerts.")
    
    # Collect alert shapes
    alert_shapes = []
    
    for alert in alerts:
        provinces = normalize_provinces(alert.get('provinces'))
        for prov in provinces:
            province_name = prov.get('province') or prov.get('areaDesc')
            municipality_name = prov.get('municipality')
            name = municipality_name if municipality_name else province_name
            if not name: continue
            
            area_type = str(prov.get('type', '')).lower()
            
            warning_level = None
            if area_type in ['yellow', 'orange', 'red']:
                warning_level = area_type
            else:
                level_text = f"{prov.get('headline','')} {prov.get('description','')} {alert.get('headline','')} {alert.get('description','')} {alert.get('subtype','')}"
                warning_level = parse_warning_level(level_text)
                
            if warning_level in ['red', 'orange', 'yellow']:
                color = COLORS[warning_level]
            elif area_type in ['affecting', 'light-moderate', 'light moderate', 'moderate']:
                color = COLORS['affecting']
            elif area_type in ['expecting', 'expected']:
                color = COLORS['expecting']
            else:
                color = COLORS['affecting']
                
            geom = None
            if prov.get('shape'):
                geom = shape_str_to_shapely(prov.get('shape'))
            if not geom and prov.get('polygon'):
                geom = polygon_str_to_shapely(prov.get('polygon'))
                
            color_label = None
            if color == COLORS['red']: color_label = '🔴 RED WARNING'
            elif color == COLORS['orange']: color_label = '🟠 ORANGE WARNING'
            elif color == COLORS['yellow']: color_label = '🟡 YELLOW ADVISORY'
            elif color == COLORS['affecting']: color_label = '🟦 AFFECTING'
            elif color == COLORS['expecting']: color_label = '🟩 EXPECTING'

            priority_map = {'#ef4444': 5, '#f97316': 4, '#facc15': 3, '#38bdf8': 2, '#10b981': 1}
            priority = priority_map.get(color, 0)

            if geom and not geom.is_empty:
                alert_shapes.append({
                    'name': name,
                    'province': province_name,
                    'municipality': municipality_name,
                    'color_label': color_label,
                    'geometry': geom,
                    'color': color,
                    'priority': priority
                })
            elif not municipality_name:
                # Fallback to province lookup geometry ONLY if it's a province-wide alert without municipality
                c_prov = str(province_name or '').strip().lower()
                if 'manila' in c_prov: c_prov = 'metropolitan manila'
                matched_geom = geoms_dict["prov_lookup"].get(c_prov)
                if matched_geom:
                    alert_shapes.append({
                        'name': name,
                        'province': province_name,
                        'municipality': municipality_name,
                        'color_label': color_label,
                        'geometry': matched_geom,
                        'color': color,
                        'priority': priority
                    })

    if not alert_shapes:
        print("No active rainfall alerts found. No images will be generated.")
        return

    # Sort shapes by priority so higher priority warnings render on top
    alert_shapes.sort(key=lambda x: x['priority'])

    # Determine which island groups have active alerts
    u_luzon = unary_union(geoms_dict["luzon_main"] + geoms_dict["palawan"] + geoms_dict["batanes_babuyan"])
    u_visayas = unary_union(geoms_dict["visayas"])
    u_mindanao = unary_union(geoms_dict["mindanao"])

    active_groups = set()
    for shape_item in alert_shapes:
        geom = shape_item['geometry']
        assigned_group = None
        if geom.intersects(u_luzon):
            assigned_group = "Luzon"
        elif geom.intersects(u_visayas):
            assigned_group = "Visayas"
        elif geom.intersects(u_mindanao):
            assigned_group = "Mindanao"
        else:
            # Fallback to centroid proximity
            c = geom.centroid
            d_luz = u_luzon.distance(c)
            d_vis = u_visayas.distance(c)
            d_min = u_mindanao.distance(c)
            min_d = min(d_luz, d_vis, d_min)
            if min_d == d_luz: assigned_group = "Luzon"
            elif min_d == d_vis: assigned_group = "Visayas"
            else: assigned_group = "Mindanao"
            
        shape_item['island_group'] = assigned_group
        active_groups.add(assigned_group)

    # Extract weather system headline
    alert_msg = str(alerts[0].get('message', '')).upper() if alerts else ''
    alert_hdln = str(alerts[0].get('headline', 'WEATHER ADVISORY')).upper() if alerts else 'WEATHER ADVISORY'
    combined_text = (alert_msg + " " + alert_hdln).upper()

    found_systems = []
    tc_match = re.search(r'(SUPER TYPHOON|TYPHOON|SEVERE TROPICAL STORM|TROPICAL STORM|TROPICAL DEPRESSION|TROPICAL CYCLONE)\s+["\']?([A-Z-]{3,})["\']?', combined_text)
    if tc_match:
        tc_type = tc_match.group(1).title()
        tc_name = tc_match.group(2).upper()
        found_systems.append(f"{tc_type} {tc_name}")
    else:
        if 'SUPER TYPHOON' in combined_text: found_systems.append("Super Typhoon")
        elif 'TYPHOON' in combined_text: found_systems.append("Typhoon")
        elif 'SEVERE TROPICAL STORM' in combined_text: found_systems.append("Severe Tropical Storm")
        elif 'TROPICAL STORM' in combined_text: found_systems.append("Tropical Storm")
        elif 'TROPICAL DEPRESSION' in combined_text: found_systems.append("Tropical Depression")
        elif 'TROPICAL CYCLONE' in combined_text: found_systems.append("Tropical Cyclone")

    if 'SOUTHWEST MONSOON' in combined_text or 'HABAGAT' in combined_text:
        found_systems.append("Southwest Monsoon (Habagat)")
    if 'LOW PRESSURE AREA' in combined_text or ' LPA ' in combined_text:
        found_systems.append("Low Pressure Area")
    if 'NORTHEAST MONSOON' in combined_text or 'AMIHAN' in combined_text:
        found_systems.append("Northeast Monsoon (Amihan)")
    if 'SHEAR LINE' in combined_text or 'TAIL-END' in combined_text:
        found_systems.append("Shear Line")
    if 'INTERTROPICAL' in combined_text or 'ITCZ' in combined_text:
        found_systems.append("Intertropical Convergence Zone")
    if 'TROUGH' in combined_text:
        found_systems.append("Trough of LPA")

    if found_systems:
        latest_headline = " and ".join(found_systems) if len(found_systems) <= 2 else found_systems[0]
    else:
        sys_match = re.search(r'(?:due to|brought by|associated with)\s+(.*)', alert_hdln, re.IGNORECASE)
        latest_headline = sys_match.group(1).strip() if sys_match else alert_hdln

    latest_headline = latest_headline.replace('\n', ' ').strip()
    pst = datetime.timezone(datetime.timedelta(hours=8))
    issued_time_str = datetime.datetime.now(pst).strftime("%I:%M %p, %d %B %Y (%A)")

    # ── Render TV Broadcast Map for each active region ────────────────────────
    for target_group in ["Luzon", "Visayas", "Mindanao"]:
        if target_group not in active_groups:
            print(f"No alerts in {target_group}. Skipping.")
            continue

        print(f"Rendering broadcast map for {target_group}...")
        region_key = target_group.lower()
        region_info = BROADCAST_REGIONS[region_key]
        target_alerts = [s for s in alert_shapes if s.get('island_group') == target_group]

        # 16:9 Widescreen TV Broadcast Canvas
        fig = plt.figure(figsize=(16, 9), dpi=200)
        fig.patch.set_facecolor(COLORS['bg'])

        # Main map axis
        ax = fig.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree())
        ax.set_extent(region_info["extent"], crs=ccrs.PlateCarree())

        # Deep Navy Ocean & Dark Slate-Olive Land (matching ai_precip_outlook.py)
        ax.add_feature(cfeature.OCEAN, facecolor='#162533', zorder=0)
        ax.add_feature(cfeature.LAND, facecolor='#25342a', zorder=1)

        # Base province boundaries & coastlines
        if "all" in geoms_dict:
            ax.add_geometries(geoms_dict["all"], crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#475569', linewidth=0.8, alpha=0.85, zorder=3)
        ax.add_feature(cfeature.COASTLINE, linewidth=1.3, edgecolor='#0f172a', zorder=4)

        # Plot alert shapes (with lakes subtracted so water bodies like Taal and Laguna de Bay are not colored)
        for s in sorted(target_alerts, key=lambda x: x['priority']):
            geom = s['geometry']
            if u_lakes and not u_lakes.is_empty:
                try:
                    diff_geom = geom.difference(u_lakes)
                    if not diff_geom.is_empty:
                        geom = diff_geom
                except Exception:
                    pass
            ax.add_geometries([geom], crs=ccrs.PlateCarree(), facecolor=s['color'], edgecolor='#ffffff', linewidth=0.75, alpha=0.92, zorder=5)

        # Re-draw and outline lakes in exact Ocean color on top of alerts (zorder=6 & 7)
        if u_lakes and not u_lakes.is_empty:
            ax.add_geometries([u_lakes], crs=ccrs.PlateCarree(), facecolor='#162533', edgecolor='#0f172a', linewidth=1.2, zorder=6)
            ax.add_geometries([u_lakes], crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#475569', linewidth=0.8, zorder=7)

        # ── Dedicated Inset Mini-Maps on Luzon View (Only if Active Advisories) ──
        if region_key == "luzon":
            pal_bbox = box(116.6, 8.2, 120.5, 12.5)
            u_palawan = unary_union(geoms_dict["palawan"]) if geoms_dict.get("palawan") else None
            palawan_alerts = [
                s for s in target_alerts
                if (s.get('province', '').lower() == 'palawan') or
                   (u_palawan and s['geometry'].intersects(u_palawan)) or
                   (s['geometry'].intersects(pal_bbox))
            ]

            bb_bbox = box(120.9, 18.7, 122.6, 21.2)
            u_bb = unary_union(geoms_dict["batanes_babuyan"]) if geoms_dict.get("batanes_babuyan") else None
            bb_alerts = [
                s for s in target_alerts
                if (s.get('province', '').lower() == 'batanes') or
                   (u_bb and s['geometry'].intersects(u_bb)) or
                   (s['geometry'].intersects(bb_bbox))
            ]

            # 1. Palawan Inset (Bottom-Left - Only if active alert in Palawan)
            if palawan_alerts:
                inset_pal_rect = [0.03, 0.05, 0.27, 0.48]
                inset_pal_bg = FancyBboxPatch((inset_pal_rect[0]-0.005, inset_pal_rect[1]-0.005), inset_pal_rect[2]+0.01, inset_pal_rect[3]+0.01,
                                              boxstyle='round,pad=0.005,rounding_size=0.012', transform=fig.transFigure,
                                              facecolor='#0b131a', edgecolor='#38bdf8', lw=1.5, zorder=30)
                fig.patches.append(inset_pal_bg)

                palawan_title_pill = FancyBboxPatch((inset_pal_rect[0] + 0.01, inset_pal_rect[1] + inset_pal_rect[3] - 0.045), 0.12, 0.035,
                                                    boxstyle='round,pad=0.005,rounding_size=0.008', transform=fig.transFigure,
                                                    facecolor='#0369a1', edgecolor='none', zorder=32)
                fig.patches.append(palawan_title_pill)
                fig.text(inset_pal_rect[0] + 0.07, inset_pal_rect[1] + inset_pal_rect[3] - 0.028, 'PALAWAN',
                         fontsize=11, fontweight='heavy', color='#ffffff', ha='center', va='center', zorder=33)

                ax_pal = fig.add_axes(inset_pal_rect, projection=ccrs.PlateCarree(), zorder=31)
                ax_pal.set_extent([116.6, 120.5, 8.2, 12.5], crs=ccrs.PlateCarree())
                ax_pal.add_feature(cfeature.OCEAN, facecolor='#162533', zorder=0)
                ax_pal.add_feature(cfeature.LAND, facecolor='#25342a', zorder=1)
                if "palawan" in geoms_dict:
                    ax_pal.add_geometries(geoms_dict["palawan"], crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#475569', linewidth=0.8, alpha=0.85, zorder=3)
                ax_pal.add_feature(cfeature.COASTLINE, linewidth=1.2, edgecolor='#0f172a', zorder=4)

                for s in sorted(palawan_alerts, key=lambda x: x['priority']):
                    geom = s['geometry']
                    if u_lakes and not u_lakes.is_empty:
                        try:
                            diff_geom = geom.difference(u_lakes)
                            if not diff_geom.is_empty:
                                geom = diff_geom
                        except Exception:
                            pass
                    ax_pal.add_geometries([geom], crs=ccrs.PlateCarree(), facecolor=s['color'], edgecolor='#ffffff', linewidth=0.7, alpha=0.92, zorder=5)

            # 2. Batanes & Babuyan Inset (Upper-Right - Only if active alert in Batanes/Babuyan)
            if bb_alerts:
                inset_bb_rect = [0.70, 0.36, 0.27, 0.50]
                inset_bb_bg = FancyBboxPatch((inset_bb_rect[0]-0.005, inset_bb_rect[1]-0.005), inset_bb_rect[2]+0.01, inset_bb_rect[3]+0.01,
                                             boxstyle='round,pad=0.005,rounding_size=0.012', transform=fig.transFigure,
                                             facecolor='#0b131a', edgecolor='#38bdf8', lw=1.5, zorder=30)
                fig.patches.append(inset_bb_bg)

                bb_title_pill = FancyBboxPatch((inset_bb_rect[0] + 0.01, inset_bb_rect[1] + inset_bb_rect[3] - 0.045), 0.22, 0.035,
                                               boxstyle='round,pad=0.005,rounding_size=0.008', transform=fig.transFigure,
                                               facecolor='#0369a1', edgecolor='none', zorder=32)
                fig.patches.append(bb_title_pill)
                fig.text(inset_bb_rect[0] + 0.12, inset_bb_rect[1] + inset_bb_rect[3] - 0.028, 'BATANES & BABUYAN',
                         fontsize=10.5, fontweight='heavy', color='#ffffff', ha='center', va='center', zorder=33)

                ax_bb = fig.add_axes(inset_bb_rect, projection=ccrs.PlateCarree(), zorder=31)
                ax_bb.set_extent([120.9, 122.6, 18.7, 21.2], crs=ccrs.PlateCarree())
                ax_bb.add_feature(cfeature.OCEAN, facecolor='#162533', zorder=0)
                ax_bb.add_feature(cfeature.LAND, facecolor='#25342a', zorder=1)
                if "batanes_babuyan" in geoms_dict:
                    ax_bb.add_geometries(geoms_dict["batanes_babuyan"], crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#475569', linewidth=0.8, alpha=0.85, zorder=3)
                ax_bb.add_feature(cfeature.COASTLINE, linewidth=1.2, edgecolor='#0f172a', zorder=4)

                for s in sorted(bb_alerts, key=lambda x: x['priority']):
                    geom = s['geometry']
                    if u_lakes and not u_lakes.is_empty:
                        try:
                            diff_geom = geom.difference(u_lakes)
                            if not diff_geom.is_empty:
                                geom = diff_geom
                        except Exception:
                            pass
                    ax_bb.add_geometries([geom], crs=ccrs.PlateCarree(), facecolor=s['color'], edgecolor='#ffffff', linewidth=0.7, alpha=0.92, zorder=5)

        # ── Top Broadcast Header Banner ──────────────────────────────────────
        header_bg = patches.Rectangle((0, 0.88), 1, 0.12, transform=fig.transFigure, facecolor='#0b131a', alpha=0.96, zorder=40)
        fig.patches.append(header_bg)

        # Title Banner Pill
        title_pill = FancyBboxPatch((0.21, 0.932), 0.40, 0.052, boxstyle='round,pad=0.01,rounding_size=0.012',
                                    transform=fig.transFigure, facecolor='#1e293b', edgecolor='#38bdf8', lw=1.2, zorder=41)
        fig.patches.append(title_pill)
        fig.text(0.41, 0.957, 'RAINFALL ADVISORY', fontsize=20, fontweight='heavy', color='#f8fafc', ha='center', va='center', zorder=42)

        # Subtitle Blue Bar
        short_time = datetime.datetime.now(pst).strftime("%I:%M %p")
        sub_title = f'{target_group.upper()} · {latest_headline} · {short_time}'
        pill_w = max(0.34, len(sub_title) * 0.0076)
        pill_x = 0.41 - pill_w / 2
        sub_pill = FancyBboxPatch((pill_x, 0.892), pill_w, 0.034, boxstyle='round,pad=0.01,rounding_size=0.01',
                                  transform=fig.transFigure, facecolor='#0369a1', edgecolor='none', zorder=41)
        fig.patches.append(sub_pill)
        fig.text(0.41, 0.908, sub_title, fontsize=10.5, fontweight='bold', color='#ffffff', ha='center', va='center', zorder=42)

        # ── Top Right Warning Level Legend Pills ─────────────────────────────
        legend_items = [
            ("EXPECTING", COLORS['expecting'], '#000000'),
            ("AFFECTING", COLORS['affecting'], '#000000'),
            ("YELLOW", COLORS['yellow'], '#000000'),
            ("ORANGE", COLORS['orange'], '#ffffff'),
            ("RED", COLORS['red'], '#ffffff'),
        ]
        total_w = 0.34
        pill_w = 0.063
        spacing = 0.005
        start_x = 0.63
        y_pill = 0.935
        h_pill = 0.035

        for i, (l_name, l_color, l_tc) in enumerate(legend_items):
            px = start_x + i * (pill_w + spacing)
            lpill = FancyBboxPatch((px, y_pill), pill_w, h_pill, boxstyle='round,pad=0.003,rounding_size=0.006',
                                   transform=fig.transFigure, facecolor=l_color, edgecolor='#ffffff', lw=0.9, zorder=42)
            fig.patches.append(lpill)
            fig.text(px + pill_w / 2, y_pill + h_pill / 2, l_name, fontsize=8.2, fontweight='heavy',
                     color=l_tc, ha='center', va='center', zorder=43)

        fig.text(start_x + total_w / 2, 0.902, 'PAGASA RAINFALL WARNING LEVELS', fontsize=8.8, fontweight='bold',
                 color='#94a3b8', ha='center', va='center', zorder=42)

        # ── User Brand Logo ──────────────────────────────────────────────────
        found_logo = next((p for p in LOGO_PATHS if os.path.exists(p)), None)
        if found_logo:
            try:
                logo_img = mpimg.imread(found_logo)
                logo_ax = fig.add_axes([0.02, 0.888, 0.08, 0.10], zorder=45)
                logo_ax.imshow(logo_img)
                logo_ax.axis('off')
            except Exception:
                fig.text(0.052, 0.936, 'PHIL\nWX', fontsize=12, fontweight='heavy', color='#38bdf8', ha='center', va='center', zorder=42)
        else:
            fig.text(0.052, 0.936, 'PHIL\nWX', fontsize=12, fontweight='heavy', color='#38bdf8', ha='center', va='center', zorder=42)

        # Save map image
        out_path = OUTPUT_PATH.replace(".png", f"_{target_group}.png")
        fig.savefig(out_path, dpi=200, facecolor=COLORS['bg'], edgecolor='none')
        plt.close(fig)
        print(f"Map successfully saved to {out_path}")

        # ── Generate Facebook Text Caption ───────────────────────────────────
        caption_lines = []
        caption_lines.append(f"⚠️ RAINFALL ADVISORY: {target_group.upper()} ⚠️")
        caption_lines.append(f"ACTIVE SYSTEM: {latest_headline}")
        caption_lines.append(f"Issued at: {issued_time_str}")
        caption_lines.append("")
        
        grouped_areas = {}
        for s in target_alerts:
            label = s.get('color_label')
            if not label: continue
            
            if label not in grouped_areas:
                grouped_areas[label] = {}
                
            prov_name = s.get('province')
            muni_name = s.get('municipality')
            if not prov_name: continue
                
            if prov_name not in grouped_areas[label]:
                grouped_areas[label][prov_name] = set()
                
            if muni_name:
                grouped_areas[label][prov_name].add(muni_name)
                
        full_labels = {
            '🔴 RED WARNING': '🔴 RED WARNING (Emergency)\nSerious flooding expected. Evacuate.',
            '🟠 ORANGE WARNING': '🟠 ORANGE WARNING (High)\nFlooding is threatening. Be prepared.',
            '🟡 YELLOW ADVISORY': '🟡 YELLOW ADVISORY (Moderate)\nFlooding is possible. Monitor updates.',
            '🟦 AFFECTING': '🟦 AFFECTING (Light / Moderate)\nCurrently affecting the area.',
            '🟩 EXPECTING': '🟩 EXPECTING (Standby)\nExpected to affect the area.'
        }
        
        for base_label, full_label in full_labels.items():
            if base_label in grouped_areas and grouped_areas[base_label]:
                caption_lines.append(full_label)
                caption_lines.append("Affected Areas:")
                
                for prov in sorted(grouped_areas[base_label].keys()):
                    munis = sorted(list(grouped_areas[base_label][prov]))
                    hashtag_prov = f"#{prov.replace(' ', '')}"
                    if munis:
                        munis_str = ", ".join(munis)
                        caption_lines.append(f" • {hashtag_prov} ({munis_str})")
                    else:
                        caption_lines.append(f" • {hashtag_prov}")
                
                caption_lines.append("")
        
        caption_lines.append("Data automatically generated from Real-Time DOST-PAGASA.")
        caption_lines.append("Always verify information with official sources.")
        
        caption_path = OUTPUT_PATH.replace(".png", f"_{target_group}.txt")
        with open(caption_path, "w", encoding="utf-8") as f:
            f.write("\n".join(caption_lines))
        print(f"Caption successfully saved to {caption_path}")

if __name__ == "__main__":
    main()
