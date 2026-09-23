'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { mergeProperty, deduplicateStore, removeExpired, resetPreviousPrices, looksLikeSameProperty, normalizeAddress } = require('../src/property-store');

function makeProperty(overrides = {}) {
  return {
    address:       'הרצל 12, תל אביב',
    property_type: 'דירה',
    area_sqm:      100,
    balcony_sqm:   null,
    rooms:         4,
    floor:         3,
    price:         3000000,
    mamad:         true,
    parking:       1,
    elevator:      true,
    broker_name:   'רון לוי',
    broker_phone:  '0521234567',
    ...overrides,
  };
}

test('mergeProperty adds new property', () => {
  const { properties, action } = mergeProperty([], makeProperty());
  assert.equal(action, 'added');
  assert.equal(properties.length, 1);
  assert.ok(properties[0].id, 'should have id');
  assert.ok(properties[0].first_seen_date, 'should have first_seen_date');
  assert.equal(properties[0].previous_price, null);
});

test('mergeProperty skips duplicate — same address, same price', () => {
  const { properties: initial } = mergeProperty([], makeProperty());
  const { properties: after, action } = mergeProperty(initial, makeProperty());
  assert.equal(action, 'skipped');
  assert.equal(after.length, 1);
});

test('mergeProperty updates when price drops', () => {
  const { properties: initial } = mergeProperty([], makeProperty({ price: 3000000 }));
  const { properties: updated, action } = mergeProperty(initial, makeProperty({ price: 2800000 }));
  assert.equal(action, 'updated');
  assert.equal(updated[0].price, 2800000);
  assert.equal(updated[0].previous_price, 3000000);
});

test('mergeProperty ignores price increase', () => {
  const { properties: initial } = mergeProperty([], makeProperty({ price: 3000000 }));
  const { properties: after, action } = mergeProperty(initial, makeProperty({ price: 3500000 }));
  assert.equal(action, 'skipped');
  assert.equal(after[0].price, 3000000);
  assert.equal(after[0].previous_price, null);
});

test('mergeProperty skips property with no address', () => {
  const { action } = mergeProperty([], makeProperty({ address: null }));
  assert.equal(action, 'skipped');
});

test('mergeProperty normalizes address whitespace for comparison', () => {
  const { properties: initial } = mergeProperty([], makeProperty({ address: '  הרצל 12, תל אביב  ' }));
  const { action } = mergeProperty(initial, makeProperty({ address: 'הרצל 12, תל אביב' }));
  assert.equal(action, 'skipped');
});

test('normalizeAddress treats Hebrew geresh and ASCII apostrophe as the same character', () => {
  assert.equal(normalizeAddress("רח' דב הוז"), normalizeAddress('רח׳ דב הוז'));
});

test('normalizeAddress treats Hebrew gershayim and ASCII double-quote as the same character', () => {
  assert.equal(normalizeAddress('רחוב אז"ר 118'), normalizeAddress('רחוב אז״ר 118'));
});

test('normalizeAddress ignores commas', () => {
  assert.equal(normalizeAddress('לוונברג, הירוקה 80'), normalizeAddress('לוונברג הירוקה 80'));
});

test('mergeProperty merges the same address written with a different geresh character', () => {
  const { properties: initial } = mergeProperty([], makeProperty({ address: 'רח׳ ארלוזורוב 25' }));
  const { action } = mergeProperty(initial, makeProperty({ address: "ארלוזורוב 25" }));
  assert.equal(action, 'skipped');
});

test('mergeProperty adds a new record — same street, no house number, but a different property type', () => {
  // e.g. a store and an apartment both on "רוטשילד" with no house number
  const { properties: initial } = mergeProperty([], makeProperty({
    address: 'רוטשילד', property_type: 'חנות', rooms: null, price: 4700,
  }));
  const { properties: after, action } = mergeProperty(initial, makeProperty({
    address: 'רוטשילד', property_type: 'פנטהאוז', rooms: 4, price: 2690000,
  }));
  assert.equal(action, 'added');
  assert.equal(after.length, 2);
});

