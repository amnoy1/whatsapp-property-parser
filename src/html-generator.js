'use strict';

function monthsOnMarket(firstSeenDate) {
  if (!firstSeenDate) return 0;
  const days = Math.floor((Date.now() - new Date(firstSeenDate)) / 86_400_000);
  return Math.floor(days / 30);
}

function fmtPrice(val) {
  if (val == null) return '';
  return Number(val).toLocaleString('he-IL') + ' ₪';
}

function fmtBool(val) {
  return val ? '✓' : '—';
}

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Generate an RTL Hebrew HTML report from the properties array.
 * @param {Array}  properties
 * @param {string} excelPublicUrl  Public URL of the .xlsx file in Supabase Storage
 * @param {string} dateFmt         e.g. "22/07/2026"
 * @returns {string} HTML string
 */
function generateHtml(properties, excelPublicUrl, dateFmt) {
  const updatedCount = properties.filter(p => p.previous_price != null).length;

  const rows = properties.map(p => {
    const isUpdated = p.previous_price != null;
    const rowClass  = isUpdated ? ' class="price-updated"' : '';

    return `    <tr${rowClass}>
      <td>${escHtml(p.property_type)}</td>
      <td class="addr">${escHtml(p.address)}</td>
      <td>${p.area_sqm ?? ''}</td>
      <td>${p.balcony_sqm ?? ''}</td>
      <td>${p.rooms ?? ''}</td>
      <td>${p.floor ?? ''}</td>
      <td class="price">${fmtPrice(p.price)}</td>
      <td class="${isUpdated ? 'updated-price' : ''}">${isUpdated ? fmtPrice(p.price) : ''}</td>
      <td>${fmtBool(p.mamad)}</td>
      <td>${p.parking ?? 0}</td>
      <td>${fmtBool(p.storage)}</td>
      <td>${fmtBool(p.elevator)}</td>
      <td>${monthsOnMarket(p.first_seen_date)}</td>
      <td>${escHtml(p.broker_name)}</td>
      <td dir="ltr">${escHtml(p.broker_phone)}</td>
    </tr>`;
  }).join('\n');

  const downloadBtn = excelPublicUrl
    ? `<a class="dl-btn" href="${escHtml(excelPublicUrl)}" download>⬇ הורד Excel</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>דוח נכסים | מנגו ריאלטי | ${escHtml(dateFmt)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, 'Segoe UI', sans-serif;
      font-size: 13px;
      background: #f4f6f8;
      color: #222;
      direction: rtl;
    }
    header {
      background: #1B5E20;
      color: #fff;
      padding: 14px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }
    header h1 { font-size: 18px; font-weight: bold; }
    header .meta { font-size: 12px; opacity: .85; }
    .dl-btn {
      background: #fff;
      color: #1B5E20;
      border: none;
      padding: 7px 14px;
      border-radius: 6px;
      font-weight: bold;
      font-size: 13px;
      cursor: pointer;
      text-decoration: none;
      white-space: nowrap;
    }
    .dl-btn:hover { background: #e8f5e9; }
    .wrapper { overflow-x: auto; padding: 16px; }
    table {
      border-collapse: collapse;
      width: 100%;
      min-width: 900px;
      background: #fff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 4px rgba(0,0,0,.12);
    }
    thead tr { background: #1B5E20; color: #fff; }
    thead th {
      padding: 10px 8px;
      font-size: 12px;
      font-weight: bold;
      text-align: center;
      white-space: nowrap;
      position: sticky;
      top: 0;
      z-index: 1;
      background: #1B5E20;
      border-bottom: 2px solid #388E3C;
    }
    tbody tr:nth-child(even) { background: #f9f9f9; }
    tbody tr:hover { background: #e8f5e9; }
    td {
      padding: 8px 7px;
      text-align: center;
      border-bottom: 1px solid #eee;
      vertical-align: middle;
    }
    td.addr { text-align: right; min-width: 160px; }
    td.price { font-weight: bold; }
    tr.price-updated { background: #FFF3E0 !important; }
    td.updated-price {
      font-weight: bold;
      color: #E65100;
    }
    .bool-yes { color: #2E7D32; font-weight: bold; }
    .bool-no  { color: #9E9E9E; }
    footer {
      text-align: center;
      padding: 12px;
      font-size: 11px;
      color: #888;
    }
  </style>
</head>
<body>
<header>
  <div>
    <h1>🏠 דוח נכסים יומי — מנגו ריאלטי</h1>
    <div class="meta">${escHtml(dateFmt)} &nbsp;|&nbsp; ${properties.length} נכסים במאגר &nbsp;|&nbsp; ${updatedCount} עדכוני מחיר</div>
  </div>
  ${downloadBtn}
</header>
<div class="wrapper">
<table>
  <thead>
    <tr>
      <th>סוג נכס</th>
      <th>כתובת מלאה</th>
      <th>שטח<br>(מ"ר)</th>
      <th>מרפסת/גינה/גג<br>(מ"ר)</th>
      <th>חדרים</th>
      <th>קומה</th>
      <th>מחיר</th>
      <th>עודכן</th>
      <th>ממ"ד</th>
      <th>חניה</th>
      <th>מחסן</th>
      <th>מעלית</th>
      <th>זמן בשוק<br>(חודשים)</th>
      <th>מתווך</th>
      <th>טלפון מתווך</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>
</div>
<footer>נוצר אוטומטית ע"י מנגו ריאלטי &nbsp;|&nbsp; ${escHtml(dateFmt)}</footer>
</body>
</html>`;
}

module.exports = { generateHtml };
