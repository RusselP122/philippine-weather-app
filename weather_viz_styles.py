"""
weather_viz_styles.py
======================
Standardized, production-grade, accessible, and high-performance weather forecast
visualization styles and utilities for the Philippine Weather Forecasting system.

Provides:
- Colorblind-safe, high-contrast, perceptually tuned colormaps (Precipitation, Rainfall, Wind Speed)
- Base cartography features (Land, Ocean, Coastline, Borders, Provinces, PAR boundaries, Gridlines)
- MSLP isobars with Gaussian smoothing & white-halo contour labels
- 1000-500 mb thickness contours with 540 dam highlight & halo labels
- Wind vector / quiver drawing with optimal subsampling
- Professional header banners and styled colorbars
"""

import os
import json
from datetime import datetime, timezone, timedelta
import numpy as np
import scipy.ndimage
from scipy.interpolate import RegularGridInterpolator
import matplotlib
import matplotlib.pyplot as plt
import matplotlib.lines as mlines
import matplotlib.patheffects as patheffects
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from shapely.geometry import shape

# ── Geographic Domain ────────────────────────────────────────────────────────
DEFAULT_EXTENT = [112.0, 140.0, 2.0, 28.0]  # [LON_MIN, LON_MAX, LAT_MIN, LAT_MAX]
PAR_LONS = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
PAR_LATS = [5.0, 15.0, 21.0, 25.0, 25.0, 5.0, 5.0]

# ── Text Halo Effects for Ultra-Clear Contours ──────────────────────────────
STROKE_WHITE_HALO = [patheffects.withStroke(linewidth=2.5, foreground='white', alpha=0.9)]
STROKE_DARK_HALO = [patheffects.withStroke(linewidth=2.5, foreground='#0f172a', alpha=0.9)]

# ════════════════════════════════════════════════════════════════════════════
# 1. Colormaps & Norms
# ════════════════════════════════════════════════════════════════════════════

# ── 6-Hour Precipitation Colormap ───────────────────────────────────────────
PRECIP_6H_LEVELS = [0, 0.5, 1, 2, 5, 8, 12, 18, 25, 35, 45, 55, 70, 85, 100, 150]
PRECIP_6H_COLORS = [
    '#ffffff00',  # 0.0 - 0.5 mm: Transparent
    '#d4e6f6',    # 0.5 - 1.0 mm: Very light ice blue
    '#a3c9e8',    # 1.0 - 2.0 mm: Soft sky blue
    '#5b9cd6',    # 2.0 - 5.0 mm: Light royal blue
    '#246bb4',    # 5.0 - 8.0 mm: Deep ocean blue
    '#2db87a',    # 8.0 - 12 mm: Teal-mint green
    '#1b964f',    # 12 - 18 mm: Lush emerald green
    '#107536',    # 18 - 25 mm: Deep forest green
    '#f7d028',    # 25 - 35 mm: Bright warm yellow
    '#f59e0b',    # 35 - 45 mm: Amber gold
    '#ea580c',    # 45 - 55 mm: Rich warm orange
    '#dc2626',    # 55 - 70 mm: Bright scarlet red
    '#b91c1c',    # 70 - 85 mm: Deep crimson
    '#991b1b',    # 85 - 100 mm: Dark blood ruby
    '#c026d3',    # 100 - 150 mm: Vivid magenta
]
PRECIP_6H_CMAP = ListedColormap(PRECIP_6H_COLORS, name="ph_precip_6h")
PRECIP_6H_CMAP.set_over('#4c1d95')  # > 150 mm: Deep royal purple
PRECIP_6H_NORM = BoundaryNorm(PRECIP_6H_LEVELS, ncolors=len(PRECIP_6H_COLORS), clip=False)


