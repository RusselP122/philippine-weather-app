#!/usr/bin/env python3
"""
tropical_signal_warning.py
==========================
DOST-PAGASA Tropical Cyclone Wind Signals (TCWS) Warning Map Generator.

Extracts official TCWS warnings (Signals 1 to 5) directly from PAGASA
Tropical Cyclone Bulletins (TCB) at:
  https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/

Renders broadcast-grade TV weather graphics adhering to official PAGASA
cartographic standards:
  - Solid flat dark header band with hairline divider and split subtitle
  - Brand logo badge with clear margin
  - Map axes clipped strictly below the header band
  - Top-Right Status Card with active signal chips, "Highest tier" indicator,
    5-segment scale bar, and total municipality count
  - Bottom-Left Legend Card with outlined active tiers and dimmed inactive tiers
  - Municipality-level boundary coloring strictly inland (no ocean halo bleed)
  - Full storm track (center position + forecast points) with directional arrows
    and collision-free forecast timestamp pills
  - Solid orange PAR boundary
  - Multi-aspect ratio presets: 16x9, 4x3, 4x5, 1x1
  - Automated JSON metadata export to public/data/tcws_latest_warning.json
"""

import os
import sys
import re
import math
import json
import argparse
import urllib.request
from pathlib import Path
from datetime import datetime, timezone, timedelta

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.image as mpimg
import matplotlib.patches as mpatches
import matplotlib.patheffects as path_effects
import matplotlib.font_manager as font_manager
from matplotlib.patches import FancyBboxPatch
from matplotlib.path import Path as MplPath
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import shapely
from shapely.geometry import shape, Point, Polygon, MultiPolygon
from shapely.ops import unary_union

try:
    import pymupdf
except ImportError:
    pymupdf = None

try:
    import pypdf
except ImportError:
    pypdf = None

# ── Base Paths & Local Font Setup ─────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
FONT_DIR = BASE_DIR / "assets" / "fonts"
FONT_PATH = FONT_DIR / "Inter-Variable.ttf"

if FONT_PATH.exists():
    try:
        font_manager.fontManager.addfont(str(FONT_PATH))
        prop = font_manager.FontProperties(fname=str(FONT_PATH))
        FONT_FAMILY = prop.get_name()
    except Exception:
        FONT_FAMILY = "DejaVu Sans"
else:
    FONT_FAMILY = "DejaVu Sans"

plt.rcParams['font.family'] = [FONT_FAMILY, 'DejaVu Sans', 'Arial', 'sans-serif']
plt.rcParams['text.antialiased'] = True

# ── Color Palette & TCWS Standard Specifications ──────────────────────────────
BG_CANVAS      = "#070e1c"   # Deep broadcast midnight ocean
OCEAN_COLOR    = "#070e1c"   # Deep broadcast midnight ocean
LAND_COLOR     = "#18263a"   # High-contrast slate terrain
COAST_EDGE     = "#4d6b94"   # Crisp lighter coastline boundary
COAST_CASING   = "#03060c"   # Dark halo casing under coastline
PROVINCE_EDGE  = "#3b5172"   # Provincial boundary lines
MUNI_DEFAULT   = "#1d2e46"   # Inactive municipality base
MUNI_EDGE      = "#273b58"   # Inactive municipality border
PAR_COLOR      = "#f97316"   # PAR boundary orange accent
CARD_BG        = "#091222"   # Fully opaque floating card background
CARD_BORDER    = "#22354e"   # Crisp card stroke
DIVIDER_COLOR  = "#192538"   # Subtle horizontal card divider
TEXT_WHITE     = "#f8fafc"   # Primary text
TEXT_MUTED     = "#94a3b8"   # Slate secondary text

TCB_INDEX_URL  = "https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/"

# Official DOST-PAGASA Tropical Cyclone Wind Signal levels (1 to 5)
TCWS_LEVELS = {
    5: {
        'order': 5,
        'label': 'Signal 5',
        'short_label': 'Sig 5',
        'badge_bg': '#c084fc',
        'badge_fg': '#ffffff',
        'fill_color': '#c084fc',
        'border_color': '#e879f9',
        'dim_bg': '#451a4a',
        'dim_fg': '#a855f7',
        'alpha': 0.94,
        'lead_h': 12,
        'wind_range': '≥ 185 km/h',
        'wind_type': 'Super Typhoon',
        'line1': 'Super Typhoon Winds (≥185 km/h) • 12h lead time',
        'line2': 'Catastrophic threat to life and property.'
    },
    4: {
        'order': 4,
        'label': 'Signal 4',
        'short_label': 'Sig 4',
        'badge_bg': '#ef4444',
        'badge_fg': '#ffffff',
        'fill_color': '#ef4444',
        'border_color': '#f87171',
        'dim_bg': '#5c2227',
        'dim_fg': '#f87171',
        'alpha': 0.90,
        'lead_h': 12,
        'wind_range': '118 to 184 km/h',
        'wind_type': 'Typhoon',
        'line1': 'Typhoon-force Winds (118–184 km/h) • 12h lead time',
        'line2': 'Very heavy damage to structures and trees.'
    },
    3: {
        'order': 3,
        'label': 'Signal 3',
        'short_label': 'Sig 3',
        'badge_bg': '#f97316',
        'badge_fg': '#ffffff',
        'fill_color': '#f97316',
        'border_color': '#fb923c',
        'dim_bg': '#5c2f16',
        'dim_fg': '#fb923c',
        'alpha': 0.86,
        'lead_h': 18,
        'wind_range': '89 to 117 km/h',
        'wind_type': 'Storm-force',
        'line1': 'Storm-force Winds (89–117 km/h) • 18h lead time',
        'line2': 'Moderate to heavy damage to high-risk structures.'
    },
    2: {
        'order': 2,
        'label': 'Signal 2',
        'short_label': 'Sig 2',
        'badge_bg': '#facc15',
        'badge_fg': '#09101d',
        'fill_color': '#facc15',
        'border_color': '#fde047',
        'dim_bg': '#544710',
        'dim_fg': '#fde047',
        'alpha': 0.82,
        'lead_h': 24,
        'wind_range': '62 to 88 km/h',
        'wind_type': 'Gale-force',
        'line1': 'Gale-force Winds (62–88 km/h) • 24h lead time',
        'line2': 'Minor to moderate damage to light structures.'
    },
    1: {
        'order': 1,
        'label': 'Signal 1',
        'short_label': 'Sig 1',
        'badge_bg': '#00d2ff',
        'badge_fg': '#09101d',
        'fill_color': '#00d2ff',
        'border_color': '#38bdf8',
        'dim_bg': '#0c3b5e',
        'dim_fg': '#38bdf8',
        'alpha': 0.76,
        'lead_h': 36,
        'wind_range': '39 to 61 km/h',
        'wind_type': 'Strong',
        'line1': 'Strong Winds (39–61 km/h) • 36h lead time',
        'line2': 'Minimal to minor threat to life and property.'
    }
}

PAR_LONS = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
PAR_LATS = [ 5.0,  15.0,  21.0,  25.0,  25.0,   5.0,   5.0]

# Key Philippine reference cities
MAJOR_CITIES = [
    {"name": "Basco", "lon": 121.97, "lat": 20.45},
    {"name": "Itbayat", "lon": 121.84, "lat": 20.78},
    {"name": "Calayan", "lon": 121.48, "lat": 19.26},
    {"name": "Aparri", "lon": 121.64, "lat": 18.35},
    {"name": "Tuguegarao", "lon": 121.72, "lat": 17.61},
    {"name": "Laoag", "lon": 120.59, "lat": 18.20},
    {"name": "Ilagan", "lon": 121.89, "lat": 17.15},
    {"name": "Casiguran", "lon": 122.14, "lat": 16.28},
    {"name": "Baler", "lon": 121.56, "lat": 15.76},
    {"name": "Virac", "lon": 124.23, "lat": 13.58},
    {"name": "Daet", "lon": 122.95, "lat": 14.11},
    {"name": "Legazpi", "lon": 123.73, "lat": 13.14},
    {"name": "Manila", "lon": 120.98, "lat": 14.60},
    {"name": "Catarman", "lon": 124.64, "lat": 12.50},
    {"name": "Tacloban", "lon": 125.00, "lat": 11.24},
    {"name": "Cebu City", "lon": 123.89, "lat": 10.31},
    {"name": "Iloilo City", "lon": 122.56, "lat": 10.72},
    {"name": "Puerto Princesa", "lon": 118.74, "lat": 9.74},
    {"name": "Cagayan de Oro", "lon": 124.63, "lat": 8.48},
    {"name": "Davao City", "lon": 125.61, "lat": 7.19},
    {"name": "General Santos", "lon": 125.17, "lat": 6.11},
    {"name": "Zamboanga", "lon": 122.08, "lat": 6.92}
]

