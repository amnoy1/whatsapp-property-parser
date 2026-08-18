'use strict';

const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_FILE  = path.join(__dirname, '..', 'data', 'known-properties.json');
const EXPIRY_DAYS = 10;

function load() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function save(properties) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(properties, null, 2), 'utf8');
  } catch (err) {
    throw new Error(`Failed to save property database: ${err.message}`);
  }
}

function normalizeAddress(addr) {
  if (!addr) return '';
  return addr
    .trim()
    .replace(/\s+/g, ' ')
    // Remove street prefixes: רחוב, רח', רח, שד', שדרות, שדרות, דרך, סמטת, סמטה, פינת
    .replace(/^(רחוב|רח'|רח|שדרות|שד'|שד|דרך|סמטת|סמטה|פינת|פינה)\s+/i, '')
    .toLowerCase();
}

/**
 * Merge a newly extracted property into the existing list.
 * Returns { properties, action } where action = 'added' | 'updated' | 'skipped'
 */
function mergeProperty(properties, newProp) {
  const today   = new Date().toISOString().split('T')[0];
  const newAddr = normalizeAddress(newProp.address);

  if (!newAddr) return { properties, action: 'skipped' };

  const idx = properties.findIndex(
    p => normalizeAddress(p.address) === newAddr
  );

  if (idx === -1) {
    const record = {
      id:            uuidv4(),
      property_type: newProp.property_type  || null,
      address:       newProp.address,
      city:          newProp.city           || 'כפר סבא',
      neighborhood:  newProp.neighborhood   || null,
      area_sqm:      newProp.area_sqm       ?? null,
      balcony_sqm:   newProp.balcony_sqm    ?? null,
      rooms:         newProp.rooms          ?? null,
      floor:         newProp.floor          ?? null,
      price:         newProp.price          ?? null,
      mamad:         newProp.mamad          || false,
      parking:       newProp.parking        ?? 0,
      storage:       newProp.storage        || false,
      elevator:      newProp.elevator       || false,
      broker_name:   newProp.broker_name    || null,
      broker_phone:  newProp.broker_phone   || null,
      first_seen_date: today,
      last_seen_date:  today,
      previous_price:  null,
    };
    return { properties: [...properties, record], action: 'added' };
  }

  // Existing property — update last_seen
  const existing = { ...properties[idx], last_seen_date: today };

  // Price can only go down — ignore increases (assumed typo/error)
  if (
    newProp.price != null &&
    existing.price != null &&
    newProp.price < existing.price
  ) {
    existing.previous_price = existing.price;
    existing.price          = newProp.price;
    const updated = [...properties];
    updated[idx]  = existing;
    return { properties: updated, action: 'updated' };
  }

  const updated = [...properties];
  updated[idx]  = existing;
  return { properties: updated, action: 'skipped' };
}

/**
 * Deduplicate an existing list by normalized address.
 * Keeps the record with the earliest first_seen_date and the lowest price.
 * Call this once after load() to clean up historical duplicates.
 */
function deduplicateStore(properties) {
  const seen = new Map(); // normalizedAddr → index in result

  const result = [];
  for (const prop of properties) {
    const key = normalizeAddress(prop.address);
    if (!key) {
      result.push(prop);
      continue;
    }
    const existingIdx = seen.get(key);
    if (existingIdx === undefined) {
      seen.set(key, result.length);
      result.push(prop);
    } else {
      // Merge: keep earliest first_seen, latest last_seen, lowest price
      const existing = result[existingIdx];
      result[existingIdx] = {
        ...existing,
        first_seen_date: existing.first_seen_date < prop.first_seen_date
          ? existing.first_seen_date : prop.first_seen_date,
        last_seen_date: existing.last_seen_date > prop.last_seen_date
          ? existing.last_seen_date : prop.last_seen_date,
        price: (existing.price != null && prop.price != null)
          ? Math.min(existing.price, prop.price)
          : (existing.price ?? prop.price),
      };
    }
  }
  return result;
}

/**
 * Remove properties not seen for more than `days` days.
 */
function removeExpired(properties, days = EXPIRY_DAYS) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  return properties.filter(p => p.last_seen_date >= cutoffStr);
}

/**
 * Reset previous_price on all properties after the report is sent.
 */
function resetPreviousPrices(properties) {
  return properties.map(p => ({ ...p, previous_price: null }));
}

module.exports = { load, save, mergeProperty, deduplicateStore, removeExpired, resetPreviousPrices };
