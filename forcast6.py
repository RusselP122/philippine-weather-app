import os
import json
import warnings
from datetime import datetime, timedelta, timezone
import requests
import subprocess
import numpy as np
import pandas as pd
from shapely.geometry import shape, Point, MultiPoint, Polygon
from shapely.ops import unary_union
from shapely.validation import make_valid
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.patches import FancyBboxPatch, Circle, Polygon as MplPolygon
import matplotlib.patheffects as patheffects
import matplotlib.image as mpimg
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from sklearn.cluster import DBSCAN

# Suppress minor cartopy/shapely warnings during rendering
warnings.filterwarnings("ignore")

# ── Configuration & Paths ──────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
IMAGES_DIR = os.path.join(BASE_DIR, "public", "images")
TEMP_DATA_DIR = os.path.join(BASE_DIR, "temp_data")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(IMAGES_DIR, exist_ok=True)
os.makedirs(TEMP_DATA_DIR, exist_ok=True)

LOGO_PATHS = [
    os.path.join(IMAGES_DIR, "logo.png"),
    os.path.join(BASE_DIR, "public", "logo512.png"),
    os.path.join(BASE_DIR, "public", "logo192.png"),
]

MIN_GENESIS_WIND_KT = 25.0
OUTPUT_IMAGE = os.path.join(IMAGES_DIR, "tropical_outlook_week2_latest.png")
OUTPUT_JSON = os.path.join(DATA_DIR, "tropical_outlook_week2.json")

# Philippine Area of Responsibility (PAR) boundary vertices & solid color
PAR_COLOR = "#7c2d12"
PAR_VERTICES = [
    (115.0, 5.0), (115.0, 15.0), (120.0, 21.0), (120.0, 25.0),
    (135.0, 25.0), (135.0, 5.0), (115.0, 5.0)
]

# Comprehensive catalog of Philippine & Regional reference coastal cities
ALL_CITIES = [
    # North & Central Luzon
    ("LAOAG", 120.59, 18.20, (0.55, 0.20)),
    ("VIGAN", 120.39, 17.57, (-0.60, 0.15)),
    ("TUGUEGARAO", 121.72, 17.61, (0.75, 0.25)),
    ("BAGUIO", 120.59, 16.41, (0.75, 0.20)),
    ("SAN FERNANDO", 120.32, 16.62, (-0.85, 0.15)),
    ("DAGUPAN", 120.34, 16.04, (-0.65, -0.25)),
    ("BALER", 121.56, 15.76, (0.65, 0.20)),
    ("MANILA", 120.98, 14.59, (0.65, -0.15)),
    ("BATANGAS", 121.05, 13.75, (-0.75, 0.10)),
    # Mimaropa & Bicol
    ("PUERTO PRINCESA", 118.73, 9.74, (0.90, 0.10)),
    ("CORON", 120.20, 12.00, (0.60, 0.20)),
    ("CALAPAN", 121.18, 13.41, (0.75, -0.20)),
    ("DAET", 122.96, 14.11, (0.65, 0.20)),
    ("NAGA", 123.19, 13.62, (0.65, 0.20)),
    ("LEGAZPI", 123.73, 13.14, (0.75, -0.20)),
    # Visayas
    ("ILOILO", 122.56, 10.72, (-0.75, -0.25)),
    ("BACOLOD", 122.95, 10.67, (0.70, 0.15)),
    ("CEBU CITY", 123.89, 10.31, (0.80, 0.10)),
    ("TAGBILARAN", 123.85, 9.65, (-0.70, -0.20)),
    ("DUMAGUETE", 123.30, 9.31, (-0.75, -0.20)),
    ("TACLOBAN", 125.00, 11.24, (0.80, 0.25)),
    ("CATBALOGAN", 124.88, 11.77, (0.75, 0.20)),
    ("GUIUAN", 125.72, 11.03, (0.70, -0.20)),
    # Mindanao
    ("SURIGAO", 125.49, 9.79, (0.75, 0.20)),
    ("BUTUAN", 125.54, 8.95, (0.70, 0.20)),
    ("CAGAYAN DE ORO", 124.63, 8.48, (0.0, 0.45)),
    ("DAVAO", 125.60, 7.19, (0.70, -0.15)),
    ("GENERAL SANTOS", 125.17, 6.11, (0.85, -0.15)),
    ("ZAMBOANGA", 122.07, 6.92, (-0.85, -0.30)),
    # Regional Pacific & Asian anchors
    ("TAIPEI", 121.56, 25.03, (0.65, 0.35)),
    ("OKINAWA", 127.68, 26.21, (0.80, 0.35)),
    ("GUAM", 144.79, 13.44, (0.70, 0.25)),
    ("PALAU", 134.48, 7.34, (0.70, -0.25)),
    ("YAP", 138.12, 9.52, (0.65, 0.25)),
    ("HONG KONG", 114.17, 22.32, (-0.80, 0.25))
]

# ── Helper Functions ────────────────────────────────────────────────────────
def get_category(prob):
    """Categorize development probability."""
    if prob < 40:
        return "low"
    elif prob <= 60:
        return "medium"
    else:
        return "high"

