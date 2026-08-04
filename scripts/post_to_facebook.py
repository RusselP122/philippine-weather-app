import os
import requests

def post_to_facebook():
    # Environment variables set by GitHub Actions
    PAGE_ID = os.environ.get('FB_PAGE_ID')
    ACCESS_TOKEN = os.environ.get('FB_ACCESS_TOKEN')
    
    if not PAGE_ID or not ACCESS_TOKEN:
        print("Error: FB_PAGE_ID or FB_ACCESS_TOKEN environment variables are missing.")
        return
        
    regions = ['Luzon', 'Visayas', 'Mindanao']
    
    for region in regions:
        IMAGE_PATH = f'public/facebook_alert_post_{region}.png'
        TEXT_PATH = f'public/facebook_alert_post_{region}.txt'
        
        if not os.path.exists(IMAGE_PATH) or not os.path.exists(TEXT_PATH):
            print(f"No map or caption found for {region}. Skipping Facebook post.")
            continue
            
        # Read the text caption
        with open(TEXT_PATH, 'r', encoding='utf-8') as f:
            message = f.read()
            
        url = f"https://graph.facebook.com/v19.0/{PAGE_ID}/photos"
        
        payload = {
            'message': message,
            'access_token': ACCESS_TOKEN
        }
        
        # Upload the image
        with open(IMAGE_PATH, 'rb') as img:
            files = {
                'source': img
            }
            
            print(f"Sending post to Facebook for {region}...")
            response = requests.post(url, data=payload, files=files)
            
            if response.status_code == 200:
                print(f"Successfully posted {region} to Facebook!")
                print(f"Post ID: {response.json().get('post_id')}")
            else:
                print(f"Failed to post {region} to Facebook.")
                print(f"Status Code: {response.status_code}")
                print(f"Response: {response.text}")
                # Exit with code 1 so GitHub Action marks the step as failed
                exit(1)

if __name__ == "__main__":
    post_to_facebook()
