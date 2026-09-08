#!/usr/bin/env python3
"""
========================================================================================
Himawari-9 Channel 13 IR Brightness Temperature (°C) Map & GIF Generator
========================================================================================
- Data Source: Japan Meteorological Agency (JMA) Himawari-9 Full Disk Real-Time Tiles (B13/TBB)
- Wavelength: Channel 13 Clean Longwave Infrared Window (10.4 μm)
- Color Enhancement: Standard Tropical Cyclone / PolarWx Brightness Temperature scale (+40°C to -100°C)
  Cold overshooting cloud tops in magenta/pink/violet, eyewall convection in red/orange,
  mid clouds in yellow/cyan/blue, warm sea surface/low clouds in grayscale.
- Features:
    * Philippines & Entire PAR Archipelago Overview
    * Storm-Centered Automated Tracking (from JTWC / Knack ATCF operational feed)
    * Detailed Philippine Province Boundaries (82 provinces from ph_provinces.json)
    * Vertical Brightness Temperature (°C) Legend Colorbar
    * Static PNG Maps and Smooth Animated GIF Loops
========================================================================================
"""

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
from matplotlib.colors import LinearSegmentedColormap
import matplotlib.ticker as mticker
import matplotlib.patheffects as pe
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import cartopy.io.img_tiles as cimgt
from PIL import Image, ImageDraw, ImageFont

import shapely
from shapely.geometry import shape
from shapely.validation import make_valid

# ── Shared Requests Session with Connection Pooling ─────────────────────────
_HTTP_SESSION = requests.Session()
_ADAPTER = requests.adapters.HTTPAdapter(pool_connections=40, pool_maxsize=40, max_retries=3)
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

def format_system_title(storm_data):
    if not storm_data:
        return "PHILIPPINES & PAR REGION"

    atcf_id = str(storm_data.get("atcf_id", "")).strip().upper()
    raw_name = str(storm_data.get("storm_name", "")).strip().upper()
    lat = float(storm_data.get("lat", 0.0))
    lon = float(storm_data.get("lon", 0.0))
    wind_kt = float(storm_data.get("wind_kt", 0.0))
    pressure = float(storm_data.get("pressure_hpa", 1008.0))

    inside_par = is_point_inside_par(lat, lon)

    m = re.search(r'(\d{2}[A-Z]?)', atcf_id)
    short_id = m.group(1) if m else atcf_id
    if short_id and not short_id.endswith('W') and not short_id.endswith('E') and not short_id.endswith('C'):
        short_id += 'W'

    nums = ''.join(filter(str.isdigit, short_id))
    num_val = int(nums) if nums else 0
    is_invest = (90 <= num_val <= 99) or "INVEST" in raw_name

    ignored_names = [
        "INVEST", "NONAME", "UNKNOWN", "STORM", "NULL", "NONE", "LPA", "LOW PRESSURE AREA", "",
        "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
        "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN",
        "EIGHTEEN", "NINETEEN", "TWENTY", "TWENTY-ONE", "TWENTY-TWO"
    ]
    intl_name = raw_name.title() if (raw_name and raw_name not in ignored_names) else None

    pagasa_name = storm_data.get("pagasa_name")
    if not pagasa_name and inside_par and not is_invest:
        if 1 <= num_val <= len(PAGASA_NAMES_2026):
            pagasa_name = PAGASA_NAMES_2026[num_val - 1]

    classification = get_storm_classification_label(wind_kt, is_invest=is_invest)

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

    details = []
    if wind_kt > 0:
        kmh = int(wind_kt * 1.852)
        details.append(f"{int(wind_kt)} KT ({kmh} KM/H)")
    if 800 < pressure < 1040:
        details.append(f"{int(pressure)} HPA")

    if details:
        return f"{system_title} • " + " • ".join(details)
    return system_title

# ── Philippine Province Geometries Cache ─────────────────────────────────────
_PROVINCE_GEOMS_CACHE = None

def load_philippine_province_geometries():
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