def get_area_color(prob):
    """Return broadcast outline/fill color according to development probability."""
    if prob < 40:
        return "#facc15"  # Vibrant yellow (Low)
    elif prob <= 60:
        return "#f97316"  # Orange (Medium)
    else:
        return "#ef4444"  # Red (High)

def round_prob(p):
    """Round probability: if >0 and <10, round up to 10% like NHC/Fox Weather."""
    if p <= 0:
        return 0
    elif p < 10:
        return 10
    else:
        return int(10 * round(p / 10))

def classify_tc_stage(max_wind_kt):
    """Classify cyclone intensity stage based on max sustained wind in knots."""
    try:
        w = float(max_wind_kt)
    except Exception:
        return "Unknown"

    if w < 20:
        return "Disturbance / LPA"
    elif w < 25:
        return "Low Pressure Area"
    elif w < 34:
        return "Tropical Depression"
    elif w < 48:
        return "Tropical Storm"
    elif w < 64:
        return "Severe Tropical Storm"
    else:
        return "Typhoon"

def get_region_name(lat, lon):
    """Returns concise geographic basin region tag."""
    if lon < 120.0:
        return "West PH Sea"
    elif lon <= 135.0:
        return "Philippine Sea"
    elif lon <= 145.0:
        return "Near Marianas"
    else:
        return "Pacific Ocean"

def load_ph_provinces():
    """Load Philippine province geometries from JSON for crisp cartography."""
    search_paths = [
        os.path.join(DATA_DIR, "ph_provinces.json"),
        os.path.join(BASE_DIR, "ph_provinces.json"),
        "public/data/ph_provinces.json"
    ]
    for p in search_paths:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    geo_data = json.load(f)
                return [make_valid(shape(feat["geometry"])) for feat in geo_data.get("features", [])]
            except Exception as e:
                print(f"Notice loading provinces from {p}: {e}")
    return []

# ── Dynamic Threat-Focused Extent Calculator ────────────────────────────────
def compute_dynamic_extent(areas, active_tcs=None):
    """
    Computes a threat-focused 16:9 widescreen bounding box for Week 2.
    Centers dynamically on the development area(s) + the threatened Philippine coast,
    preventing empty dead ocean space while ensuring dramatic on-air presentation.
    """
    all_lons = []
    all_lats = []

    for a in areas:
        for poly in a.get("polygons", []):
            for pt in poly:
                all_lats.append(pt[0])
                all_lons.append(pt[1])

    if not all_lons:
        return [113.0, 139.67, 4.0, 19.0]

    threat_min_lon, threat_max_lon = min(all_lons), max(all_lons)
    threat_min_lat, threat_max_lat = min(all_lats), max(all_lats)
    center_threat_lon = (threat_min_lon + threat_max_lon) / 2.0

    ref_points = []
    if center_threat_lon < 123.0:
        ref_points.extend([(120.6, 18.2), (120.6, 16.4), (121.0, 14.6), (120.3, 16.0), (121.0, 13.8), (123.7, 13.1)])
    if center_threat_lon > 122.0:
        ref_points.extend([(123.7, 13.1), (125.0, 11.2), (125.6, 7.2), (123.9, 10.3), (121.7, 17.6)])

    # If there are areas stretching far east (> 140E) as well as near Philippines, include full PH
    if threat_min_lon < 122.0 and threat_max_lon > 140.0:
        ref_points.extend([(118.7, 9.7), (120.6, 18.2), (125.6, 7.2), (121.0, 14.6)])

    for rlon, rlat in ref_points:
        all_lons.append(rlon)
        all_lats.append(rlat)

    min_lon, max_lon = min(all_lons), max(all_lons)
    min_lat, max_lat = min(all_lats), max(all_lats)

    pad_x = 3.5
    pad_y = 2.5
    w = max(max_lon - min_lon + 2 * pad_x, 21.0)
    h = max(max_lat - min_lat + 2 * pad_y, 11.81)

    target_ratio = 16.0 / 9.0
    if w / h < target_ratio:
        w = h * target_ratio
    else:
        h = w / target_ratio

    c_lon = (min_lon + max_lon) / 2.0
    c_lat = (min_lat + max_lat) / 2.0

    if center_threat_lon < 120.0:
        c_lon += 1.2

    extent = [
        round(c_lon - w / 2.0, 2),
        round(c_lon + w / 2.0, 2),
        round(c_lat - h / 2.0, 2),
        round(c_lat + h / 2.0, 2)
    ]
    return extent

