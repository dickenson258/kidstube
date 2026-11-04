// KidsTube 前端 —— 所有数据只保存在本浏览器 localStorage，不上传任何服务器
import { DICT } from './i18n.js';
import * as R from './resolver.js';
import { detectHelper, onHelper, helperRequest, helperVersion } from './bridge.js';

// 检测到 KidsTube 助手后，跨域请求改由助手发出
onHelper(() => R.setTransport(helperRequest));
detectHelper();

const $ = (s, el = document) => el.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toLocaleDateString('sv-SE');
const ALL = '__all';

// ------------------------------------------------------------ 本地存储
const KEY = 'kidstube:v1';
const browserLang = /^zh/i.test(navigator.language) ? 'zh' : 'en';
function load() {
  const base = {
    videos: [],
    groups: DICT[browserLang].defaultGroups.slice(),
    settings: { lang: browserLang, pinHash: '', ytKey: '', ytLoggedIn: false, shield: true, sandbox: false, dailyLimit: 0 },
    usage: { date: today(), sec: 0, bonus: 0 },
  };
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d) return { ...base, ...d, settings: { ...base.settings, ...d.settings } };
  } catch {}
  return base;
}
const db = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { toast(t('storageFail')); }
}
function usage() {
  if (db.usage.date !== today()) db.usage = { date: today(), sec: 0, bonus: 0 };
  return db.usage;
}
const limitSec = () => (db.settings.dailyLimit ? db.settings.dailyLimit * 60 + (usage().bonus || 0) : Infinity);

