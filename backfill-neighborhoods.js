'use strict';

require('dotenv').config();

const { backfillMissingNeighborhoods } = require('./src/neighborhood-enrichment');

async function main() {
  console.log('🔍 Fetching whatsapp_properties without neighborhood...');

  const { fetched, dbFound, geocoded, healed, updated } = await backfillMissingNeighborhoods();

  console.log(`   Found ${fetched} properties without neighborhood`);
  if (fetched === 0) return;

  console.log(`   🏘️  Matched ${dbFound} neighborhoods from street table`);
  if (geocoded > 0) console.log(`   🗺️  Matched ${geocoded} more via Google Geocoding`);
  if (healed > 0) console.log(`   💾 Self-healed ${healed} mapping(s) into street_neighborhoods`);
  if (updated === 0) return;

  console.log(`   ⬆️  Updated ${updated} rows in Supabase...`);
  console.log('✅ Done!');
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
