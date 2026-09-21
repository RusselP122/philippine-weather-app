"""
model_comparison_broadcast.py
==============================
TV Broadcast Weather Model Comparison System
Customized for Philippine Typhoon / Weather Broadcast Operations
Inspired by NBC StormTeam 4 & High-End Television Weather Graphics

Compares 4 premier global forecasting models:
1. GFS (American Global Forecast System - NOAA)
2. AIGFS / AIGEFS (American AI Global Forecast System / Ensemble - NOAA)
3. ECMWF IFS (European Centre for Medium-Range Weather Forecasts)
4. ECMWF AIFS (European Artificial Intelligence Forecasting System)

Features:
- Multi-Frame Broadcast Layouts:
  * 4-Panel Quad Grid (2x2): Compares GFS, AIGFS, ECMWF, AIFS simultaneously
  * 3-Panel Side-by-Side (1x3): 3-model horizontal comparison
  * 2-Panel Side-by-Side (1x2): Classic 2-model comparison
  * 1-Panel Single Model (1x1): Full widescreen broadcast view for a single model
- Official Philippine Typhoon/Weather Branding:
  * Embedded official circular logo (logo.png)
  * Station branding: PHILIPPINE TYPHOON / WEATHER
- Dynamic Edge-to-Edge Map Framing:
  * Zero letterboxing/pillarboxing - maps seamlessly fill every card
- Authentic TV Broadcast Graphics:
  * Cinematic rainy studio window background with bokeh raindrops on glass
  * Glassmorphism top header with station badge, title card & valid day pill
  * Map cards with dark ocean, slate terrain, smooth MSLP isobars
  * Smooth precipitation / radar reflectivity color mapping
  * Signature red Low Pressure (L) center badge with counter-clockwise curved cyclonic arrows
  * Glass timestamp badge (e.g., "9 PM SUN JAN 25")
  * Deep royal blue gradient model title banners
- Data Pipeline:
  * Connectors for NOAA NOMADS (GFS, AIGFS/AIGEFS) and ECMWF OpenData (IFS, AIFS)
  * High-fidelity realistic synoptic simulation engine (--demo) for instant offline execution
"""

import os
import sys
import argparse
import numpy as np
import scipy.ndimage
from datetime import datetime, timedelta, timezone

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.patches import FancyBboxPatch, Circle, FancyArrowPatch
import matplotlib.patheffects as patheffects
from matplotlib.colors import ListedColormap, BoundaryNorm
import matplotlib.image as mpimg

import cartopy.crs as ccrs
import cartopy.feature as cfeature

# ── Import Shared Project Visualizations if Available ───────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
IMAGES_DIR = os.path.join(BASE_DIR, "public", "images")
os.makedirs(IMAGES_DIR, exist_ok=True)

try:
    from weather_viz_styles import load_ph_provinces, PAR_LONS, PAR_LATS
except ImportError:
    PAR_LONS = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
    PAR_LATS = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]
    load_ph_provinces = lambda d=None: []

# ── Color Palettes & Broadcast Design Tokens ────────────────────────────────────
BG_DARK = "#09111e"           # Deep studio canvas
CARD_BORDER = "#38bdf8"       # Cyan glow border
CARD_EDGE_MUTED = "#1e3a5f"   # Deep navy card edge
TEXT_WHITE = "#ffffff"
TEXT_MUTED = "#94a3b8"

# ── 10m Surface Wind Speed Colormap (km/h) ──────────────────────────────────────
# Full Synoptic & Typhoon Pivotal Weather / Broadcast Television wind speed scale (0 to 240+ km/h)
WIND_SPEED_LEVELS = [
    0, 4, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20,
    22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42,
    44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64,
    66, 70, 75, 80, 85, 90, 95, 100,
    110, 120, 135, 150, 165, 185, 210, 240
]
WIND_SPEED_COLORS = [
    "#101c2a",  # 0 - 4 km/h: Deep Ocean Midnight
    "#122030",  # 4 - 6 km/h: Dark Marine Navy
    "#142537",  # 6 - 7 km/h: Deep Slate Navy
    "#162b3f",  # 7 - 8 km/h: Subtle Ocean Navy
    "#183147",  # 8 - 9 km/h: Muted Blue-Navy
    "#1b3851",  # 9 - 10 km/h: Deep Blue Transition
    "#1463d3",  # 10 - 12 km/h: Deep Cobalt Blue
    "#2883ef",  # 12 - 14 km/h: Royal Blue
    "#4fa5f8",  # 14 - 16 km/h: Sky Blue
    "#9ad0fd",  # 16 - 18 km/h: Light Ice Blue
    "#b4eefb",  # 18 - 20 km/h: Pale Cyan
    "#34d33a",  # 20 - 22 km/h: Fresh Green
    "#51f050",  # 22 - 24 km/h: Bright Lime Green
    "#77f476",  # 24 - 26 km/h: Light Mint Green
    "#b7f8ad",  # 26 - 28 km/h: Pale Mint
    "#c7ffbb",  # 28 - 30 km/h: Soft Pastel Green
    "#fefaa7",  # 30 - 32 km/h: Light Cream Yellow
    "#fee87b",  # 32 - 34 km/h: Golden Yellow
    "#ffbf3c",  # 34 - 36 km/h: Amber Gold
    "#fca104",  # 36 - 38 km/h: Vivid Orange
    "#fb6100",  # 38 - 40 km/h: Deep Orange
    "#fd3204",  # 40 - 42 km/h: Vermilion Red-Orange
    "#e01304",  # 42 - 44 km/h: Scarlet Red
    "#c10102",  # 44 - 46 km/h: Crimson Red
    "#a70101",  # 46 - 48 km/h: Deep Blood Red
    "#643b30",  # 48 - 50 km/h: Dark Ochre Brown
    "#795045",  # 50 - 52 km/h: Earth Brown
    "#8c625a",  # 52 - 54 km/h: Warm Tan Brown
    "#b48c85",  # 54 - 56 km/h: Pale Tan
    "#e1bdb6",  # 56 - 58 km/h: Soft Blush Tan
    "#f1dcd3",  # 58 - 60 km/h: Pale Rose Grey
    "#fbf0eb",  # 60 - 62 km/h: Off-White Blush
    "#fce7e6",  # 62 - 64 km/h: Pale Rose Pink
    "#fec7c9",  # 64 - 66 km/h: Soft Coral Pink
    "#f59e9f",  # 66 - 70 km/h: Salmon Coral
    "#e58383",  # 70 - 75 km/h: Light Coral Red
    "#e16363",  # 75 - 80 km/h: Deep Coral
    "#d64e52",  # 80 - 85 km/h: Intense Crimson
    "#c83b3e",  # 85 - 90 km/h: Dark Ruby Red
    "#b7291f",  # 90 - 95 km/h: Dark Maroon
    "#991b1b",  # 95 - 100 km/h: Deep Blood Crimson
    # --- Tropical Cyclone & Typhoon Eyewall Tiers (> 100 km/h) ---
    "#831843",  # 100 - 110 km/h: Deep Plum / Severe Tropical Storm Peak
    "#9d174d",  # 110 - 120 km/h: Rich Berry / Typhoon Cat 1 Threshold (118 km/h)
    "#be185d",  # 120 - 135 km/h: Vivid Magenta-Red / Cat 1 Typhoon
    "#c026d3",  # 135 - 150 km/h: Bright Magenta / Cat 2 Typhoon
    "#d946ef",  # 150 - 165 km/h: Electric Fuchsia / Cat 2-3 Typhoon
    "#9333ea",  # 165 - 185 km/h: Vibrant Purple / Cat 3-4 Typhoon
    "#6b21a8",  # 185 - 210 km/h: Deep Royal Purple / Super Typhoon (> 185 km/h)
    "#3b0764",  # 210 - 240 km/h: Extreme Midnight Purple / Violent Super Typhoon
]
WIND_SPEED_CMAP = ListedColormap(WIND_SPEED_COLORS, name="pivotal_broadcast_wind")
WIND_SPEED_CMAP.set_over("#fdf4ff")  # > 240 km/h: Blinding Neon White Eyewall Core
WIND_SPEED_NORM = BoundaryNorm(WIND_SPEED_LEVELS, ncolors=len(WIND_SPEED_COLORS), clip=False)

# Backward compatibility aliases
PRECIP_LEVELS = WIND_SPEED_LEVELS
PRECIP_COLORS = WIND_SPEED_COLORS
PRECIP_CMAP = WIND_SPEED_CMAP
PRECIP_NORM = WIND_SPEED_NORM

