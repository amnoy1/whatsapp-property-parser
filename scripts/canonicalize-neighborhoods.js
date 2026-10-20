'use strict';

// One-time cleanup (Amir, 2026-10-20): bring every stored neighborhood to the
// canonical name, with the same rules new listings now get at ingestion
// (src/neighborhood-lookup.js, "Canonical neighborhood names").
//   1. street_neighborhoods: rename the old spellings Amir decided on
//      ("הזמר העיברי" -> "הזמר העברי", "כפר סבא הירוקה" -> "הירוקה").
//   2. whatsapp_properties: street map wins, else the stored name
//      canonicalized, else an address that is a neighborhood name.
//
// Dry run by default: prints before -> after and changes nothing.
//   node scripts/canonicalize-neighborhoods.js           (dry run)
//   node scripts/canonicalize-neighborhoods.js --apply   (writes)

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const {
  NEIGHBORHOOD_ALIASES,
  normalizeNeighborhoodsWithRows,
} = require('../src/neighborhood-lookup');

const APPLY = process.argv.includes('--apply');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  console.log(APPLY ? '*** APPLY — writing changes ***\n' : '--- DRY RUN — nothing is written ---\n');

  // 1. The curated table's own old spellings.
  const { data: streetRows, error: e1 } = await sb.from('street_neighborhoods').select('id, city, street, neighborhood');
  if (e1) throw new Error(e1.message);
  const renames = streetRows.filter(r => NEIGHBORHOOD_ALIASES[r.neighborhood]);
  const renameCounts = {};
  for (const r of renames) {
    const k = `${r.neighborhood} -> ${NEIGHBORHOOD_ALIASES[r.neighborhood]}`;
    renameCounts[k] = (renameCounts[k] || 0) + 1;
  }
  console.log(`street_neighborhoods: ${renames.length} rows to rename`);
  for (const [k, n] of Object.entries(renameCounts)) console.log(`  ${k}  (${n})`);
  if (APPLY) {
    for (const r of renames) {
      const { error } = await sb.from('street_neighborhoods')
        .update({ neighborhood: NEIGHBORHOOD_ALIASES[r.neighborhood] }).eq('id', r.id);
      if (error) console.error(`  ! rename ${r.id}: ${error.message}`);
    }
  }

  // 2. whatsapp_properties, every row.
  const { data: props, error: e2 } = await sb.from('whatsapp_properties').select('id, address, city, neighborhood');
  if (e2) throw new Error(e2.message);
  const before = new Map(props.map(p => [p.id, p.neighborhood]));
  const working = props.map(p => ({ ...p }));
  normalizeNeighborhoodsWithRows(working, streetRows);

  const changes = working.filter(p => (p.neighborhood || null) !== (before.get(p.id) || null));
  const byPair = {};
  for (const p of changes) {
    const k = `${before.get(p.id) || '(ריק)'}  ->  ${p.neighborhood || '(ריק)'}`;
    (byPair[k] = byPair[k] || []).push(`${p.address || '?'} / ${p.city || '?'}`);
  }
  console.log(`\nwhatsapp_properties: ${changes.length} of ${props.length} rows change`);
  for (const [k, list] of Object.entries(byPair).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${k}  (${list.length})`);
    for (const a of list.slice(0, 6)) console.log(`      ${a}`);
    if (list.length > 6) console.log(`      ... ועוד ${list.length - 6}`);
  }
  const stillNull = working.filter(p => !p.neighborhood && p.city === 'כפר סבא').length;
  console.log(`\nכפר סבא still without a neighborhood after this: ${stillNull}`);

  if (APPLY) {
    let failed = 0;
    for (const p of changes) {
      const { error } = await sb.from('whatsapp_properties').update({ neighborhood: p.neighborhood }).eq('id', p.id);
      if (error) { failed++; console.error(`  ! ${p.id}: ${error.message}`); }
    }
    console.log(`\nwritten: ${changes.length - failed}, failed: ${failed}`);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
