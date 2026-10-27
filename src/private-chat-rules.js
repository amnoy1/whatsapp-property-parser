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

/**
 * What to do with one chat that has new messages.
 * @returns {'lead'|'skip'|'check'|'candidate'} lead = summarize onto the lead;
 *   candidate = refresh the pending row; check = ask the model whether it is a
 *   real-estate inquiry; skip = nothing leaves the PC.
 */
function route({ phone, saved, newTexts, leadPhones, candidateStatus }) {
  if (!phone) return 'skip';
  if (!newTexts.length) return 'skip';
  if (leadPhones.has(phone)) return 'lead';
  if (candidateStatus === 'dismissed' || candidateStatus === 'approved') return 'skip';
  if (candidateStatus === 'pending') return 'candidate';
  if (!saved) return 'check';
  return hasRealEstateWords(newTexts) ? 'check' : 'skip';
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

module.exports = { normalizePhone, hasRealEstateWords, route, transcript, parseVerdict, REAL_ESTATE_WORDS };
