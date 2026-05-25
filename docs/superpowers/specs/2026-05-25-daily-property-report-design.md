# Daily Property Report — Design Spec
**Date:** 2026-05-25  
**Project:** WhatsApp Property Parser — Mango Realty  
**Scope:** Phase 2 — Automated daily Excel report from 3 WhatsApp groups

---

## Goal

Every morning at 08:00, automatically:
1. Connect to 3 WhatsApp groups (Sharon area)
2. Collect all property listings from the last 24 hours
3. Merge into a cumulative master table (no duplicates)
4. Export the full master table as an Excel file
5. Send it as a WhatsApp message to the user

---

## Groups

| Group | City |
|-------|------|
| קבוצה 1 | רעננה |
| קבוצה 2 | כפר סבא |
| קבוצה 3 | הוד השרון |

> Exact WhatsApp group names to be provided by user at setup time.

---

## Excel Output Columns

| # | Column | Source | Notes |
|---|--------|--------|-------|
| 1 | סוג נכס | Claude extraction | דירה / פנטהאוז / דירת גן / חנות / וכו' |
| 2 | כתובת מלאה | Claude extraction | רחוב + מספר + עיר |
| 3 | שטח (מ"ר) | Claude extraction | מספר שלם |
| 4 | מרפסת/גינה (מ"ר) | Claude extraction | null אם אין |
| 5 | חדרים | Claude extraction | כולל חצאים (3.5) |
| 6 | קומה | Claude extraction | מספר |
| 7 | מחיר | Claude extraction | ₪ — מחיר בלבד, ללא סוג עסקה |
| 8 | עודכן | System | המחיר המעודכן (החדש) אם ירד — מודגש. ריק אם לא השתנה |
| 9 | ממ"ד | Claude extraction | ✓ / — |
| 10 | חניה | Claude extraction | 0 / 1 / 2 (מספר חניות) |
| 11 | מעלית | Claude extraction | ✓ / — |
| 12 | זמן בשוק | System | מספר חודשים מאז `first_seen_date` |

> **הערה:** עמודת "סוג" = סוג הנכס (דירה/פנטהאוז וכו'), לא סוג העסקה. המחיר עצמו מבהיר מכירה/השכרה.

---

## Master Database — known-properties.json

כל נכס שנראה אי פעם נשמר בקובץ `data/known-properties.json`.

### Schema לכל רשומה

```json
{
  "id": "uuid-v4",
  "property_type": "דירה",
  "address": "הרצל 12, תל אביב",
  "area_sqm": 110,
  "balcony_sqm": null,
  "rooms": 4,
  "floor": 3,
  "price": 3200000,
  "mamad": true,
  "parking": 1,
  "elevator": true,
  "broker_name": "רון לוי",
  "broker_phone": "0521234567",
  "first_seen_date": "2026-05-20",
  "last_seen_date": "2026-05-25",
  "previous_price": null
}
```

> `previous_price` — המחיר הקודם לפני הירידה. מאופס ל-`null` לאחר שליחת הדו"ח. מחיר **לעולם לא עולה** — אם מחיר חדש גבוה מהקיים, מתעלמים (ייתכן טעות פרסום).
```

---

## Deduplication Logic

### זיהוי כפילות — השוואה ישירה בלבד
**כפילות = כתובת זהה + מחיר זהה** (השוואת מחרוזת/מספר, ללא Claude, ללא פילטרים).

### כללים
| מצב | פעולה |
|-----|--------|
| כתובת חדשה | מוסיף + `first_seen = today`, `last_seen = today` |
| כתובת קיימת, מחיר זהה | רק `last_seen = today` — מדלג |
| כתובת קיימת, מחיר ירד | `last_seen = today`, `price = new_lower_price`, `previous_price = old` |
| כתובת קיימת, מחיר עלה | `last_seen = today` בלבד — מתעלמים מהמחיר החדש (טעות פרסום) |
| נכס לא נראה 10+ ימים | מוחק אוטומטית מ-known-properties.json |
| נכס שהוסר ומופיע שוב | נוסף מחדש כנכס חדש |

> **איפוס previous_price:** לאחר שליחת הדו"ח, `previous_price` מאופס ל-`null`. עמודת "עודכן" מציגה את המחיר הקודם רק ביום הירידה.

---

## Architecture

### קבצים חדשים

```
src/
  whatsapp-client.js     — חיבור whatsapp-web.js, שליפה, שליחה
  excel-generator.js     — יצירת xlsx עם exceljs (RTL, עיצוב)
  daily-report.js        — מנהל התהליך היומי (נקודת כניסה)
  property-store.js      — קריאה/כתיבה של known-properties.json

data/
  known-properties.json  — מסד הנתונים המצטבר (נוצר אוטומטית)

setup-task-scheduler.ps1 — הגדרה חד-פעמית של Windows Task Scheduler
setup-qr.js             — סקריפט חד-פעמי לסריקת QR ושמירת סשן
```

### קבצים מעודכנים

```
src/property-extractor.js  — הוספת שדה property_type, הסרת transaction_type
```

### קבצים שנשארים ללא שינוי

```
src/whatsapp-parser.js   — לא בשימוש בתהליך החדש (רק ל-manual export)
src/airtable-client.js   — נשאר לשלב ג' (Airtable integration)
src/index.js             — נשאר לשימוש ידני
```

---

## Daily Flow (daily-report.js)

```
1. טוען known-properties.json
2. מוחק נכסים שלא נראו 10+ ימים
3. מפעיל whatsapp-client — מתחבר לוואטסאפ
4. שולף הודעות 24 שעות אחרונות מ-3 קבוצות
5. מריץ property-extractor על כל הודעה
6. לכל נכס מחולץ: מריץ deduplicator מול known-properties
   - חדש → מוסיף
   - קיים, מחיר זהה → מעדכן last_seen
   - קיים, מחיר שונה → מעדכן מחיר + price_updated=true
7. שומר known-properties.json
8. מריץ excel-generator → מייצר קובץ
   נכסים_DD-MM-YYYY.xlsx
9. שולח הודעת וואטסאפ לאמיר:
   "🏠 דו"ח נכסים | DD/MM/YYYY
   X נכסים במאגר | Y חדשים | Z מחיר עודכן
   📎 [קובץ xlsx]"
10. מתנתק
```

---

## WhatsApp Connection (whatsapp-client.js)

- **ספריה:** `whatsapp-web.js`
- **Auth:** `LocalAuth` — שומר סשן בתיקיית `.wwebjs_auth`
- **First run:** `node setup-qr.js` — סורקים QR פעם אחת
- **Subsequent runs:** מתחבר אוטומטית ללא QR
- **WhatsApp Desktop:** אינו נדרש
- **דרישה:** טלפון דלוק + אינטרנט (רגיל)

---

## Excel Styling (excel-generator.js)

- **ספריה:** `exceljs`
- **כיוון:** RTL
- **כותרות:** צבע רקע ירוק כהה, טקסט לבן, מודגש
- **שורת "עודכן":** צבע רקע כתום בהיר
- **עמודות boolean (ממ"ד/מעלית):** ✓ ירוק / — אפור
- **עמודת חניה:** מספר שלם (0/1/2) — רקע צבעוני לפי כמות
- **עמודת עודכן:** המחיר **החדש** (המעודכן) מודגש בכתום אם ירד (למשל: **3,500,000**) — ריק אחרת
- **עמודת זמן בשוק:** `Math.floor(daysSinceFirstSeen / 30)` חודשים — מחושב בזמן יצירת ה-Excel
- **שם קובץ:** `נכסים_DD-MM-YYYY.xlsx`

---

## Windows Task Scheduler

`setup-task-scheduler.ps1` יוצר:
- **שם המשימה:** WhatsApp Property Report
- **זמן:** 08:00 כל יום
- **פקודה:** `node "c:\path\to\src\daily-report.js"`
- **תנאי:** רץ רק אם המחשב דלוק (לא מעיר ממצב שינה)

---

## Dependencies חדשות

```json
"whatsapp-web.js": "^1.x",
"qrcode-terminal": "^0.12.x",
"exceljs": "^4.x",
"uuid": "^9.x"
```

---

## Out of Scope (שלב ג')

- Airtable integration
- הצלבה עם טבלת קונים
- ממשק ווב
- שרת ענן 24/7

---

## Open Questions

- [ ] שמות מדויקים של 3 קבוצות הוואטסאפ (יסופקו בשלב ה-setup)
- [ ] מספר הטלפון של אמיר לקבלת הדו"ח (יסופק ב-.env)
- [ ] שעה מועדפת לשינוי בעתיד (כרגע 08:00)
