// ==UserScript==
// @name         朵米助手 / DomiBuddy Helper
// @namespace    https://kidstube.local/helper
// @version      1.7.2
// @description  让朵米片单网页能读取 B 站、小红书、YouTube 等网站的视频信息（使用你自己浏览器的登录状态）。Lets Domi Lists look up videos on Bilibili, Xiaohongshu, YouTube and more, using your own browser sign-ins.
// @match        *://*/*
// @homepageURL  https://github.com/dickenson258/kidstube
// @updateURL    https://lists.domibuddy.com/kidstube-helper.user.js
// @downloadURL  https://lists.domibuddy.com/kidstube-helper.user.js
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
// @connect      vimeo.com
// @connect      dailymotion.com
// @connect      iqiyi.com
// @connect      mgtv.com
// @connect      baidu.com
// @connect      baidupcs.com
// ==/UserScript==

/*
 * 工作方式
 * - 只在带有 <meta name="kidstube-app"> 的朵米片单页面上启用，其他网页上什么都不做。
 * - 某个朵米片单网址第一次使用助手时，会弹窗请你确认是否允许；只允许你信任的网址。
 * - 只代为请求上面 @connect 列出的视频网站，只支持 GET / POST。
 * - 请求带着你在这些网站上的登录状态（Cookie 由浏览器自动附带，脚本和朵米片单都看不到 Cookie 内容）。
 */
(function () {
  'use strict';
  // 优酷播放器嵌在朵米片单里时，浏览器会把优酷的登录 Cookie 当成第三方 Cookie 拦下，
  // 播放器就以为没登录，会员也只能试看 6 分钟。这里在优酷播放器里请求浏览器的"存储访问"授权
  // （Storage Access API，需要用户点一下），授权后播放器就能用上你在优酷网站上的登录状态。
  if (window.top !== window) {
    if (location.hostname === 'player.youku.com') youkuStorageAccess();
    return; // 其他网页里的框架：什么都不做
  }
  if (!document.querySelector('meta[name="kidstube-app"]')) return;

  const VERSION = '1.7.2';
  const ALLOWED = /(^|\.)(bilibili\.com|b23\.tv|bili2233\.cn|xiaohongshu\.com|xhslink\.com|xhslink\.cn|xhscdn\.com|youtube\.com|youtu\.be|googleapis\.com|douyin\.com|iesdouyin\.com|qq\.com|youku\.com|vimeo\.com|dailymotion\.com|iqiyi\.com|mgtv\.com|baidu\.com|baidupcs\.com)$/i;
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
    console.warn('[DomiBuddy Helper] 当前脚本管理器不支持 GM.xmlHttpRequest');
    return;
  }

  // 每个朵米片单网址只需确认一次
  let approval = null;
  function ensureApproved() {
    if (!approval) {
      approval = (async () => {
        const list = (await getValue('approvedOrigins', [])) || [];
        if (list.includes(origin)) return true;
        const ok = window.confirm(
          `朵米助手\n\n允许 ${origin} 通过你的浏览器读取视频网站（B 站、小红书、YouTube 等）的视频信息吗？\n只应允许你自己信任的朵米片单网址。\n\n` +
            `Allow ${origin} to look up videos on Bilibili, Xiaohongshu, YouTube, etc. through your browser?\nOnly allow a DomiBuddy address you trust.`
        );
        if (ok) await setValue('approvedOrigins', [...list, origin]);
        return ok;
      })();
      approval.then((ok) => { if (!ok) approval = null; });
    }
    return approval;
  }

  // 1.3.0 曾保存过小红书登录信息；小红书已不再支持，清除它
  setValue('xhsCookie', '');

  // 网页可以为大页面（如 YouTube 频道主页）请求更长的等待时间，默认 25 秒，最多 90 秒
  const limit = (d) => Math.min(Math.max(Number(d.timeout) || 25000, 5000), 90000);

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
        timeout: d.type === 'arraybuffer' ? 300000 : limit(d) + 5000,
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
      try { r = await within(send(d), d.type === 'arraybuffer' ? 300000 : limit(d), 'timeout'); }
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

  function youkuStorageAccess() {
    if (typeof document.hasStorageAccess !== 'function' || typeof document.requestStorageAccess !== 'function') return;
    document.hasStorageAccess().then((has) => {
      if (has) return;
      const zh = /^zh/i.test(navigator.language);
      const bar = document.createElement('button');
      bar.textContent = zh ? '🔑 家长点这里：让播放器使用优酷会员登录' : '🔑 Parents: tap to use your Youku sign-in here';
      bar.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:2147483647;padding:8px 14px;border:0;border-radius:999px;background:#1f8cff;color:#fff;font:600 13px/1.3 -apple-system,system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.35);cursor:pointer;max-width:92%';
      bar.onclick = (e) => {
        e.stopPropagation();
        document.requestStorageAccess().then(
          () => location.reload(),
          () => {
            bar.textContent = zh ? '浏览器没有允许。请先在本浏览器直接打开 youku.com 登录一次，再回来点这里' : "The browser didn't allow it. Open youku.com in this browser and sign in once, then tap here again";
          },
        );
      };
      (document.body || document.documentElement).appendChild(bar);
    }).catch(() => {});
  }
})();
