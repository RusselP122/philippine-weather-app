
import requests

def check_cpc():
    url = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        print("Success fetching CPC data!")
        lines = response.text.splitlines()
        print("Last 5 lines:")
        for line in lines[-5:]:
            print(line)
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_cpc()
