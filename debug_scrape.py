
import requests
import re

def debug_scrape():
    url = "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml"
    try:
        response = requests.get(url, timeout=15)
        content = response.text
        
        print("Searching for 'ENSO Alert System Status'...")
        start_idx = content.find("ENSO Alert System Status")
        if start_idx != -1:
            print(f"Found at index {start_idx}")
            # Print a chunk of characters around the match
            snippet = content[start_idx:start_idx+200]
            print("--- Snippet Start ---")
            print(snippet)
            print("--- Snippet End ---")
        else:
            print("String not found.")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    debug_scrape()
