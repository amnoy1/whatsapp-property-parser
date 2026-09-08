'use strict';

/**
 * trigger-watcher.js
 *
 * Runs in the background (started at system startup via Task Scheduler).
 * Subscribes to Supabase Realtime on the `run_triggers` table.
 * When the admin panel inserts a row with status='pending', this process
 * spawns daily-report.js — exactly once (lock file prevents double-runs).
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { spawn }        = require('child_process');
const fs               = require('fs');
const path             = require('path');

// ── paths ─────────────────────────────────────────────────────────────────────

const ROOT       = path.join(__dirname, '..');
const LOCK_FILE  = path.join(ROOT, 'data',  'running.lock');
const REPORT_LOG = path.join(ROOT, 'logs',  'daily-report.log');
const WATCHER_LOG= path.join(ROOT, 'logs',  'trigger-watcher.log');

// ── helpers ───────────────────────────────────────────────────────────────────

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    ensureDir(WATCHER_LOG);
    fs.appendFileSync(WATCHER_LOG, line + '\n');
  } catch {}
}

// ── lock file (prevents double-runs) ─────────────────────────────────────────

const LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — daily-report takes ~3 min max

function isRunning() {
  if (!fs.existsSync(LOCK_FILE)) return false;
  try {
    const ageMs = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
    if (ageMs > LOCK_TIMEOUT_MS) {
      log('⚠️  Stale lock file (>30 min) — removing');
      fs.unlinkSync(LOCK_FILE);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── supabase ──────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function updateTrigger(id, status, result = null) {
  const { error } = await supabase
    .from('run_triggers')
    .update({ status, result })
    .eq('id', id);
  if (error) log(`⚠️  Failed to update trigger ${id}: ${error.message}`);
}

// ── run daily-report ──────────────────────────────────────────────────────────

async function runReport(triggerId) {
  if (isRunning()) {
    log(`⚠️  Already running — ignoring trigger ${triggerId}`);
    await updateTrigger(triggerId, 'already_running', 'דוח כבר רץ כרגע — נסה שוב בעוד מספר דקות');
    return;
  }

  await updateTrigger(triggerId, 'running');
  log(`▶️  Spawning daily-report.js (trigger: ${triggerId})`);

  // Append output to the same log file as the scheduled run
  ensureDir(REPORT_LOG);
  const logFd = fs.openSync(REPORT_LOG, 'a');

  const child = spawn('node', [path.join(__dirname, 'daily-report.js')], {
    cwd: ROOT,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });

  child.on('close', async (code) => {
    try { fs.closeSync(logFd); } catch {}

    if (code === 0) {
      log(`✅ daily-report.js done (trigger: ${triggerId})`);
      await updateTrigger(triggerId, 'done', 'הרצה הושלמה בהצלחה ✅');
    } else {
      log(`❌ daily-report.js exited with code ${code} (trigger: ${triggerId})`);
      await updateTrigger(triggerId, 'error', `הרצה נכשלה (קוד ${code}) — בדוק את הלוג`);
    }
  });

  child.on('error', async (err) => {
    try { fs.closeSync(logFd); } catch {}
    log(`❌ Failed to spawn daily-report.js: ${err.message}`);
    await updateTrigger(triggerId, 'error', `שגיאת הפעלה: ${err.message}`);
  });
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
    process.exit(1);
  }

  log('🔌 Trigger watcher started — waiting for run requests via Supabase Realtime');

  // Handle any trigger that was requested while the watcher was offline
  const { data: pending } = await supabase
    .from('run_triggers')
    .select('id')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })
    .limit(1);

  if (pending?.length) {
    log(`📬 Found pending trigger from before startup: ${pending[0].id}`);
    runReport(pending[0].id);
  }

  // Subscribe to new inserts via Realtime (WebSocket — no polling)
  supabase
    .channel('run-triggers-channel')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'run_triggers' },
      (payload) => {
        if (payload.new?.status === 'pending') {
          log(`📩 Trigger received: ${payload.new.id}`);
          runReport(payload.new.id);
        }
      }
    )
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') log('📡 Realtime subscription active');
      if (status === 'CHANNEL_ERROR') log(`⚠️  Realtime error: ${err?.message}`);
      if (status === 'CLOSED') log('📡 Realtime channel closed — reconnecting...');
    });

  // Keep the process alive
  process.on('SIGINT',  () => { log('👋 Watcher stopped (SIGINT)');  process.exit(0); });
  process.on('SIGTERM', () => { log('👋 Watcher stopped (SIGTERM)'); process.exit(0); });
}

main().catch(err => {
  log(`❌ Fatal: ${err.message}`);
  process.exit(1);
});
