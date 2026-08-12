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

OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "precip_mslp_aigfs")
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

def plot_precip_mslp(lons, lats, precip_rate, msl_data, thickness, filename_id, init_time, valid_time, forecast_hour):
    fig = plt.figure(figsize=(14, 11))
    fig.subplots_adjust(top=0.88)
    ax = plt.axes(projection=ccrs.PlateCarree())
    ax.set_extent([LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], crs=ccrs.PlateCarree())

    ax.add_feature(cfeature.LAND, facecolor="#eaeaea", zorder=0)
    ax.add_feature(cfeature.OCEAN, facecolor="#d4e5ed", zorder=0)
    ax.add_feature(cfeature.COASTLINE, linewidth=1.0, edgecolor="#222222", zorder=5)
    ax.add_feature(cfeature.BORDERS, linestyle="-", linewidth=0.6, edgecolor="#555555", zorder=5)

    try:
        geojson_paths = [os.path.join(os.getcwd(), "public", "data", "ph_provinces.json")]
        found_geo = next((p for p in geojson_paths if os.path.exists(p)), None)
        if found_geo:
            with open(found_geo, "r", encoding="utf-8") as f: geo_data = json.load(f)
            prov_geoms = [shape(feat["geometry"]) for feat in geo_data["features"]]
            ax.add_geometries(prov_geoms, crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#555555', linewidth=0.4, alpha=0.6, zorder=3)
    except: pass

    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color="gray", alpha=0.4, linestyle=":", zorder=6)
    gl.top_labels = False; gl.right_labels = False

    pr_levels = [0, 0.5, 1, 2, 5, 8, 12, 18, 25, 35, 45, 55, 70, 85, 100, 150]
    pr_colors = ['#ffffff00', '#dbe9f6', '#a6cbe3', '#5ba3d0', '#227abb', '#4ac15e', '#2ea946', '#1a862f', '#ffdb00', '#f7a800', '#ea7200', '#df4000', '#d41c00', '#b40047', '#c432b4']
    pr_cmap = ListedColormap(pr_colors)
    pr_cmap.set_over('#4b0082')
    pr_norm = BoundaryNorm(pr_levels, ncolors=len(pr_colors), clip=False)

    if np.nanmax(precip_rate) > 0.05:
        cf = ax.contourf(lons, lats, precip_rate, levels=pr_levels, cmap=pr_cmap, norm=pr_norm, extend="max", transform=ccrs.PlateCarree(), zorder=2)
        cb = fig.colorbar(cf, ax=ax, orientation="vertical", pad=0.02, shrink=0.85, aspect=25)
        cb.set_ticks(pr_levels); cb.ax.tick_params(labelsize=9)
        cb.set_label("6-hr Precipitation (mm)", fontsize=10)
        cb.outline.set_edgecolor("black"); cb.outline.set_linewidth(1)

    if msl_data is not None:
        msl_smooth = scipy.ndimage.gaussian_filter(msl_data, sigma=1)
        cs = ax.contour(lons, lats, msl_smooth, levels=range(900, 1050, 4), colors="black", linewidths=1.2, transform=ccrs.PlateCarree(), zorder=3)
        ax.clabel(cs, inline=True, fontsize=9, fmt="%d", colors="black")

    if thickness is not None:
        thick_smooth = scipy.ndimage.gaussian_filter(thickness, sigma=1.5)
        thick_levels = list(range(492, 600, 6))
        ct = ax.contour(lons, lats, thick_smooth, levels=thick_levels, colors="#2563eb", linewidths=0.8, linestyles="dashed", transform=ccrs.PlateCarree(), zorder=3)
        ax.clabel(ct, inline=True, fontsize=8, fmt="%d", colors="#2563eb")
        ct540 = ax.contour(lons, lats, thick_smooth, levels=[540], colors="#dc2626", linewidths=2.5, linestyles="solid", transform=ccrs.PlateCarree(), zorder=4)
        ax.clabel(ct540, inline=True, fontsize=10, fmt="%d", colors="#dc2626")

    ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(), color="#d62728", linestyle="-", linewidth=2.5, zorder=7)

    time_fmt = "%Hz %a, %b %d, %Y"
    init_str = init_time.strftime(time_fmt)
    valid_str = valid_time.strftime(time_fmt)
    fh_str = f"f{forecast_hour:03d}"
    
    fig.canvas.draw()
    pos = ax.get_position()
    left, right = pos.x0, pos.x1
    y_top = pos.y1 + 0.045; y_bottom = pos.y1 + 0.015; y_line = pos.y1 + 0.005

    fig.text(left, y_top, "Philippine T/W", ha="left", va="bottom", fontsize=14, weight="bold", color="#888")
    fig.text(right, y_top, "6-hr Precip (mm), MSLP (hPa) & 1000\u2013500 mb Thickness (dam)", ha="right", va="bottom", fontsize=12, weight="bold", color="black")
    fig.text(left, y_bottom, f"Model: NOAA AIGFS   |   Forecast Hour: {fh_str}", ha="left", va="bottom", fontsize=11, color="black")
    fig.text(right, y_bottom, f"Init: {init_str} / Valid: {valid_str}", ha="right", va="bottom", fontsize=11, color="black")

    sep = mlines.Line2D((left, right), (y_line, y_line), color="black", linewidth=1, transform=fig.transFigure)
    fig.add_artist(sep)

    filepath = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(filepath, dpi=120, bbox_inches="tight", facecolor="white")
    print(f"  Saved {filepath}")
    plt.close()


