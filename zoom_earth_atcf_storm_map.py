import os
import sys
import math
import json
import io
import argparse
import datetime
import requests
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, Polygon as MplPolygon, PathPatch, Circle
from matplotlib.path import Path
import matplotlib.patheffects as patheffects
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import cartopy.io.img_tiles as cimgt
from PIL import Image, ImageEnhance, ImageDraw, ImageFont

# ── Shared Requests Session with Connection Pooling ─────────────────────────
_HTTP_SESSION = requests.Session()
_ADAPTER = requests.adapters.HTTPAdapter(pool_connections=30, pool_maxsize=30, max_retries=2)
_HTTP_SESSION.mount('https://', _ADAPTER)
_HTTP_SESSION.mount('http://', _ADAPTER)

# ── Custom Tile Provider for Zoom Earth Satellite Map Tiles ─────────────────
class ZoomEarthTiles(cimgt.GoogleTiles):
    """
    Cartopy tile provider fetching satellite tiles from Zoom Earth Himawari-9 basemap.
    Includes HTTP headers and connection pooling.
    """
    def __init__(self, date_str=None, time_str=None, session=None, **kwargs):
        super().__init__(**kwargs)
        if not date_str or not time_str:
            # Auto-calculate active Himawari satellite timestamp (UTC - 40 mins, rounded to 10 min)
            now = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=40)
            mins = (now.minute // 10) * 10
            date_str = now.strftime('%Y-%m-%d')
            time_str = f'{now.hour:02d}{mins:02d}'

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
        # Zoom Earth uses {z}/{y}/{x} coordinate order
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

        # When Himawari coverage ends in the Eastern Pacific (~165E),
        # return a solid color tile matching the Himawari ocean color
        seamless_ocean = Image.new('RGB', (256, 256), (11, 15, 20))
        return seamless_ocean, self.tileextent(tile), 'lower'

# ── Helper: Category styling based on wind speed (knots) & cyclone nature ───
def get_category_info(wind_kt, nature=None):
    if wind_kt is None:
        wind_kt = 0
        
    wind_kmh = round((wind_kt * 1.852) / 5) * 5
    nature = (nature or "").upper()

    if wind_kmh < 39 or nature in ["DB", "INVEST", "LPA"]:
        return "Low Pressure Area", "#9ab3c5", "LPA"
    elif wind_kmh <= 61:
        return "Tropical Depression", "#7cb5ec", "TD"
    elif wind_kmh <= 88:
        return "Tropical Storm", "#90ed7d", "TS"
    elif wind_kmh <= 117:
        return "Severe Tropical Storm", "#f7a35c", "STS"
    elif wind_kmh <= 184:
        return "Typhoon", "#f45b5b", "TY"
    else:
        return "Super Typhoon", "#aa0000", "STY"

# ── Helper: Offset point calculation for cones and circles ─────────────────
def offset_point(lat, lon, distance_km, bearing_deg):
    R = 6371.0
    br = math.radians(bearing_deg)
    la1 = math.radians(lat)
    lo1 = math.radians(lon)
    la2 = math.asin(
        math.sin(la1) * math.cos(distance_km / R) +
        math.cos(la1) * math.sin(distance_km / R) * math.cos(br)
    )
    lo2 = lo1 + math.atan2(
        math.sin(br) * math.sin(distance_km / R) * math.cos(la1),
        math.cos(distance_km / R) - math.sin(la1) * math.sin(la2),
    )
    return math.degrees(la2), math.degrees(lo2)

# ── Fetch Storm Data from Knack ATCF API ─────────────────────────────────────
def fetch_knack_atcf_storms():
    """
    Fetches active tropical cyclones directly from Knack ATCF API.
    Filters specifically for Western Pacific (WPAC / WNP) basin storms.
    """
    knack_url = "https://api.knackwx.com/atcf/v2"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    storms = []

    try:
        r = _HTTP_SESSION.get(knack_url, headers=headers, timeout=10)
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list):
                for item in data:
                    atcf_id = item.get("atcf_id", "").strip()
                    long_id = (item.get("long_atcf_id") or atcf_id or "").lower()
                    storm_name = item.get("storm_name", "UNNAMED").strip()
                    lat = float(item.get("latitude", 0.0))
                    lon = float(item.get("longitude", 0.0))
                    wind_kt = float(item.get("winds") or 0.0)
                    pressure = float(item.get("pressure") or 1008.0)
                    nature = item.get("cyclone_nature", "")
                    basin = item.get("basin", "")

                    is_wpac = (
                        basin.upper() == "WPAC"
                        or item.get("origin_basin") == "W"
                        or atcf_id.upper().endswith("W")
                        or long_id.startswith("wp")
                    )

                    if not is_wpac:
                        continue

                    if lon < 0:
                        lon += 360

                    cat_name, cat_color, cat_abbrev = get_category_info(wind_kt, nature)

                    storms.append({
                        "atcf_id": atcf_id,
                        "long_atcf_id": long_id,
                        "storm_name": storm_name,
                        "lat": lat,
                        "lon": lon,
                        "wind_kt": wind_kt,
                        "pressure_hpa": pressure,
                        "nature": nature,
                        "basin": basin,
                        "category_name": cat_name,
                        "category_color": cat_color,
                        "category_abbrev": cat_abbrev,
                        "analysis_time": item.get("analysis_time", "Latest"),
                    })
            print(f"Successfully fetched {len(storms)} active Western Pacific storms from Knack ATCF API.")
    except Exception as err:
        print(f"Notice: Failed to fetch live Knack ATCF data ({err}). Using fallback extent.")

    if not storms:
        data_file = os.path.join("public", "data", "tc_positions_latest.json")
        if os.path.exists(data_file):
            try:
                with open(data_file, 'r', encoding='utf-8') as f:
                    loc_data = json.load(f)
                    latest = loc_data.get("latest", {})
                    wind = latest.get("wind_kt", 115.0)
                    cat_name, cat_color, cat_abbrev = get_category_info(wind)
                    storms.append({
                        "atcf_id": loc_data.get("track_id", "WP122026"),
                        "long_atcf_id": loc_data.get("track_id", "WP122026").lower(),
                        "storm_name": loc_data.get("storm_name", "TYPHOON GAEMI"),
                        "lat": latest.get("lat", 15.4),
                        "lon": latest.get("lon", 128.8),
                        "wind_kt": wind,
                        "pressure_hpa": latest.get("pressure_hpa", 945.0),
                        "nature": "TY",
                        "basin": "WPAC",
                        "category_name": cat_name,
                        "category_color": cat_color,
                        "category_abbrev": cat_abbrev,
                        "analysis_time": latest.get("init_time", "Latest"),
                    })
            except Exception as e:
                print(f"Error reading local fallback file: {e}")

    return storms

