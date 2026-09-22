'use strict';

/**
 * One-time cleanup: merges duplicate rows in the `whatsapp_properties`
 * Supabase table that were created by the removeExpired/Supabase-sync bug
 * (a listing that expired out of the local store and later reappeared got
 * a new id and was inserted as a second row instead of updating the old one).
 *
 * Groups rows by normalized address + city (the same key property-store.js
 * uses to decide "is this the same property"), keeps the row with the most
 * recent last_seen_date per group, and deletes the rest.
 *
 * Run with --dry-run first to see what would be deleted without touching data.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

function normalizeAddress(addr) {
  if (!addr) return '';
  return addr
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^(רחוב|רח'|רח|שדרות|שד'|שד|דרך|סמטת|סמטה|פינת|פינה)\s+/i, '')
    .toLowerCase();
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await supabase
    .from('whatsapp_properties')
    .select('id,address,city,last_seen_date,first_seen_date,price');
  if (error) throw new Error(`Fetch failed: ${error.message}`);

  console.log(`Total rows: ${data.length}`);

  const groups = new Map();
  for (const p of data) {
    const key = normalizeAddress(p.address) + '|' + (p.city || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const idsToDelete = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;

    // Keep the row with the most recent last_seen_date (most current data).
    // Tie-break on first_seen_date (earlier = original listing).
    const sorted = [...list].sort((a, b) => {
      if (a.last_seen_date !== b.last_seen_date) {
        return a.last_seen_date > b.last_seen_date ? -1 : 1;
      }
      return a.first_seen_date < b.first_seen_date ? -1 : 1;
    });
    const keep    = sorted[0];
    const removed = sorted.slice(1);

    console.log(`\n${list[0].address} (${list[0].city}) — ${list.length} rows`);
    console.log(`  KEEP   ${keep.id} | last_seen: ${keep.last_seen_date} | price: ${keep.price}`);
    for (const r of removed) {
      console.log(`  DELETE ${r.id} | last_seen: ${r.last_seen_date} | price: ${r.price}`);
      idsToDelete.push(r.id);
    }
  }

  console.log(`\n${idsToDelete.length} row(s) to delete across ${[...groups.values()].filter(g => g.length > 1).length} duplicate group(s).`);

  if (dryRun) {
    console.log('\n--dry-run: no changes made.');
    return;
  }

  if (idsToDelete.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  const { error: delError } = await supabase
    .from('whatsapp_properties')
    .delete()
    .in('id', idsToDelete);
  if (delError) throw new Error(`Delete failed: ${delError.message}`);

  console.log(`\n✅ Deleted ${idsToDelete.length} duplicate row(s).`);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
