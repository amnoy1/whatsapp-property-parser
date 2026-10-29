'use strict';

/**
 * voice-notes.js — Amir's voice notes in his WhatsApp group "תזכורות" (only he is
 * in it) become lead updates on the Mango dashboard (Amir 2026-10-29; the-system
 * B-brain/03-projects/personal-assistant/spec.md, voice notes).
 *
 *   group "תזכורות", Amir's own voice notes, newer than the last one handled
 *     -> downloaded to data/voice/ (inside the scan's WhatsApp session)
 *     -> transcribed here, locally (personal-assistant-kit calls/transcribe_note.py)
 *     -> the text goes through the dashboard's free-text door
 *        (nir-buyers-agent scripts/apply-update.mjs): new lead / update / task
 *
 * Leads only for now (Amir): a note that names no lead is logged, nothing else.
 * Read only on WhatsApp, like the rest of the scan.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const GROUP_NAME = process.env.VOICE_GROUP_NAME || 'תזכורות';
const DOCS = path.join(process.env.USERPROFILE || 'C:\\Users\\user', 'Documents', 'Amir-workspace');
const KIT_CALLS = process.env.VOICE_KIT_CALLS || path.join(DOCS, 'personal-assistant-kit', 'calls');
const NIR_REPO = process.env.VOICE_NIR_REPO || path.join(DOCS, 'nir-buyers-agent');
const MAX_NOTES = 10; // per run; the rest wait for the next hour
const VOICE_TYPES = ['ptt', 'audio'];

/** Amir's voice notes in the group, newer than `sinceS` (oldest first). */
async function findVoiceNotes(client, sinceS) {
  return client.pupPage.evaluate(async (groupName, sinceS, types, max) => {
    const C = window.require('WAWebCollections');
    const g = C.Chat.getModelsArray().find((c) => c.id.server === 'g.us' && (c.name || c.formattedTitle || '').trim() === groupName);
    if (!g) return { found: false, notes: [] };
    // A chat that wasn't opened lately holds few messages in memory: load back to the cursor.
    const loadEarlier = window.require('WAWebChatLoadMessages').loadEarlierMsgs;
    for (let i = 0; i < 6; i++) {
      const all = g.msgs.getModelsArray();
      if (all.length && all.reduce((a, m) => Math.min(a, m.t), Infinity) <= sinceS) break;
      const got = await Promise.race([loadEarlier({ chat: g }), new Promise((r) => setTimeout(() => r(null), 20000))]);
      if (!got || !got.length) break;
    }
    const all = g.msgs.getModelsArray();
    const ptt = all.filter((m) => types.includes(m.type));
    const stats = { total: all.length, types: [...new Set(all.map((m) => m.type))].join(','), newest: all.reduce((a, m) => Math.max(a, m.t), 0), voice: ptt.map((m) => [new Date(m.t * 1000).toISOString().slice(0, 16), !!m.id.fromMe]) };
    const notes = all
      .filter((m) => m.id.fromMe && types.includes(m.type) && m.t > sinceS)
      .sort((a, b) => a.t - b.t)
      .slice(0, max)
      .map((m) => ({ id: m.id._serialized, t: m.t }));
    return { found: true, groupId: g.id._serialized, notes, stats };
  }, GROUP_NAME, sinceS, VOICE_TYPES, MAX_NOTES);
}

/**
 * Downloads each note to dir, oldest first, and stops at the first that fails:
 * it and the ones after it stay past the cursor and are retried next hour.
 * @returns {{ok: Array, error: string|null}}
 */
async function downloadNotes(client, notes, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ok = [];
  for (const n of notes) {
    try {
      const msg = await client.getMessageById(n.id);
      if (!msg) throw new Error('message not found');
      const media = await msg.downloadMedia();
      if (!media || !media.data) throw new Error('no media');
      const file = path.join(dir, `${n.t}-${n.id.replace(/[^\w]/g, '').slice(-12)}.ogg`);
      fs.writeFileSync(file, Buffer.from(media.data, 'base64'));
      ok.push({ ...n, file });
    } catch (err) {
      return { ok, error: String(err.message || err).slice(0, 160) };
    }
  }
  return { ok, error: null };
}

/** One local Whisper run for all files. Returns Map(file -> {text} | {error}). */
function transcribe(files) {
  const py = path.join(KIT_CALLS, 'venv', 'Scripts', 'python.exe');
  const r = spawnSync(py, ['transcribe_note.py', ...files], {
    cwd: KIT_CALLS, encoding: 'utf8', timeout: 15 * 60_000, windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const out = new Map();
  for (const line of String(r.stdout || '').split(/\r?\n/)) {
    try { const j = JSON.parse(line); if (j.file) out.set(j.file, j); } catch {}
  }
  if (!out.size) throw new Error(`transcribe failed: ${String(r.stderr || r.error || '').slice(-200)}`);
  return out;
}

/** The dashboard's free-text door, run locally with Nir's own env. */
function applyUpdate(text, { dry = false } = {}) {
  const r = spawnSync(process.execPath, ['--env-file=.env', 'scripts/apply-update.mjs', ...(dry ? ['--dry-run'] : [])], {
    cwd: NIR_REPO, input: text, encoding: 'utf8', timeout: 2 * 60_000, windowsHide: true,
  });
  const last = String(r.stdout || '').trim().split(/\r?\n/).pop();
  try { return JSON.parse(last); } catch { throw new Error(`apply-update failed: ${String(r.stderr || r.error || '').slice(-200)}`); }
}

module.exports = { GROUP_NAME, findVoiceNotes, downloadNotes, transcribe, applyUpdate };
