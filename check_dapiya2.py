import urllib.request
import re

try:
    req = urllib.request.Request('https://data.dapiya.top/history/', headers={'User-Agent': 'Mozilla/5.0'})
    html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
    folders = re.findall(r'href="([^"]+)"', html)
    print("Folders in /history/: ", folders)
except Exception as e:
    print(e)