# ── Dynamic Multi-Format Layout Specifications ────────────────────────────────
LAYOUT_CONFIGS = {
    '16x9': {
        'figsize': (16.0, 9.0),
        'dpi': 120, # 1920 x 1080
        'band_h': 0.092, # Solid flat header band
        'title_size': 17.5,
        'sub_size': 9.2,
        'top_card': [0.725, 0.670, 0.245, 0.220],
        'legend_card': [0.030, 0.035, 0.340, 0.285],
        'font_scale': 1.0,
    },
    '4x3': {
        'figsize': (16.0, 12.0),
        'dpi': 120, # 1920 x 1440
        'band_h': 0.090,
        'title_size': 18.0,
        'sub_size': 9.5,
        'top_card': [0.725, 0.705, 0.245, 0.180],
        'legend_card': [0.030, 0.030, 0.345, 0.235],
        'font_scale': 1.1,
    },
    '4x5': {
        'figsize': (9.0, 11.25),
        'dpi': 120, # 1080 x 1350
        'band_h': 0.090,
        'title_size': 13.5,
        'sub_size': 7.5,
        'top_card': [0.575, 0.690, 0.390, 0.195],
        'legend_card': [0.035, 0.025, 0.520, 0.250],
        'font_scale': 0.9,
    },
    '1x1': {
        'figsize': (10.0, 10.0),
        'dpi': 108, # 1080 x 1080
        'band_h': 0.090,
        'title_size': 14.5,
        'sub_size': 8.0,
        'top_card': [0.610, 0.680, 0.360, 0.205],
        'legend_card': [0.035, 0.025, 0.490, 0.265],
        'font_scale': 0.95,
    }
}


# ── Vector Graphics Utilities ─────────────────────────────────────────────────
def draw_vector_cyclone_symbol(fig, cx=0.960, cy=0.942, radius=0.016, color="#f8fafc", lw=2.2):
    """Draws a resolution-independent vector tropical cyclone symbol."""
    eye = plt.Circle((cx, cy), radius * 0.40, fill=False, edgecolor=color,
                     linewidth=lw, transform=fig.transFigure, zorder=25)
    fig.patches.append(eye)

    verts1 = [
        (cx, cy + radius * 0.40),
        (cx + radius * 0.70, cy + radius * 0.75),
        (cx - radius * 0.60, cy + radius * 1.35),
        (cx - radius * 1.25, cy + radius * 0.70)
    ]
    codes = [MplPath.MOVETO, MplPath.CURVE4, MplPath.CURVE4, MplPath.CURVE4]
    p1 = mpatches.PathPatch(MplPath(verts1, codes), facecolor='none', edgecolor=color,
                            linewidth=lw, capstyle='round', transform=fig.transFigure, zorder=25)
    fig.patches.append(p1)

    verts2 = [
        (cx, cy - radius * 0.40),
        (cx - radius * 0.70, cy - radius * 0.75),
        (cx + radius * 0.60, cy - radius * 1.35),
        (cx + radius * 1.25, cy - radius * 0.70)
    ]
    p2 = mpatches.PathPatch(MplPath(verts2, codes), facecolor='none', edgecolor=color,
                            linewidth=lw, capstyle='round', transform=fig.transFigure, zorder=25)
    fig.patches.append(p2)


def is_point_inside_rect(pt_x, pt_y, rect, margin=0.015):
    """Checks if a point in figure coordinates lies inside a rect [x, y, w, h]."""
    rx, ry, rw, rh = rect
    return (rx - margin <= pt_x <= rx + rw + margin) and (ry - margin <= pt_y <= ry + rh + margin)


# ── PDF Listing & Retrieval ───────────────────────────────────────────────────
def fetch_available_tcb_pdfs(base_url=TCB_INDEX_URL):
    """Fetches the directory listing of available TCB PDFs from PAGASA."""
    req = urllib.request.Request(base_url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64)'})
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"Error fetching TCB index from {base_url}: {e}")
        return []

    pdf_files = re.findall(r'href=["\']([^"\']+\.pdf)["\']', html, re.IGNORECASE)
    seen = set()
    cleaned = []
    for f in pdf_files:
        if f not in seen:
            seen.add(f)
            cleaned.append(f)
    return cleaned


def download_tcb_pdf(filename_or_url, cache_dir=None):
    """Downloads a chosen TCB PDF from PAGASA or uses local file."""
    if cache_dir is None:
        cache_dir = BASE_DIR / "temp_data"
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    if Path(filename_or_url).exists():
        return str(filename_or_url)

    if filename_or_url.startswith("http://") or filename_or_url.startswith("https://"):
        url = filename_or_url
        filename = url.split('/')[-1]
    else:
        filename = filename_or_url
        safe_fn = filename.replace('#', '%23')
        url = TCB_INDEX_URL + safe_fn

    local_path = cache_dir / filename.replace('%23', '#')
    if not local_path.exists() or local_path.stat().st_size == 0:
        print(f"Downloading {url} -> {local_path}...")
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as resp, open(local_path, 'wb') as out_f:
            out_f.write(resp.read())
        print(f"Saved {local_path.stat().st_size} bytes.")
    else:
        print(f"Using cached file: {local_path}")
    return str(local_path)


# ── Text & Geographic Entity Normalization ─────────────────────────────────────
def clean_entity_name(s):
    """Normalizes string for municipality & province matching."""
    s = s.lower().strip()
    s = s.replace('\ufffd', 'n').replace('\u00f1', 'n')
    s = re.sub(r'\s+', ' ', s)
    s = s.replace('city of ', '').replace(' city', '')
    s = s.replace('pearrubia', 'penarrubia').replace('peablanca', 'penablanca').replace('santo nio', 'santo nino')
    s = s.replace('peñarubia', 'penarrubia').replace('peñablanca', 'penablanca').replace('santo niño', 'santo nino')
    s = s.replace('island', '').replace('islands', '').strip()
    return s


def parse_tcws_area_text(area_text):
    """
    Parses a TCWS text string into a list of structured entries:
    [{'province': 'Cagayan', 'municipalities': [...], 'is_rest': False}, ...]
    """
    if not area_text or area_text.strip() == '-':
        return []
    text = re.sub(r'\s+', ' ', area_text).strip().rstrip('.')

    # Split tokens by comma while respecting parentheses
    tokens = []
    current = []
    in_paren = False
    for ch in text:
        if ch == '(':
            in_paren = True
            current.append(ch)
        elif ch == ')':
            in_paren = False
            current.append(ch)
        elif ch == ',' and not in_paren:
            tokens.append(''.join(current).strip())
            current = []
        else:
            current.append(ch)
    if current:
        tokens.append(''.join(current).strip())

    results = []
    for raw_token in tokens:
        t = raw_token.strip()
        if not t:
            continue

        # Check for parentheses: "the eastern portion of mainland Cagayan (Santa Ana, ...)"
        m_paren = re.search(r'^(.*?)\((.*?)\)(.*)$', t)
        if m_paren:
            prefix = m_paren.group(1).strip()
            inside = m_paren.group(2).strip()
            suffix = m_paren.group(3).strip()

            p_name = re.sub(r'^(?:and\s+)?(?:the\s+)?(?:[a-z\s\-]+?\s+)?portion(?:s)?\s+of\s+', '', prefix, flags=re.I).strip()
            p_name = re.sub(r'^mainland\s+', '', p_name, flags=re.I).strip()

            m_and = re.search(r'^(.*?)\s+and\s+(the\s+.*)', prefix, flags=re.I)
            if m_and:
                p_before = m_and.group(1).strip()
                if p_before:
                    results.append({'province': p_before, 'municipalities': [], 'is_rest': False})
                p_name = re.sub(r'^(?:the\s+)?(?:[a-z\s\-]+?\s+)?portion(?:s)?\s+of\s+', '', m_and.group(2), flags=re.I).strip()
                p_name = re.sub(r'^mainland\s+', '', p_name, flags=re.I).strip()

            munis = [m.strip() for m in re.split(r'[,;]|\s+and\s+', inside) if m.strip()]
            results.append({
                'province': p_name,
                'municipalities': munis,
                'is_rest': False
            })

            if suffix:
                s_clean = re.sub(r'^(?:including|and)\s+', '', suffix, flags=re.I).strip()
                if s_clean:
                    results.append({
                        'province': s_clean,
                        'municipalities': [],
                        'is_rest': False
                    })
        else:
            is_rest = bool(re.search(r'\bthe\s+rest\s+of\b', t, flags=re.I))
            clean_p = re.sub(r'^(?:and\s+)?(?:the\s+)?rest\s+of\s+', '', t, flags=re.I).strip()
            clean_p = re.sub(r'^mainland\s+', '', clean_p, flags=re.I).strip()
            clean_p = re.sub(r'^(?:and\s+)?(?:the\s+)?', '', clean_p, flags=re.I).strip()

            if ' and ' in clean_p.lower():
                parts = re.split(r'\s+and\s+', clean_p, flags=re.I)
                for sp in parts:
                    if sp.strip():
                        results.append({'province': sp.strip(), 'municipalities': [], 'is_rest': is_rest})
            else:
                results.append({'province': clean_p, 'municipalities': [], 'is_rest': is_rest})

    return results


