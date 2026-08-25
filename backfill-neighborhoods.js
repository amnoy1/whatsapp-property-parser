'use strict';

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { enrichNeighborhoodsFromDB } = require('./src/neighborhood-lookup');

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

  // Run the DB lookup (mutates neighborhood in-place)
  const found = await enrichNeighborhoodsFromDB(props);
  console.log(`   🏘️  Matched ${found} neighborhoods from street table`);
  if (found === 0) return;

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