# Model Metadata Specifications
MODEL_META = {
    "GFS": {
        "name": "GFS",
        "agency": "NOAA / NCEP",
        "full_name": "American Global Forecast System",
        "banner_text": "AMERICAN GFS FORECAST",
        "sub_badge": "NOAA GFS",
        "color": "#38bdf8",
        "gradient": ("#0c4a6e", "#0284c7"),
    },
    "AIGFS": {
        "name": "AIGFS",
        "agency": "NOAA AI / GraphCast",
        "full_name": "American AI Global Forecast System",
        "banner_text": "AMERICAN AI-GFS FORECAST",
        "sub_badge": "NOAA AIGFS",
        "color": "#fb923c",
        "gradient": ("#7c2d12", "#ea580c"),
    },
    "AIGEFS": {
        "name": "AIGEFS",
        "agency": "NOAA AI / GraphCast",
        "full_name": "American AI Global Ensemble",
        "banner_text": "AMERICAN AI-GEFS FORECAST",
        "sub_badge": "NOAA AI-GEFS",
        "color": "#fb923c",
        "gradient": ("#7c2d12", "#ea580c"),
    },
    "ECMWF": {
        "name": "ECMWF",
        "agency": "ECMWF",
        "full_name": "European Integrated Forecast System",
        "banner_text": "EUROPEAN ECMWF FORECAST",
        "sub_badge": "ECMWF IFS",
        "color": "#facc15",
        "gradient": ("#1e3a8a", "#2563eb"),
    },
    "AIFS": {
        "name": "AIFS",
        "agency": "ECMWF AI",
        "full_name": "ECMWF Artificial Intelligence",
        "banner_text": "EUROPEAN AIFS FORECAST",
        "sub_badge": "ECMWF AIFS",
        "color": "#2dd4bf",
        "gradient": ("#064e3b", "#0d9488"),
    },
    "WEATHERNEXT": {
        "name": "WEATHERNEXT",
        "agency": "Google DeepMind",
        "full_name": "Google WeatherNext 3 Model",
        "banner_text": "GOOGLE WEATHERNEXT 3 FORECAST",
        "sub_badge": "GOOGLE WNC3",
        "color": "#c084fc",
        "gradient": ("#581c87", "#7e22ce"),
    },
    "WEATHERNEXT3": {
        "name": "WEATHERNEXT3",
        "agency": "Google DeepMind",
        "full_name": "Google WeatherNext 3 Model",
        "banner_text": "GOOGLE WEATHERNEXT 3 FORECAST",
        "sub_badge": "GOOGLE WN3 (10 KM)",
        "color": "#c084fc",
        "gradient": ("#581c87", "#7e22ce"),
    },
    "WN3": {
        "name": "WN3",
        "agency": "Google DeepMind",
        "full_name": "Google WeatherNext 3 Model",
        "banner_text": "GOOGLE WEATHERNEXT 3 FORECAST",
        "sub_badge": "GOOGLE WN3 (10 KM)",
        "color": "#c084fc",
        "gradient": ("#581c87", "#7e22ce"),
    }
}

# Domain Extents
DOMAINS = {
    "ph": {
        "name": "Philippine Area of Responsibility (PAR)",
        "extent": [112.0, 138.0, 4.0, 25.0],
        "is_ph": True
    },
    "wnp": {
        "name": "Western North Pacific",
        "extent": [108.0, 152.0, 2.0, 32.0],
        "is_ph": False
    },
    "conus": {
        "name": "Eastern United States",
        "extent": [-88.0, -68.0, 28.0, 46.0],
        "is_ph": False
    }
}


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Realistic Synoptic Simulation Engine (Instant --demo & offline mode)
# ═══════════════════════════════════════════════════════════════════════════════

def generate_demo_model_data(model_key, domain_extent, valid_dt):
    """
    Generates realistic synoptic weather fields (MSLP isobars + precipitation)
    tailored to each model's unique characteristics to realistically emulate
    operational model divergence across the specific extent.
    """
    norm_key = model_key.upper().strip()
    lon_min, lon_max, lat_min, lat_max = domain_extent
    lons = np.linspace(lon_min - 3.0, lon_max + 3.0, 160)
    lats = np.linspace(lat_min - 3.0, lat_max + 3.0, 130)
    LONS, LATS = np.meshgrid(lons, lats)

    # Base background pressure field: subtropical ridge north/east, lower pressure south
    base_mslp = 1012.0 + (LATS - (lat_min + lat_max) / 2.0) * 0.35 + (LONS - lon_min) * 0.08

    # Low Pressure Center coordinates with realistic model divergence
    cx = 127.5
    cy = 13.8

    # Model-specific offsets and depths
    if norm_key == "GFS":
        center_lon, center_lat = cx + 1.8, cy + 1.1
        central_pressure = 992.0
        r_scale = 3.2
        rain_amp = 48.0
    elif norm_key in ("AIGFS", "AIGEFS"):
        center_lon, center_lat = cx + 2.3, cy + 0.8
        central_pressure = 995.0
        r_scale = 3.0
        rain_amp = 44.0
    elif norm_key == "ECMWF":
        center_lon, center_lat = cx + 0.3, cy + 0.2
        central_pressure = 988.0
        r_scale = 2.8
        rain_amp = 62.0
    elif norm_key == "AIFS":
        center_lon, center_lat = cx + 0.7, cy + 0.4
        central_pressure = 990.0
        r_scale = 2.9
        rain_amp = 55.0
    elif norm_key in ("WEATHERNEXT", "WEATHERNEXT3", "WN3"):
        center_lon, center_lat = cx + 0.9, cy + 0.6
        central_pressure = 989.0
        r_scale = 2.7
        rain_amp = 68.0
    else:
        center_lon, center_lat = cx, cy
        central_pressure = 994.0
        r_scale = 3.0
        rain_amp = 45.0

    # Distance to cyclone center
    dist = np.sqrt((LONS - center_lon) ** 2 + ((LATS - center_lat) * 1.1) ** 2)

    # Radial pressure dip (Holland/Rankine type profile)
    depth = 1012.0 - central_pressure
    cyclone_mslp = -depth * np.exp(-((dist / r_scale) ** 1.8))
    mslp_field = base_mslp + cyclone_mslp

    # Secondary trough / front extends northeastward
    trough_axis = (LONS - center_lon) - 1.2 * (LATS - center_lat)
    trough_effect = -4.5 * np.exp(-(trough_axis ** 2) / 6.0) * (LATS > center_lat - 1)
    mslp_field += trough_effect

    # Gaussian smoothing for smooth broadcast isobars
    mslp_field = scipy.ndimage.gaussian_filter(mslp_field, sigma=1.0)

    # 10m Surface Wind Speed field (km/h): Holland / Modified Rankine Vortex
    # Peak winds at eyewall (RMW ~ 1.05 deg), calm eye at center, outer decay & ambient easterlies
    dp = max(8.0, 1012.0 - central_pressure)
    # Vmax scaling: 938 hPa gives ~205 km/h (STY), 970 hPa gives ~145 km/h (TY), 990 hPa gives ~95 km/h (STS)
    vmax_kph = 12.8 * np.sqrt(dp) * 1.82
    rmw = 1.05

    angle = np.arctan2(LATS - center_lat, LONS - center_lon)
    r_ratio = dist / max(rmw, 0.05)
    v_profile = np.where(
        dist < rmw,
        vmax_kph * (r_ratio ** 1.35),
        vmax_kph * ((rmw / np.maximum(dist, rmw)) ** 0.52)
    )

    # Asymmetry: Storm translation and easterly flow enhances east/northeast quadrant
    asymmetry = 1.0 + 0.16 * np.cos(angle - 0.45)
    # Outer spiral wind bands
    spiral_bands = 1.0 + 0.12 * np.sin(3.2 * angle + dist * 1.3) * np.exp(-dist / 5.5)
    # Ambient background wind (~15-22 km/h)
    ambient_wind = 16.0 + 6.0 * np.sin(np.radians(LATS * 3.5))

    wind_field = v_profile * asymmetry * spiral_bands + ambient_wind * np.exp(-dist / 6.0)
    wind_field = np.maximum(0.0, wind_field)
    wind_field = scipy.ndimage.gaussian_filter(wind_field, sigma=0.8)

    # Find exact minimum pressure location for (L) center badge
    min_idx = np.unravel_index(np.argmin(mslp_field), mslp_field.shape)
    low_lon = float(LONS[min_idx])
    low_lat = float(LATS[min_idx])
    min_mslp = float(mslp_field[min_idx])

    return {
        "lons": lons,
        "lats": lats,
        "mslp": mslp_field,
        "wind_speed": wind_field,
        "precip": wind_field,  # backward compatibility
        "low_center": (low_lon, low_lat, min_mslp),
        "valid_dt": valid_dt,
        "model_key": norm_key
    }


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Live Data Connectors (NOAA NOMADS & ECMWF OpenData)
# ═══════════════════════════════════════════════════════════════════════════════

