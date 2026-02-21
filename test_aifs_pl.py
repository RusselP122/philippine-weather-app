from ecmwf.opendata import Client

client = Client(source="ecmwf", model="aifs-single", resol="0p25")

try:
    print("Trying to download 850hPa u/v/z/t and 500hPa z...")
    client.retrieve(
        step=0,
        type="fc",
        levtype="pl",
        levelist=[850, 500],
        param=['u', 'v', 'z', 't'],
        target="test_pl.grib2"
    )
    print("Success! Pressure levels are available in AIFS open data.")
except Exception as e:
    print(f"Failed to retrieve pl: {e}")
