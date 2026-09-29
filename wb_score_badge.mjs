#!/usr/bin/env node
/**
 * WorkBuddy Score Badge — bridge daemon v1.0.0
 *
 * Connects to WorkBuddy's official CDP endpoint (enabled by launching WorkBuddy with
 * the WORKBUDDY_REMOTE_DEBUGGING_PORT environment variable), injects badge.js into
 * every eligible page target, keeps it alive across navigations, and pushes credit
 * data into the page via window.__wbScoreBadge.update(...).
 *
 * Data source: the installed "totorosir-workbuddy-score" skill script
 * (buddy_station.py) which reads the local login state and queries the
 * Buddy Station checkin-activity-status API. Alternatively WB_SCORE_MOCK_DATA
 * (JSON) for demo/testing.
 *
 * Requires Node.js >= 22 (global WebSocket). Zero dependencies.
 *
 * Exit codes: 0 clean exit (WorkBuddy closed) / 2 CDP unreachable at startup
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REV = '1.0.0';
const CFG = {
  cdpPort: Number(process.env.WB_SCORE_CDP_PORT || 9223),
  pollMs: clampNum(process.env.WB_SCORE_POLL_MS, 3000, 500, 60_000),
  dataIntervalMs: clampNum(process.env.WB_SCORE_DATA_INTERVAL_MS, 5 * 60_000, 30_000, 24 * 3600_000),
  idleExitMs: clampNum(process.env.WB_SCORE_IDLE_EXIT_MS, 90_000, 10_000, 3600_000),
  pyTimeoutMs: clampNum(process.env.WB_SCORE_PY_TIMEOUT_MS, 45_000, 5_000, 300_000),
  mock: process.env.WB_SCORE_MOCK_DATA || '',
  urlFilter: process.env.WB_SCORE_URL_FILTER || '', // optional substring; empty = all pages
  logFile: process.env.WB_SCORE_LOG || ''
};

function clampNum(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

const log = (...a) => {
  const line = `[${ts()}] ${a.join(' ')}`;
  console.log(line);
  if (CFG.logFile) { try { fs.appendFileSync(CFG.logFile, line + '\n'); } catch (e) { /* ignore */ } }
};
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// badge source
// ---------------------------------------------------------------------------
const badgeSrc = fs.readFileSync(path.join(__dirname, 'badge.js'), 'utf8');
const HEARTBEAT = `(window.__wbScoreBadge&&window.__wbScoreBadge.rev===${JSON.stringify(REV)})?1:0`;
const READ_REFRESH = `(window.__wbScoreBadge&&window.__wbScoreBadge.req)?window.__wbScoreBadge.req.refreshAt:0`;

// ---------------------------------------------------------------------------
// data source: buddy_station.py (skill) or mock
// ---------------------------------------------------------------------------
function findPython() {
  const cands = [];
  if (process.env.WB_SCORE_PYTHON) cands.push(process.env.WB_SCORE_PYTHON);
  const binRoot = path.join(os.homedir(), '.workbuddy', 'binaries', 'python', 'versions');
  try {
    for (const v of fs.readdirSync(binRoot)) {
      const exe = process.platform === 'win32' ? path.join(binRoot, v, 'python.exe') : path.join(binRoot, v, 'python');
      if (fs.existsSync(exe)) cands.push(exe);
    }
  } catch (e) { /* ignore */ }
  if (process.platform === 'win32') {
    cands.push('python3', 'python');
  } else {
    cands.push('python3', 'python');
  }
  return cands;
}

function findSkillScript() {
  const cands = [];
  if (process.env.WB_SCORE_SKILL_SCRIPT) cands.push(process.env.WB_SCORE_SKILL_SCRIPT);
  const skillsRoot = path.join(os.homedir(), '.workbuddy', 'skills');
  for (const name of ['totorosir-workbuddy-score', 'totorosir-workbuddy-score__skillhub']) {
    cands.push(path.join(skillsRoot, name, 'scripts', 'buddy_station.py'));
  }
  for (const p of cands) { try { if (fs.existsSync(p)) return p; } catch (e) { /* ignore */ } }
  return null;
}

