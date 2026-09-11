// GarbinWx Doppler Radar Color Processor & Spectral Theme Worker

// Official GarbinWx Reflectivity (DBZ) Scale (1 to 66+ dBZ)
const HEX_COLORS_DBZ = [
  '#535353', '#5b5b5b', '#606060', '#6e6e6e', '#797979', '#828282', '#8a8a8a', '#939393',
  '#9b9b9b', '#a1a1a1', '#aaaaaa', '#b9b9b9', '#c1c1c1', '#c8c8c8', '#cecece', '#00ff00',
  '#00f500', '#00e600', '#00dc00', '#00d200', '#00c800', '#00be00', '#00b400', '#00aa00',
  '#00a000', '#009600', '#32aa00', '#64be00', '#96d200', '#cdeb00', '#ffff00', '#fff500',
  '#ffe600', '#ffdc00', '#ffd200', '#ffc800', '#ffb900', '#ffaa00', '#ff9600', '#ff8700',
  '#ff7800', '#ff5f00', '#ff4600', '#ff3200', '#ff1900', '#ff0000', '#ff0000', '#e60000',
  '#dc0000', '#d20000', '#c80000', '#be0000', '#b40000', '#aa0000', '#a00000', '#960000',
  '#aa0032', '#be0064', '#d70096', '#eb00cd', '#ff00ff', '#eb00ff', '#d200ff', '#be00ff',
  '#aa00ff', '#9600ff'
];

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16)
  ];
}

const DBZ_RGB = HEX_COLORS_DBZ.map(hexToRgb);

// Map a pixel to approximate dBZ (1 to 66) based on closest GarbinWx color
function estimateDbz(r, g, b) {
  // Grayscale clutter (1 to 15 dBZ)
  if (Math.abs(r - g) <= 5 && Math.abs(g - b) <= 5) {
    // 1 dBZ is #535353 (83, 83, 83), 15 dBZ is #cecece (206, 206, 206)
    if (r < 75) return 1;
    if (r > 215) return 15;
    return Math.round(1 + ((r - 83) / (206 - 83)) * 14);
  }

  // Purples / Pinks (57 to 66+ dBZ)
  if (b > 150 && r > 120) {
    if (b > 240 && r < 180) return 66; // #9600ff
    if (b > 240 && r > 240) return 61; // #ff00ff
    return 60;
  }

  // Reds / Crimsons (46 to 56 dBZ)
  if (r > 140 && g < 40 && b < 40) {
    if (r > 230) return 46; // #ff0000
    if (r < 170) return 56; // #960000
    return 50;
  }

  // Oranges (40 to 45 dBZ)
  if (r > 220 && g > 30 && g < 150 && b < 50) {
    return Math.round(45 - (g / 150) * 5);
  }

  // Yellows / Lime (30 to 39 dBZ)
  if (r > 190 && g > 190 && b < 50) {
    if (r > 240 && g > 240) return 31; // #ffff00
    return 36;
  }

  // Greens (16 to 29 dBZ)
  if (g > 140 && r < 160 && b < 50) {
    if (r > 120) return 29; // yellow-green
    if (g > 230) return 16; // bright green
    return 22;
  }

  return 0;
}

// Alternative theme color mapper by dBZ
function getThemeRgb(dbz, theme) {
  if (theme === "vaporwave") {
    if (dbz <= 15) return [28, 21, 51];       // #1c1533
    if (dbz <= 30) return [0, 240, 255];      // #00f0ff
    if (dbz <= 40) return [5, 217, 232];      // #05d9e8
    if (dbz <= 50) return [255, 42, 116];     // #ff2a74
    if (dbz <= 60) return [255, 0, 127];      // #ff007f
    return [171, 0, 205];                     // #ab00cd
  }

  if (theme === "storm") {
    if (dbz <= 15) return [32, 24, 27];       // #20181b
    if (dbz <= 30) return [30, 58, 138];      // #1e3a8a
    if (dbz <= 40) return [4, 120, 87];       // #047857
    if (dbz <= 50) return [217, 119, 6];      // #d97706
    if (dbz <= 60) return [220, 38, 38];      // #dc2626
    return [112, 26, 117];                    // #701a75
  }

  if (theme === "retro") {
    if (dbz <= 15) return [4, 31, 15];        // #041f0f
    if (dbz <= 30) return [20, 83, 45];       // #14532d
    if (dbz <= 40) return [21, 128, 61];      // #15803d
    if (dbz <= 50) return [34, 197, 94];      // #22c55e
    if (dbz <= 60) return [74, 222, 128];     // #4ade80
    return [134, 239, 172];                   // #86efac
  }

  return null;
}

self.onmessage = function (e) {
  const { buffer, width, height, theme = "default" } = e.data;
  const data = new Uint8ClampedArray(buffer);

  // If theme is "default", the image is already rendered in authentic GarbinWx palette.
  // Only filter nearly transparent background noise pixels.
  if (theme === "default") {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 10) {
        data[i + 3] = 0;
      }
    }
    self.postMessage({ buffer: data.buffer, width, height }, [data.buffer]);
    return;
  }

  // If theme is "clean", filter out grayscale radar clutter (1 to 15 dBZ)
  if (theme === "clean") {
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 10) {
        data[i + 3] = 0;
        continue;
      }
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Grayscale clutter detection: r, g, b are almost identical and within 1-15 dBZ range
      if (Math.abs(r - g) <= 5 && Math.abs(g - b) <= 5 && r >= 70 && r <= 220) {
        data[i + 3] = 0; // Make clutter transparent
      }
    }
    self.postMessage({ buffer: data.buffer, width, height }, [data.buffer]);
    return;
  }

  // For creative themes (storm, vaporwave, retro), remap colors cleanly
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 10) {
      data[i + 3] = 0;
      continue;
    }

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const dbz = estimateDbz(r, g, b);
    if (dbz > 0) {
      const mappedRgb = getThemeRgb(dbz, theme);
      if (mappedRgb) {
        data[i]     = mappedRgb[0];
        data[i + 1] = mappedRgb[1];
        data[i + 2] = mappedRgb[2];
      }
    }
  }

  self.postMessage({ buffer: data.buffer, width, height }, [data.buffer]);
};
