'use strict';

const { createClient } = require('@supabase/supabase-js');
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

/**
 * Re-check every already-stored property that still has no neighborhood
 * against the current street_neighborhoods table (curated lookup + geocoding
 * fallback, same pipeline as enrichAllNeighborhoods). Catches the case a
 * property was ingested before its street was added to the curated table —
 * enrichment only ever ran once, at ingestion time, so without this it would
 * stay null forever even after the table catches up.
 *
 * @returns {Promise<{fetched: number, dbFound: number, geocoded: number, healed: number, updated: number}>}
 */
async function backfillMissingNeighborhoods() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: props, error } = await supabase
    .from('whatsapp_properties')
    .select('id, address, city, neighborhood')
    .is('neighborhood', null)
    .not('address', 'is', null);

  if (error) throw new Error(`[backfill] Fetch failed: ${error.message}`);
  if (props.length === 0) return { fetched: 0, dbFound: 0, geocoded: 0, healed: 0, updated: 0 };

  const { dbFound, geocoded, healed } = await enrichAllNeighborhoods(props);

  const toUpdate = props.filter(p => p.neighborhood);
  for (const prop of toUpdate) {
    const { error: upErr } = await supabase
      .from('whatsapp_properties')
      .update({ neighborhood: prop.neighborhood })
      .eq('id', prop.id);
    if (upErr) console.error(`[backfill] Failed to update ${prop.id}: ${upErr.message}`);
  }

  return { fetched: props.length, dbFound, geocoded, healed, updated: toUpdate.length };
}

module.exports = { enrichAllNeighborhoods, selectHealCandidates, backfillMissingNeighborhoods };