# ── Daily / Cumulative Rainfall Colormap (High Dynamic Range) ──────────────
RAINFALL_DAILY_LEVELS = [
    0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 15.0, 20.0, 30.0, 40.0,
    50.0, 65.0, 80.0, 100.0, 125.0, 150.0, 175.0, 200.0, 250.0, 300.0, 400.0
]
RAINFALL_DAILY_COLORS = [
    '#e0f2fe',  # 0.1 - 0.5 mm: Ice blue mist
    '#bae6fd',  # 0.5 - 1.0 mm: Soft cyan
    '#7dd3fc',  # 1.0 - 2.0 mm: Sky cyan
    '#38bdf8',  # 2.0 - 5.0 mm: Bright light blue
    '#0284c7',  # 5.0 - 10.0 mm: Medium azure
    '#0369a1',  # 10.0 - 15.0 mm: Deep ocean blue
    '#0d9488',  # 15.0 - 20.0 mm: Teal-cyan
    '#10b981',  # 20.0 - 30.0 mm: Bright mint emerald
    '#16a34a',  # 30.0 - 40.0 mm: Lush green
    '#84cc16',  # 40.0 - 50.0 mm: Lime / Yellow-green
    '#eab308',  # 50.0 - 65.0 mm: Golden yellow
    '#f97316',  # 65.0 - 80.0 mm: Warm vibrant orange
    '#ea580c',  # 80.0 - 100 mm: Deep sunset orange
    '#ef4444',  # 100 - 125 mm: Warning red
    '#dc2626',  # 125 - 150 mm: Intense crimson
    '#b91c1c',  # 150 - 175 mm: Deep dark red
    '#db2777',  # 175 - 200 mm: Vivid rose magenta
    '#c026d3',  # 200 - 250 mm: Purple magenta
    '#9333ea',  # 250 - 300 mm: Electric purple
    '#6b21a8',  # 300 - 400 mm: Dark amethyst
]
RAINFALL_DAILY_CMAP = ListedColormap(RAINFALL_DAILY_COLORS, name="ph_rainfall_daily")
RAINFALL_DAILY_CMAP.set_over('#2e1065')  # > 400 mm: Midnight violet
RAINFALL_DAILY_NORM = BoundaryNorm(RAINFALL_DAILY_LEVELS, ncolors=len(RAINFALL_DAILY_COLORS), clip=False)


# ── 10m Wind Speed Colormap (kph) ──────────────────────────────────────────
WIND_SPEED_LEVELS = [0, 5, 10, 20, 30, 40, 50, 60, 75, 90, 105, 120, 140, 165, 185, 220]
WIND_SPEED_COLORS = [
    '#ffffff00',  # 0 - 5 kph: Transparent (Calm)
    '#f0f9ff',    # 5 - 10 kph: Light air
    '#bae6fd',    # 10 - 20 kph: Light breeze
    '#60a5fa',    # 20 - 30 kph: Gentle/Moderate breeze
    '#2563eb',    # 30 - 40 kph: Fresh breeze
    '#10b981',    # 40 - 50 kph: Strong breeze
    '#84cc16',    # 50 - 60 kph: Near gale / TD
    '#eab308',    # 60 - 75 kph: Gale force / TS
    '#f97316',    # 75 - 90 kph: Severe TS
    '#ea580c',    # 90 - 105 kph: Storm force
    '#ef4444',    # 105 - 120 kph: Violent storm / Near TY
    '#dc2626',    # 120 - 140 kph: Typhoon Cat 1
    '#991b1b',    # 140 - 165 kph: Typhoon Cat 2-3
    '#c026d3',    # 165 - 185 kph: Typhoon Cat 4
    '#7c3aed',    # 185 - 220 kph: Super Typhoon / Cat 5
]
WIND_SPEED_CMAP = ListedColormap(WIND_SPEED_COLORS, name="ph_wind_kph")
WIND_SPEED_CMAP.set_over('#3b0764')  # > 220 kph: Extreme Super Typhoon
WIND_SPEED_NORM = BoundaryNorm(WIND_SPEED_LEVELS, ncolors=len(WIND_SPEED_COLORS), clip=False)


# ════════════════════════════════════════════════════════════════════════════
# 2. Cartographic Utilities & Province Boundaries
# ════════════════════════════════════════════════════════════════════════════

def load_ph_provinces(data_dir=None):
    """Robustly load Philippine province geometries from JSON."""
    search_paths = [
        os.path.join(os.getcwd(), "public", "data", "ph_provinces.json"),
        os.path.join(os.getcwd(), "ph_provinces.json"),
    ]
    if data_dir:
        search_paths.insert(0, os.path.join(data_dir, "ph_provinces.json"))

    for p in search_paths:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    geojson_content = json.load(f)
                return [shape(feat["geometry"]) for feat in geojson_content.get("features", [])]
            except Exception as e:
                print(f"Warning: Failed reading {p}: {e}")
    return []


