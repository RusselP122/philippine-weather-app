"""
process_ibtracs.py
==================
Processes NOAA IBTrACS Western Pacific tropical cyclone best-track dataset:
1. Calculates historical climatological statistics (1960-2025) and Poisson probability ranges.
2. Exports monthly track data to JSON for web application consumption.
3. Generates broadcast/agency-grade Tropical Cyclone Outlook infographic maps:
   - Unified grid system with consistent margins (top/left/right aligned).
   - Spaghetti background rendered as subtle, elegant data texture (low opacity/desaturated).
   - 3 sleek, refined, non-intrusive climatological trajectory flow arrows.
   - High-contrast typography with protected city labels and clean spatial hierarchy.
   - Left forecast card moved down for optimal layout spacing and breathing room.
   - Glassmorphic UI cards with ambient backdrops and user logo branding.
"""

import os
import sys
import json
import argparse
import warnings
import numpy as np
import pandas as pd
import geopandas as gpd
from PIL import Image
from scipy.stats import poisson
import scipy.interpolate

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.patches import FancyBboxPatch, Polygon as MplPolygon, FancyArrowPatch
from matplotlib.collections import LineCollection
import matplotlib.patheffects as patheffects
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import shapely
from shapely.geometry import Point, Polygon

warnings.filterwarnings('ignore')

# ── File Paths ──────────────────────────────────────────────────────────────
WORKSPACE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_CSV_PATHS = [
    os.path.join(WORKSPACE_ROOT, "ibtracs.WP.list.v04r01.csv"),
    r"C:\Users\Russel\Downloads\ibtracs.WP.list.v04r01.csv",
    r"c:\Users\Russel\Desktop\philippine-weather-app\ibtracs.WP.list.v04r01.csv",
    os.path.join(os.getcwd(), "ibtracs.WP.list.v04r01.csv"),
]
DEFAULT_JSON_OUTPUT = os.path.join(WORKSPACE_ROOT, "public", "data", "historical_tracks.json")
DEFAULT_IMG_OUTPUT = os.path.join(WORKSPACE_ROOT, "public", "images", "tropical_cyclone_outlook_october_2026.png")
GEOJSON_PATH = os.path.join(WORKSPACE_ROOT, "public", "data", "ph_provinces.json")
USER_LOGO_PATHS = [
    os.path.join(WORKSPACE_ROOT, "public", "images", "logo.png"),
    os.path.join(WORKSPACE_ROOT, "public", "logo512.png"),
    os.path.join(WORKSPACE_ROOT, "public", "logo192.png"),
    os.path.join(WORKSPACE_ROOT, "public", "favicon.ico")
]

# ── PAR Coordinates ─────────────────────────────────────────────────────────
PAR_COORDS = [
    (115.0, 5.0),
    (135.0, 5.0),
    (135.0, 25.0),
    (120.0, 25.0),
    (120.0, 21.0),
    (115.0, 15.0),
    (115.0, 5.0)
]
par_polygon = Polygon(PAR_COORDS)

MONTH_NAMES = {
    1: "JANUARY", 2: "FEBRUARY", 3: "MARCH", 4: "APRIL",
    5: "MAY", 6: "JUNE", 7: "JULY", 8: "AUGUST",
    9: "SEPTEMBER", 10: "OCTOBER", 11: "NOVEMBER", 12: "DECEMBER"
}

MONTH_NAMES_TL = {
    1: "ENERO", 2: "PEBRERO", 3: "MARSO", 4: "ABRIL",
    5: "MAYO", 6: "HUNYO", 7: "HULYO", 8: "AGOSTO",
    9: "SETYEMBRE", 10: "OKTUBRE", 11: "NOBYEMBRE", 12: "DISYEMBRE"
}

# ── PAGASA Intensity Scale (Subtle, desaturated background texture) ─────────
PAGASA_COLORS = {
    'TD':  {'color': '#38bdf8', 'label': 'Tropical Depression',       'speed': '≤ 61 km/h',    'min_w': 0,   'max_w': 34,   'lw': 0.65, 'alpha': 0.13, 'zorder': 3},
    'TS':  {'color': '#facc15', 'label': 'Tropical Storm',            'speed': '62–88 km/h',   'min_w': 34,  'max_w': 48,   'lw': 0.75, 'alpha': 0.16, 'zorder': 4},
    'STS': {'color': '#fb923c', 'label': 'Severe Tropical Storm',     'speed': '89–117 km/h',  'min_w': 48,  'max_w': 64,   'lw': 0.90, 'alpha': 0.19, 'zorder': 5},
    'TY':  {'color': '#ef4444', 'label': 'Typhoon',                   'speed': '118–184 km/h', 'min_w': 64,  'max_w': 100,  'lw': 1.05, 'alpha': 0.22, 'zorder': 6},
    'STY': {'color': '#c084fc', 'label': 'Super Typhoon',             'speed': '≥ 185 km/h',   'min_w': 100, 'max_w': 9999, 'lw': 1.30, 'alpha': 0.25, 'zorder': 7},
}

# ── 3 Distinct Climatological Tracks for September ───────────────────────────
CLIM_TRACKS_SEPTEMBER = [
    {
        'pts': np.array([[134.5, 13.5], [132.5, 15.8], [130.5, 18.0], [128.8, 20.0], [127.5, 21.6]]),
        'start_w': 0.18, 'end_w': 0.26, 'head_len': 1.05, 'head_w': 0.75, 'num': None
    },
    {
        'pts': np.array([[134.0, 12.8], [129.5, 14.8], [125.0, 16.8], [121.5, 18.2], [118.5, 18.8]]),
        'start_w': 0.20, 'end_w': 0.28, 'head_len': 1.15, 'head_w': 0.82, 'num': None
    },
    {
        'pts': np.array([[133.5, 8.5], [128.5, 10.5], [124.5, 12.5], [121.5, 14.0], [118.5, 14.6]]),
        'start_w': 0.20, 'end_w': 0.28, 'head_len': 1.15, 'head_w': 0.82, 'num': None
    }
]

