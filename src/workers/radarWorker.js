// High-Definition Doppler Radar Color LUT Builder
function buildSmoothLUT(theme = "default") {
  const lut = new Uint8ClampedArray(256 * 4);

  function lerp(a, b, t) {
    return a + (b - a) * Math.max(0, Math.min(1, t));
  }

  function lerpColor(c1, c2, t) {
    return [
      Math.round(lerp(c1[0], c2[0], t)),
      Math.round(lerp(c1[1], c2[1], t)),
      Math.round(lerp(c1[2], c2[2], t)),
      Math.round(lerp(c1[3], c2[3], t))
    ];
  }

  let stops = [];

  if (theme === "vaporwave") {
    stops = [
      [0,   [0, 0, 0, 0]],
      [5,   [0, 0, 0, 0]],
      [8,   [0, 240, 255, 100]],
      [18,  [0, 240, 255, 180]],
      [28,  [5, 217, 232, 220]],
      [38,  [255, 42, 116, 245]],
      [48,  [255, 0, 127, 255]],
      [60,  [171, 0, 205, 255]],
      [75,  [255, 200, 255, 255]]
    ];
  } else if (theme === "storm") {
    stops = [
      [0,   [0, 0, 0, 0]],
      [5,   [0, 0, 0, 0]],
      [8,   [30, 58, 138, 100]],
      [18,  [30, 58, 138, 180]],
      [28,  [4, 120, 87, 220]],
      [38,  [217, 119, 6, 245]],
      [48,  [220, 38, 38, 255]],
      [60,  [112, 26, 117, 255]],
      [75,  [255, 255, 255, 255]]
    ];
  } else if (theme === "retro") {
    stops = [
      [0,   [0, 0, 0, 0]],
      [5,   [0, 0, 0, 0]],
      [8,   [20, 83, 45, 100]],
      [18,  [21, 128, 61, 180]],
      [28,  [34, 197, 94, 220]],
      [38,  [74, 222, 128, 245]],
      [48,  [134, 239, 172, 255]],
      [60,  [248, 113, 113, 255]],
      [75,  [255, 255, 255, 255]]
    ];
  } else {
    // Official High-Definition Doppler Color Scale (Ultra-smooth gradient)
    stops = [
      [0,   [0, 0, 0, 0]],
      [5,   [0, 0, 0, 0]],
      [8,   [64, 164, 223, 90]],       // Light sky blue / drizzle
      [15,  [0, 210, 220, 160]],       // Cyan
      [23,  [0, 245, 120, 220]],       // Light green
      [30,  [0, 215, 0, 255]],         // Pure green (Light-Mod Rain)
      [37,  [140, 235, 0, 255]],       // Lime green
      [43,  [255, 240, 0, 255]],       // Yellow (Mod-Heavy Rain)
      [49,  [255, 150, 0, 255]],       // Amber-Orange (Heavy Rain)
      [55,  [255, 50, 20, 255]],       // Bright Red (Intense Rain)
      [63,  [200, 0, 0, 255]],         // Dark Crimson Red (Torrential)
      [70,  [255, 0, 255, 255]],       // Magenta / Severe Hail
      [78,  [255, 220, 255, 255]]      // Extreme white-purple core
    ];
  }

  for (let val = 0; val < 256; val++) {
    const dbz = (val / 255.0) * 80.0;
    const offset = val * 4;

    if (dbz <= stops[0][0]) {
      lut[offset] = stops[0][1][0];
      lut[offset + 1] = stops[0][1][1];
      lut[offset + 2] = stops[0][1][2];
      lut[offset + 3] = stops[0][1][3];
      continue;
    }

    if (dbz >= stops[stops.length - 1][0]) {
      const last = stops[stops.length - 1][1];
      lut[offset] = last[0];
      lut[offset + 1] = last[1];
      lut[offset + 2] = last[2];
      lut[offset + 3] = last[3];
      continue;
    }

    for (let s = 0; s < stops.length - 1; s++) {
      const s0 = stops[s];
      const s1 = stops[s + 1];
      if (dbz >= s0[0] && dbz <= s1[0]) {
        const t = (dbz - s0[0]) / (s1[0] - s0[0]);
        const col = lerpColor(s0[1], s1[1], t);
        lut[offset] = col[0];
        lut[offset + 1] = col[1];
        lut[offset + 2] = col[2];
        lut[offset + 3] = col[3];
        break;
      }
    }
  }

  return lut;
}

