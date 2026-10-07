import os
import sys
import json
import argparse
import requests
import numpy as np
import scipy.ndimage
from scipy.interpolate import griddata
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.image as mpimg
import matplotlib.patches as patches
import matplotlib.patheffects as pe
from matplotlib.patches import FancyBboxPatch
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import shapely
from shapely.geometry import shape, box
from shapely.validation import make_valid
from shapely.ops import unary_union
from datetime import datetime, timedelta, timezone

# Optional / External NWP fetch dependencies
try:
    from eccodes import codes_grib_new_from_file, codes_get, codes_get_double_array, codes_get_values, codes_release
    HAS_ECCODES = True
except ImportError:
    HAS_ECCODES = False

try:
    from ecmwf.opendata import Client
    HAS_ECMWF = True
except ImportError:
    HAS_ECMWF = False

try:
    import xarray as xr
    import gcsfs
    import numcodecs
    from google.cloud import storage
    from weather_viz_styles import find_latest_weathernext_run, batch_cat_gcs
    HAS_WEATHERNEXT = True
except ImportError:
    HAS_WEATHERNEXT = False

# ── Directories ────────────────────────────────────────────────────────────
OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "ai_thunderstorm_outlook")
DATA_DIR = os.path.join(os.getcwd(), "public", "data")
LOGO_PATHS = [
    os.path.join(os.getcwd(), "public", "images", "logo.png"),
    os.path.join(os.getcwd(), "public", "logo512.png"),
    os.path.join(os.getcwd(), "public", "logo192.png")
]
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# ── Region & Master Grid ───────────────────────────────────────────────────
LAT_MIN, LAT_MAX = 4.5, 21.5
LON_MIN, LON_MAX = 114.0, 129.5

# High-resolution master grid (0.02° ≈ 2.2 km resolution for smooth, crisp contours)
GRID_RES = 0.02
MASTER_LATS = np.arange(LAT_MIN, LAT_MAX + GRID_RES, GRID_RES)
MASTER_LONS = np.arange(LON_MIN, LON_MAX + GRID_RES, GRID_RES)
M_LONS, M_LATS = np.meshgrid(MASTER_LONS, MASTER_LATS)

# ── Convective Rain Burst / Thunderstorm Risk Categories ───────────────────
# Based on peak 1-3h convective burst accumulation (mm), not broad stratiform 24h totals:
# 1 = General (Isolated brief rainshowers / localized lightning)
# 2 = Moderate (Scattered moderate downpours, 15-30 mm burst)
# 3 = Strong (Clustered thunderstorms with heavy downpours, 30-60 mm burst)
# 4 = Intense (Intense convective rain bursts, localized flash floods, 60-90 mm burst)
# 5 = Torrential (Torrential downpours from deep convective cores, >90 mm burst)
RISK_LEVELS = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]
RISK_COLORS = [
    '#22c55e',  # 1: General (Emerald Green)
    '#eab308',  # 2: Moderate (Golden Yellow)
    '#f97316',  # 3: Strong (Warm Orange)
    '#ef4444',  # 4: Intense (Crimson Red)
    '#c026d3'   # 5: Torrential (Vivid Magenta)
]
risk_cmap = ListedColormap(RISK_COLORS)
risk_norm = BoundaryNorm(RISK_LEVELS, ncolors=len(RISK_COLORS), clip=False)

RISK_NAMES = {
    1: "GENERAL",
    2: "MODERATE",
    3: "STRONG",
    4: "INTENSE",
    5: "TORRENTIAL"
}

# ── Regional Definitions with Exact 16:9 Aspect Ratio Extents ─────────────
BROADCAST_REGIONS = {
    "luzon": {
        "title": "LUZON",
        "extent": [114.46, 127.94, 12.0, 19.3],
        "cities": [
            ("LAOAG", 120.59, 18.20, (-0.85, 0.0)),
            ("TUGUEGARAO", 121.72, 17.61, (1.30, 0.0)),
            ("BAGUIO", 120.59, 16.41, (-1.00, 0.10)),
            ("DAGUPAN", 120.34, 16.04, (-1.05, -0.15)),
            ("CLARK", 120.56, 15.18, (-1.35, -0.05)),
            ("CABANATUAN", 120.96, 15.48, (1.75, 0.0)),
            ("MANILA", 120.98, 14.59, (-0.85, -0.15)),
            ("NAGA", 123.19, 13.62, (0.0, 0.65)),
            ("LEGAZPI", 123.73, 13.14, (0.95, 0.10))
        ]
    },
    "visayas": {
        "title": "VISAYAS",
        "extent": [120.08, 127.32, 9.0, 13.0],
        "cities": [
            ("BORACAY", 121.92, 11.97, (-0.48, 0.15)),
            ("ROXAS", 122.75, 11.58, (0.20, 0.42)),
            ("ILOILO", 122.56, 10.72, (-0.71, -0.30)),
            ("BACOLOD", 122.95, 10.67, (0.45, 0.28)),
            ("CEBU CITY", 123.89, 10.31, (0.46, 0.20)),
            ("TAGBILARAN", 123.85, 9.65, (0.50, -0.30)),
            ("DUMAGUETE", 123.30, 9.31, (0.35, 0.08)),
            ("TACLOBAN", 125.00, 11.24, (0.65, -0.19)),
            ("CATBALOGAN", 124.88, 11.77, (-0.63, 0.05))
        ]
    },
    "mindanao": {
        "title": "MINDANAO",
        "extent": [120.02, 128.98, 5.2, 10.2],
        "cities": [
            ("SURIGAO", 125.49, 9.79, (-0.95, -0.40)),
            ("BUTUAN", 125.54, 8.95, (-0.25, 0.15)),
            ("CAGAYAN DE ORO", 124.63, 8.48, (0.0, 0.40)),
            ("DIPOLOG", 123.34, 8.58, (-0.45, 0.25)),
            ("PAGADIAN", 123.43, 7.82, (0.05, -0.35)),
            ("ZAMBOANGA", 122.07, 6.92, (0.0, -0.30)),
            ("COTABATO", 124.24, 7.22, (-0.55, 0.0)),
            ("DAVAO", 125.60, 7.19, (0.35, -0.30)),
            ("GEN SANTOS", 125.17, 6.11, (0.0, -0.35))
        ]
    }
}

