import { createClient } from "@supabase/supabase-js";

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
    // 1. Fetch current timeline from PAGASA
    const timelineRes = await fetch(
      "https://www.panahon.gov.ph/api/v1/radar/timeline?token=vYopE7FszD6VmZ71qnG0GAh0dc4Qtv8G2Wp7eJ4k&sublayer=hybrid-reflectivity"
    );
    const data = await timelineRes.json();
    if (!data.success || !data.data || !data.data.timeline) {
      return res.status(500).json({ error: "Failed to retrieve active timeline from PAGASA." });
    }

    const timeline = data.data.timeline;
    const archived = [];

    // 2. Loop through frames and archive new ones
    for (const frame of timeline) {
      const observed_at = frame.observed_at;
      const observed_at_unix = parseInt(frame.observed_at_unix, 10);
      const image_url = frame.image_url;

      // Extract PAGASA index parameter
      const idMatch = image_url.match(/[&?]id=(\d+)/);
      if (!idMatch) continue;
      const pagasaIndex = idMatch[1];

      // Check if already exists in Supabase
      const { data: existing, error: dbError } = await supabase
        .from("radar_frames")
        .select("id")
        .eq("observed_at_unix", observed_at_unix);

      if (dbError) throw dbError;
      if (existing && existing.length > 0) continue; // Already archived

      console.log(`New Frame Detected: ${observed_at}. Archiving...`);

      // 3. Download the raw PNG image from PAGASA as an ArrayBuffer
      const imgRes = await fetch(
        `https://panahon.gov.ph/api/v1/radar-image?token=vYopE7FszD6VmZ71qnG0GAh0dc4Qtv8G2Wp7eJ4k&sublayer=hybrid-reflectivity&index=${pagasaIndex}`
      );
      if (!imgRes.ok) continue;
      
      // Convert to ArrayBuffer which has maximum node serverless runtime compatibility
      const imgBuffer = await imgRes.arrayBuffer();

      // 4. Upload image to Supabase Storage (public/radar-archives)
      const dateFolder = observed_at.split(" ")[0];
      const storagePath = `${dateFolder}/${observed_at_unix}.png`;

      const { error: uploadError } = await supabase.storage
        .from("radar-archives")
        .upload(storagePath, imgBuffer, {
          contentType: "image/png",
          upsert: true // Handles duplicate uploads cleanly
        });

      if (uploadError) {
        // If it's a duplicate error, the file is already uploaded, so we can ignore and write to database
        const errStr = JSON.stringify(uploadError);
        if (!errStr.includes("Duplicate") && !errStr.includes("already exists")) {
          console.error("Upload error:", uploadError);
          continue;
        }
      }

      // 5. Retrieve the public URL of the uploaded image
      const { data: publicUrlData } = supabase.storage
        .from("radar-archives")
        .getPublicUrl(storagePath);

      const publicUrl = publicUrlData.publicUrl;

      // 6. Insert metadata record into Database
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
