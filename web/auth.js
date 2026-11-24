/* Fanwhale · 账号门禁 + 大厅世界频道 */
/* ===== 全屏粘性：换地图 / 联机重载后自动恢复全屏 =====
   浏览器在页面导航时会强制退出全屏，且 requestFullscreen 只能由用户手势触发。
   策略：记住"用户想全屏"，重载后第一次手指/鼠标按下就重新请求。 */
(function () {
  var KEY = 'saltline.wantFull';
  var TTL = 300000;            /* 5 分钟内有效，避免用户主动退出后反复被拉全屏 */
  var nav = false;
  try { addEventListener('beforeunload', function () { nav = true; }); } catch (e) {}
  try {
    document.addEventListener('fullscreenchange', function () {
      try {
        if (document.fullscreenElement) localStorage.setItem(KEY, String(Date.now()));
        else if (!nav) localStorage.removeItem(KEY);
      } catch (e) {}
    });
    document.addEventListener('webkitfullscreenchange', function () {
      try {
        if (document.webkitFullscreenElement) localStorage.setItem(KEY, String(Date.now()));
        else if (!nav) localStorage.removeItem(KEY);
      } catch (e) {}
    });
  } catch (e) {}

  var t0 = 0;
  try { t0 = +localStorage.getItem(KEY) || 0; } catch (e) {}
  if (!t0 || Date.now() - t0 > TTL) return;

  function go() {
    var pa = (window.parent && window.parent !== window && window.parent.document) ? window.parent.document : null;
    var D = pa || document;
    if (D.fullscreenElement || D.webkitFullscreenElement) return;
    var el = pa ? D.documentElement : (document.getElementById('app') || document.documentElement);
    var fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) return;
    try {
      var p = fn.call(el);
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  function once() {
    document.removeEventListener('pointerdown', once, true);
    document.removeEventListener('touchend', once, true);
    go();
  }
  document.addEventListener('pointerdown', once, true);
  document.addEventListener('touchend', once, true);
  window.__wantFull = go;

  /* 明确提示层：自动恢复被浏览器拦下时，给一个"点此全屏"的按钮 */
  function hint() {
    if (document.getElementById('fullhint')) return;
    var __pa2 = (window.parent && window.parent !== window) ? window.parent.document : document;
    if (__pa2.fullscreenElement || __pa2.webkitFullscreenElement) return;
    var d = document.createElement('div');
    d.id = 'fullhint';
    d.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:500;' +
      'display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:4px;' +
      'background:rgba(14,18,23,.97);border:1px solid rgba(255,181,71,.55);border-left:3px solid #ffb547;' +
      'box-shadow:0 14px 40px rgba(0,0,0,.55);font:500 13px/1.4 system-ui,-apple-system,"PingFang SC",sans-serif;' +
      'color:#e8e6e1;max-width:calc(100vw - 32px)';
    d.innerHTML = '<span>刚才是全屏，浏览器跳转后自动退出了</span>' +
      '<button type="button" id="fullhint-go" style="flex:0 0 auto;padding:8px 15px;border:0;border-radius:3px;' +
      'background:#ffb547;color:#14181b;font:700 12px/1 inherit;letter-spacing:.08em;cursor:pointer">恢复全屏</button>' +
      '<button type="button" id="fullhint-x" style="flex:0 0 auto;width:26px;height:26px;border:1px solid rgba(255,255,255,.14);' +
      'border-radius:3px;background:transparent;color:rgba(232,230,225,.55);font:400 15px/1 inherit;cursor:pointer">&times;</button>';
    document.body.appendChild(d);

    d.querySelector('#fullhint-go').addEventListener('click', function () {
      go();
      setTimeout(function () { try { d.remove(); } catch (e) {} }, 260);
    });
    d.querySelector('#fullhint-x').addEventListener('click', function () {
      try { d.remove(); } catch (e) {}
    });
    setTimeout(function () {
      if (document.fullscreenElement) { try { d.remove(); } catch (e) {} }
    }, 1200);
  }

  /* 先自己试一次（部分环境允许），失败就上提示 */
  try { go(); } catch (e) {}
  setTimeout(function () {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) hint();
  }, 1400);
})();