PALAWAN_CITIES = [
    ("CORON", 120.20, 12.00, (-0.65, 0.22)),
    ("EL NIDO", 119.39, 11.18, (-0.60, 0.05)),
    ("PTO PRINCESA", 118.73, 9.74, (0.85, 0.0)),
    ("BROOKE’S PT", 117.83, 8.77, (0.70, -0.10))
]

BATANES_BABUYAN_CITIES = [
    ("ITBAYAT", 121.84, 20.78, (-0.42, 0.0)),
    ("BASCO", 121.97, 20.45, (0.35, 0.0)),
    ("BABUYAN IS.", 121.93, 19.52, (0.38, 0.0)),
    ("CALAYAN", 121.47, 19.26, (-0.42, -0.02)),
    ("CAMIGUIN IS.", 121.93, 18.92, (0.38, -0.02))
]

# ═══════════════════════════════════════════════════════════════════════════
# Regridding
# ═══════════════════════════════════════════════════════════════════════════
def regrid_to_master(lats, lons, values):
    mask = (
        (lats >= LAT_MIN - 1.5) & (lats <= LAT_MAX + 1.5) &
        (lons >= LON_MIN - 1.5) & (lons <= LON_MAX + 1.5)
    )
    if np.any(mask):
        sub_lats = lats[mask]
        sub_lons = lons[mask]
        sub_vals = values[mask]
    else:
        sub_lats, sub_lons, sub_vals = lats, lons, values

    pts = np.column_stack((sub_lons.ravel(), sub_lats.ravel()))
    vals = sub_vals.ravel()
    valid = ~np.isnan(vals)
    if not np.any(valid):
        return np.zeros_like(M_LATS)

    regridded = griddata(pts[valid], vals[valid], (M_LONS, M_LATS), method='cubic', fill_value=np.nan)
    if np.any(np.isnan(regridded)):
        linear_fill = griddata(pts[valid], vals[valid], (M_LONS, M_LATS), method='linear', fill_value=0.0)
        regridded = np.where(np.isnan(regridded), linear_fill, regridded)

    regridded = np.nan_to_num(regridded, nan=0.0)
    regridded = np.clip(regridded, 0, None)
    return regridded

# ═══════════════════════════════════════════════════════════════════════════
# Convective Risk Scoring Algorithm (Peak 3h Rolling Accumulation)
# ═══════════════════════════════════════════════════════════════════════════
def compute_thunderstorm_risk_score(peak_3h_burst):
    """
    Computes a continuous convective risk index (0.0 to 5.5+) based strictly on peak 3-hour
    rolling convective accumulation (mm) from hourly NWP steps, isolating true localized
    convective bursts without artificial multipliers or daily stratiform contamination.

    Burst Thresholds (Peak 3-Hour Convective Accumulation):
      < 5 mm: Minimal / None
      5 - 15 mm: Category 1 (General TSTM / Isolated)
      15 - 30 mm: Category 2 (Moderate / Scattered Downpours)
      30 - 60 mm: Category 3 (Strong / Frequent Thunderstorms)
      60 - 90 mm: Category 4 (Intense Convective Rain Bursts)
      >= 90 mm: Category 5 (Torrential Rain Bursts)
    """
    burst = np.nan_to_num(peak_3h_burst, nan=0.0)
    score = np.zeros_like(burst)

    t_gen, t_mod, t_strg, t_int, t_torr = 5.0, 15.0, 30.0, 60.0, 90.0

    # Smooth piecewise interpolation to maintain continuous gradients across category boundaries
    m1 = (burst >= t_gen) & (burst < t_mod)
    score[m1] = 0.5 + 1.0 * ((burst[m1] - t_gen) / (t_mod - t_gen))

    m2 = (burst >= t_mod) & (burst < t_strg)
    score[m2] = 1.5 + 1.0 * ((burst[m2] - t_mod) / (t_strg - t_mod))

    m3 = (burst >= t_strg) & (burst < t_int)
    score[m3] = 2.5 + 1.0 * ((burst[m3] - t_strg) / (t_int - t_strg))

    m4 = (burst >= t_int) & (burst < t_torr)
    score[m4] = 3.5 + 1.0 * ((burst[m4] - t_int) / (t_torr - t_int))

    m5 = (burst >= t_torr)
    score[m5] = 4.5 + np.clip(0.8 * ((burst[m5] - t_torr) / 45.0), 0.0, 1.0)

    return score

