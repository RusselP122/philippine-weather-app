"""
persiann_nowcast.py
===================
Real-Time Satellite Precipitation Nowcasting for the Philippines using PERSIANN PDIR-Now (Unmasked).

Data Source:
  Center for Hydrometeorology and Remote Sensing (CHRS), University of California, Irvine (UCI)
  Product: PERSIANN-PDIR-Now 1-Hourly Near-Real-Time Global Precipitation (~0.04° / ~4 km resolution)
  URL: https://persiann.eng.uci.edu/CHRSdata/PDIRNow/PDIRNow1hourly/

Features:
  - Scrapes the latest published hourly files from UCI CHRS (PDIR-Now by default, or PERSIANN-CCS).
  - Unmasked continuous satellite rainfall covering both ocean and land (matching satellite view / Cyclone.jsx).
  - Generates Nowcast Rainfall Products:
      1. Latest 1-Hour Rain Rate / Intensity (mm/hr)
      2. Past 3-Hour Cumulative Precipitation (mm)
      3. Past 6-Hour Cumulative Precipitation (mm)
      4. Past 24-Hour Daily Cumulative Precipitation (mm)
  - Broadcast-Quality Visuals:
      - 16:9 Widescreen TV Studio Aesthetic (dark navy ocean, slate-olive terrain).
      - Regional Zoom Maps: Luzon (with Palawan & Batanes/Babuyan insets), Visayas, Mindanao, and National Overview.
      - City-level rainfall callout badges with offsets and rounded pills.
      - Top broadcast header banner with timestamps in Philippine Standard Time (PHT, UTC+8).
      - PhilWx brand logo integration.
      - Output metadata JSON for web app integration.
"""

import os
import re
import sys
import json
import gzip
import argparse
import requests
import numpy as np
import scipy.ndimage
from scipy.interpolate import RegularGridInterpolator
from datetime import datetime, timedelta, timezone

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.image as mpimg
import matplotlib.patches as patches
from matplotlib.patches import FancyBboxPatch
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import shapely
from shapely.geometry import shape, box
from shapely.validation import make_valid
from shapely.ops import unary_union

# ── Directories ────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "public", "images", "persiann_nowcast")
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
CACHE_DIR = os.path.join(BASE_DIR, "temp_data", "persiann_cache")

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(CACHE_DIR, exist_ok=True)

LOGO_PATHS = [
    os.path.join(BASE_DIR, "public", "images", "logo.png"),
    os.path.join(BASE_DIR, "public", "logo512.png"),
    os.path.join(BASE_DIR, "public", "logo192.png"),
]

# ── Philippine Master Grid ─────────────────────────────────────────────────
# Expanded domain (107.0°E to 141.0°E, 3.5°N to 22.5°N) so rainfall extends seamlessly
# across the entire widescreen 16:9 canvas on National overview without any cutoffs
LAT_MIN, LAT_MAX = 3.5, 22.5
LON_MIN, LON_MAX = 107.0, 141.0
GRID_RES = 0.02
MASTER_LATS = np.arange(LAT_MIN, LAT_MAX + GRID_RES, GRID_RES)
MASTER_LONS = np.arange(LON_MIN, LON_MAX + GRID_RES, GRID_RES)
M_LONS, M_LATS = np.meshgrid(MASTER_LONS, MASTER_LATS)

# ── Colormaps & Norms ──────────────────────────────────────────────────────
# 1. 1-Hour Rain Intensity (mm/hr)
NOWCAST_1H_LEVELS = [0.5, 2.0, 5.0, 10.0, 15.0, 20.0, 30.0, 45.0, 60.0]
NOWCAST_1H_COLORS = [
    '#2d6a4f', '#52b788', '#70e000', '#9ef01a', '#ffea00',
    '#ff9e00', '#ff5400', '#d90429'
]
nowcast_1h_cmap = ListedColormap(NOWCAST_1H_COLORS)
nowcast_1h_cmap.set_over('#7209b7')
nowcast_1h_norm = BoundaryNorm(NOWCAST_1H_LEVELS, ncolors=len(NOWCAST_1H_COLORS), clip=False)

# 2. 3-Hour Accumulation (mm)
ACCUM_3H_LEVELS = [1, 3, 5, 10, 20, 35, 50, 75, 100]
accum_3h_cmap = ListedColormap(NOWCAST_1H_COLORS)
accum_3h_cmap.set_over('#7209b7')
accum_3h_norm = BoundaryNorm(ACCUM_3H_LEVELS, ncolors=len(NOWCAST_1H_COLORS), clip=False)

# 3. 6-Hour Accumulation (mm)
ACCUM_6H_LEVELS = [2, 5, 10, 20, 35, 50, 75, 100, 150]
accum_6h_cmap = ListedColormap(NOWCAST_1H_COLORS)
accum_6h_cmap.set_over('#7209b7')
accum_6h_norm = BoundaryNorm(ACCUM_6H_LEVELS, ncolors=len(NOWCAST_1H_COLORS), clip=False)

