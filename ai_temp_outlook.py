import os
import json
import requests
import numpy as np
import scipy.ndimage
from scipy.interpolate import griddata
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.image as mpimg
import matplotlib.patches as patches
from matplotlib.patches import FancyBboxPatch
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import shapely
from shapely.geometry import shape, box
from shapely.validation import make_valid
from shapely.ops import unary_union
from datetime import datetime, timedelta, timezone
from eccodes import codes_grib_new_from_file, codes_get, codes_get_double_array, codes_get_values, codes_release
from ecmwf.opendata import Client
import xarray as xr
import gcsfs

# ── Directories ────────────────────────────────────────────────────────────
OUTPUT_DIR = os.path.join(os.getcwd(), "public", "images", "ai_temp_outlook")
DATA_DIR = os.path.join(os.getcwd(), "public", "data")
LOGO_PATHS = [
    os.path.join(os.getcwd(), "public", "images", "logo.png"),
    os.path.join(os.getcwd(), "public", "logo512.png"),
    os.path.join(os.getcwd(), "public", "logo192.png")
]
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# ── Region & Master Grid ───────────────────────────────────────────────────
LAT_MIN, LAT_MAX = 4.5, 21.5
LON_MIN, LON_MAX = 114.0, 129.5

GRID_RES = 0.02
MASTER_LATS = np.arange(LAT_MIN, LAT_MAX + GRID_RES, GRID_RES)
MASTER_LONS = np.arange(LON_MIN, LON_MAX + GRID_RES, GRID_RES)
M_LONS, M_LATS = np.meshgrid(MASTER_LONS, MASTER_LATS)

# ── Maximum Temperature Colormap (Daytime Highs: Warm / Heat Scale) ────────
MAX_TEMP_LEVELS = [24, 26, 28, 30, 32, 34, 36, 38]
MAX_TEMP_COLORS = [
    '#5bc0be', '#90e0ef', '#e0e1dd', '#ffd166', '#f48c06', '#dc2f02', '#9d0208'
]
max_temp_cmap = ListedColormap(MAX_TEMP_COLORS)
max_temp_cmap.set_over('#6a040f')
max_temp_cmap.set_under('#0077b6')
max_temp_norm = BoundaryNorm(MAX_TEMP_LEVELS, ncolors=len(MAX_TEMP_COLORS), clip=False)

# ── Minimum Temperature Colormap (Night/Morning Lows: Cool Scale) ──────────
MIN_TEMP_LEVELS = [16, 18, 20, 22, 24, 26, 28, 30]
MIN_TEMP_COLORS = [
    '#3a0ca3', '#4361ee', '#4cc9f0', '#80ed99', '#57cc99', '#38b000', '#007200'
]
min_temp_cmap = ListedColormap(MIN_TEMP_COLORS)
min_temp_cmap.set_over('#004b00')
min_temp_cmap.set_under('#1e0059')
min_temp_norm = BoundaryNorm(MIN_TEMP_LEVELS, ncolors=len(MIN_TEMP_COLORS), clip=False)

# ── Regional Definitions with Exact 16:9 Aspect Ratio Extents ─────────────
BROADCAST_REGIONS = {
    "luzon": {
        "title": "LUZON",
        "extent": [114.46, 127.94, 12.0, 19.3],
        "cities": [
            ("LAOAG", 120.59, 18.20, (0, 0)),
            ("TUGUEGARAO", 121.72, 17.61, (0, 0)),
            ("BAGUIO", 120.59, 16.41, (-0.35, 0)),
            ("DAGUPAN", 120.34, 16.04, (-0.45, -0.1)),
            ("CLARK", 120.56, 15.18, (-0.45, 0)),
            ("CABANATUAN", 120.96, 15.48, (0.45, 0.1)),
            ("MANILA", 120.98, 14.59, (-0.5, 0)),
            ("BATANGAS", 121.05, 13.75, (-0.5, -0.1)),
            ("LUCENA", 121.61, 13.93, (0.45, 0.05)),
            ("NAGA", 123.19, 13.62, (0, 0.1)),
            ("LEGAZPI", 123.73, 13.14, (0.45, -0.1))
        ]
    },
    "visayas": {
        "title": "VISAYAS",
        "extent": [120.08, 127.32, 9.0, 13.0],
        "cities": [
            ("BORACAY", 121.92, 11.97, (-0.45, 0.1)),
            ("KALIBO", 122.36, 11.70, (0, 0.15)),
            ("ROXAS", 122.75, 11.58, (0.35, 0.15)),
            ("ILOILO", 122.56, 10.72, (-0.45, -0.1)),
            ("BACOLOD", 122.95, 10.67, (0.45, 0.1)),
            ("CEBU CITY", 123.89, 10.31, (0.5, -0.05)),
            ("TAGBILARAN", 123.85, 9.65, (0, -0.18)),
            ("DUMAGUETE", 123.30, 9.31, (-0.45, -0.1)),
            ("TACLOBAN", 125.00, 11.24, (0.45, 0.1)),
            ("ORMOC", 124.60, 11.00, (-0.45, 0)),
            ("CATBALOGAN", 124.88, 11.77, (0, 0.18))
        ]
    },
    "mindanao": {
        "title": "MINDANAO",
        "extent": [120.02, 128.98, 5.2, 10.2],
        "cities": [
            ("SURIGAO", 125.49, 9.79, (0.35, -0.30)),
            ("BUTUAN", 125.54, 8.95, (0.45, 0.05)),
            ("CAGAYAN DE ORO", 124.63, 8.48, (-0.55, 0.1)),
            ("ILIGAN", 124.24, 8.23, (-0.55, -0.1)),
            ("DIPOLOG", 123.34, 8.58, (-0.45, 0.1)),
            ("PAGADIAN", 123.43, 7.82, (-0.45, 0)),
            ("ZAMBOANGA", 122.07, 6.92, (0, -0.18)),
            ("COTABATO", 124.24, 7.22, (-0.45, 0)),
            ("DAVAO", 125.60, 7.19, (0.45, 0.05)),
            ("TAGUM", 125.80, 7.44, (0.45, 0.1)),
            ("GEN SANTOS", 125.17, 6.11, (0, -0.18))
        ]
    }
}