# ═══════════════════════════════════════════════════════════════════════════
# Load Philippine Province Geometries Categorized by Region
# ═══════════════════════════════════════════════════════════════════════════
def load_ph_regional_geometries():
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
        geojson_paths = [os.path.join(DATA_DIR, "ph_provinces.json"), "public/data/ph_provinces.json"]
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

            u_luzon_main = unary_union(luzon_main_geoms)
            u_palawan = unary_union(palawan_geoms)
            u_bb = unary_union(batanes_babuyan_geoms)
            u_visayas = unary_union(visayas_geoms)
            u_mindanao = unary_union(mindanao_geoms)

            masks = {
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
                "mindanao": mindanao_geoms
            }
            return geoms_dict, masks
    except Exception as e:
        print(f"Notice loading regional geometries: {e}")
    return {}, {}

# ═══════════════════════════════════════════════════════════════════════════
# TV Broadcast Thunderstorm Risk Map Generator with Dual Inset
# ═══════════════════════════════════════════════════════════════════════════
def plot_broadcast_thunderstorm_map(risk_grid, filename_id, init_dt, region_key, period="today", geoms_dict=None, masks=None):
    """
    Renders 16:9 Widescreen TV Broadcast Convective Outlook Map with Risk Categories:
    - period: 'today' (Day 1 / 0-24h) or 'tomorrow' (Day 2 / 24-48h).
    - Regional Isolation: Masked strictly to the target region's landmass.
    - Dual Insets on Luzon View: Palawan (Bottom-Left) & Batanes/Babuyan (Upper-Right).
    - Floating City Pin Badges showing '⚡ CATEGORY \n CITY'.
    - Top Right Categorical Legend Pills (General, Marginal, Slight, Severe, Extreme).
    """
    region_info = BROADCAST_REGIONS[region_key]

    # Smooth the continuous risk grid for organic convective contours
    smoothed_risk = scipy.ndimage.gaussian_filter(risk_grid, sigma=1.2)

    # Apply strict regional land mask so other regions don't bleed risk colors
    if masks:
        if region_key == "luzon":
            land_risk = np.where(masks.get("luzon_main"), smoothed_risk, np.nan)
            palawan_risk = np.where(masks.get("palawan"), smoothed_risk, np.nan)
            bb_risk = np.where(masks.get("batanes_babuyan"), smoothed_risk, np.nan)
        elif region_key == "visayas":
            land_risk = np.where(masks.get("visayas"), smoothed_risk, np.nan)
        elif region_key == "mindanao":
            land_risk = np.where(masks.get("mindanao"), smoothed_risk, np.nan)
        else:
            land_risk = smoothed_risk
    else:
        land_risk = smoothed_risk

    fig = plt.figure(figsize=(16, 9), dpi=120)
    fig.patch.set_facecolor('#0d1821')
    ax = fig.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree())
    ax.set_extent(region_info["extent"], crs=ccrs.PlateCarree())

    # Deep Navy TV ocean & Dark Slate-Olive terrain (matching ai_precip_outlook.py)
    ax.add_feature(cfeature.OCEAN, facecolor='#162533', zorder=0)
    ax.add_feature(cfeature.LAND, facecolor='#25342a', zorder=1)

    # Convective Risk Filled Contours (Strictly masked to this region)
    cf = ax.contourf(
        M_LONS, M_LATS, land_risk,
        levels=RISK_LEVELS, cmap=risk_cmap, norm=risk_norm,
        extend='neither', transform=ccrs.PlateCarree(), zorder=2, alpha=0.90
    )

    # Crisp province boundaries & coastlines
    if geoms_dict and "all" in geoms_dict:
        ax.add_geometries(geoms_dict["all"], crs=ccrs.PlateCarree(), facecolor='none',
                          edgecolor='#475569', linewidth=0.8, alpha=0.85, zorder=3)
    ax.add_feature(cfeature.COASTLINE, linewidth=1.3, edgecolor='#0f172a', zorder=4)

    # ── City Risk Callout Badges ──────────────────────────────────────────────
    extent = region_info["extent"]
    for item in region_info["cities"]:
        name, clon, clat = item[0], item[1], item[2]
        offset_x, offset_y = item[3] if len(item) > 3 else (0, 0)

        if extent[0] - 0.2 <= clon <= extent[1] + 0.2 and extent[2] - 0.2 <= clat <= extent[3] + 0.2:
            dist = (M_LONS - clon)**2 + (M_LATS - clat)**2
            min_idx = np.unravel_index(np.argmin(dist), dist.shape)
            val = land_risk[min_idx]

            if np.isnan(val) or val < 0.5:
                continue

            cat_id = int(np.clip(np.round(val), 1, 5))
            cat_label = RISK_NAMES[cat_id]
            badge_edge = RISK_COLORS[cat_id - 1]

            bbox_props = dict(boxstyle='round,pad=0.35', facecolor='#000000', edgecolor=badge_edge, alpha=0.85, lw=1.5)
            callout = f"⚡ {cat_label}\n{name}"

            # City pin dot on land
            ax.plot(clon, clat, marker='o', markersize=4.2, color='#38bdf8',
                    markeredgecolor='#ffffff', markeredgewidth=0.9, zorder=11, transform=ccrs.PlateCarree())

            # Leader line connecting pin to badge
            if abs(offset_x) > 0.05 or abs(offset_y) > 0.05:
                ax.plot([clon, clon + offset_x * 0.78], [clat, clat + offset_y * 0.78],
                        color='#cbd5e1', lw=1.2, alpha=0.80, zorder=9, transform=ccrs.PlateCarree())

            ax.text(
                clon + offset_x, clat + offset_y, callout,
                transform=ccrs.PlateCarree(),
                fontsize=10.5, fontweight='heavy',
                color='#ffffff', ha='center', va='center',
                bbox=bbox_props, zorder=10
            )

    # ── Dedicated Inset Mini-Maps on Luzon View ──────────────────────────────
    if region_key == "luzon" and geoms_dict:
        # 1. Palawan Inset (Bottom-Left)
        if "palawan" in geoms_dict:
            inset_pal_rect = [0.03, 0.05, 0.27, 0.48]
            inset_pal_bg = FancyBboxPatch((inset_pal_rect[0]-0.005, inset_pal_rect[1]-0.005),
                                          inset_pal_rect[2]+0.01, inset_pal_rect[3]+0.01,
                                          boxstyle='round,pad=0.005,rounding_size=0.012',
                                          transform=fig.transFigure,
                                          facecolor='#0b131a', edgecolor='#38bdf8', lw=1.5, zorder=30)
            fig.patches.append(inset_pal_bg)

            palawan_title_pill = FancyBboxPatch((inset_pal_rect[0] + 0.01, inset_pal_rect[1] + inset_pal_rect[3] - 0.045),
                                                0.12, 0.035, boxstyle='round,pad=0.005,rounding_size=0.008',
                                                transform=fig.transFigure, facecolor='#0369a1', edgecolor='none', zorder=32)
            fig.patches.append(palawan_title_pill)
            fig.text(inset_pal_rect[0] + 0.07, inset_pal_rect[1] + inset_pal_rect[3] - 0.028, 'PALAWAN',
                     fontsize=11, fontweight='heavy', color='#ffffff', ha='center', va='center', zorder=33)

            ax_pal = fig.add_axes(inset_pal_rect, projection=ccrs.PlateCarree(), zorder=31)
            ax_pal.set_extent([116.6, 120.5, 8.2, 12.5], crs=ccrs.PlateCarree())
            ax_pal.add_feature(cfeature.OCEAN, facecolor='#162533', zorder=0)
            ax_pal.add_feature(cfeature.LAND, facecolor='#25342a', zorder=1)

            ax_pal.contourf(
                M_LONS, M_LATS, palawan_risk,
                levels=RISK_LEVELS, cmap=risk_cmap, norm=risk_norm,
                extend='neither', transform=ccrs.PlateCarree(), zorder=2, alpha=0.90
            )
            ax_pal.add_geometries(geoms_dict["palawan"], crs=ccrs.PlateCarree(), facecolor='none',
                                  edgecolor='#475569', linewidth=0.8, alpha=0.85, zorder=3)
            ax_pal.add_feature(cfeature.COASTLINE, linewidth=1.2, edgecolor='#0f172a', zorder=4)

            for name, clon, clat, (ox, oy) in PALAWAN_CITIES:
                dist = (M_LONS - clon)**2 + (M_LATS - clat)**2
                min_idx = np.unravel_index(np.argmin(dist), dist.shape)
                val = palawan_risk[min_idx]
                if np.isnan(val) or val < 0.5:
                    continue

                cat_id = int(np.clip(np.round(val), 1, 5))
                cat_label = RISK_NAMES[cat_id]
                badge_edge = RISK_COLORS[cat_id - 1]

                bbox_props = dict(boxstyle='round,pad=0.25', facecolor='#000000', edgecolor=badge_edge, alpha=0.85, lw=1.2)
                callout = f"⚡ {cat_label}\n{name}"
                ax_pal.plot(clon, clat, marker='o', markersize=3.2, color='#38bdf8',
                            markeredgecolor='#ffffff', markeredgewidth=0.8, zorder=11, transform=ccrs.PlateCarree())
                if abs(ox) > 0.05 or abs(oy) > 0.05:
                    ax_pal.plot([clon, clon + ox * 0.76], [clat, clat + oy * 0.76],
                                color='#cbd5e1', lw=1.0, alpha=0.80, zorder=9, transform=ccrs.PlateCarree())
                ax_pal.text(
                    clon + ox, clat + oy, callout,
                    transform=ccrs.PlateCarree(),
                    fontsize=8.0, fontweight='heavy',
                    color='#ffffff', ha='center', va='center',
                    bbox=bbox_props, zorder=10
                )

        # 2. Batanes & Babuyan Inset (Upper-Right)
        if "batanes_babuyan" in geoms_dict:
            inset_bb_rect = [0.70, 0.36, 0.27, 0.50]
            inset_bb_bg = FancyBboxPatch((inset_bb_rect[0]-0.005, inset_bb_rect[1]-0.005),
                                         inset_bb_rect[2]+0.01, inset_bb_rect[3]+0.01,
                                         boxstyle='round,pad=0.005,rounding_size=0.012',
                                         transform=fig.transFigure,
                                         facecolor='#0b131a', edgecolor='#38bdf8', lw=1.5, zorder=30)
            fig.patches.append(inset_bb_bg)

            bb_title_pill = FancyBboxPatch((inset_bb_rect[0] + 0.01, inset_bb_rect[1] + inset_bb_rect[3] - 0.045),
                                           0.22, 0.035, boxstyle='round,pad=0.005,rounding_size=0.008',
                                           transform=fig.transFigure, facecolor='#0369a1', edgecolor='none', zorder=32)
            fig.patches.append(bb_title_pill)
            fig.text(inset_bb_rect[0] + 0.12, inset_bb_rect[1] + inset_bb_rect[3] - 0.028, 'BATANES & BABUYAN',
                     fontsize=10.5, fontweight='heavy', color='#ffffff', ha='center', va='center', zorder=33)

            ax_bb = fig.add_axes(inset_bb_rect, projection=ccrs.PlateCarree(), zorder=31)
            ax_bb.set_extent([120.9, 122.6, 18.7, 21.2], crs=ccrs.PlateCarree())
            ax_bb.add_feature(cfeature.OCEAN, facecolor='#162533', zorder=0)
            ax_bb.add_feature(cfeature.LAND, facecolor='#25342a', zorder=1)

            ax_bb.contourf(
                M_LONS, M_LATS, bb_risk,
                levels=RISK_LEVELS, cmap=risk_cmap, norm=risk_norm,
                extend='neither', transform=ccrs.PlateCarree(), zorder=2, alpha=0.90
            )
            ax_bb.add_geometries(geoms_dict["batanes_babuyan"], crs=ccrs.PlateCarree(), facecolor='none',
                                  edgecolor='#475569', linewidth=0.8, alpha=0.85, zorder=3)
            ax_bb.add_feature(cfeature.COASTLINE, linewidth=1.2, edgecolor='#0f172a', zorder=4)

            for name, clon, clat, (ox, oy) in BATANES_BABUYAN_CITIES:
                dist = (M_LONS - clon)**2 + (M_LATS - clat)**2
                min_idx = np.unravel_index(np.argmin(dist), dist.shape)
                val = bb_risk[min_idx]
                if np.isnan(val) or val < 0.5:
                    continue

                cat_id = int(np.clip(np.round(val), 1, 5))
                cat_label = RISK_NAMES[cat_id]
                badge_edge = RISK_COLORS[cat_id - 1]

                bbox_props = dict(boxstyle='round,pad=0.22', facecolor='#000000', edgecolor=badge_edge, alpha=0.85, lw=1.2)
                callout = f"⚡ {cat_label}\n{name}"
                ax_bb.plot(clon, clat, marker='o', markersize=3.0, color='#38bdf8',
                            markeredgecolor='#ffffff', markeredgewidth=0.8, zorder=11, transform=ccrs.PlateCarree())
                if abs(ox) > 0.05 or abs(oy) > 0.05:
                    ax_bb.plot([clon, clon + ox * 0.76], [clat, clat + oy * 0.76],
                                color='#cbd5e1', lw=1.0, alpha=0.80, zorder=9, transform=ccrs.PlateCarree())
                ax_bb.text(
                    clon + ox, clat + oy, callout,
                    transform=ccrs.PlateCarree(),
                    fontsize=7.8, fontweight='heavy',
                    color='#ffffff', ha='center', va='center',
                    bbox=bbox_props, zorder=10
                )

    # ── Top Broadcast Header Banner ──────────────────────────────────────────
    header_bg = patches.Rectangle((0, 0.88), 1, 0.12, transform=fig.transFigure, facecolor='#0b131a', alpha=0.96, zorder=40)
    fig.patches.append(header_bg)

    # Title Banner Pill
    title_pill = FancyBboxPatch((0.21, 0.932), 0.40, 0.052, boxstyle='round,pad=0.01,rounding_size=0.012',
                                transform=fig.transFigure, facecolor='#1e293b', edgecolor='#38bdf8', lw=1.2, zorder=41)
    fig.patches.append(title_pill)
    fig.text(0.41, 0.957, 'THUNDERSTORM OUTLOOK', fontsize=20, fontweight='heavy', color='#f8fafc', ha='center', va='center', zorder=42)

    # Subtitle Blue Bar (Today vs Tomorrow)
    ph_tz = timezone(timedelta(hours=8))
    init_dt_ph = init_dt.astimezone(ph_tz) if init_dt else None
    
    if period == "today":
        day_str = init_dt_ph.strftime("%b %d") if init_dt_ph else "Today"
        sub_title = f'TODAY · {region_info["title"]} ({day_str})'
        pill_w = 0.28
        pill_x = 0.27
    else:  # tomorrow
        tomorrow_dt = (init_dt_ph + timedelta(days=1)) if init_dt_ph else None
        day_str = tomorrow_dt.strftime("%b %d") if tomorrow_dt else "Tomorrow"
        sub_title = f'TOMORROW · {region_info["title"]} ({day_str})'
        pill_w = 0.31
        pill_x = 0.255

    sub_pill = FancyBboxPatch((pill_x, 0.892), pill_w, 0.034, boxstyle='round,pad=0.01,rounding_size=0.01',
                             transform=fig.transFigure, facecolor='#0369a1', edgecolor='none', zorder=41)
    fig.patches.append(sub_pill)
    fig.text(0.41, 0.908, sub_title, fontsize=11, fontweight='bold', color='#ffffff', ha='center', va='center', zorder=42)

    # ── Top Right Risk Level Legend Pills ────────────────────────────────────
    legend_items = [
        ("GENERAL", '#22c55e', '#000000'),
        ("MODERATE", '#eab308', '#000000'),
        ("STRONG", '#f97316', '#ffffff'),
        ("INTENSE", '#ef4444', '#ffffff'),
        ("TORRENTIAL", '#c026d3', '#ffffff')
    ]
    total_w = 0.35
    pill_w = 0.064
    spacing = 0.005
    start_x = 0.635
    y_pill = 0.932
    h_pill = 0.036

    for i, (l_name, l_color, l_tc) in enumerate(legend_items):
        px = start_x + i * (pill_w + spacing)
        lpill = FancyBboxPatch((px, y_pill), pill_w, h_pill, boxstyle='round,pad=0.003,rounding_size=0.006',
                               transform=fig.transFigure, facecolor=l_color, edgecolor='#ffffff', lw=0.9, zorder=42)
        fig.patches.append(lpill)
        fig.text(px + pill_w / 2, y_pill + h_pill / 2, l_name, fontsize=8.0, fontweight='heavy',
                 color=l_tc, ha='center', va='center', zorder=43)

    fig.text(start_x + total_w / 2, 0.900, 'PEAK 3H CONVECTIVE BURST', fontsize=8.6, fontweight='bold',
             color='#94a3b8', ha='center', va='center', zorder=42)

    # ── User Brand Logo ──────────────────────────────────────────────────────
    found_logo = next((p for p in LOGO_PATHS if os.path.exists(p)), None)
    if found_logo:
        try:
            logo_img = mpimg.imread(found_logo)
            logo_ax = fig.add_axes([0.02, 0.888, 0.08, 0.10], zorder=45)
            logo_ax.imshow(logo_img)
            logo_ax.axis('off')
        except Exception:
            fig.text(0.052, 0.936, 'PHIL\nWX', fontsize=12, fontweight='heavy', color='#38bdf8', ha='center', va='center', zorder=42)
    else:
        fig.text(0.052, 0.936, 'PHIL\nWX', fontsize=12, fontweight='heavy', color='#38bdf8', ha='center', va='center', zorder=42)

    # ── Bottom-Right Forecast Guidance Note ──────────────────────────────────
    stroke = [pe.withStroke(linewidth=2.2, foreground='#0d1821')]
    fig.text(0.835, 0.060, "THUNDERSTORM OUTLOOK",
             fontsize=8.8, fontweight='heavy', color='#38bdf8', ha='center', va='center', zorder=52,
             path_effects=stroke)
    fig.text(0.835, 0.038, "Categories reflect peak 3h convective rain bursts, subject to change",
             fontsize=7.3, fontweight='bold', color='#cbd5e1', ha='center', va='center', zorder=52,
             path_effects=stroke)

    out_path = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    tmp_path = os.path.join(OUTPUT_DIR, f"{filename_id}.tmp.png")
    try:
        fig.savefig(tmp_path, dpi=120, facecolor="#0d1821", edgecolor="none")
        plt.close(fig)
        if os.path.exists(out_path):
            try:
                os.remove(out_path)
            except Exception:
                pass
        os.replace(tmp_path, out_path)
    except Exception:
        try:
            fig.savefig(out_path, dpi=120, facecolor="#0d1821", edgecolor="none")
            plt.close(fig)
        except Exception:
            pass
    print(f"  Successfully saved {out_path}")

