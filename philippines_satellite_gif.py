import os
import sys
import math
import json
import io
import re
import argparse
import datetime
import requests
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import cartopy.io.img_tiles as cimgt
from PIL import Image, ImageDraw, ImageFont
import shapely
from shapely.geometry import shape
from shapely.validation import make_valid
from shapely.ops import unary_union, linemerge

# ── Philippine Province Geometries Cache ─────────────────────────────────────
_PROVINCE_GEOMS_CACHE = None

def load_philippine_province_geometries():
    """
    Loads high-resolution Philippine province boundaries from public/data/ph_provinces.json
    cached in memory for instantaneous rendering across frames.
    Deduplicates shared borders between neighboring provinces for clean, single lines.
    """
    global _PROVINCE_GEOMS_CACHE
    if _PROVINCE_GEOMS_CACHE is not None:
        return _PROVINCE_GEOMS_CACHE

    geojson_paths = [
        os.path.join(os.getcwd(), "public", "data", "ph_provinces.json"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "data", "ph_provinces.json"),
        "public/data/ph_provinces.json"
    ]
    found_path = next((p for p in geojson_paths if os.path.exists(p)), None)
    if found_path:
        try:
            with open(found_path, "r", encoding="utf-8") as f:
                geo_data = json.load(f)

            raw_boundaries = []
            for feat in geo_data.get("features", []):
                geom = shape(feat["geometry"])
                if not geom.is_valid:
                    geom = make_valid(geom)
                if hasattr(geom, 'boundary'):
                    raw_boundaries.append(geom.boundary)

            # Deduplicate shared borders between neighboring provinces
            merged = linemerge(unary_union(raw_boundaries))
            if hasattr(merged, 'geoms'):
                _PROVINCE_GEOMS_CACHE = list(merged.geoms)
            else:
                _PROVINCE_GEOMS_CACHE = [merged]
            return _PROVINCE_GEOMS_CACHE
        except Exception as e:
            print(f"Notice: Failed to load province boundaries: {e}")
    _PROVINCE_GEOMS_CACHE = []
    return _PROVINCE_GEOMS_CACHE

# ── Shared Requests Session with Connection Pooling ─────────────────────────
_HTTP_SESSION = requests.Session()
_ADAPTER = requests.adapters.HTTPAdapter(pool_connections=30, pool_maxsize=30, max_retries=2)
_HTTP_SESSION.mount('https://', _ADAPTER)
_HTTP_SESSION.mount('http://', _ADAPTER)

# ── Dynamically Find Latest Available Satellite Timestamp ────────────────────
def get_latest_available_satellite_time():
    now = datetime.datetime.now(datetime.timezone.utc)
    for offset_mins in [15, 20, 25, 30, 40, 50, 60]:
        t = now - datetime.timedelta(minutes=offset_mins)
        mins = (t.minute // 10) * 10
        t_aligned = t.replace(minute=mins, second=0, microsecond=0)
        d_str = t_aligned.strftime('%Y-%m-%d')
        tm_str = f'{t_aligned.hour:02d}{t_aligned.minute:02d}'
        url = f'https://tiles.zoom.earth/geocolor/himawari/{d_str}/{tm_str}/6/28/53.jpg'
        try:
            r = _HTTP_SESSION.get(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': 'https://zoom.earth/',
                'Origin': 'https://zoom.earth'
            }, timeout=3)
            if r.status_code == 200 and len(r.content) > 1000:
                return t_aligned
        except Exception:
            pass
    t = now - datetime.timedelta(minutes=40)
    mins = (t.minute // 10) * 10
    return t.replace(minute=mins, second=0, microsecond=0)

# ── Custom Tile Provider for Zoom Earth Satellite Map Tiles ─────────────────
class ZoomEarthTiles(cimgt.GoogleTiles):
    def __init__(self, date_str=None, time_str=None, session=None, **kwargs):
        super().__init__(**kwargs)
        if not date_str or not time_str:
            latest_dt = get_latest_available_satellite_time()
            date_str = latest_dt.strftime('%Y-%m-%d')
            time_str = f'{latest_dt.hour:02d}{latest_dt.minute:02d}'

        self.date_str = date_str
        self.time_str = time_str
        self.session = session or _HTTP_SESSION
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://zoom.earth/',
            'Origin': 'https://zoom.earth'
        }

    def _image_url(self, tile):
        x, y, z = tile
        return f"https://tiles.zoom.earth/geocolor/himawari/{self.date_str}/{self.time_str}/{z}/{y}/{x}.jpg"

    def get_image(self, tile):
        x, y, z = tile
        primary_url = self._image_url(tile)
        try:
            r = self.session.get(primary_url, headers=self.headers, timeout=5)
            if r.status_code == 200 and len(r.content) > 1000:
                img = Image.open(io.BytesIO(r.content)).convert('RGB')
                return img, self.tileextent(tile), 'lower'
        except Exception:
            pass

        seamless_ocean = Image.new('RGB', (256, 256), (11, 15, 20))
        return seamless_ocean, self.tileextent(tile), 'lower'

