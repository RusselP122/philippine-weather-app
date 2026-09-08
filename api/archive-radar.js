import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const maxDuration = 60; // Allow longer execution time on Vercel if needed

function extractCookies(res, existingMap = new Map()) {
  const cookieMap = new Map(existingMap);

  // 1. Try getSetCookie() if available
  if (typeof res.headers.getSetCookie === 'function') {
    const list = res.headers.getSetCookie();
    for (const str of list) {
      const part = str.split(';')[0].trim();
      const eqIdx = part.indexOf('=');
      if (eqIdx > 0) {
        const name = part.slice(0, eqIdx).trim();
        cookieMap.set(name, part);
      }
    }
  }

  // 2. Fallback / supplementary regex extraction from raw 'set-cookie' header
  const rawHeader = res.headers.get('set-cookie');
  if (rawHeader) {
    const regex = /(?:^|,\s*)([a-zA-Z0-9_\-]+)=([^;]+?)(?=;|,|\s*$)/g;
    let match;
    while ((match = regex.exec(rawHeader)) !== null) {
      const name = match[1].trim();
      const val = match[2].trim();
      if (!['expires', 'path', 'domain', 'samesite', 'max-age', 'secure', 'httponly'].includes(name.toLowerCase())) {
        cookieMap.set(name, `${name}=${val}`);
      }
    }
  }

  return cookieMap;
}

function getSignedHeaders(apiSigSecret, csrfToken, cookieHeader, pathname, baseUrl) {
  const method = 'GET';
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const stringToSign = `${method}\n${pathname}\n${ts}\n${nonce}`;
  const sig = crypto.createHmac('sha256', apiSigSecret).update(stringToSign).digest('hex');

  return {
    "User-Agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9,fil;q=0.8",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": `${baseUrl}/`,
    "Origin": baseUrl,
    "Cookie": cookieHeader,
    "X-CSRF-TOKEN": csrfToken,
    "sec-ch-ua": '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": '"Android"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "X-Ts": ts,
    "X-Nonce": nonce,
    "X-Sig": sig,
  };
}

