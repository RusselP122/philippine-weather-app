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
from PIL import Image

# ── Shared Requests Session with Connection Pooling ─────────────────────────
_HTTP_SESSION = requests.Session()
_ADAPTER = requests.adapters.HTTPAdapter(pool_connections=30, pool_maxsize=30, max_retries=2)
_HTTP_SESSION.mount('https://', _ADAPTER)
_HTTP_SESSION.mount('http://', _ADAPTER)

# ── Custom Tile Provider for Zoom Earth Satellite Map Tiles ─────────────────
class ZoomEarthTiles(cimgt.GoogleTiles):
    """
    Cartopy tile provider fetching satellite tiles from Zoom Earth Himawari-9 basemap.
    """
    def __init__(self, date_str=None, time_str=None, session=None, **kwargs):
        super().__init__(**kwargs)
        if not date_str or not time_str:
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

# ── Dynamic Satellite Header Title Generator ─────────────────────────────────
def get_satellite_header_title(dt_utc):
    """
    Determines whether it is daytime (True Color) or nighttime (Shortwave IR)
    in the Western Pacific based on solar time, and formats header in Philippine Standard Time (PHT, UTC+8).
    """
    pht_tz = datetime.timezone(datetime.timedelta(hours=8))
    dt_pht = dt_utc.astimezone(pht_tz)

    hour_pht = dt_pht.hour + dt_pht.minute / 60.0
    is_daytime = (5.75 <= hour_pht < 18.25)
    
    if is_daytime:
        mode_text = "Himawari-9 True Color (day)"
    else:
        mode_text = "Himawari-9 Shortwave IR (night)"
        
    time_text = dt_pht.strftime("%I:%M %p PHT %b %d, %Y")
    return f"{mode_text} at {time_text}"

# ── Helper to Clean Filename Strings ─────────────────────────────────────────
def clean_filename_str(s):
    return re.sub(r'[^a-zA-Z0-9_\-]', '', str(s).replace(' ', '_'))

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
                        "analysis_time": item.get("analysis_time", "Latest"),
                    })
            print(f"Successfully fetched {len(storms)} active Western Pacific storm(s) from Knack ATCF API.")
    except Exception as err:
        print(f"Notice: Failed to fetch live Knack ATCF data ({err}). Using fallback.")

    if not storms:
        data_file = os.path.join("public", "data", "tc_positions_latest.json")
        if os.path.exists(data_file):
            try:
                with open(data_file, 'r', encoding='utf-8') as f:
                    loc_data = json.load(f)
                    latest = loc_data.get("latest", {})
                    wind = latest.get("wind_kt", 115.0)
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
                        "analysis_time": latest.get("init_time", "Latest"),
                    })
            except Exception as e:
                print(f"Error reading local fallback file: {e}")

    return storms

# ── Storm Focus Extent Calculator ───────────────────────────────────────────
def calculate_storm_focus_extent(c_lat, c_lon, lon_span=26.0, target_aspect=0.72):
    """
    Calculates dynamic extent focused on given center coordinates (c_lat, c_lon).
    Default lon_span is ~26 degrees with ~18.7 degrees lat span (4:3 aspect ratio).
    """
    min_lon = c_lon - lon_span / 2.0
    max_lon = c_lon + lon_span / 2.0
    lat_span = lon_span * target_aspect
    min_lat = c_lat - lat_span / 2.0
    max_lat = c_lat + lat_span / 2.0

    if min_lat < 0:
        shift = 0 - min_lat
        min_lat += shift
        max_lat += shift

    min_lon = max(80.0, min_lon)
    max_lon = min(180.0, max_lon)
    min_lat = max(0.0, min_lat)
    max_lat = min(60.0, max_lat)

    return [min_lon, max_lon, min_lat, max_lat]

