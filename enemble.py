"""
enemble.py  –  Tropical Cyclone Track + Cone of Uncertainty → JSON
===================================================================
Converts the existing matplotlib-based track plotter into a JSON exporter.
Reads the same hardcoded data_dict / history_dict and produces:

    public/data/ensemble_tracks.json

JSON schema
-----------
{
  "generated_at": "2026-04-09T16:00:00Z",
  "storm_name": "Low Pressure Area",
  "init_time": "2026-04-09 00:00:00",
  "current_time_ph": "4:00 PM PhST, April 9, 2026",
  "history": [
    {"lead_time_hours": -24, "lat": 8.70, "lon": 154.50,
     "wind_kt": 16.1, "pressure_hpa": 1006.9}
  ],
  "forecast": [
    {"lead_time_hours": 6, "lat": 8.10, "lon": 151.80,
     "wind_kt": 39.0, "pressure_hpa": 996.1,
     "cone_radius_km": 48.2}
  ],
  "cone_polygon": [          # pre-computed outer envelope [lon, lat] pairs
    [154.5, 8.7], ...
  ]
}
"""

import json
import math
import os
import numpy as np
import pandas as pd
from datetime import datetime, timezone
from shapely.geometry import Polygon
from shapely.ops import unary_union

# ── Output path ────────────────────────────────────────────────────────────────
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "public", "data")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "ensemble_tracks.json")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── Forecast data (mean track)  ────────────────────────────────────────────────
data_dict = {
    'lead_time_hours': [6.0, 30.0, 54.0, 78.0, 102.0, 126.0],
    'lat': [7.20, 7.73, 8.52, 9.50, 10.31, 11.19],
    'lon': [146.70, 143.94, 140.25, 136.48, 133.22, 130.03],
    'minimum_sea_level_pressure_hpa': [1002.1, 1001.7, 997.9, 996.6, 995.2, 996.7],
    'maximum_sustained_wind_speed_knots': [30.2, 35.5, 40.6, 44.4, 43.5, 39.8]
}

# ── Historical (past-track) data  ──────────────────────────────────────────────
history_dict = [
    {'init_time': '2026-05-04 12:00:00', 'lead_time': '0 days 00:00:00',
     'lat': 8.0, 'lon': 150.40, 'minimum_sea_level_pressure_hpa': 1006.9,
     'maximum_sustained_wind_speed_knots': 16.1}, 
    {'init_time': '2026-05-04 18:00:00', 'lead_time': '0 days 00:00:00',
     'lat': 7.60, 'lon': 150.50, 'minimum_sea_level_pressure_hpa': 1006.9,
     'maximum_sustained_wind_speed_knots': 16.1}, 
    {'init_time': '2026-05-05 00:00:00', 'lead_time': '0 days 00:00:00',
     'lat': 7.70, 'lon': 149.70, 'minimum_sea_level_pressure_hpa': 1006.9,
     'maximum_sustained_wind_speed_knots': 16.1}, 
    {'init_time': '2026-05-05 06:00:00', 'lead_time': '0 days 00:00:00',
     'lat': 8.20, 'lon': 149.50, 'minimum_sea_level_pressure_hpa': 1006.9,
     'maximum_sustained_wind_speed_knots': 16.1}, 
      {'init_time': '2026-05-05 12:00:00', 'lead_time': '0 days 00:00:00',
     'lat': 7.90, 'lon': 148.60, 'minimum_sea_level_pressure_hpa': 1006.9,
     'maximum_sustained_wind_speed_knots': 16.1}, 
     {'init_time': '2026-05-05 18:00:00', 'lead_time': '0 days 00:00:00',
     'lat': 7.60, 'lon': 147.80, 'minimum_sea_level_pressure_hpa': 1006.9,
     'maximum_sustained_wind_speed_knots': 16.1}, ]

STORM_NAME    = "Tropical Depression"
INIT_TIME_STR = "2026-05-05 18:00:00"
CURRENT_TIME_PH = "9:00 AM PhST, May 6, 2026"

# ── NHC standard cone radii (nautical miles) by lead time (hours)  ─────────────
LEAD_STANDARD = [0,  12,  24,  36,  48,   60,   72,   96,  120,  144]
RADII_NM      = [0,  26,  38,  50,  59,   71,   83,  113,  146,  180]

# ── Geometry helpers  ──────────────────────────────────────────────────────────
def offset_point(lat, lon, distance_km, bearing_deg):
    """Return (lat2, lon2) displaced from (lat, lon) by distance_km along bearing_deg."""
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


def build_circle_points(lat, lon, radius_km, n=36):
    """Return list of [lon, lat] for a circle of radius_km around (lat, lon)."""
    pts = []
    for i in range(n):
        ang = 360 * i / n
        clat, clon = offset_point(lat, lon, radius_km, ang)
        pts.append([round(clon, 4), round(clat, 4)])
    pts.append(pts[0])   # close the ring
    return pts