export default async function handler(req, res) {
  // Simple token authorization check to prevent unauthorized calls
  const { auth } = req.query;
  if (auth !== "vYopE7FszD6VmZ71qnG0GAh0dc4Qtv8G2Wp7eJ4k") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabaseUrl = process.env.SUPABASE_URL || "https://jzbgofsdnniflospoggl.supabase.co";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6YmdvZnNkbm5pZmxvc3BvZ2dsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM0NDQzMSwiZXhwIjoyMDk1OTIwNDMxfQ.IQ0covu3g4Oh1M4a1EMcFGi1jfu2jCmh3R88TAKcQWg";

  let supabase;
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
  } catch (err) {
    return res.status(500).json({ error: `Failed to initialize Supabase client: ${err.message}` });
  }

  try {
    const baseCandidates = ["https://panahon.gov.ph", "https://www.panahon.gov.ph"];
    let baseUrl = null;
    let csrfToken = "";
    let apiSigSecret = "";
    let cookieMap = new Map();

    for (const base of baseCandidates) {
      try {
        const homeRes = await fetch(`${base}/`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,fil;q=0.8",
          }
        });

        if (!homeRes.ok) continue;

        const html = await homeRes.text();
        cookieMap = extractCookies(homeRes);

        const csrfMatch = html.match(/<meta name="csrf-token" content="([^"]+)"/);
        const apiSigMatch = html.match(/<meta name="api-sig" content="([^"]+)"/);
        const apiSigHandleMatch = html.match(/<meta name="api-sig-handle" content="([^"]+)"/);

        const token = csrfMatch ? csrfMatch[1] : "";
        let secret = apiSigMatch ? apiSigMatch[1] : "";
        const handle = apiSigHandleMatch ? apiSigHandleMatch[1] : "";

        if (!token) continue;

        if (!secret && handle) {
          const sigUrl = `${base}/api/v1/sig?token=${encodeURIComponent(token)}`;
          const sigRes = await fetch(sigUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36",
              "Cookie": Array.from(cookieMap.values()).join("; "),
              "X-Sig-Handle": handle,
              "Referer": `${base}/`,
              "Origin": base,
              "X-Requested-With": "XMLHttpRequest",
            }
          });

          if (sigRes.ok) {
            cookieMap = extractCookies(sigRes, cookieMap);
            const ct = sigRes.headers.get("content-type") || "";
            if (ct.includes("application/json")) {
              const sigData = await sigRes.json();
              if (sigData && sigData.secret) secret = sigData.secret;
            } else {
              const text = await sigRes.text();
              try {
                const sigData = JSON.parse(text);
                if (sigData && sigData.secret) secret = sigData.secret;
              } catch (_) {}
            }
          }
        }

        if (secret) {
          baseUrl = base;
          csrfToken = token;
          apiSigSecret = secret;
          break;
        }
      } catch (_) {}
    }

    if (!apiSigSecret || !baseUrl) {
      throw new Error("Could not extract or resolve api-sig secret from PANaHON portal");
    }

    // Acquire asset-ticket cookie
    const currentCookieHeader = Array.from(cookieMap.values()).join("; ");
    const assetHeaders = getSignedHeaders(apiSigSecret, csrfToken, currentCookieHeader, "api/v1/asset-ticket", baseUrl);
    const assetRes = await fetch(`${baseUrl}/api/v1/asset-ticket?token=${encodeURIComponent(csrfToken)}`, {
      headers: assetHeaders,
    });

    if (assetRes.ok) {
      cookieMap = extractCookies(assetRes, cookieMap);
    }

    const cookieHeader = Array.from(cookieMap.values()).join("; ");

    // 2. Fetch current timeline from PAGASA
    const timelinePath = "api/v1/radar/timeline";
    const timelineRes = await fetch(
      `${baseUrl}/api/v1/radar/timeline?token=${csrfToken}&sublayer=mosaic-reflectivity`,
      { headers: getSignedHeaders(apiSigSecret, csrfToken, cookieHeader, timelinePath, baseUrl) }
    );

    if (!timelineRes.ok) {
      throw new Error(`PAGASA Timeline API returned HTTP ${timelineRes.status}`);
    }

    const ct = timelineRes.headers.get("content-type") || "";
    let data;
    if (ct.includes("application/json")) {
      data = await timelineRes.json();
    } else {
      const rawText = await timelineRes.text();
      data = JSON.parse(rawText);
    }

    if (!data.success || !data.data || !data.data.timeline) {
      return res.status(500).json({ error: "Failed to retrieve active timeline from PAGASA." });
    }

    const timeline = data.data.timeline;
    const tileVersion = data.data.tile_version || 5;
    const archived = [];

    // 3. Process frames (newest to oldest), archiving up to 3 missing frames per run
    const reversedTimeline = timeline.slice().reverse();
    let processedCount = 0;

    for (const frame of reversedTimeline) {
      if (processedCount >= 3) break; // Keep execution fast and well within serverless timeout

      const observed_at = frame.observed_at;
      const observed_at_unix = parseInt(frame.observed_at_unix, 10);

      // Check if already exists in Supabase
      const { data: existing, error: dbError } = await supabase
        .from("radar_frames")
        .select("id")
        .eq("observed_at_unix", observed_at_unix);

      if (dbError) throw dbError;
      if (existing && existing.length > 0) continue; // Already archived

      console.log(`New Frame Detected: ${observed_at} (${observed_at_unix}). Archiving...`);

      // 4. Download radar image from PAGASA (try 1536 first, fallback to 2048 and 896)
      const imagePath = "api/v1/radar-data-image";
      let imgRes = null;
      for (const size of [1536, 2048, 896]) {
        try {
          const res = await fetch(
            `${baseUrl}/api/v1/radar-data-image?token=${csrfToken}&t=${observed_at_unix}&mode=dbz&size=${size}&v=${tileVersion}`,
            { headers: getSignedHeaders(apiSigSecret, csrfToken, cookieHeader, imagePath, baseUrl) }
          );
          if (res.ok) {
            imgRes = res;
            break;
          }
        } catch (_) {}
      }

      if (!imgRes || !imgRes.ok) {
        console.warn(`Failed to download radar image for ${observed_at}`);
        continue;
      }
      
      const imgBuffer = await imgRes.arrayBuffer();

      // 5. Upload image to Supabase Storage (public/radar-archives)
      const dateFolder = observed_at.split(" ")[0];
      const storagePath = `${dateFolder}/${observed_at_unix}.png`;

      const { error: uploadError } = await supabase.storage
        .from("radar-archives")
        .upload(storagePath, imgBuffer, {
          contentType: "image/png",
          upsert: true
        });

      if (uploadError) {
        const errStr = JSON.stringify(uploadError);
        if (!errStr.includes("Duplicate") && !errStr.includes("already exists")) {
          console.error("Upload error:", uploadError);
          continue;
        }
      }

      // 6. Retrieve public URL of the uploaded image
      const { data: publicUrlData } = supabase.storage
        .from("radar-archives")
        .getPublicUrl(storagePath);

      const publicUrl = publicUrlData.publicUrl;

      // 7. Insert metadata record into Database
      const { error: insertError } = await supabase
        .from("radar_frames")
        .insert({
          observed_at: observed_at + "+08:00", // PHT timezone offset
          observed_at_unix,
          public_url: publicUrl
        });

      if (insertError) {
        console.error("Insert error:", insertError);
        continue;
      }

      archived.push(observed_at);
      processedCount++;
    }

    return res.status(200).json({ success: true, archived, totalTimelineFrames: timeline.length });
  } catch (error) {
    console.error("Serverless Handler Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
