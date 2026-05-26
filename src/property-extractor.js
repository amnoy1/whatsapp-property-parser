'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();
const MODEL  = 'claude-haiku-4-5';

const SYSTEM_PROMPT = `אתה מומחה בחילוץ מידע על נכסי נדל"ן מהודעות WhatsApp שנשלחות על ידי מתווכים ישראלים.
המשימה: לנתח הודעה ולהחזיר JSON מערך עם כל הנכסים שמוזכרים בה.
החזר תמיד JSON תקין בלבד, ללא טקסט נוסף.`;

async function extractProperty(block) {
  const userPrompt = `שם השולח: ${block.sender}
תאריך: ${block.date}
הודעה:
${block.text}

חלץ את כל הנכסים מהטקסט לעיל. יכולים להיות נכס אחד או יותר באותה הודעה.
החזר JSON מערך בדיוק בפורמט הבא (גם אם יש נכס אחד בלבד):
[
  {
    "property_type": "דירה" / "פנטהאוז" / "דירת גן" / "דופלקס" / "וילה" / "קוטג'" / "חנות" / "משרד" / "מחסן" / null,
    "address": "כתובת מלאה או חלקית או null",
    "city": "שם עיר או null",
    "area_sqm": מספר שלם או null,
    "balcony_sqm": מספר שלם של שטח מרפסת או גינה (מ"ר) או null,
    "rooms": מספר (כולל חצאים כגון 3.5) או null,
    "floor": מספר או null,
    "price": מספר שלם ללא פסיקים (למשל 2500000) או null,
    "mamad": true/false,
    "parking": 0 או 1 או 2 (מספר חניות — 0 אם אין),
    "storage": true/false,
    "elevator": true/false,
    "broker_name": "שם המתווך",
    "broker_phone": "מספר טלפון ספרות בלבד" או null
  }
]

חוקים:
- החזר מערך ריק [] אם ההודעה אינה על נכסים למכירה/השכרה (שאלה, שיחה, חיפוש וכו')
- broker_name = שם השולח אם לא מופיע שם אחר
- price: "2.5 מיליון" → 2500000, "1.8M" → 1800000, "1,800,000" → 1800000
- rooms: "4 חד'" → 4, "3.5 חד'" → 3.5
- mamad: true רק אם מופיע מפורשות ממ"ד / מרחב מוגן
- parking: ספור חניות מפורשות. 0 אם לא הוזכרו.
- storage: true רק אם מוזכר מפורשות מחסן
- elevator: true רק אם מוזכר מפורשות מעלית
- החזר null עבור שדות שלא נמצאו`;

  try {
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 2048,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0]?.text?.trim();
    if (!text) return [];

    const jsonText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const arr      = JSON.parse(jsonText);

    if (!Array.isArray(arr) || arr.length === 0) return [];

    return arr.map(data => ({
      property_type: data.property_type  || null,
      address:       data.address        || null,
      city:          data.city           || null,
      area_sqm:      toNumber(data.area_sqm),
      balcony_sqm:   toNumber(data.balcony_sqm),
      rooms:         toNumber(data.rooms),
      floor:         toNumber(data.floor),
      price:         toNumber(data.price),
      mamad:         Boolean(data.mamad),
      parking:       toParking(data.parking),
      storage:       Boolean(data.storage),
      elevator:      Boolean(data.elevator),
      broker_name:   data.broker_name    || block.sender,
      broker_phone:  cleanPhone(data.broker_phone),
      publish_date:  block.date,
    }));
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`  [extractor] Error on block from ${block.sender}:`, err.message);
    }
    return [];
  }
}

async function extractProperties(blocks) {
  const results     = [];
  const CONCURRENCY = 5;

  for (let i = 0; i < blocks.length; i += CONCURRENCY) {
    const batch   = blocks.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(extractProperty));
    for (const r of settled) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        results.push(...r.value);
      }
    }
    if (i + CONCURRENCY < blocks.length) await sleep(500);
  }

  return results;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function toNumber(val) {
  if (val === null || val === undefined) return null;
  const n = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function toParking(val) {
  const n = parseInt(val, 10);
  if (isNaN(n)) return 0;
  return Math.min(Math.max(n, 0), 2);
}

function cleanPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 9) return null;
  if (digits.startsWith('972') && digits.length === 12) return '0' + digits.slice(3);
  return digits;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { extractProperty, extractProperties };
