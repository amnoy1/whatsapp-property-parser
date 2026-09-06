'use strict';

const {
  enrichNeighborhoodsFromDB,
  extractStreetName,
  getCitiesWithCoverage,
  saveStreetNeighborhood,
} = require('./neighborhood-lookup');
const { enrichNeighborhoods: geocodeNeighborhoods } = require('./geocoder');

/**
 * Given properties that Google Geocoding just resolved (already mutated with
 * .neighborhood) and the set of cities with existing curated coverage,
 * return the {city, street, neighborhood} rows that should be self-healed
 * into street_neighborhoods.
 *
 * Cities with existing coverage (e.g. כפר סבא) are maintained manually via
 * the admin panel and must never be auto-overwritten by a geocoding guess —
 * only cities with zero curated rows are eligible.
 */
function selectHealCandidates(geocodedProperties, coveredCities) {
  const candidates = [];
  for (const prop of geocodedProperties) {
    if (!prop.neighborhood || !prop.city || coveredCities.has(prop.city)) continue;
    const street = extractStreetName(prop.address);
    if (!street) continue;
    candidates.push({ city: prop.city, street, neighborhood: prop.neighborhood });
  }
  return candidates;
}

/**
 * Full neighborhood-enrichment pipeline: curated table lookup first, then
 * Google Geocoding as fallback for whatever remains. A geocoded result is
 * written back into street_neighborhoods only for cities with no curated
 * coverage yet, so cities like רעננה build up their own lookup table over
 * time instead of re-querying Google for the same street forever.
 *
 * @param {Array} properties — mutated in place
 * @returns {Promise<{dbFound: number, geocoded: number, healed: number}>}
 */
async function enrichAllNeighborhoods(properties) {
  const dbFound = await enrichNeighborhoodsFromDB(properties);

  let geocoded = 0;
  let healed = 0;

  if (process.env.GOOGLE_GEOCODING_KEY) {
    const preGeocode = properties.filter(p => !p.neighborhood && p.address);
    if (preGeocode.length > 0) {
      geocoded = await geocodeNeighborhoods(preGeocode);
      if (geocoded > 0) {
        const coveredCities = await getCitiesWithCoverage();
        const candidates = selectHealCandidates(preGeocode, coveredCities);
        for (const c of candidates) {
          await saveStreetNeighborhood(c.city, c.street, c.neighborhood);
          healed++;
        }
      }
    }
  }

  return { dbFound, geocoded, healed };
}

module.exports = { enrichAllNeighborhoods, selectHealCandidates };
