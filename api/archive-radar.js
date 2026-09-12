import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60; // Allow sufficient execution time on Vercel

export default async function handler(req, res) {
  // Simple token authorization check
  const { auth, timestamp, type = "DBZ" } = req.query;
  if (auth !== "vYopE7FszD6VmZ71qnG0GAh0dc4Qtv8G2Wp7eJ4k") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabaseUrl = process.env.SUPABASE_URL || "https://jzbgofsdnniflospoggl.supabase.co";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6YmdvZnNkbm5pZmxvc3BvZ2dsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM0NDQzMSwiZXhwIjoyMDk1OTIwNDMxfQ.IQ0covu3g4Oh1M4a1EMcFGi1jfu2jCmh3R88TAKcQWg";
  const radarIdentity = process.env.GARBINWX_RADAR_IDENTITY || "PHTYW-GWxID0625403800007957";

  let supabase;
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
  } catch (err) {
    return res.status(500).json({ error: `Failed to initialize Supabase client: ${err.message}` });
  }

  // Generate recent UTC+8 candidate timestamps if not explicitly provided
  const candidateTimestamps = [];
  if (timestamp && timestamp.length === 12) {
    candidateTimestamps.push(timestamp);
  } else {
    const now = new Date();
    // UTC+8 offset
    const phtOffsetMs = 8 * 60 * 60 * 1000;
    const nowPHT = new Date(now.getTime() + phtOffsetMs);

    // Look back up to 180 minutes (18 steps x 10 mins) to ensure no missed frames during delays
    const minute = nowPHT.getUTCMinutes();
    const roundedMin = Math.floor(minute / 10) * 10;
    const basePHT = new Date(Date.UTC(
      nowPHT.getUTCFullYear(),
      nowPHT.getUTCMonth(),
      nowPHT.getUTCDate(),
      nowPHT.getUTCHours(),
      roundedMin,
      0
    ));

    for (let i = 0; i < 18; i++) {
      const dt = new Date(basePHT.getTime() - i * 10 * 60 * 1000);
      const yyyy = dt.getUTCFullYear();
      const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(dt.getUTCDate()).padStart(2, "0");
      const hh = String(dt.getUTCHours()).padStart(2, "0");
      const min = String(dt.getUTCMinutes()).padStart(2, "0");
      candidateTimestamps.push(`${yyyy}${mm}${dd}${hh}${min}`);
    }
  }

  const results = [];
  let unauthorized = false;

  for (const ts of candidateTimestamps) {
    // Parse timestamp to unix seconds
    const yyyy = parseInt(ts.slice(0, 4), 10);
    const mm = parseInt(ts.slice(4, 6), 10) - 1;
    const dd = parseInt(ts.slice(6, 8), 10);
    const hh = parseInt(ts.slice(8, 10), 10);
    const min = parseInt(ts.slice(10, 12), 10);

    // This is UTC+8 timestamp
    const unixTs = Math.floor(Date.UTC(yyyy, mm, dd, hh - 8, min, 0) / 1000);
    const formattedStr = `${yyyy}-${String(mm + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")} ${String(hh).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;

    // Check DB
    try {
      const { data: existing } = await supabase
        .from("radar_frames")
        .select("id")
        .eq("observed_at_unix", unixTs);

      if (existing && existing.length > 0) {
        continue;
      }
    } catch (dbErr) {
      console.error("DB check failed:", dbErr);
      continue;
    }

    if (unauthorized) break;

    const radarUrl = `https://data.garbinwx.org/raw/${type}-${ts}.png`;
    try {
      const resp = await fetch(radarUrl, {
        headers: {
          "User-Agent": radarIdentity,
          "X-Garbin-ID": radarIdentity,
          "X-Identification-Key": radarIdentity,
          "X-API-Key": radarIdentity,
          "Referer": "https://garbinwx.org/",
          "Origin": "https://garbinwx.org"
        }
      });

      if (resp.status === 403) {
        unauthorized = true;
        results.push({
          timestamp: ts,
          status: 403,
          error: "Radar identity header not authorized. Contact contact@garbinwx.org and set GARBINWX_RADAR_IDENTITY."
        });
        break;
      }

      if (resp.ok) {
        const buffer = Buffer.from(await resp.arrayBuffer());
        if (buffer.length > 200) {
          const dateFolder = `${yyyy}-${String(mm + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
          const storagePath = `${dateFolder}/${unixTs}.png`;

          // Upload to Supabase Storage
          await supabase.storage
            .from("radar-archives")
            .upload(storagePath, buffer, {
              contentType: "image/png",
              upsert: true
            });

          const { data: { publicUrl } } = supabase.storage
            .from("radar-archives")
            .getPublicUrl(storagePath);

          // Save to database
          const { error: insertErr } = await supabase.from("radar_frames").insert({
            observed_at: `${formattedStr}+08:00`,
            observed_at_unix: unixTs,
            public_url: publicUrl
          });

          if (insertErr) {
            console.error("DB Insert error:", insertErr);
            results.push({ timestamp: ts, status: 500, error: insertErr.message });
          } else {
            results.push({ timestamp: ts, status: 200, publicUrl });
          }
        }
      }
    } catch (fetchErr) {
      results.push({ timestamp: ts, error: fetchErr.message });
    }
  }

  return res.status(200).json({
    success: true,
    processed: results.length,
    radarIdentityConfigured: radarIdentity !== "IDENTITY-HERE",
    results
  });
}
