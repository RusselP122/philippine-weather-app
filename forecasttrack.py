import os
import sys
import re
import json
import math
import io
import base64
import argparse
import glob
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.image as mpimg
import matplotlib.patches as mpatches
import matplotlib.patheffects as path_effects
from matplotlib.patches import FancyBboxPatch
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import cartopy.io.img_tiles as cimgt
from PIL import Image
import requests
from shapely.geometry import shape, Polygon
from shapely.ops import unary_union
import urllib.request
import concurrent.futures
from datetime import datetime, timezone, timedelta

# ── Brand Logo Paths (matching ai_precip_outlook.py) ──────────────────
LOGO_PATHS = [
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "images", "logo.png"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "logo512.png"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "logo192.png"),
    os.path.join(os.getcwd(), "public", "images", "logo.png"),
    os.path.join(os.getcwd(), "public", "logo512.png"),
    os.path.join(os.getcwd(), "public", "logo192.png")
]

# JTWC / PAGASA Western North Pacific climatological error cone radii (nautical miles) by lead time (hours)
# Incorporates realistic satellite / analysis fix uncertainty (~12 NM) at T+0
LEAD_STANDARD = [0,   12,  24,  36,  48,   60,   72,   96,  120,  144]
RADII_NM      = [12,  28,  42,  56,  72,   88,  105,  155,  210,  260]

# ── TV Broadcast Dark Theme Palette Constants (matching forcast5.py) ─────
BG_DARK       = "#0b131e"   # Deep broadcast backdrop canvas
OCEAN_COLOR   = "#162533"   # Deep Navy TV ocean
LAND_COLOR    = "#23313d"   # Sleek Slate-Dark terrain (from forcast5.py)
LAND_EDGE     = "#cbd5e1"   # Crisp luminous coastline (Slate-300, visible over ocean & clouds)
BORDER_EDGE   = "#94a3b8"   # High-contrast international borders (Slate-400)
PROVINCE_EDGE = "#64748b"   # Clean steel slate Philippine provinces (Slate-500)
PAR_COLOR     = "#7c2d12"   # Solid 7c2d12 PAR boundary
GRID_COLOR    = "#475569"   # Subtle coordinate gridlines
GRID_TEXT     = "#64748b"   # Lat/Lon grid labels

HEADER_BG     = "#08172b"   # Glassmorphism header card
HEADER_BORDER = "#0284c7"   # Header border accent

PANEL_BG      = "#0b131e"   # Forecast panel background
CARD_BG       = "#0b172a"   # Surface card
CARD_BORDER   = "#1e293b"   # Card border

ACCENT_LINE   = "#38bdf8"   # Cyan trend line
MSLP_LINE     = "#fb923c"   # Orange pressure line

TEXT_PRI      = "#f8fafc"   # Near-white primary text
TEXT_SEC      = "#94a3b8"   # Muted slate secondary
TEXT_MUT      = "#64748b"   # Muted label text

# Official Agencies (Neon Glow Colors)
AGENCY_COLORS = {
    'PAGASA': '#00d2ff',  # Electric Sky Blue
    'JTWC':   '#f43f5e',  # Bright Crimson Rose
    'JMA':    '#10b981'   # Radiant Emerald Green
}

# NWP Models (Numerical Weather Prediction)
NWP_COLORS = {
    'ECMWF IFS': '#fbbf24',  # Warm Amber / Gold
    'GFS':       '#60a5fa'   # Crisp Cornflower Blue
}

# AI Models (Machine Learning & Deep Learning Weather Forecasting)
AI_COLORS = {
    'AIGEFS':                '#fb923c',  # Coral Orange
    'ECMWF AIFS':            '#2dd4bf',  # Bright Mint / Teal
    'WeatherNext 3 Cyclone': '#a855f7'   # Radiant Violet
}

# Combined dictionary for multi-model processing and map rendering
ENSEMBLE_COLORS = {**NWP_COLORS, **AI_COLORS}

# Intensity Scale (PAGASA Standard in km/h)
INTENSITY_PALETTE = {
    'LPA': ('#38bdf8', 'Low Pressure Area'),
    'TD':  ('#34d399', 'Tropical Depression'),
    'TS':  ('#facc15', 'Tropical Storm'),
    'STS': ('#fb923c', 'Severe Tropical Storm'),
    'TY':  ('#ef4444', 'Typhoon'),
    'STY': ('#f43f5e', 'Super Typhoon')
}

def wind_color(kmh):
    if kmh >= 118: return "#ef4444"
    if kmh >= 89:  return "#fb923c"
    if kmh >= 62:  return "#facc15"
    if kmh >= 45:  return "#34d399"
    return "#38bdf8"


# ── Himawari Satellite Cloud Isolation Provider ─────────────────────────────
_SAT_SESSION = requests.Session()
_SAT_ADAPTER = requests.adapters.HTTPAdapter(pool_connections=25, pool_maxsize=25, max_retries=2)
_SAT_SESSION.mount('https://', _SAT_ADAPTER)
_SAT_SESSION.mount('http://', _SAT_ADAPTER)

_LATEST_SAT_TIME_CACHE = None
_SAT_TIME_MAP_CACHE = {}

def parse_storm_init_time(init_time_val):
    """
    Parses a storm init/analysis time value into a UTC datetime.
    Handles datetime/Timestamp objects, and string formats like:
    'YYYY-MM-DD HH:MM:SS', 'YYYY-MM-DDTHH:MM:SS', 'YYYYMMDDHH', etc.
    """
    if not init_time_val:
        return None
    
    if isinstance(init_time_val, datetime):
        if init_time_val.tzinfo is None:
            return init_time_val.replace(tzinfo=timezone.utc)
        return init_time_val.astimezone(timezone.utc)
        
    try:
        if hasattr(init_time_val, 'to_pydatetime'):
            dt = init_time_val.to_pydatetime()
            if dt.tzinfo is None:
                return dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
    except Exception:
        pass

    s = str(init_time_val).strip().replace('Z', '')
    s_clean = s.split('.')[0]
    
    formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y%m%d%H%M",
        "%Y%m%d%H",
        "%Y-%m-%d"
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(s_clean, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
            
    try:
        pdt = pd.to_datetime(s_clean)
        dt = pdt.to_pydatetime()
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        pass
        
    return None

def format_to_ph_time_str(init_time_val):
    """
    Converts a storm initialization timestamp (UTC) to Philippine Standard Time (PST/PHT, UTC+8).
    Returns a clean formatted string e.g. 'Sep 23, 2026, 2:00 PM' or 'Latest'.
    """
    if not init_time_val or str(init_time_val).strip().lower() in ('latest', 'none', ''):
        return "Latest"
    dt_utc = parse_storm_init_time(init_time_val)
    if dt_utc is not None:
        ph_tz = timezone(timedelta(hours=8))
        dt_ph = dt_utc.astimezone(ph_tz)
        hour_str = dt_ph.strftime("%I").lstrip("0")
        min_ampm = dt_ph.strftime("%M %p")
        return f"{dt_ph.strftime('%b %d, %Y')}, {hour_str}:{min_ampm}"
    return str(init_time_val)

def get_latest_satellite_time():
    """
    Dynamically discovers the latest available Himawari satellite scan timestamp
    (typically 15-25 minutes behind real time) and caches it for the execution run.
    """
    global _LATEST_SAT_TIME_CACHE
    if _LATEST_SAT_TIME_CACHE is not None:
        return _LATEST_SAT_TIME_CACHE

    now = datetime.now(timezone.utc)
    for offset_mins in [15, 20, 25, 30, 40, 50, 60]:
        t = now - timedelta(minutes=offset_mins)
        mins = (t.minute // 10) * 10
        t_aligned = t.replace(minute=mins, second=0, microsecond=0)
        d_str = t_aligned.strftime('%Y-%m-%d')
        tm_str = f'{t_aligned.hour:02d}{t_aligned.minute:02d}'
        url = f'https://tiles.zoom.earth/geocolor/himawari/{d_str}/{tm_str}/6/28/53.jpg'
        try:
            r = _SAT_SESSION.get(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': 'https://zoom.earth/',
                'Origin': 'https://zoom.earth'
            }, timeout=3.5)
            if r.status_code == 200 and len(r.content) > 1000:
                _LATEST_SAT_TIME_CACHE = t_aligned
                return _LATEST_SAT_TIME_CACHE
        except Exception:
            pass

    t = now - timedelta(minutes=40)
    mins = (t.minute // 10) * 10
    _LATEST_SAT_TIME_CACHE = t.replace(minute=mins, second=0, microsecond=0)
    return _LATEST_SAT_TIME_CACHE

def get_satellite_scan_time(target_dt=None):
    """
    Finds the optimal available Himawari satellite scan timestamp.
    If target_dt is provided (e.g. from Knack API storm init_time), it finds the closest
    available 10-minute scan near that datetime so cloud features align with the storm's
    analyzed position. If target_dt is None or unavailable, it falls back to the latest scan.
    """
    parsed_dt = parse_storm_init_time(target_dt) if target_dt else None
    
    if parsed_dt is not None:
        cache_key = parsed_dt.strftime('%Y-%m-%d %H:%M')
        if cache_key in _SAT_TIME_MAP_CACHE:
            return _SAT_TIME_MAP_CACHE[cache_key]
        
        # Check offsets near target time: [0, -10, 10, -20, 20, -30, 30]
        offsets = [0, -10, 10, -20, 20, -30, 30]
        for off in offsets:
            t = parsed_dt + timedelta(minutes=off)
            mins = (t.minute // 10) * 10
            t_aligned = t.replace(minute=mins, second=0, microsecond=0)
            d_str = t_aligned.strftime('%Y-%m-%d')
            tm_str = f'{t_aligned.hour:02d}{t_aligned.minute:02d}'
            url = f'https://tiles.zoom.earth/geocolor/himawari/{d_str}/{tm_str}/6/28/53.jpg'
            try:
                r = _SAT_SESSION.get(url, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Referer': 'https://zoom.earth/',
                    'Origin': 'https://zoom.earth'
                }, timeout=3.0)
                if r.status_code == 200 and len(r.content) > 1000:
                    _SAT_TIME_MAP_CACHE[cache_key] = t_aligned
                    return t_aligned
            except Exception:
                pass
                
        mins = (parsed_dt.minute // 10) * 10
        fallback_aligned = parsed_dt.replace(minute=mins, second=0, microsecond=0)
        _SAT_TIME_MAP_CACHE[cache_key] = fallback_aligned
        return fallback_aligned
        
    return get_latest_satellite_time()

def isolate_clouds_geocolor(pil_img):
    """
    Preserves 100% of the original Himawari satellite RGB pixels (photographic
    texture, natural cloud shadows, and true color), while smoothly transitioning
    the dark ocean and clear terrain to transparent.
    """
    raw_rgb = pil_img.convert('RGB')
    rgb_arr = np.array(raw_rgb)
    r = rgb_arr[:, :, 0].astype(np.float32)
    g = rgb_arr[:, :, 1].astype(np.float32)
    b = rgb_arr[:, :, 2].astype(np.float32)

    # Perceptual luminance of the satellite pixels
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0

    # Natural alpha feathering:
    # Ocean / dark clear ground (lum < 0.20) -> 100% transparent
    # Cirrus and cloud edges (0.20 to 0.42) -> smoothly blended
    # Solid cloud deck & eyewall (lum > 0.42) -> solid original satellite photo
    alpha = np.clip((lum - 0.20) / (0.42 - 0.20), 0.0, 1.0)
    alpha = np.power(alpha, 1.3) * 255.0
    alpha_u8 = alpha.astype(np.uint8)

    # PRESERVE 100% OF THE ORIGINAL SATELLITE RGB CHANNELS UNTOUCHED
    out_arr = np.dstack([rgb_arr, alpha_u8])
    return Image.fromarray(out_arr, 'RGBA')

class TransparentCloudTiles(cimgt.GoogleTiles):
    """
    Cartopy tile provider that fetches Himawari satellite tiles and dynamically
    isolates the clouds with transparent ocean and terrain.
    """
    def __init__(self, dt_satellite=None, **kwargs):
        super().__init__(**kwargs)
        if dt_satellite is None:
            dt_satellite = get_latest_satellite_time()
        self.date_str = dt_satellite.strftime('%Y-%m-%d')
        self.time_str = f"{dt_satellite.hour:02d}{dt_satellite.minute:02d}"
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://zoom.earth/',
            'Origin': 'https://zoom.earth'
        }

    def _image_url(self, tile):
        x, y, z = tile
        return f"https://tiles.zoom.earth/geocolor/himawari/{self.date_str}/{self.time_str}/{z}/{y}/{x}.jpg"

    def get_image(self, tile):
        url = self._image_url(tile)
        try:
            r = _SAT_SESSION.get(url, headers=self.headers, timeout=4.5)
            if r.status_code == 200 and len(r.content) > 1000:
                raw_img = Image.open(io.BytesIO(r.content)).convert('RGB')
                return isolate_clouds_geocolor(raw_img), self.tileextent(tile), 'lower'
        except Exception:
            pass

        empty = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
        return empty, self.tileextent(tile), 'lower'

def overlay_isolated_satellite_clouds(ax, extent, target_time=None, alpha=0.90):
    """
    Safely overlays transparent Himawari satellite clouds onto the map axes.
    When target_time is provided (from Knack API storm init_time), satellite clouds
    are aligned to that exact analysis time rather than latest real-time.
    """
    try:
        min_lon, max_lon, min_lat, max_lat = extent
        span_lon = max_lon - min_lon
        if span_lon > 35:
            zoom_level = 5
        elif span_lon > 15:
            zoom_level = 6
        else:
            zoom_level = 7

        sat_dt = get_satellite_scan_time(target_time)
        tiler = TransparentCloudTiles(sat_dt)
        ax.add_image(tiler, zoom_level, alpha=alpha, zorder=3.5)
        print(f"Overlayed Himawari transparent clouds (Scan: {sat_dt.strftime('%Y-%m-%d %H:%MZ')}, Zoom: {zoom_level}, Aligned with storm time: {target_time})")
        return True
    except Exception as e:
        print(f"Notice: Failed to overlay satellite clouds: {e}")
        return False



def clean_storm_id_no_dot(raw_id):
    """
    Cleans raw ATCF ID strings into standardized short IDs.
    Example: 'WP01.2026' -> '01W', '90.W' -> '90W', 'WP92' -> '92W'
    """
    if not raw_id:
        return "UNKNOWN"
    
    clean_str = str(raw_id).replace('.', '').strip().upper()
    
    num = None
    letter = "W"
    
    # Match patterns like WP012026, WP902026
    m = re.match(r'^([A-Z]{2})(\d{2})\d{4}$', clean_str)
    if m:
        num = m.group(2)
        letter = 'W' if m.group(1) == 'WP' else m.group(1)[0]
    else:
        # Match 90W, 01W
        m = re.match(r'^(\d{2})([A-Z])$', clean_str)
        if m:
            num = m.group(1)
            letter = m.group(2)
        else:
            # Match WP90, WP01
            m = re.match(r'^([A-Z]{2})(\d{2})$', clean_str)
            if m:
                num = m.group(2)
                letter = 'W' if m.group(1) == 'WP' else m.group(1)[0]
            else:
                # Match W90, W01
                m = re.match(r'^([A-Z])(\d{2})$', clean_str)
                if m:
                    num = m.group(2)
                    letter = m.group(1)
                else:
                    # Match digits only '90', '01'
                    m = re.match(r'^(\d{2})$', clean_str)
                    if m:
                        num = m.group(1)
                        
    if num:
        return f"{num}{letter}"
            
    return clean_str


def get_short_atcf_id(raw_id):
    """Returns clean short ATCF ID like '90W' or '01W' without dots."""
    clean_name = clean_storm_id_no_dot(raw_id)
    m = re.search(r'(\d{2}[A-Z])', clean_name)
    if m:
        return m.group(1)
    return str(raw_id).replace('.', '').upper()


def fetch_knack_active_storms():
    """
    Fetches active tropical cyclones from the Knack API.
    Returns list of dicts: {'atcf_id': ..., 'name': ..., 'lat': ..., 'lon': ..., 'init_time': ...}
    """
    url = "https://api.knackwx.com/atcf/v2"
    try:
        print(f"Fetching active storms from Knack API: {url} ...")
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            
        storms = []
        for item in data:
            lat = item.get('latitude')
            lon = item.get('longitude')
            if lat is None or lon is None:
                continue
                
            lat = float(lat)
            lon = float(lon)
            
            if lon > 180:
                lon -= 360
            elif lon < -180:
                lon += 360
                
            analysis_time = item.get('analysis_time', '')
            init_time = analysis_time
            if 'T' in analysis_time:
                try:
                    dt = datetime.strptime(analysis_time.split('.')[0], "%Y-%m-%dT%H:%M:%S")
                    init_time = dt.strftime("%Y-%m-%d %H:%M:%S")
                except (ValueError, TypeError):
                    pass
                    
            atcf_id = str(item.get('atcf_id', '')).replace('.', '')
            if not (atcf_id.upper().endswith('W') or atcf_id.upper().startswith('WP')):
                continue
                
            storms.append({
                'atcf_id': atcf_id,
                'name': item.get('storm_name', 'INVEST'),
                'lat': lat,
                'lon': lon,
                'init_time': init_time
            })
        print(f"Successfully fetched {len(storms)} active storms from Knack API.")
        return storms
    except Exception as e:
        print(f"Warning: Failed to fetch from Knack API: {e}")
        return []


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2.0)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0)**2
    return R * 2.0 * math.asin(math.sqrt(a))


