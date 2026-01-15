const PAGASA_NAMES = [
    "ADA", "BASYANG", "CALOY", "DOMENG", "ESTER",
    "FRANCISCO", "GARDO", "HENRY", "INDAY", "JOSIE",
    "KIYAPO", "LUIS", "MAYMAY", "NENENG", "OBET",
    "PILANDOK", "QUEENIE", "ROSAL", "SAMUEL", "TOMAS",
    "UMBERTO", "VENUS", "WALDO", "YAYANG", "ZENY"
];

// Keys for persistence
const STORAGE_KEY_ASSIGNMENTS = "pagasa_assignments_2026";
const STORAGE_KEY_INDEX = "pagasa_next_index_2026";

// In-memory cache to reduce localStorage reads
let assignmentsCache = null;
let nextIndexCache = null;

const loadState = () => {
    if (assignmentsCache && nextIndexCache !== null) return;

    try {
        const savedAssignments = localStorage.getItem(STORAGE_KEY_ASSIGNMENTS);
        assignmentsCache = savedAssignments ? JSON.parse(savedAssignments) : {};

        const savedIndex = localStorage.getItem(STORAGE_KEY_INDEX);
        nextIndexCache = savedIndex ? parseInt(savedIndex, 10) : 0;
    } catch (e) {
        console.error("Error loading PAGASA naming state:", e);
        assignmentsCache = {};
        nextIndexCache = 0;
    }
};

const saveState = () => {
    try {
        localStorage.setItem(STORAGE_KEY_ASSIGNMENTS, JSON.stringify(assignmentsCache));
        localStorage.setItem(STORAGE_KEY_INDEX, nextIndexCache.toString());
    } catch (e) {
        console.error("Error saving PAGASA naming state:", e);
    }
};

const normalizeId = (id) => (id || "").trim().toUpperCase();

export const getAssignedPagasaName = (stormId) => {
    loadState();
    const id = normalizeId(stormId);
    return assignmentsCache[id] || null;
};

export const assignPagasaName = (stormId) => {
    loadState();
    const id = normalizeId(stormId);

    // If already assigned, return it
    if (assignmentsCache[id]) {
        return assignmentsCache[id];
    }

    // If we ran out of names, return null or handle auxiliary list (simplified to null for now)
    if (nextIndexCache >= PAGASA_NAMES.length) {
        return null;
    }

    // Assign next name
    const name = PAGASA_NAMES[nextIndexCache];
    assignmentsCache[id] = name;
    nextIndexCache++;

    saveState();
    return name;
};

export const getStormDisplayName = (rawName, classificationCode, insidePar, stormId) => {
    // 1. Basic cleaning
    const upperRaw = (rawName || "").trim().toUpperCase();

    // 2. Handle INVEST / LPA - usually no name needed, just generic label
    if (!upperRaw || upperRaw.includes("INVEST") || classificationCode === "LPA") {
        // If user specific logic for INVEST naming exists, keep it here or return generic
        // For now, returning generic based on previous code
        if (upperRaw.includes("INVEST")) {
            // Try to parse ATCF ID if available to make it look nicer (e.g. "Invest 90W")
            if (stormId) {
                const match = stormId.match(/^([a-zA-Z]{2})(\d{2})\d{4}$/);
                if (match) {
                    const basinRaw = match[1].toLowerCase();
                    const num = match[2];
                    let letter = basinRaw === 'wp' ? 'W' : basinRaw.toUpperCase().charAt(0);
                    return { displayName: `Invest ${num}${letter}`, intlName: null, pagasaName: null };
                }
            }
            return { displayName: rawName, intlName: null, pagasaName: null };
        }
        return { displayName: "Low Pressure Area", intlName: null, pagasaName: null };
    }

    // 3. Determine International Name
    let intlName = rawName; // Default to raw name from feed

    // 4. Determine PAGASA Name
    let pagasaName = getAssignedPagasaName(stormId);

    // If inside PAR and not yet assigned, assign one!
    // Condition: Must be at least TD to get a name? 
    // User said "enter par first alphabet which is ada". Usually implies TD or higher.
    // We will assign if it's classified as TD or higher AND inside PAR.
    // OR if it was already assigned (handled by getAssignedPagasaName check above? no, that just retrieves).

    const isTropicalCyclone = ["TD", "TS", "STS", "TY", "STY"].includes(classificationCode);

    if (insidePar && isTropicalCyclone && !pagasaName) {
        pagasaName = assignPagasaName(stormId);
    }

    // Format the PAGASA name (Title Case: ADA -> Ada)
    const formatName = (n) => n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : null;
    const formattedPagasa = formatName(pagasaName);

    // 5. Build Display Name based on rules

    // CASE A: Outside PAR
    if (!insidePar) {
        // "pagasa name will it gone... international name stays"
        return { displayName: intlName, intlName, pagasaName: null };
    }

    // CASE B: Inside PAR

    // If TD, we might ONLY have the PAGASA name (international bodies might just call it TD 01W)
    // If the raw name looks like a generic ID (e.g., "TD 03W"), and we have a PAGASA name, prefer PAGASA.
    if (classificationCode === "TD") {
        if (formattedPagasa) {
            return { displayName: formattedPagasa, intlName, pagasaName: formattedPagasa };
        }
        // If no PAGASA name (e.g. unnamed for some reason), fallback
        return { displayName: "Tropical Depression", intlName, pagasaName: null };
    }

    // If TS or stronger
    if (["TS", "STS", "TY", "STY"].includes(classificationCode)) {
        if (formattedPagasa) {
            // "Combine: International Name (PAGASA Name)" or "PAGASA Name (International Name)"
            // User: "put also the internation name if became TS like tropical storm ada ( )"
            // We'll follow: "PAGASA Name (International Name)"
            // But wait, if RawName IS the international name?
            // If the raw name IS the PAGASA name (sometimes feeds do that), detect it?
            // Assuming rawName is International from the source (e.g., YAGI).

            return {
                displayName: `${formattedPagasa} (${intlName})`,
                intlName,
                pagasaName: formattedPagasa
            };
        }
    }

    // Default fallback
    return { displayName: intlName, intlName, pagasaName: formattedPagasa };
};
