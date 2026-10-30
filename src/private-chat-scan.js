'use strict';

/**
 * private-chat-scan.js — hourly, READ ONLY scan of Amir's private WhatsApp
 * chats (052), feeding the Mango dashboard (2026-10-27; the-system
 * B-brain/03-projects/personal-assistant/spec.md section 10, step 2).
 *
 *   phone already a lead   -> one summary line on its timeline (whatsapp_amir)
 *   real-estate inquiry    -> "לידים חדשים לאישור" (crm_lead_candidates), Amir approves
 *   anything else          -> nothing leaves the PC
 *   Amir's voice notes in his group "תזכורות" -> transcribed here, then a lead
 *                            update like the dashboard's text box (src/voice-notes.js)
 *
 * Never sends, never marks read, never changes presence: it only reads WA
 * Web's store. Shares the WhatsApp session with daily-report.js, so it takes
 * the same lock and simply skips the hour if the report is running.
 *
 * Cost: runs only on chats with new messages; saved contacts pass a free word
 * filter first; one Haiku call per chat that passes. First run: 3 days back.
 *
 *   node src/private-chat-scan.js            normal run
 *   node src/private-chat-scan.js --dry-run  decide + call the model, print counts, write nothing
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { connect } = require('./whatsapp-client');
const { sendAlert } = require('./alert');
const { normalizePhone, streetKeys, strongSignal, nameUpdate, route, transcript, parseVerdict, firstLookFloor, pruneSeen } = require('./private-chat-rules');
const voice = require('./voice-notes');

const ROOT        = path.join(__dirname, '..');
const LOCK_FILE   = path.join(ROOT, 'data', 'running.lock');
const STATE_FILE  = path.join(ROOT, 'data', 'private-scan.json');
const LOG_FILE    = path.join(ROOT, 'logs', 'private-scan.log');
const VOICE_DIR   = path.join(ROOT, 'data', 'voice');
const LOCK_TIMEOUT_MS = 30 * 60 * 1000;
const FIRST_RUN_DAYS  = 3;           // Amir: 3 days on the first run
const MAX_RUN_MS      = 10 * 60_000; // never hold the session longer than this
const VOICE_RUN_MS    = 25 * 60_000; // after the session closes: local transcription can be slow
const VOICE_FIRST_DAYS = 2;          // first run: voice notes from the last 2 days
const ALERT_EVERY_MS  = 12 * 3_600_000;
const MODEL = 'claude-haiku-4-5';
const DRY = process.argv.includes('--dry-run');
// Voice notes are off until the media download works (WA Web 2026-10; spec sec 11): VOICE_NOTES=on in .env.
const VOICE_ON = process.env.VOICE_NOTES === 'on';

// ── small helpers ─────────────────────────────────────────────────────────────

function ensureDir(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); }
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { ensureDir(LOG_FILE); fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}
function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } }
function writeState(s) { ensureDir(STATE_FILE); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

function locked() {
  if (!fs.existsSync(LOCK_FILE)) return false;
  try {
    if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs > LOCK_TIMEOUT_MS) { fs.unlinkSync(LOCK_FILE); return false; }
    return true;
  } catch { return false; }
}

// ── WhatsApp: private chats with messages past their own cursor ──────────────

async function readPrivateChats(client, seen, floorS) {
  return client.pupPage.evaluate(async (seen, floorS) => {
    const C = window.require('WAWebCollections');
    const api = window.require('WAWebApiContact');
    const loadEarlier = window.require('WAWebChatLoadMessages').loadEarlierMsgs;
    const out = [];
    // isGroup is unreliable in current WA Web; the id's server is not.
    // Each chat has its own cursor (the last message already read), so a message
    // that reaches the PC late is still caught next hour (Sunny, 2026-10-27).
    const cursorOf = (c) => Math.max(seen[c.id._serialized] || 0, floorS);
    const chats = C.Chat.getModelsArray().filter((c) => (c.id.server === 'lid' || c.id.server === 'c.us') && c.t > cursorOf(c));
    for (const c of chats) {
      const sinceS = cursorOf(c);
      let pn = null;
      try { pn = c.id.server === 'c.us' ? c.id.user : (api.getPhoneNumber(c.id) || {}).user || null; } catch {}
      const ct = C.Contact.get(c.id._serialized) || (pn ? C.Contact.get(pn + '@c.us') : null);
      for (let i = 0; i < 6; i++) {
        const all = c.msgs.getModelsArray();
        const oldest = all.reduce((a, m) => Math.min(a, m.t), Infinity);
        if (all.length && oldest <= sinceS) break;
        const got = await Promise.race([loadEarlier({ chat: c }), new Promise((r) => setTimeout(() => r(null), 20000))]);
        if (!got || !got.length) break;
      }
      const msgs = c.msgs.getModelsArray()
        .filter((m) => !m.isNotification && m.type !== 'notification_template' && m.type !== 'call_log' && m.type !== 'e2e_notification')
        .map((m) => ({ t: m.t, fromMe: !!m.id.fromMe, type: m.type, body: m.type === 'chat' ? m.body : null }))
        .sort((a, b) => a.t - b.t);
      out.push({
        id: c.id._serialized,
        cursor: sinceS,
        pn,
        saved: !!(ct && ct.isAddressBookContact),
        name: (ct && (ct.name || ct.pushname)) || null,
        msgs,
      });
    }
    return out;
  }, seen, floorS);
}

// ── the model ─────────────────────────────────────────────────────────────────

const anthropic = new Anthropic();

const SYSTEM = `אתה עוזר של אמיר, מתווך נדל"ן (מנגו נדל"ן, כפר סבא והסביבה). אתה קורא שיחת ווטסאפ פרטית של אמיר ומחזיר JSON תקין בלבד, בלי טקסט נוסף.`;

/** "יום שישי 2026-10-30": the model turns "ביום ראשון" into a date. */
function todayIsrael(now = new Date()) {
  const day = now.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long' });
  return `${day} ${now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })}`;
}

