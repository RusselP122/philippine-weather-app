import os
import json
import re
import requests
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.lines as mlines
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import scipy.ndimage
from shapely.geometry import shape
from datetime import datetime, timedelta, timezone
from eccodes import codes_grib_new_from_file, codes_get, codes_get_double_array, codes_get_values, codes_release

# Import standardized visualization system
try:
    from weather_viz_styles import (
        WIND_SPEED_LEVELS, WIND_SPEED_CMAP, WIND_SPEED_NORM,
        load_ph_provinces, setup_map_ax, draw_par_boundary,
        add_mslp_contours, add_wind_vectors,
        add_styled_colorbar, draw_header_banner,
        DEFAULT_EXTENT, PAR_LONS, PAR_LATS
    )
except ImportError:
    DEFAULT_EXTENT = [112.0, 140.0, 2.0, 28.0]
    PAR_LONS = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
    PAR_LATS = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]
    WIND_SPEED_LEVELS = [0, 5, 10, 20, 30, 40, 50, 60, 75, 90, 105, 120, 140, 165, 185, 220]
    _ws_colors = [
        '#ffffff00', '#f0f9ff', '#bae6fd', '#60a5fa', '#2563eb',
        '#10b981', '#84cc16', '#eab308', '#f97316', '#ea580c',
        '#ef4444', '#dc2626', '#991b1b', '#c026d3', '#7c3aed'
    ]
    WIND_SPEED_CMAP = ListedColormap(_ws_colors)
    WIND_SPEED_CMAP.set_over('#3b0764')
    WIND_SPEED_NORM = BoundaryNorm(WIND_SPEED_LEVELS, ncolors=len(_ws_colors), clip=False)
    load_ph_provinces = lambda d=None: []
    setup_map_ax = None
    draw_par_boundary = None
    add_mslp_contours = None
    add_wind_vectors = None
    add_styled_colorbar = None
    draw_header_banner = None

OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "wind_aigfs")
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
            r = session.get(date_url, timeout=6)
            if r.status_code != 200:
                continue

            for cycle in ["18", "12", "06", "00"]:
                cycle_url = f"{date_url}{cycle}/model/atmos/grib2/"
                test_idx_url = f"{cycle_url}aigfs.t{cycle}z.sfc.f006.grib2.idx"
                try:
                    head_res = session.head(test_idx_url, timeout=5)
                    if head_res.status_code == 200:
                        run_dt = datetime.strptime(f"{date_str}{cycle}", "%Y%m%d%H").replace(tzinfo=timezone.utc)
                        print(f"Found latest AIGFS run: {date_str} {cycle}Z")
                        return cycle_url, run_dt, date_str, cycle
                except Exception:
                    continue
        except Exception:
            continue

    raise RuntimeError("Critical: No recent AIGFS cycle found on NOAA NOMADS.")


def download_byte_ranges(grib_url, idx_url, session):
    r = session.get(idx_url, timeout=10)
    if r.status_code != 200:
        raise ValueError(f"Failed to download index file from {idx_url}")

    lines = r.text.splitlines()
    ranges = []

    for i, line in enumerate(lines):
        parts = line.split(":")
        if len(parts) < 5:
            continue
        start_byte = int(parts[1])
        if i < len(lines) - 1:
            end_byte = int(lines[i + 1].split(":")[1]) - 1
        else:
            end_byte = ""

        var_name = parts[3]
        level = parts[4]

        if var_name in ["UGRD", "VGRD", "PRMSL"] and ("10 m" in level or "mean sea level" in level or "surface" in level):
            ranges.append((start_byte, end_byte, var_name))

    if not ranges:
        raise ValueError("Could not find required UGRD/VGRD/PRMSL fields in .idx file")

    temp_grib_path = os.path.join(os.getcwd(), f"temp_aigfs_{os.getpid()}_{np.random.randint(1000,9999)}.grib2")
    with open(temp_grib_path, "wb") as f:
        for start, end, var in ranges:
            headers = {"Range": f"bytes={start}-{end}"}
            gr = session.get(grib_url, headers=headers, timeout=15)
            f.write(gr.content)

    return temp_grib_path


