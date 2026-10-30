'use strict';

// Pure rules for the private-chat scan (private-chat-scan.js). No I/O here, so
// tests can pin every decision. Amir's rules, 2026-10-26/27 (the-system
// B-brain/03-projects/personal-assistant/spec.md section 10):
//  - a phone that is already a lead -> a one-line summary on its timeline
//  - an unknown number -> checked; real estate -> "לידים חדשים לאישור"
//  - brokers always checked; friends/family/suppliers only when they talk real
//    estate -> saved contacts go through a free local word filter first
//  - source only from the chat, never guessed
//  - the messages themselves never leave the PC

/** 9725XXXXXXXX / 05X-XXX-XXXX -> 05XXXXXXXX; anything that is not an Israeli mobile -> null. */
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return /^05\d{8}$/.test(d) ? d : null;
}

// Free, local pre-filter for SAVED contacts only (unknown numbers always go to
// the model). Words a property talk almost always has; "בית" is left out on
// purpose — "אני בבית" would wake the model for every friend.
const REAL_ESTATE_WORDS = [
  'דירה', 'דירות', 'נכס', 'נכסים', 'חדרים', "חד'", 'חד׳', 'מ"ר', 'מ״ר', 'מטר', 'למכירה', 'מכירה', 'למכור', 'מוכר', 'מוכרים',
  'לקנות', 'קונה', 'קונים', 'שכירות', 'להשכרה', 'משכנתא', 'מחיר', 'הצעה', 'בלעדיות', 'תיווך', 'מתווך', 'מתווכת', 'עמלה',
  'פנטהאוז', 'דופלקס', 'דירת גן', 'מגרש', 'קרקע', 'וילה', 'קוטג', 'נדל"ן', 'נדל״ן', 'נדלן', 'יד2', 'יד 2', 'מדלן',
  'שלט', 'טאבו', 'היתר', 'ממ"ד', 'ממ״ד', 'מרפסת', 'חניה', 'קומה', 'ביקור בנכס', 'לראות את הדירה', 'שמאי', 'שמאות',
];

function hasRealEstateWords(texts) {
  const t = (texts || []).join('\n');
  return REAL_ESTATE_WORDS.some((w) => t.includes(w));
}

// Amir 2026-10-30 (ניר קונה הבריגדה: "בודק עם השוכרים ומעדכן" was skipped):
// a Mango property's street, a visit being arranged, or a contact Amir saved
// as a buyer/seller is ALWAYS queued for his ✓/✗, whatever the model thinks.
// "ביקור" as a whole word only: "ביקורות" (restaurant reviews) woke it (שלומי, 2026-10-30).
const VISIT_RE = /ביקור(?![א-ת])/;
const VISIT_WORDS = [
  'לבקר בנכס', 'לבקר בדירה', 'לבוא לראות', 'להגיע לראות', 'לראות את הדירה', 'לראות את הנכס', 'לראות את הבית',
  'סיור בנכס', 'לתאם ביקור', 'תיאום ביקור', 'נתאם ביקור', 'לתאם לראות', 'שוכרים', 'השוכר',
];

/** Street names of Mango's properties ("הבריגדה היהודית 18") -> match keys: no number, no leading ה, plus a first word of 4+ letters. */
function streetKeys(streets) {
  const keys = [];
  for (const s of streets || []) {
    const full = String(s || '').replace(/\d+\s*[א-ת]?\s*$/, '').replace(/״/g, '"').trim();
    if (full.length < 3) continue;
    const bare = full.replace(/^ה/, '');
    keys.push({ key: bare, street: full });
    const first = bare.split(/\s+/)[0];
    if (first !== bare && first.length >= 4) keys.push({ key: first, street: full });
  }
  return keys;
}

/** A reason this chat/call must reach Amir, or null. -> { reason, property } */
function strongSignal({ name, texts, keys }) {
  const t = (texts || []).join('\n').replace(/״/g, '"');
  const n = String(name || '').replace(/״/g, '"');
  const hit = (keys || []).find((k) => t.includes(k.key) || n.includes(k.key));
  if (hit) return { reason: `נכס: ${hit.street}`, property: hit.street };
  const visit = VISIT_RE.test(t) ? 'ביקור' : VISIT_WORDS.find((w) => t.includes(w));
  if (visit) return { reason: 'תיאום ביקור', property: null, match: visit };
  if (n && REAL_ESTATE_WORDS.some((w) => n.includes(w))) return { reason: 'שם איש הקשר', property: null };
  return null;
}

