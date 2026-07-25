import os
import base64
import pandas as pd
import numpy as np
import io
import json
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from datetime import datetime, timezone, timedelta
from shapely.geometry import shape, Polygon
from shapely.ops import unary_union
import math

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "data")
XOR_KEY = 0xAA

def decode_obfuscated_data(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read().strip()
    encrypted_bytes = base64.b64decode(content)
    decrypted_bytes = bytes([b ^ XOR_KEY for b in encrypted_bytes])
    return decrypted_bytes.decode('utf-8')

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = np.radians(lat2 - lat1)
    dlon = np.radians(lon2 - lon1)
    a = np.sin(dlat / 2.0)**2 + np.cos(np.radians(lat1)) * np.cos(np.radians(lat2)) * np.sin(dlon / 2.0)**2
    return R * 2.0 * np.arcsin(np.sqrt(a))

def calculate_bearing(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlon = lon2 - lon1
    y = np.sin(dlon) * np.cos(lat2)
    x = np.cos(lat1) * np.sin(lat2) - np.sin(lat1) * np.cos(lat2) * np.cos(dlon)
    bearing = np.degrees(np.arctan2(y, x))
    return (bearing + 360) % 360

def bearing_to_compass(bearing):
    dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    ix = int((bearing + 11.25) / 22.5)
    return dirs[ix % 16]

# ── NHC standard cone radii (nautical miles) by lead time (hours)  ─────────────
LEAD_STANDARD = [0,  12,  24,  36,  48,   60,   72,   96,  120,  144]
RADII_NM      = [0,  26,  38,  50,  59,   71,   83,  113,  146,  180]

# ── Geometry helpers  ──────────────────────────────────────────────────────────
def offset_point(lat, lon, distance_km, bearing_deg):
    """Return (lat2, lon2) displaced from (lat, lon) by distance_km along bearing_deg."""
    R = 6371.0
    br = math.radians(bearing_deg)
    la1 = math.radians(lat)
    lo1 = math.radians(lon)
    la2 = math.asin(
        math.sin(la1) * math.cos(distance_km / R) +
        math.cos(la1) * math.sin(distance_km / R) * math.cos(br)
    )
    lo2 = lo1 + math.atan2(
        math.sin(br) * math.sin(distance_km / R) * math.cos(la1),
        math.cos(distance_km / R) - math.sin(la1) * math.sin(la2),
    )
    return math.degrees(la2), math.degrees(lo2)


def build_circle_points(lat, lon, radius_km, n=36):
    """Return list of [lon, lat] for a circle of radius_km around (lat, lon)."""
    pts = []
    for i in range(n):
        ang = 360 * i / n
        clat, clon = offset_point(lat, lon, radius_km, ang)
        pts.append([round(clon, 4), round(clat, 4)])
    pts.append(pts[0])   # close the ring
    return pts


def convex_hull_2d(points):
    """
    Simple Graham-scan convex hull for a list of [x, y] points.
    Returns [x, y] list in CCW order.
    """
    pts = [tuple(p) for p in points]
    pts = sorted(set(pts))
    if len(pts) <= 1:
        return [[p[0], p[1]] for p in pts]

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    return [[p[0], p[1]] for p in hull]


def build_cone_polygon(lats, lons, lead_times):
    """
    Build the cone-of-uncertainty outer envelope using a continuous swept tangent union.
    Returns list of [lon, lat] pairs (closed polygon).
    """
    radii_nm_interp = np.interp(lead_times, LEAD_STANDARD, RADII_NM)
    radii_km = radii_nm_interp * 1.852

    if len(lats) <= 1:
        circ = []
        radius = max(radii_km[0], 0.1)
        for ang in range(0, 360, 10):
            clat, clon = offset_point(lats[0], lons[0], radius, ang)
            circ.append([round(clon, 4), round(clat, 4)])
        return circ

    circles = []
    for i in range(len(lats)):
        circ_lons = []
        circ_lats = []
        radius = max(radii_km[i], 0.1)
        for ang in range(0, 360, 10):
            clat, clon = offset_point(lats[i], lons[i], radius, ang)
            circ_lons.append(clon)
            circ_lats.append(clat)
        circles.append(Polygon(np.column_stack((circ_lons, circ_lats))))
        
    # Connect consecutive circles with a convex hull tangent
    segments = []
    for i in range(len(circles) - 1):
        segment = circles[i].union(circles[i+1]).convex_hull
        segments.append(segment)
        
    # Merge all segments into one continuous blob
    cone_geom = unary_union(segments)
    
    if cone_geom.geom_type == 'Polygon':
        geoms = [cone_geom]
    elif cone_geom.geom_type == 'MultiPolygon':
        geoms = list(cone_geom.geoms)
    else:
        geoms = []
        
    if not geoms:
        return []

    # Get the outline of the main contiguous polygon
    largest_geom = max(geoms, key=lambda g: g.area)
    coords = list(largest_geom.exterior.coords)
    return [[round(p[0], 4), round(p[1], 4)] for p in coords]

def get_storm_name(track_id):
    import re
    m = re.match(r'^WP(\d{2})\d{4}$', track_id)
    if m:
        num = int(m.group(1))
        return f"Invest {num}W" if num >= 90 else f"TC {num:02d}W"
    
    m = re.search(r'WP(\d+)', track_id)
    if m:
        num = int(m.group(1))
        return f"Invest {num}W" if num >= 90 else f"TC {num:02d}W"
    return track_id

def get_category_style(wind_kt, pressure=None):
    if wind_kt is not None and not np.isnan(wind_kt):
        if wind_kt >= 100:
            return 'Super Typhoon', '#FF007F', '#241a22'
        elif 64 <= wind_kt < 100:
            return 'Typhoon', '#A83232', '#241c1c'
        elif 48 <= wind_kt < 64:
            return 'Severe Tropical Storm', '#E67E22', '#241f1a'
        elif 34 <= wind_kt < 48:
            return 'Tropical Storm', '#F1C40F', '#24231a'
        elif 25 <= wind_kt < 34:
            return 'Tropical Depression', '#2ECC71', '#1a241e'
        else:
            return 'Low Pressure Area', '#3498DB', '#1a1f24'
            
    if pressure is not None and not np.isnan(pressure):
        if pressure < 920:
            return 'Super Typhoon', '#FF007F', '#241a22'
        elif 920 <= pressure <= 945:
            return 'Typhoon', '#A83232', '#241c1c'
        elif 945 < pressure <= 970:
            return 'Severe Tropical Storm', '#E67E22', '#241f1a'
        elif 970 < pressure <= 990:
            return 'Tropical Storm', '#F1C40F', '#24231a'
        elif 990 < pressure <= 1005:
            return 'Tropical Depression', '#2ECC71', '#1a241e'
        else:
            return 'Low Pressure Area', '#3498DB', '#1a1f24'
            
    return "N/A", "#3498DB", "#1e293b"

def generate_empty_state():
    """Outputs empty JSON and default map when no storms are active."""
    print("No active Western Pacific storms found. Generating empty state files...")
    
    json_output = {
        'active': False,
        'storm_name': None,
        'track_id': None,
        'latest': None,
        'history': []
    }
    
    with open(os.path.join(DATA_DIR, "tc_positions_latest.json"), "w") as f:
        json.dump(json_output, f, indent=2)
        
    # Mark all storms in index as inactive
    index_path = os.path.join(DATA_DIR, "tc_storms_index.json")
    if os.path.exists(index_path):
        try:
            with open(index_path, 'r') as f_idx:
                storms_index = json.load(f_idx)
            for item in storms_index:
                item['active'] = False
            with open(index_path, 'w') as f_idx:
                json.dump(storms_index, f_idx, indent=2)
            print("Marked all storms in index as inactive.")
        except Exception as e:
            print(f"Warning: Could not update index file on empty state: {e}")
        
    fig, (ax_head, ax) = plt.subplots(2, 1, figsize=(12, 13.5), gridspec_kw={'height_ratios': [0.08, 0.92], 'hspace': 0.02})
    
    ax_head.set_axis_off()
    ax_head.axhline(y=0.5, color='#64748b', linewidth=50, alpha=0.15, zorder=1)
    ax_head.axvline(x=0.0, color='#64748b', linewidth=8, solid_capstyle='butt', zorder=2)
    ax_head.text(0.02, 0.4, "NO ACTIVE TROPICAL CYCLONES", fontsize=20, fontweight='900', color='#1e293b', va='center')
    
    # Re-initialize main axis with Cartopy projection
    spec = ax.get_subplotspec()
    ax.remove()
    ax = fig.add_subplot(spec, projection=ccrs.PlateCarree())
    ax.set_extent([105, 155, 0, 40], crs=ccrs.PlateCarree())
    
    ax.set_facecolor('#87CEEB')
    ax.add_feature(cfeature.LAND, facecolor='#DEB887', edgecolor='#8B4513', linewidth=0.8)
    ax.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.8, alpha=0.7, color='#654321')
    
    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
    gl.xlocator = plt.FixedLocator(np.arange(105, 156, 5))
    gl.ylocator = plt.FixedLocator(np.arange(0, 41, 5))
    gl.xlabel_style = {'size': 12, 'weight': 'bold'}
    gl.ylabel_style = {'size': 12, 'weight': 'bold'}
    gl.top_labels = False
    gl.right_labels = False
    
    par_vertices = [(115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0), (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)]
    ax.add_patch(mpatches.Polygon(par_vertices, facecolor='none', edgecolor='#FF6B35', linestyle='-', linewidth=3, alpha=0.8, transform=ccrs.PlateCarree()))
    
    output_file = os.path.join(DATA_DIR, "..", "assets", "tc_positions_latest.png")
    plt.savefig(output_file, dpi=300, bbox_inches='tight')
    plt.close()
    print("Saved empty state map.")

def main():
    manifest_path = os.path.join(DATA_DIR, "cycles_manifest.json")
    if not os.path.exists(manifest_path):
        print(f"Error: Manifest not found at {manifest_path}")
        generate_empty_state()
        return
        
    with open(manifest_path, 'r') as f:
        manifest = json.load(f)
        
    base_cycles = sorted(manifest.get("base", []), key=lambda c: c['cycle'])
    cycle_points = {}
    
    for cycle in base_cycles:
        cycle_name = cycle['cycle']
        paired_fn = cycle['paired']
        paired_path = os.path.join(DATA_DIR, paired_fn)
        if not os.path.exists(paired_path):
            continue
            
        try:
            csv_text = decode_obfuscated_data(paired_path)
            df = pd.read_csv(io.StringIO(csv_text), comment='#')
            df.columns = df.columns.str.strip()
            
            if 'lead_time_hours' not in df.columns and 'lead_time' in df.columns:
                df['lead_time_hours'] = pd.to_timedelta(df['lead_time']).dt.total_seconds() / 3600.0
                    
            df_zero = df[(df['lead_time_hours'] == 0) & (df['track_id'].str.startswith('WP', na=True)) & (df['sample'] == -1)]
            
            points = []
            for idx, row in df_zero.iterrows():
                points.append({
                    'cycle': cycle_name,
                    'track_id': row['track_id'].strip(),
                    'lat': float(row['lat']),
                    'lon': float(row['lon']),
                    'pressure': float(row['minimum_sea_level_pressure_hpa']),
                    'wind_kt': float(row['maximum_sustained_wind_speed_knots']),
                })
            if points:
                cycle_points[cycle_name] = points
        except Exception as e:
            print(f"Error parsing cycle {cycle_name}: {e}")
            continue
            
    latest_cycle = base_cycles[-1]['cycle']
    if latest_cycle not in cycle_points or not cycle_points[latest_cycle]:
        print("No active WP tracks in the latest cycle.")
        generate_empty_state()
        return
        
    latest_pts = cycle_points[latest_cycle]
    
    # Identify the primary storm (strongest) for fallback files
    primary_pt = min(latest_pts, key=lambda pt: pt['pressure'])
    primary_tid = primary_pt['track_id']
    
    active_track_ids = {pt['track_id'] for pt in latest_pts}
    active_storms_info = {}
    
    # Load latest cycle's paired data for forecast tracks
    latest_cycle_info = base_cycles[-1]
    latest_paired_fn = latest_cycle_info['paired']
    latest_paired_path = os.path.join(DATA_DIR, latest_paired_fn)
    latest_df = None
    try:
        csv_text_latest = decode_obfuscated_data(latest_paired_path)
        latest_df = pd.read_csv(io.StringIO(csv_text_latest), comment='#')
        latest_df.columns = latest_df.columns.str.strip()
        if 'lead_time_hours' not in latest_df.columns and 'lead_time' in latest_df.columns:
            latest_df['lead_time_hours'] = pd.to_timedelta(latest_df['lead_time']).dt.total_seconds() / 3600.0
    except Exception as e:
        print(f"Error loading latest cycle paired CSV: {e}")
    
    for latest_pt in latest_pts:
        latest_tid = latest_pt['track_id']
        track_pts = [latest_pt]
        curr_lat = latest_pt['lat']
        curr_lon = latest_pt['lon']
        
        for cycle_info in reversed(base_cycles[:-1]):
            c_name = cycle_info['cycle']
            if c_name not in cycle_points or not cycle_points[c_name]:
                continue
                
            candidates = cycle_points[c_name]
            closest_pt = min(candidates, key=lambda pt: haversine_km(curr_lat, curr_lon, pt['lat'], pt['lon']))
            dist = haversine_km(curr_lat, curr_lon, closest_pt['lat'], closest_pt['lon'])
            
            if dist < 600:
                track_pts.append(closest_pt)
                curr_lat = closest_pt['lat']
                curr_lon = closest_pt['lon']
                
        track_pts = sorted(track_pts, key=lambda x: x['cycle'])
        
        movement_str = "Stationary"
        if len(track_pts) >= 2:
            prev = track_pts[-2]
            latest = track_pts[-1]
            dist_km = haversine_km(prev['lat'], prev['lon'], latest['lat'], latest['lon'])
            dt_hours = (datetime.strptime(latest['cycle'], "%Y-%m-%d %H:%M") - datetime.strptime(prev['cycle'], "%Y-%m-%d %H:%M")).total_seconds() / 3600.0
            
            if dt_hours > 0:
                speed_kmh = dist_km / dt_hours
                bearing = calculate_bearing(prev['lat'], prev['lon'], latest['lat'], latest['lon'])
                movement_str = f"{bearing_to_compass(bearing)} at {speed_kmh:.1f} km/h ({speed_kmh/1.852:.1f} kt)"
                
        latest_pt = track_pts[-1]
        oldest_tid = track_pts[0]['track_id']
        latest_name = get_storm_name(latest_tid)
        
        if latest_tid != oldest_tid:
            oldest_name = get_storm_name(oldest_tid)
            storm_name = f"{latest_name} ({oldest_name})" if "Invest" in oldest_name and "TC" in latest_name else latest_name
        else:
            storm_name = latest_name
            
        print(f"Tracking Storm: {storm_name}")
        
        # Save JSON Configuration
        latest_cat = get_category_style(latest_pt['wind_kt'], latest_pt['pressure'])[0]
        
        storm_filename = f"tc_positions_{latest_tid}.json"
        storm_filepath = os.path.join(DATA_DIR, storm_filename)
        
        existing_history = []
        if os.path.exists(storm_filepath):
            try:
                with open(storm_filepath, 'r') as f_exist:
                    exist_data = json.load(f_exist)
                    existing_history = exist_data.get('history', [])
            except Exception as e:
                print(f"Warning: Could not read existing storm file {storm_filepath}: {e}")

        # If no existing history for this specific ID (e.g. upgraded to a numbered TC),
        # search for an old Invest history file (WP90-WP99) matching the same location (<600km)
        if not existing_history:
            for fname in os.listdir(DATA_DIR):
                if (fname.startswith("tc_positions_WP9") or fname.startswith("tc_positions_9")) and fname.endswith(".json"):
                    old_path = os.path.join(DATA_DIR, fname)
                    try:
                        with open(old_path, 'r', encoding='utf-8') as f_old:
                            old_data = json.load(f_old)
                            old_hist = old_data.get('history', [])
                            if old_hist:
                                last_pt = old_hist[-1]
                                if haversine_km(latest_pt['lat'], latest_pt['lon'], last_pt['lat'], last_pt['lon']) < 600:
                                    print(f"Found matching historical Invest file {fname} for upgraded storm {latest_tid}")
                                    existing_history = old_hist
                                    break
                    except Exception as ex:
                        pass
                
        # Check if the existing history is too old (e.g. more than 5 days gap)
        # to prevent merging different storms when Invest IDs reset/recycle
        if existing_history:
            try:
                # Find the latest cycle time in existing history
                latest_existing_cycle_str = max(pt['cycle'] for pt in existing_history)
                latest_existing_time = datetime.strptime(latest_existing_cycle_str, "%Y-%m-%d %H:%M")
                current_cycle_time = datetime.strptime(latest_pt['cycle'], "%Y-%m-%d %H:%M")
                
                # If the gap is greater than 5 days, clear existing history
                if (current_cycle_time - latest_existing_time).days > 5:
                    print(f"Detected Invest ID reuse for {latest_tid} (gap > 5 days). Resetting old history.")
                    existing_history = []
            except Exception as ex:
                print(f"Error checking history age: {ex}")
                
        history_by_cycle = {pt['cycle']: pt for pt in existing_history}
        for pt in track_pts:
            pt_cat = get_category_style(pt['wind_kt'], pt['pressure'])[0]
            history_by_cycle[pt['cycle']] = {
                'cycle': pt['cycle'],
                'lat': pt['lat'],
                'lon': pt['lon'],
                'pressure_hpa': pt['pressure'],
                'wind_kt': pt['wind_kt'],
                'wind_kmh': round(pt['wind_kt'] * 1.852),
                'category': pt_cat
            }
        merged_history = sorted(history_by_cycle.values(), key=lambda x: x['cycle'])
        
        json_output = {
            'active': True,
            'storm_name': storm_name,
            'track_id': latest_tid,
            'latest': {
                'lat': latest_pt['lat'],
                'lon': latest_pt['lon'],
                'pressure_hpa': latest_pt['pressure'],
                'wind_kt': latest_pt['wind_kt'],
                'wind_kmh': round(latest_pt['wind_kt'] * 1.852),
                'movement': movement_str,
                'init_time': latest_pt['cycle'],
                'category': latest_cat
            },
            'history': merged_history
        }
        
        with open(storm_filepath, "w") as f:
            json.dump(json_output, f, indent=2)
        print(f"Storm-specific data saved to {storm_filepath}")

        # Also write short ID file (e.g. tc_positions_11W.json) if available
        if latest_tid.startswith("WP") and len(latest_tid) >= 4:
            try:
                num_part = int(latest_tid[2:4])
                short_tid = f"{num_part}W"
                short_filepath = os.path.join(DATA_DIR, f"tc_positions_{short_tid}.json")
                with open(short_filepath, "w") as f_short:
                    json.dump(json_output, f_short, indent=2)
            except Exception:
                pass
            
        if latest_tid == primary_tid:
            with open(os.path.join(DATA_DIR, "tc_positions_latest.json"), "w") as f:
                json.dump(json_output, f, indent=2)
            print("Generic tc_positions_latest.json updated.")
            
        # Collect for index update
        active_storms_info[latest_tid] = {
            'storm_name': storm_name,
            'active': True,
            'last_updated': latest_pt['cycle'],
            'latest_lat': latest_pt['lat'],
            'latest_lon': latest_pt['lon'],
            'category': latest_cat
        }
        
        # --- PLOTTING GRID LAYOUT CONFIGURATION ---
        fig, (ax_head, ax_dummy) = plt.subplots(
            2, 1, 
            figsize=(10, 9.6), 
            gridspec_kw={'height_ratios': [0.12, 0.88], 'hspace': 0.02}
        )
        
        # Render Dashboard Header Text Element Area
        ax_head.set_axis_off()
        category, identity_color, bg_dark = get_category_style(latest_pt['wind_kt'], latest_pt['pressure'])
        
        # Rounded card background spanning the top
        card = mpatches.FancyBboxPatch(
            (0.01, 0.05), 0.98, 0.90,
            boxstyle="round,pad=0.01,rounding_size=0.02",
            facecolor=bg_dark, edgecolor=identity_color, linewidth=2.5,
            transform=ax_head.transAxes
        )
        ax_head.add_patch(card)
        
        # Title inside card
        ax_head.text(
            0.5, 0.78, "◆ TROPICAL CYCLONE STATUS REPORT ◆",
            transform=ax_head.transAxes, ha='center', va='center',
            fontsize=11, fontweight='black', color='white'
        )
        
        # Left column details
        col1_text = (
            f" Storm Name :  {storm_name}\n"
            f" Category   :  {category}\n"
            f" Init Cycle :  {latest_pt['cycle']} UTC"
        )
        ax_head.text(
            0.05, 0.38, col1_text,
            transform=ax_head.transAxes, ha='left', va='center',
            fontsize=9.5, fontweight='bold', color='white', fontfamily='monospace',
            linespacing=1.6
        )
        
        # Right column details
        col2_text = (
            f" Position   :  {latest_pt['lat']:.1f}°N, {latest_pt['lon']:.1f}°E\n"
            f" Intensity  :  {latest_pt['wind_kt']:.0f} kt ({round(latest_pt['wind_kt']*1.852)} km/h) | {latest_pt['pressure']:.0f} hPa\n"
            f" Movement   :  {movement_str}"
        )
        ax_head.text(
            0.52, 0.38, col2_text,
            transform=ax_head.transAxes, ha='left', va='center',
            fontsize=9.5, fontweight='bold', color='white', fontfamily='monospace',
            linespacing=1.6
        )
        
        # Swapping out Dummy Subplot with Real Geo-Projected Cartopy Canvas Box
        spec = ax_dummy.get_subplotspec()
        ax_dummy.remove()
        ax = fig.add_subplot(spec, projection=ccrs.PlateCarree())
        ax.set_extent([105, 155, 0, 40], crs=ccrs.PlateCarree())
        
        ax.set_facecolor('#87CEEB')
        ax.add_feature(cfeature.LAND, facecolor='#DEB887', edgecolor='#8B4513', linewidth=0.8)
        ax.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.8, alpha=0.7, color='#654321')
        
        try:
            prov_path = os.path.join(DATA_DIR, "ph_provinces.json")
            if os.path.exists(prov_path):
                with open(prov_path, 'r', encoding='utf-8') as f:
                    geojson = json.load(f)
                province_shapely_geometries = [shape(prov_feat['geometry']) for prov_feat in geojson['features']]
                ax.add_geometries(province_shapely_geometries, crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#654321', linewidth=0.4, alpha=0.5, zorder=3)
        except Exception as e:
            print(f"Warning: Failed to load province boundaries: {e}")

        gl = ax.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
        gl.xlocator = plt.FixedLocator(np.arange(105, 156, 5))
        gl.ylocator = plt.FixedLocator(np.arange(0, 41, 5))
        gl.xlabel_style = {'size': 12, 'weight': 'bold'}
        gl.ylabel_style = {'size': 12, 'weight': 'bold'}
        gl.top_labels = False
        gl.right_labels = False
        
        ax.text(118, 13, 'West Philippine\nSea', fontsize=5, color='navy', weight='bold', transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5)
        ax.text(130, 20, 'Philippine\nSea', fontsize=9, color='navy', weight='bold', transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5)
        
        # Watermark text at the bottom right corner
        ax.text(0.98, 0.02, 'Philippine Typhoon/Weather', transform=ax.transAxes, fontsize=10, color='#0f172a', weight='bold', style='italic', ha='right', va='bottom', alpha=0.45, zorder=10)
        
        par_vertices = [(115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0), (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)]
        ax.add_patch(mpatches.Polygon(par_vertices, facecolor='none', edgecolor='#FF6B35', linestyle='-', linewidth=3, alpha=0.8, transform=ccrs.PlateCarree()))
        
        lats = [pt['lat'] for pt in merged_history]
        lons = [pt['lon'] for pt in merged_history]
        ax.plot(lons, lats, color='#475569', linewidth=2.2, linestyle='-', zorder=4, transform=ccrs.PlateCarree())
        
        for pt in merged_history[:-1]:
            _, cat_color, _ = get_category_style(pt.get('wind_kt'), pt.get('pressure_hpa') or pt.get('pressure'))
            ax.plot(pt['lon'], pt['lat'], marker='o', color=cat_color, markersize=7, markeredgecolor='white', markeredgewidth=1.0, zorder=5, transform=ccrs.PlateCarree())
            
        latest_cat, latest_color, _ = get_category_style(latest_pt['wind_kt'], latest_pt['pressure'])
        ax.plot(latest_pt['lon'], latest_pt['lat'], marker='o', color=latest_color, markersize=12, markeredgecolor='white', markeredgewidth=1.5, zorder=7, transform=ccrs.PlateCarree())
        
        try:
            dt = datetime.strptime(latest_pt['cycle'], "%Y-%m-%d %H:%M")
            lbl_latest = f"{dt.strftime('%m-%d %HZ')} {latest_pt['wind_kt']:.0f}kt (LATEST)"
        except:
            lbl_latest = f"{latest_pt['cycle']} {latest_pt['wind_kt']:.0f}kt (LATEST)"
            
        # Dynamically determine offset to keep label inside map boundaries (extent: [105, 155, 0, 40])
        dx = 3.0 if latest_pt['lon'] < 135 else -3.0
        dy = 1.8 if latest_pt['lat'] < 30 else -1.8
        ha = 'left' if dx > 0 else 'right'
        va = 'bottom' if dy > 0 else 'top'
        
        transform = ccrs.PlateCarree()._as_mpl_transform(ax)
        ax.annotate(
            lbl_latest,
            xy=(latest_pt['lon'], latest_pt['lat']),
            xytext=(latest_pt['lon'] + dx, latest_pt['lat'] + dy),
            xycoords=transform,
            arrowprops=dict(
                arrowstyle="-",
                linestyle="--",
                color=latest_color,
                linewidth=1.2,
                alpha=0.8
            ),
            fontsize=8,
            color='black',
            weight='bold',
            ha=ha,
            va=va,
            zorder=8
        )
        
        legend_elements = [
            plt.Line2D([0], [0], color='#FF6B35', linewidth=2.2, label='PAR Boundary'),
            plt.Line2D([0], [0], color='#475569', linewidth=2.2, label='Track Line'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#FF007F', markeredgecolor='white', markersize=6, label='Super Typhoon'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#A83232', markeredgecolor='white', markersize=6, label='Typhoon'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#E67E22', markeredgecolor='white', markersize=6, label='Severe Tropical Storm'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#F1C40F', markeredgecolor='white', markersize=6, label='Tropical Storm'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#2ECC71', markeredgecolor='white', markersize=6, label='Tropical Depression'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#3498DB', markeredgecolor='white', markersize=6, label='Low Pressure Area')
        ]
        ax.legend(handles=legend_elements, loc='upper left', bbox_to_anchor=(0.02, 0.98), frameon=True, facecolor='white', framealpha=0.9, fontsize=8, ncol=2)
        
        output_file_storm = os.path.join(DATA_DIR, "..", "assets", f"tc_positions_{latest_tid}.png")
        plt.savefig(output_file_storm, dpi=300, bbox_inches='tight')
        
        plt.close()
        print(f"Maps successfully generated and saved to {output_file_storm}")

        # --- GENERATE FORECAST TRACK MAP ---
        if latest_df is not None:
            # Filter for this storm's ensemble mean forecast
            # Strip whitespace from track_id in DataFrame
            storm_df = latest_df[
                (latest_df['track_id'].str.strip() == latest_tid) & 
                (latest_df['sample'] == -1) & 
                (latest_df['lead_time_hours'] >= 0)
            ]
            storm_df = storm_df.sort_values(by='lead_time_hours')
            
            if not storm_df.empty:
                f_lats = storm_df['lat'].tolist()
                f_lons = storm_df['lon'].tolist()
                f_leads = storm_df['lead_time_hours'].tolist()
                f_winds = storm_df['maximum_sustained_wind_speed_knots'].tolist()
                f_pressures = storm_df['minimum_sea_level_pressure_hpa'].tolist()
                
                # Plotting Grid Layout for Forecast
                fig_f, (ax_head_f, ax_dummy_f) = plt.subplots(
                    2, 1, 
                    figsize=(10, 9.6), 
                    gridspec_kw={'height_ratios': [0.12, 0.88], 'hspace': 0.02}
                )
                
                ax_head_f.set_axis_off()
                category, identity_color, bg_dark = get_category_style(latest_pt['wind_kt'], latest_pt['pressure'])
                
                card_f = mpatches.FancyBboxPatch(
                    (0.01, 0.05), 0.98, 0.90,
                    boxstyle="round,pad=0.01,rounding_size=0.02",
                    facecolor=bg_dark, edgecolor=identity_color, linewidth=2.5,
                    transform=ax_head_f.transAxes
                )
                ax_head_f.add_patch(card_f)
                
                ax_head_f.text(
                    0.5, 0.78, "◆ TROPICAL CYCLONE FORECAST TRACK REPORT ◆",
                    transform=ax_head_f.transAxes, ha='center', va='center',
                    fontsize=11, fontweight='black', color='white'
                )
                
                col1_text_f = (
                    f" Storm Name :  {storm_name}\n"
                    f" Category   :  {category}\n"
                    f" Init Cycle :  {latest_pt['cycle']} UTC"
                )
                ax_head_f.text(
                    0.05, 0.38, col1_text_f,
                    transform=ax_head_f.transAxes, ha='left', va='center',
                    fontsize=9.5, fontweight='bold', color='white', fontfamily='monospace',
                    linespacing=1.6
                )
                
                col2_text_f = (
                    f" Position   :  {latest_pt['lat']:.1f}°N, {latest_pt['lon']:.1f}°E\n"
                    f" Intensity  :  {latest_pt['wind_kt']:.0f} kt ({round(latest_pt['wind_kt']*1.852)} km/h) | {latest_pt['pressure']:.0f} hPa\n"
                    f" Movement   :  {movement_str}"
                )
                ax_head_f.text(
                    0.52, 0.38, col2_text_f,
                    transform=ax_head_f.transAxes, ha='left', va='center',
                    fontsize=9.5, fontweight='bold', color='white', fontfamily='monospace',
                    linespacing=1.6
                )
                
                spec_f = ax_dummy_f.get_subplotspec()
                ax_dummy_f.remove()
                ax_f = fig_f.add_subplot(spec_f, projection=ccrs.PlateCarree())
                ax_f.set_extent([105, 155, 0, 40], crs=ccrs.PlateCarree())
                
                ax_f.set_facecolor('#87CEEB')
                ax_f.add_feature(cfeature.LAND, facecolor='#DEB887', edgecolor='#8B4513', linewidth=0.8)
                ax_f.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.8, alpha=0.7, color='#654321')
                
                # Add provinces
                try:
                    prov_path = os.path.join(DATA_DIR, "ph_provinces.json")
                    if os.path.exists(prov_path):
                        with open(prov_path, 'r', encoding='utf-8') as f_prov:
                            geojson_prov = json.load(f_prov)
                        province_geoms = [shape(prov_feat['geometry']) for prov_feat in geojson_prov['features']]
                        ax_f.add_geometries(province_geoms, crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#654321', linewidth=0.4, alpha=0.5, zorder=3)
                except Exception as e:
                    print(f"Warning: Failed to load provinces for forecast map: {e}")

                gl_f = ax_f.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
                gl_f.xlocator = plt.FixedLocator(np.arange(105, 156, 5))
                gl_f.ylocator = plt.FixedLocator(np.arange(0, 41, 5))
                gl_f.xlabel_style = {'size': 12, 'weight': 'bold'}
                gl_f.ylabel_style = {'size': 12, 'weight': 'bold'}
                gl_f.top_labels = False
                gl_f.right_labels = False
                
                ax_f.text(118, 13, 'West Philippine\nSea', fontsize=5, color='navy', weight='bold', transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5)
                ax_f.text(130, 20, 'Philippine\nSea', fontsize=9, color='navy', weight='bold', transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5)
                
                # Watermark
                ax_f.text(0.98, 0.02, 'Philippine Typhoon/Weather', transform=ax_f.transAxes, fontsize=10, color='#0f172a', weight='bold', style='italic', ha='right', va='bottom', alpha=0.45, zorder=10)
                
                # PAR boundary
                ax_f.add_patch(mpatches.Polygon(par_vertices, facecolor='none', edgecolor='#FF6B35', linestyle='-', linewidth=3, alpha=0.8, transform=ccrs.PlateCarree()))
                
                # ── Generate & Plot Cone of Uncertainty ──
                cone_coords = build_cone_polygon(f_lats, f_lons, f_leads)
                if cone_coords:
                    cone_lons = [p[0] for p in cone_coords]
                    cone_lats = [p[1] for p in cone_coords]
                    # Fill the cone
                    ax_f.fill(cone_lons, cone_lats, color='white', alpha=0.20, transform=ccrs.PlateCarree(), zorder=3)
                    # Border of the cone
                    ax_f.plot(cone_lons, cone_lats, color='white', linestyle='--', linewidth=1.5, alpha=0.6, transform=ccrs.PlateCarree(), zorder=3)
                
                # Plot History Track (Gray Line) on Forecast Map
                hist_lats = [pt['lat'] for pt in merged_history]
                hist_lons = [pt['lon'] for pt in merged_history]
                if len(hist_lats) > 1:
                    ax_f.plot(hist_lons, hist_lats, color='#94a3b8', linewidth=2.0, linestyle='--', zorder=4, transform=ccrs.PlateCarree())
                    for pt in merged_history[:-1]:
                        ax_f.plot(pt['lon'], pt['lat'], marker='o', color='#cbd5e1', markersize=5, markeredgecolor='#94a3b8', markeredgewidth=0.8, zorder=5, transform=ccrs.PlateCarree())

                # Plot Forecast Track Line
                ax_f.plot(f_lons, f_lats, color='#475569', linewidth=2.5, linestyle='-', zorder=4, transform=ccrs.PlateCarree())
                
                # Plot forecast points
                for i, (lat, lon, lead, wind, press) in enumerate(zip(f_lats, f_lons, f_leads, f_winds, f_pressures)):
                    _, cat_color, _ = get_category_style(wind, press)
                    
                    is_start = (i == 0)
                    markersize = 12 if is_start else 7
                    markeredgewidth = 1.5 if is_start else 1.0
                    zorder = 7 if is_start else 5
                    
                    ax_f.plot(lon, lat, marker='o', color=cat_color, markersize=markersize, markeredgecolor='white', markeredgewidth=markeredgewidth, zorder=zorder, transform=ccrs.PlateCarree())
                    
                    # Annotate key forecast lead times
                    if lead in [0, 24, 48, 72, 96, 120, 144] or (i == len(f_lats) - 1 and lead not in [0, 24, 48, 72, 96, 120, 144]):
                        lbl = f"{'+' if lead > 0 else ''}{lead:.0f}h"
                        dx_f = 2.2 if lon < 135 else -2.2
                        dy_f = 1.3 if lat < 30 else -1.3
                        ha_f = 'left' if dx_f > 0 else 'right'
                        va_f = 'bottom' if dy_f > 0 else 'top'
                        
                        transform_f = ccrs.PlateCarree()._as_mpl_transform(ax_f)
                        ax_f.annotate(
                            lbl,
                            xy=(lon, lat),
                            xytext=(lon + dx_f, lat + dy_f),
                            xycoords=transform_f,
                            arrowprops=dict(
                                arrowstyle="-",
                                linestyle=":",
                                color=cat_color,
                                linewidth=0.8,
                                alpha=0.6
                            ),
                            fontsize=7.5,
                            color='black',
                            weight='bold',
                            ha=ha_f,
                            va=va_f,
                            zorder=8
                        )
                
                # Legend (add cone entry)
                legend_elements_f = [
                    plt.Line2D([0], [0], color='#FF6B35', linewidth=2.2, label='PAR Boundary'),
                    plt.Line2D([0], [0], color='#475569', linewidth=2.5, label='Forecast Track'),
                    plt.Line2D([0], [0], color='#94a3b8', linewidth=2.0, linestyle='--', label='Past Track (History)'),
                    mpatches.Patch(facecolor='white', edgecolor='white', linestyle='--', alpha=0.3, label='Cone of Uncertainty'),
                    plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#FF007F', markeredgecolor='white', markersize=6, label='Super Typhoon'),
                    plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#A83232', markeredgecolor='white', markersize=6, label='Typhoon'),
                    plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#E67E22', markeredgecolor='white', markersize=6, label='Severe Tropical Storm'),
                    plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#F1C40F', markeredgecolor='white', markersize=6, label='Tropical Storm'),
                    plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#2ECC71', markeredgecolor='white', markersize=6, label='Tropical Depression'),
                    plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#3498DB', markeredgecolor='white', markersize=6, label='Low Pressure Area')
                ]
                ax_f.legend(handles=legend_elements_f, loc='upper left', bbox_to_anchor=(0.02, 0.98), frameon=True, facecolor='white', framealpha=0.9, fontsize=8, ncol=2)
                
                output_file_storm_f = os.path.join(DATA_DIR, "..", "assets", f"tc_forecast_{latest_tid}.png")
                plt.savefig(output_file_storm_f, dpi=300, bbox_inches='tight')
                
                plt.close()
                print(f"Forecast map successfully generated and saved to {output_file_storm_f}")

    # Generate generic tc_positions_latest.png composite map containing ALL active storms
    if latest_pts:
        fig_all, (ax_head_all, ax_dummy_all) = plt.subplots(
            2, 1, 
            figsize=(10, 9.6), 
            gridspec_kw={'height_ratios': [0.12, 0.88], 'hspace': 0.02}
        )
        ax_head_all.set_axis_off()
        category_p, color_p, bg_dark_p = get_category_style(primary_pt['wind_kt'], primary_pt['pressure'])
        card_all = mpatches.FancyBboxPatch(
            (0.01, 0.05), 0.98, 0.90,
            boxstyle="round,pad=0.01,rounding_size=0.02",
            facecolor=bg_dark_p, edgecolor=color_p, linewidth=2.5,
            transform=ax_head_all.transAxes
        )
        ax_head_all.add_patch(card_all)
        
        ax_head_all.text(
            0.5, 0.78, "◆ ACTIVE TROPICAL CYCLONES STATUS REPORT ◆",
            transform=ax_head_all.transAxes, ha='center', va='center',
            fontsize=11, fontweight='black', color='white'
        )
        
        active_storms_text = " Active Systems: " + ", ".join(
            [f"{get_storm_name(pt['track_id'])} ({pt['lat']:.1f}°N, {pt['lon']:.1f}°E)" for pt in latest_pts]
        )
        ax_head_all.text(
            0.05, 0.38, active_storms_text,
            transform=ax_head_all.transAxes, ha='left', va='center',
            fontsize=9.5, fontweight='bold', color='white', fontfamily='monospace'
        )
        
        spec_all = ax_dummy_all.get_subplotspec()
        ax_dummy_all.remove()
        ax_all = fig_all.add_subplot(spec_all, projection=ccrs.PlateCarree())
        ax_all.set_extent([105, 155, 0, 40], crs=ccrs.PlateCarree())
        
        ax_all.set_facecolor('#87CEEB')
        ax_all.add_feature(cfeature.LAND, facecolor='#DEB887', edgecolor='#8B4513', linewidth=0.8)
        ax_all.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.8, alpha=0.7, color='#654321')
        
        try:
            prov_path = os.path.join(DATA_DIR, "ph_provinces.json")
            if os.path.exists(prov_path):
                with open(prov_path, 'r', encoding='utf-8') as f_prov:
                    geojson_prov = json.load(f_prov)
                province_shapely_geometries = [shape(prov_feat['geometry']) for prov_feat in geojson_prov['features']]
                ax_all.add_geometries(province_shapely_geometries, crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#654321', linewidth=0.4, alpha=0.5, zorder=3)
        except Exception as e:
            print(f"Warning: Failed to load province boundaries: {e}")

        gl_all = ax_all.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
        gl_all.xlocator = plt.FixedLocator(np.arange(105, 156, 5))
        gl_all.ylocator = plt.FixedLocator(np.arange(0, 41, 5))
        gl_all.xlabel_style = {'size': 12, 'weight': 'bold'}
        gl_all.ylabel_style = {'size': 12, 'weight': 'bold'}
        gl_all.top_labels = False
        gl_all.right_labels = False
        
        ax_all.text(118, 13, 'West Philippine\nSea', fontsize=5, color='navy', weight='bold', transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5)
        ax_all.text(130, 20, 'Philippine\nSea', fontsize=9, color='navy', weight='bold', transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5)
        ax_all.text(0.98, 0.02, 'Philippine Typhoon/Weather', transform=ax_all.transAxes, fontsize=10, color='#0f172a', weight='bold', style='italic', ha='right', va='bottom', alpha=0.45, zorder=10)
        ax_all.add_patch(mpatches.Polygon(par_vertices, facecolor='none', edgecolor='#FF6B35', linestyle='-', linewidth=3, alpha=0.8, transform=ccrs.PlateCarree()))
        
        # Loop through and plot each active storm's history
        for latest_pt in latest_pts:
            tid = latest_pt['track_id']
            track_pts_all = [latest_pt]
            curr_lat = latest_pt['lat']
            curr_lon = latest_pt['lon']
            for cycle_info in reversed(base_cycles[:-1]):
                c_name = cycle_info['cycle']
                if c_name not in cycle_points or not cycle_points[c_name]:
                    continue
                candidates = cycle_points[c_name]
                closest_pt = min(candidates, key=lambda pt: haversine_km(curr_lat, curr_lon, pt['lat'], pt['lon']))
                if haversine_km(curr_lat, curr_lon, closest_pt['lat'], closest_pt['lon']) < 600:
                    track_pts_all.append(closest_pt)
                    curr_lat = closest_pt['lat']
                    curr_lon = closest_pt['lon']
            track_pts_all = sorted(track_pts_all, key=lambda x: x['cycle'])
            
            lats = [pt['lat'] for pt in track_pts_all]
            lons = [pt['lon'] for pt in track_pts_all]
            ax_all.plot(lons, lats, color='#475569', linewidth=2.2, linestyle='-', zorder=4, transform=ccrs.PlateCarree())
            for pt in track_pts_all[:-1]:
                _, cat_color, _ = get_category_style(pt.get('wind_kt'), pt.get('pressure_hpa') or pt.get('pressure'))
                ax_all.plot(pt['lon'], pt['lat'], marker='o', color=cat_color, markersize=7, markeredgecolor='white', markeredgewidth=1.0, zorder=5, transform=ccrs.PlateCarree())
                
            _, latest_color, _ = get_category_style(latest_pt['wind_kt'], latest_pt['pressure'])
            ax_all.plot(latest_pt['lon'], latest_pt['lat'], marker='o', color=latest_color, markersize=12, markeredgecolor='white', markeredgewidth=1.5, zorder=7, transform=ccrs.PlateCarree())
            
            s_name = get_storm_name(tid)
            ax_all.text(latest_pt['lon'] + 1.2, latest_pt['lat'] + 1.2, s_name, transform=ccrs.PlateCarree(), fontsize=8, color='black', weight='black', zorder=8)
            
        legend_elements_all = [
            plt.Line2D([0], [0], color='#FF6B35', linewidth=2.2, label='PAR Boundary'),
            plt.Line2D([0], [0], color='#475569', linewidth=2.2, label='Track Line'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#FF007F', markeredgecolor='white', markersize=6, label='Super Typhoon'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#A83232', markeredgecolor='white', markersize=6, label='Typhoon'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#E67E22', markeredgecolor='white', markersize=6, label='Severe Tropical Storm'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#F1C40F', markeredgecolor='white', markersize=6, label='Tropical Storm'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#2ECC71', markeredgecolor='white', markersize=6, label='Tropical Depression'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#3498DB', markeredgecolor='white', markersize=6, label='Low Pressure Area')
        ]
        ax_all.legend(handles=legend_elements_all, loc='upper left', bbox_to_anchor=(0.02, 0.98), frameon=True, facecolor='white', framealpha=0.9, fontsize=8, ncol=2)
        
        output_file_latest = os.path.join(DATA_DIR, "..", "assets", "tc_positions_latest.png")
        plt.savefig(output_file_latest, dpi=300, bbox_inches='tight')
        plt.close()
        print(f"Generic composite analysis map saved to {output_file_latest}")

    # Generate generic tc_forecast_latest.png composite map containing ALL active storms
    if latest_pts and latest_df is not None:
        fig_f_all, (ax_head_f_all, ax_dummy_f_all) = plt.subplots(
            2, 1, 
            figsize=(10, 9.6), 
            gridspec_kw={'height_ratios': [0.12, 0.88], 'hspace': 0.02}
        )
        ax_head_f_all.set_axis_off()
        category_p, color_p, bg_dark_p = get_category_style(primary_pt['wind_kt'], primary_pt['pressure'])
        card_f_all = mpatches.FancyBboxPatch(
            (0.01, 0.05), 0.98, 0.90,
            boxstyle="round,pad=0.01,rounding_size=0.02",
            facecolor=bg_dark_p, edgecolor=color_p, linewidth=2.5,
            transform=ax_head_f_all.transAxes
        )
        ax_head_f_all.add_patch(card_f_all)
        
        ax_head_f_all.text(
            0.5, 0.78, "◆ TROPICAL CYCLONE FORECAST COMPOSITE REPORT ◆",
            transform=ax_head_f_all.transAxes, ha='center', va='center',
            fontsize=11, fontweight='black', color='white'
        )
        
        active_storms_text_f = " Active Systems: " + ", ".join(
            [f"{get_storm_name(pt['track_id'])} ({pt['lat']:.1f}°N, {pt['lon']:.1f}°E)" for pt in latest_pts]
        )
        ax_head_f_all.text(
            0.05, 0.38, active_storms_text_f,
            transform=ax_head_f_all.transAxes, ha='left', va='center',
            fontsize=9.5, fontweight='bold', color='white', fontfamily='monospace'
        )
        
        spec_f_all = ax_dummy_f_all.get_subplotspec()
        ax_dummy_f_all.remove()
        ax_f_all = fig_f_all.add_subplot(spec_f_all, projection=ccrs.PlateCarree())
        ax_f_all.set_extent([105, 155, 0, 40], crs=ccrs.PlateCarree())
        
        ax_f_all.set_facecolor('#87CEEB')
        ax_f_all.add_feature(cfeature.LAND, facecolor='#DEB887', edgecolor='#8B4513', linewidth=0.8)
        ax_f_all.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.8, alpha=0.7, color='#654321')
        
        try:
            prov_path = os.path.join(DATA_DIR, "ph_provinces.json")
            if os.path.exists(prov_path):
                with open(prov_path, 'r', encoding='utf-8') as f_prov:
                    geojson_prov = json.load(f_prov)
                province_shapely_geometries = [shape(prov_feat['geometry']) for prov_feat in geojson_prov['features']]
                ax_f_all.add_geometries(province_shapely_geometries, crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#654321', linewidth=0.4, alpha=0.5, zorder=3)
        except:
            pass

        gl_f_all = ax_f_all.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.5, linestyle='--')
        gl_f_all.xlocator = plt.FixedLocator(np.arange(105, 156, 5))
        gl_f_all.ylocator = plt.FixedLocator(np.arange(0, 41, 5))
        gl_f_all.xlabel_style = {'size': 12, 'weight': 'bold'}
        gl_f_all.ylabel_style = {'size': 12, 'weight': 'bold'}
        gl_f_all.top_labels = False
        gl_f_all.right_labels = False
        
        ax_f_all.text(118, 13, 'West Philippine\nSea', fontsize=5, color='navy', weight='bold', transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5)
        ax_f_all.text(130, 20, 'Philippine\nSea', fontsize=9, color='navy', weight='bold', transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.5)
        ax_f_all.text(0.98, 0.02, 'Philippine Typhoon/Weather', transform=ax_f_all.transAxes, fontsize=10, color='#0f172a', weight='bold', style='italic', ha='right', va='bottom', alpha=0.45, zorder=10)
        ax_f_all.add_patch(mpatches.Polygon(par_vertices, facecolor='none', edgecolor='#FF6B35', linestyle='-', linewidth=3, alpha=0.8, transform=ccrs.PlateCarree()))
        
        # Loop through and plot each active storm's forecast track & cone
        for latest_pt in latest_pts:
            tid = latest_pt['track_id']
            storm_df = latest_df[
                (latest_df['track_id'].str.strip() == tid) & 
                (latest_df['sample'] == -1) & 
                (latest_df['lead_time_hours'] >= 0)
            ]
            storm_df = storm_df.sort_values(by='lead_time_hours')
            
            if not storm_df.empty:
                f_lats = storm_df['lat'].tolist()
                f_lons = storm_df['lon'].tolist()
                f_leads = storm_df['lead_time_hours'].tolist()
                f_winds = storm_df['maximum_sustained_wind_speed_knots'].tolist()
                f_pressures = storm_df['minimum_sea_level_pressure_hpa'].tolist()
                
                # Cone of Uncertainty
                cone_coords = build_cone_polygon(f_lats, f_lons, f_leads)
                if cone_coords:
                    cone_lons = [p[0] for p in cone_coords]
                    cone_lats = [p[1] for p in cone_coords]
                    ax_f_all.fill(cone_lons, cone_lats, color='white', alpha=0.15, transform=ccrs.PlateCarree(), zorder=3)
                    ax_f_all.plot(cone_lons, cone_lats, color='white', linestyle='--', linewidth=1.2, alpha=0.5, transform=ccrs.PlateCarree(), zorder=3)
                
                # Reconstruct history for the gray line
                track_pts_all = [latest_pt]
                curr_lat = latest_pt['lat']
                curr_lon = latest_pt['lon']
                for cycle_info in reversed(base_cycles[:-1]):
                    c_name = cycle_info['cycle']
                    if c_name not in cycle_points or not cycle_points[c_name]:
                        continue
                    candidates = cycle_points[c_name]
                    closest_pt = min(candidates, key=lambda pt: haversine_km(curr_lat, curr_lon, pt['lat'], pt['lon']))
                    if haversine_km(curr_lat, curr_lon, closest_pt['lat'], closest_pt['lon']) < 600:
                        track_pts_all.append(closest_pt)
                        curr_lat = closest_pt['lat']
                        curr_lon = closest_pt['lon']
                track_pts_all = sorted(track_pts_all, key=lambda x: x['cycle'])
                
                # Plot History (Gray)
                hist_lats = [pt['lat'] for pt in track_pts_all]
                hist_lons = [pt['lon'] for pt in track_pts_all]
                if len(hist_lats) > 1:
                    ax_f_all.plot(hist_lons, hist_lats, color='#94a3b8', linewidth=2.0, linestyle='--', zorder=4, transform=ccrs.PlateCarree())
                    for pt in track_pts_all[:-1]:
                        ax_f_all.plot(pt['lon'], pt['lat'], marker='o', color='#cbd5e1', markersize=5, markeredgecolor='#94a3b8', markeredgewidth=0.8, zorder=5, transform=ccrs.PlateCarree())
                
                # Plot Forecast Line
                ax_f_all.plot(f_lons, f_lats, color='#475569', linewidth=2.5, linestyle='-', zorder=4, transform=ccrs.PlateCarree())
                
                # Plot forecast points
                for i, (lat, lon, lead, wind, press) in enumerate(zip(f_lats, f_lons, f_leads, f_winds, f_pressures)):
                    _, cat_color, _ = get_category_style(wind, press)
                    is_start = (i == 0)
                    markersize = 12 if is_start else 7
                    markeredgewidth = 1.5 if is_start else 1.0
                    zorder = 7 if is_start else 5
                    ax_f_all.plot(lon, lat, marker='o', color=cat_color, markersize=markersize, markeredgecolor='white', markeredgewidth=markeredgewidth, zorder=zorder, transform=ccrs.PlateCarree())
                    
                s_name = get_storm_name(tid)
                ax_f_all.text(latest_pt['lon'] + 1.2, latest_pt['lat'] + 1.2, s_name, transform=ccrs.PlateCarree(), fontsize=8, color='black', weight='black', zorder=8)
                
        legend_elements_f_all = [
            plt.Line2D([0], [0], color='#FF6B35', linewidth=2.2, label='PAR Boundary'),
            plt.Line2D([0], [0], color='#475569', linewidth=2.5, label='Forecast Track'),
            plt.Line2D([0], [0], color='#94a3b8', linewidth=2.0, linestyle='--', label='Past Track (History)'),
            mpatches.Patch(facecolor='white', edgecolor='white', linestyle='--', alpha=0.3, label='Cone of Uncertainty'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#FF007F', markeredgecolor='white', markersize=6, label='Super Typhoon'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#A83232', markeredgecolor='white', markersize=6, label='Typhoon'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#E67E22', markeredgecolor='white', markersize=6, label='Severe Tropical Storm'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#F1C40F', markeredgecolor='white', markersize=6, label='Tropical Storm'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#2ECC71', markeredgecolor='white', markersize=6, label='Tropical Depression'),
            plt.Line2D([0], [0], marker='o', color='none', markerfacecolor='#3498DB', markeredgecolor='white', markersize=6, label='Low Pressure Area')
        ]
        ax_f_all.legend(handles=legend_elements_f_all, loc='upper left', bbox_to_anchor=(0.02, 0.98), frameon=True, facecolor='white', framealpha=0.9, fontsize=8, ncol=2)
        
        output_file_latest_f = os.path.join(DATA_DIR, "..", "assets", "tc_forecast_latest.png")
        plt.savefig(output_file_latest_f, dpi=300, bbox_inches='tight')
        plt.close()
        print(f"Generic composite forecast map saved to {output_file_latest_f}")
        
    # Maintain/Update storms index file (tc_storms_index.json)
    index_path = os.path.join(DATA_DIR, "tc_storms_index.json")
    storms_index = []
    if os.path.exists(index_path):
        try:
            with open(index_path, 'r') as f_idx:
                storms_index = json.load(f_idx)
        except Exception as e:
            print(f"Warning: Could not read index file {index_path}: {e}")
            
    # Mark storms not in active_track_ids as inactive
    for item in storms_index:
        if item['track_id'] not in active_track_ids:
            item['active'] = False
            
    # Update active storms in index
    for tid, info in active_storms_info.items():
        found = False
        for item in storms_index:
            if item['track_id'] == tid:
                item['storm_name'] = info['storm_name']
                item['active'] = True
                item['last_updated'] = info['last_updated']
                item['latest_lat'] = info['latest_lat']
                item['latest_lon'] = info['latest_lon']
                item['category'] = info['category']
                found = True
                break
                
        if not found:
            storms_index.append({
                'track_id': tid,
                'storm_name': info['storm_name'],
                'active': True,
                'last_updated': info['last_updated'],
                'latest_lat': info['latest_lat'],
                'latest_lon': info['latest_lon'],
                'category': info['category']
            })
            
    storms_index = sorted(storms_index, key=lambda x: x['last_updated'], reverse=True)
    
    with open(index_path, 'w') as f_idx:
        json.dump(storms_index, f_idx, indent=2)
    print(f"Index successfully updated at {index_path}")

if __name__ == "__main__":
    main()