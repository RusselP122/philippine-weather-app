// api/earthquake-bulletin.js

const ROMAN_MAP = {
  'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5,
  'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10
};

function cleanIntensityText(text) {
  if (!text) return '';
  return text
    // Remove aftershock mentions, remarks, notes, or accidental instrumental headers
    .replace(/(?:(?:\s|\b|^)(?:\*+\s*)?(?:This\s+(?:is\s+an?|earthquake\s+is\s+an?|event\s+is\s+an?)\s+aftershock|Aftershock\s+of|Note\s*:|Remarks?\s*:|Inst?rumental\s*Intensit(?:y|ies)\s*:?).*$)/i, '')
    .trim();
}

function parsePlaces(rawText) {
  const items = [];
  const cleanRaw = cleanIntensityText(rawText);
  // Split by semicolon first
  const segments = cleanRaw.split(';').map(s => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const commaParts = seg.split(',').map(p => p.trim()).filter(Boolean);
    if (commaParts.length >= 2) {
      // The last element is usually the province: e.g. "ZAMBALES"
      let province = commaParts[commaParts.length - 1].replace(/\band\b/gi, '').trim();
      province = cleanIntensityText(province);
      const townsPart = commaParts.slice(0, commaParts.length - 1);
      for (const t of townsPart) {
        const subTowns = t.split(/\band\b/i).map(x => x.trim()).filter(Boolean);
        for (const st of subTowns) {
          const cleanTown = cleanIntensityText(st);
          if (cleanTown.length > 1 && !/(?:aftershock|earthquake|mainshock)/i.test(cleanTown)) {
            items.push({ name: cleanTown, province });
          }
        }
      }
    } else {
      // Single city like "CITY OF DAGUPAN" or "CITY OF OLONGAPO"
      const cleanTown = cleanIntensityText(seg);
      if (cleanTown.length > 1 && !/(?:aftershock|earthquake|mainshock)/i.test(cleanTown)) {
        items.push({ name: cleanTown, province: '' });
      }
    }
  }
  return items;
}

function parseIntensityLines(block) {
  const results = [];
  const intensityRegex = /Intensity\s+([IVXLCDM]+)\s*-\s*([^\n]+(?:\n(?!\s*(?:Intensity|Inst?rumental|Expecting|This\s+(?:is|earthquake|event)|Aftershock|Note:|Remarks?:))[^\n]+)*)/gi;
  let m;
  while ((m = intensityRegex.exec(block)) !== null) {
    const level = m[1].toUpperCase();
    let text = m[2].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    text = cleanIntensityText(text);
    if (!text) continue;
    const places = parsePlaces(text);
    results.push({
      level,
      value: ROMAN_MAP[level] || 1,
      raw_text: text,
      places
    });
  }
  return results;
}