# ── October Climatological Trajectories (Matching PAGASA Climatology Chart) ──
# ── October Climatological Trajectories (Matching PAGASA Climatology Chart) ──
CLIM_TRACKS_OCTOBER = [
    # Track 1 - Branch A: Outer Pacific Recurver (Part of Track ①)
    {
        'pts': np.array([
            [135.3, 18.4],
            [133.5, 18.4],
            [131.8, 18.6],
            [130.6, 19.4],
            [130.4, 20.8],
            [131.2, 22.4],
            [132.5, 23.8],
            [133.8, 24.8],
            [134.8, 25.6]
        ]),
        'start_w': 0.18, 'end_w': 0.26, 'head_len': 0.95, 'head_w': 0.72, 'num': None
    },
    # Track 1 - Branch B: Inner Pacific Recurver (Part of Track ①)
    {
        'pts': np.array([
            [135.2, 15.6],
            [132.5, 15.6],
            [129.5, 16.0],
            [127.0, 16.8],
            [125.2, 18.2],
            [124.4, 20.2],
            [124.8, 21.8],
            [125.8, 23.2],
            [127.2, 24.5],
            [128.6, 25.7]
        ]),
        'start_w': 0.18, 'end_w': 0.26, 'head_len': 0.95, 'head_w': 0.72, 'num': None
    },
    # Track 2: Northern / Central Luzon Landfall Corridor (Originates at Badge ②)
    {
        'pts': np.array([
            [136.5, 13.4],
            [133.0, 13.6],
            [129.5, 14.4],
            [126.0, 15.6],
            [122.5, 16.8],
            [119.5, 17.5],
            [116.5, 18.3],
            [114.0, 19.2]
        ]),
        'start_w': 0.18, 'end_w': 0.26, 'head_len': 0.95, 'head_w': 0.72, 'num': None
    },
    # Track 3: Central & Southern Luzon / Metro Manila Corridor (Originates at Badge ③)
    {
        'pts': np.array([
            [136.5, 9.3],
            [133.0, 10.2],
            [129.5, 11.5],
            [126.0, 12.8],
            [122.5, 14.0],
            [119.0, 14.6],
            [116.0, 14.7],
            [113.8, 14.7]
        ]),
        'start_w': 0.18, 'end_w': 0.26, 'head_len': 0.95, 'head_w': 0.72, 'num': None
    },
    # Track 4: Visayas & Palawan Corridor (Originates at Badge ④)
    {
        'pts': np.array([
            [132.2, 7.4],
            [129.0, 8.6],
            [126.0, 9.9],
            [123.0, 11.0],
            [120.0, 11.7],
            [117.0, 11.9],
            [113.8, 11.9]
        ]),
        'start_w': 0.18, 'end_w': 0.26, 'head_len': 0.95, 'head_w': 0.72, 'num': None
    }
]

# The 4 official PAGASA October Badges
PAGASA_OCTOBER_BADGES = [
    (1, 136.2, 17.0),  # Centered between Track 1's two recurving arrows
    (2, 137.2, 13.4),  # Directly at the origin of Track 2 (Northern Luzon)
    (3, 137.2, 9.3),   # Directly at the origin of Track 3 (Central/Southern Luzon)
    (4, 133.0, 7.4),   # Directly at the origin of Track 4 (Visayas)
]

# Major Philippine Geographic & City Callout Labels
MAP_CITIES = [
    ("Basco", 121.97, 20.45, (0.22, 0.10), "left"),
    ("Laoag", 120.59, 18.20, (-0.22, 0.12), "right"),
    ("Tuguegarao", 121.72, 17.61, (0.24, 0.05), "left"),
    ("Baguio", 120.59, 16.41, (-0.22, -0.05), "right"),
    ("Manila", 120.98, 14.59, (-0.24, -0.24), "right"),
    ("Legazpi", 123.73, 13.14, (0.24, -0.08), "left"),
    ("Iloilo", 122.56, 10.72, (-0.22, 0), "right"),
    ("Cebu", 123.89, 10.31, (0.24, 0), "left"),
    ("Tacloban", 125.00, 11.24, (0.24, 0.12), "left"),
    ("Puerto Princesa", 118.73, 9.74, (0.26, 0.08), "left"),
    ("Cagayan de Oro", 124.63, 8.48, (-0.22, 0.15), "right"),
    ("Butuan", 125.54, 8.95, (0.24, 0), "left"),
    ("Davao", 125.60, 7.19, (0.24, 0), "left"),
    ("Zamboanga", 122.07, 6.92, (0, -0.32), "center"),
    ("Jolo", 121.00, 6.05, (0, -0.30), "center"),
]


def find_csv_file(custom_path=None):
    """Locates the IBTrACS WP CSV file automatically."""
    candidates = []
    if custom_path:
        candidates.append(custom_path)
    candidates.extend(DEFAULT_CSV_PATHS)
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None


def smooth_spline(pts, num_samples=220):
    """Interpolates coordinate points using a cubic spline."""
    t = np.linspace(0, 1, len(pts))
    t_new = np.linspace(0, 1, num_samples)
    x_spline = scipy.interpolate.CubicSpline(t, pts[:, 0])
    y_spline = scipy.interpolate.CubicSpline(t, pts[:, 1])
    return x_spline(t_new), y_spline(t_new)