// ------------------------------------------------------------ 多语言
const L = () => DICT[db.settings.lang] || DICT.zh;
function t(key, ...args) {
  const v = L()[key] ?? DICT.zh[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
}
const platName = (p) => L().platforms[p] || p;
const errText = (e) => (L().err[e.code] ? L().err[e.code] + (e.detail && e.code !== 'XHS_LOGIN' ? `（${e.detail}）` : '') : e.detail || e.message);
function setLang(lang) {
  db.settings.lang = lang;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  save();
}
document.documentElement.lang = db.settings.lang === 'zh' ? 'zh-CN' : 'en';

// ------------------------------------------------------------ 通用 UI
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
function modal(html, onMount) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="mask"><div class="dialog">${html}</div></div>`;
  const close = () => (root.innerHTML = '');
  root.querySelector('.mask').addEventListener('click', (e) => e.target.classList.contains('mask') && close());
  onMount?.(root.querySelector('.dialog'), close);
  return close;
}
// 手机通过 http://192.168.x.x 访问时不是"安全上下文"，crypto.subtle 不可用，改用纯 JS 实现
async function sha(s) {
  const bytes = new TextEncoder().encode('kidstube::' + s);
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256js(bytes);
}
function sha256js(bytes) {
  const K = [];
  const H = [];
  const frac = (x) => ((x - Math.floor(x)) * 2 ** 32) >>> 0;
  for (let n = 2, c = 0; c < 64; n++) {
    if ([...Array(n).keys()].slice(2).some((d) => n % d === 0)) continue;
    if (c < 8) H.push(frac(Math.sqrt(n)));
    K.push(frac(Math.cbrt(n)));
    c++;
  }
  const len = bytes.length, total = (((len + 9 + 63) >> 6) << 6);
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  new DataView(m.buffer).setUint32(total - 4, len * 8);
  const w = new Uint32Array(64), rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < total; i += 64) {
    const dv = new DataView(m.buffer, i, 64);
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(j * 4);
    for (let j = 16; j < 64; j++) {
      const s0 = rot(w[j - 15], 7) ^ rot(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rot(w[j - 2], 17) ^ rot(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let j = 0; j < 64; j++) {
      const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[j] + w[j]) >>> 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, h].forEach((v, k) => (H[k] = (H[k] + v) >>> 0));
  }
  return H.map((v) => v.toString(16).padStart(8, '0')).join('');
}
const thumbImg = (v) => (v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '');

// PIN 输入框：mode = 'verify' | 'set'
function pinDialog({ title, sub = '', mode = 'verify' }) {
  return new Promise((resolve) => {
    let pin = '', first = '';
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('b');
      else if (e.key === 'Escape') press('x');
    };
    let dlg, close;
    const done = (v) => { document.removeEventListener('keydown', onKey); close(); resolve(v); };
    const dots = () => dlg.querySelectorAll('.pin-dots i').forEach((d, i) => d.classList.toggle('on', i < pin.length));
    const fail = (msg) => { pin = ''; $('#pin-sub').textContent = msg; dlg.classList.remove('shake'); void dlg.offsetWidth; dlg.classList.add('shake'); dots(); };
    async function press(n) {
      if (n === 'x') return done(null);
      if (n === 'b') pin = pin.slice(0, -1);
      else if (pin.length < 4) pin += n;
      dots();
      if (pin.length < 4) return;
      if (mode === 'set') {
        if (!first) { first = pin; pin = ''; dots(); $('#pin-sub').textContent = t('pinAgain'); return; }
        if (first === pin) return done(pin);
        first = '';
        return fail(t('pinMismatch'));
      }
      if ((await sha(pin)) === db.settings.pinHash) return done(pin);
      fail(t('pinWrong'));
    }
    close = modal(
      `<h2>${title}</h2><div class="hint" id="pin-sub">${sub}</div>
       <div class="pin-dots">${'<i></i>'.repeat(4)}</div>
       <div class="pin-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-n="${n}">${n}</button>`).join('')}
       <button data-n="x" class="txt">${t('pinCancel')}</button><button data-n="0">0</button><button data-n="b" class="txt" aria-label="delete">⌫</button></div>`,
      (d) => {
        dlg = d;
        dlg.querySelectorAll('[data-n]').forEach((b) => (b.onclick = () => press(b.dataset.n)));
        document.addEventListener('keydown', onKey);
      }
    );
  });
}

let parentUnlocked = false;
async function unlockParent() {
  if (parentUnlocked) return true;
  if (!db.settings.pinHash) {
    const pin = await pinDialog({ title: t('pinSetTitle'), sub: t('pinSetSub'), mode: 'set' });
    if (!pin) return false;
    db.settings.pinHash = await sha(pin);
    save();
    toast(t('pinSaved'));
  } else if (!(await pinDialog({ title: t('pinVerifyTitle'), sub: t('pinVerifySub') }))) return false;
  parentUnlocked = true;
  return true;
}

// ------------------------------------------------------------ 链接解析（在浏览器中完成）
async function api(body) {
  try {
    return await R.resolve({ ...body, ytKey: db.settings.ytKey || undefined });
  } catch (e) {
    throw e.code ? e : Object.assign(e, { code: 'HTTP', detail: e.message });
  }
}

// ------------------------------------------------------------ 路由
const app = $('#app');
let cleanup = null;
function route() {
  cleanup?.();
  cleanup = null;
  window.scrollTo(0, 0);
  document.title = 'KidsTube';
  const [, page, arg] = location.hash.split('/');
  if (page === 'watch') return renderWatch(arg);
  if (page === 'parent') {
    if (!parentUnlocked) {
      location.hash = '#/';
      unlockParent().then((ok) => ok && (location.hash = '#/parent/' + (arg || 'add')));
      return;
    }
    return renderParent(arg || 'add');
  }
  renderHome();
}
window.addEventListener('hashchange', route);

const langBtn = () => `<button class="btn icon-btn lang" id="lang-btn" title="中文 / English">${db.settings.lang === 'zh' ? 'EN' : '中'}</button>`;
function bindLangBtn() {
  $('#lang-btn').onclick = () => { setLang(db.settings.lang === 'zh' ? 'en' : 'zh'); route(); };
}
function topbar(extra = '') {
  return `<header class="topbar">
    <a class="logo" href="#/"><img src="icon.svg" alt=""><span>Kids<b>Tube</b></span></a>
    <div class="spacer"></div>${extra}${langBtn()}
    <button class="btn icon-btn" id="parent-btn" title="${t('parentArea')}" aria-label="${t('parentArea')}">🔒</button>
  </header>`;
}
function bindTopbar() {
  bindLangBtn();
  $('#parent-btn').onclick = () => unlockParent().then((ok) => ok && (location.hash = '#/parent/add'));
}

// ------------------------------------------------------------ 儿童首页
let homeGroup = ALL, homeQuery = '';
function videoCard(v) {
  return `<a class="card" href="#/watch/${v.id}">
    <div class="thumb">${thumbImg(v)}<span class="plat plat-${v.platform}">${esc(platName(v.platform))}</span>${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ''}</div>
    <div class="body"><div class="title">${esc(v.title)}</div><div class="sub">${esc(v.author || '')}</div></div></a>`;
}
function renderHome() {
  const groups = db.groups.filter((g) => db.videos.some((v) => v.group === g));
  if (homeGroup !== ALL && !groups.includes(homeGroup)) homeGroup = ALL;
  const q = homeQuery.toLowerCase();
  const list = db.videos
    .filter((v) => homeGroup === ALL || v.group === homeGroup)
    .filter((v) => !q || (v.title + v.author).toLowerCase().includes(q));
  app.innerHTML =
    topbar(`<input class="search" id="q" placeholder="${t('search')}" value="${esc(homeQuery)}">`) +
    `<main class="wrap">
      ${db.videos.length ? `<div class="chips">${[ALL, ...groups].map((g) => `<button class="chip ${g === homeGroup ? 'on' : ''}" data-g="${esc(g)}">${esc(g === ALL ? t('all') : g)}</button>`).join('')}</div>` : ''}
      ${list.length ? `<div class="grid">${list.map(videoCard).join('')}</div>`
        : db.videos.length ? `<div class="empty"><div class="big">🔍</div><h2>${t('notFound')}</h2></div>`
        : `<div class="empty"><div class="big">📺</div><h2>${t('emptyTitle')}</h2><p>${t('emptyBody')}</p></div>`}
    </main>`;
  bindTopbar();
  app.querySelectorAll('.chip').forEach((c) => (c.onclick = () => { homeGroup = c.dataset.g; renderHome(); }));
  const input = $('#q');
  input.oninput = () => {
    homeQuery = input.value;
    const pos = input.selectionStart;
    renderHome();
    const n = $('#q');
    n.focus();
    n.setSelectionRange(pos, pos);
  };
}

// ------------------------------------------------------------ 播放器
function embedUrl(v) {
  if (v.platform === 'youtube') {
    const host = db.settings.ytLoggedIn ? 'https://www.youtube.com' : 'https://www.youtube-nocookie.com';
    const hl = db.settings.lang === 'zh' ? 'zh-CN' : 'en';
    return `${host}/embed/${v.vid}?autoplay=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&fs=0&enablejsapi=1&hl=${hl}&origin=${encodeURIComponent(location.origin)}`;
  }
  if (v.platform === 'bilibili' && v.playType === 'iframe')
    return `https://player.bilibili.com/player.html?${v.vid.startsWith('av') ? 'aid=' + v.vid.slice(2) : 'bvid=' + v.vid}&page=${v.page || 1}&autoplay=1&danmaku=0&high_quality=1`;
  return v.embed;
}