# ── Tropical Cyclone IR Brightness Temperature Colormap ──────────────────────
# Temperature scale: +40°C down to -100°C (Total range: 140°C)
_B13_COLOR_STOPS = [
    (0.00, '#000000'), # +40C : Black
    (0.14, '#333333'), # +20C : Dark Gray
    (0.28, '#cccccc'), # 0C   : Light Gray
    (0.35, '#80d4ff'), # -10C : Cyan
    (0.42, '#2b6cb0'), # -20C : Blue
    (0.50, '#1a365d'), # -30C : Deep Navy
    (0.57, '#f6e05e'), # -40C : Yellow
    (0.64, '#dd6b20'), # -50C : Orange
    (0.71, '#e53e3e'), # -60C : Bright Red
    (0.78, '#9b2c2c'), # -70C : Dark Red / Crimson
    (0.85, '#d53f8c'), # -80C : Deep Pink
    (0.92, '#f687b3'), # -90C : Hot Pink
    (1.00, '#ffffff'), # -100C: White / Violet
]

_CMAP_POS = [c[0] for c in _B13_COLOR_STOPS]
_CMAP_HEX = [c[1] for c in _B13_COLOR_STOPS]
CMAP_B13 = LinearSegmentedColormap.from_list('tc_polarwx_b13', list(zip(_CMAP_POS, _CMAP_HEX)), N=256)

# Inverted color stops for the vertical legend colorbar (so +40°C is top and -100°C is bottom)
_CBAR_STOPS = [(1.0 - c[0], c[1]) for c in _B13_COLOR_STOPS]
_CBAR_STOPS.sort(key=lambda x: x[0])
CMAP_CBAR = LinearSegmentedColormap.from_list('tc_cbar', _CBAR_STOPS, N=256)

# ── Fetch JMA Himawari Target Times ──────────────────────────────────────────
def get_jma_target_times():
    url = "https://www.jma.go.jp/bosai/himawari/data/satimg/targetTimes_fd.json"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    try:
        r = _HTTP_SESSION.get(url, headers=headers, timeout=6)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print(f"Notice: Failed to fetch JMA target times: {e}")
    return []

def get_latest_jma_time():
    targets = get_jma_target_times()
    if targets:
        vt = targets[-1]["validtime"]
        dt = datetime.datetime.strptime(vt, "%Y%m%d%H%M%S").replace(tzinfo=datetime.timezone.utc)
        return vt, dt

    now = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=25)
    mins = (now.minute // 10) * 10
    now = now.replace(minute=mins, second=0, microsecond=0)
    return now.strftime("%Y%m%d%H%M00"), now

# ── Custom Cartopy Tile Provider for Himawari Channel 13 ─────────────────────
class HimawariB13Tiles(cimgt.GoogleTiles):
    def __init__(self, basetime, validtime, session=None, **kwargs):
        super().__init__(**kwargs)
        self.basetime = basetime
        self.validtime = validtime
        self.session = session or _HTTP_SESSION
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": "https://www.jma.go.jp/"
        }

    def _image_url(self, tile):
        x, y, z = tile
        return f"https://www.jma.go.jp/bosai/himawari/data/satimg/{self.basetime}/fd/{self.validtime}/B13/TBB/{z}/{x}/{y}.jpg"

    def get_image(self, tile):
        url = self._image_url(tile)
        try:
            r = self.session.get(url, headers=self.headers, timeout=4)
            if r.status_code == 200 and len(r.content) > 500:
                raw_gray = np.array(Image.open(io.BytesIO(r.content)).convert('L'))
                # JMA 8-bit TBB: 0 (+40°C warm) to 255 (-100°C extreme cold)
                colored = (CMAP_B13(raw_gray / 255.0)[:, :, :3] * 255).astype(np.uint8)
                img = Image.fromarray(colored)
                return img, self.tileextent(tile), 'lower'
        except Exception:
            pass

        blank = Image.new('RGB', (256, 256), (10, 15, 20))
        return blank, self.tileextent(tile), 'lower'

