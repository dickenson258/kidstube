// 百度网盘的转码视频在同一个 PPS 编号下不停更换 pic_init_qp（同一段视频里 30～33 来回变）。
// 苹果的硬件解码器（iPhone / iPad / Mac）跟不上这种变化：画面变糊、马赛克、卡住，Chrome 直接报解码错误。
// 这里在 hls.js 转好的 fMP4 片段送进解码器之前改写：所有 PPS 统一成第一个，
// 每个 slice 的 slice_qp_delta 补上差值，解出来的画面完全一样。
// 只改 slice 头里的一个数字，后面的 CABAC 数据按字节原样保留。出错就原样放行。

// ---------- 比特读写 ----------
class BitReader {
  constructor(b) { this.b = b; this.p = 0; }
  u(n) { let v = 0; for (let i = 0; i < n; i++) { v = v * 2 + ((this.b[this.p >> 3] >> (7 - (this.p & 7))) & 1); this.p++; } return v; }
  ue() { let z = 0; while (!this.u(1)) { if (++z > 31) throw new Error('ue'); } return z ? (1 << z) - 1 + this.u(z) : 0; }
  se() { const k = this.ue(); return k & 1 ? (k + 1) / 2 : -k / 2; }
  get left() { return this.b.length * 8 - this.p; }
}
class BitWriter {
  constructor() { this.out = []; this.cur = 0; this.n = 0; }
  bit(v) { this.cur = (this.cur << 1) | v; if (++this.n === 8) { this.out.push(this.cur); this.cur = 0; this.n = 0; } }
  u(v, n) { for (let i = n - 1; i >= 0; i--) this.bit(Math.floor(v / 2 ** i) & 1); }
  ue(v) { const x = v + 1, len = Math.floor(Math.log2(x)); this.u(0, len); this.u(x, len + 1); }
  se(v) { this.ue(v > 0 ? 2 * v - 1 : -2 * v); }
  copy(r, from, to) { for (let p = from; p < to; p++) this.bit((r.b[p >> 3] >> (7 - (p & 7))) & 1); }
}
const unescape = (n) => { // 去掉防竞争字节 00 00 03
  const o = new Uint8Array(n.length); let j = 0, z = 0;
  for (let i = 0; i < n.length; i++) { const c = n[i]; if (z >= 2 && c === 3) { z = 0; continue; } o[j++] = c; z = c === 0 ? z + 1 : 0; }
  return o.subarray(0, j);
};
const escape = (r) => {
  const o = []; let z = 0;
  for (const c of r) { if (z >= 2 && c <= 3) { o.push(3); z = 0; } o.push(c); z = c === 0 ? z + 1 : 0; }
  return Uint8Array.from(o);
};

