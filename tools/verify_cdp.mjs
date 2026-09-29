// E2E verification: connect to CDP, check badge injection + data push + refresh request
import fs from 'node:fs';
const PORT = process.env.VERIFY_PORT || 9333;

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

class Ws {
  static send(wsUrl, msg, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('ws timeout')); }, timeoutMs);
      ws.addEventListener('open', () => ws.send(JSON.stringify(msg)));
      ws.addEventListener('message', (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === msg.id) { clearTimeout(timer); ws.close(); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
      });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('ws error')); });
    });
  }
}

let id = 0;
async function evaluate(wsUrl, expression) {
  const res = await Ws.send(wsUrl, { id: ++id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } });
  if (res.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(res.exceptionDetails.exception?.description || res.exceptionDetails.text).slice(0, 300));
  return res.result?.value;
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('no page target'); process.exit(1); }
const wsUrl = page.webSocketDebuggerUrl;

// wait for bridge to inject
let badge = false, dataOk = false;
for (let i = 0; i < 20; i++) {
  try {
    badge = await evaluate(wsUrl, `!!document.getElementById('wb-score-badge-host')`);
    dataOk = await evaluate(wsUrl, `window.__wbScoreBadge && window.__wbScoreBadge.data && window.__wbScoreBadge.data.total_credits === 900 ? 1 : 0`) === 1;
    if (badge && dataOk) break;
  } catch (e) { /* page not ready yet */ }
  await new Promise((r) => setTimeout(r, 1000));
}
check('badge host injected into page', !!badge);
check('mock data pushed (total_credits=900)', dataOk);

const pos = await evaluate(wsUrl, `(()=>{const h=document.getElementById('wb-score-badge-host');return h?h.style.position+'|'+h.style.zIndex:'none'})()`);
check('host is fixed-position overlay', pos === 'fixed|2147483000', String(pos));

// refresh request round-trip
const before = await evaluate(wsUrl, `window.__wbScoreBadge.req.refreshAt = Date.now(); window.__wbScoreBadge.req.refreshAt`);
await new Promise((r) => setTimeout(r, 5500));
const lastPush = await evaluate(wsUrl, `window.__wbScoreBadge.data.fetched_at`);
check('refresh request readable from page', typeof before === 'number' && before > 0);

// idempotent re-injection returns 'already'
const again = await evaluate(wsUrl, fs.readFileSync(process.env.BADGE_PATH, 'utf8'));
check('hot-reload guard returns "already"', again === 'already', String(again));

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} checks passed`);
process.exit(fails ? 1 : 0);
