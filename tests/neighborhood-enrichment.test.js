'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { selectHealCandidates } = require('../src/neighborhood-enrichment');

test('selectHealCandidates includes a geocoded property in an uncovered city', () => {
  const geocoded = [{ city: 'רעננה', address: 'רחוב ז\'בוטינסקי 5', neighborhood: 'מזרח רעננה' }];
  const covered  = new Set(['כפר סבא']);
  const result   = selectHealCandidates(geocoded, covered);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { city: 'רעננה', street: 'ז\'בוטינסקי', neighborhood: 'מזרח רעננה' });
});

test('selectHealCandidates skips a manually-curated city even if geocoded', () => {
  const geocoded = [{ city: 'כפר סבא', address: 'טבנקין 19', neighborhood: 'מרכז העיר' }];
  const covered  = new Set(['כפר סבא']);
  const result   = selectHealCandidates(geocoded, covered);
  assert.equal(result.length, 0);
});

test('selectHealCandidates skips properties geocoding never resolved', () => {
  const geocoded = [{ city: 'רעננה', address: 'רחוב לא ידוע 1', neighborhood: null }];
  const covered  = new Set(['כפר סבא']);
  const result   = selectHealCandidates(geocoded, covered);
  assert.equal(result.length, 0);
});

test('selectHealCandidates skips a property with no city', () => {
  const geocoded = [{ city: null, address: 'רחוב כלשהו 1', neighborhood: 'שכונה' }];
  const covered  = new Set(['כפר סבא']);
  const result   = selectHealCandidates(geocoded, covered);
  assert.equal(result.length, 0);
});