def read_grib_fields(grib_file_path):
    u10, v10, mslp = None, None, None
    lats, lons = None, None

    with open(grib_file_path, "rb") as f:
        while True:
            gid = codes_grib_new_from_file(f)
            if gid is None:
                break

            short_name = codes_get(gid, "shortName")
            if lats is None:
                ni = codes_get(gid, "Ni")
                nj = codes_get(gid, "Nj")
                lats = codes_get_double_array(gid, "latitudes").reshape(nj, ni)
                lons = codes_get_double_array(gid, "longitudes").reshape(nj, ni)

            vals = codes_get_values(gid).reshape(lats.shape[0], lats.shape[1])

            if short_name in ["10u", "u10"]:
                u10 = vals
            elif short_name in ["10v", "v10"]:
                v10 = vals
            elif short_name in ["prmsl", "msl"]:
                mslp = vals

            codes_release(gid)

    if lons is not None and np.max(lons) > 180:
        lons = np.where(lons > 180, lons - 360, lons)

    return lats, lons, u10, v10, mslp


def plot_wind_frame(sub_lons, sub_lats, ws_kph, u_ms, v_ms, msl_hpa,
                    filename_id, init_time=None, valid_time=None, forecast_hour=None,
                    province_shapely_geometries=None):
    fig = plt.figure(figsize=(14, 11), dpi=120)
    fig.subplots_adjust(top=0.88)
    ax = plt.axes(projection=ccrs.PlateCarree())

    if setup_map_ax:
        setup_map_ax(ax, extent=[LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], provinces=province_shapely_geometries)
    else:
        ax.set_extent([LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], crs=ccrs.PlateCarree())
        ax.add_feature(cfeature.LAND, facecolor="#edf2f7", zorder=0)
        ax.add_feature(cfeature.OCEAN, facecolor="#d9e8f5", zorder=0)
        ax.add_feature(cfeature.COASTLINE, linewidth=0.9, edgecolor="#1e293b", zorder=5)
        ax.add_feature(cfeature.BORDERS, linestyle="-", linewidth=0.55, edgecolor="#64748b", zorder=5)

    cf = ax.contourf(
        sub_lons, sub_lats, ws_kph,
        levels=WIND_SPEED_LEVELS,
        cmap=WIND_SPEED_CMAP,
        norm=WIND_SPEED_NORM,
        extend="max",
        transform=ccrs.PlateCarree(),
        zorder=2
    )
    if add_styled_colorbar:
        add_styled_colorbar(fig, cf, ax, label="10m Wind Speed (kph)", ticks=WIND_SPEED_LEVELS)
    else:
        cb = fig.colorbar(cf, ax=ax, orientation="vertical", pad=0.02, shrink=0.85, aspect=25)
        cb.set_ticks(WIND_SPEED_LEVELS)

    if msl_hpa is not None:
        if add_mslp_contours:
            add_mslp_contours(ax, sub_lons, sub_lats, msl_hpa, levels=range(900, 1040, 4), sigma=1.0)
        else:
            msl_smooth = scipy.ndimage.gaussian_filter(msl_hpa, sigma=1)
            cs = ax.contour(sub_lons, sub_lats, msl_smooth, levels=range(900, 1040, 4), colors="#0f172a", linewidths=1.1, transform=ccrs.PlateCarree(), zorder=3)
            ax.clabel(cs, inline=True, fontsize=8.5, fmt="%d", colors="#0f172a")

    if add_wind_vectors:
        add_wind_vectors(ax, sub_lons, sub_lats, u_ms, v_ms, skip=None, scale=400, alpha=0.38)
    else:
        skip = max(1, int(sub_lons.shape[0] / 32))
        ax.quiver(sub_lons[::skip, ::skip], sub_lats[::skip, ::skip], u_ms[::skip, ::skip], v_ms[::skip, ::skip], transform=ccrs.PlateCarree(), color="#0f172a", alpha=0.35, width=0.0016, scale=400, headwidth=3.5, zorder=4)

    if draw_par_boundary:
        draw_par_boundary(ax)
    else:
        ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(), color="#dc2626", linestyle="-", linewidth=2.2, zorder=7)

    time_fmt  = "%Hz %a, %b %d, %Y"
    init_str  = init_time.strftime(time_fmt)  if init_time  else "Unknown"
    valid_str = valid_time.strftime(time_fmt) if valid_time else "Unknown"
    fh_str    = f"f{forecast_hour:03d}"       if forecast_hour is not None else "f---"

    if draw_header_banner:
        draw_header_banner(
            fig, ax,
            left_title="Philippine T/W",
            right_title="AIGFS 10m Wind Speed (kph) & MSLP (hPa)",
            model_sub=f"Model: NOAA AIGFS (0.25°)   |   Forecast Hour: {fh_str}",
            time_sub=f"Init: {init_str} / Valid: {valid_str}"
        )

    out_path = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(out_path, dpi=120, bbox_inches="tight", facecolor="white")
    print(f"  Saved {out_path}")
    plt.close(fig)


