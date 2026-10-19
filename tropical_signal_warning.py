#!/usr/bin/env python3
"""
tropical_signal_warning.py
==========================
Automated Tropical Cyclone Wind Signal (TCWS) Warning Map Generator.

Computes forward-looking wind hazard corridors according to official
DOST-PAGASA lead-time standards:
  - TCWS #1: Strong winds (39-61 km/h)      -> Within 36 hours
  - TCWS #2: Gale-force winds (62-88 km/h)   -> Within 24 hours
  - TCWS #3: Storm-force winds (89-117 km/h) -> Within 18 hours
  - TCWS #4: Typhoon-force (118-184 km/h)   -> Within 12 hours
  - TCWS #5: Super Typhoon (>=185 km/h)     -> Within 12 hours

Spatially intersects the threat swaths against 1,647 Philippine municipalities
(or 82 provinces) from ph_municipalities.json / ph_provinces.json and renders
a TV-broadcast graphic with Himawari-9 live satellite clouds.
"""

import os
import sys
import io
import json
import math
import argparse
import urllib.request
from datetime import datetime, timezone, timedelta

import numpy as np
import pandas as pd
from PIL import Image

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.patheffects as path_effects
from matplotlib.patches import FancyBboxPatch
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import cartopy.io.img_tiles as cimgt
import requests

from shapely.geometry import shape, Point, Polygon
from shapely.ops import unary_union

# ── TV Broadcast Dark Theme Styling ───────────────────────────────────────────
BG_DARK        = "#0b131e"   # Deep broadcast backdrop canvas
OCEAN_COLOR    = "#0f172a"   # Deep Navy TV ocean
LAND_COLOR     = "#1e293b"   # Slate-Dark terrain
LAND_EDGE      = "#475569"   # Crisp coastline border
BORDER_EDGE    = "#64748b"   # International borders
PROVINCE_EDGE  = "#334155"   # Subtle province boundaries
PAR_COLOR      = "#f97316"   # PAGASA PAR Boundary Accent (Vivid Orange)
GRID_COLOR     = "#1e293b"   # Gridlines
GRID_TEXT      = "#64748b"   # Coordinate labels

HEADER_BG      = "#08172b"   # Glassmorphism header card
CARD_BG        = "#091424"   # Floating sidebar surface card
CARD_BORDER    = "#1e293b"   # Card border accent

TEXT_PRI       = "#f8fafc"   # Pure crisp white
TEXT_SEC       = "#94a3b8"   # Slate secondary
TEXT_MUT       = "#64748b"   # Slate muted

# ── PAGASA TCWS Palette & Specifications ──────────────────────────────────────
TCWS_LEVELS = {
    1: {
        'name': 'Signal No. 1',
        'desc': 'Strong Winds (39–61 km/h)',
        'lead_h': 36,
        'min_kt': 21.0,
        'color': '#00d2ff',    # Electric Sky Blue
        'border': '#38bdf8',
        'alpha': 0.65,
        'label': 'TCWS #1 (39-61 km/h | 36h)'
    },
    2: {
        'name': 'Signal No. 2',
        'desc': 'Gale-force Winds (62–88 km/h)',
        'lead_h': 24,
        'min_kt': 34.0,
        'color': '#facc15',    # Bright Amber / Yellow
        'border': '#fde047',
        'alpha': 0.70,
        'label': 'TCWS #2 (62-88 km/h | 24h)'
    },
    3: {
        'name': 'Signal No. 3',
        'desc': 'Storm-force Winds (89–117 km/h)',
        'lead_h': 18,
        'min_kt': 48.0,
        'color': '#fb923c',    # Vivid Orange
        'border': '#fdba74',
        'alpha': 0.75,
        'label': 'TCWS #3 (89-117 km/h | 18h)'
    },
    4: {
        'name': 'Signal No. 4',
        'desc': 'Typhoon-force Winds (118–184 km/h)',
        'lead_h': 12,
        'min_kt': 64.0,
        'color': '#ef4444',    # Typhoon Crimson
        'border': '#f87171',
        'alpha': 0.80,
        'label': 'TCWS #4 (118-184 km/h | 12h)'
    },
    5: {
        'name': 'Signal No. 5',
        'desc': 'Super Typhoon Winds (≥185 km/h)',
        'lead_h': 12,
        'min_kt': 100.0,
        'color': '#c084fc',    # Radiant Magenta / Violet
        'border': '#e879f9',
        'alpha': 0.85,
        'label': 'TCWS #5 (≥185 km/h | 12h)'
    }
}

# PAGASA Area of Responsibility (PAR) Boundary Coordinates
PAR_LONS = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
PAR_LATS = [ 5.0,  15.0,  21.0,  25.0,  25.0,   5.0,   5.0]

# ── Himawari Satellite Cloud Tile Provider ─────────────────────────────────────
_SAT_SESSION = requests.Session()
_SAT_ADAPTER = requests.adapters.HTTPAdapter(pool_connections=15, pool_maxsize=15, max_retries=2)
_SAT_SESSION.mount('https://', _SAT_ADAPTER)
_SAT_SESSION.mount('http://', _SAT_ADAPTER)