# ── Query Active Storms from Knack ATCF ───────────────────────────────────────
def fetch_active_storms():
    knack_url = "https://api.knackwx.com/atcf/v2"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    storms = []
    try:
        r = _HTTP_SESSION.get(knack_url, headers=headers, timeout=5)
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list):
                for item in data:
                    atcf_id = str(item.get("atcf_id", "")).upper()
                    basin = str(item.get("basin", "")).upper()
                    if atcf_id.endswith("W") or basin == "WPAC":
                        storms.append({
                            "atcf_id": atcf_id,
                            "storm_name": item.get("storm_name", "UNKNOWN"),
                            "lat": float(item.get("latitude", 0.0)),
                            "lon": float(item.get("longitude", 0.0)),
                            "wind_kt": float(item.get("winds") or 0.0),
                            "pressure_hpa": float(item.get("pressure") or 1008.0),
                            "source": "JTWC"
                        })
    except Exception as e:
        print(f"Notice: Failed to fetch ATCF storms: {e}")
    return storms

# ── Extent Calculators ───────────────────────────────────────────────────────
def fit_extent_to_aspect(extent, aspect_ratio=10.0/7.5):
    """
    Ensures [min_lon, max_lon, min_lat, max_lat] strictly matches the canvas
    aspect ratio (lon_span / lat_span == aspect_ratio) so Cartopy renders 100%
    edge-to-edge full-bleed with zero black borders/bars on any side.
    """
    min_lon, max_lon, min_lat, max_lat = extent
    c_lon = (min_lon + max_lon) / 2.0
    c_lat = (min_lat + max_lat) / 2.0
    lon_span = max_lon - min_lon
    lat_span = max_lat - min_lat

    current_aspect = lon_span / lat_span
    if current_aspect < aspect_ratio:
        target_lon_span = lat_span * aspect_ratio
        min_lon = c_lon - target_lon_span / 2.0
        max_lon = c_lon + target_lon_span / 2.0
    elif current_aspect > aspect_ratio:
        target_lat_span = lon_span / aspect_ratio
        min_lat = c_lat - target_lat_span / 2.0
        max_lat = c_lat + target_lat_span / 2.0

    return [min_lon, max_lon, min_lat, max_lat]

def get_philippines_extent():
    # 24.0 lon span / 18.0 lat span = 1.3333 (matches 10.0 / 7.5 aspect ratio)
    return [113.0, 137.0, 4.0, 22.0]

def calculate_storm_extent(c_lat, c_lon, lon_span=24.0, target_aspect=0.75):
    min_lon = c_lon - lon_span / 2.0
    max_lon = c_lon + lon_span / 2.0
    lat_span = lon_span * target_aspect
    min_lat = c_lat - lat_span / 2.0
    max_lat = c_lat + lat_span / 2.0

    if min_lat < 0:
        shift = 0 - min_lat
        min_lat += shift
        max_lat += shift

    return fit_extent_to_aspect([max(80.0, min_lon), min(180.0, max_lon), max(0.0, min_lat), min(60.0, max_lat)], 1.0 / target_aspect)