def draw_sleek_data_arrow(ax, pts, start_w=0.18, end_w=0.26, head_len=1.10, head_w=0.80):
    """
    Renders a sleek, luminous data annotation flow arrow with a subtle gradient glow,
    refined vector tapering, soft drop shadow, and clean chevron arrowhead.
    """
    xs, ys = smooth_spline(pts, 240)
    
    dx = np.gradient(xs)
    dy = np.gradient(ys)
    lengths = np.sqrt(dx**2 + dy**2)
    lengths[lengths == 0] = 1.0
    nx = -dy / lengths
    ny = dx / lengths
    
    dists_from_end = np.sqrt((xs - xs[-1])**2 + (ys - ys[-1])**2)
    body_mask = dists_from_end >= head_len
    
    if np.sum(body_mask) < 2:
        cutoff_idx = len(xs) - 20
    else:
        cutoff_idx = np.where(body_mask)[0][-1]
        
    body_x = xs[:cutoff_idx+1]
    body_y = ys[:cutoff_idx+1]
    body_nx = nx[:cutoff_idx+1]
    body_ny = ny[:cutoff_idx+1]
    
    t_prog = np.linspace(0, 1, len(body_x))
    taper_curve = np.clip(t_prog / 0.15, 0.40, 1.0)
    w_arr = (start_w + (end_w - start_w) * t_prog) * taper_curve / 2.0
    
    left_x = body_x + body_nx * w_arr
    left_y = body_y + body_ny * w_arr
    right_x = body_x - body_nx * w_arr
    right_y = body_y - body_ny * w_arr
    
    body_poly_x = np.concatenate([left_x, right_x[::-1]])
    body_poly_y = np.concatenate([left_y, right_y[::-1]])
    
    head_tip_x, head_tip_y = xs[-1], ys[-1]
    neck_x, neck_y = xs[cutoff_idx], ys[cutoff_idx]
    neck_nx, neck_ny = nx[cutoff_idx], ny[cutoff_idx]
    
    hw = head_w / 2.0
    sweep_back = 0.22
    
    dir_x = head_tip_x - neck_x
    dir_y = head_tip_y - neck_y
    d_len = np.sqrt(dir_x**2 + dir_y**2)
    if d_len > 0:
        dir_x /= d_len
        dir_y /= d_len
        
    norm_x = -dir_y
    norm_y = dir_x
    
    wing_left_x = neck_x + norm_x * hw - dir_x * sweep_back
    wing_left_y = neck_y + norm_y * hw - dir_y * sweep_back
    wing_right_x = neck_x - norm_x * hw - dir_x * sweep_back
    wing_right_y = neck_y - norm_y * hw - dir_y * sweep_back
    
    head_poly_x = [head_tip_x, wing_left_x, neck_x, wing_right_x]
    head_poly_y = [head_tip_y, wing_left_y, neck_y, wing_right_y]
    
    # 1. Soft Ambient Shadow
    so_x, so_y = 0.06, -0.06
    ax.fill(body_poly_x + so_x, body_poly_y + so_y,
            color='#020617', alpha=0.35, transform=ccrs.PlateCarree(), zorder=15)
    ax.fill([x + so_x for x in head_poly_x], [y + so_y for y in head_poly_y],
            color='#020617', alpha=0.35, transform=ccrs.PlateCarree(), zorder=15)
    
    # 2. Sleek Translucent Ice-Cyan Ribbon
    ax.fill(body_poly_x, body_poly_y,
            color='#e2e8f0', alpha=0.72, transform=ccrs.PlateCarree(), zorder=16)
    ax.plot(body_poly_x, body_poly_y, color='#38bdf8', alpha=0.60, lw=0.75,
            transform=ccrs.PlateCarree(), zorder=17)
    
    # 3. Luminous Core Spine (Data Flow Line)
    ax.plot(body_x, body_y, color='#ffffff', alpha=0.90, lw=1.2,
            linestyle='-', transform=ccrs.PlateCarree(), zorder=18)
    
    # 4. Refined Arrowhead
    ax.fill(head_poly_x, head_poly_y,
            color='#f8fafc', alpha=0.88, transform=ccrs.PlateCarree(), zorder=19)
    ax.plot(head_poly_x + [head_poly_x[0]], head_poly_y + [head_poly_y[0]],
            color='#ffffff', alpha=0.95, lw=1.0, transform=ccrs.PlateCarree(), zorder=19)


