import os
import sys
import math
import json
import io
import re
import argparse
import datetime
import requests
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import cartopy.io.img_tiles as cimgt
from PIL import Image, ImageDraw, ImageFont
import shapely
from shapely.geometry import shape
from shapely.validation import make_valid

# ── Philippine Province Geometries Cache ─────────────────────────────────────
_PROVINCE_GEOMS_CACHE = None

def load_philippine_province_geometries():
    """
    Loads high-resolution Philippine province boundaries from public/data/ph_provinces.json
    cached in memory for instantaneous rendering across frames.
    """
    global _PROVINCE_GEOMS_CACHE
    if _PROVINCE_GEOMS_CACHE is not None:
        return _PROVINCE_GEOMS_CACHE

    geojson_paths = [
        os.path.join(os.getcwd(), "public", "data", "ph_provinces.json"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "data", "ph_provinces.json"),
        "public/data/ph_provinces.json"
    ]
    found_path = next((p for p in geojson_paths if os.path.exists(p)), None)
    if found_path:
        try:
            with open(found_path, "r", encoding="utf-8") as f:
                geo_data = json.load(f)
            _PROVINCE_GEOMS_CACHE = [make_valid(shape(feat["geometry"])) for feat in geo_data.get("features", [])]
            return _PROVINCE_GEOMS_CACHE
        except Exception as e:
            print(f"Notice: Failed to load province boundaries: {e}")
    _PROVINCE_GEOMS_CACHE = []
    return _PROVINCE_GEOMS_CACHE

# ── Shared Requests Session with Connection Pooling ─────────────────────────
_HTTP_SESSION = requests.Session()
_ADAPTER = requests.adapters.HTTPAdapter(pool_connections=30, pool_maxsize=30, max_retries=2)
_HTTP_SESSION.mount('https://', _ADAPTER)
_HTTP_SESSION.mount('http://', _ADAPTER)

# ── 2026 Official PAGASA Name Roster (PAR Sequence) ──────────────────────────
PAGASA_NAMES_2026 = [
    "ADA", "BASYANG", "CALOY", "DOMENG", "ESTER",
    "FRANCISCO", "GARDO", "HENRY", "INDAY", "JOSIE",
    "KIYAPO", "LUIS", "MAYMAY", "NENENG", "OBET",
    "PILANDOK", "QUEENIE", "ROSAL", "SAMUEL", "TOMAS",
    "UMBERTO", "VENUS", "WALDO", "YAYANG", "ZENY"
]

