/*! WorkBuddy Score Badge v1.0.0
 *  Injected into the WorkBuddy main window via CDP Runtime.evaluate by wb_score_badge.mjs.
 *  Renders a floating credit badge at the top-right of the chat window.
 *  Hot-reload guard: an older instance retires itself when a newer revision takes over
 *  (same ownership pattern as the Codex++ DeepSeek usage panel).
 */
(() => {
  'use strict';
  const REV = '1.0.0';
  const HOST_ID = 'wb-score-badge-host';
  const POS_KEY = 'wbScoreBadge.pos.v1';

  // ---- ownership / hot-reload ----
  const existing = window.__wbScoreBadge;
  if (existing && existing.rev === REV) {
    if (typeof existing.touch === 'function') existing.touch();
    return 'already';
  }
  if (existing && typeof existing.retire === 'function') {
    try { existing.retire(); } catch (e) { /* ignore */ }
  }

  let retired = false;
  let data = null;
  let busySince = 0;
  const req = { refreshAt: 0 };

  // ---- helpers ----
  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtNum = (n) => (typeof n === 'number' && isFinite(n)) ? n.toLocaleString('en-US') : '--';
  const clampText = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  // ---- host + shadow root ----
  let host = document.getElementById(HOST_ID);
  if (host) host.remove();
  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.position = 'fixed';
  host.style.zIndex = '2147483000';
  host.style.pointerEvents = 'none'; // wrap re-enables pointer events inside shadow
  (document.documentElement || document.body).appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .wrap {
    display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
    pointer-events: auto; user-select: none;
    font-family: "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif;
  }
  .pill {
    display: flex; align-items: center; gap: 7px; height: 28px; padding: 0 13px;
    border-radius: 999px; cursor: grab;
    background: rgba(24, 26, 34, .86);
    -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, .13);
    box-shadow: 0 4px 16px rgba(0, 0, 0, .35);
    color: #e8eaf0; font-size: 12.5px; line-height: 1; white-space: nowrap;
  }
  .pill:active { cursor: grabbing; }
  .pill .label { color: #9aa3b2; font-size: 11.5px; }
  .coin { font-size: 13px; }
  .num { font-weight: 700; color: #f5c451; font-variant-numeric: tabular-nums; font-size: 13px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #f87171; box-shadow: 0 0 6px #f87171; }
  .dot.ok  { background: #34d399; box-shadow: 0 0 6px #34d399; }
  .dot.warn{ background: #fbbf24; box-shadow: 0 0 6px #fbbf24; }
  .dot.err { background: #f87171; box-shadow: 0 0 6px #f87171; }
  .card {
    width: 256px; padding: 12px 14px 10px; display: none;
    background: rgba(24, 26, 34, .96);
    -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
    border: 1px solid rgba(255, 255, 255, .13); border-radius: 12px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, .45);
    color: #cfd3dc; font-size: 12px;
  }
  .wrap:hover .card, .card.pinned { display: block; }
  .chead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .ctitle { font-weight: 600; color: #e8eaf0; font-size: 12.5px; letter-spacing: .2px; }
  .rbtn {
    all: unset; cursor: pointer; width: 20px; height: 20px; border-radius: 6px;
    display: inline-flex; align-items: center; justify-content: center;
    color: #9aa3b2; font-size: 13px; text-align: center;
  }
  .rbtn:hover { background: rgba(255,255,255,.08); color: #fff; }
  .rbtn.spin { animation: spin .9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .big { display: flex; align-items: baseline; gap: 6px; margin: 2px 0 9px; }
  .big .n { font-size: 24px; font-weight: 700; color: #f5c451; font-variant-numeric: tabular-nums; }
  .big .u { font-size: 12px; color: #8b93a3; }
  .row { display: flex; gap: 6px; margin: 4px 0; color: #c3c9d4; align-items: baseline; }
  .row .k { color: #8b93a3; flex: none; }
  .row .v { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta {
    margin-top: 9px; padding-top: 7px; border-top: 1px solid rgba(255,255,255,.08);
    color: #78808f; font-size: 11px; display: flex; justify-content: space-between; gap: 8px;
  }
  .err-text { color: #f8a5a5; white-space: normal; }
</style>
<div class="wrap">
  <div class="pill" title="WorkBuddy 积分徽章&#10;悬停查看详情 · 拖动移动位置">
    <span class="dot err"></span>
    <span class="coin">💰</span>
    <span class="num">--</span>
    <span class="label">积分</span>
  </div>
  <div class="card">
    <div class="chead">
      <span class="ctitle">WorkBuddy 积分</span>
      <button class="rbtn" title="立即刷新">⟳</button>
    </div>
    <div class="big"><span class="n">--</span><span class="u">积分</span></div>
    <div class="row streak"><span class="k">🔥 连续</span><span class="v">--</span></div>
    <div class="row today"><span class="k">📅 今日</span><span class="v">--</span></div>
    <div class="row tier"><span class="k">🎯 连续奖励</span><span class="v">--</span></div>
    <div class="row travel"><span class="k">🐱 旅行</span><span class="v">--</span></div>
    <div class="meta"><span class="m-src">--</span><span class="m-time">--</span></div>
  </div>
</div>`;

  const wrap   = shadow.querySelector('.wrap');
  const pill   = shadow.querySelector('.pill');
  const dotEl  = shadow.querySelector('.dot');
  const numEl  = shadow.querySelector('.pill .num');
  const card   = shadow.querySelector('.card');
  const bigN   = shadow.querySelector('.big .n');
  const vStreak = shadow.querySelector('.streak .v');
  const vToday  = shadow.querySelector('.today .v');
  const vTier   = shadow.querySelector('.tier .v');
  const vTravel = shadow.querySelector('.travel .v');
  const mSrc    = shadow.querySelector('.m-src');
  const mTime   = shadow.querySelector('.m-time');
  const rbtn    = shadow.querySelector('.rbtn');

  // ---- position: default top-right, draggable, persisted ----
  function applyPos() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && typeof saved.l === 'number' && typeof saved.t === 'number') {
      host.style.left = Math.round(saved.l) + 'px';
      host.style.top = Math.round(saved.t) + 'px';
    } else {
      host.style.right = '138px';
      host.style.top = '10px';
    }
  }
  applyPos();

  // drag via pointer events; click (move < 4px) toggles pin
  let dragState = null;
  pill.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const r = host.getBoundingClientRect();
    dragState = { sx: ev.clientX, sy: ev.clientY, ox: r.left, oy: r.top, moved: false };
    pill.setPointerCapture(ev.pointerId);
  });
  pill.addEventListener('pointermove', (ev) => {
    if (!dragState) return;
    const dx = ev.clientX - dragState.sx;
    const dy = ev.clientY - dragState.sy;
    if (!dragState.moved && Math.hypot(dx, dy) < 4) return;
    dragState.moved = true;
    host.style.right = 'auto';
    host.style.left = Math.max(4, dragState.ox + dx) + 'px';
    host.style.top = Math.max(4, dragState.oy + dy) + 'px';
  });
  pill.addEventListener('pointerup', (ev) => {
    if (!dragState) return;
    const wasDrag = dragState.moved;
    dragState = null;
    if (wasDrag) {
      const r = host.getBoundingClientRect();
      try { localStorage.setItem(POS_KEY, JSON.stringify({ l: r.left, t: r.top })); } catch (e) { /* ignore */ }
      card.classList.remove('pinned'); // drag should not leave a pinned card
    } else {
      card.classList.toggle('pinned');
    }
  });
  pill.addEventListener('pointercancel', () => { dragState = null; });

  rbtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    req.refreshAt = Date.now();
    busySince = Date.now();
    rbtn.classList.add('spin');
  });

  // ---- rendering ----
  function setDot(cls) { dotEl.className = 'dot ' + cls; }
  function render() {
    if (!data) {
      numEl.textContent = '--'; bigN.textContent = '--';
      setDot('err');
      vStreak.textContent = vToday.textContent = vTier.textContent = vTravel.textContent = '--';
      mSrc.textContent = '等待数据…'; mTime.textContent = '';
      return;
    }
    if (data.error) {
      numEl.textContent = '--'; bigN.textContent = '--';
      setDot('err');
      vStreak.textContent = '--'; vToday.textContent = '--'; vTier.textContent = '--';
      vTravel.textContent = '--';
      vTravel.classList.add('err-text');
      vTravel.textContent = clampText(data.message || data.error, 60);
      mSrc.textContent = '查询失败'; mTime.textContent = fmtTime(data.fetched_at || Date.now());
      return;
    }
    vTravel.classList.remove('err-text');
    numEl.textContent = fmtNum(data.total_credits);
    bigN.textContent = fmtNum(data.total_credits);
    setDot(data.today_checked_in ? 'ok' : 'warn');
    vStreak.textContent = (typeof data.streak_days === 'number' ? data.streak_days + ' 天' : '--');
    vToday.textContent = data.today_checked_in
      ? `已记录${typeof data.today_credit === 'number' ? ' · 今日可得 ' + data.today_credit + ' 分' : ''}`
      : '未记录（完成一次对话即记录 1 天）';
    let tier = '--';
    if (typeof data.next_streak_day === 'number' && data.next_streak_day > 0) {
      const gap = Math.max(0, data.next_streak_day - (typeof data.streak_days === 'number' ? data.streak_days : 0));
      tier = `还差 ${gap} 天到 ${data.next_streak_day} 天档`;
    }
    if (typeof data.streak_bonus_credit === 'number' && data.streak_bonus_credit > 0) {
      tier += (tier !== '--' ? ' · ' : '') + `已累计奖励 +${data.streak_bonus_credit} 分`;
    }
    vTier.textContent = tier;
    // travel
    const t = data.travel;
    let travel = '—';
    if (t && t.available) {
      if (t.state === 'traveling') travel = `旅行中 · ${t.location_name || ''}${t.remaining_text ? ' · ' + t.remaining_text : ''}`;
      else if (t.state === 'arrived') travel = `已到达 · 可领 ${typeof t.reward_credit === 'number' ? t.reward_credit + ' 分' : '奖励'}`;
      else if (t.state === 'idle') travel = '空闲' + (t.daily_limit_reached ? '（今日派遣已达上限）' : '');
    }
    vTravel.textContent = clampText(travel, 34);
    mSrc.textContent = data._source === 'mock' ? '演示数据' : 'Buddy 加油站';
    mTime.textContent = '更新于 ' + fmtTime(data.fetched_at || Date.now());
  }
  render();

  // busy spinner auto-clear (in case no update arrives)
  setInterval(() => {
    if (busySince && Date.now() - busySince > 20000) {
      busySince = 0; rbtn.classList.remove('spin');
    }
    // remount if the host app wiped our node (SPA DOM reset safety)
    if (!retired && !host.isConnected) {
      host = document.getElementById(HOST_ID);
      if (!host) { /* full re-injection by bridge will restore state */ }
    }
  }, 15000);

  // ---- public api ----
  const api = {
    rev: REV,
    req,
    touch() { /* heartbeat: bridge confirms ownership each poll */ },
    retire() {
      if (retired) return;
      retired = true;
      try { host.remove(); } catch (e) { /* ignore */ }
    },
    update(d) {
      data = d;
      busySince = 0;
      rbtn.classList.remove('spin');
      render();
    },
    get data() { return data; }
  };
  window.__wbScoreBadge = api;
  return 'injected';
})();