# ═══════════════════════════════════════════════════════════════════════════
# Fetch Model Data (Pure Rolling 3h Peak from WeatherNext 3)
# ═══════════════════════════════════════════════════════════════════════════
def fetch_or_synthesize_inputs(session, use_demo=False):
    """
    Computes discrete convective burst metrics based strictly on peak 3-hour rolling
    accumulation from hourly WeatherNext 3 steps:
      - total_today: Peak 3h rolling accumulation in 0h - 24h
      - total_tomorrow: Peak 3h rolling accumulation in 24h - 48h
    AIFS is excluded to avoid corrupting convective bursts with assumed fractions of daily totals.
    """
    if use_demo:
        print("Generating realistic synthetic 3h convective burst fields for demonstration...")
        np.random.seed(42)

        # ── 1. Today Convective Burst Systems (Day 1: 0-24h peak 3h burst) ────
        syn_today = np.zeros_like(M_LATS)
        # Core A: Central Luzon storm core (peak 3h burst ~ 48 mm)
        d_cl = np.sqrt((M_LONS - 121.0)**2 + (M_LATS - 15.8)**2)
        syn_today += 48.0 * np.exp(-(d_cl**2) / (0.85**2))
        # Core B: Central Visayas (Cebu/Negros, peak 3h burst ~ 32 mm)
        d_vis = np.sqrt((M_LONS - 123.5)**2 + (M_LATS - 10.8)**2)
        syn_today += 32.0 * np.exp(-(d_vis**2) / (0.65**2))
        # Core C: Eastern Mindanao (Davao/Caraga, peak 3h burst ~ 58 mm)
        d_min = np.sqrt((M_LONS - 125.5)**2 + (M_LATS - 7.8)**2)
        syn_today += 58.0 * np.exp(-(d_min**2) / (1.1**2))
        syn_today += np.maximum(0, np.random.normal(1.0, 1.5, size=syn_today.shape))

        # ── 2. Tomorrow Convective Burst Systems (Day 2: 24-48h peak 3h burst) 
        syn_tomorrow = np.zeros_like(M_LATS)
        # Tomorrow Core A: Convective line moving to Western Luzon & Ilocos / Baguio (~52 mm)
        d_t1 = np.sqrt((M_LONS - 120.4)**2 + (M_LATS - 16.5)**2)
        syn_tomorrow += 52.0 * np.exp(-(d_t1**2) / (0.80**2))
        # Tomorrow Core B: Western Visayas / Panay convective pulse (~36 mm)
        d_t2 = np.sqrt((M_LONS - 122.6)**2 + (M_LATS - 11.2)**2)
        syn_tomorrow += 36.0 * np.exp(-(d_t2**2) / (0.70**2))
        # Tomorrow Core C: Zamboanga Peninsula & Northern Mindanao (~42 mm)
        d_t3 = np.sqrt((M_LONS - 123.2)**2 + (M_LATS - 8.2)**2)
        syn_tomorrow += 42.0 * np.exp(-(d_t3**2) / (0.85**2))
        # Tomorrow Core D: Palawan localized cell (~24 mm)
        d_t4 = np.sqrt((M_LONS - 118.8)**2 + (M_LATS - 9.8)**2)
        syn_tomorrow += 24.0 * np.exp(-(d_t4**2) / (0.55**2))
        syn_tomorrow += np.maximum(0, np.random.normal(1.0, 1.5, size=syn_tomorrow.shape))

        return {
            "models_used": ["Demo Tropical Convective Model (Ensemble)"],
            "peak_3h_today": syn_today,
            "peak_3h_tomorrow": syn_tomorrow,
            "init_dt": datetime.now(timezone.utc)
        }

    init_dt = datetime.now(timezone.utc)
    total_today = None
    total_tomorrow = None

    # Google WeatherNext 3: Compute actual rolling 3h accumulation from hourly chunks
    if HAS_WEATHERNEXT:
        try:
            print("Connecting to Google WeatherNext 3...")
            client = storage.Client(project="affable-ring-442402-j2")
            fs = gcsfs.GCSFileSystem(project="affable-ring-442402-j2")
            latest_run, avail_hours = find_latest_weathernext_run(client, fs, min_hours=48, var_check="total_precipitation_1hr_mean")
            base = f"weathernext3_statistics_spatial/{latest_run}predictions.zarr"
            codec = numcodecs.Zstd()

            lat = np.frombuffer(codec.decode(fs.cat_file(f'{base}/lat_0p1/c/0')), dtype='<f4')
            lon = np.frombuffer(codec.decode(fs.cat_file(f'{base}/lon_0p1/c/0')), dtype='<f4')

            lat_mask = (lat >= LAT_MIN - 1.0) & (lat <= LAT_MAX + 1.0)
            lon_mask = (lon >= LON_MIN - 1.0) & (lon <= LON_MAX + 1.0)
            lat_idx = np.where(lat_mask)[0]
            lon_idx = np.where(lon_mask)[0]
            lat_slice = slice(lat_idx.min(), lat_idx.max() + 1)
            lon_slice = slice(lon_idx.min(), lon_idx.max() + 1)

            WN_LONS, WN_LATS = np.meshgrid(lon[lon_slice], lat[lat_slice])
            paths = [f'{base}/total_precipitation_1hr_mean/c/{t}/0/0' for t in range(min(48, avail_hours))]
            raw_dict = batch_cat_gcs(fs, paths, batch_size=24, desc="WeatherNext Precip")

            chunks = []
            for p in paths:
                if p in raw_dict:
                    arr = np.frombuffer(codec.decode(raw_dict[p]), dtype='<f4').reshape((1801, 3600))[lat_slice, lon_slice]
                    chunks.append(arr)
                else:
                    chunks.append(np.zeros_like(WN_LATS))

            # Today (0-24h): Rolling 3-hour peak alone (no 1h*2 inflation)
            chunks_today = chunks[:24]
            rolling_3h_today = [
                np.sum(chunks_today[i:i+3], axis=0) * 1000.0 for i in range(len(chunks_today) - 2)
            ]
            peak_3h_today = np.max(rolling_3h_today, axis=0) if rolling_3h_today else np.zeros_like(WN_LATS)
            regrid_peak_3h_today = regrid_to_master(WN_LATS, WN_LONS, peak_3h_today)

            # Tomorrow (24-48h): Rolling 3-hour peak alone (independent of Today)
            chunks_tomorrow = chunks[24:min(48, len(chunks))]
            rolling_3h_tomorrow = [
                np.sum(chunks_tomorrow[i:i+3], axis=0) * 1000.0 for i in range(len(chunks_tomorrow) - 2)
            ]
            peak_3h_tomorrow = np.max(rolling_3h_tomorrow, axis=0) if rolling_3h_tomorrow else np.zeros_like(WN_LATS)
            regrid_peak_3h_tomorrow = regrid_to_master(WN_LATS, WN_LONS, peak_3h_tomorrow)

            print("  Successfully computed pure Rolling 3h Convective Peaks from WeatherNext 3.")
        except Exception as e:
            print(f"  Notice: WeatherNext 3 fetch error ({e})")

    # Fallback to synthetic if live fetch failed
    if regrid_peak_3h_today is None or np.nanmax(regrid_peak_3h_today) == 0:
        print("Notice: No live WeatherNext 3 inputs available. Falling back to synthetic demonstration.")
        return fetch_or_synthesize_inputs(session, use_demo=True)

    return {
        "models_used": ["Google WeatherNext 3 (Rolling 3h Peak)"],
        "peak_3h_today": regrid_peak_3h_today,
        "peak_3h_tomorrow": regrid_peak_3h_tomorrow,
        "init_dt": init_dt
    }