# ── Fox Weather Broadcast Header Drawing Function ───────────────────────────
def draw_fox_weather_header(img, dt_utc, storm_data=None, is_philippines=False, custom_title=None):
    """
    Draws a TV broadcast-style top header matching the Fox Weather layout:
    - Top navy container with 2-tier layout and rounded corners
    - Top Tier: 'IR BRIGHTNESS TEMPERATURE' + 'PHILIPPINE TYPHOON WEATHER' badge
    - Bottom Tier: 'WED 9:50AM PHT' + System Name / Details + 'DATA: JTWC' (or 'DATA: JMA HIMAWARI-9')
    """
    pht_tz = datetime.timezone(datetime.timedelta(hours=8))
    dt_pht = dt_utc.astimezone(pht_tz)

    w, h = img.size
    draw = ImageDraw.Draw(img)

    title_text = custom_title.upper() if custom_title else "IR BRIGHTNESS TEMPERATURE"

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

    # 3. Top Tier Left: Product Title ('IR BRIGHTNESS TEMPERATURE')
    draw.text((bx1 + int(16 * scale), by1 + int(8 * scale)), title_text, fill=(255, 255, 255), font=font_title)

    # 4. Top Tier Right: PHILIPPINE TYPHOON WEATHER Broadcast Logo Badge
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

    # 5. Bottom Tier Left: Timestamp in PHT (e.g. WED 9:50AM PHT)
    hr_str = dt_pht.strftime('%I').lstrip('0')
    min_am_pm = dt_pht.strftime('%M%p')
    day_str = dt_pht.strftime('%a').upper()
    time_display = f"{day_str} {hr_str}:{min_am_pm} PHT"

    time_x = bx1 + int(16 * scale)
    time_y = mid_y + int(6 * scale)
    draw.text((time_x, time_y), time_display, fill=(255, 255, 255), font=font_sub)

    bbox = draw.textbbox((time_x, time_y), time_display, font=font_sub)
    time_w = bbox[2] - bbox[0]

    # Separator 1
    sep1_x = time_x + time_w + int(14 * scale)
    draw.line([(sep1_x, mid_y + 1), (sep1_x, by2 - 1)], fill=(70, 105, 155), width=max(1, int(1 * scale)))

    # 6. Bottom Tier Far Right: Data Source Tag
    if is_philippines:
        source_text = "DATA: JMA HIMAWARI-9"
    else:
        src_name = storm_data.get("source", "JTWC") if storm_data else "JTWC"
        source_text = f"DATA: {src_name}"

    src_bbox = draw.textbbox((0, 0), source_text, font=font_sub)
    src_w = src_bbox[2] - src_bbox[0]
    src_x = bx2 - int(16 * scale) - src_w
    draw.text((src_x, time_y), source_text, fill=(147, 197, 253), font=font_sub)

    # Separator 2
    sep2_x = src_x - int(14 * scale)
    draw.line([(sep2_x, mid_y + 1), (sep2_x, by2 - 1)], fill=(70, 105, 155), width=max(1, int(1 * scale)))

    # 7. Bottom Tier Middle: System Name or Regional Domain
    if is_philippines:
        system_text = "PHILIPPINES & PAR REGION"
    else:
        system_text = format_system_title(storm_data)

    sys_x = sep1_x + int(14 * scale)
    draw.text((sys_x, time_y), system_text, fill=(255, 255, 255), font=font_sub)

    return img

