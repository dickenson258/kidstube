// KidsTube 前端 —— 所有数据只保存在本浏览器 localStorage，不上传任何服务器
import { DICT } from './i18n.js';
import * as R from './resolver.js';
import { detectHelper, onHelper, helperRequest, helperVersion, pingHelper } from './bridge.js';

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
    settings: { lang: browserLang, pinHash: '', ytKey: '', ytLoggedIn: false, shield: true, sandbox: false, dailyLimit: 0, autoplayNext: true, biliNative: true, sandboxSites: { youtube: true, youku: true }, sandboxYoukuDefault: 1 },
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
// 内嵌 SVG 图标：不依赖设备是否有 emoji 字体
const svg = (body, size = 24) => `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  lock: (n) => svg('<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>', n),
  search: (n) => svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', n),
  tv: (n) => svg('<rect x="3" y="6" width="18" height="13" rx="3"/><path d="m8 2 4 4 4-4"/><path d="m10.5 10 4 2.5-4 2.5z" fill="currentColor"/>', n),
  moon: (n) => svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>', n),
  star: (n) => svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>', n),
  folder: (n) => svg('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>', n),
  window: (n) => svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18"/><path d="M14 13h4v4"/><path d="m18 13-5 5"/>', n),
};
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
  if (page === 'series') return renderSeries(decodeURIComponent(arg || ''));
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
    <button class="btn icon-btn" id="parent-btn" title="${t('parentArea')}" aria-label="${t('parentArea')}">${ICON.lock(20)}</button>
  </header>`;
}
function bindTopbar() {
  bindLangBtn();
  $('#parent-btn').onclick = () => unlockParent().then((ok) => ok && (location.hash = '#/parent/add'));
}

