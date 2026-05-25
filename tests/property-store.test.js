'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { mergeProperty, removeExpired, resetPreviousPrices } = require('../src/property-store');

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
  const { action } = mergeProperty(initial, makeProperty());
  assert.equal(action, 'skipped');
  assert.equal(initial.length, 1);
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

test('removeExpired removes properties not seen in N days', () => {
  const today  = new Date().toISOString().split('T')[0];
  const old    = '2020-01-01';
  const props  = [
    { id: '1', address: 'א', last_seen_date: old,   previous_price: null },
    { id: '2', address: 'ב', last_seen_date: today, previous_price: null },
  ];
  const result = removeExpired(props, 10);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '2');
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