# ── Frame Rendering Pipeline ─────────────────────────────────────────────────
def render_b13_frame(
    validtime_str,
    extent,
    storm_data=None,
    is_philippines=False,
    figsize=(10.0, 7.5),
    dpi=120,
    zoom_level=5
):
    """
    Renders a full-bleed Channel 13 IR Brightness Temperature map:
    - Full-bleed edge-to-edge satellite image
    - High-visibility Yellow coastlines and country borders (#FFE600)
    - Detailed Yellow Philippine Province Boundaries
    - Orange Philippine Area of Responsibility (PAR) line (#FF6B35)
    - Floating vertical Brightness Temperature colorbar on right
    - Floating Fox Weather broadcast header on top
    """
    tiler = HimawariB13Tiles(basetime=validtime_str, validtime=validtime_str)

    fig = plt.figure(figsize=figsize, dpi=dpi, facecolor='black')

    # Strict aspect-ratio matching to ensure 100% edge-to-edge coverage without black sidebars
    extent = fit_extent_to_aspect(extent, aspect_ratio=figsize[0] / figsize[1])

    # Full-bleed edge-to-edge map canvas
    ax_map = fig.add_axes([0.0, 0.0, 1.0, 1.0], projection=ccrs.PlateCarree())
    ax_map.set_extent(extent, crs=ccrs.PlateCarree())

    # 1. Overlay Satellite Imagery
    try:
        ax_map.add_image(tiler, zoom_level, alpha=0.98)
    except Exception:
        ax_map.set_facecolor('#0b1420')

    # 2. Add Coastlines & Borders in High-visibility YELLOW (#FFE600)
    ax_map.add_feature(cfeature.COASTLINE, linewidth=1.1, edgecolor='#FFE600', alpha=0.95, zorder=10)
    ax_map.add_feature(cfeature.BORDERS, linewidth=0.8, edgecolor='#FFE600', linestyle='--', alpha=0.90, zorder=10)

    # 3. Add Detailed Philippine Province Boundaries in YELLOW (#FFE600)
    prov_geoms = load_philippine_province_geometries()
    if prov_geoms:
        ax_map.add_geometries(
            prov_geoms,
            crs=ccrs.PlateCarree(),
            facecolor='none',
            edgecolor='#FFE600',
            linewidth=0.7,
            linestyle='--',
            alpha=0.85,
            zorder=11
        )

    # 4. Add Philippine Area of Responsibility (PAR) Boundary (Orange)
    par_lons = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
    par_lats = [ 5.0,  15.0,  21.0,  25.0,  25.0,   5.0,   5.0]
    ax_map.plot(
        par_lons, par_lats, color='#FF6B35', linewidth=2.2, linestyle='-',
        alpha=0.95, transform=ccrs.PlateCarree(), zorder=12, label='PAR'
    )

    # 5. Optional Storm Center Marker
    if storm_data and not is_philippines:
        c_lat = float(storm_data.get("lat", 0.0))
        c_lon = float(storm_data.get("lon", 0.0))
        if c_lat != 0.0 and c_lon != 0.0:
            ax_map.plot(c_lon, c_lat, marker='+', markersize=14, markeredgewidth=2.2, color='#FFE600', transform=ccrs.PlateCarree(), zorder=15)
            ax_map.plot(c_lon, c_lat, marker='o', markersize=8, markerfacecolor='none', markeredgecolor='#FFE600', markeredgewidth=1.8, transform=ccrs.PlateCarree(), zorder=15)

    # 6. Lat/Lon Coordinate Gridlines (Subtle over satellite)
    gl = ax_map.gridlines(draw_labels=False, linewidth=0.5, color='white', alpha=0.20, linestyle='--', zorder=13)
    gl.xlocator = mticker.MultipleLocator(5.0)
    gl.ylocator = mticker.MultipleLocator(5.0)

    # 7. Floating Sleek Vertical Colorbar on Right (Edge-to-edge over satellite with outline & drop shadow)
    cax = fig.add_axes([0.938, 0.14, 0.012, 0.64])
    norm = matplotlib.colors.Normalize(vmin=-100, vmax=40)
    cb = matplotlib.colorbar.ColorbarBase(cax, cmap=CMAP_CBAR, norm=norm, orientation='vertical')
    cb.outline.set_edgecolor('white')
    cb.outline.set_linewidth(1.0)
    cb.ax.set_title('°C', color='white', fontsize=10, fontweight='bold', pad=6,
                    path_effects=[pe.withStroke(linewidth=2.5, foreground='black')])
    cb.ax.yaxis.set_tick_params(color='white', width=1.0, length=3)
    cb.set_ticks([40, 20, 0, -20, -40, -60, -80, -100])
    for tick in cb.ax.yaxis.get_ticklabels():
        tick.set_color('white')
        tick.set_fontweight('bold')
        tick.set_fontsize(8.5)
        tick.set_path_effects([pe.withStroke(linewidth=2.5, foreground='black')])

    # Convert plot directly to PIL Image
    fig.canvas.draw()
    rgba_buffer = fig.canvas.buffer_rgba()
    img = Image.frombuffer('RGBA', fig.canvas.get_width_height(), rgba_buffer, 'raw', 'RGBA', 0, 1).convert('RGB')
    plt.close(fig)

    # 8. Composite Fox Weather broadcast header onto the image
    try:
        dt_utc = datetime.datetime.strptime(validtime_str, "%Y%m%d%H%M%S").replace(tzinfo=datetime.timezone.utc)
    except Exception:
        dt_utc = datetime.datetime.now(datetime.timezone.utc)

    img = draw_fox_weather_header(
        img,
        dt_utc=dt_utc,
        storm_data=storm_data,
        is_philippines=is_philippines,
        custom_title="IR BRIGHTNESS TEMPERATURE"
    )

    return img

