#!/usr/bin/env python3
"""
========================================================================================
Himawari Channel 13 IR Brightness Temperature HD Satellite Map & Loop Generator
(Northern Luzon Focus & Storm-Centered Tracking with Fox Weather Broadcast Styling)
========================================================================================
- Data Source: Japan Meteorological Agency (JMA) Himawari-9 Clean Infrared (Band 13 / 10.4 μm TBB)
- Enhancing Low-Res Tiles:
    * 4x Sub-Pixel Bicubic Resampling (upsampling 256x256 tiles to 1024x1024 with bicubic filter)
    * Smooth continuous cloud gradients with zero blocky/pixelated artifacts
- Colormap: Dvorak BD-Curve / TC-Rainbow Enhancement:
    * Overshooting tops (-80°C to -100°C) in soft/bright pink and pure white
    * Cold convective core / CDO (-70°C to -76°C) in dark charcoal and maroon
    * Intense eyewall & convection (-54°C to -69°C) in red, orange, and bright yellow
    * Outer rainbands (-42°C to -53°C) in vivid electric lime green & chartreuse
    * Mid-level clouds (-30°C to -41°C) in cyan / teal / slate gray
    * Warm low clouds & sea surface (> 0°C) in dark/medium gray
- Geographic features & Broadcast Styling:
    * Full-bleed edge-to-edge canvas (strict 4:3 aspect ratio, zero black sidebars)
    * High-visibility Yellow coastlines (#FFE600) and international boundaries
    * Detailed Yellow Philippine Province Boundaries (from public/data/ph_provinces.json)
    * Orange Philippine Area of Responsibility (PAR) boundary line (#FF6B35)
    * Subtle white coordinate gridlines
- Storm Past Track Overlay:
    * Red dashed line tracing past storm motion
    * Red circular nodes with white borders and bold white hour labels (0, 6, 12, 18...)
- TV Broadcast Header:
    * Floating 2-tier navy container with rounded corners and white outline
    * Top Tier: 'ENHANCED INFRARED SATELLITE (BD-CURVE)' + 'PHILIPPINE TYPHOON WEATHER' badge
    * Bottom Tier: 'WED 9:50AM PHT' + System Name / Details + 'DATA: JMA HIMAWARI-9'
========================================================================================
"""

import os
import sys
import math
import re
import io
import json
import argparse
import datetime
import requests
import numpy as np
import matplotlib
matplotlib.use('Agg')
matplotlib.rcParams['lines.scale_dashes'] = False
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import matplotlib.patheffects as pe
from matplotlib.colors import LinearSegmentedColormap
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import cartopy.io.img_tiles as cimgt
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import shape
from shapely.validation import make_valid
from shapely.ops import unary_union, linemerge
import hashlib

# ── Optional RapidOCR & PyMuPDF for PAGASA pf.pdf Parsing ────────────────────
try:
    import pymupdf
    from rapidocr_onnxruntime import RapidOCR
    _OCR_AVAILABLE = True
    _RAPID_OCR_INSTANCE = None
except ImportError:
    _OCR_AVAILABLE = False
    _RAPID_OCR_INSTANCE = None

def get_ocr_instance():
    global _RAPID_OCR_INSTANCE
    if _RAPID_OCR_INSTANCE is None and _OCR_AVAILABLE:
        try:
            _RAPID_OCR_INSTANCE = RapidOCR()
        except Exception as e:
            print(f"Notice: Failed to initialize RapidOCR: {e}")
            _RAPID_OCR_INSTANCE = False
    return _RAPID_OCR_INSTANCE if _RAPID_OCR_INSTANCE else None

# Explicit non-scaling dash pattern for aligned province and country borders
DASH = (0, (5, 3))

# ── Shared Requests Session with Connection Pooling ─────────────────────────
_HTTP_SESSION = requests.Session()
_ADAPTER = requests.adapters.HTTPAdapter(pool_connections=40, pool_maxsize=40, max_retries=3)
_HTTP_SESSION.mount('https://', _ADAPTER)
_HTTP_SESSION.mount('http://', _ADAPTER)

# ── 2026 PAGASA Storm Name Roster ────────────────────────────────────────────
PAGASA_NAMES_2026 = [
    "ADA", "BASYANG", "CALOY", "DOMENG", "ESTER",
    "FRANCISCO", "GARDO", "HENRY", "INDAY", "JOSIE",
    "KIYAPO", "LUIS", "MAYMAY", "NENENG", "OBET",
    "PILANDOK", "QUEENIE", "ROSAL", "SAMUEL", "TOMAS",
    "UMBERTO", "VENUS", "WALDO", "YAYANG", "ZENY"
]

PAGASA_STORM_MAP_2026 = {
    '25W': 'QUEENIE',
    'WP25': 'QUEENIE',
    'WP252026': 'QUEENIE',
    'SURIGAE': 'QUEENIE',
    '26W': 'CHOI-WAN',
    'WP26': 'CHOI-WAN',
    'WP262026': 'CHOI-WAN',
    'CHOI-WAN': 'CHOI-WAN',
    'CHOIWAN': 'CHOI-WAN',
    '32W': 'UWAN',
    'FUNG-WONG': 'UWAN',
}

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

            raw_boundaries = []
            for feat in geo_data.get("features", []):
                geom = shape(feat["geometry"])
                if not geom.is_valid:
                    geom = make_valid(geom)
                if hasattr(geom, 'boundary'):
                    raw_boundaries.append(geom.boundary)

            # Deduplicate shared borders between neighboring provinces
            merged = linemerge(unary_union(raw_boundaries))
            if hasattr(merged, 'geoms'):
                _PROVINCE_GEOMS_CACHE = list(merged.geoms)
            else:
                _PROVINCE_GEOMS_CACHE = [merged]
            return _PROVINCE_GEOMS_CACHE
        except Exception as e:
            print(f"Notice: Failed to load province boundaries: {e}")
    _PROVINCE_GEOMS_CACHE = []
    return _PROVINCE_GEOMS_CACHE

# ── Dvorak BD-Curve / TC-Rainbow Infrared Colormap ───────────────────────────
# Normalized scale: 0.0 = +40°C, 1.0 = -100°C (linear: T = 40.0 - norm * 140.0)
_PTCC_BD_STOPS = [
    (0.000, '#000000'),  # +40°C: pure black / clear ocean
    (0.071, '#000000'),  # +30°C: pure black / warm tropical sea
    (0.143, '#0a0d12'),  # +20°C: dark navy-black / warm land surface
    (0.214, '#20242c'),  # +10°C: dark charcoal for low clouds
    (0.286, '#464d58'),  #   0°C: medium-dark slate gray / freezing level
    (0.357, '#8892a0'),  # -10°C: slate gray mid clouds
    (0.393, '#cbd4e0'),  # -15°C: light silver-gray before cyan onset
    (0.414, '#55abc7'),  # -18°C: bright cyan
    (0.429, '#058bb7'),  # -20°C: cerulean blue
    (0.457, '#002589'),  # -24°C: royal blue
    (0.486, '#04455f'),  # -28°C: deep navy blue
    (0.500, '#01664c'),  # -30°C: deep forest teal
    (0.529, '#00b323'),  # -34°C: rich green
    (0.557, '#49d212'),  # -38°C: vivid lime green
    (0.571, '#76df0a'),  # -40°C: bright electric green
    (0.600, '#d2f700'),  # -44°C: chartreuse / yellow-green
    (0.614, '#e6e500'),  # -46°C: vivid yellow
    (0.629, '#f0b700'),  # -48°C: amber yellow
    (0.643, '#f58600'),  # -50°C: bright orange
    (0.671, '#fa2d00'),  # -54°C: vivid red-orange
    (0.686, '#e71505'),  # -56°C: bright red
    (0.714, '#891305'),  # -60°C: deep crimson red
    (0.729, '#5b100d'),  # -62°C: dark maroon
    (0.743, '#2b0d10'),  # -64°C: very dark maroon
    (0.757, '#352529'),  # -66°C: cold ring charcoal/black
    (0.786, '#888280'),  # -70°C: medium gray
    (0.814, '#d8d7d7'),  # -74°C: light silver gray
    (0.829, '#d6cedf'),  # -76°C: light lavender
    (0.857, '#ab82b8'),  # -80°C: pastel purple
    (0.871, '#9457a9'),  # -82°C: medium purple / violet
    (0.893, '#763594'),  # -85°C: deep violet
    (0.940, '#52166d'),  # -92°C: rich dark violet
    (1.000, '#ffffff'),  # -100°C: pure white convective overshooting tops
]

CMAP_PTCC_BD = LinearSegmentedColormap.from_list('ptcc_bd_curve', _PTCC_BD_STOPS, N=256)

# ── Web Mercator <-> WGS84 Degree Conversions ─────────────────────────────────
def deg2num(lat_deg, lon_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return xtile, ytile

def num2deg(xtile, ytile, zoom):
    n = 2.0 ** zoom
    lon_deg = xtile / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * ytile / n)))
    lat_deg = math.degrees(lat_rad)
    return lat_deg, lon_deg

# ── Ultra-HD Composite Tile Mosaicking & Bicubic Rectification ────────────────
def fetch_composite_b13(vt_str, extent, zoom=5, session=None):
    """
    Fetches all JMA Himawari Band 13 tiles covering 'extent', merges them into
    a seamless mosaic, performs 4x sub-pixel bicubic resampling, warps from Web
    Mercator to linear PlateCarree coordinates, and applies the Dvorak BD-Curve.
    
    This bypasses Cartopy's internal 750-pixel nearest-neighbor regridder,
    allowing ax.imshow(..., transform=ccrs.PlateCarree(), interpolation='bicubic')
    to render at full resolution with silky-smooth, continuous cloud gradients.
    """
    min_lon, max_lon, min_lat, max_lat = extent
    session = session or _HTTP_SESSION
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.jma.go.jp/"}

    x0, y0 = deg2num(max_lat, min_lon, zoom)
    x1, y1 = deg2num(min_lat, max_lon, zoom)

    x_min, x_max = min(x0, x1), max(x0, x1)
    y_min, y_max = min(y0, y1), max(y0, y1)

    tile_top_lat, tile_left_lon = num2deg(x_min, y_min, zoom)
    tile_bot_lat, tile_right_lon = num2deg(x_max + 1, y_max + 1, zoom)
    grid_extent = [tile_left_lon, tile_right_lon, tile_bot_lat, tile_top_lat]

    nx_tiles = x_max - x_min + 1
    ny_tiles = y_max - y_min + 1

    tile_w, tile_h = 256, 256
    raw_mosaic = Image.new('L', (nx_tiles * tile_w, ny_tiles * tile_h), 0)

    for ty in range(y_min, y_max + 1):
        for tx in range(x_min, x_max + 1):
            url = f"https://www.jma.go.jp/bosai/himawari/data/satimg/{vt_str}/fd/{vt_str}/B13/TBB/{zoom}/{tx}/{ty}.jpg"
            try:
                r = session.get(url, headers=headers, timeout=5)
                if r.status_code == 200 and len(r.content) > 500:
                    t_img = Image.open(io.BytesIO(r.content)).convert('L')
                    px = (tx - x_min) * tile_w
                    py = (ty - y_min) * tile_h
                    raw_mosaic.paste(t_img, (px, py))
            except Exception:
                pass

    # 4x Sub-Pixel Bicubic Resampling over the full bounding mosaic
    hd_w = nx_tiles * 1024
    hd_h = ny_tiles * 1024
    mosaic_hd = raw_mosaic.resize((hd_w, hd_h), Image.Resampling.BICUBIC)
    arr_merc = np.array(mosaic_hd, dtype=np.float32)

    # Sub-pixel transformation from Mercator y to PlateCarree latitude
    lats = np.linspace(tile_top_lat, tile_bot_lat, hd_h)
    lats_rad = np.radians(lats)
    y_merc_norm = (1.0 - np.arcsinh(np.tan(lats_rad)) / np.pi) / 2.0

    n_tiles_total = 2.0 ** zoom
    y_min_norm = y_min / n_tiles_total
    y_max_norm = (y_max + 1) / n_tiles_total

    y_indices = (y_merc_norm - y_min_norm) / (y_max_norm - y_min_norm) * (hd_h - 1)
    y_indices = np.clip(y_indices, 0, hd_h - 1).astype(int)

    arr_plate = arr_merc[y_indices, :]
    norm_val = np.clip(arr_plate / 255.0, 0.0, 1.0)
    colored = (CMAP_PTCC_BD(norm_val)[:, :, :3] * 255).astype(np.uint8)
    return colored, grid_extent