// ------------------------------------------------------------ 儿童首页
let homeGroup = ALL, homeCreator = ALL, homeQuery = '';
// 博主标识：优先用博主主页地址，没有时用"平台+名字"
const creatorKey = (v) => v.authorUrl || `${v.platform}:${v.author || ''}`;
function creatorsOf(list) {
  const map = new Map();
  for (const v of list) {
    if (!v.author) continue;
    const k = creatorKey(v);
    const c = map.get(k) || { key: k, name: v.author, count: 0 };
    c.count++;
    map.set(k, c);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
// ---------- 合集：每个视频可带 series = { id, title, index }
// 已停止支持的网站（不适合孩子 / 网页版无法观看）：库里旧的视频不在孩子模式里出现，家长可在视频库中删除
const RETIRED = new Set(['douyin', 'xiaohongshu']);
const kidVideos = () => db.videos.filter((v) => !RETIRED.has(v.platform));
const seriesEps = (id) => kidVideos().filter((x) => x.series?.id === id).sort((a, b) => a.series.index - b.series.index);
const epNo = (v) => seriesEps(v.series.id).findIndex((x) => x.id === v.id) + 1;
function nextEpisode(v) {
  if (!v.series) return null;
  const eps = seriesEps(v.series.id);
  const i = eps.findIndex((x) => x.id === v.id);
  return i >= 0 ? eps[i + 1] || null : null;
}
const durSec = (d) => String(d || '').split(':').reduce((a, b) => a * 60 + (Number(b) || 0), 0);

function videoCard(v, { ep, current } = {}) {
  return `<a class="card ${current ? 'current' : ''}" href="#/watch/${v.id}">
    <div class="thumb">${thumbImg(v)}<span class="plat plat-${v.platform}">${esc(platName(v.platform))}</span>${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ''}</div>
    <div class="body"><div class="title">${esc(v.title)}</div><div class="sub">${ep ? `<b class="ep-tag">${t('epN', ep)}</b> ` : ''}${esc(v.author || '')}</div></div></a>`;
}
function seriesCard(series, eps) {
  const first = eps[0];
  return `<a class="card stack" href="#/series/${encodeURIComponent(series.id)}">
    <div class="thumb">${thumbImg(first)}<span class="plat plat-series">${ICON.folder(12)} ${t('collection')}</span><span class="dur">${t('episodesN', eps.length)}</span></div>
    <div class="body"><div class="title">${esc(series.title)}</div><div class="sub">${esc(first.author || '')}</div></div></a>`;
}
// 首页：同一合集的视频合并成一张"合集"卡片（搜索时不合并，直接列出匹配的视频）
function homeCards(list, merge) {
  if (!merge) return list.map((v) => videoCard(v)).join('');
  const done = new Set();
  return list.map((v) => {
    if (!v.series) return videoCard(v);
    if (done.has(v.series.id)) return '';
    const eps = list.filter((x) => x.series?.id === v.series.id).sort((a, b) => a.series.index - b.series.index);
    if (eps.length < 2) return videoCard(v);
    done.add(v.series.id);
    return seriesCard(v.series, eps);
  }).join('');
}
function renderHome() {
  const groups = db.groups.filter((g) => kidVideos().some((v) => v.group === g));
  if (homeGroup !== ALL && !groups.includes(homeGroup)) homeGroup = ALL;
  const q = homeQuery.toLowerCase();
  const inGroup = kidVideos().filter((v) => homeGroup === ALL || v.group === homeGroup);
  const creators = creatorsOf(inGroup);
  if (homeCreator !== ALL && !creators.some((c) => c.key === homeCreator)) homeCreator = ALL;
  const list = inGroup
    .filter((v) => homeCreator === ALL || creatorKey(v) === homeCreator)
    .filter((v) => !q || (v.title + v.author).toLowerCase().includes(q));
  app.innerHTML =
    topbar(`<input class="search" id="q" placeholder="${t('search')}" value="${esc(homeQuery)}">`) +
    `<main class="wrap">
      ${kidVideos().length ? `<div class="chips">${[ALL, ...groups].map((g) => `<button class="chip ${g === homeGroup ? 'on' : ''}" data-g="${esc(g)}">${esc(g === ALL ? t('all') : g)}</button>`).join('')}</div>` : ''}
      ${creators.length > 1 ? `<div class="chips sub">${[{ key: ALL, name: t('allCreators') }, ...creators].map((c) => `<button class="chip folder ${c.key === homeCreator ? 'on' : ''}" data-c="${esc(c.key)}">${ICON.folder(16)}<span>${esc(c.name)}</span>${c.count ? `<em>${c.count}</em>` : ''}</button>`).join('')}</div>` : ''}
      ${list.length ? `<div class="grid">${homeCards(list, !q)}</div>`
        : kidVideos().length ? `<div class="empty"><div class="big">${ICON.search(64)}</div><h2>${t('notFound')}</h2></div>`
        : `<div class="empty"><div class="big">${ICON.tv(72)}</div><h2>${t('emptyTitle')}</h2><p>${t('emptyBody')}</p></div>`}
    </main>`;
  bindTopbar();
  app.querySelectorAll('.chip[data-g]').forEach((c) => (c.onclick = () => { homeGroup = c.dataset.g; homeCreator = ALL; renderHome(); }));
  app.querySelectorAll('.chip[data-c]').forEach((c) => (c.onclick = () => { homeCreator = c.dataset.c; renderHome(); }));
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

function renderSeries(id) {
  const eps = seriesEps(id);
  if (!eps.length) { location.hash = '#/'; return; }
  const ser = eps[0].series;
  document.title = ser.title + ' · KidsTube';
  app.innerHTML = topbar() + `<main class="wrap">
      <div class="series-head"><a class="btn" href="#/">${t('back')}</a>
        <div><h1>${esc(ser.title)}</h1><div class="hint" style="margin:0">${esc(eps[0].author || '')} · ${t('episodesN', eps.length)}</div></div></div>
      <div class="grid">${eps.map((v, i) => videoCard(v, { ep: i + 1 })).join('')}</div>
    </main>`;
  bindTopbar();
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

// 每个网站单独设置是否用沙箱；默认只有 YouTube 开启（旧版的"全部开启"选项迁移为每个网站都开）
const SANDBOX_SITES = ['youtube', 'bilibili', 'qq', 'youku', 'ixigua', 'vimeo', 'tiktok', 'dailymotion', 'other'];
function sandboxOn(platform) {
  const s = db.settings;
  if (!s.sandboxSites) s.sandboxSites = s.sandbox ? Object.fromEntries(SANDBOX_SITES.map((p) => [p, true])) : { youtube: true };
  // 优酷底部控制栏里的标志 / "去优酷"等按钮会跳出去，所以优酷也默认开启（老用户迁移一次）
  if (!s.sandboxYoukuDefault) { s.sandboxSites.youku = true; s.sandboxYoukuDefault = 1; save(); }
  const key = SANDBOX_SITES.includes(platform) ? platform : 'other';
  return s.sandboxSites[key] ?? (key === 'youtube' || key === 'youku');
}
function mountIframe(box, v, onEnded) {
  const s = db.settings;
  // 沙箱（不含 allow-popups / allow-top-navigation）：播放器里指向外网的链接、"在 YouTube 上观看"、推荐卡片等
  // 都无法打开新页面或跳转，点击没有反应。YouTube 在沙箱里能正常播放，所以始终开启；其他网站按设置
  const sandboxed = sandboxOn(v.platform);
  // 有沙箱时外链本来就打不开，不再加透明遮挡（否则会挡住 YouTube 卡片列表的关闭按钮等正常操作）
  box.innerHTML = `<iframe src="${esc(embedUrl(v))}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture; storage-access"
      referrerpolicy="strict-origin-when-cross-origin" ${sandboxed ? 'sandbox="allow-scripts allow-same-origin allow-presentation allow-storage-access-by-user-activation"' : ''}></iframe>
    ${s.shield && !sandboxed ? (SHIELDS[v.platform] || SHIELDS.default).map((c) => `<div class="shield ${c}"></div>`).join('') : ''}`;
  if (v.platform === 'youtube') return watchYouTube(box, onEnded);
}

// YouTube IFrame API（postMessage）：暂停/结束时遮住"更多视频"推荐
function watchYouTube(box, onEnded) {
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
      if (onEnded?.()) { cover.hidden = true; return; } // 有下一集：交给倒计时
      cover.innerHTML = `<div class="ended"><div class="big">${ICON.star(56)}</div><div>${t('ended')}</div><div class="row"><button class="btn primary" data-a="replay">${t('replay')}</button><a class="btn" href="#/">${t('back')}</a></div></div>`;
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
  let lastState = null;
  const onMsg = (e) => {
    if (e.source !== iframe.contentWindow) return;
    let d;
    try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    const state = d?.event === 'onStateChange' ? d.info : d?.event === 'infoDelivery' && typeof d.info?.playerState === 'number' ? d.info.playerState : null;
    if (state === null) return;
    show(state);
    if (state !== lastState) { lastState = state; box.dispatchEvent(new Event('kt-state')); }
  };
  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
}

function openExternal(url, w = 1100, h = 720) {
  window.open(url, 'kidstube_ext', `popup,width=${w},height=${h}`);
}

async function mountPlayer(box, v, onEnded) {
  // B 站：装了助手就用 KidsTube 自己的播放器（手机 Firefox 也能播、没有 B 站推荐、能自动播放下一集），取不到再用嵌入播放器
  if (v.platform === 'bilibili' && v.playType === 'iframe' && db.settings.biliNative !== false) {
    box.innerHTML = `<div class="msg"><div class="spin"></div><div>${t('loading')}</div></div>`;
    let src = null;
    try { if (await detectHelper(1500)) src = await R.biliStream(v); } catch {}
    if (!box.isConnected) return;
    if (src) return mountVideo(box, v, src, onEnded, () => mountIframe(box, v, onEnded));
  }
  if (v.playType === 'iframe') return mountIframe(box, v, onEnded);
  if (v.playType === 'external') {
    box.innerHTML = `<div class="msg"><div>${ICON.window(48)}</div><div>${t('extNeed')}</div><button class="btn primary" id="ext">${t('extOpen')}</button></div>`;
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
  const done = mountVideo(box, v, src, onEnded);
  return () => { done?.(); if (blobUrl) URL.revokeObjectURL(blobUrl); };
}

// onFail：视频还没开始播放就出错（如地址过期、被拒绝）时调用，用来退回嵌入播放器
function mountVideo(box, v, src, onEnded, onFail) {
  box.innerHTML = `<video controls autoplay playsinline controlslist="nodownload" referrerpolicy="no-referrer" ${v.thumb ? `poster="${esc(v.thumb)}"` : ''}></video>`;
  const video = $('video', box);
  let played = false;
  video.addEventListener('loadedmetadata', () => box.classList.toggle('portrait', video.videoHeight > video.videoWidth));
  video.addEventListener('playing', () => (played = true));
  video.addEventListener('ended', () => onEnded?.());
  if (onFail) video.addEventListener('error', () => { if (!played && box.isConnected) onFail(); });
  if (/\.m3u8(\?|$)/i.test(src) && !video.canPlayType('application/vnd.apple.mpegurl')) {
    let hls = null, gone = false;
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js').then(() => {
      if (gone) return;
      hls = new window.Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
    });
    return () => { gone = true; hls?.destroy(); };
  }
  video.src = src;
  return () => { video.removeAttribute('src'); video.load(); };
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
  app.innerHTML = topbar() + `<main class="wrap rest"><div class="big">${ICON.moon(88)}</div><h1>${t('restTitle')}</h1><p class="hint">${t('restBody')}</p>
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
  const v = kidVideos().find((x) => x.id === id);
  if (!v) { location.hash = '#/'; return; }
  if (usage().sec >= limitSec()) return renderRest();
  document.title = v.title + ' · KidsTube';
  const eps = v.series ? seriesEps(v.series.id) : [];
  const next = nextEpisode(v);
  const rank = (x) => (creatorKey(x) === creatorKey(v) ? 0 : x.group === v.group ? 1 : 2);
  const more = kidVideos().filter((x) => x.id !== v.id && !(v.series && x.series?.id === v.series.id)).sort((a, b) => rank(a) - rank(b)).slice(0, 12);
  app.innerHTML =
    topbar() +
    `<main class="wrap watch">
      <section>
        <div class="player" id="player"></div>
        <h1>${esc(v.title)}</h1>
        <div class="meta">${esc(v.author || '')} · ${esc(platName(v.platform))}${v.series ? ` · ${esc(v.series.title)} ${t('epOfN', epNo(v), eps.length)}` : ''}</div>
        <div class="player-bar"><a class="btn" href="#/">${t('back')}</a><button class="btn" id="fs">${t('fullscreen')}</button>
          ${next ? `<a class="btn primary" href="#/watch/${next.id}">${t('nextEp')} ▶</a>` : ''}</div>
      </section>
      <aside class="side">
        ${eps.length > 1 ? `<h3 class="side-title">${ICON.folder(16)} ${esc(v.series.title)}</h3>${eps.map((x, i) => videoCard(x, { ep: i + 1, current: x.id === v.id })).join('')}<h3 class="side-title">${t('moreVideos')}</h3>` : ''}
        ${more.map((x) => videoCard(x)).join('')}
      </aside>
    </main>`;
  bindTopbar();
  const box = $('#player');
  let unmount, countdown;
  // 播放结束：有下一集且开启了自动播放 → 5 秒倒计时（可取消）
  const onEnded = () => {
    if (!next || !db.settings.autoplayNext || $('.next-cover', box)) return false;
    let left = 5;
    const el = document.createElement('div');
    el.className = 'next-cover';
    el.innerHTML = `<div class="next-label">${t('nextEp')}</div><div class="next-title">${esc(next.title)}</div>
      <div class="next-count">${t('nextIn', left)}</div>
      <div class="row" style="justify-content:center"><a class="btn primary" href="#/watch/${next.id}">${t('playNow')}</a><button class="btn" data-a="cancel">${t('cancel')}</button></div>`;
    box.appendChild(el);
    countdown = setInterval(() => {
      left--;
      if (left <= 0) { clearInterval(countdown); location.hash = '#/watch/' + next.id; return; }
      $('.next-count', el).textContent = t('nextIn', left);
    }, 1000);
    $('[data-a="cancel"]', el).onclick = () => { clearInterval(countdown); el.remove(); };
    return true;
  };
  Promise.resolve(mountPlayer(box, v, onEnded)).then((fn) => (unmount = fn));
  // B 站播放器不会通知播放结束：按时长估算，快结束时只在底部提示"下一集"，不自动切换
  const estimate = v.platform === 'bilibili' && v.playType === 'iframe' && next ? durSec(v.duration) : 0;
  let watched = 0;
  // iPhone Safari 不支持对普通元素全屏，改用铺满屏幕的"伪全屏"（并提示横屏）
  const exitPseudo = () => { box.classList.remove('pseudo-fs'); document.body.classList.remove('no-scroll'); };
  // 全屏后锁定横屏（Android 上的 Firefox / Chrome 支持；手机开着"锁定竖屏"时也能横过来）。竖屏视频不锁。
  // Firefox 手机版在视频暂停时会自己把方向还原成竖屏，所以全屏期间一旦被转回竖屏、或播放器暂停/继续，就重新锁定
  const wantLandscape = () => document.fullscreenElement === box && !box.classList.contains('portrait');
  const relock = () => { if (wantLandscape()) screen.orientation?.lock?.('landscape').catch(() => {}); };
  const relockSoon = () => { relock(); setTimeout(relock, 300); setTimeout(relock, 1000); };
  const onFsChange = () => {
    const o = screen.orientation;
    if (!o) return;
    if (wantLandscape()) relock();
    else if (!document.fullscreenElement) { try { o.unlock?.(); } catch {} }
  };
  const onOrient = () => { if (wantLandscape() && screen.orientation.type.startsWith('portrait')) relock(); };
  document.addEventListener('fullscreenchange', onFsChange);
  screen.orientation?.addEventListener?.('change', onOrient);
  // 播放状态变化：自己的 <video>（pause / play 不冒泡，用捕获）和 YouTube 播放器（watchYouTube 发出 kt-state）
  ['pause', 'play', 'kt-state'].forEach((ev) => box.addEventListener(ev, relockSoon, true));
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
    if (estimate && $('iframe', box) && ++watched === estimate + 2 && !$('.next-hint', box)) {
      const hint = document.createElement('div');
      hint.className = 'next-hint';
      hint.innerHTML = `<span>${t('nextEp')}：${esc(next.title)}</span><a class="btn primary small" href="#/watch/${next.id}">${t('playNext')} ▶</a><button class="btn small" aria-label="close">✕</button>`;
      $('button', hint).onclick = () => hint.remove();
      box.appendChild(hint);
    }
    if (usage().sec % 10 === 0) save();
    if (usage().sec >= limitSec()) {
      save();
      clearInterval(timer);
      if (document.fullscreenElement) document.exitFullscreen();
      unmount?.();
      renderRest();
    }
  }, 1000);
  cleanup = () => { clearInterval(timer); clearInterval(countdown); unmount?.(); exitPseudo(); document.removeEventListener('fullscreenchange', onFsChange); screen.orientation?.removeEventListener?.('change', onOrient); save(); };
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
// series：{ id, title, indexOf(v) } —— 作为合集加入时按集数排序；已在库里的视频会被补上合集信息
function addVideos(list, group, series) {
  let n = 0;
  for (const v of list) {
    const ser = series ? { id: series.id, title: series.title, index: series.indexOf(v) } : undefined;
    const old = db.videos.find((x) => x.platform === v.platform && x.vid === v.vid && (x.page || 1) === (v.page || 1));
    if (old) { if (ser && !old.series) old.series = ser; continue; }
    db.videos.unshift({ ...v, src: v.playType === 'xhs' ? undefined : v.src, id: uid(), group, addedAt: Date.now(), ...(ser ? { series: ser } : {}) });
    n++;
  }
  save();
  return n;
}

let lastGroup = null, pendingCreatorUrl = null, sharedTitle = '';
// 从视频库/添加结果跳转："查看该博主的更多视频"
async function openCreatorOf(v, btn) {
  if (btn) { btn.disabled = true; btn.textContent = t('loadingMore'); }
  let url = null;
  try { url = await R.creatorUrlOf(v); } catch {}
  if (btn) { btn.disabled = false; btn.textContent = t('moreFromCreator'); }
  if (!url) return toast(t('noCreatorUrl'));
  if (!v.authorUrl) {
    const stored = db.videos.find((x) => x.id === v.id);
    if (stored) { stored.authorUrl = url; save(); }
  }
  pendingCreatorUrl = url;
  if (location.hash === '#/parent/add') renderParent('add');
  else location.hash = '#/parent/add';
}
function paneAdd(el) {
  el.innerHTML = `<div class="panel">
    <h2>${t('addTitle')}</h2>
    <p class="hint">${t('addHint')}</p>
    <div class="row"><input class="field grow" id="url" placeholder="${t('addPlaceholder')}" autocomplete="off">
      <select class="field" id="grp" style="width:auto">${groupOptions(lastGroup || db.groups[0])}</select><button class="btn primary" id="go">${t('parse')}</button></div>
    <div class="platforms">${['youtube', 'bilibili', 'qq', 'youku', 'ixigua', 'vimeo', 'tiktok', 'iqiyi'].map((p) => `<span class="plat-${p}">${esc(platName(p))}</span>`).join('')}<span class="plat-other">${t('directLink')}</span></div>
    <div id="helper-tip"></div><div id="result"></div></div>`;
  bindGroupSelect($('#grp'));
  detectHelper().then((v) => {
    const tip = $('#helper-tip');
    if (tip && !v) tip.innerHTML = `<p class="warn" style="margin-top:14px">${t('helperMissingTip')} <a href="#/parent/accounts">${t('helperSetup')}</a></p>`;
  });
  const input = $('#url');
  // 粘贴的分享文案前后常带有文字：自动提取其中的网址，并记下文案里的标题
  const tidy = () => {
    const raw = input.value.trim();
    const { url, title } = R.extractLink(raw);
    if (url !== raw) { input.value = url; sharedTitle = title; }
    return url;
  };
  input.addEventListener('paste', () => setTimeout(tidy, 0));
  const go = async () => {
    const url = tidy();
    if (!url) return;
    const out = $('#result');
    out.innerHTML = `<div class="row" style="margin-top:20px"><div class="spin dark"></div>${t('parsing')}</div>`;
    try {
      const data = await api({ url });
      if (data.kind === 'video') showSingle(out, data.video, data.manual && !sharedTitle, sharedTitle, data);
      else showCreator(out, url, data);
    } catch (e) {
      out.innerHTML = `<p class="warn" style="margin-top:16px">${t('parseFail')}${esc(errText(e))}</p>`;
    }
  };
  $('#go').onclick = go;
  // 注意：onkeydown 处理函数返回 false 会取消按键（导致无法删除文字），所以不能写成 `cond && go()`
  input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  input.oninput = () => { if (!input.value) sharedTitle = ''; };
  if (pendingCreatorUrl) {
    input.value = pendingCreatorUrl;
    pendingCreatorUrl = null;
    sharedTitle = '';
    go();
  }
}

function showSingle(out, v, manual, suggested = '', extra = {}) {
  const warn = v.playType === 'external' ? `<p class="warn">${t('extWarn')}</p>`
    : v.platform === 'xiaohongshu' && v.isVideo === false ? `<p class="warn">${t('notVideoNote')}</p>` : '';
  const has = exists(v);
  out.innerHTML = `<div class="single">
      <div class="thumb">${thumbImg(v)}</div>
      <div class="grow"><div style="font-weight:700;font-size:17px">${esc(v.title || platName(v.platform) + ' · ' + v.vid)}</div>
      <div class="hint">${esc(v.author || '')} · ${esc(platName(v.platform))}${v.duration ? ' · ' + esc(v.duration) : ''}</div>
      ${warn}${manual ? `<p class="hint">${t('manualHint')}</p>` : ''}
      <input class="field" id="title" value="${esc(v.title || suggested)}" placeholder="${t('titlePlaceholder')}" style="margin-bottom:10px" title="${t('editTitle')}">
      ${extra.collection ? `<div class="collection-box">${ICON.folder(18)}<span class="grow">${esc(t('inCollection', extra.collection.title, extra.collection.videos.length))}</span><button class="btn primary small" id="add-col">${t('addWholeCollection')}</button></div>` : ''}
      ${extra.playlistUrl ? `<div class="collection-box">${ICON.folder(18)}<span class="grow">${t('inPlaylist')}</span><button class="btn small" id="add-pl">${t('addWholePlaylist')}</button></div>` : ''}
      <div class="row"><button class="btn primary" id="add" ${has ? 'disabled' : ''}>${has ? t('inLib') : t('addToLib')}</button>
        ${canHaveCreator(v) ? `<button class="btn" id="more-creator">${t('moreFromCreator')}</button>` : ''}</div></div></div>`;
  if ($('#more-creator')) $('#more-creator').onclick = (e) => openCreatorOf(v, e.currentTarget);
  if ($('#add-col')) $('#add-col').onclick = () => showCreator(out, null, { author: extra.collection.title, videos: extra.collection.videos, next: null, collection: extra.collection });
  if ($('#add-pl')) $('#add-pl').onclick = () => { $('#url').value = extra.playlistUrl; $('#go').click(); };
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
    sharedTitle = '';
  };
}
const canHaveCreator = (v) => !!v.authorUrl || v.platform === 'youtube' || (v.platform === 'bilibili' && /^(BV|av)/.test(v.vid));

function showCreator(out, url, data) {
  const items = [...data.videos];
  const chosen = new Set();
  const keyOf = (v) => v.vid + (v.page ? '#' + v.page : '');
  const col = data.collection;
  if (col) items.forEach((v) => !exists(v) && chosen.add(keyOf(v))); // 合集默认全选
  let next = data.next, loading = false;
  out.innerHTML = `<h3>${col ? ICON.folder(18) + ' ' + esc(t('collectionTitle', col.title)) : esc(t('creatorVideos', data.author))} <span class="badge" id="cnt"></span></h3>
    ${col ? `<label class="inline" style="margin-bottom:10px"><input type="checkbox" id="as-series" checked> ${t('asSeries')}</label>` : ''}
    ${data.noteCode ? `<p class="hint">${esc(L().err[data.noteCode] || '')}</p>` : ''}
    ${data.source ? `<p class="hint" style="margin:0 0 8px">${t('listSource')}: ${t('src_' + data.source)}</p>` : ''}
    ${data.partial ? `<div class="warn row" style="margin-bottom:12px"><span class="grow">${t('biliPartial')}</span><button class="btn small" id="refetch">${t('refetchFull')}</button></div>` : ''}
    <div class="row"><button class="btn small" id="all">${t('selectAll')}</button><button class="btn small" id="none">${t('selectNone')}</button>
      <input class="field grow" id="filter" placeholder="${t('filter')}" style="padding:8px 12px">
      <button class="btn small" id="more">${t('loadMore')}</button><button class="btn small" id="loadall">${t('loadAll')}</button></div>
    <div class="pick-grid" id="picks"></div>
    <div class="sticky-actions row"><span class="hint" style="margin:0" id="sel"></span><div class="spacer"></div><button class="btn primary" id="addsel">${t('addSelected')}</button></div>`;
  const ft = () => $('#filter').value.trim().toLowerCase();
  const visible = () => items.filter((v) => !ft() || v.title.toLowerCase().includes(ft()));
  const draw = () => {
    $('#picks').innerHTML = visible().map((v) => {
      const added = exists(v), on = chosen.has(keyOf(v));
      return `<div class="pick ${on ? 'on' : ''} ${added ? 'added' : ''}" data-vid="${esc(keyOf(v))}">
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
      const seen = new Set(items.map(keyOf));
      d.videos.forEach((v) => !seen.has(keyOf(v)) && items.push(v));
      if (col) d.videos.forEach((v) => !exists(v) && chosen.add(keyOf(v)));
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
  if ($('#refetch')) $('#refetch').onclick = () => $('#go').click();
  $('#picks').onclick = (e) => {
    const p = e.target.closest('.pick');
    if (!p || p.classList.contains('added')) return;
    chosen.has(p.dataset.vid) ? chosen.delete(p.dataset.vid) : chosen.add(p.dataset.vid);
    draw();
  };
  $('#all').onclick = () => { visible().forEach((v) => !exists(v) && chosen.add(keyOf(v))); draw(); };
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
    const asSeries = col && $('#as-series')?.checked;
    const picked = items.filter((v) => chosen.has(keyOf(v)));
    // 作为合集加入：已在库里的同合集视频也一起补上合集信息（便于连续播放）
    const n = addVideos(asSeries ? items.filter((v) => chosen.has(keyOf(v)) || exists(v)) : picked, lastGroup,
      asSeries ? { id: col.id, title: col.title, indexOf: (v) => items.indexOf(v) } : undefined);
    chosen.clear();
    draw();
    toast(t('addedN', n, lastGroup));
  };
  draw();
}

// 通用确认弹窗：返回 true / false；extra 是额外按钮 [{ text, onClick }]（点了不关闭弹窗）
function confirmBox({ title, body, ok, danger = true, extra = [] }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; close(); resolve(v); } };
    const close = modal(`<h2>${title}</h2><p class="confirm-body">${body}</p>
      ${extra.length ? `<div class="row confirm-extra">${extra.map((x, i) => `<button class="btn" data-x="${i}">${x.text}</button>`).join('')}</div>` : ''}
      <div class="row confirm-acts"><button class="btn" data-a="no">${t('cancel')}</button><button class="btn ${danger ? 'danger-solid' : 'primary'}" data-a="yes">${ok}</button></div>`, (dlg) => {
      dlg.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.x != null) return extra[b.dataset.x].onClick();
        finish(b.dataset.a === 'yes');
      };
    });
    // 点遮罩关闭也算取消
    const mask = $('#modal-root .mask');
    mask?.addEventListener('click', (e) => e.target === mask && finish(false));
  });
}
function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: 'KidsTube', version: 1, groups: db.groups, videos: db.videos }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `kidstube-backup-${today()}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

let libGroup = ALL, libCreator = ALL;
function paneLibrary(el) {
  let q = '';
  const sel = new Set(); // 勾选的视频 id
  const drawCreators = () => {
    // 博主列表和数量都按当前视频库实时计算：删光的博主自动消失
    const cs = creatorsOf(db.videos.filter((v) => libGroup === ALL || v.group === libGroup));
    if (libCreator !== ALL && !cs.some((c) => c.key === libCreator)) libCreator = ALL;
    $('#lc').innerHTML = `<option value="${ALL}">${t('allCreators')}</option>` + cs.map((c) => `<option value="${esc(c.key)}" ${c.key === libCreator ? 'selected' : ''}>${esc(c.name)} (${c.count})</option>`).join('');
  };
  const drawGroups = () => {
    // 分组保留（空分组显示 0），只更新数量
    const n = (g) => db.videos.filter((v) => v.group === g).length;
    $('#lg').innerHTML = `<option value="${ALL}">${t('allGroups')}</option>` + db.groups.map((g) => `<option value="${esc(g)}" ${g === libGroup ? 'selected' : ''}>${esc(g)} (${n(g)})</option>`).join('');
  };
  const filtered = () => db.videos
    .filter((v) => libGroup === ALL || v.group === libGroup)
    .filter((v) => libCreator === ALL || creatorKey(v) === libCreator)
    .filter((v) => !q || (v.title + v.author + v.group).toLowerCase().includes(q));
  const drawBulk = () => {
    const shown = filtered();
    $('#selall').textContent = t('selectShown', shown.length);
    $('#selall').disabled = !shown.length;
    $('#selnone').disabled = !sel.size;
    $('#delsel').textContent = t('delSelected', sel.size);
    $('#delsel').disabled = !sel.size;
    $('#delall').disabled = !db.videos.length;
  };
  const draw = () => {
    const list = filtered();
    $('#libbody').innerHTML = list.map((v) => `<tr data-id="${v.id}" class="${sel.has(v.id) ? 'on' : ''}">
      <td class="thumb-cell" style="width:120px"><label class="chk" title="${t('select')}"><input type="checkbox" data-sel ${sel.has(v.id) ? 'checked' : ''}></label>${v.thumb ? `<img src="${esc(v.thumb)}" referrerpolicy="no-referrer" loading="lazy" alt="">` : ''}</td>
      <td><div class="t" contenteditable="true" data-f="title" title="${t('editTitle')}">${esc(v.title)}</div>
        <div class="s">${esc(v.author || '')} · ${esc(platName(v.platform))}${v.series ? ` · ${esc(v.series.title)} ${t('epOfN', epNo(v), seriesEps(v.series.id).length)}` : ''} · <a href="${esc(v.url)}" target="_blank" rel="noopener">${t('original')}</a></div></td>
      <td><select data-f="group">${db.groups.map((g) => `<option ${g === v.group ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></td>
      <td class="acts">${canHaveCreator(v) ? `<button class="btn small" data-more>${t('moreFromCreator')}</button>` : ''}<button class="btn danger small" data-del>${t('del')}</button></td></tr>`).join('') || `<tr><td colspan="4" class="hint">${t('noVideos')}</td></tr>`;
    drawBulk();
  };
  // 视频库有变化（删除 / 改分组）后：总数、分组数量、博主列表、列表、批量按钮全部重新计算
  const refresh = () => {
    for (const id of [...sel]) if (!db.videos.some((v) => v.id === id)) sel.delete(id);
    $('#libcnt').textContent = t('libCount', db.videos.length);
    drawGroups();
    drawCreators();
    draw();
  };
  const removeIds = (ids) => {
    const set = new Set(ids);
    const before = db.videos.length;
    db.videos = db.videos.filter((x) => !set.has(x.id));
    save();
    refresh();
    return before - db.videos.length;
  };
  el.innerHTML = `<div class="panel"><h2>${t('libTitle')} <span class="badge" id="libcnt"></span></h2>
    <p class="hint">${t('libHint')}</p>
    <div class="row" style="margin-bottom:10px">
      <select class="field" id="lg" style="width:auto"></select>
      <select class="field" id="lc" style="width:auto"></select>
      <input class="field grow" id="lq" placeholder="${t('libSearch')}">
      <button class="btn small" id="newg">${t('manageGroups')}</button><button class="btn danger small" id="delall">${t('clearAll')}</button></div>
    <div class="row bulk" style="margin-bottom:6px">
      <button class="btn small" id="selall"></button><button class="btn small" id="selnone">${t('selectNone')}</button>
      <div class="spacer"></div><button class="btn danger-solid small" id="delsel"></button></div>
    <div class="table-wrap"><table class="lib"><tbody id="libbody"></tbody></table></div></div>`;
  if (libGroup !== ALL && !db.groups.includes(libGroup)) libGroup = ALL;
  refresh();
  $('#lg').onchange = (e) => { libGroup = e.target.value; libCreator = ALL; drawCreators(); draw(); };
  $('#lc').onchange = (e) => { libCreator = e.target.value; draw(); };
  const byRow = (e) => db.videos.find((x) => x.id === e.target.closest('tr')?.dataset.id);
  $('#lq').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  $('#libbody').addEventListener('change', (e) => {
    if (e.target.matches('[data-sel]')) {
      const id = e.target.closest('tr').dataset.id;
      e.target.checked ? sel.add(id) : sel.delete(id);
      e.target.closest('tr').classList.toggle('on', e.target.checked);
      return drawBulk();
    }
    if (e.target.dataset.f !== 'group') return;
    const v = byRow(e);
    v.group = e.target.value;
    save();
    refresh();
    toast(t('movedTo', v.group));
  });
  $('#libbody').addEventListener('focusout', (e) => {
    if (e.target.dataset.f !== 'title') return;
    const v = byRow(e), title = e.target.textContent.trim();
    if (title && title !== v.title) { v.title = title; save(); toast(t('titleUpdated')); }
  });
  $('#libbody').addEventListener('click', (e) => {
    if (e.target.matches('[data-more]')) return openCreatorOf(byRow(e), e.target);
    if (!e.target.matches('[data-del]')) return;
    removeIds([e.target.closest('tr').dataset.id]);
  });
  // 全选只选当前筛选结果（分组 + 博主 + 搜索）
  $('#selall').onclick = () => { filtered().forEach((v) => sel.add(v.id)); draw(); };
  $('#selnone').onclick = () => { sel.clear(); draw(); };
  $('#delsel').onclick = async () => {
    const n = sel.size;
    if (!n || !(await confirmBox({ title: t('delSelTitle', n), body: t('delSelBody'), ok: t('delSelOk', n) }))) return;
    toast(t('deletedN', removeIds([...sel])));
  };
  $('#delall').onclick = async () => {
    const n = db.videos.length, m = filtered().length;
    if (!n) return;
    const ok = await confirmBox({
      title: t('clearTitle'),
      body: t('clearBody', n, m),
      ok: t('clearOk', n),
      extra: [{ text: t('clearBackup'), onClick: () => { exportBackup(); toast(t('backupDone')); } }],
    });
    if (!ok) return;
    sel.clear();
    toast(t('deletedN', removeIds(db.videos.map((v) => v.id))));
  };
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

