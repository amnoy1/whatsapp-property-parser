'use strict';

const fs = require('fs');

// WhatsApp Export line patterns:
// iOS:     [DD/MM/YYYY, HH:MM:SS] Name: text
// Android: DD/MM/YYYY, HH:MM - Name: text
// Some variants use 2-digit year or AM/PM
const IOS_PATTERN     = /^\[(\d{1,2}[\/\.]?\d{1,2}[\/\.]?\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\]\s*([^:]+):\s*(.*)/;
const ANDROID_PATTERN = /^(\d{1,2}[\/\.]?\d{1,2}[\/\.]?\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\s+-\s+([^:]+):\s*(.*)/;

// System messages to skip (Hebrew + English)
const SYSTEM_PHRASES = [
  'end-to-end encrypted',
  'מוצפנות מקצה לקצה',
  'joined using this group',
  'הצטרף לקבוצה',
  'הצטרפה לקבוצה',
  'left the group',
  'עזב את הקבוצה',
  'עזבה את הקבוצה',
  'was added',
  'הוסיף',
  'הוסיפה',
  'changed the group',
  'שינה את שם הקבוצה',
  'שינתה את שם הקבוצה',
  '<Media omitted>',
  'תמונה לא נכללה',
  'וידאו לא נכלל',
  'קובץ לא נכלל',
  'הודעה זו נמחקה',
  'You deleted this message',
];

/**
 * Parse a WhatsApp export .txt file.
 * @param {string} filePath - Path to the exported .txt file
 * @returns {Array<{sender: string, date: string, time: string, text: string}>}
 */
function parseExportFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');

  // Strip BOM and Unicode directional marks
  const content = raw
    .replace(/^\uFEFF/, '')
    .replace(/[\u200E\u200F\u202A-\u202E]/g, '');

  const lines = content.split(/\r?\n/);
  const messages = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const iosMatch     = trimmed.match(IOS_PATTERN);
    const androidMatch = !iosMatch && trimmed.match(ANDROID_PATTERN);
    const match        = iosMatch || androidMatch;

    if (match) {
      if (current) messages.push(current);
      const [, rawDate, rawTime, rawSender, rawText] = match;
      current = {
        date:   normalizeDate(rawDate),
        time:   rawTime.trim(),
        sender: rawSender.trim(),
        text:   rawText.trim(),
      };
    } else if (current) {
      // Multi-line message continuation
      current.text += '\n' + trimmed;
    }
  }

  if (current) messages.push(current);

  // Filter system messages
  return messages.filter(m => !isSystemMessage(m.text));
}

/**
 * Group consecutive messages from the same sender into blocks.
 * Two messages are considered "consecutive" if they are adjacent in the chat
 * AND sent within 60 minutes of each other (same posting session).
 *
 * @param {Array} messages
 * @returns {Array<{sender: string, date: string, text: string}>}
 */
function groupConsecutiveMessages(messages) {
  const blocks = [];
  let current = null;

  for (const msg of messages) {
    if (
      current &&
      current.sender === msg.sender &&
      current.date === msg.date &&
      minutesBetween(current.lastTime, msg.time) <= 60
    ) {
      current.text    += '\n' + msg.text;
      current.lastTime = msg.time;
    } else {
      if (current) blocks.push(toBlock(current));
      current = {
        sender:   msg.sender,
        date:     msg.date,
        lastTime: msg.time,
        text:     msg.text,
      };
    }
  }

  if (current) blocks.push(toBlock(current));

  return blocks;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function isSystemMessage(text) {
  return SYSTEM_PHRASES.some(phrase => text.includes(phrase));
}

function toBlock(current) {
  return { sender: current.sender, date: current.date, text: current.text };
}

/** Convert DD/MM/YYYY (or variants) to YYYY-MM-DD */
function normalizeDate(raw) {
  // Remove dots and replace with slashes for uniform parsing
  const s = raw.replace(/\./g, '/');
  const parts = s.split('/');
  if (parts.length !== 3) return raw;
  let [d, m, y] = parts;
  if (y.length === 2) y = '20' + y;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** Return minutes between two HH:MM[:SS] strings */
function minutesBetween(t1, t2) {
  const toMinutes = t => {
    const [h, m] = t.replace(/[AP]M/i, '').trim().split(':').map(Number);
    return h * 60 + (m || 0);
  };
  return Math.abs(toMinutes(t2) - toMinutes(t1));
}

module.exports = { parseExportFile, groupConsecutiveMessages };