PALAWAN_CITIES = [
    ("CORON", 120.20, 12.00, (-0.35, 0.05)),
    ("EL NIDO", 119.39, 11.18, (-0.45, 0.05)),
    ("PTO PRINCESA", 118.73, 9.74, (0.55, 0)),
    ("BROOKE’S PT", 117.83, 8.77, (-0.45, 0))
]

BATANES_BABUYAN_CITIES = [
    ("ITBAYAT", 121.84, 20.78, (0, 0.08)),
    ("BASCO", 121.97, 20.45, (0.28, 0)),
    ("BABUYAN IS.", 121.93, 19.52, (0.35, 0)),
    ("CALAYAN", 121.47, 19.26, (-0.28, -0.05)),
    ("CAMIGUIN IS.", 121.93, 18.92, (0.35, -0.05))
]

# ═══════════════════════════════════════════════════════════════════════════
# Regridding
# ═══════════════════════════════════════════════════════════════════════════
def regrid_to_master(lats, lons, values, default_val=30.0):
    mask = (
        (lats >= LAT_MIN - 1.5) & (lats <= LAT_MAX + 1.5) &
        (lons >= LON_MIN - 1.5) & (lons <= LON_MAX + 1.5)
    )
    if np.any(mask):
        sub_lats = lats[mask]
        sub_lons = lons[mask]
        sub_vals = values[mask]
    else:
        sub_lats, sub_lons, sub_vals = lats, lons, values

    pts = np.column_stack((sub_lons.ravel(), sub_lats.ravel()))
    vals = sub_vals.ravel()
    valid = ~np.isnan(vals)
    if not np.any(valid):
        return np.full_like(M_LATS, default_val)

    regridded = griddata(pts[valid], vals[valid], (M_LONS, M_LATS), method='cubic', fill_value=np.nan)
    if np.any(np.isnan(regridded)):
        linear_fill = griddata(pts[valid], vals[valid], (M_LONS, M_LATS), method='linear', fill_value=np.nanmean(vals))
        regridded = np.where(np.isnan(regridded), linear_fill, regridded)

    regridded = np.nan_to_num(regridded, nan=default_val)
    return regridded

# ═══════════════════════════════════════════════════════════════════════════
# Model Forecast Step Helper for Peak Heating and Nighttime Low
# ═══════════════════════════════════════════════════════════════════════════
def get_diurnal_steps(cycle_str, day_offset=0):
    """
    Returns (daytime_step, nighttime_step) for the given UTC cycle and day offset.
    - Peak daytime heating is ~14:00 PHT = 06:00 UTC.
    - Night/early morning low is ~02:00-05:00 PHT = 18:00-21:00 UTC.
    """
    cycle = int(cycle_str) if cycle_str else 0
    # Steps from cycle to target 06Z (14:00 PHT)
    daytime_step = ((6 - cycle) % 24) + (day_offset * 24)
    # Steps from cycle to target 18Z (02:00 AM PHT next day / night)
    nighttime_step = ((18 - cycle) % 24) + (day_offset * 24)
    return daytime_step, nighttime_step

# ═══════════════════════════════════════════════════════════════════════════
# Fetchers
# ═══════════════════════════════════════════════════════════════════════════
def get_latest_aigfs_run(session):
    base_url = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/aigfs/prod"
    now = datetime.now(timezone.utc)
    for days_back in range(0, 3):
        t_date = now - timedelta(days=days_back)
        date_str = t_date.strftime("%Y%m%d")
        date_url = f"{base_url}/aigfs.{date_str}/"
        try:
            if session.get(date_url, timeout=6).status_code != 200: continue
            for cycle in ["18", "12", "06", "00"]:
                cycle_url = f"{date_url}{cycle}/model/atmos/grib2/"
                test_idx = f"{cycle_url}aigfs.t{cycle}z.sfc.f048.grib2.idx"
                try:
                    if session.head(test_idx, timeout=5).status_code == 200:
                        run_dt = datetime.strptime(f"{date_str}{cycle}", "%Y%m%d%H").replace(tzinfo=timezone.utc)
                        print(f"Found latest AIGFS run: {date_str} {cycle}Z")
                        return cycle_url, run_dt, date_str, cycle
                except: continue
        except: continue
    return None, None, None, None

def download_aigfs_t2m(grib_url, idx_url, session):
    r = session.get(idx_url, timeout=10)
    if r.status_code != 200: return None
    lines = r.text.splitlines()
    
    start_byte, end_byte = None, ""
    for i, line in enumerate(lines):
        if "TMP:2 m above ground" in line:
            start_byte = int(line.split(":")[1])
            if i < len(lines) - 1:
                end_byte = int(lines[i + 1].split(":")[1]) - 1
            break
            
    if start_byte is None: return None
    temp_path = os.path.join(os.getcwd(), f"temp_aigfs_t2m_{os.getpid()}_{np.random.randint(1000,9999)}.grib2")
    headers = {"Range": f"bytes={start_byte}-{end_byte}"}
    gr = session.get(grib_url, headers=headers, timeout=25)
    with open(temp_path, "wb") as f:
        f.write(gr.content)
    return temp_path

