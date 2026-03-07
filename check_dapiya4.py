import urllib.request
import re

try:
    req = urllib.request.Request('https://data.dapiya.top/history/95W/RGB/', headers={'User-Agent': 'Mozilla/5.0'})
    html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
    files = re.findall(r'href="([^"]+)"', html)
    relevant = [f for f in files if '.png' in f.lower() or '.jpg' in f.lower() or '.gif' in f.lower()]
    print("Files in /history/95W/RGB/: ", relevant[-5:]) # print last 5 to see naming convention
    
    req2 = urllib.request.Request('https://data.dapiya.top/history/95W/TRUECOLOR/', headers={'User-Agent': 'Mozilla/5.0'})
    html2 = urllib.request.urlopen(req2, timeout=10).read().decode('utf-8')
    files2 = re.findall(r'href="([^"]+)"', html2)
    relevant2 = [f for f in files2 if '.png' in f.lower() or '.jpg' in f.lower() or '.gif' in f.lower()]
    print("\nFiles in /history/95W/TRUECOLOR/: ", relevant2[-5:])
except Exception as e:
    print(e)