// 透明遮罩：挡住播放器中会跳转到原网站的 Logo / 标题区域
const SHIELDS = {
  youtube: ['top', 'yt-logo'],
  bilibili: ['top'],
  default: ['top'],
};

function mountIframe(box, v) {
  const s = db.settings;
  box.innerHTML = `<iframe src="${esc(embedUrl(v))}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      referrerpolicy="strict-origin-when-cross-origin" ${s.sandbox ? 'sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"' : ''}></iframe>
    ${s.shield ? (SHIELDS[v.platform] || SHIELDS.default).map((c) => `<div class="shield ${c}"></div>`).join('') : ''}`;
  if (v.platform === 'youtube') return watchYouTube(box);
}

// YouTube IFrame API（postMessage）：暂停/结束时遮住"更多视频"推荐
function watchYouTube(box) {
  const iframe = $('iframe', box);
  const cover = document.createElement('div');
  cover.className = 'yt-cover';
  cover.hidden = true;
  box.appendChild(cover);
  const cmd = (func, args = []) => iframe.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  const listen = () => iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
  iframe.addEventListener('load', () => { listen(); setTimeout(listen, 800); });
  const show = (state) => {
    if (state === 0) {
      cover.innerHTML = `<div class="ended"><div class="big">🎉</div><div>${t('ended')}</div><button class="btn primary" data-a="replay">${t('replay')}</button><a class="btn" href="#/">${t('back')}</a></div>`;
      cover.hidden = false;
    } else if (state === 2) {
      cover.innerHTML = `<button class="play-big" data-a="play" aria-label="play">▶</button>`;
      cover.hidden = false;
    } else if (state === 1 || state === 3) cover.hidden = true;
  };
  cover.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'replay') { cmd('seekTo', [0, true]); cmd('playVideo'); cover.hidden = true; }
    if (a === 'play' || e.target === cover) { cmd('playVideo'); cover.hidden = true; }
  };
  const onMsg = (e) => {
    if (e.source !== iframe.contentWindow) return;
    let d;
    try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    if (d?.event === 'onStateChange') show(d.info);
    else if (d?.event === 'infoDelivery' && typeof d.info?.playerState === 'number') show(d.info.playerState);
  };
  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
}

function openExternal(url, w = 1100, h = 720) {
  window.open(url, 'kidstube_ext', `popup,width=${w},height=${h}`);
}