# ── WNv3 Cyclogenesis Data Ingestion ────────────────────────────────────────
def get_latest_wnv3_run():
    """
    Finds the latest available Google WeatherNext 3 (WNV3) cyclogenesis ensemble CSV.
    Checks remote DeepMind WeatherLab first, with fallback to local caches.
    """
    base_url = "https://deepmind.google.com/science/weatherlab/download/cyclones/WNV3/ensemble/cyclogenesis/csv"
    today = datetime.now(timezone.utc).date()
    dates = [today - timedelta(days=i) for i in range(5)]
    hours = ["18", "12", "06", "00"]

    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})

    for d in dates:
        d_str = d.strftime("%Y_%m_%d")
        for h in hours:
            fn = f"WNV3_{d_str}T{h}_00_cyclogenesis.csv"
            local_target = os.path.join(DATA_DIR, fn)
            if os.path.exists(local_target) and os.path.getsize(local_target) > 100000:
                print(f"WeatherNext 3: Found current local run {d_str} {h}:00Z -> {local_target}")
                return d_str, h, None, local_target

            url = f"{base_url}/{fn}"
            try:
                resp = session.head(url, allow_redirects=True, timeout=4)
                if resp.status_code == 200:
                    print(f"WeatherNext 3: Found latest online run {d_str} {h}:00Z at {url}")
                    return d_str, h, url, local_target
            except requests.RequestException:
                continue

    for d in dates:
        d_str = d.strftime("%Y_%m_%d")
        for h in hours:
            fn = f"WNV3_{d_str}T{h}_00_cyclogenesis.csv"
            fallback_path = os.path.join(TEMP_DATA_DIR, fn)
            if os.path.exists(fallback_path) and os.path.getsize(fallback_path) > 100000:
                print(f"WeatherNext 3: Using fallback cached run {d_str} {h}:00Z -> {fallback_path}")
                return d_str, h, None, fallback_path

    raise RuntimeError("No available WeatherNext 3 (WNV3) cyclogenesis runs found in the last 4 days.")

