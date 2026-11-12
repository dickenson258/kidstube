// 朵米助手（浏览器扩展版）后台：替朵米片单网页请求视频网站，带上你在这些网站上的登录状态。
// 只请求下面列出的视频网站，只支持 GET / POST；不保存、不上传任何内容。
const api = globalThis.browser ?? globalThis.chrome;

const ALLOWED = /(^|\.)(bilibili\.com|b23\.tv|bili2233\.cn|youtube\.com|youtu\.be|googleapis\.com|qq\.com|youku\.com|vimeo\.com|dailymotion\.com|iqiyi\.com|mgtv\.com|baidu\.com|baidupcs\.com)$/i;
// fetch 不能自己设置的请求头：用只匹配这一个请求的临时规则（declarativeNetRequest）改写
const RULE_HEADERS = ['referer', 'origin', 'user-agent'];
const TAB_NONE = -1; // 扩展后台发出的请求不属于任何标签页
let ruleSeq = Math.floor(Math.random() * 1e6) + 1;

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'kt-req') return undefined;
  // 只接受扩展自己的页面脚本（只注入在朵米片单网址上）
  if (sender.id !== api.runtime.id) return undefined;
  handle(msg.d).then(sendResponse, (err) => sendResponse({ code: 'HELPER_NET', error: String(err?.message || err) }));
  return true;
});

const limit = (d) => Math.min(Math.max(Number(d.timeout) || 25000, 5000), 90000);

async function handle(d) {
  const u = new URL(d.url);
  const method = (d.method || 'GET').toUpperCase();
  if (!/^https?:$/.test(u.protocol) || !ALLOWED.test(u.hostname)) return { code: 'HELPER_HOST', error: u.hostname };
  if (!['GET', 'POST'].includes(method)) return { code: 'HELPER_HOST', error: method };

  const headers = {}, special = [];
  for (const [k, v] of Object.entries(d.headers || {})) {
    const key = k.toLowerCase();
    if (key === 'cookie') continue; // 浏览器会自动带上你在该网站的 Cookie
    if (RULE_HEADERS.includes(key)) special.push({ header: key, operation: 'set', value: String(v) });
    else headers[k] = v;
  }

  let ruleId = null;
  if (special.length) {
    ruleId = ruleSeq++;
    await api.declarativeNetRequest.updateSessionRules({
      addRules: [{
        id: ruleId,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: special },
        condition: { urlFilter: '|' + u.href.replace(/[*^|]/g, (c) => encodeURIComponent(c)) + '|', resourceTypes: ['xmlhttprequest', 'other'], tabIds: [TAB_NONE] },
      }],
    });
  }
  const binary = d.type === 'arraybuffer';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), binary ? 300000 : limit(d));
  try {
    const r = await fetch(u.href, { method, headers, body: method === 'POST' ? d.body : undefined, credentials: 'include', redirect: 'follow', signal: ctrl.signal });
    if (binary) return { status: r.status, url: r.url || d.url, b64: toBase64(new Uint8Array(await r.arrayBuffer())) };
    return { status: r.status, url: r.url || d.url, data: await r.text() };
  } catch (err) {
    return { code: 'HELPER_NET', error: `${ctrl.signal.aborted ? 'timeout' : err?.message || err} @ ${u.host + u.pathname}` };
  } finally {
    clearTimeout(timer);
    if (ruleId) api.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {});
  }
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