# ── TCB PDF Text & Section Parser ─────────────────────────────────────────────
def parse_tcb_pdf_data(pdf_path):
    """
    Parses a PAGASA Tropical Cyclone Bulletin PDF.
    Extracts storm metadata, center coordinates, forecast track, and TCWS area listings.
    """
    if pymupdf is not None:
        doc = pymupdf.open(pdf_path)
        full_text = ""
        for page in doc:
            full_text += page.get_text() + "\n"
    elif pypdf is not None:
        reader = pypdf.PdfReader(pdf_path)
        full_text = ""
        for page in reader.pages:
            txt = page.extract_text()
            if txt:
                full_text += txt + "\n"
        doc = None
    else:
        raise ImportError("Either pymupdf or pypdf is required to read bulletin PDFs.")

    # Storm name and international name
    m_storm = re.search(r'(?:Super\s+Typhoon|Typhoon|Severe\s+Tropical\s+Storm|Tropical\s+Storm|Tropical\s+Depression)\s+([A-Z0-9\-]+)(?:\s*\(([^)]+)\))?', full_text, re.IGNORECASE)
    storm_name = m_storm.group(1).upper() if m_storm else "CYCLONE"
    intl_name = m_storm.group(2).upper() if m_storm and m_storm.group(2) else ""

    m_no = re.search(r'TROPICAL CYCLONE BULLETIN NR\.\s*([0-9]+)', full_text, re.IGNORECASE)
    bulletin_no = m_no.group(1) if m_no else "1"

    m_iss = re.search(r'Issued at\s+([^\n]+)', full_text, re.IGNORECASE)
    issued_str = m_iss.group(1).strip() if m_iss else ""

    m_valid = re.search(r'Valid for broadcast until[^\n]*at\s+([^\n]+)', full_text, re.IGNORECASE)
    valid_str = m_valid.group(1).strip() if m_valid else ""

    # Current center position
    m_pos = re.search(r'\((\d+\.?\d*)°?N,\s*(\d+\.?\d*)°?E\)', full_text)
    current_pos = {'lat': float(m_pos.group(1)), 'lon': float(m_pos.group(2))} if m_pos else None

    track_pts = []
    if current_pos:
        m_ctime = re.search(r'Location of Center\s*\(([^)]+)\)', full_text, re.IGNORECASE)
        ctime_lbl = m_ctime.group(1).strip().upper() if m_ctime else "CENTER"
        track_pts.append({
            'time_label': ctime_lbl,
            'lon': current_pos['lon'],
            'lat': current_pos['lat'],
            'is_forecast': False
        })

    # Forecast track points from table
    fc_matches = re.finditer(
        r'(\d+)-Hour Forecast\s*\n\s*(\d{1,2}:\d{2}\s*[AP]M)\s*\n\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*\n\s*(\d+\.?\d*)\s*\n\s*(\d+\.?\d*)',
        full_text, re.IGNORECASE
    )
    for fm in fc_matches:
        tau = fm.group(1)
        tm = fm.group(2).strip()
        dt_str = fm.group(3).strip()
        lat = float(fm.group(4))
        lon = float(fm.group(5))
        try:
            d_obj = re.search(r'(\d+)\s+([A-Za-z]+)', dt_str)
            month_str = d_obj.group(2)[:3].upper() if d_obj else ""
            day_str = d_obj.group(1) if d_obj else ""
            t_short = tm.replace(':00', '')
            lbl = f"{month_str} {day_str} • {t_short}"
        except Exception:
            lbl = f"+{tau}H"

        track_pts.append({
            'time_label': lbl,
            'lon': lon,
            'lat': lat,
            'is_forecast': True
        })

    # Extract TCWS area table
    tcws_signals = {}
    if doc is not None:
        for page in doc:
            tabs = page.find_tables()
            for tab in tabs:
                extracted = tab.extract()
                if any('TCWS' in str(r) for r in extracted):
                    for row in extracted:
                        if not row or not row[0]:
                            continue
                        m_sig = re.search(r'(\d+)', str(row[0]))
                        if m_sig:
                            sig_num = int(m_sig.group(1))
                            if 1 <= sig_num <= 5:
                                areas = []
                                for col_idx in [1, 2, 3]:
                                    if len(row) > col_idx and row[col_idx] and row[col_idx].strip() != '-':
                                        areas.append(row[col_idx].strip())
                                combined_txt = " ".join(areas)
                                tcws_signals[sig_num] = parse_tcws_area_text(combined_txt)

    # Fallback if table extraction was empty
    if not tcws_signals:
        for sig_val in [5, 4, 3, 2, 1]:
            pat = rf'TCWS No\.\s*{sig_val}[\s\S]+?(?=TCWS No\.|\Z|OTHER HAZARDS)'
            m_s = re.search(pat, full_text, re.IGNORECASE)
            if m_s:
                tcws_signals[sig_val] = parse_tcws_area_text(m_s.group(0))

    return {
        'storm_name': storm_name,
        'intl_name': intl_name,
        'bulletin_no': bulletin_no,
        'issued_str': issued_str,
        'valid_str': valid_str,
        'track_points': track_pts,
        'signals': tcws_signals
    }


# ── Geographic Matching Engine ────────────────────────────────────────────────
def load_ph_administrative_data(geojson_path=None, prov_geojson_path=None):
    """Loads Philippine municipality and province boundaries with caching and simplification."""
    if geojson_path is None:
        geojson_path = BASE_DIR / "public" / "data" / "ph_municipalities.json"
    if prov_geojson_path is None:
        prov_geojson_path = BASE_DIR / "public" / "data" / "ph_provinces.json"

    geojson_path = Path(geojson_path)
    prov_geojson_path = Path(prov_geojson_path)

    if not geojson_path.exists():
        raise FileNotFoundError(f"Missing administrative boundary file: {geojson_path}")

    with open(geojson_path, 'r', encoding='utf-8') as f:
        muni_data = json.load(f)

    muni_hierarchy = {}
    muni_list = []
    for feat in muni_data.get('features', []):
        props = feat.get('properties', {})
        geom = feat.get('geometry')
        if not geom:
            continue
        try:
            poly = shape(geom)
            if not poly.is_valid:
                poly = shapely.make_valid(poly)
        except Exception:
            continue

        prov = clean_entity_name(props.get('PROVINCE', ''))
        muni = clean_entity_name(props.get('NAME_2', ''))
        if prov not in muni_hierarchy:
            muni_hierarchy[prov] = {}

        item = {
            'province': props.get('PROVINCE', ''),
            'name': props.get('NAME_2', ''),
            'clean_prov': prov,
            'clean_name': muni,
            'geometry': poly,
            'properties': props
        }
        muni_hierarchy[prov][muni] = item
        muni_list.append(item)

    provinces_list = []
    if prov_geojson_path.exists():
        with open(prov_geojson_path, 'r', encoding='utf-8') as pf:
            prov_data = json.load(pf)
        for feat in prov_data.get('features', []):
            props = feat.get('properties', {})
            geom = feat.get('geometry')
            if not geom:
                continue
            try:
                poly = shape(geom)
                if not poly.is_valid:
                    poly = shapely.make_valid(poly)
            except Exception:
                continue
            provinces_list.append({
                'name': props.get('PROVINCE') or props.get('NAME_1', ''),
                'clean_name': clean_entity_name(props.get('PROVINCE') or props.get('NAME_1', '')),
                'geometry': poly,
                'properties': props
            })

    return muni_hierarchy, muni_list, provinces_list


