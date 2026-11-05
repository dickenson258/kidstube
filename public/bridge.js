// 网页 ↔ KidsTube 助手（用户脚本）之间的通信，基于 window.postMessage
const pending = new Map();
const waiters = new Set();
let version = null;
const nonceWaiters = new Map();

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || typeof e.data !== 'object') return;
  const d = e.data;
  if (d.__kt === 'pong') {
    if (d.nonce && nonceWaiters.has(d.nonce)) { nonceWaiters.get(d.nonce)(d.version); nonceWaiters.delete(d.nonce); }
    version = d.version || '1';
    waiters.forEach((f) => f(version));
    waiters.clear();
  } else if (d.__kt === 'res' && pending.has(d.id)) {
    const p = pending.get(d.id);
    pending.delete(d.id);
    clearTimeout(p.timer);
    if (d.code) p.reject(Object.assign(new Error(d.code), { code: d.code, detail: d.error }));
    else p.resolve({ status: d.status, url: d.url, data: d.data });
  }
});

export const helperVersion = () => version;

// 等待助手应答（脚本在 document-end 注入，可能比本模块晚）
export function detectHelper(timeout = 1500) {
  if (version) return Promise.resolve(version);
  return new Promise((resolve) => {
    const f = (v) => resolve(v);
    waiters.add(f);
    window.postMessage({ __kt: 'ping' }, location.origin);
    setTimeout(() => { waiters.delete(f); resolve(version); }, timeout);
  });
}
export function onHelper(fn) {
  if (version) fn(version);
  else waiters.add(fn);
}

export function helperRequest({ url, method = 'GET', headers = {}, body, type = 'text', timeout }) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    // 下载视频时间较长；首次使用还要等家长在弹窗中确认
    let where = url;
    try { const u = new URL(url); where = u.host + u.pathname; } catch {}
    // 助手 1.2.0 起自带超时（授权 60 秒 + 请求 25 秒），这里只是兜底
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(Object.assign(new Error('HELPER_TIMEOUT'), { code: 'HELPER_TIMEOUT', detail: where }));
    }, type === 'arraybuffer' ? 320000 : 100000 + (timeout || 0));
    pending.set(id, { resolve, reject, timer });
    window.postMessage({ __kt: 'req', id, url, method, headers, body, type, timeout }, location.origin);
  });
}

// 双向通信测试：发出带编号的 ping，确认助手确实收到了网页的消息并回复
export function pingHelper(timeout = 3000) {
  return new Promise((resolve) => {
    const nonce = Math.random().toString(36).slice(2);
    nonceWaiters.set(nonce, (v) => resolve(v || true));
    window.postMessage({ __kt: 'ping', nonce }, location.origin);
    setTimeout(() => { if (nonceWaiters.delete(nonce)) resolve(null); }, timeout);
  });
}
