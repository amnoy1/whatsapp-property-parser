'use strict';

const { createClient } = require('@supabase/supabase-js');

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  return createClient(url, key);
}

const STREET_PREFIX_RE = /^(רחוב|רח'|רח|שדרות|שד'|שד|דרך|סמטת|סמטה|פינת|פינה|משעול|כיכר|שכונת)\s+/i;

/**
 * Normalize Hebrew abbreviation marks, apostrophes and the maqaf (a Hebrew
 * hyphen, U+05BE, e.g. "בר־אילן") to standard ASCII / plain space.
 * "רמב״ם" → "רמב"ם", "רח׳" → "רח'", "בר־אילן" → "בר אילן"
 */
function normalizeQuotes(name) {
  if (!name) return name;
  return name
    .replace(/״/g, '"')   // gershayim (U+05F4) → "
    .replace(/׳/g, "'")   // geresh    (U+05F3) → '
    .replace(/־/g, ' ');  // maqaf     (U+05BE) → space
}

/**
 * Extract the primary street name from a full address string.
 * Handles all common Hebrew prefixes including משעול, כיכר.
 * Normalizes Unicode apostrophes/maqaf before prefix matching.
 * Strips a house number wherever it appears, including when followed by
 * descriptive text (e.g. "12 קדמת הדרים" — a floor/position qualifier).
 *
 * "רחוב שיפר 12"              → "שיפר"
 * "רח׳ ששת הימים 51"          → "ששת הימים"  (then looked up as "שדרות ששת הימים")
 * "משעול הסובלנות 7"           → "הסובלנות"
 * "רחוב אז״ר פינת תל חי"      → "אז"ר פינת תל חי"  (corner handled separately)
 * "הכלנית 28 ב'"               → "הכלנית"
 * "השיקמה 12 קדמת הדרים"      → "השיקמה"
 */