# ── Fox Weather Broadcast Header Drawing Function (National / Regional Satellite) ───
def draw_fox_weather_header(img, dt_utc, custom_title=None, sector_title=None):
    """
    Draws a TV broadcast-style top header matching the Fox Weather layout for general satellite:
    - Top navy container with 2-tier layout and rounded corners
    - Top Tier: 'VISIBLE SATELLITE' (or 'INFRARED SATELLITE') + 'PHILIPPINE TYPHOON WEATHER' badge
    - Bottom Tier: 'WED 9:50AM PHT' + Domain coverage (or Sector Name) + 'CLEAR [ === ] CLOUDS' scale
    """
    pht_tz = datetime.timezone(datetime.timedelta(hours=8))
    dt_pht = dt_utc.astimezone(pht_tz)

    w, h = img.size
    draw = ImageDraw.Draw(img)

    hour_pht = dt_pht.hour + dt_pht.minute / 60.0
    is_daytime = (5.75 <= hour_pht < 18.25)

    if custom_title:
        title_text = custom_title.upper()
    else:
        title_text = "VISIBLE SATELLITE" if is_daytime else "INFRARED SATELLITE"

    scale = w / 1200.0
    pad_x = int(20 * scale)
    pad_y = int(16 * scale)
    bw = w - (pad_x * 2)
    bh = int(74 * scale)
    bx1, by1 = pad_x, pad_y
    bx2, by2 = pad_x + bw, pad_y + bh
    radius = max(4, int(6 * scale))

    # Main container
    draw.rounded_rectangle([bx1, by1, bx2, by2], radius=radius, fill=(7, 24, 56), outline=(255, 255, 255), width=max(1, int(2 * scale)))
    mid_y = by1 + int(43 * scale)
    draw.line([(bx1 + 1, mid_y), (bx2 - 1, mid_y)], fill=(70, 105, 155), width=max(1, int(1 * scale)))

    f_title_sz = max(14, int(24 * scale))
    f_badge_sz = max(9, int(13 * scale))
    f_sub_sz = max(9, int(13 * scale))

    try:
        font_title = ImageFont.truetype("arialbd.ttf", f_title_sz)
        font_badge_main = ImageFont.truetype("arialbd.ttf", f_badge_sz)
        font_badge_sub = ImageFont.truetype("arialbd.ttf", f_badge_sz)
        font_sub = ImageFont.truetype("arialbd.ttf", f_sub_sz)
    except Exception:
        font_title = ImageFont.load_default()
        font_badge_main = font_title
        font_badge_sub = font_title
        font_sub = font_title

    # 1. Top tier left: Satellite Mode
    draw.text((bx1 + int(16 * scale), by1 + int(8 * scale)), title_text, fill=(255, 255, 255), font=font_title)

    # 2. Top tier right: Philippine Typhoon Weather badge
    badge_h = int(28 * scale)
    badge_y1 = by1 + int(7 * scale)
    badge_y2 = badge_y1 + badge_h
    badge_w = int(278 * scale)
    badge_x2 = bx2 - int(12 * scale)
    badge_x1 = badge_x2 - badge_w

    draw.rounded_rectangle([badge_x1, badge_y1, badge_x2, badge_y2], radius=max(3, int(5 * scale)), fill=(255, 255, 255), outline=(255, 255, 255), width=1)
    red_w = int(82 * scale)
    red_x1 = badge_x2 - red_w
    draw.rounded_rectangle([red_x1, badge_y1 + int(2 * scale), badge_x2 - int(2 * scale), badge_y2 - int(2 * scale)], radius=max(2, int(4 * scale)), fill=(220, 38, 38))
    draw.text((badge_x1 + int(10 * scale), badge_y1 + int(6 * scale)), "PHILIPPINE TYPHOON", fill=(10, 25, 56), font=font_badge_main)
    draw.text((red_x1 + int(8 * scale), badge_y1 + int(6 * scale)), "WEATHER", fill=(255, 255, 255), font=font_badge_sub)

    # 3. Bottom tier left: Time in PHT
    hr_str = dt_pht.strftime('%I').lstrip('0')
    min_am_pm = dt_pht.strftime('%M%p')
    day_str = dt_pht.strftime('%a').upper()
    time_display = f"{day_str} {hr_str}:{min_am_pm} PHT"

    time_x = bx1 + int(16 * scale)
    time_y = mid_y + int(6 * scale)
    draw.text((time_x, time_y), time_display, fill=(255, 255, 255), font=font_sub)
    bbox = draw.textbbox((time_x, time_y), time_display, font=font_sub)
    time_w = bbox[2] - bbox[0]

    # Separator
    sep_x = time_x + time_w + int(14 * scale)
    draw.line([(sep_x, mid_y + 1), (sep_x, by2 - 1)], fill=(70, 105, 155), width=max(1, int(1 * scale)))

    # 4. Bottom tier right: Fox Weather CLEAR [ gradient bar ] CLOUDS scale
    legend_right = bx2 - int(16 * scale)
    clouds_text = "CLOUDS"
    c_bbox = draw.textbbox((0, 0), clouds_text, font=font_sub)
    c_w = c_bbox[2] - c_bbox[0]
    draw.text((legend_right - c_w, time_y), clouds_text, fill=(255, 255, 255), font=font_sub)

    bar_w = int(110 * scale)
    bar_h = max(4, int(7 * scale))
    bar_right = legend_right - c_w - int(10 * scale)
    bar_left = bar_right - bar_w
    bar_top = time_y + int(5 * scale)

    for step in range(bar_w):
        ratio = step / float(bar_w)
        c_val = int(25 + ratio * 230)
        draw.line([(bar_left + step, bar_top), (bar_left + step, bar_top + bar_h)], fill=(c_val, c_val, c_val))

    draw.rectangle([bar_left, bar_top, bar_right, bar_top + bar_h], outline=(100, 130, 175), width=1)

    clear_text = "CLEAR"
    cl_bbox = draw.textbbox((0, 0), clear_text, font=font_sub)
    cl_w = cl_bbox[2] - cl_bbox[0]
    draw.text((bar_left - cl_w - int(10 * scale), time_y), clear_text, fill=(255, 255, 255), font=font_sub)

    # 5. Bottom tier middle: Domain coverage label
    domain_text = sector_title.upper() if sector_title else "PHILIPPINES & PAR REGION"
    draw.text((sep_x + int(14 * scale), time_y), domain_text, fill=(200, 220, 255), font=font_sub)

    return img