def generate_outlook_poster(df_wp, target_month=10, target_year=2026,
                            expected_range="1–2",
                            upcoming_names=("ROSAL", "SAMUEL"),
                            output_image_path=DEFAULT_IMG_OUTPUT):
    """
    Renders an original, zoomed-in, broadcast-grade Philippine Tropical Cyclone Outlook poster
    with unified grid alignment, subtle background texture, and sleek vector flow arrows.
    Updated with October Climatological tracks and comprehensive Tagalog outlook cards.
    """
    month_name_display = MONTH_NAMES_TL.get(target_month, MONTH_NAMES[target_month])
    print(f"\n[Poster] Generating Zoomed Philippine TC Outlook for {month_name_display} {target_year}...")
    
    # Select full tracks for all storms active in target month (1960-2024)
    target_sids = df_wp[(df_wp['YEAR'] >= 1960) & (df_wp['YEAR'] <= 2024) & (df_wp['MONTH'] == target_month)]['SID'].unique()
    df_hist = df_wp[df_wp['SID'].isin(target_sids) & (df_wp['YEAR'] >= 1960) & (df_wp['YEAR'] <= 2024)].copy()
    print(f"[Poster] Historical points for {MONTH_NAMES[target_month]} (1960-2024): {len(df_hist)} points across {len(target_sids)} storms.")
    
    # ── Figure Setup (Square 1:1 Aspect Ratio) ──────────────────────────────
    fig = plt.figure(figsize=(13, 13), dpi=160, facecolor='#020617')
    ax = fig.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree())
    
    # BROADENED EXTENT: Entire Philippine archipelago + PAR + Western WPS arrowheads fully visible and unobstructed
    # Longitude: 104.0°E to 140.5°E | Latitude: 3.5°N to 26.5°N
    map_extent = [104.0, 140.5, 3.5, 26.5]
    ax.set_extent(map_extent, crs=ccrs.PlateCarree())
    
    # Dark Ocean & Neighboring Land
    ax.add_feature(cfeature.OCEAN, facecolor='#060d1d', zorder=0)
    ax.add_feature(cfeature.LAND, facecolor='#0b1329', edgecolor='#1e293b', linewidth=0.5, zorder=1)
    
    # Graticules / Gridlines
    gl = ax.gridlines(crs=ccrs.PlateCarree(), draw_labels=False,
                      linewidth=0.45, color='#1e293b', alpha=0.40, linestyle='--', zorder=1)
    
    # Philippine Provinces (Detailed, Clean Slate Fill with Luminous Province Outlines)
    if os.path.exists(GEOJSON_PATH):
        try:
            gdf_ph = gpd.read_file(GEOJSON_PATH)
            ax.add_geometries(gdf_ph.geometry, crs=ccrs.PlateCarree(),
                              facecolor='#162544', edgecolor='#38bdf8', linewidth=0.60, alpha=0.98, zorder=3)
            print("[Poster] Loaded detailed Philippine province boundaries.")
        except Exception as e:
            print(f"[Poster] Warning loading province geometries: {e}")
            
    ax.add_feature(cfeature.COASTLINE, edgecolor='#475569', linewidth=0.75, zorder=2)

    # ── Philippine Area of Responsibility (PAR) Boundary (Solid Line) ───
    par_lons = [p[0] for p in PAR_COORDS]
    par_lats = [p[1] for p in PAR_COORDS]
    ax.plot(par_lons, par_lats, color='#f59e0b', lw=1.8, linestyle='-',
            alpha=0.92, transform=ccrs.PlateCarree(), zorder=12,
            path_effects=[patheffects.withStroke(linewidth=3.2, foreground='#000000', alpha=0.95)])
    ax.text(128.5, 5.35, "Philippine Area of Responsibility (PAR)",
            color='#fbbf24', fontsize=7.8, fontweight='bold', fontstyle='italic',
            path_effects=[patheffects.withStroke(linewidth=2.5, foreground='#020617', alpha=0.95)],
            transform=ccrs.PlateCarree(), zorder=13)
    
    # ── Historical Tracks Background (Rendered as Elegant Data Texture) ─────
    segments_by_cat = {k: [] for k in PAGASA_COLORS}
    
    for sid, track in df_hist.groupby('SID'):
        track = track.dropna(subset=['LON', 'LAT'])
        if len(track) < 2:
            continue
        
        lons = track['LON'].values
        lats = track['LAT'].values
        winds = track['WIND'].values
        
        for i in range(len(lons) - 1):
            if abs(lons[i+1] - lons[i]) > 3.5 or abs(lats[i+1] - lats[i]) > 3.5:
                continue
            
            w_avg = max(winds[i], winds[i+1])
            seg = [[lons[i], lats[i]], [lons[i+1], lats[i+1]]]
            
            if w_avg >= 100:
                segments_by_cat['STY'].append(seg)
            elif w_avg >= 64:
                segments_by_cat['TY'].append(seg)
            elif w_avg >= 48:
                segments_by_cat['STS'].append(seg)
            elif w_avg >= 34:
                segments_by_cat['TS'].append(seg)
            else:
                segments_by_cat['TD'].append(seg)
                
    for cat_key in ['TD', 'TS', 'STS', 'TY', 'STY']:
        cat_info = PAGASA_COLORS[cat_key]
        segs = segments_by_cat[cat_key]
        if segs:
            lc = LineCollection(segs, colors=cat_info['color'],
                                linewidths=cat_info['lw'], alpha=cat_info['alpha'],
                                transform=ccrs.PlateCarree(), zorder=cat_info['zorder'])
            ax.add_collection(lc)
            
    # ── Draw Climatological Trajectory Flow Arrows ───────────────────────────
    print(f"[Poster] Drawing climatological track flow arrows for {MONTH_NAMES[target_month]}...")
    clim_tracks = CLIM_TRACKS_OCTOBER if target_month == 10 else CLIM_TRACKS_SEPTEMBER
    for t_info in clim_tracks:
        draw_sleek_data_arrow(
            ax,
            t_info['pts'],
            start_w=t_info['start_w'],
            end_w=t_info['end_w'],
            head_len=t_info['head_len'],
            head_w=t_info['head_w']
        )
        if t_info.get('num'):
            p0 = t_info['pts'][0]
            ax.plot(p0[0], p0[1], marker='o', markersize=14, color='#dc2626',
                    markeredgecolor='#ffffff', markeredgewidth=1.4,
                    transform=ccrs.PlateCarree(), zorder=48)
            ax.text(p0[0], p0[1], str(t_info['num']), color='#ffffff', fontsize=9.5,
                    fontweight='black', ha='center', va='center',
                    transform=ccrs.PlateCarree(), zorder=49)

    # ── Draw the 4 Official PAGASA Red Badges ①, ②, ③, ④ ───────────────────
    if target_month == 10:
        for b_num, b_lon, b_lat in PAGASA_OCTOBER_BADGES:
            # Outer ambient glow
            ax.plot(b_lon, b_lat, marker='o', markersize=18, color='#dc2626', alpha=0.35,
                    transform=ccrs.PlateCarree(), zorder=47)
            # Main circular badge
            ax.plot(b_lon, b_lat, marker='o', markersize=14, color='#dc2626',
                    markeredgecolor='#ffffff', markeredgewidth=1.6,
                    transform=ccrs.PlateCarree(), zorder=48)
            ax.text(b_lon, b_lat, str(b_num), color='#ffffff', fontsize=9.2,
                    fontweight='black', ha='center', va='center',
                    transform=ccrs.PlateCarree(), zorder=49)
        
    # ── Map City / Regional Labels (Protected Top Layer with Deep Halo) ─────
    dark_halo = [patheffects.withStroke(linewidth=3.6, foreground='#020617', alpha=0.98)]
    for name, clon, clat, (off_x, off_y), ha in MAP_CITIES:
        ax.plot(clon, clat, marker='o', markersize=3.6, color='#38bdf8',
                markeredgecolor='#ffffff', markeredgewidth=0.8,
                transform=ccrs.PlateCarree(), zorder=45)
        ax.text(clon + off_x, clat + off_y, name,
                color='#f8fafc', fontsize=9.2, fontweight='bold', ha=ha, va='center',
                path_effects=dark_halo, transform=ccrs.PlateCarree(), zorder=46)
    
    # ── UNIFIED GRID SYSTEM & MARGINS (2.0% Margin, Protected Archipelagic Space) ──
    GRID_MARGIN = 0.020
    TOP_GRID_Y = 0.980
    
    # 1. Top-Left Header Banner Card (Restricted width: stays strictly west of Batanes & Luzon)
    header_x = GRID_MARGIN
    header_w = 0.280
    header_h = 0.076
    header_y = TOP_GRID_Y - header_h
    
    header_shadow = FancyBboxPatch(
        (header_x + 0.003, header_y - 0.003), header_w, header_h,
        boxstyle="round,pad=0.005,rounding_size=0.014",
        facecolor='#01040a', edgecolor='none', alpha=0.55,
        transform=fig.transFigure, zorder=29
    )
    fig.patches.append(header_shadow)
    
    header_bg = FancyBboxPatch(
        (header_x, header_y), header_w, header_h,
        boxstyle="round,pad=0.005,rounding_size=0.014",
        facecolor='#030b1e', edgecolor='#1e3a8a', linewidth=1.4,
        alpha=0.94, transform=fig.transFigure, zorder=30
    )
    fig.patches.append(header_bg)
    
    tag_patch = FancyBboxPatch(
        (header_x + 0.010, header_y + header_h - 0.022), 0.165, 0.015,
        boxstyle="round,pad=0.002,rounding_size=0.004",
        facecolor='#0284c7', edgecolor='none',
        transform=fig.transFigure, zorder=31
    )
    fig.patches.append(tag_patch)
    fig.text(header_x + 0.010 + 0.082, header_y + header_h - 0.0145, "PAGTAYA SA KLIMA AT MGA BAGYO",
             color='#ffffff', fontsize=6.8, fontweight='black', ha='center', va='center', zorder=32)
    
    title_str = f"PAGTAYA SA BUWAN NG {month_name_display} {target_year}"
    fig.text(header_x + 0.010, header_y + 0.031, title_str,
             color='#ffffff', fontsize=9.8, fontweight='black', va='center', zorder=32)
    
    fig.text(header_x + 0.010, header_y + 0.013, "Mga Historikal na Track (1960–2024) at Trajectories ng PAGASA",
             color='#94a3b8', fontsize=6.6, fontweight='semibold', va='center', zorder=32)
    
    # 2. Top-Right Legend Card (Tucked into far top-right ocean corner east of 135.5°E)
    leg_w = 0.132
    leg_h = 0.235
    leg_x = 1.0 - GRID_MARGIN - leg_w
    leg_y = TOP_GRID_Y - leg_h
    
    leg_bg = FancyBboxPatch(
        (leg_x, leg_y), leg_w, leg_h,
        boxstyle="round,pad=0.005,rounding_size=0.014",
        facecolor='#030b1e', edgecolor='#1e3a8a', linewidth=1.2,
        alpha=0.94, transform=fig.transFigure, zorder=30
    )
    fig.patches.append(leg_bg)
    
    fig.text(leg_x + 0.008, leg_y + leg_h - 0.018, "PAGASA INTENSITY SCALE",
             color='#38bdf8', fontsize=7.6, fontweight='black', zorder=32)
    fig.text(leg_x + 0.008, leg_y + leg_h - 0.032, "1960–2024 Historical Tracks",
             color='#94a3b8', fontsize=6.2, zorder=32)
    
    cat_items = [
        ('STY', 'Super Typhoon', '#c084fc', '≥ 185 km/h'),
        ('TY',  'Typhoon',       '#ef4444', '118–184'),
        ('STS', 'Severe TS',     '#fb923c', '89–117'),
        ('TS',  'Tropical Storm','#facc15', '62–88'),
        ('TD',  'Tropical Depr.', '#38bdf8', '≤ 61 km/h'),
    ]
    
    line_start_y = leg_y + leg_h - 0.052
    for idx, (code, label, c, speed) in enumerate(cat_items):
        ly = line_start_y - idx * 0.017
        fig.lines.append(plt.Line2D(
            [leg_x + 0.008, leg_x + 0.024], [ly, ly],
            color=c, lw=2.6, transform=fig.transFigure, zorder=32
        ))
        fig.text(leg_x + 0.028, ly, label, color='#ffffff', fontsize=6.8, fontweight='bold', va='center', zorder=32)
        fig.text(leg_x + leg_w - 0.008, ly, speed, color='#94a3b8', fontsize=6.0, ha='right', va='center', zorder=32)
        
    div_y = leg_y + 0.055
    fig.lines.append(plt.Line2D([leg_x + 0.008, leg_x + leg_w - 0.008],
                                [div_y, div_y],
                                color='#1e293b', lw=0.8, transform=fig.transFigure, zorder=32))
    
    # Karaniwang Track header & subtitle
    fig.text(leg_x + 0.008, div_y - 0.014, f"Karaniwang Track ({month_name_display})",
             color='#ffffff', fontsize=6.8, fontweight='bold', zorder=32)
    fig.text(leg_x + 0.008, div_y - 0.027, "PAGASA Climatology (Tracks 1, 2, 3, 4)",
             color='#64748b', fontsize=5.8, zorder=32)
    
    # Dedicated row for sample flow arrow (completely free of text overlap)
    arrow_y = div_y - 0.041
    fig.lines.append(plt.Line2D(
        [leg_x + 0.012, leg_x + leg_w - 0.012], [arrow_y, arrow_y],
        color='#38bdf8', lw=3.0, alpha=0.45, transform=fig.transFigure, zorder=32
    ))
    arrow_icon = FancyArrowPatch(
        (leg_x + leg_w - 0.012, arrow_y), (leg_x + 0.012, arrow_y),
        arrowstyle='simple,head_width=6,head_length=8,tail_width=2.2',
        facecolor='#f8fafc', edgecolor='#38bdf8', linewidth=0.8, alpha=0.95,
        transform=fig.transFigure, zorder=33
    )
    fig.patches.append(arrow_icon)
    
    # 3. Left Card A: Forecast & Names & Landfall Alert (Snug & Cohesive)
    card_x = GRID_MARGIN
    card_w = 0.202
    card_y = 0.536
    card_h = 0.354
    
    card_shadow = FancyBboxPatch(
        (card_x + 0.003, card_y - 0.003), card_w, card_h,
        boxstyle="round,pad=0.005,rounding_size=0.014",
        facecolor='#01040a', edgecolor='none', alpha=0.55,
        transform=fig.transFigure, zorder=29
    )
    fig.patches.append(card_shadow)
    
    card_bg = FancyBboxPatch(
        (card_x, card_y), card_w, card_h,
        boxstyle="round,pad=0.005,rounding_size=0.014",
        facecolor='#030b1e', edgecolor='#1e3a8a', linewidth=1.4,
        alpha=0.92, transform=fig.transFigure, zorder=30
    )
    fig.patches.append(card_bg)
    
    # Section 1: Expected PAR Count
    fig.text(card_x + card_w / 2.0, card_y + card_h - 0.024, "INAASAHAN SA LOOB NG PAR",
             color='#38bdf8', fontsize=8.0, fontweight='black', ha='center', va='center', zorder=32)
    
    fig.text(card_x + card_w / 2.0, card_y + card_h - 0.070, expected_range,
             color='#ffffff', fontsize=33, fontweight='black', ha='center', va='center',
             path_effects=[patheffects.withStroke(linewidth=3, foreground='#0284c7', alpha=0.45)],
             zorder=32)
    
    fig.text(card_x + card_w / 2.0, card_y + card_h - 0.112, "Mga Bagyo (Tropical Cyclones)",
             color='#cbd5e1', fontsize=7.6, fontweight='bold', ha='center', va='center', zorder=32)
    fig.text(card_x + card_w / 2.0, card_y + card_h - 0.128, "PAGASA Climatological Average: 2.1",
             color='#64748b', fontsize=6.6, ha='center', va='center', zorder=32)
    
    fig.lines.append(plt.Line2D([card_x + 0.010, card_x + card_w - 0.010],
                                [card_y + card_h - 0.144, card_y + card_h - 0.144],
                                color='#1e293b', lw=1.0, transform=fig.transFigure, zorder=32))
    
    # Section 2: Next In Line Storm Names
    fig.text(card_x + card_w / 2.0, card_y + card_h - 0.163, "SUSUNOD NA MGA PANGALAN",
             color='#38bdf8', fontsize=7.8, fontweight='black', ha='center', va='center', zorder=32)
    
    badge_w = card_w - 0.020
    badge_h = 0.033
    badge_x = card_x + 0.010
    start_badge_y = card_y + card_h - 0.208
    
    for idx, sname in enumerate(upcoming_names):
        by = start_badge_y - idx * (badge_h + 0.007)
        b_patch = FancyBboxPatch(
            (badge_x, by), badge_w, badge_h,
            boxstyle="round,pad=0.003,rounding_size=0.006",
            facecolor='#0b1d3a', edgecolor='#0284c7', linewidth=1.2,
            transform=fig.transFigure, zorder=32
        )
        fig.patches.append(b_patch)
        
        num_str = f"#{idx+1}"
        fig.text(badge_x + 0.008, by + badge_h / 2.0, num_str,
                 color='#38bdf8', fontsize=8.2, fontweight='black', va='center', zorder=33)
        fig.text(badge_x + badge_w / 2.0 + 0.006, by + badge_h / 2.0, sname,
                 color='#fef08a', fontsize=11.0, fontweight='black', ha='center', va='center', zorder=33)
        
    # Section 3: Landfall Alert Box (Snug below Samuel with no dead space)
    lbox_y = card_y + 0.012
    lbox_h = 0.080
    lbox = FancyBboxPatch(
        (badge_x, lbox_y), badge_w, lbox_h,
        boxstyle="round,pad=0.003,rounding_size=0.006",
        facecolor='#450a0a', edgecolor='#ef4444', linewidth=1.2,
        transform=fig.transFigure, zorder=32
    )
    fig.patches.append(lbox)
    fig.text(card_x + card_w / 2.0, lbox_y + lbox_h - 0.016, "⚠️ BABALA SA LANDFALL",
             color='#fca5a5', fontsize=7.2, fontweight='black', ha='center', va='center', zorder=33)
    fig.text(card_x + card_w / 2.0, lbox_y + lbox_h - 0.034, "MAS MATAAS ANG TSANSA NG LANDFALL",
             color='#ffffff', fontsize=6.6, fontweight='black', ha='center', va='center', zorder=33)
    fig.text(card_x + card_w / 2.0, lbox_y + lbox_h - 0.051, "SA LUZON O VISAYAS (Tracks 2, 3, 4)",
             color='#fef08a', fontsize=6.6, fontweight='bold', ha='center', va='center', zorder=33)
    fig.text(card_x + card_w / 2.0, lbox_y + 0.012, "May posibilidad ng pagtawid bago lumabas sa WPS.",
             color='#fca5a5', fontsize=5.8, ha='center', va='center', zorder=33)

    # 4. Left Card B: Monsoon Transition & Weather Systems (Clean, Wrapped & Snug)
    card_b_top = card_y - 0.016
    syn_h = 0.352
    syn_y = card_b_top - syn_h
    
    syn_shadow = FancyBboxPatch(
        (card_x + 0.003, syn_y - 0.003), card_w, syn_h,
        boxstyle="round,pad=0.005,rounding_size=0.014",
        facecolor='#01040a', edgecolor='none', alpha=0.55,
        transform=fig.transFigure, zorder=29
    )
    fig.patches.append(syn_shadow)
    
    syn_bg = FancyBboxPatch(
        (card_x, syn_y), card_w, syn_h,
        boxstyle="round,pad=0.005,rounding_size=0.014",
        facecolor='#030b1e', edgecolor='#1e3a8a', linewidth=1.4,
        alpha=0.92, transform=fig.transFigure, zorder=30
    )
    fig.patches.append(syn_bg)
    
    # Header tag for systems
    stag_h = 0.018
    stag_y = card_b_top - 0.026
    stag = FancyBboxPatch(
        (card_x + 0.010, stag_y), badge_w, stag_h,
        boxstyle="round,pad=0.002,rounding_size=0.004",
        facecolor='#0f2a4a', edgecolor='#0284c7', linewidth=1.0,
        transform=fig.transFigure, zorder=31
    )
    fig.patches.append(stag)
    fig.text(card_x + card_w / 2.0, card_b_top - 0.017, "MONSOON TRANSITION & MGA SISTEMA",
             color='#38bdf8', fontsize=6.8, fontweight='black', ha='center', va='center', zorder=32)

    # 1. Habagat Termination
    title1_y = card_b_top - 0.046
    fig.text(card_x + 0.010, title1_y, "1. PAGTATAPOS NG HABAGAT (SW MONSOON)",
             color='#fbbf24', fontsize=6.8, fontweight='black', zorder=32)
    fig.text(card_x + 0.012, title1_y - 0.016, "• Pagtatapos ng Habagat at tag-ulan", color='#f8fafc', fontsize=6.0, zorder=32)
    fig.text(card_x + 0.018, title1_y - 0.029, "sa unang linggo ng buwan.", color='#cbd5e1', fontsize=5.8, zorder=32)
    fig.text(card_x + 0.012, title1_y - 0.045, "• Paghupa ng malalakas na pag-ulan", color='#f8fafc', fontsize=6.0, zorder=32)
    fig.text(card_x + 0.018, title1_y - 0.058, "sa kanlurang bahagi ng bansa.", color='#94a3b8', fontsize=5.8, zorder=32)

    div1_y = title1_y - 0.072
    fig.lines.append(plt.Line2D([card_x + 0.010, card_x + card_w - 0.010],
                                [div1_y, div1_y],
                                color='#1e293b', lw=0.8, transform=fig.transFigure, zorder=32))

    # 2. Amihan Onset
    title2_y = div1_y - 0.016
    fig.text(card_x + 0.010, title2_y, "2. PAGSISIMULA NG AMIHAN (NE MONSOON)",
             color='#67e8f9', fontsize=6.8, fontweight='black', zorder=32)
    fig.text(card_x + 0.012, title2_y - 0.016, "• Posibleng pagpasok ng Amihan at simula", color='#f8fafc', fontsize=6.0, zorder=32)
    fig.text(card_x + 0.018, title2_y - 0.029, "ng cool dry season sa huling bahagi.", color='#cbd5e1', fontsize=5.8, zorder=32)
    fig.text(card_x + 0.012, title2_y - 0.045, "• Mas malamig na simoy ng hangin", color='#f8fafc', fontsize=6.0, zorder=32)
    fig.text(card_x + 0.018, title2_y - 0.058, "sa gabi at madaling araw.", color='#94a3b8', fontsize=5.8, zorder=32)

    div2_y = title2_y - 0.072
    fig.lines.append(plt.Line2D([card_x + 0.010, card_x + card_w - 0.010],
                                [div2_y, div2_y],
                                color='#1e293b', lw=0.8, transform=fig.transFigure, zorder=32))

    # 3. Prevailing Systems
    title3_y = div2_y - 0.016
    fig.text(card_x + 0.010, title3_y, "3. MGA UMIIRAL NA WEATHER SYSTEMS",
             color='#34d399', fontsize=6.8, fontweight='black', zorder=32)
    fig.text(card_x + 0.012, title3_y - 0.016, "• ITCZ: Kalat-kalat na pag-ulan sa", color='#f8fafc', fontsize=6.0, zorder=32)
    fig.text(card_x + 0.018, title3_y - 0.029, "bahagi ng Visayas at Mindanao.", color='#cbd5e1', fontsize=5.8, zorder=32)
    fig.text(card_x + 0.012, title3_y - 0.045, "• Easterlies: Thunderstorms at maalinsangan", color='#cbd5e1', fontsize=6.0, zorder=32)
    fig.text(card_x + 0.018, title3_y - 0.058, "na panahon sa silangang baybayin.", color='#94a3b8', fontsize=5.8, zorder=32)
    fig.text(card_x + 0.012, title3_y - 0.074, "• LPAs: Namumuong sama ng panahon", color='#f87171', fontsize=6.0, zorder=32)
    fig.text(card_x + 0.018, title3_y - 0.087, "sa loob at paligid ng ITCZ.", color='#fca5a5', fontsize=5.8, zorder=32)

    div3_y = title3_y - 0.101
    fig.lines.append(plt.Line2D([card_x + 0.010, card_x + card_w - 0.010],
                                [div3_y, div3_y],
                                color='#1e293b', lw=0.8, transform=fig.transFigure, zorder=32))

    # Pinagmulan directly below section 3 divider (no dead space)
    pinagmulan_y = div3_y - 0.014
    fig.text(card_x + card_w / 2.0, pinagmulan_y, "Pinagmulan: DOST-PAGASA & NOAA IBTrACS",
             color='#64748b', fontsize=6.2, fontweight='semibold', ha='center', va='center', zorder=32)
    
    # 5. User's App Logo (Bottom Right - Aligned to GRID_MARGIN)
    user_logo_file = next((p for p in USER_LOGO_PATHS if os.path.exists(p)), None)
    if user_logo_file:
        try:
            logo_img = Image.open(user_logo_file)
            logo_size = 0.125
            logo_x = 1.0 - GRID_MARGIN - logo_size
            logo_y = GRID_MARGIN
            logo_ax = fig.add_axes([logo_x, logo_y, logo_size, logo_size], zorder=40)
            logo_ax.imshow(logo_img)
            logo_ax.axis('off')
            print(f"[Poster] Embedded user logo from {user_logo_file}")
        except Exception as e:
            print(f"[Poster] Error embedding user logo: {e}")
            
    # Save Image
    os.makedirs(os.path.dirname(output_image_path), exist_ok=True)
    plt.savefig(output_image_path, dpi=160, facecolor='#020617')
    print(f"[Poster] Saved high-resolution poster to {output_image_path}")
    
    artifact_dir = r"C:\Users\Russel\.gemini\antigravity-ide\brain\a77c8e91-392d-4bc9-b623-b3d9de183f37"
    if os.path.exists(artifact_dir):
        try:
            art_img_path = os.path.join(artifact_dir, "tropical_cyclone_outlook_october_2026.png")
            plt.savefig(art_img_path, dpi=160, facecolor='#020617')
            print(f"[Poster] Also saved copy to artifact: {art_img_path}")
        except Exception as e:
            print(f"[Poster] Note saving artifact copy: {e}")
    plt.close()


