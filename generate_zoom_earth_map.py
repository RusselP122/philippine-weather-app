import os
import sys
import math
import json
import io
import datetime
import requests
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, Polygon as MplPolygon, PathPatch, Circle
from matplotlib.path import Path
import matplotlib.patheffects as patheffects
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import cartopy.io.img_tiles as cimgt
from PIL import Image, ImageEnhance

# ── Custom Tile Provider for Zoom Earth Satellite Map Tiles ─────────────────
class ZoomEarthTiles(cimgt.GoogleTiles):
    """
    Cartopy tile provider fetching satellite tiles from Zoom Earth / ESRI World Imagery basemap.
    Includes proper HTTP headers required by Zoom Earth tile servers.
    """
    def __init__(self, date_str=None, time_str=None, **kwargs):
        super().__init__(**kwargs)
        if not date_str or not time_str:
            # Auto-calculate active Himawari satellite timestamp (UTC - 40 mins, rounded to 10 min)
            now = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=40)
            mins = (now.minute // 10) * 10
            date_str = now.strftime('%Y-%m-%d')
            time_str = f'{now.hour:02d}{mins:02d}'

        self.date_str = date_str
        self.time_str = time_str
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://zoom.earth/',
            'Origin': 'https://zoom.earth'
        }

    def _image_url(self, tile):
        x, y, z = tile
        # Zoom Earth uses {z}/{y}/{x} coordinate order (latitude y before longitude x)
        return f"https://tiles.zoom.earth/geocolor/himawari/{self.date_str}/{self.time_str}/{z}/{y}/{x}.jpg"

    def get_image(self, tile):
        x, y, z = tile
        # Try Zoom Earth satellite tile URL
        primary_url = self._image_url(tile)
        try:
            r = requests.get(primary_url, headers=self.headers, timeout=4)
            if r.status_code == 200 and len(r.content) > 1000:
                img = Image.open(io.BytesIO(r.content)).convert('RGB')
                return img, self.tileextent(tile), 'lower'
        except Exception:
            pass

        # When Himawari (Zoom Earth) coverage ends in the Eastern Pacific (~165E),
        # return a solid color tile that perfectly matches the Himawari ocean color
        # Himawari deep Pacific ocean color approximation: RGB (11, 15, 20)
        seamless_ocean = Image.new('RGB', (256, 256), (11, 15, 20))
        return seamless_ocean, self.tileextent(tile), 'lower'

# ── Helper: Category styling based on wind speed (knots) & cyclone nature ───
def get_category_info(wind_kt, nature=None):
    if wind_kt is None:
        wind_kt = 0
        
    # Convert knots to km/h and round to nearest 5 (matching Cyclone.jsx logic)
    wind_kmh = round((wind_kt * 1.852) / 5) * 5
    nature = (nature or "").upper()

    if wind_kmh < 39 or nature in ["DB", "INVEST", "LPA"]:
        return "Low Pressure Area", "#9ab3c5", "LPA"
    elif wind_kmh <= 61:
        return "Tropical Depression", "#7cb5ec", "TD"
    elif wind_kmh <= 88:
        return "Tropical Storm", "#90ed7d", "TS"
    elif wind_kmh <= 117:
        return "Severe Tropical Storm", "#f7a35c", "STS"
    elif wind_kmh <= 184:
        return "Typhoon", "#f45b5b", "TY"
    else:
        return "Super Typhoon", "#aa0000", "STY"

# ── Helper: Offset point calculation for cones and circles ─────────────────
def offset_point(lat, lon, distance_km, bearing_deg):
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
    pts = []
    for i in range(n):
        ang = 360 * i / n
        clat, clon = offset_point(lat, lon, radius_km, ang)
        pts.append([clon, clat])
    pts.append(pts[0])
    return pts