const lutCache = {};

self.onmessage = function (e) {
  const { buffer, width, height, theme = "default" } = e.data;
  const data = new Uint8ClampedArray(buffer);

  if (!lutCache[theme]) {
    lutCache[theme] = buildSmoothLUT(theme);
  }
  const lut = lutCache[theme];

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a < 10) {
      data[i + 3] = 0;
      continue;
    }

    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;

    // Check if grayscale data texture
    const isGrayscaleData = saturation < 0.12 || Math.abs(r - g) <= 6 && Math.abs(g - b) <= 6;

    if (isGrayscaleData) {
      const val = r;
      const offset = val * 4;

      data[i]     = lut[offset];
      data[i + 1] = lut[offset + 1];
      data[i + 2] = lut[offset + 2];
      data[i + 3] = lut[offset + 3];
      continue;
    }

    // Legacy Colored Radar handling
    if (saturation < 0.22 || (r > 170 && g > 170 && b > 170 && saturation < 0.16)) {
      continue;
    }

    let colorType = "green";
    if (g > 200 && b > 200 && r > 100 && r < 160) colorType = "clutter";
    else if (r > 150 && b > 150 && g < 135) colorType = "purple";
    else if (r > 140 && g < 50 && b < 50) colorType = "red";
    else if (r > 200 && g > 120 && b < 100) colorType = "yellow";
    else if (b > g && b > r * 0.9) colorType = "blue";
    else if (g > r && g > b) colorType = "green";

    let targetHex = "";
    if (theme === "vaporwave") {
      if (colorType === "clutter") targetHex = "#1c1533";
      else if (colorType === "blue") targetHex = "#00f0ff";
      else if (colorType === "green") targetHex = "#05d9e8";
      else if (colorType === "yellow") targetHex = "#ff2a74";
      else if (colorType === "red") targetHex = "#ff007f";
      else if (colorType === "purple") targetHex = "#ab00cd";
    } else if (theme === "storm") {
      if (colorType === "clutter") targetHex = "#20181b";
      else if (colorType === "blue") targetHex = "#1e3a8a";
      else if (colorType === "green") targetHex = "#047857";
      else if (colorType === "yellow") targetHex = "#d97706";
      else if (colorType === "red") targetHex = "#dc2626";
      else if (colorType === "purple") targetHex = "#701a75";
    } else if (theme === "retro") {
      if (colorType === "clutter") targetHex = "#041f0f";
      else if (colorType === "blue") targetHex = "#14532d";
      else if (colorType === "green") targetHex = "#15803d";
      else if (colorType === "yellow") targetHex = "#22c55e";
      else if (colorType === "red") targetHex = "#4ade80";
      else if (colorType === "purple") targetHex = "#86efac";
    } else {
      if (colorType === "clutter") targetHex = "#075163";
      else if (colorType === "blue") targetHex = "#0a6f87";
      else if (colorType === "green") targetHex = "#31ab12";
      else if (colorType === "yellow") targetHex = "#f0ec00";
      else if (colorType === "red") targetHex = "#ff0000";
      else if (colorType === "purple") targetHex = "#dcbae6";
    }

    if (targetHex) {
      const hex = targetHex.replace("#", "");
      data[i] = parseInt(hex.substring(0, 2), 16);
      data[i + 1] = parseInt(hex.substring(2, 4), 16);
      data[i + 2] = parseInt(hex.substring(4, 6), 16);
    }
  }

  self.postMessage({ buffer: data.buffer, width, height }, [data.buffer]);
};