def get_latest_satellite_time():
    """Dynamically locates the latest 10-minute Himawari-9 satellite scan."""
    now = datetime.now(timezone.utc)
    for offset_mins in [15, 20, 25, 30, 40, 50, 60]:
        t = now - timedelta(minutes=offset_mins)
        mins = (t.minute // 10) * 10
        t_aligned = t.replace(minute=mins, second=0, microsecond=0)
        d_str = t_aligned.strftime('%Y-%m-%d')
        tm_str = f"{t_aligned.hour:02d}{t_aligned.minute:02d}"
        url = f"https://tiles.zoom.earth/geocolor/himawari/{d_str}/{tm_str}/6/28/53.jpg"
        try:
            r = _SAT_SESSION.get(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': 'https://zoom.earth/',
                'Origin': 'https://zoom.earth'
            }, timeout=3.0)
            if r.status_code == 200 and len(r.content) > 1000:
                return t_aligned
        except Exception:
            pass

    t = now - timedelta(minutes=40)
    mins = (t.minute // 10) * 10
    return t.replace(minute=mins, second=0, microsecond=0)

def isolate_clouds_geocolor(pil_img):
    """Isolates satellite clouds with alpha transparency, preserving RGB textures."""
    raw_rgb = pil_img.convert('RGB')
    rgb_arr = np.array(raw_rgb)
    r = rgb_arr[:, :, 0].astype(np.float32)
    g = rgb_arr[:, :, 1].astype(np.float32)
    b = rgb_arr[:, :, 2].astype(np.float32)
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    alpha = np.clip((lum - 0.20) / (0.42 - 0.20), 0.0, 1.0)
    alpha = np.power(alpha, 1.3) * 255.0
    alpha_u8 = alpha.astype(np.uint8)
    out_arr = np.dstack([rgb_arr, alpha_u8])
    return Image.fromarray(out_arr, 'RGBA')

class TransparentCloudTiles(cimgt.GoogleTiles):
    """Cartopy tile provider for Himawari clouds with transparent ocean/ground."""
    def __init__(self, dt_satellite=None, **kwargs):
        super().__init__(**kwargs)
        if dt_satellite is None:
            dt_satellite = get_latest_satellite_time()
        self.date_str = dt_satellite.strftime('%Y-%m-%d')
        self.time_str = f"{dt_satellite.hour:02d}{dt_satellite.minute:02d}"
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Referer': 'https://zoom.earth/',
            'Origin': 'https://zoom.earth'
        }

    def _image_url(self, tile):
        x, y, z = tile
        return f"https://tiles.zoom.earth/geocolor/himawari/{self.date_str}/{self.time_str}/{z}/{y}/{x}.jpg"

    def get_image(self, tile):
        url = self._image_url(tile)
        try:
            r = _SAT_SESSION.get(url, headers=self.headers, timeout=4.0)
            if r.status_code == 200 and len(r.content) > 1000:
                raw_img = Image.open(io.BytesIO(r.content)).convert('RGB')
                return isolate_clouds_geocolor(raw_img), self.tileextent(tile), 'lower'
        except Exception:
            pass
        empty = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
        return empty, self.tileextent(tile), 'lower'


# ── Storm Track & JMA Parser ──────────────────────────────────────────────────
def parse_jma_latlon(val_str):
    """Parses coordinate strings like '15.9N' or '138.7E'."""
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