def normalize_dataframe(df):
    """
    Standardizes loaded track dataframes (matching plot_ensemble_spaghetti.py).
    """
    if df.empty:
        return df
        
    df = df.copy()
    df.columns = df.columns.str.strip()
    
    rename_dict = {}
    for col in df.columns:
        col_lower = col.lower()
        if col_lower in ('lat', 'latitude', 'lat_str'):
            rename_dict[col] = 'lat'
        elif col_lower in ('lon', 'longitude', 'lon_str'):
            rename_dict[col] = 'lon'
        elif col_lower in ('pressure', 'minimum_sea_level_pressure_hpa', 'mslp'):
            rename_dict[col] = 'pressure'
        elif col_lower in ('wind', 'maximum_sustained_wind_speed_knots', 'vmax'):
            rename_dict[col] = 'wind'
        elif col_lower in ('lead_time_hours', 'tau'):
            rename_dict[col] = 'lead_time_hours'
            
    df = df.rename(columns=rename_dict)
    
    if 'track_id' not in df.columns:
        if 'basin' in df.columns and 'cyclone_number' in df.columns:
            df['track_id'] = df['basin'].astype(str) + df['cyclone_number'].astype(str).str.zfill(2)
        else:
            df['track_id'] = 'STORM'
            
    if 'sample' not in df.columns:
        df['sample'] = 0
        
    for col in ['lat', 'lon', 'lead_time_hours']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
            
    if 'lon' in df.columns:
        df['lon'] = np.where(df['lon'] > 180, df['lon'] - 360, df['lon'])
        
    return df


def load_and_decrypt_track_file(file_path):
    """
    Decrypts XOR base64 DAT files or loads CSV/ATCF files, returning normalized track DataFrames.
    Supports both standard 0xAA XOR key and CalauanWeather2026 XOR key.
    """
    if not os.path.exists(file_path):
        return pd.DataFrame()
        
    try:
        if file_path.endswith('.dat'):
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    b64_content = f.read().strip()
                xored_bytes = base64.b64decode(b64_content)
                decrypted_bytes = bytearray([b ^ 0xAA for b in xored_bytes])
                csv_text = decrypted_bytes.decode('utf-8', errors='ignore')
                df = pd.read_csv(io.StringIO(csv_text), comment='#')
                if df.empty or ('lat' not in df.columns and 'track_id' not in df.columns):
                    raise ValueError("0xAA key did not produce valid columns")
            except Exception:
                try:
                    key = "CalauanWeather2026".encode('utf-8')
                    decrypted_bytes = bytearray([xored_bytes[i] ^ key[i % len(key)] for i in range(len(xored_bytes))])
                    csv_text = decrypted_bytes.decode('utf-8', errors='ignore')
                    df = pd.read_csv(io.StringIO(csv_text), comment='#')
                except Exception:
                    # Fallback for plain ATCF text file
                    df = pd.read_csv(file_path, comment='#', header=None, on_bad_lines='skip')
        else:
            df = pd.read_csv(file_path, comment='#')
            
        return normalize_dataframe(df)
    except Exception as e:
        print(f"Warning: Failed to load track file {file_path}: {e}")
        return pd.DataFrame()


def get_actual_ensemble_mean_for_storm(storm, model_file_path):
    """
    Extracts actual ensemble track members for a model from workspace files
    and computes the true geographic ensemble mean track (mean lat/lon per lead time).
    """
    df = load_and_decrypt_track_file(model_file_path)
    if df.empty or 'lat' not in df.columns or 'lon' not in df.columns:
        return pd.DataFrame()
        
    curr_lat, curr_lon = storm['lat'], storm['lon']
    short_id = get_short_atcf_id(storm['atcf_id'])
    
    # 1. First attempt: match by track_id string (e.g. 12W, WP12, WP122026)
    matching_tracks = pd.DataFrame()
    if 'track_id' in df.columns:
        track_ids = df['track_id'].astype(str).str.upper()
        mask = track_ids.str.contains(short_id.upper()) | track_ids.str.contains(storm['atcf_id'].upper())
        matching_tracks = df[mask]
        
    # 2. If no track_id match or empty, spatial proximity filter (initial point <= 500 km from active storm)
    if matching_tracks.empty:
        keep_keys = set()
        for (t_id, s_val), track_pts in df.groupby(['track_id', 'sample']):
            track_pts = track_pts.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
            if track_pts.empty:
                continue
            first_pt = track_pts.iloc[0]
            dist_km = haversine_km(first_pt['lat'], first_pt['lon'], curr_lat, curr_lon)
            if dist_km <= 500.0:
                keep_keys.add((t_id, s_val))
                
        if keep_keys:
            conds = [((df['track_id'] == k[0]) & (df['sample'] == k[1])) for k in keep_keys]
            matching_tracks = df[pd.concat(conds, axis=1).any(axis=1)]
            
    if matching_tracks.empty:
        return pd.DataFrame()
        
    # Filter sample != -1 to exclude deterministic/paired tracks from ensemble mean calculation
    calc_df = matching_tracks[matching_tracks['sample'] != -1]
    if calc_df.empty:
        calc_df = matching_tracks
        
    # Calculate required_support (50% of the total ensemble size for this storm)
    total_members = calc_df['sample'].nunique()
    if total_members > 0:
        required_support = max(1, total_members // 2)
    else:
        required_support = 1
        
    # Group by lead_time_hours and enforce hourly member support constraint
    mean_rows = []
    for h, h_group in calc_df.groupby('lead_time_hours'):
        valid_pts = h_group.dropna(subset=['lat', 'lon'])
        n_active = len(valid_pts)
        if n_active >= required_support:
            row_dict = {
                'lead_time_hours': h,
                'lat': valid_pts['lat'].mean(),
                'lon': valid_pts['lon'].mean()
            }
            if 'wind' in valid_pts.columns:
                w_mean = valid_pts['wind'].mean()
                row_dict['wind'] = w_mean
            if 'pressure' in valid_pts.columns:
                row_dict['pressure'] = valid_pts['pressure'].mean()
            mean_rows.append(row_dict)

    mean_track = pd.DataFrame(mean_rows)
    if not mean_track.empty:
        mean_track = mean_track.sort_values('lead_time_hours')
    return mean_track


def parse_atcf_latlon(val_str):
    """Parses ATCF lat/lon format like '145N' or '1320E'."""
    if not val_str or str(val_str).strip() == '':
        return float('nan')
    val_str = str(val_str).strip()
    try:
        num = float(val_str[:-1]) / 10.0
        if val_str[-1].upper() in ('S', 'W'):
            num = -num
        return num
    except (ValueError, IndexError):
        return float('nan')


def get_fnv3_paired_mean_track(storm, data_dir='public/data'):
    """
    Checks for available WNCv3 paired mean track files (wnv3_paired_latest.dat, wnv3_paired_latest.csv).
    Only uses recent/latest model initialization files.
    """
    latest_files = [
        os.path.join(data_dir, 'wnv3_paired_latest.dat'),
        os.path.join(data_dir, 'wnv3_paired_latest.csv')
    ]
    
    other_candidates = glob.glob(os.path.join(data_dir, 'wn*paired*.dat')) + glob.glob(os.path.join(data_dir, 'wn*paired*.csv')) + glob.glob(os.path.join('temp_data', 'wn*paired*.csv'))
    other_candidates = [f for f in other_candidates if 'latest' not in os.path.basename(f)]
    other_candidates.sort(key=lambda f: os.path.getmtime(f), reverse=True)
    
    paired_candidates = [f for f in latest_files if os.path.exists(f)] + other_candidates
    
    curr_lat, curr_lon = storm['lat'], storm['lon']
    short_id = get_short_atcf_id(storm['atcf_id'])
    
    for fpath in paired_candidates:
        if not os.path.exists(fpath):
            continue
            
        # Reject historical files older than 48 hours unless it's explicitly named *_latest.*
        if 'latest' not in os.path.basename(fpath):
            file_mtime = os.path.getmtime(fpath)
            age_hours = (datetime.now().timestamp() - file_mtime) / 3600.0
            if age_hours > 48.0:
                continue

        df = load_and_decrypt_track_file(fpath)
        if df.empty or 'lat' not in df.columns or 'lon' not in df.columns:
            continue
            
        # Filter paired tracks (sample == -1)
        paired_df = df[df['sample'] == -1].copy()
        if paired_df.empty:
            paired_df = df
            
        # Match track closest to active storm position (tightened distance threshold to 250km)
        best_tid = None
        best_dist = 250.0
        
        for tid, t_df in paired_df.groupby('track_id'):
            t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
            if t_df.empty:
                continue
            first_row = t_df.iloc[0]
            d_km = haversine_km(first_row['lat'], first_row['lon'], curr_lat, curr_lon)
            if d_km < best_dist:
                best_dist = d_km
                best_tid = tid
                
        if best_tid is not None:
            matched = paired_df[paired_df['track_id'] == best_tid].sort_values('lead_time_hours')
            cols_to_keep = ['lead_time_hours', 'lat', 'lon']
            if 'wind' in matched.columns: cols_to_keep.append('wind')
            if 'pressure' in matched.columns: cols_to_keep.append('pressure')
            res = matched[cols_to_keep].dropna(subset=['lat', 'lon'])
            if not res.empty:
                print(f"Found official WNCv3 paired mean track for {short_id} in {os.path.basename(fpath)} (dist: {best_dist:.1f}km)")
                return res
                
    return pd.DataFrame()


def get_gfs_control_or_mean_track(storm, data_dir='public/data'):
    """
    Checks for available GFS / GEFS forecast track for the active storm:
    1. Phase 1: GFS Deterministic (AVNO) & GEFS Control (AC00).
    2. Phase 2: GEFS Ensemble Mean (AEMN) as fallback.
    Checks local files first, then queries live NOAA NOMADS endpoints.
    Returns (DataFrame, init_time_str, track_type) where track_type is 'Control' or 'Mean'.
    """
    curr_lat, curr_lon = storm['lat'], storm['lon']
    short_id = get_short_atcf_id(storm['atcf_id'])
    storm_name = str(storm.get('name', '')).strip().upper()
    now_utc = datetime.now(timezone.utc)

    # ─────────────────────────────────────────────────────────────
    # Phase 1: Check Deterministic Control Track (AVNO or AC00)
    # ─────────────────────────────────────────────────────────────
    ctrl_local_files = [
        os.path.join(data_dir, 'gfs_tc_latest.dat'),
        os.path.join(data_dir, 'gfs_tc_latest.csv'),
        os.path.join(data_dir, 'gefs_tc_latest.dat'),
        os.path.join(data_dir, 'gefs_tc_latest.csv')
    ] + glob.glob(os.path.join(data_dir, '*avno*.trackatcfunix')) \
      + glob.glob(os.path.join(data_dir, '*ac00*.trackatcfunix')) \
      + glob.glob(os.path.join('temp_data', '*avno*.trackatcfunix')) \
      + glob.glob(os.path.join('temp_data', '*ac00*.trackatcfunix'))

    for fpath in ctrl_local_files:
        if not os.path.exists(fpath):
            continue
        df = load_and_decrypt_track_file(fpath)
        if df.empty or 'lat' not in df.columns or 'lon' not in df.columns:
            continue
            
        ctrl_df = pd.DataFrame()
        if 'sample' in df.columns and (df['sample'] == 0).any():
            ctrl_df = df[df['sample'] == 0].copy()
        elif 'tech' in df.columns:
            mask = df['tech'].astype(str).str.upper().isin(['AVNO', 'AC00', 'GFS', 'GFSO', 'AVNX'])
            ctrl_df = df[mask].copy()
        else:
            ctrl_df = df.copy()

        for tid, t_df in ctrl_df.groupby('track_id'):
            t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
            if t_df.empty:
                continue
            first_row = t_df.iloc[0]
            d_km = haversine_km(first_row['lat'], first_row['lon'], curr_lat, curr_lon)
            tid_upper = str(tid).upper()
            is_match = (
                short_id.upper() in tid_upper or
                f"WP{short_id.upper().rstrip('W')}" == tid_upper or
                str(storm.get('atcf_id', '')).upper() in tid_upper or
                (storm_name != '' and storm_name in tid_upper)
            )
            if (is_match and d_km <= 800.0) or d_km <= 500.0:
                init_str = None
                if 'init_time' in t_df.columns and not t_df['init_time'].dropna().empty:
                    try:
                        init_dt = pd.to_datetime(t_df['init_time'].dropna().iloc[0])
                        init_str = init_dt.strftime('%Y-%m-%d %HZ')
                    except Exception:
                        pass
                cols = ['lead_time_hours', 'lat', 'lon']
                if 'wind' in t_df.columns: cols.append('wind')
                if 'pressure' in t_df.columns: cols.append('pressure')
                res = t_df[cols].copy()
                print(f"Found local GFS Deterministic/Control track for {short_id} in {os.path.basename(fpath)} (dist: {d_km:.1f}km)")
                return res, init_str, "Control"

    # Live NOAA NOMADS: GFS Deterministic (AVNO) and GEFS Control (AC00)
    for day_offset in range(3):
        date_str = (now_utc - timedelta(days=day_offset)).strftime("%Y%m%d")
        for rt in ['18', '12', '06', '00']:
            live_ctrl_urls = [
                f"https://nomads.ncep.noaa.gov/pub/data/nccf/com/ens_tracker/prod/gfs.{date_str}/{rt}/tctrack/avno.t{rt}z.cyclone.trackatcfunix",
                f"https://nomads.ncep.noaa.gov/pub/data/nccf/com/ens_tracker/prod/gefs.{date_str}/{rt}/tctrack/ac00.t{rt}z.cyclone.trackatcfunix"
            ]
            for url in live_ctrl_urls:
                try:
                    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, timeout=4) as response:
                        content = response.read().decode('utf-8', errors='ignore')
                    
                    rows = []
                    for line in content.splitlines():
                        parts = [p.strip() for p in line.split(',')]
                        if len(parts) >= 10:
                            b, cy, ymdh, tau, la_str, lo_str = parts[0], parts[1], parts[2], parts[5], parts[6], parts[7]
                            la = parse_atcf_latlon(la_str)
                            lo = parse_atcf_latlon(lo_str)
                            try: h = int(tau)
                            except ValueError: h = 0
                            row_data = {'track_id': f"{b}{cy}", 'lead_time_hours': h, 'lat': la, 'lon': lo}
                            if len(parts) > 8 and parts[8].strip():
                                try: row_data['wind'] = float(parts[8])
                                except ValueError: pass
                            if len(parts) > 9 and parts[9].strip():
                                try: row_data['pressure'] = float(parts[9])
                                except ValueError: pass
                            rows.append(row_data)
                            
                    if rows:
                        live_df = pd.DataFrame(rows)
                        for tid, t_df in live_df.groupby('track_id'):
                            t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
                            if t_df.empty:
                                continue
                            first_row = t_df.iloc[0]
                            d_km = haversine_km(first_row['lat'], first_row['lon'], curr_lat, curr_lon)
                            tid_upper = str(tid).upper()
                            is_match = (
                                short_id.upper() in tid_upper or
                                f"WP{short_id.upper().rstrip('W')}" == tid_upper or
                                str(storm.get('atcf_id', '')).upper() in tid_upper
                            )
                            if (is_match and d_km <= 800.0) or d_km <= 500.0:
                                live_init_str = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]} {rt}Z"
                                src_name = "GFS AVNO" if "avno" in url else "GEFS AC00"
                                print(f"Successfully fetched live NOAA {src_name} deterministic control track for {short_id} (Run: {live_init_str}, dist: {d_km:.1f}km)")
                                cols_ret = ['lead_time_hours', 'lat', 'lon']
                                if 'wind' in t_df.columns: cols_ret.append('wind')
                                if 'pressure' in t_df.columns: cols_ret.append('pressure')
                                return t_df[cols_ret].copy(), live_init_str, "Control"
                except Exception:
                    continue

    # ─────────────────────────────────────────────────────────────
    # Phase 2: Fallback to Ensemble Mean (AEMN)
    # ─────────────────────────────────────────────────────────────
    mean_local_files = [
        os.path.join(data_dir, 'gefs_tc_latest.dat'),
        os.path.join(data_dir, 'gefs_tc_latest.csv')
    ] + glob.glob(os.path.join(data_dir, '*aemn*.trackatcfunix')) \
      + glob.glob(os.path.join(data_dir, '*gemn*.trackatcfunix')) \
      + glob.glob(os.path.join('temp_data', '*aemn*.trackatcfunix'))

    for fpath in mean_local_files:
        if not os.path.exists(fpath):
            continue
        df = load_and_decrypt_track_file(fpath)
        if df.empty or 'lat' not in df.columns or 'lon' not in df.columns:
            continue
            
        mean_df = pd.DataFrame()
        if 'sample' in df.columns and (df['sample'] == -1).any():
            mean_df = df[df['sample'] == -1].copy()
        elif 'tech' in df.columns:
            mask = df['tech'].astype(str).str.upper().isin(['AEMN', 'GEMN'])
            mean_df = df[mask].copy()

        for tid, t_df in mean_df.groupby('track_id'):
            t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
            if t_df.empty:
                continue
            first_row = t_df.iloc[0]
            d_km = haversine_km(first_row['lat'], first_row['lon'], curr_lat, curr_lon)
            tid_upper = str(tid).upper()
            is_match = (
                short_id.upper() in tid_upper or
                f"WP{short_id.upper().rstrip('W')}" == tid_upper or
                str(storm.get('atcf_id', '')).upper() in tid_upper
            )
            if (is_match and d_km <= 800.0) or d_km <= 500.0:
                init_str = None
                if 'init_time' in t_df.columns and not t_df['init_time'].dropna().empty:
                    try:
                        init_dt = pd.to_datetime(t_df['init_time'].dropna().iloc[0])
                        init_str = init_dt.strftime('%Y-%m-%d %HZ')
                    except Exception:
                        pass
                cols = ['lead_time_hours', 'lat', 'lon']
                if 'wind' in t_df.columns: cols.append('wind')
                if 'pressure' in t_df.columns: cols.append('pressure')
                print(f"Found local GEFS ensemble mean track for {short_id} in {os.path.basename(fpath)} (dist: {d_km:.1f}km)")
                return t_df[cols].copy(), init_str, "Mean"

    # Live NOAA NOMADS: GEFS Ensemble Mean (AEMN)
    for day_offset in range(3):
        date_str = (now_utc - timedelta(days=day_offset)).strftime("%Y%m%d")
        for rt in ['18', '12', '06', '00']:
            mean_url = f"https://nomads.ncep.noaa.gov/pub/data/nccf/com/ens_tracker/prod/gefs.{date_str}/{rt}/tctrack/aemn.t{rt}z.cyclone.trackatcfunix"
            try:
                req = urllib.request.Request(mean_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=4) as response:
                    content = response.read().decode('utf-8', errors='ignore')
                rows = []
                for line in content.splitlines():
                    parts = [p.strip() for p in line.split(',')]
                    if len(parts) >= 10:
                        b, cy, ymdh, tau, la_str, lo_str = parts[0], parts[1], parts[2], parts[5], parts[6], parts[7]
                        la = parse_atcf_latlon(la_str)
                        lo = parse_atcf_latlon(lo_str)
                        try: h = int(tau)
                        except ValueError: h = 0
                        row_data = {'track_id': f"{b}{cy}", 'lead_time_hours': h, 'lat': la, 'lon': lo}
                        if len(parts) > 8 and parts[8].strip():
                            try: row_data['wind'] = float(parts[8])
                            except ValueError: pass
                        if len(parts) > 9 and parts[9].strip():
                            try: row_data['pressure'] = float(parts[9])
                            except ValueError: pass
                        rows.append(row_data)
                        
                if rows:
                    live_df = pd.DataFrame(rows)
                    for tid, t_df in live_df.groupby('track_id'):
                        t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
                        if t_df.empty:
                            continue
                        first_row = t_df.iloc[0]
                        d_km = haversine_km(first_row['lat'], first_row['lon'], curr_lat, curr_lon)
                        tid_upper = str(tid).upper()
                        is_match = (
                            short_id.upper() in tid_upper or
                            f"WP{short_id.upper().rstrip('W')}" == tid_upper or
                            str(storm.get('atcf_id', '')).upper() in tid_upper
                        )
                        if (is_match and d_km <= 800.0) or d_km <= 500.0:
                            live_init_str = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]} {rt}Z"
                            print(f"Successfully fetched live NOAA GEFS ensemble mean track for {short_id} (Run: {live_init_str}, dist: {d_km:.1f}km)")
                            cols_ret = ['lead_time_hours', 'lat', 'lon']
                            if 'wind' in t_df.columns: cols_ret.append('wind')
                            if 'pressure' in t_df.columns: cols_ret.append('pressure')
                            return t_df[cols_ret].copy(), live_init_str, "Mean"
            except Exception:
                continue

    return pd.DataFrame(), None, None


