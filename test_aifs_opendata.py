from ecmwf.opendata import Client
import logging

logging.basicConfig(level=logging.DEBUG)

def main():
    try:
        # AIFS-ENS test
        client = Client(model="ifs")
        print("Requesting IFS enfo tf...")
        client.retrieve(
            stream="enfo",
            type="tf",
            target="ifs_tc_tracks.bufr"
        )
        print("Download successful for ifs enfo!")
    except Exception as e:
        print(f"Failed to get ifs: {e}")

if __name__ == "__main__":
    main()