# 4. 24-Hour Accumulation (mm) - matching ai_precip_outlook.py broadcast scale
ACCUM_24H_LEVELS = [5, 15, 30, 50, 75, 100, 150, 200, 300, 450]
ACCUM_24H_COLORS = [
    '#2d6a4f', '#52b788', '#70e000', '#9ef01a', '#ffea00',
    '#ff9e00', '#ff5400', '#d90429', '#7209b7'
]
accum_24h_cmap = ListedColormap(ACCUM_24H_COLORS)
accum_24h_cmap.set_over('#3a0ca3')
accum_24h_norm = BoundaryNorm(ACCUM_24H_LEVELS, ncolors=len(ACCUM_24H_COLORS), clip=False)

# ── Regional Definitions (Exact 16:9 Aspect Ratio) ─────────────────────────
BROADCAST_REGIONS = {
    "luzon": {
        "title": "LUZON",
        "extent": [114.46, 127.94, 12.0, 19.3],
        "cities": [
            ("LAOAG", 120.59, 18.20, (0, 0)),
            ("TUGUEGARAO", 121.72, 17.61, (0, 0)),
            ("BAGUIO", 120.59, 16.41, (-0.35, 0)),
            ("DAGUPAN", 120.34, 16.04, (-0.45, -0.1)),
            ("CLARK", 120.56, 15.18, (-0.45, 0)),
            ("CABANATUAN", 120.96, 15.48, (0.45, 0.1)),
            ("MANILA", 120.98, 14.59, (-0.5, 0)),
            ("BATANGAS", 121.05, 13.75, (-0.5, -0.1)),
            ("LUCENA", 121.61, 13.93, (0.45, 0.05)),
            ("NAGA", 123.19, 13.62, (0, 0.1)),
            ("LEGAZPI", 123.73, 13.14, (0.45, -0.1))
        ]
    },
    "visayas": {
        "title": "VISAYAS",
        "extent": [120.08, 127.32, 9.0, 13.0],
        "cities": [
            ("BORACAY", 121.92, 11.97, (-0.45, 0.1)),
            ("KALIBO", 122.36, 11.70, (0, 0.15)),
            ("ROXAS", 122.75, 11.58, (0.35, 0.15)),
            ("ILOILO", 122.56, 10.72, (-0.45, -0.1)),
            ("BACOLOD", 122.95, 10.67, (0.45, 0.1)),
            ("CEBU CITY", 123.89, 10.31, (0.5, -0.05)),
            ("TAGBILARAN", 123.85, 9.65, (0, -0.18)),
            ("DUMAGUETE", 123.30, 9.31, (-0.45, -0.1)),
            ("TACLOBAN", 125.00, 11.24, (0.45, 0.1)),
            ("ORMOC", 124.60, 11.00, (-0.45, 0)),
            ("CATBALOGAN", 124.88, 11.77, (0, 0.18))
        ]
    },
    "mindanao": {
        "title": "MINDANAO",
        "extent": [120.02, 128.98, 5.2, 10.2],
        "cities": [
            ("SURIGAO", 125.49, 9.79, (-0.45, -0.45)),
            ("BUTUAN", 125.54, 8.95, (0.45, 0.05)),
            ("CAGAYAN DE ORO", 124.63, 8.48, (-0.55, 0.1)),
            ("ILIGAN", 124.24, 8.23, (-0.55, -0.1)),
            ("DIPOLOG", 123.34, 8.58, (-0.45, 0.1)),
            ("PAGADIAN", 123.43, 7.82, (-0.45, 0)),
            ("ZAMBOANGA", 122.07, 6.92, (0, -0.18)),
            ("COTABATO", 124.24, 7.22, (-0.45, 0)),
            ("DAVAO", 125.60, 7.19, (0.45, 0.05)),
            ("TAGUM", 125.80, 7.44, (0.45, 0.1)),
            ("GEN SANTOS", 125.17, 6.11, (0, -0.18))
        ]
    },
    "national": {
        "title": "PHILIPPINES",
        "extent": [108.0, 140.0, 4.0, 22.0],
        "cities": [
            ("LAOAG", 120.59, 18.20, (-0.6, 0.15)),
            ("TUGUEGARAO", 121.72, 17.61, (0.7, 0.1)),
            ("BAGUIO", 120.59, 16.41, (-0.65, 0)),
            ("MANILA", 120.98, 14.59, (-0.7, 0)),
            ("LEGAZPI", 123.73, 13.14, (0.7, 0)),
            ("PTO PRINCESA", 118.73, 9.74, (-0.9, -0.1)),
            ("ILOILO", 122.56, 10.72, (-0.65, -0.1)),
            ("CEBU CITY", 123.89, 10.31, (0.75, 0)),
            ("TACLOBAN", 125.00, 11.24, (0.75, 0.1)),
            ("CAGAYAN DE ORO", 124.63, 8.48, (0, 0.25)),
            ("DAVAO", 125.60, 7.19, (0.65, 0)),
            ("ZAMBOANGA", 122.07, 6.92, (-0.75, -0.2)),
            ("GEN SANTOS", 125.17, 6.11, (0, -0.28))
        ]
    }
}

PALAWAN_CITIES = [
    ("CORON", 120.20, 12.00, (-0.35, 0.05)),
    ("EL NIDO", 119.39, 11.18, (-0.45, 0.05)),
    ("PTO PRINCESA", 118.73, 9.74, (0.55, 0)),
    ("BROOKE’S PT", 117.83, 8.77, (-0.45, 0))
]