def read_aigfs_t2m(grib_file_path):
    lats, lons, t2m = None, None, None
    with open(grib_file_path, "rb") as f:
        gid = codes_grib_new_from_file(f)
        if gid:
            ni = codes_get(gid, "Ni")
            nj = codes_get(gid, "Nj")
            lats = codes_get_double_array(gid, "latitudes").reshape(nj, ni)
            lons = codes_get_double_array(gid, "longitudes").reshape(nj, ni)
            t2m = codes_get_values(gid).reshape(nj, ni)
            codes_release(gid)
    if lons is not None and np.max(lons) > 180:
        lons = np.where(lons > 180, lons - 360, lons)
    if t2m is not None and np.nanmax(t2m) > 150:
        t2m = t2m - 273.15  # Convert Kelvin to Celsius
    return lats, lons, t2m

def get_aifs_t2m(client, step):
    target_file = f"temp_aifs_t2m_{step:03d}_{os.getpid()}.grib2"
    try:
        client.retrieve(step=step, type="fc", param=["2t"], target=target_file)
        ds_sfc = xr.open_dataset(target_file, engine="cfgrib")
        if "time" in ds_sfc.dims and ds_sfc.sizes["time"] > 1:
            ds_sfc = ds_sfc.isel(time=-1)
        t_var = ds_sfc["t2m"]
        t_grid = t_var.values.squeeze()
        lats = t_var.coords["latitude"].values
        lons = t_var.coords["longitude"].values
        if np.nanmax(t_grid) > 150: t_grid = t_grid - 273.15
        ds_sfc.close()
        LONS, LATS = np.meshgrid(lons, lats)
        return LATS, LONS, t_grid
    except Exception as e:
        print(f"AIFS fetch error step {step}: {e}")
        return None, None, None
    finally:
        if os.path.exists(target_file): os.remove(target_file)

def load_weathernext_dataset():
    try:
        fs = gcsfs.GCSFileSystem()
        parent_path = 'gs://weathernext/weathernext_2_0_0/zarr/2025_to_present'
        all_items = fs.ls(parent_path)
        run_folders = [f'gs://{item}' for item in all_items if item.endswith('_preds')]
        if not run_folders: return None
        run_folders.sort()
        latest_run_path = run_folders[-1]
        print(f"WeatherNext2: Reading from {latest_run_path}")
        store = fs.get_mapper(f"{latest_run_path}/predictions.zarr")
        ds = xr.open_zarr(store, consolidated=True)
        if ds.lat[0] < ds.lat[-1]:
            ds_ph = ds.sel(lat=slice(LAT_MIN, LAT_MAX), lon=slice(LON_MIN, LON_MAX))
        else:
            ds_ph = ds.sel(lat=slice(LAT_MAX, LAT_MIN), lon=slice(LON_MIN, LON_MAX))
        return ds_ph
    except Exception as e:
        print(f"WeatherNext2 error: {e}")
        return None

# ── Load Philippine Province Geometries Categorized by Region ─────────────
def load_ph_regional_geometries():
    LUZON_REGIONS = [
        'Bicol Region (Region V)', 'CALABARZON (Region IV-A)', 'Cagayan Valley (Region II)',
        'Central Luzon (Region III)', 'Cordillera Administrative Region (CAR)',
        'Ilocos Region (Region I)', 'MIMAROPA (Region IV-B)', 'Metropolitan Manila'
    ]
    VISAYAS_REGIONS = [
        'Central Visayas (Region VII)', 'Eastern Visayas (Region VIII)', 'Western Visayas (Region VI)'
    ]
    MINDANAO_REGIONS = [
        'Autonomous Region of Muslim Mindanao (ARMM)', 'Caraga (Region XIII)',
        'Davao Region (Region XI)', 'Northern Mindanao (Region X)',
        'SOCCSKSARGEN (Region XII)', 'Zamboanga Peninsula (Region IX)'
    ]

    all_provs = []
    luzon_main_geoms = []
    palawan_geoms = []
    batanes_babuyan_geoms = []
    visayas_geoms = []
    mindanao_geoms = []

    bb_box = box(120.8, 18.7, 122.6, 21.4)

    try:
        geojson_paths = [os.path.join(DATA_DIR, "ph_provinces.json"), "public/data/ph_provinces.json"]
        found_geo = next((p for p in geojson_paths if os.path.exists(p)), None)
        if found_geo:
            with open(found_geo, "r", encoding="utf-8") as f:
                geo_data = json.load(f)
            
            for feat in geo_data["features"]:
                reg = feat["properties"].get("REGION", "")
                pname = feat["properties"].get("NAME_1", feat["properties"].get("PROVINCE", ""))
                geom = make_valid(shape(feat["geometry"]))
                all_provs.append(geom)
                
                if reg in LUZON_REGIONS:
                    if pname.lower() == "palawan":
                        palawan_geoms.append(geom)
                    elif pname.lower() == "batanes":
                        batanes_babuyan_geoms.append(geom)
                    elif pname.lower() == "cagayan":
                        babuyan_part = geom.intersection(bb_box)
                        cagayan_main = geom.difference(bb_box)
                        if not babuyan_part.is_empty:
                            batanes_babuyan_geoms.append(babuyan_part)
                        if not cagayan_main.is_empty:
                            luzon_main_geoms.append(cagayan_main)
                    else:
                        luzon_main_geoms.append(geom)
                elif reg in VISAYAS_REGIONS:
                    visayas_geoms.append(geom)
                elif reg in MINDANAO_REGIONS:
                    mindanao_geoms.append(geom)

            u_luzon_main = unary_union(luzon_main_geoms)
            u_palawan = unary_union(palawan_geoms)
            u_bb = unary_union(batanes_babuyan_geoms)
            u_visayas = unary_union(visayas_geoms)
            u_mindanao = unary_union(mindanao_geoms)

            masks = {
                "luzon_main": shapely.contains_xy(u_luzon_main, M_LONS, M_LATS),
                "palawan": shapely.contains_xy(u_palawan, M_LONS, M_LATS),
                "batanes_babuyan": shapely.contains_xy(u_bb, M_LONS, M_LATS),
                "visayas": shapely.contains_xy(u_visayas, M_LONS, M_LATS),
                "mindanao": shapely.contains_xy(u_mindanao, M_LONS, M_LATS)
            }
            geoms_dict = {
                "all": all_provs,
                "luzon_main": luzon_main_geoms,
                "palawan": palawan_geoms,
                "batanes_babuyan": batanes_babuyan_geoms,
                "visayas": visayas_geoms,
                "mindanao": mindanao_geoms
            }
            return geoms_dict, masks
    except Exception as e:
        print(f"Notice loading regional geometries: {e}")
    return {}, {}