# ── Main Execution ──────────────────────────────────────────────────────────
def main():
    print("=== Google WeatherNext 3 (WNv3) Week 2 Tropical Weather Outlook ===")
    
    date_str, hour_str, remote_url, local_csv = get_latest_wnv3_run()

    if remote_url and not os.path.exists(local_csv):
        print(f"Downloading WeatherNext 3 CSV to {local_csv}...")
        try:
            subprocess.run(["curl", "-L", "-o", local_csv, remote_url], check=True)
        except Exception as curl_err:
            print(f"curl download failed ({curl_err}), trying requests...")
            r = requests.get(remote_url, timeout=30)
            with open(local_csv, "wb") as f:
                f.write(r.content)

    print(f"Reading dataset: {local_csv}")
    data = pd.read_csv(local_csv, comment="#")

    # Timestamps
    latest_utc = datetime.strptime(f"{date_str} {hour_str}", "%Y_%m_%d %H").replace(tzinfo=timezone.utc)
    ph_tz = timezone(timedelta(hours=8))
    latest_ph = latest_utc.astimezone(ph_tz)
    time_label = latest_ph.strftime("%I:%M %p").lstrip("0")
    date_text = latest_ph.strftime('%B %d, %Y')
    init_text = f"{time_label} PHT, {date_text}"
    nine_day_day = (latest_ph + timedelta(days=9)).strftime("%a")
    fourteen_day_day = (latest_ph + timedelta(days=14)).strftime("%a")

    if "lead_time" in data.columns and "lead_time_hours" not in data.columns:
        data["lead_time_hours"] = pd.to_timedelta(data["lead_time"]).dt.total_seconds() / 3600.0

    # Filter Week 2 window (168 to 336 hours = Days 8 to 14) with threshold wind
    wp_data = data[
        (data["lead_time_hours"] <= 336) &
        (data["maximum_sustained_wind_speed_knots"] >= MIN_GENESIS_WIND_KT)
    ].copy()

    total_samples = len(data[data["lead_time_hours"] <= 336]["sample"].unique())
    if total_samples == 0:
        total_samples = 64

    print(f"Initialization: {init_text} | Total ensemble members: {total_samples}")

    # Process Potential Formation Areas for Week 2
    potential_ids = [tid for tid in wp_data["track_id"].unique() if str(tid).isdigit()]
    wp_potentials = wp_data[wp_data["track_id"].isin(potential_ids)].copy()

    genesis_data = pd.DataFrame()
    if not wp_potentials.empty:
        wp_potentials = wp_potentials.sort_values(by=["init_time", "track_id", "sample", "lead_time_hours"])
        genesis_data = wp_potentials.loc[
            wp_potentials.groupby(["init_time", "track_id", "sample"])["lead_time_hours"].idxmin()
        ]
        genesis_data = genesis_data[
            (genesis_data["lead_time_hours"] >= 168) &
            (genesis_data["lead_time_hours"] <= 336)
        ]
        mask = (
            (genesis_data["lon"] >= 105.0) & (genesis_data["lon"] <= 165.0) &
            (genesis_data["lat"] >= 0.0) & (genesis_data["lat"] <= 38.0)
        )
        genesis_data = genesis_data[mask]

    print(f"Total Week 2 potential genesis points in WP: {len(genesis_data)}")

    # ── Cluster Genesis Points (DBSCAN) ───────────────────────────────────────
    json_areas = []
    display_areas = []

    if len(genesis_data) >= 2:
        coords = np.column_stack((genesis_data["lon"].values, genesis_data["lat"].values))
        db = DBSCAN(eps=4.0, min_samples=2).fit(coords)
        unique_labels = sorted(set(db.labels_) - {-1})

        for i, lbl in enumerate(unique_labels, start=1):
            cluster_mask = (db.labels_ == lbl)
            c_pts = genesis_data.iloc[cluster_mask]
            c_lons = c_pts["lon"].values
            c_lats = c_pts["lat"].values

            s_14day = c_pts["sample"].unique()
            prob_14day = len(s_14day) / total_samples * 100
            s_9day = c_pts[c_pts["lead_time_hours"] <= 216]["sample"].unique()
            prob_9day = len(s_9day) / total_samples * 100

            prob_9day_rounded = round_prob(prob_9day)
            prob_14day_rounded = round_prob(prob_14day)

            cat_9day = get_category(prob_9day_rounded)
            cat_14day = get_category(prob_14day_rounded)
            area_color = get_area_color(prob_14day_rounded)

            center_lon = float(np.mean(c_lons))
            center_lat = float(np.mean(c_lats))

            pts = np.column_stack((c_lons, c_lats))
            area_polys_json = []

            if len(pts) == 1:
                c_geom = Point(center_lon, center_lat).buffer(2.8)
                ext = list(c_geom.exterior.coords)
                area_polys_json.append([[lat, lon] for lon, lat in ext])
            else:
                hull = MultiPoint(pts).convex_hull
                buffered = hull.buffer(2.5, join_style="round")
                if isinstance(buffered, Polygon):
                    ext = list(buffered.exterior.coords)
                    area_polys_json.append([[lat, lon] for lon, lat in ext])
                elif hasattr(buffered, "geoms"):
                    for poly in buffered.geoms:
                        ext = list(poly.exterior.coords)
                        area_polys_json.append([[lat, lon] for lon, lat in ext])

            stage = classify_tc_stage(c_pts["maximum_sustained_wind_speed_knots"].mean())
            area_text = f"Area {i}: {prob_9day_rounded}% (Day 8-9) · {prob_14day_rounded}% (Day 8-14)"
            summary_line = f"Area {i}: {cat_14day.title()} potential ({prob_14day_rounded}%) of tropical cyclone formation during Week 2."

            json_areas.append({
                "id": i,
                "probability_2day": prob_9day_rounded,
                "probability_7day": prob_14day_rounded,
                "category_2day": cat_9day,
                "category_7day": cat_14day,
                "center": [center_lat, center_lon],
                "color": area_color,
                "stage": stage,
                "polygons": area_polys_json,
                "text": area_text,
                "summary": summary_line
            })

            display_areas.append({
                "id": i,
                "prob_2day": prob_9day_rounded,
                "prob_7day": prob_14day_rounded,
                "color": area_color,
                "cat": cat_14day,
                "center": [center_lat, center_lon],
                "polygons": area_polys_json
            })

    display_areas = sorted(display_areas, key=lambda x: x["prob_7day"], reverse=True)

    # ── Compute Dynamic Threat-Focused Extent ──────────────────────────────────
    extent = compute_dynamic_extent(json_areas)
    print(f"Dynamic Threat-Focused Extent (16:9): {extent}")

    # ── Initialize 16:9 HD Broadcast Figure ───────────────────────────────────
    fig = plt.figure(figsize=(16, 9), dpi=140)
    fig.patch.set_facecolor("#0b131e")
    ax = fig.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree())
    ax.set_extent(extent, crs=ccrs.PlateCarree())

    # Map Cartography (Matching ai_precip_outlook.py)
    ax.add_feature(cfeature.OCEAN, facecolor="#162533", zorder=0)
    ax.add_feature(cfeature.LAND, facecolor="#23313d", zorder=1)

    provinces = load_ph_provinces()
    if provinces:
        ax.add_geometries(provinces, crs=ccrs.PlateCarree(), facecolor="none", edgecolor="#475569", linewidth=0.65, alpha=0.85, zorder=2)

    ax.add_feature(cfeature.COASTLINE, linewidth=1.3, edgecolor="#0f172a", zorder=3)
    ax.add_feature(cfeature.BORDERS, linestyle="-", linewidth=0.8, edgecolor="#475569", zorder=3)

    # Philippine Area of Responsibility (PAR) Boundary: SOLID 7c2d12
    par_lons, par_lats = zip(*PAR_VERTICES)
    ax.plot(
        par_lons, par_lats,
        color=PAR_COLOR,
        linewidth=2.5,
        linestyle="-",
        alpha=0.95,
        transform=ccrs.PlateCarree(),
        zorder=5,
        path_effects=[patheffects.Stroke(linewidth=4.0, foreground="#451a03", alpha=0.5), patheffects.Normal()]
    )

    if extent[0] <= 120.0 <= extent[1] and extent[2] <= 25.0 <= extent[3]:
        ax.text(131.5, 25.4, "PAR (Philippine Area of Responsibility)", color="#ffedd5", fontsize=8.5, fontweight="bold",
                transform=ccrs.PlateCarree(), ha="center", va="bottom", zorder=6,
                bbox=dict(boxstyle="round,pad=0.25", facecolor="#7c2d12", edgecolor="#ea580c", alpha=0.90, lw=1.0))

    # Water Body Labels (Adaptive based on extent visibility)
    if extent[0] <= 133.0 <= extent[1] and extent[2] <= 16.5 <= extent[3]:
        ax.text(133.0, 16.5, "PHILIPPINE  SEA", fontsize=13, color="#64748b", fontweight="bold", fontstyle="italic",
                alpha=0.65, transform=ccrs.PlateCarree(), ha="center", va="center", zorder=4)
    if extent[0] <= 116.0 <= extent[1] and extent[2] <= 14.5 <= extent[3]:
        ax.text(116.0, 14.5, "WEST  PHILIPPINE  SEA", fontsize=11, color="#64748b", fontweight="bold", fontstyle="italic",
                alpha=0.60, transform=ccrs.PlateCarree(), ha="center", va="center", zorder=4)
    if extent[0] <= 147.0 <= extent[1] and extent[2] <= 8.5 <= extent[3]:
        ax.text(147.0, 8.5, "PACIFIC  OCEAN", fontsize=14, color="#64748b", fontweight="bold", fontstyle="italic",
                alpha=0.60, transform=ccrs.PlateCarree(), ha="center", va="center", zorder=4)

    ax.gridlines(draw_labels=False, linewidth=0.5, color="#475569", alpha=0.20, linestyle=":", zorder=4)

    # ── Plot Development Areas (Thick Vibrant Border & Tinted Wash) ───────────
    for a in display_areas:
        for poly in a["polygons"]:
            coords = [[lon, lat] for lat, lon in poly]
            patch = MplPolygon(coords, facecolor=a["color"], edgecolor=a["color"], linewidth=4.0, alpha=0.38, transform=ccrs.PlateCarree(), zorder=10)
            ax.add_patch(patch)

        center_lat, center_lon = a["center"]
        badge_offset_y = -2.8 if (center_lon < (extent[0] + 0.35 * (extent[1] - extent[0])) and center_lat > (extent[2] + 0.5 * (extent[3] - extent[2]))) else 2.5
        ax.text(center_lon, center_lat + badge_offset_y, f"AREA {a['id']}\nWeek 2: {a['prob_7day']}%",
                fontsize=9.5, fontweight="heavy", color="#ffffff", ha="center", va="center",
                transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.35,rounding_size=0.2", facecolor="#0f172a", edgecolor=a["color"], lw=2.0, alpha=0.92),
                zorder=22)

    # ── Adaptive City Reference Badges (Inside Focused Extent) ────────────────
    lon_span = extent[1] - extent[0]
    is_wide_view = lon_span > 26.0
    MAJOR_ANCHORS = {
        "MANILA", "CEBU CITY", "DAVAO", "GUAM", "PALAU", "YAP",
        "OKINAWA", "TAIPEI", "HONG KONG", "PUERTO PRINCESA", "TUGUEGARAO"
    }
    scale_offset = max(1.0, lon_span / 24.0)

    for name, clon, clat, (ox, oy) in ALL_CITIES:
        if is_wide_view and name not in MAJOR_ANCHORS:
            continue

        if (extent[0] + 0.5 <= clon <= extent[1] - 0.5) and (extent[2] + 0.5 <= clat <= extent[3] - 0.5):
            norm_x = (clon - extent[0]) / (extent[1] - extent[0])
            norm_y = (clat - extent[2]) / (extent[3] - extent[2])
            if norm_x < 0.35 and norm_y > 0.48:
                continue
            if norm_x > 0.66 and norm_y < 0.16:
                continue
            if norm_x < 0.13 and norm_y < 0.16:
                continue

            eff_ox = ox * (scale_offset if is_wide_view else 1.0)
            eff_oy = oy * (scale_offset if is_wide_view else 1.0)

            ax.plot(clon, clat, marker="o", color="#ffffff", markersize=3.8, transform=ccrs.PlateCarree(), zorder=14)
            ax.text(
                clon + eff_ox, clat + eff_oy, name,
                transform=ccrs.PlateCarree(),
                fontsize=8.5 if is_wide_view else 9.0,
                fontweight="heavy", color="#091b34",
                ha="center", va="center",
                bbox=dict(boxstyle="round,pad=0.22,rounding_size=0.15", facecolor="#ffffff", edgecolor="#94a3b8", alpha=0.95, lw=0.9),
                zorder=15
            )

    # ── Fox Weather Top Header Bar ─────────────────────────────────────────────
    header_bg = patches.Rectangle((0, 0.895), 1.0, 0.105, transform=fig.transFigure, facecolor="#08172b", alpha=0.96, zorder=40)
    fig.patches.append(header_bg)
    header_border = patches.Rectangle((0, 0.892), 1.0, 0.003, transform=fig.transFigure, facecolor="#0284c7", zorder=41)
    fig.patches.append(header_border)

    # Left Brand Pill: "PHILIPPINE TYPHOON WEATHER"
    brand_pill = FancyBboxPatch((0.022, 0.916), 0.280, 0.062, boxstyle="round,pad=0.005,rounding_size=0.014",
                                transform=fig.transFigure, facecolor="#ffffff", edgecolor="#0284c7", lw=1.6, zorder=42)
    fig.patches.append(brand_pill)

    red_badge = FancyBboxPatch((0.216, 0.920), 0.080, 0.054, boxstyle="round,pad=0.003,rounding_size=0.010",
                                transform=fig.transFigure, facecolor="#dc2626", edgecolor="none", zorder=43)
    fig.patches.append(red_badge)

    fig.text(0.118, 0.947, "PHILIPPINE TYPHOON", fontsize=12.5, fontweight="heavy", color="#0a1d37", ha="center", va="center", zorder=44)
    fig.text(0.256, 0.947, "WEATHER", fontsize=12.5, fontweight="heavy", color="#ffffff", ha="center", va="center", zorder=44)

    # Right Headline Pill: "AREA TO WATCH"
    title_pill = FancyBboxPatch((0.336, 0.916), 0.254, 0.062, boxstyle="round,pad=0.005,rounding_size=0.014",
                                transform=fig.transFigure, facecolor="#0b2344", edgecolor="#ffffff", lw=1.6, zorder=42)
    fig.patches.append(title_pill)
    fig.text(0.463, 0.947, "AREA TO WATCH", fontsize=19.5, fontweight="heavy", color="#ffffff", ha="center", va="center", zorder=44)

    # Subtitle / Model Info in Header Right
    fig.text(0.978, 0.956, "WEEK 2 TROPICAL WEATHER OUTLOOK", fontsize=13.5, fontweight="heavy", color="#38bdf8", ha="right", va="center", zorder=44)
    fig.text(0.978, 0.926, f"GOOGLE WEATHERNEXT 3 · {date_text}", fontsize=10.0, fontweight="bold", color="#cbd5e1", ha="right", va="center", zorder=44)

    # ── Floating "CHANCE OF DEVELOPMENT" Card (Adaptive Fox Weather Layout) ────
    lead1_label = "DAY\n8 - 9"
    lead2_label = "DAY\n8 - 14"
    col1_hdr = "DAY 8-9"
    col2_hdr = "DAY 8-14"

    if len(display_areas) == 1:
        # Single Area: Large 2-Column Broadcast Card (Classic Fox Weather)
        primary_area = display_areas[0]
        card_x, card_y, card_w, card_h = 0.025, 0.560, 0.270, 0.275
        card_bg = FancyBboxPatch((card_x, card_y), card_w, card_h, boxstyle="round,pad=0.006,rounding_size=0.020",
                                transform=fig.transFigure, facecolor="#ffffff", edgecolor="#cbd5e1", lw=1.5, zorder=50)
        fig.patches.append(card_bg)

        card_header = FancyBboxPatch((card_x + 0.008, card_y + card_h - 0.054), card_w - 0.016, 0.046,
                                     boxstyle="round,pad=0.004,rounding_size=0.012",
                                     transform=fig.transFigure, facecolor="#0d2342", edgecolor="none", zorder=51)
        fig.patches.append(card_header)
        fig.text(card_x + card_w / 2.0, card_y + card_h - 0.031, "CHANCE OF DEVELOPMENT",
                 fontsize=12.5, fontweight="heavy", color="#ffffff", ha="center", va="center", zorder=52)

        col1_x = card_x + 0.068
        col2_x = card_x + card_w - 0.068
        mid_divider_x = card_x + card_w / 2.0

        divider = patches.FancyArrowPatch((mid_divider_x, card_y + 0.025), (mid_divider_x, card_y + card_h - 0.065),
                                          transform=fig.transFigure, color="#cbd5e1", linewidth=1.5, zorder=51)
        fig.patches.append(divider)

        fig.text(col1_x, card_y + 0.138, f"{primary_area['prob_2day']}%",
                 fontsize=35, fontweight="heavy", color="#0a1d37", ha="center", va="center", zorder=52)
        fig.text(col1_x, card_y + 0.068, lead1_label,
                 fontsize=10.0, fontweight="heavy", color="#0284c7", ha="center", va="center", multialignment="center", zorder=52)

        fig.text(col2_x, card_y + 0.138, f"{primary_area['prob_7day']}%",
                 fontsize=35, fontweight="heavy", color="#0a1d37", ha="center", va="center", zorder=52)
        fig.text(col2_x, card_y + 0.068, lead2_label,
                 fontsize=10.0, fontweight="heavy", color="#0284c7", ha="center", va="center", multialignment="center", zorder=52)

        reg_name = get_region_name(primary_area["center"][0], primary_area["center"][1])
        fig.text(card_x + card_w / 2.0, card_y + 0.016, f"Area {primary_area['id']} · {reg_name}",
                 fontsize=8.5, fontweight="bold", color="#64748b", ha="center", va="center", zorder=52)

    elif len(display_areas) > 1:
        # Multi-Area: Clean Broadcast Table Breakdown
        table_areas = sorted(display_areas, key=lambda x: x["id"])
        num_rows = min(len(table_areas), 4)
        row_height = 0.054
        card_w = 0.320
        card_h = 0.088 + (num_rows * row_height) + 0.024
        card_x = 0.025
        card_y = 0.840 - card_h

        card_bg = FancyBboxPatch((card_x, card_y), card_w, card_h, boxstyle="round,pad=0.006,rounding_size=0.018",
                                transform=fig.transFigure, facecolor="#ffffff", edgecolor="#cbd5e1", lw=1.5, zorder=50)
        fig.patches.append(card_bg)

        # Card Title Header
        card_header = FancyBboxPatch((card_x + 0.008, card_y + card_h - 0.048), card_w - 0.016, 0.040,
                                     boxstyle="round,pad=0.004,rounding_size=0.010",
                                     transform=fig.transFigure, facecolor="#0d2342", edgecolor="none", zorder=51)
        fig.patches.append(card_header)
        fig.text(card_x + card_w / 2.0, card_y + card_h - 0.028, "CHANCE OF DEVELOPMENT",
                 fontsize=12.0, fontweight="heavy", color="#ffffff", ha="center", va="center", zorder=52)

        # Table Column Subheaders
        hdr_y = card_y + card_h - 0.068
        c_area_x = card_x + 0.022
        c_p1_x   = card_x + 0.170
        c_p2_x   = card_x + 0.236
        c_risk_x = card_x + 0.292

        fig.text(c_area_x, hdr_y, "AREA", fontsize=8.0, fontweight="heavy", color="#64748b", ha="left", va="center", zorder=52)
        fig.text(c_p1_x, hdr_y, col1_hdr, fontsize=7.5, fontweight="heavy", color="#64748b", ha="center", va="center", zorder=52)
        fig.text(c_p2_x, hdr_y, col2_hdr, fontsize=7.5, fontweight="heavy", color="#0284c7", ha="center", va="center", zorder=52)
        fig.text(c_risk_x, hdr_y, "RISK", fontsize=7.5, fontweight="heavy", color="#64748b", ha="center", va="center", zorder=52)

        hdr_line = patches.FancyArrowPatch((card_x + 0.012, hdr_y - 0.012), (card_x + card_w - 0.012, hdr_y - 0.012),
                                          transform=fig.transFigure, color="#e2e8f0", linewidth=1.2, zorder=51)
        fig.patches.append(hdr_line)

        # Render Each Area Row
        start_y = hdr_y - 0.038
        for idx, a in enumerate(table_areas[:num_rows]):
            curr_row_y = start_y - (idx * row_height)
            reg_name = get_region_name(a["center"][0], a["center"][1])

            # Area Color Dot
            dot = patches.Circle((c_area_x + 0.005, curr_row_y + 0.006), 0.0045,
                                transform=fig.transFigure, facecolor=a["color"], edgecolor="#0f172a", lw=0.6, zorder=53)
            fig.patches.append(dot)

            # Area Title and Location Subtitle
            fig.text(c_area_x + 0.014, curr_row_y + 0.007, f"Area {a['id']}",
                     fontsize=9.5, fontweight="heavy", color="#0a1d37", ha="left", va="center", zorder=52)
            fig.text(c_area_x + 0.014, curr_row_y - 0.008, reg_name,
                     fontsize=7.0, fontweight="bold", color="#64748b", ha="left", va="center", zorder=52)

            # 2-day / 9-day Probability
            fig.text(c_p1_x, curr_row_y, f"{a['prob_2day']}%",
                     fontsize=12.0, fontweight="heavy", color="#0f172a", ha="center", va="center", zorder=52)

            # 7-day / 14-day Probability (Bold & Risk Tinted)
            fig.text(c_p2_x, curr_row_y, f"{a['prob_7day']}%",
                     fontsize=13.0, fontweight="heavy", color="#0284c7", ha="center", va="center", zorder=52)

            # Risk Category Pill Badge
            risk_text = a["cat"].upper()
            if risk_text == "HIGH":
                rbg, rfg = "#fee2e2", "#b91c1c"
            elif risk_text in ("MEDIUM", "MED"):
                rbg, rfg = "#ffedd5", "#c2410c"
                risk_text = "MED"
            else:
                rbg, rfg = "#fef9c3", "#a16207"
                risk_text = "LOW"

            risk_badge = FancyBboxPatch((c_risk_x - 0.018, curr_row_y - 0.010), 0.036, 0.020,
                                       boxstyle="round,pad=0.002,rounding_size=0.006",
                                       transform=fig.transFigure, facecolor=rbg, edgecolor="none", zorder=52)
            fig.patches.append(risk_badge)
            fig.text(c_risk_x, curr_row_y, risk_text,
                     fontsize=7.0, fontweight="heavy", color=rfg, ha="center", va="center", zorder=53)

            # Row Divider Line
            if idx < num_rows - 1:
                row_div = patches.FancyArrowPatch((card_x + 0.015, curr_row_y - 0.018), (card_x + card_w - 0.015, curr_row_y - 0.018),
                                                  transform=fig.transFigure, color="#f1f5f9", linewidth=1.0, zorder=51)
                fig.patches.append(row_div)

        # Footer Note
        fig.text(card_x + card_w / 2.0, card_y + 0.012, f"Tracking {len(table_areas)} Active Formation Areas",
                 fontsize=7.5, fontweight="bold", color="#64748b", ha="center", va="center", zorder=52)

    else:
        # Zero Areas Case
        card_x, card_y, card_w, card_h = 0.025, 0.620, 0.270, 0.160
        card_bg = FancyBboxPatch((card_x, card_y), card_w, card_h, boxstyle="round,pad=0.006,rounding_size=0.020",
                                transform=fig.transFigure, facecolor="#ffffff", edgecolor="#cbd5e1", lw=1.5, zorder=50)
        fig.patches.append(card_bg)

        card_header = FancyBboxPatch((card_x + 0.008, card_y + card_h - 0.054), card_w - 0.016, 0.046,
                                     boxstyle="round,pad=0.004,rounding_size=0.012",
                                     transform=fig.transFigure, facecolor="#0d2342", edgecolor="none", zorder=51)
        fig.patches.append(card_header)
        fig.text(card_x + card_w / 2.0, card_y + card_h - 0.031, "CHANCE OF DEVELOPMENT",
                 fontsize=12.5, fontweight="heavy", color="#ffffff", ha="center", va="center", zorder=52)

        fig.text(card_x + card_w / 2.0, card_y + 0.050, "NO TROPICAL CYCLONE\nFORMATION EXPECTED",
                 fontsize=10.0, fontweight="heavy", color="#15803d", ha="center", va="center", multialignment="center", zorder=52)

    # ── Bottom-Left Brand Logo (Direct on Canvas, No White Background) ─────────
    logo_w, logo_h = 0.088, 0.088
    logo_x, logo_y = 0.022, 0.028
    found_logo = next((p for p in LOGO_PATHS if os.path.exists(p)), None)

    if found_logo:
        try:
            img = mpimg.imread(found_logo)
            logo_ax = fig.add_axes([logo_x, logo_y, logo_w, logo_h], zorder=50)
            logo_ax.imshow(img)
            logo_ax.axis("off")
        except Exception:
            fig.text(logo_x + logo_w / 2.0, logo_y + logo_h / 2.0, "PHIL\nWX",
                     fontsize=12, fontweight="heavy", color="#38bdf8", ha="center", va="center", zorder=50)
    else:
        fig.text(logo_x + logo_w / 2.0, logo_y + logo_h / 2.0, "PHIL\nWX",
                 fontsize=12, fontweight="heavy", color="#38bdf8", ha="center", va="center", zorder=50)

    # ── Bottom-Right Broadcast Legend & Metadata Card ──────────────────────────
    leg_x, leg_y, leg_w, leg_h = 0.675, 0.035, 0.300, 0.115
    leg_bg = FancyBboxPatch((leg_x, leg_y), leg_w, leg_h, boxstyle="round,pad=0.006,rounding_size=0.015",
                           transform=fig.transFigure, facecolor="#09182b", edgecolor="#ea580c", lw=1.2, alpha=0.94, zorder=50)
    fig.patches.append(leg_bg)

    fig.text(leg_x + leg_w / 2.0, leg_y + 0.092, "WEEK 2 FORMATION POTENTIAL",
             fontsize=9.5, fontweight="heavy", color="#f8fafc", ha="center", va="center", zorder=52)

    c1 = leg_x + leg_w * 0.19
    c2 = leg_x + leg_w * 0.50
    c3 = leg_x + leg_w * 0.81
    fig.text(c1, leg_y + 0.062, "● Low (<40%)", fontsize=8.8, fontweight="bold", color="#facc15", ha="center", va="center", zorder=52)
    fig.text(c2, leg_y + 0.062, "● Med (40-60%)", fontsize=8.8, fontweight="bold", color="#f97316", ha="center", va="center", zorder=52)
    fig.text(c3, leg_y + 0.062, "● High (>60%)", fontsize=8.8, fontweight="bold", color="#ef4444", ha="center", va="center", zorder=52)

    fig.text(leg_x + leg_w / 2.0, leg_y + 0.024, "EXPERIMENTAL GUIDANCE PRODUCT · NOT AN OFFICIAL FORECAST\nREFER TO PAGASA FOR OFFICIAL WARNINGS AND ADVISORIES",
             fontsize=6.8, fontweight="bold", color="#94a3b8", ha="center", va="center", multialignment="center", zorder=52)

    # ── Save Outputs ──────────────────────────────────────────────────────────
    plt.savefig(OUTPUT_IMAGE, dpi=140, facecolor="#0b131e")
    plt.close()
    print(f"Broadcast map saved successfully to: {OUTPUT_IMAGE}")

    # JSON export for frontend compatibility
    json_data = {
        "initialization": init_text,
        "model": "Google WeatherNext 3 (WNv3)",
        "has_active_tc": False,
        "active_tcs": [],
        "areas": json_areas,
        "two_day_day": nine_day_day,
        "seven_day_day": fourteen_day_day
    }
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(json_data, f, indent=2)
    print(f"Metadata JSON saved successfully to: {OUTPUT_JSON}")

if __name__ == "__main__":
    main()