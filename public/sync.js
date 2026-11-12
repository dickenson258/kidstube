// 多设备同步（免账号、端到端加密、按设备授权）
// - 家长设备生成一把随机的"同步密钥"。服务器只拿到由它算出的家庭编号，以及 AES-GCM 加密后的片单，没有密钥就读不了内容。
// - 每台设备有自己的访问凭证。新设备只能用家长设备生成的一次性邀请加入（扫码 / 链接，24 小时内有效），
//   密钥和邀请都放在网址 # 后面，浏览器不会把它们发给任何服务器。
// - 家长可以查看、改名、移除设备；移除时可以让那台设备清空同步来的片单（下次联网时生效）。
// - 同步的内容：视频、分组、家长密码（哈希）、每日时长等家长设置；每台设备自己的语言、观看进度、今日时长不同步。
const API = 'https://api.domibuddy.com/v1/sync/';
const STORE = 'domibuddy:sync';
const SETTINGS = ['pinHash', 'dailyLimit', 'autoplayNext', 'biliNative', 'shield', 'sandbox', 'sandboxSites', 'sandboxYoukuDefault', 'ytKey'];

export const syncSupported = () => !!(globalThis.crypto?.subtle && window.isSecureContext);

// cfg：{ key, deviceId, token, role, version, at }
let cfg = null;
try { cfg = JSON.parse(localStorage.getItem(STORE)) || null; } catch {}
if (cfg && !cfg.token) cfg = null; // 旧版（没有设备凭证）的同步配置：作废
const saveCfg = () => { try { cfg ? localStorage.setItem(STORE, JSON.stringify(cfg)) : localStorage.removeItem(STORE); } catch {} };

const b64u = (bytes) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const digest = (label, key) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(label + ':' + key));

