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
    // Official Doppler Color Scale matching uploaded reference palette
    // 0: #595959 (Clutter), 15: #43e843 (1 mm/hr), 20: #00c900 (3 mm/hr), 25: #1ca500 (7 mm/hr)
    // 30: #eff000 (15 mm/hr), 35: #ffc100, 40: #ff6a00 (30 mm/hr), 45: #f50500 (45 mm/hr)
    // 50: #c20000, 55: #ad0033, 60: #e600cc, 65+: #9e07fb (65+ mm/hr)
    stops = [
      [0,    [0, 0, 0, 0]],              // < 1 dBZ: transparent clear air
      [1,    [89, 89, 89, 60]],          // #595959 (0 dBZ Radar Clutter)
      [5,    [128, 128, 128, 90]],       // #808080
      [10,   [170, 170, 170, 130]],      // #aaaaaa (10 dBZ)
      [13,   [140, 215, 140, 180]],      // #8cd78c
      [15,   [67, 232, 67, 220]],        // #43e843 (15 dBZ / 1 mm/hr)
      [20,   [0, 201, 0, 255]],          // #00c900 (20 dBZ / 3 mm/hr)
      [25,   [28, 165, 0, 255]],         // #1ca500 (25 dBZ / 7 mm/hr)
      [30,   [239, 240, 0, 255]],        // #eff000 (30 dBZ / 15 mm/hr)
      [35,   [255, 193, 0, 255]],        // #ffc100 (35 dBZ)
      [40,   [255, 106, 0, 255]],        // #ff6a00 (40 dBZ / 30 mm/hr)
      [45,   [245, 5, 0, 255]],          // #f50500 (45 dBZ / 45 mm/hr)
      [50,   [194, 0, 0, 255]],          // #c20000 (50 dBZ)
      [55,   [173, 0, 51, 255]],         // #ad0033 (55 dBZ)
      [60,   [230, 0, 204, 255]],        // #e600cc (60 dBZ)
      [65,   [158, 7, 251, 255]],        // #9e07fb (65+ dBZ / 65+ mm/hr)
      [80,   [158, 7, 251, 255]]
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