def process_climatology_and_json(df_wp, output_json_path=DEFAULT_JSON_OUTPUT):
    """
    Builds climatology statistics and exports historical tracks JSON for 2014-2026.
    Fast vectorized geometry checking.
    """
    print("\n[Climatology] Building statistics across historical years (1970-2025)...")
    clim_start = 1970
    clim_end = 2025

    valid_mask = (~df_wp['LON'].isna()) & (~df_wp['LAT'].isna())
    df_wp['IN_PAR'] = False
    if valid_mask.any():
        df_wp.loc[valid_mask, 'IN_PAR'] = shapely.contains_xy(
            par_polygon,
            df_wp.loc[valid_mask, 'LON'].values,
            df_wp.loc[valid_mask, 'LAT'].values
        )

    par_sids = set(df_wp[df_wp['IN_PAR']]['SID'].unique())
    df_clim = df_wp[(df_wp['FIRST_YEAR'] >= clim_start) & (df_wp['FIRST_YEAR'] <= clim_end)]

    climatology = {}
    all_years = range(clim_start, clim_end + 1)
    
    for month in range(1, 13):
        month_storms = df_clim[df_clim['FIRST_MONTH'] == month]
        
        formation_counts = month_storms.groupby('FIRST_YEAR')['SID'].nunique().reindex(all_years, fill_value=0)
        avg_formation = float(formation_counts.mean())

        month_par_storms = month_storms[month_storms['SID'].isin(par_sids)]
        par_counts = month_par_storms.groupby('FIRST_YEAR')['SID'].nunique().reindex(all_years, fill_value=0)
        avg_par = float(par_counts.mean())

        mu_form = avg_formation
        mu_par = avg_par

        form_low = int(poisson.ppf(0.10, mu_form)) if mu_form > 0 else 0
        form_high = int(poisson.ppf(0.90, mu_form)) if mu_form > 0 else 0
        par_low = int(poisson.ppf(0.10, mu_par)) if mu_par > 0 else 0
        par_high = int(poisson.ppf(0.90, mu_par)) if mu_par > 0 else 0

        climatology[str(month)] = {
            "month_name": MONTH_NAMES[month].capitalize(),
            "avg_formation": round(avg_formation, 1),
            "avg_par_entry": round(avg_par, 1),
            "formation_range": [form_low, form_high],
            "par_range": [par_low, par_high],
        }
        print(f"  {MONTH_NAMES[month].capitalize():>10}: Avg Formation={avg_formation:.1f} ({form_low}-{form_high}), Avg PAR={avg_par:.1f} ({par_low}-{par_high})")

    print("\n[JSON] Exporting per-month track data (2014-2026)...")
    tracks_by_month = {}
    for year in range(2014, 2027):
        for month in range(1, 13):
            key = f"{year}-{month:02d}"
            df_ym = df_wp[(df_wp['FIRST_YEAR'] == year) & (df_wp['FIRST_MONTH'] == month)]
            storms_data = []
            wnp_count = 0
            par_count = 0

            for sid, track in df_ym.groupby('SID'):
                if 'NAME' in track.columns:
                    storm_name = str(track['NAME'].iloc[0]).strip()
                    if storm_name in ["NOT_NAMED", "nan"]:
                        storm_name = "Unnamed"
                else:
                    storm_name = "Unnamed"

                valid_points = track.dropna(subset=['LON', 'LAT'])
                if valid_points.empty:
                    continue

                entered_par = bool(sid in par_sids)
                track_pts = []
                for _, row in valid_points.iterrows():
                    track_pts.append([float(row['LAT']), float(row['LON']), float(row['WIND'])])

                storms_data.append({
                    "sid": str(sid),
                    "name": storm_name,
                    "entered_par": entered_par,
                    "tracks": track_pts
                })
                wnp_count += 1
                if entered_par:
                    par_count += 1

            tracks_by_month[key] = {
                "storms": storms_data,
                "stats": {
                    "wnp_formation_count": wnp_count,
                    "par_entry_count": par_count
                }
            }

    result = {
        "climatology": climatology,
        "tracks": tracks_by_month
    }

    os.makedirs(os.path.dirname(output_json_path), exist_ok=True)
    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(result, f)

    print(f"[JSON] Saved historical tracks JSON to {output_json_path}")
    return climatology


