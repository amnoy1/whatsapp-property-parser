# Daily Property Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automated daily WhatsApp report that collects property listings from 3 Sharon-area groups, maintains a deduplicated master database, and sends a formatted Excel file every morning at 08:00.

**Architecture:** Windows Task Scheduler runs `daily-report.js` at 08:00. `whatsapp-client.js` connects headlessly via whatsapp-web.js (no WhatsApp Desktop needed), fetches 24h of messages from 3 groups. `property-extractor.js` uses Claude Haiku to extract structured data. `property-store.js` maintains a cumulative JSON database with address-based dedup. `excel-generator.js` produces a styled RTL Excel file, which is sent back as a WhatsApp message.

**Tech Stack:** Node.js (CommonJS), whatsapp-web.js, @anthropic-ai/sdk (Claude Haiku), exceljs, uuid, Windows Task Scheduler

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/property-extractor.js` | Modify | Add `property_type`, `mamad`, `parking` (0/1/2), `elevator`, `balcony_sqm`; remove `transaction_type`, `features` |
| `src/property-store.js` | Create | Load/save `data/known-properties.json`; merge, dedup, expire, reset |
| `src/excel-generator.js` | Create | Generate styled RTL xlsx buffer from properties array |
| `src/whatsapp-client.js` | Create | Connect via whatsapp-web.js; fetch group messages; send file |
| `src/daily-report.js` | Create | Main orchestrator — runs the full daily pipeline |
| `setup-qr.js` | Create | One-time QR scan to save WhatsApp session |
| `setup-task-scheduler.ps1` | Create | Register Windows Task Scheduler job |
| `tests/property-store.test.js` | Create | Unit tests for all store logic |
| `.env.example` | Modify | Add group names + recipient phone vars |
| `.gitignore` | Modify | Add `.wwebjs_auth/`, `data/`, `reports/` |
| `package.json` | Modify | Add new dependencies |

---

## Task 1: Install dependencies + update .gitignore

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Install new packages**

```bash
cd "c:\אמיר\Whatsapp property parser"
npm install whatsapp-web.js qrcode-terminal exceljs uuid
```

Expected output: `added N packages` with no errors.

- [ ] **Step 2: Update .gitignore**

Replace the content of `.gitignore` with:

```
node_modules/
.env
input/*.txt
input/*.zip
.wwebjs_auth/
data/
.superpowers/
```

- [ ] **Step 3: Commit**

```bash
git init
git add package.json package-lock.json .gitignore
git commit -m "feat: add whatsapp-web.js, exceljs, uuid dependencies"
```

---

## Task 2: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Replace .env.example**

```
# Anthropic API Key - get from https://console.anthropic.com
ANTHROPIC_API_KEY=sk-ant-...

# Airtable (Phase 3 — not needed yet)
AIRTABLE_API_KEY=pat...
AIRTABLE_BASE_ID=appI34peLLN3NSK7u

# WhatsApp group names — exact names as they appear in WhatsApp
WHATSAPP_GROUP_1=שם קבוצה רעננה
WHATSAPP_GROUP_2=שם קבוצה כפר סבא
WHATSAPP_GROUP_3=שם קבוצה הוד השרון

# Your WhatsApp phone number to receive the daily report (Israeli format)
WHATSAPP_RECIPIENT_PHONE=05XXXXXXXX
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "feat: add WhatsApp group + recipient env vars"
```

---

## Task 3: Update src/property-extractor.js

**Files:**
- Modify: `src/property-extractor.js`

- [ ] **Step 1: Replace the file content**

```javascript
'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();
const MODEL  = 'claude-haiku-4-5';

const SYSTEM_PROMPT = `אתה מומחה בחילוץ מידע על נכסי נדל"ן מהודעות WhatsApp שנשלחות על ידי מתווכים ישראלים.
המשימה: לנתח הודעות ולהחזיר JSON מובנה עם פרטי הנכס.
החזר תמיד JSON תקין בלבד, ללא טקסט נוסף.`;

async function extractProperty(block) {
  const userPrompt = `שם השולח: ${block.sender}
תאריך: ${block.date}
הודעות:
${block.text}

חלץ את פרטי הנכס מהטקסט לעיל והחזר JSON בדיוק בפורמט הבא:
{
  "is_property_listing": true/false,
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
  "elevator": true/false,
  "broker_name": "שם המתווך",
  "broker_phone": "מספר טלפון ספרות בלבד" או null
}

חוקים:
- is_property_listing = false אם ההודעה אינה על נכס למכירה/השכרה (שאלה, שיחה, מודעה לחיפוש וכו')
- broker_name = שם השולח אם לא מופיע שם אחר
- price: "2.5 מיליון" → 2500000, "1.8M" → 1800000, "1,800,000" → 1800000
- rooms: "4 חד'" → 4, "3.5 חד'" → 3.5
- mamad: true רק אם מופיע מפורשות ממ"ד / מרחב מוגן
- parking: ספור חניות מפורשות. 0 אם לא הוזכרו.
- elevator: true רק אם מוזכר מפורשות מעלית
- החזר null עבור שדות שלא נמצאו`;

  try {
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 512,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userPrompt }],
    });

    const text     = response.content[0]?.text?.trim();
    if (!text) return null;

    const jsonText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const data     = JSON.parse(jsonText);

    if (!data.is_property_listing) return null;

    return {
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
      elevator:      Boolean(data.elevator),
      broker_name:   data.broker_name    || block.sender,
      broker_phone:  cleanPhone(data.broker_phone),
      publish_date:  block.date,
    };
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`  [extractor] Error on block from ${block.sender}:`, err.message);
    }
    return null;
  }
}

async function extractProperties(blocks) {
  const results    = [];
  const CONCURRENCY = 5;

  for (let i = 0; i < blocks.length; i += CONCURRENCY) {
    const batch   = blocks.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(extractProperty));
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
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
  return Math.min(Math.max(n, 0), 2); // clamp to 0-2
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
```

- [ ] **Step 2: Commit**

```bash
git add src/property-extractor.js
git commit -m "feat: extractor — add property_type, mamad, parking(0-2), elevator, balcony_sqm"
```

---

## Task 4: Create src/property-store.js + tests

**Files:**
- Create: `src/property-store.js`
- Create: `tests/property-store.test.js`

- [ ] **Step 1: Write the failing tests first**

Create `tests/property-store.test.js`:

```javascript
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { mergeProperty, removeExpired, resetPreviousPrices } = require('../src/property-store');

function makeProperty(overrides = {}) {
  return {
    address:       'הרצל 12, תל אביב',
    property_type: 'דירה',
    area_sqm:      100,
    balcony_sqm:   null,
    rooms:         4,
    floor:         3,
    price:         3000000,
    mamad:         true,
    parking:       1,
    elevator:      true,
    broker_name:   'רון לוי',
    broker_phone:  '0521234567',
    ...overrides,
  };
}

test('mergeProperty adds new property', () => {
  const { properties, action } = mergeProperty([], makeProperty());
  assert.equal(action, 'added');
  assert.equal(properties.length, 1);
  assert.ok(properties[0].id, 'should have id');
  assert.ok(properties[0].first_seen_date, 'should have first_seen_date');
  assert.equal(properties[0].previous_price, null);
});

test('mergeProperty skips duplicate — same address, same price', () => {
  const { properties: initial } = mergeProperty([], makeProperty());
  const { action } = mergeProperty(initial, makeProperty());
  assert.equal(action, 'skipped');
  assert.equal(initial.length, 1);
});

test('mergeProperty updates when price drops', () => {
  const { properties: initial } = mergeProperty([], makeProperty({ price: 3000000 }));
  const { properties: updated, action } = mergeProperty(initial, makeProperty({ price: 2800000 }));
  assert.equal(action, 'updated');
  assert.equal(updated[0].price, 2800000);
  assert.equal(updated[0].previous_price, 3000000);
});

test('mergeProperty ignores price increase', () => {
  const { properties: initial } = mergeProperty([], makeProperty({ price: 3000000 }));
  const { properties: after, action } = mergeProperty(initial, makeProperty({ price: 3500000 }));
  assert.equal(action, 'skipped');
  assert.equal(after[0].price, 3000000);
  assert.equal(after[0].previous_price, null);
});

test('mergeProperty skips property with no address', () => {
  const { action } = mergeProperty([], makeProperty({ address: null }));
  assert.equal(action, 'skipped');
});

test('mergeProperty normalizes address whitespace for comparison', () => {
  const { properties: initial } = mergeProperty([], makeProperty({ address: '  הרצל 12, תל אביב  ' }));
  const { action } = mergeProperty(initial, makeProperty({ address: 'הרצל 12, תל אביב' }));
  assert.equal(action, 'skipped');
});

test('removeExpired removes properties not seen in N days', () => {
  const today  = new Date().toISOString().split('T')[0];
  const old    = '2020-01-01';
  const props  = [
    { id: '1', address: 'א', last_seen_date: old,   previous_price: null },
    { id: '2', address: 'ב', last_seen_date: today, previous_price: null },
  ];
  const result = removeExpired(props, 10);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '2');
});

test('resetPreviousPrices sets all previous_price to null', () => {
  const props = [
    { id: '1', previous_price: 3000000 },
    { id: '2', previous_price: null },
  ];
  const result = resetPreviousPrices(props);
  assert.equal(result[0].previous_price, null);
  assert.equal(result[1].previous_price, null);
});
```

- [ ] **Step 2: Run tests — expect ALL to fail**

```bash
node --test tests/property-store.test.js
```

Expected: `Error: Cannot find module '../src/property-store'`

- [ ] **Step 3: Create src/property-store.js**

```javascript
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
  fs.writeFileSync(DATA_FILE, JSON.stringify(properties, null, 2), 'utf8');
}

function normalizeAddress(addr) {
  if (!addr) return '';
  return addr.trim().replace(/\s+/g, ' ');
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
      area_sqm:      newProp.area_sqm       ?? null,
      balcony_sqm:   newProp.balcony_sqm    ?? null,
      rooms:         newProp.rooms          ?? null,
      floor:         newProp.floor          ?? null,
      price:         newProp.price          ?? null,
      mamad:         newProp.mamad          || false,
      parking:       newProp.parking        ?? 0,
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
 * Ensures "עודכן" column only shows on the day of the price drop.
 */