def get_aigefs_control_or_mean_track(storm, data_dir='public/data'):
    """
    Checks for available AIGEFS forecast track for the active storm:
    1. Phase 1: AIGEFS Control member (a000 / sample == 0).
    2. Phase 2: AIGEFS Ensemble Mean (aimn / sample == -1) as fallback.
    Checks local files first (aigefs_tc_latest.dat / csv / glob), then queries live NOAA NOMADS endpoints.
    Returns (DataFrame, init_time_str, track_type) where track_type is 'Control' or 'Mean'.
    """
    curr_lat, curr_lon = storm['lat'], storm['lon']
    short_id = get_short_atcf_id(storm['atcf_id'])
    storm_name = str(storm.get('name', '')).strip().upper()
    now_utc = datetime.now(timezone.utc)

    # ─────────────────────────────────────────────────────────────
    # Phase 1: Check Deterministic Control Track (sample == 0 / a000)
    # ─────────────────────────────────────────────────────────────
    ctrl_local_files = [
        os.path.join(data_dir, 'aigefs_tc_latest.dat'),
        os.path.join(data_dir, 'aigefs_tc_latest.csv')
    ] + glob.glob(os.path.join(data_dir, '*a000*.trackatcfunix')) \
      + glob.glob(os.path.join('temp_data', '*a000*.trackatcfunix'))

    for fpath in ctrl_local_files:
        if not os.path.exists(fpath):
            continue
        if 'latest' not in os.path.basename(fpath):
            file_mtime = os.path.getmtime(fpath)
            age_hours = (datetime.now().timestamp() - file_mtime) / 3600.0
            if age_hours > 72.0:
                continue

        df = load_and_decrypt_track_file(fpath)
        if df.empty or 'lat' not in df.columns or 'lon' not in df.columns:
            continue

        ctrl_df = pd.DataFrame()
        if 'sample' in df.columns and (df['sample'] == 0).any():
            ctrl_df = df[df['sample'] == 0].copy()
        elif 'tech' in df.columns:
            mask = df['tech'].astype(str).str.upper().isin(['A000', 'AIG0', 'AC00'])
            ctrl_df = df[mask].copy()

        if not ctrl_df.empty:
            for tid, t_df in ctrl_df.groupby('track_id'):
                t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
                if t_df.empty:
                    continue
                first_row = t_df.iloc[0]
                d_km = haversine_km(first_row['lat'], first_row['lon'], curr_lat, curr_lon)
                tid_upper = str(tid).upper()
                is_match = (
                    short_id.upper() in tid_upper or
                    f"WP{short_id.upper().rstrip('W')}" == tid_upper or
                    str(storm.get('atcf_id', '')).upper() in tid_upper or
                    (storm_name != '' and storm_name in tid_upper)
                )
                if (is_match and d_km <= 800.0) or d_km <= 500.0:
                    init_str = None
                    if 'init_time' in t_df.columns and not t_df['init_time'].dropna().empty:
                        try:
                            init_dt = pd.to_datetime(t_df['init_time'].dropna().iloc[0])
                            init_str = init_dt.strftime('%Y-%m-%d %HZ')
                        except Exception:
                            pass
                    cols = ['lead_time_hours', 'lat', 'lon']
                    if 'wind' in t_df.columns: cols.append('wind')
                    if 'pressure' in t_df.columns: cols.append('pressure')
                    res = t_df[cols].copy()
                    print(f"Found local AIGEFS Control track for {short_id} in {os.path.basename(fpath)} (dist: {d_km:.1f}km)")
                    return res, init_str, "Control"

    # Live NOAA NOMADS: AIGEFS Control (a000)
    for day_offset in range(3):
        date_str = (now_utc - timedelta(days=day_offset)).strftime("%Y%m%d")
        for rt in ['18', '12', '06', '00']:
            live_ctrl_url = f"https://nomads.ncep.noaa.gov/pub/data/nccf/com/ens_tracker/prod/aigefs.{date_str}/{rt}/tctrack/a000.t{rt}z.cyclone.trackatcfunix"
            try:
                req = urllib.request.Request(live_ctrl_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=4) as response:
                    content = response.read().decode('utf-8', errors='ignore')
                rows = []
                for line in content.splitlines():
                    parts = [p.strip() for p in line.split(',')]
                    if len(parts) >= 10:
                        b, cy, ymdh, tau, la_str, lo_str = parts[0], parts[1], parts[2], parts[5], parts[6], parts[7]
                        la = parse_atcf_latlon(la_str)
                        lo = parse_atcf_latlon(lo_str)
                        try: h = int(tau)
                        except ValueError: h = 0
                        row_data = {'track_id': f"{b}{cy}", 'lead_time_hours': h, 'lat': la, 'lon': lo}
                        if len(parts) > 8 and parts[8].strip():
                            try: row_data['wind'] = float(parts[8])
                            except ValueError: pass
                        if len(parts) > 9 and parts[9].strip():
                            try: row_data['pressure'] = float(parts[9])
                            except ValueError: pass
                        rows.append(row_data)
                if rows:
                    live_df = pd.DataFrame(rows)
                    for tid, t_df in live_df.groupby('track_id'):
                        t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
                        if t_df.empty:
                            continue
                        first_row = t_df.iloc[0]
                        d_km = haversine_km(first_row['lat'], first_row['lon'], curr_lat, curr_lon)
                        tid_upper = str(tid).upper()
                        is_match = (
                            short_id.upper() in tid_upper or
                            f"WP{short_id.upper().rstrip('W')}" == tid_upper or
                            str(storm.get('atcf_id', '')).upper() in tid_upper
                        )
                        if (is_match and d_km <= 800.0) or d_km <= 500.0:
                            live_init_str = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]} {rt}Z"
                            print(f"Successfully fetched live NOAA AIGEFS a000 control track for {short_id} (Run: {live_init_str}, dist: {d_km:.1f}km)")
                            cols_ret = ['lead_time_hours', 'lat', 'lon']
                            if 'wind' in t_df.columns: cols_ret.append('wind')
                            if 'pressure' in t_df.columns: cols_ret.append('pressure')
                            return t_df[cols_ret].copy(), live_init_str, "Control"
            except Exception:
                continue

    # ─────────────────────────────────────────────────────────────
    # Phase 2: Fallback to Ensemble Mean (AIMN / sample == -1)
    # ─────────────────────────────────────────────────────────────
    mean_local_files = [
        os.path.join(data_dir, 'aigefs_tc_latest.dat'),
        os.path.join(data_dir, 'aigefs_tc_latest.csv')
    ] + glob.glob(os.path.join(data_dir, '*aimn*.trackatcfunix')) \
      + glob.glob(os.path.join('temp_data', '*aimn*.trackatcfunix'))

    for fpath in mean_local_files:
        if not os.path.exists(fpath):
            continue
        if 'latest' not in os.path.basename(fpath):
            file_mtime = os.path.getmtime(fpath)
            age_hours = (datetime.now().timestamp() - file_mtime) / 3600.0
            if age_hours > 72.0:
                continue

        df = load_and_decrypt_track_file(fpath)
        if df.empty or 'lat' not in df.columns or 'lon' not in df.columns:
            continue

        mean_df = pd.DataFrame()
        if 'sample' in df.columns and (df['sample'] == -1).any():
            mean_df = df[df['sample'] == -1].copy()
        elif 'tech' in df.columns:
            mask = df['tech'].astype(str).str.upper().str.contains('AIMN')
            mean_df = df[mask].copy()
        elif 'track_id' in df.columns:
            mask = df['track_id'].astype(str).str.upper().str.contains('AIMN')
            mean_df = df[mask].copy()

        if not mean_df.empty:
            for tid, t_df in mean_df.groupby('track_id'):
                t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
                if t_df.empty:
                    continue
                first_row = t_df.iloc[0]
                d_km = haversine_km(first_row['lat'], first_row['lon'], curr_lat, curr_lon)
                tid_upper = str(tid).upper()
                is_match = (
                    short_id.upper() in tid_upper or
                    f"WP{short_id.upper().rstrip('W')}" == tid_upper or
                    str(storm.get('atcf_id', '')).upper() in tid_upper
                )
                if (is_match and d_km <= 800.0) or d_km <= 500.0:
                    init_str = None
                    if 'init_time' in t_df.columns and not t_df['init_time'].dropna().empty:
                        try:
                            init_dt = pd.to_datetime(t_df['init_time'].dropna().iloc[0])
                            init_str = init_dt.strftime('%Y-%m-%d %HZ')
                        except Exception:
                            pass
                    cols = ['lead_time_hours', 'lat', 'lon']
                    if 'wind' in t_df.columns: cols.append('wind')
                    if 'pressure' in t_df.columns: cols.append('pressure')
                    print(f"Found local AIGEFS ensemble mean track for {short_id} in {os.path.basename(fpath)} (dist: {d_km:.1f}km)")
                    return t_df[cols].copy(), init_str, "Mean"

    # Live NOAA NOMADS: AIGEFS Ensemble Mean (AIMN)
    for day_offset in range(3):
        date_str = (now_utc - timedelta(days=day_offset)).strftime("%Y%m%d")
        for rt in ['18', '12', '06', '00']:
            mean_url = f"https://nomads.ncep.noaa.gov/pub/data/nccf/com/ens_tracker/prod/aigefs.{date_str}/{rt}/tctrack/aimn.t{rt}z.cyclone.trackatcfunix"
            try:
                req = urllib.request.Request(mean_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=4) as response:
                    content = response.read().decode('utf-8', errors='ignore')
                rows = []
                for line in content.splitlines():
                    parts = [p.strip() for p in line.split(',')]
                    if len(parts) >= 10:
                        b, cy, ymdh, tau, la_str, lo_str = parts[0], parts[1], parts[2], parts[5], parts[6], parts[7]
                        la = parse_atcf_latlon(la_str)
                        lo = parse_atcf_latlon(lo_str)
                        try: h = int(tau)
                        except ValueError: h = 0
                        row_data = {'track_id': f"{b}{cy}", 'lead_time_hours': h, 'lat': la, 'lon': lo}
                        if len(parts) > 8 and parts[8].strip():
                            try: row_data['wind'] = float(parts[8])
                            except ValueError: pass
                        if len(parts) > 9 and parts[9].strip():
                            try: row_data['pressure'] = float(parts[9])
                            except ValueError: pass
                        rows.append(row_data)
                if rows:
                    live_df = pd.DataFrame(rows)
                    for tid, t_df in live_df.groupby('track_id'):
                        t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
                        if t_df.empty:
                            continue
                        first_row = t_df.iloc[0]
                        d_km = haversine_km(first_row['lat'], first_row['lon'], curr_lat, curr_lon)
                        tid_upper = str(tid).upper()
                        is_match = (
                            short_id.upper() in tid_upper or
                            f"WP{short_id.upper().rstrip('W')}" == tid_upper or
                            str(storm.get('atcf_id', '')).upper() in tid_upper
                        )
                        if (is_match and d_km <= 800.0) or d_km <= 500.0:
                            live_init_str = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]} {rt}Z"
                            print(f"Successfully fetched live NOAA AIGEFS ensemble mean track for {short_id} (Run: {live_init_str}, dist: {d_km:.1f}km)")
                            cols_ret = ['lead_time_hours', 'lat', 'lon']
                            if 'wind' in t_df.columns: cols_ret.append('wind')
                            if 'pressure' in t_df.columns: cols_ret.append('pressure')
                            return t_df[cols_ret].copy(), live_init_str, "Mean"
            except Exception:
                continue

    return pd.DataFrame(), None, None


# Backward-compatibility alias
get_aigefs_aimn_mean_track = get_aigefs_control_or_mean_track


