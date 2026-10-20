'use strict';

// Canonical neighborhood names (Amir, 2026-10-20). The curated
// street_neighborhoods table is the canonical list; the street map wins over
// the message; known variants map to one name. No network: the table rows
// are passed in.

const { test } = require('node:test');
const assert    = require('node:assert/strict');
const {
  canonicalNeighborhood,
  cleanedNeighborhoodText,
  neighborhoodFromAddress,
  normalizeNeighborhoodsWithRows,
  candidateStreets,
  streetVariants,
} = require('../src/neighborhood-lookup');

const KS = 'כפר סבא';
const CANON = new Set(['הפרחים', 'הירוקה', 'הזמר העברי', 'תקומה הראשונים', 'הדרים', 'הפארק', 'מרכז העיר דרום', 'אליעזר', 'גני שרון']);

test('broker spellings map to the canonical name', () => {
  const cases = {
    'שכונת הפרחים': 'הפרחים',
    'בירוקה': 'הירוקה',
    'כפר סבא הירוקה': 'הירוקה',
    'השכונה הירוקה': 'הירוקה',
    'ירוקה 80': 'הירוקה',
    'זמר העברי הירוקה': 'הזמר העברי',
    'הזמר העיברי': 'הזמר העברי',
    'הזמר העברי': 'הזמר העברי',
    'הראשונים': 'תקומה הראשונים',
    'הדרים החדשה': 'הדרים',
    'שכונת הדרים החדשה': 'הדרים',
    'שכונת הפארק': 'הפארק',
    'שכונת אליעזר': 'אליעזר',
    'גני השרון': 'גני שרון',
  };
  for (const [raw, want] of Object.entries(cases)) {
    assert.equal(canonicalNeighborhood(raw, CANON, KS), want, raw);
  }
});

test('an unknown name is not forced into the list, only cleaned', () => {
  assert.equal(canonicalNeighborhood('מרכז העיר', CANON, KS), null);
  assert.equal(canonicalNeighborhood('ארנונה', CANON, KS), null);
  assert.equal(cleanedNeighborhoodText('שכונת כיסופים'), 'כיסופים');
  assert.equal(cleanedNeighborhoodText('מרכז העיר'), 'מרכז העיר');
  assert.equal(cleanedNeighborhoodText('שכונת 2003'), 'שכונת 2003');
});

test('an address that is really a neighborhood name', () => {
  assert.equal(neighborhoodFromAddress('פרחים', CANON, KS), 'הפרחים');
  assert.equal(neighborhoodFromAddress('פרחים כפס', CANON, KS), 'הפרחים');
  assert.equal(neighborhoodFromAddress('ירוקה 80', CANON, KS), 'הירוקה');
  assert.equal(neighborhoodFromAddress('יירוקה 80', CANON, KS), 'הירוקה');
  assert.equal(neighborhoodFromAddress('בראשונים 3', CANON, KS), 'תקומה הראשונים');
  assert.equal(neighborhoodFromAddress('רחוב שקט', CANON, KS), null);
  assert.equal(neighborhoodFromAddress('ויצמן 12', CANON, KS), null);
});

test('street candidates: a glued ב is tried, after the plain form', () => {
  const c = candidateStreets('בששת הימים 14');
  assert.ok(c.includes('ששת הימים'));
  assert.ok(c.indexOf('בששת הימים') < c.indexOf('ששת הימים'));
  assert.ok(candidateStreets('במשעול האהבה').includes('משעול האהבה'));
});

test('street variants collapse a doubled yod: וייצמן matches ויצמן', () => {
  assert.ok(streetVariants('וייצמן').includes('ויצמן'));
});

test('street variants: an ASCII hyphen is a space, full spelling meets defective', () => {
  const props = [
    { address: 'רחוב בר-אילן', city: KS, neighborhood: null },
    { address: 'השיקמה 12 קדמת הדרים', city: KS, neighborhood: null },
  ];
  normalizeNeighborhoodsWithRows(props, [
    { city: KS, street: 'בר אילן', neighborhood: 'מוצקין' },
    { city: KS, street: 'השקמה', neighborhood: 'גבעת אשכול' },
  ]);
  assert.equal(props[0].neighborhood, 'מוצקין');
  assert.equal(props[1].neighborhood, 'גבעת אשכול');
});

test('the yod-less fallback never beats an exact street', () => {
  const props = [{ address: 'הירדן 3', city: KS, neighborhood: null }];
  normalizeNeighborhoodsWithRows(props, [
    { city: KS, street: 'הרדן', neighborhood: 'א' },
    { city: KS, street: 'הירדן', neighborhood: 'ב' },
  ]);
  assert.equal(props[0].neighborhood, 'ב');
});

const ROWS = [
  { city: KS, street: 'ויצמן', neighborhood: 'מרכז העיר דרום' },
  { city: KS, street: 'ששת הימים', neighborhood: 'הדרים' },
  { city: KS, street: 'יאיר רוזנבלום', neighborhood: 'הזמר העיברי' },
  { city: KS, street: 'נלקין', neighborhood: 'כפר סבא הירוקה' },
  { city: KS, street: 'היסמין', neighborhood: 'הפרחים' },
];

test('the street map wins over the message (decision 4)', () => {
  const props = [{ address: 'וייצמן 88', city: KS, neighborhood: 'הירוקה' }];
  const stats = normalizeNeighborhoodsWithRows(props, ROWS);
  assert.equal(props[0].neighborhood, 'מרכז העיר דרום');
  assert.equal(stats.fromStreet, 1);
});

test('table values are canonicalized too (the old spellings in the table)', () => {
  const props = [
    { address: 'יאיר רוזנבלום 15', city: KS, neighborhood: 'זמר העברי הירוקה' },
    { address: 'נלקין 12', city: KS, neighborhood: null },
  ];
  normalizeNeighborhoodsWithRows(props, ROWS);
  assert.equal(props[0].neighborhood, 'הזמר העברי');
  assert.equal(props[1].neighborhood, 'הירוקה');
});

test('no street match: the message neighborhood is canonicalized or cleaned', () => {
  const props = [
    { address: 'רחוב לא ידוע 4', city: KS, neighborhood: 'שכונת הפרחים' },
    { address: 'רחוב לא ידוע 5', city: KS, neighborhood: 'שכונת כיסופים' },
  ];
  const stats = normalizeNeighborhoodsWithRows(props, ROWS);
  assert.equal(props[0].neighborhood, 'הפרחים');
  assert.equal(props[1].neighborhood, 'כיסופים');
  assert.equal(stats.canonicalized, 2);
});

test('no street, no neighborhood: the address itself, else left for geocoding', () => {
  const props = [
    { address: 'בששת הימים 14', city: KS, neighborhood: null },
    { address: 'פרחים', city: KS, neighborhood: null },
    { address: 'רחוב שקט', city: KS, neighborhood: null },
  ];
  normalizeNeighborhoodsWithRows(props, ROWS);
  assert.equal(props[0].neighborhood, 'הדרים');
  assert.equal(props[1].neighborhood, 'הפרחים');
  assert.equal(props[2].neighborhood, null);
});

test('another city: no rows, nothing invented', () => {
  const props = [{ address: 'מולדת 4', city: 'הוד השרון', neighborhood: 'שכונת גני צבי' }];
  normalizeNeighborhoodsWithRows(props, ROWS);
  assert.equal(props[0].neighborhood, 'גני צבי');
});
