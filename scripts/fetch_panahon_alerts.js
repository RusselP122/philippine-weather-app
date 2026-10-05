import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

export async function fetchPanahonAlerts() {
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  // 1. Fetch home page for tokens and session cookies
  const homeRes = await fetch("https://panahon.gov.ph/", {
    headers: { "User-Agent": userAgent }
  });

  if (!homeRes.ok) {
    throw new Error(`Failed to fetch Panahon home page: HTTP ${homeRes.status}`);
  }

  const html = await homeRes.text();
  const rawCookies = homeRes.headers.getSetCookie 
    ? homeRes.headers.getSetCookie() 
    : (homeRes.headers.get('set-cookie') ? [homeRes.headers.get('set-cookie')] : []);
  const cookies = rawCookies.map(c => c.split(';')[0]).join('; ');

  const csrfToken = (html.match(/<meta name="csrf-token" content="([^"]+)"/) || [])[1];
  const apiSigHandle = (html.match(/<meta name="api-sig-handle" content="([^"]+)"/) || [])[1];

  if (!csrfToken || !apiSigHandle) {
    throw new Error("Missing csrf-token or api-sig-handle in Panahon HTML");
  }

  // 2. Fetch beta.js to dynamically extract the secret derivation algorithm
  const scriptMatch = html.match(/<script src="([^"]*beta\.js[^"]*)"/);
  const scriptUrl = scriptMatch ? (scriptMatch[1].startsWith('http') ? scriptMatch[1] : `https://panahon.gov.ph${scriptMatch[1]}`) : null;
  if (!scriptUrl) {
    throw new Error("Failed to find beta.js script tag on Panahon");
  }

  const jsRes = await fetch(scriptUrl);
  if (!jsRes.ok) {
    throw new Error(`Failed to load beta.js: HTTP ${jsRes.status}`);
  }
  const js = await jsRes.text();

  const oIdx = js.indexOf('var o=[1116352408');
  const endIdx = js.indexOf('var f="",p=null;');
  if (oIdx === -1 || endIdx === -1) {
    throw new Error("Failed to locate key derivation block in beta.js");
  }

  const block = js.slice(oIdx, endIdx);
  const deriveSecret = new Function("seed", `
    ${block}
    return d({seed: seed});
  `);

  // Extract dynamic recipe if present, or fallback to default
  const recipeMatch = js.match(/"X-Sig-Recipe"\s*:\s*"([a-f0-9]+)"/i);
  const sigRecipe = recipeMatch ? recipeMatch[1] : "717d04e83fd01ad8";

  // 3. Exchange handle for signature seed
  const sigRes = await fetch(`https://panahon.gov.ph/api/v1/sig?token=${encodeURIComponent(csrfToken)}`, {
    headers: {
      "User-Agent": userAgent,
      "Cookie": cookies,
      "X-Sig-Handle": apiSigHandle,
      "X-Sig-Recipe": sigRecipe,
      "Referer": "https://panahon.gov.ph/",
    }
  });

  if (!sigRes.ok) {
    throw new Error(`Panahon /api/v1/sig exchange failed: HTTP ${sigRes.status}`);
  }

  const sigJson = await sigRes.json();
  if (!sigJson || !sigJson.seed) {
    throw new Error("Invalid response from /api/v1/sig: seed missing");
  }

  const secret = deriveSecret(sigJson.seed);
  if (!secret) {
    throw new Error("Derived secret is empty");
  }

  // 4. Sign and fetch cap-alerts
  const pathname = "api/v1/cap-alerts";
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  const stringToSign = `GET\n${pathname}\n${ts}\n${nonce}`;
  const sig = crypto.createHmac("sha256", secret).update(stringToSign).digest("hex");

  const capRes = await fetch(`https://panahon.gov.ph/api/v1/cap-alerts?token=${encodeURIComponent(csrfToken)}`, {
    headers: {
      "User-Agent": userAgent,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Referer": "https://panahon.gov.ph/",
      "Cookie": cookies,
      "X-CSRF-TOKEN": csrfToken,
      "X-Ts": ts,
      "X-Nonce": nonce,
      "X-Sig": sig,
    }
  });

  if (!capRes.ok) {
    throw new Error(`Panahon cap-alerts failed: HTTP ${capRes.status}`);
  }

  const capData = await capRes.json();

  // Sanitize: filter defacement scripts and dummy notes
  if (capData && capData.data && Array.isArray(capData.data.alert_data)) {
    capData.data.alert_data = capData.data.alert_data.filter(a => 
      a &&
      !String(a.headline || "").includes("<script") &&
      !String(a.message || "").includes("<script") &&
      !(a.event === "NOTE" && a.subtype === "NOTE")
    );
  }

  // Cache to public/data/cap_alerts.json
  const cachePath = path.join(projectRoot, 'public', 'data', 'cap_alerts.json');
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(capData, null, 2), 'utf-8');
  } catch (err) {
    console.error("Warning: Could not save cache:", err.message);
  }

  return capData;
}

// When executed directly from CLI or subprocess:
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  fetchPanahonAlerts()
    .then(data => {
      process.stdout.write(JSON.stringify(data));
      process.exit(0);
    })
    .catch(err => {
      process.stderr.write(err.message || String(err));
      process.exit(1);
    });
}
