'use strict';

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs   = require('fs');
const path = require('path');

const CONNECT_TIMEOUT_MS = 180_000; // 3 minutes

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
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const client = _createClient();
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`WhatsApp connection timeout after ${CONNECT_TIMEOUT_MS / 1000}s`)),
          CONNECT_TIMEOUT_MS
        );

        client.on('ready', () => {
          clearTimeout(timer);
          // Wait 12s for WhatsApp to finish loading chats + message history before we query them
          setTimeout(resolve, 12_000);
        });
        client.on('auth_failure', msg => {
          clearTimeout(timer);
          reject(new Error(`WhatsApp auth failure: ${msg}`));
        });

        client.initialize();
      });
      return client;
    } catch (err) {
      if (err.message.startsWith('WhatsApp auth failure')) throw err; // QR needed — no point retrying
      try { await client.destroy(); } catch {}

      if (attempt < MAX_ATTEMPTS) {
        console.log(`   ⚠️  Attempt ${attempt} failed: ${err.message.slice(0, 80)}. Retrying in 20s...`);
        await new Promise(r => setTimeout(r, 20_000));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Fetch messages from a WhatsApp group sent in the last `hoursBack` hours.
 * @param {Client} client
 * @param {string} groupName  Exact group name as it appears in WhatsApp
 * @param {number} hoursBack
 * @returns {Promise<Array<{sender:string, date:string, time:string, text:string}>>}
 */
async function fetchGroupMessages(client, groupName, sinceMs) {
  const cutoffMs = sinceMs ?? (Date.now() - 24 * 3_600_000);

  // getChats() fails in current WA Web because getChatModel() throws a minified "r" error
  // for some chat types. Instead, access the WA store directly to find the group and
  // read its messages — bypasses getChatModel entirely.
  const result = await client.pupPage.evaluate(async (name, cutoff) => {
    const allChats = window.require('WAWebCollections').Chat.getModelsArray();
    const chat = allChats.find(c => c.name === name);
    if (!chat) return { error: 'not_found' };

    // Load earlier messages from the server until the oldest loaded message
    // is before the cutoff. WA Web only keeps ~50 msgs in memory by default;
    // loadEarlierMsgs fetches batches from the server.
    const loadEarlier = window.require('WAWebChatLoadMessages').loadEarlierMsgs;
    for (let round = 0; round < 15; round++) {
      const all = chat.msgs.getModelsArray();
      if (!all.length) break;
      const oldestTs = all.reduce((min, m) => Math.min(min, m.t * 1000), Infinity);
      if (oldestTs <= cutoff) break;         // history now covers the full window
      const loaded = await loadEarlier({ chat });
      if (!loaded || !loaded.length) break;  // server has no more history
    }

    const msgs = chat.msgs.getModelsArray();
    return {
      messages: msgs
        .filter(m => !m.isNotification && !m.id.fromMe && m.body && m.t * 1000 >= cutoff)
        .map(m => ({
          sender: m.notifyName || m.senderObj?.name || 'Unknown',
          date:   new Date(m.t * 1000).toISOString().split('T')[0],
          time:   new Date(m.t * 1000).toTimeString().slice(0, 5),
          text:   m.body,
        })),
    };
  }, groupName, cutoffMs);

  if (result.error === 'not_found') throw new Error(`WhatsApp group not found: "${groupName}"`);
  return result.messages;
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

  // Verify the target chat exists before sending
  const chat = await client.getChatById(waId).catch(() => null);
  if (!chat) {
    throw new Error(`Cannot find WhatsApp chat for ${recipientPhone} (${waId}). ` +
      `Make sure you have an existing conversation with this number, or send a message first.`);
  }
  console.log(`   📲 Sending to: "${chat.name || waId}" (${waId})`);

  const media = new MessageMedia(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    excelBuffer.toString('base64'),
    filename
  );

  await client.sendMessage(waId, media, { caption: messageText });

  // Brief pause to allow WhatsApp to finish the upload before disconnecting
  await new Promise(r => setTimeout(r, 3_000));
}

/**
 * Gracefully disconnect the client.
 */
async function disconnect(client) {
  await client.destroy();
}

module.exports = { connect, fetchGroupMessages, sendReport, disconnect };
