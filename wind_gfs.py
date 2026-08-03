import os
import json
from shapely.geometry import shape
"""
GFS 10m Wind Speed (kph) & MSLP Generator
Fetches data from UCAR THREDDS via OPeNDAP for the 00z, 06z, 12z, 18z runs.
Generates PNG frames for every 6-hour step out to T+384h (16 days).
"""

import matplotlib
matplotlib.use("Agg")

import matplotlib.pyplot as plt
import matplotlib.lines as mlines
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import numpy as np
import os
import json
import re
import scipy.ndimage
import requests
from pydap.client import open_url
from datetime import datetime, timedelta, timezone
from matplotlib.colors import ListedColormap, BoundaryNorm

# ── Directories ────────────────────────────────────────────────────────────────
OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "wind_gfs")
DATA_DIR   = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR,   exist_ok=True)

# ── Region ─────────────────────────────────────────────────────────────────────
LAT_MIN, LAT_MAX = 2.0, 28.0
LON_MIN, LON_MAX = 112.0, 140.0

# ── PAR boundary ───────────────────────────────────────────────────────────────
PAR_LONS = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
PAR_LATS = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]


# ═══════════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════════

def get_latest_run_url(session):
    """Return the URL of the most recent 00/06/12/18 GFS 0.25° run."""
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
    """CF-convention time → list[datetime UTC]."""
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
    """Return the parsed time axis for a given variable."""
    if var_name is None:
        return []
    try:
        tdim = ds[var_name].dimensions[0]
        return parse_time_units(ds[tdim])
    except Exception:
        return []


# ═══════════════════════════════════════════════════════════════════════════════
# Plotting
# ═══════════════════════════════════════════════════════════════════════════════