def load_jma_json(file_path):
    """Loads and normalizes forecast points from a JMA VPTW JSON file."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"JMA file not found: {file_path}")

    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    meta = {
        'name': data.get('name') or 'TROPICAL CYCLONE',
        'number': data.get('number') or '',
        'remark': data.get('remark') or '',
        'report_dt': data.get('reportDateTime') or '',
        'target_dt': data.get('targetDateTime') or ''
    }

    infos = data.get('meteorologicalInfos', [])
    if not infos:
        raise ValueError(f"No meteorological information found in {file_path}")

    pts = []
    t0 = None

    for item in infos:
        dt_str = item.get('dateTime', '')
        if not dt_str:
            continue
        try:
            dt = datetime.strptime(dt_str, '%Y/%m/%d %H:%M').replace(tzinfo=timezone.utc)
        except Exception:
            continue

        if t0 is None:
            t0 = dt

        tau = (dt - t0).total_seconds() / 3600.0

        c_part = item.get('centerPart', {}) or {}
        lat_str = c_part.get('coordinateLat') or (c_part.get('probabilityCircle', {}) or {}).get('basePointLat')
        lon_str = c_part.get('coordinateLon') or (c_part.get('probabilityCircle', {}) or {}).get('basePointLon')

        lat = parse_jma_latlon(lat_str)
        lon = parse_jma_latlon(lon_str)
        if math.isnan(lat) or math.isnan(lon):
            continue

        # Intensity & Pressure
        wind_kt = 30.0
        w_part = item.get('windPart', {}) or {}
        if w_part.get('windSpeedKnot'):
            try:
                wind_kt = float(w_part['windSpeedKnot'])
            except (ValueError, TypeError):
                pass

        pres_hpa = 1004.0
        if c_part.get('pressure'):
            try:
                pres_hpa = float(c_part['pressure'])
            except (ValueError, TypeError):
                pass

        # Probability Circle
        prob_km = 0.0
        prob_part = c_part.get('probabilityCircle', {}) or {}
        if prob_part.get('axis', {}).get('radiusKm'):
            try:
                prob_km = float(prob_part['axis']['radiusKm'])
            except (ValueError, TypeError):
                pass

        # Warning Radii
        w50_km = 0.0
        for w in item.get('warningAreaPart50') or []:
            if w.get('radiusKm'):
                try:
                    w50_km = max(w50_km, float(w['radiusKm']))
                except (ValueError, TypeError):
                    pass

        w30_km = 0.0
        for w in item.get('warningAreaPart30') or []:
            if w.get('radiusKm'):
                try:
                    w30_km = max(w30_km, float(w['radiusKm']))
                except (ValueError, TypeError):
                    pass

        cls_code = (item.get('classPart', {}) or {}).get('typhoonClass') or 'TD'
        cls_name = (item.get('classPart', {}) or {}).get('typhoonClassName') or 'Tropical Depression'

        pts.append({
            'dt': dt,
            'lead_h': tau,
            'lat': lat,
            'lon': lon,
            'wind_kt': wind_kt,
            'wind_kmh': wind_kt * 1.852,
            'pressure': pres_hpa,
            'prob_km': prob_km,
            'w50_km': w50_km,
            'w30_km': w30_km,
            'class_code': cls_code,
            'class_name': cls_name
        })

    if not pts:
        raise ValueError("Could not parse any valid coordinates from JMA file.")

    return meta, pts


def generate_demo_storm():
    """Generates a realistic test cyclone approaching Luzon with TCWS #1, #2, and #3."""
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    meta = {
        'name': 'DEMO CYCLONE',
        'number': '2620',
        'remark': 'TYPHOON SIMULATION',
        'report_dt': now.strftime('%Y/%m/%d %H:00'),
        'target_dt': now.strftime('%Y/%m/%d %H:00')
    }

    # Storm tracking WNW making landfall over Aurora/Isabela within 12h
    raw_steps = [
        {'lead_h': 0,   'lat': 16.0, 'lon': 123.5, 'wind_kt': 85.0, 'prob_km': 0,   'w50_km': 100, 'w30_km': 280, 'class_code': 'TY',  'class_name': 'Typhoon'},
        {'lead_h': 12,  'lat': 16.5, 'lon': 121.8, 'wind_kt': 75.0, 'prob_km': 45,  'w50_km': 90,  'w30_km': 260, 'class_code': 'TY',  'class_name': 'Typhoon'},
        {'lead_h': 24,  'lat': 17.1, 'lon': 120.0, 'wind_kt': 60.0, 'prob_km': 80,  'w50_km': 70,  'w30_km': 220, 'class_code': 'STS', 'class_name': 'Severe Tropical Storm'},
        {'lead_h': 36,  'lat': 17.8, 'lon': 118.2, 'wind_kt': 45.0, 'prob_km': 120, 'w50_km': 0,   'w30_km': 180, 'class_code': 'TS',  'class_name': 'Tropical Storm'},
        {'lead_h': 48,  'lat': 18.6, 'lon': 116.5, 'wind_kt': 35.0, 'prob_km': 160, 'w50_km': 0,   'w30_km': 140, 'class_code': 'TS',  'class_name': 'Tropical Storm'},
    ]

    pts = []
    for s in raw_steps:
        s['dt'] = now + timedelta(hours=s['lead_h'])
        s['wind_kmh'] = s['wind_kt'] * 1.852
        s['pressure'] = 955.0 + s['lead_h'] * 0.7
        pts.append(s)

    return meta, pts


# ── Hourly Track Interpolator & Swath Engine ──────────────────────────────────
def interpolate_track_hourly(pts, max_lead_h=48.0):
    """Interpolates forecast points into hourly time steps."""
    df = pd.DataFrame(pts).sort_values('lead_h').reset_index(drop=True)
    if len(df) == 1:
        return df

    max_h = min(float(df['lead_h'].max()), float(max_lead_h))
    hourly_h = np.arange(0.0, max_h + 1.0, 1.0)

    interp_lat = np.interp(hourly_h, df['lead_h'], df['lat'])
    interp_lon = np.interp(hourly_h, df['lead_h'], df['lon'])
    interp_wind = np.interp(hourly_h, df['lead_h'], df['wind_kt'])
    interp_prob = np.interp(hourly_h, df['lead_h'], df['prob_km'])
    interp_w50  = np.interp(hourly_h, df['lead_h'], df['w50_km'])
    interp_w30  = np.interp(hourly_h, df['lead_h'], df['w30_km'])
    interp_pres = np.interp(hourly_h, df['lead_h'], df['pressure'])

    t0 = df.iloc[0]['dt']
    hourly_pts = []
    for idx, h in enumerate(hourly_h):
        hourly_pts.append({
            'lead_h': h,
            'dt': t0 + timedelta(hours=h),
            'lat': interp_lat[idx],
            'lon': interp_lon[idx],
            'wind_kt': interp_wind[idx],
            'wind_kmh': interp_wind[idx] * 1.852,
            'pressure': interp_pres[idx],
            'prob_km': interp_prob[idx],
            'w50_km': interp_w50[idx],
            'w30_km': interp_w30[idx]
        })
    return pd.DataFrame(hourly_pts)