def get_pagasa_official_track(storm, data_dir='public/data'):
    """
    Fetches and parses PAGASA's official forecast track from https://pubfiles.pagasa.dost.gov.ph/tamss/weather/cyclone.dat
    or local fallback file public/data/cyclone.dat.
    """
    url = "https://pubfiles.pagasa.dost.gov.ph/tamss/weather/cyclone.dat"
    local_path = os.path.join(data_dir, "cyclone.dat")
    content = ""
    
    # 1. Attempt live download from PAGASA public server
    try:
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req, timeout=6) as response:
            content = response.read().decode('utf-8', errors='ignore')
            if content.strip():
                os.makedirs(data_dir, exist_ok=True)
                with open(local_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                print(f"Successfully fetched live PAGASA cyclone.dat from {url}")
    except Exception as e:
        print(f"Notice: Live PAGASA fetch from {url} encountered: {e}")

    # 2. Fallback to local cyclone.dat file if live fetch produced no content
    if not content.strip() and os.path.exists(local_path):
        try:
            with open(local_path, 'r', encoding='utf-8') as f:
                content = f.read()
            print(f"Loaded PAGASA cyclone.dat from local cache {local_path}")
        except Exception:
            pass

    curr_lat, curr_lon = float(storm['lat']), float(storm['lon'])
    short_id = get_short_atcf_id(storm['atcf_id'])
    parsed_pts = []
    
    for line in content.splitlines():
        line = line.strip()
        if not line or '{' in line:
            continue
        parts = [p.strip() for p in line.split(',')]
        if len(parts) >= 5:
            cat = parts[0]
            date_str = parts[1]
            time_str = parts[2]
            try:
                lat = float(parts[3])
                lon = float(parts[4])
                radius = float(parts[5]) if len(parts) >= 6 and parts[5] else 0.0
                dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
                parsed_pts.append({
                    'datetime': dt,
                    'lat': lat,
                    'lon': lon,
                    'category': cat,
                    'radius': radius
                })
            except Exception:
                continue

    if not parsed_pts:
        return pd.DataFrame(), None

    match = re.search(r'^([A-Za-z0-9_-]+)\{', content.strip().splitlines()[0]) if content.strip() else None
    matched_name = match.group(1).upper() if match else None

    # Find candidate points from the last analysis fix onwards
    idx_t0 = 0
    for i in range(len(parsed_pts) - 1, -1, -1):
        if parsed_pts[i]['radius'] == 0.0:
            idx_t0 = i
            break

    candidate_pts = parsed_pts[idx_t0:]
    
    # Find the point in candidate_pts closest to the current active storm position
    # to eliminate older historical fixes that precede the current active fix
    best_idx = 0
    best_dist = haversine_km(candidate_pts[0]['lat'], candidate_pts[0]['lon'], curr_lat, curr_lon)
    for i, pt in enumerate(candidate_pts):
        d = haversine_km(pt['lat'], pt['lon'], curr_lat, curr_lon)
        if d < best_dist:
            best_dist = d
            best_idx = i
            
    valid_pts = candidate_pts[best_idx:]
    if not valid_pts:
        valid_pts = candidate_pts

    t0 = valid_pts[0]['datetime']
    
    # Check bulletin age relative to storm initialization time
    ref_time = None
    if storm.get('init_time'):
        try:
            ref_time = pd.to_datetime(str(storm['init_time']).split('.')[0])
            if ref_time.tzinfo is None:
                ref_time = ref_time.tz_localize(timezone.utc)
        except Exception:
            pass
    if ref_time is None:
        ref_time = datetime.now(timezone.utc)
        
    if t0:
        t0_utc = t0.replace(tzinfo=timezone.utc)
        age_hours = (ref_time - t0_utc).total_seconds() / 3600.0
        if age_hours > 18.0:
            print(f"Notice: PAGASA bulletin for {short_id} is outdated ({age_hours:.1f}h old); PAGASA has stopped forecasting.")
            return pd.DataFrame(), None

    rows = []
    for pt in valid_pts:
        tau = max(0.0, (pt['datetime'] - t0).total_seconds() / 3600.0)
        rows.append({
            'lead_time_hours': tau,
            'lat': pt['lat'],
            'lon': pt['lon'],
            'category': pt.get('category', '')
        })

    df = pd.DataFrame(rows).drop_duplicates(subset=['lead_time_hours']).sort_values('lead_time_hours')
    if df.empty:
        return pd.DataFrame(), None
        
    # Check if PAGASA has future forecast positions (not just past / analysis points)
    future_pts = df[df['lead_time_hours'] > 0]
    if future_pts.empty or len(df) < 2:
        print(f"Notice: PAGASA bulletin for {short_id} has no future forecast positions; skipping PAGASA display.")
        return pd.DataFrame(), None

    first_pt = df.iloc[0]
    first_dist_km = haversine_km(first_pt['lat'], first_pt['lon'], curr_lat, curr_lon)
    min_dist_km = min(haversine_km(r['lat'], r['lon'], curr_lat, curr_lon) for _, r in df.iterrows())
    
    # Accept PAGASA track ONLY if active, starting fix within 350 km of storm center
    if first_dist_km <= 350.0 and min_dist_km <= 350.0:
        if matched_name:
            storm['pagasa_name'] = matched_name
        print(f"Matched official PAGASA track for {short_id} (Name: {matched_name}, dist: {min_dist_km:.1f}km)")
        return df[['lead_time_hours', 'lat', 'lon']], t0.strftime('%Y-%m-%d %HZ') if t0 else None
        
    return pd.DataFrame(), None


def get_ecmwf_control_or_paired_track(storm, fpath):
    """
    Checks if an ECMWF file contains an official deterministic control track:
    1. Checks explicit flags: 'forecast_type' == 0 or 'is_control' == True.
    2. Checks standard control member (sample == 0) or paired track (sample == -1).
    3. Checks ECMWF 1-indexed BUFR ensemble convention:
       - AIFS: sample == 52 (unperturbed high-resolution deterministic control forecast, descriptor 001092 = 0)
               fallback to sample == 51 (control forecast type 1)
       - IFS:  sample == 51 (unperturbed high-resolution deterministic control forecast, descriptor 001092 = 0)
    Matches candidates to the active storm by ATCF ID, storm name, or nearest distance within 500 km (or 800 km if name/ID matches).
    Returns that official deterministic control track DataFrame if available, else an empty DataFrame.
    """
    if not os.path.exists(fpath):
        return pd.DataFrame()
        
    df = load_and_decrypt_track_file(fpath)
    if df.empty or 'lat' not in df.columns or 'lon' not in df.columns:
        return pd.DataFrame()
        
    curr_lat, curr_lon = storm['lat'], storm['lon']
    short_id = get_short_atcf_id(storm['atcf_id'])
    storm_name = str(storm.get('name', '')).strip().upper()
    
    # 1. Filter deterministic control member rows
    ctrl_df = pd.DataFrame()
    if 'forecast_type' in df.columns and (df['forecast_type'] == 0).any():
        ctrl_df = df[df['forecast_type'] == 0].copy()
    elif 'is_control' in df.columns and df['is_control'].any():
        ctrl_df = df[df['is_control'] == True].copy()
    elif 'sample' in df.columns:
        if (df['sample'] == 0).any():
            ctrl_df = df[df['sample'] == 0].copy()
        elif (df['sample'] == -1).any():
            ctrl_df = df[df['sample'] == -1].copy()
        else:
            fname = os.path.basename(fpath).lower()
            samples = set(df['sample'].dropna().unique())
            if 'aifs' in fname:
                if 52 in samples:
                    ctrl_df = df[df['sample'] == 52].copy()
                elif 51 in samples:
                    ctrl_df = df[df['sample'] == 51].copy()
            elif 'ifs' in fname:
                if 51 in samples:
                    ctrl_df = df[df['sample'] == 51].copy()
            else:
                if 52 in samples:
                    ctrl_df = df[df['sample'] == 52].copy()
                elif 51 in samples:
                    ctrl_df = df[df['sample'] == 51].copy()

    if ctrl_df.empty:
        return pd.DataFrame()
        
    best_tid = None
    best_dist = 500.0  # km threshold
    best_score = float('inf')
    
    for tid, t_df in ctrl_df.groupby('track_id'):
        t_df = t_df.sort_values('lead_time_hours').dropna(subset=['lat', 'lon'])
        if t_df.empty:
            continue
        first_row = t_df.iloc[0]
        d_km = haversine_km(first_row['lat'], first_row['lon'], curr_lat, curr_lon)
        
        tid_upper = str(tid).upper()
        is_id_match = (
            short_id.upper() in tid_upper or 
            str(storm.get('atcf_id', '')).upper() in tid_upper or 
            (storm_name != '' and storm_name in tid_upper)
        )
        
        # Prioritize ID/name matches with a score bonus
        if is_id_match and d_km <= 800.0:
            score = d_km - 1000.0
        elif d_km <= best_dist:
            score = d_km
        else:
            continue
            
        if score < best_score:
            best_score = score
            best_dist = d_km
            best_tid = tid
            
    if best_tid is not None:
        matched = ctrl_df[ctrl_df['track_id'] == best_tid].sort_values('lead_time_hours')
        cols_to_keep = ['lead_time_hours', 'lat', 'lon']
        if 'wind' in matched.columns: cols_to_keep.append('wind')
        if 'pressure' in matched.columns: cols_to_keep.append('pressure')
        res = matched[cols_to_keep].dropna(subset=['lat', 'lon'])
        if not res.empty:
            print(f"Found official ECMWF deterministic control track for {short_id} (track_id: {best_tid}, dist: {best_dist:.1f}km)")
            return res
            
    return pd.DataFrame()

def get_jtwc_official_track(storm, data_dir='public/data'):
    """
    Fetches official JTWC forecast track for Western Pacific storms from Navy JTWC .tcw files:
    - https://www.metoc.navy.mil/jtwc/products/wp{num}{year_short}.tcw
    The .tcw file contains structured forecast lines like:
        T000 236N 1509E 110
        T012 243N 1483E 100
    Format: T{hours} {lat}{N/S} {lon}{E/W} {wind_kt}
    If no official JTWC forecast track exists, returns an empty DataFrame.
    """
    raw_id = str(storm['atcf_id']).replace('.', '').upper()
    short_id = get_short_atcf_id(raw_id)
    
    m = re.search(r'(\d{2})([A-Z])', short_id)
    if not m:
        return pd.DataFrame(), None
        
    num_str, basin_letter = m.group(1), m.group(2)
    if basin_letter != 'W':
        return pd.DataFrame(), None  # Western Pacific storms only
    
    # Skip invests (90-99) — JTWC only issues warnings for numbered storms
    num_val = int(num_str)
    if num_val >= 90:
        return pd.DataFrame(), None
        
    now_year = datetime.now(timezone.utc).year
    year_short = str(now_year)[-2:]
    
    local_path = os.path.join(data_dir, f"jtwc_wp{num_str}{year_short}.tcw")
    
    urls_to_try = [
        f"https://www.metoc.navy.mil/jtwc/products/wp{num_str}{year_short}.tcw",
        f"https://www.metoc.navy.mil/jtwc/products/wp{num_str}{year_short}web.txt",
    ]
    
    content = ""
    for url in urls_to_try:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
            with urllib.request.urlopen(req, timeout=6) as resp:
                text = resp.read().decode('utf-8', errors='ignore')
                if text.strip():
                    content = text
                    os.makedirs(data_dir, exist_ok=True)
                    with open(local_path, 'w', encoding='utf-8') as f:
                        f.write(text)
                    print(f"Successfully fetched official JTWC track for {short_id} from {url}")
                    break
        except Exception:
            continue
            
    if not content.strip() and os.path.exists(local_path):
        try:
            with open(local_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception:
            pass

    if not content.strip():
        return pd.DataFrame(), None

    # Check if JTWC has issued its final warning and ceased advisories
    content_upper = content.upper()
    if (
        "THIS IS THE FINAL WARNING" in content_upper
        or "FINAL WARNING ON THIS SYSTEM" in content_upper
        or "FINAL WARNING BY THE JOINT TYPHOON" in content_upper
        or bool(re.search(r'\bFINAL\s+WARNING\b', content_upper))
    ):
        print(f"Notice: JTWC has issued its final warning and ceased advisories for {short_id}; skipping JTWC display.")
        return pd.DataFrame(), None

    # Parse warning timestamp YYYYMMDDHH (e.g. 2026090906 22W)
    warn_dt = None
    dt_match = re.search(r'\b(20\d{8})\s+' + re.escape(short_id), content)
    if not dt_match:
        dt_match = re.search(r'\b(20\d{8})\s+\d+[A-Z]', content)
    if dt_match:
        try:
            warn_dt = datetime.strptime(dt_match.group(1), "%Y%m%d%H").replace(tzinfo=timezone.utc)
        except Exception:
            pass

    ref_time = None
    if storm.get('init_time'):
        try:
            ref_time = pd.to_datetime(str(storm['init_time']).split('.')[0])
            if ref_time.tzinfo is None:
                ref_time = ref_time.tz_localize(timezone.utc)
        except Exception:
            pass
    if ref_time is None:
        ref_time = datetime.now(timezone.utc)

    if warn_dt:
        age_hours = (ref_time - warn_dt).total_seconds() / 3600.0
        if age_hours > 18.0:
            print(f"Notice: JTWC warning for {short_id} is outdated ({age_hours:.1f}h old); JTWC has ceased forecasting.")
            return pd.DataFrame(), None

    curr_lat, curr_lon = storm['lat'], storm['lon']
    rows = []
    
    # Method 1: Parse .tcw T-line format: "T000 236N 1509E 110 R064 ..."
    for line in content.splitlines():
        line = line.strip()
        t_match = re.match(r'^T(\d{3})\s+(\d+)([NS])\s+(\d+)([EW])\s+(\d+)', line)
        if t_match:
            tau = int(t_match.group(1))
            lat_raw = float(t_match.group(2)) / 10.0
            if t_match.group(3) == 'S':
                lat_raw = -lat_raw
            lon_raw = float(t_match.group(4)) / 10.0
            if t_match.group(5) == 'W':
                lon_raw = -lon_raw
            wind_kt = float(t_match.group(6))
            rows.append({
                'lead_time_hours': tau,
                'lat': lat_raw,
                'lon': lon_raw,
                'wind': wind_kt,
            })
    
    # Method 2: If no T-lines found, try ATCF comma-separated format
    if not rows:
        for line in content.splitlines():
            line = line.strip()
            if not line:
                continue
            parts = [p.strip() for p in line.split(',')]
            if len(parts) >= 8:
                tech = parts[4].upper()
                if tech in ('OFCL', 'JTWC', 'JTWI'):
                    try:
                        tau = int(parts[5])
                        la = parse_atcf_latlon(parts[6])
                        lo = parse_atcf_latlon(parts[7])
                        if not math.isnan(la) and not math.isnan(lo):
                            row_data = {'lead_time_hours': tau, 'lat': la, 'lon': lo}
                            if len(parts) > 8 and parts[8].strip():
                                try: row_data['wind'] = float(parts[8])
                                except ValueError: pass
                            if len(parts) > 9 and parts[9].strip():
                                try: row_data['pressure'] = float(parts[9])
                                except ValueError: pass
                            rows.append(row_data)
                    except (ValueError, IndexError):
                        continue

    # Method 3: Parse the plain-text warning for forecast positions
    if not rows:
        forecast_section = False
        for line in content.splitlines():
            line = line.strip()
            if 'FORECAST' in line.upper() and ('POSITION' in line.upper() or 'POSIT' in line.upper()):
                forecast_section = True
                continue
            if forecast_section:
                # Match patterns like: "030000Z --- NEAR 24.8N 145.6E"  or "TAU 024 --- 24.8N 145.6E"
                pos_match = re.search(r'(\d+)\s*(?:Z|H)?\s*---\s*(?:NEAR\s+)?(\d+\.?\d*)\s*([NS])\s+(\d+\.?\d*)\s*([EW])', line, re.IGNORECASE)
                if pos_match:
                    continue  # These are position-only, harder to extract tau reliably
                wind_match = re.search(r'MAX\s+(?:SUSTAINED\s+)?WINDS?\s*[-:]\s*(\d+)\s*KT', line, re.IGNORECASE)
                if wind_match:
                    continue

    if not rows:
        return pd.DataFrame(), None

    df = pd.DataFrame(rows).drop_duplicates(subset=['lead_time_hours']).sort_values('lead_time_hours')
    if df.empty:
        return pd.DataFrame(), None

    future_pts = df[df['lead_time_hours'] > 0]
    if future_pts.empty or len(df) < 2:
        print(f"Notice: JTWC track for {short_id} has no future forecast positions; skipping JTWC display.")
        return pd.DataFrame(), None

    first_pt = df.iloc[0]
    dist_km = haversine_km(first_pt['lat'], first_pt['lon'], curr_lat, curr_lon)
    
    if dist_km <= 350.0:
        init_str = warn_dt.strftime("%Y-%m-%d %HZ") if warn_dt else "Latest Warning"
        print(f"Matched official JTWC track for {short_id} (dist: {dist_km:.1f}km, run: {init_str})")
        cols_ret = ['lead_time_hours', 'lat', 'lon']
        if 'wind' in df.columns: cols_ret.append('wind')
        if 'pressure' in df.columns: cols_ret.append('pressure')
        ret_df = df[cols_ret].copy()
        return ret_df, init_str
        
    return pd.DataFrame(), None


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


def get_jma_official_track(storm, data_dir='public/data'):
    """
    Fetches official JMA forecast track from Japan Meteorological Agency official portal
    (https://www.data.jma.go.jp/multi/cyclone/index.html?lang=en).
    If available, returns the matching official JMA track DataFrame.
    If not available, returns an empty DataFrame (no fallback track display).
    """
    curr_lat, curr_lon = storm['lat'], storm['lon']
    storm_name = storm.get('name', '').upper()
    short_id = get_short_atcf_id(storm['atcf_id'])
    
    ref_time = None
    if storm.get('init_time'):
        try:
            ref_time = pd.to_datetime(str(storm['init_time']).split('.')[0])
            if ref_time.tzinfo is None:
                ref_time = ref_time.tz_localize(timezone.utc)
        except Exception:
            pass
    if ref_time is None:
        ref_time = datetime.now(timezone.utc)

    for i in range(60, 66):
        url = f"https://www.data.jma.go.jp/multi/data/VPTW60/{i}_en.json"
        local_path = os.path.join(data_dir, f"jma_vptw60_{i}.json")
        res = ""
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
            with urllib.request.urlopen(req, timeout=5) as resp:
                res = resp.read().decode('utf-8', errors='ignore')
                if res.strip():
                    os.makedirs(data_dir, exist_ok=True)
                    with open(local_path, 'w', encoding='utf-8') as f:
                        f.write(res)
        except Exception:
            pass

        if not res.strip() and os.path.exists(local_path):
            try:
                with open(local_path, 'r', encoding='utf-8') as f:
                    res = f.read()
            except Exception:
                pass

        if not res.strip():
            continue

        try:
            data = json.loads(res)
            
            # If the remark indicates cyclone dissipated, ceased, or transitioned, skip
            remark = str(data.get('remark', '')).strip()
            if any(k in remark for k in ['消滅', '低気圧化', '台風消滅', '温帯低気圧']):
                print(f"Notice: JMA product {i} indicates system ceased/dissipated ({remark}); skipping JMA display.")
                continue

            target_dt_str = data.get('targetDateTime', '') or data.get('reportDateTime', '')
            tdt = None
            if target_dt_str:
                try:
                    tdt = datetime.strptime(target_dt_str, "%Y/%m/%d %H:%M").replace(tzinfo=timezone.utc)
                    age_hours = (ref_time - tdt).total_seconds() / 3600.0
                    if age_hours > 18.0:
                        print(f"Notice: JMA product {i} for {short_id} is outdated ({age_hours:.1f}h old); skipping.")
                        continue
                except Exception:
                    pass

            infos = data.get('meteorologicalInfos', [])
            if not infos:
                continue
                
            first_c = infos[0].get('centerPart', {})
            first_lat_str = first_c.get('coordinateLat') or (first_c.get('probabilityCircle', {}) or {}).get('basePointLat')
            first_lon_str = first_c.get('coordinateLon') or (first_c.get('probabilityCircle', {}) or {}).get('basePointLon')
            
            first_lat = parse_jma_latlon(first_lat_str)
            first_lon = parse_jma_latlon(first_lon_str)
            
            if math.isnan(first_lat) or math.isnan(first_lon):
                continue
                
            dist_km = haversine_km(first_lat, first_lon, curr_lat, curr_lon)
            jma_name = str(data.get('name', '')).upper()
            
            # Enforce 350 km distance threshold even if name matches
            if dist_km > 350.0:
                continue

            if dist_km <= 250.0 or (storm_name and storm_name != 'INVEST' and storm_name in jma_name):
                rows = []
                t0 = None
                for pt in infos:
                    dt_str = pt.get('dateTime', '')
                    c_part = pt.get('centerPart', {})
                    lat_str = c_part.get('coordinateLat') or (c_part.get('probabilityCircle', {}) or {}).get('basePointLat')
                    lon_str = c_part.get('coordinateLon') or (c_part.get('probabilityCircle', {}) or {}).get('basePointLon')
                    
                    lat = parse_jma_latlon(lat_str)
                    lon = parse_jma_latlon(lon_str)
                    
                    if not math.isnan(lat) and not math.isnan(lon) and dt_str:
                        dt = datetime.strptime(dt_str, "%Y/%m/%d %H:%M")
                        if t0 is None:
                            t0 = dt
                        tau = (dt - t0).total_seconds() / 3600.0
                        row_data = {'lead_time_hours': tau, 'lat': lat, 'lon': lon}
                        # JMA windPart.windSpeedKnot is 10-min sustained kt (JMA convention)
                        w_part = pt.get('windPart', {}) or {}
                        wind_kt_str = w_part.get('windSpeedKnot')
                        if wind_kt_str is not None:
                            try: row_data['wind'] = float(wind_kt_str)
                            except (ValueError, TypeError): pass
                        # Pressure from centerPart
                        pres_val = c_part.get('pressure')
                        if pres_val is not None:
                            try: row_data['pressure'] = float(pres_val)
                            except (ValueError, TypeError): pass
                        rows.append(row_data)
                
                df = pd.DataFrame(rows)
                if df.empty:
                    continue

                future_pts = df[df['lead_time_hours'] > 0]
                if future_pts.empty or len(df) < 2:
                    print(f"Notice: JMA product {i} for {short_id} has no future forecast positions; skipping.")
                    continue

                print(f"Matched official JMA track for {short_id} (ID {i}, Name={jma_name}, dist={dist_km:.1f}km)")
                cols_ret = ['lead_time_hours', 'lat', 'lon']
                if 'wind' in df.columns: cols_ret.append('wind')
                if 'pressure' in df.columns: cols_ret.append('pressure')
                # Extract init time from targetDateTime or first forecast point
                init_str = "Latest"
                if tdt:
                    init_str = tdt.strftime("%Y-%m-%d %HZ")
                elif target_dt_str:
                    try:
                        p_dt = datetime.strptime(target_dt_str, "%Y/%m/%d %H:%M")
                        init_str = p_dt.strftime("%Y-%m-%d %HZ")
                    except (ValueError, TypeError):
                        pass
                return df[cols_ret], init_str
        except Exception:
            continue
            
    return pd.DataFrame(), None


def get_fallback_cycle_str(storm):
    """
    Computes a clean fallback initialization string (e.g. '2026-08-20 06Z')
    based on the storm's current analysis timestamp or current UTC cycle.
    """
    if storm.get('init_time'):
        try:
            dt = pd.to_datetime(str(storm['init_time']).split('.')[0])
            cycle_hr = (dt.hour // 6) * 6
            return dt.strftime(f"%Y-%m-%d {cycle_hr:02d}Z")
        except Exception:
            pass
    now_utc = datetime.now(timezone.utc)
    cycle_hr = (now_utc.hour // 6) * 6
    return now_utc.strftime(f"%Y-%m-%d {cycle_hr:02d}Z")


def load_all_actual_tracks_for_storm(storm):
    """
    Scans data sources to extract actual forecast tracks for:
    - FNV3p2 (prefers paired track if available, else calculated ensemble mean)
    - ECMWF IFS (prefers control/paired track if available, else calculated ensemble mean)
    - ECMWF AIFS (prefers control/paired track if available, else calculated ensemble mean)
    - GFS (prefers deterministic/control track if available, else calculated ensemble mean)
    And official agency tracks (PAGASA from cyclone.dat, JTWC from NOAA/Navy ATCF, JMA from JMA Portal).
    Also returns latest model run initialization strings.
    NO synthetic or fake tracks are generated. If a track does not exist, it is NOT displayed.
    """
    agency_tracks = {}
    ensemble_means = {}
    track_inits = {}
    
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public', 'data')
    fallback_cycle = get_fallback_cycle_str(storm)
    
    # 1. WeatherNext 3 Cyclone (WNCv3): Check paired file first, fallback to calculated ensemble mean
    wnc_paired = get_fnv3_paired_mean_track(storm, data_dir)
    if not wnc_paired.empty:
        ensemble_means['WeatherNext 3 Cyclone'] = wnc_paired
    else:
        for raw_cand in ['wnv3_paired_latest.dat', 'wnv3_paired_latest.csv', 'wnv3_latest.dat', 'wnv3_latest.csv']:
            cand_path = os.path.join(data_dir, raw_cand)
            if os.path.exists(cand_path):
                wnc_calc = get_actual_ensemble_mean_for_storm(storm, cand_path)
                if not wnc_calc.empty:
                    ensemble_means['WeatherNext 3 Cyclone'] = wnc_calc
                    break

    for wnc_f in [
        os.path.join(data_dir, 'wnv3_paired_latest.dat'),
        os.path.join(data_dir, 'wnv3_paired_latest.csv'),
        os.path.join(data_dir, 'wnv3_latest.dat'),
        os.path.join(data_dir, 'wnv3_latest.csv')
    ]:
        if os.path.exists(wnc_f):
            df_wnc = load_and_decrypt_track_file(wnc_f)
            if 'init_time' in df_wnc.columns and not df_wnc['init_time'].dropna().empty:
                try:
                    dt = pd.to_datetime(df_wnc['init_time'].dropna().iloc[0])
                    track_inits['WeatherNext 3 Cyclone'] = dt.strftime('%Y-%m-%d %HZ')
                    break
                except Exception:
                    pass
    if 'WeatherNext 3 Cyclone' not in track_inits:
        track_inits['WeatherNext 3 Cyclone'] = fallback_cycle

    # 2. ECMWF IFS: Check deterministic control track first, fallback to calculated ensemble mean
    ifs_files = [os.path.join(data_dir, 'ifs_tc_latest.dat'), os.path.join(data_dir, 'ifs_tc_latest.csv')]
    for fpath in ifs_files:
        if os.path.exists(fpath):
            df_check = load_and_decrypt_track_file(fpath)
            if df_check.empty:
                continue
            if 'init_time' in df_check.columns and not df_check['init_time'].dropna().empty:
                try:
                    latest_init = pd.to_datetime(df_check['init_time'].dropna().iloc[0])
                    init_age_hours = (datetime.now(timezone.utc) - latest_init.tz_localize('UTC')).total_seconds() / 3600.0
                    if init_age_hours > 72.0:
                        print(f"Skipping outdated IFS file {os.path.basename(fpath)} (init: {latest_init})")
                        continue
                    track_inits['ECMWF IFS'] = latest_init.strftime('%Y-%m-%d %HZ')
                except Exception:
                    pass

            base_ifs_init = track_inits.get('ECMWF IFS', fallback_cycle)
            ifs_ctrl = get_ecmwf_control_or_paired_track(storm, fpath)
            if not ifs_ctrl.empty:
                ensemble_means['ECMWF IFS'] = ifs_ctrl
                track_inits['ECMWF IFS'] = base_ifs_init
            else:
                ifs_calc = get_actual_ensemble_mean_for_storm(storm, fpath)
                if not ifs_calc.empty:
                    ensemble_means['ECMWF IFS'] = ifs_calc
                    track_inits['ECMWF IFS'] = base_ifs_init
            break
    if 'ECMWF IFS' not in track_inits:
        track_inits['ECMWF IFS'] = fallback_cycle

    # 3. ECMWF AIFS: Check deterministic control track first, fallback to calculated ensemble mean
    aifs_files = [os.path.join(data_dir, 'aifs_tc_latest.dat'), os.path.join(data_dir, 'aifs_tc_latest.csv')]
    for fpath in aifs_files:
        if os.path.exists(fpath):
            df_check = load_and_decrypt_track_file(fpath)
            if df_check.empty:
                continue
            if 'init_time' in df_check.columns and not df_check['init_time'].dropna().empty:
                try:
                    latest_init = pd.to_datetime(df_check['init_time'].dropna().iloc[0])
                    init_age_hours = (datetime.now(timezone.utc) - latest_init.tz_localize('UTC')).total_seconds() / 3600.0
                    if init_age_hours > 72.0:
                        print(f"Skipping outdated AIFS file {os.path.basename(fpath)} (init: {latest_init})")
                        continue
                    track_inits['ECMWF AIFS'] = latest_init.strftime('%Y-%m-%d %HZ')
                except Exception:
                    pass

            base_aifs_init = track_inits.get('ECMWF AIFS', fallback_cycle)
            aifs_ctrl = get_ecmwf_control_or_paired_track(storm, fpath)
            if not aifs_ctrl.empty:
                ensemble_means['ECMWF AIFS'] = aifs_ctrl
                track_inits['ECMWF AIFS'] = base_aifs_init
            else:
                aifs_calc = get_actual_ensemble_mean_for_storm(storm, fpath)
                if not aifs_calc.empty:
                    ensemble_means['ECMWF AIFS'] = aifs_calc
                    track_inits['ECMWF AIFS'] = base_aifs_init
            break
    if 'ECMWF AIFS' not in track_inits:
        track_inits['ECMWF AIFS'] = fallback_cycle

    # 4-8. Concurrent Fetching for Official Agencies, GFS & AIGEFS
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        f_gfs = executor.submit(get_gfs_control_or_mean_track, storm, data_dir)
        f_aigefs = executor.submit(get_aigefs_control_or_mean_track, storm, data_dir)
        f_pagasa = executor.submit(get_pagasa_official_track, storm, data_dir)
        f_jtwc = executor.submit(get_jtwc_official_track, storm, data_dir)
        f_jma = executor.submit(get_jma_official_track, storm, data_dir)
        
        gfs_track, gfs_init_str, gfs_track_type = f_gfs.result()
        aigefs_track, aigefs_init_str, aigefs_track_type = f_aigefs.result()
        pagasa_official, pagasa_init_str = f_pagasa.result()
        jtwc_official, jtwc_init_str = f_jtwc.result()
        jma_official, jma_init_str = f_jma.result()

    # 4. GFS: Check deterministic control track first, fallback to calculated ensemble mean
    if not gfs_track.empty:
        ensemble_means['GFS'] = gfs_track
        track_inits['GFS'] = gfs_init_str or fallback_cycle
    else:
        for f_cand in ['gefs_tc_latest.dat', 'gfs_tc_latest.dat']:
            cand_p = os.path.join(data_dir, f_cand)
            if os.path.exists(cand_p):
                gfs_calc = get_actual_ensemble_mean_for_storm(storm, cand_p)
                if not gfs_calc.empty:
                    ensemble_means['GFS'] = gfs_calc
                    track_inits['GFS'] = fallback_cycle
                    break
            
    if 'GFS' not in track_inits:
        track_inits['GFS'] = fallback_cycle

    # 5. AIGEFS: Check deterministic control track first, fallback to ensemble mean
    if not aigefs_track.empty:
        ensemble_means['AIGEFS'] = aigefs_track
        track_inits['AIGEFS'] = aigefs_init_str or fallback_cycle
    else:
        aigefs_cand = os.path.join(data_dir, 'aigefs_tc_latest.dat')
        if os.path.exists(aigefs_cand):
            aigefs_calc = get_actual_ensemble_mean_for_storm(storm, aigefs_cand)
            if not aigefs_calc.empty:
                ensemble_means['AIGEFS'] = aigefs_calc
                track_inits['AIGEFS'] = fallback_cycle
            
    if 'AIGEFS' not in track_inits:
        track_inits['AIGEFS'] = fallback_cycle

    # 5. Official PAGASA track from cyclone.dat (pubfiles.pagasa.dost.gov.ph)
    if isinstance(pagasa_official, pd.DataFrame) and not pagasa_official.empty and len(pagasa_official) >= 2:
        agency_tracks['PAGASA'] = pagasa_official
        track_inits['PAGASA'] = pagasa_init_str or "Latest"
    else:
        print(f"No active official PAGASA track available for {storm['atcf_id']}; skipping PAGASA display.")

    # 6. Official JTWC track from NOAA ATCF / Navy JTWC
    if isinstance(jtwc_official, pd.DataFrame) and not jtwc_official.empty and len(jtwc_official) >= 2:
        agency_tracks['JTWC'] = jtwc_official
        track_inits['JTWC'] = jtwc_init_str or "Latest Warning"
    else:
        print(f"No active official JTWC track available for {storm['atcf_id']}; skipping JTWC display.")

    # 7. Official JMA track from Japan Meteorological Agency portal (data.jma.go.jp)
    if isinstance(jma_official, pd.DataFrame) and not jma_official.empty and len(jma_official) >= 2:
        agency_tracks['JMA'] = jma_official
        track_inits['JMA'] = jma_init_str or "Latest"
    else:
        print(f"No active official JMA track available for {storm['atcf_id']}; skipping JMA display.")
            
    return agency_tracks, ensemble_means, track_inits


def get_adaptive_viewport(lats, lons, target_aspect=1.75):
    """
    Calculates an adaptive bounding box around all storm and track points,
    enforcing padding, minimum geographic span, aspect ratio matching,
    and clamping within the full Western North Pacific basin (95°E - 180°E, 0°N - 50°N).
    """
    valid_lats = [float(la) for la in lats if not pd.isna(la) and not math.isnan(la)]
    valid_lons = [float(lo) for lo in lons if not pd.isna(lo) and not math.isnan(lo)]
    
    if not valid_lats or not valid_lons:
        return [110.0, 145.0, 5.0, 25.0]
        
    raw_min_lat, raw_max_lat = min(valid_lats), max(valid_lats)
    raw_min_lon, raw_max_lon = min(valid_lons), max(valid_lons)
    
    # Adaptive padding
    pad_lat = max(2.5, (raw_max_lat - raw_min_lat) * 0.20)
    pad_lon = max(3.5, (raw_max_lon - raw_min_lon) * 0.20)
    
    min_lat = raw_min_lat - pad_lat
    max_lat = raw_max_lat + pad_lat
    min_lon = raw_min_lon - pad_lon
    max_lon = raw_max_lon + pad_lon
    
    # Ensure minimum span so localized storms have good geographic context
    min_span_lat = 10.0
    min_span_lon = 17.5
    
    if (max_lat - min_lat) < min_span_lat:
        center_lat = (max_lat + min_lat) / 2.0
        min_lat = center_lat - min_span_lat / 2.0
        max_lat = center_lat + min_span_lat / 2.0
        
    if (max_lon - min_lon) < min_span_lon:
        center_lon = (max_lon + min_lon) / 2.0
        min_lon = center_lon - min_span_lon / 2.0
        max_lon = center_lon + min_span_lon / 2.0
        
    # Enforce aspect ratio (width / height)
    curr_w = max_lon - min_lon
    curr_h = max_lat - min_lat
    curr_aspect = curr_w / max(0.1, curr_h)
    
    if curr_aspect < target_aspect:
        needed_w = curr_h * target_aspect
        diff_w = needed_w - curr_w
        min_lon -= diff_w / 2.0
        max_lon += diff_w / 2.0
    elif curr_aspect > target_aspect:
        needed_h = curr_w / target_aspect
        diff_h = needed_h - curr_h
        min_lat -= diff_h / 2.0
        max_lat += diff_h / 2.0
        
    # Full Western North Pacific basin limits (95°E - 180°E, 0°N - 50°N)
    DOMAIN_MIN_LON = 95.0
    DOMAIN_MAX_LON = 180.0
    DOMAIN_MIN_LAT = 0.0
    DOMAIN_MAX_LAT = 50.0

    w = max_lon - min_lon
    h = max_lat - min_lat

    # Shift bounding box if hitting domain boundaries while strictly maintaining aspect ratio
    if max_lon > DOMAIN_MAX_LON:
        max_lon = DOMAIN_MAX_LON
        min_lon = max(DOMAIN_MIN_LON, max_lon - w)
    if min_lon < DOMAIN_MIN_LON:
        min_lon = DOMAIN_MIN_LON
        max_lon = min(DOMAIN_MAX_LON, min_lon + w)

    if max_lat > DOMAIN_MAX_LAT:
        max_lat = DOMAIN_MAX_LAT
        min_lat = max(DOMAIN_MIN_LAT, max_lat - h)
    if min_lat < DOMAIN_MIN_LAT:
        min_lat = DOMAIN_MIN_LAT
        max_lat = min(DOMAIN_MAX_LAT, min_lat + h)
    
    return [min_lon, max_lon, min_lat, max_lat]


def draw_current_storm_glyph(ax, lon, lat, color='#ffffff', size=130):
    """Draws a broadcast-grade glowing hurricane eye center glyph at initial fix."""
    # Outer glow ring
    ax.scatter(lon, lat, s=size*1.9, facecolor='none', edgecolor=color, linewidth=2.2, alpha=0.45, transform=ccrs.PlateCarree(), zorder=18)
    # Mid ring
    ax.scatter(lon, lat, s=size, facecolor=BG_DARK, edgecolor=color, linewidth=2.0, alpha=0.95, transform=ccrs.PlateCarree(), zorder=19)
    # Center core dot
    ax.scatter(lon, lat, s=size*0.22, facecolor=color, edgecolor='none', transform=ccrs.PlateCarree(), zorder=20)


def resample_track_to_regular_intervals(df, interval_hours=6.0):
    """
    Resamples a track DataFrame to regular lead times (0, 6, 12, 18, ...)
    using linear interpolation on lat, lon, wind, and pressure.
    """
    if df.empty or 'lead_time_hours' not in df.columns or 'lat' not in df.columns or 'lon' not in df.columns:
        return pd.DataFrame()
        
    df_clean = df.dropna(subset=['lead_time_hours', 'lat', 'lon']).sort_values('lead_time_hours').drop_duplicates(subset=['lead_time_hours'])
    if len(df_clean) < 1:
        return pd.DataFrame()
    if len(df_clean) == 1:
        return df_clean.copy()
        
    taus = df_clean['lead_time_hours'].values.astype(float)
    min_tau = 0.0 if taus[0] >= 0 else float(taus[0])
    max_tau = float(taus[-1])
    
    grid_taus = np.arange(min_tau, max_tau + 0.01, interval_hours)
    
    interp_lats = np.interp(grid_taus, taus, df_clean['lat'].values.astype(float))
    interp_lons = np.interp(grid_taus, taus, df_clean['lon'].values.astype(float))
    
    out_df = pd.DataFrame({
        'lead_time_hours': grid_taus,
        'lat': interp_lats,
        'lon': interp_lons
    })
    
    if 'wind' in df_clean.columns:
        w_valid = df_clean.dropna(subset=['wind'])
        if len(w_valid) > 1:
            out_df['wind'] = np.interp(grid_taus, w_valid['lead_time_hours'].values.astype(float), w_valid['wind'].values.astype(float))
        elif len(w_valid) == 1:
            out_df['wind'] = float(w_valid['wind'].iloc[0])
            
    if 'pressure' in df_clean.columns:
        p_valid = df_clean.dropna(subset=['pressure'])
        if len(p_valid) > 1:
            out_df['pressure'] = np.interp(grid_taus, p_valid['lead_time_hours'].values.astype(float), p_valid['pressure'].values.astype(float))
        elif len(p_valid) == 1:
            out_df['pressure'] = float(p_valid['pressure'].iloc[0])
            
    return out_df


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


def build_cone_polygon(lats, lons, lead_times):
    if len(lats) == 0:
        return None
    radii_nm_interp = np.interp(lead_times, LEAD_STANDARD, RADII_NM)
    radii_km = radii_nm_interp * 1.852
    if len(lats) <= 1:
        circ_pts = []
        radius = max(radii_km[0], 0.1)
        for ang in range(0, 360, 10):
            clat, clon = offset_point(lats[0], lons[0], radius, ang)
            circ_pts.append((clon, clat))
        return Polygon(circ_pts)

    circles = []
    for i in range(len(lats)):
        circ_pts = []
        radius = max(radii_km[i], 0.1)
        for ang in range(0, 360, 10):
            clat, clon = offset_point(lats[i], lons[i], radius, ang)
            circ_pts.append((clon, clat))
        circles.append(Polygon(circ_pts))
        
    segments = []
    for i in range(len(circles) - 1):
        segment = circles[i].union(circles[i+1]).convex_hull
        segments.append(segment)
        
    cone_geom = unary_union(segments)
    return cone_geom


def get_intensity_color(wind_kmh, pressure=None):
    if pd.isna(wind_kmh) or wind_kmh is None:
        return INTENSITY_PALETTE['LPA']
    w = float(wind_kmh)
    if w < 45:
        return INTENSITY_PALETTE['LPA']
    elif w <= 61:
        return INTENSITY_PALETTE['TD']
    elif w <= 88:
        return INTENSITY_PALETTE['TS']
    elif w <= 117:
        return INTENSITY_PALETTE['STS']
    elif w <= 184:
        return INTENSITY_PALETTE['TY']
    else:
        return INTENSITY_PALETTE['STY']


def compute_compiled_mean_track(agency_tracks, ensemble_means, storm=None):
    """
    Harmonizes wind metrics (1-min kt -> 10-min kt), resamples all valid tracks
    to standard 6-hour intervals, enforces 5-day horizon (120h) and member quorum constraints
    to prevent end-of-track outlier jumps, and smoothly anchors the consensus at T+0 to the active storm fix.
    """
    resampled_tracks = []
    
    # 1. Process agency tracks
    for name, df in agency_tracks.items():
        if isinstance(df, pd.DataFrame) and not df.empty and len(df) >= 1:
            df_copy = df.copy()
            # JTWC issues 1-min sustained kt; convert to 10-min kt equivalent (~0.88x)
            if name == 'JTWC' and 'wind' in df_copy.columns:
                df_copy['wind'] = df_copy['wind'] * 0.88
            resampled = resample_track_to_regular_intervals(df_copy, 6.0)
            if not resampled.empty:
                resampled_tracks.append(resampled)
                
    # 2. Process ensemble means
    for name, df in ensemble_means.items():
        if isinstance(df, pd.DataFrame) and not df.empty and len(df) >= 1:
            resampled = resample_track_to_regular_intervals(df, 6.0)
            if not resampled.empty:
                resampled_tracks.append(resampled)
                
    if not resampled_tracks:
        return pd.DataFrame()
        
    combined = pd.concat(resampled_tracks, ignore_index=True)
    combined = combined.dropna(subset=['lat', 'lon', 'lead_time_hours'])
    if combined.empty:
        return pd.DataFrame()
        
    # Calculate baseline member count at early lead times (0 - 24h)
    early_counts = [len(combined[combined['lead_time_hours'] == t].dropna(subset=['lat', 'lon'])) for t in [0.0, 6.0, 12.0, 24.0]]
    valid_early = [c for c in early_counts if c > 0]
    initial_members = max(valid_early) if valid_early else len(resampled_tracks)
    
    # Enforce minimum quorum (at least 40% of initial members, min 2 if >= 3 initial)
    if initial_members >= 3:
        min_quorum = max(2, int(np.ceil(initial_members * 0.40)))
    else:
        min_quorum = max(1, initial_members)
        
    # Enforce 5-day / 120-hour maximum forecast horizon constraint
    sorted_taus = [t for t in sorted(combined['lead_time_hours'].unique()) if 0.0 <= t <= 120.0]
    mean_rows = []
    
    for tau in sorted_taus:
        group = combined[combined['lead_time_hours'] == tau]
        valid_pts = group.dropna(subset=['lat', 'lon'])
        
        # Stop extending consensus once surviving model support drops below quorum
        if len(valid_pts) < min_quorum:
            break
            
        row = {
            'lead_time_hours': float(tau),
            'lat': float(valid_pts['lat'].mean()),
            'lon': float(valid_pts['lon'].mean())
        }
        if 'wind' in valid_pts.columns:
            v_winds = pd.to_numeric(valid_pts['wind'], errors='coerce').dropna()
            if not v_winds.empty:
                row['wind'] = float(v_winds.mean()) * 1.852  # convert knots to km/h
        if 'pressure' in valid_pts.columns:
            v_press = pd.to_numeric(valid_pts['pressure'], errors='coerce').dropna()
            if not v_press.empty:
                row['pressure'] = float(v_press.mean())
        mean_rows.append(row)
        
    if not mean_rows:
        return pd.DataFrame()
        
    mean_df = pd.DataFrame(mean_rows).sort_values('lead_time_hours').reset_index(drop=True)
    
    if 'wind' in mean_df.columns:
        mean_df['wind'] = mean_df['wind'].interpolate(method='linear', limit_direction='both')
    if 'pressure' in mean_df.columns:
        mean_df['pressure'] = mean_df['pressure'].ffill().bfill()
        
    # Smooth T+0 anchoring to verified storm center fix
    if storm is not None and not mean_df.empty:
        try:
            storm_lat = float(storm['lat'])
            storm_lon = float(storm['lon'])
            t0_lat = float(mean_df.iloc[0]['lat'])
            t0_lon = float(mean_df.iloc[0]['lon'])
            
            init_offset_dist = haversine_km(t0_lat, t0_lon, storm_lat, storm_lon)
            if init_offset_dist <= 350.0:
                d_lat = storm_lat - t0_lat
                d_lon = storm_lon - t0_lon
                # Smooth decay factor: 1.0 at T+0, decaying to 0.0 by T+72h
                taus = mean_df['lead_time_hours'].values.astype(float)
                decay = np.clip(1.0 - (taus / 72.0), 0.0, 1.0)
                mean_df['lat'] = mean_df['lat'] + d_lat * decay
                mean_df['lon'] = mean_df['lon'] + d_lon * decay
        except Exception as e:
            print(f"Warning: Failed to anchor consensus track to storm center: {e}")
            
    return mean_df


def render_sea_labels(ax, extent):
    """
    Renders official 'West Philippine Sea' and 'Philippine Sea' labels strictly within
    their designated official bounding coordinates:
      - West Philippine Sea: 116°40'E to 126°34'E (116.67°E - 126.57°E) and 4°40'N to 21°10'N (4.67°N - 21.17°N)
    Places the labels at their exact official geographic coordinates:
      - West Philippine Sea: (117.5°E, 13.8°N)
      - Philippine Sea: (130.5°E, 14.0°N)
    Labels are only rendered when their exact geographic location falls within the active map viewport
    with safety margin padding. When the actual location is outside the map area (such as for recurving
    storms tracked near Japan/Korea), the labels will not display.
    """
    min_lon, max_lon, min_lat, max_lat = extent
    span_lon = max_lon - min_lon
    
    # ── 1. West Philippine Sea (116°40'E - 126°34'E, 4°40'N - 21°10'N) ──────────
    # Actual open water channel location west of Luzon/Mindoro:
    wps_lon = 117.5
    wps_lat = 13.8
    wps_in_official_bounds = (116.667 <= wps_lon <= 126.567) and (4.667 <= wps_lat <= 21.167)
    
    # Only render West Philippine Sea when its actual location is inside the visible map area
    if wps_in_official_bounds and (min_lon + 1.0) <= wps_lon <= (max_lon - 1.0) and (min_lat + 1.0) <= wps_lat <= (max_lat - 1.0):
        if span_lon > 32.0:
            wps_txt = 'West\nPhilippine\nSea'
            fs_wps = 5.2
        else:
            wps_txt = 'West Philippine\nSea'
            fs_wps = max(6.5, min(9.0, 10.0 - (span_lon * 0.09)))
            
        ax.text(
            wps_lon, wps_lat, wps_txt,
            fontsize=fs_wps, color='#93c5fd', weight='bold',
            transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.40,
            zorder=4.2, clip_on=True,
            path_effects=[path_effects.withStroke(linewidth=2.4, foreground='#070e1a')]
        )
        
    # ── 2. Philippine Sea (120°06'E - 146°03'E, 2°30'N - 35°15'N) ───────────────
    # Actual open water location east of the archipelago:
    ps_lon = 130.5
    ps_lat = 14.0
    ps_in_official_bounds = (120.10 <= ps_lon <= 146.05) and (2.50 <= ps_lat <= 35.25)
    
    # Only render Philippine Sea when its actual location is inside the visible map area
    if ps_in_official_bounds and (min_lon + 1.5) <= ps_lon <= (max_lon - 1.5) and (min_lat + 1.2) <= ps_lat <= (max_lat - 1.2):
        fs_ps = max(6.5, min(10.0, 11.2 - (span_lon * 0.095)))
        ax.text(
            ps_lon, ps_lat, "Philippine Sea",
            fontsize=fs_ps, color='#93c5fd', weight='bold',
            transform=ccrs.PlateCarree(), ha='center', va='center', style='italic', alpha=0.40,
            zorder=4.2, clip_on=True,
            path_effects=[path_effects.withStroke(linewidth=2.8, foreground='#070e1a')]
        )


PAGASA_NAMES_2026 = [
    "ADA", "BASYANG", "CALOY", "DOMENG", "ESTER",
    "FRANCISCO", "GARDO", "HENRY", "INDAY", "JOSIE",
    "KIYAPO", "LUIS", "MAYMAY", "NENENG", "OBET",
    "PILANDOK", "QUEENIE", "ROSAL", "SAMUEL", "TOMAS",
    "UMBERTO", "VENUS", "WALDO", "YAYANG", "ZENY"
]

# Official mapping of 2026 Western Pacific systems to PAGASA local names
PAGASA_STORM_MAP_2026 = {
    '25W': 'QUEENIE',
    'WP25': 'QUEENIE',
    'WP252026': 'QUEENIE',
    'SURIGAE': 'QUEENIE',
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


def format_storm_title(storm):
    """
    Standardizes storm titles across all charts:
    - Inside PAR with international name: 'Queenie (Surigae)'
    - Inside PAR without international name: 'Queenie (25W)'
    - Outside PAR with international name: 'Surigae (25W)'
    - Outside PAR without international name: '25W'
    """
    raw_id = storm.get('atcf_id', '')
    short_id = get_short_atcf_id(raw_id)
    raw_name = str(storm.get('name', '')).strip()
    curr_lat = float(storm.get('lat', 0))
    curr_lon = float(storm.get('lon', 0))
    inside_par = is_point_inside_par(curr_lat, curr_lon)
    
    # Valid named storms (e.g. SURIGAE, QUEENIE, DUJUAN, YAGI, etc.)
    ignored_names = [
        "INVEST", "NONAME", "UNKNOWN", "STORM", "NULL", "NONE", "LPA", "LOW PRESSURE AREA", "",
        "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
        "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN",
        "EIGHTEEN", "NINETEEN", "TWENTY", "TWENTY-ONE", "TWENTY-TWO", "TWENTY-THREE",
        "TWENTY-FOUR", "TWENTY-FIVE", "TWENTYFIVE", "TWENTY-SIX", "TWENTYSIX",
        "TWENTY-SEVEN", "TWENTYSEVEN", "TWENTY-EIGHT", "TWENTYEIGHT", "TWENTY-NINE",
        "TWENTYNINE", "THIRTY", "THIRTY-ONE", "THIRTYONE"
    ]
    
    intl_name = None
    if raw_name and raw_name.upper() not in ignored_names:
        intl_name = raw_name.title()
        
    p_name = storm.get('pagasa_name')
    if not p_name:
        p_name = (
            PAGASA_STORM_MAP_2026.get(short_id.upper()) or
            PAGASA_STORM_MAP_2026.get(str(storm.get('atcf_id', '')).upper()) or
            PAGASA_STORM_MAP_2026.get(str(storm.get('name', '')).upper())
        )
                
    if inside_par and p_name and str(p_name).strip().upper() not in ignored_names:
        p_name_fmt = str(p_name).strip().title()
        if intl_name:
            return f"{p_name_fmt} ({intl_name})"
        else:
            return f"{p_name_fmt} ({short_id})"
            
    if intl_name:
        return f"{intl_name} ({short_id})"
        
    return f"{short_id}"


def prepare_anchored_track(df, curr_lat, curr_lon, max_lead_time=120.0):
    """
    Filters track to standard 5-day horizon (<= 120h) and smoothly anchors
    the initial point to the active storm center fix (curr_lat, curr_lon).
    """
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return pd.DataFrame()
        
    sub_df = df[df['lead_time_hours'] <= max_lead_time].copy().sort_values('lead_time_hours').reset_index(drop=True)
    if sub_df.empty:
        return pd.DataFrame()
        
    t0_lat = float(sub_df.iloc[0]['lat'])
    t0_lon = float(sub_df.iloc[0]['lon'])
    first_dist = haversine_km(curr_lat, curr_lon, t0_lat, t0_lon)
    
    if first_dist <= 350.0:
        d_lat = curr_lat - t0_lat
        d_lon = curr_lon - t0_lon
        taus = sub_df['lead_time_hours'].values.astype(float)
        # Decay factor: 1.0 at T+0, decaying smoothly to 0.0 by T+48h
        decay = np.clip(1.0 - (taus / 48.0), 0.0, 1.0)
        sub_df['lat'] = sub_df['lat'] + d_lat * decay
        sub_df['lon'] = sub_df['lon'] + d_lon * decay
        
        # If first lead time is > 0h (e.g. 6h), insert T+0 point at curr_lat, curr_lon
        if sub_df.iloc[0]['lead_time_hours'] > 0:
            row0 = sub_df.iloc[0].copy()
            row0['lead_time_hours'] = 0.0
            row0['lat'] = curr_lat
            row0['lon'] = curr_lon
            sub_df = pd.concat([pd.DataFrame([row0]), sub_df], ignore_index=True)
            
    return sub_df


def plot_forecast_track_map(storm, agency_tracks, ensemble_means, output_filepath, init_time_str="Latest", track_inits=None, show_satellite=True):
    """
    Renders a broadcast-grade multi-agency & ensemble comparison forecast track map
    styled in Option A (Deep Slate Dark Theme).
    """
    if track_inits is None:
        track_inits = {}

    short_id = get_short_atcf_id(storm['atcf_id'])
    full_storm_title = format_storm_title(storm)
    curr_lat, curr_lon = float(storm['lat']), float(storm['lon'])
    
    fig = plt.figure(figsize=(12, 7.6), facecolor=BG_DARK)
    
    # ── 1. Top Header Glassmorphism Card ─────────────────────────────
    ax_head = fig.add_axes([0.05, 0.865, 0.90, 0.115])
    ax_head.set_facecolor(HEADER_BG)
    ax_head.set_xlim(0, 1)
    ax_head.set_ylim(0, 1)
    ax_head.axis('off')
    
    head_box = FancyBboxPatch(
        (0, 0), 1, 1, boxstyle="round,pad=0.015,rounding_size=0.04",
        facecolor=HEADER_BG, edgecolor=HEADER_BORDER, linewidth=1.2, transform=ax_head.transAxes
    )
    ax_head.add_patch(head_box)
    
    # User Brand Logo (from ai_precip_outlook style)
    found_logo = next((p for p in LOGO_PATHS if os.path.exists(p)), None)
    title_x = 0.025
    if found_logo:
        try:
            logo_img = mpimg.imread(found_logo)
            logo_ax = fig.add_axes([0.058, 0.872, 0.045, 0.098], zorder=45)
            logo_ax.imshow(logo_img)
            logo_ax.axis('off')
            title_x = 0.082
        except Exception:
            title_x = 0.025

    # Title & Left Column
    ax_head.text(
        title_x, 0.68, f"{full_storm_title} — Forecast Track Comparison",
        fontsize=13.5, fontweight='bold', color=TEXT_PRI, transform=ax_head.transAxes, va='center'
    )
    ph_time_str = format_to_ph_time_str(init_time_str)
    ax_head.text(
        title_x, 0.28, f"Latest Center Fix: {curr_lat:.1f}°N, {curr_lon:.1f}°E  |  PH Time: {ph_time_str}",
        fontsize=9.5, color=TEXT_SEC, transform=ax_head.transAxes, va='center'
    )
    
    # Right Column Branding
    ax_head.text(
        0.975, 0.68, "Philippine Typhoon/Weather",
        fontsize=11.5, fontweight='bold', color=TEXT_PRI, transform=ax_head.transAxes, ha='right', va='center'
    )
    ax_head.text(
        0.975, 0.28, "Official Agencies & NWP / AI Models",
        fontsize=9.0, color='#38bdf8', transform=ax_head.transAxes, ha='right', va='center'
    )
    
    # ── 2. Cartopy Map Canvas ─────────────────────────────────────────
    ax = fig.add_axes([0.05, 0.235, 0.90, 0.615], projection=ccrs.PlateCarree())
    ax.set_facecolor(OCEAN_COLOR)
    
    # Base Map Features (Deep Navy TV ocean, Slate-Dark terrain, crisp dark coastline)
    ax.add_feature(cfeature.OCEAN, facecolor=OCEAN_COLOR, zorder=0)
    ax.add_feature(cfeature.LAND, facecolor=LAND_COLOR, zorder=1)
    
    # Philippine Province Overlay
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        geojson_paths = [
            os.path.join(script_dir, "public", "data", "ph_provinces.json"),
            "public/data/ph_provinces.json"
        ]
        found_geojson = next((p for p in geojson_paths if os.path.exists(p)), None)
        if found_geojson:
            with open(found_geojson, 'r', encoding='utf-8') as gf:
                geojson_data = json.load(gf)
            prov_geoms = [shape(feature['geometry']) for feature in geojson_data['features']]
            ax.add_geometries(prov_geoms, crs=ccrs.PlateCarree(), facecolor='none', edgecolor=PROVINCE_EDGE, linewidth=0.70, alpha=0.85, zorder=4.0)
    except Exception:
        pass

    # Coastlines & International Borders (Rendered above satellite imagery at zorder=4.1)
    ax.add_feature(cfeature.COASTLINE, linewidth=1.2, edgecolor=LAND_EDGE, zorder=4.1)
    ax.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.85, edgecolor=BORDER_EDGE, zorder=4.1)
        
    # PAR Boundary Polygon (Matching forcast5.py solid PAR with dark warm halo)
    par_vertices = [
        (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
        (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
    ]
    ax.add_patch(mpatches.Polygon(
        par_vertices, facecolor='none', edgecolor=PAR_COLOR,
        linestyle='-', linewidth=2.5, alpha=0.95,
        transform=ccrs.PlateCarree(), zorder=5, label='PAR',
        path_effects=[path_effects.Stroke(linewidth=4.0, foreground='#451a03', alpha=0.5), path_effects.Normal()]
    ))
    
    # Subtle Gridlines Configuration (Matching forcast5.py)
    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color=GRID_COLOR, alpha=0.25, linestyle=':', zorder=4)
    gl.xlocator = plt.FixedLocator(np.arange(90, 181, 5))
    gl.ylocator = plt.FixedLocator(np.arange(-10, 51, 5))
    gl.xlabel_style = {'size': 9.0, 'weight': 'bold', 'color': GRID_TEXT}
    gl.ylabel_style = {'size': 9.0, 'weight': 'bold', 'color': GRID_TEXT}
    gl.top_labels = False
    gl.right_labels = False
    
    # 1. Prepare anchored 5-day tracks for all agencies and models
    processed_agencies = {}
    for name, df in agency_tracks.items():
        anchored = prepare_anchored_track(df, curr_lat, curr_lon, max_lead_time=120.0)
        if not anchored.empty:
            processed_agencies[name] = anchored

    processed_ensembles = {}
    for name, df in ensemble_means.items():
        anchored = prepare_anchored_track(df, curr_lat, curr_lon, max_lead_time=120.0)
        if not anchored.empty:
            processed_ensembles[name] = anchored

    # Determine adaptive bounding box extent (bounded by 5-day forecast horizon)
    all_lats = [curr_lat]
    all_lons = [curr_lon]
    for df in list(processed_agencies.values()) + list(processed_ensembles.values()):
        if isinstance(df, pd.DataFrame) and not df.empty:
            all_lats.extend(df['lat'].dropna().tolist())
            all_lons.extend(df['lon'].dropna().tolist())
            
    extent = get_adaptive_viewport(all_lats, all_lons, target_aspect=1.75)
    ax.set_extent(extent, crs=ccrs.PlateCarree())
    
    # Overlay Isolated Himawari Satellite Clouds (Transparent Ocean & Land)
    if show_satellite:
        storm_target_time = storm.get('init_time') or init_time_str
        overlay_isolated_satellite_clouds(ax, extent, target_time=storm_target_time)

    # Sea Text Labels (strictly bounded and zoom-scaled)
    render_sea_labels(ax, extent)
    
    # Plot Official Agency Tracks
    for name, color in AGENCY_COLORS.items():
        df = processed_agencies.get(name)
        if df is None or df.empty:
            continue
        lats = df['lat'].dropna().values
        lons = df['lon'].dropna().values
        if len(lats) == 0 or len(lons) == 0:
            continue
            
        # Smooth line with dark halo
        ax.plot(
            lons, lats, color=color, linestyle='-', linewidth=2.4, label=name,
            transform=ccrs.PlateCarree(), zorder=10,
            path_effects=[path_effects.Stroke(linewidth=4.2, foreground=BG_DARK), path_effects.Normal()]
        )
                
    # Plot Ensemble Mean Tracks
    for name, color in ENSEMBLE_COLORS.items():
        df = processed_ensembles.get(name)
        if df is None or df.empty:
            continue
        lats = df['lat'].dropna().values
        lons = df['lon'].dropna().values
        if len(lats) == 0 or len(lons) == 0:
            continue
            
        ax.plot(
            lons, lats, color=color, linestyle='-', linewidth=2.0, label=name,
            transform=ccrs.PlateCarree(), zorder=8,
            path_effects=[path_effects.Stroke(linewidth=3.6, foreground=BG_DARK), path_effects.Normal()]
        )
                
    # Draw initial storm center fix icon
    draw_current_storm_glyph(ax, curr_lon, curr_lat, color='#ffffff', size=130)
    
    # ── 3. Bottom Legend & Model Run Panel ────────────────────────────
    panel_ax = fig.add_axes([0.05, 0.015, 0.90, 0.175])
    panel_ax.set_facecolor(CARD_BG)
    panel_ax.set_xlim(0, 1)
    panel_ax.set_ylim(0, 1)
    panel_ax.axis('off')
    
    panel_box = FancyBboxPatch(
        (0, 0), 1, 1, boxstyle="round,pad=0.015,rounding_size=0.04",
        facecolor=CARD_BG, edgecolor=CARD_BORDER, linewidth=1.2, transform=panel_ax.transAxes
    )
    panel_ax.add_patch(panel_box)
    
    # ── Section 1: OFFICIAL AGENCIES ──────────────────────────────────
    panel_ax.text(0.020, 0.88, "OFFICIAL AGENCIES", color='#00d2ff', fontsize=9.2, weight='bold', transform=panel_ax.transAxes)
    for idx, (ag_name, ag_color) in enumerate(AGENCY_COLORS.items()):
        is_active = ag_name in agency_tracks and not agency_tracks[ag_name].empty
        line_color = ag_color if is_active else '#334155'
        text_color = TEXT_PRI if is_active else TEXT_MUT
        
        if idx < 2:
            x_start, x_text = 0.020, 0.054
            y_val = 0.68 - (idx * 0.28)
        else:
            x_start, x_text = 0.142, 0.176
            y_val = 0.68 - ((idx - 2) * 0.28)
            
        panel_ax.plot([x_start, x_start + 0.026], [y_val, y_val], color=line_color, linestyle='-', linewidth=2.8, transform=panel_ax.transAxes)
        panel_ax.text(x_text, y_val + 0.03, ag_name, color=text_color, fontsize=8.5, weight='bold', transform=panel_ax.transAxes)
        run_str = track_inits.get(ag_name, 'Latest') if is_active else 'Not Available'
        panel_ax.text(x_text, y_val - 0.11, f"Run: {run_str}", color=TEXT_SEC if is_active else TEXT_MUT, fontsize=6.8, transform=panel_ax.transAxes)
        
    # Vertical Divider Line 1 (placed with generous clearance after JMA text)
    panel_ax.axvline(0.278, ymin=0.10, ymax=0.90, color=CARD_BORDER, linewidth=1.0)
    
    # ── Section 2: NWP MODELS ─────────────────────────────────────────
    panel_ax.text(0.298, 0.88, "NWP MODELS", color='#60a5fa', fontsize=9.2, weight='bold', transform=panel_ax.transAxes)
    nwp_items = [
        ('ECMWF IFS', NWP_COLORS['ECMWF IFS']),
        ('GFS', NWP_COLORS['GFS'])
    ]
    for idx, (m_name, m_color) in enumerate(nwp_items):
        is_active = m_name in ensemble_means and not ensemble_means[m_name].empty
        line_color = m_color if is_active else '#334155'
        text_color = TEXT_PRI if is_active else TEXT_MUT
        
        x_start, x_text = 0.298, 0.332
        y_val = 0.68 - (idx * 0.28)
        
        panel_ax.plot([x_start, x_start + 0.026], [y_val, y_val], color=line_color, linestyle='-', linewidth=2.4, transform=panel_ax.transAxes)
        panel_ax.text(x_text, y_val + 0.03, m_name, color=text_color, fontsize=8.2, weight='bold', transform=panel_ax.transAxes)
        run_str = track_inits.get(m_name, 'Latest' if is_active else 'Not Available')
        panel_ax.text(x_text, y_val - 0.11, f"Run: {run_str}", color=TEXT_SEC if is_active else TEXT_MUT, fontsize=6.7, transform=panel_ax.transAxes)
        
    # Vertical Divider Line 2 (placed with generous clearance after ECMWF IFS / GFS Control text)
    panel_ax.axvline(0.485, ymin=0.10, ymax=0.90, color=CARD_BORDER, linewidth=1.0)
    
    # ── Section 3: AI MODELS ──────────────────────────────────────────
    panel_ax.text(0.505, 0.88, "AI MODELS:", color='#a855f7', fontsize=9.2, weight='bold', transform=panel_ax.transAxes)
    ai_items = [
        ('AIGEFS', AI_COLORS['AIGEFS']),
        ('ECMWF AIFS', AI_COLORS['ECMWF AIFS']),
        ('WeatherNext 3 Cyclone', AI_COLORS['WeatherNext 3 Cyclone'])
    ]
    for idx, (m_name, m_color) in enumerate(ai_items):
        is_active = (m_name in ensemble_means and not ensemble_means[m_name].empty) or \
                    (m_name == 'WeatherNext 3 Cyclone' and 'WeatherNext Cyclone' in ensemble_means and not ensemble_means['WeatherNext Cyclone'].empty)
        line_color = m_color if is_active else '#334155'
        text_color = TEXT_PRI if is_active else TEXT_MUT
        
        if idx < 2:
            x_start, x_text = 0.505, 0.539
            y_val = 0.68 - (idx * 0.28)
        else:
            x_start, x_text = 0.695, 0.729
            y_val = 0.68
            
        panel_ax.plot([x_start, x_start + 0.026], [y_val, y_val], color=line_color, linestyle='-', linewidth=2.4, transform=panel_ax.transAxes)
        panel_ax.text(x_text, y_val + 0.03, m_name, color=text_color, fontsize=8.2, weight='bold', transform=panel_ax.transAxes)
        run_str = track_inits.get(m_name)
        if not run_str and m_name == 'WeatherNext 3 Cyclone':
            run_str = track_inits.get('WeatherNext Cyclone')
        if not run_str:
            run_str = 'Latest' if is_active else 'Not Available'
        panel_ax.text(x_text, y_val - 0.11, f"Run: {run_str}", color=TEXT_SEC if is_active else TEXT_MUT, fontsize=6.7, transform=panel_ax.transAxes)
        
    out_abs = os.path.normpath(os.path.abspath(output_filepath))
    os.makedirs(os.path.dirname(out_abs), exist_ok=True)
    try:
        plt.savefig(out_abs, dpi=200, bbox_inches='tight', facecolor=BG_DARK)
    except OSError:
        import time
        time.sleep(0.6)
        plt.savefig(out_abs, dpi=200, bbox_inches='tight', facecolor=BG_DARK)
    plt.close(fig)
    print(f"Successfully generated publication-quality forecast track plot: {out_abs}")


def plot_unofficial_forecast_track_map(storm, agency_tracks, ensemble_means, output_filepath, init_time_str="Latest", track_inits=None, show_satellite=True):
    """
    Renders a broadcast-grade consensus mean forecast track map with Cone of Uncertainty
    and an overhaul of the bottom Forecast Summary & Intensity Dashboard.
    """
    if track_inits is None:
        track_inits = {}

    short_id = get_short_atcf_id(storm['atcf_id'])
    full_storm_title = format_storm_title(storm)
    curr_lat, curr_lon = float(storm['lat']), float(storm['lon'])
    mean_track = compute_compiled_mean_track(agency_tracks, ensemble_means, storm=storm)
    
    fig = plt.figure(figsize=(12, 7.6), facecolor=BG_DARK)
    
    # ── 1. Top Header Glassmorphism Card ─────────────────────────────
    ax_head = fig.add_axes([0.05, 0.865, 0.90, 0.115])
    ax_head.set_facecolor(HEADER_BG)
    ax_head.set_xlim(0, 1)
    ax_head.set_ylim(0, 1)
    ax_head.axis('off')
    
    head_box = FancyBboxPatch(
        (0, 0), 1, 1, boxstyle="round,pad=0.015,rounding_size=0.04",
        facecolor=HEADER_BG, edgecolor=HEADER_BORDER, linewidth=1.2, transform=ax_head.transAxes
    )
    ax_head.add_patch(head_box)
    
    # User Brand Logo (from ai_precip_outlook style)
    found_logo = next((p for p in LOGO_PATHS if os.path.exists(p)), None)
    title_x = 0.025
    if found_logo:
        try:
            logo_img = mpimg.imread(found_logo)
            logo_ax = fig.add_axes([0.058, 0.872, 0.045, 0.098], zorder=45)
            logo_ax.imshow(logo_img)
            logo_ax.axis('off')
            title_x = 0.082
        except Exception:
            title_x = 0.025

    ax_head.text(
        title_x, 0.68, f"{full_storm_title} — Consensus Mean Track & Cone of Uncertainty",
        fontsize=13.5, fontweight='bold', color=TEXT_PRI, transform=ax_head.transAxes, va='center'
    )
    ph_time_str = format_to_ph_time_str(init_time_str)
    ax_head.text(
        title_x, 0.28, f"Compiled Multi-Model & Agency Ensemble Consensus  |  PH Time: {ph_time_str}",
        fontsize=9.5, color=TEXT_SEC, transform=ax_head.transAxes, va='center'
    )
    
    ax_head.text(
        0.975, 0.68, "Philippine Typhoon/Weather",
        fontsize=11.5, fontweight='bold', color=TEXT_PRI, transform=ax_head.transAxes, ha='right', va='center'
    )
    ax_head.text(
        0.975, 0.28, "Unofficial Forecast Consensus",
        fontsize=9.0, color='#38bdf8', transform=ax_head.transAxes, ha='right', va='center'
    )
    
    # ── 2. Cartopy Map Canvas ─────────────────────────────────────────
    ax = fig.add_axes([0.05, 0.235, 0.90, 0.615], projection=ccrs.PlateCarree())
    ax.set_facecolor(OCEAN_COLOR)
    
    # Base Map Features (Deep Navy TV ocean, Slate-Dark terrain, crisp dark coastline)
    ax.add_feature(cfeature.OCEAN, facecolor=OCEAN_COLOR, zorder=0)
    ax.add_feature(cfeature.LAND, facecolor=LAND_COLOR, zorder=1)
    
    # Philippine Province Overlay
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        geojson_paths = [
            os.path.join(script_dir, "public", "data", "ph_provinces.json"),
            "public/data/ph_provinces.json"
        ]
        found_geojson = next((p for p in geojson_paths if os.path.exists(p)), None)
        if found_geojson:
            with open(found_geojson, 'r', encoding='utf-8') as gf:
                geojson_data = json.load(gf)
            prov_geoms = [shape(feature['geometry']) for feature in geojson_data['features']]
            ax.add_geometries(prov_geoms, crs=ccrs.PlateCarree(), facecolor='none', edgecolor=PROVINCE_EDGE, linewidth=0.70, alpha=0.85, zorder=4.0)
    except Exception:
        pass

    # Coastlines & International Borders (Rendered above satellite imagery at zorder=4.1)
    ax.add_feature(cfeature.COASTLINE, linewidth=1.2, edgecolor=LAND_EDGE, zorder=4.1)
    ax.add_feature(cfeature.BORDERS, linestyle='-', linewidth=0.85, edgecolor=BORDER_EDGE, zorder=4.1)
    
    # PAR Boundary Polygon (Matching forcast5.py solid PAR with dark warm halo)
    par_vertices = [
        (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
        (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
    ]
    ax.add_patch(mpatches.Polygon(
        par_vertices, facecolor='none', edgecolor=PAR_COLOR,
        linestyle='-', linewidth=2.5, alpha=0.95,
        transform=ccrs.PlateCarree(), zorder=5, label='PAR',
        path_effects=[path_effects.Stroke(linewidth=4.0, foreground='#451a03', alpha=0.5), path_effects.Normal()]
    ))
    
    # Subtle Gridlines Configuration (Matching forcast5.py)
    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color=GRID_COLOR, alpha=0.25, linestyle=':', zorder=4)
    gl.xlocator = plt.FixedLocator(np.arange(90, 181, 5))
    gl.ylocator = plt.FixedLocator(np.arange(-10, 51, 5))
    gl.xlabel_style = {'size': 9.0, 'weight': 'bold', 'color': GRID_TEXT}
    gl.ylabel_style = {'size': 9.0, 'weight': 'bold', 'color': GRID_TEXT}
    gl.top_labels = False
    gl.right_labels = False
    
    # Adaptive Viewport
    all_lats = [curr_lat]
    all_lons = [curr_lon]
    if not mean_track.empty:
        all_lats.extend(mean_track['lat'].dropna().tolist())
        all_lons.extend(mean_track['lon'].dropna().tolist())
        
    extent = get_adaptive_viewport(all_lats, all_lons, target_aspect=1.75)
    min_lon, max_lon, min_lat, max_lat = extent
    span_lon = max_lon - min_lon
    ax.set_extent(extent, crs=ccrs.PlateCarree())
    
    # Overlay Isolated Himawari Satellite Clouds (Transparent Ocean & Land)
    if show_satellite:
        storm_target_time = storm.get('init_time') or init_time_str
        overlay_isolated_satellite_clouds(ax, extent, target_time=storm_target_time)

    # Sea Text Labels (strictly bounded and zoom-scaled)
    render_sea_labels(ax, extent)
    
    # Cone of Uncertainty
    if not mean_track.empty and len(mean_track) > 0:
        lats = mean_track['lat'].values
        lons = mean_track['lon'].values
        taus = mean_track['lead_time_hours'].values
        
        cone_geom = build_cone_polygon(lats, lons, taus)
        if cone_geom:
            if cone_geom.geom_type == 'Polygon':
                geoms = [cone_geom]
            elif cone_geom.geom_type == 'MultiPolygon':
                geoms = list(cone_geom.geoms)
            else:
                geoms = []
                
            if geoms:
                ax.add_geometries(
                    geoms, crs=ccrs.PlateCarree(),
                    facecolor='#38bdf8', alpha=0.18,
                    edgecolor='#7dd3fc', linestyle='--', linewidth=1.6,
                    zorder=6, label='Cone of Uncertainty'
                )
                
        # Spline Consensus Track Line
        ax.plot(
            lons, lats, color='#f1f5f9', linestyle='-', linewidth=2.8,
            label='Unofficial Mean Track', transform=ccrs.PlateCarree(), zorder=10,
            path_effects=[path_effects.Stroke(linewidth=4.8, foreground=BG_DARK), path_effects.Normal()]
        )
        
        # Waypoints at 24h, 48h, 72h, 96h, 120h with perpendicular track offsets
        waypoints = [r for _, r in mean_track.iterrows() if int(round(r['lead_time_hours'])) in [24, 48, 72, 96, 120]]
        N_pts = len(waypoints)
        for idx, row in enumerate(waypoints):
            h = int(round(row['lead_time_hours']))
            la = float(row['lat'])
            lo = float(row['lon'])
            w = row.get('wind', 45)
            wind_for_color = w if (w is not None and not pd.isna(w) and w > 0) else 45
            pt_color, cat_name = get_intensity_color(wind_for_color)
            
            size = 82
            ax.scatter(
                lo, la, color=pt_color, edgecolor='#ffffff', linewidth=1.8,
                s=size, zorder=12, transform=ccrs.PlateCarree()
            )
            
            lbl_text = f"T+{h}h\n{int(round(wind_for_color))} km/h"
            
            # Compute track tangent vector to push labels perpendicular to track heading
            if idx < N_pts - 1:
                t_dx = float(waypoints[idx + 1]['lon']) - lo
                t_dy = float(waypoints[idx + 1]['lat']) - la
            else:
                t_dx = lo - float(waypoints[idx - 1]['lon'])
                t_dy = la - float(waypoints[idx - 1]['lat'])
                
            dist_seg = math.sqrt(t_dx**2 + t_dy**2)
            if dist_seg > 0.05:
                # Normal vector pointing to the right/outside of track
                nx = t_dy / dist_seg
                ny = -t_dx / dist_seg
            else:
                nx, ny = 0.707, 0.707
                
            # If waypoints are in a tight cluster/loop, disperse to distinct cardinal directions
            if dist_seg < 0.85:
                cardinal_angles = [0.0, math.pi / 2.0, math.pi, 3.0 * math.pi / 2.0, math.pi / 4.0, 5.0 * math.pi / 4.0]
                angle_rad = cardinal_angles[idx % len(cardinal_angles)]
                offset_dist = max(0.70, min(1.3, span_lon * 0.040))
                dx = math.cos(angle_rad) * offset_dist
                dy = math.sin(angle_rad) * offset_dist
            else:
                side = 1.0 if (idx % 2 == 0) else -1.0
                offset_r = max(0.55, min(1.1, span_lon * 0.028))
                dx = nx * offset_r * side
                dy = ny * offset_r * side
            
            ha = 'left' if dx > 0.15 else ('right' if dx < -0.15 else 'center')
            va = 'bottom' if dy > 0.15 else ('top' if dy < -0.15 else 'center')
            
            ax.text(
                lo + dx, la + dy, lbl_text, color='#ffffff', fontsize=7.6, weight='bold',
                transform=ccrs.PlateCarree(), zorder=14, ha=ha, va=va, clip_on=True,
                path_effects=[path_effects.withStroke(linewidth=3.0, foreground=BG_DARK)]
            )
            
    # Draw initial storm center fix icon
    draw_current_storm_glyph(ax, curr_lon, curr_lat, color='#38bdf8', size=130)
    
    # ── 3. Bottom Forecast Summary & Intensity Dashboard ─────────────
    init_dt = None
    if storm.get('init_time'):
        try:
            init_dt = datetime.strptime(str(storm['init_time']).split('.')[0], "%Y-%m-%d %H:%M:%S")
        except Exception:
            try: init_dt = pd.to_datetime(storm['init_time'])
            except Exception: pass
            
    forecast_data = []
    key_hours = [0, 24, 48, 72, 96, 120]
    if not mean_track.empty:
        for _, r in mean_track.iterrows():
            h = int(round(r['lead_time_hours']))
            if h in key_hours:
                w_val = r.get('wind')
                p_val = r.get('pressure')
                
                wind = int(round(w_val)) if (w_val is not None and not math.isnan(w_val) and w_val > 0) else 45
                mslp = int(round(p_val)) if (p_val is not None and not math.isnan(p_val) and p_val > 0) else 1004
                
                time_lbl = ""
                if init_dt:
                    t_pt = init_dt + timedelta(hours=h)
                    time_lbl = t_pt.strftime("%b %d %HZ")
                else:
                    time_lbl = f"+{h}h"
                    
                pt_color, cat_name = get_intensity_color(wind)
                
                forecast_data.append({
                    "label": f"T+{h}h",
                    "date": time_lbl,
                    "lat": round(float(r['lat']), 1),
                    "lon": round(float(r['lon']), 1),
                    "wind": wind,
                    "wind_kt": int(round(wind / 1.852)),
                    "mslp": mslp,
                    "dot_color": pt_color,
                    "cat_name": cat_name
                })
                
    N = len(forecast_data)
    if N > 0:
        panel_ax = fig.add_axes([0.05, 0.015, 0.90, 0.175])
        panel_ax.set_facecolor(CARD_BG)
        panel_ax.set_xlim(0, 1)
        panel_ax.set_ylim(0, 1)
        panel_ax.axis('off')
        
        panel_box = FancyBboxPatch(
            (0, 0), 1, 1, boxstyle="round,pad=0.015,rounding_size=0.04",
            facecolor=CARD_BG, edgecolor=CARD_BORDER, linewidth=1.2, transform=panel_ax.transAxes
        )
        panel_ax.add_patch(panel_box)
        
        panel_ax.text(
            0.02, 0.91, "FORECAST SUMMARY & INTENSITY DETAILS (6-HOUR CONSENSUS)",
            transform=panel_ax.transAxes, fontsize=8.0, fontweight="bold", color='#38bdf8',
            fontfamily="monospace", va="center"
        )
        
        left_margin  = 0.012
        right_margin = 0.988
        card_width   = (right_margin - left_margin) / N
        card_pad     = 0.005
        
        for i, fc in enumerate(forecast_data):
            x0 = left_margin + i * card_width + card_pad
            x1 = left_margin + (i + 1) * card_width - card_pad
            cw = x1 - x0
            cx = (x0 + x1) / 2.0
            
            card = FancyBboxPatch(
                (x0, 0.05), cw, 0.81, boxstyle="round,pad=0.005,rounding_size=0.03",
                transform=panel_ax.transAxes,
                facecolor='#1e293b', edgecolor='#334155', linewidth=0.8, zorder=1
            )
            panel_ax.add_patch(card)
            
            dot_c = fc.get("dot_color", '#38bdf8')
            
            # Top: Lead Time Badge
            panel_ax.text(
                cx, 0.77, f"{fc['label']} • {fc['date']}",
                transform=panel_ax.transAxes, ha="center", va="center",
                fontsize=7.8, fontweight="bold", color=dot_c, zorder=2
            )
            
            # Category Badge
            panel_ax.text(
                cx, 0.65, fc['cat_name'],
                transform=panel_ax.transAxes, ha="center", va="center",
                fontsize=6.8, fontweight="bold", color=TEXT_PRI, zorder=2
            )
            
            # Coordinates
            pos_str = f"{fc['lat']}°N, {fc['lon']}°E"
            panel_ax.text(
                cx, 0.53, pos_str,
                transform=panel_ax.transAxes, ha="center", va="center",
                fontsize=7.0, color=TEXT_SEC, zorder=2
            )
            
            panel_ax.axhline(0.44, color='#334155', linewidth=0.6, xmin=x0 + 0.005, xmax=x1 - 0.005)
            
            # Wind Speed in km/h and kt
            panel_ax.text(
                cx, 0.33, f"{fc['wind']} km/h",
                transform=panel_ax.transAxes, ha="center", va="center",
                fontsize=9.0, fontweight="bold", color=dot_c, zorder=2
            )
            panel_ax.text(
                cx, 0.22, f"({fc['wind_kt']} kt)",
                transform=panel_ax.transAxes, ha="center", va="center",
                fontsize=6.8, color=TEXT_SEC, zorder=2
            )
            
            # Central Pressure
            panel_ax.text(
                cx, 0.11, f"{fc['mslp']} hPa",
                transform=panel_ax.transAxes, ha="center", va="center",
                fontsize=7.5, fontweight="bold", color=TEXT_PRI, zorder=2
            )
            
    out_abs = os.path.normpath(os.path.abspath(output_filepath))
    os.makedirs(os.path.dirname(out_abs), exist_ok=True)
    try:
        plt.savefig(out_abs, dpi=200, bbox_inches='tight', facecolor=BG_DARK)
    except OSError:
        import time
        time.sleep(0.6)
        plt.savefig(out_abs, dpi=200, bbox_inches='tight', facecolor=BG_DARK)
    plt.close(fig)
    print(f"Successfully generated Philippine Typhoon/Weather unofficial forecast track plot: {out_abs}")




def process_and_generate_tracks(storm_id_filter=None, output_dir='public/assets', show_satellite=True):
    """
    Processes active storm systems, computes ensemble means & agency tracks from real workspace files,
    and saves separate image files for each storm.
    """
    knack_storms = fetch_knack_active_storms()
    
    if not knack_storms:
        print("No live Knack storms retrieved. Using default WP active storm sample.")
        knack_storms = [{
            'atcf_id': '90W',
            'name': 'INVEST',
            'lat': 14.5,
            'lon': 132.0,
            'init_time': datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        }]
        
    plotted_files = []
    
    for storm in knack_storms:
        clean_id = clean_storm_id_no_dot(storm['atcf_id'])
        short_id = get_short_atcf_id(storm['atcf_id'])
        
        if storm_id_filter:
            target = storm_id_filter.upper().strip().replace('.', '')
            if target not in (clean_id.upper(), short_id.upper(), storm['atcf_id'].upper()):
                continue
                
        # Load real tracks per storm alongside model run initialization timestamps
        agency_tracks, ensemble_means, track_inits = load_all_actual_tracks_for_storm(storm)
        
        # 1. Comparison Track Map
        filename = f"forecasttrack_{short_id}.png"
        out_filepath = os.path.join(output_dir, filename)
        
        plot_forecast_track_map(
            storm=storm,
            agency_tracks=agency_tracks,
            ensemble_means=ensemble_means,
            output_filepath=out_filepath,
            init_time_str=storm.get('init_time', 'Latest'),
            track_inits=track_inits,
            show_satellite=show_satellite
        )
        plotted_files.append(out_filepath)

        # 2. Dedicated Unofficial Consensus Mean Track Map with Cone of Uncertainty
        unofficial_filename = f"forecasttrack_unofficial_{short_id}.png"
        unofficial_filepath = os.path.join(output_dir, unofficial_filename)
        
        plot_unofficial_forecast_track_map(
            storm=storm,
            agency_tracks=agency_tracks,
            ensemble_means=ensemble_means,
            output_filepath=unofficial_filepath,
            init_time_str=storm.get('init_time', 'Latest'),
            track_inits=track_inits,
            show_satellite=show_satellite
        )
        plotted_files.append(unofficial_filepath)
        
    return plotted_files


def main():
    parser = argparse.ArgumentParser(description="Forecast Track Visualization Script")
    parser.add_argument('--storm-id', type=str, help="Specific storm ATCF ID to plot (e.g. 90W or WP01)")
    parser.add_argument('--output-dir', type=str, default='public/assets', help="Directory to save generated plot images")
    parser.add_argument('--no-satellite', action='store_true', help="Disable Himawari satellite cloud overlay")
    args = parser.parse_args()
    
    process_and_generate_tracks(
        storm_id_filter=args.storm_id,
        output_dir=args.output_dir,
        show_satellite=not args.no_satellite
    )


if __name__ == '__main__':
    main()