function resetPreviousPrices(properties) {
  return properties.map(p => ({ ...p, previous_price: null }));
}

module.exports = { load, save, mergeProperty, removeExpired, resetPreviousPrices };
```

- [ ] **Step 4: Run tests — expect ALL to pass**

```bash
node --test tests/property-store.test.js
```

Expected output:
```
✔ mergeProperty adds new property
✔ mergeProperty skips duplicate — same address, same price
✔ mergeProperty updates when price drops
✔ mergeProperty ignores price increase
✔ mergeProperty skips property with no address
✔ mergeProperty normalizes address whitespace for comparison
✔ removeExpired removes properties not seen in N days
✔ resetPreviousPrices sets all previous_price to null
ℹ tests 8
ℹ pass 8
```

- [ ] **Step 5: Commit**

```bash
git add src/property-store.js tests/property-store.test.js
git commit -m "feat: property-store — dedup, expire, price-drop logic with tests"
```

---

## Task 5: Create src/excel-generator.js

**Files:**
- Create: `src/excel-generator.js`

- [ ] **Step 1: Create the file**

```javascript
'use strict';

const ExcelJS = require('exceljs');

const COLUMNS = [
  { key: 'property_type',  header: 'סוג נכס',             width: 14 },
  { key: 'address',        header: 'כתובת מלאה',           width: 30 },
  { key: 'area_sqm',       header: 'שטח (מ"ר)',            width: 10 },
  { key: 'balcony_sqm',    header: 'מרפסת/גינה (מ"ר)',    width: 16 },
  { key: 'rooms',          header: 'חדרים',                width: 8  },
  { key: 'floor',          header: 'קומה',                 width: 8  },
  { key: 'price',          header: 'מחיר',                 width: 15 },
  { key: 'price_updated',  header: 'עודכן',                width: 15 },
  { key: 'mamad',          header: 'ממ"ד',                 width: 7  },
  { key: 'parking',        header: 'חניה',                 width: 7  },
  { key: 'elevator',       header: 'מעלית',                width: 8  },
  { key: 'time_on_market', header: 'זמן בשוק (חודשים)',   width: 18 },
];

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Arial' };

