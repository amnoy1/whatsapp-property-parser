'use strict';

// Telegram alert to Amir — same bot + chat that Nir (nir-buyers-agent) uses.
// Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.
//
// Best-effort and never throws: a failed alert must not hide the original
// error in the log. If the env vars are missing it says so in the log, loudly,
// because a silent alert channel is how the parser sat dead for a week (Oct 2026).

const SEND_TIMEOUT_MS = 10_000;

async function sendAlert(text) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.error('   ⚠️  Telegram alert NOT sent — TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing in .env');
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: `🏠 מנתח הנכסים מווצאפ\n\n${text}` }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`   ⚠️  Telegram alert failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
      return false;
    }
    console.log('   📨 Telegram alert sent');
    return true;
  } catch (err) {
    console.error(`   ⚠️  Telegram alert failed: ${err.message}`);
    return false;
  }
}

module.exports = { sendAlert };
