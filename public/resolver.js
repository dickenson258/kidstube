// 朵米片单链接解析器 —— 运行在浏览器中（纯静态网站，无服务器）
//
// 浏览器的跨域限制（CORS）让网页无法读取 B 站、小红书等网站的数据。
// 安装 "朵米助手" 用户脚本后，跨域请求经由脚本管理器发出，并使用家长自己的登录状态。
// 未安装助手时：单个视频链接仍可直接从链接中识别 ID 并播放（标题由家长填写），
// YouTube 标题可通过 oEmbed 获取，YouTube 频道可通过 Data API Key 获取。
//
// 本文件不依赖 DOM，也可在 Node 中运行（用于测试，通过 setTransport 注入网络层）。

let transport = null; // async ({ url, method, headers, body, type }) => { status, url, data }
export function setTransport(fn) { transport = fn; }
export const hasHelper = () => !!transport;

export const fail = (code, detail = '') => Object.assign(new Error(code + (detail ? ': ' + detail : '')), { code, detail });

// ---------------------------------------------------------------- 网络层
// 这些接口允许网页直接跨域访问（返回 Access-Control-Allow-Origin），无需助手
function corsOk(u) {
  return u.hostname === 'www.googleapis.com' || (/(^|\.)youtube\.com$/.test(u.hostname) && u.pathname === '/oembed') || (u.hostname === 'vimeo.com' && u.pathname.startsWith('/api/oembed'));
}
async function request(url, { method = 'GET', headers = {}, body, type = 'text', timeout } = {}) {
  if (transport) return transport({ url, method, headers, body, type, timeout });
  if (corsOk(new URL(url))) {
    const r = await fetch(url, { method, body, headers: Object.fromEntries(Object.entries(headers).filter(([k]) => /^content-type$/i.test(k))) });
    return { status: r.status, url: r.url, data: type === 'arraybuffer' ? await r.arrayBuffer() : await r.text() };
  }
  throw fail('NEED_HELPER');
}
async function getText(url, opts) {
  const r = await request(url, opts);
  if (r.status >= 400) throw fail('HTTP', `${r.status} ${new URL(url).host}`);
  return { text: r.data, url: r.url || url };
}
async function getJson(url, opts) {
  const { text } = await getText(url, opts);
  try { return JSON.parse(text); } catch { throw fail('HTTP', 'invalid JSON ' + new URL(url).host); }
}
// JSONP：用 <script> 加载数据，不受跨域限制。B 站 view 接口支持它（UP 主列表接口不支持）
function jsonp(url, timeout = 10000) {
  if (typeof document === 'undefined') return Promise.reject(fail('NEED_HELPER'));
  return new Promise((resolve, reject) => {
    const cb = '__kt_jsonp_' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const done = () => { clearTimeout(timer); delete window[cb]; s.remove(); };
    const timer = setTimeout(() => { done(); reject(fail('HTTP', 'timeout ' + new URL(url).host)); }, timeout);
    window[cb] = (d) => { done(); resolve(d); };
    s.onerror = () => { done(); reject(fail('HTTP', 'jsonp ' + new URL(url).host)); };
    // 不带来源（Referer）：B 站会按来源网站拦截，部分网络下来自 lists.domibuddy.com 的请求会被拒绝
    s.referrerPolicy = 'no-referrer';
    s.src = url + (url.includes('?') ? '&' : '?') + 'jsonp=jsonp&callback=' + cb;
    document.head.appendChild(s);
  });
}

export async function download(url, headers = {}) {
  const r = await request(url, { headers, type: 'arraybuffer' });
  if (r.status >= 400) throw fail('HTTP', `${r.status} ${new URL(url).host}`);
  return r.data;
}

