// KidsTube 链接解析器 —— 运行在浏览器中（纯静态网站，无服务器）
//
// 浏览器的跨域限制（CORS）让网页无法读取 B 站、小红书等网站的数据。
// 安装 "KidsTube 助手" 用户脚本后，跨域请求经由脚本管理器发出，并使用家长自己的登录状态。
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
async function request(url, { method = 'GET', headers = {}, body, type = 'text' } = {}) {
  if (transport) return transport({ url, method, headers, body, type });
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

// ---------------------------------------------------------------- 离线识别（不联网，只看链接本身）
const RULES = [
  { re: /vimeo\.com\/(?:video\/)?(\d+)/, platform: 'vimeo', embed: (m) => `https://player.vimeo.com/video/${m[1]}` },
  { re: /dailymotion\.com\/video\/([a-z0-9]+)/i, platform: 'dailymotion', embed: (m) => `https://www.dailymotion.com/embed/video/${m[1]}` },
  { re: /v\.qq\.com\/x\/(?:cover\/[^/]+|page)\/([a-z0-9]{11})\.html/i, platform: 'qq', embed: (m) => `https://v.qq.com/txp/iframe/player.html?vid=${m[1]}` },
  { re: /v\.youku\.com\/v_show\/id_([^.]+)\.html/, platform: 'youku', embed: (m) => `https://player.youku.com/embed/${m[1]}` },
  { re: /douyin\.com\/(?:video|note)\/(\d+)/, platform: 'douyin', embed: (m) => `https://open.douyin.com/player/video?vid=${m[1]}&autoplay=0` },
  { re: /douyin\.com\/.*modal_id=(\d+)/, platform: 'douyin', embed: (m) => `https://open.douyin.com/player/video?vid=${m[1]}&autoplay=0` },
  { re: /tiktok\.com\/@[^/]+\/video\/(\d+)/, platform: 'tiktok', embed: (m) => `https://www.tiktok.com/player/v1/${m[1]}` },
  { re: /ixigua\.com\/(\d+)/, platform: 'ixigua', embed: (m) => `https://www.ixigua.com/iframe/${m[1]}?autoplay=0` },
  { re: /iqiyi\.com\/(v_\w+)/, platform: 'iqiyi', embed: null },
  { re: /mgtv\.com\/b\/\d+\/(\d+)/, platform: 'mgtv', embed: null },
];
const SHORT_HOSTS = /^(b23\.tv|bili2233\.cn|xhslink\.com|v\.douyin\.com|vm\.tiktok\.com|url\.cn)$/;
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
    return ytVideo(id, o.title, o.author_name);
  } catch {
    return ytVideo(id);
  }
}
function ytWalk(node, out, conts) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((n) => ytWalk(n, out, conts));
  const r = node.playlistVideoRenderer || node.videoRenderer || node.gridVideoRenderer || node.reelItemRenderer;
  if (r?.videoId) out.push(ytVideo(r.videoId, r.title?.runs?.[0]?.text || r.title?.simpleText || r.headline?.simpleText || '', '', r.lengthText?.simpleText || ''));
  const lv = node.lockupViewModel;
  if (lv?.contentId && /VIDEO/i.test(lv.contentType || 'VIDEO')) out.push(ytVideo(lv.contentId, lv.metadata?.lockupMetadataViewModel?.title?.content || ''));
  const sv = node.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
  if (sv) out.push(ytVideo(sv, node.shortsLockupViewModel.overlayMetadata?.primaryText?.content || ''));
  if (node.continuationCommand?.token) conts.push(node.continuationCommand.token);
  for (const k in node) ytWalk(node[k], out, conts);
}
async function ytBrowse(payload) {
  const data = await getJson('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20251020.01.00', hl: 'zh-CN', gl: 'US' } }, ...payload }),
  });
  const out = [], conts = [];
  ytWalk(data, out, conts);
  const seen = new Set();
  return { videos: out.filter((v) => !seen.has(v.vid) && seen.add(v.vid)), next: conts[conts.length - 1] || null };
}
async function ytChannelInfo(u) {
  let id = pick(/^\/channel\/(UC[\w-]{22})/, u.pathname);
  const base = u.pathname.split('/').slice(0, 2).join('/');
  const { text } = await getText(`https://www.youtube.com${id ? '/channel/' + id : base}`);
  id = id || pick(/"externalId":"(UC[\w-]{22})"/, text) || pick(/channel\/(UC[\w-]{22})/, text);
  if (!id) throw fail('YT_CHANNEL');
  return { id, name: meta(text, 'og:title') || id };
}
async function ytCreator(u, { cursor, ytKey }) {
  const c = decCursor(cursor);
  const listId = u.searchParams.get('list');

  // 有 API Key：Data API 允许网页直接跨域调用，无需助手
  if (ytKey) {
    let playlistId = c?.playlistId || listId, author = c?.author || '';
    if (!playlistId) {
      const id = pick(/^\/channel\/(UC[\w-]{22})/, u.pathname);
      const handle = pick(/^\/(@[^/]+)/, u.pathname);
      const user = pick(/^\/user\/([^/]+)/, u.pathname);
      let q = id ? `id=${id}` : handle ? `forHandle=${encodeURIComponent(decodeURIComponent(handle))}` : user ? `forUsername=${user}` : null;
      if (!q) q = `id=${(await ytChannelInfo(u)).id}`; // /c/xxx 需要助手读取页面
      const ch = (await getJson(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails,snippet&${q}&key=${ytKey}`)).items?.[0];
      if (!ch) throw fail('YT_NOT_FOUND');
      playlistId = ch.contentDetails.relatedPlaylists.uploads;
      author = ch.snippet.title;
    }
    const d = await getJson(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${ytKey}` + (c?.pageToken ? `&pageToken=${c.pageToken}` : ''));
    if (d.error) throw fail('YT_API', d.error.message);
    const videos = (d.items || []).map((it) => it.snippet)
      .filter((s) => s.resourceId?.videoId && s.title !== 'Private video' && s.title !== 'Deleted video')
      .map((s) => ytVideo(s.resourceId.videoId, s.title, author || s.channelTitle));
    return { author: author || 'YouTube', total: d.pageInfo?.totalResults, videos, next: d.nextPageToken ? encCursor({ playlistId, author, pageToken: d.nextPageToken }) : null };
  }

  // 无 Key：通过助手调用 YouTube 网页内部接口
  if (!transport) throw fail('NEED_HELPER_OR_KEY');
  if (c?.token) {
    const r = await ytBrowse({ continuation: c.token });
    r.videos.forEach((v) => (v.author = c.author));
    return { author: c.author, videos: r.videos, next: r.next ? encCursor({ token: r.next, author: c.author }) : null };
  }
  let author, browseId, channelId;
  if (listId) { browseId = 'VL' + listId; author = 'Playlist'; }
  else {
    const info = await ytChannelInfo(u);
    author = info.name;
    channelId = info.id;
    browseId = 'VLUU' + info.id.slice(2); // 频道"全部上传"播放列表
  }
  let r = await ytBrowse({ browseId });
  if (!r.videos.length && channelId) r = await ytBrowse({ browseId: channelId, params: 'EgZ2aWRlb3PyBgQKAjoA' });
  r.videos.forEach((v) => (v.author = author));
  return { author, videos: r.videos, next: r.next ? encCursor({ token: r.next, author }) : null };
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
  duration: typeof v.duration === 'number' ? fmtDur(v.duration) : v.length || v.duration || '', thumb: https(v.pic),
});
async function biliSingle(u) {
  const off = parseOffline(u.href);
  if (!off) {
    // 番剧/课程等无法外嵌，只能在原网站窗口播放
    const { text } = await getText(u.href);
    return { platform: 'bilibili', playType: 'external', vid: u.pathname, url: u.href, title: meta(text, 'og:title') || pick(/<title>([^<]*)/, text) || '', thumb: https(meta(text, 'og:image')), author: '', duration: '' };
  }
  const q = off.vid.startsWith('av') ? 'aid=' + off.vid.slice(2) : 'bvid=' + off.vid;
  const d = await getJson(`https://api.bilibili.com/x/web-interface/view?${q}`, { headers: BILI_REF });
  if (d.code !== 0) throw fail('BILI_API', d.message);
  const v = biliVideo(d.data);
  if (off.page) { v.page = off.page; v.title += ` (P${off.page})`; }
  return v;
}
async function biliCreator(u, { cursor }) {
  const mid = pick(/space\.bilibili\.com\/(\d+)/, u.href) || pick(/\/(\d+)/, u.pathname);
  if (!mid) throw fail('BILI_MID');
  const headers = { referer: `https://space.bilibili.com/${mid}/video` };
  const pn = decCursor(cursor)?.pn || 1, ps = 30;
  let list = [], total = 0, author = '';
  try {
    const q = wbiSign({ mid, ps, pn, order: 'pubdate', platform: 'web', web_location: 1550101, dm_img_list: '[]', dm_img_str: 'V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ', dm_cover_img_str: 'QU5HTEUgKEFwcGxlLCBBcHBsZSBNMSBQcm8sIE9wZW5HTCA0LjEp' }, await wbiKey());
    const d = await getJson(`https://api.bilibili.com/x/space/wbi/arc/search?${q}`, { headers });
    if (d.code !== 0) throw new Error(d.message);
    list = d.data.list.vlist;
    total = d.data.page.count;
    author = list[0]?.author || '';
  } catch (e) {
    if (e.code === 'NEED_HELPER') throw e;
    if (e.code === 'HTTP' && /^412/.test(e.detail)) throw fail('BILI_RISK', '412');
    const d = await getJson(`https://api.bilibili.com/x/series/recArchivesByKeywords?mid=${mid}&keywords=&ps=${ps}&pn=${pn}&orderby=pubdate`, { headers }).catch((err) => {
      throw err.code === 'HTTP' && /^412/.test(err.detail) ? fail('BILI_RISK', '412') : err;
    });
    if (d.code !== 0) throw fail('BILI_RISK', d.message || e.message);
    list = d.data.archives || [];
    total = d.data.page?.total || 0;
  }
  if (!author) {
    try { author = (await getJson(`https://api.bilibili.com/x/web-interface/card?mid=${mid}`, { headers: BILI_REF })).data?.card?.name || ''; } catch {}
  }
  const videos = list.map((v) => ({ ...biliVideo(v), author: author || v.author || '' }));
  return { author: author || 'UP ' + mid, total, videos, next: pn * ps < total ? encCursor({ pn: pn + 1 }) : null };
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
// 返回 { kind: 'video', video, manual? } 或 { kind: 'creator', author, videos, next, total?, noteCode? }
export async function resolve({ url, cursor, ytKey }) {
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let u;
  try { u = new URL(url); } catch { throw fail('BAD_URL'); }
  if (SHORT_HOSTS.test(u.hostname)) {
    if (!transport) throw fail('SHORT_LINK');
    u = new URL((await request(u.href)).url || u.href);
  }
  const h = u.hostname.replace(/^(www|m)\./, '');

  if (isYouTube(u.hostname)) {
    const id = ytVideoId(u);
    if (id && !cursor) return { kind: 'video', video: await ytSingle(id) };
    if (u.searchParams.get('list') || /^\/(@|channel\/|c\/|user\/)/.test(u.pathname)) return { kind: 'creator', ...(await ytCreator(u, { cursor, ytKey })) };
    throw fail('YT_URL');
  }
  if (/bilibili\.com$/.test(h)) {
    if (/^space\./.test(u.hostname)) return withHelper(() => biliCreator(u, { cursor }), 'creator');
    return single(u, () => biliSingle(u));
  }
  if (/xiaohongshu\.com$/.test(h)) {
    if (/\/user\/profile\//.test(u.pathname)) return withHelper(() => xhsCreator(u), 'creator');
    return withHelper(async () => ({ video: await xhsSingle(u) }), 'video');
  }
  return single(u, () => otherSingle(u));
}
async function withHelper(fn, kind) {
  if (!transport) throw fail('NEED_HELPER');
  return { kind, ...(await fn()) };
}
// 单个视频：有助手 → 完整信息；没有 → 从链接识别（标题由家长填写）
async function single(u, full) {
  if (transport) return { kind: 'video', video: await full() };
  const off = parseOffline(u.href);
  if (!off) throw fail('NEED_HELPER');
  if (off.platform === 'vimeo') {
    try {
      const o = await getJson(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u.href)}`);
      return { kind: 'video', video: { ...off, title: o.title, author: o.author_name, thumb: o.thumbnail_url } };
    } catch {}
  }
  return { kind: 'video', video: off, manual: !off.title };
}

// 播放前重新解析小红书视频地址（地址会过期）
export async function xhsStream(url) {
  const v = await xhsSingle(new URL(url));
  if (!v.src) throw fail('XHS_NOTE');
  return v.src;
}
export const XHS_HEADERS = XHS_REF;
