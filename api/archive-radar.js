import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const maxDuration = 60; // Allow longer execution time on Vercel if needed

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
    // 1. Fetch gateway page to extract session cookies, csrf-token, and api-sig secret
    const homeRes = await fetch("https://panahon.gov.ph/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      }
    });

    if (!homeRes.ok) {
      throw new Error(`Failed to contact PANaHON gateway: ${homeRes.status}`);
    }

    const html = await homeRes.text();

    const cookieMap = new Map();
    const parseCookies = (res) => {
      const raw = res.headers.getSetCookie 
        ? res.headers.getSetCookie() 
        : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
      for (const c of raw) {
        const part = c.split(";")[0].trim();
        if (part) {
          const eqIdx = part.indexOf("=");
          if (eqIdx > 0) {
            cookieMap.set(part.slice(0, eqIdx), part);
          }
        }
      }
    };

    parseCookies(homeRes);

    const csrfMatch = html.match(/<meta name="csrf-token" content="([^"]+)"/);
    const apiSigMatch = html.match(/<meta name="api-sig" content="([^"]+)"/);
    const apiSigHandleMatch = html.match(/<meta name="api-sig-handle" content="([^"]+)"/);

    const csrfToken = csrfMatch ? csrfMatch[1] : "";
    let apiSigSecret = apiSigMatch ? apiSigMatch[1] : "";
    const apiSigHandle = apiSigHandleMatch ? apiSigHandleMatch[1] : "";

    if (!csrfToken) {
      throw new Error("Could not extract csrf-token from PANaHON portal");
    }

    // Exchange api-sig-handle via /api/v1/sig if api-sig is not directly embedded
    if (!apiSigSecret && apiSigHandle) {
      const sigUrl = `https://panahon.gov.ph/api/v1/sig?token=${encodeURIComponent(csrfToken)}`;
      const sigRes = await fetch(sigUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Cookie": Array.from(cookieMap.values()).join("; "),
          "X-Sig-Handle": apiSigHandle,
          "Referer": "https://panahon.gov.ph/",
        }
      });

      if (sigRes.ok) {
        parseCookies(sigRes);
        const sigData = await sigRes.json();
        if (sigData && sigData.secret) {
          apiSigSecret = sigData.secret;
        }
      }
    }

    if (!apiSigSecret) {
      throw new Error("Could not extract or resolve api-sig secret from PANaHON portal");
    }

    // Helper to generate dynamic HMAC-SHA256 headers for any PANaHON endpoint
    function getSignedHeaders(pathname) {
      const ts = String(Math.floor(Date.now() / 1000));
      const nonce = crypto.randomBytes(16).toString("hex");
      const stringToSign = `GET\n${pathname}\n${ts}\n${nonce}`;
      const sig = crypto.createHmac("sha256", apiSigSecret).update(stringToSign).digest("hex");

      return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://panahon.gov.ph/",
        "Origin": "https://panahon.gov.ph",
        "Cookie": Array.from(cookieMap.values()).join("; "),
        "X-CSRF-TOKEN": csrfToken,
        "X-Ts": ts,
        "X-Nonce": nonce,
        "X-Sig": sig,
      };
    }

    // Acquire asset-ticket cookie
    const assetRes = await fetch(`https://panahon.gov.ph/api/v1/asset-ticket?token=${encodeURIComponent(csrfToken)}`, {
      headers: getSignedHeaders("api/v1/asset-ticket"),
    });

    if (assetRes.ok) {
      parseCookies(assetRes);
    }

    // 2. Fetch current timeline from PAGASA
    const timelinePath = "api/v1/radar/timeline";
    const timelineRes = await fetch(
      `https://panahon.gov.ph/api/v1/radar/timeline?token=${csrfToken}&sublayer=mosaic-reflectivity`,
      { headers: getSignedHeaders(timelinePath) }
    );

    if (!timelineRes.ok) {
      throw new Error(`PAGASA Timeline API returned HTTP ${timelineRes.status}`);
    }

    const data = await timelineRes.json();
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

      // 4. Download radar image from PAGASA (try 2048 first, fallback to 896)
      const imagePath = "api/v1/radar-data-image";
      let imgRes = await fetch(
        `https://panahon.gov.ph/api/v1/radar-data-image?token=${csrfToken}&t=${observed_at_unix}&mode=dbz&size=2048&v=${tileVersion}`,
        { headers: getSignedHeaders(imagePath) }
      );

      if (!imgRes.ok) {
        imgRes = await fetch(
          `https://panahon.gov.ph/api/v1/radar-data-image?token=${csrfToken}&t=${observed_at_unix}&mode=dbz&size=896&v=${tileVersion}`,
          { headers: getSignedHeaders(imagePath) }
        );
      }

      if (!imgRes.ok) {
        console.warn(`Failed to download radar image for ${observed_at} (HTTP ${imgRes.status})`);
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