function extractStreetName(address) {
  if (!address) return null;
  let street = normalizeQuotes(address)
    .trim()
    // Remove city suffix (everything after comma)
    .replace(/,.*$/, '')
    .trim()
    // Remove common Hebrew street prefixes
    .replace(STREET_PREFIX_RE, '')
    .trim()
    // Remove house number, and any trailing qualifier text after it:
    // "12", "12א", "12 ב'", "12/3", "12 קדמת הדרים"
    .replace(/\s+\d+(\s*[א-ת]'?)?(\s*\/\s*\d+)?(\s+.*)?$/, '')
    .trim();
  return street || null;
}

/**
 * Return all candidate street names to try for a given address.
 * Handles:
 * - Regular street: "שיפר 12"         → ["שיפר"]
 * - Corner street: "X פינת Y"         → ["X פינת Y", "X", "Y"]
 * - "שכונת הפארק" (neighborhood name) → ["הפארק"]
 * - Punctuation variants: "ביל"ו"     → also tries "בילו" (no punctuation)
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
    .replace(/\s+\d+(\s*[א-ת]'?)?(\s*\/\s*\d+)?(\s+.*)?$/, '').trim();
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

  // Strip ALL internal quote/apostrophe characters, not just a trailing one:
  // "ביל"ו" → "בילו" (matches a table entry stored with no punctuation at all)
  const withoutAnyQuotes = base.replace(/["'׳״]/g, '');
  if (withoutAnyQuotes !== base) candidates.add(withoutAnyQuotes);

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
 * Given a street name as stored in street_neighborhoods, return every form an
 * incoming address might use to refer to it: ה/non-ה, with/without its own
 * street-type prefix (a table row stored as "סמטת אביבים" also matches an
 * address that just says "אביבים"), and with/without internal punctuation.
 * This is the table-side mirror of candidateStreets() above — it exists
 * because a table entry can carry a prefix or punctuation the source address
 * never had, so guessing only from the address side misses real matches.
 */
function expandStreetVariants(rawName) {
  if (!rawName) return new Set();
  const base = normalizeQuotes(rawName).trim();
  const names = new Set();
  const addAll = (n) => { for (const v of streetVariants(n)) names.add(v); };

  addAll(base);
  const stripped = base.replace(STREET_PREFIX_RE, '').trim();
  if (stripped && stripped !== base) addAll(stripped);

  for (const n of [...names]) {
    const clean = n.replace(/[''׳]+$/, '');
    if (clean !== n) names.add(clean);
    const noQuotes = n.replace(/["'׳״]/g, '');
    if (noQuotes !== n) names.add(noQuotes);
  }
  return names;
}

/**
 * Enrich properties that have no neighborhood by looking up the street name
 * in the street_neighborhoods Supabase table.
 *
 * Rules:
 * - Handles ה"א הידיעה: "כלנית" ↔ "הכלנית"
 * - Handles Hebrew quote/maqaf normalization: ״/׳/־ ↔ "/'/space
 * - Handles "רח׳" / "משעול" / "כיכר" prefixes on either side (address or table row)
 * - Handles corner streets: "X פינת Y" → tries X and Y separately
 * - City-aware: the lookup key is `city::street`, so a city with no rows
 *   in street_neighborhoods simply produces no match — no per-city gate needed
 *
 * Fetches the whole table for the cities actually needed (it's a curated,
 * hand-maintained table — a few hundred rows total) and matches in memory,
 * rather than querying by guessed street-name variants: a table row can carry
 * a prefix or punctuation no address candidate would ever produce, so that
 * approach systematically missed real matches.
 *
 * @param {Array} properties  — mutated in-place
 * @returns {Promise<number>} count of properties that got a neighborhood
 */
async function enrichNeighborhoodsFromDB(properties) {
  const needsLookup = properties.filter(p => !p.neighborhood && p.address);
  if (needsLookup.length === 0) return 0;

  const cities = [...new Set(needsLookup.map(p => p.city || 'כפר סבא'))];

  try {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('street_neighborhoods')
      .select('city, street, neighborhood')
      .in('city', cities);

    if (error) {
      console.error('[neighborhood-lookup] Supabase query failed:', error.message);
      return 0;
    }
    if (!data || data.length === 0) return 0;

    // Build lookup map: every table row contributes all its name variants.
    const lookupMap = new Map();
    for (const row of data) {
      for (const variant of expandStreetVariants(row.street)) {
        const key = `${row.city}::${variant}`;
        if (!lookupMap.has(key)) lookupMap.set(key, row.neighborhood);
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
  } catch (err) {
    console.error('[neighborhood-lookup] enrichNeighborhoodsFromDB failed:', err.message);
    return 0;
  }
}

/**
 * Return the set of cities that already have at least one curated row in
 * street_neighborhoods — used to decide which cities are manually maintained
 * (never auto-written to) vs. eligible for geocoding self-heal.
 * @returns {Promise<Set<string>>}
 */
async function getCitiesWithCoverage() {
  try {
    const supabase = getClient();
    const { data, error } = await supabase.from('street_neighborhoods').select('city');
    if (error) {
      console.error('[neighborhood-lookup] getCitiesWithCoverage failed:', error.message);
      return new Set();
    }
    return new Set((data || []).map(row => row.city));
  } catch (err) {
    console.error('[neighborhood-lookup] getCitiesWithCoverage failed:', err.message);
    return new Set();
  }
}

/**
 * Upsert one curated street→neighborhood mapping (city+street is the unique key).
 */
async function saveStreetNeighborhood(city, street, neighborhood) {
  try {
    const supabase = getClient();
    const { error } = await supabase
      .from('street_neighborhoods')
      .upsert({ city, street, neighborhood }, { onConflict: 'city,street' });
    if (error) console.error('[neighborhood-lookup] saveStreetNeighborhood failed:', error.message);
  } catch (err) {
    console.error('[neighborhood-lookup] saveStreetNeighborhood failed:', err.message);
  }
}

module.exports = {
  enrichNeighborhoodsFromDB,
  extractStreetName,
  candidateStreets,
  candidateStreetsFromAddress,
  streetVariants,
  expandStreetVariants,
  getCitiesWithCoverage,
  saveStreetNeighborhood,
};
