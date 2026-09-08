'use strict';

const { test } = require('node:test');
const assert    = require('node:assert/strict');
const {
  extractStreetName,
  candidateStreets,
  expandStreetVariants,
} = require('../src/neighborhood-lookup');

test('extractStreetName still handles the basic cases', () => {
  assert.equal(extractStreetName('רחוב שיפר 12'), 'שיפר');
  assert.equal(extractStreetName("הכלנית 28 ב'"), 'הכלנית');
  assert.equal(extractStreetName('משעול הסובלנות 7'), 'הסובלנות');
});

test('extractStreetName strips a house number followed by descriptive text', () => {
  // Real production example: neighborhood lookup was failing because "12 קדמת
  // הדרים" (a floor/position qualifier after the house number) was never
  // stripped — the old regex only matched a number at the very end of the string.
  assert.equal(extractStreetName('השיקמה 12 קדמת הדרים'), 'השיקמה');
});

test('extractStreetName normalizes a maqaf (Hebrew hyphen) to a space', () => {
  // Real production example: address said "רחוב בר־אילן" (maqaf), the curated
  // table stores "בר אילן" (plain space) — these never matched before.
  assert.equal(extractStreetName('רחוב בר־אילן'), 'בר אילן');
});

test('candidateStreets includes a variant with all internal punctuation stripped', () => {
  // Real production example: "רחוב ביל״ו 9" normalizes to "ביל\"ו", but the
  // curated table stores it as "בילו" with no punctuation at all.
  const candidates = candidateStreets('רחוב ביל״ו 9');
  assert.ok(candidates.includes('בילו'), `expected "בילו" in ${JSON.stringify(candidates)}`);
});

test('expandStreetVariants exposes a table row stored with its own street-type prefix', () => {
  // Real production example: table stores "סמטת אביבים" but the source address
  // just says "אביבים 8" — no prefix to match against on the address side, so
  // the table side has to offer the bare name too.
  const variants = expandStreetVariants('סמטת אביבים');
  assert.ok(variants.has('אביבים'), `expected "אביבים" in ${JSON.stringify([...variants])}`);
  assert.ok(variants.has('סמטת אביבים'));
});

test('expandStreetVariants exposes a punctuation-free form of a table row', () => {
  const variants = expandStreetVariants('ביל"ו');
  assert.ok(variants.has('בילו'), `expected "בילו" in ${JSON.stringify([...variants])}`);
});

test('expandStreetVariants exposes the ה/non-ה pair', () => {
  const variants = expandStreetVariants('כלנית');
  assert.ok(variants.has('כלנית'));
  assert.ok(variants.has('הכלנית'));
});