# ── JMA Observation Time Fetching ────────────────────────────────────────────
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

# ── Extents & Aspect Ratio Matching ──────────────────────────────────────────
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

# ── Regional Sectors & Target Domains ─────────────────────────────────────────
SECTORS = {
    'northern_luzon': {
        'id': 'northern_luzon',
        'key': 'northern_luzon',
        'extent': fit_extent_to_aspect([117.5, 125.5, 15.5, 21.5], 10.0 / 7.5),
        'title': 'NORTHERN & EXTREME NORTHERN LUZON',
        'label': 'Northern & Extreme Northern Luzon Sector',
        'filename_stem': 'ptcc_northern_luzon',
        'grid_step': 1.0,
    },
    'southern_luzon': {
        'id': 'southern_luzon',
        'key': 'southern_luzon',
        'extent': fit_extent_to_aspect([119.5, 124.5, 12.5, 16.25], 10.0 / 7.5),
        'title': 'SOUTHERN LUZON (CALABARZON • NCR • MIMAROPA)',
        'label': 'Southern Luzon Sector (CALABARZON / Laguna / Metro Manila / Mindoro)',
        'filename_stem': 'ptcc_southern_luzon',
        'grid_step': 1.0,
    },
    'visayas': {
        'id': 'visayas',
        'key': 'visayas',
        'extent': fit_extent_to_aspect([120.75, 126.75, 9.0, 13.5], 10.0 / 7.5),
        'title': 'VISAYAS',
        'label': 'All Visayas Sector (Western, Central & Eastern Visayas)',
        'filename_stem': 'ptcc_visayas',
        'grid_step': 1.0,
    },
    'mindanao': {
        'id': 'mindanao',
        'key': 'mindanao',
        'extent': fit_extent_to_aspect([119.0, 127.0, 4.75, 10.75], 10.0 / 7.5),
        'title': 'MINDANAO',
        'label': 'Mindanao Sector (Davao, Caraga, Zamboanga, BARMM)',
        'filename_stem': 'ptcc_mindanao',
        'grid_step': 1.0,
    },
    'luzon': {
        'id': 'luzon',
        'key': 'luzon',
        'extent': fit_extent_to_aspect([116.0, 126.0, 13.0, 20.5], 10.0 / 7.5),
        'title': 'LUZON ARCHIPELAGO REGIONAL FOCUS',
        'label': 'General Luzon Sector',
        'filename_stem': 'ptcc_luzon',
        'grid_step': 2.0,
    },
    'philippines': {
        'id': 'philippines',
        'key': 'philippines',
        'extent': fit_extent_to_aspect([113.0, 137.0, 4.0, 22.0], 10.0 / 7.5),
        'title': 'PHILIPPINES & PAR REGION',
        'label': 'Philippine Archipelago & PAR Overview',
        'filename_stem': 'ptcc_philippines',
        'grid_step': 5.0,
    }
}

def resolve_sector(sector_name):
    if not sector_name:
        return None
    s = str(sector_name).lower().replace('-', '_').strip()
    if s in SECTORS:
        return SECTORS[s]
    alias_map = {
        'north_luzon': 'northern_luzon',
        'extreme_north_luzon': 'northern_luzon',
        'extreme_northern_luzon': 'northern_luzon',
        'nluzon': 'northern_luzon',
        'south_luzon': 'southern_luzon',
        'sluzon': 'southern_luzon',
        'calabarzon': 'southern_luzon',
        'central_luzon': 'southern_luzon',
        'laguna': 'southern_luzon',
        'all_visayas': 'visayas',
        'vis': 'visayas',
        'all_mindanao': 'mindanao',
        'min': 'mindanao',
        'par': 'philippines',
        'all_philippines': 'philippines',
        'all_luzon': 'luzon',
    }
    canonical = alias_map.get(s)
    if canonical and canonical in SECTORS:
        return SECTORS[canonical]
    return None

def get_sector_extent(sector_key):
    info = resolve_sector(sector_key)
    if info:
        return info['extent']
    return SECTORS['southern_luzon']['extent']

def get_luzon_extent():
    return SECTORS['luzon']['extent']

def get_philippines_extent():
    return SECTORS['philippines']['extent']

