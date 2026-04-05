"""
precip_mslp_thickness.py
========================
Generates 6-hour average precipitation rate (mm/hr) maps overlaid with
MSLP isobars and 1000-500 mb thickness contours from GFS 0.25° data.

Output: public/images/precip_mslp/  (PNGs)
        public/data/precip_mslp_meta.json
"""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.lines as mlines
import matplotlib.colors as mcolors
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import numpy as np
import scipy.ndimage
import os
import sys
import json
import re
import requests
from datetime import datetime, timedelta, timezone
from pydap.client import open_url

# ── Directories ────────────────────────────────────────────────────────────
OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "precip_mslp")
DATA_DIR = os.path.join(os.getcwd(), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# ── Region ─────────────────────────────────────────────────────────────────
LAT_MIN, LAT_MAX = 2.0, 28.0
LON_MIN, LON_MAX = 112.0, 140.0

# ── PAR boundary ───────────────────────────────────────────────────────────
PAR_LONS = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
PAR_LATS = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════

def get_latest_run_url(session):
    """Locate the most recent GFS 0.25° run on UCAR THREDDS."""
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
    """Parse CF-convention time units → list[datetime]."""
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


# ═══════════════════════════════════════════════════════════════════════════
# Plot one frame
# ═══════════════════════════════════════════════════════════════════════════

def plot_frame(
    lons, lats, precip_rate, msl_data, thickness,
    filename_id, init_time, valid_time, forecast_hour
):
    fig = plt.figure(figsize=(14, 11))
    fig.subplots_adjust(top=0.88)
    ax = plt.axes(projection=ccrs.PlateCarree())
    ax.set_extent([LON_MIN, LON_MAX, LAT_MIN, LAT_MAX], crs=ccrs.PlateCarree())

    # Base map
    ax.add_feature(cfeature.LAND, facecolor="#eaeaea", zorder=0)
    ax.add_feature(cfeature.OCEAN, facecolor="#d4e5ed", zorder=0)
    ax.add_feature(cfeature.COASTLINE, linewidth=1.0, edgecolor="#222", zorder=5)
    ax.add_feature(cfeature.BORDERS, linestyle="-", linewidth=0.6, edgecolor="#555", zorder=5)

    gl = ax.gridlines(draw_labels=True, linewidth=0.5, color="gray", alpha=0.4, linestyle=":", zorder=6)
    gl.top_labels = False
    gl.right_labels = False
    gl.xlabel_style = {"size": 10, "color": "#333"}
    gl.ylabel_style = {"size": 10, "color": "#333"}

    # Meshgrid
    if lons.ndim == 1:
        X, Y = np.meshgrid(lons, lats)
    else:
        X, Y = lons, lats

    # ── 1. Precipitation fill ────────────────────────────────────────────
    # Levels scaled for 6-hour accumulation (typical tropical: 0-100mm)
    pr_levels = [0, 0.5, 1, 2, 5, 8, 12, 18, 25, 35, 45, 55, 70, 85, 100, 150]
    pr_colors = [
        '#ffffff00',  # 0-0.5 (Transparent)
        '#dbe9f6',    # 0.5-1
        '#a6cbe3',    # 1-2
        '#5ba3d0',    # 2-5
        '#227abb',    # 5-8
        '#4ac15e',    # 8-12
        '#2ea946',    # 12-18
        '#1a862f',    # 18-25
        '#ffdb00',    # 25-35
        '#f7a800',    # 35-45
        '#ea7200',    # 45-55
        '#df4000',    # 55-70
        '#d41c00',    # 70-85
        '#b40047',    # 85-100
        '#c432b4',    # 100-150
    ]
    pr_cmap = ListedColormap(pr_colors)
    pr_cmap.set_over('#4b0082')
    pr_norm = BoundaryNorm(pr_levels, ncolors=len(pr_colors), clip=False)

    if np.nanmax(precip_rate) > 0:
        cf = ax.contourf(
            X, Y, precip_rate, levels=pr_levels, cmap=pr_cmap, norm=pr_norm,
            extend="max", transform=ccrs.PlateCarree(), zorder=2
        )
        cb = fig.colorbar(cf, ax=ax, orientation="vertical", pad=0.02, shrink=0.85, aspect=25)
        cb.set_ticks(pr_levels)
        cb.ax.tick_params(labelsize=9)
        cb.set_label("6-hr Precipitation (mm)", fontsize=10)
        cb.outline.set_edgecolor("black")
        cb.outline.set_linewidth(1)

    # ── 2. MSLP isobars ───────────────────────────────────────────────────
    if msl_data is not None:
        msl_smooth = scipy.ndimage.gaussian_filter(msl_data, sigma=1)
        cs = ax.contour(
            X, Y, msl_smooth, levels=range(900, 1050, 4),
            colors="black", linewidths=1.2, transform=ccrs.PlateCarree(), zorder=3
        )
        ax.clabel(cs, inline=True, fontsize=9, fmt="%d", colors="black")

    # ── 3. 1000-500 mb thickness ──────────────────────────────────────────
    if thickness is not None:
        thick_smooth = scipy.ndimage.gaussian_filter(thickness, sigma=1.5)
        # Thickness in decameters (dam)
        thick_levels = list(range(492, 600, 6))

        # Regular thickness lines (dashed blue)
        ct = ax.contour(
            X, Y, thick_smooth, levels=thick_levels,
            colors="#2563eb", linewidths=0.8, linestyles="dashed",
            transform=ccrs.PlateCarree(), zorder=3
        )
        ax.clabel(ct, inline=True, fontsize=8, fmt="%d", colors="#2563eb")

        # Highlight the 540 dam line (rain-snow boundary)
        ct540 = ax.contour(
            X, Y, thick_smooth, levels=[540],
            colors="#dc2626", linewidths=2.5, linestyles="solid",
            transform=ccrs.PlateCarree(), zorder=4
        )
        ax.clabel(ct540, inline=True, fontsize=10, fmt="%d", colors="#dc2626")

    # ── 4. PAR boundary ──────────────────────────────────────────────────
    ax.plot(PAR_LONS, PAR_LATS, transform=ccrs.PlateCarree(),
            color="#d62728", linestyle="-", linewidth=2.5, zorder=7)

    # ── 5. Banner header ─────────────────────────────────────────────────
    time_fmt = "%Hz %a, %b %d, %Y"
    init_str = init_time.strftime(time_fmt) if init_time else "Unknown"
    valid_str = valid_time.strftime(time_fmt) if valid_time else "Unknown"
    fh_str = f"f{forecast_hour:03d}" if forecast_hour is not None else "f---"

    fig.canvas.draw()
    pos = ax.get_position()
    left, right = pos.x0, pos.x1
    y_top = pos.y1 + 0.045
    y_bottom = pos.y1 + 0.015
    y_line = pos.y1 + 0.005

    fig.text(left, y_top, "Philippine T/W", ha="left", va="bottom",
             fontsize=14, weight="bold", color="#888")
    fig.text(right, y_top,
             "6-hr Precip (mm), MSLP (hPa) & 1000\u2013500 mb Thickness (dam)",
             ha="right", va="bottom", fontsize=12, weight="bold", color="black")
    fig.text(left, y_bottom, "Model: GFS (0.25°)", ha="left", va="bottom",
             fontsize=11, color="black")
    fig.text(left + 0.22, y_bottom, f"Forecast Hour: {fh_str}", ha="left",
             va="bottom", fontsize=11, color="black")
    fig.text(right, y_bottom, f"Init: {init_str} / Valid: {valid_str}",
             ha="right", va="bottom", fontsize=11, color="black")

    sep = mlines.Line2D((left, right), (y_line, y_line), color="black",
                        linewidth=1, transform=fig.transFigure)
    fig.add_artist(sep)

    filepath = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(filepath, dpi=120, bbox_inches="tight", facecolor="white")
    print(f"  Saved {filepath}")
    plt.close()


# ═══════════════════════════════════════════════════════════════════════════
# Main pipeline
# ═══════════════════════════════════════════════════════════════════════════

def main():
    print("\n=== 6-hr Precip Rate + MSLP + Thickness Generator ===\n")

    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 (WeatherApp)"})

    dataset_url, run_time = get_latest_run_url(session)
    ds = open_url(dataset_url, session=session)

    # ── Discover variable names ────────────────────────────────────────────
    all_keys = list(ds.keys())

    # Precipitation accumulation
    precip_name = None
    for k in all_keys:
        if "precipitation" in k.lower() and "accumulation" in k.lower():
            precip_name = k
            break
    if precip_name is None:
        candidates = [k for k in all_keys if "precip" in k.lower()]
        if candidates:
            precip_name = candidates[0]
    if precip_name is None:
        print("ERROR: No precipitation variable found")
        sys.exit(1)
    print(f"Precip var: {precip_name}")

    # MSLP
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

    # Geopotential height (isobaric)
    ghgt_name = None
    for k in all_keys:
        kl = k.lower()
        if "geopotential_height" in kl and "isobaric" in kl:
            ghgt_name = k
            break
    print(f"Geopotential var: {ghgt_name}")

    # ── Coordinate arrays ──────────────────────────────────────────────────
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

    # ── Time ──────────────────────────────────────────────────────────────
    time_var = ds[time_dim]
    all_dates = parse_time_units(time_var)
    init_time = all_dates[0] if all_dates else run_time or datetime.now(timezone.utc)
    print(f"Init time: {init_time}")
    print(f"Total time steps: {len(all_dates)}")

    # ── Isobaric levels for geopotential ──────────────────────────────────
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
            # Could be in Pa or hPa
            if np.max(iso_data) > 2000:
                iso_hpa = iso_data / 100.0
            else:
                iso_hpa = iso_data
            # Find indices for 500 and 1000 hPa
            idx_500 = int(np.argmin(np.abs(iso_hpa - 500)))
            idx_1000 = int(np.argmin(np.abs(iso_hpa - 1000)))
            print(f"Isobaric levels: 500hPa → idx {idx_500} ({iso_hpa[idx_500]:.0f}), "
                  f"1000hPa → idx {idx_1000} ({iso_hpa[idx_1000]:.0f})")

    # ── Generate frames ───────────────────────────────────────────────────
    now = datetime.now(timezone.utc)
    valid_frames = []
    steps_6h = list(range(6, 385, 6))  # T+6 through T+384 (16 days)

    for step in steps_6h:
        print(f"\nStep T+{step}h ...")
        target_end = now + timedelta(hours=step)
        target_start = now + timedelta(hours=step - 6)
        idx_end = find_nearest_idx(all_dates, target_end)
        idx_start = find_nearest_idx(all_dates, target_start)
        valid_time = all_dates[idx_end]

        # ── Precip rate ────────────────────────────────────────────────────
        try:
            grid_end = np.array(
                precip_var[idx_end, li0:li1 + 1, lo0:lo1 + 1].data
            ).astype(float).squeeze()
            grid_start = np.array(
                precip_var[idx_start, li0:li1 + 1, lo0:lo1 + 1].data
            ).astype(float).squeeze()
            grid_end[grid_end > 3000] = 0
            grid_end[grid_end < 0] = 0
            grid_start[grid_start > 3000] = 0
            grid_start[grid_start < 0] = 0
            precip_6h = np.maximum(grid_end - grid_start, 0)
            precip_rate = precip_6h  # 6h accumulated mm
        except Exception as e:
            print(f"  Precip fetch error: {e}")
            continue

        # ── MSLP ──────────────────────────────────────────────────────────
        msl_grid = None
        if msl_name:
            try:
                msl_var = ds[msl_name]
                raw = np.array(
                    msl_var[idx_end, li0:li1 + 1, lo0:lo1 + 1].data
                ).astype(float).squeeze()
                # Convert Pa → hPa if needed
                if np.nanmean(raw) > 50000:
                    raw = raw / 100.0
                msl_grid = raw
            except Exception as e:
                print(f"  MSLP fetch error: {e}")

        # ── Thickness ─────────────────────────────────────────────────────
        thick_grid = None
        if ghgt_name and iso_dim:
            try:
                ghgt_var = ds[ghgt_name]
                # Determine dimension order for the isobaric slice
                ghgt_dims = ghgt_var.dimensions
                iso_pos = list(ghgt_dims).index(iso_dim)

                # Build slices dynamically
                def build_slice(iso_idx):
                    slices = []
                    for i, d in enumerate(ghgt_dims):
                        if d == time_dim:
                            slices.append(idx_end)
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

                # Convert m → decameters
                if np.nanmean(z500) > 10000:
                    z500 = z500 / 10.0
                    z1000 = z1000 / 10.0

                thick_grid = z500 - z1000
            except Exception as e:
                print(f"  Thickness fetch error: {e}")

        # ── Plot ──────────────────────────────────────────────────────────
        frame_id = f"precip_mslp_{step:03d}"
        plot_frame(
            sub_lons, sub_lats, precip_rate, msl_grid, thick_grid,
            frame_id, init_time, valid_time, step
        )
        valid_frames.append(frame_id)

    # ── Metadata ──────────────────────────────────────────────────────────
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