# ── Aspect Ratio Extent Fitting Helper ───────────────────────────────────────
def fit_extent_to_aspect(extent, aspect_ratio=10.0 / 7.5):
    """
    Ensures [min_lon, max_lon, min_lat, max_lat] strictly matches the canvas
    aspect ratio (lon_span / lat_span == aspect_ratio) so Cartopy renders 100%
    edge-to-edge full-bleed with zero black borders/bars on any side.
    """
    min_lon, max_lon, min_lat, max_lat = extent
    c_lon = (min_lon + max_lon) / 2.0
    c_lat = (min_lat + max_lat) / 2.0
    lon_span = max_lon - min_lon
    lat_span = max_lat - min_lat

    current_aspect = lon_span / lat_span
    if current_aspect < aspect_ratio:
        target_lon_span = lat_span * aspect_ratio
        min_lon = c_lon - target_lon_span / 2.0
        max_lon = c_lon + target_lon_span / 2.0
    elif current_aspect > aspect_ratio:
        target_lat_span = lon_span / aspect_ratio
        min_lat = c_lat - target_lat_span / 2.0
        max_lat = c_lat + target_lat_span / 2.0

    return [min_lon, max_lon, min_lat, max_lat]

# ── Regional Sectors & Target Domains (Identical to PTCC) ─────────────────────
SECTORS = {
    'northern_luzon': {
        'id': 'northern_luzon',
        'key': 'northern_luzon',
        'extent': fit_extent_to_aspect([117.5, 125.5, 15.5, 21.5], 10.0 / 7.5),
        'title': 'NORTHERN & EXTREME NORTHERN LUZON',
        'label': 'Northern & Extreme Northern Luzon Sector',
        'filename_stem': 'philippines_northern_luzon',
        'zoom_level': 7,
        'grid_step': 1.0,
    },
    'southern_luzon': {
        'id': 'southern_luzon',
        'key': 'southern_luzon',
        'extent': fit_extent_to_aspect([119.5, 124.5, 12.5, 16.25], 10.0 / 7.5),
        'title': 'SOUTHERN LUZON (CALABARZON • NCR • MIMAROPA)',
        'label': 'Southern Luzon Sector (CALABARZON / Laguna / Metro Manila / Mindoro)',
        'filename_stem': 'philippines_southern_luzon',
        'zoom_level': 7,
        'grid_step': 1.0,
    },
    'visayas': {
        'id': 'visayas',
        'key': 'visayas',
        'extent': fit_extent_to_aspect([120.75, 126.75, 9.0, 13.5], 10.0 / 7.5),
        'title': 'VISAYAS',
        'label': 'All Visayas Sector (Western, Central & Eastern Visayas)',
        'filename_stem': 'philippines_visayas',
        'zoom_level': 7,
        'grid_step': 1.0,
    },
    'mindanao': {
        'id': 'mindanao',
        'key': 'mindanao',
        'extent': fit_extent_to_aspect([119.0, 127.0, 4.75, 10.75], 10.0 / 7.5),
        'title': 'MINDANAO',
        'label': 'Mindanao Sector (Davao, Caraga, Zamboanga, BARMM)',
        'filename_stem': 'philippines_mindanao',
        'zoom_level': 7,
        'grid_step': 1.0,
    },
    'luzon': {
        'id': 'luzon',
        'key': 'luzon',
        'extent': fit_extent_to_aspect([116.0, 126.0, 13.0, 20.5], 10.0 / 7.5),
        'title': 'LUZON ARCHIPELAGO REGIONAL FOCUS',
        'label': 'General Luzon Sector',
        'filename_stem': 'philippines_luzon',
        'zoom_level': 6,
        'grid_step': 2.0,
    },
    'philippines': {
        'id': 'philippines',
        'key': 'philippines',
        'extent': fit_extent_to_aspect([113.0, 137.0, 4.0, 22.0], 10.0 / 7.5),
        'title': 'PHILIPPINES & PAR REGION',
        'label': 'Philippine Archipelago & PAR Overview',
        'filename_stem': 'philippines_satellite',
        'zoom_level': 6,
        'grid_step': 5.0,
    }
}

