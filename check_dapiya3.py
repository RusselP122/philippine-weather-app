import urllib.request
import re

try:
    req = urllib.request.Request('https://data.dapiya.top/history/95W/', headers={'User-Agent': 'Mozilla/5.0'})
    html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
    folders = re.findall(r'href="([^"]+)"', html)
    
    # filter out generic web stuff
    relevant = [f for f in folders if not f.startswith('/theme') and not f.startswith('?')]
    print("Files in /history/95W/: ", relevant)
except Exception as e:
    print(e)
