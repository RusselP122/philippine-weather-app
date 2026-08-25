import os
import json
import requests
import numpy as np
import scipy.ndimage
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
        PRECIP_6H_LEVELS, PRECIP_6H_CMAP, PRECIP_6H_NORM,
        load_ph_provinces, setup_map_ax, draw_par_boundary,
        add_mslp_contours, add_thickness_contours,
        add_styled_colorbar, draw_header_banner,
        DEFAULT_EXTENT, PAR_LONS, PAR_LATS
    )
except ImportError:
    DEFAULT_EXTENT = [112.0, 140.0, 2.0, 28.0]
    PAR_LONS = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
    PAR_LATS = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]
    PRECIP_6H_LEVELS = [0, 0.5, 1, 2, 5, 8, 12, 18, 25, 35, 45, 55, 70, 85, 100, 150]
    _pr_colors = [
        '#ffffff00', '#d4e6f6', '#a3c9e8', '#5b9cd6', '#246bb4',
        '#2db87a', '#1b964f', '#107536', '#f7d028', '#f59e0b',
        '#ea580c', '#dc2626', '#b91c1c', '#991b1b', '#c026d3'
    ]
    PRECIP_6H_CMAP = ListedColormap(_pr_colors)
    PRECIP_6H_CMAP.set_over('#4c1d95')
    PRECIP_6H_NORM = BoundaryNorm(PRECIP_6H_LEVELS, ncolors=len(_pr_colors), clip=False)
    load_ph_provinces = lambda d=None: []
    setup_map_ax = None
    draw_par_boundary = None
    add_mslp_contours = None
    add_thickness_contours = None
    add_styled_colorbar = None
    draw_header_banner = None

OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "precip_mslp_aigfs")
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


def get_byte_range(idx_url, search_str, session):
    r = session.get(idx_url, timeout=10)
    if r.status_code != 200: return None, None
    lines = r.text.splitlines()
    for i, line in enumerate(lines):
        if search_str in line:
            start_byte = int(line.split(":")[1])
            end_byte = int(lines[i + 1].split(":")[1]) - 1 if i < len(lines) - 1 else ""
            return start_byte, end_byte
    return None, None


def download_and_extract(grib_url, start, end, session):
    temp_path = os.path.join(os.getcwd(), f"temp_{os.getpid()}_{np.random.randint(1000,9999)}.grib2")
    headers = {"Range": f"bytes={start}-{end}"}
    gr = session.get(grib_url, headers=headers, timeout=15)
    with open(temp_path, "wb") as f:
        f.write(gr.content)

    lats, lons, values = None, None, None
    with open(temp_path, "rb") as f:
        gid = codes_grib_new_from_file(f)
        if gid:
            ni = codes_get(gid, "Ni"); nj = codes_get(gid, "Nj")
            lats = codes_get_double_array(gid, "latitudes").reshape(nj, ni)
            lons = codes_get_double_array(gid, "longitudes").reshape(nj, ni)
            values = codes_get_values(gid).reshape(nj, ni)
            codes_release(gid)
    if lons is not None and np.max(lons) > 180:
        lons = np.where(lons > 180, lons - 360, lons)
    try:
        os.remove(temp_path)
    except:
        pass
    return lats, lons, values


def plot_precip_mslp(lons, lats, precip_rate, msl_data, thickness, filename_id, init_time, valid_time, forecast_hour, province_shapely_geometries=None):
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

    if lons.ndim == 1:
        X, Y = np.meshgrid(lons, lats)
    else:
        X, Y = lons, lats

    if np.nanmax(precip_rate) > 0.05:
        cf = ax.contourf(
            X, Y, precip_rate,
            levels=PRECIP_6H_LEVELS,
            cmap=PRECIP_6H_CMAP,
            norm=PRECIP_6H_NORM,
            extend="max",
            transform=ccrs.PlateCarree(),
            zorder=2
        )
        if add_styled_colorbar:
            add_styled_colorbar(fig, cf, ax, label="6-hr Precipitation (mm)", ticks=PRECIP_6H_LEVELS)
        else:
            cb = fig.colorbar(cf, ax=ax, orientation="vertical", pad=0.02, shrink=0.85, aspect=25)
            cb.set_ticks(PRECIP_6H_LEVELS)

    if msl_data is not None:
        if add_mslp_contours:
            add_mslp_contours(ax, X, Y, msl_data, levels=range(900, 1050, 4), sigma=1.0)
        else:
            msl_smooth = scipy.ndimage.gaussian_filter(msl_data, sigma=1)
            cs = ax.contour(X, Y, msl_smooth, levels=range(900, 1050, 4), colors="#0f172a", linewidths=1.1, transform=ccrs.PlateCarree(), zorder=3)
            ax.clabel(cs, inline=True, fontsize=8.5, fmt="%d", colors="#0f172a")

    if thickness is not None:
        if add_thickness_contours:
            add_thickness_contours(ax, X, Y, thickness, sigma=1.5)
        else:
            thick_smooth = scipy.ndimage.gaussian_filter(thickness, sigma=1.5)
            ct = ax.contour(X, Y, thick_smooth, levels=list(range(492, 600, 6)), colors="#2563eb", linewidths=0.85, linestyles="dashed", transform=ccrs.PlateCarree(), zorder=3)
            ax.clabel(ct, inline=True, fontsize=8, fmt="%d", colors="#2563eb")
            ct540 = ax.contour(X, Y, thick_smooth, levels=[540], colors="#dc2626", linewidths=2.2, linestyles="solid", transform=ccrs.PlateCarree(), zorder=4)
            ax.clabel(ct540, inline=True, fontsize=9, fmt="%d", colors="#dc2626")

    if draw_par_boundary:
        draw_par_boundary(ax)
    else:
        ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(), color="#dc2626", linestyle="-", linewidth=2.2, zorder=7)

    time_fmt = "%Hz %a, %b %d, %Y"
    init_str = init_time.strftime(time_fmt)
    valid_str = valid_time.strftime(time_fmt)
    fh_str = f"f{forecast_hour:03d}"

    if draw_header_banner:
        draw_header_banner(
            fig, ax,
            left_title="Philippine T/W",
            right_title="6-hr Precip (mm), MSLP (hPa) & 1000-500 mb Thickness (dam)",
            model_sub=f"Model: NOAA AIGFS (0.25°)   |   Forecast Hour: {fh_str}",
            time_sub=f"Init: {init_str} / Valid: {valid_str}"
        )

    filepath = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(filepath, dpi=120, bbox_inches="tight", facecolor="white")
    print(f"  Saved {filepath}")
    plt.close(fig)


