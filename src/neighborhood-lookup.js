'use strict';

const { createClient } = require('@supabase/supabase-js');

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  return createClient(url, key);
}

/**
 * Normalize Hebrew abbreviation marks and apostrophes to standard ASCII.
 * "רמב״ם" → "רמב"ם", "רח׳" → "רח'"
 */
function normalizeQuotes(name) {
  if (!name) return name;
  return name
    .replace(/״/g, '"')   // gershayim (U+05F4) → "
    .replace(/׳/g, "'");  // geresh    (U+05F3) → '
}

/**
 * Extract the primary street name from a full address string.
 * Handles all common Hebrew prefixes including משעול, כיכר.
 * Normalizes Unicode apostrophes before prefix matching.
 *
 * "רחוב שיפר 12"              → "שיפר"
 * "רח׳ ששת הימים 51"          → "ששת הימים"  (then looked up as "שדרות ששת הימים")
 * "משעול הסובלנות 7"           → "הסובלנות"
 * "רחוב אז״ר פינת תל חי"      → "אז"ר פינת תל חי"  (corner handled separately)
 * "הכלנית 28 ב'"               → "הכלנית"
 */
function extractStreetName(address) {
  if (!address) return null;
  let street = normalizeQuotes(address)
    .trim()
    // Remove city suffix (everything after comma)
    .replace(/,.*$/, '')
    .trim()
    // Remove common Hebrew street prefixes
    .replace(/^(רחוב|רח'|רח|שדרות|שד'|שד|דרך|סמטת|סמטה|פינת|פינה|משעול|כיכר|שכונת)\s+/i, '')
    .trim()
    // Remove house number at end: "12", "12א", "12 ב'", "12/3"
    .replace(/\s+\d+(\s*[א-ת]'?)?(\s*\/\s*\d+)?$/, '')
    .trim();
  return street || null;
}

/**
 * Return all candidate street names to try for a given address.
 * Handles:
 * - Regular street: "שיפר 12"         → ["שיפר"]
 * - Corner street: "X פינת Y"         → ["X פינת Y", "X", "Y"]
 * - "שכונת הפארק" (neighborhood name) → ["הפארק"]
 */
function candidateStreets(address) {
  if (!address) return [];
  const base = extractStreetName(address);
  if (!base) return [];

  const candidates = new Set([base]);

  // Also keep the name BEFORE prefix stripping (e.g. "משעול האהבה" not just "האהבה")
  // so that table entries stored with their prefix (e.g. "משעול האהבה") can still match
  const beforeStrip = normalizeQuotes(address.trim())
    .replace(/,.*$/, '').trim()
    .replace(/\s+\d+(\s*[א-ת]'?)?(\s*\/\s*\d+)?$/, '').trim();
  if (beforeStrip && beforeStrip !== base) candidates.add(beforeStrip);

  // Corner streets: "X פינת Y" → also try X alone and Y alone
  const corner = base.match(/^(.+?)\s+פינת\s+(.+)$/);
  if (corner) {
    candidates.add(corner[1].trim());
    candidates.add(corner[2].trim());
  }

  // Progressive shortening: "לוונברג הירוקה" → also try "לוונברג"
  // Removes trailing words one at a time (handles neighborhood qualifiers embedded in address)
  const words = base.split(/\s+/);
  if (words.length > 1) {
    for (let i = words.length - 1; i >= 1; i--) {
      candidates.add(words.slice(0, i).join(' '));
    }
  }

  // Strip trailing apostrophe: "אהרונוביץ'" → "אהרונוביץ"
  const withoutTrailingApostrophe = base.replace(/[''׳]+$/, '');
  if (withoutTrailingApostrophe !== base) candidates.add(withoutTrailingApostrophe);

  return [...candidates];
}

/**
 * Extract all candidate street names from an address that may contain
 * multiple parts (e.g. "משקיף לפארק, משעול האהבה").
 * Handles comma-separated multi-part addresses by trying each segment.
 */
function candidateStreetsFromAddress(address) {
  if (!address) return [];
  // Split on comma — each part may be a street or a city
  const parts = address.split(',').map(s => s.trim()).filter(Boolean);
  const all = new Set();
  for (const part of parts) {
    for (const c of candidateStreets(part)) all.add(c);
  }
  return [...all];
}

/**
 * Return both variants of a street name: with and without leading ה (definite article).
 * "כלנית"  → ["כלנית",  "הכלנית"]
 * "הכלנית" → ["הכלנית", "כלנית"]
 */
function streetVariants(name) {
  if (!name) return [];
  const n = normalizeQuotes(name);
  if (n.startsWith('ה') && n.length > 1) return [n, n.slice(1)];
  return [n, 'ה' + n];
}

/**
 * Enrich properties that have no neighborhood by looking up the street name
 * in the street_neighborhoods Supabase table.
 *
 * Rules:
 * - Handles ה"א הידיעה: "כלנית" ↔ "הכלנית"
 * - Handles Hebrew quote normalization: ״/׳ ↔ "/′
 * - Handles "רח׳" / "משעול" / "כיכר" prefixes
 * - Handles corner streets: "X פינת Y" → tries X and Y separately
 * - Does NOT assign neighborhood to non-כפר-סבא cities
 *
 * @param {Array} properties  — mutated in-place
 * @returns {Promise<number>} count of properties that got a neighborhood
 */
async function enrichNeighborhoodsFromDB(properties) {
  const needsLookup = properties.filter(p => !p.neighborhood && p.address);
  if (needsLookup.length === 0) return 0;

  // Collect all unique candidate street names (including corner variants)
  const allCandidates = [...new Set(
    needsLookup.flatMap(p => candidateStreetsFromAddress(p.address))
  )];
  // Include ה variants + apostrophe-suffixed variants for each candidate
  // (handles stored names like "אהרונוביץ'" when extracted as "אהרונוביץ")
  const allVariants = [...new Set([
    ...allCandidates.flatMap(streetVariants),
    ...allCandidates.flatMap(c => [`${c}'`, `${c}׳`]),
  ])];

  if (allVariants.length === 0) return 0;

  try {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('street_neighborhoods')
      .select('city, street, neighborhood')
      .in('street', allVariants);

    if (error || !data || data.length === 0) return 0;

    // Build lookup map for both variants of every stored street.
    // Also adds version without trailing apostrophe so "אהרונוביץ'" matches "אהרונוביץ".
    const lookupMap = new Map();
    for (const row of data) {
      for (const variant of streetVariants(row.street)) {
        const key = `${row.city}::${variant}`;
        if (!lookupMap.has(key)) lookupMap.set(key, row.neighborhood);
        // also without trailing apostrophe
        const clean = variant.replace(/[''׳]+$/, '');
        if (clean !== variant) {
          const cleanKey = `${row.city}::${clean}`;
          if (!lookupMap.has(cleanKey)) lookupMap.set(cleanKey, row.neighborhood);
        }
      }
    }

    const resolve = (streetName, city) => {
      for (const variant of streetVariants(streetName)) {
        const n = lookupMap.get(`${city}::${variant}`);
        if (n) return n;
      }
      return null;
    };

    let found = 0;
    for (const prop of needsLookup) {
      const city = prop.city || 'כפר סבא';
      // Only look up כפר סבא — other cities have no mapping yet
      if (city !== 'כפר סבא') continue;

      const candidates = candidateStreetsFromAddress(prop.address);
      let neighborhood = null;
      for (const candidate of candidates) {
        neighborhood = resolve(candidate, city);
        if (neighborhood) break;
      }

      if (neighborhood) {
        prop.neighborhood = neighborhood;
        found++;
      }
    }
    return found;
  } catch {
    return 0;
  }
}

module.exports = { enrichNeighborhoodsFromDB };
