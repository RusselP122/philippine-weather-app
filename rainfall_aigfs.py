import os
import json
import requests
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.lines as mlines
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from shapely.geometry import shape
from datetime import datetime, timedelta, timezone
from eccodes import codes_grib_new_from_file, codes_get, codes_get_double_array, codes_get_values, codes_release

OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "rainfall_aigfs")
DATA_DIR   = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR,   exist_ok=True)

LAT_MIN, LAT_MAX = 2.0, 28.0
LON_MIN, LON_MAX = 112.0, 140.0
PAR_LONS = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
PAR_LATS = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]

def get_latest_aigfs_run(session):
    base_url = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/aigfs/prod"
    now = datetime.now(timezone.utc)
    for days_back in range(0, 3):
        t_date = now - timedelta(days=days_back)
        date_str = t_date.strftime("%Y%m%d")
        date_url = f"{base_url}/aigfs.{date_str}/"
        try:
            if session.get(date_url, timeout=6).status_code != 200: continue
            for cycle in ["18", "12", "06", "00"]:
                cycle_url = f"{date_url}{cycle}/model/atmos/grib2/"
                test_idx = f"{cycle_url}aigfs.t{cycle}z.sfc.f024.grib2.idx"
                try:
                    if session.head(test_idx, timeout=5).status_code == 200:
                        run_dt = datetime.strptime(f"{date_str}{cycle}", "%Y%m%d%H").replace(tzinfo=timezone.utc)
                        print(f"Found latest AIGFS run: {date_str} {cycle}Z")
                        return cycle_url, run_dt, date_str, cycle
                except: continue
        except: continue
    raise RuntimeError("No recent AIGFS cycle found on NOAA NOMADS.")


def download_apcp_total(grib_url, idx_url, session, target_day):
    """Download the 0-{day} day acc fcst APCP field."""
    r = session.get(idx_url, timeout=10)
    if r.status_code != 200: return None

    lines = r.text.splitlines()
    target_str = f"0-{target_day} day acc fcst"
    if target_day == 1:
        # Sometimes f024 is just "0-1 day" or might be "0-24 hour"
        target_str_alt = "0-1 day acc fcst"
        target_str_alt2 = "0-24 hour acc fcst"
    else:
        target_str_alt = f"0-{target_day} day acc fcst"
        target_str_alt2 = f"0-{target_day} day acc fcst"

    start_byte, end_byte = None, ""
    for i, line in enumerate(lines):
        if "APCP" in line and (target_str in line or target_str_alt in line or target_str_alt2 in line):
            start_byte = int(line.split(":")[1])
            if i < len(lines) - 1:
                end_byte = int(lines[i + 1].split(":")[1]) - 1
            break
            
    if start_byte is None: return None

    temp_path = os.path.join(os.getcwd(), f"temp_aigfs_apcp_{os.getpid()}_{np.random.randint(1000,9999)}.grib2")
    headers = {"Range": f"bytes={start_byte}-{end_byte}"}
    gr = session.get(grib_url, headers=headers, timeout=15)
    with open(temp_path, "wb") as f:
        f.write(gr.content)
    return temp_path


def read_apcp(grib_file_path):
    lats, lons, apcp = None, None, None
    with open(grib_file_path, "rb") as f:
        gid = codes_grib_new_from_file(f)
        if gid:
            ni = codes_get(gid, "Ni")
            nj = codes_get(gid, "Nj")
            lats = codes_get_double_array(gid, "latitudes").reshape(nj, ni)
            lons = codes_get_double_array(gid, "longitudes").reshape(nj, ni)
            apcp = codes_get_values(gid).reshape(nj, ni)
            codes_release(gid)
    if lons is not None and np.max(lons) > 180:
        lons = np.where(lons > 180, lons - 360, lons)
    return lats, lons, apcp