def resolve_sector(sector_name):
    if not sector_name:
        return None
    s = str(sector_name).lower().replace('-', '_').strip()
    if s in SECTORS:
        return SECTORS[s]
    alias_map = {
        'north_luzon': 'northern_luzon',
        'extreme_north_luzon': 'northern_luzon',
        'extreme_northern_luzon': 'northern_luzon',
        'nluzon': 'northern_luzon',
        'south_luzon': 'southern_luzon',
        'sluzon': 'southern_luzon',
        'calabarzon': 'southern_luzon',
        'central_luzon': 'southern_luzon',
        'laguna': 'southern_luzon',
        'all_visayas': 'visayas',
        'vis': 'visayas',
        'all_mindanao': 'mindanao',
        'min': 'mindanao',
        'par': 'philippines',
        'all_philippines': 'philippines',
        'all_luzon': 'luzon',
    }
    canonical = alias_map.get(s)
    if canonical and canonical in SECTORS:
        return SECTORS[canonical]
    return None

def get_sector_extent(sector_key):
    info = resolve_sector(sector_key)
    if info:
        return info['extent']
    return SECTORS['southern_luzon']['extent']

def get_philippines_extent():
    """
    Returns extent tightly framing the Philippine archipelago and PAR boundary:
    [min_lon, max_lon, min_lat, max_lat] -> [113.0, 137.0, 4.0, 22.0] (4:3 aspect ratio)
    """
    return SECTORS['philippines']['extent']

