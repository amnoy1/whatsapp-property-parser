'use strict';

const https = require('https');

/**
 * Look up the neighborhood (sublocality) for a given address via Google Geocoding API.
 * Returns null if not found, API key is missing, or request fails.
 * @param {string} address
 * @param {string} city
 * @returns {Promise<string|null>}
 */
async function lookupNeighborhood(address, city) {
  const apiKey = process.env.GOOGLE_GEOCODING_KEY;
  if (!apiKey || !address) return null;

  const query   = encodeURIComponent(`${address}, ${city || 'כפר סבא'}, ישראל`);
  const url     = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${apiKey}&language=he&region=il`;

  try {
    const data   = await httpsGet(url);
    const result = data.results?.[0];
    if (!result) return null;

    const components = result.address_components || [];

    // Try these types in order of specificity
    for (const type of ['sublocality_level_1', 'sublocality', 'neighborhood']) {
      const comp = components.find(c => c.types.includes(type));
      if (comp) return comp.long_name;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Enrich an array of extracted property objects with neighborhoods (in place).
 * Only geocodes properties that don't already have a neighborhood.
 * @param {Array} properties   — mutable array from extractProperties()
 * @returns {Promise<number>}  — number of neighborhoods found
 */
async function enrichNeighborhoods(properties) {
  const toGeocode = properties.filter(p => !p.neighborhood && p.address);
  let found = 0;

  for (const prop of toGeocode) {
    const neighborhood = await lookupNeighborhood(prop.address, prop.city);
    if (neighborhood) {
      prop.neighborhood = neighborhood;
      found++;
    }
  }

  return found;
}

// ── internal ──────────────────────────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let raw = '';
      res.on('data', chunk => (raw += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

module.exports = { lookupNeighborhood, enrichNeighborhoods };