// ---------- SPS / PPS ----------
function parseSps(nal) {
  const r = new BitReader(unescape(nal)); r.u(8);
  const prof = r.u(8); r.u(16); const id = r.ue();
  let chroma = 1, sep = 0;
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(prof)) {
    chroma = r.ue(); if (chroma === 3) sep = r.u(1);
    r.ue(); r.ue(); r.u(1);
    if (r.u(1)) for (let i = 0; i < (chroma !== 3 ? 8 : 12); i++) if (r.u(1)) { let last = 8, next = 8; for (let j = 0; j < (i < 6 ? 16 : 64); j++) { if (next) next = (last + r.se() + 256) % 256; last = next || last; } }
  }
  const frameNumBits = r.ue() + 4, pocType = r.ue();
  let pocBits = 0, pocZero = 0;
  if (pocType === 0) pocBits = r.ue() + 4;
  else if (pocType === 1) { pocZero = r.u(1); r.se(); r.se(); const n = r.ue(); for (let i = 0; i < n; i++) r.se(); }
  r.ue(); r.u(1); r.ue(); r.ue();
  const frameMbsOnly = r.u(1);
  return { id, chromaType: sep ? 0 : chroma, sep, frameNumBits, pocType, pocBits, pocZero, frameMbsOnly };
}
function parsePps(nal) {
  const raw = unescape(nal), r = new BitReader(raw); r.u(8);
  const id = r.ue(), sps = r.ue(), cabac = r.u(1), bfp = r.u(1);
  if (r.ue() !== 0) throw new Error('slice groups');
  const l0 = r.ue() + 1, l1 = r.ue() + 1, wp = r.u(1), wb = r.u(2);
  const qpAt = r.p, qp = 26 + r.se(), qpEnd = r.p;
  r.se(); r.se();
  const dbf = r.u(1); r.u(1); const rpc = r.u(1);
  return { id, sps, cabac, bfp, l0, l1, wp, wb, qp, dbf, rpc, raw, qpAt, qpEnd };
}
// ---------- slice 头：找到 slice_qp_delta，改值；CABAC 数据从字节边界开始，原样拷贝 ----------
function fixSlice(nal, st, delta) {
  const raw = unescape(nal), r = new BitReader(raw);
  r.u(1); const refIdc = r.u(2), type = r.u(5), idr = type === 5;
  r.ue(); const sliceType = r.ue() % 5, ppsId = r.ue();
  const pps = st.cur.get(ppsId), sps = pps && st.sps.get(pps.sps);
  if (!pps || !sps) throw new Error('no pps');
  if (!pps.cabac) throw new Error('cavlc'); // 只处理 CABAC（百度的都是）
  const P = sliceType === 0, B = sliceType === 1, I = sliceType === 2, SP = sliceType === 3, SI = sliceType === 4;
  if (sps.sep) r.u(2);
  r.u(sps.frameNumBits);
  let field = 0; if (!sps.frameMbsOnly) { field = r.u(1); if (field) r.u(1); }
  if (idr) r.ue();
  if (sps.pocType === 0) { r.u(sps.pocBits); if (pps.bfp && !field) r.se(); }
  if (sps.pocType === 1 && !sps.pocZero) { r.se(); if (pps.bfp && !field) r.se(); }
  if (pps.rpc) r.ue();
  if (B) r.u(1);
  let l0 = pps.l0, l1 = pps.l1;
  if (P || SP || B) { if (r.u(1)) { l0 = r.ue() + 1; if (B) l1 = r.ue() + 1; } }
  const mod = () => { if (r.u(1)) { for (let k = 0; k < 64; k++) { const idc = r.ue(); if (idc === 3) return; r.ue(); } throw new Error('rplm'); } };
  if (!I && !SI) mod();
  if (B) mod();
  if ((pps.wp && (P || SP)) || (pps.wb === 1 && B)) {
    r.ue(); if (sps.chromaType) r.ue();
    const tbl = (n) => { for (let i = 0; i < n; i++) { if (r.u(1)) { r.se(); r.se(); } if (sps.chromaType && r.u(1)) { r.se(); r.se(); r.se(); r.se(); } } };
    tbl(l0); if (B) tbl(l1);
  }
  if (refIdc) {
    if (idr) r.u(2);
    else if (r.u(1)) { for (let k = 0; k < 64; k++) { const op = r.ue(); if (!op) break; if (op === 1 || op === 3) r.ue(); if (op === 2) r.ue(); if (op === 3 || op === 6) r.ue(); if (op === 4) r.ue(); } }
  }
  if (!I && !SI) r.ue();
  const qAt = r.p, q = r.se(), qEnd = r.p;
  if (SP || SI) throw new Error('sp');
  if (pps.dbf) { if (r.ue() !== 1) { r.se(); r.se(); } }
  const hdrEnd = r.p, dataAt = (hdrEnd + 7) >> 3;
  for (let p = hdrEnd; p < dataAt * 8; p++) if (!((raw[p >> 3] >> (7 - (p & 7))) & 1)) throw new Error('align'); // cabac_alignment_one_bit 都应是 1
  const w = new BitWriter();
  w.copy(r, 0, qAt); w.se(q + delta); w.copy(r, qEnd, hdrEnd);
  while (w.n) w.bit(1);
  const head = Uint8Array.from(w.out), body = raw.subarray(dataAt);
  const outRaw = new Uint8Array(head.length + body.length); outRaw.set(head); outRaw.set(body, head.length);
  return escape(outRaw);
}

// ---------- fMP4 ----------
const rd32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const wr32 = (b, o, v) => { b[o] = v >>> 24; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255; };
const typ = (b, o) => String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
function* boxes(b, from, to) { for (let o = from; o + 8 <= to;) { const s = rd32(b, o); if (s < 8 || o + s > to) return; yield [typ(b, o), o, s]; o += s; } }
const child = (b, o, s, name, skip = 8) => { for (const x of boxes(b, o + skip, o + s)) if (x[0] === name) return x; return null; };

function readInit(b, st) {
  const moov = [...boxes(b, 0, b.length)].find((x) => x[0] === 'moov'); if (!moov) return false;
  for (const trak of boxes(b, moov[1] + 8, moov[1] + moov[2])) {
    if (trak[0] !== 'trak') continue;
    let x = child(b, trak[1], trak[2], 'mdia'); x = x && child(b, x[1], x[2], 'minf'); x = x && child(b, x[1], x[2], 'stbl'); x = x && child(b, x[1], x[2], 'stsd');
    const avc1 = x && child(b, x[1], x[2], 'avc1', 16); const avcC = avc1 && child(b, avc1[1], avc1[2], 'avcC', 8 + 78);
    if (!avcC) continue;
    let o = avcC[1] + 8; st.lenSize = (b[o + 4] & 3) + 1; const ns = b[o + 5] & 31; o += 6;
    for (let i = 0; i < ns; i++) { const l = (b[o] << 8) | b[o + 1]; const s = parseSps(b.subarray(o + 2, o + 2 + l)); st.sps.set(s.id, s); o += 2 + l; }
    const np = b[o++];
    for (let i = 0; i < np; i++) {
      const l = (b[o] << 8) | b[o + 1], at = o + 2; o += 2 + l;
      const p = parsePps(b.subarray(at, at + l)), c = st.canon.get(p.id);
      st.cur.set(p.id, p);
      // 之后的 init（换文件、跳转后 hls.js 会重发）沿用第一次的 PPS，免得中途换了"标准"
      if (c && c.qp !== p.qp && c.bytes.length === l) { b.set(c.bytes, at); st.cur.set(p.id, c); }
      else st.canon.set(p.id, { ...p, bytes: b.slice(at, at + l) });
    }
    return true;
  }
  return false;
}

