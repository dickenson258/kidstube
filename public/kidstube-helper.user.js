// ==UserScript==
// @name         KidsTube 助手 / KidsTube Helper
// @namespace    https://kidstube.local/helper
// @version      1.2.2
// @description  让 KidsTube 网页能读取 B 站、小红书、YouTube 等网站的视频信息（使用你自己浏览器的登录状态）。Lets KidsTube look up videos on Bilibili, Xiaohongshu, YouTube and more, using your own browser sign-ins.
// @match        *://*/*
// @homepageURL  https://github.com/dickenson258/kidstube
// @updateURL    https://dickenson258.github.io/kidstube/kidstube-helper.user.js
// @downloadURL  https://dickenson258.github.io/kidstube/kidstube-helper.user.js
// @noframes
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @connect      bilibili.com
// @connect      b23.tv
// @connect      bili2233.cn
// @connect      xiaohongshu.com
// @connect      xhslink.com
// @connect      xhslink.cn
// @connect      xhscdn.com
// @connect      youtube.com
// @connect      youtu.be
// @connect      googleapis.com
// @connect      douyin.com
// @connect      iesdouyin.com
// @connect      qq.com
// @connect      youku.com
// @connect      ixigua.com
// @connect      vimeo.com
// @connect      tiktok.com
// @connect      dailymotion.com
// @connect      iqiyi.com
// @connect      mgtv.com
// ==/UserScript==

/*
 * 工作方式
 * - 只在带有 <meta name="kidstube-app"> 的 KidsTube 页面上启用，其他网页上什么都不做。
 * - 某个 KidsTube 网址第一次使用助手时，会弹窗请你确认是否允许；只允许你信任的网址。
 * - 只代为请求上面 @connect 列出的视频网站，只支持 GET / POST。
 * - 请求带着你在这些网站上的登录状态（Cookie 由浏览器自动附带，脚本和 KidsTube 都看不到 Cookie 内容）。
 */
(function () {
  'use strict';
  if (!document.querySelector('meta[name="kidstube-app"]')) return;

  const VERSION = '1.2.2';
  const ALLOWED = /(^|\.)(bilibili\.com|b23\.tv|bili2233\.cn|xiaohongshu\.com|xhslink\.com|xhslink\.cn|xhscdn\.com|youtube\.com|youtu\.be|googleapis\.com|douyin\.com|iesdouyin\.com|qq\.com|youku\.com|ixigua\.com|vimeo\.com|tiktok\.com|dailymotion\.com|iqiyi\.com|mgtv\.com)$/i;
  const hasGM4 = typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function';
  const xhr = hasGM4 ? GM.xmlHttpRequest.bind(GM) : typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null;
  const getValue = (k, d) => (typeof GM !== 'undefined' && GM.getValue ? GM.getValue(k, d) : Promise.resolve(GM_getValue(k, d)));
  const setValue = (k, v) => (typeof GM !== 'undefined' && GM.setValue ? GM.setValue(k, v) : Promise.resolve(GM_setValue(k, v)));
  const origin = location.origin;
  // 有些管理器（如 Firefox 上的 Tampermonkey）给脚本的 window 是代理对象；带 transfer 发送失败时退回普通复制
  const post = (msg, transfer) => {
    try { window.postMessage(msg, origin, transfer || []); }
    catch { window.postMessage(msg, origin); }
  };

  if (!xhr) {
    console.warn('[KidsTube Helper] 当前脚本管理器不支持 GM.xmlHttpRequest');
    return;
  }

  // 每个 KidsTube 网址只需确认一次
  let approval = null;
  function ensureApproved() {
    if (!approval) {
      approval = (async () => {
        const list = (await getValue('approvedOrigins', [])) || [];
        if (list.includes(origin)) return true;
        const ok = window.confirm(
          `KidsTube 助手\n\n允许 ${origin} 通过你的浏览器读取视频网站（B 站、小红书、YouTube 等）的视频信息吗？\n只应允许你自己信任的 KidsTube 网址。\n\n` +
            `Allow ${origin} to look up videos on Bilibili, Xiaohongshu, YouTube, etc. through your browser?\nOnly allow a KidsTube address you trust.`
        );
        if (ok) await setValue('approvedOrigins', [...list, origin]);
        return ok;
      })();
      approval.then((ok) => { if (!ok) approval = null; });
    }
    return approval;
  }

  function send(d) {
    // 网页不能直接设置 Cookie 请求头；交给脚本管理器的 cookie 选项（会合并进浏览器已有的 Cookie）
    const headers = { ...(d.headers || {}) };
    const cookie = headers.cookie || headers.Cookie;
    delete headers.cookie;
    delete headers.Cookie;
    return new Promise((resolve, reject) => {
      const req = xhr({
        method: d.method || 'GET',
        url: d.url,
        headers,
        ...(cookie ? { cookie } : {}),
        data: d.body,
        responseType: d.type === 'arraybuffer' ? 'arraybuffer' : undefined,
        anonymous: false,
        timeout: d.type === 'arraybuffer' ? 300000 : 30000,
        onload: resolve,
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('timeout')),
      });
      if (req && typeof req.then === 'function') req.then(resolve, reject);
    });
  }

  // 无论脚本管理器是否遵守 timeout，都保证在限定时间内给网页一个答复（并说明卡在哪一步）
  const within = (p, ms, label) =>
    Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms))]);

  window.addEventListener('message', async (e) => {
    // 不能用 e.source !== window 判断：在 Firefox 等环境里脚本看到的 window 是代理对象，永远不相等，
    // 会导致收不到网页的任何请求（表现为"助手请求超时"）。改为校验消息来源网址。
    if (e.origin !== origin || !e.data || typeof e.data !== 'object') return;
    const d = e.data;
    if (d.__kt === 'ping') return post({ __kt: 'pong', version: VERSION, nonce: d.nonce });
    if (d.__kt !== 'req' || !d.id) return;
    const reply = (o, transfer) => post({ __kt: 'res', id: d.id, ...o }, transfer);
    try {
      const u = new URL(d.url);
      if (!/^https?:$/.test(u.protocol) || !ALLOWED.test(u.hostname)) return reply({ code: 'HELPER_HOST', error: u.hostname });
      if (!['GET', 'POST'].includes((d.method || 'GET').toUpperCase())) return reply({ code: 'HELPER_HOST', error: d.method });
      const where = u.host + u.pathname;
      let ok;
      try { ok = await within(ensureApproved(), 60000, 'approval'); }
      catch { return reply({ code: 'HELPER_APPROVAL', error: where }); }
      if (!ok) return reply({ code: 'HELPER_DENIED', error: 'denied' });
      let r;
      try { r = await within(send(d), d.type === 'arraybuffer' ? 300000 : 25000, 'timeout'); }
      catch (err) { return reply({ code: 'HELPER_NET', error: `${(err && err.message) || err} @ ${where}` }); }
      if (d.type === 'arraybuffer') {
        const buf = r.response instanceof ArrayBuffer ? r.response : null;
        if (!buf) return reply({ code: 'HELPER_NET', error: 'empty response' });
        return reply({ status: r.status, url: r.finalUrl || d.url, data: buf }, [buf]);
      }
      reply({ status: r.status, url: r.finalUrl || d.url, data: r.responseText });
    } catch (err) {
      reply({ code: 'HELPER_NET', error: String((err && err.message) || err) });
    }
  });

  post({ __kt: 'pong', version: VERSION });
})();
