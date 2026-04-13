# WhatsApp Property Parser

חילוץ אוטומטי של נכסי נדל"ן מ-Export של קבוצת WhatsApp ושמירה ב-Airtable.

---

## הגדרה ראשונית

```bash
# 1. התקן תלויות
npm install

# 2. צור קובץ .env
cp .env.example .env
# מלא: ANTHROPIC_API_KEY, AIRTABLE_API_KEY
```

---

## שימוש יומי

1. פתח את הקבוצה בווצאפ → **שם הקבוצה → ייצוא צ'אט → ללא מדיה**
2. שמור את הקובץ `.txt` בתיקיית `input/`
3. הרץ:

```bash
node src/index.js input/chat.txt
```

---

## מה המערכת עושה

```
קובץ WhatsApp Export (.txt)
        ↓
  פרסינג הודעות
  (iOS + Android formats)
        ↓
  מיזוג הודעות עוקבות
  מאותו שולח
        ↓
  Claude Haiku מחלץ:
  כתובת, עיר, חדרים, שטח,
  קומה, מחיר, מאפיינים,
  שם מתווך, טלפון
        ↓
  בדיקת כפילויות (AI)
  ┌──────────────┐
  │ נכס קיים?   │
  │ כן → עדכן   │
  │       מחיר  │
  │ לא → צור    │
  │      שורה   │
  └──────────────┘
        ↓
  Airtable: טבלת "נכסים מווצאפ"
```

---

## Airtable

- **Base:** ניהול לקוחות Mango Realty (`appI34peLLN3NSK7u`)
- **טבלה:** נכסים מווצאפ (`tbl7bHXoidYBQirZ2`)
- **שדות:** כתובת, סוג עסקה, שטח מ"ר, חדרים, קומה, מחיר, מאפיינים, שם מתווך, טלפון מתווך, תאריך פרסום, עדכון אחרון, מצב

---

## קבצים

| קובץ | תפקיד |
|------|--------|
| `src/whatsapp-parser.js` | פרסינג קובץ Export |
| `src/property-extractor.js` | חילוץ נתוני נכס עם Claude Haiku |
| `src/airtable-client.js` | קריאה/כתיבה Airtable |
| `src/deduplicator.js` | זיהוי כפילויות |
| `src/index.js` | תהליך ראשי |

---

## שלב ב' (עתידי)

הצלבת נכסים עם טבלת **קונים** ב-Airtable לזיהוי התאמות אוטומטי.

---

## משתני סביבה

| משתנה | תיאור |
|-------|--------|
| `ANTHROPIC_API_KEY` | מפתח Claude API |
| `AIRTABLE_API_KEY` | Personal Access Token של Airtable |
| `AIRTABLE_BASE_ID` | מזהה ה-Base (ברירת מחדל: `appI34peLLN3NSK7u`) |
| `DEBUG=1` | לוגים מפורטים |
