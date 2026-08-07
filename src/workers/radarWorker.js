// Web Worker for processing high-fidelity dynamic pixel color swapping
self.onmessage = function (e) {
  const { buffer, width, height, theme } = e.data;
  const data = new Uint8ClampedArray(buffer);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a < 15) continue; // Skip transparent pixels

    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;

    // Skip white/grey outlines/labels and radar clutter (non-colorful pixels)
    if (saturation < 0.22 || (r > 170 && g > 170 && b > 170 && saturation < 0.16)) {
      continue;
    }

    // Classify PAGASA storm cell colors
    let colorType = "green"; // Light rain default
    if (g > 200 && b > 200 && r > 100 && r < 160) {
      colorType = "clutter";
    } else if (r > 150 && b > 150 && g < 135) {
      colorType = "purple";
    } else if (r > 140 && g < 50 && b < 50) {
      colorType = "red";
    } else if (r > 200 && g > 120 && b < 100) {
      colorType = "yellow";
    } else if (b > g && b > r * 0.9) {
      colorType = "blue";
    } else if (g > r && g > b) {
      colorType = "green";
    }

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
    } else if (theme === "custom") {
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
