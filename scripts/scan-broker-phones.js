'use strict';

// One-time: find the phone of every broker in whatsapp_properties (Amir
// 2026-11-04: "טבלת מתווכים והטלפונים שלהם ... סקירה בקבוצות פעם אחת").
// Read-only on WhatsApp, no model calls. Three sources, best first:
//   contacts      - a contact Amir saved under the broker's name
//   group_author  - who posted in the groups (last 60 days) under that name
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
const { connect } = require('../src/whatsapp-client');

const WRITE = process.argv.includes('--write');
const DAYS = 60;
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
    console.log('⚠️  The daily report is running (lock file). Try again in a few minutes.');
    process.exit(1);
  }
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

  const client = await connect();
  const found = {}; // norm name -> { phone, source }
  const put = (name, phone, source) => {
    const k = norm(name);
    if (!k || !phone || !listings[k] || found[k]) return;
    found[k] = { phone, source };
  };

  // 1. Amir's saved contacts.
  for (const c of await client.getContacts()) {
    if (!c.isMyContact || c.isGroup) continue;
    const phone = toLocal(c.number);
    if (phone) put(c.name, phone, 'contacts');
  }

  // 2 + 3. The groups: who posted, then who is a member.
  let hidden = 0;
  const chats = await client.getChats();
  for (const groupName of GROUPS) {
    const chat = chats.find((ch) => ch.isGroup && ch.name === groupName);
    if (!chat) { console.log(`⚠️  group not found: ${groupName}`); continue; }
    const since = Date.now() / 1000 - DAYS * 86400;
    const msgs = (await chat.fetchMessages({ limit: 2000 })).filter((m) => m.timestamp >= since && !m.fromMe);
    const lids = [];
    const authors = [];
    for (const m of msgs) {
      const name = m._data?.notifyName;
      if (!name || !m.author) continue;
      authors.push({ name, id: m.author });
      if (m.author.endsWith('@lid')) lids.push(m.author);
    }
    for (const p of chat.participants || []) if (p.id.server === 'lid') lids.push(p.id._serialized);
    // WhatsApp hides numbers behind "lid" ids in some groups; ask it for the phone behind each.
    const pnByLid = {};
    if (lids.length) {
      try {
        for (const r of await client.getContactLidAndPhone([...new Set(lids)])) if (r.pn) pnByLid[r.lid] = r.pn;
      } catch (e) {
        console.log(`   (lid lookup failed: ${e.message.slice(0, 80)})`);
      }
    }
    const phoneOf = (id) => toLocal(String(id.endsWith('@lid') ? pnByLid[id] || '' : id).split('@')[0]);
    for (const a of authors) {
      const ph = phoneOf(a.id);
      if (ph) put(a.name, ph, 'group_author');
      else hidden++;
    }
    for (const p of chat.participants || []) {
      const ph = phoneOf(p.id._serialized);
      if (!ph) continue;
      try {
        const c = await client.getContactById(p.id._serialized);
        put(c.pushname || c.name, ph, 'group_member');
      } catch {}
    }
    console.log(`${groupName}: ${msgs.length} messages, ${(chat.participants || []).length} members`);
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

main().then(() => process.exit(0)).catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