// 都直接打开各网站的登录页（不是首页）；手机上爱奇艺 / 优酷 / 腾讯视频会自动显示手机号验证码登录
const LOGINS = [
  { key: 'youtube', url: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F', color: '#ff0033' },
  { key: 'bilibili', url: 'https://passport.bilibili.com/login', color: '#fb7299' },
  { key: 'qq', url: 'https://film.qq.com/weixin/login.html?ru=' + encodeURIComponent('https://v.qq.com/'), color: '#ff6a00' },
  // 优酷首页在手机上会换成引导打开 App 的手机版；专门的登录页在手机上也能用账号密码 / 验证码登录
  { key: 'youku', url: 'https://account.youku.com/?callback=' + encodeURIComponent('https://www.youku.com/'), color: '#1f8cff' },
  { key: 'iqiyi', url: 'https://www.iqiyi.com/iframe/loginreg', color: '#00be06' },
];
// 借助手读取本浏览器在各网站的登录状态（只读是否登录和昵称，不读 Cookie）
const LOGIN_CHECKS = {
  bilibili: async () => {
    const j = JSON.parse((await helperRequest({ url: 'https://api.bilibili.com/x/web-interface/nav' })).data);
    return { in: !!j.data?.isLogin, name: j.data?.uname };
  },
  youtube: async () => {
    const m = /"LOGGED_IN":(true|false)/.exec((await helperRequest({ url: 'https://www.youtube.com/' })).data || '');
    return m ? { in: m[1] === 'true' } : null;
  },
  // 腾讯视频：会员积分接口，未登录时 ret -11
  qq: async () => {
    const text = (await helperRequest({ url: 'https://vip.video.qq.com/fcgi-bin/comm_cgi?name=get_cscore&type=2&otype=json', headers: { referer: 'https://v.qq.com/' } })).data || '';
    const j = JSON.parse(text.replace(/^[^(]*\(|\);?\s*$/g, ''));
    return j.ret === 0 ? { in: true, name: j.nick || j.data?.nick } : j.ret === -11 ? { in: false } : null;
  },
  // 优酷：页面里服务端填入的 userId，未登录时为空（页面约 0.6MB，等待时间放宽）
  youku: async () => {
    // 优酷按浏览器标识返回手机版页面（没有 userId），所以用电脑版标识请求
    const text = (await helperRequest({ url: 'https://www.youku.com/ku/webvip', timeout: 60000, headers: { 'user-agent': DESKTOP_UA } })).data || '';
    const m = /"userId":"([^"]*)"/.exec(text);
    return m ? { in: !!m[1] } : null;
  },
  // 爱奇艺：会员成长值接口，未登录时 code Q00304（"用户未登录"）
  iqiyi: async () => {
    const j = JSON.parse((await helperRequest({ url: 'https://serv.vip.iqiyi.com/vipgrowth/query.action?platform=b6c13e26323c537d', headers: { referer: 'https://www.iqiyi.com/' } })).data);
    return j.code === 'A00000' ? { in: true } : j.code === 'Q00304' ? { in: false } : null;
  },
};
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
let loginCheckAt = 0;
async function refreshLoginStates() {
  const boxes = [...document.querySelectorAll('[data-state]')];
  if (!boxes.length || Date.now() - loginCheckAt < 1500) return;
  loginCheckAt = Date.now();
  if (!helperVersion()) {
    boxes.forEach((b) => { b.className = 'login-state muted'; b.textContent = t('loginNeedHelper'); });
    return;
  }
  await Promise.all(boxes.map(async (b) => {
    b.className = 'login-state muted';
    b.textContent = t('loginChecking');
    let r = null;
    try { r = await LOGIN_CHECKS[b.dataset.state](); } catch {}
    if (!r) { b.textContent = t('loginUnknown'); return; }
    b.className = 'login-state ' + (r.in ? 'on' : 'off');
    b.textContent = r.in ? (r.name ? t('loginIn', r.name) : t('loginInNoName')) : t('loginOut');
  }));
}
// 登录完回到这个页面（关掉弹窗或切回标签页）时自动刷新
window.addEventListener('focus', () => refreshLoginStates());
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refreshLoginStates());

