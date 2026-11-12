// 打包浏览器扩展：node extension/build.mjs
// 输出 extension/dist/chrome（Chrome / Edge）和 extension/dist/firefox，以及各自的 .zip（用于上架商店）。
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const pkg = JSON.parse(readFileSync(join(ROOT, 'version.json'), 'utf8'));

// 只在朵米片单自己的网址上运行（localhost / 127.0.0.1 用于本地开发）
const SITES = [
  'https://lists.domibuddy.com/*', 'https://domibuddy.com/*', 'https://www.domibuddy.com/*',
  'https://domibuddy.pages.dev/*', 'https://*.domibuddy.pages.dev/*', 'https://dickenson258.github.io/kidstube/*',
  'http://localhost/*', 'http://127.0.0.1/*',
];
const VIDEO_HOSTS = ['bilibili.com', 'b23.tv', 'bili2233.cn', 'youtube.com', 'youtu.be', 'googleapis.com', 'qq.com', 'youku.com', 'vimeo.com', 'dailymotion.com', 'iqiyi.com', 'mgtv.com', 'baidu.com', 'baidupcs.com']
  .flatMap((h) => [`*://${h}/*`, `*://*.${h}/*`]);

const base = {
  manifest_version: 3,
  name: '__MSG_name__',
  short_name: '__MSG_shortName__',
  description: '__MSG_description__',
  default_locale: 'zh_CN',
  version: pkg.version,
  homepage_url: 'https://lists.domibuddy.com',
  icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  permissions: ['storage', 'declarativeNetRequestWithHostAccess'],
  host_permissions: VIDEO_HOSTS,
  content_scripts: [
    { matches: SITES, js: ['content.js'], run_at: 'document_end' },
    { matches: ['https://player.youku.com/*'], js: ['youku.js'], run_at: 'document_end', all_frames: true },
  ],
};

const targets = {
  chrome: { ...base, background: { service_worker: 'background.js' }, minimum_chrome_version: '116' },
  firefox: {
    ...base,
    background: { scripts: ['background.js'] },
    browser_specific_settings: {
      gecko: { id: 'helper@domibuddy.com', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } },
    },
  },
};

rmSync(DIST, { recursive: true, force: true });
for (const [name, manifest] of Object.entries(targets)) {
  const out = join(DIST, name);
  mkdirSync(out, { recursive: true });
  cpSync(join(ROOT, 'src'), out, { recursive: true });
  cpSync(join(ROOT, 'icons'), join(out, 'icons'), { recursive: true });
  cpSync(join(ROOT, '_locales'), join(out, '_locales'), { recursive: true });
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const zip = join(DIST, `domibuddy-helper-${name}-${pkg.version}.zip`);
  execFileSync('zip', ['-qr', '-X', zip, '.'], { cwd: out });
  console.log('built', zip);
}
