'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const MODEL = 'claude-haiku-4-5';

const SYSTEM_PROMPT = `אתה מומחה בחילוץ מידע על נכסי נדל"ן מהודעות WhatsApp שנשלחות על ידי מתווכים ישראלים.
המשימה: לנתח הודעות ולהחזיר JSON מובנה עם פרטי הנכס.
החזר תמיד JSON תקין בלבד, ללא טקסט נוסף.`;

/**
 * Extract property data from a single message block using Claude Haiku.
 * @param {{sender: string, date: string, text: string}} block
 * @returns {Promise<Object|null>} Extracted property or null if not a listing
 */
async function extractProperty(block) {
  const userPrompt = `שם השולח: ${block.sender}
תאריך: ${block.date}
הודעות:
${block.text}

חלץ את פרטי הנכס מהטקסט לעיל והחזר JSON בדיוק בפורמט הבא:
{
  "is_property_listing": true/false,
  "address": "כתובת מלאה או חלקית או null",
  "city": "שם עיר או null",
  "transaction_type": "מכירה" או "השכרה" או null,
  "area_sqm": מספר או null,
  "rooms": מספר (כולל חצאים כגון 3.5) או null,
  "floor": מספר או null,
  "price": מספר שלם ללא פסיקים (למשל 2500000) או null,
  "features": "רשימה מופרדת בפסיקים של מאפיינים: ממ\\"ד, חניה, מעלית, מרפסת, גינה, מחסן, שיפוץ וכו'" או null,
  "broker_name": "שם המתווך",
  "broker_phone": "מספר טלפון ספרות בלבד ללא מקף" או null
}

חוקים:
- is_property_listing = false אם ההודעה אינה על נכס למכירה/השכרה (שאלה, שיחה, מודעה לחיפוש וכו')
- broker_name = שם השולח אם לא מופיע שם אחר
- price: אם כתוב "2.5 מיליון" → 2500000, "1.8M" → 1800000, "1,800,000" → 1800000
- rooms: "4 חד'" או "4 חדרים" → 4, "3.5 חד'" → 3.5
- החזר null עבור כל שדה שלא נמצא בהודעה`;

  try {
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 512,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0]?.text?.trim();
    if (!text) return null;

    // Strip markdown code fences if present
    const jsonText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const data = JSON.parse(jsonText);

    if (!data.is_property_listing) return null;

    return {
      address:          data.address          || null,
      city:             data.city             || null,
      transaction_type: data.transaction_type || null,
      area_sqm:         toNumber(data.area_sqm),
      rooms:            toNumber(data.rooms),
      floor:            toNumber(data.floor),
      price:            toNumber(data.price),
      features:         data.features         || null,
      broker_name:      data.broker_name      || block.sender,
      broker_phone:     cleanPhone(data.broker_phone),
      publish_date:     block.date,
    };
  } catch (err) {
    // JSON parse failure or API error — skip this block
    if (process.env.DEBUG) {
      console.error(`  [extractor] Error on block from ${block.sender}:`, err.message);
    }
    return null;
  }
}

/**
 * Process an array of message blocks and return extracted properties.
 * Runs with limited concurrency to respect API rate limits.
 *
 * @param {Array} blocks
 * @returns {Promise<Array>}
 */
async function extractProperties(blocks) {
  const results = [];
  const CONCURRENCY = 5;

  for (let i = 0; i < blocks.length; i += CONCURRENCY) {
    const batch = blocks.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(extractProperty));

    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value);
      }
    }

    // Small delay between batches to avoid hitting rate limits
    if (i + CONCURRENCY < blocks.length) {
      await sleep(500);
    }
  }

  return results;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function toNumber(val) {
  if (val === null || val === undefined) return null;
  const n = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function cleanPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 9) return null;
  // Normalize Israeli numbers: 972XXXXXXXXX → 0XXXXXXXXX
  if (digits.startsWith('972') && digits.length === 12) {
    return '0' + digits.slice(3);
  }
  return digits;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { extractProperty, extractProperties };