def assign_signals_to_municipalities(signals_dict, muni_hierarchy):
    """
    Assigns each municipality to its highest signal (5 down to 1).
    Handles specific municipality lists, whole provinces, and 'is_rest' residual clauses.
    """
    assigned = {}

    # Iterate from highest signal to lowest: 5, 4, 3, 2, 1
    for sig in sorted(signals_dict.keys(), reverse=True):
        entries = signals_dict[sig]

        # First pass: specific municipalities and whole provinces
        for entry in entries:
            raw_prov = entry['province']
            munis = entry['municipalities']
            is_rest = entry['is_rest']
            c_prov = clean_entity_name(raw_prov)

            if is_rest:
                continue

            # Special Babuyan Islands handling (Calayan municipality in Cagayan)
            if 'babuyan' in c_prov:
                if 'cagayan' in muni_hierarchy and 'calayan' in muni_hierarchy['cagayan']:
                    item = muni_hierarchy['cagayan']['calayan']
                    key = (item['clean_prov'], item['clean_name'])
                    if key not in assigned:
                        assigned[key] = (item, sig)
                continue

            # Polillo Islands handling (Quezon province)
            if 'polillo' in c_prov:
                if 'quezon' in muni_hierarchy:
                    for p_muni in ['polillo', 'panukulan', 'burdeos', 'patnanungan', 'jomalig']:
                        if p_muni in muni_hierarchy['quezon']:
                            item = muni_hierarchy['quezon'][p_muni]
                            key = (item['clean_prov'], item['clean_name'])
                            if key not in assigned:
                                assigned[key] = (item, sig)
                continue

            prov_match = None
            for p_key in muni_hierarchy:
                if p_key == c_prov or c_prov in p_key or p_key in c_prov:
                    prov_match = p_key
                    break

            if not munis:
                # Whole province
                if prov_match:
                    for km, item in muni_hierarchy[prov_match].items():
                        key = (item['clean_prov'], item['clean_name'])
                        if key not in assigned:
                            assigned[key] = (item, sig)
            else:
                for m_raw in munis:
                    c_m = clean_entity_name(m_raw)
                    matched = None
                    if prov_match:
                        for km, item in muni_hierarchy[prov_match].items():
                            if km == c_m or c_m in km or km in c_m:
                                matched = item
                                break
                    if not matched:
                        for p_k, sub in muni_hierarchy.items():
                            for km, item in sub.items():
                                if km == c_m:
                                    matched = item
                                    break
                            if matched:
                                break
                    if matched:
                        key = (matched['clean_prov'], matched['clean_name'])
                        if key not in assigned:
                            assigned[key] = (matched, sig)

        # Second pass: 'is_rest' entries (claim remaining unassigned municipalities)
        for entry in entries:
            if not entry['is_rest']:
                continue
            raw_prov = entry['province']
            c_prov = clean_entity_name(raw_prov)
            prov_match = None
            for p_key in muni_hierarchy:
                if p_key == c_prov or c_prov in p_key or p_key in c_prov:
                    prov_match = p_key
                    break
            if prov_match:
                for km, item in muni_hierarchy[prov_match].items():
                    key = (item['clean_prov'], item['clean_name'])
                    if key not in assigned:
                        assigned[key] = (item, sig)

    # Group by signal: {5: [...], 4: [...], 3: [...], 2: [...], 1: [...]}
    grouped = {5: [], 4: [], 3: [], 2: [], 1: []}
    for (cp, cm), (item, sig) in assigned.items():
        grouped[sig].append(item)
    return grouped


def generate_demo_tcws_scenario():
    """Generates a realistic demo cyclone approaching Luzon with Signals 1, 2, 3, and 4."""
    now = datetime.now(timezone.utc)
    meta = {
        'storm_name': 'ROSAL',
        'intl_name': 'CHAMPI',
        'bulletin_no': '1',
        'issued_str': '11:00 AM, 20 October 2026',
        'valid_str': 'Valid until next bulletin at 5:00 PM today',
        'track_points': [
            {'time_label': '10:00 AM', 'lon': 135.1, 'lat': 16.1, 'is_forecast': False},
            {'time_label': 'OCT 20 • 8 PM', 'lon': 133.1, 'lat': 16.9, 'is_forecast': True},
            {'time_label': 'OCT 21 • 8 AM', 'lon': 130.5, 'lat': 18.2, 'is_forecast': True},
            {'time_label': 'OCT 21 • 8 PM', 'lon': 128.2, 'lat': 19.5, 'is_forecast': True},
            {'time_label': 'OCT 22 • 8 AM', 'lon': 126.6, 'lat': 20.6, 'is_forecast': True},
            {'time_label': 'OCT 22 • 8 PM', 'lon': 125.7, 'lat': 21.5, 'is_forecast': True},
            {'time_label': 'OCT 23 • 8 AM', 'lon': 124.6, 'lat': 22.8, 'is_forecast': True},
            {'time_label': 'OCT 24 • 8 AM', 'lon': 123.8, 'lat': 26.3, 'is_forecast': True},
            {'time_label': 'OCT 25 • 8 AM', 'lon': 125.2, 'lat': 29.7, 'is_forecast': True}
        ],
        'signals': {
            1: parse_tcws_area_text(
                "Batanes, the eastern portion of Babuyan Islands (Babuyan Is., Camiguin Is., Didicas Is.), "
                "the eastern portion of mainland Cagayan (Santa Ana, Gonzaga, Lal-Lo, Santa Teresita, "
                "Camalaniugan, Aparri, Buguey, Gattaran, Baggao, Peñablanca), the northeastern portion "
                "of Isabela (Maconacon, Divilacan, Palanan, San Pablo, Cabagan, Santa Maria, Tumauini, Ilagan City), "
                "and the northeastern portion of Catanduanes (Pandan, Bagamanoc, Panganiban, Viga, Gigmoto)"
            )
        }
    }
    return meta


# ── Full-Bleed Map Extent Calculator (Warned Zones with Open-Sea Headroom) ────
def compute_broadcast_extent(assigned_groups, aspect_ratio='16x9', band_h=0.0):
    """
    Computes optimal map extent enclosing all active warning zones with generous
    ocean margins to guarantee that floating status and legend cards sit over open water.
    """
    all_lons = []
    all_lats = []

    for sig in [5, 4, 3, 2, 1]:
        for item in assigned_groups.get(sig, []):
            b = item['geometry'].bounds
            all_lons.extend([b[0], b[2]])
            all_lats.extend([b[1], b[3]])

    if not all_lons or not all_lats:
        # Default Philippine overview
        all_lons = [119.0, 126.0]
        all_lats = [12.0, 20.5]

    min_x = min(all_lons)
    max_x = max(all_lons)
    min_y = min(all_lats)
    max_y = max(all_lats)

    # Generous ocean margins so floating cards sit over open water
    extent_min_lon = max(112.0, min_x - 5.5)
    extent_max_lon = min(134.5, max_x + 6.5)
    extent_min_lat = max(4.0, min_y - 2.8)
    extent_max_lat = min(23.5, max_y + 1.8)

    span_x = extent_max_lon - extent_min_lon
    span_y = extent_max_lat - extent_min_lat

    target_ratios = {'16x9': 16.0 / 9.0, '4x3': 4.0 / 3.0, '4x5': 4.0 / 5.0, '1x1': 1.0}
    target_aspect = target_ratios.get(aspect_ratio, 16.0 / 9.0)
    if band_h > 0.0:
        target_aspect = target_aspect / max(0.1, (1.0 - band_h))

    mid_lat = (extent_min_lat + extent_max_lat) / 2.0
    cos_lat = math.cos(math.radians(mid_lat))

    current_ratio = (span_x * cos_lat) / max(span_y, 0.1)

    if current_ratio < target_aspect:
        needed_span_x = (span_y * target_aspect) / cos_lat
        diff_x = needed_span_x - span_x
        extent_min_lon = max(110.0, extent_min_lon - diff_x * 0.5)
        extent_max_lon = min(136.0, extent_max_lon + diff_x * 0.5)
    else:
        needed_span_y = (span_x * cos_lat) / target_aspect
        diff_y = needed_span_y - span_y
        extent_min_lat = max(3.5, extent_min_lat - diff_y * 0.5)
        extent_max_lat = min(24.5, extent_max_lat + diff_y * 0.5)

    return [extent_min_lon, extent_max_lon, extent_min_lat, extent_max_lat]