def fetch_live_ecmwf(model_type="ifs", step=240, extent=(98.0, 154.0, 2.0, 27.0)):
    """
    Retrieves real forecast fields from ECMWF OpenData with automatic multi-mirror failover
    (ECMWF -> AWS -> Azure) and calculates 6-hour precipitation ending at step.
    model_type: 'ifs' or 'aifs-single'
    """
    print(f"  [LIVE] Fetching ECMWF {model_type.upper()} for step T+{step}h ...")
    try:
        from ecmwf.opendata import Client
        import xarray as xr
        import pandas as pd
        # Ensure fast failover across mirrors without 120s retry delays
        try:
            import ecmwf.opendata.client
            import multiurl
            _orig_robust = getattr(multiurl, "_orig_robust_cached", multiurl.robust)
            multiurl._orig_robust_cached = _orig_robust
            fast_robust = lambda call, **kwargs: _orig_robust(call, maximum_tries=2, retry_after=1)
            multiurl.robust = fast_robust
            ecmwf.opendata.client.robust = fast_robust
        except Exception:
            pass

        target_file = f"temp_ecmwf_{model_type}_{step:03d}_{os.getpid()}.grib2"

        # 1. Multi-mirror retrieval (official ECMWF -> AWS OpenData -> Azure Planetary Computer)
        client = None
        for src in ["ecmwf", "aws", "azure"]:
            try:
                c = Client(source=src, model=model_type, resol="0p25")
                c.retrieve(step=step, type="fc", param=["10u", "10v", "msl"], target=target_file)
                client = c
                break
            except Exception as e_src:
                if src == "azure":
                    raise e_src
                continue

        ds = xr.open_dataset(target_file, engine="cfgrib")
        if "time" in ds.dims and ds.sizes["time"] > 1:
            ds = ds.isel(time=-1)

        init_dt = pd.to_datetime(ds.time.values)
        valid_dt = init_dt + timedelta(hours=step)

        lats = ds.latitude.values
        lons = ds.longitude.values
        u10 = ds["u10"].values.squeeze()
        v10 = ds["v10"].values.squeeze()
        ws = np.sqrt(u10**2 + v10**2) * 3.6  # m/s -> km/h
        msl = ds["msl"].values.squeeze() / 100.0  # Pa -> hPa
        ds.close()
        try: os.remove(target_file)
        except Exception: pass

        # Longitude normalization to [-180, 180]
        if np.nanmax(lons) > 180:
            lons = np.where(lons > 180, lons - 360, lons)
        sort_lon = np.argsort(lons)
        lons = lons[sort_lon]
        msl = msl[:, sort_lon]
        ws = ws[:, sort_lon]

        # Latitude sorting (ascending)
        if lats[0] > lats[-1]:
            lats = lats[::-1]
            msl = msl[::-1, :]
            ws = ws[::-1, :]

        # Spatial clipping to extent
        lon_mask = (lons >= extent[0] - 2.0) & (lons <= extent[1] + 2.0)
        lat_mask = (lats >= extent[2] - 2.0) & (lats <= extent[3] + 2.0)
        sub_lons = lons[lon_mask]
        sub_lats = lats[lat_mask]
        sub_msl = msl[np.ix_(lat_mask, lon_mask)]
        sub_ws = np.maximum(0, ws[np.ix_(lat_mask, lon_mask)])

        # Find Low Pressure Center inside visible extent (avoiding border edges)
        inner_lon_mask = (sub_lons >= extent[0] + 0.5) & (sub_lons <= extent[1] - 0.5)
        inner_lat_mask = (sub_lats >= extent[2] + 0.5) & (sub_lats <= extent[3] - 0.5)
        low_center = None
        if np.any(inner_lon_mask) and np.any(inner_lat_mask):
            inner_msl = sub_msl[np.ix_(inner_lat_mask, inner_lon_mask)]
            inner_lons = sub_lons[inner_lon_mask]
            inner_lats = sub_lats[inner_lat_mask]
            min_idx = np.unravel_index(np.argmin(inner_msl), inner_msl.shape)
            low_lon = float(inner_lons[min_idx[1]])
            low_lat = float(inner_lats[min_idx[0]])
            min_p = float(inner_msl[min_idx])
            if min_p < 1012.0:
                low_center = (low_lon, low_lat, min_p)
                print(f"  [OK] ECMWF {model_type.upper()}: Min MSLP {min_p:.1f} hPa at ({low_lon:.1f}E, {low_lat:.1f}N)")
            else:
                print(f"  [OK] ECMWF {model_type.upper()}: No closed low (<1012 hPa) inside domain. Min MSLP: {min_p:.1f} hPa")

        return {
            "lons": sub_lons,
            "lats": sub_lats,
            "mslp": sub_msl,
            "wind_speed": sub_ws,
            "precip": sub_ws,  # backward compatibility
            "low_center": low_center,
            "init_dt": init_dt,
            "valid_dt": valid_dt,
            "model_key": "ECMWF" if model_type == "ifs" else "AIFS"
        }
    except Exception as e:
        print(f"  [WARNING] Live fetch for ECMWF {model_type} step {step} error: {e}")
        return None


def _read_grib_content(content):
    """Helper to decode GRIB2 byte content into a NumPy 2D array using eccodes."""
    import tempfile
    from eccodes import codes_grib_new_from_file, codes_get, codes_get_values, codes_release
    with tempfile.NamedTemporaryFile(suffix=".grib2", delete=False) as tf:
        tf.write(content)
        tmp_path = tf.name
    with open(tmp_path, "rb") as f:
        gid = codes_grib_new_from_file(f)
        ni = codes_get(gid, "Ni")
        nj = codes_get(gid, "Nj")
        arr = codes_get_values(gid).reshape(nj, ni)
        codes_release(gid)
    try:
        os.remove(tmp_path)
    except Exception:
        pass
    return arr, ni, nj


def fetch_live_aigfs(step=240, extent=(98.0, 154.0, 2.0, 27.0)):
    """
    Retrieves real forecast fields from NOAA NOMADS AIGFS via fast byte-range HTTP streaming:
    - PRMSL: mean sea level pressure (hPa)
    - UGRD & VGRD: 10 m above ground wind components (km/h)
    """
    import requests

    print(f"  [LIVE] Fetching NOAA AIGFS for step T+{step}h from NOMADS ...")
    base_url = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/aigfs/prod"
    now_utc = datetime.now(timezone.utc)

    for day_off in range(3):
        dt_check = now_utc - timedelta(days=day_off)
        date_str = dt_check.strftime("%Y%m%d")
        for cycle in ["18", "12", "06", "00"]:
            cycle_url = f"{base_url}/aigfs.{date_str}/{cycle}/model/atmos/grib2/"
            idx_url = f"{cycle_url}aigfs.t{cycle}z.sfc.f{step:03d}.grib2.idx"
            try:
                r_idx = requests.get(idx_url, timeout=6)
                if r_idx.status_code == 200:
                    lines = r_idx.text.splitlines()
                    prmsl_line = next((l for l in lines if ":PRMSL:mean sea level:" in l), None)
                    ugrd_line = next((l for l in lines if ":UGRD:10 m above ground:" in l), None)
                    vgrd_line = next((l for l in lines if ":VGRD:10 m above ground:" in l), None)
                    if not (prmsl_line and ugrd_line and vgrd_line):
                        continue

                    grib_url = f"{cycle_url}aigfs.t{cycle}z.sfc.f{step:03d}.grib2"

                    def get_range(target_line):
                        idx = lines.index(target_line)
                        start = int(target_line.split(":")[1])
                        end = int(lines[idx + 1].split(":")[1]) - 1 if idx < len(lines) - 1 else ""
                        return start, end

                    sp, ep = get_range(prmsl_line)
                    su, eu = get_range(ugrd_line)
                    sv, ev = get_range(vgrd_line)

                    r_p = requests.get(grib_url, headers={"Range": f"bytes={sp}-{ep}"}, timeout=25)
                    r_u = requests.get(grib_url, headers={"Range": f"bytes={su}-{eu}"}, timeout=25)
                    r_v = requests.get(grib_url, headers={"Range": f"bytes={sv}-{ev}"}, timeout=25)

                    if not (r_p.status_code in (200, 206) and r_u.status_code in (200, 206) and r_v.status_code in (200, 206)):
                        continue

                    msl_raw, ni, nj = _read_grib_content(r_p.content)
                    msl_raw = msl_raw / 100.0  # Pa -> hPa
                    u_raw, _, _ = _read_grib_content(r_u.content)
                    v_raw, _, _ = _read_grib_content(r_v.content)
                    ws_raw = np.sqrt(u_raw**2 + v_raw**2) * 3.6  # m/s -> km/h

                    lons = np.linspace(0.0, 359.75, ni)
                    lats = np.linspace(90.0, -90.0, nj)
                    lons_180 = np.where(lons > 180, lons - 360, lons)
                    sort_lon = np.argsort(lons_180)
                    lons = lons_180[sort_lon]
                    msl_raw = msl_raw[:, sort_lon]
                    ws_raw = ws_raw[:, sort_lon]

                    lats = lats[::-1]
                    msl_raw = msl_raw[::-1, :]
                    ws_raw = ws_raw[::-1, :]

                    lon_mask = (lons >= extent[0] - 2.0) & (lons <= extent[1] + 2.0)
                    lat_mask = (lats >= extent[2] - 2.0) & (lats <= extent[3] + 2.0)
                    sub_lons = lons[lon_mask]
                    sub_lats = lats[lat_mask]
                    sub_msl = msl_raw[np.ix_(lat_mask, lon_mask)]
                    sub_ws = np.maximum(0, ws_raw[np.ix_(lat_mask, lon_mask)])

                    # Find Low Pressure Center inside visible extent (avoiding border edges)
                    inner_lon_mask = (sub_lons >= extent[0] + 0.5) & (sub_lons <= extent[1] - 0.5)
                    inner_lat_mask = (sub_lats >= extent[2] + 0.5) & (sub_lats <= extent[3] - 0.5)
                    low_center = None
                    if np.any(inner_lon_mask) and np.any(inner_lat_mask):
                        inner_msl = sub_msl[np.ix_(inner_lat_mask, inner_lon_mask)]
                        inner_lons = sub_lons[inner_lon_mask]
                        inner_lats = sub_lats[inner_lat_mask]
                        min_idx = np.unravel_index(np.argmin(inner_msl), inner_msl.shape)
                        low_lon = float(inner_lons[min_idx[1]])
                        low_lat = float(inner_lats[min_idx[0]])
                        min_p = float(inner_msl[min_idx])
                        if min_p < 1012.0:
                            low_center = (low_lon, low_lat, min_p)

                    init_dt = datetime.strptime(f"{date_str}{cycle}", "%Y%m%d%H").replace(tzinfo=timezone.utc)
                    valid_dt = init_dt + timedelta(hours=step)

                    print(f"  [OK] NOAA AIGFS ({date_str} {cycle}Z): Min MSLP {min_p:.1f} hPa at ({low_lon:.1f}E, {low_lat:.1f}N)")
                    return {
                        "lons": sub_lons,
                        "lats": sub_lats,
                        "mslp": sub_msl,
                        "wind_speed": sub_ws,
                        "precip": sub_ws,  # backward compatibility
                        "low_center": low_center,
                        "init_dt": init_dt,
                        "valid_dt": valid_dt,
                        "model_key": "AIGFS"
                    }
            except Exception as e:
                continue
    print(f"  [WARNING] Could not retrieve live AIGFS from NOMADS.")
    return None


