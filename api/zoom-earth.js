export default async function handler(req, res) {
  // Extract path from query parameters
  const { path } = req.query;

  if (!path) {
    return res.status(400).json({ error: "Missing tile path parameter" });
  }

  // Construct target Zoom Earth URL
  const targetUrl = `https://tiles.zoom.earth/${path}`;

  try {
    // Forward the request to Zoom Earth with custom Referer and User-Agent headers
    const response = await fetch(targetUrl, {
      headers: {
        "Referer": "https://zoom.earth/",
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (!response.ok) {
      return res.status(response.status).send(`Failed to fetch tile: ${response.statusText}`);
    }

    // Set standard image headers and cache controls
    res.setHeader("Content-Type", response.headers.get("Content-Type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); // Cache tiles for 1 year

    // Get arrayBuffer and send it
    const buffer = await response.arrayBuffer();
    return res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Zoom Earth Proxy Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