# ── Television Broadcast Map Renderer ─────────────────────────────────────────
def render_tcws_broadcast_graphic(meta, assigned_groups, muni_list, provinces_list,
                                  output_img="public/images/tropical_signal_warning.png",
                                  format_preset="16x9"):
    """
    Renders a broadcast-quality TV weather briefing graphic for Tropical Cyclone
    Wind Signals in effect according to official PAGASA standards.
    """
    output_path = Path(output_img)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    layout = LAYOUT_CONFIGS.get(format_preset, LAYOUT_CONFIGS['16x9'])
    figsize = layout['figsize']
    dpi = layout['dpi']
    font_scale = layout['font_scale']

    fig = plt.figure(figsize=figsize, dpi=dpi)
    fig.patch.set_facecolor(OCEAN_COLOR)

    # 1. Full-Bleed Map Canvas (Clipped strictly below the solid flat header band)
    band_h = layout.get('band_h', 0.092)
    ax = fig.add_axes([0.0, 0.0, 1.0, 1.0 - band_h], projection=ccrs.PlateCarree())
    for spine in ax.spines.values():
        spine.set_visible(False)

    extent = compute_broadcast_extent(assigned_groups, aspect_ratio=format_preset, band_h=band_h)
    ax.set_extent(extent, crs=ccrs.PlateCarree())
    ax.set_aspect('auto')
    ax.set_facecolor(OCEAN_COLOR)

    min_lon, max_lon, min_lat, max_lat = extent

    # 2. High-Contrast Base Cartography (Dark halo casing under lighter boundary)
    ax.add_feature(cfeature.LAND, facecolor=LAND_COLOR, edgecolor='none', zorder=1)
    ax.add_feature(cfeature.COASTLINE, edgecolor=COAST_CASING, linewidth=2.4, zorder=2.0)
    ax.add_feature(cfeature.COASTLINE, edgecolor=COAST_EDGE, linewidth=1.1, zorder=2.1)
    ax.add_feature(cfeature.BORDERS, edgecolor='#3b4d66', linewidth=0.7, linestyle=':', zorder=2.2)

    # Inactive municipality grid (subtle, simplified)
    for item in muni_list:
        poly = item['geometry']
        b = poly.bounds
        if b[2] < min_lon or b[0] > max_lon or b[3] < min_lat or b[1] > max_lat:
            continue
        try:
            poly_simple = poly.simplify(0.008, preserve_topology=False)
            geoms = [poly_simple] if poly_simple.geom_type == 'Polygon' else list(poly_simple.geoms)
            for g in geoms:
                x, y = g.exterior.xy
                ax.fill(x, y, facecolor=MUNI_DEFAULT, edgecolor=MUNI_EDGE,
                        linewidth=0.35, alpha=0.45, transform=ccrs.PlateCarree(), zorder=2.3)
        except Exception:
            pass

    # 3. Color-Coded Active Municipalities (Strict inland coverage, zero ocean halo bleed)
    for sig in [1, 2, 3, 4, 5]:
        items = assigned_groups.get(sig, [])
        if not items:
            continue
        cfg = TCWS_LEVELS[sig]
        fill_c = cfg['fill_color']
        border_c = cfg['border_color']
        alpha_v = cfg['alpha']

        for item in items:
            poly = item['geometry']
            geoms = [poly] if poly.geom_type == 'Polygon' else list(poly.geoms)
            for g in geoms:
                x, y = g.exterior.xy
                ax.fill(x, y, facecolor=fill_c, edgecolor=border_c,
                        linewidth=0.75, alpha=alpha_v, transform=ccrs.PlateCarree(), zorder=3.5)

    # 4. Provincial Boundaries
    for prov in provinces_list:
        poly = prov['geometry']
        b = poly.bounds
        if b[2] < min_lon or b[0] > max_lon or b[3] < min_lat or b[1] > max_lat:
            continue
        geoms = [poly] if poly.geom_type == 'Polygon' else list(poly.geoms)
        for g in geoms:
            x, y = g.exterior.xy
            ax.plot(x, y, color=PROVINCE_EDGE, linewidth=1.0,
                    transform=ccrs.PlateCarree(), zorder=4.0)

    # 5. PAR Boundary (Solid orange line)
    ax.plot(PAR_LONS, PAR_LATS, color=PAR_COLOR, linewidth=1.8, linestyle='-',
            transform=ccrs.PlateCarree(), zorder=4.2, alpha=0.92)

    all_card_rects = [layout['top_card'], layout['legend_card'], [0.0, 1.0 - band_h, 1.0, band_h]]
    occupied_label_boxes = []

    # 7. City Pins & Labels with Strict Collision Rejection
    affected_muni_geoms = []
    for sig in [5, 4, 3, 2, 1]:
        for item in assigned_groups.get(sig, []):
            affected_muni_geoms.append(item['geometry'])

    hazard_union = unary_union(affected_muni_geoms) if affected_muni_geoms else None

    placed_city_points = []
    for c in MAJOR_CITIES:
        cx, cy = c['lon'], c['lat']
        if not (min_lon + 0.4 <= cx <= max_lon - 0.4 and min_lat + 0.4 <= cy <= max_lat - 0.4):
            continue

        pt_display = ax.transData.transform((cx, cy))
        pt_fig = fig.transFigure.inverted().transform(pt_display)
        fx, fy = pt_fig[0], pt_fig[1]

        under_card = any(is_point_inside_rect(fx, fy, rect, margin=0.035) for rect in all_card_rects)
        if under_card:
            continue

        c_pt = Point(cx, cy)
        is_relevant = False
        if hazard_union and not hazard_union.is_empty:
            if hazard_union.distance(c_pt) < 0.60:
                is_relevant = True
        else:
            is_relevant = True

        if not is_relevant:
            continue

        if any(abs(cx - ox) < 0.65 and abs(cy - oy) < 0.35 for ox, oy, _, _ in occupied_label_boxes):
            continue

        cand_offsets = [
            (cx + 0.08, cy + 0.035, 'left', 'bottom'),
            (cx - 0.08, cy + 0.035, 'right', 'bottom'),
            (cx + 0.08, cy - 0.045, 'left', 'top'),
            (cx - 0.08, cy - 0.045, 'right', 'top'),
        ]

        best_cand = None
        for tx, ty, ha, va in cand_offsets:
            if any(abs(tx - ox) < 0.65 and abs(ty - oy) < 0.35 for ox, oy, _, _ in occupied_label_boxes):
                continue
            if any(math.hypot(tx - px, ty - py) < 0.38 for px, py in placed_city_points):
                continue
            best_cand = (tx, ty, ha, va)
            break

        if not best_cand:
            continue

        tx, ty, ha, va = best_cand
        placed_city_points.append((tx, ty))

        ax.plot(cx, cy, marker='o', markersize=3.6, color='#f8fafc',
                markeredgecolor='#070e1c', markeredgewidth=1.3,
                transform=ccrs.PlateCarree(), zorder=5.3)

        t_city = ax.text(tx, ty, c['name'], color='#ffffff',
                         fontsize=8.5 * font_scale, fontweight='heavy',
                         ha=ha, va=va, transform=ccrs.PlateCarree(), zorder=5.4)
        t_city.set_path_effects([
            path_effects.withStroke(linewidth=3.6, foreground='#070e1c', alpha=0.98)
        ])

    # 8. Solid Flat Header Band & Split Subtitle
    storm_title = meta.get('storm_name', 'Cyclone')
    issued_text = meta.get('issued_str', '')
    bulletin_num = meta.get('bulletin_no', '1')

    band_y = 1.0 - band_h

    # 8.1 Flat solid dark band across top
    header_band = mpatches.Rectangle((0.0, band_y), 1.0, band_h,
                                     facecolor='#09101d', edgecolor='none',
                                     transform=fig.transFigure, zorder=30)
    fig.patches.append(header_band)

    # 8.2 Hairline divider at bottom edge of header band
    fig.lines.append(plt.Line2D([0.0, 1.0], [band_y, band_y],
                                color=DIVIDER_COLOR, linewidth=1.2,
                                transform=fig.transFigure, zorder=31))

    # 8.3 Brand Logo on far right
    user_logo_paths = [
        BASE_DIR / "public" / "images" / "logo.png",
        BASE_DIR / "public" / "logo512.png",
        BASE_DIR / "public" / "logo192.png",
    ]
    found_logo = next((p for p in user_logo_paths if p.exists()), None)
    logo_h = 0.068 * (band_h / 0.092)
    logo_w = logo_h * (figsize[1] / figsize[0])
    logo_x = 0.975 - logo_w
    logo_y = band_y + (band_h - logo_h) / 2.0

    if found_logo:
        try:
            logo_img = mpimg.imread(str(found_logo))
            logo_ax = fig.add_axes([logo_x, logo_y, logo_w, logo_h], zorder=40)
            logo_ax.imshow(logo_img)
            logo_ax.axis('off')
        except Exception:
            draw_vector_cyclone_symbol(fig, cx=logo_x + logo_w / 2.0, cy=band_y + band_h / 2.0,
                                       radius=logo_h * 0.45, color="#38bdf8", lw=2.2)
    else:
        draw_vector_cyclone_symbol(fig, cx=logo_x + logo_w / 2.0, cy=band_y + band_h / 2.0,
                                   radius=logo_h * 0.45, color="#38bdf8", lw=2.2)

    # 8.4 Main Title: Sentence Case ("Wind Signal Warning due to Tropical Cyclone Rosal")
    storm_sentence = storm_title.capitalize()
    full_title = f"Wind Signal Warning due to Tropical Cyclone {storm_sentence}"

    title_x = 0.030
    title_y = 1.0 - (0.036 * (band_h / 0.092))
    curr_title_size = layout.get('title_size', 17.5) * font_scale

    max_title_w = logo_x - title_x - 0.025
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    t_measure = fig.text(0, 0, full_title, fontsize=curr_title_size, fontweight='heavy', alpha=0)
    try:
        t_w = t_measure.get_window_extent(renderer=renderer).transformed(fig.transFigure.inverted()).width
        while t_w > max_title_w and curr_title_size > 10.0:
            curr_title_size -= 0.5
            t_measure.set_fontsize(curr_title_size)
            t_w = t_measure.get_window_extent(renderer=renderer).transformed(fig.transFigure.inverted()).width
    except Exception:
        if len(full_title) > 48:
            curr_title_size *= 0.82
        elif len(full_title) > 38:
            curr_title_size *= 0.90
    t_measure.remove()

    fig.text(title_x, title_y, full_title,
             color=TEXT_WHITE, fontsize=curr_title_size,
             fontweight='heavy', fontfamily=FONT_FAMILY, va='center', zorder=35)

    # 8.5 Split Subtitle: Time string -> Bulletin Chip -> Source text
    clean_issued = issued_text.replace(" on ", ", ").replace(" ON ", ", ").strip()
    time_str = f"Updated {clean_issued}" if not clean_issued.lower().startswith("updated") else clean_issued
    sub_y = 1.0 - (0.068 * (band_h / 0.092))
    sub_font_size = layout.get('sub_size', 9.2) * font_scale

    t_time = fig.text(title_x, sub_y, time_str,
                      color=TEXT_MUTED, fontsize=sub_font_size,
                      fontweight='medium', fontfamily=FONT_FAMILY, va='center', zorder=35)

    try:
        bbox_time = t_time.get_window_extent(renderer=renderer).transformed(fig.transFigure.inverted())
        chip_x = bbox_time.x1 + 0.010 * (16.0 / figsize[0])
    except Exception:
        chip_x = title_x + (len(time_str) * 0.0052 * font_scale * (16.0 / figsize[0])) + 0.010

    # Bulletin Chip
    chip_text = f"Bulletin #{bulletin_num}"
    t_chip_measure = fig.text(0, 0, chip_text, fontsize=sub_font_size * 0.95, fontweight='bold', alpha=0)
    try:
        b_w = t_chip_measure.get_window_extent(renderer=renderer).transformed(fig.transFigure.inverted()).width
    except Exception:
        b_w = 0.045 * (16.0 / figsize[0])
    t_chip_measure.remove()

    chip_pad_x = 0.009 * (16.0 / figsize[0])
    chip_w = b_w + 2 * chip_pad_x
    chip_h = 0.022 * (band_h / 0.092)
    chip_y = sub_y - chip_h / 2.0

    bulletin_chip = FancyBboxPatch((chip_x, chip_y), chip_w, chip_h,
                                   boxstyle="round,pad=0.001,rounding_size=0.006",
                                   facecolor='#141f30', edgecolor='#293b54', linewidth=1.1,
                                   transform=fig.transFigure, zorder=35)
    fig.patches.append(bulletin_chip)

    fig.text(chip_x + chip_w / 2.0, sub_y, chip_text,
             color='#e2e8f0', fontsize=sub_font_size * 0.95,
             fontweight='bold', fontfamily=FONT_FAMILY, ha='center', va='center', zorder=36)

    # Source Text after chip
    source_x = chip_x + chip_w + 0.011 * (16.0 / figsize[0])
    fig.text(source_x, sub_y, "DOST-PAGASA TCWS",
             color=TEXT_MUTED, fontsize=sub_font_size,
             fontweight='medium', fontfamily=FONT_FAMILY, va='center', zorder=35)

    # 9. Top-Right Floating Card: Active Wind Signals in Effect & Tier Scale
    top_rect = layout['top_card']
    top_x, top_y, top_w, top_h = top_rect
    c_bg = FancyBboxPatch((top_x, top_y), top_w, top_h,
                          boxstyle="round,pad=0.002,rounding_size=0.014",
                          facecolor=CARD_BG, edgecolor=CARD_BORDER, linewidth=1.5,
                          transform=fig.transFigure, zorder=10)
    fig.patches.append(c_bg)

    pad_tx = 0.014 * (top_w / 0.245)
    h_rel = top_h / 0.220
    w_rel = top_w / 0.245

    # 9.1 Line 1: Header caption
    y_caption = top_y + top_h - (0.024 * h_rel)
    fig.text(top_x + pad_tx, y_caption,
             "Tropical cyclone wind signals in effect",
             color=TEXT_MUTED, fontsize=8.6 * font_scale, fontweight='medium', zorder=11)

    # 9.2 Line 2: Card Title
    y_title = top_y + top_h - (0.058 * h_rel)
    fig.text(top_x + pad_tx, y_title,
             "Signal Warnings",
             color=TEXT_WHITE, fontsize=18.5 * font_scale, fontweight='heavy', zorder=11)

    # 9.3 Line 3: Active Chips & Label Text
    # Ordered left to right: Signal 5 -> Signal 4 -> Signal 3 -> Signal 2 -> Signal 1
    ALL_SIGNALS = [5, 4, 3, 2, 1]
    active_signals = [s for s in ALL_SIGNALS if len(assigned_groups.get(s, [])) > 0]
    num_act = len(active_signals)

    y_chips = top_y + top_h - (0.098 * h_rel)
    chip_h = 0.028 * h_rel
    curr_chip_x = top_x + pad_tx

    if not active_signals:
        no_chip_w = 0.095 * w_rel
        p = FancyBboxPatch((curr_chip_x, y_chips), no_chip_w, chip_h,
                           boxstyle="round,pad=0.001,rounding_size=0.007",
                           facecolor='#263345', edgecolor='none',
                           transform=fig.transFigure, zorder=12)
        fig.patches.append(p)
        fig.text(curr_chip_x + no_chip_w / 2.0, y_chips + chip_h / 2.0,
                 "No signals in effect", color='#94a3b8', fontsize=7.8 * font_scale,
                 fontweight='bold', ha='center', va='center', zorder=13)
    else:
        label_text = "signals in effect" if num_act >= 2 else "signal in effect"

        if num_act <= 2:
            chip_w = 0.052 * w_rel
            chip_gap = 0.0055 * w_rel
            for s_num in active_signals:
                s_cfg = TCWS_LEVELS[s_num]
                p = FancyBboxPatch((curr_chip_x, y_chips), chip_w, chip_h,
                                   boxstyle="round,pad=0.001,rounding_size=0.007",
                                   facecolor=s_cfg['badge_bg'], edgecolor='none',
                                   transform=fig.transFigure, zorder=12)
                fig.patches.append(p)
                fig.text(curr_chip_x + chip_w / 2.0, y_chips + chip_h / 2.0,
                         s_cfg['label'], color=s_cfg['badge_fg'], fontsize=8.4 * font_scale,
                         fontweight='heavy', ha='center', va='center', zorder=13)
                curr_chip_x += chip_w + chip_gap

            fig.text(curr_chip_x + (0.003 * w_rel), y_chips + chip_h / 2.0,
                     label_text, color=TEXT_WHITE, fontsize=10.5 * font_scale,
                     fontweight='heavy', va='center', zorder=12)
        else:
            chip_w = 0.042 * w_rel
            chip_gap = 0.0040 * w_rel
            for s_num in active_signals:
                s_cfg = TCWS_LEVELS[s_num]
                p = FancyBboxPatch((curr_chip_x, y_chips), chip_w, chip_h,
                                   boxstyle="round,pad=0.001,rounding_size=0.006",
                                   facecolor=s_cfg['badge_bg'], edgecolor='none',
                                   transform=fig.transFigure, zorder=12)
                fig.patches.append(p)
                fig.text(curr_chip_x + chip_w / 2.0, y_chips + chip_h / 2.0,
                         s_cfg['short_label'], color=s_cfg['badge_fg'], fontsize=7.8 * font_scale,
                         fontweight='heavy', ha='center', va='center', zorder=13)
                curr_chip_x += chip_w + chip_gap

            fig.text(curr_chip_x + (0.003 * w_rel), y_chips + chip_h / 2.0,
                     label_text, color=TEXT_WHITE, fontsize=9.6 * font_scale,
                     fontweight='heavy', va='center', zorder=12)

    # 9.4 Highest-Tier Tag (Shown ONLY when 2+ tiers active, placed above most severe active segment)
    scale_y = top_y + (0.058 * h_rel)
    scale_h = 0.0060 * h_rel
    scale_total_w = top_w - 2 * pad_tx
    seg_gap = 0.0035 * w_rel
    seg_w = (scale_total_w - 4 * seg_gap) / 5.0

    if num_act >= 2:
        highest_active = active_signals[0]
        highest_idx = ALL_SIGNALS.index(highest_active)
        high_x = top_x + pad_tx + highest_idx * (seg_w + seg_gap) + seg_w / 2.0
        high_color = TCWS_LEVELS[highest_active]['badge_bg']
        fig.text(high_x, scale_y + scale_h + (0.008 * h_rel),
                 "Highest tier", color=high_color, fontsize=7.6 * font_scale,
                 fontweight='heavy', ha='center', va='bottom', zorder=12)

    # 9.5 5-Segment Scale Bar (Signal 5, 4, 3, 2, 1) & Labels
    for i, s_num in enumerate(ALL_SIGNALS):
        seg_x = top_x + pad_tx + i * (seg_w + seg_gap)
        is_act = (s_num in active_signals)
        s_cfg = TCWS_LEVELS[s_num]
        c_fill = s_cfg['badge_bg'] if is_act else s_cfg['dim_bg']

        seg_patch = FancyBboxPatch((seg_x, scale_y), seg_w, scale_h,
                                   boxstyle="round,pad=0.0005,rounding_size=0.0028",
                                   facecolor=c_fill, edgecolor='none',
                                   transform=fig.transFigure, zorder=12)
        fig.patches.append(seg_patch)

        lbl_color = TEXT_WHITE if is_act else '#55647a'
        lbl_weight = 'heavy' if is_act else 'bold'
        fig.text(seg_x + seg_w / 2.0, scale_y - (0.009 * h_rel),
                 s_cfg['short_label'], color=lbl_color, fontsize=7.6 * font_scale,
                 fontweight=lbl_weight, ha='center', va='top', zorder=12)

    # 9.6 Divider Line & Footer with Total Municipalities Count
    divider_y = top_y + (0.030 * h_rel)
    fig.lines.append(plt.Line2D([top_x + pad_tx, top_x + top_w - pad_tx], [divider_y, divider_y],
                                color=DIVIDER_COLOR, linewidth=1.0, transform=fig.transFigure, zorder=11))

    total_warned_munis = sum(len(v) for v in assigned_groups.values())
    y_foot = top_y + (0.015 * h_rel)
    fig.text(top_x + pad_tx, y_foot,
             f"{total_warned_munis} municipalities under warning",
             color=TEXT_MUTED, fontsize=7.4 * font_scale, fontweight='heavy', va='center', zorder=11)

    fig.text(top_x + top_w - pad_tx, y_foot,
             "DOST-PAGASA TCWS",
             color=TEXT_MUTED, fontsize=7.4 * font_scale, fontweight='heavy', ha='right', va='center', zorder=11)

    # 10. Bottom-Left Floating Card: "What the wind signals mean"
    bl_rect = layout['legend_card']
    bl_x, bl_y, bl_w, bl_h = bl_rect

    bl_bg = FancyBboxPatch((bl_x, bl_y), bl_w, bl_h,
                           boxstyle="round,pad=0.002,rounding_size=0.014",
                           facecolor=CARD_BG, edgecolor=CARD_BORDER, linewidth=1.5,
                           transform=fig.transFigure, zorder=10)
    fig.patches.append(bl_bg)

    pad_x = 0.015 * (bl_w / 0.340)
    fig.text(bl_x + pad_x, bl_y + bl_h - (0.024 * (bl_h / 0.285)),
             "What the wind signals mean", color=TEXT_WHITE,
             fontsize=13.2 * font_scale, fontweight='heavy', zorder=11)

    divider_y = bl_y + bl_h - (0.038 * (bl_h / 0.285))
    fig.lines.append(plt.Line2D([bl_x + pad_x, bl_x + bl_w - pad_x], [divider_y, divider_y],
                                color=DIVIDER_COLOR, linewidth=1.0, transform=fig.transFigure, zorder=11))

    # 5 Signal Tier Rows (Signal 5 down to 1)
    tier_order = [5, 4, 3, 2, 1]
    row_pad_x = 0.010 * (bl_w / 0.340)
    row_w = bl_w - 2 * row_pad_x
    row_h = 0.034 * (bl_h / 0.285)
    row_gap = 0.0055 * (bl_h / 0.285)
    row_step = row_h + row_gap
    y_top_row = divider_y - (0.010 * (bl_h / 0.285)) - row_h

    for idx, s_num in enumerate(tier_order):
        row_y = y_top_row - idx * row_step
        row_x = bl_x + row_pad_x
        s_cfg = TCWS_LEVELS[s_num]
        is_active = (s_num in active_signals)

        # If active, draw outer highlight outline border
        if is_active:
            row_outline = FancyBboxPatch((row_x, row_y), row_w, row_h,
                                         boxstyle="round,pad=0.001,rounding_size=0.008",
                                         facecolor='none', edgecolor=s_cfg['border_color'], linewidth=1.3,
                                         transform=fig.transFigure, zorder=11)
            fig.patches.append(row_outline)

        # Badge pill
        badge_w = 0.065 * (bl_w / 0.340)
        badge_h = 0.027 * (bl_h / 0.285)
        badge_x = row_x + (0.004 * (bl_w / 0.340))
        badge_y = row_y + (row_h - badge_h) / 2.0

        b_bg = s_cfg['badge_bg'] if is_active else s_cfg['dim_bg']
        b_fg = s_cfg['badge_fg'] if is_active else s_cfg['dim_fg']

        badge_patch = FancyBboxPatch((badge_x, badge_y), badge_w, badge_h,
                                     boxstyle="round,pad=0.001,rounding_size=0.007",
                                     facecolor=b_bg, edgecolor='none',
                                     transform=fig.transFigure, zorder=12)
        fig.patches.append(badge_patch)

        fig.text(badge_x + badge_w / 2.0, badge_y + badge_h / 2.0,
                 s_cfg['label'], color=b_fg, fontsize=8.6 * font_scale,
                 fontweight='heavy', ha='center', va='center', zorder=13)

        # Description Lines
        text_x = badge_x + badge_w + (0.012 * (bl_w / 0.340))
        line1_color = '#ffffff' if is_active else '#55647a'
        line2_color = '#cbd5e1' if is_active else '#3b4b5e'
        line1_weight = 'heavy' if is_active else 'bold'

        fig.text(text_x, row_y + row_h * 0.66,
                 s_cfg['line1'], color=line1_color, fontsize=8.2 * font_scale,
                 fontweight=line1_weight, va='center', zorder=12)

        fig.text(text_x, row_y + row_h * 0.26,
                 s_cfg['line2'], color=line2_color, fontsize=7.6 * font_scale,
                 fontweight='medium', va='center', zorder=12)

    # Footnote at bottom
    foot_y = bl_y + (0.015 * (bl_h / 0.285))
    icon_w = 0.008 * (bl_w / 0.340)
    icon_h = 0.011 * (bl_h / 0.285)
    icon_x = bl_x + (0.015 * (bl_w / 0.340))
    icon_y = foot_y - icon_h / 2.0

    foot_icon = FancyBboxPatch((icon_x, icon_y), icon_w, icon_h,
                               boxstyle="round,pad=0.0005,rounding_size=0.0028",
                               facecolor='none', edgecolor='#64748b', linewidth=1.1,
                               transform=fig.transFigure, zorder=11)
    fig.patches.append(foot_icon)

    fig.text(icon_x + icon_w + (0.005 * (bl_w / 0.340)), foot_y,
             "Outlined signals are active in this bulletin. Dimmed signals are not raised.",
             color='#8595ac', fontsize=7.4 * font_scale, fontweight='medium', va='center', zorder=11)

    # Save cleanly with explicit facecolor, NO bbox_inches="tight"
    plt.savefig(str(output_path), dpi=dpi, facecolor=OCEAN_COLOR, edgecolor='none')
    plt.close(fig)
    print(f"Successfully generated Tropical Cyclone Signal Warning map -> {output_path}")
    return str(output_path)


