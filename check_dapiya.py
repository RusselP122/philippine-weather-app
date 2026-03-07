import urllib.request
import re

try:
    req = urllib.request.Request('https://data.dapiya.top/history/', headers={'User-Agent': 'Mozilla/5.0'})
    html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
    print("HTML response snapshot (first 1000 chars):\n", html[:1000])
    
    # Try with 2026
    req2 = urllib.request.Request('https://data.dapiya.top/history/2026/', headers={'User-Agent': 'Mozilla/5.0'})
    html2 = urllib.request.urlopen(req2, timeout=10).read().decode('utf-8')
    print("\n2026 Directory snapshot:\n", html2[:1000])
    
    # Look for WP952026 or 95W
    if '95' in html2:
        print("\nFound '95' in 2026 HTML!")

except Exception as e:
    print(e)
