import os
import sys
import requests
import datetime

# Attempt to load .env variables if python-dotenv is installed
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Supabase configuration
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://jzbgofsdnniflospoggl.supabase.co").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6YmdvZnNkbm5pZmxvc3BvZ2dsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM0NDQzMSwiZXhwIjoyMDk1OTIwNDMxfQ.IQ0covu3g4Oh1M4a1EMcFGi1jfu2jCmh3R88TAKcQWg")

# GarbinWx Doppler Radar Identity Header
# Request your ID header at: contact@garbinwx.org
GARBINWX_RADAR_IDENTITY = os.environ.get("GARBINWX_RADAR_IDENTITY", "PHTYW-GWxID0625403800007957")

GARBINWX_RAW_BASE = "https://data.garbinwx.org/raw"

def supabase_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }

def is_frame_archived(unix_ts):
    """Check if record already exists in Supabase radar_frames table."""
    try:
        url = f"{SUPABASE_URL}/rest/v1/radar_frames?observed_at_unix=eq.{unix_ts}&select=id"
        res = requests.get(url, headers=supabase_headers(), timeout=10)
        if res.ok:
            data = res.json()
            return len(data) > 0
    except Exception as e:
        print(f"Warning: Failed to check DB for timestamp {unix_ts}: {e}")
    return False

def upload_radar_image(storage_path, image_data):
    """Upload radar composite image to Supabase Storage Bucket."""
    upload_url = f"{SUPABASE_URL}/storage/v1/object/radar-archives/{storage_path}"
    headers = supabase_headers()
    headers["Content-Type"] = "image/png"
    headers["x-upsert"] = "true"

    res = requests.post(upload_url, headers=headers, data=image_data, timeout=30)
    public_url = f"{SUPABASE_URL}/storage/v1/object/public/radar-archives/{storage_path}"
    if res.ok or res.status_code in [200, 201, 409]:
        return public_url
    print(f"Upload failed ({res.status_code}): {res.text}")
    return None

def save_frame_metadata(observed_at_str, unix_ts, public_url):
    """Save frame record into Supabase radar_frames table."""
    insert_url = f"{SUPABASE_URL}/rest/v1/radar_frames"
    headers = supabase_headers()
    headers["Content-Type"] = "application/json"
    headers["Prefer"] = "return=representation"

    payload = {
        "observed_at": f"{observed_at_str}+08:00",
        "observed_at_unix": unix_ts,
        "public_url": public_url
    }
    res = requests.post(insert_url, headers=headers, json=payload, timeout=10)
    return res.ok

def get_recent_utc8_timestamps(hours_back=3, interval_minutes=10):
    """Generate candidate UTC+8 timestamps (YYYYMMDDHHmm) rounded to interval_minutes."""
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    utc8_tz = datetime.timezone(datetime.timedelta(hours=8))
    now_utc8 = now_utc.astimezone(utc8_tz)

    minute_rounded = (now_utc8.minute // interval_minutes) * interval_minutes
    base_dt = now_utc8.replace(minute=minute_rounded, second=0, microsecond=0)

    timestamps = []
    total_intervals = int((hours_back * 60) / interval_minutes)
    for i in range(total_intervals):
        dt = base_dt - datetime.timedelta(minutes=i * interval_minutes)
        ts_str = dt.strftime("%Y%m%d%H%M")
        unix_ts = int(dt.timestamp())
        formatted_str = dt.strftime("%Y-%m-%d %H:%M:%S")
        timestamps.append((ts_str, unix_ts, formatted_str))

    return timestamps

def archive_frame(timestamp_str, unix_ts, formatted_str, radar_type="DBZ"):
    url = f"{GARBINWX_RAW_BASE}/{radar_type}-{timestamp_str}.png"
    headers = {
        "User-Agent": GARBINWX_RADAR_IDENTITY,
        "X-Garbin-ID": GARBINWX_RADAR_IDENTITY,
        "X-Identification-Key": GARBINWX_RADAR_IDENTITY,
        "X-API-Key": GARBINWX_RADAR_IDENTITY,
        "Referer": "https://garbinwx.org/",
        "Origin": "https://garbinwx.org"
    }

    try:
        res = requests.get(url, headers=headers, stream=True, timeout=8)
        if res.status_code == 403:
            print(f"[{timestamp_str}] HTTP 403 Forbidden: Identity header required to access GarbinWx radar.", flush=True)
            return "FORBIDDEN"
        if res.status_code != 200:
            return False

        content = res.content
        if len(content) < 200:
            return False

        date_folder = formatted_str.split(" ")[0]
        storage_path = f"{date_folder}/{unix_ts}.png"

        public_url = upload_radar_image(storage_path, content)
        if not public_url:
            return False

        if save_frame_metadata(formatted_str, unix_ts, public_url):
            print(f"[{formatted_str}] Successfully archived GarbinWx {radar_type} frame: {public_url}", flush=True)
            return True
    except Exception as e:
        print(f"Error archiving {timestamp_str}: {e}", flush=True)
    return False

def archive_radar():
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now_str}] Starting GarbinWx Doppler Radar Archiving Process...", flush=True)
    print(f"Identity Header Configured: {'YES' if GARBINWX_RADAR_IDENTITY != 'IDENTITY-HERE' else 'NO (Set GARBINWX_RADAR_IDENTITY in .env)'}", flush=True)

    if GARBINWX_RADAR_IDENTITY == "IDENTITY-HERE":
        print("\n[NOTE] GarbinWx requires an identification header to access the Doppler radar endpoint.", flush=True)
        print("Please contact GarbinWx at contact@garbinwx.org to get your ID header, then add it to your .env file:", flush=True)
        print("GARBINWX_RADAR_IDENTITY=<your-identity-header>\n", flush=True)

    # Specific timestamp CLI argument: e.g. python archive_radar.py 202609051610
    if len(sys.argv) > 1 and len(sys.argv[1]) == 12 and sys.argv[1].isdigit():
        ts_arg = sys.argv[1]
        dt = datetime.datetime.strptime(ts_arg, "%Y%m%d%H%M").replace(tzinfo=datetime.timezone(datetime.timedelta(hours=8)))
        archive_frame(ts_arg, int(dt.timestamp()), dt.strftime("%Y-%m-%d %H:%M:%S"))
        return

    candidates_10 = get_recent_utc8_timestamps(hours_back=3, interval_minutes=10)
    candidates_15 = get_recent_utc8_timestamps(hours_back=3, interval_minutes=15)
    candidates_20 = get_recent_utc8_timestamps(hours_back=3, interval_minutes=20)
    candidates = sorted(list({c[0]: c for c in candidates_10 + candidates_15 + candidates_20}.values()), key=lambda x: x[1])

    archived_count = 0
    for ts_str, unix_ts, formatted_str in candidates:
        if is_frame_archived(unix_ts):
            continue

        result = archive_frame(ts_str, unix_ts, formatted_str, radar_type="DBZ")
        if result == "FORBIDDEN":
            break
        elif result:
            archived_count += 1

    print(f"Archiving complete. {archived_count} new frame(s) archived.", flush=True)

if __name__ == "__main__":
    archive_radar()