/**
 * What to do with one chat that has new messages.
 * @returns {'lead'|'skip'|'check'|'candidate'} lead = summarize onto the lead;
 *   candidate = refresh the pending row; check = ask the model whether it is a
 *   real-estate inquiry; skip = nothing leaves the PC.
 */
// Mango's own numbers: Nir / ManyChat (054) talks to 052 all day and is never a lead.
const OWN_NUMBERS = new Set(['0545370056']);

function route({ phone, saved, newTexts, leadPhones, candidateStatus, signal }) {
  if (!phone || OWN_NUMBERS.has(phone)) return 'skip';
  if (!newTexts.length) return 'skip';
  if (leadPhones.has(phone)) return 'lead';
  if (candidateStatus === 'dismissed' || candidateStatus === 'approved') return 'skip';
  if (candidateStatus === 'pending') return 'candidate';
  if (!saved) return 'check';
  return signal || hasRealEstateWords(newTexts) ? 'check' : 'skip';
}

// Amir 2026-10-30 (Naor = "נאור קונה נלקין"): the name he saved in his phone is
// the lead's name. A name he typed in the dashboard (name_locked) always wins.
/** The new name for a lead, or null when nothing should change. */
function nameUpdate(lead, savedName) {
  const saved = String(savedName || '').trim();
  if (!lead || lead.name_locked || saved.length < 2) return null;
  if (/^[\d\s+\-()]+$/.test(saved)) return null; // a number, not a name
  return saved === String(lead.name || '').trim() ? null : saved;
}

const TYPE_LABEL = { image: '[תמונה]', video: '[וידאו]', ptt: '[הודעה קולית]', audio: '[הקלטה]', document: '[מסמך]', sticker: '[מדבקה]', location: '[מיקום]', vcard: '[איש קשר]', album: '[תמונות]' };

/** The text the model sees: the last messages, newest last, capped in size. */
function transcript(msgs, name, { maxMsgs = 30, maxChars = 6000 } = {}) {
  const lines = [];
  for (const m of msgs.slice(-maxMsgs)) {
    const text = m.body ? String(m.body).slice(0, 500) : TYPE_LABEL[m.type];
    if (!text) continue;
    const when = new Date(m.t * 1000).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
    lines.push(`[${when}] ${m.fromMe ? 'אמיר' : name || 'הצד השני'}: ${text}`);
  }
  let out = lines.join('\n');
  if (out.length > maxChars) out = out.slice(out.length - maxChars);
  return out;
}

const KINDS = ['buyer', 'seller', 'broker', 'other'];

/** Model output -> a safe object. Anything malformed means "not real estate". */
function parseVerdict(text) {
  try {
    const j = JSON.parse(String(text || '').trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, ''));
    const s = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
    return {
      relevant: j.relevant === true,
      kind: KINDS.includes(j.kind) ? j.kind : 'other',
      source: s(j.source, 80),
      property: s(j.property, 80),
      summary: s(j.summary, 200),
    };
  } catch {
    return { relevant: false, kind: 'other', source: null, property: null, summary: null };
  }
}

// ── the ledger: one cursor per chat (last message already read) ──────────────
// A message can reach the PC hours after it was sent (the phone was offline, or
// WhatsApp had not synced yet when the scan read). A single "read up to HH:MM"
// checkpoint skips it forever; a cursor per chat catches it on the next run.
const LATE_DAYS = 3; // how late a message may arrive and still be caught

/** Oldest message time any chat is read from (seconds): the scan's fixed start, but never more than LATE_DAYS back. */
function firstLookFloor(state, nowS, firstRunDays) {
  const start = typeof state.start === 'number' ? state.start : nowS - firstRunDays * 86_400;
  return Math.max(start, nowS - LATE_DAYS * 86_400);
}

/** Drop cursors that fall before any possible floor, so the state file stays small. */
function pruneSeen(seen, nowS) {
  const cut = nowS - LATE_DAYS * 86_400;
  return Object.fromEntries(Object.entries(seen).filter(([, t]) => t >= cut));
}

module.exports = { normalizePhone, hasRealEstateWords, streetKeys, strongSignal, nameUpdate, route, transcript, parseVerdict, firstLookFloor, pruneSeen, REAL_ESTATE_WORDS, VISIT_WORDS };
