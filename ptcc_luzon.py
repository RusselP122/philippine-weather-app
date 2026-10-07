#!/usr/bin/env python3
"""
========================================================================================
Himawari Channel 13 IR Brightness Temperature HD Regional Satellite Generator
========================================================================================
Dedicated entry point for regional target sectors with Ultra-HD bicubic resampling
and Fox Weather 2-tier broadcast styling.

Supported Targets:
  1. Regional Sectors:
     --northern-luzon  /  --extreme-northern-luzon  /  --target northern_luzon
     --southern-luzon  /  --calabarzon              /  --target southern_luzon
     --visayas         /  --all-visayas             /  --target visayas
     --mindanao        /  --all-mindanao            /  --target mindanao
     --all-targets                                  # Render all 4 regional sectors

  2. Tropical Storm / Cyclone Targets:
     --26W             /  --25W  /  --32W           # Direct storm ID shortcuts
     --storm <ID/NAME>                              # Target any storm (e.g. 26W, CHOI-WAN)

Examples:
  python ptcc_luzon.py --26W                       # Focus directly on Typhoon 26W (Choi-wan)
  python ptcc_luzon.py --26W --gif                 # 6-hour animated storm tracking loop
  python ptcc_luzon.py --northern-luzon            # Northern & Extreme Northern Luzon
  python ptcc_luzon.py --southern-luzon            # Southern Luzon (CALABARZON / Bicol)
  python ptcc_luzon.py --visayas                   # All Visayas sector
  python ptcc_luzon.py --mindanao                  # Mindanao sector
  python ptcc_luzon.py --all-targets               # Batch generate all 4 regional targets
"""

import sys
import os

# Import main execution and utilities from ptcc_satellite
from ptcc_satellite import main, generate_satellite, SECTORS, resolve_sector

if __name__ == "__main__":
    main()
