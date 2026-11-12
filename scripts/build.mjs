// 生产构建：node scripts/build.mjs → dist/
// - public/ 原样复制（开发时仍直接用 public/，npm start 不需要构建）
// - app.js 连同它 import 的模块打包成一个压缩后的文件，style.css 压缩：首屏少一轮请求、文件更小
// - index.html 里引用改成 app.js?v=<内容哈希>、style.css?v=<内容哈希>，配合 _headers 的一年缓存：
//   再次打开直接用浏览器缓存；每次发布哈希变化，浏览器自动拿新版本，不会新旧文件混用
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'public'), OUT = join(ROOT, 'dist');
const ESBUILD = ['--yes', 'esbuild@0.24.0'];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(SRC, OUT, { recursive: true });

const run = (args) => execFileSync('npx', [...ESBUILD, ...args], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
run(['public/app.js', '--bundle', '--format=esm', '--minify', '--target=es2020', '--legal-comments=none', '--charset=utf8', '--outfile=dist/app.js']);
run(['public/style.css', '--minify', '--charset=utf8', '--outfile=dist/style.css']);

const hash = (f) => createHash('sha256').update(readFileSync(join(OUT, f))).digest('hex').slice(0, 10);
const v = { 'app.js': hash('app.js'), 'style.css': hash('style.css') };
let html = readFileSync(join(OUT, 'index.html'), 'utf8');
for (const [f, h] of Object.entries(v)) {
  const re = new RegExp(`(["'])${f.replace('.', '\\.')}\\1`, 'g');
  if (!re.test(html)) throw new Error(`index.html does not reference ${f}`);
  html = html.replace(re, `$1${f}?v=${h}$1`);
}
writeFileSync(join(OUT, 'index.html'), html);

// 带版本号的文件可以长期缓存（_headers 只对 Cloudflare Pages 生效，GitHub Pages 会忽略）
appendFileSync(join(OUT, '_headers'), `
/app.js
  Cache-Control: public, max-age=31536000, immutable

/style.css
  Cache-Control: public, max-age=31536000, immutable
`);
const kb = (f) => Math.round(readFileSync(join(OUT, f)).length / 1024);
console.log(`built dist/: app.js ${kb('app.js')} KB (v=${v['app.js']}), style.css ${kb('style.css')} KB (v=${v['style.css']})`);