const UPDATED_ROW_FILL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E0' } };
const UPDATED_CELL_FONT = { bold: true, color: { argb: 'FFE65100' }, name: 'Arial' };

function monthsOnMarket(firstSeenDate) {
  if (!firstSeenDate) return 0;
  const days = Math.floor((Date.now() - new Date(firstSeenDate)) / 86_400_000);
  return Math.floor(days / 30);
}

function fmtBool(val) {
  return val ? '✓' : '—';
}

function fmtPrice(val) {
  if (val == null) return '';
  return Number(val).toLocaleString('he-IL');
}

/**
 * Generate an Excel workbook buffer from an array of property records.
 * @param {Array} properties
 * @returns {Promise<Buffer>}
 */
async function generateExcel(properties) {
  const wb    = new ExcelJS.Workbook();
  wb.creator  = 'Mango Realty';
  wb.created  = new Date();

  const ws = wb.addWorksheet('נכסים', {
    views: [{ rightToLeft: true }],
  });

  ws.columns = COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width }));

  // Style header row
  const headerRow = ws.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell(cell => {
    cell.fill      = HEADER_FILL;
    cell.font      = HEADER_FONT;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border    = { bottom: { style: 'thin', color: { argb: 'FF388E3C' } } };
  });

  // Add data rows
  for (const prop of properties) {
    const isPriceUpdated = prop.previous_price != null;

    const row = ws.addRow({
      property_type:  prop.property_type || '',
      address:        prop.address       || '',
      area_sqm:       prop.area_sqm      ?? '',
      balcony_sqm:    prop.balcony_sqm   ?? '',
      rooms:          prop.rooms         ?? '',
      floor:          prop.floor         ?? '',
      price:          fmtPrice(prop.price),
      price_updated:  isPriceUpdated ? fmtPrice(prop.price) : '',
      mamad:          fmtBool(prop.mamad),
      parking:        prop.parking       ?? 0,
      elevator:       fmtBool(prop.elevator),
      time_on_market: monthsOnMarket(prop.first_seen_date),
    });

    row.eachCell(cell => {
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (isPriceUpdated) cell.fill = UPDATED_ROW_FILL;
    });

    // Bold orange on the עודכן cell
    if (isPriceUpdated) {
      row.getCell('price_updated').font = UPDATED_CELL_FONT;
    }

    // Colour ✓/— cells
    ['mamad', 'elevator'].forEach(key => {
      const cell = row.getCell(key);
      cell.font = cell.value === '✓'
        ? { color: { argb: 'FF2E7D32' }, bold: true, name: 'Arial' }
        : { color: { argb: 'FF9E9E9E' }, name: 'Arial' };
    });
  }

  // Freeze header + auto-filter
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, rightToLeft: true }];
  ws.autoFilter = { from: 'A1', to: `L${properties.length + 1}` };

  return wb.xlsx.writeBuffer();
}