def compute_signal_hazard_swaths(hourly_df, apply_cone_margin=True):
    """
    Computes PAGASA-standard hazard swaths for Signal 1 through 5.
    Accounts for lead-time constraints and wind radius profiles.
    """
    swaths = {1: None, 2: None, 3: None, 4: None, 5: None}

    for sig_level in [5, 4, 3, 2, 1]:
        cfg = TCWS_LEVELS[sig_level]
        max_lead = cfg['lead_h']
        min_kt = cfg['min_kt']

        # Filter track points within lead time window
        valid_steps = hourly_df[hourly_df['lead_h'] <= max_lead]
        if valid_steps.empty:
            continue

        circles = []
        for _, row in valid_steps.iterrows():
            v_kt = row['wind_kt']
            # If the storm at this hour does not attain the intensity, skip
            if v_kt < (min_kt - 5.0): # 5kt allowance for intensification margin
                continue

            # Compute effective radius for this wind threshold
            w30 = row['w30_km']
            w50 = row['w50_km']

            if sig_level == 1:
                # 39 km/h (21 kt) strong wind radius
                if w30 > 0:
                    r_wind = w30 * 1.25
                else:
                    # Typical TD/TS strong wind radius
                    r_wind = max(160.0, 100.0 + v_kt * 2.5)
            elif sig_level == 2:
                # 62 km/h (34 kt) gale radius
                if w30 > 0:
                    r_wind = w30 * 0.95
                else:
                    r_wind = max(110.0, 70.0 + v_kt * 1.8)
            elif sig_level == 3:
                # 89 km/h (48 kt) storm radius
                if w50 > 0:
                    r_wind = w50 * 0.95
                else:
                    r_wind = max(60.0, 30.0 + (v_kt - 48.0) * 2.0)
            elif sig_level == 4:
                # 118 km/h (64 kt) typhoon eyewall core
                r_wind = max(40.0, 25.0 + (v_kt - 64.0) * 1.2)
            else: # Signal 5
                # >= 185 km/h (100 kt) super typhoon core
                r_wind = max(30.0, 20.0 + (v_kt - 100.0) * 0.8)

            # Operational position uncertainty margin
            if apply_cone_margin:
                r_cone = row['prob_km'] if row['prob_km'] > 0 else (15.0 + row['lead_h'] * 2.2)
                r_total = r_wind + min(r_cone * 0.45, 90.0) # 45% cone width expansion
            else:
                r_total = r_wind

            # Convert km to degrees (1 deg ~ 111.32 km)
            r_deg = r_total / 111.32
            pt = Point(row['lon'], row['lat'])
            circles.append(pt.buffer(r_deg, resolution=16))

        if circles:
            swaths[sig_level] = unary_union(circles)

    return swaths


# ── Geographic Intersection Engine ────────────────────────────────────────────
def evaluate_geographic_signals(swaths, geojson_path, level_name='municipality'):
    """
    Intersects each municipality / province against Signal 5 down to 1 swaths.
    Returns matched features with their highest active TCWS signal.
    """
    if not os.path.exists(geojson_path):
        raise FileNotFoundError(f"Administrative GeoJSON file missing: {geojson_path}")

    with open(geojson_path, 'r', encoding='utf-8') as f:
        geo_data = json.load(f)

    results = []
    active_swaths = {k: v for k, v in swaths.items() if v is not None and not v.is_empty}

    for feat in geo_data.get('features', []):
        raw_geom = feat.get('geometry')
        if not raw_geom:
            continue
        try:
            poly = shape(raw_geom)
        except Exception:
            continue

        props = feat.get('properties', {})
        if level_name == 'municipality':
            name = props.get('NAME_2') or props.get('MUNICIPALITY') or 'Unknown'
            prov = props.get('NAME_1') or props.get('PROVINCE') or 'Unknown'
            region = props.get('REGION') or ''
        else:
            name = props.get('NAME_1') or props.get('PROVINCE') or 'Unknown'
            prov = name
            region = props.get('REGION') or ''

        assigned_signal = 0
        for s in [5, 4, 3, 2, 1]:
            if s in active_swaths and active_swaths[s].intersects(poly):
                assigned_signal = s
                break

        results.append({
            'name': name,
            'province': prov,
            'region': region,
            'signal': assigned_signal,
            'geometry': poly,
            'properties': props
        })

    return results