# ── Main Orchestrator & CLI ───────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="DOST-PAGASA Tropical Cyclone Wind Signal (TCWS) Warning Map Generator"
    )
    parser.add_argument('--list', action='store_true',
                        help="List all available TCB PDFs from PAGASA")
    parser.add_argument('--pdf', type=str, default=None,
                        help="Specific PDF file name (e.g. TCB#1_rosal.pdf) or URL or 'latest'")
    parser.add_argument('--demo', action='store_true',
                        help="Generate high-definition demo graphic using simulated Rosal data")
    parser.add_argument('--format', type=str, default='16x9', choices=['16x9', '4x3', '4x5', '1x1'],
                        help="Aspect ratio format preset (default: 16x9)")
    parser.add_argument('--output', type=str, default="public/images/tropical_signal_warning.png",
                        help="Target output image path (default: public/images/tropical_signal_warning.png)")
    parser.add_argument('--export-json', type=str, default="public/data/tcws_latest_warning.json",
                        help="Save extracted warning data as JSON for web application")

    args = parser.parse_args()

    # 1. List Mode
    if args.list:
        print(f"Fetching available TCB PDFs from {TCB_INDEX_URL}...")
        pdfs = fetch_available_tcb_pdfs()
        print(f"\nFound {len(pdfs)} Tropical Cyclone Bulletins:")
        for idx, p in enumerate(pdfs, 1):
            print(f"  [{idx:3d}] {p.replace('%23', '#')}")
        print("\nTo generate a warning graphic from any bulletin above, run:")
        print("  python tropical_signal_warning.py --pdf <FILENAME>")
        return 0

    # 2. Administrative Boundaries
    print("Loading Philippine administrative boundaries...")
    muni_hierarchy, muni_list, provinces_list = load_ph_administrative_data()

    # 3. Demo Mode
    if args.demo:
        print(f"Generating DEMO scenario in {args.format} format...")
        meta = generate_demo_tcws_scenario()
        assigned_groups = assign_signals_to_municipalities(meta['signals'], muni_hierarchy)
        render_tcws_broadcast_graphic(
            meta=meta,
            assigned_groups=assigned_groups,
            muni_list=muni_list,
            provinces_list=provinces_list,
            output_img=args.output,
            format_preset=args.format
        )
        return 0

    # 4. Resolve Target PDF
    pdf_target = args.pdf
    if not pdf_target or pdf_target.lower() == 'latest':
        # Check if local TCB#1_rosal.pdf exists in temp_data first
        local_rosal = BASE_DIR / "temp_data" / "TCB#1_rosal.pdf"
        if local_rosal.exists():
            pdf_target = str(local_rosal)
            print(f"Defaulting to local test bulletin: {pdf_target}")
        else:
            print("Locating available bulletins on PAGASA server...")
            available = fetch_available_tcb_pdfs()
            if not available:
                print("No remote PDFs reachable. Falling back to demo scenario.")
                meta = generate_demo_tcws_scenario()
                assigned_groups = assign_signals_to_municipalities(meta['signals'], muni_hierarchy)
                render_tcws_broadcast_graphic(meta, assigned_groups, muni_list, provinces_list,
                                              output_img=args.output, format_preset=args.format)
                return 0
            pdf_target = available[-1]
            print(f"Defaulting to latest bulletin: {pdf_target}")

    if pdf_target.isdigit():
        available = fetch_available_tcb_pdfs()
        idx = int(pdf_target) - 1
        if 0 <= idx < len(available):
            pdf_target = available[idx]
        else:
            print(f"Invalid index {pdf_target}. Available 1 to {len(available)}")
            return 1

    pdf_path = download_tcb_pdf(pdf_target)

    # 5. Parse Bulletin Data
    print(f"Parsing Tropical Cyclone Bulletin: {pdf_path}...")
    meta = parse_tcb_pdf_data(pdf_path)
    print(f"Storm: {meta['storm_name']} (Intl: {meta['intl_name']}) | Bulletin #{meta['bulletin_no']} | Issued: {meta['issued_str']}")
    print(f"Signals found in text: {list(meta['signals'].keys())}")

    # 6. Intersect & Assign
    assigned_groups = assign_signals_to_municipalities(meta['signals'], muni_hierarchy)
    total_warned = sum(len(v) for v in assigned_groups.values())
    breakdown_str = ", ".join(f"Signal {k}: {len(v)}" for k, v in sorted(assigned_groups.items(), reverse=True) if len(v) > 0)
    print(f"Total municipalities under warning: {total_warned} ({breakdown_str})")

    # 7. Render Graphic
    output_path = render_tcws_broadcast_graphic(
        meta=meta,
        assigned_groups=assigned_groups,
        muni_list=muni_list,
        provinces_list=provinces_list,
        output_img=args.output,
        format_preset=args.format
    )

    # 8. Export JSON Metadata
    if args.export_json:
        export_file = Path(args.export_json)
        export_file.parent.mkdir(parents=True, exist_ok=True)

        highest_signal = max([s for s in assigned_groups if len(assigned_groups[s]) > 0], default=0)

        affected_munis_by_signal = {}
        for s in [5, 4, 3, 2, 1]:
            s_items = assigned_groups.get(s, [])
            prov_muni_map = {}
            for it in s_items:
                p_name = it['province']
                m_name = it['name'].replace('\ufffd', 'ñ')
                if p_name not in prov_muni_map:
                    prov_muni_map[p_name] = []
                prov_muni_map[p_name].append(m_name)
            for p_name in prov_muni_map:
                prov_muni_map[p_name].sort()
            affected_munis_by_signal[f"Signal_{s}"] = prov_muni_map

        export_payload = {
            'storm_name': meta['storm_name'],
            'intl_name': meta['intl_name'],
            'bulletin_no': meta['bulletin_no'],
            'issued_str': meta['issued_str'],
            'valid_str': meta['valid_str'],
            'highest_signal': highest_signal,
            'image_url': '/' + str(output_path).replace('\\', '/').lstrip('/'),
            'total_municipalities_under_warning': total_warned,
            'summary_counts': {f"Signal_{k}": len(v) for k, v in assigned_groups.items()},
            'affected_provinces': {
                f"Signal_{s}": sorted(list(set(it['province'] for it in items)))
                for s, items in assigned_groups.items()
            },
            'affected_municipalities': affected_munis_by_signal
        }
        with open(export_file, 'w', encoding='utf-8') as jf:
            json.dump(export_payload, jf, indent=2)
        print(f"Exported JSON metadata -> {export_file}")

    return 0


if __name__ == '__main__':
    sys.exit(main())