module.exports = { generateExcel };
```

- [ ] **Step 2: Smoke-test the generator**

```bash
node -e "
const { generateExcel } = require('./src/excel-generator');
const sample = [{
  property_type:'דירה', address:'הרצל 12, ת\"א', area_sqm:100, balcony_sqm:12,
  rooms:4, floor:3, price:3200000, previous_price:3500000,
  mamad:true, parking:1, elevator:true,
  first_seen_date:'2026-04-01', last_seen_date:'2026-05-25'
}];
generateExcel(sample).then(buf => {
  require('fs').writeFileSync('test-output.xlsx', buf);
  console.log('OK — wrote test-output.xlsx (' + buf.length + ' bytes)');
});
"
```

Expected: `OK — wrote test-output.xlsx (XXXX bytes)`  
Open `test-output.xlsx` and verify: RTL layout, green header, orange row with bold price in "עודכן".

- [ ] **Step 3: Delete test file + commit**

```bash
del test-output.xlsx
git add src/excel-generator.js
git commit -m "feat: excel-generator — 12-col RTL xlsx with Hebrew headers and price-update styling"
```

---

## Task 6: Create src/whatsapp-client.js

**Files:**
- Create: `src/whatsapp-client.js`

- [ ] **Step 1: Create the file**

```javascript
'use strict';

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const CONNECT_TIMEOUT_MS = 90_000; // 90 seconds

function _createClient() {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });
}

