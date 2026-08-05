import os
import json
import requests
import datetime
import geopandas as gpd
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from dateutil import parser
import re

API_URL = "https://www.panahon.gov.ph/api/v1/cap-alerts?token=sH2S6zIL6jKA7lgffdgyI3kGTZgPjGdiHCsIocAW"
GEOJSON_PATH = "public/data/ph_provinces.json"
OUTPUT_PATH = "public/facebook_alert_post.png"

# Color mappings based on alert.jsx
COLORS = {
    'red': '#ef4444',
    'orange': '#f97316',
    'yellow': '#facc15',
    'affecting': '#38bdf8',  # Using rainfall light-moderate by default
    'expecting': '#10b981',  # Emerald green for standby
    'default': '#334155', # Base province color
    'bg': '#020617', # Slate 950 background
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

def get_alerts():
    response = requests.get(API_URL)
    response.raise_for_status()
    data = response.json()
    
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
            except:
                pass
                
        if a.get('issued_date'):
            try:
                issued_dt = parser.parse(a['issued_date'])
                if issued_dt.tzinfo is None:
                    issued_dt = issued_dt.replace(tzinfo=datetime.timezone(datetime.timedelta(hours=8)))
                # Within last 3 hours or a bit in future
                diff = (now - issued_dt).total_seconds()
                if diff < -300 or diff > 3 * 3600:
                    continue
            except:
                pass
        
        filtered_alerts.append(a)
        
    return filtered_alerts

def polygon_str_to_shapely(poly_str):
    from shapely.geometry import Polygon
    if not poly_str or not isinstance(poly_str, str): return None
    try:
        parts = poly_str.strip().split()
        ring = []
        for p in parts:
            if ',' in p:
                lat_str, lon_str = p.split(',')
                # matplotlib uses (lon, lat) mapping to (x, y)
                ring.append((float(lon_str), float(lat_str)))
        if len(ring) >= 3:
            return Polygon(ring)
    except:
        pass
    return None

def shape_str_to_shapely(shape_str):
    import json
    from shapely.geometry import Polygon, MultiPolygon
    if not shape_str or not isinstance(shape_str, str): return None
    try:
        raw = json.loads(shape_str)
        def to_lon_lat(pair):
            if not isinstance(pair, list) or len(pair) < 2: return None
            v1, v2 = pair[0], pair[1]
            if not isinstance(v1, (int, float)) or not isinstance(v2, (int, float)): return None
            if v1 > 50 and v2 < 50: return (v1, v2)
            if v1 < 50 and v2 > 50: return (v2, v1)
            return (v1, v2)

        def convert_ring(r):
            return [res for p in r if (res := to_lon_lat(p)) is not None]

        if len(raw) and isinstance(raw[0], list) and len(raw[0]) and isinstance(raw[0][0], (int, float)):
            ring = convert_ring(raw)
            if len(ring) >= 3: return Polygon(ring)
            
        if len(raw) and isinstance(raw[0], list) and len(raw[0]) and isinstance(raw[0][0], list):
            if isinstance(raw[0][0][0], (int, float)):
                polys = [Polygon(convert_ring(r)) for r in raw if len(convert_ring(r)) >= 3]
                return MultiPolygon(polys) if polys else None
                
            polys = []
            for poly in raw:
                if isinstance(poly, list):
                    for r in poly:
                        cr = convert_ring(r)
                        if len(cr) >= 3: polys.append(Polygon(cr))
            return MultiPolygon(polys) if polys else None
    except:
        pass
    return None

def main():
    print("Loading geographic data...")
    if not os.path.exists(GEOJSON_PATH):
        print(f"Error: Could not find {GEOJSON_PATH}")
        return
        
    gdf = gpd.read_file(GEOJSON_PATH)
    
    # Normalize province names for matching
    def clean_name(name):
        n = str(name).strip().lower()
        if 'manila' in n:
            return 'metropolitan manila'
        return n
        
    gdf['clean_name'] = gdf.apply(lambda row: clean_name(row.get('PROV_NAME', '') or row.get('PROVINCE', '') or row.get('NAME_1', '')), axis=1)
    
    print("Fetching alerts...")
    alerts = get_alerts()
    print(f"Found {len(alerts)} active alerts.")
    
    # Collect alert polygons
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
                
            color = None
            if warning_level in ['red', 'orange', 'yellow']:
                color = COLORS[warning_level]
            elif area_type in ['affecting', 'light-moderate', 'light moderate', 'moderate']:
                color = COLORS['affecting']
            elif area_type in ['expecting', 'expected']:
                color = COLORS['expecting']
            else:
                color = COLORS['affecting']
                
            # Attempt to extract geometry directly from CAP alert shape or polygon string
            geom = None
            if prov.get('shape'):
                geom = shape_str_to_shapely(prov.get('shape'))
            if not geom and prov.get('polygon'):
                geom = polygon_str_to_shapely(prov.get('polygon'))
                
            c_name = clean_name(name)
            
            color_label = None
            if color == COLORS['red']: color_label = '🔴 RED WARNING'
            elif color == COLORS['orange']: color_label = '🟠 ORANGE WARNING'
            elif color == COLORS['yellow']: color_label = '🟡 YELLOW ADVISORY'
            elif color == COLORS['affecting']: color_label = '🟦 AFFECTING'
            elif color == COLORS['expecting']: color_label = '🟩 EXPECTING'

            if geom:
                # We have a specific municipality geometry from the alert
                alert_shapes.append({'name': name, 'province': province_name, 'municipality': municipality_name, 'color_label': color_label, 'geometry': geom, 'color': color, 'priority': {'#ef4444': 5, '#f97316': 4, '#facc15': 3, '#38bdf8': 2, '#10b981': 1}.get(color, 0)})
            else:
                # Fallback to province matching if no geometry in CAP alert
                matching_geom = gdf[gdf['clean_name'] == c_name]
                if matching_geom.empty:
                    matching_geom = gdf[gdf['clean_name'].str.contains(c_name, regex=False)]
                
                if not matching_geom.empty:
                    alert_shapes.append({'name': name, 'province': province_name, 'municipality': municipality_name, 'color_label': color_label, 'geometry': matching_geom.geometry.iloc[0], 'color': color, 'priority': {'#ef4444': 5, '#f97316': 4, '#facc15': 3, '#38bdf8': 2, '#10b981': 1}.get(color, 0)})

    def get_island_group(region_str):
        if not region_str: return "Luzon"
        r = str(region_str).lower()
        if "visayas" in r: return "Visayas"
        if any(x in r for x in ["zamboanga", "mindanao", "davao", "soccsksargen", "caraga", "bangsamoro", "muslim"]):
            return "Mindanao"
        return "Luzon"

    gdf['island_group'] = gdf['REGION'].apply(get_island_group)

    # Sort shapes by priority to render higher priority warnings on top
    alert_shapes.sort(key=lambda x: x['priority'])

    # Figure out which island groups have active alerts
    active_groups = set()
    for shape in alert_shapes:
        try:
            centroid = shape['geometry'].centroid
            distances = gdf.geometry.distance(centroid)
            closest_idx = distances.idxmin()
            group = gdf.loc[closest_idx, 'island_group']
            active_groups.add(group)
            shape['island_group'] = group
        except:
            active_groups.update(["Luzon", "Visayas", "Mindanao"])
            shape['island_group'] = "Luzon"

    if not active_groups:
        print("No active rainfall alerts found. No images will be generated.")
        return

    # Render a map for each active group
    for target_group in ["Luzon", "Visayas", "Mindanao"]:
        if target_group not in active_groups:
            print(f"No alerts in {target_group}. Skipping.")
            continue
            
        print(f"Rendering map for {target_group}...")
        
        # 16:9 Landscape Layout (3840x2160 HD)
        fig = plt.figure(figsize=(19.2, 10.8), dpi=200)
        fig.patch.set_facecolor(COLORS['bg'])
        
        # Map axis takes up the ENTIRE figure
        ax = fig.add_axes([0, 0, 1, 1])
        ax.set_facecolor(COLORS['bg'])
        
        # Isolate the region to focus
        group_gdf = gdf[gdf['island_group'] == target_group]
        
        # Other regions for national context
        other_gdf = gdf[gdf['island_group'] != target_group]
        if not other_gdf.empty:
            other_gdf.plot(ax=ax, color=COLORS['default'], edgecolor='none', alpha=0.25)
            other_gdf.boundary.plot(ax=ax, color='#0f172a', linewidth=1.5, alpha=0.25)
        
        # Create a dissolved mainland for coastlines and glow
        # Fix potential topology errors in the geojson by applying a 0-distance buffer
        valid_geom = group_gdf.geometry.buffer(0)
        mainland = gpd.GeoSeries([valid_geom.union_all()])
        
        # Soft glow behind the region removed        
        # Plot base map ONLY for this region
        group_gdf.plot(ax=ax, color=COLORS['default'], edgecolor='none', linewidth=0)
        
        # Province borders (1.5px)
        group_gdf.boundary.plot(ax=ax, color='#0f172a', linewidth=1.5, alpha=0.5)
        
        # Coastline / Region boundary (3px)
        mainland.boundary.plot(ax=ax, color='#0f172a', linewidth=3.0, alpha=0.8)
        
        # Plot alert shapes (only those inside this region)
        target_alerts = [s for s in alert_shapes if s.get('island_group') == target_group]
        if target_alerts:
            alerts_gdf = gpd.GeoDataFrame(target_alerts, geometry='geometry')
            
            alerts_gdf.plot(ax=ax, color=alerts_gdf['color'], edgecolor='white', linewidth=1.0)
            
            # Zoom logic: Focus on the region, but crop unnecessary ocean
            group_minx, group_miny, group_maxx, group_maxy = group_gdf.total_bounds
            
            # Ensure active alerts are still visible if they fall outside the cropped region
            alert_minx, alert_miny, alert_maxx, alert_maxy = alerts_gdf.total_bounds
            minx = min(group_minx, alert_minx)
            miny = min(group_miny, alert_miny)
            maxx = max(group_maxx, alert_maxx)
            maxy = max(group_maxy, alert_maxy)
            
            width = maxx - minx
            height = maxy - miny
            
            center_x = minx + width / 2
            center_y = miny + height / 2
            
            # Match physical aspect ratio of the FULL screen (10.8 height / 19.2 width)
            target_ratio = 10.8 / 19.2
            if width == 0: width = 1
            if height / width < target_ratio:
                height = width * target_ratio
            else:
                width = height / target_ratio
                
            # Monumental zoom: push the zoom factor up (less padding/crop into the image)
            width = max(width * 0.92, 4.0)
            height = max(height * 0.92, 4.0 * target_ratio)
            
            # Shift the map to the right side of the screen
            # Text takes up left ~45%. We want the map center to sit in the right 55%.
            x_shift = width * 0.20
            
            # Shift the camera down slightly to push the landmass UP into the dead space
            y_shift = height * 0.08
            
            ax.set_xlim(center_x - x_shift - width / 2, center_x - x_shift + width / 2)
            ax.set_ylim(center_y - y_shift - height / 2, center_y - y_shift + height / 2)
            
        # Remove axes
        ax.set_axis_off()
        
        # Gradient overlay removed
        
        # TEXT AND LAYOUT ON THE LEFT SIDE
        # Extract weather system from message or headline
        import re
        import textwrap
        alert_msg = str(alerts[0].get('message', '')).upper() if alerts else ''
        alert_hdln = str(alerts[0].get('headline', 'WEATHER ADVISORY')).upper() if alerts else 'WEATHER ADVISORY'
        
        found_systems = []
        if 'SUPER TYPHOON' in alert_msg or 'SUPER TYPHOON' in alert_hdln:
            found_systems.append("SUPER TYPHOON")
        elif 'TYPHOON' in alert_msg or 'TYPHOON' in alert_hdln:
            found_systems.append("TYPHOON")
        elif 'SEVERE TROPICAL STORM' in alert_msg or 'SEVERE TROPICAL STORM' in alert_hdln:
            found_systems.append("SEVERE TROPICAL STORM")
        elif 'TROPICAL STORM' in alert_msg or 'TROPICAL STORM' in alert_hdln:
            found_systems.append("TROPICAL STORM")
        elif 'TROPICAL DEPRESSION' in alert_msg or 'TROPICAL DEPRESSION' in alert_hdln:
            found_systems.append("TROPICAL DEPRESSION")
        elif 'TROPICAL CYCLONE' in alert_msg or 'TROPICAL CYCLONE' in alert_hdln:
            found_systems.append("TROPICAL CYCLONE")
            
        if 'SOUTHWEST MONSOON' in alert_msg or 'SOUTHWEST MONSOON' in alert_hdln:
            found_systems.append("SOUTHWEST MONSOON")
        if 'LOW PRESSURE AREA' in alert_msg or 'LOW PRESSURE AREA' in alert_hdln:
            found_systems.append("LOW PRESSURE AREA")
        if 'NORTHEAST MONSOON' in alert_msg or 'NORTHEAST MONSOON' in alert_hdln:
            found_systems.append("NORTHEAST MONSOON")
        if 'SHEAR LINE' in alert_msg or 'SHEAR LINE' in alert_hdln or 'TAIL-END' in alert_msg:
            found_systems.append("SHEAR LINE")
        if 'INTERTROPICAL' in alert_msg or 'ITCZ' in alert_msg or 'INTERTROPICAL' in alert_hdln:
            found_systems.append("INTERTROPICAL CONVERGENCE ZONE")
        if 'TROUGH' in alert_msg or 'TROUGH' in alert_hdln:
            found_systems.append("TROUGH OF LPA")
            
        if found_systems:
            latest_headline = " / ".join(found_systems)
        else:
            sys_match = re.search(r'(?:due to|brought by|associated with)\s+(.*)', alert_hdln, re.IGNORECASE)
            if sys_match:
                latest_headline = sys_match.group(1).strip()
            else:
                latest_headline = alert_hdln
                
        latest_headline = latest_headline.replace('\n', ' ')
        latest_headline = textwrap.fill(latest_headline, width=45)
            
        # Title
        fig.text(0.05, 0.82, f"RAINFALL ADVISORY", color="#38bdf8", fontsize=42, fontweight='black', fontfamily='sans-serif')
        fig.text(0.05, 0.77, f"{target_group.upper()}", color="#f1f5f9", fontsize=28, fontweight='bold', fontfamily='sans-serif')
        
        # Headline
        fig.text(0.05, 0.71, "ACTIVE SYSTEM", color="#64748b", fontsize=14, fontweight='bold', fontfamily='sans-serif')
        fig.text(0.05, 0.68, latest_headline, color="#fbbf24", fontsize=20, fontweight='bold', fontfamily='sans-serif', verticalalignment='top')
        
        # Timestamp
        pst = datetime.timezone(datetime.timedelta(hours=8))
        timestamp = datetime.datetime.now(pst).strftime("%I:%M %p, %d %B %Y (%A)")
        fig.text(0.05, 0.58, "LAST UPDATED", color="#64748b", fontsize=14, fontweight='bold', fontfamily='sans-serif')
        fig.text(0.05, 0.55, timestamp, color="#cbd5e1", fontsize=18, fontweight='normal', fontfamily='sans-serif')
        
        # Custom Legend
        fig.text(0.05, 0.49, "WARNING LEVELS", color="#64748b", fontsize=14, fontweight='bold', fontfamily='sans-serif')
        
        legend_items = [
            (COLORS['red'], 'Emergency (Critical)', 'Serious flooding expected. Evacuate.'),
            (COLORS['orange'], 'Warning (High)', 'Flooding is threatening. Be prepared.'),
            (COLORS['yellow'], 'Advisory (Moderate)', 'Flooding is possible. Monitor updates.'),
            (COLORS['affecting'], 'Affecting (Light / Moderate)', 'Currently affecting the area.'),
            (COLORS['expecting'], 'Expecting (Standby)', 'Expected to affect the area.')
        ]
        
        y_pos = 0.44
        for color, title, desc in legend_items:
            # Draw color box
            fig.patches.append(plt.Rectangle((0.05, y_pos), 0.015, 0.025, color=color, transform=fig.transFigure))
            
            # Title
            fig.text(0.075, y_pos + 0.015, title, color=color, fontsize=16, fontweight='bold', fontfamily='sans-serif', verticalalignment='center')
            # Description
            fig.text(0.075, y_pos - 0.005, desc, color="#94a3b8", fontsize=12, fontfamily='sans-serif', verticalalignment='center')
            
            y_pos -= 0.06
        # Footer
        fig.text(0.05, 0.1, "Data automatically generated from Real-Time DOST-PAGASA.\nAlways verify information with official sources.", color="#475569", fontsize=12, fontfamily='sans-serif')
        
        # Watermark
        logo_path = 'public/images/logo.png'
        if os.path.exists(logo_path):
            import matplotlib.image as mpimg
            logo = mpimg.imread(logo_path)
            logo_ax = fig.add_axes([0.85, 0.05, 0.1, 0.1])
            logo_ax.imshow(logo, alpha=0.6)
            logo_ax.axis('off')

        # Generate Caption
        caption_lines = []
        caption_lines.append(f"⚠️ RAINFALL ADVISORY: {target_group.upper()} ⚠️")
        caption_lines.append(f"ACTIVE SYSTEM: {latest_headline}")
        caption_lines.append(f"Issued at: {timestamp}")
        caption_lines.append("")
        
        # Group targets by color label and province
        grouped_areas = {}
        for s in target_alerts:
            label = s.get('color_label')
            if not label: continue
            
            if label not in grouped_areas:
                grouped_areas[label] = {}
                
            prov_name = s.get('province')
            muni_name = s.get('municipality')
            
            if not prov_name:
                continue
                
            if prov_name not in grouped_areas[label]:
                grouped_areas[label][prov_name] = set()
                
            if muni_name:
                grouped_areas[label][prov_name].add(muni_name)
                
        # Priority mapping to match the facebook legend
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
                
                # Sort alphabetically for cleanliness
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

        out_path = OUTPUT_PATH.replace(".png", f"_{target_group}.png")
        plt.savefig(out_path, facecolor=fig.get_facecolor(), bbox_inches=None, pad_inches=0.1, dpi=300)
        print(f"Map successfully saved to {out_path}")
        plt.close(fig)

if __name__ == "__main__":
    main()