def plot_wind_frame(sub_lons, sub_lats, ws_kph, u_ms, v_ms, msl_hpa,
                    filename_id, init_time=None, valid_time=None, forecast_hour=None):
    """Render one frame and save to OUTPUT_DIR."""

    fig = plt.figure(figsize=(14, 11))
    fig.subplots_adjust(top=0.88)
    ax  = plt.axes(projection=ccrs.PlateCarree())
    ax.set_extent([LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], crs=ccrs.PlateCarree())

    ax.add_feature(cfeature.LAND,      facecolor="#eaeaea", zorder=0)
    ax.add_feature(cfeature.OCEAN,     facecolor="#d4e5ed", zorder=0)
    ax.add_feature(cfeature.COASTLINE, linewidth=1.0, edgecolor="#222222", zorder=5)
    ax.add_feature(cfeature.BORDERS,   linestyle="-", linewidth=0.6, edgecolor="#555555", zorder=5)
    # Add Philippine province boundaries from ph_provinces.json
    try:

        script_dir_path = os.path.dirname(os.path.abspath(__file__))
        geojson_paths_list = [
            os.path.join(script_dir_path, "public", "data", "ph_provinces.json"),
            os.path.join(os.getcwd(), "public", "data", "ph_provinces.json"),
            "public/data/ph_provinces.json"
        ]
        found_geojson_path = None
        for p_path in geojson_paths_list:
            if os.path.exists(p_path):
                found_geojson_path = p_path
                break
        if found_geojson_path:
            with open(found_geojson_path, 'r', encoding='utf-8') as geojson_file_handle:
                geojson_content_dict = json.load(geojson_file_handle)
            province_shapely_geometries = [shape(prov_feat['geometry']) for prov_feat in geojson_content_dict['features']]
            ax.add_geometries(province_shapely_geometries, crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#555555', linewidth=0.4, alpha=0.6, zorder=3)
    except Exception as province_load_error:
        print(f"Warning: Failed to overlay province boundaries: {province_load_error}")


    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color="gray",
                      alpha=0.4, linestyle=":", zorder=6)
    gl.top_labels   = False
    gl.right_labels = False
    gl.xlabel_style = {"size": 10, "color": "#333"}
    gl.ylabel_style = {"size": 10, "color": "#333"}

    # ── Wind-speed colormap ───────────────────────────────────────────────────
    levels = [0, 0.5, 1.5, 2.5, 5, 10, 20, 30, 40, 50, 60, 80, 100, 120, 150, 185, 220]
    colors = [
        "#ffffff00", "#ffffff", "#f8fafc", "#f1f5f9", "#f0f9ff", "#e0f2fe", 
        "#dbeafe", "#93c5fd", "#3b82f6", "#22c55e", "#eab308",   
        "#f97316", "#ef4444", "#dc2626", "#a855f7", "#7e22ce",
    ]
    cmap = ListedColormap(colors)
    cmap.set_over("#4b0082")
    norm = BoundaryNorm(levels, ncolors=len(colors), clip=False)

    X, Y = np.meshgrid(sub_lons, sub_lats)
    cf = ax.contourf(X, Y, ws_kph, levels=levels, cmap=cmap, norm=norm,
                     extend="max", transform=ccrs.PlateCarree(), zorder=2)
    cb = fig.colorbar(cf, ax=ax, orientation="vertical", pad=0.02, shrink=0.85, aspect=25)
    cb.set_ticks(levels)
    cb.ax.tick_params(labelsize=10)
    cb.set_label("Wind Speed (kph)", fontsize=10)
    cb.outline.set_edgecolor("black")
    cb.outline.set_linewidth(1)

    # ── MSLP isobars ─────────────────────────────────────────────────────────
    if msl_hpa is not None:
        msl_smooth = scipy.ndimage.gaussian_filter(msl_hpa, sigma=1)
        cs = ax.contour(X, Y, msl_smooth, levels=range(900, 1040, 4),
                        colors="black", linewidths=1.2,
                        transform=ccrs.PlateCarree(), zorder=3)
        ax.clabel(cs, inline=True, fontsize=10, fmt="%d", colors="black")

    # ── Wind arrows (barbs-style sub-sampling) ───────────────────────────────
    skip = 8
    ax.quiver(X[::skip, ::skip], Y[::skip, ::skip],
              u_ms[::skip, ::skip], v_ms[::skip, ::skip],
              transform=ccrs.PlateCarree(),
              color="black", alpha=0.35,
              width=0.0015, scale=400, headwidth=3, zorder=4)

    # ── PAR boundary ─────────────────────────────────────────────────────────
    ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(),
            color="#d62728", linestyle="-", linewidth=2.5, zorder=7)

    # ── Banner ───────────────────────────────────────────────────────────────
    time_fmt  = "%Hz %a, %b %d, %Y"
    init_str  = init_time.strftime(time_fmt)  if init_time  else "Unknown"
    valid_str = valid_time.strftime(time_fmt) if valid_time else "Unknown"
    fh_str    = f"f{forecast_hour:03d}"       if forecast_hour is not None else "f---"

    fig.canvas.draw()
    pos          = ax.get_position()
    left, right  = pos.x0, pos.x1
    y_top        = pos.y1 + 0.045
    y_bottom     = pos.y1 + 0.015
    y_line       = pos.y1 + 0.005

    fig.text(left,  y_top,    "Philippine T/W",
             ha="left",  va="bottom", fontsize=14, weight="bold", color="#888888")
    fig.text(right, y_top,    "GFS 10m Wind Speed (kph) & MSLP (hPa)",
             ha="right", va="bottom", fontsize=14, weight="bold", color="black")
    fig.text(left, y_bottom, f"Model: GFS (0.25\u00b0)   |   Forecast Hour: {fh_str}",
             ha="left", va="bottom", fontsize=11, color="black")
    fig.text(right, y_bottom, f"Init: {init_str} / Valid: {valid_str}",
             ha="right", va="bottom", fontsize=11, color="black")

    sep = mlines.Line2D((left, right), (y_line, y_line),
                        color="black", linewidth=1, transform=fig.transFigure)
    fig.add_artist(sep)

    out_path = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(out_path, dpi=120, bbox_inches="tight", facecolor="white")
    print(f"  Saved {out_path}")
    plt.close()


