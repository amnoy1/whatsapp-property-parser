'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { normalizePhone, hasRealEstateWords, streetKeys, strongSignal, nameUpdate, route, transcript, parseVerdict, parseNext, firstLookFloor, pruneSeen } = require('../src/private-chat-rules');

const base = { phone: '0541234567', saved: true, newTexts: ['מה נשמע?'], leadPhones: new Set(), candidateStatus: undefined };

test('phones: WhatsApp 972 form and dashed form become 05XXXXXXXX; foreign / landline are dropped', () => {
  assert.equal(normalizePhone('972541234567'), '0541234567');
  assert.equal(normalizePhone('054-123-4567'), '0541234567');
  assert.equal(normalizePhone('15557654321'), null);
  assert.equal(normalizePhone('097654321'), null);
});

test('a known lead is always summarized, even small talk (the model decides if anything is new)', () => {
  assert.equal(route({ ...base, leadPhones: new Set(['0541234567']) }), 'lead');
});

test('an unknown number always goes to the model', () => {
  assert.equal(route({ ...base, saved: false }), 'check');
});

test('a saved contact (friend, supplier) stays on the PC unless they talk real estate', () => {
  assert.equal(route(base), 'skip');
  assert.equal(route({ ...base, newTexts: ['יש לי חבר שרוצה למכור דירה ברעננה'] }), 'check');
});

test('a broker in contacts is caught by the words brokers always use', () => {
  assert.equal(route({ ...base, newTexts: ['יש לי קונה ל-4 חד׳ בכפר סבא, בלעדיות?'] }), 'check');
});

test('a dismissed or already-approved number is never asked about again; a pending one is refreshed', () => {
  assert.equal(route({ ...base, saved: false, candidateStatus: 'dismissed' }), 'skip');
  assert.equal(route({ ...base, saved: false, candidateStatus: 'approved' }), 'skip');
  assert.equal(route({ ...base, candidateStatus: 'pending' }), 'candidate');
});

test("Nir's own ManyChat number (054) is never a lead, whatever it says", () => {
  assert.equal(route({ ...base, phone: '0545370056', saved: false, newTexts: ['דירת 5 חדרים בכפר סבא'] }), 'skip');
});

test('no new text (only a voice note or a call) -> nothing to read', () => {
  assert.equal(route({ ...base, saved: false, newTexts: [] }), 'skip');
});

const keys = streetKeys(['הבריגדה היהודית 18', 'נלקין 12', 'ש"י עגנון 16', 'הרב קטרוני 10', '', null]);

test('street keys: no house number, no leading ה, first word as a short form', () => {
  assert.deepEqual(keys.map((k) => k.key), ['בריגדה היהודית', 'בריגדה', 'נלקין', 'ש"י עגנון', 'רב קטרוני']);
});

test('ניר קונה הבריגדה (2026-10-30): a saved buyer with no real-estate word in the message still reaches Amir', () => {
  const signal = strongSignal({ name: 'ניר קונה הבריגדה היהודית', texts: ['בודק עם השוכרים ומעדכן.'], keys });
  assert.equal(signal.property, 'הבריגדה היהודית');
  assert.equal(route({ ...base, newTexts: ['בודק עם השוכרים ומעדכן.'], signal }), 'check');
});

test('with a signal, an existing lead is still updated, never re-queued as a new one', () => {
  const signal = strongSignal({ name: 'ניר קונה הבריגדה היהודית', texts: ['בודק עם השוכרים'], keys });
  assert.equal(route({ ...base, leadPhones: new Set(['0541234567']), newTexts: ['בודק עם השוכרים'], signal }), 'lead');
});

test('a Mango street in the message, with a Hebrew prefix, is a signal', () => {
  assert.equal(strongSignal({ name: 'יוסי', texts: ['מתי אפשר בבריגדה?'], keys }).property, 'הבריגדה היהודית');
  assert.equal(strongSignal({ name: 'יוסי', texts: ['ברחוב נלקין עדיין פנוי?'], keys }).property, 'נלקין');
});

test('arranging a visit is a signal; a contact saved as a buyer is a signal', () => {
  assert.equal(strongSignal({ name: 'דנה', texts: ['אפשר לבוא לראות מחר ב-5?'], keys }).reason, 'תיאום ביקור');
  assert.equal(strongSignal({ name: 'אלכס קונה הר צין', texts: ['תודה'], keys }).reason, 'שם איש הקשר');
});

