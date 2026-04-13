'use strict';

const Airtable = require('airtable');

const BASE_ID  = process.env.AIRTABLE_BASE_ID || 'appI34peLLN3NSK7u';
const TABLE_ID = 'tbl7bHXoidYBQirZ2'; // נכסים מווצאפ

// Field name → Airtable field ID mapping
const FIELDS = {
  address:          'fldRQkdtZzwdBs4NR', // כתובת
  transaction_type: 'fldylz0UCTPDhCkkp', // סוג עסקה (singleSelect)
  area_sqm:         'fldqQDDrEFc1Gfdvu', // שטח מ"ר
  rooms:            'fldWA9ptpKZndGMoF', // חדרים
  floor:            'fld980LQkQ38ROwoA', // קומה
  price:            'fldtERk5ak3FiXRtO', // מחיר (currency)
  features:         'fldgG1OYXI7yr5nrC', // מאפיינים
  broker_name:      'fldwtmM8RM8fhtxlt', // שם מתווך
  broker_phone:     'fldQQfklMTJ69IL6i', // טלפון מתווך
  publish_date:     'fldvsh0sqs8yRe5gH', // תאריך פרסום (date)
  last_updated:     'fld74CArThZcU1w8y', // עדכון אחרון (dateTime)
  status:           'fldNhr4ACWY9owLRl', // מצב (singleSelect)
};

let _base = null;

function getBase() {
  if (!_base) {
    Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY });
    _base = new Airtable().base(BASE_ID);
  }
  return _base;
}

/**
 * Fetch all existing properties from Airtable.
 * Returns lightweight objects with just the fields needed for deduplication.
 * @returns {Promise<Array<{id: string, address, broker_name, broker_phone, rooms, area_sqm, price}>>}
 */
async function getExistingProperties() {
  const base = getBase();
  const records = [];

  await base(TABLE_ID)
    .select({
      fields: [
        FIELDS.address,
        FIELDS.broker_name,
        FIELDS.broker_phone,
        FIELDS.rooms,
        FIELDS.area_sqm,
        FIELDS.price,
        FIELDS.transaction_type,
        FIELDS.publish_date,
      ],
      pageSize: 100,
    })
    .eachPage((page, fetchNextPage) => {
      for (const rec of page) {
        records.push({
          id:               rec.id,
          address:          rec.get(FIELDS.address)          || null,
          broker_name:      rec.get(FIELDS.broker_name)      || null,
          broker_phone:     rec.get(FIELDS.broker_phone)     || null,
          rooms:            rec.get(FIELDS.rooms)            || null,
          area_sqm:         rec.get(FIELDS.area_sqm)         || null,
          price:            rec.get(FIELDS.price)            || null,
          transaction_type: rec.get(FIELDS.transaction_type) || null,
          publish_date:     rec.get(FIELDS.publish_date)     || null,
        });
      }
      fetchNextPage();
    });

  return records;
}

/**
 * Create a new property record in Airtable.
 * @param {Object} property
 * @returns {Promise<string>} New record ID
 */
async function createProperty(property) {
  const base = getBase();
  const fields = buildFields(property, true);

  const created = await base(TABLE_ID).create([{ fields }]);
  return created[0].getId();
}

/**
 * Update an existing property record (price change / details update).
 * @param {string} recordId
 * @param {Object} property
 * @returns {Promise<void>}
 */
async function updateProperty(recordId, property) {
  const base = getBase();

  const fields = {};

  // Only update price, features, and last_updated on dedup update
  if (property.price     != null) fields[FIELDS.price]        = property.price;
  if (property.features  != null) fields[FIELDS.features]     = property.features;
  if (property.area_sqm  != null) fields[FIELDS.area_sqm]     = property.area_sqm;

  // Always update the "last seen" timestamp
  fields[FIELDS.last_updated] = new Date().toISOString();

  await base(TABLE_ID).update([{ id: recordId, fields }]);
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Map our internal property object to Airtable field IDs */
function buildFields(property, isNew) {
  const fields = {};

  if (property.address)          fields[FIELDS.address]          = property.address;
  if (property.transaction_type) fields[FIELDS.transaction_type] = property.transaction_type;
  if (property.area_sqm  != null) fields[FIELDS.area_sqm]        = property.area_sqm;
  if (property.rooms     != null) fields[FIELDS.rooms]           = property.rooms;
  if (property.floor     != null) fields[FIELDS.floor]           = property.floor;
  if (property.price     != null) fields[FIELDS.price]           = property.price;
  if (property.features)          fields[FIELDS.features]        = property.features;
  if (property.broker_name)       fields[FIELDS.broker_name]     = property.broker_name;
  if (property.broker_phone)      fields[FIELDS.broker_phone]    = property.broker_phone;
  if (property.publish_date)      fields[FIELDS.publish_date]    = property.publish_date;

  fields[FIELDS.last_updated] = new Date().toISOString();

  if (isNew) {
    fields[FIELDS.status] = 'פעיל';
  }

  return fields;
}

module.exports = { getExistingProperties, createProperty, updateProperty };