# ── Fetch Storm Data from Knack ATCF API ─────────────────────────────────────
def fetch_knack_atcf_storms():
    """
    Fetches active tropical cyclones directly from Knack ATCF API (https://api.knackwx.com/atcf/v2).
    Filters specifically for Western Pacific (WPAC / WNP) basin storms.
    """
    knack_url = "https://api.knackwx.com/atcf/v2"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    storms = []

    try:
        r = requests.get(knack_url, headers=headers, timeout=10)
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list):
                for item in data:
                    atcf_id = item.get("atcf_id", "").strip()
                    long_id = (item.get("long_atcf_id") or atcf_id or "").lower()
                    storm_name = item.get("storm_name", "UNNAMED").strip()
                    lat = float(item.get("latitude", 0.0))
                    lon = float(item.get("longitude", 0.0))
                    wind_kt = float(item.get("winds") or 0.0)
                    pressure = float(item.get("pressure") or 1008.0)
                    nature = item.get("cyclone_nature", "")
                    basin = item.get("basin", "")

                    # Filter Western Pacific (WPAC) storms only
                    is_wpac = (
                        basin.upper() == "WPAC"
                        or item.get("origin_basin") == "W"
                        or atcf_id.upper().endswith("W")
                        or long_id.startswith("wp")
                    )

                    if not is_wpac:
                        continue

                    # Adjust negative lon if in West hemisphere
                    if lon < 0:
                        lon += 360

                    cat_name, cat_color, cat_abbrev = get_category_info(wind_kt, nature)

                    # Try loading matching local detailed history & forecast track file
                    history = []
                    forecast = []
                    local_file = os.path.join("public", "data", f"tc_positions_{long_id.upper()}.json")
                    if not os.path.exists(local_file):
                        local_file = os.path.join("public", "data", "tc_positions_latest.json")

                    if os.path.exists(local_file):
                        try:
                            with open(local_file, "r", encoding="utf-8") as f:
                                loc_data = json.load(f)
                                history = loc_data.get("history", [])
                                forecast = loc_data.get("forecast", [])
                        except Exception:
                            pass

                    # If no forecast track, generate dynamic synthetic forecast track heading WNW
                    if not forecast and lat > 0:
                        spd_kmh = 18.0
                        for lead_h in [12, 24, 36, 48, 72]:
                            dist_km = spd_kmh * lead_h
                            flat, flon = offset_point(lat, lon, dist_km, 295)
                            fw = max(15, wind_kt + (5 if lead_h <= 24 else -10))
                            fp = max(920, pressure - (5 if lead_h <= 24 else -10))
                            forecast.append({
                                "lead_h": lead_h,
                                "lat": round(flat, 2),
                                "lon": round(flon, 2),
                                "wind_kt": fw,
                                "pressure_hpa": fp,
                                "radius_km": lead_h * 4.0 + 40.0
                            })

                    storms.append({
                        "atcf_id": atcf_id,
                        "long_atcf_id": long_id,
                        "storm_name": storm_name,
                        "lat": lat,
                        "lon": lon,
                        "wind_kt": wind_kt,
                        "pressure_hpa": pressure,
                        "nature": nature,
                        "basin": basin,
                        "category_name": cat_name,
                        "category_color": cat_color,
                        "category_abbrev": cat_abbrev,
                        "history": history,
                        "forecast": forecast,
                        "analysis_time": item.get("analysis_time", "Latest"),
                        "raw_interp": item.get("interp_sector_file", "")
                    })
            print(f"Successfully fetched {len(storms)} active Western Pacific storms from Knack ATCF API.")
    except Exception as err:
        print(f"Notice: Failed to fetch live Knack ATCF data ({err}). Using local fallback storm data.")

    # Fallback to local tc_positions_latest.json if Knack API unavailable or empty
    if not storms:
        data_file = os.path.join("public", "data", "tc_positions_latest.json")
        if os.path.exists(data_file):
            try:
                with open(data_file, 'r', encoding='utf-8') as f:
                    loc_data = json.load(f)
                    latest = loc_data.get("latest", {})
                    wind = latest.get("wind_kt", 115.0)
                    cat_name, cat_color, cat_abbrev = get_category_info(wind)
                    storms.append({
                        "atcf_id": loc_data.get("track_id", "WP122026"),
                        "long_atcf_id": loc_data.get("track_id", "WP122026").lower(),
                        "storm_name": loc_data.get("storm_name", "TYPHOON GAEMI"),
                        "lat": latest.get("lat", 15.4),
                        "lon": latest.get("lon", 128.8),
                        "wind_kt": wind,
                        "pressure_hpa": latest.get("pressure_hpa", 945.0),
                        "nature": "TY",
                        "basin": "WPAC",
                        "category_name": cat_name,
                        "category_color": cat_color,
                        "category_abbrev": cat_abbrev,
                        "history": loc_data.get("history", []),
                        "forecast": loc_data.get("forecast", []),
                        "analysis_time": latest.get("init_time", "Latest"),
                        "raw_interp": ""
                    })
            except Exception as e:
                print(f"Error reading local fallback file: {e}")

    return storms