function promptFor(mode, context, fresh) {
  const convo = (context ? `הודעות קודמות (להקשר בלבד):\n${context}\n\n` : '') + `ההודעות החדשות:\n${fresh}`;
  if (mode === 'lead') {
    return `${convo}

זה ליד קיים של אמיר. כתוב שורת סיכום אחת, עד 25 מילים, של מה שחדש בהודעות החדשות: מה הליד אמר או ביקש, מה סוכם, מה הצעד הבא.
אם הליד אמר שהוא לא מעוניין, לא רלוונטי לו כרגע, קנה במקום אחר, ירד מהנכס או ביטל/דחה ביקור - פתח בזה, קרוב למילים שלו, וכתוב גם את הסיבה אם נאמרה (למשל: "כרגע לא רלוונטי לה לקנות דירה, ביטלה את הביקור"). אסור להשמיט את זה.
אם בהודעות החדשות אין שום דבר מהותי (רק תודה, אישור, אימוג'י, ברכה) - relevant=false.
next = הצעד הבא של אמיר מול הליד, לפי ההודעות החדשות בלבד:
- {"kind": "not_relevant"} אם הליד הפסיק לחפש, לא מעוניין בכלל, לא רלוונטי לו כרגע או קנה במקום אחר. ירידה מנכס אחד כשהוא עדיין מחפש = step, לא not_relevant.
- {"kind": "step", "type": "call"|"schedule_visit"|"send_alternative"|"answer_question"|"other", "title": "עד 6 מילים", "due_date": "YYYY-MM-DD" או null, "due_time": "HH:MM" או null} אם נקבע או התבקש משהו חדש (ביקור, לחזור אליו, לשלוח חומר, לענות על שאלה). תאריך ושעה רק אם נאמרו במפורש. היום: ${todayIsrael()}.
- {"kind": "none"} אם אין צעד חדש.
החזר: {"relevant": true/false, "summary": "...", "next": {...}} (summary תמיד, גם כש-relevant=false)`;
  }
  return `${convo}

האם הצד השני בשיחה הוא ליד עסקי לאמיר בתחום הנדל"ן? כן = מתעניין לקנות/לשכור נכס, בעל נכס שרוצה למכור/להשכיר, או מתווך שמציע נכס/לקוח/שיתוף פעולה.
לא = שיחה אישית, משפחה, חברים, ספק, רואת חשבון או עו"ד בעניין שאינו נכס, שירות לקוחות, פרסומת.
החזר: {"relevant": true/false, "kind": "buyer"|"seller"|"broker"|"other", "source": "...", "property": "...", "summary": "..."}
- source: רק אם נאמר במפורש איך הגיע (למשל "ראיתי ביד2", "ראיתי את השלט", "X הפנה אותי"). אחרת null. אל תנחש.
- property: הרחוב או הנכס שהוזכר, אחרת null.
- summary: שורה אחת, עד 20 מילים: מי זה ומה הוא רוצה. תמיד, גם כש-relevant=false.`;
}

