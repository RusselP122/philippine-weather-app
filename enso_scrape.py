
import requests
import os
import json
from datetime import datetime
import re
import html

# Output Directory
DATA_DIR = os.path.join(os.getcwd(), "src", "data")
os.makedirs(DATA_DIR, exist_ok=True)
OUTPUT_FILE = os.path.join(DATA_DIR, "enso_data.json")

def fetch_enso_data():
    # Primary source: ENSO Diagnostic Discussion page (weekly Niño-3.4 value)
    disc_url = "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }

    try:
        print(f"Fetching ENSO Discussion from {disc_url}...")
        response = requests.get(disc_url, headers=headers, timeout=15)
        response.raise_for_status()
        content = response.text

        # Extract latest weekly Niño-3.4 index value
        # Pattern matches: "The latest weekly Niño-3.4 index value was -0.9°C"
        nino_match = re.search(
            r'latest weekly Ni[ñn\u0026]o[\-\s]*3\.4 index value was\s*([\-\+]?\d+\.?\d*)\s*[°\u00b0]?\s*C',
            content, re.IGNORECASE
        )
        
        if not nino_match:
            # Try with HTML entity for ñ  
            nino_match = re.search(
                r'latest weekly Ni.*?3\.4 index value was\s*([\-\+]?\d+\.?\d*)',
                content, re.IGNORECASE | re.DOTALL
            )

        if not nino_match:
            print("Error: Could not find Niño-3.4 index value in discussion page.")
            return

        latest_val = float(nino_match.group(1))
        print(f"Extracted Niño-3.4 value: {latest_val}")
        
        # Determine phase
        phase = "Neutral"
        if latest_val >= 0.5:
            phase = "El Niño"
        elif latest_val <= -0.5:
            phase = "La Niña"
            
        # Determine Intensity
        abs_val = abs(latest_val)
        intensity = ""
        
        if phase != "Neutral":
            if abs_val >= 1.5:
                intensity = "Strong"
            elif abs_val >= 1.0:
                intensity = "Moderate"
            elif abs_val >= 0.5:
                intensity = "Weak"
        
        # Construct Display Status
        current_status = f"{intensity} {phase}".strip()

        # Fetch Advisory Text and Alert Status (from same page)
        advisory_data = fetch_advisory_data()
        
        advisory_text = advisory_data.get("synopsis")
        alert_status = advisory_data.get("alert_status")
        
        if not advisory_text:
            advisory_text = generate_fallback_advisory(phase, latest_val)

        # Generate forecast summary from the discussion content
        forecast_summary = generate_forecast_summary(content, phase, latest_val)

        # Prepare JSON Structure
        data = {
            "current_status": current_status,
            "phase": phase,
            "intensity": intensity,
            "alert_status": alert_status,
            "latest_value": latest_val,
            "trend": "Cooling" if latest_val < 0 else ("Warming" if latest_val > 0 else "Stable"),
            "advisory": advisory_text,
            "forecast_image": "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/figure07.gif",
            "forecast_summary": forecast_summary,
            "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        
        with open(OUTPUT_FILE, "w") as f:
            json.dump(data, f, indent=2)
            
        print(f"Successfully saved ENSO data to {OUTPUT_FILE}")
        print(f"Status: {current_status} | Niño-3.4 Value: {latest_val}")

    except Exception as e:
        print(f"Failed to fetch ENSO data: {e}")


def fetch_advisory_data():
    url = "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    result = {"synopsis": None, "alert_status": None}
    
    try:
        print(f"Fetching Advisory from {url}...")
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()
        content = response.text
        
        # 1. Scrape Alert Status
        # Structure: ENSO Alert System Status: ... <span style="color:blue">La Ni&ntilde;a Advisory</span>
        # Use DOTALL to match across newlines
        alert_match = re.search(r"ENSO Alert System Status:.*?(<span[^>]*>(.*?)</span>)", content, re.DOTALL | re.IGNORECASE)
        
        if alert_match:
            raw_alert = alert_match.group(2) # Group 2 is the inner text of the span
            # Clean up HTML entities
            clean_alert = raw_alert.replace("&ntilde;", "ñ").replace("&Ntilde;", "Ñ")
            clean_alert = re.sub(r'<[^>]+>', '', clean_alert).strip()
            result["alert_status"] = clean_alert
            
        # 2. Scrape Synopsis
        synopsis_match = re.search(r"Synopsis:.*?(?=<br>|<p>|\n\n)", content, re.DOTALL | re.IGNORECASE)
        if synopsis_match:
            raw_text = synopsis_match.group(0)
            clean_text = re.sub(r'<[^>]+>', '', raw_text) # Remove HTML tags
            clean_text = html.unescape(clean_text)        # Decode HTML entities (e.g. &#37; to %)
            clean_text = ' '.join(clean_text.split())     # Normalize whitespace
            result["synopsis"] = clean_text
            
    except Exception as e:
        print(f"Error fetching advisory: {e}")
        
    return result

def generate_fallback_advisory(status, value):
    base_text = ""
    if status == "El Niño":
        intensity = "Weak"
        if value >= 1.5: intensity = "Strong"
        elif value >= 1.0: intensity = "Moderate"
        base_text = f"{intensity} El Niño condition is present. Expect below-normal rainfall conditions in most parts of the country. Dry spells and droughts may occur."
    elif status == "La Niña":
        intensity = "Weak"
        if value <= -1.5: intensity = "Strong"
        elif value <= -1.0: intensity = "Moderate"
        base_text = f"{intensity} La Niña condition is present. Expect above-normal rainfall conditions. Potential for flash floods and landslides is increased."
    else:
        base_text = "ENSO-neutral conditions are present. Neither El Niño nor La Niña is currently dominant. Weather patterns are expected to be generally near average."
    return base_text

def generate_forecast_summary(discussion_html, current_phase, current_value):
    """Generate a forecast summary from the ENSO discussion page content."""
    clean_text = re.sub(r'<[^>]+>', '', discussion_html)
    clean_text = clean_text.replace("&ntilde;", "ñ").replace("&Ntilde;", "Ñ")
    clean_text = ' '.join(clean_text.split())
    
    summary_parts = []
    
    # Determine current month for context
    now = datetime.now()
    month_name = now.strftime("%B %Y")
    
    # Part 1: Current state
    abs_val = abs(current_value)
    if current_phase == "La Niña":
        summary_parts.append(
            f"La Niña conditions are currently present with the latest weekly Niño-3.4 index at {current_value}°C. "
            f"This indicates {'moderate' if abs_val >= 1.0 else 'weak'} La Niña conditions in the equatorial Pacific."
        )
    elif current_phase == "El Niño":
        summary_parts.append(
            f"El Niño conditions are currently present with the latest weekly Niño-3.4 index at +{current_value}°C. "
            f"This indicates {'strong' if abs_val >= 1.5 else 'moderate' if abs_val >= 1.0 else 'weak'} El Niño conditions."
        )
    else:
        summary_parts.append(
            f"ENSO-neutral conditions are currently present with the Niño-3.4 index at {current_value}°C."
        )
    
    # Part 2: Extract transition forecast from discussion text
    # Look for phrases about ENSO-neutral transition
    neutral_match = re.search(
        r'transition.*?ENSO.?neutral.*?expected.*?(\w+.?\w+.?\w+\s+\d{4})\s*\((\d+)%\s*chance\)',
        clean_text, re.IGNORECASE
    )
    if neutral_match:
        summary_parts.append(
            f"A transition to ENSO-neutral is expected in {neutral_match.group(1)} ({neutral_match.group(2)}% chance)."
        )
    
    # Look for El Niño emergence forecast
    elnino_match = re.search(
        r'(\d+).?(\d+)%\s*chance of El Ni[ñn]o',
        clean_text, re.IGNORECASE
    )
    if elnino_match:
        summary_parts.append(
            f"There is a {elnino_match.group(1)}-{elnino_match.group(2)}% chance of El Niño forming later in the year."
        )
    elif re.search(r'El Ni[ñn]o.*?form', clean_text, re.IGNORECASE):
        summary_parts.append(
            "Models suggest a possibility of El Niño conditions developing later in the year."
        )
    
    # Look for ENSO-neutral persistence
    persist_match = re.search(
        r'ENSO.?neutral.*?persisting.*?(\w+\s+\w+\s+\w+\s+\d{4})\s*\((\d+)%',
        clean_text, re.IGNORECASE
    )
    if persist_match:
        summary_parts.append(
            f"ENSO-neutral is likely to persist through the {persist_match.group(1)} ({persist_match.group(2)}% chance)."
        )
    
    # Part 3: Chart description
    summary_parts.append(
        "The probability chart below shows the seasonal forecast for La Niña (blue), Neutral (grey), and El Niño (red) conditions through the end of the year."
    )
    
    if not summary_parts:
        return "Forecast probability data from NOAA CPC. See the chart below for seasonal ENSO outlook."
    
    return " ".join(summary_parts)

if __name__ == "__main__":
    fetch_enso_data()
