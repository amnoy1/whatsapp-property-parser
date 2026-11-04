'use strict';

// One-time: find the phone of every broker in whatsapp_properties (Amir
// 2026-11-04: "טבלת מתווכים והטלפונים שלהם ... סקירה בקבוצות פעם אחת").
// Read-only on WhatsApp, no model calls. Three sources, best first:
//   contacts      - a contact Amir saved under the broker's name
//   group_author  - who posted in the groups (last 30 days) under that name
//   group_member  - a group member whose WhatsApp name is the broker's name
//
// Run from the live folder, while the daily report is not running:
//   node scripts\scan-broker-phones.js            -> prints the list, writes nothing
//   node scripts\scan-broker-phones.js --write    -> after Amir approved the list:
//        upserts public.brokers and fills whatsapp_properties.broker_phone where empty
//
// Needs sql/020 (nir-buyers-agent) for --write.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { connect, fetchGroupMessages } = require('../src/whatsapp-client');

const WRITE = process.argv.includes('--write');
const DAYS = 30; // Amir 2026-11-04: 30 days are enough
const LOCK_FILE = path.join(__dirname, '..', 'data', 'running.lock');
const OUT = path.join(__dirname, '..', 'data', 'broker-phones.json');

const GROUPS = [process.env.WHATSAPP_GROUP_1, process.env.WHATSAPP_GROUP_2, process.env.WHATSAPP_GROUP_3].filter(Boolean);

