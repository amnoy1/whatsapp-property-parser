'use strict';

const { createClient } = require('@supabase/supabase-js');

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  return createClient(url, key);
}

/**
 * Upsert all properties into the Supabase `properties` table.
 * Uses the property `id` (UUID) as the conflict key.
 * @param {Array} properties
 * @returns {Promise<number>} number of rows upserted
 */
async function upsertProperties(properties) {
  if (!properties.length) return 0;

  const supabase = getClient();
  const rows = properties.map(p => ({
    id:               p.id,
    property_type:    p.property_type    ?? null,
    address:          p.address,
    area_sqm:         p.area_sqm         ?? null,
    balcony_sqm:      p.balcony_sqm      ?? null,
    rooms:            p.rooms            ?? null,
    floor:            p.floor            ?? null,
    price:            p.price            ?? null,
    previous_price:   p.previous_price   ?? null,
    mamad:            p.mamad            ?? false,
    parking:          p.parking          ?? 0,
    storage:          p.storage          ?? false,
    elevator:         p.elevator         ?? false,
    broker_name:      p.broker_name      ?? null,
    broker_phone:     p.broker_phone     ?? null,
    first_seen_date:  p.first_seen_date  ?? null,
    last_seen_date:   p.last_seen_date   ?? null,
    updated_at:       new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('whatsapp_properties')
    .upsert(rows, { onConflict: 'id' });

  if (error) throw new Error(`Supabase DB upsert failed: ${error.message}`);
  return rows.length;
}

/**
 * Upload a Buffer to Supabase Storage (overwrites existing file).
 * @param {Buffer} buffer
 * @param {string} filename   e.g. 'latest.html' or 'latest.xlsx'
 * @param {string} contentType
 * @returns {Promise<string>} public URL of the uploaded file
 */
async function uploadToStorage(buffer, filename, contentType) {
  const supabase = getClient();

  // Use Blob so the content-type is embedded — plain Buffer causes Supabase to default to text/plain
  const blob = new Blob([buffer], { type: contentType });

  const { error } = await supabase.storage
    .from('reports')
    .upload(filename, blob, { contentType, upsert: true });

  if (error) throw new Error(`Supabase Storage upload failed (${filename}): ${error.message}`);

  const { data } = supabase.storage.from('reports').getPublicUrl(filename);
  return data.publicUrl;
}

module.exports = { upsertProperties, uploadToStorage };