def fetch_live_gfs(step=240, extent=(98.0, 154.0, 2.0, 27.0)):
    """
    Retrieves real forecast fields from NOAA NOMADS GFS 0.25 via fast byte-range HTTP streaming:
    - PRMSL: mean sea level pressure (hPa)
    - UGRD & VGRD: 10 m above ground wind components (km/h)
    """
    import requests

    print(f"  [LIVE] Fetching NOAA GFS 0.25 for step T+{step}h from NOMADS ...")
    base_url = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod"
    now_utc = datetime.now(timezone.utc)

    for day_off in range(3):
        dt_check = now_utc - timedelta(days=day_off)
        date_str = dt_check.strftime("%Y%m%d")
        for cycle in ["18", "12", "06", "00"]:
            cycle_url = f"{base_url}/gfs.{date_str}/{cycle}/atmos/"
            idx_url = f"{cycle_url}gfs.t{cycle}z.pgrb2.0p25.f{step:03d}.idx"
            try:
                r_idx = requests.get(idx_url, timeout=6)
                if r_idx.status_code == 200:
                    lines = r_idx.text.splitlines()
                    prmsl_line = next((l for l in lines if ":PRMSL:mean sea level:" in l), None)
                    ugrd_line = next((l for l in lines if ":UGRD:10 m above ground:" in l), None)
                    vgrd_line = next((l for l in lines if ":VGRD:10 m above ground:" in l), None)
                    if not (prmsl_line and ugrd_line and vgrd_line):
                        continue

                    grib_url = f"{cycle_url}gfs.t{cycle}z.pgrb2.0p25.f{step:03d}"

                    def get_range(target_line):
                        idx = lines.index(target_line)
                        start = int(target_line.split(":")[1])
                        end = int(lines[idx + 1].split(":")[1]) - 1 if idx < len(lines) - 1 else ""
                        return start, end

                    sp, ep = get_range(prmsl_line)
                    su, eu = get_range(ugrd_line)
                    sv, ev = get_range(vgrd_line)

                    r_p = requests.get(grib_url, headers={"Range": f"bytes={sp}-{ep}"}, timeout=25)
                    r_u = requests.get(grib_url, headers={"Range": f"bytes={su}-{eu}"}, timeout=25)
                    r_v = requests.get(grib_url, headers={"Range": f"bytes={sv}-{ev}"}, timeout=25)

                    if not (r_p.status_code in (200, 206) and r_u.status_code in (200, 206) and r_v.status_code in (200, 206)):
                        continue

                    msl_raw, ni, nj = _read_grib_content(r_p.content)
                    msl_raw = msl_raw / 100.0  # Pa -> hPa
                    u_raw, _, _ = _read_grib_content(r_u.content)
                    v_raw, _, _ = _read_grib_content(r_v.content)
                    ws_raw = np.sqrt(u_raw**2 + v_raw**2) * 3.6  # m/s -> km/h

                    lons = np.linspace(0.0, 359.75, ni)
                    lats = np.linspace(90.0, -90.0, nj)
                    lons_180 = np.where(lons > 180, lons - 360, lons)
                    sort_lon = np.argsort(lons_180)
                    lons = lons_180[sort_lon]
                    msl_raw = msl_raw[:, sort_lon]
                    ws_raw = ws_raw[:, sort_lon]

                    lats = lats[::-1]
                    msl_raw = msl_raw[::-1, :]
                    ws_raw = ws_raw[::-1, :]

                    lon_mask = (lons >= extent[0] - 2.0) & (lons <= extent[1] + 2.0)
                    lat_mask = (lats >= extent[2] - 2.0) & (lats <= extent[3] + 2.0)
                    sub_lons = lons[lon_mask]
                    sub_lats = lats[lat_mask]
                    sub_msl = msl_raw[np.ix_(lat_mask, lon_mask)]
                    sub_ws = np.maximum(0, ws_raw[np.ix_(lat_mask, lon_mask)])

                    # Find Low Pressure Center inside visible extent (avoiding border edges)
                    inner_lon_mask = (sub_lons >= extent[0] + 0.5) & (sub_lons <= extent[1] - 0.5)
                    inner_lat_mask = (sub_lats >= extent[2] + 0.5) & (sub_lats <= extent[3] - 0.5)
                    low_center = None
                    if np.any(inner_lon_mask) and np.any(inner_lat_mask):
                        inner_msl = sub_msl[np.ix_(inner_lat_mask, inner_lon_mask)]
                        inner_lons = sub_lons[inner_lon_mask]
                        inner_lats = sub_lats[inner_lat_mask]
                        min_idx = np.unravel_index(np.argmin(inner_msl), inner_msl.shape)
                        low_lon = float(inner_lons[min_idx[1]])
                        low_lat = float(inner_lats[min_idx[0]])
                        min_p = float(inner_msl[min_idx])
                        if min_p < 1012.0:
                            low_center = (low_lon, low_lat, min_p)

                    init_dt = datetime.strptime(f"{date_str}{cycle}", "%Y%m%d%H").replace(tzinfo=timezone.utc)
                    valid_dt = init_dt + timedelta(hours=step)

                    print(f"  [OK] NOAA GFS ({date_str} {cycle}Z): Min MSLP {min_p:.1f} hPa at ({low_lon:.1f}E, {low_lat:.1f}N)")
                    return {
                        "lons": sub_lons,
                        "lats": sub_lats,
                        "mslp": sub_msl,
                        "wind_speed": sub_ws,
                        "precip": sub_ws,  # backward compatibility
                        "low_center": low_center,
                        "init_dt": init_dt,
                        "valid_dt": valid_dt,
                        "model_key": "GFS"
                    }
            except Exception as e:
                continue
    print(f"  [WARNING] Could not retrieve live GFS from NOMADS.")
    return None