function paneAccounts(el) {
  const s = db.settings, ver = helperVersion();
  el.innerHTML = `<div class="panel"><h2>${t('helperTitle')} <span class="badge ${ver ? 'ok' : ''}">${ver ? t('helperOn', ver) : t('helperOff')}</span></h2>
    <p class="hint">${t('helperIntro')}</p>
    <div class="row" style="margin-bottom:12px"><a class="btn primary" href="kidstube-helper.user.js" target="_blank" rel="noopener">${t('helperInstall')}</a>
      <button class="btn small" id="recheck">${t('helperRecheck')}</button></div>
    <div class="steps">${t('helperSteps')}</div>
    <p class="hint">${t('helperPrivacy')}</p>
    <h3>${t('helperTest')}</h3>
    <p class="hint">${t('helperTestHint')}</p>
    <div class="row"><button class="btn" id="selftest">${t('helperTest')}</button><button class="btn small" id="copytest" hidden>${t('helperTestCopy')}</button></div>
    <pre class="testout" id="testout" hidden></pre></div>

    <div class="panel"><h2>${t('accTitle')}</h2>
    <p class="hint">${t('accHint')}</p>
    <p class="warn">${t('accWarn')}</p>
    <div class="login-list">${LOGINS.map((p) => `<div class="login-item">
      <div class="name"><span class="dot" style="background:${p.color}"></span>${esc(platName(p.key))}</div>
      <div class="hint" style="margin:0 0 10px">${t('note_' + p.key)}</div>
      ${LOGIN_CHECKS[p.key] ? `<div class="login-state" data-state="${p.key}"></div>` : ''}
      <button class="btn small" data-login="${p.url}">${t('openLogin')}</button></div>`).join('')}</div>

    <h3>${t('ytSettings')}</h3>
    <label class="inline"><input type="checkbox" id="ytlogin" ${s.ytLoggedIn ? 'checked' : ''}> ${t('ytLogin')}</label>
    <p class="hint">${t('ytLoginHint')}</p>
    <label>${t('ytKey')}</label>
    <input class="field" id="ytkey" value="${esc(s.ytKey)}" placeholder="AIza…" style="margin:6px 0" autocomplete="off">
    <p class="hint">${t('ytKeyHint')}</p>
    <div class="row" style="margin-top:14px"><button class="btn primary" id="save">${t('save')}</button></div></div>`;
  el.querySelectorAll('[data-login]').forEach((b) => (b.onclick = () => {
    const w = window.open(b.dataset.login, '_blank', 'popup,width=1000,height=760');
    // 电脑上是弹出窗口：关掉后刷新登录状态
    const timer = setInterval(() => { if (!w || w.closed) { clearInterval(timer); loginCheckAt = 0; refreshLoginStates(); } }, 1000);
  }));
  loginCheckAt = 0;
  refreshLoginStates();
  $('#recheck').onclick = () => location.reload();
  $('#selftest').onclick = () => runSelfTest();
  $('#copytest').onclick = async () => {
    try { await navigator.clipboard.writeText($('#testout').textContent); toast(t('helperTestCopied')); }
    catch { toast(t('helperTestCopyFail')); }
  };
  $('#save').onclick = () => {
    s.ytLoggedIn = $('#ytlogin').checked;
    s.ytKey = $('#ytkey').value.trim();
    save();
    toast(t('saved'));
  };
}

