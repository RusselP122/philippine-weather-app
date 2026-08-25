import os
import json
import re
import scipy.ndimage
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
from pydap.client import open_url

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

OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "wind_gfs")
DATA_DIR   = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR,   exist_ok=True)

LAT_MIN, LAT_MAX = 2.0, 28.0
LON_MIN, LON_MAX = 112.0, 140.0


def get_latest_run_url(session):
    base = "https://thredds.ucar.edu/thredds/dodsC/grib/NCEP/GFS/Global_0p25deg"
    now  = datetime.now(timezone.utc)
    for hours_back in range(0, 30):
        t = now - timedelta(hours=hours_back)
        if t.hour % 6 == 0:
            run = t.replace(minute=0, second=0, microsecond=0)
            fname = f"GFS_Global_0p25deg_{run.strftime('%Y%m%d_%H%M')}.grib2"
            url   = f"{base}/{fname}"
            try:
                r = session.head(url + ".dds", timeout=5)
                if r.status_code == 200:
                    print(f"Found GFS run: {fname}")
                    return url, run
            except Exception:
                continue
    raise Exception("Critical: No recent 00z/06z/12z/18z GFS run found after 30 hours.")


def parse_time_units(time_var):
    vals     = time_var[:]
    units    = time_var.attributes.get("units", "")
    m        = re.match(r"(\w+)\s+since\s+(.+)", units)
    if not m:
        raise ValueError(f"Unknown time units: {units}")
    step     = m.group(1).lower().rstrip("s")
    ref_str  = m.group(2).replace("Z", "").replace("T", " ").strip()
    try:
        ref = datetime.strptime(ref_str, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        ref = datetime.strptime(ref_str, "%Y-%m-%d %H:%M")
    ref = ref.replace(tzinfo=timezone.utc)
    out = []
    for v in vals:
        if step == "hour":
            out.append(ref + timedelta(hours=float(v)))
        elif step == "minute":
            out.append(ref + timedelta(minutes=float(v)))
        else:
            out.append(ref + timedelta(days=float(v)))
    return out


def find_nearest_idx(dates, target):
    deltas = [abs((d - target).total_seconds()) for d in dates]
    return deltas.index(min(deltas))


def get_var_dates(ds, var_name):
    if var_name is None:
        return []
    try:
        tdim = ds[var_name].dimensions[0]
        return parse_time_units(ds[tdim])
    except Exception:
        return []


def plot_wind_frame(sub_lons, sub_lats, ws_kph, u_ms, v_ms, msl_hpa,
                    filename_id, init_time=None, valid_time=None, forecast_hour=None,
                    province_shapely_geometries=None):
    fig = plt.figure(figsize=(14, 11), dpi=120)
    fig.subplots_adjust(top=0.88)
    ax  = plt.axes(projection=ccrs.PlateCarree())

    if setup_map_ax:
        setup_map_ax(ax, extent=[LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], provinces=province_shapely_geometries)
    else:
        ax.set_extent([LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], crs=ccrs.PlateCarree())
        ax.add_feature(cfeature.LAND,      facecolor="#edf2f7", zorder=0)
        ax.add_feature(cfeature.OCEAN,     facecolor="#d9e8f5", zorder=0)
        ax.add_feature(cfeature.COASTLINE, linewidth=0.9, edgecolor="#1e293b", zorder=5)
        ax.add_feature(cfeature.BORDERS,   linestyle="-", linewidth=0.55, edgecolor="#64748b", zorder=5)

    X, Y = np.meshgrid(sub_lons, sub_lats)
    cf = ax.contourf(
        X, Y, ws_kph,
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

    # MSLP isobars
    if msl_hpa is not None:
        if add_mslp_contours:
            add_mslp_contours(ax, X, Y, msl_hpa, levels=range(900, 1040, 4), sigma=1.0)
        else:
            msl_smooth = scipy.ndimage.gaussian_filter(msl_hpa, sigma=1)
            cs = ax.contour(X, Y, msl_smooth, levels=range(900, 1040, 4), colors="#0f172a", linewidths=1.1, transform=ccrs.PlateCarree(), zorder=3)
            ax.clabel(cs, inline=True, fontsize=8.5, fmt="%d", colors="#0f172a")

    # Wind arrows
    if add_wind_vectors:
        add_wind_vectors(ax, X, Y, u_ms, v_ms, skip=8, scale=400, alpha=0.38)
    else:
        ax.quiver(X[::8, ::8], Y[::8, ::8], u_ms[::8, ::8], v_ms[::8, ::8], transform=ccrs.PlateCarree(), color="#0f172a", alpha=0.35, width=0.0016, scale=400, headwidth=3.5, zorder=4)

    # PAR boundary
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
            right_title="GFS 10m Wind Speed (kph) & MSLP (hPa)",
            model_sub=f"Model: GFS (0.25°)   |   Forecast Hour: {fh_str}",
            time_sub=f"Init: {init_str} / Valid: {valid_str}"
        )

    out_path = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(out_path, dpi=120, bbox_inches="tight", facecolor="white")
    print(f"  Saved {out_path}")
    plt.close(fig)


def main():
    print("\n=== GFS 10m Wind + MSLP Generator ===\n")

    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 (WeatherApp)"})

    dataset_url, run_time = get_latest_run_url(session)
    ds = open_url(dataset_url, session=session)

    province_shapely_geometries = load_ph_provinces(DATA_DIR)

    all_keys = list(ds.keys())

    u_name, v_name = None, None
    for k in all_keys:
        kl = k.lower()
        if "u-component_of_wind" in kl and "height_above_ground" in kl:
            u_name = k
        if "v-component_of_wind" in kl and "height_above_ground" in kl:
            v_name = k
    print(f"U-wind var : {u_name}")
    print(f"V-wind var : {v_name}")
    if u_name is None or v_name is None:
        raise RuntimeError("Could not find 10m U/V wind variables in dataset.")

    msl_name = None
    for k in all_keys:
        kl = k.lower()
        if ("pressure" in kl and "msl" in kl) or "pressure_reduced_to_msl" in kl:
            msl_name = k
            break
    print(f"MSLP var   : {msl_name}")

    u_var  = ds[u_name]
    u_dims = u_var.dimensions

    time_dim = u_dims[0]
    lat_dim  = u_dims[-2]
    lon_dim  = u_dims[-1]

    height_dim = u_dims[1] if len(u_dims) == 4 else None

    lat_data = np.array(ds[lat_dim][:])
    lon_data = np.array(ds[lon_dim][:])

    lat_idx = np.where((lat_data >= LAT_MIN) & (lat_data <= LAT_MAX))[0]
    lon_idx = np.where((lon_data >= LON_MIN) & (lon_data <= LON_MAX))[0]
    li0, li1 = int(lat_idx[0]), int(lat_idx[-1])
    lo0, lo1 = int(lon_idx[0]), int(lon_idx[-1])
    if li0 > li1:
        li0, li1 = li1, li0
    sub_lats = lat_data[li0:li1 + 1]
    sub_lons = lon_data[lo0:lo1 + 1]

    all_dates  = parse_time_units(ds[time_dim])
    init_time  = all_dates[0] if all_dates else run_time or datetime.now(timezone.utc)
    msl_dates  = get_var_dates(ds, msl_name)
    print(f"Init time  : {init_time}")
    print(f"Wind steps : {len(all_dates)}")

    height_idx = 0
    if height_dim:
        hgt_data = np.array(ds[height_dim][:])
        nearest  = int(np.argmin(np.abs(hgt_data - 10.0)))
        height_idx = nearest
        print(f"10m level  : index {height_idx} ({hgt_data[nearest]:.0f} m)")

    valid_frames = []
    steps_6h    = list(range(6, 385, 6))

    for step in steps_6h:
        print(f"\nStep T+{step}h ...")
        target = init_time + timedelta(hours=step)
        idx    = find_nearest_idx(all_dates, target)
        valid_time = all_dates[idx]

        try:
            if height_dim:
                u_raw = np.array(
                    u_var[idx, height_idx, li0:li1 + 1, lo0:lo1 + 1].data
                ).astype(float).squeeze()
                v_raw = np.array(
                    ds[v_name][idx, height_idx, li0:li1 + 1, lo0:lo1 + 1].data
                ).astype(float).squeeze()
            else:
                u_raw = np.array(
                    u_var[idx, li0:li1 + 1, lo0:lo1 + 1].data
                ).astype(float).squeeze()
                v_raw = np.array(
                    ds[v_name][idx, li0:li1 + 1, lo0:lo1 + 1].data
                ).astype(float).squeeze()

            ws_ms  = np.sqrt(u_raw**2 + v_raw**2)
            ws_kph = ws_ms * 3.6
            print(f"  Wind max: {np.nanmax(ws_kph):.1f} kph")

        except Exception as e:
            print(f"  Wind fetch error: {e}")
            continue

        msl_grid = None
        if msl_name and msl_dates:
            try:
                msl_var = ds[msl_name]
                msl_idx = find_nearest_idx(msl_dates, valid_time)
                msl_idx = min(msl_idx, len(msl_dates) - 1)
                raw = np.array(
                    msl_var[msl_idx, li0:li1 + 1, lo0:lo1 + 1].data
                ).astype(float).squeeze()
                msl_grid = raw / 100.0 if np.nanmean(raw) > 50000 else raw
            except Exception as e:
                print(f"  MSLP fetch error: {e}")

        filename_id = f"gfs_wind_{step:03d}"
        plot_wind_frame(
            sub_lons, sub_lats, ws_kph, u_raw, v_raw, msl_grid,
            filename_id,
            init_time    = init_time,
            valid_time   = valid_time,
            forecast_hour= step,
            province_shapely_geometries=province_shapely_geometries
        )
        valid_frames.append(filename_id)

    meta = {
        "model"           : "GFS (0.25°)",
        "source"          : "NOAA / UCAR THREDDS",
        "generated_at"    : datetime.now().strftime("%Y-%m-%d %I:%M %p"),
        "run_time"        : init_time.strftime("%Y-%m-%d %H:%M UTC"),
        "animation_frames": valid_frames,
    }
    meta_path = os.path.join(DATA_DIR, "wind_gfs_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"\nSaved metadata -> {meta_path}")
    print(f"Generated {len(valid_frames)} frames. Done!")


if __name__ == "__main__":
    main()