BATANES_BABUYAN_CITIES = [
    ("ITBAYAT", 121.84, 20.78, (0, 0.08)),
    ("BASCO", 121.97, 20.45, (0.28, 0)),
    ("BABUYAN IS.", 121.93, 19.52, (0.35, 0)),
    ("CALAYAN", 121.47, 19.26, (-0.28, -0.05)),
    ("CAMIGUIN IS.", 121.93, 18.92, (0.35, -0.05))
]

PAR_VERTICES = [
    (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
    (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
]

# ═══════════════════════════════════════════════════════════════════════════
# Geometry & Mask Loading
# ═══════════════════════════════════════════════════════════════════════════

def load_ph_regional_geometries():
    """Load Philippine provincial boundaries and compute regional containment masks."""
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

    bb_box = box(120.8, 18.7, 122.6, 21.4)

    try:
        geojson_paths = [
            os.path.join(DATA_DIR, "ph_provinces.json"),
            os.path.join(BASE_DIR, "public", "data", "ph_provinces.json"),
            os.path.join(os.getcwd(), "public", "data", "ph_provinces.json")
        ]
        found_geo = next((p for p in geojson_paths if os.path.exists(p)), None)
        if found_geo:
            with open(found_geo, "r", encoding="utf-8") as f:
                geo_data = json.load(f)

            for feat in geo_data["features"]:
                reg = feat["properties"].get("REGION", "")
                pname = feat["properties"].get("NAME_1", feat["properties"].get("PROVINCE", ""))
                geom = make_valid(shape(feat["geometry"]))
                all_provs.append(geom)

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

            u_all = unary_union(all_provs)
            u_luzon_main = unary_union(luzon_main_geoms)
            u_palawan = unary_union(palawan_geoms)
            u_bb = unary_union(batanes_babuyan_geoms)
            u_visayas = unary_union(visayas_geoms)
            u_mindanao = unary_union(mindanao_geoms)

            # Load major Philippine lakes (Laguna de Bay, Taal Lake, etc.)
            lakes_geoms = []
            lakes_paths = [
                os.path.join(DATA_DIR, "ph_major_lakes.json"),
                os.path.join(BASE_DIR, "public", "data", "ph_major_lakes.json"),
                os.path.join(os.getcwd(), "public", "data", "ph_major_lakes.json")
            ]
            found_lakes = next((p for p in lakes_paths if os.path.exists(p)), None)
            if found_lakes:
                try:
                    with open(found_lakes, "r", encoding="utf-8") as f:
                        lakes_json = json.load(f)
                    for feat in lakes_json.get("features", []):
                        lakes_geoms.append(make_valid(shape(feat["geometry"])))
                except Exception as e:
                    print(f"Notice loading major lakes: {e}")

            if not lakes_geoms:
                try:
                    import cartopy.io.shapereader as shpreader
                    reader = shpreader.Reader(shpreader.natural_earth('10m', 'physical', 'lakes'))
                    for rec in reader.records():
                        b = rec.geometry.bounds
                        if 115 <= b[0] and b[2] <= 130 and 4 <= b[1] and b[3] <= 22:
                            lakes_geoms.append(rec.geometry)
                except Exception as e:
                    print(f"Notice loading fallback lakes: {e}")

            lake_mask = None
            if lakes_geoms:
                u_lakes = unary_union(lakes_geoms)
                lake_mask = shapely.contains_xy(u_lakes, M_LONS, M_LATS)

            masks = {
                "all": shapely.contains_xy(u_all, M_LONS, M_LATS),
                "luzon_main": shapely.contains_xy(u_luzon_main, M_LONS, M_LATS),
                "palawan": shapely.contains_xy(u_palawan, M_LONS, M_LATS),
                "batanes_babuyan": shapely.contains_xy(u_bb, M_LONS, M_LATS),
                "visayas": shapely.contains_xy(u_visayas, M_LONS, M_LATS),
                "mindanao": shapely.contains_xy(u_mindanao, M_LONS, M_LATS)
            }
            geoms_dict = {
                "all": all_provs,
                "luzon_main": luzon_main_geoms,
                "palawan": palawan_geoms,
                "batanes_babuyan": batanes_babuyan_geoms,
                "visayas": visayas_geoms,
                "mindanao": mindanao_geoms,
                "lakes": lakes_geoms,
                "lake_mask": lake_mask
            }
            return geoms_dict, masks
    except Exception as e:
        print(f"Notice loading regional geometries: {e}")
    return {}, {}

# ═══════════════════════════════════════════════════════════════════════════
# UCI CHRS Real-Time Satellite Rain Fetcher & Decoder (PERSIANN-CCS / PDIR-Now)
# ═══════════════════════════════════════════════════════════════════════════

def get_latest_persiann_files(session, product="ccs", hours_needed=26):
    """
    Scrapes UCI CHRS directory index for current year and finds the latest published files.
    - product='ccs' (default): PERSIANN-CCS (Cloud Classification System, big-endian short int)
    - product='pdir': PERSIANN-PDIR-Now (Dynamic Infrared, little-endian short int)
    Returns: list of (datetime_utc, filename, url) sorted chronologically ascending.
    """
    now_utc = datetime.now(timezone.utc)
    years = [now_utc.year]
    if now_utc.month == 1 and now_utc.day <= 2:
        years.append(now_utc.year - 1)

    matched_files = []
    if product == "ccs":
        pattern = re.compile(r'href=["\']?(rgccs1h(\d{2})(\d{3})(\d{2})\.bin\.gz)["\']?')
    else:
        pattern = re.compile(r'href=["\']?(pdirnow1h(\d{2})(\d{2})(\d{2})(\d{2})\.bin\.gz)["\']?')

    for yr in years:
        if product == "ccs":
            dir_url = f"https://persiann.eng.uci.edu/CHRSdata/PERSIANN-CCS/hrly/{yr}/"
        else:
            dir_url = f"https://persiann.eng.uci.edu/CHRSdata/PDIRNow/PDIRNow1hourly/{yr}/"

        try:
            resp = session.get(dir_url, timeout=12)
            if resp.status_code == 200:
                for match in pattern.finditer(resp.text):
                    fname = match.group(1)
                    if product == "ccs":
                        yy, ddd, hh = int(match.group(2)), int(match.group(3)), int(match.group(4))
                        century = 2000 if yy < 70 else 1900
                        dt = datetime.strptime(f"{century + yy} {ddd:03d} {hh:02d}", "%Y %j %H").replace(tzinfo=timezone.utc)
                    else:
                        yy, mm, dd, hh = int(match.group(2)), int(match.group(3)), int(match.group(4)), int(match.group(5))
                        century = 2000 if yy < 70 else 1900
                        dt = datetime(century + yy, mm, dd, hh, 0, tzinfo=timezone.utc)
                    file_url = f"{dir_url}{fname}"
                    matched_files.append((dt, fname, file_url))
        except Exception as e:
            print(f"Notice scraping CHRS directory for {yr} ({product}): {e}")

    if not matched_files:
        return []

    # Sort chronologically
    matched_files.sort(key=lambda x: x[0])
    return matched_files[-hours_needed:]

def download_and_read_persiann_hour(session, dt, fname, url, product="ccs"):
    """
    Downloads and caches a single 1-hour PERSIANN binary file, extracts and slices to the PH domain.
    Returns: 2D numpy array on MASTER_LATS, MASTER_LONS grid in mm/hr.
    """
    product_cache = os.path.join(CACHE_DIR, f"persiann_{product}")
    os.makedirs(product_cache, exist_ok=True)
    cache_path = os.path.join(product_cache, fname)
    raw_bytes = None

    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 100000:
        try:
            with gzip.open(cache_path, "rb") as gz:
                raw_bytes = gz.read()
        except Exception:
            raw_bytes = None

    if raw_bytes is None:
        try:
            print(f"  Downloading {fname} from UCI CHRS ({product.upper()})...")
            resp = session.get(url, timeout=30)
            if resp.status_code == 200:
                with open(cache_path, "wb") as f:
                    f.write(resp.content)
                raw_bytes = gzip.decompress(resp.content)
            else:
                print(f"  Warning: HTTP {resp.status_code} for {fname}")
                return None
        except Exception as e:
            print(f"  Error downloading {fname}: {e}")
            return None

    try:
        # CCS is big-endian >i2, PDIR is little-endian <i2
        dtype = '>i2' if product == 'ccs' else '<i2'
        arr = np.frombuffer(raw_bytes, dtype=dtype).reshape((3000, 9000))

        # Coordinates for slicing Philippines (buffer with margin: Lat 3.2 to 22.8, Lon 106.5 to 141.5)
        r_min = int(round((59.98 - 22.8) / 0.04))
        r_max = int(round((59.98 - 3.2) / 0.04)) + 1
        c_min = int(round((106.5 - 0.02) / 0.04))
        c_max = int(round((141.5 - 0.02) / 0.04)) + 1

        sub_arr = arr[r_min:r_max, c_min:c_max].astype(np.float32)
        # Handle nodata (-9999)
        sub_arr[sub_arr < 0] = 0.0
        # 1-hourly scale factor is 100 -> mm/hr
        sub_arr = sub_arr / 100.0

        # Coordinates of the sliced sub-array
        sub_lats = 59.98 - np.arange(r_min, r_max) * 0.04
        sub_lons = 0.02 + np.arange(c_min, c_max) * 0.04

        # RegularGridInterpolator requires strictly ascending 1D coordinates
        rgi = RegularGridInterpolator(
            (sub_lats[::-1], sub_lons),
            sub_arr[::-1, :],
            method='linear',
            bounds_error=False,
            fill_value=0.0
        )

        grid_pts = np.stack([M_LATS.ravel(), M_LONS.ravel()], axis=-1)
        regridded = rgi(grid_pts).reshape(M_LATS.shape)
        regridded = np.clip(regridded, 0.0, None)
        return regridded

    except Exception as e:
        print(f"  Decoding error in {fname}: {e}")
        return None

# ═══════════════════════════════════════════════════════════════════════════
# TV Broadcast Regional Map Generator with Dual Insets
# ═══════════════════════════════════════════════════════════════════════════

def plot_broadcast_nowcast_map(
    rain_grid,
    filename_id,
    period_key,
    period_title,
    obs_start_utc,
    obs_end_utc,
    region_key,
    geoms_dict=None,
    masks=None,
    product_label="PDIR-Now"
):
    """
    Renders a 16:9 Widescreen TV Broadcast Weather Graphic for Real-Time PERSIANN Satellite Rainfall.
    - Regional Isolation: Rain heatmaps cleanly masked to regional land masses.
    - Dual Insets on Luzon Map (Palawan bottom-left & Batanes/Babuyan upper-right).
    - Custom City Callout Badges with exact satellite point readings.
    - TV Top Banner with PHT timestamps, dataset pills, and custom colorbars.
    """
    region_info = BROADCAST_REGIONS[region_key]
    smoothed_grid = scipy.ndimage.gaussian_filter(rain_grid, sigma=1.0)

    # Select color levels, labels, and norm based on period
    if period_key == "1h":
        levels = NOWCAST_1H_LEVELS
        cmap = nowcast_1h_cmap
        norm = nowcast_1h_norm
        tick_labels = ['0.5', '2', '5', '10', '15', '20', '30', '45']
        cbar_unit = 'INTENSITY (mm/hr)'
        val_unit = 'mm/h'
    elif period_key == "3h":
        levels = ACCUM_3H_LEVELS
        cmap = accum_3h_cmap
        norm = accum_3h_norm
        tick_labels = ['1', '3', '5', '10', '20', '35', '50', '75']
        cbar_unit = 'PRECIPITATION (mm)'
        val_unit = 'mm'
    elif period_key == "6h":
        levels = ACCUM_6H_LEVELS
        cmap = accum_6h_cmap
        norm = accum_6h_norm
        tick_labels = ['2', '5', '10', '20', '35', '50', '75', '100']
        cbar_unit = 'PRECIPITATION (mm)'
        val_unit = 'mm'
    else:  # 24h
        levels = ACCUM_24H_LEVELS
        cmap = accum_24h_cmap
        norm = accum_24h_norm
        tick_labels = ['5', '15', '30', '50', '75', '100', '150', '200', '300']
        cbar_unit = 'PRECIPITATION (mm)'
        val_unit = 'mm'

    # Apply strict regional land mask so other regions don't bleed rain colors
    if masks:
        if region_key == "luzon":
            land_rain = np.where(masks.get("luzon_main"), smoothed_grid, np.nan)
            palawan_rain = np.where(masks.get("palawan"), smoothed_grid, np.nan)
            bb_rain = np.where(masks.get("batanes_babuyan"), smoothed_grid, np.nan)
        elif region_key == "visayas":
            land_rain = np.where(masks.get("visayas"), smoothed_grid, np.nan)
        elif region_key == "mindanao":
            land_rain = np.where(masks.get("mindanao"), smoothed_grid, np.nan)
        else:  # national
            land_rain = np.where(masks.get("all"), smoothed_grid, np.nan)
    else:
        land_rain = smoothed_grid
        palawan_rain = smoothed_grid
        bb_rain = smoothed_grid

    # Major inland lakes (Laguna de Bay, Taal Lake, etc.) masked so they have no rain color
    if geoms_dict and geoms_dict.get("lake_mask") is not None:
        l_mask = geoms_dict["lake_mask"]
        land_rain = np.where(l_mask, np.nan, land_rain)
        palawan_rain = np.where(l_mask, np.nan, palawan_rain)
        bb_rain = np.where(l_mask, np.nan, bb_rain)

    fig = plt.figure(figsize=(16, 9), dpi=120)
    fig.patch.set_facecolor('#0d1821')
    ax = fig.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree())
    ax.set_extent(region_info["extent"], crs=ccrs.PlateCarree())

    # Deep Navy TV ocean & Dark Slate-Olive terrain
    ax.add_feature(cfeature.OCEAN, facecolor='#162533', zorder=0)
    ax.add_feature(cfeature.LAND, facecolor='#25342a', zorder=1)

    # Precipitation Heatmap
    cf = ax.contourf(
        M_LONS, M_LATS, land_rain,
        levels=levels, cmap=cmap, norm=norm,
        extend='max', transform=ccrs.PlateCarree(), zorder=2, alpha=0.92
    )

    # Province boundaries & coastlines
    if geoms_dict and "all" in geoms_dict:
        ax.add_geometries(geoms_dict["all"], crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#475569', linewidth=0.8, alpha=0.85, zorder=3)
    ax.add_feature(cfeature.COASTLINE, linewidth=1.3, edgecolor='#0f172a', zorder=4)

    # Inland lakes (Laguna de Bay, Taal Lake, etc.) rendered in deep water color with shoreline borders
    if geoms_dict and geoms_dict.get("lakes"):
        ax.add_geometries(geoms_dict["lakes"], crs=ccrs.PlateCarree(), facecolor='#162533', edgecolor='#0f172a', linewidth=1.2, zorder=4.5)

    # ── City Point-Rainfall Callout Badges ─────────────────────────────────────
    extent = region_info["extent"]
    for item in region_info["cities"]:
        name, clon, clat = item[0], item[1], item[2]
        offset_x, offset_y = item[3] if len(item) > 3 else (0, 0)

        if extent[0] - 0.2 <= clon <= extent[1] + 0.2 and extent[2] - 0.2 <= clat <= extent[3] + 0.2:
            dist = (M_LONS - clon)**2 + (M_LATS - clat)**2
            min_idx = np.unravel_index(np.argmin(dist), dist.shape)
            val = land_rain[min_idx]

            min_threshold = 0.5 if period_key == "1h" else 0.8
            if np.isnan(val) or val < min_threshold:
                continue

            if period_key == "1h":
                val_str = f"{val:.1f} {val_unit}"
            else:
                val_str = f"{val:.0f} {val_unit}"

            bbox_props = dict(boxstyle='round,pad=0.35', facecolor='#000000', edgecolor='#ffffff', alpha=0.78, lw=1.1)
            callout = f"{val_str}\n{name}"
            ax.text(
                clon + offset_x, clat + offset_y, callout,
                transform=ccrs.PlateCarree(),
                fontsize=11.5, fontweight='heavy',
                color='#ffffff', ha='center', va='center',
                bbox=bbox_props, zorder=10
            )

    # ── Dedicated Inset Mini-Maps on Luzon View ──────────────────────────────
    if region_key == "luzon" and geoms_dict:
        # 1. Palawan Inset (Bottom-Left)
        if "palawan" in geoms_dict:
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

            ax_pal.contourf(
                M_LONS, M_LATS, palawan_rain,
                levels=levels, cmap=cmap, norm=norm,
                extend='max', transform=ccrs.PlateCarree(), zorder=2, alpha=0.92
            )
            ax_pal.add_geometries(geoms_dict["palawan"], crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#475569', linewidth=0.8, alpha=0.85, zorder=3)
            ax_pal.add_feature(cfeature.COASTLINE, linewidth=1.2, edgecolor='#0f172a', zorder=4)
            if geoms_dict.get("lakes"):
                ax_pal.add_geometries(geoms_dict["lakes"], crs=ccrs.PlateCarree(), facecolor='#162533', edgecolor='#0f172a', linewidth=0.9, zorder=4.5)

            for name, clon, clat, (ox, oy) in PALAWAN_CITIES:
                dist = (M_LONS - clon)**2 + (M_LATS - clat)**2
                min_idx = np.unravel_index(np.argmin(dist), dist.shape)
                val = palawan_rain[min_idx]
                min_threshold = 0.5 if period_key == "1h" else 0.8
                if np.isnan(val) or val < min_threshold:
                    continue

                val_str = f"{val:.1f} {val_unit}" if period_key == "1h" else f"{val:.0f} {val_unit}"
                bbox_props = dict(boxstyle='round,pad=0.3', facecolor='#000000', edgecolor='#ffffff', alpha=0.75, lw=1.0)
                callout = f"{val_str}\n{name}"
                ax_pal.text(
                    clon + ox, clat + oy, callout,
                    transform=ccrs.PlateCarree(),
                    fontsize=10.5, fontweight='heavy',
                    color='#ffffff', ha='center', va='center',
                    bbox=bbox_props, zorder=10
                )

        # 2. Batanes & Babuyan Inset (Upper-Right)
        if "batanes_babuyan" in geoms_dict:
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

            ax_bb.contourf(
                M_LONS, M_LATS, bb_rain,
                levels=levels, cmap=cmap, norm=norm,
                extend='max', transform=ccrs.PlateCarree(), zorder=2, alpha=0.92
            )
            ax_bb.add_geometries(geoms_dict["batanes_babuyan"], crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#475569', linewidth=0.8, alpha=0.85, zorder=3)
            ax_bb.add_feature(cfeature.COASTLINE, linewidth=1.2, edgecolor='#0f172a', zorder=4)
            if geoms_dict.get("lakes"):
                ax_bb.add_geometries(geoms_dict["lakes"], crs=ccrs.PlateCarree(), facecolor='#162533', edgecolor='#0f172a', linewidth=0.9, zorder=4.5)

            for name, clon, clat, (ox, oy) in BATANES_BABUYAN_CITIES:
                dist = (M_LONS - clon)**2 + (M_LATS - clat)**2
                min_idx = np.unravel_index(np.argmin(dist), dist.shape)
                val = bb_rain[min_idx]
                min_threshold = 0.5 if period_key == "1h" else 0.8
                if np.isnan(val) or val < min_threshold:
                    continue

                val_str = f"{val:.1f} {val_unit}" if period_key == "1h" else f"{val:.0f} {val_unit}"
                bbox_props = dict(boxstyle='round,pad=0.3', facecolor='#000000', edgecolor='#ffffff', alpha=0.75, lw=1.0)
                callout = f"{val_str}\n{name}"
                ax_bb.text(
                    clon + ox, clat + oy, callout,
                    transform=ccrs.PlateCarree(),
                    fontsize=10.5, fontweight='heavy',
                    color='#ffffff', ha='center', va='center',
                    bbox=bbox_props, zorder=10
                )

    # ── Top Broadcast Header Banner ──────────────────────────────────────────
    header_bg = patches.Rectangle((0, 0.88), 1, 0.12, transform=fig.transFigure, facecolor='#0b131a', alpha=0.96, zorder=40)
    fig.patches.append(header_bg)

    # Title Banner Pill
    title_pill = FancyBboxPatch((0.24, 0.932), 0.36, 0.052, boxstyle='round,pad=0.01,rounding_size=0.012',
                                transform=fig.transFigure, facecolor='#1e293b', edgecolor='#38bdf8', lw=1.2, zorder=41)
    fig.patches.append(title_pill)
    fig.text(0.42, 0.957, 'NEAR REAL-TIME RAINFALL', fontsize=17.5, fontweight='heavy', color='#f8fafc', ha='center', va='center', zorder=42)

    # Subtitle Blue Bar with Philippine Standard Time (PHT, UTC+8)
    ph_tz = timezone(timedelta(hours=8))
    t_end_pht = obs_end_utc.astimezone(ph_tz)
    t_start_pht = obs_start_utc.astimezone(ph_tz)

    if period_key == "1h":
        sub_title = f'15 MIN FROM REAL-TIME OBSERVATION · {region_info["title"]} ({t_end_pht.strftime("%b %d, %I:%M %p PHT")})'
        pill_w = 0.44
        pill_x = 0.20
    else:
        time_range_str = f"{t_start_pht.strftime('%b %d %I:%M %p')} - {t_end_pht.strftime('%I:%M %p PHT')}"
        sub_title = f'15 MIN FROM REAL-TIME OBSERVATION · {region_info["title"]} ({time_range_str})'
        pill_w = 0.46
        pill_x = 0.19

    sub_pill = FancyBboxPatch((pill_x, 0.892), pill_w, 0.034, boxstyle='round,pad=0.01,rounding_size=0.01',
                             transform=fig.transFigure, facecolor='#0369a1', edgecolor='none', zorder=41)
    fig.patches.append(sub_pill)
    fig.text(0.42, 0.908, sub_title, fontsize=10.5, fontweight='bold', color='#ffffff', ha='center', va='center', zorder=42)

    # Colorbar in upper right header
    cbar_ax = fig.add_axes([0.65, 0.925, 0.31, 0.032], zorder=42)
    cb = fig.colorbar(cf, cax=cbar_ax, orientation='horizontal')
    cb.set_ticks(levels[:-1])
    cb.set_ticklabels(tick_labels)
    cb.ax.tick_params(labelsize=9.5, colors='#ffffff', length=0)
    cb.outline.set_edgecolor('#ffffff')
    cb.outline.set_linewidth(1.0)
    fig.text(0.805, 0.894, cbar_unit, fontsize=9, fontweight='bold', color='#94a3b8', ha='center', zorder=42)

    # ── Brand Logo ──────────────────────────────────────────────────────────
    found_logo = next((p for p in LOGO_PATHS if os.path.exists(p)), None)
    if found_logo:
        try:
            logo_img = mpimg.imread(found_logo)
            logo_ax = fig.add_axes([0.02, 0.888, 0.08, 0.10], zorder=45)
            logo_ax.imshow(logo_img)
            logo_ax.axis('off')
        except Exception as e:
            print(f"Notice loading logo: {e}")
            fig.text(0.052, 0.936, 'PHIL\nWX', fontsize=12, fontweight='heavy', color='#38bdf8', ha='center', va='center', zorder=42)
    else:
        fig.text(0.052, 0.936, 'PHIL\nWX', fontsize=12, fontweight='heavy', color='#38bdf8', ha='center', va='center', zorder=42)

    out_path = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(out_path, dpi=120, bbox_inches="tight", facecolor="#0d1821")
    plt.close()
    print(f"  Successfully saved {out_path}")
    return out_path

# ═══════════════════════════════════════════════════════════════════════════
# Main Pipeline
# ═══════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Real-Time PERSIANN PDIR-Now Satellite Rainfall Nowcasting for the Philippines (Unmasked).")
    parser.add_argument("--product", choices=["pdir", "ccs"], default="pdir",
                        help="PERSIANN product to use: 'pdir' (PDIR-Now, default) or 'ccs' (PERSIANN-CCS)")
    parser.add_argument("--periods", nargs="+", default=["1h", "3h", "6h", "24h"],
                        help="Periods to generate: 1h, 3h, 6h, 24h (default: all)")
    parser.add_argument("--regions", nargs="+", default=["luzon", "visayas", "mindanao", "national"],
                        help="Regions to plot: luzon, visayas, mindanao, national (default: all)")
    parser.add_argument("--masked", action="store_true", default=False,
                        help="Apply strict regional terrestrial land mask (default is False: unmasked continuous ocean + land)")
    parser.add_argument("--unmasked", action="store_true", default=True,
                        help="Keep continuous satellite rainfall across ocean and land (default: True)")
    args = parser.parse_args()

    # Unmasked by default unless --masked is explicitly passed
    apply_mask = args.masked

    product_label = "PDIR-Now" if args.product == "pdir" else "PERSIANN-CCS"
    product_full = "PERSIANN PDIR-Now (0.04° / ~4 km Near Real-Time Satellite Precipitation)" if args.product == "pdir" else "PERSIANN-CCS (Cloud Classification System, ~4 km Near Real-Time)"

    print("=================================================================")
    print(f"   REAL-TIME {product_label.upper()} SATELLITE RAINFALL NOWCASTING PIPELINE    ")
    print(f"   Mode: {'MASKED TO LAND' if apply_mask else 'UNMASKED (OCEAN + LAND CONTINUOUS)'}")
    print("=================================================================")

    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})

    # 1. Discover available hourly files
    print(f"\n[1/4] Discovering latest {product_label} hourly files from UCI CHRS...")
    file_inventory = get_latest_persiann_files(session, product=args.product, hours_needed=26)
    if not file_inventory:
        print(f"Error: Could not retrieve any {product_label} files from UCI CHRS.")
        sys.exit(1)

    latest_file_dt, latest_file_name, _ = file_inventory[-1]
    ph_tz = timezone(timedelta(hours=8))
    latest_pht = latest_file_dt.astimezone(ph_tz)
    print(f"  Latest available observation: {latest_file_name} -> {latest_pht.strftime('%Y-%m-%d %I:%M %p PHT')} ({latest_file_dt.strftime('%H:%M')}Z)")

    # 2. Determine required hourly slots
    needed_hours = 1
    if "24h" in args.periods:
        needed_hours = max(needed_hours, 24)
    elif "6h" in args.periods:
        needed_hours = max(needed_hours, 6)
    elif "3h" in args.periods:
        needed_hours = max(needed_hours, 3)

    target_files = file_inventory[-needed_hours:]
    print(f"\n[2/4] Downloading and caching {len(target_files)} hourly frames ({product_label})...")
    hourly_grids = {}
    for dt, fname, url in target_files:
        grid = download_and_read_persiann_hour(session, dt, fname, url, product=args.product)
        if grid is not None:
            hourly_grids[dt] = grid

    if not hourly_grids:
        print("Error: Failed to extract any hourly grids.")
        sys.exit(1)

    sorted_dts = sorted(hourly_grids.keys())
    print(f"  Successfully processed {len(sorted_dts)} hourly grids.")

    # 3. Load regional geometries & land masks
    print("\n[3/4] Loading Philippine regional geometries & masking arrays...")
    geoms_dict, masks = load_ph_regional_geometries()

    # 4. Generate products
    print(f"\n[4/4] Rendering TV-Broadcast {product_label} Maps ({'Masked' if apply_mask else 'Unmasked'})...")
    generated_frames = []
    product_stats = {}

    period_specs = {
        "1h": {"hours": 1, "title": "Latest 1-Hour Rain Rate"},
        "3h": {"hours": 3, "title": "Past 3-Hour Accumulation"},
        "6h": {"hours": 6, "title": "Past 6-Hour Accumulation"},
        "24h": {"hours": 24, "title": "Past 24-Hour Accumulation"}
    }

    for period_key in args.periods:
        if period_key not in period_specs:
            continue
        spec = period_specs[period_key]
        n_hours = spec["hours"]
        period_title = spec["title"]

        avail_dts = sorted_dts[-n_hours:]
        if not avail_dts:
            continue

        start_dt = avail_dts[0]
        end_dt = avail_dts[-1] + timedelta(hours=1)

        # Calculate accumulation
        grids_to_sum = [hourly_grids[t] for t in avail_dts]
        accum_grid = np.sum(grids_to_sum, axis=0)
        # If 1h, it is rain rate (mm/hr); if sum of multiple, it is total mm
        if period_key == "1h":
            accum_grid = grids_to_sum[-1]

        max_val = float(np.nanmax(accum_grid))
        mean_val = float(np.nanmean(accum_grid))
        product_stats[period_key] = {
            "max_rain": round(max_val, 2),
            "mean_rain": round(mean_val, 2),
            "start_utc": start_dt.isoformat(),
            "end_utc": end_dt.isoformat(),
            "frames_summed": len(grids_to_sum)
        }
        print(f"\n  Processing {period_title} ({len(grids_to_sum)} frame{'s' if len(grids_to_sum) > 1 else ''} | Max: {max_val:.1f} mm)...")

        for reg_key in args.regions:
            if reg_key not in BROADCAST_REGIONS:
                continue
            frame_id = f"persiann_nowcast_{period_key}_{reg_key}"
            plot_broadcast_nowcast_map(
                rain_grid=accum_grid,
                filename_id=frame_id,
                period_key=period_key,
                period_title=period_title,
                obs_start_utc=start_dt,
                obs_end_utc=end_dt,
                region_key=reg_key,
                geoms_dict=geoms_dict,
                masks=masks if apply_mask else None,
                product_label=product_label
            )
            generated_frames.append(frame_id)

    # Save metadata JSON
    meta = {
        "title": f"Real-Time {product_label} Satellite Rainfall Nowcast" + (" (Masked)" if apply_mask else " (Unmasked)"),
        "product": product_full,
        "product_code": args.product,
        "is_unmasked": not apply_mask,
        "source": "Center for Hydrometeorology and Remote Sensing (CHRS) - University of California, Irvine",
        "generated_at_pht": datetime.now(ph_tz).strftime("%Y-%m-%d %I:%M %p PHT"),
        "latest_observation_utc": latest_file_dt.isoformat(),
        "latest_observation_pht": latest_pht.strftime("%Y-%m-%d %I:%M %p PHT"),
        "periods_generated": list(product_stats.keys()),
        "regions_generated": [r for r in args.regions if r in BROADCAST_REGIONS],
        "statistics": product_stats,
        "frames": generated_frames
    }

    meta_path = os.path.join(DATA_DIR, "persiann_nowcast_meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print(f"\nMetadata successfully saved to {meta_path}")
    print("\n=================================================================")
    print(f"   ALL {product_label.upper()} NOWCASTING BROADCAST MAPS GENERATED SUCCESSFULLY ")
    print("=================================================================")

if __name__ == "__main__":
    main()
