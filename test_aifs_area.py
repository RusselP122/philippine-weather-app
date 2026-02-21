from ecmwf.opendata import Client
import os

client = Client(source="ecmwf", model="aifs-single", resol="0p25")

try:
    print("Testing area subset download...")
    target = "test_area.grib2"
    client.retrieve(
        step=0,
        type="fc",
        param=["msl"],
        area=[45, 100, 0, 160], # N, W, S, E
        target=target
    )
    size = os.path.getsize(target)
    print(f"Success! File size: {size} bytes")
except Exception as e:
    print(f"Failed to retrieve with area: {e}")