def calculate_storm_focus_extent(c_lat, c_lon, lon_span=26.0, target_aspect=0.75):
    """
    Calculates dynamic extent focused on given center coordinates (c_lat, c_lon).
    Default lon_span is ~26 degrees with ~19.5 degrees lat span (4:3 aspect ratio),
    matching storm_focused_satellite_gif.py.
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

    return fit_extent_to_aspect([max(80.0, min_lon), min(180.0, max_lon), max(0.0, min_lat), min(60.0, max_lat)], 1.0 / target_aspect)

# ── Storm Track Timeline Extraction & Historical Track Points ────────────────
def get_storm_track_timeline(storm_data):
    if not storm_data:
        return []

    atcf_id = str(storm_data.get('atcf_id', '')).strip().upper()
    m = re.search(r'(\d{2}[A-Z]?)', atcf_id)
    short_id = m.group(1) if m else atcf_id
    if short_id and not (short_id.endswith('W') or short_id.endswith('E') or short_id.endswith('C')):
        short_id += 'W'
    num_match = re.search(r'(\d{2})', short_id)
    num_str = num_match.group(1) if num_match else ''

    timeline = []
    seen_times = set()

    now_year = datetime.datetime.now(datetime.timezone.utc).year
    candidates = [
        os.path.join('public', 'data', f'tc_positions_{short_id}.json'),
        os.path.join('public', 'data', f'tc_positions_WP{num_str}{now_year}.json') if num_str else None,
        os.path.join('public', 'data', f'tc_positions_{atcf_id}.json'),
    ]
    loaded = False
    for c in filter(None, candidates):
        if os.path.exists(c):
            try:
                with open(c, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    for item in data.get('history', []):
                        cyc_str = item.get('cycle')
                        if not cyc_str:
                            continue
                        t = datetime.datetime.strptime(cyc_str, '%Y-%m-%d %H:%M').replace(tzinfo=datetime.timezone.utc)
                        timeline.append({
                            'time': t,
                            'lat': float(item['lat']),
                            'lon': float(item['lon']),
                            'wind_kt': float(item.get('wind_kt', 0)),
                            'pressure_hpa': float(item.get('pressure_hpa', 1008)),
                            'type': 'history'
                        })
                        seen_times.add(t)
                    loaded = True
                    break
            except Exception:
                pass

    if not loaded and short_id:
        remote_url = f"https://raw.githubusercontent.com/RusselP122/philippine-weather-app/main/public/data/tc_positions_{short_id}.json"
        try:
            r = _HTTP_SESSION.get(remote_url, timeout=4)
            if r.status_code == 200:
                data = r.json()
                for item in data.get('history', []):
                    cyc_str = item.get('cycle')
                    if not cyc_str:
                        continue
                    t = datetime.datetime.strptime(cyc_str, '%Y-%m-%d %H:%M').replace(tzinfo=datetime.timezone.utc)
                    timeline.append({
                        'time': t,
                        'lat': float(item['lat']),
                        'lon': float(item['lon']),
                        'wind_kt': float(item.get('wind_kt', 0)),
                        'pressure_hpa': float(item.get('pressure_hpa', 1008)),
                        'type': 'history'
                    })
                    seen_times.add(t)
        except Exception:
            pass

    cur_lat = storm_data.get('lat')
    cur_lon = storm_data.get('lon')
    if cur_lat is not None and cur_lon is not None:
        analysis_time = storm_data.get('analysis_time')
        cur_t = None
        if analysis_time:
            clean_time_str = str(analysis_time).strip()
            for fmt in ['%Y-%m-%d %H:%M', '%Y%m%d%H%M', '%Y%m%d%H']:
                try:
                    cur_t = datetime.datetime.strptime(clean_time_str, fmt).replace(tzinfo=datetime.timezone.utc)
                    break
                except Exception:
                    pass
        if not cur_t:
            cur_t = datetime.datetime.now(datetime.timezone.utc).replace(minute=0, second=0, microsecond=0)

        if cur_t not in seen_times:
            timeline.append({
                'time': cur_t,
                'lat': float(cur_lat),
                'lon': float(cur_lon),
                'wind_kt': float(storm_data.get('wind_kt', 0)),
                'pressure_hpa': float(storm_data.get('pressure_hpa', 1008)),
                'type': 'analysis'
            })
            seen_times.add(cur_t)

    timeline.sort(key=lambda x: x['time'])
    return timeline

def interpolate_storm_state(timeline, target_time, fallback_storm_data):
    if not timeline:
        return fallback_storm_data

    if target_time <= timeline[0]['time']:
        pt = timeline[0]
        res = dict(fallback_storm_data or {})
        res['lat'] = pt['lat']
        res['lon'] = pt['lon']
        res['wind_kt'] = pt['wind_kt']
        res['pressure_hpa'] = pt['pressure_hpa']
        return res

    if target_time >= timeline[-1]['time']:
        pt = timeline[-1]
        res = dict(fallback_storm_data or {})
        res['lat'] = pt['lat']
        res['lon'] = pt['lon']
        res['wind_kt'] = pt['wind_kt']
        res['pressure_hpa'] = pt['pressure_hpa']
        return res

    for i in range(len(timeline) - 1):
        t1 = timeline[i]['time']
        t2 = timeline[i+1]['time']
        if t1 <= target_time <= t2:
            dt_total = (t2 - t1).total_seconds()
            alpha = (target_time - t1).total_seconds() / dt_total if dt_total > 0 else 0.0
            
            p1 = timeline[i]
            p2 = timeline[i+1]
            interp_lat = p1['lat'] + alpha * (p2['lat'] - p1['lat'])
            interp_lon = p1['lon'] + alpha * (p2['lon'] - p1['lon'])
            interp_wind = p1['wind_kt'] + alpha * (p2['wind_kt'] - p1['wind_kt'])
            interp_press = p1['pressure_hpa'] + alpha * (p2['pressure_hpa'] - p1['pressure_hpa'])

            res = dict(fallback_storm_data or {})
            res['lat'] = round(interp_lat, 2)
            res['lon'] = round(interp_lon, 2)
            res['wind_kt'] = round(interp_wind, 1)
            res['pressure_hpa'] = round(interp_press, 1)
            return res

    return fallback_storm_data

def get_past_track_nodes(timeline, current_dt, max_hours_back=18):
    """
    Extracts 6-hourly past track nodes leading up to current_dt:
    Returns list of dicts: [{'hours_ago': 0, 'lat': ..., 'lon': ...}, {'hours_ago': 6, ...}, ...]
    sorted from oldest to newest.
    """
    if not timeline:
        return []

    nodes = []
    offsets = list(range(max_hours_back, -1, -6))
    for h in offsets:
        t_target = current_dt - datetime.timedelta(hours=h)
        state = interpolate_storm_state(timeline, t_target, None)
        if state and 'lat' in state and 'lon' in state:
            nodes.append({
                'hours_ago': h,
                'time': t_target,
                'lat': state['lat'],
                'lon': state['lon'],
            })
    return nodes

def parse_jma_latlon(val_str):
    """Parses JMA lat/lon format like '22.4N' or '154.3E'."""
    if not val_str:
        return float('nan')
    val_str = str(val_str).strip()
    try:
        num = float(val_str[:-1])
        if val_str[-1].upper() in ('S', 'W'):
            num = -num
        return num
    except Exception:
        return float('nan')

def knots_to_kmh(kt):
    """
    Converts knots to km/h rounded to the nearest 5 km/h,
    matching official WMO, PAGASA, and RSMC operational broadcast standards.
    E.g., 45 kt -> 85 km/h, 30 kt -> 55 km/h, 25 kt -> 45 km/h, 15 kt -> 30 km/h.
    """
    if kt is None:
        return None
    try:
        val = float(kt)
        return int(round(val * 1.852 / 5.0) * 5)
    except (ValueError, TypeError):
        return None

def kmh_to_knots(kmh):
    """
    Converts km/h to knots rounded to the nearest 5 kt,
    matching official WMO and operational agency intensity standards.
    E.g., 85 km/h -> 45 kt, 55 km/h -> 30 kt, 175 km/h -> 95 kt.
    """
    if kmh is None:
        return None
    try:
        val = float(kmh)
        return int(round(val / 1.852 / 5.0) * 5)
    except (ValueError, TypeError):
        return None

def is_placeholder_storm_name(name):
    """
    Checks if a storm name from ATCF / JTWC is just a placeholder,
    temporary designation, number word, or INVEST ID rather than an official
    international name assigned by RSMC Tokyo (JMA).
    Examples: 'TWENTYNINE', 'TWENTY-NINE', '29W', 'INVEST', 'WP292026', 'UNKNOWN'.
    """
    if not name:
        return True
    clean = re.sub(r'[^A-Za-z0-9]', '', str(name).upper())
    if not clean:
        return True

    # Generic terms
    if clean in ('UNKNOWN', 'NONAME', 'SYSTEM', 'CYCLONE', 'CUSTOM', 'NA', 'NONE', 'INVEST'):
        return True
    if clean.startswith('INVEST') or re.match(r'^9\d[A-Z]?$', clean):
        return True
    if re.match(r'^(TC|WP|TD)?\d{1,2}[A-Z]?$', clean) or re.match(r'^WP\d{4}$', clean):
        return True

    # Spelled-out number words (JTWC standard depression designation)
    number_words = {
        'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
        'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN',
        'TWENTY', 'TWENTYONE', 'TWENTYTWO', 'TWENTYTHREE', 'TWENTYFOUR', 'TWENTYFIVE',
        'TWENTYSIX', 'TWENTYSEVEN', 'TWENTYEIGHT', 'TWENTYNINE',
        'THIRTY', 'THIRTYONE', 'THIRTYTWO', 'THIRTYTHREE', 'THIRTYFOUR', 'THIRTYFIVE',
        'THIRTYSIX', 'THIRTYSEVEN', 'THIRTYEIGHT', 'THIRTYNINE', 'FORTY'
    }
    if clean in number_words:
        return True

    return False

def find_jma_international_name(storm_data, data_dir='public/data'):
    """
    Scans JMA (RSMC Tokyo) observation bulletins (VPTW60_60 through 65) to find the
    official international tropical cyclone name (e.g. CHAMPI for 29W) when
    ATCF / JTWC still only reports a placeholder number word (e.g. TWENTYNINE) or code.
    Matches by spatial proximity (within 650 km).
    """
    if not storm_data:
        return None

    try:
        curr_lat = float(storm_data.get('lat', 0.0))
        curr_lon = float(storm_data.get('lon', 0.0))
    except (ValueError, TypeError):
        return None

    if not curr_lat or not curr_lon:
        return None

    best_name = None
    min_dist = float('inf')

    for i in range(60, 66):
        local_jma = os.path.join(data_dir, f"jma_vptw60_{i}.json")
        jma_json_str = ""

        # Attempt live fetch first to ensure we have the latest bulletin
        url = f"https://www.data.jma.go.jp/multi/data/VPTW60/{i}_en.json"
        try:
            r = _HTTP_SESSION.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=3.0)
            if r.status_code == 200 and len(r.text) > 50:
                jma_json_str = r.text
                os.makedirs(data_dir, exist_ok=True)
                with open(local_jma, 'w', encoding='utf-8') as f:
                    f.write(jma_json_str)
        except Exception:
            pass

        # Fallback to local cached file
        if not jma_json_str.strip() and os.path.exists(local_jma):
            try:
                with open(local_jma, 'r', encoding='utf-8') as f:
                    jma_json_str = f.read()
            except Exception:
                pass

        if not jma_json_str.strip():
            continue

        try:
            d = json.loads(jma_json_str)
            remark = str(d.get('remark', '')).strip()
            if any(k in remark for k in ['消滅', '低気圧化', '台風消滅', '温帯低気圧']):
                continue

            # Check product age (skip older than 36h)
            target_dt_str = d.get('targetDateTime', '') or d.get('reportDateTime', '')
            if target_dt_str:
                try:
                    tdt = datetime.datetime.strptime(target_dt_str, "%Y/%m/%d %H:%M").replace(tzinfo=datetime.timezone.utc)
                    age_hours = (datetime.datetime.now(datetime.timezone.utc) - tdt).total_seconds() / 3600.0
                    if age_hours > 36.0:
                        continue
                except Exception:
                    pass

            jma_name = str(d.get('name', '')).strip().upper()
            if not jma_name or is_placeholder_storm_name(jma_name):
                continue

            infos = d.get('meteorologicalInfos', [])
            if not infos:
                continue

            first_c = infos[0].get('centerPart', {})
            c_lat = parse_jma_latlon(first_c.get('coordinateLat') or (first_c.get('probabilityCircle', {}) or {}).get('basePointLat'))
            c_lon = parse_jma_latlon(first_c.get('coordinateLon') or (first_c.get('probabilityCircle', {}) or {}).get('basePointLon'))

            if not math.isnan(c_lat) and not math.isnan(c_lon):
                dist_km = math.sqrt((c_lat - curr_lat)**2 + (c_lon - curr_lon)**2) * 111.0
                if dist_km <= 650.0 and dist_km < min_dist:
                    min_dist = dist_km
                    best_name = jma_name
        except Exception:
            continue

    return best_name

# ── Fox Weather Broadcast Header Drawing Function ───────────────────────────
def draw_fox_weather_header(img, dt_utc, storm_data=None, custom_title=None, sector_title=None, is_luzon=False):
    """
    Draws a TV broadcast-style top header matching the Fox Weather layout:
    - Top navy container with 2-tier layout and rounded corners
    - Top Tier: 'ENHANCED INFRARED SATELLITE (BD-CURVE)' + 'PHILIPPINE TYPHOON WEATHER' badge
    - Bottom Tier: 'WED 9:50AM PHT' + System Name / Details + 'DATA: JMA HIMAWARI-9'
    """
    pht_tz = datetime.timezone(datetime.timedelta(hours=8))
    dt_pht = dt_utc.astimezone(pht_tz)

    w, h = img.size
    draw = ImageDraw.Draw(img)

    title_text = custom_title.upper() if custom_title else "ENHANCED INFRARED SATELLITE"

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

    # 3. Top Tier Left: Product Title
    draw.text((bx1 + int(16 * scale), by1 + int(8 * scale)), title_text, fill=(255, 255, 255), font=font_title)

    # 4. Top Tier Right: PHILIPPINE TYPHOON WEATHER Broadcast Badge
    badge_h = int(28 * scale)
    badge_y1 = by1 + int(7 * scale)
    badge_y2 = badge_y1 + badge_h
    badge_w = int(278 * scale)
    badge_x2 = bx2 - int(12 * scale)
    badge_x1 = badge_x2 - badge_w

    draw.rounded_rectangle(
        [badge_x1, badge_y1, badge_x2, badge_y2],
        radius=max(3, int(5 * scale)),
        fill=(255, 255, 255),
        outline=(255, 255, 255),
        width=1
    )

    red_w = int(82 * scale)
    red_x1 = badge_x2 - red_w
    draw.rounded_rectangle(
        [red_x1, badge_y1 + int(2 * scale), badge_x2 - int(2 * scale), badge_y2 - int(2 * scale)],
        radius=max(2, int(4 * scale)),
        fill=(220, 38, 38)
    )

    draw.text((badge_x1 + int(10 * scale), badge_y1 + int(6 * scale)), "PHILIPPINE TYPHOON", fill=(10, 25, 56), font=font_badge_main)
    draw.text((red_x1 + int(8 * scale), badge_y1 + int(6 * scale)), "WEATHER", fill=(255, 255, 255), font=font_badge_sub)

    # 5. Bottom Tier Left: Timestamp in PHT
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
    source_text = "DATA: JMA HIMAWARI-9"
    src_bbox = draw.textbbox((0, 0), source_text, font=font_sub)
    src_w = src_bbox[2] - src_bbox[0]
    src_x = bx2 - int(16 * scale) - src_w
    draw.text((src_x, time_y), source_text, fill=(147, 197, 253), font=font_sub)

    # Separator 2
    sep2_x = src_x - int(14 * scale)
    draw.line([(sep2_x, mid_y + 1), (sep2_x, by2 - 1)], fill=(70, 105, 155), width=max(1, int(1 * scale)))

    # 7. Bottom Tier Middle: Headline (displays only storm name for storm targets)
    if storm_data:
        raw_name = str(storm_data.get("storm_name", "")).strip().upper()
        atcf_id = str(storm_data.get("atcf_id", "")).strip().upper()
        m = re.search(r'(\d{2}[A-Z]?)', atcf_id)
        short_id = m.group(1) if m else atcf_id
        if short_id and not (short_id.endswith('W') or short_id.endswith('E') or short_id.endswith('C')):
            short_id += 'W'

        # If ATCF name is a placeholder (e.g. TWENTYNINE, 29W, etc.), check JMA data for official international name
        if is_placeholder_storm_name(raw_name):
            jma_name = storm_data.get("international_name") or find_jma_international_name(storm_data)
            if jma_name:
                raw_name = jma_name
                storm_data["storm_name"] = jma_name
                storm_data["international_name"] = jma_name

        pagasa_name = storm_data.get("pagasa_name") or PAGASA_STORM_MAP_2026.get(short_id) or PAGASA_STORM_MAP_2026.get(raw_name)
        if pagasa_name:
            if raw_name.startswith("TC ") or raw_name.startswith("WP") or raw_name == short_id:
                disp_name = pagasa_name
            elif pagasa_name in raw_name:
                disp_name = raw_name
            else:
                disp_name = f"{raw_name} ({pagasa_name})"
        else:
            disp_name = raw_name

        if short_id and short_id not in disp_name:
            system_text = f"{disp_name} ({short_id})"
        else:
            system_text = disp_name
    elif sector_title:
        system_text = sector_title
    else:
        system_text = "PHILIPPINES & PAR REGION"

    sys_x = sep1_x + int(14 * scale)
    draw.text((sys_x, time_y), system_text, fill=(255, 255, 255), font=font_sub)

    return img

# ── Official Agency Storm Wind Fetching & Broadcast Card ─────────────────────

# ── PAGASA pf.pdf Cache & Parser (for Storms Outside PAR / No cyclone.dat) ───
_PAGASA_PF_PDF_CACHE = {
    'hash': None,
    'records': []
}

def parse_pagasa_pf_pdf_records(pdf_bytes):
    """
    Parses pf.pdf into a list of structured records for all tropical cyclones
    reported under TROPICAL CYCLONE OUTSIDE PAR or in the SYNOPSIS.
    Accurately separates multi-column tables (e.g. 2 cyclones reported side-by-side)
    so each cyclone retains its own coordinates, winds, category, and name.
    """
    if not _OCR_AVAILABLE:
        return []
    ocr = get_ocr_instance()
    if not ocr:
        return []

    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype='pdf')
        page = doc[0]
        rect = page.rect
        # Clip from top of page through Tropical Cyclone section (first 520 points)
        clip = pymupdf.Rect(0, 0, rect.width, min(rect.height, 520))
        pix = page.get_pixmap(dpi=120, clip=clip)
        res, _ = ocr(pix.tobytes('png'))
        if not res:
            return []
    except Exception as e:
        print(f"Notice: Failed to process pf.pdf with OCR: {e}")
        return []

    # 1. Identify items inside the Tropical Cyclone Outside PAR table and Synopsis
    tc_items = []
    synopsis_items = []
    state = 'BEFORE'
    for item in res:
        txt = item[1].strip()
        txt_u = txt.upper()
        box = item[0]
        cx = sum(p[0] for p in box) / 4.0
        cy = sum(p[1] for p in box) / 4.0

        if 'TROPICAL' in txt_u and 'OUTSIDE' in txt_u and 'PAR' in txt_u:
            state = 'TC_TABLE'
            continue
        if 'FORECAST' in txt_u and 'WEATHER' in txt_u and 'CONDITION' in txt_u:
            state = 'AFTER'
            break

        if state == 'BEFORE':
            synopsis_items.append((cx, cy, txt))
        elif state == 'TC_TABLE':
            tc_items.append((cx, cy, txt))

    # 2. Check if TC table has columns (e.g. 2 columns separated around mid_x)
    mid_x = pix.width / 2.0
    has_left = any(it[0] < mid_x - 30 for it in tc_items)
    has_right = any(it[0] > mid_x + 30 for it in tc_items)

    columns = []
    if has_left and has_right:
        # Two columns!
        left_items = sorted([it for it in tc_items if it[0] < mid_x], key=lambda x: x[1])
        right_items = sorted([it for it in tc_items if it[0] >= mid_x], key=lambda x: x[1])
        columns.append('\n'.join(it[2] for it in left_items))
        columns.append('\n'.join(it[2] for it in right_items))
    elif tc_items:
        # Single column
        all_items = sorted(tc_items, key=lambda x: x[1])
        columns.append('\n'.join(it[2] for it in all_items))

    records = []
    for col_text in columns:
        if not col_text.strip():
            continue

        # Extract winds
        m_wind = re.search(r'(?:MAXIMUM\s*SUSTAINED\s*)?WINDS?\s*:\s*(\d+)\s*K\s*M\s*/?\s*H', col_text, re.IGNORECASE)
        kmh = int(m_wind.group(1)) if m_wind else None

        # Fallback to gustiness or category defaults if sustained wind line was missed
        if kmh is None:
            m_gust = re.search(r'GUSTINESS\s*:\s*(?:UP\s*TO\s*)?(\d+)\s*K\s*M\s*/?\s*H', col_text, re.IGNORECASE)
            if m_gust:
                g_val = int(m_gust.group(1))
                kmh = int(round(g_val / 1.3 / 5.0) * 5)
            elif 'TROPICAL DEPRESSION' in col_text.upper():
                kmh = 45
            elif 'TROPICAL STORM' in col_text.upper():
                kmh = 65
            elif 'TYPHOON' in col_text.upper():
                kmh = 120

        kt = kmh_to_knots(kmh) if kmh is not None else None

        # Extract coordinates: (lat°N, lon°E), allowing unicode degree symbol or OCR replacement chars
        pos_m = re.findall(r'\((\d+\.?\d*)\s*[^A-Z0-9\s]?\s*[NS][,.\s]+(\d+\.?\d*)\s*[^A-Z0-9\s]?\s*[EW]\)', col_text)
        coords = [(float(p[0]), float(p[1])) for p in pos_m]

        # Extract category and name
        m_cat = re.search(r'(SUPER\s*TYPHOON|TYPHOON|SEVERE\s*TROPICAL\s*STORM|TROPICAL\s*STORM|TROPICAL\s*DEPRESSION)', col_text, re.IGNORECASE)
        category = ''
        if m_cat:
            raw_c = m_cat.group(1).upper()
            if 'SUPER' in raw_c and 'TYPHOON' in raw_c:
                category = 'SUPER TYPHOON'
            elif 'TYPHOON' in raw_c:
                category = 'TYPHOON'
            elif 'SEVERE' in raw_c:
                category = 'SEVERE TROPICAL STORM'
            elif 'STORM' in raw_c:
                category = 'TROPICAL STORM'
            elif 'DEPRESSION' in raw_c:
                category = 'TROPICAL DEPRESSION'
            else:
                category = re.sub(r'\s+', ' ', raw_c).strip()
        name = ''
        if m_cat:
            after_cat = col_text[m_cat.end():].strip().splitlines()[0]
            m_name = re.search(r'([A-Za-z0-9_-]+)', after_cat)
            if m_name and m_name.group(1).upper() not in ['LOCATION', 'MAXIMUM', 'WINDS', 'GUSTINESS', 'MOVEMENT']:
                name = m_name.group(1).upper()

        records.append({
            'text': col_text,
            'category': category,
            'name': name,
            'coords': coords,
            'wind_kmh': kmh,
            'wind_kt': kt
        })

    # Also check if an LPA is described in the synopsis
    syn_text = '\n'.join(it[2] for it in sorted(synopsis_items, key=lambda x: x[1]))
    if 'LOW PRESSURE AREA' in syn_text.upper() or 'LPA' in syn_text.upper():
        pos_m = re.findall(r'\((\d+\.?\d*)\s*[°]?\s*[NS][,.\s]+(\d+\.?\d*)\s*[°]?\s*[EW]\)', syn_text)
        coords = [(float(p[0]), float(p[1])) for p in pos_m]
        if coords:
            records.append({
                'text': syn_text,
                'category': 'LOW PRESSURE AREA',
                'name': 'LPA',
                'coords': coords,
                'wind_kmh': 30,
                'wind_kt': 15
            })

    return records

def fetch_pagasa_pf_pdf(storm_data, data_dir='public/data'):
    """
    Fetches and parses PAGASA's official 24-Hour Public Weather Forecast PDF (pf.pdf)
    when a storm is outside PAR or does not have an active bulletin in cyclone.dat.
    Supports multi-storm PDF tables with 2+ columns (e.g. Typhoon + Tropical Depression).
    """
    if not storm_data or not _OCR_AVAILABLE:
        return None

    url_pdf = "https://pubfiles.pagasa.dost.gov.ph/tamss/weather/pf.pdf"
    local_pdf = os.path.join(data_dir, "pf.pdf")
    pdf_bytes = None

    # 1. Attempt live download first
    try:
        r = _HTTP_SESSION.get(url_pdf, headers={'User-Agent': 'Mozilla/5.0'}, timeout=5.0)
        if r.status_code == 200 and len(r.content) > 1000:
            pdf_bytes = r.content
            os.makedirs(data_dir, exist_ok=True)
            with open(local_pdf, 'wb') as f:
                f.write(pdf_bytes)
    except Exception:
        pass

    # 2. Fallback to local cache if live fetch failed
    if not pdf_bytes and os.path.exists(local_pdf):
        try:
            with open(local_pdf, 'rb') as f:
                pdf_bytes = f.read()
        except Exception:
            pass

    if not pdf_bytes:
        return None

    # 3. Check memory cache by MD5 hash to avoid repeating OCR across frames
    pdf_hash = hashlib.md5(pdf_bytes).hexdigest()
    if _PAGASA_PF_PDF_CACHE.get('hash') == pdf_hash:
        records = _PAGASA_PF_PDF_CACHE.get('records', [])
    else:
        records = parse_pagasa_pf_pdf_records(pdf_bytes)
        _PAGASA_PF_PDF_CACHE['hash'] = pdf_hash
        _PAGASA_PF_PDF_CACHE['records'] = records

    if not records:
        return None

    raw_name = str(storm_data.get('storm_name', '')).strip().upper()
    pagasa_name = str(storm_data.get('pagasa_name', '')).strip().upper()
    curr_lat = float(storm_data.get('lat', 0.0))
    curr_lon = float(storm_data.get('lon', 0.0))

    # 4. Find the best matching record for this target storm
    best_record = None
    best_score = 0.0

    for r in records:
        score = 0.0

        # Exact name match (if not generic INVEST/UNKNOWN)
        if raw_name and raw_name not in ['INVEST', 'UNKNOWN', 'CUSTOM'] and len(raw_name) >= 3:
            if raw_name in r['text'].upper():
                score = max(score, 100.0)
        if pagasa_name and len(pagasa_name) >= 3:
            if pagasa_name in r['text'].upper():
                score = max(score, 100.0)

        # Coordinate proximity match
        if curr_lat and curr_lon:
            for plat, plon in r['coords']:
                dist = math.sqrt((plat - curr_lat)**2 + (plon - curr_lon)**2) * 111.0
                if dist <= 600.0:
                    prox_score = max(0.0, 95.0 - (dist / 10.0))
                    score = max(score, prox_score)

        if score > best_score and score >= 40.0:
            best_score = score
            best_record = r

    if not best_record or not best_record.get('wind_kmh'):
        return None

    return {
        'wind_kmh': best_record['wind_kmh'],
        'wind_kt': best_record['wind_kt'],
        'category': best_record.get('category'),
        'standard': '10-MIN SUSTAINED',
        'status': 'ACTIVE',
        'source': 'pf.pdf'
    }

def get_agency_category(agency, wind_kt=None, wind_kmh=None, explicit_cat=None, storm_name=None):
    """
    Returns the official tropical cyclone intensity category for each agency:
    - JTWC: Category 1-5 Typhoon, Super Typhoon, Tropical Storm, Tropical Depression, Low Pressure Area
    - JMA: Typhoon, Severe Tropical Storm, Tropical Storm, Tropical Depression, Low Pressure Area
    - PAGASA: Super Typhoon, Typhoon, Severe Tropical Storm, Tropical Storm, Tropical Depression, Low Pressure Area
    """
    if wind_kmh is None and wind_kt is None and not explicit_cat:
        return None

    agency = (agency or '').upper()
    name_u = (storm_name or '').upper()
    is_invest = ('INVEST' in name_u or (name_u.startswith('9') and len(name_u) <= 3))

    # Compute from wind
    kt = wind_kt if wind_kt is not None else (kmh_to_knots(wind_kmh) if wind_kmh else 0)
    kmh = wind_kmh if wind_kmh is not None else (knots_to_kmh(wind_kt) if wind_kt else 0)

    # 45 km/h or lower (or < 25 kt) is classified as a Low Pressure Area (LPA / Disturbance / Invest)
    is_lpa = (kmh <= 45 or kt < 25)

    if explicit_cat:
        c = explicit_cat.strip().upper()
        if 'SUPER' in c and 'TYPHOON' in c:
            return 'SUPER TYPHOON'
        elif 'TYPHOON' in c:
            return 'TYPHOON'
        elif 'SEVERE' in c:
            return 'SEVERE TROPICAL STORM'
        elif 'STORM' in c:
            return 'TROPICAL STORM'
        elif 'DEPRESSION' in c:
            if is_lpa:
                return 'LOW PRESSURE AREA'
            return 'TROPICAL DEPRESSION'
        elif 'LOW PRESSURE' in c or 'LPA' in c or 'INVEST' in c or 'DISTURBANCE' in c:
            return 'LOW PRESSURE AREA'

    if agency == 'PAGASA':
        if kmh >= 185:
            return 'SUPER TYPHOON'
        elif kmh >= 118:
            return 'TYPHOON'
        elif kmh >= 89:
            return 'SEVERE TROPICAL STORM'
        elif kmh >= 62:
            return 'TROPICAL STORM'
        elif kmh > 45:
            return 'TROPICAL DEPRESSION'
        else:
            return 'LOW PRESSURE AREA'

    elif agency == 'JMA':
        if kt >= 64:
            return 'TYPHOON'
        elif kt >= 48:
            return 'SEVERE TROPICAL STORM'
        elif kt >= 34:
            return 'TROPICAL STORM'
        elif not is_lpa:
            return 'TROPICAL DEPRESSION'
        else:
            return 'LOW PRESSURE AREA'

    elif agency == 'JTWC':
        if kt >= 137:
            return 'CATEGORY 5 TYPHOON'
        elif kt >= 130:
            return 'SUPER TYPHOON'
        elif kt >= 113:
            return 'CATEGORY 4 TYPHOON'
        elif kt >= 96:
            return 'CATEGORY 3 TYPHOON'
        elif kt >= 83:
            return 'CATEGORY 2 TYPHOON'
        elif kt >= 64:
            return 'CATEGORY 1 TYPHOON'
        elif kt >= 34:
            return 'TROPICAL STORM'
        elif not is_lpa:
            return 'TROPICAL DEPRESSION'
        else:
            return 'LOW PRESSURE AREA'

    return 'LOW PRESSURE AREA' if is_lpa else 'TROPICAL DEPRESSION'

def fetch_agency_storm_winds(storm_data, data_dir='public/data'):
    """
    Fetches real-time operational storm wind estimates for the 3 official agencies:
    - JTWC (Joint Typhoon Warning Center): 1-minute sustained winds (kt & km/h) + category
    - JMA (Japan Meteorological Agency): 10-minute sustained winds (kt & km/h) + category
    - PAGASA (DOST-PAGASA): 10-minute sustained winds (kt & km/h) + category
    
    If an agency does not have an active bulletin or data, its status is set to 'N/A'.
    """
    if not storm_data:
        return {
            'JTWC': {'wind_kt': None, 'wind_kmh': None, 'category': None, 'status': 'N/A', 'note': 'NO BULLETIN', 'standard': '1-MIN SUSTAINED'},
            'JMA': {'wind_kt': None, 'wind_kmh': None, 'category': None, 'status': 'N/A', 'note': 'NO BULLETIN', 'standard': '10-MIN SUSTAINED'},
            'PAGASA': {'wind_kt': None, 'wind_kmh': None, 'category': None, 'status': 'N/A', 'note': 'NO BULLETIN', 'standard': '10-MIN SUSTAINED'}
        }

    raw_id = str(storm_data.get('atcf_id', '')).replace('.', '').upper()
    m_id = re.search(r'(\d{2})', raw_id)
    num_str = m_id.group(1) if m_id else ''
    now_year = datetime.datetime.now(datetime.timezone.utc).year
    year_short = str(now_year)[-2:]

    curr_lat = float(storm_data.get('lat', 0.0))
    curr_lon = float(storm_data.get('lon', 0.0))
    raw_name = str(storm_data.get('storm_name', '')).strip().upper()
    short_id = f"{num_str}W" if num_str else raw_id
    pagasa_name = str(storm_data.get('pagasa_name') or PAGASA_STORM_MAP_2026.get(short_id) or PAGASA_STORM_MAP_2026.get(raw_name) or '').upper()

    agency_results = {
        'JTWC': {'wind_kt': None, 'wind_kmh': None, 'category': None, 'status': 'N/A', 'note': 'NO BULLETIN', 'standard': '1-MIN SUSTAINED'},
        'JMA': {'wind_kt': None, 'wind_kmh': None, 'category': None, 'status': 'N/A', 'note': 'NO BULLETIN', 'standard': '10-MIN SUSTAINED'},
        'PAGASA': {'wind_kt': None, 'wind_kmh': None, 'category': None, 'status': 'N/A', 'note': 'NO BULLETIN', 'standard': '10-MIN SUSTAINED'}
    }

    # ── 1. JTWC Official Track / Advisory ────────────────────────────────────
    jtwc_kt = None
    if num_str:
        local_tcw = os.path.join(data_dir, f"jtwc_wp{num_str}{year_short}.tcw")
        tcw_content = ""
        urls = [
            f"https://www.metoc.navy.mil/jtwc/products/wp{num_str}{year_short}.tcw",
            f"https://www.metoc.navy.mil/jtwc/products/wp{num_str}{year_short}web.txt"
        ]
        # Attempt live download first
        for u in urls:
            try:
                r = _HTTP_SESSION.get(u, headers={'User-Agent': 'Mozilla/5.0'}, timeout=3.5)
                if r.status_code == 200 and len(r.text) > 100:
                    tcw_content = r.text
                    os.makedirs(data_dir, exist_ok=True)
                    with open(local_tcw, 'w', encoding='utf-8') as f:
                        f.write(tcw_content)
                    break
            except Exception:
                pass

        # Fallback to local cache if live fetch failed
        if not tcw_content.strip() and os.path.exists(local_tcw):
            try:
                with open(local_tcw, 'r', encoding='utf-8') as f:
                    tcw_content = f.read()
            except Exception:
                pass

        if tcw_content and "FINAL WARNING" not in tcw_content.upper():
            m_t0 = re.search(r'T000\s+\d+[NS]\s+\d+[EW]\s+(\d+)', tcw_content)
            if m_t0:
                jtwc_kt = int(m_t0.group(1))
            else:
                m_mw = re.search(r'MAX\s+SUSTAINED\s+WINDS\s*-\s*(\d+)\s*KT', tcw_content, re.IGNORECASE)
                if m_mw:
                    jtwc_kt = int(m_mw.group(1))

    # Fallback to storm_data if JTWC .tcw not found or not parsed
    if jtwc_kt is None and float(storm_data.get('wind_kt', 0)) > 0:
        jtwc_kt = int(round(float(storm_data['wind_kt'])))

    if jtwc_kt is not None and jtwc_kt > 0:
        kmh = knots_to_kmh(jtwc_kt)
        agency_results['JTWC'] = {
            'wind_kt': jtwc_kt,
            'wind_kmh': kmh,
            'category': get_agency_category('JTWC', wind_kt=jtwc_kt, wind_kmh=kmh, storm_name=raw_name),
            'status': 'ACTIVE',
            'standard': '1-MIN SUSTAINED'
        }

    # ── 2. JMA Official Track / Advisory ─────────────────────────────────────
    jma_kt = None
    for i in range(60, 66):
        local_jma = os.path.join(data_dir, f"jma_vptw60_{i}.json")
        jma_json_str = ""

        # Attempt live fetch first to always use fresh observation data
        url = f"https://www.data.jma.go.jp/multi/data/VPTW60/{i}_en.json"
        try:
            r = _HTTP_SESSION.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=3.0)
            if r.status_code == 200 and len(r.text) > 50:
                jma_json_str = r.text
                os.makedirs(data_dir, exist_ok=True)
                with open(local_jma, 'w', encoding='utf-8') as f:
                    f.write(jma_json_str)
        except Exception:
            pass

        # Fallback to local cache if live query failed
        if not jma_json_str.strip() and os.path.exists(local_jma):
            try:
                with open(local_jma, 'r', encoding='utf-8') as f:
                    jma_json_str = f.read()
            except Exception:
                pass

        if not jma_json_str.strip():
            continue

        try:
            d = json.loads(jma_json_str)
            remark = str(d.get('remark', '')).strip()
            if any(k in remark for k in ['消滅', '低気圧化', '台風消滅', '温帯低気圧']):
                continue

            # Check bulletin age to skip old archived products (>24 hours)
            target_dt_str = d.get('targetDateTime', '') or d.get('reportDateTime', '')
            if target_dt_str:
                try:
                    tdt = datetime.datetime.strptime(target_dt_str, "%Y/%m/%d %H:%M").replace(tzinfo=datetime.timezone.utc)
                    age_hours = (datetime.datetime.now(datetime.timezone.utc) - tdt).total_seconds() / 3600.0
                    if age_hours > 24.0:
                        continue
                except Exception:
                    pass

            jma_name = str(d.get('name', '')).upper()
            infos = d.get('meteorologicalInfos', [])
            if not infos:
                continue

            first_c = infos[0].get('centerPart', {})
            c_lat = parse_jma_latlon(first_c.get('coordinateLat') or (first_c.get('probabilityCircle', {}) or {}).get('basePointLat'))
            c_lon = parse_jma_latlon(first_c.get('coordinateLon') or (first_c.get('probabilityCircle', {}) or {}).get('basePointLon'))

            is_match = False
            if raw_name and not is_placeholder_storm_name(raw_name) and (raw_name in jma_name or jma_name in raw_name):
                is_match = True
            elif not math.isnan(c_lat) and not math.isnan(c_lon) and curr_lat and curr_lon:
                dist_km = math.sqrt((c_lat - curr_lat)**2 + (c_lon - curr_lon)**2) * 111.0
                if dist_km <= 650.0:
                    is_match = True

            if is_match:
                if jma_name and not is_placeholder_storm_name(jma_name):
                    if is_placeholder_storm_name(storm_data.get('storm_name')):
                        storm_data['storm_name'] = jma_name
                        storm_data['international_name'] = jma_name
                w_part = infos[0].get('windPart', {})
                w_kt_str = w_part.get('windSpeedKnot')
                if w_kt_str:
                    jma_kt = int(round(float(w_kt_str)))
                    break
        except Exception:
            continue

    if jma_kt is not None and jma_kt > 0:
        kmh = knots_to_kmh(jma_kt)
        agency_results['JMA'] = {
            'wind_kt': jma_kt,
            'wind_kmh': kmh,
            'category': get_agency_category('JMA', wind_kt=jma_kt, wind_kmh=kmh, storm_name=raw_name),
            'status': 'ACTIVE',
            'standard': '10-MIN SUSTAINED'
        }

    # ── 3. PAGASA Official Bulletin ──────────────────────────────────────────
    pagasa_kt = None
    pagasa_kmh = None

    # 3A. STRICTLY LOOK cyclone.dat FIRST ALWAYS
    local_pag = os.path.join(data_dir, "cyclone.dat")
    pag_content = ""

    # Attempt live download first
    url_cyclone = "https://pubfiles.pagasa.dost.gov.ph/tamss/weather/cyclone.dat"
    try:
        r = _HTTP_SESSION.get(url_cyclone, headers={'User-Agent': 'Mozilla/5.0'}, timeout=3.5)
        if r.status_code == 200 and len(r.text) > 30:
            pag_content = r.text
            os.makedirs(data_dir, exist_ok=True)
            with open(local_pag, 'w', encoding='utf-8') as f:
                f.write(pag_content)
    except Exception:
        pass

    # Fallback to local cache if live fetch failed
    if not pag_content.strip() and os.path.exists(local_pag):
        try:
            with open(local_pag, 'r', encoding='utf-8') as f:
                pag_content = f.read()
        except Exception:
            pass

    if pag_content.strip():
        lines = pag_content.strip().splitlines()
        first_line = lines[0] if lines else ""
        m_p = re.search(r'^([A-Za-z0-9_-]+)\{', first_line)
        matched_p_name = m_p.group(1).upper() if m_p else ""

        is_p_match = False
        if matched_p_name and (matched_p_name == raw_name or matched_p_name == pagasa_name):
            is_p_match = True

        pts = []
        for l in lines[1:]:
            parts = [p.strip() for p in l.split(',')]
            if len(parts) >= 5:
                try:
                    cat = parts[0]
                    dt = datetime.datetime.strptime(f"{parts[1]} {parts[2]}", "%Y-%m-%d %H:%M")
                    la, lo = float(parts[3]), float(parts[4])
                    rad = float(parts[5]) if len(parts) >= 6 and parts[5] else 0.0
                    pts.append({'cat': cat, 'dt': dt, 'lat': la, 'lon': lo, 'rad': rad})
                except Exception:
                    pass

        if pts:
            t_last = pts[-1]['dt']
            age_hours = (datetime.datetime.now() - t_last).total_seconds() / 3600.0
            if age_hours <= 24.0:
                dist_km = math.sqrt((pts[0]['lat'] - curr_lat)**2 + (pts[0]['lon'] - curr_lon)**2) * 111.0 if (curr_lat and curr_lon) else 9999.0
                if is_p_match or dist_km <= 400.0:
                    cat = pts[0]['cat']
                    cat_map = {
                        'TD': (30, 55),
                        'TS': (45, 85),
                        'STS': (55, 100),
                        'TY': (75, 140),
                        'STY': (105, 195)
                    }
                    if cat in cat_map:
                        pagasa_kt, pagasa_kmh = cat_map[cat]

    if pagasa_kt is not None:
        # cyclone.dat had active data for this storm -> USE IT AND FINISH!
        pag_cat_map = {
            'TD': 'TROPICAL DEPRESSION',
            'TS': 'TROPICAL STORM',
            'STS': 'SEVERE TROPICAL STORM',
            'TY': 'TYPHOON',
            'STY': 'SUPER TYPHOON'
        }
        pag_cat = pag_cat_map.get(cat) or get_agency_category('PAGASA', wind_kt=pagasa_kt, wind_kmh=pagasa_kmh, storm_name=raw_name)
        agency_results['PAGASA'] = {
            'wind_kt': pagasa_kt,
            'wind_kmh': pagasa_kmh,
            'category': pag_cat,
            'status': 'ACTIVE',
            'standard': '10-MIN SUSTAINED',
            'source': 'cyclone.dat'
        }
        return agency_results

    # 3B. IF NO cyclone.dat DATA FOR THIS STORM, USE pf.pdf
    pf_res = fetch_pagasa_pf_pdf(storm_data, data_dir=data_dir)
    if pf_res and pf_res.get('wind_kmh'):
        pag_cat = get_agency_category('PAGASA', wind_kt=pf_res.get('wind_kt'), wind_kmh=pf_res.get('wind_kmh'), explicit_cat=pf_res.get('category'), storm_name=raw_name)
        agency_results['PAGASA'] = {
            'wind_kt': pf_res.get('wind_kt'),
            'wind_kmh': pf_res.get('wind_kmh'),
            'category': pag_cat,
            'status': 'ACTIVE',
            'standard': '10-MIN SUSTAINED',
            'source': 'pf.pdf'
        }
    return agency_results

def draw_agency_wind_card(img, agency_data=None, storm_data=None):
    """
    Draws a TV broadcast comparison card at the bottom of the satellite map,
    comparing storm maximum winds and official categories across JTWC, JMA, and PAGASA.
    Matches the Fox Weather broadcast widget styling with enhanced hierarchy, line spacing, & contrast.
    """
    if agency_data is None:
        agency_data = fetch_agency_storm_winds(storm_data)

    w, h = img.size
    draw = ImageDraw.Draw(img)
    scale = w / 1200.0

    # Dimensions & placement at bottom center - tight & compact without excessive bottom space
    card_w = int(550 * scale)
    card_h = int(154 * scale)
    card_x = int((w - card_w) / 2)
    card_y = int(h - card_h - (22 * scale))

    radius = max(8, int(13 * scale))
    border_w = max(1, int(2 * scale))

    # 1. Outer White Card Container
    draw.rounded_rectangle(
        [card_x, card_y, card_x + card_w, card_y + card_h],
        radius=radius,
        fill=(255, 255, 255),
        outline=(203, 213, 225),  # #cbd5e1 Slate-300
        width=border_w
    )

    # 2. Dark Navy Header Pill
    pill_margin_x = int(9 * scale)
    pill_margin_y = int(7 * scale)
    pill_h = int(28 * scale)
    pill_x1 = card_x + pill_margin_x
    pill_y1 = card_y + pill_margin_y
    pill_x2 = card_x + card_w - pill_margin_x
    pill_y2 = pill_y1 + pill_h
    pill_radius = max(4, int(6 * scale))

    draw.rounded_rectangle(
        [pill_x1, pill_y1, pill_x2, pill_y2],
        radius=pill_radius,
        fill=(13, 35, 66),  # #0d2342 Dark Navy
        outline=None
    )

    # Fonts
    try:
        font_pill = ImageFont.truetype("arialbd.ttf", max(10, int(12.5 * scale)))
        font_agency = ImageFont.truetype("arialbd.ttf", max(12, int(16.5 * scale)))
        font_cat = ImageFont.truetype("arialbd.ttf", max(8, int(10.5 * scale)))
        font_wind_large = ImageFont.truetype("arialbd.ttf", max(18, int(25.0 * scale)))
        font_wind_na = ImageFont.truetype("arialbd.ttf", max(18, int(25.0 * scale)))
        font_metric = ImageFont.truetype("arialbd.ttf", max(9, int(12.5 * scale)))
        font_sub = ImageFont.truetype("arialbd.ttf", max(8, int(11.0 * scale)))
        font_na_sub = ImageFont.truetype("arialbd.ttf", max(9, int(12.0 * scale)))
    except Exception:
        font_pill = ImageFont.load_default()
        font_agency = font_pill
        font_cat = font_pill
        font_wind_large = font_pill
        font_wind_na = font_pill
        font_metric = font_pill
        font_sub = font_pill
        font_na_sub = font_pill

    # Header Pill Title
    pill_title = "OFFICIAL AGENCY MAXIMUM WINDS"
    pb = draw.textbbox((0, 0), pill_title, font=font_pill)
    pw, ph = pb[2] - pb[0], pb[3] - pb[1]
    draw.text(
        (pill_x1 + (pill_x2 - pill_x1 - pw) / 2, pill_y1 + (pill_h - ph) / 2 - 1),
        pill_title,
        fill=(255, 255, 255),
        font=font_pill
    )

    # 3. Three Equal Columns
    body_y1 = pill_y2 + int(5 * scale)
    col_w = (card_w - (pill_margin_x * 2)) / 3.0

    agencies = [
        ('JTWC', agency_data.get('JTWC', {}), (190, 18, 60)),     # #be123c Rich Crimson
        ('JMA', agency_data.get('JMA', {}), (4, 120, 87)),        # #047857 Deep Forest Emerald
        ('PAGASA', agency_data.get('PAGASA', {}), (3, 105, 161))  # #0369a1 Deep Ocean Sapphire
    ]

    # Vertical dividers between columns
    div_y1 = body_y1 + int(3 * scale)
    div_y2 = card_y + card_h - int(8 * scale)
    for i in [1, 2]:
        div_x = card_x + pill_margin_x + int(i * col_w)
        draw.line([(div_x, div_y1), (div_x, div_y2)], fill=(203, 213, 225), width=max(1, int(1.2 * scale)))

    # Synchronized row coordinates for clean horizontal alignment
    agency_y = body_y1 + int(2 * scale)
    cat_y = agency_y + int(19 * scale)
    val_y = cat_y + int(16 * scale)
    metric_y = val_y + int(31 * scale)
    standard_y = metric_y + int(16 * scale)

    # Render each agency column
    for i, (name, data, color) in enumerate(agencies):
        c_x1 = card_x + pill_margin_x + (i * col_w)
        c_x2 = c_x1 + col_w
        c_mid = (c_x1 + c_x2) / 2.0

        # Row 1: Agency Label (Prominent, colored)
        ab = draw.textbbox((0, 0), name, font=font_agency)
        aw = ab[2] - ab[0]
        draw.text((c_mid - aw / 2.0, agency_y), name, fill=color, font=font_agency)

        wind_kt = data.get('wind_kt')
        wind_kmh = data.get('wind_kmh')

        if wind_kmh is not None and wind_kmh > 0:
            # Row 2: Official Category
            cat_str = get_agency_category(name, wind_kt=wind_kt, wind_kmh=wind_kmh, explicit_cat=data.get('category'), storm_name=storm_data.get('storm_name') if storm_data else None) or data.get('category') or ''
            cb = draw.textbbox((0, 0), cat_str, font=font_cat)
            cw = cb[2] - cb[0]

            # Auto-shrink font if long category string to maintain clean margins
            use_font_cat = font_cat
            if cw > col_w - int(10 * scale):
                try:
                    use_font_cat = ImageFont.truetype("arialbd.ttf", max(7, int(9.0 * scale)))
                    cb = draw.textbbox((0, 0), cat_str, font=use_font_cat)
                    cw = cb[2] - cb[0]
                except Exception:
                    pass
            draw.text((c_mid - cw / 2.0, cat_y), cat_str, fill=(71, 85, 105), font=use_font_cat)

            # Row 3: Dominant KM/H number on TOP
            val_str = f"{int(wind_kmh)} KM/H"
            vb = draw.textbbox((0, 0), val_str, font=font_wind_large)
            vw = vb[2] - vb[0]
            draw.text((c_mid - vw / 2.0, val_y), val_str, fill=(10, 29, 55), font=font_wind_large)

            # Row 4: KT Metric Line below KM/H
            kt_str = f"{int(wind_kt)} KT" if wind_kt is not None else ""
            kb = draw.textbbox((0, 0), kt_str, font=font_metric)
            kw = kb[2] - kb[0]
            draw.text((c_mid - kw / 2.0, metric_y), kt_str, fill=(3, 105, 161), font=font_metric)

            # Row 5: Sustained Standard line
            std_str = data.get('standard', 'SUSTAINED')
            sb = draw.textbbox((0, 0), std_str, font=font_sub)
            sw = sb[2] - sb[0]
            draw.text((c_mid - sw / 2.0, standard_y), std_str, fill=(15, 23, 42), font=font_sub)
        else:
            # Row 3: N/A in muted slate
            val_str = "N/A"
            vb = draw.textbbox((0, 0), val_str, font=font_wind_na)
            vw = vb[2] - vb[0]
            draw.text((c_mid - vw / 2.0, val_y), val_str, fill=(148, 163, 184), font=font_wind_na)

            # Row 4: Clean single note: NO BULLETIN (No OUTSIDE PAR text on JMA or JTWC)
            note_str = "NO BULLETIN"
            nb = draw.textbbox((0, 0), note_str, font=font_na_sub)
            nw = nb[2] - nb[0]
            draw.text((c_mid - nw / 2.0, metric_y + int(3 * scale)), note_str, fill=(71, 85, 105), font=font_na_sub)

    return img

# ── Render a Single Frame (Broadcast Style) ──────────────────────────────────
def render_frame(
    validtime_str,
    extent,
    storm_data=None,
    timeline=None,
    show_track=False,
    sector_info=None,
    figsize=(10.0, 7.5),
    dpi=120,
    zoom_level=5,
    custom_title=None,
    draw_agency_card=False
):
    """
    Renders an Ultra-HD Channel 13 IR Brightness Temperature map:
    - Full-bleed edge-to-edge satellite image (strict 4:3 aspect ratio)
    - Direct PlateCarree Bicubic imshow (bypasses Cartopy 750px regridding)
    - Crisp white coastlines with dark halo casing (boldest)
    - Thinner dashed white Philippine Province Boundaries with dark halo
    - Orange Philippine Area of Responsibility (PAR) line with dark halo
    - Ultra-subtle faint lat/lon coordinate gridlines (faintest)
    - Floating Fox Weather broadcast header
    """
    plt.rcParams['lines.scale_dashes'] = False
    fig = plt.figure(figsize=figsize, dpi=dpi, facecolor='black')

    # Strict aspect ratio fitting
    extent = fit_extent_to_aspect(extent, aspect_ratio=figsize[0] / figsize[1])

    # Full bleed map canvas (edge-to-edge, no black sidebars)
    ax = fig.add_axes([0.0, 0.0, 1.0, 1.0], projection=ccrs.PlateCarree())
    ax.set_extent(extent, crs=ccrs.PlateCarree())

    # 0. Set Canvas Background (Deep navy space/ocean like LagunaWISE)
    ax.set_facecolor('#040d1a')

    # 1. Overlay Ultra-HD Himawari Channel 13 IR with Direct Bicubic imshow (100% Opacity)
    try:
        img_arr, grid_extent = fetch_composite_b13(validtime_str, extent, zoom=zoom_level, session=_HTTP_SESSION)
        ax.imshow(
            img_arr,
            origin='upper',
            extent=[grid_extent[0], grid_extent[1], grid_extent[2], grid_extent[3]],
            transform=ccrs.PlateCarree(),
            interpolation='bicubic',
            zorder=1
        )
    except Exception:
        pass

    # 2. Lat/Lon Coordinate Gridlines (Faintest: Ultra-subtle dotted lines)
    grid_step = sector_info.get('grid_step', 1.0) if sector_info else 1.0
    gl = ax.gridlines(draw_labels=False, linewidth=0.35, color='#FFFFFF', alpha=0.15, linestyle=':', zorder=2)
    gl.xlocator = mticker.MultipleLocator(grid_step)
    gl.ylocator = mticker.MultipleLocator(grid_step)

    # 3. Coastlines (Boldest: Crisp White with Dark Halo Casing)
    ax.add_feature(cfeature.COASTLINE, linewidth=3.0, edgecolor='#000000', alpha=0.85, zorder=3)
    ax.add_feature(cfeature.COASTLINE, linewidth=1.6, edgecolor='#FFFFFF', alpha=1.0, zorder=4)

    # 4. International Borders (Medium: Aligned Ice-White Dashed with Dark Halo)
    ax.add_feature(cfeature.BORDERS, linewidth=2.2, edgecolor='#000000', linestyle=DASH, alpha=0.45, zorder=3)
    ax.add_feature(cfeature.BORDERS, linewidth=0.9, edgecolor='#E8F4FF', linestyle=DASH, alpha=0.90, zorder=4)

    # 5. High-Resolution Deduplicated Philippine Province Boundaries (Aligned DASH, no duplicate edges)
    prov_geoms = load_philippine_province_geometries()
    if prov_geoms:
        # Casing with matching explicit DASH pattern
        ax.add_geometries(
            prov_geoms,
            crs=ccrs.PlateCarree(),
            facecolor='none',
            edgecolor='#000000',
            linewidth=2.6,
            linestyle=DASH,
            alpha=0.45,
            zorder=3
        )
        # Ice-white 1.0px line with matching explicit DASH pattern
        ax.add_geometries(
            prov_geoms,
            crs=ccrs.PlateCarree(),
            facecolor='none',
            edgecolor='#E8F4FF',
            linewidth=1.0,
            linestyle=DASH,
            alpha=1.0,
            zorder=4
        )

    # 6. Philippine Area of Responsibility (PAR) Boundary
    # Displayed for full Philippines overview and storm tracks; omitted on regional sectors to avoid stray bottom lines
    is_regional = sector_info and sector_info.get('key') in ['northern_luzon', 'southern_luzon', 'visayas', 'mindanao', 'luzon']
    if not is_regional:
        par_lons = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
        par_lats = [ 5.0,  15.0,  21.0,  25.0,  25.0,   5.0,   5.0]
        ax.plot(
            par_lons, par_lats, color='#000000', linewidth=3.0, linestyle='-',
            alpha=0.60, transform=ccrs.PlateCarree(), zorder=5
        )
        ax.plot(
            par_lons, par_lats, color='#FF6B35', linewidth=1.7, linestyle='-',
            alpha=0.95, transform=ccrs.PlateCarree(), zorder=6, label='PAR Boundary'
        )

    # 6. Storm Past Track Overlay with Numbered Circular Nodes (0, 6, 12, 18h)
    try:
        dt_utc = datetime.datetime.strptime(validtime_str, "%Y%m%d%H%M%S").replace(tzinfo=datetime.timezone.utc)
    except Exception:
        dt_utc = datetime.datetime.now(datetime.timezone.utc)

    if show_track and timeline and len(timeline) > 1:
        track_nodes = get_past_track_nodes(timeline, dt_utc, max_hours_back=18)
        if len(track_nodes) >= 2:
            lons = [n['lon'] for n in track_nodes]
            lats = [n['lat'] for n in track_nodes]

            ax.plot(
                lons, lats,
                color='#ff1a1a',
                linewidth=2.2,
                linestyle='--',
                alpha=0.95,
                transform=ccrs.PlateCarree(),
                zorder=15
            )

            for n in track_nodes:
                ax.plot(
                    n['lon'], n['lat'],
                    marker='o',
                    markersize=13,
                    markerfacecolor='#e60000',
                    markeredgecolor='#ffffff',
                    markeredgewidth=1.3,
                    transform=ccrs.PlateCarree(),
                    zorder=16
                )
                ax.text(
                    n['lon'], n['lat'],
                    str(n['hours_ago']),
                    color='white',
                    fontsize=8.0,
                    fontweight='heavy',
                    ha='center',
                    va='center',
                    transform=ccrs.PlateCarree(),
                    zorder=17
                )

    # Render figure to PIL Image
    fig.canvas.draw()
    rgba_buffer = fig.canvas.buffer_rgba()
    img = Image.frombuffer('RGBA', fig.canvas.get_width_height(), rgba_buffer, 'raw', 'RGBA', 0, 1).convert('RGB')
    plt.close(fig)

    # 7. Composite Fox Weather broadcast header
    sector_title = sector_info.get('title') if sector_info else None
    img = draw_fox_weather_header(
        img,
        dt_utc=dt_utc,
        storm_data=storm_data,
        custom_title=custom_title,
        sector_title=sector_title
    )

    # 8. Composite Official Agency Wind Comparison Card (for storm targets)
    if draw_agency_card and storm_data:
        agency_winds = fetch_agency_storm_winds(storm_data)
        img = draw_agency_wind_card(img, agency_data=agency_winds, storm_data=storm_data)

    return img

# ── Fetch Active Storms ───────────────────────────────────────────────────────
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
                        raw_name = str(item.get("storm_name", "UNKNOWN")).strip().upper()
                        st = {
                            "atcf_id": atcf_id,
                            "storm_name": raw_name,
                            "lat": float(item.get("latitude", 0.0)),
                            "lon": float(item.get("longitude", 0.0)),
                            "wind_kt": float(item.get("winds") or 0.0),
                            "pressure_hpa": float(item.get("pressure") or 1008.0),
                            "analysis_time": item.get("analysis_time", "Latest"),
                            "source": "JTWC"
                        }
                        if is_placeholder_storm_name(raw_name):
                            jma_name = find_jma_international_name(st)
                            if jma_name:
                                st["storm_name"] = jma_name
                                st["international_name"] = jma_name
                                st["atcf_name"] = raw_name
                        storms.append(st)
    except Exception as e:
        print(f"Notice: Failed to fetch ATCF storms: {e}")
    return storms

def load_storm_from_local_positions(target_str):
    t_clean = re.sub(r'[^a-zA-Z0-9]', '', str(target_str).upper())
    m = re.search(r'(\d{2})', t_clean)
    num_str = m.group(1) if m else ''
    now_year = datetime.datetime.now(datetime.timezone.utc).year
    candidates = [
        f"public/data/tc_positions_{t_clean}.json",
        f"public/data/tc_positions_{t_clean}W.json",
        f"public/data/tc_positions_WP{num_str}{now_year}.json" if num_str else None,
        f"public/data/tc_positions_{num_str}W.json" if num_str else None,
    ]
    for c in filter(None, candidates):
        if os.path.exists(c):
            try:
                with open(c, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                latest = data.get("latest", {})
                st = {
                    "atcf_id": data.get("track_id", t_clean),
                    "long_atcf_id": data.get("track_id", t_clean).lower(),
                    "storm_name": data.get("storm_name", t_clean),
                    "lat": float(latest.get("lat", 15.0)),
                    "lon": float(latest.get("lon", 130.0)),
                    "wind_kt": float(latest.get("wind_kt", 35.0)),
                    "pressure_hpa": float(latest.get("pressure_hpa", 1000.0)),
                    "nature": "TS",
                    "basin": "WPAC",
                    "analysis_time": latest.get("init_time", "Latest"),
                    "source": "JTWC"
                }
                if is_placeholder_storm_name(st["storm_name"]):
                    jma_name = find_jma_international_name(st)
                    if jma_name:
                        st["storm_name"] = jma_name
                        st["international_name"] = jma_name
                return st
            except Exception:
                pass
    return None

# ── Main Generator Pipeline ──────────────────────────────────────────────────
def generate_satellite(
    storm_data=None,
    extent=None,
    sector_key=None,
    output_png=None,
    output_gif=None,
    hours=6.0,
    interval=20,
    fps=8,
    dpi=120,
    make_png=True,
    make_gif=False,
    track_storm=True,
    show_track=False,
    lon_span=26.0,
    draw_agency_card=None
):
    print("=" * 75)
    print("Himawari Band 13 IR Brightness Temperature HD Satellite Generator")
    print("=" * 75)

    targets = get_jma_target_times()
    if not targets:
        print("Error: Could not retrieve JMA observation times.")
        return

    latest_target = targets[-1]["validtime"]

    # Timeline for tracking & track node line
    timeline = get_storm_track_timeline(storm_data) if storm_data else []

    # Determine Sector & Extent
    sector_info = resolve_sector(sector_key) if sector_key else None
    if extent is None:
        if storm_data and track_storm:
            c_lat = float(storm_data.get("lat", 16.5))
            c_lon = float(storm_data.get("lon", 121.0))
            extent = calculate_storm_focus_extent(c_lat, c_lon, lon_span=lon_span)
        elif sector_info:
            extent = sector_info['extent']
        else:
            sector_info = SECTORS['southern_luzon']
            extent = sector_info['extent']

    if sector_info and not storm_data:
        default_fn = sector_info['filename_stem']
    elif storm_data:
        raw_id = str(storm_data.get("atcf_id", "storm")).strip().upper()
        m_id = re.search(r'(\d{2}[A-Z]?)', raw_id)
        short_label = m_id.group(1) if m_id else raw_id
        if short_label and not (short_label.endswith('W') or short_label.endswith('E') or short_label.endswith('C')):
            short_label += 'W'
        default_fn = f"ptcc_{short_label}"
    else:
        default_fn = "ptcc_satellite"

    out_png = output_png or f"{default_fn}_satellite.png"
    out_gif = output_gif or f"{default_fn}_loop.gif"

    # Static Map
    if make_png:
        print(f"Rendering Ultra-HD Static Map for {latest_target}...")
        card_flag = bool(storm_data) if draw_agency_card is None else bool(draw_agency_card)
        img = render_frame(
            latest_target,
            extent=extent,
            storm_data=storm_data,
            timeline=timeline,
            show_track=show_track,
            sector_info=sector_info,
            dpi=dpi,
            draw_agency_card=card_flag
        )
        img.save(out_png, dpi=(dpi, dpi))
        print(f"SUCCESS: Satellite map saved to: {os.path.abspath(out_png)}")

    # Animated Loop
    if make_gif:
        latest_dt = datetime.datetime.strptime(latest_target, "%Y%m%d%H%M%S").replace(tzinfo=datetime.timezone.utc)
        earliest_target = targets[0]["validtime"]
        earliest_dt = datetime.datetime.strptime(earliest_target, "%Y%m%d%H%M%S").replace(tzinfo=datetime.timezone.utc)
        jma_max_hours = (latest_dt - earliest_dt).total_seconds() / 3600.0

        if hours > jma_max_hours:
            print(f"Notice: Requested {hours:.1f}h exceeds JMA archive ({jma_max_hours:.1f}h available). Rendering {jma_max_hours:.1f} hours.")
            start_dt = earliest_dt
        else:
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

        total_frames = len(sampled_targets)
        print(f"Rendering {total_frames} Ultra-HD frames (interval: {interval}m, fps: {fps})...")

        frames = []
        for idx, vt in enumerate(sampled_targets):
            try:
                vt_dt = datetime.datetime.strptime(vt, "%Y%m%d%H%M%S").replace(tzinfo=datetime.timezone.utc)
            except Exception:
                vt_dt = datetime.datetime.now(datetime.timezone.utc)

            if timeline and track_storm and storm_data:
                frame_storm = interpolate_storm_state(timeline, vt_dt, storm_data)
                frame_extent = calculate_storm_focus_extent(frame_storm["lat"], frame_storm["lon"], lon_span=lon_span)
            else:
                frame_storm = storm_data
                frame_extent = extent

            print(f"[{idx+1}/{total_frames}] Rendering frame {vt}...", end="\r", flush=True)
            f_img = render_frame(
                vt,
                extent=frame_extent,
                storm_data=frame_storm,
                timeline=timeline,
                show_track=show_track,
                sector_info=sector_info,
                dpi=dpi
            )
            frames.append(f_img)

        print(f"\nCompiling and saving animated GIF to {out_gif}...")
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
        print(f"SUCCESS: Animated GIF saved to: {os.path.abspath(out_gif)}")

# ── CLI Interface ────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Generate Ultra-HD Himawari Channel 13 IR Brightness Temperature Satellite Maps & Loops")
    parser.add_argument("--storm", type=str, default=None, help="Target specific storm (e.g. 25W, 32W, FUNG-WONG, QUEENIE)")
    parser.add_argument("--target", "--sector", dest="target", type=str, default=None,
                        help="Target sector: northern_luzon, southern_luzon, visayas, mindanao, luzon, philippines")
    parser.add_argument("--northern-luzon", "--north-luzon", "--extreme-northern-luzon", dest="northern_luzon", action="store_true",
                        help="Target Northern & Extreme Northern Luzon Sector")
    parser.add_argument("--southern-luzon", "--south-luzon", "--calabarzon", dest="southern_luzon", action="store_true",
                        help="Target Southern & Central Luzon Sector (CALABARZON, NCR, Mindoro, Bicol)")
    parser.add_argument("--visayas", "--all-visayas", dest="visayas", action="store_true",
                        help="Target All Visayas Sector (Western, Central & Eastern Visayas)")
    parser.add_argument("--mindanao", "--all-mindanao", dest="mindanao", action="store_true",
                        help="Target Mindanao Sector (Davao, Caraga, Northern Mindanao, Zamboanga, BARMM)")
    parser.add_argument("--luzon", action="store_true", default=None, help="Force focus on general Luzon sector")
    parser.add_argument("--philippines", "--par", dest="philippines", action="store_true", help="Focus on full Philippine archipelago & PAR domain")
    parser.add_argument("--all-targets", "--all-sectors", dest="all_targets", action="store_true",
                        help="Render all 4 regional target sectors: Northern Luzon, Southern Luzon, Visayas, and Mindanao")
    parser.add_argument("--png-only", action="store_true", help="Generate only static PNG map (default)")
    parser.add_argument("--gif-only", action="store_true", help="Generate only animated GIF loop")
    parser.add_argument("--gif", action="store_true", help="Generate animated satellite GIF loop")
    parser.add_argument("--both", action="store_true", help="Generate both PNG and GIF")
    parser.add_argument("--hours", type=float, default=6.0, help="Timeframe in hours for GIF (default: 6.0)")
    parser.add_argument("--interval", type=int, default=20, help="Frame step interval in minutes (default: 20)")
    parser.add_argument("--fps", type=int, default=8, help="Frames per second for GIF (default: 8)")
    parser.add_argument("--dpi", type=int, default=120, help="DPI resolution for frames (default: 120)")
    parser.add_argument("--lat", type=float, default=None, help="Custom center latitude")
    parser.add_argument("--lon", type=float, default=None, help="Custom center longitude")
    parser.add_argument("--span", type=float, default=26.0, help="Longitude span in degrees (default: 26.0, matching storm_focused_satellite_gif.py)")
    parser.add_argument("--output", type=str, default=None, help="Custom output filepath")
    parser.add_argument("--fixed-camera", "--no-track", dest="fixed_camera", action="store_true", help="Keep camera fixed instead of tracking storm")
    parser.add_argument("--show-track-line", dest="show_track_line", action="store_true", help="Optionally draw the red dashed past track line and nodes")
    parser.add_argument("--25w", "--25W", dest="storm_25w", action="store_true", help="Target Typhoon 25W (QUEENIE / SURIGAE)")
    parser.add_argument("--26w", "--26W", dest="storm_26w", action="store_true", help="Target Typhoon 26W (CHOI-WAN)")
    parser.add_argument("--32w", "--32W", dest="storm_32w", action="store_true", help="Target Typhoon 32W (UWAN / FUNG-WONG)")
    parser.add_argument("--agency-card", dest="agency_card", action="store_true", default=None, help="Force display of official agency wind comparison card")
    parser.add_argument("--no-agency-card", dest="no_agency_card", action="store_true", help="Disable official agency wind comparison card")
    args, unknown = parser.parse_known_args()

    # Dynamic storm detection from flags like --26W, --25W, --CHOIWAN, etc.
    active_storm_arg = args.storm
    if getattr(args, 'storm_26w', False):
        active_storm_arg = '26W'
    elif getattr(args, 'storm_25w', False):
        active_storm_arg = '25W'
    elif getattr(args, 'storm_32w', False):
        active_storm_arg = '32W'
    elif not active_storm_arg:
        for u in unknown:
            if u.startswith("--") and len(u) > 2:
                cand = u[2:].strip().upper()
                if re.match(r'^(WP)?\d{2}[A-Z]?$', cand) or re.match(r'^(INVEST)?\d{2}[A-Z]?$', cand):
                    active_storm_arg = cand
                    break
                if cand in PAGASA_NAMES_2026 or cand in PAGASA_STORM_MAP_2026:
                    active_storm_arg = cand
                    break
                if os.path.exists(os.path.join("public", "data", f"tc_positions_{cand}.json")) or \
                   os.path.exists(os.path.join("public", "data", f"tc_positions_{cand}W.json")):
                    active_storm_arg = cand
                    break
    args.storm = active_storm_arg

    make_png = not (args.gif_only or args.gif)
    make_gif = args.gif_only or args.gif or args.both

    # Handle --all-targets batch generation
    if args.all_targets:
        targets_list = ['northern_luzon', 'southern_luzon', 'visayas', 'mindanao']
        print(f"\n--- Batch generating all 4 regional target sectors: {targets_list} ---")
        for t_sec in targets_list:
            generate_satellite(
                storm_data=None,
                extent=None,
                sector_key=t_sec,
                output_png=None,
                output_gif=None,
                hours=args.hours,
                interval=args.interval,
                fps=args.fps,
                dpi=args.dpi,
                make_png=make_png,
                make_gif=make_gif,
                track_storm=False,
                show_track=False
            )
        print("\nAll regional targets generated successfully!")
        return

    # Determine target sector
    sector_key = None
    if args.target:
        sector_key = args.target
    elif args.northern_luzon:
        sector_key = 'northern_luzon'
    elif args.southern_luzon:
        sector_key = 'southern_luzon'
    elif args.visayas:
        sector_key = 'visayas'
    elif args.mindanao:
        sector_key = 'mindanao'
    elif args.philippines:
        sector_key = 'philippines'
    elif args.luzon:
        sector_key = 'luzon'
    elif not args.storm and not (args.lat and args.lon):
        # Default to southern_luzon (matching reference image)
        sector_key = 'southern_luzon'

    # Resolve storm data if specified
    storm_data = None
    if args.storm:
        active = fetch_active_storms()
        matched = [
            s for s in active
            if args.storm.upper() in s["atcf_id"].upper()
            or args.storm.upper() in s["storm_name"].upper()
            or args.storm.upper() in s.get("international_name", "").upper()
            or args.storm.upper() in s.get("atcf_name", "").upper()
        ]
        if matched:
            storm_data = matched[0]
            if is_placeholder_storm_name(storm_data.get('storm_name')):
                jma_name = find_jma_international_name(storm_data)
                if jma_name:
                    storm_data["storm_name"] = jma_name
                    storm_data["international_name"] = jma_name
            print(f"Targeting active storm: {storm_data['storm_name']} ({storm_data['atcf_id']})")
        else:
            local_st = load_storm_from_local_positions(args.storm)
            if local_st:
                storm_data = local_st
                if is_placeholder_storm_name(storm_data.get('storm_name')):
                    jma_name = find_jma_international_name(storm_data)
                    if jma_name:
                        storm_data["storm_name"] = jma_name
                        storm_data["international_name"] = jma_name
                print(f"Targeting storm from local dataset: {storm_data['storm_name']} ({storm_data['atcf_id']})")
            else:
                print(f"Notice: Storm '{args.storm}' not found in active/local feeds. Using custom center.")
                storm_data = {
                    "atcf_id": args.storm.upper(),
                    "storm_name": args.storm.upper(),
                    "lat": args.lat or 16.5,
                    "lon": args.lon or 121.0,
                    "wind_kt": 65.0,
                    "pressure_hpa": 980.0
                }
                if is_placeholder_storm_name(storm_data["storm_name"]):
                    jma_name = find_jma_international_name(storm_data)
                    if jma_name:
                        storm_data["storm_name"] = jma_name
                        storm_data["international_name"] = jma_name

    # Override coordinates if provided
    if args.lat is not None and args.lon is not None:
        if storm_data:
            storm_data["lat"] = args.lat
            storm_data["lon"] = args.lon
        else:
            storm_data = {
                "atcf_id": "CUSTOM",
                "storm_name": "CUSTOM",
                "lat": args.lat,
                "lon": args.lon,
                "wind_kt": 0
            }

    # Custom extent override
    extent = None
    if args.lat is not None and args.lon is not None:
        extent = calculate_storm_focus_extent(args.lat, args.lon, lon_span=args.span)

    out_png = args.output.replace(".gif", ".png") if (args.output and make_png) else args.output
    out_gif = args.output.replace(".png", ".gif") if (args.output and make_gif) else args.output

    card_override = None
    if getattr(args, 'no_agency_card', False):
        card_override = False
    elif getattr(args, 'agency_card', False):
        card_override = True

    generate_satellite(
        storm_data=storm_data,
        extent=extent,
        sector_key=sector_key,
        output_png=out_png,
        output_gif=out_gif,
        hours=args.hours,
        interval=args.interval,
        fps=args.fps,
        dpi=args.dpi,
        make_png=make_png,
        make_gif=make_gif,
        track_storm=(not args.fixed_camera),
        show_track=getattr(args, 'show_track_line', False),
        lon_span=args.span,
        draw_agency_card=card_override
    )

if __name__ == "__main__":
    main()
