'use strict';

require('dotenv').config();

const { connect, fetchGroupMessages, sendReport, disconnect } = require('./whatsapp-client');
const { extractProperties }       = require('./property-extractor');
const { groupConsecutiveMessages } = require('./whatsapp-parser');
const { generateExcel }           = require('./excel-generator');
const store = require('./property-store');

// ── config ────────────────────────────────────────────────────────────────────

function validateEnv() {
  const required = ['ANTHROPIC_API_KEY', 'WHATSAPP_RECIPIENT_PHONE'];
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
  const today     = new Date().toISOString().split('T')[0];
  const [y, m, d] = today.split('-');
  const dateFmt   = `${d}/${m}/${y}`;
  const filename  = `נכסים_${d}-${m}-${y}.xlsx`;

  console.log(`\n🏠 WhatsApp Property Report — ${dateFmt}`);
  console.log('─'.repeat(50));

  // 1. Load store + remove expired
  let properties = store.load();
  const before   = properties.length;
  properties     = store.removeExpired(properties, 10);
  const expired  = before - properties.length;
  if (expired > 0) console.log(`   🗑  Removed ${expired} expired listings (>10 days unseen)`);
  console.log(`   📦 ${properties.length} properties in database`);

  // 2. Connect to WhatsApp
  console.log('\n[1/4] Connecting to WhatsApp...');
  const client = await connect();
  console.log('   ✅ Connected');

  // 3. Fetch messages from all groups
  console.log('\n[2/4] Fetching last 24h from groups...');
  const allMessages = [];
  for (const group of groups) {
    try {
      const msgs = await fetchGroupMessages(client, group, 24);
      console.log(`   ${group}: ${msgs.length} messages`);
      allMessages.push(...msgs);
    } catch (err) {
      console.error(`   ⚠️  ${group}: ${err.message}`);
    }
  }
  console.log(`   Total: ${allMessages.length} messages`);

  // 4. Extract properties with Claude
  console.log('\n[3/4] Extracting properties...');
  const blocks    = groupConsecutiveMessages(allMessages);
  const extracted = await extractProperties(blocks);
  console.log(`   ${extracted.length} listings extracted from ${blocks.length} message blocks`);

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

  // 7. Generate Excel
  console.log('\n[4/4] Generating report & sending...');
  const excelBuffer   = await generateExcel(properties);
  const updatedCount  = properties.filter(p => p.previous_price != null).length;

  // 8. Send WhatsApp message
  const caption =
    `🏠 דו"ח נכסים יומי | ${dateFmt}\n` +
    `${properties.length} נכסים במאגר | ${stats.added} חדשים היום | ${updatedCount} עודכן מחיר`;

  await sendReport(client, process.env.WHATSAPP_RECIPIENT_PHONE, caption, excelBuffer, filename);
  console.log(`   ✅ Sent to ${process.env.WHATSAPP_RECIPIENT_PHONE}`);

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
