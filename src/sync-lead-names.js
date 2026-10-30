'use strict';

/**
 * sync-lead-names.js — one-time: every Mango lead gets the name Amir saved for
 * that phone in his WhatsApp 052 contacts (Amir 2026-10-30: "Naor" on the
 * dashboard is "נאור קונה נלקין" in his phone). READ ONLY on WhatsApp; no model.
 * A name Amir typed in the dashboard (name_locked) is never touched.
 * The hourly private-chat-scan keeps it in sync afterwards.
 *
 *   node src/sync-lead-names.js           prints the list (old -> new), writes nothing
 *   node src/sync-lead-names.js --write   applies it
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { connect } = require('./whatsapp-client');
const { normalizePhone, nameUpdate } = require('./private-chat-rules');

const LOCK_FILE = path.join(__dirname, '..', 'data', 'running.lock');
const WRITE = process.argv.includes('--write');

/** phone (05XXXXXXXX) -> the name saved in Amir's address book. */
async function savedNames(client) {
  const pairs = await client.pupPage.evaluate(() => {
    const C = window.require('WAWebCollections');
    const api = window.require('WAWebApiContact');
    const out = [];
    for (const ct of C.Contact.getModelsArray()) {
      if (!ct.isAddressBookContact || !ct.name) continue;
      let pn = null;
      try { pn = ct.id.server === 'c.us' ? ct.id.user : (api.getPhoneNumber(ct.id) || {}).user || null; } catch {}
      if (pn) out.push([pn, ct.name]);
    }
    return out;
  });
  const map = new Map();
  for (const [pn, name] of pairs) {
    const phone = normalizePhone(pn);
    if (phone && !map.has(phone)) map.set(phone, name);
  }
  return map;
}

async function main() {
  if (fs.existsSync(LOCK_FILE)) { console.log('WhatsApp session busy (lock) — try again in a few minutes'); return; }
  fs.writeFileSync(LOCK_FILE, `sync-lead-names ${new Date().toISOString()}`);
  let client;
  let names;
  try {
    client = await connect();
    names = await savedNames(client);
  } finally {
    if (client) try { await client.destroy(); } catch {}
    try { fs.unlinkSync(LOCK_FILE); } catch {}
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const { data: leads, error } = await sb.from('crm_leads').select('id,phone,name,name_locked').is('archived_at', null).not('phone', 'is', null);
  if (error) throw new Error(error.message);

  const changes = [];
  let notSaved = 0;
  for (const l of leads) {
    const saved = names.get(l.phone);
    if (!saved) { notSaved++; continue; }
    const next = nameUpdate(l, saved);
    if (next) changes.push({ id: l.id, phone: l.phone, from: l.name, to: next });
  }

  console.log(`${leads.length} leads · ${changes.length} to rename · ${notSaved} not saved in contacts`);
  for (const c of changes) console.log(`  ${c.from || '(בלי שם)'}  ->  ${c.to}`);
  if (!WRITE) { console.log('\n(dry run — nothing written; --write to apply)'); return; }

  for (const c of changes) {
    const { error: e } = await sb.from('crm_leads').update({ name: c.to }).eq('id', c.id).eq('name_locked', false);
    if (e) console.log(`  ⚠️ ${c.to}: ${e.message}`);
  }
  console.log(`written: ${changes.length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERR', e.message); try { fs.unlinkSync(LOCK_FILE); } catch {} process.exit(1); });