def main():
    print("\n=== NOAA AIGFS 16-Day 10m Wind + MSLP Generator ===\n")

    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 (WeatherApp)"})

    cycle_url, init_time, date_str, cycle = get_latest_aigfs_run(session)
    province_shapely_geometries = load_ph_provinces(DATA_DIR)

    steps = list(range(6, 385, 6))
    valid_frames = []

    for step in steps:
        print(f"Step T+{step:03d}h...")
        target_valid = init_time + timedelta(hours=step)

        grib_file_name = f"aigfs.t{cycle}z.sfc.f{step:03d}.grib2"
        grib_url = f"{cycle_url}{grib_file_name}"
        idx_url = f"{grib_url}.idx"

        temp_grib_path = None
        try:
            temp_grib_path = download_byte_ranges(grib_url, idx_url, session)
            lats, lons, u10, v10, mslp = read_grib_fields(temp_grib_path)

            if u10 is None or v10 is None:
                print(f"  Warning: Wind fields missing for step f{step:03d}")
                continue

            if lats.ndim == 2:
                lat_vec = lats[:, 0]
                lon_vec = lons[0, :]
            else:
                lat_vec = lats
                lon_vec = lons

            lat_mask = (lat_vec >= LAT_MIN) & (lat_vec <= LAT_MAX)
            lon_mask = (lon_vec >= LON_MIN) & (lon_vec <= LON_MAX)

            if lats.ndim == 2:
                sub_lats = lats[lat_mask, :][:, lon_mask]
                sub_lons = lons[lat_mask, :][:, lon_mask]
                sub_u = u10[lat_mask, :][:, lon_mask]
                sub_v = v10[lat_mask, :][:, lon_mask]
                sub_mslp = (mslp[lat_mask, :][:, lon_mask] / 100.0) if mslp is not None else None
            else:
                sub_lats, sub_lons = np.meshgrid(lat_vec[lat_mask], lon_vec[lon_mask], indexing='ij')
                sub_u = u10[lat_mask, :][:, lon_mask]
                sub_v = v10[lat_mask, :][:, lon_mask]
                sub_mslp = (mslp[lat_mask, :][:, lon_mask] / 100.0) if mslp is not None else None

            ws_kph = np.sqrt(sub_u**2 + sub_v**2) * 3.6

            filename_id = f"aigfs_wind_{step:03d}"
            plot_wind_frame(
                sub_lons, sub_lats, ws_kph, sub_u, sub_v, sub_mslp,
                filename_id,
                init_time=init_time,
                valid_time=target_valid,
                forecast_hour=step,
                province_shapely_geometries=province_shapely_geometries
            )
            valid_frames.append(filename_id)

        except Exception as e:
            print(f"  Error processing step f{step:03d}: {e}")
        finally:
            if temp_grib_path and os.path.exists(temp_grib_path):
                try:
                    os.remove(temp_grib_path)
                except Exception:
                    pass

    meta = {
        "model": "NOAA AIGFS (16-Day 0.25°) Deterministic",
        "source": "NOAA NCEP NOMADS",
        "generated_at": datetime.now().strftime("%Y-%m-%d %I:%M %p"),
        "run_time": init_time.strftime("%Y-%m-%d %H:%M UTC"),
        "animation_frames": valid_frames
    }

    meta_path = os.path.join(DATA_DIR, "wind_aigfs_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\nSaved metadata -> {meta_path}")
    print(f"Generated {len(valid_frames)} frames out of {len(steps)} steps successfully!")


if __name__ == "__main__":
    main()
