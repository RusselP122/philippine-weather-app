const PAGASA_NAMES = [
    "ADA", "BASYANG", "CALOY", "DOMENG", "ESTER",
    "FRANCISCO", "GARDO", "HENRY", "INDAY", "JOSIE",
    "KIYAPO", "LUIS", "MAYMAY", "NENENG", "OBET",
    "PILANDOK", "QUEENIE", "ROSAL", "SAMUEL", "TOMAS",
    "UMBERTO", "VENUS", "WALDO", "YAYANG", "ZENY"
];

const AUX_NAMES = [
    "AGILA", "BAGWIS", "CHITO", "DIEGO", "ELENA",
    "FELINO", "GUNDING", "HARRIET", "INDANG", "JESSA"
];

// Map 2026 storms entering PAR to their official PAGASA name sequence (17W = OBET)
const PAR_STORM_PAGASA_MAP = {
    17: "OBET",
    18: "PILANDOK",
    19: "QUEENIE",
    20: "ROSAL",
    21: "SAMUEL",
    22: "TOMAS",
    23: "UMBERTO",
    24: "VENUS",
    25: "WALDO",
    26: "YAYANG",
    27: "ZENY"
};

const normalizeId = (id) => {
    let clean = (id || "").trim().toUpperCase();
    if (!clean) return "";

    // Remove prefixes like "TC " or "TC"
    clean = clean.replace(/^TC\s+/, "").replace(/^TC/, "").trim();

    // Check if it matches long ATCF format: "WP092026"
    if (/^[A-Z]{2}\d{2,3}\d{4}$/.test(clean)) {
        return clean;
    }

    // Check if it matches short format: e.g. "WP09", "WP97"
    const shortLongMatch = clean.match(/^([A-Z]{2})(\d{2,3})$/);
    if (shortLongMatch) {
        const year = new Date().getFullYear() || 2026;
        return `${shortLongMatch[1]}${shortLongMatch[2]}${year}`;
    }

    // Check if it matches numbers only: e.g. "09", "97"
    if (/^\d{2,3}$/.test(clean)) {
        const year = new Date().getFullYear() || 2026;
        return `WP${clean}${year}`;
    }

    // Check if it matches shorthand like "09W" or "97W"
    const shortMatch = clean.match(/^(\d{2,3})([A-Z])$/);
    if (shortMatch) {
        const num = shortMatch[1];
        const basinLetter = shortMatch[2];
        let basinCode = "WP";
        if (basinLetter === "E") basinCode = "EP";
        else if (basinLetter === "C") basinCode = "CP";
        else if (basinLetter === "L") basinCode = "AL";
        const year = new Date().getFullYear() || 2026;
        return `${basinCode}${num}${year}`;
    }

    return clean;
};

export const getAssignedPagasaName = (stormId) => {
    const normalized = normalizeId(stormId);
    const match = normalized.match(/^[A-Z]{2}(\d{2,3})\d{4}$/);
    if (!match) return null;

    const stormNum = parseInt(match[1], 10);
    if (isNaN(stormNum) || stormNum <= 0) return null;

    // Skip Invest numbers (90-99)
    if (stormNum >= 90 && stormNum <= 99) return null;

    // 1. Check if mapped to PAR sequence (17W = OBET)
    if (PAR_STORM_PAGASA_MAP[stormNum]) {
        return PAR_STORM_PAGASA_MAP[stormNum];
    }

    // 2. Fallback to standard 1-to-1 index matching
    const index = stormNum - 1;
    if (index < PAGASA_NAMES.length) {
        return PAGASA_NAMES[index];
    }

    const auxIndex = index - PAGASA_NAMES.length;
    if (auxIndex < AUX_NAMES.length) {
        return AUX_NAMES[auxIndex];
    }

    return null;
};

export const assignPagasaName = (stormId) => {
    return getAssignedPagasaName(stormId);
};