# ── Dynamic Map Extent Calculator ───────────────────────────────────────────
def calculate_optimal_extent(storms=None, target_aspect=0.75):
    """
    Calculates dynamic map extent tightly framing Hong Kong, Philippines, and active storms.
    Ensures exact aspect ratio in Mercator projection coordinates.
    """
    if storms is None:
        storms = fetch_knack_atcf_storms()

    poi_lons = [114.1, 117.0, 126.0] + [s["lon"] for s in storms if "lon" in s]
    poi_lats = [22.3, 5.0, 21.0] + [s["lat"] for s in storms if "lat" in s]

    base_min_lon = min(poi_lons) - 2.0
    base_max_lon = max(poi_lons) + 3.5
    base_min_lat = min(poi_lats) - 2.0
    base_max_lat = max(poi_lats) + 3.5

    tiler = ZoomEarthTiles()
    tiler_crs = tiler.crs
    plate_carree = ccrs.PlateCarree()

    bottom_left = tiler_crs.transform_point(base_min_lon, base_min_lat, plate_carree)
    top_right = tiler_crs.transform_point(base_max_lon, base_max_lat, plate_carree)

    x_min, y_min = bottom_left
    x_max, y_max = top_right
    x_span = x_max - x_min
    y_span = y_max - y_min

    current_aspect = y_span / x_span

    if current_aspect < target_aspect:
        target_y_span = x_span * target_aspect
        y_padding = target_y_span - y_span
        y_min -= y_padding * 0.30
        y_max += y_padding * 0.70
    else:
        target_x_span = y_span / target_aspect
        x_padding = target_x_span - x_span
        x_min -= x_padding * 0.5
        x_max += x_padding * 0.5

    if y_min < 0:
        shift = 0 - y_min
        y_min += shift
        y_max += shift

    new_bottom_left = plate_carree.transform_point(x_min, y_min, tiler_crs)
    new_top_right = plate_carree.transform_point(x_max, y_max, tiler_crs)

    base_min_lon, base_min_lat = new_bottom_left
    base_max_lon, base_max_lat = new_top_right

    min_lon = max(90.0, base_min_lon)
    max_lon = min(178.0, base_max_lon)
    min_lat = max(0.0, base_min_lat)
    max_lat = min(60.0, base_max_lat)

    return [min_lon, max_lon, min_lat, max_lat]