# ── Render a Single Storm-Focused Frame ──────────────────────────────────────
def render_storm_frame(
    dt_utc,
    extent,
    figsize=(10.0, 7.5),
    dpi=120,
    zoom_level=6
):
    """
    Renders a single frame matching the Tropical Tidbits reference style:
    - Top white header bar with left title (True Color day / Shortwave IR night)
      and right title ('PHILIPPINE TYPHOON/ WEATHER')
    - Black border with clean lat/lon tick labels (e.g. 20°N, 15°N, 125°E, 130°E)
    - Coastlines, country borders, and Philippine Area of Responsibility (PAR) line
    - NO history or forecast lines
    """
    date_str = dt_utc.strftime('%Y-%m-%d')
    time_str = f"{dt_utc.hour:02d}{(dt_utc.minute // 10) * 10:02d}"

    tiler = ZoomEarthTiles(date_str=date_str, time_str=time_str)

    fig = plt.figure(figsize=figsize, dpi=dpi, facecolor='white')

    # Position map area with margins for lat/lon tick labels and top header bar
    # [left, bottom, width, height]
    ax_map = fig.add_axes([0.065, 0.055, 0.905, 0.885], projection=ccrs.PlateCarree())
    ax_map.set_extent(extent, crs=ccrs.PlateCarree())

    # 1. Overlay Zoom Earth satellite tiles
    try:
        ax_map.add_image(tiler, zoom_level, alpha=0.95)
    except Exception:
        ax_map.set_facecolor('#0b192c')

    # 2. Add Coastlines and Country Borders (Yellow)
    ax_map.add_feature(cfeature.COASTLINE, linewidth=1.0, edgecolor='#FFE600', alpha=0.95)
    ax_map.add_feature(cfeature.BORDERS, linewidth=0.8, edgecolor='#FFE600', linestyle='--', alpha=0.90)

    # 3. Philippine Area of Responsibility (PAR) Boundary
    par_lons = [115.0, 115.0, 120.0, 120.0, 135.0, 135.0, 115.0]
    par_lats = [ 5.0,  15.0,  21.0,  25.0,  25.0,   5.0,   5.0]
    ax_map.plot(
        par_lons, par_lats, color='#FF6B35', linewidth=2.0, linestyle='-',
        alpha=0.95, transform=ccrs.PlateCarree(), label='PAR Boundary'
    )

    # 4. Lat/Lon Coordinate Gridlines and Ticks
    gl = ax_map.gridlines(draw_labels=True, linewidth=0.5, color='gray', alpha=0.55, linestyle='-')
    gl.top_labels = False
    gl.right_labels = False
    gl.xlocator = mticker.MultipleLocator(5.0)
    gl.ylocator = mticker.MultipleLocator(5.0)
    gl.xlabel_style = {'size': 9.0, 'color': '#000000', 'weight': 'normal'}
    gl.ylabel_style = {'size': 9.0, 'color': '#000000', 'weight': 'normal'}

    # 5. Top Header Text
    left_title = get_satellite_header_title(dt_utc)
    right_title = "PHILIPPINE TYPHOON/ WEATHER"

    # Header left: Dynamic satellite product title & timestamp
    fig.text(
        0.065, 0.965,
        left_title,
        fontsize=10.5,
        fontweight='bold',
        color='#000000',
        ha='left',
        va='center',
        fontfamily='sans-serif'
    )

    # Header right: Branding
    fig.text(
        0.970, 0.965,
        right_title,
        fontsize=10.5,
        fontweight='bold',
        color='#64748b',
        ha='right',
        va='center',
        fontfamily='sans-serif'
    )

    # Convert plot directly to PIL Image
    fig.canvas.draw()
    rgba_buffer = fig.canvas.buffer_rgba()
    img = Image.frombuffer('RGBA', fig.canvas.get_width_height(), rgba_buffer, 'raw', 'RGBA', 0, 1).convert('RGB')
    plt.close(fig)

    return img

