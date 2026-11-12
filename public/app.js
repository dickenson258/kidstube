// 朵米片单前端 —— 所有数据只保存在本浏览器 localStorage，不上传任何服务器
import { DICT } from './i18n.js';
import * as R from './resolver.js';
import { detectHelper, onHelper, helperRequest, helperVersion, pingHelper } from './bridge.js';
import { wrapSourceBuffer } from './h264fix.js';
import * as S from './sync.js';

// 检测到朵米助手后，跨域请求改由助手发出
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
  S.onSaved();
}
function usage() {
  if (db.usage.date !== today()) db.usage = { date: today(), sec: 0, bonus: 0 };
  return db.usage;
}
const limitSec = () => (db.settings.dailyLimit ? db.settings.dailyLimit * 60 + (usage().bonus || 0) : Infinity);

// 播放记录：{ 视频 id: { t: 看到第几秒, d: 总时长, at: 最后观看时间 } }，只存在本浏览器
// 看完（或只剩最后几秒）就从记录里去掉，首页"接着看"只显示没看完的
const PROGRESS_MAX = 40;
function progressOf(id) { return (db.progress || {})[id] || null; }
function setProgress(id, t, d) {
  const p = (db.progress ||= {});
  if (d && t >= d - 8) { delete p[id]; return; } // 已看完
  p[id] = { t: Math.floor(t || 0), d: Math.floor(d || 0), at: Date.now() };
  const ids = Object.keys(p);
  if (ids.length > PROGRESS_MAX) ids.sort((a, b) => p[a].at - p[b].at).slice(0, ids.length - PROGRESS_MAX).forEach((k) => delete p[k]);
}
// 有记录的位置才续播：至少看了 5 秒，并且不是快结束了
const resumePoint = (id) => { const p = progressOf(id); return p && p.t >= 5 && (!p.d || p.t < p.d - 8) ? p.t : 0; };
const fmtTime = (sec) => { sec = Math.floor(sec); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = String(sec % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };

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
  play: (n) => svg('<path d="M8 5.5v13l10-6.5z"/>', n),
  share: (n) => svg('<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>', n),
  window: (n) => svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18"/><path d="M14 13h4v4"/><path d="m18 13-5 5"/>', n),
};
// 朵米（朵米伙伴的品牌角色）：蓝色圆角等边三角、两个小竖椭圆眼睛、细线手脚、不画嘴。
// pose：idle 待机漂浮 / wave 挥手 / hop 轻跳 / jump 开心跃起。手脚颜色跟随 --domi-ink（深色模式、视频遮罩上自动变浅）
const DOMI_ARMS = {
  idle: ['M28 88 Q22 91 16 96', 'M92 88 Q98 91 104 96', [16, 96], [104, 96]],
  wave: ['M28 88 Q22 91 16 96', 'M91 84 Q100 79 101 68', [16, 96], [101, 68]],
  hop: ['M29 82 Q20 77 18 68', 'M91 82 Q100 77 102 68', [18, 68], [102, 68]],
};
DOMI_ARMS.jump = DOMI_ARMS.hop;
function domi(pose = 'idle', size = 120, label = '') {
  const [l, r, lh, rh] = DOMI_ARMS[pose] || DOMI_ARMS.idle;
  const legs = pose === 'jump'
    ? '<path d="M50 112 Q46 120 40 122"/><path d="M70 112 Q74 120 80 122"/>'
    : '<path d="M50 112 V128 H43"/><path d="M70 112 V128 H77"/>';
  return `<svg class="domi domi-${pose}" width="${size}" height="${Math.round(size * 7 / 6)}" viewBox="0 0 120 140" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'}>
    <g class="domi-body">
      <g fill="none" stroke="var(--domi-ink)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
        <path class="domi-arm-l" d="${l}"/><path class="domi-arm-r" d="${r}"/>${legs}
      </g>
      <circle cx="${lh[0]}" cy="${lh[1]}" r="2.6" fill="var(--domi-ink)"/><circle class="domi-hand-r" cx="${rh[0]}" cy="${rh[1]}" r="2.6" fill="var(--domi-ink)"/>
      <path d="M66.5 40.1 L101.5 100.7 Q108 112 95 112 L25 112 Q12 112 18.5 100.7 L53.5 40.1 Q60 28.9 66.5 40.1 Z" fill="#0a5cff"/>
      <g class="domi-eyes" fill="#111"><ellipse cx="53.5" cy="66" rx="2.5" ry="4.2"/><ellipse cx="66.5" cy="66" rx="2.5" ry="4.2"/></g>
    </g>
  </svg>`;
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
  document.title = t('appTitle');
  const [, page, arg] = location.hash.split('/');
  if (page === 'watch') return renderWatch(arg);
  if (page === 'series') return renderSeries(decodeURIComponent(arg || ''));
  if (page === 'import') return renderImport(arg);
  if (page === 's') return renderShort(arg);
  // 短链接页面直接带上了片单内容：#/i/<短链接编号>/<片单>，不用再请求服务器
  if (page === 'i') return renderImport(location.hash.split('/')[3] || '', arg);
  if (page === 'recover') return renderRecover();
  if (page === 'pair') return renderPair(arg);
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
    <a class="logo" href="#/" aria-label="${esc(t('appName'))}"><img src="icon.svg" alt=""><span>Domi<b>Buddy</b></span><span class="product">${t('product')}</span></a>
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
const creatorKey = (v) => (v.authorUrl || `${v.platform}:${v.author || ''}`).toLowerCase(); // YouTube 频道地址大小写不同也算同一个
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
const RETIRED = new Set(['douyin', 'xiaohongshu', 'ixigua', 'tiktok']);
const kidVideos = () => db.videos.filter((v) => !RETIRED.has(v.platform));
const seriesEps = (id) => kidVideos().filter((x) => x.series?.id === id).sort((a, b) => a.series.index - b.series.index);
// 博主视频排序（孩子在首页选中博主后切换，按博主分别记住）；合集内部始终按集数
const SORTS = ['new', 'old', 'az', 'za'];
const collator = new Intl.Collator(['zh-Hans-CN', 'en'], { numeric: true, sensitivity: 'base' }); // "第2集" 排在 "第10集" 前
const creatorSort = (key) => (SORTS.includes(db.creatorSort?.[key]) ? db.creatorSort[key] : 'new');
// bySeries：首页合并合集时，合集按合集名称参与排序
function sortVideos(list, mode, bySeries = false) {
  const idx = new Map(db.videos.map((v, i) => [v.id, i])); // 视频库顺序：新加入的在前
  const added = (v) => v.addedAt || 0;
  const name = (v) => (bySeries && v.series ? v.series.title : v.title) || '';
  const byNew = (a, b) => added(b) - added(a) || idx.get(a.id) - idx.get(b.id);
  const cmp = { new: byNew, old: (a, b) => -byNew(a, b), az: (a, b) => collator.compare(name(a), name(b)) || byNew(a, b), za: (a, b) => collator.compare(name(b), name(a)) || byNew(a, b) }[mode];
  return [...list].sort(cmp);
}
const epNo = (v) => seriesEps(v.series.id).findIndex((x) => x.id === v.id) + 1;
function nextEpisode(v) {
  if (!v.series) return null;
  const eps = seriesEps(v.series.id);
  const i = eps.findIndex((x) => x.id === v.id);
  return i >= 0 ? eps[i + 1] || null : null;
}
const durSec = (d) => String(d || '').split(':').reduce((a, b) => a * 60 + (Number(b) || 0), 0);

function progressBar(v) {
  const p = progressOf(v.id);
  return p && p.d && p.t > 0 ? `<span class="prog"><i style="width:${Math.min(100, Math.round((p.t / p.d) * 100))}%"></i></span>` : '';
}
function videoCard(v, { ep, current } = {}) {
  return `<a class="card ${current ? 'current' : ''}" href="#/watch/${v.id}">
    <div class="thumb">${thumbImg(v)}<span class="plat plat-${v.platform}">${esc(platName(v.platform))}</span>${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ''}${progressBar(v)}</div>
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
// 首页"接着看"：最近没看完的视频（最多 4 个，最近的在前）
function continueRow(show) {
  if (!show) return '';
  const vids = kidVideos();
  const items = Object.entries(db.progress || {})
    .sort((a, b) => b[1].at - a[1].at)
    .map(([id]) => vids.find((v) => v.id === id))
    .filter(Boolean)
    .slice(0, 4);
  if (!items.length) return '';
  return `<h2 class="row-title">${ICON.play(18)} ${t('continueWatching')}</h2>
    <div class="grid continue">${items.map((v) => {
      const at = resumePoint(v.id);
      const ep = v.series ? epNo(v) : 0;
      return videoCard(v, { ep: ep || undefined }).replace('<div class="body">', `<div class="body">${at ? `<div class="resume-at">${t('resumeAt', fmtTime(at))}</div>` : ''}`);
    }).join('')}</div>
    <h2 class="row-title">${t('allVideos')}</h2>`;
}
function renderHome() {
  const groups = db.groups.filter((g) => kidVideos().some((v) => v.group === g));
  if (homeGroup !== ALL && !groups.includes(homeGroup)) homeGroup = ALL;
  const q = homeQuery.toLowerCase();
  const inGroup = kidVideos().filter((v) => homeGroup === ALL || v.group === homeGroup);
  const creators = creatorsOf(inGroup);
  if (homeCreator !== ALL && !creators.some((c) => c.key === homeCreator)) homeCreator = ALL;
  let list = inGroup
    .filter((v) => homeCreator === ALL || creatorKey(v) === homeCreator)
    .filter((v) => !q || (v.title + v.author).toLowerCase().includes(q));
  const sortMode = homeCreator === ALL ? null : creatorSort(homeCreator);
  if (sortMode) list = sortVideos(list, sortMode, !q);
  app.innerHTML =
    topbar(`<input class="search" id="q" placeholder="${t('search')}" value="${esc(homeQuery)}">`) +
    `<main class="wrap">
      ${kidVideos().length ? `<div class="chips">${[ALL, ...groups].map((g) => `<button class="chip ${g === homeGroup ? 'on' : ''}" data-g="${esc(g)}">${esc(g === ALL ? t('all') : g)}</button>`).join('')}</div>` : ''}
      ${creators.length > 1 ? `<div class="chips sub">${[{ key: ALL, name: t('allCreators') }, ...creators].map((c) => `<button class="chip folder ${c.key === homeCreator ? 'on' : ''}" data-c="${esc(c.key)}">${ICON.folder(16)}<span>${esc(c.name)}</span>${c.count ? `<em>${c.count}</em>` : ''}</button>`).join('')}</div>` : ''}
      ${sortMode ? `<div class="chips sort">${SORTS.map((m) => `<button class="chip small ${m === sortMode ? 'on' : ''}" data-sort="${m}">${t('sort_' + m)}</button>`).join('')}</div>` : ''}
      ${continueRow(!q && homeGroup === ALL && homeCreator === ALL)}
      ${list.length ? `<div class="grid">${homeCards(list, !q)}</div>`
        : kidVideos().length ? `<div class="empty"><div class="big">${ICON.search(64)}</div><h2>${t('notFound')}</h2></div>`
        : welcomeGuide()}
    </main>`;
  bindTopbar();
  $('#guide-parent')?.addEventListener('click', () => $('#parent-btn')?.click());
  // 已安装，重新检测：先问一下助手；没回应就刷新页面（刚装好的脚本要刷新后才会注入）
  $('#guide-recheck')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = t('g_checking');
    if (await detectHelper(1500)) { try { sessionStorage.removeItem('kt-recheck'); } catch {} return route(); }
    try { sessionStorage.setItem('kt-recheck', '1'); } catch {}
    location.reload();
  });
  app.querySelectorAll('.chip[data-g]').forEach((c) => (c.onclick = () => { homeGroup = c.dataset.g; homeCreator = ALL; renderHome(); }));
  app.querySelectorAll('.chip[data-c]').forEach((c) => (c.onclick = () => { homeCreator = c.dataset.c; renderHome(); }));
  app.querySelectorAll('.chip[data-sort]').forEach((c) => (c.onclick = () => { (db.creatorSort ||= {})[homeCreator] = c.dataset.sort; save(); renderHome(); }));
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

// ------------------------------------------------------------ 新用户安装指引
const LINKS = {
  userscripts: 'https://apps.apple.com/app/userscripts/id1463298887',
  firefoxPlay: 'https://play.google.com/store/apps/details?id=org.mozilla.firefox',
  firefoxSite: 'https://www.mozilla.org/firefox/browsers/mobile/android/',
  tmAndroid: 'https://addons.mozilla.org/android/addon/tampermonkey/',
  tampermonkey: 'https://www.tampermonkey.net/',
  script: 'kidstube-helper.user.js',
};
function deviceKind() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}
// 某一种设备的安装步骤：每步一句话，需要下载的地方直接给按钮
function deviceSteps(kind) {
  const ua = navigator.userAgent, here = kind === deviceKind();
  const a = (href, label, primary) => `<a class="btn small ${primary ? 'primary' : ''}" href="${href}" target="_blank" rel="noopener">${label}</a>`;
  const step = (text, ...btns) => `<li><div>${text}</div>${btns.length ? `<div class="guide-btns">${btns.join('')}</div>` : ''}</li>`;
  let warn = '', steps;
  if (kind === 'ios') {
    if (here && /CriOS|FxiOS|EdgiOS|OPiOS|MicroMessenger|QQ\//.test(ua)) warn = t('g_iosNotSafari');
    steps = [step(t('g_ios1'), a(LINKS.userscripts, t('g_appStore'), true)), step(t('g_ios2')), step(t('g_ios3'), a(LINKS.script, t('helperInstall'), true)), step(t('g_done'))];
  } else if (kind === 'android') {
    const ff = here && /Firefox\//.test(ua);
    if (here && !ff) warn = t('g_androidNotFirefox');
    steps = [ff ? step(t('g_and1ok')) : step(t('g_and1'), a(LINKS.firefoxPlay, 'Google Play', true), a(LINKS.firefoxSite, t('g_site'))),
      step(t('g_and2'), a(LINKS.tmAndroid, t('g_addon'), true)), step(t('g_and3'), a(LINKS.script, t('helperInstall'), true)), step(t('g_done'))];
  } else {
    steps = [step(t('g_pc1'), a(LINKS.tampermonkey, 'Tampermonkey', true)), step(t('g_pc2'), a(LINKS.script, t('helperInstall'), true)), step(t('g_done'))];
  }
  return `${warn ? `<p class="warn">${warn}</p>` : ''}<ol class="guide-steps">${steps.join('')}</ol>`;
}
// 安装助手：本设备的步骤展开，其他设备折叠
function helperGuide() {
  const me = deviceKind(), others = ['ios', 'android', 'desktop'].filter((k) => k !== me);
  return `<div class="guide-dev">${t('g_thisDevice', t('dev_' + me))}</div>${deviceSteps(me)}
    ${others.map((k) => `<details class="guide-other"><summary>${t('g_otherDevice', t('dev_' + k))}</summary>${deviceSteps(k)}</details>`).join('')}`;
}
// 首页（还没有视频时）：给家长的 3 步
function welcomeGuide() {
  const ver = helperVersion();
  return `<div class="welcome" data-helper="${ver ? 'on' : 'off'}">
    <div class="big"><div class="domi-say">${t('domiHello')}</div>${domi('wave', 104, t('domiName'))}</div><h2>${t('g_title')}</h2><p class="hint">${t('g_intro')}</p>
    <div class="welcome-step"><div class="num">1</div><div class="body"><h3>${t('g_s2')}</h3><p class="hint">${t('g_s2body')}</p>
      <button class="btn primary" id="guide-parent">${t('g_openParent')}</button></div></div>
    <div class="welcome-step"><div class="num">2</div><div class="body"><h3>${t('g_s1')} ${ver ? `<span class="badge ok">${t('helperOn', ver)}</span>` : ''}</h3>
      <p class="hint">${t('g_s1why')}</p>${ver ? '' : `<details class="guide-helper"${(() => { try { return sessionStorage.getItem('kt-recheck') ? ' open' : ''; } catch { return ''; } })()}><summary>${t('g_s1show')}</summary>${helperGuide()}
      <div class="row"><button class="btn" id="guide-recheck">${t('helperRecheck')}</button></div>
      ${(() => { try { return sessionStorage.getItem('kt-recheck'); } catch { return null; } })() ? `<p class="warn" id="guide-notyet">${t('g_notYet')}</p>` : ''}</details>`}</div></div>
    <div class="welcome-step"><div class="num">3</div><div class="body"><h3>${t('g_s3')}</h3><p class="hint">${t('g_s3body')}</p></div></div>
    <p class="hint" style="text-align:center;margin-top:18px">${t('g_recover')} <a href="#/recover">${t('recoverLink')} →</a></p>
  </div>`;
}
// 助手装好后，首页的指引自动更新
onHelper(() => { try { sessionStorage.removeItem('kt-recheck'); } catch {} if ($('.welcome[data-helper="off"]')) route(); });

function renderSeries(id) {
  const eps = seriesEps(id);
  if (!eps.length) { location.hash = '#/'; return; }
  const ser = eps[0].series;
  document.title = ser.title + ' · ' + t('appName');
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
    return `${host}/embed/${v.vid}?autoplay=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&fs=0&enablejsapi=1&hl=${hl}&origin=${encodeURIComponent(location.origin)}${v.resumeAt ? `&start=${v.resumeAt}` : ''}`;
  }
  if (v.platform === 'bilibili' && v.playType === 'iframe')
    return `https://player.bilibili.com/player.html?${v.vid.startsWith('av') ? 'aid=' + v.vid.slice(2) : 'bvid=' + v.vid}&page=${v.page || 1}&autoplay=1&danmaku=0&high_quality=1${v.resumeAt ? `&t=${v.resumeAt}` : ''}`;
  return v.embed;
}

// 透明遮罩：挡住播放器中会跳转到原网站的 Logo / 标题区域
const SHIELDS = {
  youtube: ['top', 'yt-logo'],
  bilibili: ['top'],
  default: ['top'],
};

// 每个网站单独设置是否用沙箱；默认只有 YouTube 开启（旧版的"全部开启"选项迁移为每个网站都开）
const SANDBOX_SITES = ['youtube', 'bilibili', 'qq', 'youku', 'vimeo', 'dailymotion', 'other'];
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
      box.dispatchEvent(new CustomEvent('kt-time', { detail: { t: Infinity, d: 1 } }));
      if (onEnded?.()) { cover.hidden = true; return; } // 有下一集：交给倒计时
      cover.innerHTML = `<div class="ended"><div class="big">${domi('hop', 64, t('domiName'))}</div><div>${t('ended')}</div><div class="row"><button class="btn primary" data-a="replay">${t('replay')}</button><a class="btn" href="#/">${t('back')}</a></div></div>`;
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
  let lastState = null, ytDur = 0;
  const onMsg = (e) => {
    if (e.source !== iframe.contentWindow) return;
    let d;
    try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    // 播放进度（用于播放记录）
    if (d?.event === 'infoDelivery' && typeof d.info?.currentTime === 'number') {
      if (d.info.duration) ytDur = d.info.duration;
      box.dispatchEvent(new CustomEvent('kt-time', { detail: { t: d.info.currentTime, d: ytDur } }));
    }
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
  // B 站：装了助手就用朵米片单自己的播放器（手机 Firefox 也能播、没有 B 站推荐、能自动播放下一集），取不到再用嵌入播放器
  if (v.platform === 'bilibili' && v.playType === 'iframe' && db.settings.biliNative !== false) {
    box.innerHTML = `<div class="msg"><div class="spin"></div><div>${t('loading')}</div></div>`;
    let src = null;
    try { if (await detectHelper(1500)) src = await R.biliStream(v); } catch {}
    if (!box.isConnected) return;
    if (src) return mountVideo(box, v, src, onEnded, () => mountIframe(box, v, onEnded));
  }
  if (v.playType === 'iframe') return mountIframe(box, v, onEnded);
  if (v.playType === 'bdpan') return mountBdpan(box, v, onEnded);
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
function mountVideo(box, v, src, onEnded, onFail, { forceHls = false, hlsConfig = {}, onHls } = {}) {
  box.innerHTML = `<video controls autoplay playsinline controlslist="nodownload" referrerpolicy="no-referrer" ${v.thumb ? `poster="${esc(v.thumb)}"` : ''}></video>`;
  const video = $('video', box);
  let played = false;
  video.addEventListener('loadedmetadata', () => {
    box.classList.toggle('portrait', video.videoHeight > video.videoWidth);
    if (v.resumeAt && v.resumeAt < video.duration - 8) video.currentTime = v.resumeAt;
  }, { once: false });
  video.addEventListener('playing', () => (played = true));
  video.addEventListener('ended', () => onEnded?.());
  if (onFail) video.addEventListener('error', () => { if (!played && box.isConnected) onFail(); });
  if (forceHls || (/\.m3u8(\?|$)/i.test(src) && !video.canPlayType('application/vnd.apple.mpegurl'))) {
    let hls = null, gone = false;
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js').then(() => {
      if (gone) return;
      hls = new window.Hls(typeof hlsConfig === 'function' ? hlsConfig(window.Hls) : hlsConfig);
      // 已经开始播放后出的严重错误：自动恢复（解码出错就重建解码器，网络出错就重新加载），而不是一直卡住
      let recovers = 0, lastRecover = 0;
      hls.on(window.Hls.Events.ERROR, (e, d) => {
        if (!d.fatal || !box.isConnected) return;
        if (!played) return onFail?.(d.details);
        const now = Date.now();
        if (now - lastRecover > 60000) recovers = 0;
        if (++recovers > 5) return onFail?.(d.details);
        lastRecover = now;
        if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else if (d.type === window.Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad(video.currentTime);
        else onFail?.(d.details);
      });
      onHls?.(hls, window.Hls);
      hls.loadSource(src);
      hls.attachMedia(video);
    });
    // 卡住看门狗：在播放、前面也有缓冲，但画面 3 秒没动 → 跳过小空隙 / 轻推一下 / 重建解码器
    let lastT = -1, still = 0, kicks = 0;
    const dog = setInterval(() => {
      const t = video.currentTime;
      if (!hls || !played || video.paused || video.ended || video.seeking || Math.abs(t - lastT) > 0.01) { lastT = t; still = 0; return; }
      if (++still < 3) return;
      still = 0;
      const b = video.buffered;
      for (let i = 0; i < b.length; i++) if (b.start(i) > t && b.start(i) - t < 3) { video.currentTime = b.start(i) + 0.05; return; }
      let ahead = false;
      for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.1 && b.end(i) > t + 0.5) ahead = true;
      if (!ahead) return; // 还在下载，交给 hls.js
      if (++kicks % 2) video.currentTime = t + 0.1;
      else { hls.recoverMediaError(); video.currentTime = t + 0.1; video.play().catch(() => {}); }
    }, 1000);
    return () => { gone = true; clearInterval(dog); hls?.destroy(); };
  }
  video.src = src;
  return () => { video.removeAttribute('src'); video.load(); };
}