def fetch_live_weathernext(step=240, extent=(98.0, 154.0, 2.0, 27.0)):
    """
    Retrieves real forecast fields from Google WeatherNext 3 (Zarr v3 on GCS):
    - wind_speed_10m_mean (converted from m/s to km/h)
    - mean_sea_level_pressure_mean (converted from Pa to hPa)
    Spatial resolution: 0.1° (~10 km) native global grid.
    """
    print(f"  [LIVE] Fetching Google WeatherNext 3 for step T+{step}h from GCS ...")
    try:
        from google.cloud import storage
        import gcsfs
        import numcodecs
        from weather_viz_styles import find_latest_weathernext_run

        project_id = "affable-ring-442402-j2"
        client = storage.Client(project=project_id)
        fs = gcsfs.GCSFileSystem(project=project_id, token=getattr(client, '_credentials', None))

        # Always prioritize synoptic 360-hour runs (00, 06, 12, 18 UTC)
        req_min_hours = max(step, 240) if step > 48 else 240
        latest_run, avail_hours = find_latest_weathernext_run(
            client, fs, project_id=project_id, min_hours=req_min_hours,
            var_check="mean_sea_level_pressure_mean"
        )

        target_step = min(step, avail_hours)
        base = f"weathernext3_statistics_spatial/{latest_run}predictions.zarr"
        codec = numcodecs.Zstd()

        # Load 0.1 deg coordinates
        lat = np.frombuffer(codec.decode(fs.cat_file(f'{base}/lat_0p1/c/0')), dtype='<f4')
        lon = np.frombuffer(codec.decode(fs.cat_file(f'{base}/lon_0p1/c/0')), dtype='<f4')

        # Spatial slice
        lat_mask = (lat >= extent[2] - 2.0) & (lat <= extent[3] + 2.0)
        lon_mask = (lon >= extent[0] - 2.0) & (lon <= extent[1] + 2.0)
        lat_idx = np.where(lat_mask)[0]
        lon_idx = np.where(lon_mask)[0]
        lat_slice = slice(lat_idx.min(), lat_idx.max() + 1)
        lon_slice = slice(lon_idx.min(), lon_idx.max() + 1)

        sub_lats = lat[lat_slice]
        sub_lons = lon[lon_slice]

        # Fetch requested forecast step chunks
        ws_path = f'{base}/wind_speed_10m_mean/c/{target_step}/0/0'
        mslp_path = f'{base}/mean_sea_level_pressure_mean/c/{target_step}/0/0'

        cat_dict = fs.cat([ws_path, mslp_path], on_error='raise')
        ws_raw = np.frombuffer(codec.decode(cat_dict[ws_path]), dtype='<f4').reshape((1801, 3600))[lat_slice, lon_slice]
        mslp_raw = np.frombuffer(codec.decode(cat_dict[mslp_path]), dtype='<f4').reshape((1801, 3600))[lat_slice, lon_slice]

        sub_ws = ws_raw * 3.6  # m/s -> km/h
        sub_msl = mslp_raw / 100.0  # Pa -> hPa

        # Find Low Pressure Center inside visible extent (avoiding border edges)
        inner_lon_mask = (sub_lons >= extent[0] + 0.5) & (sub_lons <= extent[1] - 0.5)
        inner_lat_mask = (sub_lats >= extent[2] + 0.5) & (sub_lats <= extent[3] - 0.5)
        low_center = None
        if np.any(inner_lon_mask) and np.any(inner_lat_mask):
            inner_msl = sub_msl[np.ix_(inner_lat_mask, inner_lon_mask)]
            inner_lons = sub_lons[inner_lon_mask]
            inner_lats = sub_lats[inner_lat_mask]
            min_idx = np.unravel_index(np.argmin(inner_msl), inner_msl.shape)
            low_lon = float(inner_lons[min_idx[1]])
            low_lat = float(inner_lats[min_idx[0]])
            min_p = float(inner_msl[min_idx])
            if min_p < 1012.0:
                low_center = (low_lon, low_lat, min_p)

        # Parse initialization timestamp from folder name (e.g. 20260917_00hr_01_preds)
        folder_clean = latest_run.strip('/').split('/')[-1]
        try:
            date_part = folder_clean.split('_')[0]
            hour_part = folder_clean.split('_')[1].replace('hr', '')
            init_dt = datetime.strptime(f"{date_part}{hour_part}", "%Y%m%d%H").replace(tzinfo=timezone.utc)
        except Exception:
            init_dt = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

        valid_dt = init_dt + timedelta(hours=target_step)
        if low_center is not None:
            print(f"  [OK] Google WeatherNext 3 ({init_dt.strftime('%Y%m%d %HZ')}): Min MSLP {min_p:.1f} hPa at ({low_lon:.1f}E, {low_lat:.1f}N)")
        else:
            print(f"  [OK] Google WeatherNext 3 ({init_dt.strftime('%Y%m%d %HZ')}): loaded for step T+{target_step}h")

        return {
            "lons": sub_lons,
            "lats": sub_lats,
            "mslp": sub_msl,
            "wind_speed": sub_ws,
            "precip": sub_ws,
            "low_center": low_center,
            "init_dt": init_dt,
            "valid_dt": valid_dt,
            "model_key": "WEATHERNEXT"
        }
    except Exception as e:
        print(f"  [ERROR] Live fetch error for WeatherNext 3: {e}")
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Signature Broadcast Graphics Rendering Elements
# ═══════════════════════════════════════════════════════════════════════════════

def draw_cyclonic_arrow_low_badge(ax, lon, lat, min_mslp=None, radius_deg=1.15):
    """
    Draws the signature TV broadcast Low Pressure (L) center badge:
    - Bold white letter 'L' in the center with red drop stroke
    - Optional min pressure label badge underneath
    """
    r_deg = radius_deg

    # White 'L' in center
    ax.text(
        lon, lat, "L",
        fontsize=16, fontweight="heavy", color="#ffffff",
        ha="center", va="center", zorder=28,
        transform=ccrs.PlateCarree(),
        path_effects=[patheffects.withStroke(linewidth=2.0, foreground="#991b1b")]
    )

    # Optional: Min pressure label badge underneath
    if min_mslp is not None and min_mslp < 1010:
        val_str = f"{int(round(min_mslp))} hPa"
        ax.text(
            lon, lat - r_deg * 1.55, val_str,
            fontsize=8.5, fontweight="bold", color="#ffffff",
            ha="center", va="center", zorder=29,
            transform=ccrs.PlateCarree(),
            bbox=dict(boxstyle="round,pad=0.2", facecolor="#0f172a", edgecolor="#dc2626", alpha=0.88, lw=0.9)
        )


def draw_broadcast_top_header(
    fig, brand=None, title="LONG RANGE MODEL COMPARISON",
    target_day="SUNDAY", valid_str="", mode="4panel", model_name=None
):
    """
    Renders the high-end television broadcast header bar at the top of the canvas:
    - Left brand pill: Official Philippine Typhoon/Weather logo & typography
    - Clean white drop-shadow header card: 'LONG RANGE MODEL COMPARISON'
    - Subtitle pill: Day of the week / Valid time (e.g., 'SUNDAY' or 'SUN 9 PM')
    """
    # 1. Top dark glass header background bar
    bar_bg = FancyBboxPatch(
        (0.02, 0.902), 0.96, 0.088,
        boxstyle="round,pad=0.005,rounding_size=0.012",
        transform=fig.transFigure,
        facecolor="#081423", edgecolor="#1e3a5f",
        alpha=0.94, lw=1.2, zorder=50
    )
    fig.patches.append(bar_bg)

    # 2. Station / Network Brand Badge (Official Philippine Typhoon/Weather Branding)
    brand_pill = FancyBboxPatch(
        (0.026, 0.908), 0.225, 0.076,
        boxstyle="round,pad=0.006,rounding_size=0.010",
        transform=fig.transFigure,
        facecolor="#0f2744", edgecolor="#38bdf8",
        lw=1.5, zorder=52
    )
    fig.patches.append(brand_pill)

    # Embed official circular logo if available
    logo_path = os.path.join(IMAGES_DIR, "logo.png")
    has_logo = False
    if os.path.exists(logo_path):
        try:
            logo_img = mpimg.imread(logo_path)
            ax_logo = fig.add_axes([0.030, 0.912, 0.045, 0.068], zorder=55)
            ax_logo.imshow(logo_img)
            ax_logo.axis("off")
            has_logo = True
        except Exception:
            has_logo = False

    if has_logo:
        # Dual-line brand text next to the official circular logo
        fig.text(
            0.080, 0.954, "PHILIPPINE",
            fontsize=12.5, fontweight="heavy",
            color="#ffffff", ha="left", va="center",
            zorder=56,
            path_effects=[patheffects.withStroke(linewidth=2.0, foreground="#031633")]
        )
        fig.text(
            0.080, 0.932, "TYPHOON / WEATHER",
            fontsize=9.0, fontweight="heavy",
            color="#38bdf8", ha="left", va="center",
            zorder=56
        )
    else:
        # Fallback text if logo file is missing
        brand_name = brand if brand else "PHILIPPINE WEATHER"
        fig.text(
            0.138, 0.945, brand_name,
            fontsize=13.5, fontweight="heavy",
            color="#ffffff", ha="center", va="center",
            zorder=56,
            path_effects=[patheffects.withStroke(linewidth=2.0, foreground="#031633")]
        )

    # 3. Main Header Card (Sleek Dark Glass UI Card matching station branding)
    title_card = FancyBboxPatch(
        (0.260, 0.908), 0.465, 0.076,
        boxstyle="round,pad=0.006,rounding_size=0.010",
        transform=fig.transFigure,
        facecolor="#0f2238", edgecolor="#0284c7",
        lw=1.5, alpha=0.95, zorder=52
    )
    fig.patches.append(title_card)

    # Main Title Text (Crisp White with drop shadow stroke)
    fig.text(
        0.275, 0.954, title,
        fontsize=16.5, fontweight="heavy",
        color="#ffffff", ha="left", va="center",
        zorder=53,
        path_effects=[patheffects.withStroke(linewidth=2.0, foreground="#031633")]
    )

    # Subtitle / Day Pill below the title (Vivid Cyan)
    fig.text(
        0.277, 0.926, target_day.upper(),
        fontsize=11.5, fontweight="bold",
        color="#38bdf8", ha="left", va="center",
        zorder=53
    )

    # 4. Right side: Multi-Model AI & NWP Badge
    badge_pill = FancyBboxPatch(
        (0.735, 0.908), 0.235, 0.076,
        boxstyle="round,pad=0.006,rounding_size=0.008",
        transform=fig.transFigure,
        facecolor="#0b172a", edgecolor="#0284c7",
        lw=1.0, zorder=52
    )
    fig.patches.append(badge_pill)

    if mode == "1panel":
        badge_header = f"{model_name} MODEL FORECAST" if model_name else "OPERATIONAL FORECAST"
    else:
        badge_header = "MULTI-MODEL COMPARISON"

    fig.text(
        0.852, 0.952, badge_header,
        fontsize=10.5, fontweight="heavy",
        color="#38bdf8", ha="center", va="center",
        zorder=53
    )
    fig.text(
        0.852, 0.930, "MSLP ISOBARS + 10M WIND SPEED",
        fontsize=8.5, fontweight="bold",
        color="#94a3b8", ha="center", va="center",
        zorder=53
    )