# ── Generate Animated Storm GIF for a Specific Extent ───────────────────────
def generate_single_storm_gif(
    output_path,
    extent,
    storm_label="Storm",
    timeframe_hours=6.0,
    interval_mins=20,
    fps=8,
    dpi=120,
    zoom_level=6,
    last_frame_pause_sec=1.5
):
    """
    Renders an animated GIF loop for a given storm extent.
    """
    print(f"\n--- Generating GIF for: {storm_label} ---")
    print(f"Timeframe: Past {timeframe_hours:.1f} hours | Interval: {interval_mins} mins | FPS: {fps}")

    now_utc = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=40)
    mins = (now_utc.minute // 10) * 10
    end_utc = now_utc.replace(minute=mins, second=0, microsecond=0)
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

        frame_img = render_storm_frame(
            dt_utc=t_utc,
            extent=extent,
            figsize=(10.0, 7.5),
            dpi=dpi,
            zoom_level=zoom_level
        )
        frames.append(frame_img)

    print(f"\nCompleted {len(frames)} frames for {storm_label}. Compiling GIF...")

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
    print(f"SUCCESS: GIF saved to: {os.path.abspath(output_path)} ({file_size_mb:.2f} MB)")
    return output_path

# ── Generate Static Image for a Specific Extent ──────────────────────────────
def generate_single_storm_image(
    output_path,
    extent,
    storm_label="Storm",
    dpi=150,
    zoom_level=6
):
    """
    Renders a single high-resolution image for a given storm extent.
    """
    now_utc = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=40)
    mins = (now_utc.minute // 10) * 10
    dt_utc = now_utc.replace(minute=mins, second=0, microsecond=0)

    img = render_storm_frame(
        dt_utc=dt_utc,
        extent=extent,
        figsize=(10.0, 7.5),
        dpi=dpi,
        zoom_level=zoom_level
    )

    img.save(output_path, dpi=(dpi, dpi))
    print(f"SUCCESS: [{storm_label}] image saved to: {os.path.abspath(output_path)} ({img.size[0]}x{img.size[1]})")
    return output_path

# ── Main Multi-Storm Processing Controller ───────────────────────────────────
def process_storms(
    target_storm=None,
    center_lat=None,
    center_lon=None,
    lon_span=26.0,
    timeframe_hours=6.0,
    interval_mins=20,
    fps=8,
    dpi=120,
    generate_gif=False,
    generate_both=False,
    output_custom=None
):
    print("=" * 70)
    mode_str = "GIF Loop + Static PNG" if generate_both else ("GIF Loop" if generate_gif else "Static PNG")
    print(f"Storm-Focused Satellite Generator ({mode_str})")
    print("=" * 70)

    # 1. Check if user specified custom coordinates
    if center_lat is not None and center_lon is not None:
        c_lat = float(center_lat)
        c_lon = float(center_lon)
        extent = calculate_storm_focus_extent(c_lat, c_lon, lon_span=lon_span)
        label = f"Custom_Center_{c_lat:.1f}N_{c_lon:.1f}E"
        
        if generate_both or not generate_gif:
            out_png = output_custom.replace(".gif", ".png") if output_custom else f"storm_focused_{label}.png"
            generate_single_storm_image(out_png, extent, storm_label=label, dpi=dpi)
        if generate_both or generate_gif:
            out_gif = output_custom.replace(".png", ".gif") if output_custom else f"storm_focused_{label}.gif"
            generate_single_storm_gif(
                out_gif, extent, storm_label=label,
                timeframe_hours=timeframe_hours, interval_mins=interval_mins, fps=fps, dpi=dpi
            )
        return

    # 2. Fetch active storms from Knack ATCF API
    storms = fetch_knack_atcf_storms()
    if not storms:
        print("Notice: No active storms detected. Using default Philippine Sea focus.")
        storms = [{
            "atcf_id": "WPAC",
            "storm_name": "WESTERN PACIFIC",
            "lat": 14.0,
            "lon": 135.0,
            "wind_kt": 30.0
        }]

    # 3. Filter target storm if user passed --storm
    if target_storm:
        target_str = str(target_storm).strip().upper()
        matched = [
            st for st in storms
            if target_str in st["atcf_id"].upper() or target_str in st["storm_name"].upper()
        ]
        if matched:
            storms_to_process = matched
            print(f"Targeting specified storm: {matched[0]['storm_name']} ({matched[0]['atcf_id']})")
        else:
            print(f"Warning: Storm '{target_storm}' not found in active list. Processing all active storms.")
            storms_to_process = storms
    else:
        # Default: Process ALL active storms!
        storms_to_process = storms
        print(f"\nProcessing all {len(storms_to_process)} active storms:")
        for i, st in enumerate(storms_to_process):
            print(f"  {i+1}. {st['storm_name']} ({st['atcf_id']}) - Lat: {st['lat']:.1f}N, Lon: {st['lon']:.1f}E, Wind: {st['wind_kt']} kt")

    # 4. Generate outputs for each storm
    generated_pngs = []
    generated_gifs = []

    for idx, st in enumerate(storms_to_process):
        storm_name = st.get("storm_name", "UNNAMED")
        atcf_id = st.get("atcf_id", f"STORM_{idx+1}")
        c_lat = float(st.get("lat", 15.0))
        c_lon = float(st.get("lon", 135.0))
        
        clean_id = clean_filename_str(atcf_id)
        clean_name = clean_filename_str(storm_name)
        label = f"{storm_name} ({atcf_id})"

        extent = calculate_storm_focus_extent(c_lat, c_lon, lon_span=lon_span)
        print(f"\n[{idx+1}/{len(storms_to_process)}] Processing: {label} centered at ({c_lat:.2f}N, {c_lon:.2f}E)...")

        # Static PNG
        if generate_both or not generate_gif:
            if output_custom and len(storms_to_process) == 1:
                png_file = output_custom.replace(".gif", ".png")
            else:
                png_file = f"storm_focused_{clean_id}.png"

            generate_single_storm_image(png_file, extent, storm_label=label, dpi=dpi)
            generated_pngs.append(png_file)

            # Also create standard storm_focused_satellite.png for the primary / first storm
            if idx == 0 and png_file != "storm_focused_satellite.png":
                try:
                    import shutil
                    shutil.copyfile(png_file, "storm_focused_satellite.png")
                except Exception:
                    pass

        # Animated GIF
        if generate_both or generate_gif:
            if output_custom and len(storms_to_process) == 1:
                gif_file = output_custom.replace(".png", ".gif")
            else:
                gif_file = f"storm_focused_{clean_id}.gif"

            generate_single_storm_gif(
                gif_file,
                extent,
                storm_label=label,
                timeframe_hours=timeframe_hours,
                interval_mins=interval_mins,
                fps=fps,
                dpi=dpi
            )
            generated_gifs.append(gif_file)

            # Also create standard storm_focused_satellite_loop.gif for the primary / first storm
            if idx == 0 and gif_file != "storm_focused_satellite_loop.gif":
                try:
                    import shutil
                    shutil.copyfile(gif_file, "storm_focused_satellite_loop.gif")
                except Exception:
                    pass

    print("\n" + "=" * 70)
    print("BATCH GENERATION COMPLETED SUCCESSFULLY!")
    if generated_pngs:
        print(f"Generated {len(generated_pngs)} PNG Map(s):")
        for p in generated_pngs:
            print(f"  -> {p}")
    if generated_gifs:
        print(f"Generated {len(generated_gifs)} Animated GIF(s):")
        for g in generated_gifs:
            print(f"  -> {g}")
    print("=" * 70)

# ── CLI Entry Point ──────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Generate Storm-Focused Satellite Maps & Animated GIF Loops for All Active Storms")
    parser.add_argument("--png-only", action="store_true", help="Generate only static PNG images without GIF loops")
    parser.add_argument("--gif-only", action="store_true", help="Generate only animated GIF loops without PNG images")
    parser.add_argument("--gif", action="store_true", help="Generate animated satellite GIF loops")
    parser.add_argument("--both", action="store_true", help="Generate both static PNG images and animated GIF loops")
    parser.add_argument("--storm", type=str, default=None, help="Target specific storm by ATCF ID or Name (e.g. 17W, 18W, SAUDEL, 97W)")
    parser.add_argument("--lat", type=float, default=None, help="Custom center latitude")
    parser.add_argument("--lon", type=float, default=None, help="Custom center longitude")
    parser.add_argument("--span", type=float, default=26.0, help="Longitude span in degrees (default: 26.0)")
    parser.add_argument("--hours", type=float, default=6.0, help="Timeframe in hours for GIF (default: 6.0)")
    parser.add_argument("--interval", type=int, default=20, help="Frame step interval in minutes (default: 20)")
    parser.add_argument("--fps", type=int, default=8, help="Frames per second for GIF (default: 8)")
    parser.add_argument("--dpi", type=int, default=120, help="DPI resolution for GIF frames (default: 120)")
    parser.add_argument("--output", type=str, default=None, help="Custom output filepath (when single storm)")
    args = parser.parse_args()

    # Determine generation modes: Default is to generate BOTH GIF and PNG!
    if args.png_only:
        gen_gif = False
        gen_both = False
    elif args.gif_only or args.gif:
        gen_gif = True
        gen_both = False
    else:
        # Default: generate BOTH PNG and GIF!
        gen_gif = True
        gen_both = True

    process_storms(
        target_storm=args.storm,
        center_lat=args.lat,
        center_lon=args.lon,
        lon_span=args.span,
        timeframe_hours=args.hours,
        interval_mins=args.interval,
        fps=args.fps,
        dpi=args.dpi,
        generate_gif=gen_gif,
        generate_both=gen_both,
        output_custom=args.output
    )

if __name__ == "__main__":
    main()
