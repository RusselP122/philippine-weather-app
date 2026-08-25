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

# Import standardized visualization system
try:
    from weather_viz_styles import (
        RAINFALL_DAILY_LEVELS, RAINFALL_DAILY_CMAP, RAINFALL_DAILY_NORM,
        load_ph_provinces, setup_map_ax, draw_par_boundary,
        add_styled_colorbar, draw_header_banner,
        DEFAULT_EXTENT, PAR_LONS, PAR_LATS
    )
except ImportError:
    DEFAULT_EXTENT = [112.0, 140.0, 2.0, 28.0]
    PAR_LONS = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
    PAR_LATS = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]
    RAINFALL_DAILY_LEVELS = [
        0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 15.0, 20.0, 30.0, 40.0,
        50.0, 65.0, 80.0, 100.0, 125.0, 150.0, 175.0, 200.0, 250.0, 300.0, 400.0
    ]
    _rf_colors = [
        '#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0284c7',
        '#0369a1', '#0d9488', '#10b981', '#16a34a', '#84cc16',
        '#eab308', '#f97316', '#ea580c', '#ef4444', '#dc2626',
        '#b91c1c', '#db2777', '#c026d3', '#9333ea', '#6b21a8'
    ]
    RAINFALL_DAILY_CMAP = ListedColormap(_rf_colors)
    RAINFALL_DAILY_CMAP.set_over('#2e1065')
    RAINFALL_DAILY_NORM = BoundaryNorm(RAINFALL_DAILY_LEVELS, ncolors=len(_rf_colors), clip=False)
    load_ph_provinces = lambda d=None: []
    setup_map_ax = None
    draw_par_boundary = None
    add_styled_colorbar = None
    draw_header_banner = None

OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "rainfall_aigfs")
DATA_DIR   = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR,   exist_ok=True)

LAT_MIN, LAT_MAX = 2.0, 28.0
LON_MIN, LON_MAX = 112.0, 140.0


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
    r = session.get(idx_url, timeout=10)
    if r.status_code != 200: return None

    lines = r.text.splitlines()
    target_str = f"0-{target_day} day acc fcst"
    target_str_alt = f"0-{target_day} day acc fcst"
    target_str_alt2 = f"0-{target_day * 24} hour acc fcst"

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


def plot_rainfall(lons, lats, precip_grid, filename_id, init_dt, target_day, title_str, province_shapely_geometries=None):
    fig = plt.figure(figsize=(14, 11), dpi=120)
    fig.subplots_adjust(top=0.88)
    ax = plt.axes(projection=ccrs.PlateCarree())

    if setup_map_ax:
        setup_map_ax(ax, extent=[LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], provinces=province_shapely_geometries)
    else:
        ax.set_extent([LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], crs=ccrs.PlateCarree())
        ax.add_feature(cfeature.LAND, facecolor="#edf2f7", zorder=0)
        ax.add_feature(cfeature.OCEAN, facecolor="#d9e8f5", zorder=0)
        ax.add_feature(cfeature.COASTLINE, linewidth=0.9, edgecolor="#1e293b", zorder=3)
        ax.add_feature(cfeature.BORDERS, linestyle="-", linewidth=0.55, edgecolor="#64748b", zorder=3)

    if np.nanmax(precip_grid) > 0.05:
        cf = ax.contourf(
            lons, lats, precip_grid,
            levels=RAINFALL_DAILY_LEVELS,
            cmap=RAINFALL_DAILY_CMAP,
            norm=RAINFALL_DAILY_NORM,
            extend="max",
            transform=ccrs.PlateCarree(),
            zorder=2
        )
        if add_styled_colorbar:
            add_styled_colorbar(fig, cf, ax, label="Accumulated Precipitation (mm)", ticks=RAINFALL_DAILY_LEVELS)
        else:
            cb = fig.colorbar(cf, ax=ax, orientation="vertical", pad=0.02, shrink=0.85, aspect=25)
            cb.set_ticks(RAINFALL_DAILY_LEVELS)

    if draw_par_boundary:
        draw_par_boundary(ax)
    else:
        ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(), color="#dc2626", linestyle="-", linewidth=2.2, zorder=7)

    time_fmt = "%Hz %a, %b %d, %Y"
    init_str = init_dt.strftime(time_fmt)

    if draw_header_banner:
        draw_header_banner(
            fig, ax,
            left_title="Philippine T/W",
            right_title="AIGFS Accumulated Precipitation (mm)",
            model_sub=f"Model: NOAA AIGFS (0.25°)   |   {title_str}",
            time_sub=f"Init: {init_str}"
        )

    out_path = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(out_path, dpi=120, bbox_inches="tight", facecolor="white")
    print(f"  Saved {out_path}")
    plt.close(fig)


def main():
    print("\n=== NOAA AIGFS Daily Rainfall Generator ===\n")
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})
    cycle_url, init_time, date_str, cycle = get_latest_aigfs_run(session)

    province_shapely_geometries = load_ph_provinces(DATA_DIR)
    valid_frames = []
    prev_total = None
    accum_grids = {}

    for day in range(1, 17):
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

            accum_grids[day] = sub_current.copy()

            if prev_total is not None:
                daily_precip = sub_current - prev_total
            else:
                daily_precip = sub_current

            daily_precip = np.clip(daily_precip, 0, None)
            prev_total = sub_current.copy()

            frame_id = f"aigfs_daily_{day}"
            plot_rainfall(
                sub_lons, sub_lats, daily_precip, frame_id, init_time, day, f"Day {day} (24-hr Accumulation)",
                province_shapely_geometries=province_shapely_geometries
            )
            valid_frames.append(frame_id)

        except Exception as e:
            print(f"Error Day {day}: {e}")
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except:
                    pass

    print("\nGenerating Accumulation Maps...")
    if 3 in accum_grids:
        plot_rainfall(sub_lons, sub_lats, accum_grids[3], "aigfs_3day", init_time, 3, "3-Day Total Accumulation", province_shapely_geometries=province_shapely_geometries)
    if 5 in accum_grids:
        plot_rainfall(sub_lons, sub_lats, accum_grids[5], "aigfs_5day", init_time, 5, "5-Day Total Accumulation", province_shapely_geometries=province_shapely_geometries)
    if 7 in accum_grids:
        plot_rainfall(sub_lons, sub_lats, accum_grids[7], "aigfs_7day", init_time, 7, "7-Day Total Accumulation", province_shapely_geometries=province_shapely_geometries)
    if 10 in accum_grids:
        plot_rainfall(sub_lons, sub_lats, accum_grids[10], "aigfs_10day", init_time, 10, "10-Day Total Accumulation", province_shapely_geometries=province_shapely_geometries)
    if 15 in accum_grids:
        plot_rainfall(sub_lons, sub_lats, accum_grids[15], "aigfs_15day", init_time, 15, "15-Day Total Accumulation", province_shapely_geometries=province_shapely_geometries)

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