test('a friend talking about nothing in particular is no signal and stays on the PC', () => {
  assert.equal(strongSignal({ name: 'שלומי', texts: ['יש לדיינר הזה ביקורות מעולות'], keys }), null);
  assert.equal(strongSignal({ name: 'שלומי', texts: ['מתי נוח לך ביקור?'], keys }).reason, 'תיאום ביקור');
  const signal = strongSignal({ name: 'גיא', texts: ['מה נשמע? נדבר בערב'], keys });
  assert.equal(signal, null);
  assert.equal(route({ ...base, signal }), 'skip');
});

test('names: the phone contact name replaces the WhatsApp profile name; a dashboard-typed name is never touched', () => {
  assert.equal(nameUpdate({ name: 'Naor' }, 'נאור קונה נלקין'), 'נאור קונה נלקין');
  assert.equal(nameUpdate({ name: null }, 'רבקה'), 'רבקה');
  assert.equal(nameUpdate({ name: 'Naor', name_locked: true }, 'נאור קונה נלקין'), null);
  assert.equal(nameUpdate({ name: 'נאור קונה נלקין' }, 'נאור קונה נלקין '), null);
  assert.equal(nameUpdate({ name: 'Naor' }, '+972 54-123-4567'), null);
  assert.equal(nameUpdate({ name: 'Naor' }, ''), null);
});

test('"אני בבית" alone does not wake the model', () => {
  assert.equal(hasRealEstateWords(['אני בבית, תתקשר']), false);
});

test('transcript: names the sides, labels media, keeps only the tail when long', () => {
  const t = transcript([
    { t: 1793100000, fromMe: false, type: 'chat', body: 'שלום, ראיתי את השלט' },
    { t: 1793100060, fromMe: true, type: 'chat', body: 'היי, איזה נכס?' },
    { t: 1793100120, fromMe: false, type: 'ptt', body: null },
  ], 'דנה');
  assert.match(t, /דנה: שלום, ראיתי את השלט/);
  assert.match(t, /אמיר: היי, איזה נכס\?/);
  assert.match(t, /\[הודעה קולית\]/);
  const long = transcript(Array.from({ length: 100 }, (_, i) => ({ t: 1793100000 + i, fromMe: false, type: 'chat', body: 'x'.repeat(400) })), 'a', { maxChars: 1000 });
  assert.ok(long.length <= 1000);
});

test('verdict: malformed output means "not real estate"; unknown kind -> other; empty source stays null', () => {
  assert.equal(parseVerdict('not json').relevant, false);
  const v = parseVerdict('```json\n{"relevant":true,"kind":"landlord","source":"","property":"נלקין","summary":"רוצה לראות דירה"}\n```');
  assert.equal(v.relevant, true);
  assert.equal(v.kind, 'other');
  assert.equal(v.source, null);
  assert.equal(v.property, 'נלקין');
});

test('next step (2026-10-30): not relevant / a dated step / nothing; bad dates and types are cleaned', () => {
  assert.deepEqual(parseNext({ kind: 'not_relevant', title: 'x' }), { kind: 'not_relevant' });
  assert.deepEqual(parseNext({ kind: 'step', type: 'schedule_visit', title: 'ביקור בנלקין', due_date: '2026-11-01', due_time: '17:00' }),
    { kind: 'step', type: 'schedule_visit', title: 'ביקור בנלקין', due_date: '2026-11-01', due_time: '17:00' });
  assert.deepEqual(parseNext({ kind: 'step', type: 'fly', due_date: 'ביום ראשון', due_time: '17:00' }),
    { kind: 'step', type: 'other', title: null, due_date: null, due_time: null });
  assert.equal(parseNext({ kind: 'none' }), null);
  assert.equal(parseNext(null), null);
  assert.deepEqual(parseVerdict('{"relevant":true,"summary":"ביטלה","next":{"kind":"not_relevant"}}').next, { kind: 'not_relevant' });
  assert.equal(parseVerdict('{"relevant":true,"summary":"x"}').next, null);
});

test('ledger: first run looks 3 days back; later runs read from the fixed start, at most 3 days back', () => {
  const now = 1793200000;
  assert.equal(firstLookFloor({}, now, 3), now - 3 * 86_400);
  assert.equal(firstLookFloor({ start: now - 3600 }, now, 3), now - 3600);
  assert.equal(firstLookFloor({ start: now - 10 * 86_400 }, now, 3), now - 3 * 86_400);
});

test('ledger: old cursors are dropped, recent ones kept', () => {
  const now = 1793200000;
  assert.deepEqual(pruneSeen({ a: now - 100, b: now - 4 * 86_400 }, now), { a: now - 100 });
});