async function askModel(mode, chat) {
  const older = chat.msgs.filter((m) => m.t <= chat.cursor);
  const fresh = chat.msgs.filter((m) => m.t > chat.cursor);
  const r = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM,
    messages: [{ role: 'user', content: promptFor(mode, transcript(older, chat.name, { maxMsgs: 10, maxChars: 1500 }), transcript(fresh, chat.name)) }],
  });
  return parseVerdict(r.content?.[0]?.text);
}

// ── Supabase writes (summaries only, never the messages) ──────────────────────

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}

async function must(p) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

async function recordOnLead(sb, lead, chat, verdict, lastIso, phone) {
  const row = {
    lead_id: lead.id, channel: 'whatsapp_amir', occurred_at: lastIso,
    summary: verdict.summary, body: verdict.summary, ref: `wa:${phone}:${lastIso}`, created_by: 'wa_scan',
  };
  const opts = { onConflict: 'channel,ref', ignoreDuplicates: true };
  // The next step needs sql/018 (nir-buyers-agent); until it runs, the summary alone.
  const { error } = await sb.from('crm_lead_interactions').upsert([verdict.next ? { ...row, next_step: verdict.next } : row], opts);
  if (error && /next_step/.test(error.message)) await must(sb.from('crm_lead_interactions').upsert([row], opts));
  else if (error) throw new Error(error.message);
  const patch = { analyzed_at: null };
  if (!lead.last_interaction_at || Date.parse(lead.last_interaction_at) < Date.parse(lastIso)) patch.last_interaction_at = lastIso;
  await must(sb.from('crm_leads').update(patch).eq('id', lead.id));
}

