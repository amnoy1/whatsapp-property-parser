'use strict';

const ExcelJS = require('exceljs');

const COLUMNS = [
  { key: 'property_type',  header: 'סוג נכס',               width: 14 },
  { key: 'address',        header: 'כתובת מלאה',             width: 30 },
  { key: 'area_sqm',       header: 'שטח (מ"ר)',              width: 10 },
  { key: 'balcony_sqm',    header: 'מרפסת/גינה/גג (מ"ר)',   width: 18 },
  { key: 'rooms',          header: 'חדרים',                  width: 8  },
  { key: 'floor',          header: 'קומה',                   width: 8  },
  { key: 'price',          header: 'מחיר',                   width: 15 },
  { key: 'price_updated',  header: 'עודכן',                  width: 15 },
  { key: 'mamad',          header: 'ממ"ד',                   width: 7  },
  { key: 'parking',        header: 'חניה',                   width: 7  },
  { key: 'storage',        header: 'מחסן',                   width: 8  },
  { key: 'elevator',       header: 'מעלית',                  width: 8  },
  { key: 'time_on_market', header: 'זמן בשוק (חודשים)',     width: 18 },
  { key: 'broker_name',    header: 'מתווך',                  width: 20 },
  { key: 'broker_phone',   header: 'טלפון מתווך',            width: 16 },
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
  if (!Array.isArray(properties)) throw new TypeError('properties must be an array');
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
      storage:        fmtBool(prop.storage),
      elevator:       fmtBool(prop.elevator),
      time_on_market: monthsOnMarket(prop.first_seen_date),
      broker_name:    prop.broker_name   || '',
      broker_phone:   prop.broker_phone  || '',
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
    ['mamad', 'storage', 'elevator'].forEach(key => {
      const cell = row.getCell(key);
      cell.font = cell.value === '✓'
        ? { color: { argb: 'FF2E7D32' }, bold: true, name: 'Arial' }
        : { color: { argb: 'FF9E9E9E' }, name: 'Arial' };
    });

    // Left-align broker columns
    ['broker_name', 'broker_phone'].forEach(key => {
      row.getCell(key).alignment = { horizontal: 'right', vertical: 'middle' };
    });
  }

  // Freeze header + auto-filter
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, rightToLeft: true }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: properties.length + 1, column: COLUMNS.length } };

  return wb.xlsx.writeBuffer();
}

module.exports = { generateExcel };