export const getStormDisplayName = (rawName, classificationCode, insidePar, stormId) => {
    // 1. Basic cleaning
    const upperRaw = (rawName || "").trim().toUpperCase();
    const cleanId = (stormId || "").trim().toUpperCase();

    const isInvestNum = (str) => {
        const m = str.match(/\d{2}/);
        return m ? (parseInt(m[0], 10) >= 90 && parseInt(m[0], 10) <= 99) : false;
    };

    const isInvest = upperRaw.includes("INVEST") || isInvestNum(upperRaw) || isInvestNum(cleanId);

    // 2. Handle INVEST / LPA - usually no name needed, just generic label
    if (!upperRaw || isInvest || classificationCode === "LPA") {
        if (isInvest) {
            let num = "90";
            let letter = "W";

            // Try to extract from stormId first
            if (cleanId) {
                // e.g. "WP902026"
                let m = cleanId.match(/^([A-Z]{2})(\d{2})\d{4}$/);
                if (m) {
                    num = m[2];
                    letter = m[1] === 'WP' ? 'W' : m[1].charAt(0);
                } else {
                    // e.g. "90W"
                    m = cleanId.match(/^(\d{2})([A-Z])$/);
                    if (m) {
                        num = m[1];
                        letter = m[2];
                    } else {
                        // e.g. "WP90"
                        m = cleanId.match(/^([A-Z]{2})(\d{2})$/);
                        if (m) {
                            num = m[2];
                            letter = m[1] === 'WP' ? 'W' : m[1].charAt(0);
                        } else {
                            // e.g. "90"
                            m = cleanId.match(/^(\d{2})$/);
                            if (m) {
                                num = m[1];
                            }
                        }
                    }
                }
            } else {
                // Try to extract from upperRaw
                let m = upperRaw.match(/(\d{2})([A-Z])?/);
                if (m) {
                    num = m[1];
                    if (m[2]) letter = m[2];
                }
            }
            return { displayName: `${num}${letter} INVEST`, intlName: null, pagasaName: null };
        }
        return { displayName: "Low Pressure Area", intlName: null, pagasaName: null };
    }

    // 3. Determine International Name
    const genericTerms = [
        "INVEST", "NONAME", "UNKNOWN", "STORM", "NULL", "NONE", "LPA",
        "LOW PRESSURE AREA", "TROPICAL DISTURBANCE", "TROPICAL DEPRESSION"
    ];
    const isGeneric = genericTerms.some(term => upperRaw.includes(term));
    const isJustTcCode = /^(TC\s*)?\d{2}[A-Z]?$/i.test(upperRaw);
    
    let intlName = rawName;
    let formattedIntl = rawName;
    if (rawName && !isGeneric && !isJustTcCode) {
        formattedIntl = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();
    }

    // CASE A: Outside PAR -> Only storms that enter PAR have a PAGASA name
    if (!insidePar) {
        return { displayName: rawName || cleanId || "Tropical Cyclone", intlName: rawName, pagasaName: null };
    }

    // CASE B: Inside PAR -> Storm inside PAR receives assigned PAGASA name
    let pagasaName = getAssignedPagasaName(stormId);
    const upperPagasa = pagasaName ? pagasaName.toUpperCase() : null;

    if (classificationCode === "TD") {
        if (upperPagasa) {
            return { displayName: upperPagasa, intlName, pagasaName: upperPagasa };
        }
        return { displayName: "Tropical Depression", intlName, pagasaName: null };
    }

    if (upperPagasa) {
        const isSelfNamed = upperRaw === cleanId || upperRaw === `TC ${cleanId}` || upperRaw === `TC${cleanId}` || upperRaw === upperPagasa;
        if (rawName && !isGeneric && !isJustTcCode && !isSelfNamed) {
            return {
                displayName: `${upperPagasa} (${formattedIntl})`,
                intlName: formattedIntl,
                pagasaName: upperPagasa
            };
        }
        return {
            displayName: upperPagasa,
            intlName,
            pagasaName: upperPagasa
        };
    }

    // Default fallback
    return { displayName: rawName || cleanId || "Tropical Cyclone", intlName, pagasaName: null };
};