def compute_balanced_extent(domain_cfg, map_w, map_h, fig_w=16.0, fig_h=9.0):
    """
    Computes map coordinate bounds that match the exact physical aspect ratio of the card
    in figure space, ensuring Cartopy fills 100% of the card with aspect='equal' (ZERO DISTORTION).
    """
    if not domain_cfg.get("is_ph"):
        return domain_cfg["extent"]

    # Physical aspect ratio of the map window in inches
    w_in = map_w * fig_w
    h_in = map_h * fig_h
    axis_ar = w_in / max(h_in, 0.001)

    c_lon, c_lat = 127.5, 16.0

    if axis_ar >= 1.0:
        # Landscape map box (e.g. 4-panel or 2-panel)
        # Covers the Philippine Archipelago, Philippine Sea & Western Pacific tropical systems (lat 3.0°N to 29.0°N)
        lat_span = 26.0
        lon_span = lat_span * axis_ar
    else:
        # Portrait map box (e.g. 3-panel horizontal)
        # Covers full width from South China Sea across the Philippines to the Western Pacific
        lon_span = 31.0
        lat_span = lon_span / axis_ar

    return [
        float(c_lon - lon_span / 2.0),
        float(c_lon + lon_span / 2.0),
        float(c_lat - lat_span / 2.0),
        float(c_lat + lat_span / 2.0)
    ]


def draw_panel_weather_map(ax, model_data, extent, domain_cfg, provinces_geom=None):
    """
    Renders the synoptic weather map inside each panel:
    - Base map (dark ocean, slate terrain, crisp coastlines)
    - 10m Surface Wind Speed contours (km/h)
    - Smooth MSLP isobars with white stroke & labels
    - Low pressure (L) center badge with cyclonic rotation arrows
    """
    lons = model_data["lons"]
    lats = model_data["lats"]
    mslp = model_data["mslp"]
    wind_speed = model_data.get("wind_speed", model_data.get("precip"))
    low_center = model_data.get("low_center")

    LONS, LATS = np.meshgrid(lons, lats) if lons.ndim == 1 else (lons, lats)

    ax.set_extent(extent, crs=ccrs.PlateCarree())

    # 1. Base Geography
    ax.set_facecolor("#142131")
    ax.add_feature(cfeature.OCEAN, facecolor="#142131", zorder=0)
    ax.add_feature(cfeature.LAND, facecolor="#223241", zorder=1)

    # 2. 10m Surface Wind Speed Contours (km/h)
    if wind_speed is not None:
        ax.contourf(
            LONS, LATS, wind_speed,
            levels=WIND_SPEED_LEVELS,
            cmap=WIND_SPEED_CMAP,
            norm=WIND_SPEED_NORM,
            extend="max",
            alpha=0.88,
            transform=ccrs.PlateCarree(),
            zorder=2
        )

    # 3. Country & Landmass Visibility (Overlay above wind field)
    # Distinct slate landmass fill so the country silhouette (Philippines, Taiwan, Vietnam, China)
    # is instantly recognizable against the dark ocean, while still showing wind colors over land
    ax.add_feature(cfeature.LAND, facecolor="#2c3e50", alpha=0.52, zorder=3)
    ax.add_feature(cfeature.COASTLINE, linewidth=1.3, edgecolor="#f8fafc", zorder=4)
    ax.add_feature(cfeature.BORDERS, linestyle="-", linewidth=0.75, edgecolor="#94a3b8", alpha=0.85, zorder=4)

    # Overlay Philippine province boundaries if in PH domain
    if domain_cfg.get("is_ph") and provinces_geom:
        ax.add_geometries(
            provinces_geom, crs=ccrs.PlateCarree(),
            facecolor="none", edgecolor="#cbd5e1",
            linewidth=0.55, alpha=0.85, zorder=4
        )
        # PAR boundary line
        ax.plot(
            PAR_LONS, PAR_LATS,
            transform=ccrs.PlateCarree(),
            color="#ef4444", linestyle="-", linewidth=1.4, alpha=0.90, zorder=5
        )

    # 3. MSLP Isobars (smooth white contours)
    if mslp is not None:
        mslp_smooth = scipy.ndimage.gaussian_filter(mslp, sigma=1.2)
        min_p = int(np.floor(np.nanmin(mslp_smooth) / 4.0) * 4)
        max_p = int(np.ceil(np.nanmax(mslp_smooth) / 4.0) * 4)
        levels = np.arange(min_p, max_p + 4, 4)

        cs = ax.contour(
            LONS, LATS, mslp_smooth,
            levels=levels,
            colors="#ffffff",
            linewidths=1.2,
            alpha=0.95,
            transform=ccrs.PlateCarree(),
            zorder=6
        )
        try:
            cs.set_path_effects([patheffects.withStroke(linewidth=2.4, foreground="#09111e", alpha=0.85)])
        except Exception:
            pass
        # White labels with dark stroke for ultra-clear visibility
        labels = ax.clabel(
            cs, inline=True, fontsize=8.0, fmt="%d",
            colors="#ffffff", zorder=7
        )
        for lbl in labels:
            lbl.set_path_effects([patheffects.withStroke(linewidth=2.2, foreground="#09111e")])

    # 4. Low Pressure Center (L) Badge with rotating arrows
    if low_center is not None:
        low_lon, low_lat, min_val = low_center
        draw_cyclonic_arrow_low_badge(ax, low_lon, low_lat, min_mslp=min_val, radius_deg=1.15)


def draw_broadcast_wind_legend(fig):
    """
    Renders the Pivotal Weather / TV broadcast 10m wind speed colorbar pill at the bottom of the canvas.
    Calibrated in km/h with 41 discrete color blocks matching official meteorological palettes.
    """
    from matplotlib.colorbar import ColorbarBase

    # Bottom dark glass container pill
    pill_w = 0.880
    pill_h = 0.040
    pill_x = (1.0 - pill_w) / 2.0
    pill_y = 0.006
    pill = FancyBboxPatch(
        (pill_x, pill_y), pill_w, pill_h,
        boxstyle="round,pad=0.003,rounding_size=0.006",
        transform=fig.transFigure,
        facecolor="#071322", edgecolor="#0284c7",
        lw=1.1, alpha=0.94, zorder=50
    )
    fig.patches.append(pill)

    # Left text label
    fig.text(
        pill_x + 0.012, pill_y + pill_h * 0.68,
        "10M SURFACE WIND",
        fontsize=8.5, fontweight="heavy",
        color="#38bdf8", ha="left", va="center",
        zorder=52
    )
    fig.text(
        pill_x + 0.012, pill_y + pill_h * 0.28,
        "SPEED (km/h)",
        fontsize=6.8, fontweight="bold",
        color="#94a3b8", ha="left", va="center",
        zorder=52
    )

    # Colorbar axis
    cbar_w = 0.730
    cbar_h = 0.012
    cbar_x = pill_x + 0.125
    cbar_y = pill_y + (pill_h - cbar_h) / 2.0 - 0.003
    cbar_ax = fig.add_axes([cbar_x, cbar_y, cbar_w, cbar_h], zorder=52)

    cbar = ColorbarBase(
        cbar_ax,
        cmap=WIND_SPEED_CMAP,
        norm=WIND_SPEED_NORM,
        orientation="horizontal",
        spacing="uniform",
        extend="neither"
    )
    cbar.set_ticks(WIND_SPEED_LEVELS)
    cbar.ax.set_xticklabels(
        [str(x) for x in WIND_SPEED_LEVELS],
        fontsize=5.5, color="#ffffff", fontweight="bold"
    )
    cbar.ax.xaxis.set_ticks_position("top")
    cbar.ax.tick_params(size=2.5, color="#ffffff", pad=1.2, labelsize=5.5)
    for spine in cbar.ax.spines.values():
        spine.set_edgecolor("#000000")
        spine.set_linewidth(1.0)