def setup_map_ax(ax, extent=None, provinces=None, draw_gridlines=True):
    """Configure modern cartographic styling on a Cartopy GeoAxes."""
    if extent is None:
        extent = DEFAULT_EXTENT

    ax.set_extent([extent[0], extent[1], extent[2], extent[3]], crs=ccrs.PlateCarree())

    # Premium base map features
    ax.add_feature(cfeature.LAND, facecolor="#edf2f7", edgecolor="none", zorder=0)
    ax.add_feature(cfeature.OCEAN, facecolor="#d9e8f5", edgecolor="none", zorder=0)
    ax.add_feature(cfeature.COASTLINE, linewidth=0.9, edgecolor="#1e293b", zorder=5)
    ax.add_feature(cfeature.BORDERS, linestyle="-", linewidth=0.55, edgecolor="#64748b", zorder=5)

    # Philippine provinces overlay
    if provinces:
        ax.add_geometries(
            provinces,
            crs=ccrs.PlateCarree(),
            facecolor="none",
            edgecolor="#64748b",
            linewidth=0.45,
            alpha=0.65,
            zorder=3
        )

    # Gridlines
    if draw_gridlines:
        gl = ax.gridlines(
            draw_labels=True,
            linewidth=0.5,
            color="#94a3b8",
            alpha=0.4,
            linestyle=":",
            zorder=6
        )
        gl.top_labels = False
        gl.right_labels = False
        gl.xlabel_style = {"size": 9, "color": "#475569", "weight": "normal"}
        gl.ylabel_style = {"size": 9, "color": "#475569", "weight": "normal"}


def draw_par_boundary(ax, color="#dc2626", linewidth=2.2, linestyle="-", zorder=7):
    """Draw the Philippine Area of Responsibility (PAR) boundary."""
    ax.plot(
        PAR_LONS, PAR_LATS,
        transform=ccrs.PlateCarree(),
        color=color,
        linestyle=linestyle,
        linewidth=linewidth,
        zorder=zorder
    )


# ════════════════════════════════════════════════════════════════════════════
# 3. Meteorological Layer Renderers
# ════════════════════════════════════════════════════════════════════════════

def add_mslp_contours(ax, X, Y, msl_data, levels=None, sigma=1.0, zorder=3):
    """Render smoothed MSLP isobars with clear white-halo contour labels."""
    if msl_data is None:
        return None

    if levels is None:
        levels = list(range(900, 1050, 4))

    msl_smooth = scipy.ndimage.gaussian_filter(msl_data, sigma=sigma)
    cs = ax.contour(
        X, Y, msl_smooth,
        levels=levels,
        colors="#0f172a",
        linewidths=1.1,
        transform=ccrs.PlateCarree(),
        zorder=zorder
    )

    clabels = ax.clabel(
        cs,
        inline=True,
        fontsize=8.5,
        fmt="%d",
        colors="#0f172a",
        inline_spacing=7
    )
    for lbl in clabels:
        lbl.set_path_effects(STROKE_WHITE_HALO)
        lbl.set_weight("bold")

    return cs


def add_thickness_contours(ax, X, Y, thickness_data, levels=None, sigma=1.5, zorder=3):
    """Render 1000-500 mb thickness contours with highlighted 540 dam line and white-halo labels."""
    if thickness_data is None:
        return None

    if levels is None:
        levels = list(range(492, 600, 6))

    thick_smooth = scipy.ndimage.gaussian_filter(thickness_data, sigma=sigma)

    # Standard thickness contours (dashed blue)
    ct = ax.contour(
        X, Y, thick_smooth,
        levels=levels,
        colors="#2563eb",
        linewidths=0.85,
        linestyles="dashed",
        transform=ccrs.PlateCarree(),
        zorder=zorder
    )
    cl_blue = ax.clabel(
        ct,
        inline=True,
        fontsize=8,
        fmt="%d",
        colors="#2563eb",
        inline_spacing=6
    )
    for lbl in cl_blue:
        lbl.set_path_effects(STROKE_WHITE_HALO)

    # Highlight 540 dam line (rain/snow / cold air threshold)
    ct540 = ax.contour(
        X, Y, thick_smooth,
        levels=[540],
        colors="#dc2626",
        linewidths=2.2,
        linestyles="solid",
        transform=ccrs.PlateCarree(),
        zorder=zorder + 1
    )
    cl_540 = ax.clabel(
        ct540,
        inline=True,
        fontsize=9,
        fmt="%d",
        colors="#dc2626",
        inline_spacing=8
    )
    for lbl in cl_540:
        lbl.set_path_effects(STROKE_WHITE_HALO)
        lbl.set_weight("bold")

    return ct