// Names are compared without spaces, quotes, emoji or a trailing title.
function norm(name) {
  return String(name || '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .replace(/(נדלן|נדל״ן|תיווך|מתווך|מתווכת|realestate|re\/max|remax)$/i, '')
    .toLowerCase();
}

function toLocal(user) {
  const d = String(user || '').replace(/\D/g, '');
  if (d.startsWith('972') && d.length === 12) return '0' + d.slice(3);
  if (/^0\d{8,9}$/.test(d)) return d;
  return null;
}

async function main() {
  if (fs.existsSync(LOCK_FILE)) {
    console.log('⚠️  WhatsApp is busy (daily report / private scan). Try again in a few minutes.');
    process.exit(1);
  }
  // Hold the same lock as the daily report, so the hourly private scan skips
  // while this runs: two clients on one session log it out (2026-11-04).
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
  fs.writeFileSync(LOCK_FILE, new Date().toISOString());
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: props, error } = await supabase.from('whatsapp_properties').select('broker_name,broker_phone');
  if (error) throw new Error(error.message);
  const listings = {};
  for (const p of props || []) {
    if (!p.broker_name || /^unknown$/i.test(p.broker_name)) continue;
    const k = norm(p.broker_name);
    listings[k] ||= { name: p.broker_name, count: 0, phone: null };
    listings[k].count++;
    if (p.broker_phone && !listings[k].phone) listings[k].phone = toLocal(p.broker_phone) || p.broker_phone;
  }
  console.log(`${Object.keys(listings).length} brokers in whatsapp_properties.`);

  console.log('מתחבר לוואטסאפ...');
  const client = await connect();
  const found = {}; // norm name -> { phone, source }
  const put = (name, phone, source) => {
    const k = norm(name);
    if (!k || !phone || !listings[k] || found[k]) return;
    found[k] = { phone, source };
  };

  // client.getChats()/getContacts() hang on the current WA Web (see
  // fetchGroupMessages), so contacts and group members are read straight from
  // the WA store, in one call. A "lid" contact may carry its phone number.
  console.log('קורא אנשי קשר וחברי קבוצות...');
  const store = await client.pupPage.evaluate((groupNames) => {
    const C = window.require('WAWebCollections');
    const contacts = C.Contact.getModelsArray().map((c) => ({
      id: c.id && c.id._serialized,
      name: c.name || null,
      pushname: c.pushname || null,
      saved: !!(c.isAddressBookContact || c.isMyContact),
      pn: c.phoneNumber ? (c.phoneNumber._serialized || c.phoneNumber.user || String(c.phoneNumber)) : null,
    }));
    const members = {};
    for (const ch of C.Chat.getModelsArray()) {
      if (!groupNames.includes(ch.name)) continue;
      const ps = ch.groupMetadata && ch.groupMetadata.participants;
      members[ch.name] = ps ? ps.getModelsArray().map((p) => p.id._serialized) : [];
    }
    return { contacts, members };
  }, GROUPS);
  const byId = new Map(store.contacts.map((c) => [c.id, c]));
  const phoneOf = (id) => {
    if (!id) return null;
    if (id.endsWith('@c.us')) return toLocal(id.split('@')[0]);
    const pn = byId.get(id)?.pn;
    return pn ? toLocal(String(pn).split('@')[0]) : null;
  };
  console.log(`   ${store.contacts.length} אנשי קשר בזיכרון של וואטסאפ`);

  // 1. Amir's saved contacts.
  for (const c of store.contacts) if (c.saved && c.name) put(c.name, phoneOf(c.id), 'contacts');

  // 2. Who posted in the groups (the daily scan's own loader), 3. who is a member.
  let hidden = 0;
  for (const groupName of GROUPS) {
    console.log(`קורא את ${groupName}...`);
    let msgs = [];
    try {
      msgs = (await fetchGroupMessages(client, groupName, Date.now() - DAYS * 86_400_000)).messages;
    } catch (e) {
      console.log(`   ⚠️  ${e.message.slice(0, 100)}`);
    }
    for (const m of msgs) {
      const ph = m.senderPhone ? toLocal(m.senderPhone) : phoneOf(m.senderId);
      if (ph) put(m.sender, ph, 'group_author');
      else hidden++;
    }
    for (const id of store.members[groupName] || []) {
      const c = byId.get(id);
      if (c) put(c.pushname || c.name, phoneOf(id), 'group_member');
    }
    console.log(`   ${msgs.length} הודעות, ${(store.members[groupName] || []).length} חברים`);
  }
  await client.destroy().catch(() => {});

  const rows = Object.entries(listings)
    .map(([k, l]) => ({ name: l.name, listings: l.count, phone: found[k]?.phone || l.phone || null, source: found[k]?.source || (l.phone ? 'listing' : null) }))
    .sort((a, b) => b.listings - a.listings);
  console.log('\nמתווך | נכסים | טלפון | מקור');
  for (const r of rows) console.log(`${r.name} | ${r.listings} | ${r.phone || '—'} | ${r.source || 'לא נמצא'}`);
  console.log(`\nנמצא טלפון ל-${rows.filter((r) => r.phone).length} מתוך ${rows.length}. הודעות שהמספר שלהן מוסתר: ${hidden}.`);
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
  console.log(`נשמר ל-${OUT}`);

  if (!WRITE) {
    console.log('\nלא נכתב כלום. אחרי שאמיר מאשר את הרשימה: node scripts\\scan-broker-phones.js --write');
    return;
  }
  const ok = rows.filter((r) => r.phone);
  const { error: e1 } = await supabase
    .from('brokers')
    .upsert(ok.map((r) => ({ name: r.name, phone: r.phone, source: r.source === 'listing' ? 'group_author' : r.source, updated_at: new Date().toISOString() })), { onConflict: 'name' });
  if (e1) throw new Error(`brokers upsert: ${e1.message}`);
  let filled = 0;
  for (const r of ok) {
    const { data, error: e2 } = await supabase
      .from('whatsapp_properties')
      .update({ broker_phone: r.phone })
      .eq('broker_name', r.name)
      .is('broker_phone', null)
      .select('id');
    if (e2) throw new Error(`whatsapp_properties update: ${e2.message}`);
    filled += (data || []).length;
  }
  console.log(`✅ ${ok.length} מתווכים נשמרו בטבלה, ${filled} נכסים קיבלו טלפון.`);
}

const unlock = () => { try { fs.unlinkSync(LOCK_FILE); } catch {} };
main().then(() => { unlock(); process.exit(0); }).catch((e) => {
  unlock();
  console.error('❌', e.message);
  process.exit(1);
});
