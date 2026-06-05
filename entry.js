import { createClient } from "@supabase/supabase-js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Route: /api/earthquake-data
    if (pathname === '/api/earthquake-data') {
      const targetUrl = 'https://data.garbinwx.org/api/earthquakes.json';
      return fetch(targetUrl, {
        headers: {
          'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0'
        }
      });
    }

    // Route: /api/cap-alerts
    if (pathname === '/api/cap-alerts') {
      const targetUrl = 'https://www.panahon.gov.ph/api/v1/cap-alerts?token=sH2S6zIL6jKA7lgffdgyI3kGTZgPjGdiHCsIocAW';
      return fetch(targetUrl, {
        headers: {
          'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0',
          'Referer': 'https://www.panahon.gov.ph/'
        }
      });
    }

    // Route: /api/ogimet/*
    if (pathname.startsWith('/api/ogimet/')) {
      const ogimetPath = pathname.substring('/api/ogimet/'.length);
      const targetUrl = `http://www.ogimet.com/cgi-bin/${ogimetPath}${url.search}`;
      return fetch(targetUrl, {
        headers: {
          'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0'
        }
      });
    }

    // Route: /api/zoom-earth/*
    if (pathname.startsWith('/api/zoom-earth/')) {
      const zoomPath = pathname.substring('/api/zoom-earth/'.length);
      const targetUrl = `https://tiles.zoom.earth/${zoomPath}${url.search}`;
      const response = await fetch(targetUrl, {
        headers: {
          'Referer': 'https://zoom.earth/',
          'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0'
        }
      });
      
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    // Route: /api/lightning
    if (pathname === '/api/lightning') {
      const targetUrl = 'https://panahon.gov.ph/api/v1/lightning';
      return fetch(targetUrl, {
        headers: {
          'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0',
          'Referer': 'https://www.panahon.gov.ph/'
        }
      });
    }

    // Route: /api/radar
    if (pathname === '/api/radar') {
      const targetUrl = 'https://www.panahon.gov.ph/api/v1/radar/timeline?token=vYopE7FszD6VmZ71qnG0GAh0dc4Qtv8G2Wp7eJ4k&sublayer=hybrid-reflectivity';
      return fetch(targetUrl, {
        headers: {
          'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0',
          'Referer': 'https://www.panahon.gov.ph/'
        }
      });
    }

    // Route: /api/archive-radar
    if (pathname === '/api/archive-radar') {
      // Simple token authorization check to prevent malicious spamming of the endpoint
      const auth = url.searchParams.get("auth");
      if (auth !== "vYopE7FszD6VmZ71qnG0GAh0dc4Qtv8G2Wp7eJ4k") {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }

      const supabaseUrl = env.SUPABASE_URL;
      const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !supabaseKey) {
        return new Response(JSON.stringify({ 
          error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in your Cloudflare project environment settings. Please configure them in the Cloudflare Dashboard!"
        }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }

      let supabase;
      try {
        supabase = createClient(supabaseUrl, supabaseKey);
      } catch (err) {
        return new Response(JSON.stringify({ error: `Failed to initialize Supabase client: ${err.message}` }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }

      try {
        // 1. Fetch current timeline from PAGASA
        const timelineRes = await fetch(
          "https://www.panahon.gov.ph/api/v1/radar/timeline?token=vYopE7FszD6VmZ71qnG0GAh0dc4Qtv8G2Wp7eJ4k&sublayer=hybrid-reflectivity",
          {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Referer": "https://www.panahon.gov.ph/"
            }
          }
        );
        const data = await timelineRes.json();
        if (!data.success || !data.data || !data.data.timeline) {
          return new Response(JSON.stringify({ error: "Failed to retrieve active timeline from PAGASA." }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
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
            `https://www.panahon.gov.ph/api/v1/radar-image?token=vYopE7FszD6VmZ71qnG0GAh0dc4Qtv8G2Wp7eJ4k&sublayer=hybrid-reflectivity&index=${pagasaIndex}`,
            {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://www.panahon.gov.ph/"
              }
            }
          );
          if (!imgRes.ok) continue;
          
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

        return new Response(JSON.stringify({ success: true, archived }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      } catch (error) {
        console.error("Serverless Handler Error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Default: Fallback to serving static assets
    return env.ASSETS.fetch(request);
  }
};