// 百度网盘：助手取播放列表（m3u8），分片也由助手代取（网盘服务器不允许网页直接读取），在朵米片单播放器里播放
async function mountBdpan(box, v, onEnded) {
  const msg = (html) => (box.innerHTML = `<div class="msg">${html}</div>`);
  msg(`<div class="spin"></div><div>${t('loading')}</div>`);
  if (!(await detectHelper(1500))) return msg(`<div>${t('bdpanNeedHelper')}</div>`);
  let text;
  try {
    text = await R.bdpanStream(v.vid, 'M3U8_AUTO_720', (sec) => box.isConnected && sec && msg(`<div class="spin"></div><div>${t('bdpanWait', sec)}</div>`));
  } catch (e) {
    if (!box.isConnected) return;
    return msg(`<div>${esc(errText(e))}</div><a class="btn primary" href="#/parent/accounts">${t('tabAccounts')}</a>`);
  }
  if (!box.isConnected) return;
  // 百度每 4 分钟（换一个 ts 文件）标一次 DISCONTINUITY，但时间戳其实是连续的。
  // 留着它 hls.js 会在那里重置并重新初始化解码器，iPad 上就卡在 3:58 左右：去掉
  text = text.replace(/^#EXT-X-DISCONTINUITY[ \t]*\r?\n/gm, '');
  const listUrl = URL.createObjectURL(new Blob([text], { type: 'application/vnd.apple.mpegurl' }));
  const done = mountVideo(box, v, listUrl, onEnded, (why) => msg(`<div>${t('bdpanPlayFail')}</div><div style="opacity:.7;font-size:13px">${esc(why || '')}</div>`), {
    forceHls: true,
    hlsConfig: (Hls) => {
      const Base = Hls.DefaultConfig.loader;
      class ViaHelper extends Base {
        load(ctx, cfg, cb) {
          if (!/(^|\.)baidupcs\.com$/i.test(new URL(ctx.url, location.href).hostname)) return super.load(ctx, cfg, cb);
          const st = this.stats;
          st.loading.start = performance.now();
          let aborted = false;
          this.abort = () => { aborted = true; st.aborted = true; };
          R.bdpanFetch(ctx.url).then((data) => {
            if (aborted) return;
            st.loading.first = st.loading.end = performance.now();
            st.loaded = st.total = data.byteLength;
            cb.onSuccess({ url: ctx.url, data }, st, ctx, null);
          }, (err) => { if (!aborted) cb.onError({ code: 0, text: String(err?.message || err) }, ctx, null, st); });
        }
      }
      return { loader: ViaHelper, maxBufferLength: 30 };
    },
    // 百度转码视频的 PPS 参数不停变化，苹果设备解码会花屏、卡住：送进解码器前统一参数
    onHls: (hls, Hls) => hls.on(Hls.Events.BUFFER_CREATED, (e, d) => wrapSourceBuffer(d.tracks?.video?.buffer)),
  });
  return () => { done?.(); URL.revokeObjectURL(listUrl); };
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
  app.innerHTML = topbar() + `<main class="wrap rest"><div class="big">${domi('wave', 120, t('domiName'))}</div><h1>${t('restTitle')}</h1><p class="hint">${t('restBody')}</p>
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
  document.title = v.title + ' · ' + t('appName');
  const eps = v.series ? seriesEps(v.series.id) : [];
  const next = nextEpisode(v);
  // 右侧列表：合集 → 按集数；非合集 → 这个博主的全部视频，顺序和首页为该博主选的排序一致（当前视频高亮）；再列其他视频
  const ck = creatorKey(v);
  const creatorList = v.series ? [] : sortVideos(kidVideos().filter((x) => creatorKey(x) === ck), creatorSort(ck));
  const more = kidVideos()
    .filter((x) => x.id !== v.id && !(v.series && x.series?.id === v.series.id) && !creatorList.some((c) => c.id === x.id))
    .sort((a, b) => (creatorKey(a) === ck ? 0 : a.group === v.group ? 1 : 2) - (creatorKey(b) === ck ? 0 : b.group === v.group ? 1 : 2))
    .slice(0, 12);
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
        ${creatorList.length > 1 ? `<h3 class="side-title">${ICON.folder(16)} ${esc(v.author || '')} · ${t('sort_' + creatorSort(ck))}</h3>${creatorList.map((x) => videoCard(x, { current: x.id === v.id })).join('')}<h3 class="side-title">${t('moreVideos')}</h3>` : ''}
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
  // 播放记录：从上次的位置接着播（YouTube / B 站 / 直链视频能定位；其他网站的嵌入播放器只记录"看过"）
  const resumeAt = resumePoint(v.id);
  let moved = !resumeAt;
  const startPlayer = (at) => { unmount?.(); Promise.resolve(mountPlayer(box, { ...v, resumeAt: at }, onEnded)).then((fn) => (unmount = fn)); };
  startPlayer(resumeAt);
  if (!progressOf(v.id)) setProgress(v.id, 0, durSec(v.duration));
  else db.progress[v.id].at = Date.now();
  save();
  if (resumeAt) {
    const bar = document.createElement('div');
    bar.className = 'resume-bar';
    bar.innerHTML = `<span>${t('resumedFrom', fmtTime(resumeAt))}</span><button class="btn small" data-a="restart">${t('restart')}</button>`;
    $('section', app).insertBefore(bar, box.nextSibling);
    $('[data-a="restart"]', bar).onclick = () => { bar.remove(); moved = true; setProgress(v.id, 0, progressOf(v.id)?.d); save(); startPlayer(0); };
    setTimeout(() => bar.isConnected && bar.classList.add('fade'), 8000);
  }
  let lastSaved = 0;
  const track = (cur, dur) => {
    if (!(cur >= 0)) return;
    // 续播时播放器刚加载会先报 0 秒，别用它覆盖上次的位置
    if (!moved) { if (cur < 1) return; moved = true; }
    setProgress(v.id, cur, dur || progressOf(v.id)?.d || durSec(v.duration));
    if (Math.abs(cur - lastSaved) >= 5) { lastSaved = cur; save(); }
  };
  box.addEventListener('timeupdate', (e) => e.target.tagName === 'VIDEO' && track(e.target.currentTime, e.target.duration), true);
  box.addEventListener('kt-time', (e) => track(e.detail.t, e.detail.d));
  box.addEventListener('ended', () => { setProgress(v.id, Infinity, 1); save(); }, true);
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
// 站内通知（例如正式收费前 30 天的提醒）：只在家长管理里显示，每条只显示一次
function maybeShowNotice() {
  if (!S.syncOn()) return;
  S.serviceStatus().then((st) => {
    const n = st?.notice;
    if (!n?.id || db.settings.noticeSeen === n.id || !location.hash.startsWith('#/parent')) return;
    const text = (db.settings.lang === 'zh' ? n.zh : n.en) || n.zh || n.en;
    if (!text) return;
    db.settings.noticeSeen = n.id;
    save();
    modal(`<h2>${t('noticeTitle')}</h2><p class="confirm-body" style="white-space:pre-line">${esc(text)}</p>
      <div class="row confirm-acts"><button class="btn primary" data-a="close">${t('noticeOk')}</button></div>`, (dlg, close) => ($('[data-a="close"]', dlg).onclick = close));
  });
}
function renderParent(tab) {
  if (!TABS.includes(tab)) tab = 'add';
  setTimeout(maybeShowNotice, 500);
  app.innerHTML = `<header class="topbar"><a class="logo" href="#/" aria-label="${esc(t('appName'))}"><img src="icon.svg" alt=""><span>Domi<b>Buddy</b></span><span class="product">${t('product')}</span></a><span class="badge">${t('parentArea')}</span>
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
  if (series?.rename) db.videos.forEach((x) => { if (x.series?.id === series.id) x.series.title = series.title; });
  for (const v of list) {
    // 添加时填了合集名（rename）就用它；否则同一合集已改过名的，新加入的集沿用库里的名字
    const ser = series ? { id: series.id, title: series.rename ? series.title : db.videos.find((x) => x.series?.id === series.id)?.series.title || series.title, index: series.indexOf(v) } : undefined;
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
    <div class="platforms">${['youtube', 'bilibili', 'vimeo', 'iqiyi'].map((p) => `<span class="plat-${p}">${esc(platName(p))}</span>`).join('')}<span class="plat-other">${t('directLink')}</span>${['qq', 'youku', 'baidupan'].map((p) => `<span class="plat-${p}">${esc(platName(p))}<i class="plug" title="${t('plugTip')}">🔌</i></span>`).join('')}</div>
    <p class="hint plug-legend">${t('plugLegend')}</p>
    <div id="helper-tip"></div><div id="result"></div></div>`;
  bindGroupSelect($('#grp'));
  detectHelper().then((v) => {
    const tip = $('#helper-tip');
    if (v) document.querySelectorAll('.platforms .plug, .plug-legend').forEach((x) => x.remove());
    else if (tip) tip.innerHTML = `<p class="hint" style="margin-top:14px">${t('helperMissingTip')} <a href="#/parent/accounts">${t('helperSetup')}</a></p>`;
  });
  const input = $('#url');
  // 粘贴的分享文案前后常带有文字：自动提取其中的网址，并记下文案里的标题
  // 一次粘贴多个链接（片单）：输入框是单行的，换行会被浏览器去掉，所以直接读剪贴板里的原文，保留每条链接前面的标题
  let batch = null;
  const showFound = () => { $('#result').innerHTML = `<p class="hint" style="margin-top:16px">${t('batchFound', batch.links.length)}</p>`; };
  const tidy = () => {
    const raw = input.value.trim();
    if (batch && raw === batch.shown) return null;
    batch = null;
    const links = R.extractLinks(raw);
    if (links.length > 1) {
      batch = { links, shown: links.map((l) => l.url).join(' ') };
      input.value = batch.shown;
      showFound();
      return null;
    }
    const { url, title } = R.extractLink(raw);
    if (url !== raw) { input.value = url; sharedTitle = title; }
    return url;
  };
  input.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') || '';
    const links = R.extractLinks(text);
    if (links.length > 1) {
      e.preventDefault();
      batch = { links, shown: links.map((l) => l.url).join(' ') };
      input.value = batch.shown;
      sharedTitle = '';
      showFound();
      return;
    }
    setTimeout(tidy, 0);
  });
  const go = async () => {
    const url = tidy();
    if (batch) return showBatch($('#result'), batch.links);
    if (!url) return;
    const out = $('#result');
    out.innerHTML = `<div class="row" style="margin-top:20px"><div class="spin dark"></div>${t('parsing')}</div>`;
    try {
      const data = await api({ url });
      // 网盘文件夹里的子文件夹：显示成按钮，点了就打开那个子文件夹
      const subs = data.subfolders?.length ? `<div class="subfolders"><div class="hint">${t(data.kind === 'folders' ? 'bdpanOnlyFolders' : 'bdpanSubfolders', data.title || data.author || '')}</div>
        <div class="row">${data.subfolders.map((f) => `<button class="btn small" data-sub="${esc(f.url)}">${ICON.folder(16)} ${esc(f.name)}</button>`).join('')}</div></div>` : '';
      if (data.kind === 'folders') out.innerHTML = subs;
      else {
        const box = document.createElement('div');
        out.innerHTML = subs;
        out.appendChild(box); // 先放进页面：showSingle / showCreator 按 id 查找里面的元素
        if (data.kind === 'video') showSingle(box, data.video, data.manual && !sharedTitle, sharedTitle, data);
        else showCreator(box, url, data);
      }
      out.querySelectorAll('[data-sub]').forEach((b) => (b.onclick = () => { input.value = b.dataset.sub; go(); }));
    } catch (e) {
      out.innerHTML = `<p class="warn" style="margin-top:16px">${t('parseFail')}${esc(errText(e))}</p>`;
    }
  };
  $('#go').onclick = go;
  // 注意：onkeydown 处理函数返回 false 会取消按键（导致无法删除文字），所以不能写成 `cond && go()`
  input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  input.oninput = () => { if (!input.value) sharedTitle = ''; if (batch && input.value.trim() !== batch.shown) batch = null; };
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
// 片单：逐个解析（同时最多 3 个），单个视频放进勾选列表；频道、合集链接和解析失败的列在下面
async function showBatch(out, links) {
  const videos = new Array(links.length), skipped = [];
  let done = 0, next = 0;
  const progress = () => { out.innerHTML = `<div class="row" style="margin-top:20px"><div class="spin dark"></div>${t('batchParsing', Math.min(done + 1, links.length), links.length)}</div>`; };
  progress();
  const work = async () => {
    while (next < links.length) {
      const i = next++, { url, title } = links[i];
      try {
        const d = await api({ url });
        if (d.kind !== 'video') skipped.push({ url, why: t('batchIsList') });
        else videos[i] = { ...d.video, title: d.video.title || title || `${platName(d.video.platform)} · ${d.video.vid}` };
      } catch (e) {
        skipped.push({ url, why: errText(e) });
      }
      done++;
      if (out.isConnected && done < links.length) progress();
    }
  };
  await Promise.all([work(), work(), work()]);
  if (!out.isConnected) return;
  const list = videos.filter(Boolean);
  out.innerHTML = '';
  if (list.length) {
    const box = document.createElement('div');
    out.appendChild(box);
    showCreator(box, null, { heading: t('batchHeading', list.length), videos: list, next: null, total: list.length, selectAll: true });
  }
  if (skipped.length) {
    const p = document.createElement('div');
    p.className = 'warn';
    p.style.marginTop = '16px';
    p.innerHTML = `${t('batchSkipped', skipped.length)}<ul style="margin:6px 0 0;padding-left:20px">${skipped.map((s) => `<li style="word-break:break-all">${esc(s.url)} — ${esc(s.why)}</li>`).join('')}</ul>`;
    out.appendChild(p);
  }
}
const canHaveCreator = (v) => !!v.authorUrl || v.platform === 'youtube' || (v.platform === 'bilibili' && /^(BV|av)/.test(v.vid));

function showCreator(out, url, data) {
  const items = [...data.videos];
  const chosen = new Set();
  const keyOf = (v) => v.vid + (v.page ? '#' + v.page : '');
  const col = data.collection;
  if (col || data.selectAll) items.forEach((v) => !exists(v) && chosen.add(keyOf(v))); // 合集、片单默认全选
  let next = data.next, loading = false;
  out.innerHTML = `<h3>${col ? ICON.folder(18) + ' ' + esc(t('collectionTitle', col.title)) : esc(data.heading || t('creatorVideos', data.author))} <span class="badge" id="cnt"></span></h3>
    ${col ? `<div class="row series-opts" style="margin-bottom:10px"><label class="inline"><input type="checkbox" id="as-series" checked> ${t('asSeries')}</label>
      <label class="grow series-name">${t('seriesName')}<input class="field" id="series-name" value="${esc(db.videos.find((x) => x.series?.id === col.id)?.series.title || col.title)}" style="padding:8px 12px"></label></div>` : ''}
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
  if ($('#as-series')) $('#as-series').onchange = (e) => ($('#series-name').disabled = !e.target.checked);
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
      asSeries ? { id: col.id, title: $('#series-name')?.value.trim() || col.title, rename: true, indexOf: (v) => items.indexOf(v) } : undefined);
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

// ------------------------------------------------------------ 分享片单
// 片单（视频编号、标题、封面、合集结构）压缩后直接放进链接：打开链接就能预览、导入、播放，不需要助手，也不经过服务器。
// 百度网盘是家长自己网盘里的文件，不能分享；小红书 / 抖音已不再支持。
const shareable = (v) => !['baidupan', ...RETIRED].includes(v.platform) && !['bdpan', 'xhs'].includes(v.playType);
function packVideo(v, slim) {
  const o = { p: v.platform, v: v.vid };
  if (v.page) o.pg = v.page;
  if (v.playType && v.playType !== 'iframe') o.pt = v.playType;
  if (v.title) o.t = v.title;
  if (v.duration) o.d = v.duration;
  if (!['youtube', 'bilibili'].includes(v.platform) && v.url) o.u = v.url;
  if (v.embed) o.e = v.embed;
  if (v.src) o.s = v.src;
  if (v.series) o.sr = [v.series.id, v.series.title, v.series.index];
  if (!slim) {
    if (v.author) o.a = v.author;
    if (v.authorUrl) o.au = v.authorUrl;
    if (v.thumb && v.platform !== 'youtube') o.th = v.thumb;
  }
  return o;
}
function unpackVideo(o) {
  const v = { platform: o.p, vid: o.v, playType: o.pt || 'iframe', title: o.t || '', author: o.a || '', duration: o.d || '', thumb: o.th || '' };
  if (o.pg) v.page = o.pg;
  if (o.e) v.embed = o.e;
  if (o.s) v.src = o.s;
  if (o.au) v.authorUrl = o.au;
  if (o.sr) v.series = { id: o.sr[0], title: o.sr[1], index: o.sr[2] };
  if (v.platform === 'youtube') {
    v.url = `https://www.youtube.com/watch?v=${v.vid}`;
    v.thumb = `https://i.ytimg.com/vi/${v.vid}/hqdefault.jpg`;
  } else if (v.platform === 'bilibili' && /^(BV|av)/.test(v.vid)) {
    v.url = `https://www.bilibili.com/video/${v.vid}${v.page > 1 ? '?p=' + v.page : ''}`;
  } else v.url = o.u || o.s || '';
  return v;
}
const b64url = (bytes) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function pipeBytes(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
// 格式：'1' + deflate 压缩后的 base64url；浏览器不支持压缩时用 '0' + 未压缩的 base64url
async function encodeList(list) {
  const json = new TextEncoder().encode(JSON.stringify(list));
  if (typeof CompressionStream === 'function') return '1' + b64url(await pipeBytes(json, new CompressionStream('deflate-raw')));
  return '0' + b64url(json);
}
async function decodeList(s) {
  const raw = unb64url(s.slice(1));
  const bytes = s[0] === '1' ? await pipeBytes(raw, new DecompressionStream('deflate-raw')) : raw;
  const d = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(d?.i)) throw new Error('bad list');
  return { title: String(d.n || '').slice(0, 80), videos: d.i.filter((o) => o && o.p && o.v).map(unpackVideo).filter(shareable) };
}
// 短链接：片单内容（公开信息，不含家庭信息）保存到服务器，得到 lists.domibuddy.com/l/xxxxxxxx
const LISTS_API = 'https://api.domibuddy.com/v1/lists';
const shortCache = new Map();
async function shortLink(code, title, videos) {
  const key = code + '|' + title;
  if (shortCache.has(key)) return shortCache.get(key);
  try {
    const thumb = videos.map((v) => v.thumb).find((u) => /^https:\/\//.test(u || '')) || '';
    const r = await fetch(LISTS_API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, title, count: videos.length, thumb }) });
    if (!r.ok) return null;
    const { id } = await r.json();
    const url = `https://lists.domibuddy.com/l/${id}`;
    shortCache.set(key, url);
    return url;
  } catch { return null; }
}
const shareUrl = (code) => `${location.origin}${location.pathname}#/import/${code}`;
const QR_MAX = 1800; // 再长的二维码手机很难扫出来
async function qrSvg(text) {
  await loadScript(new URL('vendor/qrcode.js', location.href).href);
  const qr = window.qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function shareDialog(videos, defaultTitle) {
  const ok = videos.filter(shareable);
  const skipped = videos.length - ok.length;
  modal(`<h2>${t('shareTitle')}</h2>
    <p class="hint">${t('shareHint', ok.length)}${skipped ? ' ' + t('shareSkipped', skipped) : ''}</p>
    <label class="share-label">${t('shareName')}<input class="field" id="sh-name" value="${esc(defaultTitle)}" maxlength="80"></label>
    <div class="share-qr" id="sh-qr"></div>
    <p class="hint share-qr-note" id="sh-qrnote"></p>
    <textarea class="field share-link" id="sh-link" readonly rows="2"></textarea>
    <p class="hint" id="sh-shortnote" style="margin:6px 0 0"></p>
    <div class="row confirm-acts"><button class="btn" data-a="close">${t('close')}</button>${navigator.share ? `<button class="btn" id="sh-native">${t('shareSystem')}</button>` : ''}<button class="btn primary" id="sh-copy">${t('copyLink')}</button></div>`, (dlg, close) => {
    let link = '', seq = 0;
    const build = async () => {
      const my = ++seq;
      const n = $('#sh-name', dlg).value.trim() || defaultTitle;
      const code = await encodeList({ n, i: ok.map((v) => packVideo(v)) });
      // 优先用短链接（微信等聊天软件里能显示标题和封面的预览卡片）；连不上服务器时用长链接
      $('#sh-link', dlg).value = t('shareMaking');
      const short = await shortLink(code, n, ok);
      if (my !== seq) return;
      link = short || shareUrl(code);
      $('#sh-link', dlg).value = link;
      $('#sh-shortnote', dlg).textContent = short ? t('shareShortHint') : t('shareLongHint');
      // 二维码：完整链接太长时去掉封面和频道名（导入后会自动补上封面），还是太长就提示分成几个小片单
      let qrLink = link.length <= QR_MAX ? link : shareUrl(await encodeList({ n, i: ok.map((v) => packVideo(v, true)) }));
      if (qrLink.length > QR_MAX) {
        $('#sh-qr', dlg).innerHTML = '';
        $('#sh-qrnote', dlg).textContent = t('shareQrTooLong');
      } else {
        try { $('#sh-qr', dlg).innerHTML = await qrSvg(qrLink); $('#sh-qrnote', dlg).textContent = t('shareQrHint'); }
        catch { $('#sh-qr', dlg).innerHTML = ''; $('#sh-qrnote', dlg).textContent = ''; }
      }
    };
    let timer;
    $('#sh-name', dlg).oninput = () => { clearTimeout(timer); timer = setTimeout(build, 800); };
    $('[data-a="close"]', dlg).onclick = close;
    $('#sh-copy', dlg).onclick = async () => {
      try { await navigator.clipboard.writeText(link); } catch { $('#sh-link', dlg).select(); document.execCommand('copy'); }
      toast(t('linkCopied'));
    };
    if ($('#sh-native', dlg)) $('#sh-native', dlg).onclick = () => navigator.share({ title: $('#sh-name', dlg).value, url: link }).catch(() => {});
    build();
  });
}

// 打开分享链接：预览片单，家长输入密码后导入
// 短链接 #/s/<id>：从服务器取回片单再显示导入页
async function renderShort(id) {
  app.innerHTML = topbar() + `<main class="wrap rest"><div class="spin dark" style="margin:40px auto"></div></main>`;
  bindTopbar();
  try {
    const r = await fetch(`${LISTS_API}/${encodeURIComponent(id || '')}`);
    if (!r.ok) throw new Error();
    const d = await r.json();
    return renderImport(d.code, id);
  } catch { return renderImport('', id); }
}
async function renderImport(code, listId) {
  let list;
  try { list = await decodeList(code || ''); } catch { list = null; }
  if (!list || !list.videos.length) {
    app.innerHTML = topbar() + `<main class="wrap rest"><div class="big">${domi('idle', 100, t('domiName'))}</div><h1>${t('importBad')}</h1><a class="btn" href="#/">${t('back')}</a></main>`;
    return bindTopbar();
  }
  const title = list.title || t('sharedList');
  document.title = title + ' · ' + t('appName');
  const fresh = list.videos.filter((v) => !exists(v));
  app.innerHTML = topbar() + `<main class="wrap import">
    <div class="import-head">${domi('hop', 64, t('domiName'))}<div><h1>${esc(title)}</h1>
      <p class="hint" style="margin:0">${t('importCount', list.videos.length)}${fresh.length < list.videos.length ? ' · ' + t('importHave', list.videos.length - fresh.length) : ''}</p></div></div>
    <div class="panel"><div class="row">
      <label class="grow import-group">${t('importTo')}<select class="field" id="im-group">
        <option value="__new">${esc(t('newGroupNamed', title))}</option>${db.groups.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}</select></label>
      <button class="btn primary" id="im-go" ${fresh.length ? '' : 'disabled'}>${fresh.length ? t('importN', fresh.length) : t('importAllHave')}</button></div>
      <p class="hint" style="margin:10px 0 0">${t('importNote')}</p></div>
    <div class="grid">${list.videos.map((v) => `<div class="card static"><div class="thumb">${thumbImg(v)}<span class="plat plat-${v.platform}">${esc(platName(v.platform))}</span>${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ''}</div><div class="body"><div class="title">${esc(v.title || platName(v.platform))}</div><div class="sub">${esc(v.author || '')}</div></div></div>`).join('')}</div>
  </main>`;
  bindTopbar();
  $('#im-go').onclick = async () => {
    if (!(await unlockParent())) return;
    let group = $('#im-group').value;
    if (group === '__new') {
      group = title;
      if (!db.groups.includes(group)) db.groups.push(group);
    }
    const added = fresh.filter((v) => !exists(v)).map((v) => ({ ...v, id: uid(), group, addedAt: Date.now() }));
    db.videos.unshift(...added);
    save();
    toast(t('importedN', added.length));
    if (listId) fetch(`${LISTS_API}/${encodeURIComponent(listId)}/imported`, { method: 'POST' }).catch(() => {});
    location.hash = '#/';
    backfillThumbs(added);
  };
}
// 二维码里的精简片单没有封面：B 站封面通过 JSONP 接口补上（不需要助手）
async function backfillThumbs(list) {
  for (const v of list.filter((x) => !x.thumb && x.platform === 'bilibili' && /^(BV|av)/.test(x.vid))) {
    try {
      const r = await R.resolve({ url: v.url });
      const stored = db.videos.find((x) => x.id === v.id);
      if (stored && r.video?.thumb) { stored.thumb = r.video.thumb; stored.author ||= r.video.author || ''; save(); }
    } catch {}
    await new Promise((ok) => setTimeout(ok, 300));
  }
  if (!location.hash || location.hash === '#/') route();
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
        <div class="s">${esc(v.author || '')} · ${esc(platName(v.platform))}${v.series ? ` · <button class="link-btn" data-series="${esc(v.series.id)}" title="${t('renameSeries')}">${ICON.folder(13)} ${esc(v.series.title)} ✎</button> ${t('epOfN', epNo(v), seriesEps(v.series.id).length)}` : ''} · <a href="${esc(v.url)}" target="_blank" rel="noopener">${t('original')}</a></div></td>
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
  const nudge = !S.syncOn() && db.videos.length >= 10 && Date.now() - (db.settings.backupNudgeAt || 0) > 14 * 864e5;
  el.innerHTML = `${nudge ? `<div class="panel nudge"><div class="row"><div class="grow"><b>${t('nudgeTitle')}</b><p class="hint" style="margin:4px 0 0">${t('nudgeBody', db.videos.length)}</p></div></div>
      <div class="row" style="margin-top:10px"><a class="btn primary small" href="#/parent/settings">${t('syncEnable')}</a><button class="btn small" id="nudge-export">${t('exportBtn')}</button><div class="spacer"></div><button class="btn small" id="nudge-later">${t('later')}</button></div></div>` : ''}
    <div class="panel"><h2>${t('libTitle')} <span class="badge" id="libcnt"></span></h2>
    <p class="hint">${t('libHint')}</p>
    <div class="row" style="margin-bottom:10px">
      <select class="field" id="lg" style="width:auto"></select>
      <select class="field" id="lc" style="width:auto"></select>
      <input class="field grow" id="lq" placeholder="${t('libSearch')}">
      <button class="btn small" id="newg">${t('manageGroups')}</button><button class="btn danger small" id="delall">${t('clearAll')}</button>
      <button class="btn primary small" id="share">${ICON.share(16)} ${t('shareList')}</button></div>
    <div class="row bulk" style="margin-bottom:6px">
      <button class="btn small" id="selall"></button><button class="btn small" id="selnone">${t('selectNone')}</button>
      <div class="spacer"></div><button class="btn danger-solid small" id="delsel"></button></div>
    <div class="table-wrap"><table class="lib"><tbody id="libbody"></tbody></table></div></div>`;
  if (libGroup !== ALL && !db.groups.includes(libGroup)) libGroup = ALL;
  if ($('#nudge-export')) $('#nudge-export').onclick = () => { exportBackup(); db.settings.backupNudgeAt = Date.now(); save(); };
  if ($('#nudge-later')) $('#nudge-later').onclick = () => { db.settings.backupNudgeAt = Date.now(); save(); $('.nudge')?.remove(); };
  refresh();
  $('#lg').onchange = (e) => { libGroup = e.target.value; libCreator = ALL; drawCreators(); draw(); };
  // 分享：勾选了视频就分享勾选的，否则分享当前筛选出来的
  $('#share').onclick = () => {
    const list = sel.size ? db.videos.filter((v) => sel.has(v.id)) : filtered();
    if (!list.length) return toast(t('shareEmpty'));
    const cname = libCreator !== ALL ? creatorsOf(list).find((c) => c.key === libCreator)?.name : '';
    shareDialog(list, libGroup !== ALL ? libGroup : cname || t('myList'));
  };
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
    // 改合集名：同一合集的所有集一起改，首页合集卡片和播放页都用新名字
    const sb = e.target.closest('[data-series]');
    if (sb) {
      const id = sb.dataset.series;
      const cur = db.videos.find((x) => x.series?.id === id)?.series.title || '';
      const name = prompt(t('renameSeriesPrompt'), cur)?.trim();
      if (!name || name === cur) return;
      db.videos.forEach((x) => { if (x.series?.id === id) x.series.title = name; });
      save();
      refresh();
      return toast(t('seriesRenamed', name));
    }
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
  { key: 'baidupan', url: 'https://pan.baidu.com/', color: '#06a7ff' },
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
  // 百度网盘：登录状态接口，未登录时 errno -6
  baidupan: async () => {
    const j = JSON.parse((await helperRequest({ url: 'https://pan.baidu.com/api/loginStatus?clienttype=0&web=1', headers: { referer: 'https://pan.baidu.com/disk/main' } })).data);
    return j.errno === 0 ? { in: true, name: j.login_info?.username } : j.errno === -6 ? { in: false } : null;
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
    <div class="steps">${helperGuide()}<p class="hint">${t('helperStepsMore')}</p></div>
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
  const lines = [`DomiBuddy Lists ${location.origin}`, `UA: ${navigator.userAgent}`];
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

// ------------------------------------------------------------ 多设备同步
let syncState = { state: S.syncOn() ? 'idle' : 'off' };
const fmtSyncTime = (ms) => (ms ? new Date(ms).toLocaleString(db.settings.lang === 'zh' ? 'zh-CN' : 'en', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
function syncStatusText() {
  const st = syncState;
  if (st.state === 'syncing') return t('syncBusy');
  if (st.state === 'error') return t('syncErr', st.error || '');
  if (st.state === 'gone') return t('syncGone');
  return t('syncLast', fmtSyncTime(S.syncInfo()?.at));
}
function syncPanel() {
  if (!S.syncSupported()) return `<div class="panel"><h2>${t('syncTitle')}</h2><p class="hint">${t('syncNeedHttps')}</p></div>`;
  if (!S.syncOn()) return `<div class="panel"><h2>${t('syncTitle')} <span class="badge">${t('syncBeta')}</span></h2>
    <p class="hint">${t('syncIntro')}</p>
    <div class="beta-rules"><b>${t('betaRulesTitle')}</b><ul>${t('betaRules').map((x) => `<li>${x}</li>`).join('')}</ul></div>
    <p class="hint" id="sync-seats"></p>
    <div class="row"><button class="btn primary" id="sync-on">${t('syncEnable')}</button><a class="btn" href="#/recover">${t('recoverLink')}</a></div></div>`;
  const parent = S.isParentDevice();
  return `<div class="panel"><h2>${t('syncTitle')} <span class="badge ok">${t('syncIsOn')}</span> <span class="badge">${parent ? t('roleParent') : t('roleChild')}</span>${S.syncInfo()?.beta ? ` <span class="badge">${t('betaFamily')}</span>` : ''}</h2>
    <p class="hint" id="sync-status">${esc(syncStatusText())}</p>
    ${parent ? `<h3>${t('devTitle')}</h3><div id="sync-devices" class="device-list"><p class="hint">${t('devLoading')}</p></div>` : `<p class="hint">${t('devChildNote')}</p>`}
    <div class="row">${parent ? `<button class="btn primary" id="sync-add">${t('syncAddDevice')}</button><button class="btn" id="sync-rc">${t('rcButton')}</button>` : ''}<button class="btn" id="sync-now">${t('syncNow')}</button>
      <div class="spacer"></div><button class="btn small" id="sync-leave">${t('syncLeave')}</button>${parent ? `<button class="btn danger small" id="sync-del">${t('syncDelete')}</button>` : ''}</div></div>`;
}
async function drawDevices(el) {
  const box = $('#sync-devices', el);
  if (!box) return;
  let d;
  try { d = await S.listDevices(); } catch (e) { box.innerHTML = `<p class="warn">${esc(t('syncErr', e.message))}</p>`; return; }
  if (!box.isConnected) return;
  box.innerHTML = d.devices.map((v) => `<div class="device-row" data-id="${esc(v.id)}">
      <div class="grow"><div class="device-name">${esc(v.name)}${v.id === d.self ? ` <span class="badge ok">${t('devThis')}</span>` : ''}</div>
        <div class="hint" style="margin:0">${v.role === 'parent' ? t('roleParent') : t('roleChild')} · ${t('devLastSeen', fmtSyncTime(v.lastSeen))}</div></div>
      <button class="btn small" data-rename>${t('devRename')}</button>${v.id === d.self ? '' : `<button class="btn danger small" data-remove>${t('devRemove')}</button>`}</div>`).join('')
    + (d.devices.filter((v) => v.role === 'parent').length < 2 ? `<div class="tip-row"><span class="grow">${t('devOneParent')}</span><button class="btn small" id="add-parent">${t('pairParent')}</button></div>` : '');
  if ($('#add-parent', box)) $('#add-parent', box).onclick = () => showPairDialog('parent');
  box.querySelectorAll('[data-rename]').forEach((b) => (b.onclick = () => {
    const row = b.closest('.device-row'), cur = d.devices.find((x) => x.id === row.dataset.id);
    modal(`<h2>${t('devRename')}</h2><input class="field" id="dev-name" maxlength="40" value="${esc(cur.name)}">
      <div class="row confirm-acts"><button class="btn" data-a="close">${t('cancel')}</button><button class="btn primary" id="dev-save">${t('save')}</button></div>`, (dlg, close) => {
      $('#dev-name', dlg).focus();
      $('[data-a="close"]', dlg).onclick = close;
      $('#dev-save', dlg).onclick = async () => {
        try { await S.renameDevice(cur.id, $('#dev-name', dlg).value.trim()); close(); drawDevices(el); } catch (e) { toast(t('syncErr', e.message)); }
      };
    });
  }));
  box.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = () => {
    const cur = d.devices.find((x) => x.id === b.closest('.device-row').dataset.id);
    modal(`<h2>${t('devRemoveTitle', cur.name)}</h2><p class="confirm-body">${t('devRemoveBody')}</p>
      <label class="inline" style="margin:4px 0 8px"><input type="checkbox" id="dev-wipe" checked> ${t('devWipe')}</label>
      <p class="hint">${t('devWipeHint')}</p>
      <div class="row confirm-acts"><button class="btn" data-a="close">${t('cancel')}</button><button class="btn danger-solid" id="dev-rm">${t('devRemove')}</button></div>`, (dlg, close) => {
      $('[data-a="close"]', dlg).onclick = close;
      $('#dev-rm', dlg).onclick = async () => {
        try { await S.removeDevice(cur.id, $('#dev-wipe', dlg).checked); close(); toast(t('devRemoved', cur.name)); drawDevices(el); } catch (e) { toast(t('syncErr', e.message)); }
      };
    });
  }));
}
const syncErrText = (m) => ({ beta_full: t('betaFull'), closed: t('betaClosed'), too_many_requests: t('tooMany') })[m] || t('syncErr', m);
function bindSyncPanel(el) {
  const on = (id, fn) => { const b = $('#' + id, el); if (b) b.onclick = fn; };
  drawDevices(el);
  if ($('#sync-on', el)) S.serviceStatus().then((st) => {
    const seats = $('#sync-seats', el), btn = $('#sync-on', el);
    if (!st || !seats || !btn) return;
    if (!st.open) {
      btn.disabled = true;
      btn.textContent = st.reason === 'beta_full' ? t('betaFullBtn') : t('betaClosedBtn');
      seats.innerHTML = `${st.reason === 'beta_full' ? t('betaFull') : t('betaClosed')} ${t('betaMeanwhile')}`;
    } else if (st.remaining != null) seats.textContent = t('betaSeats', st.remaining);
  });
  on('sync-on', async (e) => {
    e.currentTarget.disabled = true;
    let code;
    const btn = e.currentTarget;
    try { code = await S.enableSync(); } catch (err) { toast(syncErrText(err.message)); btn.disabled = false; return; }
    renderParent('settings');
    if (code) showRecoveryDialog(code, () => showPairDialog());
    else showPairDialog();
  });
  on('sync-add', () => showPairDialog());
  on('sync-rc', async () => {
    const code = S.recoveryCode();
    if (code) return showRecoveryDialog(code);
    try { showRecoveryDialog(await S.newRecoveryCode()); } catch (err) { toast(t('syncErr', err.message)); }
  });
  on('sync-now', async () => { await S.syncNow(); toast(syncState.state === 'error' ? syncStatusText() : t('syncDone')); });
  on('sync-leave', async () => {
    if (!(await confirmBox({ title: t('syncLeave'), body: t('syncLeaveBody'), ok: t('syncLeave') }))) return;
    await S.leaveSync(); syncState = { state: 'off' }; renderParent('settings');
  });
  on('sync-del', async () => {
    if (!(await confirmBox({ title: t('syncDelete'), body: t('syncDeleteBody'), ok: t('syncDelete') }))) return;
    toast((await S.deleteCloud()) ? t('syncDeleted') : t('syncErr', ''));
    syncState = { state: 'off' }; renderParent('settings');
  });
}
// 添加设备：先选是孩子的设备还是家长的另一台设备，再生成一次性邀请二维码
function showPairDialog(preset) {
  modal(`<h2>${t('syncAddDevice')}</h2><p class="hint">${t('pairWhich')}</p>
    <div class="pair-roles"><button class="btn primary" data-role="child">${t('pairChild')}</button><button class="btn" data-role="parent">${t('pairParent')}</button></div>
    <div id="pair-out"></div>
    <div class="row confirm-acts"><button class="btn" data-a="close">${t('close')}</button></div>`, (dlg, close) => {
    $('[data-a="close"]', dlg).onclick = close;
    dlg.querySelectorAll('[data-role]').forEach((b) => (b.onclick = async () => {
      dlg.querySelectorAll('[data-role]').forEach((x) => x.classList.toggle('primary', x === b));
      const out = $('#pair-out', dlg);
      out.innerHTML = `<p class="hint">${t('devLoading')}</p>`;
      let inv;
      try { inv = await S.createInvite(location.origin + location.pathname, b.dataset.role); } catch (e) { out.innerHTML = `<p class="warn">${esc(t('syncErr', e.message))}</p>`; return; }
      out.innerHTML = `<p class="hint">${t(inv.role === 'parent' ? 'pairHintParent' : 'pairHintChild')}</p><div class="share-qr" id="pair-qr"></div>
        <p class="hint share-qr-note">${t('pairOnce', fmtSyncTime(inv.expiresAt))}</p>
        <p class="warn" style="margin:8px 0">${t('syncPairWarn')}</p>
        <div class="row" style="justify-content:center"><button class="btn" id="pair-copy">${t('copyLink')}</button></div>`;
      qrSvg(inv.link).then((svg) => ($('#pair-qr', dlg).innerHTML = svg)).catch(() => {});
      $('#pair-copy', dlg).onclick = async () => { try { await navigator.clipboard.writeText(inv.link); toast(t('linkCopied')); } catch { toast(inv.link); } };
    }));
    if (preset) dlg.querySelector(`[data-role="${preset}"]`)?.click();
  });
}
// 恢复码：开启同步时显示一次，之后在设置里可以查看或重新生成
function showRecoveryDialog(code, after) {
  modal(`<h2>${t('rcTitle')}</h2><p class="hint">${t('rcIntro')}</p>
    <div class="rc-code" id="rc-code">${esc(code)}</div>
    <div class="row" style="justify-content:center"><button class="btn" id="rc-copy">${t('rcCopy')}</button><button class="btn" id="rc-dl">${t('rcDownload')}</button></div>
    <p class="warn" style="margin:12px 0">${t('rcWarn')}</p>
    <div class="row confirm-acts"><button class="btn small" id="rc-new">${t('rcRegen')}</button><div class="spacer"></div><button class="btn primary" id="rc-ok">${t('rcSaved')}</button></div>`, (dlg, close) => {
    const done = () => { close(); after?.(); };
    $('#rc-ok', dlg).onclick = done;
    $('#rc-copy', dlg).onclick = async () => { try { await navigator.clipboard.writeText(code); toast(t('rcCopied')); } catch { toast(code); } };
    $('#rc-dl', dlg).onclick = () => {
      const text = `${t('rcFileTitle')}\n\n${code}\n\n${t('rcFileBody')}\nhttps://lists.domibuddy.com/#/recover\n`;
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: 'domibuddy-recovery-code.txt' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('#rc-new', dlg).onclick = async () => {
      if (!(await confirmBox({ title: t('rcRegen'), body: t('rcRegenBody'), ok: t('rcRegen') }))) return;
      try { code = await S.newRecoveryCode(); $('#rc-code', dlg).textContent = code; toast(t('rcRegenDone')); } catch (err) { toast(t('syncErr', err.message)); }
    };
  });
}
// 用恢复码找回：新设备（或重置后的设备）恢复成家长设备
function renderRecover() {
  app.innerHTML = topbar() + `<main class="wrap rest"><div class="big">${domi('wave', 100, t('domiName'))}</div>
    <h1>${t('recoverTitle')}</h1><p class="hint">${t('recoverBody')}</p>
    ${S.syncSupported() ? `<div class="recover-form"><input class="field" id="rc-in" placeholder="DOMI-XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false">
      <button class="btn primary" id="rc-go">${t('recoverGo')}</button></div>
      ${S.syncOn() ? `<p class="warn">${t('recoverReplace')}</p>` : ''}` : `<p class="warn">${t('syncNeedHttps')}</p>`}
    <p style="margin-top:18px"><a href="#/">${t('back')}</a></p></main>`;
  bindTopbar();
  if (!$('#rc-go')) return;
  const go = async () => {
    const v = $('#rc-in').value;
    if (!S.normalizeRecovery(v)) return toast(t('recoverBad'));
    if (db.settings.pinHash && !(await unlockParent())) return;
    const btn = $('#rc-go');
    btn.disabled = true; btn.textContent = t('recoverBusy');
    try {
      if (S.syncOn()) await S.leaveSync();
      await S.recoverWithCode(v);
      toast(t('recoverDone'));
      location.hash = '#/';
    } catch (err) {
      btn.disabled = false; btn.textContent = t('recoverGo');
      toast(err.message === 'not_found' || err.message === 'bad_code' ? t('recoverNotFound') : err.message === 'too_many_attempts' ? t('recoverTooMany') : t('syncErr', err.message));
    }
  };
  $('#rc-go').onclick = go;
  $('#rc-in').onkeydown = (e) => { if (e.key === 'Enter') go(); };
}
// 打开配对链接：本设备用邀请加入家长的同步片单
async function renderPair(code) {
  history.replaceState(null, '', location.pathname + location.search + '#/pair'); // 密钥和邀请不留在地址栏和历史记录里
  const already = S.syncOn();
  app.innerHTML = topbar() + `<main class="wrap rest"><div class="big">${domi('wave', 100, t('domiName'))}</div>
    <h1>${t('pairTitle')}</h1><p class="hint">${already ? t('pairAlready') : t('pairBody', db.videos.length)}</p>
    <div class="row" style="justify-content:center"><a class="btn" href="#/">${t('cancel')}</a>${!code || !S.syncSupported() ? '' : `<button class="btn primary" id="pair-go">${t('pairJoin')}</button>`}</div>
    ${S.syncSupported() ? '' : `<p class="warn">${t('syncNeedHttps')}</p>`}</main>`;
  bindTopbar();
  if (!$('#pair-go')) return;
  $('#pair-go').onclick = async (e) => {
    if (db.settings.pinHash && !(await unlockParent())) return;
    e.currentTarget.disabled = true;
    try {
      if (S.syncOn()) await S.leaveSync();
      await S.joinSync(code);
      toast(t('pairDone'));
      location.hash = '#/';
    } catch (err) {
      e.currentTarget.disabled = false;
      toast(err.message === 'invite_invalid' ? t('pairUsed') : err.message === 'bad_link' ? t('pairBadLink') : t('syncErr', err.message));
    }
  };
}
S.initSync({
  getDb: () => db,
  applyRemote(snap) {
    if (Array.isArray(snap.groups)) db.groups = snap.groups;
    if (Array.isArray(snap.videos)) db.videos = snap.videos;
    Object.assign(db.settings, snap.settings || {});
    save();
    // 孩子正在看视频时不打断；其他页面刷新一下显示新片单
    const page = location.hash.split('/')[1] || '';
    if (!['watch', 'parent', 'import', 'pair'].includes(page)) route();
  },
  onStatus(st) {
    syncState = st;
    const el = $('#sync-status');
    if (el) el.textContent = syncStatusText();
  },
  // 家长把这台设备移除了：按家长的选择清空同步来的片单
  onRevoked(wipe) {
    syncState = { state: 'off' };
    if (wipe) {
      db.videos = [];
      db.progress = {};
      save();
      toast(t('devRevokedWiped'));
      location.hash = '#/';
      route();
    } else {
      toast(t('devRevoked'));
      if (location.hash.startsWith('#/parent/settings')) renderParent('settings');
    }
  },
});

function paneSettings(el) {
  setTimeout(() => bindSyncPanel(el));
  const s = db.settings, u = usage();
  el.innerHTML = `${syncPanel()}
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

// 旧数据补全：YouTube 新版播放列表导入的视频之前没读到频道名，首页按频道分类时看不到。
// 打开页面时用 oEmbed 补上（每次最多 30 个，逐个请求），补完刷新当前页面
async function fillYouTubeChannels() {
  const todo = db.videos.filter((v) => v.platform === 'youtube' && !v.author).slice(0, 30);
  let n = 0;
  for (const v of todo) {
    try {
      const info = await R.ytInfo(v.vid);
      if (info.author) { v.author = info.author; v.authorUrl = v.authorUrl || info.authorUrl; n++; }
    } catch {}
  }
  if (!n) return;
  save();
  if (!location.hash || location.hash === '#/') route(); // 只刷新首页，不打断播放和家长操作
}

// 百度网盘的封面地址几小时后过期：装了助手时，每次打开页面按文件夹重新取一次（最多 10 个文件夹）
async function refreshBdpanThumbs() {
  const vids = db.videos.filter((v) => v.platform === 'baidupan');
  if (!vids.length || !(await detectHelper(3000))) return;
  const dirs = [...new Set(vids.map((v) => v.vid.replace(/\/[^/]*$/, '') || '/'))].slice(0, 10);
  const thumbs = await R.bdpanThumbs(dirs);
  let n = 0;
  vids.forEach((v) => { const th = thumbs.get(v.vid); if (th && th !== v.thumb) { v.thumb = th; n++; } });
  if (!n) return;
  save();
  if (!location.hash || location.hash === '#/') route();
}

route();
fillYouTubeChannels();
refreshBdpanThumbs();
