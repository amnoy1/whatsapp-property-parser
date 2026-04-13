'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();
const MODEL  = 'claude-haiku-4-5';

/**
 * Check if a newly extracted property already exists in Airtable.
 *
 * First does a cheap keyword filter to find candidates,
 * then uses Claude Haiku to decide if it's the same property.
 *
 * @param {Object} newProperty  - The newly extracted property
 * @param {Array}  existingList - Records from getExistingProperties()
 * @returns {Promise<{isDuplicate: boolean, existingId: string|null, priceChanged: boolean}>}
 */
async function findDuplicate(newProperty, existingList) {
  if (!existingList || existingList.length === 0) {
    return { isDuplicate: false, existingId: null, priceChanged: false };
  }

  // ── Step 1: cheap filter ─────────────────────────────────────────────────
  // Keep only candidates that share broker phone OR (same broker name AND similar rooms)
  const candidates = existingList.filter(ex => {
    // Same broker phone = strong signal
    if (newProperty.broker_phone && ex.broker_phone &&
        cleanPhone(newProperty.broker_phone) === cleanPhone(ex.broker_phone)) {
      return true;
    }
    // Same broker name + same room count = possible duplicate
    if (newProperty.broker_name && ex.broker_name &&
        normalizeName(newProperty.broker_name) === normalizeName(ex.broker_name) &&
        newProperty.rooms != null && ex.rooms != null &&
        Math.abs(newProperty.rooms - ex.rooms) < 0.1) {
      return true;
    }
    return false;
  });

  if (candidates.length === 0) {
    return { isDuplicate: false, existingId: null, priceChanged: false };
  }

  // ── Step 2: ask Claude to decide ─────────────────────────────────────────
  const candidatesSummary = candidates.map((c, i) =>
    `[${i + 1}] ID=${c.id} | כתובת: ${c.address || '?'} | ` +
    `חדרים: ${c.rooms ?? '?'} | שטח: ${c.area_sqm ?? '?'} מ"ר | ` +
    `מחיר: ${c.price ?? '?'} | מתווך: ${c.broker_name || '?'} (${c.broker_phone || '?'})`
  ).join('\n');

  const newSummary =
    `כתובת: ${newProperty.address || '?'} | ` +
    `חדרים: ${newProperty.rooms ?? '?'} | שטח: ${newProperty.area_sqm ?? '?'} מ"ר | ` +
    `מחיר: ${newProperty.price ?? '?'} | מתווך: ${newProperty.broker_name || '?'} (${newProperty.broker_phone || '?'})`;

  const prompt = `האם הנכס החדש הוא כפל של אחד הנכסים הקיימים?

נכס חדש:
${newSummary}

נכסים קיימים:
${candidatesSummary}

החזר JSON בדיוק כך:
{
  "is_duplicate": true/false,
  "existing_id": "recXXXXX" או null,
  "reason": "הסבר קצר"
}

הנחיות:
- is_duplicate = true רק אם כמעט בוודאות מדובר באותו נכס (כתובת + מתווך תואמים)
- אם יש ספק, החזר false
- existing_id = ה-ID של הרשומה התואמת, או null`;

  try {
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 200,
      messages:   [{ role: 'user', content: prompt }],
    });

    const text     = response.content[0]?.text?.trim();
    const jsonText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const result   = JSON.parse(jsonText);

    if (!result.is_duplicate || !result.existing_id) {
      return { isDuplicate: false, existingId: null, priceChanged: false };
    }

    // Check if price changed
    const existing = candidates.find(c => c.id === result.existing_id);
    const priceChanged = existing && newProperty.price != null &&
      existing.price != null &&
      Math.abs(existing.price - newProperty.price) > 0;

    return {
      isDuplicate:  true,
      existingId:   result.existing_id,
      priceChanged,
    };

  } catch (err) {
    if (process.env.DEBUG) {
      console.error('  [deduplicator] Error:', err.message);
    }
    // On error, treat as new to avoid data loss
    return { isDuplicate: false, existingId: null, priceChanged: false };
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function cleanPhone(p) {
  return String(p).replace(/\D/g, '');
}

function normalizeName(name) {
  return String(name).trim().replace(/\s+/g, ' ').toLowerCase();
}

module.exports = { findDuplicate };
