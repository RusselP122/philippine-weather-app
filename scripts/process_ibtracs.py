import pandas as pd
import numpy as np
import json
import os
from shapely.geometry import Point, Polygon
from scipy.stats import poisson
import warnings

warnings.filterwarnings('ignore')

CSV_FILE = r"c:\Users\Russel\Desktop\philippine-weather-app\ibtracs.WP.list.v04r01.csv"
OUTPUT_FILE = r"c:\Users\Russel\Desktop\philippine-weather-app\public\data\historical_tracks.json"

# Define PAR (Philippine Area of Responsibility) Polygon Coordinates
PAR_COORDS = [
    (115.0, 5.0),
    (135.0, 5.0),
    (135.0, 25.0),
    (120.0, 25.0),
    (120.0, 21.0),
    (115.0, 15.0),
    (115.0, 5.0)  # Close polygon
]
par_polygon = Polygon(PAR_COORDS)

MONTH_NAMES = {
    1: "January", 2: "February", 3: "March", 4: "April",
    5: "May", 6: "June", 7: "July", 8: "August",
    9: "September", 10: "October", 11: "November", 12: "December"
}

def main():
    print("Loading IBTrACS data...")
    df = pd.read_csv(CSV_FILE, skiprows=[1], low_memory=False)
    df.columns = [c.strip() for c in df.columns]

    df['ISO_TIME'] = pd.to_datetime(df['ISO_TIME'], errors='coerce')
    df = df.dropna(subset=['ISO_TIME'])
    df['LAT'] = pd.to_numeric(df['LAT'], errors='coerce')
    df['LON'] = pd.to_numeric(df['LON'], errors='coerce')

    # Use WMO_WIND with forward fill
    if 'WMO_WIND' in df.columns:
        df['WIND'] = pd.to_numeric(df['WMO_WIND'], errors='coerce')
        df['WIND'] = df.groupby('SID')['WIND'].ffill().fillna(0)
    else:
        df['WIND'] = 0

    df['YEAR'] = df['ISO_TIME'].dt.year
    df['MONTH'] = df['ISO_TIME'].dt.month

    # Assign each storm a "formation month" based on its first track point
    storm_first = df.groupby('SID').agg(
        FIRST_YEAR=('YEAR', 'first'),
        FIRST_MONTH=('MONTH', 'first')
    ).reset_index()
    df = df.merge(storm_first, on='SID', how='left')

    # Filter for Western North Pacific
    wp_mask = df['BASIN'].str.strip().str.contains('Western North Pacific|WP', case=False, na=False)
    df_wp = df[wp_mask].copy()

    # ═══════════════════════════════════════════════════════════════
    # 1) Build climatology from ALL available years (1970-2025 range)
    # ═══════════════════════════════════════════════════════════════
    clim_start = 1970
    clim_end = 2025
    df_clim = df_wp[(df_wp['FIRST_YEAR'] >= clim_start) & (df_wp['FIRST_YEAR'] <= clim_end)]

    climatology = {}
    for month in range(1, 13):
        # Count unique storms forming per year in this month
        month_storms = df_clim[df_clim['FIRST_MONTH'] == month]
        yearly_counts = month_storms.groupby('FIRST_YEAR')['SID'].nunique()
        # Fill missing years with 0
        all_years = range(clim_start, clim_end + 1)
        yearly_counts = yearly_counts.reindex(all_years, fill_value=0)

        avg_formation = float(yearly_counts.mean())

        # PAR entries
        par_counts = []
        for yr in all_years:
            yr_month = month_storms[month_storms['FIRST_YEAR'] == yr]
            sids = yr_month['SID'].unique()
            par_count = 0
            for sid in sids:
                track = yr_month[yr_month['SID'] == sid]
                for _, row in track.iterrows():
                    if not pd.isna(row['LON']) and not pd.isna(row['LAT']):
                        if par_polygon.contains(Point(float(row['LON']), float(row['LAT']))):
                            par_count += 1
                            break
            par_counts.append(par_count)

        avg_par = float(np.mean(par_counts))

        # Poisson probability ranges
        mu_form = avg_formation
        mu_par = avg_par

        # Most likely range (central 80% interval)
        form_low = int(poisson.ppf(0.10, mu_form)) if mu_form > 0 else 0
        form_high = int(poisson.ppf(0.90, mu_form)) if mu_form > 0 else 0
        par_low = int(poisson.ppf(0.10, mu_par)) if mu_par > 0 else 0
        par_high = int(poisson.ppf(0.90, mu_par)) if mu_par > 0 else 0

        climatology[str(month)] = {
            "month_name": MONTH_NAMES[month],
            "avg_formation": round(avg_formation, 1),
            "avg_par_entry": round(avg_par, 1),
            "formation_range": [form_low, form_high],
            "par_range": [par_low, par_high],
        }
        print(f"  {MONTH_NAMES[month]:>10}: Avg Formation={avg_formation:.1f} ({form_low}-{form_high}), Avg PAR={avg_par:.1f} ({par_low}-{par_high})")

    # ═══════════════════════════════════════════════════════════════
    # 2) Build per-month track data for display years (2014-2026)
    # ═══════════════════════════════════════════════════════════════
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

                entered_par = False
                track_pts = []
                for _, row in valid_points.iterrows():
                    lon = float(row['LON'])
                    lat = float(row['LAT'])
                    wind = float(row['WIND'])
                    track_pts.append([lat, lon, wind])
                    if not entered_par:
                        if par_polygon.contains(Point(lon, lat)):
                            entered_par = True

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

        print(f"Year {year}: processed all 12 months")

    # ═══════════════════════════════════════════════════════════════
    # 3) Save result
    # ═══════════════════════════════════════════════════════════════
    result = {
        "climatology": climatology,
        "tracks": tracks_by_month
    }

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(result, f)

    print(f"\nData saved to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