(function () {
  'use strict';
  if (window.__auth) return;

  var API = '/api', KEY = 'saltline.token.v1';
  var S = { tok: '', me: '', online: 0, seq: 0, timer: 0, mode: 'login', busy: false };

  /* ---------------- 样式 ---------------- */
  var CSS = [
    'body:not(.authed) .menu{opacity:0!important;pointer-events:none!important}',
    '#gate,#lobby{position:absolute;inset:0;z-index:60;display:none;font-family:var(--f-label);color:var(--bone)}',
    '#gate.on,#lobby.on{display:flex}',
    '#lobby{z-index:76}',
    '#gate{align-items:center;justify-content:center;padding:24px;',
    'background:radial-gradient(120% 120% at 12% 0%,rgba(22,32,42,.93) 0%,rgba(11,13,15,.975) 62%)}',
    '.g-wrap{width:min(960px,100%);display:grid;grid-template-columns:1.1fr .9fr;gap:36px;align-items:center}',
    '.g-eyebrow{display:flex;gap:11px;align-items:center;font:500 11px/1 var(--f-mono);letter-spacing:.2em;text-transform:uppercase;color:var(--steel);margin-bottom:15px}',
    '.g-tag{background:var(--signal);color:#14181b;padding:4px 6px;font-weight:700;letter-spacing:.12em}',
    '.g-mark{font-family:var(--f-display);font-weight:900;font-size:clamp(40px,7.4vw,78px);letter-spacing:.14em;line-height:.94;margin:0;color:var(--bone)}',
    '.g-sub{margin:16px 0 0;font-size:14px;line-height:1.75;color:var(--bone-dim);max-width:32em}',
    '.g-rule{height:1px;background:linear-gradient(90deg,var(--signal),rgba(255,179,71,0));margin:20px 0 16px;opacity:.7}',
    '.g-meta{display:flex;gap:20px;font:400 11px/1.5 var(--f-mono);letter-spacing:.12em;color:var(--steel);text-transform:uppercase;flex-wrap:wrap}',
    '.g-meta b{color:var(--bone);font-weight:600}',
    '.g-card{background:rgba(11,13,15,.72);border:1px solid var(--line);border-left:2px solid var(--signal);padding:22px 20px 18px;box-shadow:var(--shadow);backdrop-filter:blur(3px)}',
    '.g-card h2{margin:0 0 3px;font:700 19px/1 var(--f-label);letter-spacing:.08em;text-transform:uppercase}',
    '.g-hint{margin:0 0 16px;font:400 11px/1.55 var(--f-mono);letter-spacing:.08em;color:var(--steel)}',
    '.g-field{display:block;margin:0 0 13px}',
    '.g-field span{display:block;font:500 11px/1 var(--f-label);letter-spacing:.18em;text-transform:uppercase;color:var(--steel);margin-bottom:7px}',
    '.g-field input{width:100%;background:rgba(232,228,218,.045);border:1px solid var(--line);border-bottom:1px solid rgba(232,228,218,.4);',
    'color:var(--bone);font:400 15px/1 var(--f-mono);padding:11px 10px;outline:none;border-radius:2px;letter-spacing:.02em}',
    '.g-field input:focus{border-color:var(--signal);background:rgba(255,179,71,.07)}',
    '.g-actions{display:flex;gap:9px;margin-top:15px}',
    '.g-actions .btn{flex:1;justify-content:center}',
    '.g-err{min-height:17px;margin:11px 0 0;font:500 12px/1.45 var(--f-label);letter-spacing:.05em;color:var(--alarm)}',
    '.g-err.on{animation:blink .8s steps(2,jump-none) infinite}',
    '.g-alt{margin:11px 0 0;font:400 11px/1.5 var(--f-mono);color:var(--steel);letter-spacing:.06em}',
    '.g-alt a{color:var(--signal);cursor:pointer;text-decoration:none;border-bottom:1px solid rgba(255,179,71,.4)}',
    /* lobby */
    '#lobby{flex-direction:column;background:linear-gradient(180deg,rgba(11,13,15,.955),rgba(11,13,15,.99))}',
    '.l-top{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;',
    'padding:13px max(16px,var(--gl)) 11px;border-bottom:1px solid var(--line)}',
    '.l-brand{display:flex;align-items:center;gap:10px}',
    '.l-brand b{font-family:var(--f-display);font-weight:900;font-size:21px;letter-spacing:.16em;line-height:1}',
    '.l-tag{background:var(--signal);color:#14181b;font:700 10px/1 var(--f-mono);padding:4px 5px;letter-spacing:.1em}',
    '.l-k{font:600 10px/1 var(--f-label);letter-spacing:.24em;text-transform:uppercase;color:var(--steel)}',
    '.l-who{display:flex;align-items:center;gap:16px;font:400 11px/1 var(--f-mono);letter-spacing:.1em;color:var(--steel);text-transform:uppercase}',
    '.l-who b{color:var(--bone);font-weight:600;letter-spacing:.04em;text-transform:none}',
    '.l-dot{width:6px;height:6px;border-radius:50%;background:var(--signal);box-shadow:0 0 7px var(--signal);display:inline-block;margin-right:7px;vertical-align:middle}',
    '.l-main{flex:1;display:grid;grid-template-columns:1fr 322px;min-height:0}',
    '.l-chat{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--line)}',
    '.l-chat-h{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 16px;border-bottom:1px solid var(--line)}',
    '.l-chat-h>span:first-child{font:600 11px/1 var(--f-label);letter-spacing:.24em;text-transform:uppercase;color:var(--bone-dim)}',
    '.l-feed{flex:1;overflow-y:auto;padding:13px 16px 16px;display:flex;flex-direction:column;gap:8px;overscroll-behavior:contain;',
    'font:400 13px/1.6 var(--f-label)}',
    '.l-msg{display:flex;gap:9px;align-items:baseline;animation:l-in .2s ease-out}',
    '@keyframes l-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}',
    '.l-msg time{font:400 10px/1 var(--f-mono);color:var(--steel);flex:none;letter-spacing:.03em;opacity:.8}',
    '.l-msg b{color:var(--signal);font-weight:600;flex:none;max-width:8.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.l-msg p{margin:0;color:var(--bone);word-break:break-word}',
    '.l-msg.sys b{display:none}',
    '.l-msg.sys p{color:var(--bone-dim);font-size:12px;letter-spacing:.04em}',
    '.l-msg.sys time{opacity:.55}',
    '.l-msg.me b{color:var(--signal-hot)}',
    '.l-send{display:flex;gap:8px;padding:10px 16px;border-top:1px solid var(--line);background:rgba(0,0,0,.22)}',
    '.l-send input{flex:1;background:rgba(232,228,218,.05);border:1px solid var(--line);color:var(--bone);',
    'font:400 13px/1 var(--f-label);padding:10px 11px;outline:none;border-radius:2px;letter-spacing:.02em}',
    '.l-send input:focus{border-color:var(--signal);background:rgba(255,179,71,.06)}',
    '.l-send .btn{flex:none;padding:0 18px}',
    '.l-side{padding:15px 16px;display:flex;flex-direction:column;gap:15px;overflow-y:auto}',
    '.l-brief{font:400 12px/1.7 var(--f-label);color:var(--bone-dim);margin:7px 0 0}',
    '.l-list{margin:7px 0 0;padding:0;list-style:none;font:400 12px/2 var(--f-mono);color:var(--steel);letter-spacing:.04em}',
    '.l-list li{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid rgba(232,228,218,.07)}',
    '.l-list li:last-child{border-bottom:0}',
    '.l-list b{color:var(--bone);font-weight:500}',
    '.l-go{margin-top:auto;width:100%;padding:14px;font-size:15px;justify-content:center}',
    '.l-foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:8px max(16px,var(--gl));',
    'border-top:1px solid var(--line);font:400 10px/1 var(--f-mono);letter-spacing:.14em;color:var(--steel);text-transform:uppercase}',
    '@media (max-width:780px){',
    '.g-wrap{grid-template-columns:1fr;gap:20px}',
    '.g-mark{font-size:clamp(34px,11vw,52px)}',
    '.g-sub{font-size:13px;margin-top:12px}',
    '#gate{padding:18px}',
    '.l-main{grid-template-columns:1fr}',
    '.l-chat{border-right:0}',
    '.l-side{border-top:1px solid var(--line);max-height:34vh;padding:13px 14px}',
    '.l-side .l-brief{display:none}',
    '.l-foot span:last-child{display:none}',
    '}',
    /* ---- 公告 / 关于 弹窗 ---- */
    '#dlg{position:absolute;inset:0;z-index:76;display:none;align-items:center;justify-content:center;padding:20px}',
    '#dlg.on{display:flex}',
    '.dlg{position:fixed;inset:0;z-index:86;display:none;align-items:center;justify-content:center;padding:16px}' +'.dlg.on{display:flex}' +'.dlg-veil{position:absolute;inset:0;background:rgba(6,8,10,.8);backdrop-filter:blur(3px)}',
    '.dlg-card{position:relative;width:min(520px,100%);max-height:84%;display:flex;flex-direction:column;background:rgba(17,21,26,.985);border:1px solid rgba(255,255,255,.11);border-left:2px solid var(--dlg-c,#ffb347);box-shadow:0 24px 70px rgba(0,0,0,.6)}',
    '.dlg-h{padding:17px 20px 11px;border-bottom:1px solid rgba(255,255,255,.07)}',
    '.dlg-tag{display:inline-block;background:var(--dlg-c,#ffb347);color:#12161a;font:700 10px/1 var(--f-mono,system-ui);padding:4px 7px;letter-spacing:.14em;text-transform:uppercase}',
    '.dlg-h h3{margin:11px 0 0;font:700 18px/1.35 var(--f-label,system-ui);color:var(--bone,#eef2f5);letter-spacing:.03em}',
    '.dlg-b{padding:15px 20px;overflow-y:auto;font:400 13.5px/1.78 var(--f-label,system-ui);color:rgba(232,238,242,.76);white-space:pre-wrap}',
    '.dlg-f{padding:13px 20px 17px;display:flex;justify-content:flex-end;gap:10px}',
    '#m-about-row{order:99}',
    '#lobby{background:transparent!important;overflow:hidden}',
    '.hb-bg{position:absolute;inset:0;z-index:0;pointer-events:none;background:linear-gradient(180deg,rgba(6,9,12,.82) 0%,rgba(6,9,12,.18) 26%,rgba(6,9,12,.12) 55%,rgba(6,9,12,.86) 100%),radial-gradient(120% 70% at 50% 120%,rgba(6,9,12,.9),transparent 60%)}',
    '.hb-top{position:relative;z-index:6;display:flex;align-items:center;gap:12px;padding:8px 14px;background:linear-gradient(180deg,rgba(6,9,12,.8),transparent)}',
    '.hb-brand{display:flex;align-items:center;gap:7px;font:700 12px/1 var(--f-mono);letter-spacing:.2em;color:var(--bone)}',
    '.hb-tag{background:var(--signal);color:#14181b;padding:3px 5px;font:700 9px/1 var(--f-mono);letter-spacing:.08em}',
    '.hb-sub{font:500 9px/1 var(--f-label);letter-spacing:.3em;color:rgba(232,238,242,.42);text-transform:none}',
    '.hb-res{display:flex;align-items:center;gap:13px;margin-left:auto}',
    '.hb-money{display:flex;align-items:center;gap:5px;font:600 11.5px/1 var(--f-mono);color:var(--bone)}',
    '.hb-money em{font:500 8.5px/1 var(--f-label);color:rgba(232,238,242,.36);font-style:normal;letter-spacing:.08em}',
    '.hb-coin{width:9px;height:9px;border-radius:50%;background:linear-gradient(135deg,#ffda8a,#b8860b);box-shadow:0 0 6px rgba(255,216,122,.45)}',
    '.hb-coin.c2{background:linear-gradient(135deg,#cfe4ee,#6b8794);box-shadow:0 0 6px rgba(180,215,235,.35)}',
    '.hb-coin.c3{background:linear-gradient(135deg,#ffb0a0,#a83a22);box-shadow:0 0 6px rgba(255,140,110,.4)}',
    '.hb-plus{width:17px;height:17px;border:1px solid rgba(255,255,255,.18);background:transparent;color:rgba(232,238,242,.55);font:700 11px/1 var(--f-mono);cursor:pointer}',
    '.hb-tools{display:flex;gap:3px;margin-left:8px}',
    '.hb-tools button{width:25px;height:25px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.09);color:rgba(232,238,242,.66);font:600 10px/1 var(--f-label);cursor:pointer;transition:.15s}',
    '.hb-tools button:hover{background:rgba(255,181,71,.16);border-color:rgba(255,181,71,.6);color:var(--signal)}',
    '.hb-left{position:absolute;left:0;top:44px;bottom:78px;width:162px;z-index:6;display:flex;flex-direction:column;gap:9px;padding:0 6px 0 12px}',
    '.hb-user{display:flex;align-items:center;gap:8px;padding:7px;background:rgba(9,13,17,.55);border:1px solid rgba(255,255,255,.08)}',
    '.hb-av{position:relative;flex:0 0 32px;width:32px;height:32px;border-radius:50%;background:radial-gradient(circle at 38% 30%,#63778a,#1e262e);border:1px solid rgba(255,255,255,.18)}',
    '.hb-av::after{content:"";position:absolute;left:50%;top:30%;transform:translateX(-50%);width:11px;height:11px;border-radius:50%;background:#93a1ad}',
    '.hb-user b{display:block;max-width:82px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 11.5px/1.25 var(--f-label);color:var(--bone);text-transform:none}',
    '.hb-user span{font:500 8.5px/1.4 var(--f-mono);color:rgba(232,238,242,.4);letter-spacing:.08em}',
    '.hb-user em{font-style:normal;color:var(--bone)}',
    '.hb-rank{margin-left:auto;font:700 8.5px/1 var(--f-mono);color:#ffd27a;border:1px solid rgba(255,210,122,.38);padding:3px 3px;letter-spacing:.04em;white-space:nowrap}',
    '.hb-nav{display:flex;flex-direction:column;gap:1px}',
    '.hb-nav button{position:relative;display:flex;align-items:center;gap:8px;padding:8px 9px;background:transparent;border:0;border-left:2px solid transparent;color:rgba(232,238,242,.6);font:500 12px/1 var(--f-label);letter-spacing:.06em;text-align:left;cursor:pointer;transition:.15s}',
    '.hb-nav button i{font-style:normal;width:13px;text-align:center;font:600 10px/1 var(--f-mono);color:rgba(232,238,242,.32)}',
    '.hb-nav button.on{background:linear-gradient(90deg,rgba(255,181,71,.16),transparent);border-left-color:var(--signal);color:var(--bone)}',
    '.hb-nav button.on i{color:var(--signal)}',
    '.hb-nav button:hover{color:var(--bone);background:rgba(255,255,255,.05)}',
    '.hb-dot{width:5px;height:5px;border-radius:50%;background:#ff5a40;margin-left:auto}',
    '.hb-season{margin-top:auto;display:flex;align-items:center;gap:5px;padding:6px 7px;background:rgba(9,13,17,.55);border:1px solid rgba(255,255,255,.07);font:500 9px/1.4 var(--f-label);color:rgba(232,238,242,.46)}',
    '.hb-season b{color:var(--bone);font-weight:600}',
    '.hb-sep{width:1px;height:8px;background:rgba(255,255,255,.14)}',
    '.hb-center{position:absolute;left:162px;right:230px;top:44px;bottom:78px;z-index:4;display:flex;align-items:flex-end;justify-content:center;pointer-events:none}',
    '#hb-char{display:none}',
    '.hb-plate{position:absolute;left:50%;bottom:2px;transform:translateX(-50%);text-align:center}',
    '.hb-plate b{display:block;font:700 12px/1.2 var(--f-label);color:var(--bone);letter-spacing:.12em;text-shadow:0 2px 10px #000;text-transform:none}',
    '.hb-plate span{font:500 8px/1.7 var(--f-mono);color:rgba(232,238,242,.4);letter-spacing:.22em}',
    '.hb-right{position:absolute;right:12px;top:44px;width:206px;z-index:6;display:flex;flex-direction:column;gap:7px}',
    '.hb-card{position:relative;display:block;width:100%;height:58px;overflow:hidden;background:rgba(9,13,17,.6);border:1px solid rgba(255,255,255,.09);cursor:pointer;text-align:left;transition:.16s}',
    '.hb-card:hover{border-color:rgba(255,181,71,.5)}',
    '.hb-card b{position:absolute;left:8px;top:7px;z-index:2;font:700 10.5px/1 var(--f-label);color:var(--bone);letter-spacing:.12em}',
    '.hb-card span{position:absolute;left:8px;bottom:7px;z-index:2;font:500 8.5px/1 var(--f-mono);color:rgba(232,238,242,.44);letter-spacing:.06em}',
    '.hb-card::before{content:"";position:absolute;inset:0;background:linear-gradient(118deg,rgba(79,195,247,.2),transparent 58%),linear-gradient(0deg,rgba(6,9,12,.92),transparent 72%)}',
    '.hb-card.k2::before{background:linear-gradient(118deg,rgba(255,181,71,.22),transparent 58%),linear-gradient(0deg,rgba(6,9,12,.92),transparent 72%)}',
    '.hb-card.k3::before{background:linear-gradient(118deg,rgba(255,90,64,.2),transparent 58%),linear-gradient(0deg,rgba(6,9,12,.92),transparent 72%)}',
    '.hb-new{position:absolute;right:5px;top:5px;z-index:2;background:#ff5a40;color:#fff;font:700 7.5px/1 var(--f-mono);padding:2px 3px;letter-spacing:.05em}',
    '.hb-go{position:relative;margin-top:3px;width:100%;height:52px;border:1px solid rgba(255,120,80,.55);background:linear-gradient(118deg,#78230f,#a8361a 58%,#c1441f);cursor:pointer;transition:.16s}',
    '.hb-go b{display:block;font:700 14px/1 var(--f-label);color:#fff;letter-spacing:.22em}',
    '.hb-go em{display:block;margin-top:5px;font:500 7.5px/1 var(--f-mono);letter-spacing:.16em;color:rgba(255,255,255,.6);font-style:normal}',
    '.hb-go:hover{filter:brightness(1.14);box-shadow:0 0 24px rgba(255,90,40,.32)}',
    '#l-out{align-self:flex-end;background:transparent;border:1px solid rgba(255,255,255,.1);color:rgba(232,238,242,.45);font:500 9.5px/1 var(--f-label);padding:5px 8px;letter-spacing:.1em;cursor:pointer}',
    '#l-out:hover{color:#ff5a40;border-color:rgba(255,90,64,.45)}',
    '.hb-chat{position:absolute;left:0;right:0;bottom:0;z-index:7;height:70px;display:flex;flex-direction:column;background:linear-gradient(0deg,rgba(6,9,12,.94),rgba(6,9,12,.5) 72%,transparent);transition:height .2s}',
    '.hb-chat.open{height:min(50vh,290px)}',
    '.hb-feed{flex:1;overflow-y:auto;padding:4px 14px;display:flex;flex-direction:column;gap:1px;font:500 11px/1.55 var(--f-label);opacity:0;transition:opacity .16s}',
    '.hb-chat.open .hb-feed{opacity:1}',
    '.hb-form{display:flex;align-items:center;gap:7px;padding:7px 14px}',
    '.hb-ch{font:600 9.5px/1 var(--f-mono);color:var(--signal);letter-spacing:.1em;padding:4px 5px;background:rgba(255,181,71,.12);border:1px solid rgba(255,181,71,.3)}',
    '.hb-form input{flex:1;min-width:0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:var(--bone);font:500 11.5px/1 var(--f-label);padding:7px 9px;outline:none}',
    '.hb-form input:focus{border-color:rgba(255,181,71,.55)}',
    '.hb-form button{flex:0 0 auto;background:transparent;border:1px solid rgba(255,255,255,.13);color:rgba(232,238,242,.72);font:600 9.5px/1 var(--f-label);padding:7px 9px;letter-spacing:.08em;cursor:pointer}',
    '.hb-form button[type=submit]{background:var(--signal);color:#14181b;border-color:var(--signal)}',
    '.hb-status{position:absolute;left:14px;bottom:76px;z-index:7;display:flex;align-items:center;gap:6px;font:500 8.5px/1 var(--f-mono);letter-spacing:.08em;color:rgba(232,238,242,.42);pointer-events:none}',
    '.hb-status i{width:5px;height:5px;border-radius:50%;background:#58d68d;box-shadow:0 0 6px rgba(88,214,141,.7)}',
    '.hb-status b{color:var(--bone);font-weight:700}',
    '.hb-status em{font-style:normal;color:rgba(232,238,242,.3)}',
    '.hb-foot{margin-left:6px;color:rgba(232,238,242,.32)}',
    '.hb-feed .l-msg{display:flex;gap:6px;align-items:baseline;padding:1px 0;color:rgba(232,238,242,.72)}',
    '.hb-feed .l-msg time{flex:0 0 auto;font:500 8.5px/1 var(--f-mono);color:rgba(232,238,242,.28)}',
    '.hb-feed .l-msg b{flex:0 0 auto;font:600 10.5px/1 var(--f-label);color:var(--signal);text-transform:none;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.hb-feed .l-msg p{margin:0;font:500 11px/1.5 var(--f-label);color:rgba(232,238,242,.8);word-break:break-word}',
    '.hb-feed .l-msg.me b{color:#7fd4ff}',
    '.hb-feed .l-msg.sys{color:rgba(232,238,242,.34)}',
    '.hb-feed .l-msg.sys p{font-size:10px;color:rgba(232,238,242,.34)}',
    '.in-lobby .menu{opacity:0!important;visibility:hidden!important;pointer-events:none!important}',
    '.in-lobby .m-hint{display:none!important}',
    '.hb-center{align-items:center!important;justify-content:center!important;padding:0 10px}',
    '.hb-brief{width:100%;max-width:430px;padding:14px 16px;background:rgba(9,13,17,.58);border:1px solid rgba(255,255,255,.1);border-left:2px solid var(--signal);backdrop-filter:blur(3px)}',
    '.hb-lv{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin:0 0 9px}' +'.hb-lv button{flex:1;min-width:0;font-size:9px;padding:7px 4px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);color:rgba(232,238,242,.6);font:600 9.5px/1 var(--f-label);letter-spacing:.06em;cursor:pointer;transition:.14s}' +'.hb-lv button.on{background:rgba(255,181,71,.16);border-color:rgba(255,181,71,.55);color:var(--signal)}' +
  '.hb-lv button.done:not(.on){border-color:rgba(120,200,140,.42);color:rgba(150,220,170,.85)}' +
  '.hb-lv button.next:not(.on){border-color:rgba(255,181,71,.5);color:rgba(255,205,140,.9);animation:lvn 2.4s ease-in-out infinite}' +
  '.hb-coop{display:flex;gap:5px;margin:0 0 9px}' +
  '.hb-coop input{flex:1;min-width:0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.16);color:var(--ink,#e8e6e1);padding:7px 9px;font:600 9px/1 var(--f-mono,monospace);letter-spacing:.16em;text-transform:uppercase;border-radius:2px;outline:none}' +
  '.hb-coop input:focus{border-color:rgba(255,181,71,.6)}' +
  '.hb-coop button{flex:0 0 auto;background:rgba(255,181,71,.14);border:1px solid rgba(255,181,71,.45);color:var(--signal,#ffb547);padding:7px 12px;font:600 9px/1 var(--f-mono,monospace);letter-spacing:.12em;border-radius:2px;cursor:pointer}' +
  '.hb-coop button:hover{background:rgba(255,181,71,.24)}' +
  '.hb-brief{position:relative;z-index:3}' +
  '.hb-brief,.hb-brief *{pointer-events:auto}' +
  '.hb-card.k4::before{background:linear-gradient(135deg,rgba(120,200,255,.16),rgba(255,181,71,.1))}' +
  '#fb{position:fixed;inset:0;z-index:400;display:none;align-items:center;justify-content:center;padding:18px}' +
  '#fb.on{display:flex}' +
  '.fb{position:fixed;inset:0;z-index:400;display:none;align-items:center;justify-content:center;padding:16px}'+'.fb.on{display:flex}'+'.fb-veil{position:absolute;inset:0;background:rgba(5,8,11,.74);backdrop-filter:blur(4px)}' +
  '.fb-card{position:relative;display:flex;flex-direction:column;width:min(560px,100%);max-height:min(86vh,680px);background:rgba(13,17,22,.995);border:1px solid rgba(255,255,255,.13);border-top:2px solid var(--signal);box-shadow:0 24px 70px rgba(0,0,0,.6)}' +
  '.fb-h{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid rgba(255,255,255,.08)}' +
  '.fb-h b{font:700 13px/1 var(--f-label);color:var(--bone);letter-spacing:.16em}' +
  '.fb-h span{font:600 9px/1 var(--f-mono);color:rgba(232,238,242,.34);letter-spacing:.2em}' +
  '#fb-x{margin-left:auto;width:24px;height:24px;background:transparent;border:1px solid rgba(255,255,255,.14);color:rgba(232,238,242,.6);font:600 13px/1 var(--f-mono);cursor:pointer}' +
  '#fb-x:hover{color:#ff5a40;border-color:rgba(255,90,64,.5)}' +
  '.fb-list{flex:1;overflow-y:auto;padding:11px 14px;display:flex;flex-direction:column;gap:9px;min-height:110px}' +
  '.fb-empty{margin:16px 0;text-align:center;font:400 11.5px/1.8 var(--f-label);color:rgba(232,238,242,.34)}' +
  '.fb-item{padding:9px 11px;background:rgba(255,255,255,.035);border-left:2px solid rgba(255,181,71,.4)}' +
  '.fb-item.done{border-left-color:rgba(120,220,160,.6)}' +
  '.fb-t{margin:0;font:400 12px/1.65 var(--f-label);color:rgba(232,238,242,.86);word-break:break-word}' +
  '.fb-meta{margin-top:5px;font:500 9px/1 var(--f-mono);color:rgba(232,238,242,.3);letter-spacing:.06em}' +
  '.fb-meta i{font-style:normal;margin-left:8px;color:rgba(120,220,160,.9)}' +
  '.fb-meta i.w{color:rgba(255,181,71,.75)}' +
  '.fb-re{margin-top:7px;padding:7px 9px;background:rgba(120,220,160,.07);border-left:2px solid rgba(120,220,160,.5)}' +
  '.fb-re b{display:block;margin-bottom:3px;font:700 8.5px/1 var(--f-mono);color:rgba(140,225,175,.9);letter-spacing:.16em}' +
  '.fb-re p{margin:0;font:400 11.5px/1.6 var(--f-label);color:rgba(232,238,242,.8);word-break:break-word}' +
  '.fb-form{border-top:1px solid rgba(255,255,255,.08);padding:10px 14px 12px}' +
  '#fb-ta{width:100%;min-height:84px;max-height:170px;resize:vertical;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.12);color:var(--bone);font:400 12.5px/1.6 var(--f-label);padding:9px 10px;outline:none;box-sizing:border-box}' +
  '#fb-ta:focus{border-color:rgba(255,181,71,.55)}' +
  '.fb-foot{display:flex;align-items:center;gap:10px;margin-top:8px}' +
  '#fb-cnt{font:500 9px/1 var(--f-mono);color:rgba(232,238,242,.3);letter-spacing:.08em}' +
  '#fb-send{margin-left:auto;background:var(--signal);border:0;color:#14181b;font:700 11px/1 var(--f-label);padding:9px 22px;letter-spacing:.12em;cursor:pointer}' +
  '#fb-send:disabled{opacity:.5;cursor:default}' +
  '@media (min-width:900px){.fb-h b{font-size:15px}.fb-t{font-size:14px}.fb-re p{font-size:13px}#fb-ta{font-size:14px;min-height:110px}#fb-send{font-size:13px;padding:11px 28px}}' +
  '.hb-brief{z-index:40}' +
    'body.in-play,body.in-play *{cursor:none!important}' +
  '#lobby button,#lobby input,#lobby a{touch-action:manipulation;-webkit-tap-highlight-color:transparent}' +
  '.hb-go.coop-hot{border-color:rgba(120,220,160,.75)!important;background:rgba(90,190,130,.16)!important;animation:coophot 1.8s ease-in-out infinite}' +
  '.hb-go.coop-hot em{color:rgba(150,235,185,.95)!important}' +
  '@keyframes coophot{0%,100%{box-shadow:0 0 0 0 rgba(120,220,160,0)}50%{box-shadow:0 0 0 5px rgba(120,220,160,.16)}}' +
  '#view{transition:filter .45s ease}' +
  'body.in-hub #view{filter:brightness(.62) saturate(.85) blur(1.6px)}' +
    '@media (min-width:900px){' +
      '.hb-top{padding:11px 22px;gap:16px}' +
      '.hb-left{width:262px;top:60px;bottom:104px;padding:0 10px 0 24px;gap:14px;z-index:8}' +
      '.hb-right{width:322px;right:24px;top:60px;gap:11px;z-index:8}' +
      '.hb-brief{max-width:min(660px,max(280px,calc(100vw - 760px)));padding:24px 30px;z-index:6}' +
      '.hb-brief h2{font-size:26px;margin:0 0 11px}' +
      '.hb-brief p{font-size:16px;line-height:1.65;margin:0 0 16px}' +
      '.hb-brief li{font-size:14.5px;gap:11px}' +
      '.hb-brief li i{flex:0 0 22px;width:22px;height:22px;font-size:12px}' +
      '.hb-k{font-size:11px;letter-spacing:.3em;margin-bottom:13px}' +
      '.hb-lv{gap:8px;margin:0 0 14px}' +
      '.hb-lv button{font-size:14px;padding:11px 6px;letter-spacing:.07em}' +
      '.hb-coop{gap:8px;margin:0 0 14px}' +
      '.hb-coop input{font-size:13px;padding:11px 13px}' +
      '.hb-coop button{font-size:13px;padding:11px 20px}' +
      '.hb-time{font-size:11.5px;line-height:1.7}' +
      '.hb-card b{font-size:15px}' +
      '.hb-card span{font-size:11.5px}' +
      '.hb-go b{font-size:19px}' +
      '.hb-go em{font-size:10px}' +
      '.hb-chatbtn{height:46px;font-size:14px}' +
      '.hb-av{flex:0 0 46px;width:46px;height:46px}' +
      '.hb-av .hb-avd{width:24px;height:24px}' +
      '.hb-user b{font-size:14px}' +
      '.hb-user i{font-size:10.5px}' +
      '.hb-nav button{font-size:13px}' +
      '.hb-nav .ic{width:20px;height:20px}' +
      '.ic{width:19px;height:19px}' +
    '}' +
  '@keyframes lvn{0%,100%{box-shadow:0 0 0 0 rgba(255,181,71,0)}50%{box-shadow:0 0 0 3px rgba(255,181,71,.14)}}' +'.hb-lv button:hover{border-color:rgba(255,181,71,.4)}' +'.hb-k{display:block;margin-bottom:8px;font:600 8px/1 var(--f-mono);letter-spacing:.26em;color:var(--signal)}',
    '.hb-brief h2{margin:0 0 7px;font:700 16px/1.3 var(--f-label);color:var(--bone);letter-spacing:.05em}',
    '.hb-brief p{margin:0 0 10px;font:400 11px/1.7 var(--f-label);color:rgba(232,238,242,.58)}',
    '.hb-brief ul{list-style:none;margin:0 0 10px;padding:0;display:flex;flex-direction:column;gap:5px}',
    '.hb-brief li{display:flex;align-items:center;gap:7px;font:500 10px/1 var(--f-label);color:rgba(232,238,242,.7)}',
    '.hb-brief li i{display:grid;place-items:center;flex:0 0 15px;width:15px;height:15px;background:rgba(255,181,71,.15);border:1px solid rgba(255,181,71,.42);color:var(--signal);font:700 8.5px/1 var(--f-mono);font-style:normal}',
    '.hb-time{font:500 8px/1.6 var(--f-mono);color:rgba(232,238,242,.32);letter-spacing:.08em}',
    '.hb-time b{color:rgba(232,238,242,.72);font-weight:600;text-transform:none}',
    '.hb-chatbtn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;height:32px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:rgba(232,238,242,.7);font:600 10px/1 var(--f-label);letter-spacing:.14em;cursor:pointer;transition:.15s}',
    '.hb-chatbtn:hover{border-color:rgba(255,181,71,.5);color:var(--signal)}',
    '.hb-unread{display:none;min-width:15px;height:15px;padding:0 4px;border-radius:8px;background:#ff5a40;color:#fff;font:700 8.5px/15px var(--f-mono);font-style:normal}',
    '.hb-unread.on{display:inline-block}',
    '.cb{position:absolute;inset:0;z-index:80;display:none;align-items:center;justify-content:center;padding:14px}',
    '.cb.on{display:flex}',
    '.cb-veil{position:absolute;inset:0;background:rgba(5,8,11,.7);backdrop-filter:blur(3px)}',
    '.cb-card{position:relative;display:flex;flex-direction:column;width:min(520px,100%);height:min(74vh,430px);background:rgba(14,18,23,.99);border:1px solid rgba(255,255,255,.12);border-top:2px solid var(--signal);box-shadow:0 24px 60px rgba(0,0,0,.62)}',
    '.cb-h{display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid rgba(255,255,255,.08)}',
    '.cb-h b{font:700 11.5px/1 var(--f-label);color:var(--bone);letter-spacing:.14em}',
    '.cb-h span{font:500 8.5px/1 var(--f-mono);color:rgba(232,238,242,.38);letter-spacing:.06em}',
    '.cb-h em{color:#58d68d;font-style:normal;font-weight:700}',
    '#cb-x{margin-left:auto;width:22px;height:22px;background:transparent;border:1px solid rgba(255,255,255,.14);color:rgba(232,238,242,.6);font:600 11px/1 var(--f-mono);cursor:pointer}',
    '#cb-x:hover{color:#ff5a40;border-color:rgba(255,90,64,.5)}',
    '.cb-feed{flex:1;overflow-y:auto;padding:8px 11px;display:flex;flex-direction:column;gap:2px}',
    '.cb-form{display:flex;gap:6px;padding:8px 11px;border-top:1px solid rgba(255,255,255,.08)}',
    '.cb-form input{flex:1;min-width:0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.11);color:var(--bone);font:500 12px/1 var(--f-label);padding:8px 10px;outline:none}',
    '.cb-form input:focus{border-color:rgba(255,181,71,.55)}',
    '.cb-form button{background:var(--signal);border:0;color:#14181b;font:600 10.5px/1 var(--f-label);padding:9px 14px;letter-spacing:.1em;cursor:pointer}',
    '.cb .l-msg{display:flex;gap:6px;align-items:baseline;padding:2px 0}',
    '.cb .l-msg time{flex:0 0 auto;font:500 8px/1 var(--f-mono);color:rgba(232,238,242,.26)}',
    '.cb .l-msg b{flex:0 0 auto;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 10.5px/1 var(--f-label);color:var(--signal);text-transform:none}',
    '.cb .l-msg p{margin:0;font:500 11.5px/1.55 var(--f-label);color:rgba(232,238,242,.82);word-break:break-word}',
    '.cb .l-msg.me b{color:#7fd4ff}',
    '.cb .l-msg.sys p{font-size:10.5px;color:rgba(232,238,242,.36)}',
    '.ic{display:block;width:13px;height:13px}' +'.hb-nav .ic{width:14px;height:14px}' +'.hb-nav button i{display:grid;place-items:center;width:14px}' +'.hb-av{position:relative;flex:0 0 32px;width:32px;height:32px;padding:0;border-radius:50%;overflow:hidden;display:grid;place-items:center;color:rgba(232,238,242,.55);background:radial-gradient(circle at 38% 30%,#5b6d7d,#1c242c);border:1px solid rgba(255,255,255,.18);cursor:pointer;transition:.15s}' +'.hb-av::after{display:none}' +'.hb-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +'.hb-av .hb-avd{width:18px;height:18px}' +'.hb-av:hover{border-color:var(--signal);color:var(--signal)}' +'.hb-user b{cursor:pointer}' +'.hb-user b:hover{color:var(--signal)}' +'.nd{position:absolute;inset:0;z-index:82;display:none;align-items:center;justify-content:center;padding:16px}' +'.nd.on{display:flex}' +'.nd-veil{position:absolute;inset:0;background:rgba(5,8,11,.7);backdrop-filter:blur(3px)}' +'.nd-card{position:relative;width:min(320px,100%);padding:16px;display:flex;flex-direction:column;gap:9px;background:rgba(14,18,23,.99);border:1px solid rgba(255,255,255,.12);border-top:2px solid var(--signal)}' +'.nd-card b{font:700 12px/1 var(--f-label);color:var(--bone);letter-spacing:.14em}' +'.nd-card input{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);color:var(--bone);font:500 13px/1 var(--f-label);padding:9px 10px;outline:none}' +'.nd-card input:focus{border-color:rgba(255,181,71,.6)}' +'.nd-err{margin:0;min-height:14px;font:500 10px/1.4 var(--f-label);color:#ff5a40}' +'.nd-act{display:flex;gap:7px;justify-content:flex-end}' +'.nd-act button{background:transparent;border:1px solid rgba(255,255,255,.14);color:rgba(232,238,242,.7);font:600 10.5px/1 var(--f-label);padding:8px 13px;letter-spacing:.1em;cursor:pointer}' +'#nd-ok{background:var(--signal);color:#14181b;border-color:var(--signal)}' +'@media (max-height:560px) and (orientation:landscape){' +
      '.hb-season{display:none}' +
      '.hb-user{padding:5px 6px}' +
      '.hb-av{width:26px;height:26px;flex-basis:26px}' +
      '.hb-nav button{padding:6px 8px;font-size:11px}' +
      '.hb-card{height:48px}' +
      '.hb-go{height:42px}' +
      '.hb-go b{font-size:12.5px}' +
      '.hb-brief{padding:10px 12px}' +
      '.hb-brief h2{font-size:14px}' +
      '.hb-brief p{display:none}' +
      '.hb-brief ul{margin-bottom:7px}' +
      '}' +
    '@media (orientation:portrait){' +
      '.hb-top{padding:6px 8px;gap:6px}' +
      '.hb-brand b{font-size:11px}' +
      '.hb-sub,.hb-money em,.hb-plus{display:none}' +
      '.hb-res{gap:8px}' +
      '.hb-money{font-size:10px}' +
      '.hb-tools{gap:2px;margin-left:4px}' +
      '.hb-tools button{width:21px;height:21px;font-size:9px}' +
      '.hb-left{width:104px;padding:0 4px 0 8px;gap:6px;top:40px;bottom:64px}' +
      '.hb-user{flex-direction:column;gap:4px;padding:6px 4px;text-align:center}' +
      '.hb-av{width:26px;height:26px;flex:0 0 26px}' +
      '.hb-user b{max-width:92px;font-size:10px}' +
      '.hb-user span{font-size:8px}' +
      '.hb-rank{display:none}' +
      '.hb-nav button{padding:6px 5px;font-size:10.5px;gap:5px;letter-spacing:0}' +
      '.hb-nav button i{width:10px;font-size:9px}' +
      '.hb-season{display:none}' +
      '.hb-center{left:104px;right:154px;top:40px;bottom:64px;padding:0 3px}' +
      '.hb-brief{padding:8px 9px;max-width:100%}' +
      '.hb-k{display:none}' +
      '.hb-brief h2{font-size:11.5px;margin-bottom:5px}' +
      '.hb-brief p{display:none}' +
      '.hb-brief ul{gap:4px;margin-bottom:6px}' +
      '.hb-brief li{font-size:9px;gap:5px}' +
      '.hb-brief li i{flex:0 0 13px;width:13px;height:13px;font-size:8px}' +
      '.hb-time{font-size:7.5px;line-height:1.5}' +
      '.hb-right{width:148px;right:6px;top:40px;gap:5px}' +
      '.hb-card{height:42px}' +
      '.hb-card b{font-size:9.5px;left:6px;top:6px}' +
      '.hb-card span{display:none}' +
      '.hb-go{height:40px;margin-top:1px}' +
      '.hb-go b{font-size:11.5px;letter-spacing:.14em}' +
      '.hb-go em{display:none}' +
      '.hb-chatbtn{height:26px;font-size:8.5px;letter-spacing:.08em}' +
      '#l-out{font-size:8.5px;padding:4px 6px}' +
      '.hb-status{display:none}' +
      '.cb-card{height:min(76vh,340px)}' +
      '.cb-h{padding:7px 9px}' +
      '.cb-feed{padding:6px 8px}' +
      '.cb-form{padding:6px 8px}' +
      '.cb .l-msg p{font-size:11px}' +
      '}'
  ].join('');

  var st = document.createElement('style');
  st.id = 'auth-style';
  st.textContent = CSS;
  document.head.appendChild(st);

  /* ---------------- DOM ---------------- */
  var HOST = document.getElementById('app') || document.body;

  var gate = document.createElement('div');
  gate.id = 'gate';
  gate.innerHTML =
    '<div class="g-wrap">' +
      '<div class="g-brand">' +
        '<div class="g-eyebrow"><span class="g-tag">B4</span><span>港务局破袭小队</span><span>接入终端</span></div>' +
        '<h1 class="g-mark">FANWHALE</h1>' +
        '<p class="g-sub">港口的安防网络已经失控。切断它的三条上行链路，然后登上接应船。<br>先登记你的破袭编号。</p>' +
        '<div class="g-rule"></div>' +
        '<div class="g-meta"><span>在线 <b id="g-on">0</b></span><span>通道 世界</span><span>节点 SL-04</span></div>' +
      '</div>' +
      '<form class="g-card" id="g-form">' +
        '<h2 id="g-title">身份验证</h2>' +
        '<p class="g-hint" id="g-hint">输入通行编号与口令</p>' +
        '<label class="g-field"><span>破袭编号</span><input id="g-u" maxlength="16" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>' +
        '<label class="g-field"><span>通行口令</span><input id="g-p" type="password" maxlength="64" autocomplete="current-password" required></label>' +
        '<p class="g-err" id="g-err"></p>' +
        '<div class="g-actions"><button class="btn primary" type="submit" id="g-go">进入</button><button class="btn" type="button" id="g-switch">注册</button></div>' +
        '<p class="g-alt" id="g-alt"></p>' +
      '</form>' +
    '</div>';

  /* 扁平线性图标（内联 SVG，无字体依赖） */
  var ic = function (inner) {
    return '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg>';
  };
  var IC = {
    mic: ic('<rect x="5.9" y="1.7" width="4.2" height="7.2" rx="2.1"/><path d="M3.4 7.3a4.6 4.6 0 0 0 9.2 0M8 12.1v2.2"/>'),
    friend: ic('<circle cx="5.7" cy="5.2" r="2.3"/><path d="M1.6 13.4c0-2.2 1.8-3.7 4.1-3.7s4.1 1.5 4.1 3.7"/><circle cx="11.5" cy="5.9" r="1.8"/><path d="M11.1 9.9c1.8.1 3.3 1.3 3.3 3.2"/>'),
    mail: ic('<rect x="1.5" y="3.3" width="13" height="9.4" rx="1.3"/><path d="M1.9 4.3 8 8.9l6.1-4.6"/>'),
    quest: ic('<path d="M4 2.5h8a1 1 0 0 1 1 1v10l-5-2.4-5 2.4v-10a1 1 0 0 1 1-1Z"/><path d="M6.3 6.1h3.4M6.3 8.4h2.2"/>'),
    bell: ic('<path d="M4 6.8a4 4 0 1 1 8 0c0 2.9 1.1 4 1.1 4H2.9S4 9.7 4 6.8Z"/><path d="M6.7 13.3a1.5 1.5 0 0 0 2.6 0"/>'),
    chart: ic('<path d="M2.2 13.2V9.1M6.1 13.2V5.3M10 13.2V7.2M13.8 13.2V2.9"/>'),
    gear: ic('<circle cx="8" cy="8" r="2.3"/><path d="M8 1.5v1.7M8 12.8v1.7M14.5 8h-1.7M3.2 8H1.5M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2M12.6 12.6l-1.2-1.2M4.6 4.6 3.4 3.4"/>'),
    user: ic('<circle cx="8" cy="5.3" r="2.5"/><path d="M2.9 13.8c0-2.8 2.3-4.6 5.1-4.6s5.1 1.8 5.1 4.6"/>'),
    contact: ic('<path d="M2.1 3.6h11.8v7H7.6l-3.2 2.6v-2.6H2.1Z"/>'),
    gun: ic('<path d="M10.7 2.3a3.3 3.3 0 0 0-3.1 4.5L2.7 11.7a1.5 1.5 0 1 0 2.1 2.1l4.9-4.9a3.3 3.3 0 0 0 4.5-3.1l-2 2-1.9-.5-.5-1.9Z"/>'),
    market: ic('<path d="M2.7 5.5h10.6l-.8 8H3.5Z"/><path d="M5.7 5.5V4.1a2.3 2.3 0 0 1 4.6 0v1.4"/>'),
    skin: ic('<path d="M8 3.2a1.3 1.3 0 1 0 .8 2.3L8 6.1 2.5 10.3a1 1 0 0 0 .6 1.7h9.8a1 1 0 0 0 .6-1.7L8 6.1"/>'),
    avdef: '<svg class="hb-avd" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="5.7" r="2.6"/><path d="M2.9 14c0-2.9 2.3-4.8 5.1-4.8s5.1 1.9 5.1 4.8"/></svg>'
  };

  var lobby = document.createElement('div');
  lobby.id = 'lobby';
  lobby.innerHTML =
    '<div class="hb-bg"></div>' +
    '<header class="hb-top">' +
      '<div class="hb-brand"><span class="hb-tag">B4</span><b>FANWHALE</b><span class="hb-sub">凡鲸行动</span></div>' +
      '<div class="hb-res">' +
        '<span class="hb-money"><i class="hb-coin"></i><b>45,202</b><em>克</em></span>' +
        '<span class="hb-money"><i class="hb-coin c2"></i><b>140</b><em>嘉奖</em></span>' +
        '<span class="hb-money"><i class="hb-coin c3"></i><b>50</b><em>勋点</em></span>' +
        '<button class="hb-plus" type="button" data-hb="money">+</button>' +
      '</div>' +
      '<div class="hb-tools">' +
        '<button type="button" data-hb="voice" title="语音" aria-label="语音">' + IC.mic + '</button>' +
        '<button type="button" data-hb="friend" title="好友" aria-label="好友">' + IC.friend + '</button>' +
        '<button type="button" data-hb="mail" title="邮件" aria-label="邮件">' + IC.mail + '</button>' +
        '<button type="button" data-hb="quest" title="任务" aria-label="任务">' + IC.quest + '</button>' +
        '<button type="button" data-hb="notice" title="公告" aria-label="公告">' + IC.bell + '</button>' +
        '<button type="button" data-hb="stats" title="战绩" aria-label="战绩">' + IC.chart + '</button>' +
        '<button type="button" data-hb="settings" title="设置" aria-label="设置">' + IC.gear + '</button>' +
      '</div>' +
    '</header>' +
    '<aside class="hb-left">' +
      '<div class="hb-user">' +
        '<button class="hb-av" id="hb-av" type="button" title="更换头像" aria-label="更换头像">' + '<img id="hb-avimg" alt="" hidden>' + IC.avdef + '</button>' +
        '<div><b id="l-me" role="button" tabindex="0" title="点击修改昵称">—</b><span>等级 <em>1</em></span></div>' +
        '<i class="hb-rank">新兵 I</i>' +
      '</div>' +
      '<nav class="hb-nav">' +
        '<button type="button" class="on" data-hb="role">' + '<i>' + IC.user + '</i>' + '角色</button>' +
        '<button type="button" data-hb="contact">' + '<i>' + IC.contact + '</i>' + '联络人</button>' +
        '<button type="button" data-hb="gun">' + '<i>' + IC.gun + '</i>' + '改枪</button>' +
        '<button type="button" data-hb="market">' + '<i>' + IC.market + '</i>' + '市场</button>' +
        '<button type="button" data-hb="skin">' + '<i>' + IC.skin + '</i>装扮<b class="hb-dot"></b></button>' +
      '</nav>' +
      '<div class="hb-season"><span>赛季手册 <b>1 级</b></span><i class="hb-sep"></i><span>段位 · 任务</span></div>' +
    '</aside>' +
    '<div class="hb-center">' +
      '<div class="hb-brief">' +
        '<span class="hb-k">行动简报 / BRIEFING</span>' +
        '<h2 id="lv-name">盐线码头 · 4 号泊位</h2>' +
        '<p id="lv-desc">港口的安防网络已经失控。切断它的三条上行链路，然后登上南端爬梯旁的接应船。</p>' +
        '<ul id="lv-objs">' +
          '<li><i>A</i>北侧继电器 · 通电中</li>' +
          '<li><i>B</i>西侧继电器 · 通电中</li>' +
          '<li><i>C</i>南侧继电器 · 通电中</li>' +
        '</ul>' +
        '<div class="hb-lv" id="lv-pick">' +
          '<button type="button" data-lv="dock">盐线码头</button>' +
          '<button type="button" data-lv="warehouse">盐仓</button>' +
          '<button type="button" data-lv="freighter">盐运七号</button>' +
          '<button type="button" data-lv="pumpstation">盐泵站</button>' +
        '</div>' +
        '<div class="hb-coop" id="lv-coop">' +
          '<input id="coop-code" maxlength="6" inputmode="latin" autocomplete="off" spellcheck="false" placeholder="房间码 · 留空新建">' +
          '<button type="button" id="coop-go">联机</button>' +
        '</div>' +
        '<div class="hb-time"><b id="s-name">—</b> · <span id="lv-prog">战役 0\u20444</span> · 单人突入</div>' +
      '</div>' +
    '</div>' +
    '<aside class="hb-right">' +
      '<button class="hb-card k4" type="button" data-hb="feedback"><b>意见反馈</b><span>问题 / 建议 · 官方回复</span></button>' +
      '<button class="hb-card k2" type="button" data-hb="shop"><b>商城</b><span>限时补给</span><i class="hb-new">NEW</i></button>' +
      '<button class="hb-card k3" type="button" data-hb="season"><b>赛季</b><span>冻原猎手 · 即将开始</span></button>' +
      '<button class="hb-go" id="l-go" type="button"><b>进入行动</b><em>GO INTO THE SALT</em></button>' +
      '<button class="hb-chatbtn" id="cb-open" type="button">世界频道<i class="hb-unread" id="cb-unread">0</i></button>' +
      '<button id="l-out" type="button">退出登录</button>' +
    '</aside>' +
    '<div class="hb-status"><i></i><span id="l-stat">连接中</span><em>在线</em><b id="l-on">0</b><span class="hb-foot" id="l-foot">已接入 · 加密通道</span></div>' +
    '<div class="nd" id="nd">' +'<div class="nd-veil" id="nd-veil"></div>' +'<div class="nd-card">' +'<b>修改昵称</b>' +'<input id="nd-in" maxlength="16" autocomplete="off" placeholder="2-16 位：中英文、数字、下划线">' +'<p class="nd-err" id="nd-err"></p>' +'<div class="nd-act"><button type="button" id="nd-x">取消</button><button type="button" id="nd-ok">保存</button></div>' +'</div></div>' +'<div class="cb" id="cb">' +
      '<div class="cb-veil" id="cb-veil"></div>' +
      '<div class="cb-card">' +
        '<header class="cb-h"><b>世界频道</b><span>在线 <em id="cb-on">0</em></span><button type="button" id="cb-x">✕</button></header>' +
        '<div class="cb-feed" id="l-feed"></div>' +
        '<form class="cb-form" id="l-form">' +
          '<input id="l-in" maxlength="160" placeholder="和全服破袭者说点什么…" autocomplete="off">' +
          '<button type="submit">发送</button>' +
        '</form>' +
      '</div>' +
    '</div>';

  HOST.appendChild(gate);
  HOST.appendChild(lobby);

  function $(s) { return document.querySelector(s); }

  /* ---------------- 接口 ---------------- */
  function api(p, opt) {
    opt = opt || {};
    opt.headers = Object.assign({ 'content-type': 'application/json' }, opt.headers || {});
    if (S.tok) opt.headers.authorization = 'Bearer ' + S.tok;
    return fetch(API + p, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        j.__s = r.status;
        return j;
      });
    });
  }

  /* ---------------- 门禁 ---------------- */
  function gerr(t) {
    var e = $('#g-err');
    e.textContent = t || '';
    e.classList.toggle('on', !!t);
  }

  function setMode(m) {
    S.mode = m;
    $('#g-title').textContent = m === 'login' ? '身份验证' : '登记编号';
    $('#g-hint').textContent = m === 'login' ? '输入通行编号与口令' : '新破袭者：2-16 位昵称，口令至少 6 位';
    $('#g-go').textContent = m === 'login' ? '进入' : '注册并进入';
    $('#g-switch').textContent = m === 'login' ? '注册' : '已有编号';
    $('#g-p').setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
    gerr('');
  }

  function showGate(offline) {
    gate.classList.add('on');
    lobby.classList.remove('on');
    document.body.classList.remove('authed');
    setMode('login');
    var alt = $('#g-alt');
    alt.innerHTML = offline
      ? '服务器没有响应 · <a id="g-skip">离线进入</a>'
      : '首次来？点「注册」建立一个编号。';
    var skip = document.getElementById('g-skip');
    if (skip) skip.addEventListener('click', function () { goOffline(); });
    setTimeout(function () { try { $('#g-u').focus(); } catch (e) {} }, 220);
  }

  function hideGate() {
    gate.classList.remove('on');
    document.body.classList.add('authed');
  }

  /* ---------------- 大厅 ---------------- */
  function fmt(t) {
    var d = new Date(t || Date.now());
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function addMsg(m) {
    var feed = $('#l-feed');
    if (!feed) return;
    var stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 48;
    var row = document.createElement('div');
    row.className = 'l-msg' + (m.kind === 'sys' ? ' sys' : '') + (m.u && m.u === S.me ? ' me' : '');
    var t = document.createElement('time');
    t.textContent = fmt(m.t);
    row.appendChild(t);
    if (m.u) {
      var b = document.createElement('b');
      b.textContent = m.n || m.u;
      row.appendChild(b);
    }
    var p = document.createElement('p');
    p.textContent = m.txt;
    row.appendChild(p);
    feed.appendChild(row);
    while (feed.children.length > 220) feed.removeChild(feed.firstChild);
    if (stick) feed.scrollTop = feed.scrollHeight;
    var cbEl = document.getElementById('cb');
    if (S.unreadReady && cbEl && !cbEl.classList.contains('on') && !(m.u && m.u === S.me) && m.kind !== 'sys') {
      S.unread = (S.unread || 0) + 1;
      var un = document.getElementById('cb-unread');
      if (un) { un.textContent = S.unread > 99 ? '99+' : String(S.unread); un.classList.add('on'); }
    }
  }

  function setOnline(n) {
    S.online = n | 0;
    var a = $('#l-on'), b = $('#g-on');
    if (a) a.textContent = String(S.online);
    if (b) b.textContent = String(S.online);
  }

  function setStat(t) {
    var e = $('#l-stat');
    if (e) e.textContent = t;
  }

  function foot(t) {
    var e = $('#l-foot');
    if (!e) return;
    e.textContent = t;
    clearTimeout(foot.tm);
    foot.tm = setTimeout(function () { e.textContent = '已接入 · 加密通道'; }, 2600);
  }

  function poll() {
    clearTimeout(S.timer);
    api('/chat?since=' + S.seq).then(function (j) {
      if (j.__s === 401) { logout(); return; }
      if (j.__s === 403) {
        openDlg('账号状态', '当前账号已被封禁', j.err || '请联系管理员', 'error');
        logout();
        return;
      }
      if (j.err) { setStat('受限'); return; }
      if (j.msgs && j.msgs.length) {
        for (var i = 0; i < j.msgs.length; i++) addMsg(j.msgs[i]);
        S.seq = j.msgs[j.msgs.length - 1].id;
      }
      setOnline(j.online);
      setStat('已连接');
    }).catch(function () {
      setStat('重连中…');
    }).then(function () {
      S.timer = setTimeout(poll, 2400);
    });
  }

  function onAuthed(u, online, meta) {
    S.me = u;
    S.nick = (meta && meta.nick) || u;
    S.av = (meta && meta.av) || 0;
    hideGate();
    $('#l-me').textContent = S.nick;
    $('#s-name').textContent = S.nick;
    paintAv();
    setOnline(online || 1);
    setStat('已连接');
    lobby.classList.add('on');
    poll();
    setTimeout(showNoticesOnce, 900);
    setTimeout(function () { S.unreadReady = true; }, 2200);
    try { setTimeout(function () { if (window.__imm) window.__imm.enter(); }, 0); } catch (e) {}
    if (!('ontouchstart' in window)) {
      setTimeout(function () { try { $('#l-in').focus(); } catch (e) {} }, 320);
    }
  }

  function logout() {
    clearTimeout(S.timer);
    api('/logout', { method: 'POST' }).catch(function () {});
    try { localStorage.removeItem(KEY); } catch (e) {}
    S.tok = ''; S.me = ''; S.seq = 0;
    var feed = $('#l-feed');
    if (feed) feed.innerHTML = '';
    showGate(false);
  }

  function goOffline() {
    hideGate();
    lobby.classList.remove('on');
    var menu = document.querySelector('.menu');
    if (menu) menu.classList.add('open');
    S.offline = true;
  }

  /* ---------------- 绑定 ---------------- */
  $('#g-switch').addEventListener('click', function () { setMode(S.mode === 'login' ? 'register' : 'login'); });

  $('#g-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (S.busy) return;
    var u = $('#g-u').value.trim(), p = $('#g-p').value;
    if (!u || !p) { gerr('编号与口令都要填'); return; }
    S.busy = true;
    $('#g-go').disabled = true;
    api('/' + S.mode, { method: 'POST', body: JSON.stringify({ u: u, p: p }) }).then(function (j) {
      S.busy = false;
      $('#g-go').disabled = false;
      if (j.token) {
        S.tok = j.token;
        try { localStorage.setItem(KEY, j.token); } catch (e) {}
        S.seq = 0;
        var feed = $('#l-feed');
        if (feed) feed.innerHTML = '';
        S.nick = j.nick || j.u; S.av = j.av || 0;
        onAuthed(j.u, 0, j);
      } else {
        gerr(j.err || '连接失败');
      }
    }).catch(function () {
      S.busy = false;
      $('#g-go').disabled = false;
      gerr('服务器没有响应');
    });
  });

  $('#l-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('#l-in'), txt = input.value.trim();
    if (!txt) return;
    if (S.offline) { foot('离线模式 · 无法发言'); return; }
    input.value = '';
    api('/chat', { method: 'POST', body: JSON.stringify({ txt: txt }) }).then(function (j) {
      if (j.err) { foot(j.err); return; }
      poll();
    }).catch(function () { foot('发送失败'); });
  });

  $('#l-out').addEventListener('click', function () { logout(); });

  $('#l-go').addEventListener('click', function () {
    document.body.classList.remove('in-hub');
    var b = document.querySelector('[data-act="deploy"]');
    if (!b) { foot('场景还在装载'); return; }
    lobby.classList.remove('on');
    b.click();
  });

  /* 暂停面板补一个「返回大厅」 */
  function hookPaused() {
    var box = document.querySelector('.m-screen[data-s="paused"] .m-actions');
    if (!box || document.getElementById('m-lobby')) return;
    var btn = document.createElement('button');
    btn.className = 'btn';
    btn.id = 'm-lobby';
    btn.type = 'button';
    btn.textContent = '返回大厅';
    btn.addEventListener('click', function () {
      var menu = document.querySelector('.menu');
      if (menu) menu.classList.remove('open');
      try {
        var G = window.__G;
        if (G && G.game && typeof G.game.toTitle === 'function') G.game.toTitle();
        if (G && G.input && typeof G.input.exitLock === 'function') G.input.exitLock();
        else if (document.exitPointerLock) document.exitPointerLock();
      } catch (e) {}
      document.body.classList.add('in-hub');
      lobby.classList.add('on');
      setStat('已连接');
      poll();
    });
    box.appendChild(btn);
  }

  /* ---------------- 启动 ---------------- */
  function whenBooted(cb) {
    var t0 = Date.now();
    (function loop() {
      var b = document.getElementById('boot');
      if ((b && b.classList.contains('done')) || Date.now() - t0 > 20000) { cb(); return; }
      setTimeout(loop, 110);
    })();
  }

  whenBooted(function () {
    document.body.classList.add('in-hub');
    hookPaused();
    try {
      var cq = new URLSearchParams(location.search).get('coop');
      if (cq) {
        var gb = document.getElementById('l-go');
        if (gb) {
          gb.classList.add('coop-hot');
          gb.querySelector('em').textContent = '房间 ' + cq.toUpperCase() + ' · 点此开始';
        }
        setTimeout(function () { foot('已接入房间 ' + cq.toUpperCase() + ' · 点「进入行动」开始'); }, 2600);
      }
    } catch (e) {}
    var saved = '';
    try { saved = localStorage.getItem(KEY) || ''; } catch (e) {}
    if (!saved) { showGate(false); return; }
    S.tok = saved;
    api('/me').then(function (j) {
      if (j && j.u) { onAuthed(j.u, j.online, j); }
      else {
        try { localStorage.removeItem(KEY); } catch (e) {}
        S.tok = '';
        showGate(false);
        if (j && j.err) {
          gerr(j.err);
          if (j.__s === 403) setTimeout(foot.bind(null, j.err), 60);
        }
      }
    }).catch(function () { showGate(true); });
  });

  window.__auth = {
    logout: logout,
    get user() { return S.me; },
    gate: showGate,
    lobby: function () { lobby.classList.add('on'); poll(); }
  };

  /* ---------------- 强制全屏 + 强制横屏 ----------------
     浏览器不允许无用户手势进入全屏，所以把"第一次任意触摸/点击"当作扳机：
     之后每次手势都再推一把，直到 fullscreenElement 真出现为止。 */
  var FULL = ['pointerdown', 'touchstart', 'keydown', 'click'];
  var tries = 0, locked = false;

  function lockNow() {
    try {
      var o = screen.orientation;
      if (o && typeof o.lock === 'function') {
        var p = o.lock('landscape');
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) {}
  }

  function goFull() {
    var el = document.getElementById('app') || document.documentElement;
    var fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (!fn) return false;
    try {
      var r = fn.call(el, { navigationUI: 'hide' });
      if (r && r.then) r.then(lockNow, lockNow); else lockNow();
      return true;
    } catch (e) { return false; }
  }

  function isFull() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
  }

  function kick(ev) {
    var t = ev && ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && document.body.classList.contains('authed') && document.getElementById('cb') && !document.getElementById('cb').classList.contains('on')) return;
    if (locked || isFull()) { lockNow(); return; }
    if (tries >= 8) return;
    tries++;
    goFull();
    setTimeout(function () {
      if (isFull()) { locked = true; lockNow(); }
      else if (tries < 4) goFull();
    }, 280);
  }

  FULL.forEach(function (ev) {
    document.addEventListener(ev, kick, { capture: true, passive: true });
  });

  document.addEventListener('fullscreenchange', function () {
    if (isFull()) { locked = true; lockNow(); setTimeout(lockNow, 350); }
  });
  document.addEventListener('webkitfullscreenchange', function () {
    if (isFull()) { locked = true; lockNow(); }
  });

  /* 进入战斗后再确认一次方向（部分机型要全屏稳定后才允许锁） */
  new MutationObserver(function () {
    if (document.body.classList.contains('in-play')) setTimeout(lockNow, 60);
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  /* ---------------- 公告弹窗 / 关于游戏 ---------------- */
  var AN = { notices: [], about: { title: '关于 Fanwhale', body: '' } };
  var dlgEl = null;
  var LV_C = { info: '#ffb347', warning: '#ffb347', success: '#58d68d', error: '#ff5a40' };
  var LV_T = { info: '公告', warning: '公告', success: '活动', error: '紧急公告' };

  function loadAnnounce() {
    return fetch('/api/announce', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.notices) AN = j; return AN; })
      .catch(function () { return AN; });
  }

  function buildDlg() {
    if (dlgEl) return dlgEl;
    dlgEl = document.createElement('div');
    dlgEl.id = 'dlg';
    dlgEl.innerHTML =
      '<div class="dlg-veil"></div>' +
      '<div class="dlg-card" role="dialog" aria-modal="true">' +
      '<div class="dlg-h"><span class="dlg-tag"></span><h3></h3></div>' +
      '<div class="dlg-b"></div>' +
      '<div class="dlg-f"><button class="btn primary" type="button">知道了</button></div>' +
      '</div>';
    HOST.appendChild(dlgEl);
    dlgEl.querySelector('.dlg-veil').addEventListener('click', closeDlg);
    dlgEl.querySelector('.dlg-f button').addEventListener('click', closeDlg);
    return dlgEl;
  }

  function openDlg(tag, title, body, level) {
    var d = buildDlg();
    d.style.setProperty('--dlg-c', LV_C[level] || LV_C.info);
    d.querySelector('.dlg-tag').textContent = tag || LV_T[level] || '公告';
    d.querySelector('.dlg-h h3').textContent = title || '';
    d.querySelector('.dlg-b').textContent = body || '';
    d.classList.add('on');
  }

  function closeDlg() { if (dlgEl) dlgEl.classList.remove('on'); }

  function showNoticesOnce() {
    loadAnnounce().then(function (j) {
      var list = (j && j.notices) || [];
      if (!list.length) return;
      var top = list[0];
      var seen = '';
      try { seen = localStorage.getItem('saltline.notice.v1') || ''; } catch (e) {}
      if (String(top.updated) === seen) return;
      try { localStorage.setItem('saltline.notice.v1', String(top.updated)); } catch (e) {}
      setTimeout(function () {
        openDlg(LV_T[top.level] || '公告', top.title, top.body, top.level);
      }, 720);
    });
  }

  function mountAbout() {
    var pane = document.querySelector('.panel-b[data-pane="settings"]');
    if (!pane || pane.querySelector('#m-about-row')) return;
    var row = document.createElement('div');
    row.className = 'row';
    row.id = 'm-about-row';
    row.innerHTML = '<label id="l-about">关于</label>' +
      '<button class="btn small" type="button" id="m-about" aria-labelledby="l-about">关于游戏</button>';
    pane.appendChild(row);
    row.querySelector('#m-about').addEventListener('click', function () {
      loadAnnounce().then(function (j) {
        var a = (j && j.about) || {};
        openDlg('关于', a.title || '关于 Fanwhale', a.body || '还没有填写内容。', 'info');
      });
    });
  }

  whenBooted(mountAbout);

  /* ---------------- 头像上传 / 昵称修改 ---------------- */
  function paintAv() {
    var img = document.getElementById('hb-avimg');
    var d = document.querySelector('.hb-avd');
    if (!img) return;
    if (S.av && S.me) {
      img.src = '/api/avatar?u=' + encodeURIComponent(S.me) + '&v=' + S.av;
      img.hidden = false;
      if (d) d.style.display = 'none';
    } else {
      img.hidden = true;
      if (d) d.style.display = '';
    }
  }

  (function () {
    var btn = document.getElementById('hb-av');
    if (!btn) return;
    var file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.style.display = 'none';
    document.body.appendChild(file);

    btn.addEventListener('click', function () { file.click(); });

    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        var im = new Image();
        im.onload = function () {
          var SZ = 160;
          var cv = document.createElement('canvas');
          cv.width = SZ; cv.height = SZ;
          var cx = cv.getContext('2d');
          var sw = Math.min(im.width, im.height) || SZ;
          cx.drawImage(im, (im.width - sw) / 2, (im.height - sw) / 2, sw, sw, 0, 0, SZ, SZ);
          var url = cv.toDataURL('image/jpeg', 0.86);
          foot('正在上传头像…');
          api('/avatar', { method: 'POST', body: JSON.stringify({ img: url }) }).then(function (j) {
            if (j && j.ok) { S.av = j.av; paintAv(); foot('头像已更新'); }
            else foot((j && j.err) || '上传失败');
          }).catch(function () { foot('上传失败'); });
        };
        im.onerror = function () { foot('这张图片读不出来'); };
        im.src = fr.result;
      };
      fr.readAsDataURL(f);
      file.value = '';
    });
  })();

  (function () {
    var nd = document.getElementById('nd');
    var inp = document.getElementById('nd-in');
    var err = document.getElementById('nd-err');
    var me = document.getElementById('l-me');
    if (!nd || !inp || !me) return;

    function close() { nd.classList.remove('on'); err.textContent = ''; }
    function open() {
      inp.value = S.nick || S.me || '';
      err.textContent = '';
      nd.classList.add('on');
      setTimeout(function () { inp.focus(); inp.select(); }, 80);
    }

    me.addEventListener('click', open);
    me.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    document.getElementById('nd-x').addEventListener('click', close);
    document.getElementById('nd-veil').addEventListener('click', close);

    document.getElementById('nd-ok').addEventListener('click', function () {
      var v = inp.value.trim();
      if (!/^[\u4e00-\u9fa5A-Za-z0-9_]{2,16}$/.test(v)) { err.textContent = '2-16 位：中英文、数字、下划线'; return; }
      if (v === S.nick) { close(); return; }
      err.textContent = '';
      api('/nick', { method: 'POST', body: JSON.stringify({ nick: v }) }).then(function (j) {
        if (j && j.ok) {
          S.nick = j.nick;
          $('#l-me').textContent = S.nick;
          $('#s-name').textContent = S.nick;
          close();
          foot('昵称已改为 ' + S.nick);
        } else {
          err.textContent = (j && j.err) || '保存失败';
        }
      }).catch(function () { err.textContent = '网络异常'; });
    });

    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('nd-ok').click(); }
      if (e.key === 'Escape') close();
    });
  })();


  function __tap(sel, fn) {
    var last = 0, lastEl = null;
    function h(ev) {
      var el = ev.target;
      if (!el || !el.closest) return;
      var m = el.closest(sel);
      if (!m) return;
      var now = Date.now();
      if (m === lastEl && now - last < 400) return;
      lastEl = m; last = now;
      fn(m, ev);
    }
    document.addEventListener('pointerdown', h, true);
    document.addEventListener('click', h, true);
    document.addEventListener('touchend', h, true);
  }
  window.__tap = __tap;

  /* 是否跑在外壳 iframe 里 */
  function __embedded() {
    try { return !!(window.parent && window.parent !== window); } catch (e) { return false; }
  }
  window.__embedded = __embedded;

  /* 统一的游戏页地址：外壳内 → /game.html，独立打开 → / */
  function __gamePath() { return __embedded() ? '/game.html' : '/'; }
  window.__gamePath = __gamePath;

  /* 坐标兜底：指针落在按钮矩形内即触发（绕过一切遮挡） */
  function __hit(sel, fn) {
    var last = 0, lastId = null;
    function h(ev) {
      var x = ev.clientX, y = ev.clientY;
      if (!(x > 0 || y > 0)) return;
      /* 有弹窗/菜单打开时不抢 */
      try {
        var ov = document.getElementById('fb');
        if (ov && ov.classList.contains('on')) return;
        if (document.body.classList.contains('in-play')) return;
      } catch (e) {}
      var bs = document.querySelectorAll(sel);
      for (var i = 0; i < bs.length; i++) {
        var b = bs[i], r = b.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          var id = b.getAttribute('data-lv') || b.id || '';
          var now = Date.now();
          if (id === lastId && now - last < 450) return;
          lastId = id; last = now;
          fn(b, ev);
          return;
        }
      }
    }
    document.addEventListener('pointerdown', h, true);
  }
  window.__hit = __hit;

  /* ---------------- 关卡选择 ---------------- */
  (function () {
    var LVL = {
      dock: {
        short: '盐线码头',
        name: '盐线码头 · 4 号泊位',
        desc: '港口的安防网络已经失控。切断它的三条上行链路，然后登上南端爬梯旁的接应船。',
        objs: ['北侧继电器 · 通电中', '西侧继电器 · 通电中', '南侧继电器 · 通电中']
      },
      warehouse: {
        short: '盐仓',
        name: '盐仓 · 3 号货区',
        desc: '盐仓的配电系统还在运转。三条主回路藏在三层货架之间，切断后从南门撤离。',
        objs: ['地面通道回路 · 通电中', '二层走道回路 · 通电中', '屋顶配电回路 · 通电中']
      },
      freighter: {
        short: '盐运七号',
        name: '盐运七号 · 中部甲板',
        desc: '133 米货轮的甲板上，三条主回路分别藏在船头、集装箱阵列与舰桥。切断后回到船头待援。',
        objs: ['船头首楼回路 · 通电中', '集装箱阵列回路 · 通电中', '舰桥配电回路 · 通电中']
      },
      pumpstation: {
        short: '盐泵站',
        name: '盐泵站 · 中央控制楼',
        desc: '输盐管线还在满压运行。三条主回路分布在控制楼、储罐顶与泵房，切断后从南门撤离。',
        objs: ['控制楼主配电 · 通电中', '西侧储罐顶回路 · 通电中', '东南泵房回路 · 通电中']
      }
    };
    var PROG = {};
    var cur = 'dock';
    try { cur = localStorage.getItem('saltline.level') || 'dock'; } catch (e) {}
    try {
      var q = new URLSearchParams(location.search).get('level');
      if (q && LVL[q]) { cur = q; localStorage.setItem('saltline.level', q); }
    } catch (e) {}
    if (!LVL[cur]) cur = 'dock';

    function paint(id) {
      var D = LVL[id] || LVL.dock;
      var n = document.getElementById('lv-name');
      var d = document.getElementById('lv-desc');
      var o = document.getElementById('lv-objs');
      if (n) n.textContent = D.name;
      if (d) d.textContent = D.desc;
      if (o) o.innerHTML = D.objs.map(function (t, k) {
        return '<li><i>' + 'ABC'[k] + '</i>' + t + '</li>';
      }).join('');
      var bs = document.querySelectorAll('#lv-pick button');
      for (var k = 0; k < bs.length; k++) {
        var bid = bs[k].getAttribute('data-lv');
        var pv = PROG[bid];
        var lbl = (LVL[bid] && LVL[bid].short) || bid;
        bs[k].textContent = pv && pv.done ? lbl + ' \u2713' : lbl;
        bs[k].classList.toggle('on', bid === id);
        bs[k].classList.toggle('done', !!(pv && pv.done));
      }
      var ORDER = ['dock', 'warehouse', 'freighter', 'pumpstation'];
      var nDone = 0, nextId = null;
      for (var q = 0; q < ORDER.length; q++) {
        if (PROG[ORDER[q]] && PROG[ORDER[q]].done) nDone++;
        else if (!nextId) nextId = ORDER[q];
      }
      var kEl = document.getElementById('lv-prog');
      if (kEl) kEl.textContent = '战役 ' + nDone + '\u2044' + ORDER.length;
      for (var q2 = 0; q2 < bs.length; q2++) {
        bs[q2].classList.toggle('next', bs[q2].getAttribute('data-lv') === nextId);
      }
    }

    var progLoaded = false;
    function loadProg() {
      if (progLoaded) return;
      if (typeof api !== 'function' || !S || !S.tok) return;
      progLoaded = true;
      api('/progress').then(function (j) {
        if (j && j.progress) { PROG = j.progress; paint(cur); }
      }).catch(function () { progLoaded = false; });
    }
    window.__lvRefresh = function () { progLoaded = false; loadProg(); };

    /* 联机 */
    (function () {
      var inp = document.getElementById('coop-code');
      var go = document.getElementById('coop-go');
      if (!go) return;
      function code6() {
        var A = 'ACDEFGHJKLMNPQRSTUVWXYZ2345679', o = '';
        for (var i = 0; i < 4; i++) o += A[Math.floor(Math.random() * A.length)];
        return o;
      }
      function launchCoop() {
        if (window.__navLock) return;
        window.__navLock = 1;
        /* 联机跳转前记住全屏意愿 */
        try {
          if (document.fullscreenElement || document.webkitFullscreenElement) {
            localStorage.setItem('saltline.wantFull', String(Date.now()));
          }
        } catch (e) {}
        var box = document.getElementById('coop-code');
        var c = (box && box.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        if (!c) c = code6();
        try { sessionStorage.setItem('saltline.coop', c); } catch (e) {}
        try {
          location.href = __gamePath() + '?level=' + encodeURIComponent(cur) + '&coop=' + encodeURIComponent(c) + '&auto=1&t=' + Date.now();
        } catch (e) { window.__navLock = 0; }
      }
      /* 卡片兜底：坐标落进卡片矩形就触发原生 click（任何遮挡都绕开） */
    __hit('#lobby [data-hb]', function (b) {
      try { b.click(); } catch (e) {}
    });

    /* ===== 意见反馈：直连兜底 =====
       不依赖事件委托、不依赖坐标命中，直接在这张卡片上挂三种事件。
       全屏 / iframe / 任何层级问题都绕过去。 */
    (function bindFeedbackDirect() {
      var tries = 0;
      var last = 0;

      function fire(src) {
        var now = Date.now();
        if (now - last < 900) return;          /* 三种事件去重 */
        last = now;
        if (window.__navLock) return;
        window.__navLock = 1;
        try { location.href = '/feedback.html?t=' + Date.now(); }
        catch (e) { window.__navLock = 0; }
      }

      function bind() {
        var b = document.querySelector('#lobby [data-hb="feedback"]');
        if (!b) {
          if (++tries < 40) setTimeout(bind, 250);
          return;
        }
        if (b.__fbBound) return;
        b.__fbBound = 1;
        b.style.touchAction = 'manipulation';
        b.addEventListener('pointerup', function (ev) { ev.preventDefault(); ev.stopPropagation(); fire('pointerup'); }, { passive: false });
        b.addEventListener('touchend', function (ev) { ev.preventDefault(); ev.stopPropagation(); fire('touchend'); }, { passive: false });
        b.addEventListener('click', function (ev) { ev.stopPropagation(); fire('click'); }, false);
        /* 兜底标记：确认真的绑上了 */
        window.__fbBoundCount = (window.__fbBoundCount || 0) + 1;
      }

      bind();
      /* 大厅可能重建，定时补绑 */
      setInterval(function () {
        var b = document.querySelector('#lobby [data-hb="feedback"]');
        if (b && !b.__fbBound) bind();
      }, 1500);
    })();

    __tap('#coop-go', function (m, ev) {
        if (ev.cancelable) ev.preventDefault();
        launchCoop();
      });
      __hit('#coop-go', function (m, ev) {
        if (ev.cancelable) ev.preventDefault();
        launchCoop();
      });
      document.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        var el = ev.target;
        if (el && el.id === 'coop-code') { ev.preventDefault(); launchCoop(); }
      });
    })();
    loadProg();
    var _piv = setInterval(loadProg, 1500);
    setTimeout(function () { clearInterval(_piv); }, 60000);
    paint(cur);

    var wrap = document.getElementById('lv-pick');
    function pickLevel(b) {
      var id = b.getAttribute('data-lv');
      if (!LVL[id]) return;
      if (id === cur) { foot('已经在 ' + LVL[id].name + ' 了'); return; }
      if (window.__navLock) return;          /* 已经在跳转，忽略后续点击 */
      window.__navLock = 1;
      /* 换图前记住全屏意愿，重载后首次点击自动恢复 */
      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          localStorage.setItem('saltline.wantFull', String(Date.now()));
        }
      } catch (e) {}
      try { localStorage.setItem('saltline.level', id); } catch (e) {}
      try { paint(id); } catch (e) {}
      foot('正在装载 ' + LVL[id].name + ' …');
      setTimeout(function () {
        var url = __gamePath() + '?level=' + encodeURIComponent(id) + '&t=' + Date.now();
        try { location.href = url; } catch (e) {
          window.__navLock = 0;
          try { location.reload(); } catch (e2) {}
        }
      }, 320);
    }
    __tap('#lv-pick button[data-lv]', pickLevel);
    __hit('#lv-pick button[data-lv]', pickLevel);
  })();

  window.__announce = { load: loadAnnounce, notice: showNoticesOnce, dialog: openDlg, about: mountAbout };
  /* ---------------- 大厅：聊天面板 / 隐藏原生 title 菜单 ---------------- */
  new MutationObserver(function () {
    document.body.classList.toggle('in-lobby', lobby.classList.contains('on'));
  }).observe(lobby, { attributes: true, attributeFilter: ['class'] });

  (function () {
    var cb = document.getElementById('cb');
    var btn = document.getElementById('cb-open');
    if (!cb || !btn) return;
    function open(v) {
      cb.classList.toggle('on', v);
      if (!v) return;
      S.unread = 0;
      var un = document.getElementById('cb-unread');
      if (un) { un.textContent = '0'; un.classList.remove('on'); }
      var f = $('#l-feed');
      if (f) f.scrollTop = f.scrollHeight;
      setTimeout(function () { var i = $('#l-in'); if (i) i.focus(); }, 60);
    }
    btn.addEventListener('click', function () { open(!cb.classList.contains('on')); });
    var x = document.getElementById('cb-x');
    if (x) x.addEventListener('click', function () { open(false); });
    var v = document.getElementById('cb-veil');
    if (v) v.addEventListener('click', function () { open(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && cb.classList.contains('on')) open(false);
    });
    window.__chat = { open: open };
  })();


  /* ---------------- 大厅：预留入口 + 轻量程序化人物 ---------------- */
  var HB_NAME = {
    role: '角色', contact: '联络人', gun: '改枪', market: '市场', skin: '装扮',
    money: '资源', voice: '语音', friend: '好友', mail: '邮件', quest: '任务',
    stats: '战绩', event: '活动', shop: '商城', season: '赛季', feedback: '意见反馈'
  };

  /* ---------------- 意见反馈 ---------------- */
  (function () {
    var el = document.createElement('div');
    el.id = 'fb';
    el.innerHTML =
      '<div class="fb-veil"></div>' +
      '<div class="fb-card">' +
        '<div class="fb-h"><b>意见反馈</b><span>FEEDBACK</span><button type="button" id="fb-x">×</button></div>' +
        '<div class="fb-list" id="fb-list"></div>' +
        '<div class="fb-form">' +
          '<textarea id="fb-ta" maxlength="600" placeholder="遇到了什么问题，或者有什么建议？说具体一点，我们能更快修掉。"></textarea>' +
          '<div class="fb-foot"><span id="fb-cnt">0 / 600</span><button type="button" id="fb-send">提交</button></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);

    function esc(t) {
      return String(t).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function fmt(ms) {
      try {
        var d = new Date(ms), n = new Date();
        var p = function (x) { return (x < 10 ? '0' : '') + x; };
        var sameDay = d.toDateString() === n.toDateString();
        return (sameDay ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + p(d.getHours()) + ':' + p(d.getMinutes());
      } catch (e) { return ''; }
    }

    function load() {
      var box = document.getElementById('fb-list');
      if (!box) return;
      box.innerHTML = '<p class="fb-empty">加载中…</p>';
      api('/feedback').then(function (j) {
        var list = (j && j.list) || [];
        if (!list.length) { box.innerHTML = '<p class="fb-empty">还没有提交过反馈。<br>你的反馈管理员都能看到并回复。</p>'; return; }
        box.innerHTML = list.map(function (x) {
          return '<div class="fb-item' + (x.reply ? ' done' : '') + '">' +
            '<p class="fb-t">' + esc(x.text) + '</p>' +
            '<div class="fb-meta">' + fmt(x.at) + (x.reply ? '<i>已回复</i>' : '<i class="w">等待回复</i>') + '</div>' +
            (x.reply ? '<div class="fb-re"><b>官方回复</b><p>' + esc(x.reply) + '</p></div>' : '') +
          '</div>';
        }).join('');
      }).catch(function () { box.innerHTML = '<p class="fb-empty">加载失败，稍后再试</p>'; });
    }

    function open() {
      el.classList.add('on');
      var ta = document.getElementById('fb-ta');
      if (ta) setTimeout(function () { try { ta.focus(); } catch (e) {} }, 60);
      load();
    }
    function close() { el.classList.remove('on'); }

    window.__openFb = open;
    window.__closeFb = close;

    el.querySelector('.fb-veil').addEventListener('click', close);
    document.getElementById('fb-x').addEventListener('click', close);

    var ta = document.getElementById('fb-ta');
    var cnt = document.getElementById('fb-cnt');
    if (ta) ta.addEventListener('input', function () {
      cnt.textContent = ta.value.length + ' / 600';
    });

    document.getElementById('fb-send').addEventListener('click', function () {
      var v = (ta.value || '').trim();
      if (v.length < 4) { foot('至少写 4 个字'); return; }
      var btn = this;
      btn.disabled = true;
      api('/feedback', { method: 'POST', body: JSON.stringify({ text: v }) }).then(function (j) {
        btn.disabled = false;
        if (j && j.ok) {
          ta.value = '';
          cnt.textContent = '0 / 600';
          foot('已提交，管理员回复后会显示在这里');
          load();
        } else {
          foot((j && j.err) || '提交失败');
        }
      }).catch(function () { btn.disabled = false; foot('网络异常，稍后再试'); });
    });
  })();

  lobby.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== lobby && !(el.getAttribute && el.getAttribute('data-hb'))) el = el.parentNode;
    if (!el || el === lobby) return;
    var k = el.getAttribute('data-hb');
    if (k === 'notice') { showNoticesOnce(); return; }
    if (k === 'feedback') {
      /* 独立页面，不走弹窗 */
      try {
        if (window.__navLock) return;
        window.__navLock = 1;
        foot('正在打开反馈页 …');
        location.href = '/feedback.html?t=' + Date.now();
      } catch (e) {
        window.__navLock = 0;
        foot('打开失败：' + e.message);
      }
      return;
    }
    if (k === 'settings') {
      var sb = document.querySelector('.m-title [data-act="settings"]') || document.querySelector('[data-act="settings"]');
      if (sb) { sb.click(); return; }
    }
    foot((HB_NAME[k] || '该功能') + ' · 预留入口，稍后开放');
  });

  (function () {
    var ex = $('#hb-expand'), chat = $('#hb-chat');
    if (ex && chat) ex.addEventListener('click', function () {
      chat.classList.toggle('open');
      ex.textContent = chat.classList.contains('open') ? '收起' : '频道';
    });
  })();


})();