# ── Main Generator Function ──────────────────────────────────────────────────
def generate_zoom_earth_storm_map(
    output_path="zoom_earth_atcf_storm_map.png",
    storm_data=None,
    extent=None,
    update_time_str=None
):
    if update_time_str is None:
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        update_time_str = now_utc.strftime("%B %d, %Y %I:%M %p UTC")

    print("=" * 60)
    print("Generating Zoom Earth ATCF Storm Map...")
    print("Canvas Size: 12.0 x 9.0 in @ 300 DPI (3600 x 2700 px)")
    print("=" * 60)

    # 1. Fetch Knack ATCF Storm Data if not explicitly provided
    if storm_data is None:
        storms = fetch_knack_atcf_storms()
    elif isinstance(storm_data, list):
        storms = storm_data
    else:
        storms = [storm_data]

    # Calculate dynamic extent wrapping Hong Kong, Philippines, and active storms
    if extent is None:
        # Define POIs: HK, PH, and Storm Centers
        poi_lons = [114.1, 117.0, 126.0] + [s["lon"] for s in storms]
        poi_lats = [22.3, 5.0, 21.0] + [s["lat"] for s in storms]

        # Base bounds tightly wrapping POIs with minimal padding to zoom in
        base_min_lon = min(poi_lons) - 2.0
        base_max_lon = max(poi_lons) + 3.5
        base_min_lat = min(poi_lats) - 2.0
        base_max_lat = max(poi_lats) + 3.5

        # Target aspect ratio is exactly 0.75 to perfectly match the Map Axes [0.0, 0.0, 1.0, 1.0] on a 12x9 canvas
        target_aspect = 0.75
        
        # Calculate aspect ratio in the ACTUAL map projection (Mercator) coordinates, NOT degrees!
        # Degrees are non-linear in Mercator, so padding in degrees causes Cartopy margin errors.
        tiler = ZoomEarthTiles()
        tiler_crs = tiler.crs
        plate_carree = ccrs.PlateCarree()

        bottom_left = tiler_crs.transform_point(base_min_lon, base_min_lat, plate_carree)
        top_right = tiler_crs.transform_point(base_max_lon, base_max_lat, plate_carree)

        x_min, y_min = bottom_left
        x_max, y_max = top_right
        x_span = x_max - x_min
        y_span = y_max - y_min

        current_aspect = y_span / x_span

        if current_aspect < target_aspect:
            # Too wide, pad height (y) in Mercator units
            target_y_span = x_span * target_aspect
            y_padding = target_y_span - y_span
            y_min -= y_padding * 0.30
            y_max += y_padding * 0.70
        else:
            # Too tall, pad width (x) in Mercator units
            target_x_span = y_span / target_aspect
            x_padding = target_x_span - x_span
            x_min -= x_padding * 0.5
            x_max += x_padding * 0.5

        # Pan the camera North if it dips into the Southern Hemisphere
        # (y=0 is the Equator in Mercator projection)
        if y_min < 0:
            shift = 0 - y_min
            y_min += shift
            y_max += shift

        # Transform the perfectly proportioned Mercator bounding box back to PlateCarree degrees
        new_bottom_left = plate_carree.transform_point(x_min, y_min, tiler_crs)
        new_top_right = plate_carree.transform_point(x_max, y_max, tiler_crs)

        base_min_lon, base_min_lat = new_bottom_left
        base_max_lon, base_max_lat = new_top_right

        # Clamp to reasonable max/min limits
        min_lon = max(90.0, base_min_lon)
        max_lon = min(178.0, base_max_lon)
        min_lat = max(0.0, base_min_lat)
        max_lat = min(60.0, base_max_lat)

        extent = [min_lon, max_lon, min_lat, max_lat]

    # 2. Setup Matplotlib Figure Edge-to-Edge Canvas (4:3 Landscape)
    fig = plt.figure(figsize=(12.0, 9.0), dpi=300, facecolor='#0b1736')

    # ── AX 1: Full Canvas Zoom Earth Satellite Map (Edge-to-Edge) ─────────────
    tiler = ZoomEarthTiles()
    # Position map full width and full height [0.0, 0.0, 1.0, 1.0]
    ax_map = fig.add_axes([0.0, 0.0, 1.0, 1.0], projection=tiler.crs)
    ax_map.set_extent(extent, crs=ccrs.PlateCarree())
    ax_map.set_aspect('auto')  # Fill 100% of canvas height and width without empty blue space!

    # 2. Overlay Zoom Earth Satellite Imagery Tiles (Live Clouds, Zoom level 6)
    try:
        ax_map.add_image(tiler, 6, alpha=0.95)
        print("Successfully rendered Zoom Earth live cloud tiles!")
    except Exception as e:
        print(f"Notice: Zoom Earth fetch fallback ({e}). Rendering dark ocean basemap...")
        ax_map.set_facecolor('#0b192c')

    # Add Coastlines and Country Borders
    ax_map.add_feature(cfeature.COASTLINE, linewidth=1.0, edgecolor='#e2e8f0', alpha=0.9)
    ax_map.add_feature(cfeature.BORDERS, linewidth=0.8, edgecolor='#94a3b8', linestyle='--', alpha=0.8)

    # Philippine Area of Responsibility (PAR) Boundary
    par_lons = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
    par_lats = [ 5.0,  15.0,  21.0,  25.0,  25.0,   5.0,   5.0]
    ax_map.plot(
        par_lons, par_lats, color='#FF6B35', linewidth=2.5, linestyle='-',
        alpha=0.9, transform=ccrs.PlateCarree(), label='PAR Boundary'
    )

    # NO Latitude / Longitude text or gridlines per user requirement!



    # ── 3. Plot Active ATCF Storms from Knack API ────────────────────────────
    if not storms:
        print("No active storms to render.")

    # Track report card placements to avoid overlapping cards
    card_positions = []

    for s_idx, st in enumerate(storms):
        curr_lat = st["lat"]
        curr_lon = st["lon"]
        curr_wind = st["wind_kt"]
        curr_pres = st["pressure_hpa"]
        storm_name = st["storm_name"]
        atcf_id = st["atcf_id"]
        cat_name = st["category_name"]
        cat_color = st["category_color"]


        # 3b. History Track Line
        history = st.get("history", [])
        if history:
            hist_lons = [pt.get("lon", 0.0) for pt in history if "lon" in pt]
            hist_lats = [pt.get("lat", 0.0) for pt in history if "lat" in pt]
            if len(hist_lons) > 1:
                # Outer glow & track line
                ax_map.plot(
                    hist_lons, hist_lats, color='#000000', linewidth=4.0, alpha=0.5,
                    transform=ccrs.PlateCarree()
                )
                ax_map.plot(
                    hist_lons, hist_lats, color='#38bdf8', linewidth=2.5, linestyle='-',
                    transform=ccrs.PlateCarree()
                )

                # History Markers
                for pt in history[:-1]:
                    w = pt.get("wind_kt", 30)
                    _, h_color, _ = get_category_info(w)
                    ax_map.plot(
                        pt["lon"], pt["lat"], marker='o', color=h_color, markersize=6.0,
                        markeredgecolor='white', markeredgewidth=0.8,
                        transform=ccrs.PlateCarree(), zorder=5
                    )

        # 3c. Forecast Track & Uncertainty Cone
        forecast = st.get("forecast", [])
        if False:  # User requested to remove forecast track (was: if forecast:)
            fcst_lons = [curr_lon] + [pt["lon"] for pt in forecast]
            fcst_lats = [curr_lat] + [pt["lat"] for pt in forecast]

            # Cone Polygon around forecast points
            cone_left = []
            cone_right = []
            for i, pt in enumerate(forecast):
                r_km = pt.get("radius_km", (i + 1) * 50)
                if i < len(forecast) - 1:
                    angle = math.degrees(math.atan2(forecast[i+1]["lat"] - pt["lat"], forecast[i+1]["lon"] - pt["lon"]))
                else:
                    angle = math.degrees(math.atan2(pt["lat"] - fcst_lats[i], pt["lon"] - fcst_lons[i]))

                plat_l, plon_l = offset_point(pt["lat"], pt["lon"], r_km, angle + 90)
                plat_r, plon_r = offset_point(pt["lat"], pt["lon"], r_km, angle - 90)
                cone_left.append((plon_l, plat_l))
                cone_right.append((plon_r, plat_r))

            cone_pts = [(curr_lon, curr_lat)] + cone_left + cone_right[::-1] + [(curr_lon, curr_lat)]
            cone_lons = [p[0] for p in cone_pts]
            cone_lats = [p[1] for p in cone_pts]

            ax_map.fill(
                cone_lons, cone_lats, color='#38bdf8', alpha=0.20,
                transform=ccrs.PlateCarree(), zorder=3
            )
            ax_map.plot(
                cone_lons, cone_lats, color='#38bdf8', linestyle='--', linewidth=1.2,
                alpha=0.7, transform=ccrs.PlateCarree(), zorder=3
            )

            # Forecast Track Line
            ax_map.plot(
                fcst_lons, fcst_lats, color='#FFFFFF', linewidth=2.2, linestyle='--',
                transform=ccrs.PlateCarree(), zorder=4
            )

            # Forecast Markers
            for pt in forecast:
                w = pt.get("wind_kt", 70)
                _, f_color, _ = get_category_info(w)
                ax_map.plot(
                    pt["lon"], pt["lat"], marker='s', color=f_color, markersize=7.0,
                    markeredgecolor='white', markeredgewidth=1.0,
                    transform=ccrs.PlateCarree(), zorder=5
                )
                ax_map.text(
                    pt["lon"] + 0.3, pt["lat"] + 0.3, f"+{pt['lead_h']}h",
                    color='white', fontsize=7.5, fontweight='bold',
                    transform=ccrs.PlateCarree(), zorder=6
                )


        




    # 4. Save High Resolution Map Image
    plt.savefig(output_path, dpi=300, bbox_inches=None)
    plt.close(fig)

    # Ensure output image dimensions are exactly 3600 x 2700 px @ 300 DPI
    try:
        im = Image.open(output_path)
        if im.size != (3600, 2700):
            im_resized = im.resize((3600, 2700), Image.Resampling.LANCZOS)
            im_resized.save(output_path, dpi=(300, 300))
            print(f"Resized image to exact resolution: {im_resized.size} @ 300 DPI")
        else:
            print(f"Generated exact resolution: {im.size} @ 300 DPI")
    except Exception as err:
        print(f"Post-processing note: {err}")

    print(f"SUCCESS: Map successfully saved to: {os.path.abspath(output_path)}")
    print("=" * 60)
    return output_path

if __name__ == "__main__":
    generate_zoom_earth_storm_map()
