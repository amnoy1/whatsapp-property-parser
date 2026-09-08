'use strict';

/**
 * scan-qr.js
 * One-time script to (re)authenticate WhatsApp Web.
 * Opens a VISIBLE Chrome window — scan the QR or confirm the session.
 * Once connected, saves the session to .wwebjs_auth and exits.
 */

require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const fs   = require('fs');
const path = require('path');

function findChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  return candidates.find(p => fs.existsSync(p));
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: {
    headless: false,           // ← visible window so you can scan / confirm
    executablePath: findChrome(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', (qr) => {
  console.log('\n📱 QR code displayed in the browser — scan it with your phone.');
  console.log('   WhatsApp → ⋮ → Linked Devices → Link a Device\n');
});

client.on('authenticated', () => {
  console.log('✅ Authenticated — saving session...');
});

client.on('ready', async () => {
  console.log('✅ Connected! Session saved to .wwebjs_auth');
  console.log('   You can close this script now (Ctrl+C).\n');
  // Keep alive a few seconds so the session is fully written
  setTimeout(async () => {
    await client.destroy();
    process.exit(0);
  }, 5000);
});

client.on('auth_failure', (msg) => {
  console.error('❌ Auth failed:', msg);
  process.exit(1);
});

console.log('🔄 Opening WhatsApp Web — please wait...');
client.initialize();
