'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { connect, fetchGroupMessages, disconnect } = require('./whatsapp-client');
const { extractProperties }       = require('./property-extractor');
const { generateExcel }           = require('./excel-generator');
const { generateHtml }            = require('./html-generator');
const { upsertProperties, uploadToStorage } = require('./supabase-uploader');
const store = require('./property-store');

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

  // 1. Load store + deduplicate + remove expired
  let properties = store.load();
  const beforeDedup = properties.length;
  properties = store.deduplicateStore(properties);
  const dupsRemoved = beforeDedup - properties.length;
  if (dupsRemoved > 0) console.log(`   🔄 Removed ${dupsRemoved} duplicate address entries`);
  const before   = properties.length;
  properties     = store.removeExpired(properties, 10);
  const expired  = before - properties.length;
  if (expired > 0) console.log(`   🗑  Removed ${expired} expired listings (>10 days unseen)`);
  console.log(`   📦 ${properties.length} properties in database`);

  // 2. Connect to WhatsApp
  console.log('\n[1/4] Connecting to WhatsApp...');
  const client = await connect();
  console.log('   ✅ Connected');

  // 3. Fetch messages from all groups (window: yesterday 08:00 → today 08:00)
  const windowStart = new Date(now);
  windowStart.setHours(8, 0, 0, 0);
  const sinceMs = windowStart.getTime() - 24 * 3_600_000; // yesterday 08:00

  console.log(`\n[2/4] Fetching messages since ${new Date(sinceMs).toLocaleString('he-IL')}...`);
  const allMessages = [];
  for (const group of groups) {
    try {
      const msgs = await fetchGroupMessages(client, group, sinceMs);
      console.log(`   ${group}: ${msgs.length} messages`);
      allMessages.push(...msgs);
    } catch (err) {
      console.error(`   ⚠️  ${group}: ${err.message}`);
    }
  }
  console.log(`   Total: ${allMessages.length} messages`);

  // 4. Extract properties with Claude — each live message = its own block
  console.log('\n[3/4] Extracting properties...');
  const blocks    = allMessages.map(m => ({ sender: m.sender, date: m.date, text: m.text }));
  const extracted = await extractProperties(blocks);
  console.log(`   ${extracted.length} listings extracted from ${blocks.length} messages`);

  // 5. Merge into store
  const stats = { added: 0, updated: 0, skipped: 0 };
  for (const prop of extracted) {
    const { properties: next, action } = store.mergeProperty(properties, prop);
    properties = next;
    stats[action] = (stats[action] || 0) + 1;
  }
  console.log(`   ✓ Added: ${stats.added} | ↻ Updated: ${stats.updated} | = Skipped: ${stats.skipped}`);

  // 6. Persist store
  store.save(properties);

  // 7. Generate Excel + HTML and upload to Supabase
  console.log('\n[4/4] Generating report & uploading to Supabase...');
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

  // 9. Reset price flags + save
  store.save(store.resetPreviousPrices(properties));

  // 10. Disconnect
  await disconnect(client);

  console.log('\n✅ Done!\n');
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