def add_wind_vectors(ax, X, Y, u_ms, v_ms, skip=None, scale=400, alpha=0.35, zorder=4):
    """Render subsampled wind vectors / quiver arrows with high contrast."""
    if skip is None:
        skip = max(1, int(X.shape[0] / 32))

    ax.quiver(
        X[::skip, ::skip], Y[::skip, ::skip],
        u_ms[::skip, ::skip], v_ms[::skip, ::skip],
        transform=ccrs.PlateCarree(),
        color="#0f172a",
        alpha=alpha,
        width=0.0016,
        scale=scale,
        headwidth=3.5,
        headlength=4.0,
        headaxislength=3.0,
        zorder=zorder
    )


# ════════════════════════════════════════════════════════════════════════════
# 4. Colorbar & Header Banner Renderers
# ════════════════════════════════════════════════════════════════════════════

def add_styled_colorbar(fig, cf, ax, label="Precipitation (mm)", ticks=None, fontsize=9.5):
    """Attach a sleek, standardized vertical colorbar with crisp ticks."""
    cb = fig.colorbar(
        cf,
        ax=ax,
        orientation="vertical",
        pad=0.02,
        shrink=0.86,
        aspect=26
    )
    if ticks is not None:
        cb.set_ticks(ticks)
    cb.ax.tick_params(labelsize=fontsize, length=3.5, color="#475569")
    cb.set_label(label, fontsize=fontsize + 0.5, weight="bold", color="#1e293b", labelpad=8)
    cb.outline.set_edgecolor("#334155")
    cb.outline.set_linewidth(0.8)
    return cb


def draw_header_banner(fig, ax, left_title, right_title, model_sub, time_sub):
    """Render a polished, high-contrast, accessible typography banner."""
    fig.canvas.draw()
    pos = ax.get_position()
    left, right = pos.x0, pos.x1
    y_top = pos.y1 + 0.046
    y_bottom = pos.y1 + 0.016
    y_line = pos.y1 + 0.006

    # Top line: Agency / App identity & Product title
    fig.text(
        left, y_top, left_title,
        ha="left", va="bottom",
        fontsize=13, weight="bold", color="#475569"
    )
    fig.text(
        right, y_top, right_title,
        ha="right", va="bottom",
        fontsize=12, weight="bold", color="#0f172a"
    )

    # Bottom line: Model info & Timestamp info
    fig.text(
        left, y_bottom, model_sub,
        ha="left", va="bottom",
        fontsize=10.5, color="#1e293b"
    )
    fig.text(
        right, y_bottom, time_sub,
        ha="right", va="bottom",
        fontsize=10.5, color="#1e293b"
    )

    # Sleek separator line
    sep = mlines.Line2D(
        (left, right), (y_line, y_line),
        color="#334155", linewidth=1.1,
        transform=fig.transFigure
    )
    fig.add_artist(sep)


# ════════════════════════════════════════════════════════════════════════════
# 5. WeatherNext Utilities
# ════════════════════════════════════════════════════════════════════════════