def draw_panel_frame_and_labels(fig, rect, model_key, timestamp_str="9 PM SUN JAN 25", sub_badge_override=None):
    """
    Renders the broadcast TV glass card framing, timestamp pill, and bottom model banner.
    rect: [left, bottom, width, height] in figure coordinates.
    """
    norm_key = model_key.upper().strip()
    meta = MODEL_META.get(norm_key, MODEL_META["GFS"])
    x, y, w, h = rect

    # 1. Outer Glass Card Border Glow
    outer_border = FancyBboxPatch(
        (x - 0.003, y - 0.003), w + 0.006, h + 0.006,
        boxstyle="round,pad=0.002,rounding_size=0.008",
        transform=fig.transFigure,
        facecolor="none", edgecolor="#0284c7",
        lw=2.0, alpha=0.90, zorder=35
    )
    fig.patches.append(outer_border)

    # 2. Bottom-left Timestamp Pill (Dark Glass with Cyan Glow)
    time_pill_w = min(0.185, w * 0.48)
    time_pill_h = min(0.038, h * 0.10)
    time_pill = FancyBboxPatch(
        (x + 0.008, y + 0.056), time_pill_w, time_pill_h,
        boxstyle="round,pad=0.002,rounding_size=0.004",
        transform=fig.transFigure,
        facecolor="#081526", edgecolor="#38bdf8",
        lw=1.1, alpha=0.92, zorder=36
    )
    fig.patches.append(time_pill)

    fig.text(
        x + 0.008 + time_pill_w / 2.0, y + 0.056 + time_pill_h / 2.0,
        timestamp_str.upper(),
        fontsize=9.0 if w < 0.35 else (10.5 if w > 0.60 else 10.0), fontweight="heavy",
        color="#ffffff", ha="center", va="center",
        zorder=37,
        path_effects=[patheffects.withStroke(linewidth=1.5, foreground="#020914")]
    )

    # 3. Bottom Model Banner across the bottom of each map card
    banner_h = min(0.050, h * 0.13)
    banner_bg = FancyBboxPatch(
        (x, y), w, banner_h,
        boxstyle="square,pad=0.0",
        transform=fig.transFigure,
        facecolor="#0c2d57", edgecolor="#1d4ed8",
        lw=1.2, zorder=36
    )
    fig.patches.append(banner_bg)

    # Main Model Title Text (e.g. AMERICAN GFS FORECAST, AMERICAN AI-GFS FORECAST, etc.)
    fig.text(
        x + w / 2.0, y + banner_h * 0.60,
        meta["banner_text"],
        fontsize=11.5 if w < 0.35 else (14.5 if w > 0.60 else 13.0), fontweight="heavy",
        color="#ffffff", ha="center", va="center",
        zorder=38,
        path_effects=[patheffects.withStroke(linewidth=2.0, foreground="#031633")]
    )

    # Sub-badge indicating exact model, resolution, and run cycle
    badge_label = sub_badge_override if sub_badge_override else meta["sub_badge"]
    fig.text(
        x + w / 2.0, y + banner_h * 0.22,
        badge_label,
        fontsize=7.5 if w < 0.35 else (9.5 if w > 0.60 else 8.5), fontweight="bold",
        color=meta["color"], ha="center", va="center",
        zorder=38
    )


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Master Comparison Layouts: 4-Panel Quad, 3-Panel Row, 2-Panel Side-by-Side
# ═══════════════════════════════════════════════════════════════════════════════