# ── Render a Single Frame (Regional or National) ─────────────────────────────
def render_philippines_frame(
    dt_utc,
    extent=None,
    sector_info=None,
    sector_key=None,
    figsize=(10.0, 7.5),
    dpi=120,
    zoom_level=None,
    custom_title=None
):
    """
    Renders a full-bleed satellite frame overlaid with:
    - Live Himawari satellite clouds (Zoom Earth)
    - Detailed Philippine Province Boundaries from ph_provinces.json
    - High-visibility yellow coastlines
    - Orange PAR line (omitted on regional sector zooms to avoid stray divider)
    - Fox Weather broadcast header with CLEAR/CLOUDS scale and sector title
    """
    if sector_key and not sector_info:
        sector_info = resolve_sector(sector_key)

    if sector_info is None and extent is None:
        sector_info = SECTORS['philippines']

    if extent is None:
        extent = sector_info['extent'] if sector_info else get_philippines_extent()

    extent = fit_extent_to_aspect(extent, aspect_ratio=figsize[0] / figsize[1])

    if zoom_level is None:
        zoom_level = sector_info.get('zoom_level', 6) if sector_info else 6

    date_str = dt_utc.strftime('%Y-%m-%d')
    time_str = f"{dt_utc.hour:02d}{(dt_utc.minute // 10) * 10:02d}"

    tiler = ZoomEarthTiles(date_str=date_str, time_str=time_str)

    fig = plt.figure(figsize=figsize, dpi=dpi, facecolor='black')

    # Edge-to-edge full bleed map canvas
    ax_map = fig.add_axes([0.0, 0.0, 1.0, 1.0], projection=ccrs.PlateCarree())
    ax_map.set_extent(extent, crs=ccrs.PlateCarree())

    # 1. Overlay Zoom Earth satellite tiles
    try:
        ax_map.add_image(tiler, zoom_level, alpha=0.95)
    except Exception:
        ax_map.set_facecolor('#0b192c')

    # 2. Add Coastlines and Country Borders (Yellow)
    ax_map.add_feature(cfeature.COASTLINE, linewidth=1.1, edgecolor='#FFE600', alpha=0.95)
    ax_map.add_feature(cfeature.BORDERS, linewidth=0.8, edgecolor='#FFE600', linestyle='--', alpha=0.90)

    # 3. Add Detailed Philippine Province Boundaries (from ph_provinces.json)
    prov_geoms = load_philippine_province_geometries()
    if prov_geoms:
        ax_map.add_geometries(
            prov_geoms,
            crs=ccrs.PlateCarree(),
            facecolor='none',
            edgecolor='#FFE600',
            linewidth=0.7,
            linestyle='--',
            alpha=0.85
        )

    # 4. Philippine Area of Responsibility (PAR) Boundary
    # Omitted for regional target sectors so it does not unnaturally cut across close views
    is_regional = sector_info and sector_info.get('key') in ['northern_luzon', 'southern_luzon', 'visayas', 'mindanao', 'luzon']
    if not is_regional:
        par_lons = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
        par_lats = [ 5.0,  15.0,  21.0,  25.0,  25.0,   5.0,   5.0]
        ax_map.plot(
            par_lons, par_lats, color='#FF6B35', linewidth=2.0, linestyle='-',
            alpha=0.95, transform=ccrs.PlateCarree(), label='PAR Boundary'
        )

    # 5. Lat/Lon Coordinate Gridlines (Subtle)
    grid_step = sector_info.get('grid_step', 2.0) if sector_info else 5.0
    gl = ax_map.gridlines(draw_labels=False, linewidth=0.5, color='white', alpha=0.25, linestyle='--')
    gl.xlocator = mticker.MultipleLocator(grid_step)
    gl.ylocator = mticker.MultipleLocator(grid_step)

    # Convert plot directly to PIL Image
    fig.canvas.draw()
    rgba_buffer = fig.canvas.buffer_rgba()
    img = Image.frombuffer('RGBA', fig.canvas.get_width_height(), rgba_buffer, 'raw', 'RGBA', 0, 1).convert('RGB')
    plt.close(fig)

    # 6. Composite Fox Weather broadcast header
    sector_title = sector_info.get('title') if sector_info else None
    img = draw_fox_weather_header(img, dt_utc=dt_utc, custom_title=custom_title, sector_title=sector_title)

    return img

