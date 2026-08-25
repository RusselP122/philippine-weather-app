import os
import sys
import json
import re
import requests
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.lines as mlines
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from shapely.geometry import shape
import numpy as np
import scipy.ndimage
from datetime import datetime, timedelta, timezone
from pydap.client import open_url

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

OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "precip_mslp")
DATA_DIR   = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR,   exist_ok=True)

LAT_MIN, LAT_MAX = 2.0, 28.0
LON_MIN, LON_MAX = 112.0, 140.0


def get_latest_run_url(session):
    base_url = "https://thredds.ucar.edu/thredds/dodsC/grib/NCEP/GFS/Global_0p25deg"
    now = datetime.now(timezone.utc)
    for hours_back in range(0, 30):
        t = now - timedelta(hours=hours_back)
        if t.hour % 6 == 0:
            run_time = t.replace(minute=0, second=0, microsecond=0)
            datestr = run_time.strftime("%Y%m%d_%H%M")
            filename = f"GFS_Global_0p25deg_{datestr}.grib2"
            url = f"{base_url}/{filename}"
            try:
                r = session.head(url + ".dds", timeout=5)
                if r.status_code == 200:
                    print(f"Found GFS run: {filename}")
                    return url, run_time
            except Exception:
                continue
    raise Exception("Critical: Could not find any recent 00z, 06z, 12z, or 18z GFS run after 30 hours of checking.")


def parse_time_units(time_var):
    vals = time_var[:]
    units_str = time_var.attributes.get("units", "")
    m = re.match(r"(\w+)\s+since\s+(.+)", units_str)
    if not m:
        raise ValueError(f"Unknown time units: {units_str}")
    step = m.group(1).lower().rstrip("s")
    ref_str = m.group(2).replace("Z", "").replace("T", " ")
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


def plot_frame(
    lons, lats, precip_rate, msl_data, thickness,
    filename_id, init_time, valid_time, forecast_hour,
    province_shapely_geometries=None
):
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

    # 1. Precipitation fill
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

    # 2. MSLP isobars
    if msl_data is not None:
        if add_mslp_contours:
            add_mslp_contours(ax, X, Y, msl_data, levels=range(900, 1050, 4), sigma=1.0)
        else:
            msl_smooth = scipy.ndimage.gaussian_filter(msl_data, sigma=1)
            cs = ax.contour(X, Y, msl_smooth, levels=range(900, 1050, 4), colors="#0f172a", linewidths=1.1, transform=ccrs.PlateCarree(), zorder=3)
            ax.clabel(cs, inline=True, fontsize=8.5, fmt="%d", colors="#0f172a")

    # 3. 1000-500 mb thickness
    if thickness is not None:
        if add_thickness_contours:
            add_thickness_contours(ax, X, Y, thickness, sigma=1.5)
        else:
            thick_smooth = scipy.ndimage.gaussian_filter(thickness, sigma=1.5)
            ct = ax.contour(X, Y, thick_smooth, levels=list(range(492, 600, 6)), colors="#2563eb", linewidths=0.85, linestyles="dashed", transform=ccrs.PlateCarree(), zorder=3)
            ax.clabel(ct, inline=True, fontsize=8, fmt="%d", colors="#2563eb")
            ct540 = ax.contour(X, Y, thick_smooth, levels=[540], colors="#dc2626", linewidths=2.2, linestyles="solid", transform=ccrs.PlateCarree(), zorder=4)
            ax.clabel(ct540, inline=True, fontsize=9, fmt="%d", colors="#dc2626")

    # 4. PAR boundary
    if draw_par_boundary:
        draw_par_boundary(ax)
    else:
        ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(), color="#dc2626", linestyle="-", linewidth=2.2, zorder=7)

    # 5. Header banner
    time_fmt = "%Hz %a, %b %d, %Y"
    init_str = init_time.strftime(time_fmt) if init_time else "Unknown"
    valid_str = valid_time.strftime(time_fmt) if valid_time else "Unknown"
    fh_str = f"f{forecast_hour:03d}" if forecast_hour is not None else "f---"

    if draw_header_banner:
        draw_header_banner(
            fig, ax,
            left_title="Philippine T/W",
            right_title="6-hr Precip (mm), MSLP (hPa) & 1000-500 mb Thickness (dam)",
            model_sub=f"Model: GFS (0.25°)   |   Forecast Hour: {fh_str}",
            time_sub=f"Init: {init_str} / Valid: {valid_str}"
        )

    filepath = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(filepath, dpi=120, bbox_inches="tight", facecolor="white")
    print(f"  Saved {filepath}")
    plt.close(fig)