// 助手自检：逐项测试并显示耗时，结果可复制发给开发者排查
async function runSelfTest() {
  const out = $('#testout'), btn = $('#selftest');
  out.hidden = false;
  btn.disabled = true;
  const lines = [`KidsTube ${location.origin}`, `UA: ${navigator.userAgent}`];
  const show = () => (out.textContent = lines.join('\n'));
  const step = async (label, fn) => {
    lines.push(`… ${label}`);
    show();
    const t0 = performance.now();
    let msg;
    try { msg = '✓ ' + (await fn()); }
    catch (e) { msg = '✗ ' + (e.code ? e.code + (e.detail ? ' ' + e.detail : '') : e.message); }
    lines[lines.length - 1] = `${label}: ${msg} (${Math.round(performance.now() - t0)} ms)`;
    show();
  };
  const ver = await detectHelper(2000);
  lines.push(`${t('helperTitle')}: ${ver ? 'v' + ver : t('helperOff')}`);
  show();
  if (ver) {
    await step(t('helperTestRoundTrip'), async () => {
      const v = await pingHelper();
      if (!v) throw Object.assign(new Error(t('helperTestNoReply')), {});
      return 'OK';
    });
    const get = async (url) => {
      const r = await helperRequest({ url });
      return { status: r.status, text: typeof r.data === 'string' ? r.data : '' };
    };
    await step('Bilibili nav', async () => {
      const r = await get('https://api.bilibili.com/x/web-interface/nav');
      const j = JSON.parse(r.text);
      return `HTTP ${r.status}, ${j.data?.isLogin ? t('helperTestLoggedIn') : t('helperTestLoggedOut')}`;
    });
    await step('Bilibili UP', async () => {
      const r = await R.resolve({ url: 'https://space.bilibili.com/946974' });
      return `${r.author}: ${r.videos.length} / ${r.total ?? '?'}`;
    });
    await step('YouTube oEmbed', async () => `HTTP ${(await get('https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=jNQXAC9IVRw')).status}`);
  }
  btn.disabled = false;
  $('#copytest').hidden = false;
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
      <h3>${t('nextEp')}</h3>
      <label class="inline"><input type="checkbox" id="autoplay-next" ${s.autoplayNext ? 'checked' : ''}> ${t('autoplayNext')}</label>
      <p class="hint">${t('autoplayHint')}</p>
      <label class="inline"><input type="checkbox" id="bili-native" ${s.biliNative !== false ? 'checked' : ''}> ${t('biliNative')}</label>
      <p class="hint">${t('biliNativeHint')}</p>
      <h3>${t('lockTitle')}</h3>
      <label class="inline"><input type="checkbox" id="shield" ${s.shield ? 'checked' : ''}> ${t('shield')}</label>
      <p class="hint">${t('shieldHint')}</p>
      <label>${t('sandbox')}</label>
      <p class="hint">${t('sandboxHint')}</p>
      <div class="sandbox-list">${SANDBOX_SITES.map((p) => `<label class="inline"><input type="checkbox" data-sandbox="${p}" ${sandboxOn(p) ? 'checked' : ''}> ${esc(platName(p))}</label>`).join('')}</div>
      <button class="btn primary" id="save">${t('save')}</button></div>
    <div class="panel"><h2>${t('pinTitle')}</h2><button class="btn" id="pin">${t('changePin')}</button></div>
    <div class="panel"><h2>${t('backupTitle')}</h2>
      <p class="hint">${t('backupHint')}</p>
      <div class="row"><button class="btn" id="exp">${t('exportBtn')}</button><label class="btn">${t('importBtn')}<input type="file" id="imp" accept=".json" hidden></label></div></div>`;
  el.querySelectorAll('[data-lang]').forEach((b) => (b.onclick = () => { setLang(b.dataset.lang); route(); }));
  $('#save').onclick = () => {
    s.dailyLimit = Math.max(0, Number($('#limit').value) || 0);
    s.shield = $('#shield').checked;
    s.autoplayNext = $('#autoplay-next').checked;
    s.biliNative = $('#bili-native').checked;
    s.sandboxSites = Object.fromEntries([...el.querySelectorAll('[data-sandbox]')].map((c) => [c.dataset.sandbox, c.checked]));
    delete s.sandbox;
    save();
    toast(t('saved'));
  };
  $('#reset').onclick = () => { db.usage = { date: today(), sec: 0, bonus: 0 }; save(); paneSettings(el); };
  $('#pin').onclick = async () => {
    const pin = await pinDialog({ title: t('pinNewTitle'), sub: t('pinNewSub'), mode: 'set' });
    if (pin) { s.pinHash = await sha(pin); save(); toast(t('pinChanged')); }
  };
  $('#exp').onclick = exportBackup;
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
