# KidsTube

A kids' video site where parents choose exactly which videos their children can watch.

- **Pure static website, no server.** Link resolving runs in the browser.
- **Data stays local.** Video lists and settings are stored only in the browser (localStorage) and are never uploaded.
- **Chinese / English.** Switch from the top bar or in Settings.

## Running and deploying

KidsTube is just the static files in the `public/` folder:

- **Local preview:** `npm start` (Node 18+, no dependencies), then open <http://localhost:5173>. Devices on the same Wi-Fi can use the LAN address it prints.
- **Deployment:** upload `public/` to any static host, such as GitHub Pages, Cloudflare Pages, Vercel, or Nginx. Subdirectory deployment is supported. HTTPS is recommended.

## KidsTube Helper (userscript)

Browser cross-origin restrictions (CORS) stop a web page from reading data from sites such as Bilibili. The **KidsTube Helper** ([`public/kidstube-helper.user.js`](public/kidstube-helper.user.js)) is a userscript. With it installed, cross-origin requests go out through your userscript manager and use your own sign-ins in that browser. You don't need to copy cookies, and no server is involved.

| Device | Browser | Userscript manager |
| --- | --- | --- |
| Computer | Chrome / Edge / Firefox / Safari | Tampermonkey |
| Android | Firefox or Edge (Chrome for Android doesn't support extensions) | Tampermonkey |
| iPhone / iPad | Safari | Userscripts app (free, open source) |

Installation steps are in KidsTube under 🔒 → Accounts.

Security design:
- The helper only runs on pages that contain `<meta name="kidstube-app">`.
- It only contacts the video sites listed under `@connect`.
- Each KidsTube address must be allowed by the user in a confirmation dialog the first time.

## What works with and without the helper

| Feature | Without helper | With helper |
| --- | --- | --- |
| Single YouTube video | ✅ title and thumbnail read automatically | ✅ |
| Single Bilibili video | ✅ title, thumbnail and duration read automatically (via Bilibili's JSONP endpoint) | ✅ |
| Single video from Tencent Video / Youku / Xigua / TikTok / Dailymotion | ✅ plays; parent enters the title | ✅ title, thumbnail, and duration read automatically |
| Vimeo, direct mp4 / m3u8 links | ✅ | ✅ |
| YouTube channel / playlist import | ✅ requires a YouTube Data API key | ✅ no key needed |
| Bilibili creator import | ❌ | ✅ |
| Short links (b23.tv…) | ❌ open the link and paste the full address | ✅ expanded automatically |
| Paid Bilibili series (番剧), iQIYI, Mango TV | Opens a window from the original site | Same |

Playback never needs the helper. Embedded YouTube and Bilibili players are loaded by the browser directly.

With the helper installed, Bilibili videos play in KidsTube's own player by default. The helper fetches Bilibili's html5 mp4 address and the browser streams it directly. This works in Firefox for Android, where Bilibili's embedded player can't load video. It also shows no Bilibili recommendations and plays the next episode automatically. Members-only or paid videos fall back to the embedded player. The setting is under Settings.

## Other features

- **Kids mode:** shows only videos in the library, with group chips and search. The parent area is protected by a 4-digit PIN.
- **Collections:** a Bilibili video that belongs to a collection (合集) or has multiple parts (分P) offers "Add whole collection" — no helper needed. Bilibili collection links (`space.bilibili.com/<mid>/lists/<sid>`) and YouTube playlists (`list=`) are supported too. On the kids' home page a collection shows as one card that opens its episode list.
- **Next episode:** the player always has a "Next episode" button for collections. YouTube and direct video links count down 5 seconds and play the next episode (can be cancelled; can be turned off in Settings). The Bilibili player doesn't report when a video ends, so a "Next episode" prompt appears near the estimated end instead.
- **Creator folders:** inside each category, videos are automatically grouped into second-level folders by creator (on both the kids' home page and the parent library).
- **More from this creator:** any video in the library (or a lookup result) can open its creator's page so you can pick more videos to add.
- **Paste share text:** when the pasted text has extra words around the link (e.g. Bilibili "share" text), the link is extracted automatically and the title is pre-filled.
- **Stay-in-app lock:** invisible covers over player logos and titles; YouTube recommendations are covered when a video is paused or ends; optional strict sandbox.
- **Daily watch-time limit:** a parent can add 15 more minutes with the PIN.
- **Memberships / ad-free viewing:** sign in to each site in the same browser. YouTube Premium needs "Use my signed-in account" turned on.
  - Embedded players need third-party cookies allowed. On iPhone this means turning off "Prevent cross-site tracking" in Safari.
- **Sign-in status:** with the helper installed, 🔒 → Accounts shows whether this browser is signed in to Bilibili, YouTube, Tencent Video, Youku and iQIYI (with the nickname where the site provides one). It re-checks when you come back from the sign-in page.
- **Xiaohongshu and Douyin:** no longer supported. Xiaohongshu's website doesn't play content, and Douyin isn't a good fit for kids. Their links show an error, and any of their videos already in the library are hidden from kids mode; a parent can delete them in the library.
- **Phones:** responsive layout, add to home screen, and in-page fullscreen fallback on iPhone.
- **Backup / transfer:** export and import the list as JSON. Since data is stored per browser, this is how you move a list to a child's tablet.

## Files

```
public/index.html               Entry page
public/app.js                   Kids mode, player, parent area
public/resolver.js              In-browser link resolver (also runs in Node for testing)
public/bridge.js                postMessage bridge between the page and the helper
public/kidstube-helper.user.js  KidsTube Helper userscript
public/i18n.js                  Chinese / English strings
public/style.css                Styles
server.js                       Optional local preview server (static files only)
```