export default async function handler(req, res) {
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    const urlObj = new URL(req.url, 'http://localhost');
    let bulletinUrl = req.query?.url || urlObj.searchParams.get('url');

    if (!bulletinUrl) {
      return res.status(400).json({ error: 'Missing bulletin url parameter' });
    }

    if (!bulletinUrl.startsWith('http')) {
      bulletinUrl = `https://earthquake.phivolcs.dost.gov.ph/${bulletinUrl.replace(/^[\/\\]+/, '')}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(bulletinUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`PHIVOLCS responded with HTTP ${response.status}`);
    }

    const html = await response.text();

    // Clean html to plain text
    const clean = html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<xml[\s\S]*?<\/xml>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#160;/g, ' ');

    const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
    const fullText = lines.join('\n');

    // Extract metadata
    const dtMatch = fullText.match(/Date\/Time\s*:\s*([^\n]+)/i);
    const locMatch = fullText.match(/Location\s*:\s*([^\n]+)/i);
    const depthMatch = fullText.match(/Depth\s*(?:of\s*Focus)?\s*(?:\(Km\))?\s*:\s*([^\n]+)/i);
    const originMatch = fullText.match(/Origin\s*:\s*([^\n]+)/i);
    const magMatch = fullText.match(/Magnitude\s*:\s*([^\n]+)/i);
    const damageMatch = fullText.match(/Expecting\s*Damage\s*:\s*([^\n]+)/i);
    const aftershocksMatch = fullText.match(/Expecting\s*Aftershocks\s*:\s*([^\n]+)/i);
    const issuedMatch = fullText.match(/Issued\s*On\s*:\s*([^\n]+)/i);

    // Extract lat/lon from location if available
    let latitude = null;
    let longitude = null;
    let locationDescription = locMatch ? locMatch[1].trim().replace(/[\uFFFD\?º]/g, '°') : '';

    const coordMatch = locationDescription.match(/([\d\.]+)\s*(?:º|°|\?|\uFFFD)?\s*N[,\s]+([\d\.]+)\s*(?:º|°|\?|\uFFFD)?\s*E/i);
    if (coordMatch) {
      latitude = parseFloat(coordMatch[1]);
      longitude = parseFloat(coordMatch[2]);
    }

    // Extract Reported and Instrumental sections
    let reportedBlock = '';
    const reportedStart = fullText.search(/Reported\s*Intensit(?:y|ies)\s*:/i);
    const instrumentalStart = fullText.search(/Inst?rumental\s*Intensit(?:y|ies)\s*:/i);
    const expectingStart = fullText.search(/Expecting\s*Damage/i);

    if (reportedStart !== -1) {
      const end = instrumentalStart !== -1 ? instrumentalStart : (expectingStart !== -1 ? expectingStart : fullText.length);
      reportedBlock = fullText.slice(reportedStart, end);
    }

    let instrumentalBlock = '';
    if (instrumentalStart !== -1) {
      const end = expectingStart !== -1 ? expectingStart : fullText.length;
      instrumentalBlock = fullText.slice(instrumentalStart, end);
    }

    // Extract aftershock advisory/note if present in the bulletin
    let aftershockNote = null;
    const noteMatch = fullText.match(/(?:(?:\*+\s*)?(?:This\s+(?:is\s+an?|earthquake\s+is\s+an?|event\s+is\s+an?)\s+aftershock[^\n\r]*|Aftershock\s+of[^\n\r]*))/i);
    if (noteMatch) {
      aftershockNote = noteMatch[0].replace(/^\*+\s*/, '').trim();
    }

    const reportedIntensities = parseIntensityLines(reportedBlock);
    const instrumentalIntensities = parseIntensityLines(instrumentalBlock);

    // Build affected places map for easy lookup in the frontend
    const affectedPlaces = {};
    let maxIntensityValue = 0;
    let maxIntensityLevel = 'I';

    const registerPlace = (item, level, value, type) => {
      if (value > maxIntensityValue) {
        maxIntensityValue = value;
        maxIntensityLevel = level;
      }
      const rawTown = item.name.trim();
      const rawProv = item.province.trim();
      const normTown = rawTown.toLowerCase().replace(/city of|city/gi, '').replace(/[^a-z0-9]/g, '').trim();
      const normProv = rawProv.toLowerCase().replace(/[^a-z0-9]/g, '').trim();

      const existing = affectedPlaces[`${normTown}|${normProv}`] || affectedPlaces[normTown];
      // Keep higher intensity or prioritize Reported
      if (!existing || value > existing.value || (value === existing.value && type === 'Reported')) {
        const record = {
          name: rawTown,
          province: rawProv,
          level,
          value,
          type
        };
        affectedPlaces[`${normTown}|${normProv}`] = record;
        if (!affectedPlaces[normTown]) {
          affectedPlaces[normTown] = record;
        }
      }
    };

    // Process Reported first, then Instrumental
    for (const rep of reportedIntensities) {
      for (const p of rep.places) {
        registerPlace(p, rep.level, rep.value, 'Reported');
      }
    }

    for (const inst of instrumentalIntensities) {
      for (const p of inst.places) {
        registerPlace(p, inst.level, inst.value, 'Instrumental');
      }
    }

    const hasIntensities = (reportedIntensities.length > 0 || instrumentalIntensities.length > 0);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      bulletin_url: bulletinUrl,
      date_time: dtMatch ? dtMatch[1].trim() : null,
      location: locationDescription,
      latitude,
      longitude,
      depth_km: depthMatch ? parseFloat(depthMatch[1]) || null : null,
      origin: originMatch ? originMatch[1].trim() : null,
      magnitude: magMatch ? magMatch[1].trim() : null,
      expecting_damage: damageMatch ? damageMatch[1].trim() : 'NO',
      expecting_aftershocks: aftershocksMatch ? aftershocksMatch[1].trim() : 'NO',
      issued_on: issuedMatch ? issuedMatch[1].trim() : null,
      aftershock_note: aftershockNote,
      max_intensity_level: maxIntensityLevel,
      max_intensity_value: maxIntensityValue,
      reported_intensities: reportedIntensities,
      instrumental_intensities: instrumentalIntensities,
      affected_places: affectedPlaces,
      has_intensities: hasIntensities
    });

  } catch (err) {
    console.error('Bulletin Parse Error:', err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({
      error: 'Failed to parse earthquake bulletin',
      details: err.message
    });
  }
}