async function mountPlayer(box, v) {
  if (v.playType === 'iframe') return mountIframe(box, v);
  if (v.playType === 'external') {
    box.innerHTML = `<div class="msg"><div style="font-size:48px">🪟</div><div>${t('extNeed')}</div><button class="btn primary" id="ext">${t('extOpen')}</button></div>`;
    $('#ext', box).onclick = () => openExternal(v.url);
    return;
  }
  // 'video' 直链 或 'xhs' 小红书（每次播放重新解析，因为视频地址会过期）
  box.innerHTML = `<div class="msg"><div class="spin"></div><div>${t('loading')}</div></div>`;
  let src = v.src, blobUrl = null;
  if (v.playType === 'xhs') {
    // 小红书视频服务器校验来源，网页无法直接播放：由助手下载后在本地播放
    try {
      if (!R.hasHelper()) throw new Error('no helper');
      const buf = await R.download(await R.xhsStream(v.url), R.XHS_HEADERS);
      src = blobUrl = URL.createObjectURL(new Blob([buf], { type: 'video/mp4' }));
    } catch { src = null; }
    if (!box.isConnected) { if (blobUrl) URL.revokeObjectURL(blobUrl); return; }
    if (!src) {
      box.innerHTML = `<div class="msg"><div>${t('xhsFail')}</div><div style="opacity:.7;font-size:13px">${t('xhsFailHint')}</div><button class="btn primary" id="ext">${t('xhsOpen')}</button></div>`;
      $('#ext', box).onclick = () => openExternal(v.url, 520, 900);
      return;
    }
  }
  box.innerHTML = `<video controls autoplay playsinline controlslist="nodownload" ${v.thumb ? `poster="${esc(v.thumb)}"` : ''}></video>`;
  const video = $('video', box);
  video.addEventListener('loadedmetadata', () => box.classList.toggle('portrait', video.videoHeight > video.videoWidth));
  if (/\.m3u8(\?|$)/i.test(src) && !video.canPlayType('application/vnd.apple.mpegurl')) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js');
    const hls = new window.Hls();
    hls.loadSource(src);
    hls.attachMedia(video);
  } else video.src = src;
  return () => blobUrl && URL.revokeObjectURL(blobUrl);
}
function loadScript(src) {
  return new Promise((ok, fail) => {
    if ([...document.scripts].some((s) => s.src === src)) return ok();
    const s = Object.assign(document.createElement('script'), { src, onload: ok, onerror: fail });
    document.head.appendChild(s);
  });
}

// ------------------------------------------------------------ 播放页
function renderRest() {
  app.innerHTML = topbar() + `<main class="wrap rest"><div class="big">🌙</div><h1>${t('restTitle')}</h1><p class="hint">${t('restBody')}</p>
    <button class="btn" id="more">${t('restMore')}</button></main>`;
  bindTopbar();
  $('#more').onclick = async () => {
    if (!(await pinDialog({ title: t('pinVerifyTitle'), sub: t('restVerify') }))) return;
    usage().bonus = (usage().bonus || 0) + 15 * 60;
    save();
    route();
  };
}

function renderWatch(id) {
  const v = db.videos.find((x) => x.id === id);
  if (!v) { location.hash = '#/'; return; }
  if (usage().sec >= limitSec()) return renderRest();
  document.title = v.title + ' · KidsTube';
  const more = db.videos.filter((x) => x.id !== v.id && x.group === v.group).concat(db.videos.filter((x) => x.group !== v.group)).slice(0, 12);
  app.innerHTML =
    topbar() +
    `<main class="wrap watch">
      <section>
        <div class="player" id="player"></div>
        <h1>${esc(v.title)}</h1>
        <div class="meta">${esc(v.author || '')} · ${esc(platName(v.platform))}</div>
        <div class="player-bar"><a class="btn" href="#/">${t('back')}</a><button class="btn" id="fs">${t('fullscreen')}</button></div>
      </section>
      <aside class="side">${more.map(videoCard).join('')}</aside>
    </main>`;
  bindTopbar();
  const box = $('#player');
  let unmount;
  Promise.resolve(mountPlayer(box, v)).then((fn) => (unmount = fn));
  // iPhone Safari 不支持对普通元素全屏，改用铺满屏幕的"伪全屏"（并提示横屏）
  const exitPseudo = () => { box.classList.remove('pseudo-fs'); document.body.classList.remove('no-scroll'); };
  $('#fs').onclick = () => {
    const req = box.requestFullscreen || box.webkitRequestFullscreen;
    if (req) return Promise.resolve(req.call(box)).catch(() => {});
    box.classList.add('pseudo-fs');
    document.body.classList.add('no-scroll');
    if (!$('.fs-exit', box)) {
      const b = Object.assign(document.createElement('button'), { className: 'fs-exit', textContent: '✕', ariaLabel: 'exit fullscreen' });
      b.onclick = exitPseudo;
      box.appendChild(b);
    }
  };

  // 观看计时（页面可见时累计）
  const timer = setInterval(() => {
    if (document.hidden) return;
    usage().sec++;
    if (usage().sec % 10 === 0) save();
    if (usage().sec >= limitSec()) {
      save();
      clearInterval(timer);
      if (document.fullscreenElement) document.exitFullscreen();
      unmount?.();
      renderRest();
    }
  }, 1000);
  cleanup = () => { clearInterval(timer); unmount?.(); exitPseudo(); save(); };
}