def convex_hull_2d(points):
    """
    Simple Graham-scan convex hull for a list of [x, y] points.
    Returns [x, y] list in CCW order.
    """
    pts = [tuple(p) for p in points]
    pts = sorted(set(pts))
    if len(pts) <= 1:
        return [[p[0], p[1]] for p in pts]

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    return [[p[0], p[1]] for p in hull]


def build_cone_polygon(lats, lons, lead_times):
    """
    Build the cone-of-uncertainty outer envelope using a continuous swept tangent union.
    Returns list of [lon, lat] pairs (closed polygon).
    """
    radii_nm_interp = np.interp(lead_times, LEAD_STANDARD, RADII_NM)
    radii_km = radii_nm_interp * 1.852

    if len(lats) <= 1:
        circ = []
        radius = max(radii_km[0], 0.1)
        for ang in range(0, 360, 10):
            clat, clon = offset_point(lats[0], lons[0], radius, ang)
            circ.append([round(clon, 4), round(clat, 4)])
        return circ

    circles = []
    for i in range(len(lats)):
        circ_lons = []
        circ_lats = []
        radius = max(radii_km[i], 0.1)
        for ang in range(0, 360, 10):
            clat, clon = offset_point(lats[i], lons[i], radius, ang)
            circ_lons.append(clon)
            circ_lats.append(clat)
        circles.append(Polygon(np.column_stack((circ_lons, circ_lats))))
        
    # Connect consecutive circles with a convex hull tangent
    segments = []
    for i in range(len(circles) - 1):
        segment = circles[i].union(circles[i+1]).convex_hull
        segments.append(segment)
        
    # Merge all segments into one continuous blob
    cone_geom = unary_union(segments)
    
    if cone_geom.geom_type == 'Polygon':
        geoms = [cone_geom]
    elif cone_geom.geom_type == 'MultiPolygon':
        geoms = list(cone_geom.geoms)
    else:
        geoms = []
        
    if not geoms:
        return []

    # Get the outline of the main contiguous polygon
    largest_geom = max(geoms, key=lambda g: g.area)
    coords = list(largest_geom.exterior.coords)
    return [[round(p[0], 4), round(p[1], 4)] for p in coords]


# ── Main  ──────────────────────────────────────────────────────────────────────
def main():
    wp_mean = pd.DataFrame(data_dict)
    history_data = pd.DataFrame(history_dict)

    # Recalculate lead_time_hours for history relative to INIT_TIME_STR
    ref = pd.to_datetime(INIT_TIME_STR)
    history_data['actual_time'] = pd.to_datetime(history_data['init_time'])
    history_data['lead_time_hours'] = (
        (history_data['actual_time'] - ref).dt.total_seconds() / 3600
    )

    # Build history list (sorted, deduplicated)
    history_df = history_data.sort_values('lead_time_hours').drop_duplicates('lead_time_hours')
    history_out = [
        {
            "lead_time_hours": round(float(r['lead_time_hours']), 1),
            "lat":  round(float(r['lat']), 2),
            "lon":  round(float(r['lon']), 2),
            "wind_kt":      round(float(r['maximum_sustained_wind_speed_knots']), 1),
            "pressure_hpa": round(float(r['minimum_sea_level_pressure_hpa']), 1),
        }
        for _, r in history_df.iterrows()
    ]

    # Build forecast list with per-point cone radius
    lats       = wp_mean['lat'].values
    lons       = wp_mean['lon'].values
    lead_times = wp_mean['lead_time_hours'].values
    winds      = wp_mean['maximum_sustained_wind_speed_knots'].values
    pressures  = wp_mean['minimum_sea_level_pressure_hpa'].values

    radii_nm_interp = np.interp(lead_times, LEAD_STANDARD, RADII_NM)
    radii_km        = radii_nm_interp * 1.852

    forecast_out = [
        {
            "lead_time_hours": round(float(lead_times[i]), 1),
            "lat":  round(float(lats[i]), 2),
            "lon":  round(float(lons[i]), 2),
            "wind_kt":        round(float(winds[i]), 1),
            "pressure_hpa":   round(float(pressures[i]), 1),
            "cone_radius_km": round(float(radii_km[i]), 1),
        }
        for i in range(len(lats))
    ]

    # Build cone polygon (convex hull of all circle perimeter points)
    cone_polygon = build_cone_polygon(lats, lons, lead_times)

    payload = {
        "generated_at":   datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "storm_name":     STORM_NAME,
        "init_time":      INIT_TIME_STR,
        "current_time_ph": CURRENT_TIME_PH,
        "history":        history_out,
        "forecast":       forecast_out,
        "cone_polygon":   cone_polygon,
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(payload, f, indent=2)

    print(f"✓ Written → {OUTPUT_FILE}")
    print(f"  History points : {len(history_out)}")
    print(f"  Forecast points: {len(forecast_out)}")
    print(f"  Cone polygon   : {len(cone_polygon)} vertices")
    for p in forecast_out:
        print(f"  T+{p['lead_time_hours']:5.0f}h  {p['lat']}°N {p['lon']}°E  "
              f"wind={p['wind_kt']}kt  cone_r={p['cone_radius_km']}km")


if __name__ == "__main__":
    main()