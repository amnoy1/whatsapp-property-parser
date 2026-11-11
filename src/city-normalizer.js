'use strict';

/**
 * Deterministic city fixes applied after the model extracts a property.
 * No model calls — pure string rules.
 *
 * Why: the extractor defaults the city to "כפר סבא", so a listing like
 * "רחוב הסחלב צופים" was stored as Kfar Saba and Nir offered it to Kfar Saba
 * leads (2026-11-11). The reverse also happened: Kfar Saba streets named after
 * cities ("יבנה 13", "אחי אילת 14") were stored as Yavne / Eilat.
 */

const DEFAULT_CITY = 'כפר סבא';

// Small nearby localities that show up inside the address text in the groups.
// Big cities (רעננה, הוד השרון...) are left to the model: some are also street names.
const NEARBY_LOCALITIES = [
  'צופים', 'צור יגאל', 'צור יצחק', 'כוכב יאיר', 'נווה ימין', 'אלפי מנשה',
  'ירחיב', 'שדה ורבורג', 'רמות השבים', 'גבעת חן', 'תל מונד', 'כפר יונה',
  'קדימה', 'צורן', 'נווה ירק', 'עדנים', 'ניר אליהו', 'נירית', 'בני דרור',
  'שער אפרים', 'תל יצחק', 'בר גיורא', 'גבעת אשכול',
];

// Kfar Saba neighborhoods the model sometimes returns as the city.
const KS_NEIGHBORHOOD_AS_CITY = {
  'ירוקה': 'הירוקה',
  'יירוקה': 'הירוקה',
  'הירוקה': 'הירוקה',
};

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function localityRegex(loc) {
  // whole words only; allows a "ב" prefix ("בצופים") and a comma before it
  return new RegExp(`(^|[\\s,])ב?${loc}(?=$|[\\s,])`);
}

function normalizeCity(prop) {
  const out = { ...prop };
  const address = clean(out.address);
  let city = clean(out.city) || DEFAULT_CITY;

  // 1. A Kfar Saba neighborhood returned as the city. The neighborhood itself is
  //    left to the street table (street_neighborhoods): "ג'ו עמר" was tagged
  //    "ירוקה" in a message but the table puts it in הזמר העברי.
  if (KS_NEIGHBORHOOD_AS_CITY[city]) {
    city = DEFAULT_CITY;
  }

  // 2. A Kfar Saba street named after a city ("יבנה 13", "אחי אילת 14"):
  //    the city name sits in the street part, before the house number,
  //    and the address does not end with the city ("התחייה 5 הוד השרון" stays).
  if (city !== DEFAULT_CITY && address) {
    const m = address.match(/^(.*?)\s*\d/);
    const street = m ? m[1] : '';
    if (street && street.includes(city) && !address.endsWith(city)) {
      city = DEFAULT_CITY;
    }
  }

  // 3. Default city, but the address names a nearby locality ("רחוב הסחלב צופים").
  if (city === DEFAULT_CITY && address) {
    const found = NEARBY_LOCALITIES
      .filter(loc => localityRegex(loc).test(address))
      .sort((a, b) => b.length - a.length)[0];
    if (found) {
      city = found;
      const rest = clean(address.replace(localityRegex(found), ' ').replace(/^[,\s]+|[,\s]+$/g, ''));
      out.address = rest || found;
    }
  }

  out.city = city;
  return out;
}

module.exports = { normalizeCity, NEARBY_LOCALITIES };
