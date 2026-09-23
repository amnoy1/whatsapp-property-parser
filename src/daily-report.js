'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { connect, fetchGroupMessages, disconnect } = require('./whatsapp-client');
const { extractProperties }       = require('./property-extractor');
const { generateExcel }           = require('./excel-generator');
const { generateHtml }            = require('./html-generator');
const { fetchAllProperties, upsertProperties, deleteProperties, uploadToStorage } = require('./supabase-uploader');
const { enrichAllNeighborhoods, backfillMissingNeighborhoods } = require('./neighborhood-enrichment');
const store = require('./property-store');

// ── lock file (prevents double-runs) ─────────────────────────────────────────

const LOCK_FILE       = path.join(__dirname, '..', 'data', 'running.lock');
const LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function isRunning() {
  if (!fs.existsSync(LOCK_FILE)) return false;
  try {
    const ageMs = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
    if (ageMs > LOCK_TIMEOUT_MS) {
      console.log('⚠️  Stale lock file (>30 min) — removing');
      fs.unlinkSync(LOCK_FILE);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  const dir = path.dirname(LOCK_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOCK_FILE, new Date().toISOString());
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

// ── last-fetch checkpoint ─────────────────────────────────────────────────────

const LAST_FETCH_FILE = path.join(__dirname, '..', 'data', 'last-fetch.json');

function getLastFetchMs() {
  try {
    const data = JSON.parse(fs.readFileSync(LAST_FETCH_FILE, 'utf8'));
    return typeof data.fetchedUpTo === 'number' ? data.fetchedUpTo : null;
  } catch {
    return null;
  }
}

function saveLastFetchMs(ms) {
  const dir = path.dirname(LAST_FETCH_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LAST_FETCH_FILE, JSON.stringify({ fetchedUpTo: ms }));
}

// ── config ────────────────────────────────────────────────────────────────────

function validateEnv() {
  const required = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`\n❌ Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const GROUPS = () => [
  process.env.WHATSAPP_GROUP_1,
  process.env.WHATSAPP_GROUP_2,
  process.env.WHATSAPP_GROUP_3,
].filter(Boolean);

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  validateEnv();

  // Prevent double-runs (Task Scheduler + manual trigger can overlap)
  if (isRunning()) {
    console.log('⚠️  Already running (lock file exists) — exiting.');
    process.exit(0);
  }
  acquireLock();

  const groups = GROUPS();
  if (!groups.length) {
    console.error('❌ No groups configured — set WHATSAPP_GROUP_1/2/3 in .env');
    process.exit(1);
  }

  // Date helpers
  const now       = new Date();
  const today     = now.toISOString().split('T')[0];
  const [y, m, d] = today.split('-');
  const hh        = String(now.getHours()).padStart(2, '0');
  const mm        = String(now.getMinutes()).padStart(2, '0');
  const dateFmt   = `${d}/${m}/${y}`;
  const filename  = `נכסים_${d}-${m}-${y}_${hh}${mm}.xlsx`;

  console.log(`\n🏠 WhatsApp Property Report — ${dateFmt}`);
  console.log('─'.repeat(50));

  // 1. Load current state from Supabase (source of truth — not the local
  // file) + deduplicate + remove expired. Reading live state here is what
  // makes "does this property already exist" a real check instead of a
  // guess: a lost/reset local cache can no longer cause a listing to be
  // re-added as a duplicate, because there's no local cache in the loop.
  console.log('\n[1/5] Reading current state from Supabase...');
  let properties = await fetchAllProperties();
  console.log(`   📥 ${properties.length} properties fetched`);
  const beforeDedup = properties.length;
  const deduped = store.deduplicateStore(properties);
  properties = deduped.properties;
  const dedupRemovedIds = deduped.removedIds;
  const dupsRemoved = beforeDedup - properties.length;
  if (dupsRemoved > 0) console.log(`   🔄 Removed ${dupsRemoved} duplicate address entries`);
  const before   = properties.length;
  const removedExpired = store.removeExpired(properties, 20);
  properties     = removedExpired.properties;
  const expiredIds = removedExpired.removedIds;
  const expired  = before - properties.length;
  if (expired > 0) console.log(`   🗑  Removed ${expired} expired listings (>20 days unseen)`);
  console.log(`   📦 ${properties.length} properties in database`);
  const idsToDeleteFromSupabase = [...dedupRemovedIds, ...expiredIds];

  // 2. Connect to WhatsApp
  console.log('\n[2/5] Connecting to WhatsApp...');
  const client = await connect();
  console.log('   ✅ Connected');

  // 3. Fetch messages — window ends at today 08:00, starts at last successful checkpoint
  //    (or yesterday 08:00 if no checkpoint). This catches up missed days after crashes.
  const windowEnd = new Date(now);
  windowEnd.setHours(8, 0, 0, 0);
  const windowEndMs    = windowEnd.getTime();
  const defaultSinceMs = windowEndMs - 24 * 3_600_000; // yesterday 08:00

  const lastFetchMs = getLastFetchMs();
  const sinceMs     = (lastFetchMs && lastFetchMs < defaultSinceMs) ? lastFetchMs : defaultSinceMs;

  if (sinceMs < defaultSinceMs) {
    const missedDays = Math.round((defaultSinceMs - sinceMs) / 86_400_000);
    console.log(`   📅 Catching up ${missedDays} missed day(s)`);
  }

  console.log(`\n[3/5] Fetching messages since ${new Date(sinceMs).toLocaleString('he-IL')}...`);
  const allMessages = [];
  for (const group of groups) {
    try {
      const msgs = await fetchGroupMessages(client, group, sinceMs);
      console.log(`   ${group}: ${msgs.length} messages`);
      allMessages.push(...msgs);
    } catch (err) {
      console.error(`   ⚠️  ${group}: ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack || err);
    }
  }
  console.log(`   Total: ${allMessages.length} messages`);

  // Checkpoint: record that we've successfully fetched up to windowEndMs
  saveLastFetchMs(windowEndMs);

  // 4. Extract properties with Claude — each live message = its own block
  console.log('\n[4/5] Extracting properties...');
  const blocks    = allMessages.map(m => ({ sender: m.sender, date: m.date, text: m.text }));
  const extracted = await extractProperties(blocks);
  console.log(`   ${extracted.length} listings extracted from ${blocks.length} messages`);

  // 4b. Enrich missing neighborhoods: curated street_neighborhoods table
  // first, then Google Geocoding as fallback. A geocoded result self-heals
  // into street_neighborhoods for cities with no curated coverage yet
  // (see src/neighborhood-enrichment.js) — cities Amir curates manually are
  // never touched.
  if (extracted.length > 0) {
    const { dbFound, geocoded, healed } = await enrichAllNeighborhoods(extracted);
    if (dbFound > 0) console.log(`   🏘️  Neighborhoods from DB: ${dbFound}/${extracted.length}`);
    if (geocoded > 0) console.log(`   🗺️  Neighborhoods geocoded: ${geocoded}`);
    if (healed > 0) console.log(`   💾 Self-healed ${healed} mapping(s) into street_neighborhoods`);
  }

  // 5. Merge into store
  const stats = { added: 0, updated: 0, skipped: 0 };
  for (const prop of extracted) {
    const { properties: next, action } = store.mergeProperty(properties, prop);
    properties = next;
    stats[action] = (stats[action] || 0) + 1;
  }
  console.log(`   ✓ Added: ${stats.added} | ↻ Updated: ${stats.updated} | = Skipped: ${stats.skipped}`);

  // 6. Local backup snapshot only — Supabase (step 1) is the source of
  // truth for matching, this file is never read back for that decision.
  store.save(properties);

  // 7. Generate Excel + HTML and upload to Supabase
  console.log('\n[5/5] Generating report & uploading to Supabase...');
  const excelBuffer  = await generateExcel(properties);
  const updatedCount = properties.filter(p => p.previous_price != null).length;

  // Save Excel locally as backup
  const reportsDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const localPath = path.join(reportsDir, filename);
  fs.writeFileSync(localPath, excelBuffer);
  console.log(`   💾 Saved locally: reports/${filename}`);

  // Upload Excel to Supabase Storage → get public URL for HTML download button
  let excelPublicUrl = '';
  try {
    excelPublicUrl = await uploadToStorage(
      excelBuffer,
      'latest.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    console.log(`   📤 Excel → Supabase Storage`);
  } catch (err) {
    console.error(`   ⚠️  Excel upload failed: ${err.message}`);
  }

  // Generate HTML report and upload to Storage
  try {
    const htmlContent = generateHtml(properties, excelPublicUrl, dateFmt);
    const htmlBuffer  = Buffer.from(htmlContent, 'utf8');
    const htmlUrl     = await uploadToStorage(htmlBuffer, 'latest.html', 'text/html; charset=utf-8');
    console.log(`   🌐 HTML  → ${htmlUrl}`);
  } catch (err) {
    console.error(`   ⚠️  HTML upload failed: ${err.message}`);
  }

  // Upsert all properties to Supabase DB
  try {
    const count = await upsertProperties(properties);
    console.log(`   ✅ Supabase DB updated — ${count} properties`);
  } catch (err) {
    console.error(`   ⚠️  Supabase DB upsert failed: ${err.message}`);
  }

  // Delete expired AND merged-away-duplicate properties from Supabase too —
  // otherwise the row stays forever: an expired one would look "new" (with
  // a fresh first_seen_date) if the address ever reappears, and a merged
  // duplicate would just get silently re-merged in memory every day
  // without the raw table (which the admin panel reads directly) ever
  // actually losing the extra row.
  if (idsToDeleteFromSupabase.length > 0) {
    try {
      await deleteProperties(idsToDeleteFromSupabase);
      console.log(`   🗑️  Removed ${idsToDeleteFromSupabase.length} expired/merged listing(s) from Supabase`);
    } catch (err) {
      console.error(`   ⚠️  Supabase DB delete failed: ${err.message}`);
    }
  }

  // 8b. Backfill: re-check EVERY still-null neighborhood in the DB (not just
  // today's new listings) against the current street_neighborhoods table.
  // Catches properties ingested before their street was curated — without
  // this, that gap only closed by someone remembering to run the script by hand.
  try {
    const { fetched, dbFound, geocoded, updated } = await backfillMissingNeighborhoods();
    if (fetched > 0) {
      console.log(`   🔁 Backfill: ${updated}/${fetched} previously-unmatched properties resolved (${dbFound} from table, ${geocoded} geocoded)`);
    }
  } catch (err) {
    console.error(`   ⚠️  Neighborhood backfill failed: ${err.message}`);
  }

  // 9. Reset "price just changed" flags for the next run. This now has to
  // be pushed back to Supabase too (not just the local backup) — Supabase
  // is what step 1 reads next time, so without this the "price just
  // dropped" flag would stay stuck forever instead of clearing after
  // today's report has shown it once.
  const resetProperties = store.resetPreviousPrices(properties);
  store.save(resetProperties);
  try {
    await upsertProperties(resetProperties);
  } catch (err) {
    console.error(`   ⚠️  Supabase previous_price reset failed: ${err.message}`);
  }

  // 10. Disconnect
  await disconnect(client);

  releaseLock();
  console.log('\n✅ Done!\n');
}

main().catch(err => {
  releaseLock();
  console.error('\n❌ Fatal error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
