# 上架资料（Chrome 应用商店 / Edge 加载项 / Firefox 附加组件）

上架要用开发者本人的账号，需要你自己注册并提交：

| 商店 | 开发者账号 | 费用 | 上传文件 |
| --- | --- | --- | --- |
| Chrome 应用商店 | chrome.google.com/webstore/devconsole | 一次性 US$5 | `dist/domibuddy-helper-chrome-<版本>.zip` |
| Microsoft Edge 加载项 | partner.microsoft.com（Edge 计划） | 免费 | 同上（chrome 包） |
| Firefox 附加组件 | addons.mozilla.org/developers | 免费 | `dist/domibuddy-helper-firefox-<版本>.zip`；会要求提供源码：上传本仓库的 `extension/` 目录打包即可（没有构建压缩，源码就是发布内容） |

## 名称

- 中文：朵米助手 · DomiBuddy Helper
- English: DomiBuddy Helper · 朵米助手

## 简短描述（≤132 字符）

- 中文：让朵米片单读取 B 站、YouTube 等网站的视频标题、封面和合集。只在朵米片单网站上工作。
- English: Lets DomiBuddy Lists read titles, thumbnails and collections from Bilibili, YouTube and more. Works only on DomiBuddy sites.

## 详细描述

**中文**

朵米片单（lists.domibuddy.com）是家长精选的儿童视频片单：孩子只能看家长挑过的视频，没有推荐、没有广告跳转。

不装助手也能添加 YouTube、B 站单个视频和 YouTube 播放列表。装上朵米助手后还能：
- 一次导入整个 B 站 UP 主或合集
- 导入百度网盘文件夹里的视频
- 自动补全腾讯视频、优酷、西瓜视频等网站的标题和封面
- 展开 b23.tv 等短链接

隐私：
- 只在朵米片单的网址上工作，其他网页上什么都不做；每个网址第一次使用时需要你确认。
- 使用你自己浏览器里的登录状态访问视频网站，扩展读取不到你的 Cookie。
- 不收集、不上传任何数据，没有统计和广告。

**English**

DomiBuddy Lists (lists.domibuddy.com) is a kids' video list picked by parents: children only see videos a parent chose, with no recommendations or ads pulling them away.

Single YouTube and Bilibili videos and YouTube playlists work without the helper. With DomiBuddy Helper you can also:
- import a whole Bilibili channel or collection
- import videos from a Baidu Netdisk folder
- fill in titles and thumbnails from Tencent Video, Youku, Xigua and more
- expand short links like b23.tv

Privacy:
- Runs only on DomiBuddy sites and does nothing elsewhere; each site must be allowed by you once.
- Uses your own browser sign-ins on video sites; the extension cannot read your cookies.
- Collects and uploads nothing. No analytics, no ads.

## 类别

- Chrome：生产力工具（Productivity）或 家庭（Family）
- Firefox：Other / 其他

## 隐私政策网址

https://lists.domibuddy.com/privacy.html

## 权限说明（Chrome 审核表单里逐项填写）

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存你已经允许过的朵米片单网址列表。 |
| `declarativeNetRequestWithHostAccess` | 部分视频网站的接口要求请求带正确的 Referer / Origin（例如 B 站），扩展在发出请求的那一刻添加只匹配这一个请求的临时规则，请求结束即删除。 |
| 主机权限（bilibili.com、youtube.com、qq.com、youku.com、baidu.com 等） | 替朵米片单页面向这些视频网站请求视频标题、封面、合集列表和播放地址，带上你在这些网站上的登录状态。只请求这些网站。 |
| 内容脚本（lists.domibuddy.com 等） | 只在朵米片单网页上运行，在网页和扩展之间转发请求。 |
| 内容脚本（player.youku.com，框架内） | 在嵌入的优酷播放器里显示"使用优酷会员登录"按钮（浏览器的存储访问授权）。 |

**单一用途说明**：帮助朵米片单网站读取视频网站的公开视频信息和家长自己账号下的视频，用于家长整理儿童视频片单。

**数据使用声明**：不收集任何用户数据；不出售、不转让；不用于与单一用途无关的目的；不用于信用评估。

## 截图（1280×800）

建议 3 张：添加视频页（导入 B 站 UP 主）、分享片单对话框、孩子首页。可以在 lists.domibuddy.com 上用自己的片单截图。
