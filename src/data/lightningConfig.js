// Robust Philippine Standard Time (UTC+8) manual parser
export const parsePHDateToMs = (dateStr) => {
  if (!dateStr) return 0;
  try {
    const parts = dateStr.trim().split(" ");
    if (parts.length !== 2) return 0;
    const dateParts = parts[0].split("-");
    const timeParts = parts[1].split(":");
    if (dateParts.length !== 3 || timeParts.length !== 3) return 0;

    const year = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1;
    const day = parseInt(dateParts[2], 10);
    const hour = parseInt(timeParts[0], 10);
    const minute = parseInt(timeParts[1], 10);
    const second = parseInt(timeParts[2], 10);

    // PH time is UTC+8, so subtract 8 hours to get UTC representation
    return Date.UTC(year, month, day, hour - 8, minute, second);
  } catch (e) {
    return 0;
  }
};

export const getStrikeColor = (ageMs) => {
  const ageMin = ageMs / 60000;
  if (ageMin <= 5) return "#ef4444"; // Bright red
  if (ageMin <= 10) return "#f97316"; // Orange
  if (ageMin <= 20) return "#eab308"; // Yellow
  if (ageMin <= 30) return "#84cc16"; // Light green
  if (ageMin <= 40) return "#22c55e"; // Green
  if (ageMin <= 50) return "#06b6d4"; // Cyan
  if (ageMin <= 90) return "#3b82f6"; // Blue
  return null;
};

export const getAgeRangeLabel = (val) => {
  if (val === 1) return "Live (<1m)";
  return `${val}m`;
};

export const getIslandGroup = (region) => {
  if (!region) return "Luzon";
  const r = region.toLowerCase();
  if (r.includes("visayas")) return "Visayas";
  if (
    r.includes("zamboanga") ||
    r.includes("mindanao") ||
    r.includes("davao") ||
    r.includes("soccsksargen") ||
    r.includes("caraga") ||
    r.includes("bangsamoro") ||
    r.includes("muslim")
  ) {
    return "Mindanao";
  }
  return "Luzon";
};