def main():
    print("\n=== 6-hr Precip Rate + MSLP + Thickness Generator ===\n")

    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 (WeatherApp)"})

    dataset_url, run_time = get_latest_run_url(session)
    ds = open_url(dataset_url, session=session)

    province_shapely_geometries = load_ph_provinces(DATA_DIR)

    all_keys = list(ds.keys())

    precip_name = None
    pref_names = [
        "Precipitation_rate_surface_Mixed_intervals_Average",
        "Precipitation_rate_surface",
        "Total_precipitation_surface_Mixed_intervals_Accumulation"
    ]
    for pref in pref_names:
        if pref in all_keys:
            precip_name = pref
            break
    if precip_name is None:
        candidates = [k for k in all_keys if "precip" in k.lower()]
        if candidates:
            precip_name = candidates[0]
    if precip_name is None:
        print("ERROR: No precipitation variable found")
        sys.exit(1)
    print(f"Precip var: {precip_name}")

    msl_name = None
    for k in all_keys:
        kl = k.lower()
        if ("pressure" in kl and "msl" in kl) or ("mslp" in kl) or ("mean_sea_level" in kl):
            msl_name = k
            break
    if msl_name is None:
        for k in all_keys:
            if "pressure_reduced" in k.lower():
                msl_name = k
                break
    print(f"MSLP var: {msl_name}")

    ghgt_name = None
    for k in all_keys:
        kl = k.lower()
        if "geopotential_height" in kl and "isobaric" in kl:
            ghgt_name = k
            break
    print(f"Geopotential var: {ghgt_name}")

    precip_var = ds[precip_name]
    dims = precip_var.dimensions
    time_dim, lat_dim, lon_dim = dims[0], dims[-2], dims[-1]

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

    time_var = ds[time_dim]
    all_dates = parse_time_units(time_var)
    init_time = all_dates[0] if all_dates else run_time or datetime.now(timezone.utc)
    print(f"Init time: {init_time}")
    print(f"Total time steps: {len(all_dates)}")

    def get_var_dates(var_name):
        if var_name is None:
            return []
        try:
            var = ds[var_name]
            tdim = var.dimensions[0]
            return parse_time_units(ds[tdim])
        except:
            return []

    msl_dates = get_var_dates(msl_name)
    ghgt_dates = get_var_dates(ghgt_name)

    iso_dim = None
    iso_data = None
    if ghgt_name:
        ghgt_var = ds[ghgt_name]
        for d in ghgt_var.dimensions:
            dl = d.lower()
            if "isobaric" in dl or "pressure" in dl or "lev" in dl:
                iso_dim = d
                break
        if iso_dim:
            iso_data = np.array(ds[iso_dim][:])
            if np.max(iso_data) > 2000:
                iso_hpa = iso_data / 100.0
            else:
                iso_hpa = iso_data
            idx_500 = int(np.argmin(np.abs(iso_hpa - 500)))
            idx_1000 = int(np.argmin(np.abs(iso_hpa - 1000)))
            print(f"Isobaric levels: 500hPa -> idx {idx_500} ({iso_hpa[idx_500]:.0f}), "
                  f"1000hPa -> idx {idx_1000} ({iso_hpa[idx_1000]:.0f})")

    valid_frames = []
    steps_6h = list(range(6, 385, 6))

    for step in steps_6h:
        print(f"\nStep T+{step}h ...")
        target_end = init_time + timedelta(hours=step)
        target_start = init_time + timedelta(hours=step - 6)
        idx_end = find_nearest_idx(all_dates, target_end)
        idx_start = find_nearest_idx(all_dates, target_start)
        valid_time = all_dates[idx_end]

        try:
            is_rate_var = "rate" in precip_name.lower()
            grid_end = np.array(
                precip_var[idx_end, li0:li1 + 1, lo0:lo1 + 1].data
            ).astype(float).squeeze()

            if is_rate_var:
                grid_end[grid_end < 0] = 0
                precip_rate = grid_end * 6 * 3600
            else:
                grid_start = np.array(
                    precip_var[idx_start, li0:li1 + 1, lo0:lo1 + 1].data
                ).astype(float).squeeze()
                grid_end[grid_end > 3000] = 0
                grid_end[grid_end < 0] = 0
                grid_start[grid_start > 3000] = 0
                grid_start[grid_start < 0] = 0
                precip_rate = np.maximum(grid_end - grid_start, 0)

            print(f"  Precip 6h max: {np.nanmax(precip_rate):.2f} mm")
        except Exception as e:
            print(f"  Precip fetch error: {e}")
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
                if np.nanmean(raw) > 50000:
                    raw = raw / 100.0
                msl_grid = raw
            except Exception as e:
                print(f"  MSLP fetch error: {e}")

        thick_grid = None
        if ghgt_name and iso_dim:
            try:
                ghgt_var = ds[ghgt_name]
                ghgt_dims = ghgt_var.dimensions
                ghgt_time_dim = ghgt_dims[0]
                ghgt_idx = find_nearest_idx(ghgt_dates, valid_time) if ghgt_dates else idx_end
                ghgt_idx = min(ghgt_idx, len(ghgt_dates) - 1) if ghgt_dates else ghgt_idx

                def build_slice(iso_idx):
                    slices = []
                    for i, d in enumerate(ghgt_dims):
                        if d == ghgt_time_dim:
                            slices.append(ghgt_idx)
                        elif d == iso_dim:
                            slices.append(iso_idx)
                        elif d == lat_dim:
                            slices.append(slice(li0, li1 + 1))
                        elif d == lon_dim:
                            slices.append(slice(lo0, lo1 + 1))
                        else:
                            slices.append(0)
                    return tuple(slices)

                z500 = np.array(
                    ghgt_var[build_slice(idx_500)].data
                ).astype(float).squeeze()
                z1000 = np.array(
                    ghgt_var[build_slice(idx_1000)].data
                ).astype(float).squeeze()

                if np.nanmean(z500) > 10000:
                    z500 = z500 / 10.0
                    z1000 = z1000 / 10.0

                thick_grid = z500 - z1000
            except Exception as e:
                print(f"  Thickness fetch error: {e}")

        frame_id = f"precip_mslp_{step:03d}"
        plot_frame(
            sub_lons, sub_lats, precip_rate, msl_grid, thick_grid,
            frame_id, init_time, valid_time, step,
            province_shapely_geometries=province_shapely_geometries
        )
        valid_frames.append(frame_id)

    meta = {
        "model": "GFS 0.25°",
        "source": "NOAA NOMADS / THREDDS",
        "generated_at": datetime.now().strftime("%Y-%m-%d %I:%M %p"),
        "run_time": init_time.strftime("%Y-%m-%d %H:%M UTC") if init_time else "Unknown",
        "animation_frames": valid_frames,
    }
    meta_path = os.path.join(DATA_DIR, "precip_mslp_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"\nSaved metadata to {meta_path}")
    print(f"Generated {len(valid_frames)} frames. Done!")


if __name__ == "__main__":
    main()