# ── Cartography & Broadcast Renderer ──────────────────────────────────────────
def render_tcws_broadcast_map(meta, original_pts, hourly_df, swaths, geo_results,
                             output_img="public/images/tropical_signal_warning.png",
                             level_name="municipality", use_satellite=True):
    """Renders a sleek, high-definition 16:9 TV broadcast weather warning graphic."""
    os.makedirs(os.path.dirname(os.path.abspath(output_img)), exist_ok=True)

    fig = plt.figure(figsize=(16, 9), dpi=120)
    fig.patch.set_facecolor(BG_DARK)

    # Calculate optimal map extent centered on storm & the Philippines
    all_lons = [p['lon'] for p in original_pts]
    all_lats = [p['lat'] for p in original_pts]
    
    # Base Philippine domain
    min_lon = min(116.5, min(all_lons) - 2.5)
    max_lon = max(130.5, max(all_lons) + 3.0)
    min_lat = min(4.5,   min(all_lats) - 2.0)
    max_lat = max(22.5,  max(all_lats) + 2.5)
    
    # Maintain sensible widescreen aspect ratio
    extent = [min_lon, max_lon, min_lat, max_lat]

    ax = fig.add_axes([0.02, 0.02, 0.72, 0.88], projection=ccrs.PlateCarree())
    ax.set_extent(extent, crs=ccrs.PlateCarree())
    ax.set_facecolor(OCEAN_COLOR)

    # Base Cartography
    ax.add_feature(cfeature.LAND, facecolor=LAND_COLOR, edgecolor='none', zorder=1)
    ax.add_feature(cfeature.COASTLINE, edgecolor=LAND_EDGE, linewidth=0.7, zorder=2)
    ax.add_feature(cfeature.BORDERS, edgecolor=BORDER_EDGE, linewidth=0.8, linestyle=':', zorder=2)

    # Philippine Area of Responsibility (PAR)
    ax.plot(PAR_LONS, PAR_LATS, color=PAR_COLOR, linewidth=1.5, linestyle='--',
            transform=ccrs.PlateCarree(), zorder=3, alpha=0.9, label='PAR Boundary')
    par_label_lon = max(min_lon + 1.0, min(max_lon - 3.5, 133.5))
    ax.text(par_label_lon, 5.5, 'PAR BOUNDARY', color=PAR_COLOR, fontsize=8.5, fontweight='bold',
            transform=ccrs.PlateCarree(), zorder=3.5)

    # Live Himawari Satellite Clouds
    if use_satellite:
        try:
            sat_time = get_latest_satellite_time()
            tiler = TransparentCloudTiles(sat_time)
            ax.add_image(tiler, 6, alpha=0.85, zorder=3.5)
            print(f"Overlayed Himawari satellite clouds (Scan: {sat_time.strftime('%Y-%m-%d %H:%MZ')})")
        except Exception as e:
            print(f"Notice: Satellite overlay bypassed ({e})")

    # Render Municipalities / Provinces with Signal Shading
    warned_count = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    affected_prov_map = {1: set(), 2: set(), 3: set(), 4: set(), 5: set()}

    for item in geo_results:
        poly = item['geometry']
        sig = item['signal']
        prov_name = item['province']

        if sig > 0:
            warned_count[sig] += 1
            affected_prov_map[sig].add(prov_name)
            cfg = TCWS_LEVELS[sig]
            fill_c = cfg['color']
            border_c = cfg['border']
            alpha_val = cfg['alpha']

            if poly.geom_type == 'Polygon':
                geoms = [poly]
            elif poly.geom_type == 'MultiPolygon':
                geoms = list(poly.geoms)
            else:
                geoms = []

            for g in geoms:
                x, y = g.exterior.xy
                ax.fill(x, y, facecolor=fill_c, edgecolor=border_c,
                        linewidth=0.6, alpha=alpha_val, transform=ccrs.PlateCarree(), zorder=4.5)
        else:
            # Subtle default outline for unaffected administrative areas
            if poly.geom_type == 'Polygon':
                geoms = [poly]
            elif poly.geom_type == 'MultiPolygon':
                geoms = list(poly.geoms)
            else:
                geoms = []
            for g in geoms:
                x, y = g.exterior.xy
                ax.plot(x, y, color=PROVINCE_EDGE, linewidth=0.25,
                        alpha=0.5, transform=ccrs.PlateCarree(), zorder=4.0)

    # Draw 70% Probability Uncertainty Cone
    cone_polys = []
    for p in original_pts:
        if p['prob_km'] > 0:
            pt = Point(p['lon'], p['lat'])
            cone_polys.append(pt.buffer(p['prob_km'] / 111.32, resolution=16))
    if cone_polys:
        cone_union = unary_union(cone_polys)
        if cone_union.geom_type == 'Polygon':
            c_geoms = [cone_union]
        elif cone_union.geom_type == 'MultiPolygon':
            c_geoms = list(cone_union.geoms)
        else:
            c_geoms = []
        for cg in c_geoms:
            cx, cy = cg.exterior.xy
            ax.fill(cx, cy, facecolor='#ffffff', edgecolor='#ffffff',
                    linewidth=1.2, linestyle='--', alpha=0.15,
                    transform=ccrs.PlateCarree(), zorder=5.0)

    # Plot Track Line
    track_lons = [p['lon'] for p in original_pts]
    track_lats = [p['lat'] for p in original_pts]
    ax.plot(track_lons, track_lats, color='#ffffff', linewidth=2.4,
            linestyle='-', transform=ccrs.PlateCarree(), zorder=5.2)

    # Plot Forecast Points with Intensity Badges
    for p in original_pts:
        tau = p['lead_h']
        v_kmh = p['wind_kmh']
        if v_kmh >= 185:   pt_color = TCWS_LEVELS[5]['color']
        elif v_kmh >= 118: pt_color = TCWS_LEVELS[4]['color']
        elif v_kmh >= 89:  pt_color = TCWS_LEVELS[3]['color']
        elif v_kmh >= 62:  pt_color = TCWS_LEVELS[2]['color']
        else:              pt_color = TCWS_LEVELS[1]['color']

        size = 80 if tau == 0 else 55
        marker = 'o' if tau > 0 else 'X'
        ax.scatter(p['lon'], p['lat'], s=size, color=pt_color, edgecolor='#ffffff',
                   linewidth=1.2, marker=marker, transform=ccrs.PlateCarree(), zorder=6.0)

        # Label forecast steps (T+0, T+24, etc.)
        label_text = f"T+{int(tau)}h\n{int(v_kmh)} km/h" if tau > 0 else f"CENTER\n{int(v_kmh)} km/h"
        offset_y = 0.45 if tau % 24 == 0 else -0.55
        txt = ax.text(p['lon'], p['lat'] + offset_y, label_text, color='#f8fafc',
                      fontsize=7.5, fontweight='bold', ha='center', va='center',
                      transform=ccrs.PlateCarree(), zorder=6.5)
        txt.set_path_effects([path_effects.withStroke(linewidth=2.5, foreground='#091424')])

    # Coordinate Gridlines
    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color=GRID_COLOR, alpha=0.7, linestyle=':')
    gl.top_labels = False
    gl.right_labels = False
    gl.xlabel_style = {'color': GRID_TEXT, 'size': 8}
    gl.ylabel_style = {'color': GRID_TEXT, 'size': 8}

    # ── Top Glassmorphism Header ──────────────────────────────────────────────
    header_ax = fig.add_axes([0.02, 0.915, 0.96, 0.07])
    header_ax.set_facecolor(HEADER_BG)
    header_ax.patch.set_edgecolor(CARD_BORDER)
    header_ax.patch.set_linewidth(1.0)
    header_ax.set_xticks([])
    header_ax.set_yticks([])

    # Accent Top Line
    header_ax.axhline(0.96, color='#00d2ff', linewidth=3.0)

    # Title & Branding
    header_ax.text(0.015, 0.62, "PHILIPPINE WEATHER ALERT SYSTEM", color='#00d2ff',
                   fontsize=9, fontweight='bold')
    header_ax.text(0.015, 0.22, "TROPICAL CYCLONE WIND SIGNALS (TCWS)", color=TEXT_PRI,
                   fontsize=14, fontweight='bold')

    # Storm Info Badge
    init_p = original_pts[0]
    curr_kmh = int(init_p['wind_kmh'])
    curr_cls = init_p.get('class_name') or 'Tropical Depression'
    storm_id_str = f"{meta['name']} ({curr_cls.upper()})"
    
    header_ax.text(0.48, 0.58, "STORM INTENSITY", color=TEXT_MUT, fontsize=8, fontweight='bold')
    header_ax.text(0.48, 0.22, f"{storm_id_str} | {curr_kmh} km/h (Center)", color=TEXT_PRI, fontsize=11, fontweight='bold')

    header_ax.text(0.78, 0.58, "LEAD-TIME GUIDANCE", color=TEXT_MUT, fontsize=8, fontweight='bold')
    header_ax.text(0.78, 0.22, f"TCWS #1: 36h | #2: 24h | #3: 18h", color='#facc15', fontsize=11, fontweight='bold')

    # ── Right Sidebar Dashboard ───────────────────────────────────────────────
    side_ax = fig.add_axes([0.75, 0.02, 0.23, 0.88])
    side_ax.set_facecolor(CARD_BG)
    side_ax.patch.set_edgecolor(CARD_BORDER)
    side_ax.patch.set_linewidth(1.0)
    side_ax.set_xticks([])
    side_ax.set_yticks([])

    curr_y = 0.96

    # Section 1: TCWS LEGEND
    side_ax.text(0.06, curr_y, "TROPICAL CYCLONE WIND SIGNALS", color=TEXT_PRI, fontsize=10, fontweight='bold')
    curr_y -= 0.025
    side_ax.axhline(curr_y, color='#1e293b', linewidth=1.0)
    curr_y -= 0.035

    for s in [5, 4, 3, 2, 1]:
        cfg = TCWS_LEVELS[s]
        # Color Box
        rect = FancyBboxPatch((0.06, curr_y - 0.025), 0.065, 0.032,
                              boxstyle="square,pad=0",
                              facecolor=cfg['color'], edgecolor=cfg['border'],
                              linewidth=1.0, transform=side_ax.transAxes)
        side_ax.add_patch(rect)
        side_ax.text(0.15, curr_y - 0.005, f"{cfg['name']}", color=TEXT_PRI, fontsize=9, fontweight='bold')
        side_ax.text(0.15, curr_y - 0.023, f"{cfg['desc']} · {cfg['lead_h']}h lead", color=TEXT_SEC, fontsize=7.5)
        curr_y -= 0.055

    curr_y -= 0.02

    # Section 2: THREAT ASSESSMENT & AFFECTED LOCALITIES
    side_ax.text(0.06, curr_y, f"AREAS UNDER TCWS ({level_name.upper()})", color=TEXT_PRI, fontsize=10, fontweight='bold')
    curr_y -= 0.025
    side_ax.axhline(curr_y, color='#1e293b', linewidth=1.0)
    curr_y -= 0.035

    total_active_signals = sum(warned_count.values())

    if total_active_signals == 0:
        side_ax.text(0.06, curr_y - 0.02, "NO LAND AREAS UNDER TCWS", color='#34d399', fontsize=9.5, fontweight='bold')
        side_ax.text(0.06, curr_y - 0.055, "Strong winds (>=39 km/h) are not", color=TEXT_SEC, fontsize=8)
        side_ax.text(0.06, curr_y - 0.08, "expected over land within 36 hours.", color=TEXT_SEC, fontsize=8)
        curr_y -= 0.12
    else:
        # Precompute total counts per province to distinguish entire provinces vs parts
        prov_totals = {}
        for item in geo_results:
            p = item['province']
            prov_totals[p] = prov_totals.get(p, 0) + 1

        plural_unit = "municipalities" if level_name == 'municipality' else "provinces"
        for s in [5, 4, 3, 2, 1]:
            count = warned_count[s]
            if count > 0:
                cfg = TCWS_LEVELS[s]
                side_ax.text(0.06, curr_y, f"● {cfg['name']} ({count} {plural_unit})",
                             color=cfg['color'], fontsize=9, fontweight='bold')
                curr_y -= 0.024

                # Group by province
                prov_munis = {}
                for item in geo_results:
                    if item['signal'] == s:
                        p = item['province']
                        if p not in prov_munis:
                            prov_munis[p] = []
                        prov_munis[p].append(item['name'])

                desc_parts = []
                for p, m_list in sorted(prov_munis.items()):
                    tot = prov_totals.get(p, len(m_list))
                    if level_name == 'province':
                        desc_parts.append(p)
                    else:
                        if len(m_list) >= tot:
                            desc_parts.append(f"{p} (whole prov)")
                        elif len(m_list) <= 3:
                            desc_parts.append(f"{p} [{', '.join(m_list)}]")
                        else:
                            desc_parts.append(f"{p} ({len(m_list)} munis)")

                line_str = ", ".join(desc_parts[:4])
                if len(desc_parts) > 4:
                    line_str += f", +{len(desc_parts) - 4} more provs"
                side_ax.text(0.09, curr_y, line_str, color=TEXT_SEC, fontsize=7.2, wrap=True)
                curr_y -= 0.046

    curr_y -= 0.02

    # Section 3: PAGASA 36-HOUR RULE INFO CARD
    info_box = FancyBboxPatch((0.05, 0.08), 0.90, 0.18,
                              boxstyle="round,pad=0.02,rounding_size=0.03",
                              facecolor='#0b172a', edgecolor='#1e293b',
                              linewidth=1.0, transform=side_ax.transAxes)
    side_ax.add_patch(info_box)

    side_ax.text(0.09, 0.23, "HOW SIGNALS ARE HOISTED", color='#00d2ff', fontsize=8.5, fontweight='bold')
    expl_text = (
        "Signals are raised before onset based on lead-time:\n"
        "• Signal 1 (39-61 km/h): Within 36 hours\n"
        "• Signal 2 (62-88 km/h): Within 24 hours\n"
        "• Signal 3 (89-117 km/h): Within 18 hours\n"
        "• Signal 4/5 (≥118 km/h): Within 12 hours\n"
        "Localities are warned when the threat swath touches land."
    )
    side_ax.text(0.09, 0.10, expl_text, color=TEXT_SEC, fontsize=7.0, linespacing=1.3)

    # Footer note
    side_ax.text(0.06, 0.03, "Automated Guidance · Refer to PAGASA for official warnings.",
                 color=TEXT_MUT, fontsize=6.5, style='italic')

    # Save Graphic
    plt.savefig(output_img, dpi=120, bbox_inches='tight', facecolor=fig.get_facecolor(), edgecolor='none')
    plt.close(fig)
    print(f"[OK] Tropical Cyclone Wind Signal map rendered successfully: {output_img}")