let derived = null;
async function keys(key = cfg.key) {
  if (derived?.key === key) return derived;
  const [id, enc] = await Promise.all([digest('id', key), digest('enc', key)]);
  derived = { key, id: hex(id).slice(0, 32), aes: await crypto.subtle.importKey('raw', enc, 'AES-GCM', false, ['encrypt', 'decrypt']) };
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
async function call(method, path = '', body, { auth = true } = {}) {
  const { id } = await keys();
  const headers = { ...(auth && cfg?.token ? { authorization: `Bearer ${cfg.deviceId}.${cfg.token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) };
  const r = await fetch(API + id + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  let d = {};
  try { d = await r.json(); } catch {}
  if (r.status === 410 && d.error === 'revoked') revoked(!!d.wipe);
  return { status: r.status, ...d };
}

// 设备名：例如"iPad · Safari"、"Mac · Chrome"
export function deviceName() {
  const ua = navigator.userAgent;
  // iPadOS 的 Safari 默认伪装成 Mac，只能用触摸点数区分
  const os = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android' : 'Android 平板') : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' · ') || 'Device';
}

// ---------------------------------------------------------------- 与 app.js 的接口
let hooks = null; // { getDb, applyRemote(snapshot), onStatus(state), onRevoked(wipe) }
let lastPrint = '', pushTimer = null, applying = false, busy = Promise.resolve();
const snapshot = (db) => ({ groups: db.groups, videos: db.videos, settings: Object.fromEntries(SETTINGS.filter((k) => k in db.settings).map((k) => [k, db.settings[k]])) });
const print = (snap) => JSON.stringify(snap);
const status = (state, extra = {}) => hooks?.onStatus?.({ state, at: cfg?.at || null, ...extra });
const queue = (fn) => (busy = busy.then(fn, fn));

export const syncOn = () => !!cfg?.token;
export const syncInfo = () => (cfg ? { at: cfg.at || null, version: cfg.version || 0, role: cfg.role, deviceId: cfg.deviceId } : null);
export const isParentDevice = () => cfg?.role === 'parent';

function revoked(wipe) {
  cfg = null; derived = null; saveCfg();
  clearTimeout(pushTimer);
  hooks?.onRevoked?.(wipe);
  status('revoked', { wipe });
}

let started = false;
export function initSync(h) {
  hooks = h;
  if (!syncOn() || !syncSupported()) return;
  if (!lastPrint) lastPrint = print(snapshot(h.getDb()));
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
  if (!syncOn()) return;
  const snap = snapshot(hooks.getDb()), p = print(snap);
  if (p === lastPrint) return;
  status('syncing');
  try {
    const r = await call('PUT', '', { base: cfg.version || 0, ciphertext: await encrypt(snap) });
    if (r.status === 410) return;
    if (r.status === 409) { await pull(true); return; } // 别的设备先改过：以云端为准
    if (r.status !== 200) throw new Error(r.error || 'HTTP ' + r.status);
    cfg.version = r.version; cfg.at = r.updatedAt; saveCfg();
    lastPrint = p;
    status('ok');
  } catch (e) { status('error', { error: String(e.message || e) }); }
}

async function pull(force = false) {
  if (!syncOn()) return;
  status('syncing');
  try {
    const r = await call('GET');
    if (r.status === 410) return;
    if (r.status === 404 || r.status === 401) { status('gone'); return; }
    if (r.status !== 200) throw new Error(r.error || 'HTTP ' + r.status);
    if (r.role && r.role !== cfg.role) cfg.role = r.role;
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

// 开启同步：生成新密钥，把本设备的片单作为第一个版本上传，本设备成为家长设备
export async function enableSync() {
  const key = b64u(crypto.getRandomValues(new Uint8Array(32)));
  cfg = { key, version: 0, at: null };
  const snap = snapshot(hooks.getDb());
  const r = await call('POST', '', { name: deviceName(), ciphertext: await encrypt(snap) }, { auth: false });
  if (r.status !== 200) { cfg = null; derived = null; saveCfg(); throw new Error(r.error || 'HTTP ' + r.status); }
  Object.assign(cfg, { deviceId: r.deviceId, token: r.token, role: r.role, version: r.version, at: r.updatedAt });
  saveCfg();
  lastPrint = print(snap);
  initSync(hooks);
  status('ok');
}

// 家长设备生成邀请链接（role：child 孩子设备 / parent 家长的另一台设备）
export async function createInvite(base, role = 'child') {
  const r = await call('POST', '/invites', { role });
  if (r.status !== 200) throw new Error(r.error || 'HTTP ' + r.status);
  return { link: `${base}#/pair/${cfg.key}.${r.invite}`, expiresAt: r.expiresAt, role: r.role };
}

// 加入：用邀请登记本设备，下载云端片单替换本设备的
export async function joinSync(code) {
  const [key, invite] = String(code || '').split('.');
  if (!/^[A-Za-z0-9_-]{43}$/.test(key || '') || !/^[A-Za-z0-9_-]{43}$/.test(invite || '')) throw new Error('bad_link');
  const prev = cfg;
  cfg = { key, version: 0, at: null };
  derived = null;
  const r = await call('POST', '/devices', { invite, name: deviceName() }, { auth: false });
  if (r.status !== 200) { cfg = prev; derived = null; throw new Error(r.error || 'HTTP ' + r.status); }
  Object.assign(cfg, { deviceId: r.deviceId, token: r.token, role: r.role });
  saveCfg();
  const g = await call('GET');
  if (g.status !== 200) throw new Error(g.error || 'HTTP ' + g.status);
  const snap = await decrypt(g.ciphertext);
  applying = true;
  try { hooks.applyRemote(snap); } finally { applying = false; }
  cfg.version = g.version; cfg.at = g.updatedAt; saveCfg();
  lastPrint = print(snapshot(hooks.getDb()));
  initSync(hooks);
}

export const syncNow = () => queue(() => pull()).then(() => queue(push));

export async function listDevices() {
  const r = await call('GET', '/devices');
  if (r.status !== 200) throw new Error(r.error || 'HTTP ' + r.status);
  return r;
}
export async function renameDevice(deviceId, name) {
  const r = await call('PUT', '/devices/' + deviceId, { name });
  if (r.status !== 200) throw new Error(r.error || 'HTTP ' + r.status);
}
export async function removeDevice(deviceId, wipe) {
  const r = await call('DELETE', '/devices/' + deviceId + (wipe ? '?wipe=1' : ''));
  if (r.status !== 200) throw new Error(r.error || 'HTTP ' + r.status);
}
// 本设备退出同步（保留本地片单；云端和其他设备不受影响）
export async function leaveSync() {
  if (cfg?.token) { try { await call('DELETE', '/devices/self'); } catch {} }
  cfg = null; derived = null; saveCfg();
}
// 删除云端数据（家长设备）：所有设备都会停止同步
export async function deleteCloud() {
  const r = await call('DELETE');
  cfg = null; derived = null; saveCfg();
  return r.status === 200 || r.status === 404;
}
