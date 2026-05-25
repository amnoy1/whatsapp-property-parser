'use strict';

require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

console.log('\n📱 WhatsApp QR Setup — Mango Realty');
console.log('─'.repeat(45));
console.log('בטלפון: הגדרות → מכשירים מקושרים → קשר מכשיר');
console.log('סרוק את ה-QR Code שיופיע:\n');
console.log('   (בפעם הראשונה מוריד גרסת WhatsApp — עשוי לקחת 30 שניות)\n');

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),

  // נועל גרסת WhatsApp Web יציבה — עוקף חוסר תאימות עם Chrome חדש
  webVersionCache: {
    type: 'remote',
    remotePath:
      'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
  },

  puppeteer: {
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', qr => {
  console.log('\n✅ QR מוכן — סרוק עם הטלפון:\n');
  qrcode.generate(qr, { small: true });
  console.log('\n(ממתין לסריקה... אל תסגור את הדפדפן)');
});

client.on('loading_screen', (percent, message) => {
  process.stdout.write(`\r   טוען ${percent}%...   `);
});

client.on('authenticated', () => {
  console.log('\n\n🔐 אומת — שומר סשן...');
});

client.on('ready', async () => {
  console.log('✅ מחובר! הסשן נשמר ב-.wwebjs_auth/');
  console.log('   מהפעם הבאה לא יידרש QR.\n');
  await client.destroy();
  process.exit(0);
});

client.on('auth_failure', msg => {
  console.error('\n❌ שגיאת אימות:', msg);
  process.exit(1);
});

client.on('disconnected', reason => {
  if (reason === 'LOGOUT') {
    // session expired — the client will reinitialize and show a new QR
    console.log('\n🔄 סשן ישן פג — ממתין לחיבור חדש...');
    return;
  }
  console.error('\n⚠️  התנתק:', reason);
  process.exit(1);
});

process.on('uncaughtException', err => {
  console.error('\n❌ שגיאה:', err.message);
  process.exit(1);
});

client.initialize();
