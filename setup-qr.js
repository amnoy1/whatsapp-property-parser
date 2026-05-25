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