def plot_rainfall(lons, lats, precip_grid, filename_id, init_dt, target_day, title_str):
    fig = plt.figure(figsize=(14, 11))
    fig.subplots_adjust(top=0.88)
    ax = plt.axes(projection=ccrs.PlateCarree())
    ax.set_extent([LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], crs=ccrs.PlateCarree())

    ax.add_feature(cfeature.LAND, facecolor="#eaeaea", zorder=0)
    ax.add_feature(cfeature.OCEAN, facecolor="#d4e5ed", zorder=0)
    ax.add_feature(cfeature.COASTLINE, linewidth=1.0, edgecolor="#222222", zorder=3)
    ax.add_feature(cfeature.BORDERS, linestyle="-", linewidth=0.6, edgecolor="#555555", zorder=3)

    try:
        geojson_paths = [os.path.join(os.getcwd(), "public", "data", "ph_provinces.json")]
        found_geo = next((p for p in geojson_paths if os.path.exists(p)), None)
        if found_geo:
            with open(found_geo, "r", encoding="utf-8") as f:
                geo_data = json.load(f)
            prov_geoms = [shape(feat["geometry"]) for feat in geo_data["features"]]
            ax.add_geometries(prov_geoms, crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#555555', linewidth=0.4, alpha=0.6, zorder=3)
    except: pass

    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color="gray", alpha=0.4, linestyle=":", zorder=5)
    gl.top_labels = False; gl.right_labels = False
    
    levels = [0.1, 0.5, 1.0, 1.5, 2.5, 5.0, 10.0, 15.0, 20.0, 25.0, 30.0, 35.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0, 125.0, 150.0, 175.0, 200.0, 250.0, 300.0, 400.0]
    colors = ["#F0F8FF", "#C8E6FF", "#A0D0FF", "#78BAFF", "#4A9EFF", "#1E7EFF", "#0066DD", "#008F8F", "#00B366", "#4CC700", "#8CDB00", "#C8E600", "#FFEA00", "#FFCC00", "#FF9F00", "#FF6A00", "#FF3A00", "#FF1A00", "#E6006E", "#C8009E", "#A600C8", "#8500E6", "#5F00E6", "#3F00B3", "#1F005C"]
    cmap = ListedColormap(colors)
    cmap.set_over('#0F0030')
    norm = BoundaryNorm(levels, ncolors=len(colors), clip=False)

    if np.nanmax(precip_grid) > 0.05:
        cf = ax.contourf(lons, lats, precip_grid, levels=levels, cmap=cmap, norm=norm, extend="max", transform=ccrs.PlateCarree(), zorder=2)
        cb = fig.colorbar(cf, ax=ax, orientation="vertical", pad=0.02, shrink=0.85, aspect=25)
        cb.set_ticks(levels)
        cb.ax.tick_params(labelsize=10)
        cb.outline.set_edgecolor("black")
        cb.outline.set_linewidth(1)

    ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(), color="#d62728", linestyle="-", linewidth=2.5, zorder=7)

    time_fmt = "%Hz %a, %b %d, %Y"
    init_str = init_dt.strftime(time_fmt)
    
    sub_title = title_str

    fig.canvas.draw()
    pos = ax.get_position()
    left, right = pos.x0, pos.x1
    y_top = pos.y1 + 0.045
    y_bottom = pos.y1 + 0.015
    y_line = pos.y1 + 0.005

    fig.text(left, y_top, "Philippine T/W", ha="left", va="bottom", fontsize=14, weight="bold", color="#888888")
    fig.text(right, y_top, "AIGFS 24-hr (Daily) Accumulated Precip (mm)", ha="right", va="bottom", fontsize=14, weight="bold", color="black")
    fig.text(left, y_bottom, f"Model: NOAA AIGFS (0.25°)   |   {sub_title}", ha="left", va="bottom", fontsize=11, color="black")
    fig.text(right, y_bottom, f"Init: {init_str}", ha="right", va="bottom", fontsize=11, color="black")

    sep = mlines.Line2D((left, right), (y_line, y_line), color="black", linewidth=1, transform=fig.transFigure)
    fig.add_artist(sep)

    out_path = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(out_path, dpi=120, bbox_inches="tight", facecolor="white")
    print(f"  Saved {out_path}")
    plt.close()