# ── Render a Single Satellite Frame ─────────────────────────────────────────
def render_satellite_frame(
    date_str,
    time_str,
    extent,
    storms=None,
    figsize=(12.0, 9.0),
    dpi=150,
    zoom_level=5,
    overlay_time_info=None
):
    """
    Renders a single satellite frame without history and forecast lines.
    Includes coastlines, borders, PAR boundary, and clean timestamp HUD overlay.
    """
    tiler = ZoomEarthTiles(date_str=date_str, time_str=time_str)
    fig = plt.figure(figsize=figsize, dpi=dpi, facecolor='#0b1736')
    ax_map = fig.add_axes([0.0, 0.0, 1.0, 1.0], projection=tiler.crs)
    ax_map.set_extent(extent, crs=ccrs.PlateCarree())
    ax_map.set_aspect('auto')

    # Satellite imagery layer
    try:
        ax_map.add_image(tiler, zoom_level, alpha=0.95)
    except Exception as e:
        ax_map.set_facecolor('#0b192c')

    # Add Coastlines and Country Borders
    ax_map.add_feature(cfeature.COASTLINE, linewidth=1.0, edgecolor='#e2e8f0', alpha=0.9)
    ax_map.add_feature(cfeature.BORDERS, linewidth=0.8, edgecolor='#94a3b8', linestyle='--', alpha=0.8)

    # Philippine Area of Responsibility (PAR) Boundary
    par_lons = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
    par_lats = [ 5.0,  15.0,  21.0,  25.0,  25.0,   5.0,   5.0]
    ax_map.plot(
        par_lons, par_lats, color='#FF6B35', linewidth=2.5, linestyle='-',
        alpha=0.9, transform=ccrs.PlateCarree(), label='PAR Boundary'
    )

    # Convert plot directly to PIL Image
    fig.canvas.draw()
    rgba_buffer = fig.canvas.buffer_rgba()
    img = Image.frombuffer('RGBA', fig.canvas.get_width_height(), rgba_buffer, 'raw', 'RGBA', 0, 1).convert('RGB')
    plt.close(fig)

    # Add modern Timeframe / Timestamp HUD overlay on top of frame
    if overlay_time_info:
        img = add_timeframe_hud_overlay(img, overlay_time_info)

    return img

# ── Sleek Timeframe HUD / Timestamp Badge Overlay ───────────────────────────
def add_timeframe_hud_overlay(img, time_info):
    """
    Renders an elegant glassmorphism HUD badge with observation time in UTC and PHT.
    """
    draw = ImageDraw.Draw(img, 'RGBA')
    width, height = img.size

    utc_dt = time_info.get("utc_dt")
    pht_dt = time_info.get("pht_dt")
    frame_idx = time_info.get("frame_idx")
    total_frames = time_info.get("total_frames")
    time_offset_str = time_info.get("time_offset_str", "")

    if utc_dt and pht_dt:
        time_pht_str = pht_dt.strftime("%d %b %Y • %I:%M %p PHT (UTC+8)")
        time_utc_str = utc_dt.strftime("%Y-%m-%d %H:%M UTC")
    else:
        time_pht_str = time_info.get("title", "Zoom Earth Himawari Satellite")
        time_utc_str = time_info.get("subtitle", "")

    # Badge Box Geometry scaled dynamically
    badge_w = int(width * 0.44)
    badge_h = max(68, int(height * 0.082))
    badge_x = 24
    badge_y = 24
    corner_r = 10

    # Translucent glassmorphism background
    draw.rounded_rectangle(
        [badge_x, badge_y, badge_x + badge_w, badge_y + badge_h],
        radius=corner_r,
        fill=(11, 23, 54, 215),
        outline=(56, 189, 248, 180),
        width=2
    )

    # Accent Indicator Bar
    bar_w = 5
    draw.rounded_rectangle(
        [badge_x + 6, badge_y + 8, badge_x + 6 + bar_w, badge_y + badge_h - 8],
        radius=3,
        fill=(255, 107, 53, 240)
    )

    # Fonts
    font_main_size = max(14, int(badge_h * 0.28))
    font_sub_size = max(10, int(badge_h * 0.20))
    font_tag_size = max(10, int(badge_h * 0.18))
    try:
        font_main = ImageFont.truetype("arialbd.ttf", font_main_size)
        font_sub = ImageFont.truetype("arial.ttf", font_sub_size)
        font_tag = ImageFont.truetype("arialbd.ttf", font_tag_size)
    except Exception:
        font_main = ImageFont.load_default()
        font_sub = font_main
        font_tag = font_main

    # Draw primary observation timestamp (PHT)
    draw.text((badge_x + 20, badge_y + 10), time_pht_str, fill=(255, 255, 255, 255), font=font_main)

    # Draw secondary UTC timestamp & satellite source
    sub_text = f"{time_utc_str}  |  HIMAWARI-9 GEOCOLOR"
    draw.text((badge_x + 20, badge_y + 12 + font_main_size + 4), sub_text, fill=(148, 163, 184, 255), font=font_sub)

    # Frame counter / progress badge in top right corner of the HUD
    if total_frames and total_frames > 1 and frame_idx is not None:
        tag_text = f"{frame_idx + 1}/{total_frames} ({time_offset_str})" if time_offset_str else f"{frame_idx + 1}/{total_frames}"
        tag_w = int(len(tag_text) * (font_tag_size * 0.65)) + 16
        tag_h = font_tag_size + 10
        tag_x = badge_x + badge_w - tag_w - 12
        tag_y = badge_y + 10

        draw.rounded_rectangle(
            [tag_x, tag_y, tag_x + tag_w, tag_y + tag_h],
            radius=5,
            fill=(30, 41, 59, 230),
            outline=(56, 189, 248, 140),
            width=1
        )
        draw.text((tag_x + 8, tag_y + 3), tag_text, fill=(56, 189, 248, 255), font=font_tag)

        # Subtle bottom progress bar inside badge
        progress_pct = (frame_idx + 1) / total_frames
        prog_w = int((badge_w - 24) * progress_pct)
        draw.rectangle(
            [badge_x + 12, badge_y + badge_h - 4, badge_x + 12 + prog_w, badge_y + badge_h - 2],
            fill=(56, 189, 248, 240)
        )

    return img

