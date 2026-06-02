import os
import re
import requests
import datetime
from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://jzbgofsdnniflospoggl.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6YmdvZnNkbm5pZmxvc3BvZ2dsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM0NDQzMSwiZXhwIjoyMDk1OTIwNDMxfQ.IQ0covu3g4Oh1M4a1EMcFGi1jfu2jCmh3R88TAKcQWg")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing Supabase URL or Service Role Key in environment variables.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

PAGASA_TIMELINE_URL = "https://www.panahon.gov.ph/api/v1/radar/timeline?token=vYopE7FszD6VmZ71qnG0GAh0dc4Qtv8G2Wp7eJ4k&sublayer=hybrid-reflectivity"
PAGASA_IMAGE_BASE = "https://panahon.gov.ph/api/v1/radar-image?token=vYopE7FszD6VmZ71qnG0GAh0dc4Qtv8G2Wp7eJ4k&sublayer=hybrid-reflectivity"

def archive_radar():
    print(f"[{datetime.datetime.now()}] Starting Radar Archiving Process...")
    
    # Fetch active timeline from PAGASA 
    try:
        response = requests.get(PAGASA_TIMELINE_URL, timeout=15)
        response.raise_for_status()
        data = response.json()
        if not data.get("success") or "timeline" not in data.get("data", {}):
            print("Failed to retrieve a valid timeline from PAGASA.")
            return
        timeline = data["data"]["timeline"]
    except Exception as e:
        print(f"Error fetching PAGASA timeline: {e}")
        return

    # Process frames chronologically
    for frame in timeline:
        observed_at_str = frame["observed_at"]  # e.g., "2026-06-02 08:00:00"
        observed_at_unix = frame["observed_at_unix"]
        image_url = frame["image_url"]

        # Parse index from image url (e.g. &id=5)
        id_match = re.search(r"[&?]id=(\d+)", image_url)
        if not id_match:
            continue
        pagasa_index = id_match.group(1)

        # Check if record already exists in database
        try:
            existing = supabase.table("radar_frames").select("id").eq("observed_at_unix", observed_at_unix).execute()
            if len(existing.data) > 0:
                # Frame already archived, skip
                continue
        except Exception as e:
            print(f"Error checking existing records for {observed_at_str}: {e}")
            continue

        print(f"New Frame Detected: {observed_at_str} (Unix: {observed_at_unix}). Archiving...")

        # Download PNG image
        img_download_url = f"{PAGASA_IMAGE_BASE}&index={pagasa_index}"
        try:
            img_res = requests.get(img_download_url, timeout=20)
            img_res.raise_for_status()
            img_data = img_res.content
        except Exception as e:
            print(f"Failed to download image for {observed_at_str}: {e}")
            continue

        # Upload image to Supabase Storage Bucket
        # Path structure: date/observed_at_unix.png (e.g., 2026-06-02/1780358400.png)
        date_folder = observed_at_str.split(" ")[0]
        storage_path = f"{date_folder}/{observed_at_unix}.png"
        
        try:
            # Upload the raw binary image data
            supabase.storage.from_("radar-archives").upload(
                path=storage_path,
                file=img_data,
                file_options={"content-type": "image/png"}
            )
            # Retrieve the public URL of the uploaded image
            public_url = supabase.storage.from_("radar-archives").get_public_url(storage_path)
        except Exception as e:
            print(f"Failed to upload image to Supabase Storage: {e}")
            continue

        # Insert record into database with timezone offset explicitly set
        try:
            supabase.table("radar_frames").insert({
                "observed_at": observed_at_str + "+08:00", # Explicitly mark as PHT (UTC+8)
                "observed_at_unix": observed_at_unix,
                "public_url": public_url
            }).execute()
            print(f"Successfully archived: {observed_at_str}")
        except Exception as e:
            print(f"Failed to save metadata to Database: {e}")

if __name__ == "__main__":
    archive_radar()