# ═══════════════════════════════════════════════════════════════════════════════
# Main pipeline
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    print("\n=== GFS 10m Wind + MSLP Generator ===\n")

    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 (WeatherApp)"})

    dataset_url, run_time = get_latest_run_url(session)
    ds = open_url(dataset_url, session=session)

    all_keys = list(ds.keys())

    # ── Discover wind variables ────────────────────────────────────────────────
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

    # ── Discover MSLP ─────────────────────────────────────────────────────────
    msl_name = None
    for k in all_keys:
        kl = k.lower()
        if ("pressure" in kl and "msl" in kl) or "pressure_reduced_to_msl" in kl:
            msl_name = k
            break
    print(f"MSLP var   : {msl_name}")

    # ── Coordinate arrays ─────────────────────────────────────────────────────
    u_var  = ds[u_name]
    u_dims = u_var.dimensions  # e.g. (time, height_above_ground, lat, lon)

    # Identify dimension names
    time_dim = u_dims[0]
    lat_dim  = u_dims[-2]
    lon_dim  = u_dims[-1]

    # Height level dimension (between time and lat)
    height_dim = u_dims[1] if len(u_dims) == 4 else None

    lat_data = np.array(ds[lat_dim][:])
    lon_data = np.array(ds[lon_dim][:])

    # Sub-region indices
    lat_idx = np.where((lat_data >= LAT_MIN) & (lat_data <= LAT_MAX))[0]
    lon_idx = np.where((lon_data >= LON_MIN) & (lon_data <= LON_MAX))[0]
    li0, li1 = int(lat_idx[0]), int(lat_idx[-1])
    lo0, lo1 = int(lon_idx[0]), int(lon_idx[-1])
    if li0 > li1:
        li0, li1 = li1, li0
    sub_lats = lat_data[li0:li1 + 1]
    sub_lons = lon_data[lo0:lo1 + 1]

    # ── Time axis for each variable ───────────────────────────────────────────
    all_dates  = parse_time_units(ds[time_dim])
    init_time  = all_dates[0] if all_dates else run_time or datetime.now(timezone.utc)
    msl_dates  = get_var_dates(ds, msl_name)
    print(f"Init time  : {init_time}")
    print(f"Wind steps : {len(all_dates)}")

    # ── Find 10m level index (if height dimension exists) ────────────────────
    height_idx = 0  # default to first (usually 10m)
    if height_dim:
        hgt_data = np.array(ds[height_dim][:])
        nearest  = int(np.argmin(np.abs(hgt_data - 10.0)))
        height_idx = nearest
        print(f"10m level  : index {height_idx} ({hgt_data[nearest]:.0f} m)")

    # ── Generate frames ───────────────────────────────────────────────────────
    valid_frames = []
    steps_6h    = list(range(6, 385, 6))   # T+6 … T+384 (16 days)

    for step in steps_6h:
        print(f"\nStep T+{step}h ...")
        target = init_time + timedelta(hours=step)
        idx    = find_nearest_idx(all_dates, target)
        valid_time = all_dates[idx]

        try:
            # ── U and V components ────────────────────────────────────────────
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

        # ── MSLP ─────────────────────────────────────────────────────────────
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

        # ── Plot ──────────────────────────────────────────────────────────────
        filename_id = f"gfs_wind_{step:03d}"
        plot_wind_frame(
            sub_lons, sub_lats, ws_kph, u_raw, v_raw, msl_grid,
            filename_id,
            init_time    = init_time,
            valid_time   = valid_time,
            forecast_hour= step,
        )
        valid_frames.append(filename_id)

    # ── Metadata ──────────────────────────────────────────────────────────────
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
    print(f"\nSaved metadata → {meta_path}")
    print(f"Generated {len(valid_frames)} frames. Done!")


if __name__ == "__main__":
    main()