# ── Main Static Map Generator ────────────────────────────────────────────────
def generate_zoom_earth_storm_map(
    output_path="zoom_earth_atcf_storm_map.png",
    storm_data=None,
    extent=None,
    update_time_str=None
):
    """
    Generates a single high-resolution satellite map without history or forecast lines.
    """
    print("=" * 60)
    print("Generating Zoom Earth ATCF Storm Map (Static Image)...")
    print("Canvas Size: 12.0 x 9.0 in @ 300 DPI (3600 x 2700 px)")
    print("=" * 60)

    if storm_data is None:
        storms = fetch_knack_atcf_storms()
    elif isinstance(storm_data, list):
        storms = storm_data
    else:
        storms = [storm_data]

    if extent is None:
        extent = calculate_optimal_extent(storms)

    # Active satellite timestamp (UTC - 40 mins, rounded to 10 min)
    now_utc = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=40)
    mins = (now_utc.minute // 10) * 10
    now_utc = now_utc.replace(minute=mins, second=0, microsecond=0)
    pht_tz = datetime.timezone(datetime.timedelta(hours=8))
    now_pht = now_utc.astimezone(pht_tz)

    date_str = now_utc.strftime('%Y-%m-%d')
    time_str = f'{now_utc.hour:02d}{mins:02d}'

    time_info = {
        "utc_dt": now_utc,
        "pht_dt": now_pht,
        "frame_idx": None,
        "total_frames": 1,
        "time_offset_str": "Latest"
    }

    img = render_satellite_frame(
        date_str=date_str,
        time_str=time_str,
        extent=extent,
        storms=storms,
        figsize=(12.0, 9.0),
        dpi=300,
        zoom_level=6,
        overlay_time_info=time_info
    )

    # Ensure output is exactly 3600 x 2700 px
    if img.size != (3600, 2700):
        img = img.resize((3600, 2700), Image.Resampling.LANCZOS)

    img.save(output_path, dpi=(300, 300))
    print(f"SUCCESS: Static map saved to: {os.path.abspath(output_path)} ({img.size[0]}x{img.size[1]})")
    print("=" * 60)
    return output_path

# ── Timeframe Animated GIF Generator ─────────────────────────────────────────
def generate_zoom_earth_gif(
    output_path="zoom_earth_atcf_storm_map.gif",
    timeframe_hours=6.0,
    interval_mins=20,
    fps=8,
    dpi=120,
    zoom_level=5,
    storm_data=None,
    extent=None,
    last_frame_pause_sec=1.5
):
    """
    Generates an animated GIF looping through Himawari satellite imagery across a timeframe.
    Includes timestamp HUD overlays and smooth infinite looping.
    """
    print("=" * 60)
    print(f"Generating Zoom Earth Satellite Loop GIF...")
    print(f"Timeframe: Past {timeframe_hours:.1f} hours | Interval: {interval_mins} mins | FPS: {fps}")
    print("=" * 60)

    if storm_data is None:
        storms = fetch_knack_atcf_storms()
    elif isinstance(storm_data, list):
        storms = storm_data
    else:
        storms = [storm_data]

    if extent is None:
        extent = calculate_optimal_extent(storms)

    # Calculate timestamps across timeframe window
    now_utc = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=40)
    mins = (now_utc.minute // 10) * 10
    end_utc = now_utc.replace(minute=mins, second=0, microsecond=0)
    start_utc = end_utc - datetime.timedelta(hours=timeframe_hours)

    pht_tz = datetime.timezone(datetime.timedelta(hours=8))

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
        t_pht = t_utc.astimezone(pht_tz)
        d_str = t_utc.strftime('%Y-%m-%d')
        tm_str = f"{t_utc.hour:02d}{t_utc.minute:02d}"

        # Calculate relative offset string e.g. "-3h 20m" or "Latest"
        diff_mins = int((end_utc - t_utc).total_seconds() / 60)
        if diff_mins <= 0:
            offset_str = "Latest"
        else:
            diff_h = diff_mins // 60
            diff_m = diff_mins % 60
            offset_str = f"-{diff_h}h {diff_m:02d}m" if diff_h > 0 else f"-{diff_m}m"

        time_info = {
            "utc_dt": t_utc,
            "pht_dt": t_pht,
            "frame_idx": idx,
            "total_frames": total_frames,
            "time_offset_str": offset_str
        }

        print(f"[{idx + 1}/{total_frames}] Rendering frame: {d_str} {tm_str} ({offset_str})...", end="\r", flush=True)

        frame_img = render_satellite_frame(
            date_str=d_str,
            time_str=tm_str,
            extent=extent,
            storms=storms,
            figsize=(10.0, 7.5),
            dpi=dpi,
            zoom_level=zoom_level,
            overlay_time_info=time_info
        )
        frames.append(frame_img)

    print(f"\nSuccessfully rendered all {len(frames)} frames. Compiling animated GIF...")

    if not frames:
        print("Error: No frames generated.")
        return None

    # Calculate frame durations (in milliseconds)
    frame_duration = int(1000 / fps)
    durations = [frame_duration] * len(frames)
    # Pause longer on the final frame (latest observation)
    durations[-1] = int(last_frame_pause_sec * 1000)

    # Quantize and save animated GIF with PIL
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
    print(f"SUCCESS: Animated GIF saved to: {os.path.abspath(output_path)} ({file_size_mb:.2f} MB)")
    print("=" * 60)
    return output_path

# ── CLI Entry Point ──────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Generate Zoom Earth ATCF Storm Map & Animated GIF Loop")
    parser.add_argument("--gif", action="store_true", help="Generate animated satellite GIF loop")
    parser.add_argument("--both", action="store_true", help="Generate both static PNG map and animated GIF loop")
    parser.add_argument("--hours", type=float, default=6.0, help="Timeframe in hours for GIF (default: 6.0)")
    parser.add_argument("--interval", type=int, default=20, help="Frame step interval in minutes (default: 20)")
    parser.add_argument("--fps", type=int, default=8, help="Frames per second for GIF (default: 8)")
    parser.add_argument("--dpi", type=int, default=120, help="DPI resolution for GIF frames (default: 120)")
    parser.add_argument("--output", type=str, default=None, help="Custom output filepath")
    args = parser.parse_args()

    if args.both:
        png_path = args.output.replace(".gif", ".png") if args.output else "zoom_earth_atcf_storm_map.png"
        gif_path = args.output.replace(".png", ".gif") if args.output else "zoom_earth_atcf_storm_map.gif"
        generate_zoom_earth_storm_map(output_path=png_path)
        generate_zoom_earth_gif(
            output_path=gif_path,
            timeframe_hours=args.hours,
            interval_mins=args.interval,
            fps=args.fps,
            dpi=args.dpi
        )
    elif args.gif:
        out_path = args.output or "zoom_earth_atcf_storm_map.gif"
        generate_zoom_earth_gif(
            output_path=out_path,
            timeframe_hours=args.hours,
            interval_mins=args.interval,
            fps=args.fps,
            dpi=args.dpi
        )
    else:
        out_path = args.output or "zoom_earth_atcf_storm_map.png"
        generate_zoom_earth_storm_map(output_path=out_path)

if __name__ == "__main__":
    main()
