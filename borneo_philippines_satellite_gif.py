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

# ── Dynamically Find Latest Available Satellite Timestamp ────────────────────
def get_latest_available_satellite_time():
    """
    Dynamically checks Zoom Earth tile servers to find the freshest available
    Himawari satellite scan timestamp (typically 15-25 minutes behind real time).
    """
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
    """
    Cartopy tile provider fetching satellite tiles from Zoom Earth Himawari-9 basemap.
    """
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

# ── Dynamic Satellite Header Title Generator ─────────────────────────────────
def get_satellite_header_title(dt_utc):
    """
    Determines whether it is daytime (True Color) or nighttime (Shortwave IR)
    in the Borneo/Philippines region based on solar time, and formats header in Philippine Standard Time (PHT, UTC+8).
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

# ── Borneo to Philippines Extent ─────────────────────────────────────────────
def get_borneo_philippines_extent():
    """
    Returns extent covering Borneo (Kalimantan/Sarawak/Sabah/Brunei) across the
    Sulu & Celebes Seas to the Philippine Archipelago:
    [min_lon, max_lon, min_lat, max_lat] -> [106.0, 134.0, -5.5, 21.5]
    """
    return [106.0, 134.0, -5.5, 21.5]

# ── Render a Single Borneo-to-Philippines Frame ──────────────────────────────
def render_borneo_philippines_frame(
    dt_utc,
    extent=None,
    figsize=(10.0, 7.5),
    dpi=120,
    zoom_level=6
):
    """
    Renders a single frame matching the Tropical Tidbits reference style:
    - Top white header bar with left title (True Color day / Shortwave IR night in PHT)
      and right title ('PHILIPPINE TYPHOON/ WEATHER')
    - Black border with clean lat/lon tick labels (e.g. 5°S, 0°, 5°N, 10°N, 15°N, 20°N, 110°E, 115°E, 120°E, 125°E, 130°E)
    - Yellow coastlines, country borders (Indonesia, Malaysia, Brunei, Philippines)
    - Philippine Area of Responsibility (PAR) boundary line in orange
    - NO history or forecast lines
    """
    if extent is None:
        extent = get_borneo_philippines_extent()

    date_str = dt_utc.strftime('%Y-%m-%d')
    time_str = f"{dt_utc.hour:02d}{(dt_utc.minute // 10) * 10:02d}"

    tiler = ZoomEarthTiles(date_str=date_str, time_str=time_str)

    fig = plt.figure(figsize=figsize, dpi=dpi, facecolor='white')

    # Position map area with margins for lat/lon tick labels and top header bar
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

    # Header left: Dynamic satellite product title & PHT timestamp
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

# ── Generate Animated Borneo-to-Philippines GIF Loop ────────────────────────
def generate_borneo_philippines_gif(
    output_path="borneo_philippines_satellite_loop.gif",
    timeframe_hours=6.0,
    interval_mins=20,
    fps=8,
    dpi=120,
    zoom_level=6,
    last_frame_pause_sec=1.5
):
    """
    Renders an animated GIF loop spanning Borneo to the Philippines over a timeframe.
    """
    print("=" * 70)
    print("Generating Borneo to Philippines Satellite Loop GIF...")
    print(f"Timeframe: Past {timeframe_hours:.1f} hours | Interval: {interval_mins} mins | FPS: {fps}")
    print("=" * 70)

    extent = get_borneo_philippines_extent()

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

        frame_img = render_borneo_philippines_frame(
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
    print(f"SUCCESS: Borneo to Philippines GIF saved to: {os.path.abspath(output_path)} ({file_size_mb:.2f} MB)")
    print("=" * 70)
    return output_path

# ── Generate Static Borneo-to-Philippines Image ─────────────────────────────
def generate_borneo_philippines_image(
    output_path="borneo_philippines_satellite.png",
    dpi=150,
    zoom_level=6
):
    """
    Renders a single high-resolution static map spanning Borneo to the Philippines.
    """
    print("=" * 70)
    print("Generating Borneo to Philippines Satellite Static Map...")
    print("=" * 70)

    extent = get_borneo_philippines_extent()
    dt_utc = get_latest_available_satellite_time()

    img = render_borneo_philippines_frame(
        dt_utc=dt_utc,
        extent=extent,
        figsize=(10.0, 7.5),
        dpi=dpi,
        zoom_level=zoom_level
    )

    img.save(output_path, dpi=(dpi, dpi))
    print(f"SUCCESS: Borneo to Philippines static map saved to: {os.path.abspath(output_path)} ({img.size[0]}x{img.size[1]})")
    print("=" * 70)
    return output_path

# ── CLI Entry Point ──────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Generate Borneo to Philippines Satellite Maps & Animated GIF Loops")
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
        out_png = args.output or "borneo_philippines_satellite.png"
        generate_borneo_philippines_image(output_path=out_png, dpi=args.dpi)
    elif args.gif_only or args.gif:
        out_gif = args.output or "borneo_philippines_satellite_loop.gif"
        generate_borneo_philippines_gif(
            output_path=out_gif,
            timeframe_hours=args.hours,
            interval_mins=args.interval,
            fps=args.fps,
            dpi=args.dpi
        )
    else:
        # Default: generate BOTH PNG and GIF!
        out_png = args.output.replace(".gif", ".png") if args.output else "borneo_philippines_satellite.png"
        out_gif = args.output.replace(".png", ".gif") if args.output else "borneo_philippines_satellite_loop.gif"
        generate_borneo_philippines_image(output_path=out_png, dpi=args.dpi)
        generate_borneo_philippines_gif(
            output_path=out_gif,
            timeframe_hours=args.hours,
            interval_mins=args.interval,
            fps=args.fps,
            dpi=args.dpi
        )

if __name__ == "__main__":
    main()