# ── Generate Animated Satellite GIF Loop ─────────────────────────────────────
def generate_philippines_gif(
    output_path=None,
    sector_key=None,
    timeframe_hours=6.0,
    interval_mins=20,
    fps=8,
    dpi=120,
    zoom_level=None,
    last_frame_pause_sec=1.5
):
    sector_info = resolve_sector(sector_key) if sector_key else SECTORS['philippines']
    if not sector_info:
        sector_info = SECTORS['philippines']

    if output_path is None:
        if sector_info['key'] == 'philippines':
            output_path = "philippines_satellite_loop.gif"
        else:
            output_path = f"{sector_info['filename_stem']}_loop.gif"

    print("=" * 70)
    print(f"Generating Satellite Loop GIF: {sector_info['title']}")
    print(f"Timeframe: Past {timeframe_hours:.1f} hours | Interval: {interval_mins} mins | FPS: {fps}")
    print("=" * 70)

    extent = sector_info['extent']
    actual_zoom = zoom_level if zoom_level is not None else sector_info.get('zoom_level', 6)

    now_utc = get_latest_available_satellite_time()
    end_utc = now_utc
    start_utc = end_utc - datetime.timedelta(hours=timeframe_hours)

    current_t = start_utc
    timestamps = []
    while current_t <= end_utc:
        t_mins = (current_t.minute // 10) * 10
        t_aligned = current_t.replace(minute=t_mins, second=0, microsecond=0)
        timestamps.append(t_aligned)
        current_t += datetime.timedelta(minutes=interval_mins)

    total_frames = len(timestamps)
    print(f"Rendering {total_frames} frames from {timestamps[0].strftime('%Y-%m-%d %H:%M UTC')} to {timestamps[-1].strftime('%Y-%m-%d %H:%M UTC')}...")

    frames = []
    for idx, t_utc in enumerate(timestamps):
        print(f"[{idx + 1}/{total_frames}] Rendering frame: {t_utc.strftime('%Y-%m-%d %H:%MZ')}...", end="\r", flush=True)

        frame_img = render_philippines_frame(
            dt_utc=t_utc,
            extent=extent,
            sector_info=sector_info,
            figsize=(10.0, 7.5),
            dpi=dpi,
            zoom_level=actual_zoom
        )
        frames.append(frame_img)

    print(f"\nCompleted all {len(frames)} frames. Compiling GIF...")

    if not frames:
        return None

    frame_duration = int(1000 / fps)
    durations = [frame_duration] * len(frames)
    durations[-1] = int(last_frame_pause_sec * 1000)

    quantized_frames = []
    for f in frames:
        q = f.convert('P', palette=Image.Palette.ADAPTIVE, colors=256)
        quantized_frames.append(q)

    quantized_frames[0].save(
        output_path,
        save_all=True,
        append_images=quantized_frames[1:],
        duration=durations,
        loop=0,
        optimize=True
    )

    file_size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"SUCCESS: Satellite GIF saved to: {os.path.abspath(output_path)} ({file_size_mb:.2f} MB)")
    print("=" * 70)
    return output_path