# ── Generator Functions ──────────────────────────────────────────────────────
def generate_philippines_b13(output_png="philippines_b13.png", output_gif="philippines_b13_loop.gif", hours=6.0, interval=20, fps=8, make_png=True, make_gif=True):
    print("=" * 75)
    print("Generating Philippines Channel 13 IR Brightness Temp Map(s)...")
    print("=" * 75)

    targets = get_jma_target_times()
    if not targets:
        print("Error: Could not retrieve JMA observation times.")
        return

    latest_target = targets[-1]["validtime"]
    extent = get_philippines_extent()

    if make_png:
        print(f"Rendering Static Map: {latest_target}...")
        img = render_b13_frame(latest_target, extent=extent, is_philippines=True, zoom_level=5)
        img.save(output_png, dpi=(120, 120))
        print(f"SUCCESS: Philippines B13 map saved to: {os.path.abspath(output_png)}")

    if make_gif:
        print(f"Compiling {hours:.1f}-hour Animated GIF Loop (interval: {interval}m, fps: {fps})...")
        latest_dt = datetime.datetime.strptime(latest_target, "%Y%m%d%H%M%S").replace(tzinfo=datetime.timezone.utc)
        start_dt = latest_dt - datetime.timedelta(hours=hours)

        sampled_targets = []
        last_t = None
        for item in targets:
            vt = item["validtime"]
            t_dt = datetime.datetime.strptime(vt, "%Y%m%d%H%M%S").replace(tzinfo=datetime.timezone.utc)
            if t_dt >= start_dt:
                if last_t is None or (t_dt - last_t).total_seconds() >= (interval * 60 - 60):
                    sampled_targets.append(vt)
                    last_t = t_dt

        if not sampled_targets:
            sampled_targets = [latest_target]

        frames = []
        for idx, vt in enumerate(sampled_targets):
            print(f"[{idx+1}/{len(sampled_targets)}] Rendering frame {vt}...", end="\r", flush=True)
            f_img = render_b13_frame(vt, extent=extent, is_philippines=True, zoom_level=5)
            frames.append(f_img)

        print(f"\nQuantizing and saving GIF to {output_gif}...")
        frame_dur = int(1000 / fps)
        durations = [frame_dur] * len(frames)
        durations[-1] = 1500

        q_frames = [f.convert('P', palette=Image.Palette.ADAPTIVE, colors=256) for f in frames]
        q_frames[0].save(
            output_gif,
            save_all=True,
            append_images=q_frames[1:],
            duration=durations,
            loop=0,
            optimize=True
        )
        print(f"SUCCESS: Philippines B13 GIF loop saved to: {os.path.abspath(output_gif)}")
    print("=" * 75)

