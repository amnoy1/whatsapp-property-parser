'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { normalizePhone, hasRealEstateWords, route, transcript, parseVerdict } = require('../src/private-chat-rules');

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

test('no new text (only a voice note or a call) -> nothing to read', () => {
  assert.equal(route({ ...base, saved: false, newTexts: [] }), 'skip');
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