# ═══════════════════════════════════════════════════════════════════════════
# Temperature Forecast Regional Map Generator (Maximum and Minimum Modes)
# ═══════════════════════════════════════════════════════════════════════════
def plot_temperature_map(consensus_grid, filename_id, init_dt, region_key, metric="max", period="today", geoms_dict=None, masks=None):
    """
    Renders 16:9 Widescreen Climate Prediction Center Style Map for:
      - metric: "max" (Daytime Maximum Temperature) or "min" (Nighttime Minimum Temperature)
      - period: "today" or "tomorrow"
    """
    region_info = BROADCAST_REGIONS[region_key]
    smoothed_grid = scipy.ndimage.gaussian_filter(consensus_grid, sigma=1.1)

    # Select Colormap and Levels based on Metric
    if metric == "max":
        levels = MAX_TEMP_LEVELS
        cmap = max_temp_cmap
        norm = max_temp_norm
        default_fallback = 31.0
        tick_labels = ['24', '26', '28', '30', '32', '34', '36', '38°C']
        cbar_labels = ('COOLER', 'NEAR AVERAGE', 'WARMER')
        cbar_colors = ('#5bc0be', '#e0e1dd', '#f48c06')
    else:
        levels = MIN_TEMP_LEVELS
        cmap = min_temp_cmap
        norm = min_temp_norm
        default_fallback = 24.0
        tick_labels = ['16', '18', '20', '22', '24', '26', '28', '30°C']
        cbar_labels = ('COLDER', 'MILD LOWS', 'WARMER LOWS')
        cbar_colors = ('#4cc9f0', '#80ed99', '#38b000')

    # Apply strict regional land mask
    if masks:
        if region_key == "luzon":
            land_temp = np.where(masks.get("luzon_main"), smoothed_grid, np.nan)
            palawan_temp = np.where(masks.get("palawan"), smoothed_grid, np.nan)
            bb_temp = np.where(masks.get("batanes_babuyan"), smoothed_grid, np.nan)
        elif region_key == "visayas":
            land_temp = np.where(masks.get("visayas"), smoothed_grid, np.nan)
        elif region_key == "mindanao":
            land_temp = np.where(masks.get("mindanao"), smoothed_grid, np.nan)
        else:
            land_temp = smoothed_grid
    else:
        land_temp = smoothed_grid

    fig = plt.figure(figsize=(16, 9), dpi=120)
    fig.patch.set_facecolor('#0d1821')
    ax = fig.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree())
    ax.set_extent(region_info["extent"], crs=ccrs.PlateCarree())

    # Ocean & Terrain
    ax.add_feature(cfeature.OCEAN, facecolor='#162533', zorder=0)
    ax.add_feature(cfeature.LAND, facecolor='#25342a', zorder=1)

    # Temperature Contour Fill
    cf = ax.contourf(
        M_LONS, M_LATS, land_temp,
        levels=levels, cmap=cmap, norm=norm,
        extend='both', transform=ccrs.PlateCarree(), zorder=2, alpha=0.92
    )

    # Smooth contour lines
    ax.contour(
        M_LONS, M_LATS, land_temp,
        levels=levels, colors='#334155', linewidths=0.9,
        transform=ccrs.PlateCarree(), zorder=3
    )

    # Boundaries
    if geoms_dict and "all" in geoms_dict:
        ax.add_geometries(geoms_dict["all"], crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#475569', linewidth=0.8, alpha=0.85, zorder=4)
    ax.add_feature(cfeature.COASTLINE, linewidth=1.3, edgecolor='#0f172a', zorder=5)

    # ── City Point-Temperature Callout Badges ─────────────────────────────────
    extent = region_info["extent"]
    for item in region_info["cities"]:
        name, clon, clat = item[0], item[1], item[2]
        offset_x, offset_y = item[3] if len(item) > 3 else (0, 0)

        if extent[0] - 0.2 <= clon <= extent[1] + 0.2 and extent[2] - 0.2 <= clat <= extent[3] + 0.2:
            dist = (M_LONS - clon)**2 + (M_LATS - clat)**2
            min_idx = np.unravel_index(np.argmin(dist), dist.shape)
            val = land_temp[min_idx]
            if np.isnan(val):
                val = smoothed_grid[min_idx]
            
            val_str = f"{val:.0f} °C" if not np.isnan(val) else f"{default_fallback:.0f} °C"
            bbox_props = dict(boxstyle='round,pad=0.35', facecolor='#000000', edgecolor='#ffffff', alpha=0.75, lw=1.1)
            callout = f"{val_str}\n{name}"
            ax.text(
                clon + offset_x, clat + offset_y, callout,
                transform=ccrs.PlateCarree(),
                fontsize=12, fontweight='heavy',
                color='#ffffff', ha='center', va='center',
                bbox=bbox_props, zorder=10
            )

    # ── Dedicated Inset Mini-Maps on Luzon View ──────────────────────────────
    if region_key == "luzon" and geoms_dict:
        # 1. Palawan Inset (Bottom-Left)
        if "palawan" in geoms_dict:
            inset_pal_rect = [0.03, 0.05, 0.27, 0.48]
            inset_pal_bg = FancyBboxPatch((inset_pal_rect[0]-0.005, inset_pal_rect[1]-0.005), inset_pal_rect[2]+0.01, inset_pal_rect[3]+0.01,
                                          boxstyle='round,pad=0.005,rounding_size=0.012', transform=fig.transFigure,
                                          facecolor='#0b131a', edgecolor='#38bdf8', lw=1.5, zorder=30)
            fig.patches.append(inset_pal_bg)

            palawan_title_pill = FancyBboxPatch((inset_pal_rect[0] + 0.01, inset_pal_rect[1] + inset_pal_rect[3] - 0.045), 0.12, 0.035,
                                                boxstyle='round,pad=0.005,rounding_size=0.008', transform=fig.transFigure,
                                                facecolor='#0369a1', edgecolor='none', zorder=32)
            fig.patches.append(palawan_title_pill)
            fig.text(inset_pal_rect[0] + 0.07, inset_pal_rect[1] + inset_pal_rect[3] - 0.028, 'PALAWAN',
                     fontsize=11, fontweight='heavy', color='#ffffff', ha='center', va='center', zorder=33)

            ax_pal = fig.add_axes(inset_pal_rect, projection=ccrs.PlateCarree(), zorder=31)
            ax_pal.set_extent([116.6, 120.5, 8.2, 12.5], crs=ccrs.PlateCarree())
            ax_pal.add_feature(cfeature.OCEAN, facecolor='#162533', zorder=0)
            ax_pal.add_feature(cfeature.LAND, facecolor='#25342a', zorder=1)

            ax_pal.contourf(
                M_LONS, M_LATS, palawan_temp,
                levels=levels, cmap=cmap, norm=norm,
                extend='both', transform=ccrs.PlateCarree(), zorder=2, alpha=0.92
            )
            ax_pal.add_geometries(geoms_dict["palawan"], crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#475569', linewidth=0.8, alpha=0.85, zorder=3)
            ax_pal.add_feature(cfeature.COASTLINE, linewidth=1.2, edgecolor='#0f172a', zorder=4)

            for name, clon, clat, (ox, oy) in PALAWAN_CITIES:
                dist = (M_LONS - clon)**2 + (M_LATS - clat)**2
                min_idx = np.unravel_index(np.argmin(dist), dist.shape)
                val = palawan_temp[min_idx]
                if np.isnan(val):
                    val = smoothed_grid[min_idx]
                val_str = f"{val:.0f} °C" if not np.isnan(val) else f"{default_fallback:.0f} °C"

                bbox_props = dict(boxstyle='round,pad=0.3', facecolor='#000000', edgecolor='#ffffff', alpha=0.75, lw=1.0)
                callout = f"{val_str}\n{name}"
                ax_pal.text(
                    clon + ox, clat + oy, callout,
                    transform=ccrs.PlateCarree(),
                    fontsize=10.5, fontweight='heavy',
                    color='#ffffff', ha='center', va='center',
                    bbox=bbox_props, zorder=10
                )

        # 2. Batanes & Babuyan Inset (Upper-Right)
        if "batanes_babuyan" in geoms_dict:
            inset_bb_rect = [0.70, 0.36, 0.27, 0.50]
            inset_bb_bg = FancyBboxPatch((inset_bb_rect[0]-0.005, inset_bb_rect[1]-0.005), inset_bb_rect[2]+0.01, inset_bb_rect[3]+0.01,
                                         boxstyle='round,pad=0.005,rounding_size=0.012', transform=fig.transFigure,
                                         facecolor='#0b131a', edgecolor='#38bdf8', lw=1.5, zorder=30)
            fig.patches.append(inset_bb_bg)

            bb_title_pill = FancyBboxPatch((inset_bb_rect[0] + 0.01, inset_bb_rect[1] + inset_bb_rect[3] - 0.045), 0.22, 0.035,
                                           boxstyle='round,pad=0.005,rounding_size=0.008', transform=fig.transFigure,
                                           facecolor='#0369a1', edgecolor='none', zorder=32)
            fig.patches.append(bb_title_pill)
            fig.text(inset_bb_rect[0] + 0.12, inset_bb_rect[1] + inset_bb_rect[3] - 0.028, 'BATANES & BABUYAN',
                     fontsize=10.5, fontweight='heavy', color='#ffffff', ha='center', va='center', zorder=33)

            ax_bb = fig.add_axes(inset_bb_rect, projection=ccrs.PlateCarree(), zorder=31)
            ax_bb.set_extent([120.9, 122.6, 18.7, 21.2], crs=ccrs.PlateCarree())
            ax_bb.add_feature(cfeature.OCEAN, facecolor='#162533', zorder=0)
            ax_bb.add_feature(cfeature.LAND, facecolor='#25342a', zorder=1)

            ax_bb.contourf(
                M_LONS, M_LATS, bb_temp,
                levels=levels, cmap=cmap, norm=norm,
                extend='both', transform=ccrs.PlateCarree(), zorder=2, alpha=0.92
            )
            ax_bb.add_geometries(geoms_dict["batanes_babuyan"], crs=ccrs.PlateCarree(), facecolor='none', edgecolor='#475569', linewidth=0.8, alpha=0.85, zorder=3)
            ax_bb.add_feature(cfeature.COASTLINE, linewidth=1.2, edgecolor='#0f172a', zorder=4)

            for name, clon, clat, (ox, oy) in BATANES_BABUYAN_CITIES:
                dist = (M_LONS - clon)**2 + (M_LATS - clat)**2
                min_idx = np.unravel_index(np.argmin(dist), dist.shape)
                val = bb_temp[min_idx]
                if np.isnan(val):
                    val = smoothed_grid[min_idx]
                val_str = f"{val:.0f} °C" if not np.isnan(val) else f"{default_fallback:.0f} °C"

                bbox_props = dict(boxstyle='round,pad=0.3', facecolor='#000000', edgecolor='#ffffff', alpha=0.75, lw=1.0)
                callout = f"{val_str}\n{name}"
                ax_bb.text(
                    clon + ox, clat + oy, callout,
                    transform=ccrs.PlateCarree(),
                    fontsize=10.5, fontweight='heavy',
                    color='#ffffff', ha='center', va='center',
                    bbox=bbox_props, zorder=10
                )

    # ── Top CPC Style Header Banner ──────────────────────────────────────────
    header_bg = patches.Rectangle((0, 0.88), 1, 0.12, transform=fig.transFigure, facecolor='#0b131a', alpha=0.95, zorder=40)
    fig.patches.append(header_bg)

    ph_tz = timezone(timedelta(hours=8))
    init_dt_ph = init_dt.astimezone(ph_tz) if init_dt else datetime.now(ph_tz)

    if metric == "max":
        metric_title = "MAXIMUM TEMPERATURE FORECAST"
        if period == "today":
            sub_text = "TODAY'S FORECAST HIGH"
            date_badge_text = init_dt_ph.strftime("%b %d")
        else:
            tomorrow_dt = init_dt_ph + timedelta(days=1)
            sub_text = "TOMORROW'S FORECAST HIGH"
            date_badge_text = tomorrow_dt.strftime("%b %d")
    else:
        metric_title = "MINIMUM TEMPERATURE FORECAST"
        if period == "today":
            sub_text = "TONIGHT / EARLY MORNING FORECAST LOW"
            date_badge_text = init_dt_ph.strftime("%b %d")
        else:
            tomorrow_dt = init_dt_ph + timedelta(days=1)
            sub_text = "TOMORROW NIGHT FORECAST LOW"
            date_badge_text = tomorrow_dt.strftime("%b %d")

    header_title = f'{metric_title} · {region_info["title"]}'

    # Main CPC Title Card
    cpc_box = FancyBboxPatch((0.12, 0.895), 0.48, 0.09, boxstyle='round,pad=0.008,rounding_size=0.012',
                             transform=fig.transFigure, facecolor='#111827', edgecolor='#3b82f6', lw=1.2, zorder=41)
    fig.patches.append(cpc_box)

    fig.text(0.135, 0.955, header_title, fontsize=13.5, fontweight='heavy', color='#ffffff', ha='left', va='center', zorder=42)
    fig.text(0.135, 0.923, sub_text, fontsize=9.0, fontweight='bold', color='#94a3b8', ha='left', va='center', zorder=42)

    # Date badge on the right of the CPC card
    date_pill = FancyBboxPatch((0.50, 0.915), 0.09, 0.05, boxstyle='round,pad=0.005,rounding_size=0.008',
                               transform=fig.transFigure, facecolor='#1e293b', edgecolor='#64748b', lw=1.0, zorder=42)
    fig.patches.append(date_pill)
    fig.text(0.545, 0.94, date_badge_text, fontsize=11.5, fontweight='heavy', color='#f8fafc', ha='center', va='center', zorder=43)

    # ── Attached Colorbar Ribbon ─────────────────────────────────────────────
    cbar_ax = fig.add_axes([0.62, 0.925, 0.35, 0.034], zorder=42)
    cb = fig.colorbar(cf, cax=cbar_ax, orientation='horizontal')
    cb.set_ticks(levels)
    cb.set_ticklabels(tick_labels)
    cb.ax.tick_params(labelsize=9.5, colors='#ffffff', length=0)
    cb.outline.set_edgecolor('#ffffff')
    cb.outline.set_linewidth(1.0)

    fig.text(0.665, 0.895, cbar_labels[0], fontsize=8.5, fontweight='heavy', color=cbar_colors[0], ha='center', zorder=42)
    fig.text(0.795, 0.895, cbar_labels[1], fontsize=8.5, fontweight='heavy', color=cbar_colors[1], ha='center', zorder=42)
    fig.text(0.925, 0.895, cbar_labels[2], fontsize=8.5, fontweight='heavy', color=cbar_colors[2], ha='center', zorder=42)

    # ── User Brand Logo ──────────────────────────────────────────────────────
    found_logo = next((p for p in LOGO_PATHS if os.path.exists(p)), None)
    if found_logo:
        try:
            logo_img = mpimg.imread(found_logo)
            logo_ax = fig.add_axes([0.02, 0.888, 0.08, 0.10], zorder=45)
            logo_ax.imshow(logo_img)
            logo_ax.axis('off')
        except Exception as e:
            print(f"Notice loading logo: {e}")
            fig.text(0.052, 0.936, 'PHIL\nWX', fontsize=12, fontweight='heavy', color='#38bdf8', ha='center', va='center', zorder=42)
    else:
        fig.text(0.052, 0.936, 'PHIL\nWX', fontsize=12, fontweight='heavy', color='#38bdf8', ha='center', va='center', zorder=42)

    out_path = os.path.join(OUTPUT_DIR, f"{filename_id}.png")
    plt.savefig(out_path, dpi=120, bbox_inches="tight", facecolor="#0d1821")
    plt.close()
    print(f"  Successfully saved {out_path}")


# ═══════════════════════════════════════════════════════════════════════════
# Main Pipeline
# ═══════════════════════════════════════════════════════════════════════════
def main():
    print("=== AI Multi-Model Temperature Forecast (Maximum & Minimum) ===")
    
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})
    aifs_client = Client(source="azure", model="aifs-single", resol="0p25")
    
    aigfs_url, init_dt, _, aigfs_cycle = get_latest_aigfs_run(session)
    if not init_dt:
        init_dt = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        aigfs_cycle = "18"
        
    wn2_ds = load_weathernext_dataset()
    if wn2_ds is not None:
        wn_lats = wn2_ds.lat.values
        wn_lons = wn2_ds.lon.values
        WN_LONS, WN_LATS = np.meshgrid(wn_lons, wn_lats)
    
    geoms_dict, masks = load_ph_regional_geometries()
    valid_frames = []

    # Compute exact peak heating (max) and early morning low (min) forecast steps
    today_max_step, today_min_step = get_diurnal_steps(aigfs_cycle, day_offset=0)
    tmrw_max_step, tmrw_min_step = get_diurnal_steps(aigfs_cycle, day_offset=1)

    print(f"Diurnal Cycle Timing for {aigfs_cycle}Z Run:")
    print(f"  Today Max step: {today_max_step}h | Today Min step: {today_min_step}h")
    print(f"  Tomorrow Max step: {tmrw_max_step}h | Tomorrow Min step: {tmrw_min_step}h")

    # ═══════════════════════════════════════════════════════════════════════
    # 1. TODAY MAXIMUM TEMPERATURE (Daytime High)
    # ═══════════════════════════════════════════════════════════════════════
    print("\n--- Processing TODAY MAXIMUM TEMPERATURE ($T_{max}$) ---")
    wn2_max_today = np.zeros_like(M_LATS)
    if wn2_ds is not None:
        try:
            t_slice = wn2_ds['2m_temperature'].isel(time=slice(0, 5))
            m = (t_slice.max(dim='time') - 273.15).values
            if m.ndim == 3: m = m[0]
            wn2_max_today = regrid_to_master(WN_LATS, WN_LONS, m, default_val=31.0)
        except Exception as e:
            print(f"WeatherNext2 Max Today error: {e}")

    aifs_max_today = np.zeros_like(M_LATS)
    lats, lons, current_t2m = get_aifs_t2m(aifs_client, today_max_step)
    if current_t2m is not None:
        aifs_max_today = regrid_to_master(lats, lons, current_t2m, default_val=31.0)

    aigfs_max_today = np.zeros_like(M_LATS)
    if aigfs_url:
        grib_file = f"aigfs.t{aigfs_cycle}z.sfc.f{today_max_step:03d}.grib2"
        grib_url = f"{aigfs_url}{grib_file}"
        idx_url = f"{grib_url}.idx"
        tmp_path = download_aigfs_t2m(grib_url, idx_url, session)
        if tmp_path:
            lats, lons, current_t2m = read_aigfs_t2m(tmp_path)
            if current_t2m is not None:
                aigfs_max_today = regrid_to_master(lats, lons, current_t2m, default_val=31.0)
            if os.path.exists(tmp_path): os.remove(tmp_path)

    models_max_today = [m for m in [wn2_max_today, aifs_max_today, aigfs_max_today] if np.nanmax(m) > 0]
    consensus_max_today = np.mean(models_max_today, axis=0) if models_max_today else np.full_like(M_LATS, 31.0)

    for reg_key in ["luzon", "visayas", "mindanao"]:
        frame_id = f"ai_temp_max_today_{reg_key}"
        plot_temperature_map(consensus_max_today, frame_id, init_dt, reg_key, metric="max", period="today", geoms_dict=geoms_dict, masks=masks)
        valid_frames.append(frame_id)

    # ═══════════════════════════════════════════════════════════════════════
    # 2. TODAY MINIMUM TEMPERATURE (Night / Early Morning Low)
    # ═══════════════════════════════════════════════════════════════════════
    print("\n--- Processing TODAY MINIMUM TEMPERATURE ($T_{min}$) ---")
    wn2_min_today = np.zeros_like(M_LATS)
    if wn2_ds is not None:
        try:
            t_slice = wn2_ds['2m_temperature'].isel(time=slice(0, 5))
            m = (t_slice.min(dim='time') - 273.15).values
            if m.ndim == 3: m = m[0]
            wn2_min_today = regrid_to_master(WN_LATS, WN_LONS, m, default_val=24.0)
        except Exception as e:
            print(f"WeatherNext2 Min Today error: {e}")

    aifs_min_today = np.zeros_like(M_LATS)
    lats, lons, current_t2m = get_aifs_t2m(aifs_client, today_min_step)
    if current_t2m is not None:
        aifs_min_today = regrid_to_master(lats, lons, current_t2m, default_val=24.0)

    aigfs_min_today = np.zeros_like(M_LATS)
    if aigfs_url:
        grib_file = f"aigfs.t{aigfs_cycle}z.sfc.f{today_min_step:03d}.grib2"
        grib_url = f"{aigfs_url}{grib_file}"
        idx_url = f"{grib_url}.idx"
        tmp_path = download_aigfs_t2m(grib_url, idx_url, session)
        if tmp_path:
            lats, lons, current_t2m = read_aigfs_t2m(tmp_path)
            if current_t2m is not None:
                aigfs_min_today = regrid_to_master(lats, lons, current_t2m, default_val=24.0)
            if os.path.exists(tmp_path): os.remove(tmp_path)

    models_min_today = [m for m in [wn2_min_today, aifs_min_today, aigfs_min_today] if np.nanmax(m) > 0]
    consensus_min_today = np.mean(models_min_today, axis=0) if models_min_today else np.full_like(M_LATS, 24.0)

    for reg_key in ["luzon", "visayas", "mindanao"]:
        frame_id = f"ai_temp_min_today_{reg_key}"
        plot_temperature_map(consensus_min_today, frame_id, init_dt, reg_key, metric="min", period="today", geoms_dict=geoms_dict, masks=masks)
        valid_frames.append(frame_id)

    # ═══════════════════════════════════════════════════════════════════════
    # 3. TOMORROW MAXIMUM TEMPERATURE (Daytime High)
    # ═══════════════════════════════════════════════════════════════════════
    print("\n--- Processing TOMORROW MAXIMUM TEMPERATURE ($T_{max}$) ---")
    wn2_max_tmrw = np.zeros_like(M_LATS)
    if wn2_ds is not None:
        try:
            t_slice = wn2_ds['2m_temperature'].isel(time=slice(4, 9))
            m = (t_slice.max(dim='time') - 273.15).values
            if m.ndim == 3: m = m[0]
            wn2_max_tmrw = regrid_to_master(WN_LATS, WN_LONS, m, default_val=31.0)
        except Exception as e:
            print(f"WeatherNext2 Max Tomorrow error: {e}")

    aifs_max_tmrw = np.zeros_like(M_LATS)
    lats, lons, current_t2m = get_aifs_t2m(aifs_client, tmrw_max_step)
    if current_t2m is not None:
        aifs_max_tmrw = regrid_to_master(lats, lons, current_t2m, default_val=31.0)

    aigfs_max_tmrw = np.zeros_like(M_LATS)
    if aigfs_url:
        grib_file = f"aigfs.t{aigfs_cycle}z.sfc.f{tmrw_max_step:03d}.grib2"
        grib_url = f"{aigfs_url}{grib_file}"
        idx_url = f"{grib_url}.idx"
        tmp_path = download_aigfs_t2m(grib_url, idx_url, session)
        if tmp_path:
            lats, lons, current_t2m = read_aigfs_t2m(tmp_path)
            if current_t2m is not None:
                aigfs_max_tmrw = regrid_to_master(lats, lons, current_t2m, default_val=31.0)
            if os.path.exists(tmp_path): os.remove(tmp_path)

    models_max_tmrw = [m for m in [wn2_max_tmrw, aifs_max_tmrw, aigfs_max_tmrw] if np.nanmax(m) > 0]
    consensus_max_tmrw = np.mean(models_max_tmrw, axis=0) if models_max_tmrw else np.full_like(M_LATS, 31.0)

    for reg_key in ["luzon", "visayas", "mindanao"]:
        frame_id = f"ai_temp_max_tomorrow_{reg_key}"
        plot_temperature_map(consensus_max_tmrw, frame_id, init_dt, reg_key, metric="max", period="tomorrow", geoms_dict=geoms_dict, masks=masks)
        valid_frames.append(frame_id)

    # ═══════════════════════════════════════════════════════════════════════
    # 4. TOMORROW MINIMUM TEMPERATURE (Night / Early Morning Low)
    # ═══════════════════════════════════════════════════════════════════════
    print("\n--- Processing TOMORROW MINIMUM TEMPERATURE ($T_{min}$) ---")
    wn2_min_tmrw = np.zeros_like(M_LATS)
    if wn2_ds is not None:
        try:
            t_slice = wn2_ds['2m_temperature'].isel(time=slice(4, 9))
            m = (t_slice.min(dim='time') - 273.15).values
            if m.ndim == 3: m = m[0]
            wn2_min_tmrw = regrid_to_master(WN_LATS, WN_LONS, m, default_val=24.0)
        except Exception as e:
            print(f"WeatherNext2 Min Tomorrow error: {e}")

    aifs_min_tmrw = np.zeros_like(M_LATS)
    lats, lons, current_t2m = get_aifs_t2m(aifs_client, tmrw_min_step)
    if current_t2m is not None:
        aifs_min_tmrw = regrid_to_master(lats, lons, current_t2m, default_val=24.0)

    aigfs_min_tmrw = np.zeros_like(M_LATS)
    if aigfs_url:
        grib_file = f"aigfs.t{aigfs_cycle}z.sfc.f{tmrw_min_step:03d}.grib2"
        grib_url = f"{aigfs_url}{grib_file}"
        idx_url = f"{grib_url}.idx"
        tmp_path = download_aigfs_t2m(grib_url, idx_url, session)
        if tmp_path:
            lats, lons, current_t2m = read_aigfs_t2m(tmp_path)
            if current_t2m is not None:
                aigfs_min_tmrw = regrid_to_master(lats, lons, current_t2m, default_val=24.0)
            if os.path.exists(tmp_path): os.remove(tmp_path)

    models_min_tmrw = [m for m in [wn2_min_tmrw, aifs_min_tmrw, aigfs_min_tmrw] if np.nanmax(m) > 0]
    consensus_min_tmrw = np.mean(models_min_tmrw, axis=0) if models_min_tmrw else np.full_like(M_LATS, 24.0)

    for reg_key in ["luzon", "visayas", "mindanao"]:
        frame_id = f"ai_temp_min_tomorrow_{reg_key}"
        plot_temperature_map(consensus_min_tmrw, frame_id, init_dt, reg_key, metric="min", period="tomorrow", geoms_dict=geoms_dict, masks=masks)
        valid_frames.append(frame_id)

    # Metadata
    ph_tz = timezone(timedelta(hours=8))
    init_dt_ph = init_dt.astimezone(ph_tz) if init_dt else None
    
    meta = {
        "title": "AI Multi-Model Regional Maximum & Minimum Temperature Forecast Maps",
        "models_used": ["Google WeatherNext 2", "ECMWF AIFS", "NOAA AIGFS"],
        "generated_at": datetime.now(ph_tz).strftime("%Y-%m-%d %I:%M %p PHT"),
        "run_time": init_dt_ph.strftime("%Y-%m-%d %I:%M %p PHT") if init_dt_ph else "Unknown",
        "regions": ["luzon", "visayas", "mindanao"],
        "metrics": ["max", "min"],
        "periods": ["today", "tomorrow"],
        "animation_frames": valid_frames
    }
    with open(os.path.join(DATA_DIR, "ai_temp_outlook_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
        
    print("\nGeneration complete! All Regional Maximum & Minimum Temperature Maps created successfully.")

if __name__ == "__main__":
    main()