# ── Generate Static Satellite Image ──────────────────────────────────────────
def generate_philippines_image(
    output_path=None,
    sector_key=None,
    dpi=150,
    zoom_level=None
):
    sector_info = resolve_sector(sector_key) if sector_key else SECTORS['philippines']
    if not sector_info:
        sector_info = SECTORS['philippines']

    if output_path is None:
        if sector_info['key'] == 'philippines':
            output_path = "philippines_satellite.png"
        else:
            output_path = f"{sector_info['filename_stem']}.png"

    print("=" * 70)
    print(f"Generating Satellite Static Map: {sector_info['title']}")
    print("=" * 70)

    extent = sector_info['extent']
    actual_zoom = zoom_level if zoom_level is not None else sector_info.get('zoom_level', 6)
    dt_utc = get_latest_available_satellite_time()

    img = render_philippines_frame(
        dt_utc=dt_utc,
        extent=extent,
        sector_info=sector_info,
        figsize=(10.0, 7.5),
        dpi=dpi,
        zoom_level=actual_zoom
    )

    img.save(output_path, dpi=(dpi, dpi))
    print(f"SUCCESS: Satellite static map saved to: {os.path.abspath(output_path)} ({img.size[0]}x{img.size[1]})")
    print("=" * 70)
    return output_path

