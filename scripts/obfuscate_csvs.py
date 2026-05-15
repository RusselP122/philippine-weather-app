import os
import base64
import glob

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "data")
XOR_KEY = 0xAA

def obfuscate_file(filepath):
    # Only obfuscate .csv files
    if not filepath.endswith('.csv'):
        return

    out_path = filepath.replace('.csv', '.dat')
    
    with open(filepath, 'rb') as f:
        data = f.read()
    
    # XOR and base64
    xored = bytearray([b ^ XOR_KEY for b in data])
    b64 = base64.b64encode(xored).decode('utf-8')
    
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(b64)
        
    # Delete original csv
    try:
        os.remove(filepath)
    except Exception as e:
        print(f"Could not remove {filepath}: {e}")
    print(f"Obfuscated {os.path.basename(filepath)} -> {os.path.basename(out_path)}")

def main():
    csv_files = glob.glob(os.path.join(DATA_DIR, "*.csv"))
    if not csv_files:
        print("No CSV files found to obfuscate.")
    for f in csv_files:
        obfuscate_file(f)

if __name__ == "__main__":
    main()