def find_latest_weathernext_run(client=None, fs=None, project_id="affable-ring-442402-j2", min_hours=360, var_check="mean_sea_level_pressure_mean"):
    """
    Finds the latest available and fully completed Google WeatherNext 3 forecast run in GCS.
    Prioritizes 6-hourly synoptic runs (00, 06, 12, 18 UTC) which contain 360-hour (15-day) forecasts.
    Verifies that the Zarr dataset shape meets min_hours and that the final chunk exists.
    """
    if client is None:
        from google.cloud import storage
        client = storage.Client(project=project_id)
    if fs is None:
        import gcsfs
        fs = gcsfs.GCSFileSystem(project=project_id)

    now = datetime.now(timezone.utc)
    prefixes = [
        'weathernext_3_0_0_statistics/zarr/2026_to_present/' + now.strftime('%Y%m'),
    ]
    if now.day <= 2:
        prev_month = (now.replace(day=1) - timedelta(days=1)).strftime('%Y%m')
        prefixes.append(f'weathernext_3_0_0_statistics/zarr/2026_to_present/{prev_month}')

    runs = []
    for prefix in prefixes:
        try:
            blobs = client.list_blobs('weathernext3_statistics_spatial', prefix=prefix, delimiter='/')
            for page in blobs.pages:
                runs.extend(list(page.prefixes))
        except Exception as e:
            print(f"Notice listing prefix {prefix}: {e}")

    if not runs:
        try:
            blobs = client.list_blobs('weathernext3_statistics_spatial', prefix='weathernext_3_0_0_statistics/zarr/2026_to_present/', delimiter='/')
            for page in blobs.pages:
                runs.extend(list(page.prefixes))
        except Exception as e:
            print(f"Notice broad listing: {e}")

    if not runs:
        raise RuntimeError("No WeatherNext 3 forecast run folders found in 2026_to_present!")

    runs = sorted(list(set(runs)), reverse=True)

    # 1. Synoptic runs check (00, 06, 12, 18) for long-range / 360h requests
    if min_hours > 48:
        synoptic_runs = [r for r in runs if any(f'_{h:02d}hr_' in r for h in (0, 6, 12, 18))]
        for r in synoptic_runs:
            base = f"weathernext3_statistics_spatial/{r}predictions.zarr"
            zarr_json_path = f"{base}/{var_check}/zarr.json"
            try:
                content = fs.cat_file(zarr_json_path)
                data = json.loads(content)
                shape = data.get('shape', [0])
                if shape[0] >= min_hours:
                    last_chunk = f"{base}/{var_check}/c/{shape[0] - 1}/0/0"
                    if fs.exists(last_chunk):
                        return r, shape[0]
            except Exception:
                continue

    # 2. General check for any complete run matching min_hours
    for r in runs:
        base = f"weathernext3_statistics_spatial/{r}predictions.zarr"
        zarr_json_path = f"{base}/{var_check}/zarr.json"
        try:
            content = fs.cat_file(zarr_json_path)
            data = json.loads(content)
            shape = data.get('shape', [0])
            if shape[0] >= min_hours:
                last_chunk = f"{base}/{var_check}/c/{shape[0] - 1}/0/0"
                if fs.exists(last_chunk):
                    return r, shape[0]
        except Exception:
            continue

    # 3. Fallback: newest run available with its reported hours
    for r in runs:
        base = f"weathernext3_statistics_spatial/{r}predictions.zarr"
        zarr_json_path = f"{base}/{var_check}/zarr.json"
        try:
            content = fs.cat_file(zarr_json_path)
            data = json.loads(content)
            shape = data.get('shape', [0])
            return r, shape[0]
        except Exception:
            continue

    return runs[0], 48


def regrid_01_to_025(src_lats, src_lons, data_2d, dst_lats=None, dst_lons=None):
    """
    Interpolates native 0.1 deg WeatherNext 3 data to standardized 0.25 deg grid (matching GFS/ECMWF standards).
    """
    if dst_lats is None:
        dst_lats = np.arange(2.0, 28.01, 0.25)
    if dst_lons is None:
        dst_lons = np.arange(112.0, 140.01, 0.25)

    lat_asc = bool(np.all(np.diff(src_lats) > 0))
    lon_asc = bool(np.all(np.diff(src_lons) > 0))

    cur_lats = src_lats if lat_asc else src_lats[::-1]
    cur_data = data_2d if lat_asc else data_2d[::-1, :]
    cur_lons = src_lons if lon_asc else src_lons[::-1]
    cur_data = cur_data if lon_asc else cur_data[:, ::-1]

    rgi = RegularGridInterpolator((cur_lats, cur_lons), cur_data, method='linear', bounds_error=False, fill_value=None)
    XX, YY = np.meshgrid(dst_lons, dst_lats)
    pts = np.stack([YY.ravel(), XX.ravel()], axis=-1)
    regridded = rgi(pts).reshape(YY.shape)
    return dst_lons, dst_lats, regridded


def batch_cat_gcs(fs, paths, batch_size=20, desc="chunks"):
    """
    Downloads GCS chunk paths in controlled batches to prevent WinError 10054
    (socket connection resets) and provides clean real-time download progress.
    """
    results = {}
    total = len(paths)
    step = batch_size * 2
    for i in range(0, total, step):
        sub = paths[i:i + step]
        try:
            part = fs.cat(sub, on_error='omit', batch_size=batch_size)
            results.update(part)
        except Exception as e:
            print(f"  Notice during {desc} batch ({i}/{total}): {e}", flush=True)
        print(f"  -> Loaded {min(i + len(sub), total)}/{total} {desc}...", flush=True)
    return results