def is_point_inside_par(lat, lon):
    """
    Checks if a geographic point (lat, lon) is within the Philippine Area of Responsibility (PAR).
    PAR polygon vertices: (115, 5), (115, 15), (120, 21), (120, 25), (135, 25), (135, 5)
    """
    poly = [(115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0), (135.0, 25.0), (135.0, 5.0)]
    n = len(poly)
    inside = False
    p1x, p1y = poly[0]
    for i in range(n + 1):
        p2x, p2y = poly[i % n]
        if min(p1y, p2y) < lat <= max(p1y, p2y):
            if lon <= max(p1x, p2x):
                if p1y != p2y:
                    xinters = (lat - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                if p1x == p2x or lon <= xinters:
                    inside = not inside
        p1x, p1y = p2x, p2y
    return inside

def get_storm_classification_label(wind_kt, is_invest=False):
    """
    Classifies tropical cyclone intensity (PAGASA / WMO Standard).
    """
    if is_invest or wind_kt <= 0:
        return "INVEST"
    if wind_kt < 34:
        return "TROPICAL DEPRESSION"
    elif wind_kt < 48:
        return "TROPICAL STORM"
    elif wind_kt < 64:
        return "SEVERE TROPICAL STORM"
    elif wind_kt < 130:
        return "TYPHOON"
    else:
        return "SUPER TYPHOON"

def format_system_display_name(storm_data):
    """
    Standardizes storm/system naming matching forecasttrack.py:
    - Inside PAR with intl name: 'TROPICAL STORM OBET (KROVANH)'
    - Inside PAR without intl name: 'TROPICAL DEPRESSION OBET (17W)'
    - Outside PAR with intl name: 'TROPICAL STORM KROVANH (22W)'
    - Invest: '97W INVEST'
    Appends wind speed & central pressure: ' • 40 KT (74 KM/H) • 998 HPA'
    """
    if not storm_data:
        return "WESTERN PACIFIC SYSTEM"

    atcf_id = str(storm_data.get("atcf_id", "")).strip().upper()
    raw_name = str(storm_data.get("storm_name", "")).strip().upper()
    lat = float(storm_data.get("lat", 0.0))
    lon = float(storm_data.get("lon", 0.0))
    wind_kt = float(storm_data.get("wind_kt", 0.0))
    pressure = float(storm_data.get("pressure_hpa", 1008.0))

    inside_par = is_point_inside_par(lat, lon)

    # Clean short ATCF ID (e.g. 17W, 22W, 97W)
    m = re.search(r'(\d{2}[A-Z]?)', atcf_id)
    short_id = m.group(1) if m else atcf_id
    if short_id and not short_id.endswith('W') and not short_id.endswith('E') and not short_id.endswith('C'):
        short_id += 'W'

    nums = ''.join(filter(str.isdigit, short_id))
    num_val = int(nums) if nums else 0
    is_invest = (90 <= num_val <= 99) or "INVEST" in raw_name

    # Generic or numerical placeholder names
    ignored_names = [
        "INVEST", "NONAME", "UNKNOWN", "STORM", "NULL", "NONE", "LPA", "LOW PRESSURE AREA", "",
        "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
        "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN",
        "EIGHTEEN", "NINETEEN", "TWENTY", "TWENTY-ONE", "TWENTY-TWO"
    ]
    intl_name = raw_name.title() if (raw_name and raw_name not in ignored_names) else None

    # Check for assigned PAGASA name when inside PAR
    pagasa_name = storm_data.get("pagasa_name")
    if not pagasa_name and inside_par and not is_invest:
        if 1 <= num_val <= len(PAGASA_NAMES_2026):
            pagasa_name = PAGASA_NAMES_2026[num_val - 1]

    classification = get_storm_classification_label(wind_kt, is_invest=is_invest)

    # Build primary system title
    if is_invest:
        system_title = f"{short_id} INVEST"
    elif pagasa_name:
        p_name = pagasa_name.upper()
        if intl_name:
            system_title = f"{classification} {p_name} ({intl_name.upper()})"
        else:
            system_title = f"{classification} {p_name} ({short_id})"
    elif intl_name:
        system_title = f"{classification} {intl_name.upper()} ({short_id})"
    else:
        system_title = f"{classification} {short_id}"

    # Append wind speed and central pressure metrics
    details = []
    if wind_kt > 0:
        kmh = int(wind_kt * 1.852)
        details.append(f"{int(wind_kt)} KT ({kmh} KM/H)")
    if 800 < pressure < 1040:
        details.append(f"{int(pressure)} HPA")

    if details:
        return f"{system_title} • " + " • ".join(details)
    return system_title

# ── Dynamically Find Latest Available Satellite Timestamp ────────────────────
def get_latest_available_satellite_time():
    """
    Dynamically checks Zoom Earth tile servers to find the freshest available
    Himawari satellite scan timestamp (typically 15-25 minutes behind real time).
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    for offset_mins in [15, 20, 25, 30, 40, 50, 60]:
        t = now - datetime.timedelta(minutes=offset_mins)
        mins = (t.minute // 10) * 10
        t_aligned = t.replace(minute=mins, second=0, microsecond=0)
        d_str = t_aligned.strftime('%Y-%m-%d')
        tm_str = f'{t_aligned.hour:02d}{t_aligned.minute:02d}'
        url = f'https://tiles.zoom.earth/geocolor/himawari/{d_str}/{tm_str}/6/28/53.jpg'
        try:
            r = _HTTP_SESSION.get(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': 'https://zoom.earth/',
                'Origin': 'https://zoom.earth'
            }, timeout=3)
            if r.status_code == 200 and len(r.content) > 1000:
                return t_aligned
        except Exception:
            pass
    t = now - datetime.timedelta(minutes=40)
    mins = (t.minute // 10) * 10
    return t.replace(minute=mins, second=0, microsecond=0)

# ── Custom Tile Provider for Zoom Earth Satellite Map Tiles ─────────────────
class ZoomEarthTiles(cimgt.GoogleTiles):
    """
    Cartopy tile provider fetching satellite tiles from Zoom Earth Himawari-9 basemap.
    """
    def __init__(self, date_str=None, time_str=None, session=None, **kwargs):
        super().__init__(**kwargs)
        if not date_str or not time_str:
            latest_dt = get_latest_available_satellite_time()
            date_str = latest_dt.strftime('%Y-%m-%d')
            time_str = f'{latest_dt.hour:02d}{latest_dt.minute:02d}'

        self.date_str = date_str
        self.time_str = time_str
        self.session = session or _HTTP_SESSION
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://zoom.earth/',
            'Origin': 'https://zoom.earth'
        }

    def _image_url(self, tile):
        x, y, z = tile
        return f"https://tiles.zoom.earth/geocolor/himawari/{self.date_str}/{self.time_str}/{z}/{y}/{x}.jpg"

    def get_image(self, tile):
        x, y, z = tile
        primary_url = self._image_url(tile)
        try:
            r = self.session.get(primary_url, headers=self.headers, timeout=5)
            if r.status_code == 200 and len(r.content) > 1000:
                img = Image.open(io.BytesIO(r.content)).convert('RGB')
                return img, self.tileextent(tile), 'lower'
        except Exception:
            pass

        seamless_ocean = Image.new('RGB', (256, 256), (11, 15, 20))
        return seamless_ocean, self.tileextent(tile), 'lower'

# ── Fox Weather Broadcast Header Drawing Function ───────────────────────────
def draw_fox_weather_header(img, dt_utc, storm_data=None, custom_title=None):
    """
    Draws a TV broadcast-style top header matching the Fox Weather layout:
    - Top navy container with 2-tier layout and rounded corners
    - Top Tier: 'VISIBLE SATELLITE' (or 'INFRARED SATELLITE') + 'PHILIPPINE WEATHER' badge
    - Bottom Tier: 'WED 9:50AM PHT' + System Name / Details (e.g. 'TROPICAL STORM KROVANH (22W) • 40 KT • 998 HPA')
    """
    pht_tz = datetime.timezone(datetime.timedelta(hours=8))
    dt_pht = dt_utc.astimezone(pht_tz)

    w, h = img.size
    draw = ImageDraw.Draw(img)

    # Detect day vs night based on solar time in PHT
    hour_pht = dt_pht.hour + dt_pht.minute / 60.0
    is_daytime = (5.75 <= hour_pht < 18.25)

    if custom_title:
        title_text = custom_title.upper()
    else:
        title_text = "VISIBLE SATELLITE" if is_daytime else "INFRARED SATELLITE"

    # Dynamic scaling based on image width
    scale = w / 1200.0
    pad_x = int(20 * scale)
    pad_y = int(16 * scale)
    bw = w - (pad_x * 2)
    bh = int(74 * scale)
    bx1, by1 = pad_x, pad_y
    bx2, by2 = pad_x + bw, pad_y + bh
    radius = max(4, int(6 * scale))

    # 1. Main Navy Rounded Container Box
    draw.rounded_rectangle(
        [bx1, by1, bx2, by2],
        radius=radius,
        fill=(7, 24, 56),
        outline=(255, 255, 255),
        width=max(1, int(2 * scale))
    )

    # 2. Horizontal Divider Line between tiers
    mid_y = by1 + int(43 * scale)
    draw.line([(bx1 + 1, mid_y), (bx2 - 1, mid_y)], fill=(70, 105, 155), width=max(1, int(1 * scale)))

    # Fonts
    f_title_sz = max(14, int(24 * scale))
    f_badge_sz = max(9, int(13 * scale))
    f_sub_sz = max(9, int(13 * scale))

    try:
        font_title = ImageFont.truetype("arialbd.ttf", f_title_sz)
        font_badge_main = ImageFont.truetype("arialbd.ttf", f_badge_sz)
        font_badge_sub = ImageFont.truetype("arialbd.ttf", f_badge_sz)
        font_sub = ImageFont.truetype("arialbd.ttf", f_sub_sz)
    except Exception:
        font_title = ImageFont.load_default()
        font_badge_main = font_title
        font_badge_sub = font_title
        font_sub = font_title

    # 3. Top Tier Left: Product Title ('VISIBLE SATELLITE' / 'INFRARED SATELLITE')
    draw.text((bx1 + int(16 * scale), by1 + int(8 * scale)), title_text, fill=(255, 255, 255), font=font_title)

    # 4. Top Tier Right: PHILIPPINE TYPHOON WEATHER Broadcast Logo Badge (Fox Weather style)
    badge_h = int(28 * scale)
    badge_y1 = by1 + int(7 * scale)
    badge_y2 = badge_y1 + badge_h
    badge_w = int(278 * scale)
    badge_x2 = bx2 - int(12 * scale)
    badge_x1 = badge_x2 - badge_w

    # Outer white pill container
    draw.rounded_rectangle(
        [badge_x1, badge_y1, badge_x2, badge_y2],
        radius=max(3, int(5 * scale)),
        fill=(255, 255, 255),
        outline=(255, 255, 255),
        width=1
    )

    # Red inner box for 'WEATHER'
    red_w = int(82 * scale)
    red_x1 = badge_x2 - red_w
    draw.rounded_rectangle(
        [red_x1, badge_y1 + int(2 * scale), badge_x2 - int(2 * scale), badge_y2 - int(2 * scale)],
        radius=max(2, int(4 * scale)),
        fill=(220, 38, 38)
    )

    # Text inside broadcast badge
    draw.text((badge_x1 + int(10 * scale), badge_y1 + int(6 * scale)), "PHILIPPINE TYPHOON", fill=(10, 25, 56), font=font_badge_main)
    draw.text((red_x1 + int(8 * scale), badge_y1 + int(6 * scale)), "WEATHER", fill=(255, 255, 255), font=font_badge_sub)

    # 5. Bottom Tier Left: Timestamp (e.g. WED 9:50AM PHT)
    hr_str = dt_pht.strftime('%I').lstrip('0')
    min_am_pm = dt_pht.strftime('%M%p')
    day_str = dt_pht.strftime('%a').upper()
    time_display = f"{day_str} {hr_str}:{min_am_pm} PHT"

    time_x = bx1 + int(16 * scale)
    time_y = mid_y + int(6 * scale)
    draw.text((time_x, time_y), time_display, fill=(255, 255, 255), font=font_sub)

    # Calculate width of timestamp
    bbox = draw.textbbox((time_x, time_y), time_display, font=font_sub)
    time_w = bbox[2] - bbox[0]

    # Vertical Divider Line 1 (After Timestamp)
    sep1_x = time_x + time_w + int(14 * scale)
    draw.line([(sep1_x, mid_y + 1), (sep1_x, by2 - 1)], fill=(70, 105, 155), width=max(1, int(1 * scale)))

    # 6. Bottom Tier Far Right: Data Source (underneath Philippine Weather badge)
    source_name = storm_data.get("source", "JTWC") if storm_data else "JTWC"
    source_text = f"DATA: {source_name}"
    src_bbox = draw.textbbox((0, 0), source_text, font=font_sub)
    src_w = src_bbox[2] - src_bbox[0]
    src_x = bx2 - int(16 * scale) - src_w
    draw.text((src_x, time_y), source_text, fill=(147, 197, 253), font=font_sub)

    # Vertical Divider Line 2 (Before Data Source)
    sep2_x = src_x - int(14 * scale)
    draw.line([(sep2_x, mid_y + 1), (sep2_x, by2 - 1)], fill=(70, 105, 155), width=max(1, int(1 * scale)))

    # 7. Bottom Tier Middle: System Name & Intensity Metrics (from forecasttrack.py)
    system_text = format_system_display_name(storm_data)
    sys_x = sep1_x + int(14 * scale)
    draw.text((sys_x, time_y), system_text, fill=(255, 255, 255), font=font_sub)

    return img

# ── Helper to Clean Filename Strings ─────────────────────────────────────────
def clean_filename_str(s):
    return re.sub(r'[^a-zA-Z0-9_\-]', '', str(s).replace(' ', '_'))

# ── Fetch Storm Data from Knack ATCF API ─────────────────────────────────────
def fetch_knack_atcf_storms():
    """
    Fetches active tropical cyclones directly from Knack ATCF API.
    Filters specifically for Western Pacific (WPAC / WNP) basin storms.
    """
    knack_url = "https://api.knackwx.com/atcf/v2"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    storms = []

    try:
        r = _HTTP_SESSION.get(knack_url, headers=headers, timeout=10)
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

                    is_wpac = (
                        basin.upper() == "WPAC"
                        or item.get("origin_basin") == "W"
                        or atcf_id.upper().endswith("W")
                        or long_id.startswith("wp")
                    )

                    if not is_wpac:
                        continue

                    if lon < 0:
                        lon += 360

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
                        "analysis_time": item.get("analysis_time", "Latest"),
                    })
            print(f"Successfully fetched {len(storms)} active Western Pacific storm(s) from Knack ATCF API.")
    except Exception as err:
        print(f"Notice: Failed to fetch live Knack ATCF data ({err}). Using fallback.")

    if not storms:
        data_file = os.path.join("public", "data", "tc_positions_latest.json")
        if os.path.exists(data_file):
            try:
                with open(data_file, 'r', encoding='utf-8') as f:
                    loc_data = json.load(f)
                    latest = loc_data.get("latest", {})
                    wind = latest.get("wind_kt", 115.0)
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
                        "analysis_time": latest.get("init_time", "Latest"),
                    })
            except Exception as e:
                print(f"Error reading local fallback file: {e}")

    return storms

# ── Storm Focus Extent Calculator ───────────────────────────────────────────
def calculate_storm_focus_extent(c_lat, c_lon, lon_span=26.0, target_aspect=0.72):
    """
    Calculates dynamic extent focused on given center coordinates (c_lat, c_lon).
    Default lon_span is ~26 degrees with ~18.7 degrees lat span (4:3 aspect ratio).
    """
    min_lon = c_lon - lon_span / 2.0
    max_lon = c_lon + lon_span / 2.0
    lat_span = lon_span * target_aspect
    min_lat = c_lat - lat_span / 2.0
    max_lat = c_lat + lat_span / 2.0

    if min_lat < 0:
        shift = 0 - min_lat
        min_lat += shift
        max_lat += shift

    min_lon = max(80.0, min_lon)
    max_lon = min(180.0, max_lon)
    min_lat = max(0.0, min_lat)
    max_lat = min(60.0, max_lat)

    return [min_lon, max_lon, min_lat, max_lat]

# ── Render a Single Storm-Focused Frame ──────────────────────────────────────
def render_storm_frame(
    dt_utc,
    extent,
    storm_data=None,
    figsize=(10.0, 7.5),
    dpi=120,
    zoom_level=6,
    custom_title=None
):
    """
    Renders a full-bleed satellite frame overlaid with the Fox Weather broadcast header:
    - Full edge-to-edge satellite image (no white borders)
    - Yellow coastlines and country borders
    - Orange Philippine Area of Responsibility (PAR) line
    - Subtle coordinate gridlines
    - Floating Fox Weather broadcast header with System Name from forecasttrack.py
    """
    date_str = dt_utc.strftime('%Y-%m-%d')
    time_str = f"{dt_utc.hour:02d}{(dt_utc.minute // 10) * 10:02d}"

    tiler = ZoomEarthTiles(date_str=date_str, time_str=time_str)

    fig = plt.figure(figsize=figsize, dpi=dpi, facecolor='black')

    # Full bleed map canvas (edge-to-edge)
    ax_map = fig.add_axes([0.0, 0.0, 1.0, 1.0], projection=ccrs.PlateCarree())
    ax_map.set_extent(extent, crs=ccrs.PlateCarree())

    # 1. Overlay Zoom Earth satellite tiles
    try:
        ax_map.add_image(tiler, zoom_level, alpha=0.95)
    except Exception:
        ax_map.set_facecolor('#0b192c')

    # 2. Add Coastlines and Country Borders (High-visibility Yellow)
    ax_map.add_feature(cfeature.COASTLINE, linewidth=1.1, edgecolor='#FFE600', alpha=0.95)
    ax_map.add_feature(cfeature.BORDERS, linewidth=0.8, edgecolor='#FFE600', linestyle='--', alpha=0.90)

    # 3. Add Detailed Philippine Province Boundaries (from ph_provinces.json)
    prov_geoms = load_philippine_province_geometries()
    if prov_geoms:
        ax_map.add_geometries(
            prov_geoms,
            crs=ccrs.PlateCarree(),
            facecolor='none',
            edgecolor='#FFE600',
            linewidth=0.7,
            linestyle='--',
            alpha=0.85
        )

    # 4. Philippine Area of Responsibility (PAR) Boundary
    par_lons = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
    par_lats = [ 5.0,  15.0,  21.0,  25.0,  25.0,   5.0,   5.0]
    ax_map.plot(
        par_lons, par_lats, color='#FF6B35', linewidth=2.0, linestyle='-',
        alpha=0.95, transform=ccrs.PlateCarree(), label='PAR Boundary'
    )

    # 5. Lat/Lon Coordinate Gridlines (Subtle over satellite)
    gl = ax_map.gridlines(draw_labels=False, linewidth=0.5, color='white', alpha=0.25, linestyle='--')
    gl.xlocator = mticker.MultipleLocator(5.0)
    gl.ylocator = mticker.MultipleLocator(5.0)

    # Convert plot directly to PIL Image
    fig.canvas.draw()
    rgba_buffer = fig.canvas.buffer_rgba()
    img = Image.frombuffer('RGBA', fig.canvas.get_width_height(), rgba_buffer, 'raw', 'RGBA', 0, 1).convert('RGB')
    plt.close(fig)

    # 5. Composite Fox Weather broadcast header onto the satellite image with storm name
    img = draw_fox_weather_header(img, dt_utc=dt_utc, storm_data=storm_data, custom_title=custom_title)

    return img

# ── Generate Animated Storm GIF for a Specific Extent ───────────────────────
def generate_single_storm_gif(
    output_path,
    extent,
    storm_data=None,
    storm_label="Storm",
    timeframe_hours=6.0,
    interval_mins=20,
    fps=8,
    dpi=120,
    zoom_level=6,
    last_frame_pause_sec=1.5
):
    """
    Renders an animated GIF loop for a given storm extent with the Fox Weather broadcast header.
    """
    print(f"\n--- Generating GIF for: {storm_label} ---")
    print(f"Timeframe: Past {timeframe_hours:.1f} hours | Interval: {interval_mins} mins | FPS: {fps}")

    now_utc = get_latest_available_satellite_time()
    end_utc = now_utc
    start_utc = end_utc - datetime.timedelta(hours=timeframe_hours)

    current_t = start_utc
    timestamps = []
    while current_t <= end_utc:
        t_mins = (current_t.minute // 10) * 10
        t_aligned = current_t.replace(minute=t_mins, second=0, microsecond=0)
        timestamps.append(t_aligned)
        current_t += datetime.timedelta(minutes=interval_mins)

    total_frames = len(timestamps)
    print(f"Rendering {total_frames} frames from {timestamps[0].strftime('%Y-%m-%d %H:%M UTC')} to {timestamps[-1].strftime('%Y-%m-%d %H:%M UTC')}...")

    frames = []
    for idx, t_utc in enumerate(timestamps):
        print(f"[{idx + 1}/{total_frames}] Rendering frame: {t_utc.strftime('%Y-%m-%d %H:%MZ')}...", end="\r", flush=True)

        frame_img = render_storm_frame(
            dt_utc=t_utc,
            extent=extent,
            storm_data=storm_data,
            figsize=(10.0, 7.5),
            dpi=dpi,
            zoom_level=zoom_level
        )
        frames.append(frame_img)

    print(f"\nCompleted {len(frames)} frames for {storm_label}. Compiling GIF...")

    if not frames:
        return None

    frame_duration = int(1000 / fps)
    durations = [frame_duration] * len(frames)
    durations[-1] = int(last_frame_pause_sec * 1000)

    quantized_frames = []
    for f in frames:
        q = f.convert('P', palette=Image.Palette.ADAPTIVE, colors=256)
        quantized_frames.append(q)

    quantized_frames[0].save(
        output_path,
        save_all=True,
        append_images=quantized_frames[1:],
        duration=durations,
        loop=0,
        optimize=True
    )

    file_size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"SUCCESS: GIF saved to: {os.path.abspath(output_path)} ({file_size_mb:.2f} MB)")
    return output_path

# ── Generate Static Image for a Specific Extent ──────────────────────────────
def generate_single_storm_image(
    output_path,
    extent,
    storm_data=None,
    storm_label="Storm",
    dpi=150,
    zoom_level=6
):
    """
    Renders a single high-resolution image for a given storm extent with the Fox Weather broadcast header.
    """
    dt_utc = get_latest_available_satellite_time()

    img = render_storm_frame(
        dt_utc=dt_utc,
        extent=extent,
        storm_data=storm_data,
        figsize=(10.0, 7.5),
        dpi=dpi,
        zoom_level=zoom_level
    )

    img.save(output_path, dpi=(dpi, dpi))
    print(f"SUCCESS: [{storm_label}] image saved to: {os.path.abspath(output_path)} ({img.size[0]}x{img.size[1]})")
    return output_path

# ── Main Multi-Storm Processing Controller ───────────────────────────────────
def process_storms(
    target_storm=None,
    center_lat=None,
    center_lon=None,
    lon_span=26.0,
    timeframe_hours=6.0,
    interval_mins=20,
    fps=8,
    dpi=120,
    generate_gif=True,
    generate_both=True,
    output_custom=None
):
    print("=" * 70)
    mode_str = "GIF Loop + Static PNG" if generate_both else ("GIF Loop" if generate_gif else "Static PNG")
    print(f"Storm-Focused Satellite Generator ({mode_str}) [Fox Weather Broadcast Theme]")
    print("=" * 70)

    # 1. Check if user specified custom coordinates
    if center_lat is not None and center_lon is not None:
        c_lat = float(center_lat)
        c_lon = float(center_lon)
        extent = calculate_storm_focus_extent(c_lat, c_lon, lon_span=lon_span)
        label = f"Custom_Center_{c_lat:.1f}N_{c_lon:.1f}E"
        custom_storm = {"atcf_id": "CUSTOM", "storm_name": "CUSTOM TARGET", "lat": c_lat, "lon": c_lon, "wind_kt": 0}
        
        if generate_both or not generate_gif:
            out_png = output_custom.replace(".gif", ".png") if output_custom else f"storm_focused_{label}.png"
            generate_single_storm_image(out_png, extent, storm_data=custom_storm, storm_label=label, dpi=dpi)
        if generate_both or generate_gif:
            out_gif = output_custom.replace(".png", ".gif") if output_custom else f"storm_focused_{label}.gif"
            generate_single_storm_gif(
                out_gif, extent, storm_data=custom_storm, storm_label=label,
                timeframe_hours=timeframe_hours, interval_mins=interval_mins, fps=fps, dpi=dpi
            )
        return

    # 2. Fetch active storms from Knack ATCF API
    storms = fetch_knack_atcf_storms()
    if not storms:
        print("Notice: No active storms detected. Using default Philippine Sea focus.")
        storms = [{
            "atcf_id": "WPAC",
            "storm_name": "WESTERN PACIFIC",
            "lat": 14.0,
            "lon": 135.0,
            "wind_kt": 30.0,
            "pressure_hpa": 1004.0
        }]

    # 3. Filter target storm if user passed --storm
    if target_storm:
        target_str = str(target_storm).strip().upper()
        matched = [
            st for st in storms
            if target_str in st["atcf_id"].upper() or target_str in st["storm_name"].upper()
        ]
        if matched:
            storms_to_process = matched
            print(f"Targeting specified storm: {matched[0]['storm_name']} ({matched[0]['atcf_id']})")
        else:
            print(f"Warning: Storm '{target_storm}' not found in active list. Processing all active storms.")
            storms_to_process = storms
    else:
        # Default: Process ALL active storms!
        storms_to_process = storms
        print(f"\nProcessing all {len(storms_to_process)} active storms:")
        for i, st in enumerate(storms_to_process):
            print(f"  {i+1}. {st['storm_name']} ({st['atcf_id']}) - Lat: {st['lat']:.1f}N, Lon: {st['lon']:.1f}E, Wind: {st['wind_kt']} kt")

    # 4. Generate outputs for each storm
    generated_pngs = []
    generated_gifs = []

    for idx, st in enumerate(storms_to_process):
        storm_name = st.get("storm_name", "UNNAMED")
        atcf_id = st.get("atcf_id", f"STORM_{idx+1}")
        c_lat = float(st.get("lat", 15.0))
        c_lon = float(st.get("lon", 135.0))
        
        clean_id = clean_filename_str(atcf_id)
        clean_name = clean_filename_str(storm_name)
        label = f"{storm_name} ({atcf_id})"

        extent = calculate_storm_focus_extent(c_lat, c_lon, lon_span=lon_span)
        print(f"\n[{idx+1}/{len(storms_to_process)}] Processing: {label} centered at ({c_lat:.2f}N, {c_lon:.2f}E)...")

        # Static PNG
        if generate_both or not generate_gif:
            if output_custom and len(storms_to_process) == 1:
                png_file = output_custom.replace(".gif", ".png")
            else:
                png_file = f"storm_focused_{clean_id}.png"

            generate_single_storm_image(png_file, extent, storm_data=st, storm_label=label, dpi=dpi)
            generated_pngs.append(png_file)

            if idx == 0 and png_file != "storm_focused_satellite.png":
                try:
                    import shutil
                    shutil.copyfile(png_file, "storm_focused_satellite.png")
                except Exception:
                    pass

        # Animated GIF
        if generate_both or generate_gif:
            if output_custom and len(storms_to_process) == 1:
                gif_file = output_custom.replace(".png", ".gif")
            else:
                gif_file = f"storm_focused_{clean_id}.gif"

            generate_single_storm_gif(
                gif_file,
                extent,
                storm_data=st,
                storm_label=label,
                timeframe_hours=timeframe_hours,
                interval_mins=interval_mins,
                fps=fps,
                dpi=dpi
            )
            generated_gifs.append(gif_file)

            if idx == 0 and gif_file != "storm_focused_satellite_loop.gif":
                try:
                    import shutil
                    shutil.copyfile(gif_file, "storm_focused_satellite_loop.gif")
                except Exception:
                    pass

    print("\n" + "=" * 70)
    print("BATCH GENERATION COMPLETED SUCCESSFULLY!")
    if generated_pngs:
        print(f"Generated {len(generated_pngs)} PNG Map(s):")
        for p in generated_pngs:
            print(f"  -> {p}")
    if generated_gifs:
        print(f"Generated {len(generated_gifs)} Animated GIF(s):")
        for g in generated_gifs:
            print(f"  -> {g}")
    print("=" * 70)

# ── CLI Entry Point ──────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Generate Storm-Focused Satellite Maps & Animated GIF Loops (Fox Weather Theme)")
    parser.add_argument("--png-only", action="store_true", help="Generate only static PNG images without GIF loops")
    parser.add_argument("--gif-only", action="store_true", help="Generate only animated GIF loops without PNG images")
    parser.add_argument("--gif", action="store_true", help="Generate animated satellite GIF loops")
    parser.add_argument("--both", action="store_true", help="Generate both static PNG images and animated GIF loops")
    parser.add_argument("--storm", type=str, default=None, help="Target specific storm by ATCF ID or Name (e.g. 17W, 18W, SAUDEL, 97W)")
    parser.add_argument("--lat", type=float, default=None, help="Custom center latitude")
    parser.add_argument("--lon", type=float, default=None, help="Custom center longitude")
    parser.add_argument("--span", type=float, default=26.0, help="Longitude span in degrees (default: 26.0)")
    parser.add_argument("--hours", type=float, default=6.0, help="Timeframe in hours for GIF (default: 6.0)")
    parser.add_argument("--interval", type=int, default=20, help="Frame step interval in minutes (default: 20)")
    parser.add_argument("--fps", type=int, default=8, help="Frames per second for GIF (default: 8)")
    parser.add_argument("--dpi", type=int, default=120, help="DPI resolution for GIF frames (default: 120)")
    parser.add_argument("--output", type=str, default=None, help="Custom output filepath (when single storm)")
    args = parser.parse_args()

    if args.png_only:
        gen_gif = False
        gen_both = False
    elif args.gif_only or args.gif:
        gen_gif = True
        gen_both = False
    else:
        gen_gif = True
        gen_both = True

    process_storms(
        target_storm=args.storm,
        center_lat=args.lat,
        center_lon=args.lon,
        lon_span=args.span,
        timeframe_hours=args.hours,
        interval_mins=args.interval,
        fps=args.fps,
        dpi=args.dpi,
        generate_gif=gen_gif,
        generate_both=gen_both,
        output_custom=args.output
    )

if __name__ == "__main__":
    main()
