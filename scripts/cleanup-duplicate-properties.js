'use strict';

/**
 * One-time cleanup: merges duplicate rows in the `whatsapp_properties`
 * Supabase table that were created by the removeExpired/Supabase-sync bug
 * (a listing that expired out of the local store and later reappeared got
 * a new id and was inserted as a second row instead of updating the old one).
 *
 * Groups rows by normalized address + city (the same key property-store.js
 * uses to decide "is this the same property"), then within each group only
 * merges rows that also pass looksLikeSameProperty() — same property_type,
 * comparable room count, no wild price gap. An address with no house number
 * can genuinely hold several unrelated listings (a store and an apartment,
 * a rental and a sale) that share nothing but the street name; those are
 * left alone, not deleted — they're a real gap in the source data, not a
 * duplicate, and the next scan is expected to re-add them as needed.
 *
 * Run with --dry-run first to see what would be deleted without touching data.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { looksLikeSameProperty, normalizeAddress } = require('../src/property-store');

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await supabase
    .from('whatsapp_properties')
    .select('id,address,city,property_type,rooms,last_seen_date,first_seen_date,price');
  if (error) throw new Error(`Fetch failed: ${error.message}`);

  console.log(`Total rows: ${data.length}`);

  const byAddr = new Map();
  for (const p of data) {
    const key = normalizeAddress(p.address) + '|' + (p.city || '');
    if (!byAddr.has(key)) byAddr.set(key, []);
    byAddr.get(key).push(p);
  }

  // Within each same-address bucket, cluster rows further by
  // looksLikeSameProperty — only rows in the same cluster are duplicates.
  const idsToDelete = [];
  const updates     = []; // { id, first_seen_date, last_seen_date, price }
  let dupClusters   = 0;
  for (const [key, list] of byAddr) {
    if (list.length < 2) continue;

    const clusters = []; // array of arrays
    for (const p of list) {
      const cluster = clusters.find(c => looksLikeSameProperty(c[0], p));
      if (cluster) cluster.push(p);
      else clusters.push([p]);
    }

    for (const cluster of clusters) {
      if (cluster.length < 2) {
        console.log(`\n${list[0].address} (${list[0].city}) — 1 row, distinct listing, left alone (id ${cluster[0].id})`);
        continue;
      }
      dupClusters++;

      // The surviving row is whichever was most recently seen — but its
      // first_seen_date/last_seen_date/price get corrected to the merge of
      // the WHOLE cluster, exactly like property-store.js's deduplicateStore.
      // Keeping the "most recent" row's OWN first_seen_date verbatim was the
      // 2026-09-23 bug: a freshly re-added duplicate would win "most recent"
      // and its bogus today's-date first_seen_date would silently overwrite
      // the true, older one instead of being corrected.
      const sorted = [...cluster].sort((a, b) => {
        if (a.last_seen_date !== b.last_seen_date) {
          return a.last_seen_date > b.last_seen_date ? -1 : 1;
        }
        return a.first_seen_date < b.first_seen_date ? -1 : 1;
      });
      const keep    = sorted[0];
      const removed = sorted.slice(1);

      const mergedFirstSeen = cluster.reduce((min, p) => p.first_seen_date < min ? p.first_seen_date : min, keep.first_seen_date);
      const mergedLastSeen  = cluster.reduce((max, p) => p.last_seen_date > max ? p.last_seen_date : max, keep.last_seen_date);
      const mergedPrice     = cluster.reduce((min, p) => (p.price != null && (min == null || p.price < min)) ? p.price : min, null);

      console.log(`\n${list[0].address} (${list[0].city}) — ${cluster.length} rows, same listing`);
      console.log(`  KEEP   ${keep.id} | first_seen: ${keep.first_seen_date} → ${mergedFirstSeen} | last_seen: ${keep.last_seen_date} → ${mergedLastSeen} | price: ${keep.price} → ${mergedPrice}`);
      for (const r of removed) {
        console.log(`  DELETE ${r.id} | first_seen: ${r.first_seen_date} | last_seen: ${r.last_seen_date} | price: ${r.price}`);
        idsToDelete.push(r.id);
      }
      updates.push({ id: keep.id, first_seen_date: mergedFirstSeen, last_seen_date: mergedLastSeen, price: mergedPrice });
    }
  }

  console.log(`\n${idsToDelete.length} row(s) to delete, ${updates.length} row(s) to correct, across ${dupClusters} duplicate cluster(s).`);

  if (dryRun) {
    console.log('\n--dry-run: no changes made.');
    return;
  }

  if (idsToDelete.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  for (const u of updates) {
    const { error: upErr } = await supabase
      .from('whatsapp_properties')
      .update({ first_seen_date: u.first_seen_date, last_seen_date: u.last_seen_date, price: u.price })
      .eq('id', u.id);
    if (upErr) throw new Error(`Update failed for ${u.id}: ${upErr.message}`);
  }

  const { error: delError } = await supabase
    .from('whatsapp_properties')
    .delete()
    .in('id', idsToDelete);
  if (delError) throw new Error(`Delete failed: ${delError.message}`);

  console.log(`\n✅ Corrected ${updates.length} row(s), deleted ${idsToDelete.length} duplicate row(s).`);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