async function recordCandidate(sb, phone, chat, verdict, lastIso) {
  // Only fields the model actually found, so a refresh never wipes a known source/property.
  const row = { phone, summary: verdict.summary, kind: verdict.kind, last_message_at: lastIso, updated_at: new Date().toISOString() };
  if (chat.name) row.name = chat.name;
  if (verdict.source) row.source = verdict.source;
  if (verdict.property) row.property = verdict.property;
  await must(sb.from('crm_lead_candidates').upsert([row], { onConflict: 'phone' }));
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (locked()) { log('skip: WhatsApp session busy (daily report running)'); return; }
  ensureDir(LOCK_FILE);
  fs.writeFileSync(LOCK_FILE, `private-scan ${new Date().toISOString()}`);
  const stop = (why) => () => { log(`⚠️ ${why} — stopping`); try { fs.unlinkSync(LOCK_FILE); } catch {} process.exit(1); };
  let killer = setTimeout(stop('run exceeded 10 min'), MAX_RUN_MS);

  const state = readState();
  const nowS = Date.now() / 1000;
  const floorS = firstLookFloor(state, nowS, FIRST_RUN_DAYS);
  const seen = state.seen || {};
  const counts = { chats: 0, lead: 0, candidate: 0, check: 0, skip: 0, model: 0, written: 0, notRelevant: 0, forced: 0, renamed: 0, errors: 0 };
  let voiceSince = typeof state.voiceSince === 'number' ? state.voiceSince : nowS - VOICE_FIRST_DAYS * 86400;
  let notes = [];
  let client;
  try {
    client = await connect();
    const chats = await readPrivateChats(client, seen, floorS);
    if (VOICE_ON) try {
      const v = await voice.findVoiceNotes(client, voiceSince);
      if (!v.found) log(`⚠️ voice: no group named "${voice.GROUP_NAME}"`);
      else if (DRY) console.log('  voice group:', JSON.stringify(v.stats));
      const d = await voice.downloadNotes(client, v.notes, VOICE_DIR);
      notes = d.ok;
      if (d.error) log(`⚠️ voice download (${v.notes.length - d.ok.length} waiting): ${d.error}`);
    } catch (err) {
      log(`⚠️ voice: ${String(err.message).slice(0, 160)}`);
    }
    try { await client.destroy(); } catch {}
    client = null;
    // The WhatsApp session is closed: the slow local part gets its own limit.
    clearTimeout(killer);
    killer = setTimeout(stop('run exceeded the voice-note limit'), VOICE_RUN_MS);
    counts.chats = chats.length;

    const sb = db();
    const phones = [...new Set(chats.map((c) => normalizePhone(c.pn)).filter(Boolean))];
    const leads = phones.length ? await must(sb.from('crm_leads').select('id,phone,name,name_locked,last_interaction_at').in('phone', phones).is('archived_at', null)) : [];
    // Before sql/016 runs the table is missing: read it as empty; the writes then
    // fail, so the checkpoint stays and the next run retries the same chats.
    const cands = phones.length ? await must(sb.from('crm_lead_candidates').select('phone,status').in('phone', phones)).catch((e) => { log(`⚠️ candidates: ${e.message}`); return []; }) : [];
    const leadByPhone = new Map(leads.map((l) => [l.phone, l]));
    const candStatus = new Map(cands.map((c) => [c.phone, c.status]));
    // Mango's own properties: a chat naming one of these streets always reaches Amir.
    const keys = chats.length ? streetKeys((await must(sb.from('properties').select('street')).catch(() => [])).map((p) => p.street)) : [];

    for (const chat of chats) {
      const phone = normalizePhone(chat.pn);
      const fresh = chat.msgs.filter((m) => m.t > chat.cursor);
      const lastT = fresh.length ? fresh[fresh.length - 1].t : chat.cursor;
      const newTexts = fresh.map((m) => m.body).filter(Boolean);
      // The lead's name = the name Amir saved in his phone (never over a dashboard-typed one). No model.
      const rename = chat.saved ? nameUpdate(leadByPhone.get(phone), chat.name) : null;
      if (rename && !DRY) {
        await must(sb.from('crm_leads').update({ name: rename }).eq('id', leadByPhone.get(phone).id).eq('name_locked', false)).catch((e) => log(`⚠️ rename: ${e.message}`));
        counts.renamed++;
      } else if (rename) counts.renamed++;
      const signal = strongSignal({ name: chat.saved ? chat.name : null, texts: newTexts, keys });
      const r = route({ phone, saved: chat.saved, newTexts, leadPhones: new Set(leadByPhone.keys()), candidateStatus: candStatus.get(phone), signal });
      counts[r]++;
      if (r === 'skip') { seen[chat.id] = lastT; continue; }
      try {
        const verdict = await askModel(r === 'lead' ? 'lead' : 'check', chat);
        counts.model++;
        // A strong signal is queued for Amir's ✓/✗ even when the model says "not real estate";
        // on an existing lead (found by phone first) a street / visit is an update, never a new lead.
        const strong = r === 'lead' ? signal && signal.reason !== 'שם איש הקשר' : signal;
        const forced = strong && (!verdict.relevant || !verdict.summary);
        if (forced) {
          counts.forced++;
          verdict.summary = verdict.summary || `${chat.name || 'איש קשר'} (${signal.reason})`;
        } else if (!verdict.relevant || !verdict.summary) { counts.notRelevant++; seen[chat.id] = lastT; continue; }
        if (r !== 'lead' && signal && signal.property && !verdict.property) verdict.property = signal.property;
        const lastIso = new Date(fresh[fresh.length - 1].t * 1000).toISOString();
        // Dry run shows only what WOULD reach the dashboard (the summary line), never messages.
        if (DRY) { counts.written++; console.log(`  ${r} ${phone.slice(0, 3)}…${phone.slice(-2)} ${verdict.kind || ''} | ${verdict.summary}${verdict.source ? ' | מקור: ' + verdict.source : ''}${signal ? ' | סיבה: ' + signal.reason + (signal.match ? ` ("${signal.match}")` : '') : ''}${r === 'lead' && verdict.next ? ' | צעד: ' + JSON.stringify(verdict.next) : ''}`); continue; }
        if (r === 'lead') await recordOnLead(sb, leadByPhone.get(phone), chat, verdict, lastIso, phone);
        else await recordCandidate(sb, phone, chat, verdict, lastIso);
        counts.written++;
        seen[chat.id] = lastT;
      } catch (err) {
        counts.errors++;
        log(`⚠️ chat failed: ${String(err.message).slice(0, 160)}`);
      }
    }

    // Voice notes, oldest first. One that fails stops the line, so the cursor never
    // skips it; it is retried next hour. The audio is deleted once it's handled.
    const vcounts = { notes: notes.length, ok: 0, noLead: 0, errors: 0 };
    if (notes.length) {
      try {
        const texts = voice.transcribe(notes.map((n) => n.file));
        for (const n of notes) {
          const tr = texts.get(n.file);
          if (!tr || tr.error) { vcounts.errors++; log(`⚠️ voice transcribe: ${tr ? tr.error : 'missing'}`); break; }
          const r = tr.text ? voice.applyUpdate(tr.text, { dry: DRY }) : { status: 'empty' };
          if (DRY) console.log(`  voice ${new Date(n.t * 1000).toISOString()} (${tr.seconds}s) | ${tr.text}
    -> ${JSON.stringify(r.parsed || r)}`);
          else log(`voice ${new Date(n.t * 1000).toISOString()} ${tr.seconds}s -> ${r.status}${r.lead ? ` ${r.lead.name || ''} ${r.lead.phone || ''}` : ''}${r.created ? ' (new lead)' : ''}${r.task ? ` | task: ${r.task.title} @ ${r.task.due_at}` : ''}`);
          if (r.status === 'ok') vcounts.ok++; else vcounts.noLead++;
          if (!DRY) { voiceSince = n.t; try { fs.unlinkSync(n.file); } catch {} }
        }
      } catch (err) {
        vcounts.errors++;
        log(`⚠️ voice: ${String(err.message).slice(0, 160)}`);
      }
    }

    // A chat that failed keeps its old cursor and is retried next hour; the rest move on.
    if (!DRY) writeState({ ...state, since: undefined, start: typeof state.start === 'number' ? state.start : floorS, seen: pruneSeen(seen, nowS), voiceSince, lastOk: new Date().toISOString() });
    log(`${DRY ? '[dry-run] ' : ''}floor=${new Date(floorS * 1000).toISOString()} ${JSON.stringify(counts)} voice=${JSON.stringify(vcounts)}`);
  } catch (err) {
    log(`❌ ${err.message}`);
    if (/auth failure|QR/i.test(err.message) && Date.now() - (state.alertedAt || 0) > ALERT_EVERY_MS) {
      await sendAlert('⚠️ סריקת הצ׳אטים הפרטיים (052) לא מצליחה להתחבר לווטסאפ — צריך לסרוק QR מחדש (חבר-ווצאפ.bat).');
      writeState({ ...readState(), alertedAt: Date.now() });
    }
    process.exitCode = 1;
  } finally {
    if (client) { try { await client.destroy(); } catch {} }
    clearTimeout(killer);
    try { fs.unlinkSync(LOCK_FILE); } catch {}
  }
}

if (require.main === module) main().then(() => process.exit(process.exitCode || 0));

module.exports = { promptFor };
