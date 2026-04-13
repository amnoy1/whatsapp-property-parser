'use strict';

require('dotenv').config();

const path  = require('path');
const fs    = require('fs');

const { parseExportFile, groupConsecutiveMessages } = require('./whatsapp-parser');
const { extractProperties }                          = require('./property-extractor');
const { getExistingProperties, createProperty, updateProperty } = require('./airtable-client');
const { findDuplicate }                              = require('./deduplicator');

// ── validation ────────────────────────────────────────────────────────────────

function validateEnv() {
  const required = ['ANTHROPIC_API_KEY', 'AIRTABLE_API_KEY'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`\n❌ Missing environment variables: ${missing.join(', ')}`);
    console.error('   Copy .env.example → .env and fill in your API keys.\n');
    process.exit(1);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  validateEnv();

  // Resolve input file path
  const filePath = process.argv[2] || findLatestInputFile();
  if (!filePath) {
    console.error('\n❌ No input file provided.');
    console.error('   Usage: node src/index.js input/chat.txt\n');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`\n❌ File not found: ${filePath}\n`);
    process.exit(1);
  }

  console.log(`\n📱 WhatsApp Property Parser`);
  console.log(`   File: ${filePath}`);
  console.log('─'.repeat(50));

  // ── Step 1: Parse export file ─────────────────────────────────────────────
  console.log('\n[1/4] Parsing WhatsApp export...');
  const messages = parseExportFile(filePath);
  const blocks   = groupConsecutiveMessages(messages);
  console.log(`   ${messages.length} messages → ${blocks.length} message blocks`);

  if (blocks.length === 0) {
    console.log('\n⚠️  No messages found. Check the file format.\n');
    process.exit(0);
  }

  // ── Step 2: Extract properties with Claude Haiku ──────────────────────────
  console.log('\n[2/4] Extracting properties with Claude Haiku...');
  const properties = await extractProperties(blocks);
  console.log(`   ${properties.length} property listings extracted from ${blocks.length} blocks`);

  if (properties.length === 0) {
    console.log('\n⚠️  No property listings found in messages.\n');
    process.exit(0);
  }

  // ── Step 3: Load existing Airtable records ────────────────────────────────
  console.log('\n[3/4] Loading existing records from Airtable...');
  const existingProperties = await getExistingProperties();
  console.log(`   ${existingProperties.length} existing properties in Airtable`);

  // ── Step 4: Dedup + save ──────────────────────────────────────────────────
  console.log('\n[4/4] Saving to Airtable (dedup + create/update)...');

  const stats = { created: 0, updated: 0, skipped: 0 };

  // Process sequentially to respect Airtable rate limits (5 req/sec)
  for (const property of properties) {
    await sleep(250); // ~4 req/sec

    const { isDuplicate, existingId, priceChanged } = await findDuplicate(
      property,
      existingProperties
    );

    if (isDuplicate) {
      if (priceChanged) {
        await updateProperty(existingId, property);
        stats.updated++;
        console.log(`   ↻ Updated: ${property.address || property.broker_name} (price change)`);
      } else {
        stats.skipped++;
        if (process.env.DEBUG) {
          console.log(`   = Skipped duplicate: ${property.address || property.broker_name}`);
        }
      }
    } else {
      const newId = await createProperty(property);
      stats.created++;
      console.log(`   ✓ Created: ${property.address || property.broker_name} (${property.price ? '₪' + property.price.toLocaleString() : 'no price'})`);

      // Add new record to local cache so subsequent duplicates are caught
      existingProperties.push({
        id:           newId,
        address:      property.address,
        broker_name:  property.broker_name,
        broker_phone: property.broker_phone,
        rooms:        property.rooms,
        area_sqm:     property.area_sqm,
        price:        property.price,
      });
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log('✅ Done!');
  console.log(`   Created:  ${stats.created}`);
  console.log(`   Updated:  ${stats.updated} (price changes)`);
  console.log(`   Skipped:  ${stats.skipped} (duplicates, no change)`);
  console.log('');
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Find the most recently modified .txt file in the input/ folder */
function findLatestInputFile() {
  const inputDir = path.join(__dirname, '..', 'input');
  if (!fs.existsSync(inputDir)) return null;

  const files = fs.readdirSync(inputDir)
    .filter(f => f.endsWith('.txt'))
    .map(f => ({
      name: f,
      mtime: fs.statSync(path.join(inputDir, f)).mtime,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return files.length ? path.join(inputDir, files[0].name) : null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── run ───────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