/**
 * Connect to WhatsApp (reuses saved session — no QR needed after setup).
 * @returns {Promise<Client>}
 */
async function connect() {
  const client = _createClient();

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('WhatsApp connection timeout after 90s')),
      CONNECT_TIMEOUT_MS
    );

    client.on('ready', () => { clearTimeout(timer); resolve(); });
    client.on('auth_failure', msg => {
      clearTimeout(timer);
      reject(new Error(`WhatsApp auth failure: ${msg}`));
    });

    client.initialize();
  });

  return client;
}

/**
 * Fetch messages from a WhatsApp group sent in the last `hoursBack` hours.
 * @param {Client} client
 * @param {string} groupName  Exact group name as it appears in WhatsApp
 * @param {number} hoursBack
 * @returns {Promise<Array<{sender:string, date:string, text:string}>>}
 */
async function fetchGroupMessages(client, groupName, hoursBack = 24) {
  const chats = await client.getChats();
  const chat  = chats.find(c => c.name === groupName);
  if (!chat) throw new Error(`WhatsApp group not found: "${groupName}"`);

  const messages  = await chat.fetchMessages({ limit: 500 });
  const cutoffMs  = Date.now() - hoursBack * 3_600_000;

  return messages
    .filter(m => m.timestamp * 1000 >= cutoffMs && m.body && !m.fromMe)
    .map(m => {
      const ts = new Date(m.timestamp * 1000);
      return {
        sender: m._data?.notifyName || m.author || 'Unknown',
        date:   ts.toISOString().split('T')[0],
        time:   ts.toTimeString().slice(0, 5), // "HH:MM" — required by groupConsecutiveMessages
        text:   m.body,
      };
    });
}

/**
 * Send the daily report as a WhatsApp message with Excel attachment.
 * @param {Client} client
 * @param {string} recipientPhone  Israeli format e.g. "0521234567"
 * @param {string} messageText     Caption shown with the file
 * @param {Buffer} excelBuffer
 * @param {string} filename        e.g. "נכסים_25-05-2026.xlsx"
 */
async function sendReport(client, recipientPhone, messageText, excelBuffer, filename) {
  const digits = recipientPhone.replace(/\D/g, '');
  const waId   = digits.startsWith('972')
    ? digits + '@c.us'
    : '972' + digits.slice(1) + '@c.us';

  const media = new MessageMedia(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    excelBuffer.toString('base64'),
    filename
  );

  await client.sendMessage(waId, media, { caption: messageText });
}

/**
 * Gracefully disconnect the client.
 */
async function disconnect(client) {
  await client.destroy();
}

module.exports = { connect, fetchGroupMessages, sendReport, disconnect };
```

- [ ] **Step 2: Commit**

```bash
git add src/whatsapp-client.js
git commit -m "feat: whatsapp-client — connect, fetchGroupMessages, sendReport, disconnect"
```

---

## Task 7: Create setup-qr.js

**Files:**
- Create: `setup-qr.js`

- [ ] **Step 1: Create the file**

```javascript
'use strict';

require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

console.log('\n📱 WhatsApp QR Setup — Mango Realty');
console.log('─'.repeat(45));
console.log('בטלפון: הגדרות → מכשירים מקושרים → קשר מכשיר');
console.log('סרוק את ה-QR Code שיופיע:\n');

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: {
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
  console.log('\n(ממתין לסריקה...)');
});

client.on('ready', async () => {
  console.log('\n✅ מחובר בהצלחה! הסשן נשמר ב-.wwebjs_auth/');
  console.log('   מהפעם הבאה לא יידרש QR.\n');
  await client.destroy();
  process.exit(0);
});

client.on('auth_failure', msg => {
  console.error('\n❌ שגיאת אימות:', msg);
  process.exit(1);
});

client.initialize();
```

- [ ] **Step 2: Commit**

```bash
git add setup-qr.js
git commit -m "feat: setup-qr — one-time WhatsApp session setup script"
```

---

## Task 8: Create src/daily-report.js

**Files:**
- Create: `src/daily-report.js`

- [ ] **Step 1: Create the file**

```javascript
'use strict';

require('dotenv').config();