// ------------------------------------------------------------ 家长后台
const TABS = ['add', 'library', 'accounts', 'settings'];
const TAB_LABEL = { add: 'tabAdd', library: 'tabLibrary', accounts: 'tabAccounts', settings: 'tabSettings' };
function renderParent(tab) {
  if (!TABS.includes(tab)) tab = 'add';
  app.innerHTML = `<header class="topbar"><a class="logo" href="#/"><img src="icon.svg" alt=""><span>Kids<b>Tube</b></span></a><span class="badge">${t('parentArea')}</span>
      <div class="spacer"></div>${langBtn()}<button class="btn primary" id="exit">${t('exitKids')}</button></header>
    <main class="wrap admin">
      <nav class="nav">${TABS.map((k) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${t(TAB_LABEL[k])}</button>`).join('')}</nav>
      <section id="pane"></section>
    </main>`;
  bindLangBtn();
  $('#exit').onclick = () => { parentUnlocked = false; location.hash = '#/'; };
  app.querySelectorAll('.nav button').forEach((b) => (b.onclick = () => (location.hash = '#/parent/' + b.dataset.t)));
  ({ add: paneAdd, library: paneLibrary, accounts: paneAccounts, settings: paneSettings })[tab]($('#pane'));
}

const groupOptions = (val) => db.groups.map((g) => `<option ${g === val ? 'selected' : ''}>${esc(g)}</option>`).join('') + `<option value="__new">${t('newGroup')}</option>`;
function bindGroupSelect(sel) {
  sel.addEventListener('change', () => {
    if (sel.value !== '__new') return;
    const name = prompt(t('newGroupPrompt'))?.trim();
    if (name && !db.groups.includes(name)) { db.groups.push(name); save(); }
    sel.innerHTML = groupOptions(name || db.groups[0]);
  });
}
const exists = (v) => db.videos.some((x) => x.platform === v.platform && x.vid === v.vid && (x.page || 1) === (v.page || 1));
function addVideos(list, group) {
  let n = 0;
  for (const v of list) {
    if (exists(v)) continue;
    db.videos.unshift({ ...v, src: v.playType === 'xhs' ? undefined : v.src, id: uid(), group, addedAt: Date.now() });
    n++;
  }
  save();
  return n;
}

let lastGroup = null;
function paneAdd(el) {
  el.innerHTML = `<div class="panel">
    <h2>${t('addTitle')}</h2>
    <p class="hint">${t('addHint')}</p>
    <div class="row"><input class="field grow" id="url" placeholder="${t('addPlaceholder')}" autocomplete="off">
      <select class="field" id="grp" style="width:auto">${groupOptions(lastGroup || db.groups[0])}</select><button class="btn primary" id="go">${t('parse')}</button></div>
    <div class="platforms">${['youtube', 'bilibili', 'xiaohongshu', 'douyin', 'qq', 'youku', 'ixigua', 'vimeo', 'tiktok', 'iqiyi'].map((p) => `<span class="plat-${p}">${esc(platName(p))}</span>`).join('')}<span class="plat-other">${t('directLink')}</span></div>
    <div id="helper-tip"></div><div id="result"></div></div>`;
  bindGroupSelect($('#grp'));
  detectHelper().then((v) => {
    const tip = $('#helper-tip');
    if (tip && !v) tip.innerHTML = `<p class="warn" style="margin-top:14px">${t('helperMissingTip')} <a href="#/parent/accounts">${t('helperSetup')}</a></p>`;
  });
  const go = async () => {
    const url = $('#url').value.trim();
    if (!url) return;
    const out = $('#result');
    out.innerHTML = `<div class="row" style="margin-top:20px"><div class="spin dark"></div>${t('parsing')}</div>`;
    try {
      const data = await api({ url });
      if (data.kind === 'video') showSingle(out, data.video, data.manual);
      else showCreator(out, url, data);
    } catch (e) {
      out.innerHTML = `<p class="warn" style="margin-top:16px">${t('parseFail')}${esc(errText(e))}</p>`;
    }
  };
  $('#go').onclick = go;
  $('#url').onkeydown = (e) => e.key === 'Enter' && go();
}

function showSingle(out, v, manual) {
  const warn = v.playType === 'external' ? `<p class="warn">${t('extWarn')}</p>`
    : v.platform === 'xiaohongshu' && v.isVideo === false ? `<p class="warn">${t('notVideoNote')}</p>` : '';
  const has = exists(v);
  out.innerHTML = `<div class="single">
      <div class="thumb">${thumbImg(v)}</div>
      <div class="grow"><div style="font-weight:700;font-size:17px">${esc(v.title || platName(v.platform) + ' · ' + v.vid)}</div>
      <div class="hint">${esc(v.author || '')} · ${esc(platName(v.platform))}${v.duration ? ' · ' + esc(v.duration) : ''}</div>
      ${warn}${manual ? `<p class="hint">${t('manualHint')}</p>` : ''}
      <input class="field" id="title" value="${esc(v.title)}" placeholder="${t('titlePlaceholder')}" style="margin-bottom:10px" title="${t('editTitle')}">
      <button class="btn primary" id="add" ${has ? 'disabled' : ''}>${has ? t('inLib') : t('addToLib')}</button></div></div>`;
  if (manual) $('#title').focus();
  $('#add').onclick = () => {
    const title = $('#title').value.trim() || v.title;
    if (!title) { toast(t('titleRequired')); return $('#title').focus(); }
    lastGroup = $('#grp').value;
    addVideos([{ ...v, title }], lastGroup);
    toast(t('added'));
    $('#add').disabled = true;
    $('#add').textContent = t('inLib');
    $('#url').value = '';
  };
}

function showCreator(out, url, data) {
  const items = [...data.videos];
  const chosen = new Set();
  let next = data.next, loading = false;
  out.innerHTML = `<h3>${esc(t('creatorVideos', data.author))} <span class="badge" id="cnt"></span></h3>
    ${data.noteCode ? `<p class="hint">${esc(L().err[data.noteCode] || '')}</p>` : ''}
    <div class="row"><button class="btn small" id="all">${t('selectAll')}</button><button class="btn small" id="none">${t('selectNone')}</button>
      <input class="field grow" id="filter" placeholder="${t('filter')}" style="padding:8px 12px">
      <button class="btn small" id="more">${t('loadMore')}</button><button class="btn small" id="loadall">${t('loadAll')}</button></div>
    <div class="pick-grid" id="picks"></div>
    <div class="sticky-actions row"><span class="hint" style="margin:0" id="sel"></span><div class="spacer"></div><button class="btn primary" id="addsel">${t('addSelected')}</button></div>`;
  const ft = () => $('#filter').value.trim().toLowerCase();
  const visible = () => items.filter((v) => !ft() || v.title.toLowerCase().includes(ft()));
  const draw = () => {
    $('#picks').innerHTML = visible().map((v) => {
      const added = exists(v), on = chosen.has(v.vid);
      return `<div class="pick ${on ? 'on' : ''} ${added ? 'added' : ''}" data-vid="${esc(v.vid)}">
        <div class="thumb">${thumbImg(v)}${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ''}</div>
        <span class="check">${added || on ? '✓' : ''}</span><div class="title">${added ? t('addedTag') : ''}${esc(v.title)}</div></div>`;
    }).join('');
    $('#cnt').textContent = t('loaded', items.length, data.total);
    $('#sel').textContent = t('selected', chosen.size);
    $('#more').style.display = $('#loadall').style.display = next ? '' : 'none';
  };
  const loadMore = async () => {
    if (!next || loading) return false;
    loading = true;
    $('#more').textContent = t('loadingMore');
    try {
      const d = await api({ url, cursor: next });
      const seen = new Set(items.map((v) => v.vid));
      d.videos.forEach((v) => !seen.has(v.vid) && items.push(v));
      next = d.next;
    } catch (e) {
      toast(t('loadFail') + errText(e));
      next = null;
    }
    loading = false;
    $('#more').textContent = t('loadMore');
    draw();
    return true;
  };
  $('#picks').onclick = (e) => {
    const p = e.target.closest('.pick');
    if (!p || p.classList.contains('added')) return;
    chosen.has(p.dataset.vid) ? chosen.delete(p.dataset.vid) : chosen.add(p.dataset.vid);
    draw();
  };
  $('#all').onclick = () => { visible().forEach((v) => !exists(v) && chosen.add(v.vid)); draw(); };
  $('#none').onclick = () => { chosen.clear(); draw(); };
  $('#filter').oninput = draw;
  $('#more').onclick = loadMore;
  $('#loadall').onclick = async () => {
    // 每页间隔 1 秒，避免触发视频网站的频率限制
    while (next && (await loadMore())) await new Promise((r) => setTimeout(r, 1000));
    toast(t('allLoaded'));
  };
  $('#addsel').onclick = () => {
    if (!chosen.size) return toast(t('pickFirst'));
    lastGroup = $('#grp').value;
    const n = addVideos(items.filter((v) => chosen.has(v.vid)), lastGroup);
    chosen.clear();
    draw();
    toast(t('addedN', n, lastGroup));
  };
  draw();
}

function paneLibrary(el) {
  let q = '';
  const draw = () => {
    const list = db.videos.filter((v) => !q || (v.title + v.author + v.group).toLowerCase().includes(q));
    $('#libbody').innerHTML = list.map((v) => `<tr data-id="${v.id}">
      <td style="width:120px">${v.thumb ? `<img src="${esc(v.thumb)}" referrerpolicy="no-referrer" loading="lazy" alt="">` : ''}</td>
      <td><div class="t" contenteditable="true" data-f="title" title="${t('editTitle')}">${esc(v.title)}</div>
        <div class="s">${esc(v.author || '')} · ${esc(platName(v.platform))} · <a href="${esc(v.url)}" target="_blank" rel="noopener">${t('original')}</a></div></td>
      <td><select data-f="group">${db.groups.map((g) => `<option ${g === v.group ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></td>
      <td><button class="btn danger small" data-del>${t('del')}</button></td></tr>`).join('') || `<tr><td colspan="4" class="hint">${t('noVideos')}</td></tr>`;
  };
  el.innerHTML = `<div class="panel"><h2>${t('libTitle')} <span class="badge">${t('libCount', db.videos.length)}</span></h2>
    <p class="hint">${t('libHint')}</p>
    <div class="row" style="margin-bottom:10px"><input class="field grow" id="lq" placeholder="${t('libSearch')}">
      <button class="btn small" id="newg">${t('manageGroups')}</button><button class="btn danger small" id="delall">${t('clearAll')}</button></div>
    <div class="table-wrap"><table class="lib"><tbody id="libbody"></tbody></table></div></div>`;
  draw();
  const byRow = (e) => db.videos.find((x) => x.id === e.target.closest('tr')?.dataset.id);
  $('#lq').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  $('#libbody').addEventListener('change', (e) => {
    if (e.target.dataset.f !== 'group') return;
    const v = byRow(e);
    v.group = e.target.value;
    save();
    toast(t('movedTo', v.group));
  });
  $('#libbody').addEventListener('focusout', (e) => {
    if (e.target.dataset.f !== 'title') return;
    const v = byRow(e), title = e.target.textContent.trim();
    if (title && title !== v.title) { v.title = title; save(); toast(t('titleUpdated')); }
  });
  $('#libbody').addEventListener('click', (e) => {
    if (!e.target.matches('[data-del]')) return;
    const id = e.target.closest('tr').dataset.id;
    db.videos = db.videos.filter((x) => x.id !== id);
    save();
    draw();
  });
  $('#delall').onclick = () => { if (confirm(t('clearConfirm'))) { db.videos = []; save(); draw(); } };
  $('#newg').onclick = () => {
    const txt = prompt(t('groupsPrompt'), db.groups.join(db.settings.lang === 'zh' ? '，' : ', '));
    if (txt == null) return;
    const gs = [...new Set(txt.split(/[,，]/).map((s) => s.trim()).filter(Boolean))];
    if (!gs.length) return;
    db.groups = gs;
    db.videos.forEach((v) => !gs.includes(v.group) && (v.group = gs[0]));
    save();
    paneLibrary(el);
  };
}

