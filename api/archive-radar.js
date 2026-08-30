import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export default async function handler(req, res) {
  // Simple token authorization check to prevent malicious spamming of the endpoint
  const { auth } = req.query;
  if (auth !== "vYopE7FszD6VmZ71qnG0GAh0dc4Qtv8G2Wp7eJ4k") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ 
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in your Vercel project environment settings. Please configure them in the Vercel Dashboard!"
    });
  }

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

    const cookies = [];
    const rawCookies = homeRes.headers.getSetCookie 
      ? homeRes.headers.getSetCookie() 
      : (homeRes.headers.get("set-cookie") ? [homeRes.headers.get("set-cookie")] : []);
    
    for (const c of rawCookies) {
      const part = c.split(";")[0];
      if (part) cookies.push(part);
    }
    const cookieHeader = cookies.join("; ");

    const csrfMatch = html.match(/<meta name="csrf-token" content="([^"]+)"/);
    const apiSigMatch = html.match(/<meta name="api-sig" content="([^"]+)"/);

    const csrfToken = csrfMatch ? csrfMatch[1] : "";
    const apiSigSecret = apiSigMatch ? apiSigMatch[1] : "";

    if (!csrfToken || !apiSigSecret) {
      throw new Error("Could not extract security tokens from PANaHON portal");
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
        "Cookie": cookieHeader,
        "X-CSRF-TOKEN": csrfToken,
        "X-Ts": ts,
        "X-Nonce": nonce,
        "X-Sig": sig,
      };
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
    const tileVersion = data.data.tile_version || 4;
    const archived = [];

    // 3. Loop through frames and archive new ones
    for (const frame of timeline) {
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

      // 4. Download 2K Ultra-High-Definition PNG radar image from PAGASA
      const imagePath = "api/v1/radar-data-image";
      const imgRes = await fetch(
        `https://panahon.gov.ph/api/v1/radar-data-image?token=${csrfToken}&t=${observed_at_unix}&mode=dbz&size=2048&v=${tileVersion}`,
        { headers: getSignedHeaders(imagePath) }
      );

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
    }

    return res.status(200).json({ success: true, archived });
  } catch (error) {
    console.error("Serverless Handler Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