function fixSample(s, st) {
  const L = st.lenSize, parts = []; let changed = false;
  for (let o = 0; o + L <= s.length;) {
    let n = 0; for (let i = 0; i < L; i++) n = n * 256 + s[o + i];
    const nal = s.subarray(o + L, o + L + n); o += L + n;
    const t = nal[0] & 31; let out = nal;
    if (t === 7) { const x = parseSps(nal); st.sps.set(x.id, x); }
    else if (t === 8) {
      const p = parsePps(nal); st.cur.set(p.id, p);
      let c = st.canon.get(p.id); if (!c) { c = { ...p, bytes: nal.slice() }; st.canon.set(p.id, c); }
      if (p.qp !== c.qp) { out = c.bytes; changed = true; }
    } else if (t === 1 || t === 5) {
      const r = new BitReader(nal.subarray(1, 8)); r.ue(); r.ue(); const id = r.ue();
      const p = st.cur.get(id), c = st.canon.get(id);
      if (p && c && p.qp !== c.qp) { out = fixSlice(nal, st, p.qp - c.qp); changed = true; }
    }
    parts.push(out);
  }
  if (!changed) return s;
  let total = 0; for (const p of parts) total += L + p.length;
  const o = new Uint8Array(total); let k = 0;
  for (const p of parts) { let n = p.length; for (let i = L - 1; i >= 0; i--) { o[k + i] = n & 255; n = Math.floor(n / 256); } o.set(p, k + L); k += L + p.length; }
  return o;
}

function fixMedia(b, st) {
  const list = [...boxes(b, 0, b.length)]; let changed = false; const out = [];
  for (let i = 0; i < list.length; i++) {
    const [name, o, s] = list[i];
    if (name !== 'moof' || list[i + 1]?.[0] !== 'mdat') { out.push(b.subarray(o, o + s)); continue; }
    const [, mo, ms] = list[i + 1]; i++;
    const moof = b.slice(o, o + s);
    const traf = child(moof, 0, s, 'traf'), trun = traf && child(moof, traf[1], traf[2], 'trun');
    if (!trun) { out.push(moof, b.subarray(mo, mo + ms)); continue; }
    let p = trun[1] + 8; const flags = rd32(moof, p) & 0xffffff; p += 4;
    const count = rd32(moof, p); p += 4;
    const dataOff = flags & 1 ? rd32(moof, p) : 8 + s; if (flags & 1) p += 4; if (flags & 4) p += 4;
    if (!(flags & 0x200)) { out.push(moof, b.subarray(mo, mo + ms)); continue; }
    const per = [0x100, 0x200, 0x400, 0x800].filter((f) => flags & f).length * 4, sizeAt = flags & 0x100 ? 4 : 0;
    const samples = []; let at = o + dataOff, any = false;
    for (let k = 0; k < count; k++) {
      const so = p + k * per + sizeAt, sz = rd32(moof, so), src = b.subarray(at, at + sz); at += sz;
      const fixed = fixSample(src, st); if (fixed !== src) any = true;
      samples.push(fixed); wr32(moof, so, fixed.length);
    }
    if (!any) { out.push(b.subarray(o, o + s), b.subarray(mo, mo + ms)); continue; }
    changed = true;
    let body = 0; for (const x of samples) body += x.length;
    const mdat = new Uint8Array(8 + body); wr32(mdat, 0, 8 + body); mdat.set([109, 100, 97, 116], 4);
    let q = 8; for (const x of samples) { mdat.set(x, q); q += x.length; }
    out.push(moof, mdat);
  }
  if (!changed) return b;
  let n = 0; for (const x of out) n += x.length;
  const r = new Uint8Array(n); let k = 0; for (const x of out) { r.set(x, k); k += x.length; }
  return r;
}

// 包装 hls.js 的视频 SourceBuffer：append 之前改写
export function wrapSourceBuffer(sb) {
  if (!sb || sb.__ktFix) return;
  sb.__ktFix = true;
  const st = { sps: new Map(), cur: new Map(), canon: new Map(), lenSize: 4, ok: true };
  const orig = sb.appendBuffer.bind(sb);
  sb.appendBuffer = (data) => {
    if (st.ok) {
      try {
        const b = new Uint8Array(data instanceof ArrayBuffer ? data.slice(0) : data); // 拷一份再改
        if (readInit(b, st)) return orig(b);
        if (st.canon.size) { const f = fixMedia(b, st); if (f !== b) return orig(f); }
      } catch (e) { st.ok = false; console.warn('[DomiBuddy] h264fix off:', e?.message || e); }
    }
    return orig(data);
  };
}
