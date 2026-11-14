# Chrome 应用商店提交清单（照着复制粘贴）

> Chrome 不允许任何扩展操作商店页面，所以这一步需要你手动完成，约 15 分钟。

## 0. 文件位置

| 用途 | 文件 |
| --- | --- |
| 安装包 | `extension/dist/domibuddy-helper-chrome-1.8.0.zip`（没有就先运行 `node extension/build.mjs`） |
| 商店图标 128×128 | `extension/icons/icon128.png` |
| 截图 1280×800 | `extension/store-assets/screenshot-zh-1280x800.png`、`screenshot-en-1280x800.png`、`screenshot-app-welcome-1280x800.png` |
| 小宣传图 440×280 | `extension/store-assets/promo-tile-440x280.png` |

## 1. 账号设置（只做一次）

开发者控制台左侧 **Account**：

- Publisher name：`DomiBuddy`
- Contact email：`appdeveloper@mentrait.com`（点邮件里的链接验证）
- Trader / non-trader：目前选 **non-trader**（开始收费后改成 trader）

## 2. 上传

**Items → New item**，上传安装包 zip。

## 3. Store listing（商品详情）

**Description**：

```
朵米片单（lists.domibuddy.com）是家长精选的儿童视频片单：孩子只能看家长挑过的视频，没有推荐、没有广告跳转。

不装助手也能添加 YouTube、B 站单个视频和 YouTube 播放列表。装上朵米助手后还能：
• 一次导入整个 B 站 UP 主或合集
• 导入百度网盘文件夹里的视频
• 自动补全腾讯视频、优酷的标题和封面
• 展开 b23.tv 等短链接

隐私：
• 只在朵米片单的网址上工作，其他网页上什么都不做；每个网址第一次使用时需要你确认。
• 使用你自己浏览器里的登录状态访问视频网站，扩展读取不到你的 Cookie。
• 不收集、不上传任何数据，没有统计和广告。

Domi Lists is a kids' video list picked by parents. With DomiBuddy Helper you can import a whole Bilibili channel or collection, import videos from a Baidu Netdisk folder, fill in titles and thumbnails from Tencent Video and Youku, and expand short links like b23.tv. It runs only on DomiBuddy sites and collects no data.
```

| 字段 | 填写 |
| --- | --- |
| Category | Tools（如有 Family 也可选） |
| Language | 中文（简体） |
| Store icon | `icon128.png` |
| Screenshots | 上面 3 张截图 |
| Small promo tile | `promo-tile-440x280.png` |
| Official URL / Homepage | `https://lists.domibuddy.com` |
| Support URL | `https://github.com/dickenson258/kidstube/issues` |

## 4. Privacy（隐私权）

**Single purpose description**：

```
Helps the Domi Lists website (lists.domibuddy.com) read video titles, thumbnails and collection lists from video sites such as Bilibili and YouTube, using the parent's own browser sign-ins, so parents can build kids' video lists. It runs only on DomiBuddy's own sites.
```

**Permission justification**（逐项粘贴）：

- `storage`：
  ```
  Stores the list of DomiBuddy site addresses the user has allowed, so the confirmation prompt is shown only once per site.
  ```
- `declarativeNetRequestWithHostAccess`：
  ```
  Some video site APIs (for example Bilibili) reject requests without the correct Referer/Origin. Right before the extension sends its own request, it adds a temporary session rule that matches only that exact URL (tabId -1, i.e. the extension's own request) to set Referer/Origin/User-Agent, and removes the rule as soon as the request finishes. It never modifies the user's normal browsing.
  ```
- Host permissions：
  ```
  Used only to fetch video titles, thumbnails, collection lists and stream addresses from these video sites (bilibili.com, youtube.com, qq.com, youku.com, iqiyi.com, mgtv.com, vimeo.com, dailymotion.com, baidu.com and related domains) on behalf of the DomiBuddy page, with the user's own sign-ins. Results are returned only to the DomiBuddy page that asked; nothing is stored or sent elsewhere.
  ```
- Content scripts（如有单独一项）：
  ```
  A content script runs only on DomiBuddy's own addresses (lists.domibuddy.com and related) to relay requests between the page and the extension. A second one runs inside the embedded Youku player frame only to show a button that asks the browser for storage access, so the parent's Youku sign-in works in the embedded player.
  ```

**Are you using remote code?** → **No, I am not using remote code**

**Data usage**：所有数据类型都**不勾选**（不收集任何用户数据），然后勾选下面三条声明：

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**：`https://lists.domibuddy.com/privacy`

## 5. Distribution（分发）

- Payments：Free
- Visibility：Public
- Regions：All regions

## 6. 提交

点 **Submit for review**。可以选择"审核通过后自动发布"。审核一般几天到一两周。

审核通过后，把商店链接发给我，我会在网站的新手引导里加上"一键安装"。
