from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
import json
import time
import pytz
from datetime import datetime

def scrape_phivolcs_data():
    # Target the dashboard directly since it contains the data
    url = "https://vmepd.phivolcs.dost.gov.ph/"
    
    # Setup Chrome options
    options = webdriver.ChromeOptions()
    options.add_argument("--headless")  # Run in headless mode (no GUI)
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--window-size=1920,1080")
    # Mimic a real user agent
    options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")

    print("Initializing Chrome driver...")
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

    try:
        print(f"Navigating to {url}...")
        driver.get(url)

        # Wait for "LAVA-DOME" or "MAYON" to ensure page loaded
        print("Waiting for page load...")
        WebDriverWait(driver, 30).until(
            lambda d: "MAYON" in d.find_element(By.TAG_NAME, "body").text
        )

        # Wait to ensure full data load (User requested 1-2 mins)
        time.sleep(60)
        
        # Get the text from the body
        body_text = driver.find_element(By.TAG_NAME, "body").text
        
        # Try to extract data using Regex
        import re
        # Pattern: look for a number followed optionally by whitespace and then VOLCANO name
        volcanoes = {}
        
        # Regex to match: Digits, newline, Name VOLCANO
        matches = re.findall(r'(\d+)\s+([A-Z-]+ VOLCANO)', body_text)
        
        if matches:
            for count, name in matches:
                volcanoes[name] = int(count)
            
            # Map to the keys user might expect
            mapping = {
                "MAYON VOLCANO": "mvo",
                "BULUSAN VOLCANO": "bvo",
                "KANLAON VOLCANO": "kvo",
                "TAAL VOLCANO": "tvo",
                "HIBOK-HIBOK VOLCANO": "hvo",
                "PINATUBO VOLCANO": "pvo"
            }
            
            structured_data = {}
            for name, count in volcanoes.items():
                key = mapping.get(name, name)
                structured_data[key] = str(count)

            # Load existing data or initialize structure
            import os
            from datetime import datetime
            import pytz

            output_dir = "public/data"
            os.makedirs(output_dir, exist_ok=True)
            output_file = os.path.join(output_dir, "volcano_data.json")

            current_data = {
                "metadata": {
                    "api_source": "Philippine Typhoon/Weather",
                    "data_source": "Philippine Institute of Volcanology and Seismology",
                    "last_updated": "",
                    "developer_note": "Made by a Filipino, For the Filipino, and For the World. This API is free for non-commercial use, is not affiliated with any government entities, and is solely operated independently by Philippine Typhoon/Weather. We extend our sincere gratitude to all our generous supporters. Proxy or replicate this data before using it in your application to prevent undue stress on our existing infrastructure."
                },
                "records": []
            }

            if os.path.exists(output_file):
                try:
                    with open(output_file, "r") as f:
                        existing = json.load(f)
                        if "metadata" in existing and "records" in existing:
                            current_data = existing
                except json.JSONDecodeError:
                    print("Warning: Existing JSON corrupted, starting fresh.")

            # Backfill logic: Ensure all existing records have 'total_Volcanic_earthquakes'
            for record in current_data["records"]:
                if "total_Volcanic_earthquakes" not in record and "data" in record:
                    parts = []
                    # Ensure consistent order or just iterate
                    for code, count in record["data"].items():
                         parts.append(f"{code}: {count}")
                    record["total_Volcanic_earthquakes"] = ", ".join(parts)

            # Get current time in PHT
            pht = pytz.timezone('Asia/Manila')
            now_pht = datetime.now(pht)
            timestamp_str = now_pht.isoformat()
            date_str = now_pht.strftime("%Y-%m-%d")
            
            # Update Metadata
            current_data["metadata"]["last_updated"] = timestamp_str
            
            # Create summary string for metadata
            summary_parts = []
            for code, count in structured_data.items():
                summary_parts.append(f"{code}: {count}")
            current_data["metadata"]["total_Volcanic_earthquakes"] = ", ".join(summary_parts)

            # Append new record
            new_record = {
                "timestamp": timestamp_str,
                "date": date_str,
                "data": structured_data,
                "total_Volcanic_earthquakes":  ", ".join([f"{k}: {v}" for k, v in structured_data.items()])
            }
            current_data["records"].append(new_record)

            # Save back to file
            print(json.dumps(current_data, indent=4))
            
            with open(output_file, "w") as f:
                json.dump(current_data, f, indent=4)
            print(f"Data appended to {output_file}")
            
            return structured_data
        else:
            print("Error: Could not find volcano data pattern in text.")
            return None

    except Exception as e:
        print(f"An error occurred: {e}")
        return None
    finally:
        print("\nClosing driver...")
        driver.quit()

if __name__ == "__main__":
    scrape_phivolcs_data()