let cachedSource = null;
function resolveSource() {
  if (cachedSource) return cachedSource;
  if (CFG.mock) { cachedSource = { kind: 'mock' }; return cachedSource; }
  const script = findSkillScript();
  if (script) {
    for (const py of findPython()) {
      // "python3"/"python" on PATH are resolved by spawn; absolute paths checked here
      if (py.includes('\\') || py.includes('/')) { if (!fs.existsSync(py)) continue; }
      cachedSource = { kind: 'skill', py, script };
      return cachedSource;
    }
    cachedSource = { kind: 'none', reason: `skill script found but no Python interpreter` };
    return cachedSource;
  }
  cachedSource = { kind: 'none', reason: 'totorosir-workbuddy-score skill not found (and no WB_SCORE_MOCK_DATA)' };
  return cachedSource;
}

function queryData() {
  return new Promise((resolve) => {
    const src = resolveSource();
    const finish = (d) => resolve({ ...d, fetched_at: Date.now() });
    if (src.kind === 'mock') {
      try { finish(JSON.parse(CFG.mock)); } catch (e) { finish({ error: 'mock-parse', message: String(e.message || e) }); }
      return;
    }
    if (src.kind === 'none') { finish({ error: 'no-source', message: src.reason }); return; }

    const args = [src.script, '--json', '--no-toast', '--no-push'];
    const child = spawn(src.py, args, {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    });
    let out = '', err = '', done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; try { child.kill(); } catch (e) {} finish({ error: 'timeout', message: `data query timed out after ${CFG.pyTimeoutMs / 1000}s` }); }
    }, CFG.pyTimeoutMs);
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', (e) => {
      if (done) return; done = true; clearTimeout(timer);
      finish({ error: 'spawn-failed', message: String(e.message || e) });
    });
    child.on('close', (code) => {
      if (done) return; done = true; clearTimeout(timer);
      try {
        const j = JSON.parse(out.trim().replace(/^\uFEFF/, ''));
        if (j && typeof j === 'object') { j._source = 'skill'; finish(j); }
        else finish({ error: 'bad-payload', message: 'unexpected data payload' });
      } catch (e) {
        finish({ error: 'bad-output', message: `python exit=${code} output not JSON${err ? ': ' + err.slice(0, 160) : ''}` });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// CDP target wrapper
// ---------------------------------------------------------------------------
class Target {
  constructor(info) {
    this.id = info.id;
    this.url = info.url;
    this.wsUrl = info.webSocketDebuggerUrl;
    this.ws = null;
    this.ready = false;
    this.injectedOk = false;
    this.msgId = 0;
    this.pending = new Map();
    this.dead = false;
  }

  connect() {
    if (this.ready || this.dead) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
      let ws;
      try {
        ws = new WebSocket(this.wsUrl);
      } catch (e) { this.dead = true; done(false); return; }
      ws.addEventListener('open', () => { this.ready = true; done(true); }, { once: true });
      ws.addEventListener('error', () => { this.ready = false; done(false); }, { once: true });
      ws.addEventListener('close', () => {
        this.ready = false; this.injectedOk = false;
        for (const p of this.pending.values()) p.reject(new Error('ws closed'));
        this.pending.clear();
      });
      ws.addEventListener('message', (ev) => {
        let m = null;
        try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch (e) { return; }
        if (m && m.id && this.pending.has(m.id)) {
          const p = this.pending.get(m.id);
          this.pending.delete(m.id);
          if (m.error) p.reject(new Error(m.error.message || JSON.stringify(m.error)));
          else p.resolve(m.result);
        }
        // CDP events are ignored
      });
      this.ws = ws;
      setTimeout(() => done(this.ready), 8000); // connect timeout
    });
  }

  send(method, params, timeoutMs = 10000) {
    if (!this.ready || !this.ws || this.ws.readyState !== 1) return Promise.reject(new Error('ws not ready'));
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout: ${method}`)); }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true }, 15000);
    if (res && res.result) {
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'evaluate exception');
      return res.result.value;
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// main loop
// ---------------------------------------------------------------------------
async function main() {
  log(`wb-score-badge bridge v${REV} | cdp=127.0.0.1:${CFG.cdpPort} poll=${CFG.pollMs}ms dataEvery=${Math.round(CFG.dataIntervalMs / 60000)}min`);
  log(`badge source: ${JSON.stringify((() => { const s = resolveSource(); return s.kind === 'skill' ? `skill (${s.py})` : s.kind; })())}`);

  // wait for CDP to come up (WorkBuddy may still be starting)
  const bootDeadline = Date.now() + 120_000;
  let list = null;
  while (Date.now() < bootDeadline) {
    try { list = await fetchJson(`http://127.0.0.1:${CFG.cdpPort}/json/list`); break; }
    catch (e) { await sleep(2000); }
  }
  if (!list) {
    log(`FATAL: CDP port ${CFG.cdpPort} unreachable. Start WorkBuddy via start.cmd (WORKBUDDY_REMOTE_DEBUGGING_PORT).`);
    process.exit(2);
  }
  log(`CDP reachable, ${list.length} target(s) at startup.`);

  const targets = new Map(); // targetId -> Target
  let data = null;
  let dataBusy = false;
  let needQuery = true;
  let lastRefreshSeen = 0;
  let downSince = 0;

  const pushData = (t) => t.evaluate(`window.__wbScoreBadge&&window.__wbScoreBadge.update(${JSON.stringify(data)})`)
    .catch(() => { t.injectedOk = false; });

  for (;;) {
    // 1) discover targets
    let pages = null;
    try {
      list = await fetchJson(`http://127.0.0.1:${CFG.cdpPort}/json/list`);
      downSince = 0;
    } catch (e) {
      if (!downSince) downSince = Date.now();
      else if (Date.now() - downSince > CFG.idleExitMs) {
        log(`WorkBuddy (CDP) is gone for ${Math.round(CFG.idleExitMs / 1000)}s -> bridge exits.`);
        process.exit(0);
      }
      await sleep(CFG.pollMs);
      continue;
    }

    pages = (list || []).filter((t) =>
      t && t.type === 'page' && t.webSocketDebuggerUrl &&
      !/^devtools:|^chrome:|^edge:|^chrome-extension:|^about:blank$/i.test(t.url) &&
      (!CFG.urlFilter || t.url.includes(CFG.urlFilter))
    );

    // prune
    const aliveIds = new Set(pages.map((p) => p.id));
    for (const [id, t] of targets) if (!aliveIds.has(id)) targets.delete(id);

    // 2) per-target: connect -> inject -> heartbeat -> push -> refresh request
    for (const info of pages) {
      let t = targets.get(info.id);
      if (!t) { t = new Target(info); targets.set(info.id, t); }
      if (!t.ready) {
        t.wsUrl = info.webSocketDebuggerUrl;
        const ok = await t.connect();
        if (!ok) continue;
      }
      try {
        const hb = await t.evaluate(HEARTBEAT);
        if (hb !== 1) {
          const r = await t.evaluate(badgeSrc);
          if (r === 'injected') log(`badge injected -> ${shortUrl(info.url)} (${info.id.slice(0, 8)})`);
          else if (r !== 'already') { t.injectedOk = false; continue; }
        }
        if (data) await pushData(t);
        const rr = Number(await t.evaluate(READ_REFRESH) || 0);
        if (rr > lastRefreshSeen) { lastRefreshSeen = rr; needQuery = true; log('refresh requested from badge'); }
      } catch (e) {
        t.injectedOk = false;
      }
    }

    // 3) data refresh scheduling
    const stale = !data || (Date.now() - (data.fetched_at || 0) > CFG.dataIntervalMs);
    if (needQuery && !dataBusy) {
      dataBusy = true; needQuery = false;
      queryData().then((d) => {
        data = d;
        if (d.error) log(`data query failed: ${d.error} — ${String(d.message || '').slice(0, 120)}`);
        else log(`data: credits=${d.total_credits} streak=${d.streak_days} today=${d.today_checked_in ? 'yes' : 'no'}`);
        for (const t of targets.values()) if (t.ready) pushData(t);
      }).finally(() => { dataBusy = false; });
    } else if (stale && !dataBusy) {
      needQuery = true;
    }

    await sleep(CFG.pollMs);
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const shortUrl = (u) => String(u || '').replace(/^https?:\/\//, '').slice(0, 60);

process.on('uncaughtException', (e) => { log(`uncaught: ${e && e.message}`); });
process.on('unhandledRejection', (e) => { log(`unhandled: ${e && (e.message || e)}`); });

main().catch((e) => { log(`FATAL: ${e && (e.stack || e.message || e)}`); process.exit(1); });
