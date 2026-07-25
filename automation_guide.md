# Automating Forecast Image Updates with GitHub Actions

You can use **GitHub Actions** to automatically run your Python script and update the forecast images, even when your computer is off.

## How it works
1. **GitHub Actions** creates a temporary virtual computer in the cloud.
2. It downloads your code and installs Python.
3. It runs your forecast script to generate the images.
4. It saves (commits) the new images back to your GitHub repository.
5. Your hosting provider (e.g., Vercel, Netlify) detects the change and updates your live site.

## Step 1: Prepare your Python Script

Ensure your Python script saves images to the correct folder (e.g., `public/assets/`).

*Example structure:*
```
root/
  ├── .github/workflows/
  ├── public/
  │   └── assets/
  ├── src/
  ├── generate_forecast.py  <-- Your script
  └── requirements.txt      <-- Python dependencies (matplotlib, cartopy, etc.)
```

## Step 2: Create the Workflow File

Create a new file in your repository at `.github/workflows/update_forecast.yml`:

```yaml
name: Update Forecast Images

on:
  schedule:
    # Run every 6 hours (adjust as needed)
    # Cron format: min hr day month day-of-week
    # Times are in UTC
    - cron: '0 0,6,12,18 * * *'
  workflow_dispatch: # Allows you to manually trigger it from GitHub website

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write # Important: allows the action to push changes

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.9' # Use your script's python version

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          if [ -f requirements.txt ]; then pip install -r requirements.txt; fi

      - name: Run Forecast Script
        run: python generate_forecast.py
        # Make sure your script saves images to public/assets/

      - name: Commit and Push changes
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          git add public/assets/*.png
          
          # Only commit if there are changes
          if git diff --staged --quiet; then
            echo "No changes to commit"
          else
            git commit -m "Auto-update forecast images"
            git push
          fi
```

## Step 3: Deployment
Once the Action runs and pushes the new images:
- If you use **Vercel** or **Netlify** connected to your repo, they will automatically redeploy your site with the new images.
- If you use **GitHub Pages**, it will also update automatically.

## Important Notes
- **Storage Limits**: Git repositories shouldn't store huge amounts of binary files. If you generate GBs of images, consider uploading to AWS S3 or Firebase Storage instead of committing them.
- **Dependencies**: Make sure you generate a `requirements.txt` file (`pip freeze > requirements.txt`) so the cloud runner knows what libraries to install.