def main():
    parser = argparse.ArgumentParser(description="Process IBTrACS WP data and generate Tropical Cyclone Outlook.")
    parser.add_argument("--csv", type=str, default=None, help="Path to ibtracs.WP.list.v04r01.csv")
    parser.add_argument("--json-out", type=str, default=DEFAULT_JSON_OUTPUT, help="Path to save historical_tracks.json")
    parser.add_argument("--image-out", type=str, default=DEFAULT_IMG_OUTPUT, help="Path to save output image poster")
    parser.add_argument("--month", type=int, default=10, help="Target month (1-12, default 10 for October)")
    parser.add_argument("--year", type=int, default=2026, help="Target year (default 2026)")
    parser.add_argument("--range", type=str, default="1–2", help="Expected TC range (default '1–2')")
    parser.add_argument("--names", type=str, default="ROSAL,SAMUEL", help="Comma-separated upcoming names (default 'ROSAL,SAMUEL')")
    parser.add_argument("--no-json", action="store_true", help="Skip JSON export and only generate poster")
    parser.add_argument("--no-poster", action="store_true", help="Skip poster and only generate JSON")
    args = parser.parse_args()

    csv_file = find_csv_file(args.csv)
    if not csv_file:
        print(f"Error: Could not locate IBTrACS CSV. Searched paths:\n" + "\n".join(DEFAULT_CSV_PATHS))
        sys.exit(1)

    print(f"Loading IBTrACS WP data from: {csv_file}")
    df = pd.read_csv(csv_file, skiprows=[1], low_memory=False)
    df.columns = [c.strip() for c in df.columns]

    df['ISO_TIME'] = pd.to_datetime(df['ISO_TIME'], errors='coerce')
    df = df.dropna(subset=['ISO_TIME'])
    df['LAT'] = pd.to_numeric(df['LAT'], errors='coerce')
    df['LON'] = pd.to_numeric(df['LON'], errors='coerce')

    wmo_wind = pd.to_numeric(df['WMO_WIND'], errors='coerce') if 'WMO_WIND' in df.columns else pd.Series(np.nan, index=df.index)
    usa_wind = pd.to_numeric(df['USA_WIND'], errors='coerce') if 'USA_WIND' in df.columns else pd.Series(np.nan, index=df.index)
    df['WIND'] = np.fmax(wmo_wind.fillna(0), usa_wind.fillna(0))
    df['WIND'] = df.groupby('SID')['WIND'].ffill().fillna(0)

    df['YEAR'] = df['ISO_TIME'].dt.year
    df['MONTH'] = df['ISO_TIME'].dt.month

    storm_first = df.groupby('SID').agg(
        FIRST_YEAR=('YEAR', 'first'),
        FIRST_MONTH=('MONTH', 'first')
    ).reset_index()
    df = df.merge(storm_first, on='SID', how='left')

    wp_mask = df['BASIN'].str.strip().str.contains('Western North Pacific|WP', case=False, na=False)
    df_wp = df[wp_mask].copy()

    # 1. Climatology & JSON
    if not args.no_json:
        process_climatology_and_json(df_wp, args.json_out)

    # 2. Outlook Poster Generation
    if not args.no_poster:
        expected_range = args.range
        upcoming_names = tuple([n.strip().upper() for n in args.names.split(",") if n.strip()])
        if not upcoming_names:
            upcoming_names = ("ROSAL", "SAMUEL")

        generate_outlook_poster(
            df_wp=df_wp,
            target_month=args.month,
            target_year=args.year,
            expected_range=expected_range,
            upcoming_names=upcoming_names,
            output_image_path=args.image_out
        )

    print("\n[OK] Processing and visualization complete!")


if __name__ == "__main__":
    main()