def generate_storm_b13(storm_data, output_png=None, output_gif=None, hours=6.0, interval=20, fps=8, make_png=True, make_gif=True):
    atcf_id = storm_data.get("atcf_id", "STORM")
    name = storm_data.get("storm_name", "ACTIVE")
    c_lat = storm_data.get("lat", 15.0)
    c_lon = storm_data.get("lon", 125.0)

    print(f"\n>>> Processing Storm: {name} ({atcf_id}) at ({c_lat:.1f}N, {c_lon:.1f}E)...")
    extent = calculate_storm_extent(c_lat, c_lon)

    targets = get_jma_target_times()
    if not targets:
        print("Error: Could not retrieve JMA observation times.")
        return

    latest_target = targets[-1]["validtime"]

    out_png = output_png or f"storm_{atcf_id}_b13.png"
    out_gif = output_gif or f"storm_{atcf_id}_b13_loop.gif"

    if make_png:
        print(f"Rendering Static Storm Map: {latest_target}...")
        img = render_b13_frame(latest_target, extent=extent, storm_data=storm_data, is_philippines=False, zoom_level=5)
        img.save(out_png, dpi=(120, 120))
        print(f"SUCCESS: Storm B13 map saved to: {os.path.abspath(out_png)}")

    if make_gif:
        print(f"Compiling {hours:.1f}-hour Animated Storm GIF Loop...")
        latest_dt = datetime.datetime.strptime(latest_target, "%Y%m%d%H%M%S").replace(tzinfo=datetime.timezone.utc)
        start_dt = latest_dt - datetime.timedelta(hours=hours)

        sampled_targets = []
        last_t = None
        for item in targets:
            vt = item["validtime"]
            t_dt = datetime.datetime.strptime(vt, "%Y%m%d%H%M%S").replace(tzinfo=datetime.timezone.utc)
            if t_dt >= start_dt:
                if last_t is None or (t_dt - last_t).total_seconds() >= (interval * 60 - 60):
                    sampled_targets.append(vt)
                    last_t = t_dt

        if not sampled_targets:
            sampled_targets = [latest_target]

        frames = []
        for idx, vt in enumerate(sampled_targets):
            print(f"[{idx+1}/{len(sampled_targets)}] Rendering storm frame {vt}...", end="\r", flush=True)
            f_img = render_b13_frame(vt, extent=extent, storm_data=storm_data, is_philippines=False, zoom_level=5)
            frames.append(f_img)

        print(f"\nQuantizing and saving GIF to {out_gif}...")
        frame_dur = int(1000 / fps)
        durations = [frame_dur] * len(frames)
        durations[-1] = 1500

        q_frames = [f.convert('P', palette=Image.Palette.ADAPTIVE, colors=256) for f in frames]
        q_frames[0].save(
            out_gif,
            save_all=True,
            append_images=q_frames[1:],
            duration=durations,
            loop=0,
            optimize=True
        )
        print(f"SUCCESS: Storm B13 GIF loop saved to: {os.path.abspath(out_gif)}")

# ── CLI Interface ────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Himawari-9 Channel 13 IR Brightness Temperature (°C) Map & Loop Generator")
    parser.add_argument("--philippines", action="store_true", help="Generate Philippines & PAR archipelago overview")
    parser.add_argument("--storm", type=str, default=None, help="Target specific storm (e.g. 22W, 17W, or 'all')")
    parser.add_argument("--png-only", action="store_true", help="Generate only static PNG maps")
    parser.add_argument("--gif-only", action="store_true", help="Generate only animated GIF loops")
    parser.add_argument("--both", action="store_true", help="Generate both PNG and GIF (default)")
    parser.add_argument("--hours", type=float, default=6.0, help="Timeframe in hours for GIF (default: 6.0)")
    parser.add_argument("--interval", type=int, default=20, help="Frame step interval in minutes (default: 20)")
    parser.add_argument("--fps", type=int, default=8, help="Frames per second for GIF (default: 8)")
    parser.add_argument("--output", type=str, default=None, help="Custom output filepath")
    args = parser.parse_args()

    make_png = not args.gif_only
    make_gif = not args.png_only

    active_storms = fetch_active_storms()
    print(f"Found {len(active_storms)} active storm(s) in the Western Pacific.")

    # If neither --philippines nor --storm specified, run BOTH Philippines and all active storms!
    gen_ph = args.philippines or (args.storm is None)
    gen_storm = (args.storm is not None) or (args.storm is None and len(active_storms) > 0)

    if gen_ph:
        out_png = args.output.replace(".gif", ".png") if args.output else "philippines_b13.png"
        out_gif = args.output.replace(".png", ".gif") if args.output else "philippines_b13_loop.gif"
        generate_philippines_b13(
            output_png=out_png,
            output_gif=out_gif,
            hours=args.hours,
            interval=args.interval,
            fps=args.fps,
            make_png=make_png,
            make_gif=make_gif
        )

    if gen_storm and active_storms:
        target_storms = active_storms
        if args.storm and args.storm.lower() != 'all':
            target_storms = [s for s in active_storms if args.storm.upper() in s["atcf_id"].upper() or args.storm.upper() in s["storm_name"].upper()]

        for st in target_storms:
            generate_storm_b13(
                st,
                hours=args.hours,
                interval=args.interval,
                fps=args.fps,
                make_png=make_png,
                make_gif=make_gif
            )

if __name__ == "__main__":
    main()