def render_comparison_broadcast(
    mode="4panel",
    selected_models=("GFS", "AIGFS", "ECMWF", "AIFS"),
    region="ph",
    brand=None,
    title=None,
    target_day=None,
    timestamp_str=None,
    lead_time_hours=240,
    output_filepath="public/images/model_comparison_broadcast.png",
    use_demo=False
):
    """
    Main entry point for generating the television broadcast graphic.
    Supports:
    - 4-Panel Quad Grid (2x2): Compares GFS, AIGFS, ECMWF, AIFS simultaneously
    - 3-Panel Side-by-Side (1x3): 3-model comparison
    - 2-Panel Side-by-Side (1x2): 2-model comparison
    - 1-Panel Single Model (1x1): Full widescreen broadcast view
    """
    models_list = [selected_models] if isinstance(selected_models, str) else list(selected_models)
    if not models_list:
        models_list = ["GFS"]

    # Dynamic title: > 168h (7+ days) -> LONG RANGE, <= 168h (<= 7 days) -> MEDIUM RANGE
    if not title or title in ("LONG RANGE MODEL COMPARISON", "MEDIUM RANGE MODEL COMPARISON"):
        if mode == "1panel":
            primary_name = models_list[0].upper().strip()
            title = f"LONG RANGE {primary_name} FORECAST" if lead_time_hours > 168 else f"MEDIUM RANGE {primary_name} FORECAST"
        else:
            title = "LONG RANGE MODEL COMPARISON" if lead_time_hours > 168 else "MEDIUM RANGE MODEL COMPARISON"

    print(f"\n========================================================")
    print(f" Generating Broadcast Model Comparison: {mode.upper()}")
    print(f" Models: {', '.join(models_list)}")
    print(f" Mode: {'SYNTHETIC DEMO' if use_demo else 'LIVE NWP / AI DATA'}")
    print(f" Region: {region.upper()} | Lead Time: T+{lead_time_hours}h")
    print(f" Output: {output_filepath}")
    print(f"========================================================\n")

    domain_cfg = DOMAINS.get(region, DOMAINS["ph"])
    valid_dt = datetime.now(timezone.utc) + timedelta(hours=lead_time_hours)
    valid_pht = valid_dt.astimezone(timezone(timedelta(hours=8)))

    # Compute default target_day if not specified (no T+240 indicator)
    if not target_day:
        day_name = valid_pht.strftime("%A").upper()
        days_out = lead_time_hours // 24
        if days_out >= 4:
            target_day = f"{day_name} · {days_out}-DAY OUTLOOK"
        else:
            target_day = day_name

    # Compute default timestamp string if not specified
    if not timestamp_str:
        timestamp_str = valid_pht.strftime("%I %p %a %b %d").lstrip("0").upper()

    # Load Philippine provinces if relevant
    provinces_geom = []
    if domain_cfg.get("is_ph"):
        try:
            provinces_geom = load_ph_provinces(DATA_DIR)
        except Exception:
            provinces_geom = []

    # 1. Create Figure with 16:9 Television Broadcast Aspect Ratio (1920x1080 Full HD)
    fig = plt.figure(figsize=(16, 9), dpi=120, facecolor=BG_DARK, edgecolor=BG_DARK)
    fig.patch.set_facecolor(BG_DARK)
    fig.patch.set_edgecolor(BG_DARK)

    # 2. Render Rainy Window Studio Background (Exact 30% Opacity)
    bg_image_path = os.path.join(IMAGES_DIR, "broadcast_rain_bg.jpg")
    if os.path.exists(bg_image_path):
        try:
            bg_img = mpimg.imread(bg_image_path)
            ax_bg = fig.add_axes([0, 0, 1, 1], zorder=0)
            ax_bg.imshow(bg_img, aspect="auto", alpha=0.30)
            ax_bg.axis("off")
        except Exception as e:
            print(f"Notice: Failed to load background image ({e}), applying dark studio backdrop.")
            fig.patch.set_facecolor(BG_DARK)
    else:
        fig.patch.set_facecolor(BG_DARK)

    # 3. Draw Broadcast Top Header Bar
    first_model = models_list[0].upper().strip() if models_list else "GFS"
    draw_broadcast_top_header(
        fig, brand=brand, title=title, target_day=target_day,
        valid_str=timestamp_str, mode=mode, model_name=first_model
    )

    # 4. Prepare Models & Layout Coordinates
    if mode == "1panel":
        # 1-Panel Single Model Full Broadcast Card (1x1 widescreen)
        models_to_render = models_list[:1]
        panel_rects = [
            [0.038, 0.055, 0.924, 0.815],
        ]
    elif mode == "2panel":
        # 2-Panel Side-by-Side (1x2)
        models_to_render = models_list[:2]
        if len(models_to_render) < 2:
            models_to_render = ["GFS", "ECMWF"]

        panel_rects = [
            [0.038, 0.055, 0.448, 0.815],  # Left panel
            [0.514, 0.055, 0.448, 0.815],  # Right panel
        ]
    elif mode == "3panel":
        # 3-Panel Side-by-Side (1x3)
        models_to_render = models_list[:3]
        if len(models_to_render) < 3:
            models_to_render = ["GFS", "AIGFS", "ECMWF"]

        panel_rects = [
            [0.032, 0.055, 0.298, 0.815],  # Left panel
            [0.351, 0.055, 0.298, 0.815],  # Center panel
            [0.670, 0.055, 0.298, 0.815],  # Right panel
        ]
    else:
        # Default: 4-Panel Quad Grid (2x2) comparing GFS, AIGFS, ECMWF, AIFS
        models_to_render = list(selected_models)[:4]
        # Ensure 4 models are populated
        defaults = ["GFS", "AIGFS", "ECMWF", "AIFS"]
        for d in defaults:
            if len(models_to_render) < 4 and d not in models_to_render:
                models_to_render.append(d)

        panel_rects = [
            [0.038, 0.485, 0.448, 0.395],  # Top-Left (GFS)
            [0.514, 0.485, 0.448, 0.395],  # Top-Right (AIGFS)
            [0.038, 0.055, 0.448, 0.395],  # Bottom-Left (ECMWF)
            [0.514, 0.055, 0.448, 0.395],  # Bottom-Right (AIFS)
        ]

    # 5. Render Each Model Panel
    for i, model_key in enumerate(models_to_render):
        rect = panel_rects[i]
        norm_key = model_key.upper().strip()
        print(f"Rendering Panel {i + 1}: {norm_key} ...")

        # Map axis inside the panel frame (leaving space for bottom banner)
        banner_h = min(0.050, rect[3] * 0.13)
        map_rect = [rect[0], rect[1] + banner_h, rect[2], rect[3] - banner_h]

        # Compute balanced extent for this exact map box to eliminate distortion
        extent = compute_balanced_extent(domain_cfg, map_rect[2], map_rect[3])

        # Card backing patch
        card_back = patches.Rectangle(
            (rect[0], rect[1]), rect[2], rect[3],
            transform=fig.transFigure, facecolor="#142131", edgecolor="none", zorder=7
        )
        fig.patches.append(card_back)

        # Fetch / generate model data
        model_data = None
        if not use_demo:
            try:
                if norm_key == "ECMWF":
                    model_data = fetch_live_ecmwf(model_type="ifs", step=lead_time_hours, extent=extent)
                elif norm_key == "AIFS":
                    model_data = fetch_live_ecmwf(model_type="aifs-single", step=lead_time_hours, extent=extent)
                elif norm_key == "GFS":
                    model_data = fetch_live_gfs(step=lead_time_hours, extent=extent)
                elif norm_key in ["AIGFS", "AIGEFS"]:
                    model_data = fetch_live_aigfs(step=lead_time_hours, extent=extent)
                elif norm_key in ["WEATHERNEXT", "WEATHERNEXT3", "WN3"]:
                    model_data = fetch_live_weathernext(step=lead_time_hours, extent=extent)
            except Exception as ex:
                print(f"  [ERROR] Live fetch error for {norm_key}: {ex}")
                model_data = None

        # Fallback / Demo simulation mode
        if model_data is None:
            if not use_demo:
                print(f"  [FALLBACK] Using simulation data for {norm_key}")
            model_data = generate_demo_model_data(norm_key, extent, valid_dt)

        ax_map = fig.add_axes(map_rect, projection=ccrs.PlateCarree(), zorder=10)

        draw_panel_weather_map(
            ax_map, model_data, extent, domain_cfg, provinces_geom=provinces_geom
        )

        # Determine panel-specific timestamp and sub-badge
        panel_time_str = timestamp_str
        if model_data.get("valid_dt"):
            v_dt = model_data["valid_dt"]
            v_pht = v_dt.astimezone(timezone(timedelta(hours=8))) if v_dt.tzinfo else (v_dt + timedelta(hours=8))
            panel_time_str = v_pht.strftime("%I %p %a %b %d").lstrip("0").upper()

        base_meta = MODEL_META.get(norm_key, MODEL_META["GFS"])
        sub_badge = base_meta["sub_badge"]

        # Draw frame border, timestamp badge & bottom banner
        draw_panel_frame_and_labels(
            fig, rect, norm_key, timestamp_str=panel_time_str, sub_badge_override=sub_badge
        )

    # 6. Render 10m Wind Speed Broadcast Colorbar Legend
    draw_broadcast_wind_legend(fig)

    # 7. Save High-Resolution Broadcast Graphic
    os.makedirs(os.path.dirname(output_filepath) or ".", exist_ok=True)
    plt.savefig(
        output_filepath,
        dpi=120,
        facecolor=BG_DARK,
        edgecolor=BG_DARK,
        pad_inches=0
    )
    plt.close(fig)
    print(f"\n[SUCCESS] Broadcast model comparison saved to: {output_filepath}\n")
    return output_filepath


# ═══════════════════════════════════════════════════════════════════════════════
# 5. CLI Execution & Argument Parsing
# ═══════════════════════════════════════════════════════════════════════════════

def parse_arguments():
    parser = argparse.ArgumentParser(
        description="Television Broadcast Weather Model Comparison (GFS, AIGFS/AIGEFS, ECMWF, AIFS, WEATHERNEXT 3)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )
    model_choices = [
        "GFS", "gfs",
        "AIGFS", "aigfs",
        "AIGEFS", "aigefs",
        "ECMWF", "ecmwf",
        "AIFS", "aifs",
        "WEATHERNEXT", "weathernext",
        "WEATHERNEXT3", "weathernext3",
        "WN3", "wn3"
    ]
    parser.add_argument(
        "--mode", choices=["4panel", "3panel", "2panel", "1panel"], default="4panel",
        help="Comparison layout: '4panel' (2x2 grid), '3panel' (1x3 row), '2panel' (1x2 row), or '1panel' (single model view)"
    )
    parser.add_argument(
        "--models", nargs="+", default=["GFS", "AIGFS", "ECMWF", "AIFS"],
        choices=model_choices,
        help="Models to compare (e.g. GFS AIGFS ECMWF AIFS WEATHERNEXT3)"
    )
    parser.add_argument(
        "--model", dest="single_model", choices=model_choices, default=None,
        help="Single model to display when using 1panel mode (e.g. --model WEATHERNEXT3)"
    )
    parser.add_argument(
        "--region", choices=["ph", "wnp", "conus"], default="ph",
        help="Geographic region domain ('ph' for Philippine PAR, 'wnp' for Western Pacific, 'conus' for US East)"
    )
    parser.add_argument(
        "--brand", default=None,
        help="Station / weather network brand logo text override"
    )
    parser.add_argument(
        "--title", default=None,
        help="Top broadcast title header (defaults to 'LONG RANGE' for >168h, 'MEDIUM RANGE' for <=168h)"
    )
    parser.add_argument(
        "--day", default=None,
        help="Target forecast day text (e.g. 'SUNDAY · 10-DAY OUTLOOK'). If not specified, calculated automatically."
    )
    parser.add_argument(
        "--time-label", default=None,
        help="Timestamp pill label text (e.g. '2 PM SUN SEP 20'). If not specified, calculated automatically."
    )
    parser.add_argument(
        "--lead-time", type=int, default=240,
        help="Forecast lead time in hours (e.g. 24, 72, 120, 240)"
    )
    parser.add_argument(
        "--output", default="public/images/model_comparison_broadcast.png",
        help="Output image path"
    )
    parser.add_argument(
        "--live", dest="demo", action="store_false", default=True,
        help="Retrieve actual live data from NOAA NOMADS, ECMWF OpenData, and Google Cloud Storage"
    )
    parser.add_argument(
        "--demo", dest="demo", action="store_true",
        help="Run in realistic synoptic simulation demo mode"
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_arguments()

    raw_selected = [args.single_model] if args.single_model else args.models
    selected = []
    for m in raw_selected:
        k = m.upper().replace(" ", "").replace("-", "")
        if k in ("WEATHERNEXT3", "WN3"):
            k = "WEATHERNEXT"
        selected.append(k)

    render_comparison_broadcast(
        mode=args.mode,
        selected_models=selected,
        region=args.region,
        brand=args.brand,
        title=args.title,
        target_day=args.day,
        timestamp_str=args.time_label,
        lead_time_hours=args.lead_time,
        output_filepath=args.output,
        use_demo=args.demo
    )