// ---------------------------------------------------------------- 工具
const pick = (re, s, i = 1) => (s.match(re) || [])[i];
const decodeHtml = (s = '') => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const meta = (html, prop) =>
  decodeHtml(
    pick(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i'), html) ||
      pick(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'), html) ||
      ''
  );
const fmtDur = (sec) => {
  sec = Math.round(Number(sec) || 0);
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};
const https = (u) => (u ? u.replace(/^(https?:)?\/\//, 'https://') : u);
export const coverUrl = (u) => typeof u === 'string' && /^(https?:)?\/\/[^/\s]/i.test(u) ? https(u) : '';
const encCursor = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
const decCursor = (s) => (s ? JSON.parse(decodeURIComponent(escape(atob(s)))) : null);

// MD5（B 站 WBI 签名需要；Web Crypto 不提供 MD5）
function md5(str) {
  const b = new TextEncoder().encode(str);
  const n = ((b.length + 8) >> 6) + 1, w = new Uint32Array(n * 16);
  for (let i = 0; i < b.length; i++) w[i >> 2] |= b[i] << ((i % 4) * 8);
  w[b.length >> 2] |= 0x80 << ((b.length % 4) * 8);
  w[n * 16 - 2] = b.length * 8;
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let o = 0; o < w.length; o += 16) {
    let [A, B, C, D] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      const s = S[(i >> 4) * 4 + (i % 4)];
      const x = (A + F + K[i] + w[o + g]) >>> 0;
      [A, D, C] = [D, C, B];
      B = (B + ((x << s) | (x >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  return [a0, b0, c0, d0].map((v) => [0, 8, 16, 24].map((s) => ((v >>> s) & 255).toString(16).padStart(2, '0')).join('')).join('');
}

// ---------------------------------------------------------------- 从分享文案中提取链接和标题
// 例：「【小猪佩奇 第1集-哔哩哔哩】 https://b23.tv/abc」「佩奇去露营 http://xhslink.com/a/xyz 复制本条信息…」
const URL_TAIL = `[^\\s"'<>，。！？；、）】」』《》\u3000]+`;
export function extractLink(text = '') {
  const s = String(text).trim();
  const m = s.match(new RegExp('https?://' + URL_TAIL, 'i')) ||
    s.match(new RegExp('(?:^|[^\\w.@/])((?:[a-z0-9-]+\\.)+(?:com|cn|tv|be|io|net)/' + URL_TAIL + ')', 'i'));
  if (!m) return { url: s, title: '' };
  const hit = m[1] || m[0];
  const index = m.index + m[0].indexOf(hit);
  let url = hit.replace(/[.,;:!?)\]'"]+$/, '');
  if (!/^https?:/i.test(url)) url = 'https://' + url;
  // 标题：链接前面的【】内容（B 站分享），否则链接前面的文字（小红书/抖音分享）；抖音的【xx的作品】是作者名，跳过
  const before = s.slice(0, index);
  const br = before.match(/【([^】]{2,80})】/);
  let title = br && !/的作品$/.test(br[1]) ? br[1] : before.replace(/【[^】]*】/g, ' ');
  title = title
    .replace(/#\s*/g, '')
    .replace(/^[\d.\s]*(复制打开抖音[，,]?\s*看看)?/, '')
    .replace(/[-_—\s|]*(哔哩哔哩|bilibili|小红书|抖音|YouTube)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return { url, title: /https?:/i.test(title) ? '' : title };
}
// 一段文字里的所有链接（家长群里转发的片单常是一串链接，每条前面写着标题）：
// 按链接切成小段，每段交给 extractLink，标题取这条链接和上一条链接之间的文字
export function extractLinks(text = '') {
  const s = String(text);
  const re = new RegExp('https?://' + URL_TAIL + '|(?:^|(?<=[^\\w.@/]))(?:[a-z0-9-]+\\.)+(?:com|cn|tv|be|io|net)/' + URL_TAIL, 'gi');
  const out = [], seen = new Set();
  let from = 0;
  for (const m of s.matchAll(re)) {
    const end = m.index + m[0].length;
    // 标题只看这条链接所在的那一行；那一行链接前面没有字，就看上一行（片单的标题行）
    const lines = s.slice(from, m.index).split(/\r?\n/).map((x) => x.trim());
    const own = lines.pop() || '', above = lines.filter(Boolean).pop() || '';
    const r = extractLink((own || (lines.length ? above : '')) + ' ' + m[0]);
    from = end;
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------- 离线识别（不联网，只看链接本身）
const RULES = [
  { re: /vimeo\.com\/(?:video\/)?(\d+)/, platform: 'vimeo', embed: (m) => `https://player.vimeo.com/video/${m[1]}` },
  { re: /dailymotion\.com\/video\/([a-z0-9]+)/i, platform: 'dailymotion', embed: (m) => `https://www.dailymotion.com/embed/video/${m[1]}` },
  { re: /v\.qq\.com\/x\/(?:cover\/[^/]+|page)\/([a-z0-9]{11})\.html/i, platform: 'qq', embed: (m) => `https://v.qq.com/txp/iframe/player.html?vid=${m[1]}` },
  { re: /v\.youku\.com\/v_show\/id_([^.]+)\.html/, platform: 'youku', embed: (m) => `https://player.youku.com/embed/${m[1]}` },
  { re: /iqiyi\.com\/(v_\w+)/, platform: 'iqiyi', embed: null },
  { re: /mgtv\.com\/b\/\d+\/(\d+)/, platform: 'mgtv', embed: null },
];
// 短链接：需要先跟随跳转拿到真实地址（小红书新版分享用 xhslink.cn）
const SHORT_HOSTS = /^(b23\.tv|bili2233\.cn|xhslink\.com|xhslink\.cn|url\.cn)$/;
const isYouTube = (h) => /(^|\.)youtube\.com$|^youtu\.be$|youtube-nocookie\.com$/.test(h);

function ytVideoId(u) {
  if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0];
  if (u.searchParams.get('v')) return u.searchParams.get('v');
  return pick(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/, u.pathname);
}
const ytVideo = (id, title = '', author = '', duration = '') => ({
  platform: 'youtube', playType: 'iframe', vid: id, url: `https://www.youtube.com/watch?v=${id}`,
  title, author, duration, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
});

// 不联网，从链接识别出可播放的视频；识别不了返回 null
export function parseOffline(raw) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : 'https://' + raw.trim()); } catch { return null; }
  const h = u.hostname.replace(/^(www|m)\./, '');
  if (isYouTube(u.hostname)) {
    const id = ytVideoId(u);
    return id ? ytVideo(id) : null;
  }
  if (/bilibili\.com$/.test(h)) {
    const bvid = pick(/(BV[\w]{10})/, u.href), aid = pick(/\/av(\d+)/i, u.pathname);
    if (!bvid && !aid) return null;
    const p = Number(u.searchParams.get('p') || 1);
    return { platform: 'bilibili', playType: 'iframe', vid: bvid || 'av' + aid, page: p > 1 ? p : undefined, url: u.href, title: '', author: '', duration: '', thumb: '' };
  }
  if (/\.(mp4|webm|m3u8|mov)(\?|$)/i.test(u.pathname))
    return { platform: 'direct', playType: 'video', vid: u.href, url: u.href, src: u.href, title: decodeURIComponent(u.pathname.split('/').pop()), author: u.hostname, thumb: '', duration: '' };
  for (const r of RULES) {
    const m = u.href.match(r.re);
    if (m) return { platform: r.platform, playType: r.embed ? 'iframe' : 'external', vid: m[1], url: u.href, embed: r.embed?.(m), title: '', author: '', thumb: '', duration: '' };
  }
  return null;
}

// ---------------------------------------------------------------- YouTube
async function ytSingle(id) {
  try {
    const o = await getJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`);
    return { ...ytVideo(id, o.title, o.author_name), authorUrl: o.author_url };
  } catch {
    return ytVideo(id);
  }
}
// 补全旧数据里缺少的频道名（oEmbed 接口允许网页直接跨域读取，不需要助手）
export const ytInfo = (id) => ytSingle(id);
function ytWalk(node, out, conts) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((n) => ytWalk(n, out, conts));
  const r = node.playlistVideoRenderer || node.videoRenderer || node.gridVideoRenderer || node.reelItemRenderer;
  if (r?.videoId) out.push(ytVideo(r.videoId, r.title?.runs?.[0]?.text || r.title?.simpleText || r.headline?.simpleText || '', r.shortBylineText?.runs?.[0]?.text || '', r.lengthText?.simpleText || ''));
  // 新版播放列表 / 频道页（lockupViewModel）：频道名在第一行元数据里，时长在缩略图角标里
  const lv = node.lockupViewModel;
  if (lv?.contentId && /VIDEO/i.test(lv.contentType || 'VIDEO')) {
    const md = lv.metadata?.lockupMetadataViewModel;
    const part = md?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0];
    const chUrl = part?.text?.commandRuns?.[0]?.onTap?.innertubeCommand?.browseEndpoint?.canonicalBaseUrl;
    const dur = /"text":"(\d+:\d\d(?::\d\d)?)"/.exec(JSON.stringify(lv.contentImage || {}))?.[1] || '';
    const v = ytVideo(lv.contentId, md?.title?.content || '', chUrl ? part.text.content || '' : '', dur);
    if (chUrl) v.authorUrl = 'https://www.youtube.com' + chUrl;
    out.push(v);
  }
  const sv = node.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
  if (sv) out.push(ytVideo(sv, node.shortsLockupViewModel.overlayMetadata?.primaryText?.content || ''));
  if (node.continuationCommand?.token) conts.push(node.continuationCommand.token);
  for (const k in node) ytWalk(node[k], out, conts);
}
// 有的脚本管理器（如 Firefox 上的 Tampermonkey）发 POST 时带上扩展自己的 Origin（moz-extension://…），
// YouTube 会返回 403。所以显式指定 Origin；如果仍被拒绝，播放列表改为读取网页里自带的 ytInitialData（GET 请求，只有第一页）。
const YT_HEADERS = { 'content-type': 'application/json', origin: 'https://www.youtube.com', 'x-origin': 'https://www.youtube.com', referer: 'https://www.youtube.com/' };
function ytFind(node, key, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 40) return null;
  if (node[key]) return node[key];
  for (const k in node) { const r = ytFind(node[k], key, depth + 1); if (r) return r; }
  return null;
}
async function ytBrowse(payload) {
  let data, blocked = false;
  try {
    data = await getJson('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
      method: 'POST',
      headers: YT_HEADERS,
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20251020.01.00', hl: 'zh-CN', gl: 'US' } }, ...payload }),
    });
  } catch (e) {
    if (!(e.code === 'HTTP' && /^40[13]/.test(e.detail || ''))) throw e;
    if (!payload.browseId?.startsWith('VL')) throw fail('YT_BLOCKED', e.detail);
    const { text } = await getText(`https://www.youtube.com/playlist?list=${payload.browseId.slice(2)}`, { timeout: 60000 });
    const m = /ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s.exec(text);
    if (!m) throw fail('YT_BLOCKED', e.detail);
    data = JSON.parse(m[1]);
    blocked = true;
  }
  const out = [], conts = [];
  ytWalk(data, out, conts);
  const seen = new Set();
  const owner = ytFind(data, 'videoOwnerRenderer')?.title?.runs?.[0]?.text || data.metadata?.channelMetadataRenderer?.title || '';
  const title = data.metadata?.playlistMetadataRenderer?.title || data.header?.playlistHeaderRenderer?.title?.simpleText ||
    data.header?.pageHeaderRenderer?.pageTitle || '';
  const header = data.header?.playlistHeaderRenderer;
  const sidebar = ytFind(data.sidebar, 'playlistSidebarPrimaryInfoRenderer');
  const thumbnails = header?.playlistHeaderBanner?.heroPlaylistThumbnailRenderer?.thumbnail?.thumbnails ||
    sidebar?.thumbnailRenderer?.playlistVideoThumbnailRenderer?.thumbnail?.thumbnails;
  const cover = coverUrl(thumbnails?.[thumbnails.length - 1]?.url);
  return { videos: out.filter((v) => !seen.has(v.vid) && seen.add(v.vid)), next: blocked ? null : conts[conts.length - 1] || null, title, owner, blocked, cover };
}
// 频道 ID：先用很小的 resolve_url 接口（约 1KB）；频道主页有 1～2MB，手机网络经助手下载容易超时
async function ytChannelInfo(u) {
  let id = pick(/^\/channel\/(UC[\w-]{22})/, u.pathname);
  const base = u.pathname.split('/').slice(0, 2).join('/');
  if (id) return { id, name: '' };
  try {
    const d = await getJson('https://www.youtube.com/youtubei/v1/navigation/resolve_url?prettyPrint=false', {
      method: 'POST', headers: YT_HEADERS,
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20251020.01.00' } }, url: 'https://www.youtube.com' + base }),
    });
    id = d.endpoint?.browseEndpoint?.browseId;
    if (/^UC[\w-]{22}$/.test(id || '')) return { id, name: '' };
  } catch {}
  const { text } = await getText(`https://www.youtube.com${base}`, { timeout: 60000 });
  id = pick(/"externalId":"(UC[\w-]{22})"/, text) || pick(/channel\/(UC[\w-]{22})/, text);
  if (!id) throw fail('YT_CHANNEL');
  return { id, name: meta(text, 'og:title') || '' };
}
// YouTube Data API：始终由网页直接请求（允许跨域）。不经过助手，因为助手发出的请求不带网页来源（Referer），
// 限制了"网站"的 API Key 会被拒绝（403）。出错时显示 Google 给出的原因。
async function ytApi(url) {
  let status, text;
  if (typeof fetch === 'function') { const r = await fetch(url); status = r.status; text = await r.text(); }
  else { const r = await request(url); status = r.status; text = r.data; }
  let j;
  try { j = JSON.parse(text); } catch { throw fail('HTTP', `${status} www.googleapis.com`); }
  if (j.error) throw fail('YT_API', `${status} ${j.error.errors?.[0]?.reason || j.error.status || ''} ${j.error.message || ''}`.replace(/<[^>]+>/g, '').trim());
  return j;
}

async function ytCreator(u, opts) {
  const c = decCursor(opts.cursor);
  // 有 API Key：先用 Data API；失败时如果装了助手，第一页改用网页内部接口
  if (opts.ytKey && !c?.token) {
    try { return await ytCreatorApi(u, c, opts.ytKey); }
    catch (e) { if (!transport || c?.pageToken) throw e; }
  }
  return ytCreatorWeb(u, c);
}

async function ytCreatorApi(u, c, ytKey) {
  const listId = u.searchParams.get('list');
  {
    let playlistId = c?.playlistId || listId, author = c?.author || '';
    if (!playlistId) {
      const id = pick(/^\/channel\/(UC[\w-]{22})/, u.pathname);
      const handle = pick(/^\/(@[^/]+)/, u.pathname);
      const user = pick(/^\/user\/([^/]+)/, u.pathname);
      let q = id ? `id=${id}` : handle ? `forHandle=${encodeURIComponent(decodeURIComponent(handle))}` : user ? `forUsername=${user}` : null;
      if (!q) q = `id=${(await ytChannelInfo(u)).id}`; // /c/xxx 需要助手读取页面
      const ch = (await ytApi(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails,snippet&${q}&key=${ytKey}`)).items?.[0];
      if (!ch) throw fail('YT_NOT_FOUND');
      playlistId = ch.contentDetails.relatedPlaylists.uploads;
      author = ch.snippet.title;
    }
    const d = await ytApi(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${ytKey}` + (c?.pageToken ? `&pageToken=${c.pageToken}` : ''));
    if (d.error) throw fail('YT_API', d.error.message);
    const videos = (d.items || []).map((it) => it.snippet)
      .filter((s) => s.resourceId?.videoId && s.title !== 'Private video' && s.title !== 'Deleted video')
      .map((s) => ytVideo(s.resourceId.videoId, s.title, s.videoOwnerChannelTitle || author || s.channelTitle));
    let cover;
    if (listId && !c?.pageToken) {
      try {
        const snippet = await ytPlaylistSnippet(listId, ytKey);
        author = snippet?.title || author;
        cover = ytPlaylistCover(snippet);
      } catch {}
    }
    return { author: author || 'YouTube', cover, total: d.pageInfo?.totalResults, videos, next: d.nextPageToken ? encCursor({ playlistId, author, pageToken: d.nextPageToken }) : null };
  }
}
async function ytPlaylistSnippet(id, key) {
  const data = await ytApi(`https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`);
  return data.items?.[0]?.snippet;
}
const ytPlaylistCover = (snippet) => {
  const images = snippet?.thumbnails;
  return coverUrl(images?.high?.url || images?.medium?.url || images?.standard?.url || images?.default?.url);
};
const ytPlaylistOEmbed = (id) => getJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/playlist?list=' + id)}`);

// 既没有 Key 也没有助手：用 YouTube 官方嵌入播放器（IFrame Player API）的 getPlaylist() 读出播放列表里的视频 ID，
// 再逐个用 oEmbed 取标题（两者都允许网页直接使用）。限制：最多 200 个视频；没有时长；
// 只支持播放列表链接和 /channel/UC… 频道链接（@用户名 查不到频道 ID）。
const ytEmbedIds = new Map(); // 播放列表 ID → 视频 ID 列表（翻页时不用再读一次）
let ytApiReady;
function ytIframeApi() {
  if (typeof document === 'undefined') return Promise.reject(fail('NEED_HELPER_OR_KEY'));
  if (globalThis.YT?.Player) return Promise.resolve(globalThis.YT);
  return (ytApiReady ||= new Promise((resolve, reject) => {
    const prev = globalThis.onYouTubeIframeAPIReady;
    globalThis.onYouTubeIframeAPIReady = () => { prev?.(); resolve(globalThis.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytApiReady = null; s.remove(); reject(fail('HTTP', 'www.youtube.com')); };
    document.head.appendChild(s);
  }));
}
async function ytEmbedPlaylist(listId) {
  if (ytEmbedIds.has(listId)) return ytEmbedIds.get(listId);
  const YT = await ytIframeApi();
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:180px;opacity:0;pointer-events:none';
  const el = host.appendChild(document.createElement('div'));
  document.body.appendChild(host);
  let player, iv, timer;
  try {
    const ids = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(fail('HTTP', 'timeout www.youtube.com')), 20000);
      player = new YT.Player(el, {
        playerVars: { listType: 'playlist', list: listId, mute: 1, autoplay: 0 },
        events: {
          onReady: () => {
            let n = 0;
            iv = setInterval(() => {
              const l = player.getPlaylist?.();
              if (l?.length) resolve(l);
              else if (++n > 40) reject(fail('YT_NOT_FOUND'));
            }, 250);
          },
          onError: () => reject(fail('YT_NOT_FOUND')),
        },
      });
    });
    const uniq = [...new Set(ids)];
    ytEmbedIds.set(listId, uniq);
    return uniq;
  } finally {
    clearInterval(iv);
    clearTimeout(timer);
    try { player?.destroy?.(); } catch {}
    host.remove();
  }
}
async function ytCreatorEmbed(u, c) {
  const PAGE = 50;
  let listId = c?.embed, author = c?.author || '';
  if (!listId) {
    const channelId = pick(/^\/channel\/(UC[\w-]{22})/, u.pathname);
    listId = u.searchParams.get('list') || (channelId && 'UU' + channelId.slice(2));
    if (!listId) throw fail('NEED_HELPER_OR_KEY');
  }
  const ids = await ytEmbedPlaylist(listId);
  let cover;
  if (!author) {
    try {
      const o = await ytPlaylistOEmbed(listId);
      author = (listId.startsWith('UU') ? o.author_name : o.title) || o.author_name || '';
      cover = coverUrl(o.thumbnail_url);
    } catch {}
  }
  const from = c?.offset || 0, page = ids.slice(from, from + PAGE);
  // 私密或已删除的视频 oEmbed 会失败（没有标题），跳过
  const videos = [];
  for (let i = 0; i < page.length; i += 8) {
    const got = await Promise.all(page.slice(i, i + 8).map(ytSingle));
    videos.push(...got.filter((v) => v.title));
  }
  const nextOffset = from + PAGE;
  return {
    author: author || 'YouTube', cover, total: ids.length, videos,
    next: nextOffset < ids.length ? encCursor({ embed: listId, author, offset: nextOffset }) : null,
    ...(ids.length >= 200 ? { noteCode: 'YT_EMBED_CAP' } : {}),
  };
}

// 无 Key（或 Key 失败）：通过助手调用 YouTube 网页内部接口
async function ytCreatorWeb(u, c) {
  const listId = u.searchParams.get('list');
  if (!transport || c?.embed) return ytCreatorEmbed(u, c);
  if (c?.token) {
    const r = await ytBrowse({ continuation: c.token });
    if (!c.list) r.videos.forEach((v) => (v.author = c.author));
    return { author: c.author, videos: r.videos, next: r.next ? encCursor({ token: r.next, author: c.author, list: c.list }) : null };
  }
  let author, browseId, channelId;
  if (listId) { browseId = 'VL' + listId; author = ''; }
  else {
    const info = await ytChannelInfo(u);
    author = info.name;
    channelId = info.id;
    browseId = 'VLUU' + info.id.slice(2); // 频道"全部上传"播放列表
  }
  let r = await ytBrowse({ browseId });
  if (!r.videos.length && channelId) r = await ytBrowse({ browseId: channelId, params: 'EgZ2aWRlb3PyBgQKAjoA' });
  if (!listId && !author) author = r.owner || r.videos.find((v) => v.author)?.author || decodeURIComponent(u.pathname.split('/')[1] || '');
  if (listId) author = r.title || 'Playlist'; // 播放列表：author 字段放列表名，视频各自保留所属频道
  r.videos.forEach((v) => (v.author = listId ? v.author || '' : author));
  return { author, cover: r.cover, videos: r.videos, next: r.next ? encCursor({ token: r.next, author, list: !!listId }) : null, ...(r.blocked ? { noteCode: 'YT_FIRST_PAGE' } : {}) };
}

// ---------------------------------------------------------------- 哔哩哔哩
const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
const BILI_REF = { referer: 'https://www.bilibili.com/' };
let wbi = null;
async function wbiKey() {
  if (wbi && Date.now() - wbi.at < 3600_000) return wbi.key;
  const nav = await getJson('https://api.bilibili.com/x/web-interface/nav', { headers: BILI_REF });
  const k = (u) => u.split('/').pop().split('.')[0];
  const raw = k(nav.data.wbi_img.img_url) + k(nav.data.wbi_img.sub_url);
  wbi = { key: MIXIN.map((i) => raw[i]).join('').slice(0, 32), at: Date.now() };
  return wbi.key;
}
function wbiSign(params, key) {
  const p = { ...params, wts: Math.round(Date.now() / 1000) };
  const q = Object.keys(p).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''))}`).join('&');
  return q + '&w_rid=' + md5(q + key);
}
const biliVideo = (v) => ({
  platform: 'bilibili', playType: 'iframe', vid: v.bvid, url: `https://www.bilibili.com/video/${v.bvid}`,
  title: decodeHtml((v.title || '').replace(/<[^>]+>/g, '')), author: v.author || v.owner?.name || '',
  authorUrl: v.owner?.mid || v.mid ? `https://space.bilibili.com/${v.owner?.mid || v.mid}` : undefined,
  duration: typeof v.duration === 'number' ? fmtDur(v.duration) : v.length || v.duration || '', thumb: https(v.pic),
});
// UP 主主页的各种写法：电脑版 space.bilibili.com/123、手机版 m.bilibili.com/space/123、
// www.bilibili.com/space/123，以及 b23.tv 短链接展开后的这些地址
export function biliSpaceMid(u) {
  if (/^space\.bilibili\.com$/i.test(u.hostname)) return pick(/^\/(\d+)/, u.pathname) || null;
  return pick(/^\/space\/(\d+)/, u.pathname) || null;
}
// 只有番剧、课程这类页面才当作"无法嵌入、在原网站窗口播放"的视频
const BILI_EXTERNAL = /^\/(bangumi\/play|cheese\/play|festival)\//;

async function biliSingle(u) {
  const off = parseOffline(u.href);
  if (!off) {
    if (!BILI_EXTERNAL.test(u.pathname)) throw fail('NOT_VIDEO');
    // 番剧/课程等无法外嵌，只能在原网站窗口播放
    if (!transport) throw fail('NEED_HELPER');
    const { text } = await getText(u.href);
    return { platform: 'bilibili', playType: 'external', vid: u.pathname, url: u.href, title: meta(text, 'og:title') || pick(/<title>([^<]*)/, text) || '', thumb: https(meta(text, 'og:image')), author: '', duration: '' };
  }
  const q = off.vid.startsWith('av') ? 'aid=' + off.vid.slice(2) : 'bvid=' + off.vid;
  const d = await biliView(q);
  if (d.code !== 0) throw fail('BILI_API', d.message);
  const v = biliVideo(d.data);
  // 分P 视频：详情里的 duration 是所有分P的总时长，单独加入某一P时改用这一P自己的时长和标题
  const pg = (d.data.pages || [])[(off.page || 1) - 1];
  if (d.data.pages?.length > 1 && pg) {
    v.duration = fmtDur(pg.duration);
    if (off.page) { v.page = off.page; v.title = `${d.data.title} · ${pg.part}`; v.url = `https://www.bilibili.com/video/${d.data.bvid}?p=${off.page}`; }
  } else if (off.page) { v.page = off.page; v.title += ` (P${off.page})`; }
  v._collection = biliCollectionOf(d.data, v);
  return v;
}
function biliView(query) {
  const url = `https://api.bilibili.com/x/web-interface/view?${query}`;
  return transport ? getJson(url, { headers: BILI_REF }) : jsonp(url);
}
// 视频详情里自带合集（ugc_season）和分P（pages）的完整列表
function biliCollectionOf(dd, v) {
  const base = { author: v.author, authorUrl: v.authorUrl };
  const eps = (dd.ugc_season?.sections || []).flatMap((sec) => sec.episodes || []);
  if (eps.length > 1) {
    return {
      ...base, id: 'bili-season-' + dd.ugc_season.id, title: dd.ugc_season.title, cover: coverUrl(dd.ugc_season.cover),
      videos: eps.map((ep) => biliVideo({ bvid: ep.bvid, title: ep.title || ep.arc?.title, pic: ep.arc?.pic, duration: ep.arc?.duration, owner: dd.owner })),
    };
  }
  if ((dd.pages || []).length > 1) {
    return {
      ...base, id: 'bili-pages-' + dd.bvid, title: dd.title, cover: coverUrl(dd.pic),
      videos: dd.pages.map((p) => ({
        ...biliVideo({ bvid: dd.bvid, title: p.part, pic: p.first_frame || dd.pic, duration: p.duration, owner: dd.owner }),
        page: p.page, url: `https://www.bilibili.com/video/${dd.bvid}?p=${p.page}`,
      })),
    };
  }
  return undefined;
}

// B 站合集 / 系列链接：space.bilibili.com/<mid>/lists/<sid>?type=season|series，
// 以及旧版 /channel/collectiondetail?sid= 和 /channel/seriesdetail?sid=
export function biliCollectionRef(u) {
  if (!/^(space|m)\.bilibili\.com$/i.test(u.hostname)) return null;
  const mid = pick(/^\/(?:space\/)?(\d+)\//, u.pathname);
  if (!mid) return null;
  let m = u.pathname.match(/\/lists\/(\d+)/);
  if (m) return { mid, sid: m[1], type: u.searchParams.get('type') === 'series' ? 'series' : 'season' };
  if (/\/channel\/collectiondetail/.test(u.pathname) && u.searchParams.get('sid')) return { mid, sid: u.searchParams.get('sid'), type: 'season' };
  if (/\/channel\/seriesdetail/.test(u.pathname) && u.searchParams.get('sid')) return { mid, sid: u.searchParams.get('sid'), type: 'series' };
  return null;
}
async function biliCollection({ mid, sid, type }, { cursor }) {
  const c = decCursor(cursor) || {};
  const pn = c.pn || 1, ps = 30;
  const headers = { referer: `https://space.bilibili.com/${mid}/lists/${sid}?type=${type}` };
  let archives = [], total = 0, title = c.title || '', cover = c.cover || '';
  if (type === 'season') {
    const data = await biliSeasonPage(mid, sid, pn, ps, headers);
    archives = data.archives || [];
    total = data.page?.total ?? data.meta?.total ?? 0;
    title ||= data.meta?.name || '';
    cover ||= coverUrl(data.meta?.cover);
  } else {
    const d = await getJson(`https://api.bilibili.com/x/series/archives?mid=${mid}&series_id=${sid}&pn=${pn}&ps=${ps}&sort=asc&only_normal=true`, { headers });
    if (d.code !== 0) throw fail('BILI_API', `${d.code} ${d.message || ''}`.trim());
    archives = d.data.archives || [];
    total = d.data.page?.total ?? 0;
    if (!title) {
      try {
        const meta = await biliSeriesMeta(sid, headers);
        title = meta?.name || '';
        cover = coverUrl(meta?.cover);
      } catch {}
    }
  }
  let author = c.author || '';
  if (!author) {
    try { author = (await getJson(`https://api.bilibili.com/x/web-interface/card?mid=${mid}`, { headers: BILI_REF })).data?.card?.name || ''; } catch {}
  }
  const authorUrl = `https://space.bilibili.com/${mid}`;
  return {
    author: title || author, total, source: 'collection',
    videos: archives.map((a) => ({ ...biliVideo(a), author, authorUrl })),
    next: pn * ps < total ? encCursor({ pn: pn + 1, title, author, cover }) : null,
    collection: { id: `bili-${type}-${sid}`, title: title || author, cover },
  };
}
async function biliSeasonPage(mid, sid, pn, ps, headers = BILI_REF) {
  const data = await getJson(`https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?mid=${mid}&season_id=${sid}&page_num=${pn}&page_size=${ps}&sort_reverse=false`, { headers });
  if (data.code !== 0) throw fail('BILI_API', `${data.code} ${data.message || ''}`.trim());
  return data.data;
}
async function biliSeriesMeta(id, headers = BILI_REF) {
  const data = await getJson(`https://api.bilibili.com/x/series/series?series_id=${id}`, { headers });
  if (data.code !== 0) throw fail('BILI_API', data.message);
  return data.data?.meta;
}
export async function collectionCover(id, episode, ytKey) {
  const yt = /^yt-([\w-]+)$/.exec(id);
  if (yt && episode.platform === 'youtube') {
    const listId = yt[1];
    if (ytKey) {
      try {
        const cover = ytPlaylistCover(await ytPlaylistSnippet(listId, ytKey));
        if (cover) return cover;
      } catch {}
    }
    if (transport) return (await ytBrowse({ browseId: 'VL' + listId })).cover;
    return coverUrl((await ytPlaylistOEmbed(listId)).thumbnail_url);
  }
  if (episode.platform !== 'bilibili') return '';
  const series = /^bili-series-(\d+)$/.exec(id);
  if (series) return coverUrl((await biliSeriesMeta(series[1]))?.cover);
  const season = /^bili-season-(\d+)$/.exec(id);
  if (!season && !/^bili-pages-BV[\w]+$/.test(id)) return '';
  const vid = episode.vid;
  if (!/^(BV[\w]+|av\d+)$/.test(vid)) return '';
  const data = await biliView(vid.startsWith('av') ? 'aid=' + vid.slice(2) : 'bvid=' + vid);
  if (data.code !== 0) throw fail('BILI_API', data.message);
  const video = data.data;
  if (season) {
    const cover = String(video?.ugc_season?.id) === season[1] ? coverUrl(video.ugc_season.cover) : '';
    const mid = /^https:\/\/space\.bilibili\.com\/(\d+)\/?$/.exec(episode.authorUrl || '')?.[1];
    if (!cover && transport && mid) return coverUrl((await biliSeasonPage(mid, season[1], 1, 1)).meta?.cover);
    return cover;
  }
  return id === 'bili-pages-' + video?.bvid ? coverUrl(video.pic) : '';
}
// B 站 UP 主投稿列表。B 站风控较严，依次尝试多种方式，并把每一步的结果写进错误信息，方便排查：
//   1) WBI 签名投稿接口（带 w_webid —— 2024 年起登录状态下需要）
//   2) 同上，但附带新申请的设备 Cookie（浏览器从未打开过 B 站时没有 buvid3）
//   3) 合集检索接口
//   4) 空间动态接口（只含视频动态）
let biliDeviceCookie = null;
async function biliDevice() {
  if (biliDeviceCookie !== null) return biliDeviceCookie;
  try {
    const d = await getJson('https://api.bilibili.com/x/frontend/finger/spi', { headers: BILI_REF });
    biliDeviceCookie = `buvid3=${d.data.b_3}; buvid4=${encodeURIComponent(d.data.b_4)}`;
  } catch { biliDeviceCookie = ''; }
  return biliDeviceCookie;
}
async function biliWebId(mid, headers) {
  try {
    const { text } = await getText(`https://space.bilibili.com/${mid}/video`, { headers });
    const raw = pick(/<script id="__RENDER_DATA__"[^>]*>([^<]+)<\/script>/, text);
    return raw ? JSON.parse(decodeURIComponent(raw)).access_id || '' : '';
  } catch { return ''; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errInfo = (e) => (e.code === 'HTTP' ? e.detail : e.code ? e.code + (e.detail ? ':' + e.detail : '') : e.message);

async function biliCreator(u, { cursor }) {
  const mid = pick(/space\.bilibili\.com\/(\d+)/, u.href) || pick(/\/(\d+)/, u.pathname);
  if (!mid) throw fail('BILI_MID');
  const c = decCursor(cursor) || {};
  const pn = c.pn || 1, ps = 30;
  const base = { referer: `https://space.bilibili.com/${mid}/video`, origin: 'https://space.bilibili.com' };
  const tries = [];
  let list = null, total = 0, author = '', next = null, source = '';

  const arcSearch = async (headers, webid) => {
    const params = { mid, ps, pn, order: 'pubdate', platform: 'web', web_location: 1550101, dm_img_list: '[]', dm_img_str: 'V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ', dm_cover_img_str: 'QU5HTEUgKEFwcGxlLCBBcHBsZSBNMSBQcm8sIE9wZW5HTCA0LjEp', dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}' };
    if (webid) params.w_webid = webid;
    const d = await getJson(`https://api.bilibili.com/x/space/wbi/arc/search?${wbiSign(params, await wbiKey())}`, { headers });
    if (d.code !== 0) throw fail('BILI_API', `${d.code} ${d.message || ''}`.trim());
    list = d.data.list.vlist || [];
    total = d.data.page.count;
    author = list[0]?.author || '';
    next = pn * ps < total ? { pn: pn + 1, webid } : null;
    source = 'arc';
  };

  if (c.mode !== 'dyn') {
    // 1) 浏览器自身的 Cookie（家长已登录 B 站时最可靠）
    let webid = c.webid;
    try {
      if (webid === undefined) webid = await biliWebId(mid, base);
      await arcSearch(base, webid);
    } catch (e) {
      if (e.code === 'NEED_HELPER') throw e;
      tries.push('arc:' + errInfo(e));
    }
    // 1b) 被风控时等一会儿再试（投稿接口是唯一能拿到完整列表的方式，值得多试几次）
    for (const wait of [1500, 3000]) {
      if (list) break;
      await sleep(wait);
      try { await arcSearch(base, webid); }
      catch (e) { tries.push(`arc(retry ${wait / 1000}s):` + errInfo(e)); }
    }
    // 2) 附带新申请的设备 Cookie 重试
    if (!list) {
      try {
        await sleep(600);
        const cookie = await biliDevice();
        if (cookie) await arcSearch({ ...base, cookie }, webid);
      } catch (e) { tries.push('arc+buvid:' + errInfo(e)); }
    }
    // 3) 合集检索接口
    if (!list) {
      try {
        const d = await getJson(`https://api.bilibili.com/x/series/recArchivesByKeywords?mid=${mid}&keywords=&ps=${ps}&pn=${pn}&orderby=pubdate`, { headers: base });
        if (d.code !== 0) throw fail('BILI_API', `${d.code} ${d.message || ''}`.trim());
        list = d.data.archives || [];
        total = d.data.page?.total || 0;
        next = pn * ps < total ? { pn: pn + 1, webid } : null;
        source = 'series';
        if (!list.length && pn === 1) throw fail('BILI_API', 'empty');
      } catch (e) { list = null; tries.push('series:' + errInfo(e)); }
    }
  }
  // 4) 空间动态接口（翻页用 offset）
  if (!list && (c.mode === 'dyn' || pn === 1)) {
    try {
      const d = await getJson(`https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=${mid}&offset=${c.off || ''}&features=itemOpusStyle`, { headers: base });
      if (d.code !== 0) throw fail('BILI_API', `${d.code} ${d.message || ''}`.trim());
      const items = d.data.items || [];
      author = items[0]?.modules?.module_author?.name || '';
      list = items.map((it) => it.modules?.module_dynamic?.major?.archive).filter(Boolean)
        .map((a) => ({ bvid: a.bvid, title: a.title, pic: a.cover, length: a.duration_text }));
      next = d.data.has_more ? { mode: 'dyn', off: d.data.offset } : null;
      source = 'dynamic';
    } catch (e) { tries.push('dynamic:' + errInfo(e)); }
  }
  if (!list) throw fail('BILI_RISK', tries.join(' | '));

  if (!author) {
    try { author = (await getJson(`https://api.bilibili.com/x/web-interface/card?mid=${mid}`, { headers: BILI_REF })).data?.card?.name || ''; } catch {}
  }
  const videos = list.map((v) => ({ ...biliVideo(v), author: author || v.author || '', authorUrl: `https://space.bilibili.com/${mid}` }));
  // source 不是 arc 时说明被 B 站限制、改用了备用接口，列表可能不完整
  return { author: author || 'UP ' + mid, total: total || undefined, videos, next: next ? encCursor(next) : null, source, partial: source !== 'arc', tries };
}

// ---------------------------------------------------------------- 小红书
const XHS_REF = { referer: 'https://www.xiaohongshu.com/' };
function xhsState(html) {
  const raw = pick(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/, html);
  if (!raw) throw fail('XHS_PARSE');
  return JSON.parse(raw.replace(/\bundefined\b/g, 'null'));
}
async function xhsSingle(u) {
  const noteId = pick(/\/(?:explore|discovery\/item|item)\/([0-9a-f]{24})/, u.pathname) || pick(/([0-9a-f]{24})/, u.pathname);
  const { text } = await getText(u.href, { headers: XHS_REF });
  const map = xhsState(text).note?.noteDetailMap || {};
  const note = (map[noteId] || Object.values(map)[0] || {}).note;
  if (!note?.noteId) throw fail('XHS_NOTE');
  const st = note.video?.media?.stream || {};
  const s = [...(st.h264 || []), ...(st.h265 || []), ...(st.av1 || [])][0];
  const src = s?.masterUrl || s?.backupUrls?.[0];
  return {
    platform: 'xiaohongshu', playType: src ? 'xhs' : 'external', vid: note.noteId, url: u.href,
    title: note.title || (note.desc || '').slice(0, 40) || '', author: note.user?.nickname || '',
    authorUrl: note.user?.userId ? `https://www.xiaohongshu.com/user/profile/${note.user.userId}` : undefined,
    duration: fmtDur(note.video?.capa?.duration), thumb: https(note.imageList?.[0]?.urlDefault || note.imageList?.[0]?.url),
    src, isVideo: note.type === 'video',
  };
}
async function xhsCreator(u) {
  const { text } = await getText(u.href, { headers: XHS_REF });
  const st = xhsState(text);
  if (!st.user?.notes?.[0]?.length) throw fail('XHS_LOGIN');
  const author = st.user?.userPageData?.basicInfo?.nickname || '';
  const videos = st.user.notes[0]
    .map((n) => (n.noteCard ? { ...n.noteCard, id: n.id || n.noteCard.noteId, xsecToken: n.xsecToken || n.noteCard.xsecToken } : n))
    .filter((n) => n.type === 'video')
    .map((n) => ({
      platform: 'xiaohongshu', playType: 'xhs', vid: n.id,
      url: `https://www.xiaohongshu.com/explore/${n.id}?xsec_token=${encodeURIComponent(n.xsecToken || '')}&xsec_source=pc_user`,
      title: n.displayTitle || '', author: n.user?.nickname || n.user?.nickName || author, duration: '', thumb: https(n.cover?.urlDefault || n.cover?.url),
      authorUrl: u.origin + u.pathname,
    }));
  return { author, videos, next: null, noteCode: 'XHS_FIRST_PAGE' };
}

// ---------------------------------------------------------------- 其他网站（用助手读取页面标题/封面）
async function otherSingle(u) {
  const off = parseOffline(u.href);
  let html = '';
  try { html = (await getText(u.href)).text; } catch (e) { if (off) return off; throw e; }
  const title = meta(html, 'og:title') || decodeHtml(pick(/<title[^>]*>([^<]*)/i, html) || '');
  const extra = { title, author: meta(html, 'og:site_name') || u.hostname, thumb: https(meta(html, 'og:image')) };
  if (off) return { ...off, ...extra, title: extra.title || off.title };
  const player = meta(html, 'twitter:player') || meta(html, 'og:video:secure_url') || meta(html, 'og:video:url') || meta(html, 'og:video');
  const isFile = player && /\.(mp4|webm|m3u8)(\?|$)/i.test(player);
  return {
    platform: 'other', playType: player ? (isFile ? 'video' : 'iframe') : 'external', vid: u.href, url: u.href,
    embed: player && !isFile ? https(player) : undefined, src: isFile ? https(player) : undefined, duration: '', ...extra,
  };
}

// ---------------------------------------------------------------- 统一入口
// ---------------------------------------------------------------- 百度网盘（自己网盘里的视频，需要助手）
// 粘贴网盘网页版的文件夹地址（地址栏里带 path=）或视频播放页地址；文件夹会像频道一样列出里面的视频。
// 请求都由助手带着本浏览器里的网盘登录状态发出；播放地址每次播放时重新获取（几小时后会过期）。
const BDPAN = 'https://pan.baidu.com';
const BDPAN_REF = { referer: 'https://pan.baidu.com/disk/main' };
const VIDEO_EXT = /\.(mp4|m4v|mkv|mov|avi|flv|f4v|ts|m2ts|wmv|rmvb|rm|webm|3gp|mpg|mpeg|vob)$/i;
const bdCollator = new Intl.Collator(['zh-Hans-CN', 'en'], { numeric: true, sensitivity: 'base' });
export const isBdpan = (u) => /(^|\.)(pan|yun)\.baidu\.com$/i.test(u.hostname);
function bdpanPath(u) {
  if (/^\/(s\/|share\/)/.test(u.pathname)) throw fail('BDPAN_SHARE');
  const hashQuery = new URLSearchParams((u.hash.split('?')[1] || ''));
  const p = u.searchParams.get('path') || hashQuery.get('path') || hashQuery.get('dir') || u.searchParams.get('dir');
  if (!p) throw fail('BDPAN_PATH');
  return bdNorm(p);
}
// 网盘手机网页版的地址里，路径会被再编码一次（%2F 原样留下），空格等字符写成 "@20" 这样的形式
function bdNorm(p) {
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(p); i++) { try { p = decodeURIComponent(p); } catch { break; } }
  return p.startsWith('/') ? p : '/' + p;
}
// 备选写法：把 "@20" 这类当成转义字符还原（文件名里本来就有 "@" 时不能先这样做，所以只在找不到时再试）
const bdAtVariant = (p) => (/@[0-9a-f]{2}/i.test(p) ? bdNorm(p.replace(/@([0-9a-f]{2})/gi, '%$1')) : null);
const bdDir = (path) => path.replace(/\/[^/]*$/, '') || '/';
const bdName = (path) => path.split('/').filter(Boolean).pop() || '网盘';
export const bdpanFolderUrl = (dir) => `${BDPAN}/disk/main#/index?category=all&path=${encodeURIComponent(dir)}`;
async function bdApi(path) {
  const j = await getJson(BDPAN + path, { headers: BDPAN_REF });
  if (j.errno === -6) throw fail('BDPAN_LOGIN');
  return j;
}
async function bdList(dir) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const j = await bdApi(`/api/list?dir=${encodeURIComponent(dir)}&num=1000&page=${page}&order=name&desc=0&web=1&clienttype=0&app_id=250528`);
    if (j.errno === -9) throw fail('BDPAN_NOT_FOUND', dir);
    if (j.errno !== 0) throw fail('BDPAN_API', String(j.errno));
    all.push(...(j.list || []));
    if (!j.list || j.list.length < 1000) break;
  }
  return all;
}
const bdVideo = (f, dir) => ({
  platform: 'baidupan', playType: 'bdpan', vid: f.path,
  url: `${BDPAN}/pfile/video?path=${encodeURIComponent(f.path)}`,
  title: f.server_filename.replace(VIDEO_EXT, ''), author: bdName(dir), authorUrl: bdpanFolderUrl(dir),
  thumb: f.thumbs?.url3 || f.thumbs?.url2 || f.thumbs?.url1 || '', duration: f.duration ? fmtDur(f.duration) : '',
});
const isVid = (f) => !f.isdir && (f.category === 1 || VIDEO_EXT.test(f.server_filename || ''));
async function bdpanResolve(u) {
  if (!transport) throw fail('NEED_HELPER_BDPAN');
  const path = bdpanPath(u);
  try {
    return await bdpanResolvePath(path);
  } catch (e) {
    const alt = e.code === 'BDPAN_NOT_FOUND' && bdAtVariant(path);
    if (!alt || alt === path) throw e;
    return bdpanResolvePath(alt);
  }
}
async function bdpanResolvePath(path) {
  if (VIDEO_EXT.test(path)) {
    const dir = bdDir(path);
    const items = (await bdList(dir)).filter(isVid).sort((a, b) => bdCollator.compare(a.server_filename, b.server_filename));
    const f = items.find((x) => x.path === path);
    if (!f) throw fail('BDPAN_NOT_FOUND', path);
    const videos = items.map((x) => bdVideo(x, dir));
    const video = videos.find((v) => v.vid === path);
    return { kind: 'video', video, collection: videos.length > 1 ? { id: 'bdpan:' + dir, title: bdName(dir), videos } : undefined };
  }
  const list = await bdList(path);
  const videos = list.filter(isVid).sort((a, b) => bdCollator.compare(a.server_filename, b.server_filename)).map((f) => bdVideo(f, path));
  // 子文件夹：列出来让家长点进去（视频常按字幕版本 / 季分在子文件夹里）
  const subfolders = list.filter((f) => f.isdir).sort((a, b) => bdCollator.compare(a.server_filename, b.server_filename))
    .map((f) => ({ name: f.server_filename, url: bdpanFolderUrl(f.path) }));
  if (!videos.length && !subfolders.length) throw fail('BDPAN_EMPTY', bdName(path));
  if (!videos.length) return { kind: 'folders', title: bdName(path), subfolders };
  return { kind: 'creator', author: bdName(path), total: videos.length, videos, next: null, collection: { id: 'bdpan:' + path, title: bdName(path) }, subfolders };
}
// 播放：取 HLS 播放列表（m3u8 文本）。非会员第一次请求可能要求先"看广告"（errno 133），按要求等待后带上 adToken 再取
export async function bdpanStream(path, quality = 'M3U8_AUTO_720', onWait) {
  if (!transport) throw fail('NEED_HELPER_BDPAN');
  let adToken = '';
  for (let i = 0; i < 4; i++) {
    const { text } = await getText(`${BDPAN}/api/streaming?path=${encodeURIComponent(path)}&app_id=250528&clienttype=0&type=${quality}&vip=0&web=1${adToken ? '&adToken=' + encodeURIComponent(adToken) : ''}`, { headers: BDPAN_REF });
    if (text.startsWith('#EXTM3U')) return text;
    let j = {};
    try { j = JSON.parse(text); } catch {}
    if (j.errno === -6) throw fail('BDPAN_LOGIN');
    if (j.errno === 133 && j.adToken) { adToken = j.adToken; const sec = Number(j.adTime) || 0; onWait?.(sec); await new Promise((r) => setTimeout(r, sec * 1000 + 300)); continue; }
    if (j.errno === 31341 || j.errno === 31024) { onWait?.(3); await new Promise((r) => setTimeout(r, 3000)); continue; } // 正在转码
    throw fail('BDPAN_STREAM', String(j.errno ?? text.slice(0, 40)));
  }
  throw fail('BDPAN_STREAM', 'retry');
}
// 播放器取视频分片（百度的分片服务器不允许网页直接读取，经助手代取）
export const bdpanFetch = (url) => download(url, {});
// 刷新封面（封面地址也会过期）：每个文件夹列一次
export async function bdpanThumbs(dirs) {
  const out = new Map();
  for (const dir of dirs) {
    try { for (const f of await bdList(dir)) if (isVid(f) && f.thumbs) out.set(f.path, f.thumbs.url3 || f.thumbs.url2 || f.thumbs.url1); } catch {}
  }
  return out;
}

// 返回 { kind: 'video', video, manual? } 或 { kind: 'creator', author, videos, next, total?, noteCode? }
export async function resolve({ url, cursor, ytKey }) {
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let u;
  try { u = new URL(url); } catch { throw fail('BAD_URL'); }
  // 小红书网页版不能看内容，已不再支持
  if (/(^|\.)(xiaohongshu\.com|xhslink\.com|xhslink\.cn)$/i.test(u.hostname)) throw fail('XHS_UNSUPPORTED');
  // 抖音不适合孩子观看，已不再支持
  if (/(^|\.)(douyin\.com|iesdouyin\.com)$/i.test(u.hostname)) throw fail('DOUYIN_UNSUPPORTED');
  // 西瓜视频和 TikTok 以短视频为主，暂不支持
  if (/(^|\.)(ixigua\.com|tiktok\.com)$/i.test(u.hostname)) throw fail('SHORTVIDEO_UNSUPPORTED');
  if (SHORT_HOSTS.test(u.hostname)) {
    if (!transport) throw fail('SHORT_LINK');
    u = new URL((await request(u.href)).url || u.href);
  }
  const h = u.hostname.replace(/^(www|m)\./, '');
  if (isBdpan(u)) return bdpanResolve(u);

  if (isYouTube(u.hostname)) {
    const id = ytVideoId(u);
    const listId = u.searchParams.get('list');
    if (id && !cursor) {
      // 视频链接带 list=（播放列表里的某一集）：提示可以整个列表一起添加；RD 开头是自动生成的"合辑"，跳过
      const playlistUrl = listId && !/^RD/.test(listId) ? `https://www.youtube.com/playlist?list=${listId}` : undefined;
      return { kind: 'video', video: await ytSingle(id), playlistUrl };
    }
    if (listId || /^\/(@|channel\/|c\/|user\/)/.test(u.pathname)) {
      const r = await ytCreator(u, { cursor, ytKey });
      if (listId) r.collection = { id: 'yt-' + listId, title: r.author, cover: r.cover };
      // 频道主页（非播放列表）：记下博主主页，便于按博主归类、查看更多视频
      const home = u.searchParams.get('list') ? null : 'https://www.youtube.com' + u.pathname.split('/').slice(0, u.pathname.startsWith('/@') ? 2 : 3).join('/');
      if (home) r.videos.forEach((v) => (v.authorUrl = v.authorUrl || home));
      return { kind: 'creator', ...r };
    }
    throw fail('YT_URL');
  }
  if (/bilibili\.com$/.test(h)) {
    const col = biliCollectionRef(u);
    if (col) {
      if (!transport) throw fail('NEED_HELPER_BILI');
      return { kind: 'creator', ...(await biliCollection(col, { cursor })) };
    }
    const mid = biliSpaceMid(u);
    if (mid) {
      if (!transport) throw fail('NEED_HELPER_BILI');
      return { kind: 'creator', ...(await biliCreator(new URL(`https://space.bilibili.com/${mid}`), { cursor })) };
    }
    return single(u, () => biliSingle(u), { jsonpOk: true });
  }
  return single(u, () => otherSingle(u));
}
async function withHelper(fn, kind) {
  if (!transport) throw fail('NEED_HELPER');
  return { kind, ...(await fn()) };
}
// 单个视频：有助手 → 完整信息；没有 → 从链接识别（标题由家长填写）
const asVideo = (v) => {
  const { _collection, ...video } = v;
  return { kind: 'video', video, collection: _collection };
};
async function single(u, full, { jsonpOk = false } = {}) {
  if (transport) return asVideo(await full());
  // B 站单个视频可以不经助手读取（JSONP）。偶尔会失败（网络慢、B 站风控）：自动再试一次；
  // 仍然失败就退回只识别 ID，并把原因带回去，让页面显示"重试"而不是悄悄变成手填标题
  let why;
  if (jsonpOk) {
    for (let i = 0; i < 2; i++) {
      try { return asVideo(await full()); } catch (e) { why = e.detail || e.message || e.code; }
      if (i === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  const off = parseOffline(u.href);
  if (!off) throw fail('NEED_HELPER');
  if (off.platform === 'vimeo') {
    try {
      const o = await getJson(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u.href)}`);
      return { kind: 'video', video: { ...off, title: o.title, author: o.author_name, thumb: o.thumbnail_url } };
    } catch {}
  }
  return { kind: 'video', video: off, manual: !off.title, why };
}

// 播放前重新解析小红书视频地址（地址会过期）
export async function xhsStream(url) {
  const v = await xhsSingle(new URL(url));
  if (!v.src) throw fail('XHS_NOTE');
  return v.src;
}
// B 站：通过助手取 html5 版 mp4 地址，在朵米片单自己的 <video> 里播放。
// 手机版 Firefox 上 B 站嵌入播放器加载不出视频；而 mp4 服务器接受任何网站的浏览器请求，可以边下边播。
// 会员 / 付费内容、分段视频或试看片段取不到完整 mp4，调用方会退回嵌入播放器。
export async function biliStream(v) {
  if (!transport) throw fail('NEED_HELPER');
  const idq = v.vid.startsWith('av') ? 'aid=' + v.vid.slice(2) : 'bvid=' + v.vid;
  const view = await getJson(`https://api.bilibili.com/x/web-interface/view?${idq}`, { headers: BILI_REF });
  if (view.code !== 0) throw fail('BILI_API', `${view.code} ${view.message || ''}`.trim());
  const pg = view.data.pages?.[(v.page || 1) - 1] || view.data.pages?.[0];
  const cid = pg?.cid || view.data.cid;
  const d = await getJson(`https://api.bilibili.com/x/player/playurl?${idq}&cid=${cid}&qn=80&fnval=1&fnver=0&platform=html5&high_quality=1`, { headers: BILI_REF });
  if (d.code !== 0) throw fail('BILI_API', `${d.code} ${d.message || ''}`.trim());
  const durl = d.data?.durl;
  if (!durl || durl.length !== 1 || !durl[0].url) throw fail('BILI_API', 'no mp4');
  // 试看：返回的时长明显短于视频时长
  const full = (pg?.duration || view.data.duration || 0) * 1000;
  if (d.data.is_preview || (full && d.data.timelength && d.data.timelength < full * 0.9)) throw fail('BILI_API', 'preview');
  return https(durl[0].url);
}

export const XHS_HEADERS = XHS_REF;

// 根据已加入的视频找到博主主页（旧数据没有 authorUrl 时现查）
export async function creatorUrlOf(v) {
  if (v.authorUrl) return v.authorUrl;
  if (v.platform === 'youtube') return (await ytSingle(v.vid)).authorUrl || null;
  if (v.platform === 'bilibili' && /^(BV|av)/.test(v.vid)) {
    try { return (await biliSingle(new URL(v.url))).authorUrl || null; } catch { return null; }
  }
  if (v.platform === 'xiaohongshu' && transport) {
    try { return (await xhsSingle(new URL(v.url))).authorUrl || null; } catch { return null; }
  }
  return null;
}