# ── CLI Entry Point ──────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Generate Philippines & Regional Satellite Maps & Animated GIF Loops with Province Boundaries")
    parser.add_argument("--target", "--sector", dest="target", type=str, default=None,
                        help="Target sector: northern_luzon, southern_luzon, visayas, mindanao, luzon, philippines")
    parser.add_argument("--northern-luzon", "--north-luzon", "--extreme-northern-luzon", dest="northern_luzon", action="store_true",
                        help="Target Northern & Extreme Northern Luzon Sector")
    parser.add_argument("--southern-luzon", "--south-luzon", "--calabarzon", dest="southern_luzon", action="store_true",
                        help="Target Southern & Central Luzon Sector (CALABARZON, NCR, Mindoro, Bicol)")
    parser.add_argument("--visayas", "--all-visayas", dest="visayas", action="store_true",
                        help="Target All Visayas Sector (Western, Central & Eastern Visayas)")
    parser.add_argument("--mindanao", "--all-mindanao", dest="mindanao", action="store_true",
                        help="Target Mindanao Sector (Davao, Caraga, Northern Mindanao, Zamboanga, BARMM)")
    parser.add_argument("--luzon", action="store_true", default=None, help="Force focus on general Luzon sector")
    parser.add_argument("--philippines", "--par", dest="philippines", action="store_true", help="Focus on full Philippine archipelago & PAR domain (default)")
    parser.add_argument("--all-targets", "--all-sectors", dest="all_targets", action="store_true",
                        help="Render all 4 regional target sectors: Northern Luzon, Southern Luzon, Visayas, and Mindanao")

    parser.add_argument("--png-only", action="store_true", help="Generate only static PNG image without GIF loop")
    parser.add_argument("--gif-only", action="store_true", help="Generate only animated GIF loop without PNG image")
    parser.add_argument("--gif", action="store_true", help="Generate animated satellite GIF loop")
    parser.add_argument("--both", action="store_true", help="Generate both static PNG image and animated GIF loop")
    parser.add_argument("--hours", type=float, default=6.0, help="Timeframe in hours for GIF (default: 6.0)")
    parser.add_argument("--interval", type=int, default=20, help="Frame step interval in minutes (default: 20)")
    parser.add_argument("--fps", type=int, default=8, help="Frames per second for GIF (default: 8)")
    parser.add_argument("--dpi", type=int, default=120, help="DPI resolution for GIF frames (default: 120)")
    parser.add_argument("--zoom", type=int, default=None, help="Custom satellite zoom level (default: 6 for national, 7 for regional)")
    parser.add_argument("--output", type=str, default=None, help="Custom output filepath")
    args = parser.parse_args()

    # Batch generate all regional sectors
    if args.all_targets:
        targets_list = ['northern_luzon', 'southern_luzon', 'visayas', 'mindanao']
        print(f"\n--- Batch generating all 4 regional target sectors: {targets_list} ---")
        for t_sec in targets_list:
            if args.png_only:
                generate_philippines_image(sector_key=t_sec, dpi=args.dpi, zoom_level=args.zoom)
            elif args.gif_only or args.gif:
                generate_philippines_gif(
                    sector_key=t_sec,
                    timeframe_hours=args.hours,
                    interval_mins=args.interval,
                    fps=args.fps,
                    dpi=args.dpi,
                    zoom_level=args.zoom
                )
            else:
                generate_philippines_image(sector_key=t_sec, dpi=args.dpi, zoom_level=args.zoom)
                generate_philippines_gif(
                    sector_key=t_sec,
                    timeframe_hours=args.hours,
                    interval_mins=args.interval,
                    fps=args.fps,
                    dpi=args.dpi,
                    zoom_level=args.zoom
                )
        print("\nAll regional targets generated successfully!")
        return

    # Determine sector key
    sector_key = 'philippines'
    if args.target:
        sector_key = args.target
    elif args.northern_luzon:
        sector_key = 'northern_luzon'
    elif args.southern_luzon:
        sector_key = 'southern_luzon'
    elif args.visayas:
        sector_key = 'visayas'
    elif args.mindanao:
        sector_key = 'mindanao'
    elif args.luzon:
        sector_key = 'luzon'
    elif args.philippines:
        sector_key = 'philippines'

    sec_info = resolve_sector(sector_key)
    stem = sec_info['filename_stem'] if sec_info else 'philippines_satellite'

    if args.png_only:
        out_png = args.output or f"{stem}.png"
        generate_philippines_image(output_path=out_png, sector_key=sector_key, dpi=args.dpi, zoom_level=args.zoom)
    elif args.gif_only or args.gif:
        out_gif = args.output or f"{stem}_loop.gif"
        generate_philippines_gif(
            output_path=out_gif,
            sector_key=sector_key,
            timeframe_hours=args.hours,
            interval_mins=args.interval,
            fps=args.fps,
            dpi=args.dpi,
            zoom_level=args.zoom
        )
    else:
        # Default: generate BOTH PNG and GIF!
        if args.output:
            out_png = args.output.replace(".gif", ".png")
            out_gif = args.output.replace(".png", ".gif")
        else:
            out_png = f"{stem}.png"
            out_gif = f"{stem}_loop.gif"
        generate_philippines_image(output_path=out_png, sector_key=sector_key, dpi=args.dpi, zoom_level=args.zoom)
        generate_philippines_gif(
            output_path=out_gif,
            sector_key=sector_key,
            timeframe_hours=args.hours,
            interval_mins=args.interval,
            fps=args.fps,
            dpi=args.dpi,
            zoom_level=args.zoom
        )

if __name__ == "__main__":
    main()
