'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const { data, error } = await sb
    .from('whatsapp_properties')
    .select('address, city')
    .is('neighborhood', null)
    .not('address', 'is', null);

  if (error) { console.error(error.message); return; }

  const byCity = {};
  for (const r of data) {
    const city = r.city || 'לא ידוע';
    if (!byCity[city]) byCity[city] = [];
    byCity[city].push(r.address);
  }

  for (const [city, addrs] of Object.entries(byCity).sort()) {
    console.log(`\n${city} (${addrs.length}):`);
    for (const a of addrs) console.log(`  ${a}`);
  }
}

main();