const LOGINS = [
  { key: 'youtube', url: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F', color: '#ff0033' },
  { key: 'bilibili', url: 'https://passport.bilibili.com/login', color: '#fb7299' },
  { key: 'xiaohongshu', url: 'https://www.xiaohongshu.com/explore', color: '#ff2442' },
  { key: 'douyin', url: 'https://www.douyin.com/', color: '#111' },
  { key: 'qq', url: 'https://v.qq.com/', color: '#ff6a00' },
  { key: 'youku', url: 'https://www.youku.com/', color: '#1f8cff' },
  { key: 'iqiyi', url: 'https://www.iqiyi.com/', color: '#00be06' },
];
function paneAccounts(el) {
  const s = db.settings, ver = helperVersion();
  el.innerHTML = `<div class="panel"><h2>${t('helperTitle')} <span class="badge ${ver ? 'ok' : ''}">${ver ? t('helperOn', ver) : t('helperOff')}</span></h2>
    <p class="hint">${t('helperIntro')}</p>
    <div class="row" style="margin-bottom:12px"><a class="btn primary" href="kidstube-helper.user.js" target="_blank" rel="noopener">${t('helperInstall')}</a>
      <button class="btn small" id="recheck">${t('helperRecheck')}</button></div>
    <div class="steps">${t('helperSteps')}</div>
    <p class="hint">${t('helperPrivacy')}</p></div>

    <div class="panel"><h2>${t('accTitle')}</h2>
    <p class="hint">${t('accHint')}</p>
    <p class="warn">${t('accWarn')}</p>
    <div class="login-list">${LOGINS.map((p) => `<div class="login-item">
      <div class="name"><span class="dot" style="background:${p.color}"></span>${esc(platName(p.key))}</div>
      <div class="hint" style="margin:0 0 10px">${t('note_' + p.key)}</div>
      <button class="btn small" data-login="${p.url}">${t('openLogin')}</button></div>`).join('')}</div>

    <h3>${t('ytSettings')}</h3>
    <label class="inline"><input type="checkbox" id="ytlogin" ${s.ytLoggedIn ? 'checked' : ''}> ${t('ytLogin')}</label>
    <p class="hint">${t('ytLoginHint')}</p>
    <label>${t('ytKey')}</label>
    <input class="field" id="ytkey" value="${esc(s.ytKey)}" placeholder="AIza…" style="margin:6px 0" autocomplete="off">
    <p class="hint">${t('ytKeyHint')}</p>
    <div class="row" style="margin-top:14px"><button class="btn primary" id="save">${t('save')}</button></div></div>`;
  el.querySelectorAll('[data-login]').forEach((b) => (b.onclick = () => window.open(b.dataset.login, '_blank', 'popup,width=1000,height=760')));
  $('#recheck').onclick = () => location.reload();
  $('#save').onclick = () => {
    s.ytLoggedIn = $('#ytlogin').checked;
    s.ytKey = $('#ytkey').value.trim();
    save();
    toast(t('saved'));
  };
}

function paneSettings(el) {
  const s = db.settings, u = usage();
  el.innerHTML = `
    <div class="panel"><h2>${t('langTitle')}</h2>
      <div class="row">${Object.entries(DICT).map(([k, d]) => `<button class="chip ${k === s.lang ? 'on' : ''}" data-lang="${k}">${d.langName}</button>`).join('')}</div></div>
    <div class="panel"><h2>${t('setTitle')}</h2>
      <label>${t('dailyLimit')}</label>
      <div class="row" style="margin:6px 0 4px"><input class="field" type="number" min="0" step="5" id="limit" value="${s.dailyLimit}" style="width:140px">
        <span class="hint" style="margin:0">${t('watchedToday', Math.floor(u.sec / 60))}</span><button class="btn small" id="reset">${t('resetToday')}</button></div>
      <h3>${t('lockTitle')}</h3>
      <label class="inline"><input type="checkbox" id="shield" ${s.shield ? 'checked' : ''}> ${t('shield')}</label>
      <p class="hint">${t('shieldHint')}</p>
      <label class="inline"><input type="checkbox" id="sandbox" ${s.sandbox ? 'checked' : ''}> ${t('sandbox')}</label>
      <p class="hint">${t('sandboxHint')}</p>
      <button class="btn primary" id="save">${t('save')}</button></div>
    <div class="panel"><h2>${t('pinTitle')}</h2><button class="btn" id="pin">${t('changePin')}</button></div>
    <div class="panel"><h2>${t('backupTitle')}</h2>
      <p class="hint">${t('backupHint')}</p>
      <div class="row"><button class="btn" id="exp">${t('exportBtn')}</button><label class="btn">${t('importBtn')}<input type="file" id="imp" accept=".json" hidden></label></div></div>`;
  el.querySelectorAll('[data-lang]').forEach((b) => (b.onclick = () => { setLang(b.dataset.lang); route(); }));
  $('#save').onclick = () => {
    s.dailyLimit = Math.max(0, Number($('#limit').value) || 0);
    s.shield = $('#shield').checked;
    s.sandbox = $('#sandbox').checked;
    save();
    toast(t('saved'));
  };
  $('#reset').onclick = () => { db.usage = { date: today(), sec: 0, bonus: 0 }; save(); paneSettings(el); };
  $('#pin').onclick = async () => {
    const pin = await pinDialog({ title: t('pinNewTitle'), sub: t('pinNewSub'), mode: 'set' });
    if (pin) { s.pinHash = await sha(pin); save(); toast(t('pinChanged')); }
  };
  $('#exp').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'KidsTube', version: 1, groups: db.groups, videos: db.videos }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `kidstube-backup-${today()}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('#imp').onchange = async (e) => {
    try {
      const d = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(d.videos)) throw new Error();
      d.groups?.forEach((g) => !db.groups.includes(g) && db.groups.push(g));
      let n = 0;
      d.videos.forEach((v) => { if (v.vid && v.platform && !exists(v)) { db.videos.push({ ...v, id: v.id || uid() }); n++; } });
      save();
      toast(t('importedN', n));
    } catch { toast(t('badFile')); }
  };
}

route();
