import os
import base64
import requests
import json
from datetime import datetime, timedelta, timezone

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "data")
XOR_KEY = 0xAA

def obfuscate_content(content_bytes):
    # XOR and base64
    xored = bytearray([b ^ XOR_KEY for b in content_bytes])
    b64 = base64.b64encode(xored).decode('utf-8')
    return b64

def get_latest_valid_run():
    base = (
        "https://deepmind.google.com/science/weatherlab/download/"
        "cyclones/FNV3P2/ensemble/cyclogenesis/csv"
    )
    today = datetime.now(timezone.utc).date()
    dates = [today, today - timedelta(days=1), today - timedelta(days=2)]
    hours_desc = ["18", "12", "06", "00"]

    for d in dates:
        for h in hours_desc:
            url = f"{base}/FNV3P2_{d.strftime('%Y_%m_%d')}T{h}_00_cyclogenesis.csv"
            try:
                resp = requests.head(url, allow_redirects=True, timeout=10)
                if resp.status_code == 200:
                    dt = datetime.strptime(f"{d.strftime('%Y-%m-%d')} {h}:00", "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
                    print(f"Latest valid model run identified: {dt.isoformat()}")
                    return dt
            except requests.RequestException:
                continue
    raise RuntimeError("No available FNV3P2 runs found in the last 3 days.")

def download_and_obfuscate(url, output_filename):
    out_path = os.path.join(DATA_DIR, output_filename)
    try:
        resp = requests.get(url, timeout=15)
        if resp.status_code == 200:
            obfuscated = obfuscate_content(resp.content)
            with open(out_path, 'w', encoding='utf-8') as f:
                f.write(obfuscated)
            print(f"Downloaded and obfuscated: {output_filename} ({len(resp.content)} bytes)")
            return True
        else:
            print(f"File not found (HTTP {resp.status_code}): {url}")
            return False
    except Exception as e:
        print(f"Error downloading {url}: {e}")
        return False

def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    
    # 1. Get latest valid cycle datetime
    try:
        latest_dt = get_latest_run_url_datetime = get_latest_valid_run()
    except Exception as e:
        print(f"Error finding latest valid run: {e}")
        return

    # Calculate 5 cycles: latest, latest - 6h, latest - 12h, latest - 18h, latest - 24h
    cycles = [latest_dt - timedelta(hours=i*6) for i in range(5)]
    
    manifest = {
        "base": [],
        "large": []
    }
    
    # Base and Large URLs
    BASE_TRACKS_URL = "https://deepmind.google.com/science/weatherlab/download/cyclones/FNV3P2/ensemble/cyclogenesis/csv"
    BASE_PAIRED_URL = "https://deepmind.google.com/science/weatherlab/download/cyclones/FNV3P2/ensemble_mean/paired/csv"
    
    LARGE_TRACKS_URL = "https://deepmind.google.com/science/weatherlab/download/cyclones/FNV3_LARGE_ENSEMBLE/ensemble/cyclogenesis/csv"
    LARGE_PAIRED_URL = "https://deepmind.google.com/science/weatherlab/download/cyclones/FNV3_LARGE_ENSEMBLE/ensemble_mean/paired/csv"

    for dt in cycles:
        date_str = dt.strftime("%Y_%m_%d")
        hour_str = dt.strftime("%H")
        cycle_key = f"{dt.strftime('%Y-%m-%d')} {hour_str}:00"
        
        # 1. Base Tracks
        base_tracks_fn = f"fnv3p2_{date_str}T{hour_str}_00.dat"
        base_tracks_url = f"{BASE_TRACKS_URL}/FNV3P2_{date_str}T{hour_str}_00_cyclogenesis.csv"
        
        # 2. Base Paired
        base_paired_fn = f"fnv3p2_paired_{date_str}T{hour_str}_00.dat"
        base_paired_url = f"{BASE_PAIRED_URL}/FNV3P2_{date_str}T{hour_str}_00_paired.csv"
        
        # Download Base
        print(f"Processing Base Cycle {cycle_key}...")
        success_tracks = download_and_obfuscate(base_tracks_url, base_tracks_fn)
        if success_tracks:
            manifest["base"].append({
                "cycle": cycle_key,
                "tracks": base_tracks_fn,
                "paired": base_paired_fn if download_and_obfuscate(base_paired_url, base_paired_fn) else None
            })
            
        # 3. Large Tracks
        large_tracks_fn = f"fnv3_large_{date_str}T{hour_str}_00.dat"
        large_tracks_url = f"{LARGE_TRACKS_URL}/FNV3_LARGE_ENSEMBLE_{date_str}T{hour_str}_00_cyclogenesis.csv"
        
        # 4. Large Paired
        large_paired_fn = f"fnv3_large_paired_{date_str}T{hour_str}_00.dat"
        large_paired_url = f"{LARGE_PAIRED_URL}/FNV3_LARGE_ENSEMBLE_{date_str}T{hour_str}_00_paired.csv"
        
        # Download Large
        print(f"Processing Large Cycle {cycle_key}...")
        success_large = download_and_obfuscate(large_tracks_url, large_tracks_fn)
        if success_large:
            manifest["large"].append({
                "cycle": cycle_key,
                "tracks": large_tracks_fn,
                "paired": large_paired_fn if download_and_obfuscate(large_paired_url, large_paired_fn) else None
            })

        # If this is the latest cycle, also update the _latest.dat files
        if dt == cycles[0]:
            import shutil
            if success_tracks:
                shutil.copy(os.path.join(DATA_DIR, base_tracks_fn), os.path.join(DATA_DIR, "fnv3p2_latest.dat"))
                base_paired_path = os.path.join(DATA_DIR, base_paired_fn)
                if os.path.exists(base_paired_path):
                    shutil.copy(base_paired_path, os.path.join(DATA_DIR, "fnv3p2_paired_latest.dat"))
                    print("Updated base latest files.")
            if success_large:
                shutil.copy(os.path.join(DATA_DIR, large_tracks_fn), os.path.join(DATA_DIR, "fnv3_large_latest.dat"))
                large_paired_path = os.path.join(DATA_DIR, large_paired_fn)
                if os.path.exists(large_paired_path):
                    shutil.copy(large_paired_path, os.path.join(DATA_DIR, "fnv3_large_paired_latest.dat"))
                    print("Updated large latest files.")

    # Write cycles_manifest.json
    manifest_path = os.path.join(DATA_DIR, "cycles_manifest.json")
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
    print(f"Successfully generated cycles manifest: {manifest_path}")

    # Clean up old DAT files that are no longer active to keep the repository clean
    active_files = set(["cycles_manifest.json"])
    for key in ["base", "large"]:
        for item in manifest[key]:
            if item.get("tracks"):
                active_files.add(item["tracks"])
            if item.get("paired"):
                active_files.add(item["paired"])

    print("Cleaning up obsolete multi-cycle files...")
    for f in os.listdir(DATA_DIR):
        if f.startswith("fnv3_") and f.endswith(".dat"):
            if f.endswith("_latest.dat"):
                continue
            if f not in active_files:
                file_path = os.path.join(DATA_DIR, f)
                try:
                    os.remove(file_path)
                    print(f"Deleted obsolete file: {f}")
                except Exception as e:
                    print(f"Error deleting {f}: {e}")

if __name__ == "__main__":
    main()
