// dsh-usage-panel browser bundle
// 右下角悬浮卡片(旧版收起样式:头部条),点击直接展开完整仪表盘
// (iframe 加载同源 /dsh-usage-panel/dashboard 的 dashboard.html)。
// 头部右侧小字为实时摘要(余额/花费/命中率),每 30s 刷新,不参与交互。
window.__ModuleLoader__.load({
  id: 'dsh-usage-panel',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    // ===== 配置:同源路由(宿主进程内取数,无需独立服务)=====
    var DATA_URL = '/dsh-usage-panel/data';          // 摘要小字(紧凑记录)
    var REFRESH_URL = '/dsh-usage-panel/refresh';    // 强制刷新(点击展开时先更新数据)
    var DASH_URL = '/dsh-usage-panel/dashboard';     // 完整仪表盘
    var REFRESH_MS = 30000; // 30 秒刷新摘要小字

    var STYLE = `
.dshup-card{position:fixed;right:14px;bottom:14px;z-index:99998;background:var(--dsw-alias-bg-base,#1C1C1E);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));border-radius:14px;color:var(--dsw-alias-label-primary,#fff);box-shadow:var(--dsw-shadow-lv1,0 2px 8px rgba(0,0,0,.18));overflow:hidden;cursor:pointer;user-select:none;touch-action:none;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
.dshup-head{display:flex;align-items:center;gap:8px;padding:11px 14px}
.dshup-head b{font-size:13px;letter-spacing:.02em;white-space:nowrap}
.dshup-head .dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#30D158);flex:none}
.dshup-head .sum{margin-left:auto;color:var(--dsw-alias-label-tertiary,#8e8e93);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
.dshup-head .chev{color:var(--dsw-alias-label-tertiary,#8e8e93);font-size:11px;flex:none}
.dshup-card:hover{border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.28))}
.dshup-card:active{transform:scale(.97)}
.dshup-ov{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;padding:12px}
.dshup-ov.open{display:flex}
.dshup-box{position:relative;width:100%;max-width:520px;height:88vh;background:var(--dsw-alias-bg-base,#000);border-radius:18px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.6)}
.dshup-bar{position:absolute;top:0;left:0;right:0;height:36px;background:var(--dsw-alias-fill-l1,var(--dsw-alias-bg-base,#1C1C1E));display:flex;align-items:center;justify-content:space-between;padding:0 12px;z-index:2;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.dshup-bar b{font-size:12px;color:var(--dsw-alias-label-primary,#fff);font-weight:600}
.dshup-close{border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8e8e93);font-size:18px;cursor:pointer;padding:0 4px}
.dshup-frame{position:absolute;top:36px;left:0;right:0;bottom:0;width:100%;height:calc(100% - 36px);border:none;background:var(--dsw-alias-bg-base,#000)}
`;

    function el(tag, cls, txt) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (txt !== undefined) e.textContent = txt;
      return e;
    }

    function apply(ctx) {
      if (typeof document === 'undefined') return;

      // 样式
      var st = el('style');
      st.textContent = STYLE;
      document.head.appendChild(st);

      // 卡片(可拖动;点击展开仪表盘)
      var card = el('div', 'dshup-card');
      var head = el('div', 'dshup-head');
      var title = el('b', null, 'OpenCode 用量');
      head.appendChild(el('span', 'dot'));
      head.appendChild(title);
      var sum = el('span', 'sum', '…');
      head.appendChild(sum);
      head.appendChild(el('span', 'chev', '▶'));
      card.appendChild(head);
      document.body.appendChild(card);

      // 记住上次拖动位置(刷新后不回到右下角;超出当前窗口则收回到窗口内)
      var savedPos = null;
      try { savedPos = JSON.parse(localStorage.getItem('dshup-pos') || 'null'); } catch (e) { savedPos = null; }
      if (savedPos && typeof savedPos.left === 'number' && typeof savedPos.top === 'number') {
        var sLeft = clampPos(savedPos.left, 0, Math.max(0, window.innerWidth - card.offsetWidth));
        var sTop = clampPos(savedPos.top, 0, Math.max(0, window.innerHeight - card.offsetHeight));
        card.style.left = sLeft + 'px';
        card.style.top = sTop + 'px';
        card.style.right = 'auto';
        card.style.bottom = 'auto';
      }

      // 完整仪表盘 overlay + iframe(懒加载:首次打开时才设置 src)
      var ov = el('div', 'dshup-ov');
      var box = el('div', 'dshup-box');
      var bar = el('div', 'dshup-bar');
      bar.appendChild(el('b', null, 'OpenCode 用量仪表盘'));
      var close = el('button', 'dshup-close');
      close.textContent = '✕';
      bar.appendChild(close);
      var frame = el('iframe', 'dshup-frame');
      frame.setAttribute('scrolling', 'yes');
      box.appendChild(bar);
      box.appendChild(frame);
      ov.appendChild(box);
      document.body.appendChild(ov);

      // 读取 DSH web 主题变量,传给 iframe 仪表盘使其背景一致
      // 注意:--dsw-alias-* 定义在 <body> 上而非 :root,必须从 body 的计算样式读取
      // 并判断当前主题亮暗,让仪表盘跟随 DSH web 的亮/暗模式
      function readTheme() {
        var cs = window.getComputedStyle(document.body || document.documentElement);
        function v(name) { return cs.getPropertyValue(name).trim(); }
        var bg = v('--dsw-alias-bg-base');
        var dark = false;
        if (bg) {
          // 解析 rgb(...) 计算亮度,判断亮暗
          var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(bg);
          if (m) {
            var lum = (parseInt(m[1], 10) * 299 + parseInt(m[2], 10) * 587 + parseInt(m[3], 10) * 114) / 1000;
            dark = lum < 128;
          } else if (/^#/.test(bg)) {
            var hex = bg.slice(1);
            if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
            var r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
            dark = (r * 299 + g * 587 + b * 114) / 1000 < 128;
          }
        }
        return {
          theme: dark ? 'dark' : 'light',
          bg: bg,
          card: v('--dsw-alias-fill-l1') || v('--dsw-alias-bg-layer-1') || bg,
          t1: v('--dsw-alias-label-primary'),
          t2: v('--dsw-alias-label-secondary'),
          t3: v('--dsw-alias-label-tertiary'),
          bord: v('--dsw-alias-border-l1'),
          acc: v('--dsw-alias-accent-primary') || v('--dsw-alias-brand-primary') || v('--dsw-alias-state-info-primary')
        };
      }
      // iframe 加载后请求主题(iframe 每次重载都会重新请求)
      function onHostMessage(e) {
        if (e.data === 'dshup-theme-request') {
          postToFrame({ dshupTheme: readTheme() });
        }
      }
      window.addEventListener('message', onHostMessage);
      // 主题变化即时推送:优先 MutationObserver 监听 body 属性(class/style/data-*),
      // 轮询 2s 作为兜底——保证展开瞬间与打开期间 DSH 切主题都立即同步,不出现"先旧后新"的切换过程
      var lastThemeMode = null;
      function pushThemeIfChanged() {
        var t = readTheme();
        if (t.theme !== lastThemeMode) {
          lastThemeMode = t.theme;
          postToFrame({ dshupTheme: t });
        }
      }
      var themeObserver = null;
      if (typeof MutationObserver !== 'undefined') {
        themeObserver = new MutationObserver(pushThemeIfChanged);
        try {
          themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-dsw-theme'] });
        } catch (err) { /* 忽略 */ }
      }
      var themeTimer = setInterval(pushThemeIfChanged, 2000);
      // 展开瞬间主动推送一次当前主题(iframe 已加载时立即生效,不再等轮询)
      function pushThemeNow() {
        var t = readTheme();
        lastThemeMode = t.theme;
        postToFrame({ dshupTheme: t });
      }

      // 点击卡片 → 立即展开完整仪表盘,同时后台强制刷新数据;
      // 刷新完成后通过 postMessage 通知 iframe 里的仪表盘重新拉取最新数据。
      // 按住拖动 → 移动卡片。
      // iframe 只加载一次(首帧即带主题参数,避免切换主题时闪烁);
      // 每次打开通过消息把仪表盘重置回默认视图(近2小时)。
      // iframe 首次加载完成前 postMessage 会丢失,挂一个就绪标记兜底
      var frameReady = false;
      frame.addEventListener('load', function () { frameReady = true; });
      function postToFrame(msg) {
        try {
          if (frameReady) frame.contentWindow.postMessage(msg, window.location.origin);
        } catch (err) { /* 忽略 */ }
      }
      function openDash() {
        if (!frame.getAttribute('data-loaded')) {
          frame.setAttribute('data-loaded', '1');
          var t0 = readTheme();
          frame.setAttribute('src', DASH_URL + '?theme=' + t0.theme + '&v=2'); // v 递增以强制升级后 iframe 重新拉取(绕过只加载一次的缓存)
        }
        ov.className = 'dshup-ov open';
        try {
          // 展开瞬间同步当前主题(避免看到旧主题→新主题的切换过程)
          pushThemeNow();
          postToFrame('dshup-reset');
        } catch (err) { /* 忽略 */ }
      }
      function onClickCard() {
        openDash(); // 立即展开,不等待刷新
        try {
          fetch(REFRESH_URL).then(function (r) { return r.json(); }).catch(function () { return null; })
            .then(function () {
              // 数据已更新:通知仪表盘重新拉取 + 同步更新卡片摘要小字
              postToFrame('dshup-refresh');
              refresh();
            });
        } catch (e) { /* 刷新失败不影响展开 */ }
      }
      // 点击卡片 → 直接打开完整仪表盘;按住拖动 → 移动卡片(位置记住)
      var drag = null;
      card.addEventListener('pointerdown', function (e) {
        drag = { x: e.clientX, y: e.clientY, moved: false };
        try { card.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      });
      card.addEventListener('pointermove', function (e) {
        if (!drag) return;
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
          drag.moved = true;
          // 禁用 :active 缩放,避免干扰定位;从 right/bottom 切换为 left/top
          card.style.transform = 'none';
          var rc = card.getBoundingClientRect();
          card.style.left = rc.left + 'px';
          card.style.top = rc.top + 'px';
          card.style.right = 'auto';
          card.style.bottom = 'auto';
        }
        if (drag.moved) {
          // 限位:卡片整体必须留在 dsh web 窗口可视区内
          var cw = rcWidth(), ch = card.offsetHeight || 40;
          var nx = clampPos(parseFloat(card.style.left) + dx, 0, Math.max(0, window.innerWidth - cw));
          var ny = clampPos(parseFloat(card.style.top) + dy, 0, Math.max(0, window.innerHeight - ch));
          card.style.left = nx + 'px';
          card.style.top = ny + 'px';
          drag.x = e.clientX;
          drag.y = e.clientY;
        }
      });
      function rcWidth() { return card.offsetWidth || 248; }
      function clampPos(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
      function onUp() {
        if (drag && drag.moved) {
          // 拖动结束:记住位置
          try {
            localStorage.setItem('dshup-pos', JSON.stringify({
              left: parseFloat(card.style.left), top: parseFloat(card.style.top)
            }));
          } catch (err) { /* 忽略 */ }
        } else if (drag) {
          onClickCard();
        }
        drag = null;
      }
      card.addEventListener('pointerup', onUp);
      card.addEventListener('pointercancel', function () { drag = null; });
      close.addEventListener('click', function () { ov.className = 'dshup-ov'; });
      ov.addEventListener('click', function (e) { if (e.target === ov) ov.className = 'dshup-ov'; });

      // 摘要小字(聚合紧凑记录,不参与交互)
      function refresh() {
        try {
          fetch(DATA_URL).then(function (r) { return r.json(); }).then(function (d) {
            if (!d) { sum.textContent = '未连接'; return; }
            if (d.error === 'credentials-missing') { sum.textContent = '未配置凭据'; return; }
            if (d.error || !d.records) { sum.textContent = '未连接'; return; }
            var cost = 0, inp = 0, cache = 0;
            for (var x = 0; x < d.records.length; x++) {
              var r = d.records[x];
              cost += r[2]; inp += r[3]; cache += r[6];
            }
            var hit = inp + cache > 0 ? cache / (inp + cache) * 100 : 0;
            sum.textContent = '$' + cost.toFixed(2) + ' · ' + hit.toFixed(0) + '%';
          }).catch(function () { sum.textContent = '未连接'; });
        } catch (e) {
          sum.textContent = '未连接';
        }
      }

      refresh();
      var timer = setInterval(refresh, REFRESH_MS);

      // ctx 清理(插件卸载时)
      if (ctx && ctx.on) {
        ctx.on('dispose', function () {
          clearInterval(timer); clearInterval(themeTimer);
          window.removeEventListener('message', onHostMessage);
          if (themeObserver) { try { themeObserver.disconnect(); } catch (err) { /* 忽略 */ } }
          card.remove(); ov.remove(); st.remove();
        });
      }
    }

    exports.apply = apply;
    return module.exports;
  }
});
