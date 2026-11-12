// 多设备同步（免账号、端到端加密）
// - 家长设备生成一把随机的"同步密钥"。服务器只拿到由它算出的家庭编号和写入凭证（都是哈希），
//   以及 AES-GCM 加密后的片单；没有密钥就无法读取内容。
// - 其他设备扫码或打开配对链接加入。密钥放在网址 # 后面，浏览器不会把它发给任何服务器。
// - 同步的内容：视频、分组、家长密码（哈希）、每日时长等家长设置；每台设备自己的语言、观看进度、今日时长不同步。
const API = 'https://api.domibuddy.com/v1/sync/';
const STORE = 'domibuddy:sync';
const SETTINGS = ['pinHash', 'dailyLimit', 'autoplayNext', 'biliNative', 'shield', 'sandbox', 'sandboxSites', 'sandboxYoukuDefault', 'ytKey'];

export const syncSupported = () => !!(globalThis.crypto?.subtle && window.isSecureContext);

let cfg = null; // { key, version, at }
try { cfg = JSON.parse(localStorage.getItem(STORE)) || null; } catch {}
const saveCfg = () => { try { cfg ? localStorage.setItem(STORE, JSON.stringify(cfg)) : localStorage.removeItem(STORE); } catch {} };

const b64u = (bytes) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const digest = (label, key) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(label + ':' + key));

let derived = null;
async function keys() {
  if (derived?.key === cfg.key) return derived;
  const [id, auth, enc] = await Promise.all([digest('id', cfg.key), digest('auth', cfg.key), digest('enc', cfg.key)]);
  derived = { key: cfg.key, id: hex(id).slice(0, 32), auth: hex(auth), aes: await crypto.subtle.importKey('raw', enc, 'AES-GCM', false, ['encrypt', 'decrypt']) };
  return derived;
}
async function encrypt(obj) {
  const { aes } = await keys();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return b64(out);
}
async function decrypt(s) {
  const { aes } = await keys();
  const raw = unb64(s);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, aes, raw.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function call(method, body) {
  const { id, auth } = await keys();
  const r = await fetch(API + id, { method, headers: { authorization: 'Bearer ' + auth, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  let d = {};
  try { d = await r.json(); } catch {}
  return { status: r.status, ...d };
}

// ---------------------------------------------------------------- 与 app.js 的接口
let hooks = null; // { getDb, applyRemote(snapshot), onStatus(state) }
let lastPrint = '', pushTimer = null, applying = false, busy = Promise.resolve();
const snapshot = (db) => ({ groups: db.groups, videos: db.videos, settings: Object.fromEntries(SETTINGS.filter((k) => k in db.settings).map((k) => [k, db.settings[k]])) });
const print = (snap) => JSON.stringify(snap);
const status = (state, extra = {}) => hooks?.onStatus?.({ state, at: cfg?.at || null, ...extra });
const queue = (fn) => (busy = busy.then(fn, fn));

export const syncOn = () => !!cfg?.key;
export const syncInfo = () => (cfg ? { at: cfg.at || null, version: cfg.version || 0 } : null);

let started = false;
export function initSync(h) {
  hooks = h;
  if (!syncOn() || !syncSupported()) return;
  if (!lastPrint) lastPrint = cfg.version ? print(snapshot(h.getDb())) : '';
  queue(pull);
  if (started) return;
  started = true;
  setInterval(() => syncOn() && document.visibilityState === 'visible' && queue(pull), 60000);
  document.addEventListener('visibilitychange', () => syncOn() && document.visibilityState === 'visible' && queue(pull));
}

// app.js 每次 save() 后调用：只有片单 / 家长设置真的变了才上传（播放进度和今日时长不上传）
export function onSaved() {
  if (!syncOn() || applying) return;
  const p = print(snapshot(hooks.getDb()));
  if (p === lastPrint) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => queue(push), 1500);
}

async function push() {
  const snap = snapshot(hooks.getDb()), p = print(snap);
  if (p === lastPrint && cfg.version) return;
  status('syncing');
  try {
    const r = await call('PUT', { base: cfg.version || 0, ciphertext: await encrypt(snap) });
    if (r.status === 409) { await pull(true); return; } // 别的设备先改过：以云端为准
    if (r.status !== 200) throw new Error(r.error || 'HTTP ' + r.status);
    cfg.version = r.version; cfg.at = r.updatedAt; saveCfg();
    lastPrint = p;
    status('ok');
  } catch (e) { status('error', { error: String(e.message || e) }); }
}

async function pull(force = false) {
  status('syncing');
  try {
    const r = await call('GET');
    if (r.status === 404 && !cfg.version) return push(); // 第一次：把本设备的片单传上去
    if (r.status === 404 || r.status === 401) { status('gone'); return; }
    if (r.status !== 200) throw new Error(r.error || 'HTTP ' + r.status);
    if (r.version > (cfg.version || 0) || force) {
      const snap = await decrypt(r.ciphertext);
      applying = true;
      try { hooks.applyRemote(snap); } finally { applying = false; }
      lastPrint = print(snapshot(hooks.getDb()));
      cfg.version = r.version;
    }
    cfg.at = r.updatedAt; saveCfg();
    status('ok', { changed: force });
  } catch (e) { status('error', { error: String(e.message || e) }); }
}

// 开启同步：生成新密钥，把本设备的片单作为第一个版本上传
export async function enableSync() {
  cfg = { key: b64u(crypto.getRandomValues(new Uint8Array(32))), version: 0, at: null };
  saveCfg();
  lastPrint = '';
  initSync(hooks);
  await busy;
}
// 加入：用配对链接里的密钥，下载云端片单替换本设备的
export async function joinSync(key) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('bad key');
  cfg = { key, version: 0, at: null };
  saveCfg();
  const r = await call('GET');
  if (r.status !== 200) { cfg = null; saveCfg(); throw new Error(r.status === 404 ? 'not_found' : r.error || 'HTTP ' + r.status); }
  const snap = await decrypt(r.ciphertext);
  applying = true;
  try { hooks.applyRemote(snap); } finally { applying = false; }
  cfg.version = r.version; cfg.at = r.updatedAt; saveCfg();
  initSync(hooks);
}
export const pairLink = (base) => `${base}#/pair/${cfg.key}`;
export const syncNow = () => queue(() => pull()).then(() => queue(push));
// 本设备退出同步（云端和其他设备不受影响）
export function leaveSync() { cfg = null; derived = null; saveCfg(); }
// 删除云端数据：所有设备都会停止同步
export async function deleteCloud() {
  const r = await call('DELETE');
  leaveSync();
  return r.status === 200 || r.status === 404;
}
