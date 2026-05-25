'use strict';

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs   = require('fs');
const path = require('path');

const CONNECT_TIMEOUT_MS = 90_000;

function _findChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env.USERPROFILE  || '', '.cache\\puppeteer\\chrome\\win64-146.0.7680.31\\chrome-win64\\chrome.exe'),
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('Chrome not found — install Chrome or set executablePath manually');
  return found;
}

function _createClient() {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    webVersionCache: {
      type: 'remote',
      remotePath:
        'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    puppeteer: {
      headless: true,
      executablePath: _findChrome(),
      protocolTimeout: 300_000,   // 5 minutes — getChats() can be slow on first load
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-features=BackForwardCache',
      ],
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

    client.on('ready', () => {
      clearTimeout(timer);
      // Wait 5s for WhatsApp to finish loading chats before we query them
      setTimeout(resolve, 5_000);
    });
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
 * @returns {Promise<Array<{sender:string, date:string, time:string, text:string}>>}
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