def main():
    print("\n=== NOAA AIGFS Daily Rainfall Generator ===\n")
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})
    cycle_url, init_time, date_str, cycle = get_latest_aigfs_run(session)

    valid_frames = []
    prev_total = None
    accum_grids = {} # Store absolute totals for 3-day, 5-day etc.
    
    for day in range(1, 17): # 16 days
        step = day * 24
        print(f"Processing Day {day} (f{step:03d})...")
        
        grib_file = f"aigfs.t{cycle}z.sfc.f{step:03d}.grib2"
        grib_url = f"{cycle_url}{grib_file}"
        idx_url = f"{grib_url}.idx"

        tmp_path = download_apcp_total(grib_url, idx_url, session, day)
        if not tmp_path:
            print(f"  Warning: APCP total for day {day} not found.")
            break
            
        try:
            lats, lons, current_total = read_apcp(tmp_path)
            
            # Sub-region
            if lats.ndim == 2:
                lat_vec = lats[:, 0]; lon_vec = lons[0, :]
            else:
                lat_vec = lats; lon_vec = lons
            lat_mask = (lat_vec >= LAT_MIN) & (lat_vec <= LAT_MAX)
            lon_mask = (lon_vec >= LON_MIN) & (lon_vec <= LON_MAX)
            
            if lats.ndim == 2:
                sub_lats = lats[lat_mask, :][:, lon_mask]
                sub_lons = lons[lat_mask, :][:, lon_mask]
                sub_current = current_total[lat_mask, :][:, lon_mask]
            else:
                sub_lats, sub_lons = np.meshgrid(lat_vec[lat_mask], lon_vec[lon_mask], indexing='ij')
                sub_current = current_total[lat_mask, :][:, lon_mask]
            
            # Store total accumulation
            accum_grids[day] = sub_current.copy()
            
            # Daily precip is current total minus previous total
            if prev_total is not None:
                daily_precip = sub_current - prev_total
            else:
                daily_precip = sub_current

            # Clip negatives
            daily_precip = np.clip(daily_precip, 0, None)
            prev_total = sub_current.copy()

            frame_id = f"aigfs_daily_{day}"
            plot_rainfall(sub_lons, sub_lats, daily_precip, frame_id, init_time, day, f"Day {day}")
            valid_frames.append(frame_id)

        except Exception as e:
            print(f"Error Day {day}: {e}")
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except:
                    pass

    # Generate Accumulation maps
    print("\nGenerating Accumulation Maps...")
    if 3 in accum_grids:
        plot_rainfall(sub_lons, sub_lats, accum_grids[3], "aigfs_3day", init_time, 3, "3-Day Total Accumulation")
    if 5 in accum_grids:
        plot_rainfall(sub_lons, sub_lats, accum_grids[5], "aigfs_5day", init_time, 5, "5-Day Total Accumulation")
    if 7 in accum_grids:
        plot_rainfall(sub_lons, sub_lats, accum_grids[7], "aigfs_7day", init_time, 7, "7-Day Total Accumulation")
    if 10 in accum_grids:
        plot_rainfall(sub_lons, sub_lats, accum_grids[10], "aigfs_10day", init_time, 10, "10-Day Total Accumulation")
    if 15 in accum_grids:
        plot_rainfall(sub_lons, sub_lats, accum_grids[15], "aigfs_15day", init_time, 15, "15-Day Total Accumulation")

    meta = {
        "model": "NOAA AIGFS",
        "source": "NOAA NCEP NOMADS",
        "generated_at": datetime.now().strftime("%Y-%m-%d %I:%M %p"),
        "run_time": init_time.strftime("%Y-%m-%d %H:%M UTC"),
        "animation_frames": valid_frames
    }
    with open(os.path.join(DATA_DIR, "rainfall_aigfs_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print("Rainfall successfully generated!")


if __name__ == "__main__":
    main()
