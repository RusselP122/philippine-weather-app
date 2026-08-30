import os
import re
import requests
import datetime
import hmac
import hashlib
import time
import secrets
from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://jzbgofsdnniflospoggl.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6YmdvZnNkbm5pZmxvc3BvZ2dsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM0NDQzMSwiZXhwIjoyMDk1OTIwNDMxfQ.IQ0covu3g4Oh1M4a1EMcFGi1jfu2jCmh3R88TAKcQWg")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing Supabase URL or Service Role Key in environment variables.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def get_signed_headers(session, api_sig_secret, csrf_token, pathname):
    ts = str(int(time.time()))
    nonce = secrets.token_hex(16)
    string_to_sign = f"GET\n{pathname}\n{ts}\n{nonce}".encode("utf-8")
    sig = hmac.new(api_sig_secret.encode("utf-8"), string_to_sign, hashlib.sha256).hexdigest()

    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://panahon.gov.ph/",
        "Origin": "https://panahon.gov.ph",
        "X-CSRF-TOKEN": csrf_token,
        "X-Ts": ts,
        "X-Nonce": nonce,
        "X-Sig": sig,
    }

def archive_radar():
    print(f"[{datetime.datetime.now()}] Starting Radar Archiving Process...")
    
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    })

    try:
        # 1. Fetch gateway page to extract session cookies and security tokens
        home = session.get("https://panahon.gov.ph/", timeout=15)
        csrf_match = re.search(r'<meta name="csrf-token" content="([^"]+)"', home.text)
        api_sig_match = re.search(r'<meta name="api-sig" content="([^"]+)"', home.text)

        csrf_token = csrf_match.group(1) if csrf_match else None
        api_sig_secret = api_sig_match.group(1) if api_sig_match else None

        if not csrf_token or not api_sig_secret:
            print("Failed to extract security tokens from PANaHON gateway.")
            return

        # 2. Fetch active timeline with dynamic HMAC signing
        timeline_path = "api/v1/radar/timeline"
        timeline_url = f"https://panahon.gov.ph/api/v1/radar/timeline?token={csrf_token}&sublayer=mosaic-reflectivity"
        response = session.get(timeline_url, headers=get_signed_headers(session, api_sig_secret, csrf_token, timeline_path), timeout=15)
        response.raise_for_status()
        data = response.json()
        
        if not data.get("success") or "timeline" not in data.get("data", {}):
            print("Failed to retrieve a valid timeline from PAGASA.")
            return
            
        timeline = data["data"]["timeline"]
        tile_version = data.get("data", {}).get("tile_version", 4)
    except Exception as e:
        print(f"Error fetching PAGASA timeline: {e}")
        return

    # 3. Process frames chronologically
    for frame in timeline:
        observed_at_str = frame["observed_at"]  # e.g., "2026-08-30 17:00:00"
        observed_at_unix = frame["observed_at_unix"]

        # Check if record already exists in database
        try:
            existing = supabase.table("radar_frames").select("id").eq("observed_at_unix", observed_at_unix).execute()
            if len(existing.data) > 0:
                continue
        except Exception as e:
            print(f"Error checking existing records for {observed_at_str}: {e}")
            continue

        print(f"New Frame Detected: {observed_at_str} (Unix: {observed_at_unix}). Archiving...")

        # 4. Download 2K Ultra-High-Definition PNG radar image
        img_path = "api/v1/radar-data-image"
        img_url = f"https://panahon.gov.ph/api/v1/radar-data-image?token={csrf_token}&t={observed_at_unix}&mode=dbz&size=2048&v={tile_version}"
        try:
            img_res = session.get(img_url, headers=get_signed_headers(session, api_sig_secret, csrf_token, img_path), timeout=20)
            img_res.raise_for_status()
            img_data = img_res.content
        except Exception as e:
            print(f"Failed to download image for {observed_at_str}: {e}")
            continue

        # 5. Upload image to Supabase Storage Bucket
        date_folder = observed_at_str.split(" ")[0]
        storage_path = f"{date_folder}/{observed_at_unix}.png"
        
        try:
            supabase.storage.from_("radar-archives").upload(
                path=storage_path,
                file=img_data,
                file_options={"content-type": "image/png"}
            )
            public_url = supabase.storage.from_("radar-archives").get_public_url(storage_path)
        except Exception as e:
            err_msg = str(e)
            if "409" in err_msg or "Duplicate" in err_msg or "already exists" in err_msg:
                print(f"File already exists in storage: {storage_path}. Proceeding to database registration...")
                public_url = supabase.storage.from_("radar-archives").get_public_url(storage_path)
            else:
                print(f"Failed to upload image to Supabase Storage: {e}")
                continue

        # 6. Insert record into database with timezone offset explicitly set
        try:
            supabase.table("radar_frames").insert({
                "observed_at": observed_at_str + "+08:00",
                "observed_at_unix": observed_at_unix,
                "public_url": public_url
            }).execute()
            print(f"Successfully archived: {observed_at_str}")
        except Exception as e:
            print(f"Failed to save metadata to Database: {e}")

if __name__ == "__main__":
    archive_radar()