def main():
    print("\n=== NOAA AIGFS 6-hr Precip + MSLP + Thickness Generator ===\n")
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})
    cycle_url, init_time, date_str, cycle = get_latest_aigfs_run(session)

    valid_frames = []
    
    for step in range(6, 385, 6):
        print(f"Processing step f{step:03d}...")
        valid_dt = init_time + timedelta(hours=step)
        
        sfc_grib = f"aigfs.t{cycle}z.sfc.f{step:03d}.grib2"
        pres_grib = f"aigfs.t{cycle}z.pres.f{step:03d}.grib2"
        sfc_url = f"{cycle_url}{sfc_grib}"; sfc_idx = f"{sfc_url}.idx"
        pres_url = f"{cycle_url}{pres_grib}"; pres_idx = f"{pres_url}.idx"
        
        # 1. Fetch APCP (6-hr accumulation)
        apcp_search = f"{step-6}-{step} hour acc fcst" if step > 6 else f"0-6 hour acc fcst"
        # check alt names
        apcp_search_alt = f"{step-6}-{step} hour acc fcst:"
        apcp_s, apcp_e = get_byte_range(sfc_idx, f"APCP:surface:{apcp_search}", session)
        if apcp_s is None:
            # Fallback for weird naming
             apcp_s, apcp_e = get_byte_range(sfc_idx, f"APCP:surface:", session)
             
        # 2. Fetch PRMSL
        prmsl_s, prmsl_e = get_byte_range(sfc_idx, "PRMSL:mean sea level:", session)
        
        # 3. Fetch HGT 500 & 1000
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
                sub_apcp = apcp[lat_mask, :][:, lon_mask]
                sub_prmsl = prmsl_hpa[lat_mask, :][:, lon_mask]
                sub_thick = thickness_dam[lat_mask, :][:, lon_mask]
            else:
                sub_lats, sub_lons = np.meshgrid(lat_vec[lat_mask], lon_vec[lon_mask], indexing='ij')
                sub_apcp = apcp[lat_mask, :][:, lon_mask]
                sub_prmsl = prmsl_hpa[lat_mask, :][:, lon_mask]
                sub_thick = thickness_dam[lat_mask, :][:, lon_mask]
            
            frame_id = f"aigfs_precip_{step:03d}"
            plot_precip_mslp(sub_lons, sub_lats, sub_apcp, sub_prmsl, sub_thick, frame_id, init_time, valid_dt, step)
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
