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

# ── Philippine Province Geometries Cache ─────────────────────────────────────
_PROVINCE_GEOMS_CACHE = None

def load_philippine_province_geometries():
    """
    Loads high-resolution Philippine province boundaries from public/data/ph_provinces.json
    cached in memory for instantaneous rendering across frames.
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
            _PROVINCE_GEOMS_CACHE = [make_valid(shape(feat["geometry"])) for feat in geo_data.get("features", [])]
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

# ── Fox Weather Broadcast Header Drawing Function (National / PAR Satellite) ───
def draw_fox_weather_header(img, dt_utc, custom_title=None):
    """
    Draws a TV broadcast-style top header matching the Fox Weather layout for general satellite:
    - Top navy container with 2-tier layout and rounded corners
    - Top Tier: 'VISIBLE SATELLITE' (or 'INFRARED SATELLITE') + 'PHILIPPINE TYPHOON WEATHER' badge
    - Bottom Tier: 'WED 9:50AM PHT' + 'PHILIPPINES & PAR REGION' + 'CLEAR [ === ] CLOUDS' scale
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
    domain_text = "PHILIPPINES & PAR REGION"
    draw.text((sep_x + int(14 * scale), time_y), domain_text, fill=(200, 220, 255), font=font_sub)

    return img

# ── Philippines / PAR Extent ────────────────────────────────────────────────
def get_philippines_extent():
    """
    Returns extent tightly framing the Philippine archipelago and PAR boundary:
    [min_lon, max_lon, min_lat, max_lat] -> [114.0, 136.0, 4.0, 22.0] (4:3 aspect ratio)
    """
    return [114.0, 136.0, 4.0, 22.0]

# ── Render a Single Philippines-Focused Frame ───────────────────────────────
def render_philippines_frame(
    dt_utc,
    extent=None,
    figsize=(10.0, 7.5),
    dpi=120,
    zoom_level=6,
    custom_title=None
):
    """
    Renders a full-bleed satellite frame overlaid with:
    - Live Himawari satellite clouds
    - Detailed Philippine Province Boundaries from ph_provinces.json
    - High-visibility yellow coastlines
    - Orange PAR line
    - Fox Weather broadcast header with CLEAR/CLOUDS scale
    """
    if extent is None:
        extent = get_philippines_extent()

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
    par_lons = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
    par_lats = [ 5.0,  15.0,  21.0,  25.0,  25.0,   5.0,   5.0]
    ax_map.plot(
        par_lons, par_lats, color='#FF6B35', linewidth=2.0, linestyle='-',
        alpha=0.95, transform=ccrs.PlateCarree(), label='PAR Boundary'
    )

    # 5. Lat/Lon Coordinate Gridlines (Subtle)
    gl = ax_map.gridlines(draw_labels=False, linewidth=0.5, color='white', alpha=0.25, linestyle='--')
    gl.xlocator = mticker.MultipleLocator(5.0)
    gl.ylocator = mticker.MultipleLocator(5.0)

    # Convert plot directly to PIL Image
    fig.canvas.draw()
    rgba_buffer = fig.canvas.buffer_rgba()
    img = Image.frombuffer('RGBA', fig.canvas.get_width_height(), rgba_buffer, 'raw', 'RGBA', 0, 1).convert('RGB')
    plt.close(fig)

    # 6. Composite Fox Weather broadcast header
    img = draw_fox_weather_header(img, dt_utc=dt_utc, custom_title=custom_title)

    return img

# ── Generate Animated Philippines GIF Loop ──────────────────────────────────
def generate_philippines_gif(
    output_path="philippines_satellite_loop.gif",
    timeframe_hours=6.0,
    interval_mins=20,
    fps=8,
    dpi=120,
    zoom_level=6,
    last_frame_pause_sec=1.5
):
    print("=" * 70)
    print("Generating Philippines Satellite Loop GIF...")
    print(f"Timeframe: Past {timeframe_hours:.1f} hours | Interval: {interval_mins} mins | FPS: {fps}")
    print("=" * 70)

    extent = get_philippines_extent()

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
            figsize=(10.0, 7.5),
            dpi=dpi,
            zoom_level=zoom_level
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
    print(f"SUCCESS: Philippines GIF saved to: {os.path.abspath(output_path)} ({file_size_mb:.2f} MB)")
    print("=" * 70)
    return output_path

# ── Generate Static Philippines Image ────────────────────────────────────────
def generate_philippines_image(
    output_path="philippines_satellite.png",
    dpi=150,
    zoom_level=6
):
    print("=" * 70)
    print("Generating Philippines Satellite Static Map...")
    print("=" * 70)

    extent = get_philippines_extent()
    dt_utc = get_latest_available_satellite_time()

    img = render_philippines_frame(
        dt_utc=dt_utc,
        extent=extent,
        figsize=(10.0, 7.5),
        dpi=dpi,
        zoom_level=zoom_level
    )

    img.save(output_path, dpi=(dpi, dpi))
    print(f"SUCCESS: Philippines static map saved to: {os.path.abspath(output_path)} ({img.size[0]}x{img.size[1]})")
    print("=" * 70)
    return output_path

# ── CLI Entry Point ──────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Generate Philippines Satellite Maps & Animated GIF Loops with Province Boundaries")
    parser.add_argument("--png-only", action="store_true", help="Generate only static PNG image without GIF loop")
    parser.add_argument("--gif-only", action="store_true", help="Generate only animated GIF loop without PNG image")
    parser.add_argument("--gif", action="store_true", help="Generate animated satellite GIF loop")
    parser.add_argument("--both", action="store_true", help="Generate both static PNG image and animated GIF loop")
    parser.add_argument("--hours", type=float, default=6.0, help="Timeframe in hours for GIF (default: 6.0)")
    parser.add_argument("--interval", type=int, default=20, help="Frame step interval in minutes (default: 20)")
    parser.add_argument("--fps", type=int, default=8, help="Frames per second for GIF (default: 8)")
    parser.add_argument("--dpi", type=int, default=120, help="DPI resolution for GIF frames (default: 120)")
    parser.add_argument("--output", type=str, default=None, help="Custom output filepath")
    args = parser.parse_args()

    if args.png_only:
        out_png = args.output or "philippines_satellite.png"
        generate_philippines_image(output_path=out_png, dpi=args.dpi)
    elif args.gif_only or args.gif:
        out_gif = args.output or "philippines_satellite_loop.gif"
        generate_philippines_gif(
            output_path=out_gif,
            timeframe_hours=args.hours,
            interval_mins=args.interval,
            fps=args.fps,
            dpi=args.dpi
        )
    else:
        # Default: generate BOTH PNG and GIF!
        out_png = args.output.replace(".gif", ".png") if args.output else "philippines_satellite.png"
        out_gif = args.output.replace(".png", ".gif") if args.output else "philippines_satellite_loop.gif"
        generate_philippines_image(output_path=out_png, dpi=args.dpi)
        generate_philippines_gif(
            output_path=out_gif,
            timeframe_hours=args.hours,
            interval_mins=args.interval,
            fps=args.fps,
            dpi=args.dpi
        )

if __name__ == "__main__":
    main()