const { connect, fetchGroupMessages, sendReport, disconnect } = require('./whatsapp-client');
const { extractProperties }       = require('./property-extractor');
const { groupConsecutiveMessages } = require('./whatsapp-parser');
const { generateExcel }           = require('./excel-generator');
const store = require('./property-store');

// ── config ────────────────────────────────────────────────────────────────────

function validateEnv() {
  const required = ['ANTHROPIC_API_KEY', 'WHATSAPP_RECIPIENT_PHONE'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`\n❌ Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const GROUPS = () => [
  process.env.WHATSAPP_GROUP_1,
  process.env.WHATSAPP_GROUP_2,
  process.env.WHATSAPP_GROUP_3,
].filter(Boolean);

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  validateEnv();

  const groups = GROUPS();
  if (!groups.length) {
    console.error('❌ No groups configured — set WHATSAPP_GROUP_1/2/3 in .env');
    process.exit(1);
  }

  // Date helpers
  const today     = new Date().toISOString().split('T')[0];
  const [y, m, d] = today.split('-');
  const dateFmt   = `${d}/${m}/${y}`;
  const filename  = `נכסים_${d}-${m}-${y}.xlsx`;

  console.log(`\n🏠 WhatsApp Property Report — ${dateFmt}`);
  console.log('─'.repeat(50));

  // 1. Load store + remove expired
  let properties = store.load();
  const before   = properties.length;
  properties     = store.removeExpired(properties, 10);
  const expired  = before - properties.length;
  if (expired > 0) console.log(`   🗑  Removed ${expired} expired listings (>10 days unseen)`);
  console.log(`   📦 ${properties.length} properties in database`);

  // 2. Connect to WhatsApp
  console.log('\n[1/4] Connecting to WhatsApp...');
  const client = await connect();
  console.log('   ✅ Connected');

  // 3. Fetch messages from all groups
  console.log('\n[2/4] Fetching last 24h from groups...');
  const allMessages = [];
  for (const group of groups) {
    try {
      const msgs = await fetchGroupMessages(client, group, 24);
      console.log(`   ${group}: ${msgs.length} messages`);
      allMessages.push(...msgs);
    } catch (err) {
      console.error(`   ⚠️  ${group}: ${err.message}`);
    }
  }
  console.log(`   Total: ${allMessages.length} messages`);

  // 4. Extract properties with Claude
  console.log('\n[3/4] Extracting properties...');
  const blocks    = groupConsecutiveMessages(allMessages);
  const extracted = await extractProperties(blocks);
  console.log(`   ${extracted.length} listings extracted from ${blocks.length} message blocks`);

  // 5. Merge into store
  const stats = { added: 0, updated: 0, skipped: 0 };
  for (const prop of extracted) {
    const { properties: next, action } = store.mergeProperty(properties, prop);
    properties = next;
    stats[action] = (stats[action] || 0) + 1;
  }
  console.log(`   ✓ Added: ${stats.added} | ↻ Updated: ${stats.updated} | = Skipped: ${stats.skipped}`);

  // 6. Persist store
  store.save(properties);

  // 7. Generate Excel
  console.log('\n[4/4] Generating report & sending...');
  const excelBuffer   = await generateExcel(properties);
  const updatedCount  = properties.filter(p => p.previous_price != null).length;

  // 8. Send WhatsApp message
  const caption =
    `🏠 דו"ח נכסים יומי | ${dateFmt}\n` +
    `${properties.length} נכסים במאגר | ${stats.added} חדשים היום | ${updatedCount} עודכן מחיר`;

  await sendReport(client, process.env.WHATSAPP_RECIPIENT_PHONE, caption, excelBuffer, filename);
  console.log(`   ✅ Sent to ${process.env.WHATSAPP_RECIPIENT_PHONE}`);

  // 9. Reset price flags + save
  store.save(store.resetPreviousPrices(properties));

  // 10. Disconnect
  await disconnect(client);

  console.log('\n✅ Done!\n');
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/daily-report.js
git commit -m "feat: daily-report — main orchestrator for daily WhatsApp Excel report"
```

---

## Task 9: Create setup-task-scheduler.ps1

**Files:**
- Create: `setup-task-scheduler.ps1`

- [ ] **Step 1: Create the file**

```powershell
# setup-task-scheduler.ps1
# Run once as Administrator to register the daily 08:00 task.
# Usage: Right-click → Run as Administrator, OR:
#   Start-Process powershell -Verb RunAs -ArgumentList "-File setup-task-scheduler.ps1"

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodePath   = (Get-Command node -ErrorAction Stop).Source
$scriptPath = Join-Path $projectDir "src\daily-report.js"
$taskName   = "WhatsApp Property Report - Mango Realty"
$logFile    = Join-Path $projectDir "logs\daily-report.log"

# Ensure logs directory exists
New-Item -ItemType Directory -Force -Path (Join-Path $projectDir "logs") | Out-Null

$action = New-ScheduledTaskAction `
  -Execute    $nodePath `
  -Argument   "`"$scriptPath`" >> `"$logFile`" 2>&1" `
  -WorkingDirectory $projectDir

$trigger = New-ScheduledTaskTrigger -Daily -At "08:00"

$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit  (New-TimeSpan -Minutes 15) `
  -StartWhenAvailable `
  -DontStopOnIdleEnd  `
  -RunOnlyIfNetworkAvailable

Register-ScheduledTask `
  -TaskName  $taskName `
  -Action    $action `
  -Trigger   $trigger `
  -Settings  $settings `
  -RunLevel  Highest `
  -Force | Out-Null

Write-Host ""
Write-Host "✅ Task registered: '$taskName'"
Write-Host "   Runs: daily at 08:00"
Write-Host "   Log:  $logFile"
Write-Host ""
Write-Host "To test immediately:"
Write-Host "   Start-ScheduledTask -TaskName '$taskName'"
Write-Host ""
Write-Host "To remove:"
Write-Host "   Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
```

- [ ] **Step 2: Commit**

```bash
git add setup-task-scheduler.ps1
git commit -m "feat: setup-task-scheduler — register daily 08:00 Windows Task Scheduler job"
```

---

## Task 10: End-to-end setup + first run

- [ ] **Step 1: Copy .env and fill in values**

```bash
copy .env.example .env
```

Open `.env` and fill in:
- `ANTHROPIC_API_KEY` — from https://console.anthropic.com
- `WHATSAPP_GROUP_1` / `GROUP_2` / `GROUP_3` — exact group names from WhatsApp
- `WHATSAPP_RECIPIENT_PHONE` — your Israeli phone number e.g. `0521234567`

- [ ] **Step 2: Run QR setup (once)**

```bash
node setup-qr.js
```

Scan the QR in WhatsApp → `מכשירים מקושרים → קשר מכשיר`.  
Wait for: `✅ מחובר בהצלחה! הסשן נשמר ב-.wwebjs_auth/`

- [ ] **Step 3: Test the daily report manually**

```bash
node src/daily-report.js
```

Expected output:
```
🏠 WhatsApp Property Report — DD/MM/YYYY
──────────────────────────────────────────────────
   📦 0 properties in database

[1/4] Connecting to WhatsApp...
   ✅ Connected

[2/4] Fetching last 24h from groups...
   [group name]: XX messages
   ...

[3/4] Extracting properties...
   XX listings extracted

[4/4] Generating report & sending...
   ✅ Sent to 05XXXXXXXX

✅ Done!
```

Verify: Excel file received on WhatsApp with correct columns, Hebrew RTL, and styling.

- [ ] **Step 4: Register the Task Scheduler (run PowerShell as Administrator)**

```powershell
.\setup-task-scheduler.ps1
```

Expected: `✅ Task registered: 'WhatsApp Property Report - Mango Realty'`

- [ ] **Step 5: Final commit**

```bash
git add .gitignore
git commit -m "chore: finalize setup — task scheduler registered, QR session active"
```

---

## Summary

| Task | What it builds |
|------|---------------|
| 1 | Dependencies + .gitignore |
| 2 | .env.example with new vars |
| 3 | Updated property extractor (12 fields) |
| 4 | property-store.js with full test suite |
| 5 | excel-generator.js — styled RTL xlsx |
| 6 | whatsapp-client.js — connect/fetch/send |
| 7 | setup-qr.js — one-time QR setup |
| 8 | daily-report.js — main orchestrator |
| 9 | setup-task-scheduler.ps1 — Windows scheduler |
| 10 | End-to-end setup and first real run |