def main():
    print("\n=== NOAA AIGFS 6-hr Precip + MSLP + Thickness Generator ===\n")
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})
    cycle_url, init_time, date_str, cycle = get_latest_aigfs_run(session)

    province_shapely_geometries = load_ph_provinces(DATA_DIR)
    valid_frames = []

    for step in range(6, 385, 6):
        print(f"Processing step f{step:03d}...")
        valid_dt = init_time + timedelta(hours=step)

        sfc_grib = f"aigfs.t{cycle}z.sfc.f{step:03d}.grib2"
        pres_grib = f"aigfs.t{cycle}z.pres.f{step:03d}.grib2"
        sfc_url = f"{cycle_url}{sfc_grib}"; sfc_idx = f"{sfc_url}.idx"
        pres_url = f"{cycle_url}{pres_grib}"; pres_idx = f"{pres_url}.idx"

        apcp_search = f"{step-6}-{step} hour acc fcst" if step > 6 else f"0-6 hour acc fcst"
        apcp_s, apcp_e = get_byte_range(sfc_idx, f"APCP:surface:{apcp_search}", session)
        if apcp_s is None:
            apcp_s, apcp_e = get_byte_range(sfc_idx, f"APCP:surface:", session)

        prmsl_s, prmsl_e = get_byte_range(sfc_idx, "PRMSL:mean sea level:", session)
        hgt500_s, hgt500_e = get_byte_range(pres_idx, "HGT:500 mb:", session)
        hgt1000_s, hgt1000_e = get_byte_range(pres_idx, "HGT:1000 mb:", session)

        if None in [apcp_s, prmsl_s, hgt500_s, hgt1000_s]:
            print(f"  Warning: Missing variables in f{step:03d}. Skipping.")
            continue

        try:
            lats, lons, apcp = download_and_extract(sfc_url, apcp_s, apcp_e, session)
            _, _, prmsl = download_and_extract(sfc_url, prmsl_s, prmsl_e, session)
            _, _, hgt500 = download_and_extract(pres_url, hgt500_s, hgt500_e, session)
            _, _, hgt1000 = download_and_extract(pres_url, hgt1000_s, hgt1000_e, session)

            prmsl_hpa = prmsl / 100.0
            thickness_dam = (hgt500 - hgt1000) / 10.0

            if lats.ndim == 2:
                lat_vec = lats[:, 0]; lon_vec = lons[0, :]
            else:
                lat_vec = lats; lon_vec = lons

            lat_mask = (lat_vec >= LAT_MIN) & (lat_vec <= LAT_MAX)
            lon_mask = (lon_vec >= LON_MIN) & (lon_vec <= LON_MAX)

            if lats.ndim == 2:
                sub_lats = lats[lat_mask, :][:, lon_mask]
                sub_lons = lons[lat_mask, :][:, lon_mask]
                sub_apcp = apcp[lat_mask, :][:, lon_mask]
                sub_prmsl = prmsl_hpa[lat_mask, :][:, lon_mask]
                sub_thick = thickness_dam[lat_mask, :][:, lon_mask]
            else:
                sub_lats, sub_lons = np.meshgrid(lat_vec[lat_mask], lon_vec[lon_mask], indexing='ij')
                sub_apcp = apcp[lat_mask, :][:, lon_mask]
                sub_prmsl = prmsl_hpa[lat_mask, :][:, lon_mask]
                sub_thick = thickness_dam[lat_mask, :][:, lon_mask]

            frame_id = f"aigfs_precip_{step:03d}"
            plot_precip_mslp(
                sub_lons, sub_lats, sub_apcp, sub_prmsl, sub_thick,
                frame_id, init_time, valid_dt, step,
                province_shapely_geometries=province_shapely_geometries
            )
            valid_frames.append(frame_id)

        except Exception as e:
            print(f"Error in step {step}: {e}")

    meta = {
        "model": "NOAA AIGFS",
        "source": "NOAA NCEP NOMADS",
        "generated_at": datetime.now().strftime("%Y-%m-%d %I:%M %p"),
        "run_time": init_time.strftime("%Y-%m-%d %H:%M UTC"),
        "animation_frames": valid_frames
    }
    with open(os.path.join(DATA_DIR, "precip_mslp_aigfs_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\nGenerated {len(valid_frames)} frames successfully!")


if __name__ == "__main__":
    main()