test('mergeProperty adds a new record — same street, no house number, but a wildly different price', () => {
  // e.g. a rental (₪8,300/month) vs. a sale (₪3,390,000) on the same street
  const { properties: initial } = mergeProperty([], makeProperty({
    address: 'משעול גיל', rooms: 3, price: 8300,
  }));
  const { properties: after, action } = mergeProperty(initial, makeProperty({
    address: 'משעול גיל', rooms: 4, price: 3390000,
  }));
  assert.equal(action, 'added');
  assert.equal(after.length, 2);
});

test('mergeProperty still merges same address + same type + comparable price (real duplicate)', () => {
  const { properties: initial } = mergeProperty([], makeProperty({
    address: 'ויצמן 177', property_type: 'דירה', rooms: 4, price: 2490000,
  }));
  const { properties: after, action } = mergeProperty(initial, makeProperty({
    address: 'ויצמן 177', property_type: 'דירה', rooms: 4, price: 2490000,
  }));
  assert.equal(action, 'skipped');
  assert.equal(after.length, 1);
});

test('looksLikeSameProperty rejects a >3x price gap', () => {
  const a = makeProperty({ price: 8300 });
  const b = makeProperty({ price: 3390000 });
  assert.equal(looksLikeSameProperty(a, b), false);
});

test('looksLikeSameProperty accepts a modest price drop', () => {
  const a = makeProperty({ price: 3000000 });
  const b = makeProperty({ price: 2800000 });
  assert.equal(looksLikeSameProperty(a, b), true);
});

test('deduplicateStore keeps two distinct listings that share an address with no house number', () => {
  const props = [
    { id: '1', address: 'רוטשילד', property_type: 'חנות', rooms: null, price: 4700, first_seen_date: '2026-09-15', last_seen_date: '2026-09-15' },
    { id: '2', address: 'רוטשילד', property_type: 'פנטהאוז', rooms: 4, price: 2690000, first_seen_date: '2026-07-27', last_seen_date: '2026-07-27' },
  ];
  const result = deduplicateStore(props);
  assert.equal(result.properties.length, 2);
  assert.deepEqual(result.removedIds, []);
});

test('deduplicateStore merges a real duplicate and keeps the EARLIEST first_seen_date', () => {
  // Reproduces the 2026-09-23 bug: a re-added duplicate must not let the
  // merged record's first_seen_date jump forward to the newer copy's date.
  const props = [
    { id: 'old', address: 'חניתה 13', property_type: 'דירת גן', rooms: 3, price: 3850000, first_seen_date: '2026-09-08', last_seen_date: '2026-09-10' },
    { id: 'new', address: 'חניתה 13', property_type: 'דירת גן', rooms: 3, price: 3850000, first_seen_date: '2026-09-23', last_seen_date: '2026-09-23' },
  ];
  const result = deduplicateStore(props);
  assert.equal(result.properties.length, 1);
  assert.equal(result.properties[0].first_seen_date, '2026-09-08');
  assert.equal(result.properties[0].last_seen_date, '2026-09-23');
  assert.deepEqual(result.removedIds, ['new']);
});

test('removeExpired removes properties not seen in N days', () => {
  const today  = new Date().toISOString().split('T')[0];
  const old    = '2020-01-01';
  const props  = [
    { id: '1', address: 'א', last_seen_date: old,   previous_price: null },
    { id: '2', address: 'ב', last_seen_date: today, previous_price: null },
  ];
  const result = removeExpired(props, 10);
  assert.equal(result.properties.length, 1);
  assert.equal(result.properties[0].id, '2');
  assert.deepEqual(result.removedIds, ['1']);
});

test('resetPreviousPrices sets all previous_price to null', () => {
  const props = [
    { id: '1', previous_price: 3000000 },
    { id: '2', previous_price: null },
  ];
  const result = resetPreviousPrices(props);
  assert.equal(result[0].previous_price, null);
  assert.equal(result[1].previous_price, null);
});
