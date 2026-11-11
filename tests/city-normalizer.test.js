'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { normalizeCity } = require('../src/city-normalizer');

const n = (address, city, neighborhood = null) => normalizeCity({ address, city, neighborhood });

test('locality inside the address moves to the city (הסחלב צופים, 2026-11-11)', () => {
  const r = n('רחוב הסחלב צופים', 'כפר סבא');
  assert.equal(r.city, 'צופים');
  assert.equal(r.address, 'רחוב הסחלב');
});

test('locality with ב prefix and comma', () => {
  assert.equal(n('הדקל 4, בצור יגאל', 'כפר סבא').city, 'צור יגאל');
  assert.equal(n('הדקל 4, בצור יגאל', 'כפר סבא').address, 'הדקל 4');
});

test('address that is only the locality keeps it as address', () => {
  const r = n('צור יצחק', 'כפר סבא');
  assert.equal(r.city, 'צור יצחק');
  assert.equal(r.address, 'צור יצחק');
});

test('Kfar Saba streets named after cities stay in Kfar Saba', () => {
  assert.equal(n('יבנה 13', 'יבנה').city, 'כפר סבא');
  assert.equal(n('אחי אילת 14', 'אילת').city, 'כפר סבא');
});

test('real other-city addresses are untouched', () => {
  assert.equal(n('התחייה 5 הוד השרון', 'הוד השרון').city, 'הוד השרון');
  assert.equal(n('המייסדים 5, רעננה', 'רעננה').city, 'רעננה');
  assert.equal(n('גלעד 9', 'אלפי מנשה').city, 'אלפי מנשה');
  assert.equal(n('מרכז העיר רעננה', 'רעננה').city, 'רעננה');
});

test('ירוקה as city becomes כפר סבא; neighborhood left to the street table', () => {
  const r = n("ג'ו עמר 7", 'ירוקה');
  assert.equal(r.city, 'כפר סבא');
  assert.equal(r.neighborhood, null);
  assert.equal(n('מתחם 80', 'יירוקה').city, 'כפר סבא');
});

test('plain Kfar Saba address unchanged', () => {
  const r = n('ויצמן 120', 'כפר סבא', 'מרכז');
  assert.deepEqual(r, { address: 'ויצמן 120', city: 'כפר סבא', neighborhood: 'מרכז' });
});

test('locality word inside a longer word does not match', () => {
  assert.equal(n('הצופים 3', 'כפר סבא').city, 'כפר סבא');
});
