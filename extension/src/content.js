// 朵米助手（浏览器扩展版）页面脚本：只注入在朵米片单的网址上（见 manifest 的 content_scripts.matches）。
// 和用户脚本版使用同一套 window.postMessage 协议，网页不用区分是哪种助手。
(() => {
  if (window.top !== window) return;
  if (!document.querySelector('meta[name="kidstube-app"]')) return;

  const api = globalThis.browser ?? globalThis.chrome;
  const VERSION = api.runtime.getManifest().version;
  const origin = location.origin;
  const post = (msg, transfer) => {
    try { window.postMessage(msg, origin, transfer || []); } catch { window.postMessage(msg, origin); }
  };

  // 每个朵米片单网址只需确认一次
  let approval = null;
  function ensureApproved() {
    if (!approval) {
      approval = (async () => {
        const { approvedOrigins = [] } = await api.storage.local.get('approvedOrigins');
        if (approvedOrigins.includes(origin)) return true;
        const ok = window.confirm(
          `朵米助手\n\n允许 ${origin} 通过你的浏览器读取视频网站（B 站、YouTube 等）的视频信息吗？\n只应允许你自己信任的朵米片单网址。\n\n` +
            `DomiBuddy Helper\n\nAllow ${origin} to look up videos on Bilibili, YouTube, etc. through your browser?\nOnly allow a DomiBuddy address you trust.`
        );
        if (ok) await api.storage.local.set({ approvedOrigins: [...approvedOrigins, origin] });
        return ok;
      })();
      approval.then((ok) => { if (!ok) approval = null; });
    }
    return approval;
  }

  const within = (p, ms, label) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms))]);
  const fromBase64 = (s) => {
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  };

  window.addEventListener('message', async (e) => {
    if (e.origin !== origin || !e.data || typeof e.data !== 'object') return;
    const d = e.data;
    if (d.__kt === 'ping') return post({ __kt: 'pong', version: VERSION, nonce: d.nonce, kind: 'extension' });
    if (d.__kt !== 'req' || !d.id) return;
    const reply = (o, transfer) => post({ __kt: 'res', id: d.id, ...o }, transfer);
    let where = d.url;
    try { const u = new URL(d.url); where = u.host + u.pathname; } catch {}
    let ok;
    try { ok = await within(ensureApproved(), 60000, 'approval'); } catch { return reply({ code: 'HELPER_APPROVAL', error: where }); }
    if (!ok) return reply({ code: 'HELPER_DENIED', error: 'denied' });
    const req = { url: d.url, method: d.method, headers: d.headers, body: d.body, type: d.type, timeout: d.timeout };
    let r;
    try { r = await within(api.runtime.sendMessage({ type: 'kt-req', d: req }), d.type === 'arraybuffer' ? 310000 : 100000, 'timeout'); }
    catch (err) { return reply({ code: 'HELPER_NET', error: `${err?.message || err} @ ${where}` }); }
    if (!r) return reply({ code: 'HELPER_NET', error: `no response @ ${where}` });
    if (r.code) return reply({ code: r.code, error: r.error });
    if (d.type === 'arraybuffer') {
      const buf = fromBase64(r.b64 || '');
      return reply({ status: r.status, url: r.url, data: buf }, [buf]);
    }
    reply({ status: r.status, url: r.url, data: r.data });
  });

  post({ __kt: 'pong', version: VERSION, kind: 'extension' });
})();
