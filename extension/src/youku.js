// 优酷播放器嵌在朵米片单里时，浏览器会把优酷的登录 Cookie 当成第三方 Cookie 拦下，会员只能试看。
// 这里在优酷播放器框架里请求"存储访问"授权（需要家长点一下），授权后播放器就能用上你的优酷登录状态。
(() => {
  if (window.top === window) return;
  if (typeof document.hasStorageAccess !== 'function' || typeof document.requestStorageAccess !== 'function') return;
  document.hasStorageAccess().then((has) => {
    if (has) return;
    const zh = /^zh/i.test(navigator.language);
    const bar = document.createElement('button');
    bar.textContent = zh ? '🔑 家长点这里：让播放器使用优酷会员登录' : '🔑 Parents: tap to use your Youku sign-in here';
    bar.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:2147483647;padding:8px 14px;border:0;border-radius:999px;background:#1f8cff;color:#fff;font:600 13px/1.3 -apple-system,system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.35);cursor:pointer;max-width:92%';
    bar.onclick = (e) => {
      e.stopPropagation();
      document.requestStorageAccess().then(
        () => location.reload(),
        () => { bar.textContent = zh ? '浏览器没有允许。请先在本浏览器直接打开 youku.com 登录一次，再回来点这里' : "The browser didn't allow it. Open youku.com in this browser and sign in once, then tap here again"; },
      );
    };
    (document.body || document.documentElement).appendChild(bar);
  }).catch(() => {});
})();