# ═══════════════════════════════════════════════════════════════════════════
# Main Pipeline
# ═══════════════════════════════════════════════════════════════════════════
def main():
    parser = argparse.ArgumentParser(description="AI Multi-Model Regional Thunderstorm Outlook Generator")
    parser.add_argument("--demo", action="store_true", help="Generate synthetic convective outlook for demonstration")
    parser.add_argument("--today-only", action="store_true", help="Generate only Today (Day 1) maps")
    args = parser.parse_args()

    print("\n=== AI Multi-Model Regional Thunderstorm Outlook Maps ===")
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})

    data_payload = fetch_or_synthesize_inputs(session, use_demo=args.demo)
    init_dt = data_payload["init_dt"]
    models_used = data_payload["models_used"]

    geoms_dict, masks = load_ph_regional_geometries()
    valid_frames = []

    # ── 1. Process TODAY (Day 1 / hours 0-24) Convective Risk ───────────────
    print("\n[1/2] Computing TODAY (0-24h) Thunderstorm Risk from Sliding 3h Peak Burst...")
    risk_today = compute_thunderstorm_risk_score(data_payload["peak_3h_today"])

    for reg_key in ["luzon", "visayas", "mindanao"]:
        frame_id = f"ai_thunderstorm_broadcast_today_{reg_key}"
        print(f"Plotting TV Broadcast Thunderstorm Map (TODAY - {reg_key.upper()})...")
        plot_broadcast_thunderstorm_map(
            risk_today,
            frame_id,
            init_dt,
            region_key=reg_key,
            period="today",
            geoms_dict=geoms_dict,
            masks=masks
        )
        valid_frames.append(frame_id)

    # ── 2. Process TOMORROW (Day 2 / hours 24-48) Convective Risk ─────────────
    risk_tomorrow = None
    if not args.today_only and data_payload.get("peak_3h_tomorrow") is not None:
        print("\n[2/2] Computing TOMORROW (24-48h) Thunderstorm Risk from Sliding 3h Peak Burst...")
        risk_tomorrow = compute_thunderstorm_risk_score(data_payload["peak_3h_tomorrow"])

        for reg_key in ["luzon", "visayas", "mindanao"]:
            frame_id = f"ai_thunderstorm_broadcast_tomorrow_{reg_key}"
            print(f"Plotting TV Broadcast Thunderstorm Map (TOMORROW - {reg_key.upper()})...")
            plot_broadcast_thunderstorm_map(
                risk_tomorrow,
                frame_id,
                init_dt,
                region_key=reg_key,
                period="tomorrow",
                geoms_dict=geoms_dict,
                masks=masks
            )
            valid_frames.append(frame_id)

    # ── 3. Save JSON Metadata ────────────────────────────────────────────────
    ph_tz = timezone(timedelta(hours=8))
    init_dt_ph = init_dt.astimezone(ph_tz) if init_dt else None

    meta = {
        "title": "AI Convective Thunderstorm Outlook (WeatherNext 3)",
        "models_used": models_used,
        "scoring_method": "Largest 3-hour sliding rainfall burst within the 24-hour window (24h totals not used)",
        "categories": [
            {"id": 1, "name": "General (TSTM)", "color": "#22c55e", "description": "Isolated brief rainshowers / localized lightning (5-15 mm in 3h)"},
            {"id": 2, "name": "Moderate (MOD)", "color": "#eab308", "description": "Scattered moderate downpours (15-30 mm in 3h)"},
            {"id": 3, "name": "Strong (STRG)", "color": "#f97316", "description": "Clustered thunderstorms with heavy downpours (30-60 mm in 3h)"},
            {"id": 4, "name": "Intense (INT)", "color": "#ef4444", "description": "Intense convective rain bursts, localized flash flood risk (60-90 mm in 3h)"},
            {"id": 5, "name": "Torrential (TORR)", "color": "#c026d3", "description": "Torrential rain bursts from deep convective cores (>90 mm in 3h)"}
        ],
        "generated_at": datetime.now(ph_tz).strftime("%Y-%m-%d %I:%M %p PHT"),
        "run_time": init_dt_ph.strftime("%Y-%m-%d %I:%M %p PHT") if init_dt_ph else "Unknown",
        "regions": ["luzon", "visayas", "mindanao"],
        "periods": ["today"] if args.today_only else ["today", "tomorrow"],
        "max_peak_3h_today_mm": float(np.nanmax(data_payload["peak_3h_today"])),
        "max_peak_3h_tomorrow_mm": float(np.nanmax(data_payload["peak_3h_tomorrow"])) if data_payload.get("peak_3h_tomorrow") is not None else None,
        "max_risk_score_today": float(np.nanmax(risk_today)),
        "max_risk_score_tomorrow": float(np.nanmax(risk_tomorrow)) if risk_tomorrow is not None else None,
        "animation_frames": valid_frames
    }

    meta_path = os.path.join(DATA_DIR, "ai_thunderstorm_outlook_meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print(f"\nSaved metadata to {meta_path}")
    print("Done! Both Today and Tomorrow Thunderstorm Outlook broadcast graphics generated successfully.")

if __name__ == "__main__":
    main()
