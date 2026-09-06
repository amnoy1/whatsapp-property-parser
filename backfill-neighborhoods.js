'use strict';

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { enrichAllNeighborhoods } = require('./src/neighborhood-enrichment');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  console.log('🔍 Fetching whatsapp_properties without neighborhood...');

  // Fetch all properties missing neighborhood
  const { data: props, error } = await supabase
    .from('whatsapp_properties')
    .select('id, address, city, neighborhood')
    .is('neighborhood', null)
    .not('address', 'is', null);

  if (error) throw new Error(`Fetch failed: ${error.message}`);
  console.log(`   Found ${props.length} properties without neighborhood`);
  if (props.length === 0) return;

  // Curated table lookup, then Google Geocoding fallback with self-heal
  // into street_neighborhoods for cities with no curated coverage yet.
  const { dbFound, geocoded, healed } = await enrichAllNeighborhoods(props);
  console.log(`   🏘️  Matched ${dbFound} neighborhoods from street table`);
  if (geocoded > 0) console.log(`   🗺️  Matched ${geocoded} more via Google Geocoding`);
  if (healed > 0) console.log(`   💾 Self-healed ${healed} mapping(s) into street_neighborhoods`);
  if (dbFound === 0 && geocoded === 0) return;

  // Update matched properties back to Supabase
  const toUpdate = props.filter(p => p.neighborhood);
  console.log(`   ⬆️  Updating ${toUpdate.length} rows in Supabase...`);

  for (const prop of toUpdate) {
    const { error: upErr } = await supabase
      .from('whatsapp_properties')
      .update({ neighborhood: prop.neighborhood })
      .eq('id', prop.id);
    if (upErr) console.error(`   ⚠️  Failed to update ${prop.id}: ${upErr.message}`);
  }

  console.log('✅ Done!');
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