# ── JSON Summary Exporter ─────────────────────────────────────────────────────
def export_tcws_json(meta, original_pts, geo_results, output_path="public/data/active_tcws.json", level_name="municipality"):
    """Exports structured active signal alerts to JSON for web consumption."""
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    summary_by_signal = {1: [], 2: [], 3: [], 4: [], 5: []}
    province_signal_map = {}

    for item in geo_results:
        sig = item['signal']
        if sig > 0:
            prov = item['province']
            name = item['name']
            summary_by_signal[sig].append({
                'name': name,
                'province': prov,
                'region': item['region']
            })
            province_signal_map[prov] = max(province_signal_map.get(prov, 0), sig)

    export_data = {
        'generated_utc': datetime.now(timezone.utc).isoformat(),
        'storm_meta': meta,
        'granularity': level_name,
        'provinces_under_tcws': [
            {'province': prov, 'max_signal': sig, 'signal_label': TCWS_LEVELS[sig]['name']}
            for prov, sig in sorted(province_signal_map.items())
        ],
        'counts_by_signal': {sig: len(items) for sig, items in summary_by_signal.items()},
        'localities_by_signal': summary_by_signal
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(export_data, f, indent=2)

    print(f"[OK] Exported active TCWS summary to: {output_path}")


# ── CLI & Main Entrypoint ─────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="PAGASA Tropical Cyclone Wind Signal (TCWS) Warning Map Generator")
    parser.add_argument('--jma', type=str, default=None, help="Path to JMA VPTW JSON (e.g. public/data/jma_vptw60_61.json)")
    parser.add_argument('--demo', action='store_true', help="Generate demonstration cyclone approaching Luzon")
    parser.add_argument('--level', type=str, choices=['municipality', 'province'], default='municipality',
                        help="Geographic granularity: 'municipality' (1647 towns) or 'province' (82 provinces)")
    parser.add_argument('--output', type=str, default='public/images/tropical_signal_warning.png', help="Output PNG map path")
    parser.add_argument('--json-output', type=str, default='public/data/active_tcws.json', help="Output summary JSON path")
    parser.add_argument('--no-satellite', action='store_true', help="Disable live Himawari satellite clouds")
    parser.add_argument('--no-cone-margin', action='store_true', help="Do not expand wind radius by forecast uncertainty")

    args = parser.parse_args()

    # 1. Determine Storm Data Input
    if args.demo:
        print("[MODE] Generating DEMO tropical cyclone threat...")
        meta, original_pts = generate_demo_storm()
    elif args.jma:
        print(f"[MODE] Loading JMA forecast from: {args.jma}")
        meta, original_pts = load_jma_json(args.jma)
    else:
        # Auto-discover active JMA bulletin in public/data
        candidate_paths = [
            os.path.join("public", "data", "jma_vptw60_61.json"),
            os.path.join("public", "data", "jma_vptw60_60.json"),
            os.path.join("public", "data", "jma_vptw60_62.json"),
            os.path.join("public", "data", "jma_vptw60_63.json")
        ]
        found = next((p for p in candidate_paths if os.path.exists(p)), None)
        if found:
            print(f"[MODE] Auto-detected JMA bulletin: {found}")
            meta, original_pts = load_jma_json(found)
        else:
            print("[NOTICE] No JMA bulletin found; falling back to DEMO storm mode.")
            meta, original_pts = generate_demo_storm()

    print(f"Loaded storm: {meta['name']} with {len(original_pts)} forecast points.")

    # 2. Hourly Interpolation
    hourly_df = interpolate_track_hourly(original_pts, max_lead_h=48.0)
    print(f"Interpolated track: {len(hourly_df)} hourly steps (T+0 to T+{int(hourly_df['lead_h'].max())}h).")

    # 3. Hazard Swaths
    swaths = compute_signal_hazard_swaths(hourly_df, apply_cone_margin=(not args.no_cone_margin))
    active_swaths_info = [f"Signal {s}" for s, g in swaths.items() if g is not None]
    print(f"Active wind hazard swaths: {', '.join(active_swaths_info) if active_swaths_info else 'None'}")

    # 4. Spatial Intersection with Municipalities / Provinces
    if args.level == 'municipality':
        geo_path = os.path.join("public", "data", "ph_municipalities.json")
    else:
        geo_path = os.path.join("public", "data", "ph_provinces.json")

    print(f"Evaluating spatial intersection against {args.level}s from: {geo_path} ...")
    geo_results = evaluate_geographic_signals(swaths, geo_path, level_name=args.level)

    warned_total = sum(1 for r in geo_results if r['signal'] > 0)
    print(f"Evaluation complete: {warned_total} {args.level}(s) placed under TCWS.")

    # 5. Render Graphic
    print(f"Rendering broadcast map to: {args.output} ...")
    render_tcws_broadcast_map(
        meta=meta,
        original_pts=original_pts,
        hourly_df=hourly_df,
        swaths=swaths,
        geo_results=geo_results,
        output_img=args.output,
        level_name=args.level,
        use_satellite=(not args.no_satellite)
    )

    # 6. Export JSON
    export_tcws_json(meta, original_pts, geo_results, output_path=args.json_output, level_name=args.level)
    print("All tasks completed successfully.")


if __name__ == '__main__':
    main()
