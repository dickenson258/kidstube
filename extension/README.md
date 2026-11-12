# 朵米助手 · DomiBuddy Helper（浏览器扩展）

用户脚本 `public/kidstube-helper.user.js` 的浏览器扩展版，一步安装、不需要 Tampermonkey。和网页之间用同一套 `window.postMessage` 协议，网站不用改。

| | 用户脚本 | 扩展 |
| --- | --- | --- |
| 安装 | 先装 Tampermonkey，再装脚本 | 商店里点"添加" |
| 运行范围 | 所有网页（有 `kidstube-app` 标记才启用） | **只在朵米片单的网址上** |
| 自建站点 | ✅ 任何地址 | ❌ 只认官方网址（自建请继续用用户脚本） |
| iPhone / iPad | ✅（Userscripts App） | 暂不支持（Safari 扩展需要 App Store） |

## 打包

```bash
node extension/build.mjs
```

输出 `extension/dist/chrome`（Chrome / Edge）、`extension/dist/firefox`，以及上架用的 `.zip`。版本号在 `version.json`。图标由 `node extension/make-icons.mjs` 生成。

## 本地试用

- Chrome / Edge：打开 `chrome://extensions`，打开"开发者模式"，"加载已解压的扩展程序"，选 `extension/dist/chrome`。
- Firefox：打开 `about:debugging#/runtime/this-firefox`，"临时载入附加组件"，选 `extension/dist/firefox/manifest.json`。Firefox 默认不授予网站访问权限：在 `about:addons` → 朵米助手 → 权限 里打开视频网站的访问权限。

同时装着用户脚本和扩展也能用，但建议只留一个（在 Tampermonkey 里停用"朵米助手"脚本）。

## 实现要点

- `content.js`：只注入在朵米片单网址上，负责首次授权确认和消息转发。
- `background.js`：真正发请求（带上你在视频网站的登录状态）。`Referer` / `Origin` / `User-Agent` 这类 `fetch` 不能设置的请求头，用只匹配这一个请求的临时 `declarativeNetRequest` 会话规则改写，请求结束即删除。
- 二进制数据（网盘视频分片）在后台转成 base64 传给页面脚本，再以 `ArrayBuffer` 交给网页。
- `youku.js`：优酷播放器框架里的"存储访问"授权按钮，让会员登录在嵌入播放器里生效。

## 上架

见 [STORE.md](STORE.md)。
