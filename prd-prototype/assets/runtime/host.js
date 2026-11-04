/* 已有 HTML 托管：把原有原型放进 iframe，按“进入步骤”到达页面状态，按选择器把元素绑定到功能点。 */
(function () {
  'use strict';
  var W = window.W;
  var H = (W.host = {});
  var cache = {};
  var INTERACTIVE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[onclick],[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=radio],[role=option],[contenteditable=""],[contenteditable="true"],[tabindex]:not([tabindex="-1"])';
  H.INTERACTIVE = INTERACTIVE;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function frames(n) { return new Promise(function (r) { var k = 0; (function t() { if (++k > (n || 2)) r(); else requestAnimationFrame(t); })(); }); }

  H.html = function (endId) {
    if (cache[endId] != null) return cache[endId];
    var el = document.getElementById('prd-host-' + endId);
    if (!el) return null;
    try { cache[endId] = JSON.parse(el.textContent); } catch (e) { cache[endId] = null; }
    return cache[endId];
  };
  H.isHosted = function (p) { return p && typeof p.render !== 'function'; };
  /* 托管原型不能把整个评审页跳走；允许脚本、表单、弹窗和同源访问 */
  H.SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads';
  /* 构建检查时注入：原生对话框不阻塞，记录下来供检查报告使用 */
  var SHIM = '<script>(function(){var l=window.__prdDialogs=[];window.alert=function(m){l.push(["alert",String(m)])};window.confirm=function(m){l.push(["confirm",String(m)]);return true};window.prompt=function(m,d){l.push(["prompt",String(m)]);return d==null?"":d};})();<\/script>';
  H.ignoreEls = function (root, e) {
    var out = [];
    (e.ignore || []).forEach(function (ig, i) {
      var sel = typeof ig === 'string' ? ig : ig.sel;
      var list;
      try { list = H.findAll(root, sel, typeof ig === 'object' ? ig.text : '', true); } catch (x) { list = []; }
      list.forEach(function (el) { out.push({ el: el, ig: typeof ig === 'string' ? { sel: ig } : ig, i: i }); });
    });
    return out;
  };
  H.size = function (e) {
    var m = e.device === 'mobile';
    return { w: e.width || (m ? 375 : 1440), h: e.height || (m ? 812 : 900) };
  };

  H.visible = function (el) {
    if (!el || !el.isConnected) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return false;
    var win = el.ownerDocument.defaultView;
    var cs = win.getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    return el.getClientRects().length > 0;
  };
  function textOf(el) { return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(); }
  H.textOf = textOf;
  function textOk(el, text) { return !text || textOf(el).indexOf(text) >= 0; }

  /* sel 支持普通 CSS；可配合 text 过滤；找不到时报错信息要能看懂 */
  H.findAll = function (root, sel, text, onlyVisible) {
    var list;
    try { list = Array.prototype.slice.call(root.querySelectorAll(sel)); } catch (e) { throw new Error('选择器写法错误：' + sel); }
    if (root.matches && root !== root.ownerDocument && safeMatches(root, sel)) list.unshift(root);
    return list.filter(function (el) { return textOk(el, text) && (!onlyVisible || H.visible(el)); });
  };
  function safeMatches(el, sel) { try { return el.matches(sel); } catch (e) { return false; } }
  H.find = function (root, sel, text) {
    var all = H.findAll(root, sel, text, false);
    return all.find(H.visible) || all[0] || null;
  };

  /* 状态匹配：字符串=可见选择器；对象={ sel, text, hash, js } 全部满足 */
  H.match = function (win, m) {
    if (!m) return false;
    var doc = win.document;
    if (typeof m === 'string') m = { sel: m };
    try {
      if (m.hash != null) {
        var hs = win.location.hash || '';
        if (m.hash instanceof RegExp ? !m.hash.test(hs) : hs !== m.hash) return false;
      }
      if (m.sel && !H.findAll(doc, m.sel, m.text, true).length) return false;
      if (m.js && !(new win.Function('return (' + m.js + ')')).call(win)) return false;
      return true;
    } catch (e) { return false; }
  };
  H.stateMatch = function (p, s) { return s.match || (!s.layer ? p.match : null); };
  /* 弹层状态的根节点：用于只显示最高层的功能点 */
  H.layerRoot = function (doc, p, s) {
    var m = H.stateMatch(p, s);
    if (s && s.layer && m) {
      var sel = typeof m === 'string' ? m : m.sel;
      if (sel) {
        var el = H.findAll(doc, sel, typeof m === 'object' ? m.text : '', true)[0];
        if (el) return el;
      }
    }
    return doc.body;
  };

  function fire(el, type) {
    var win = el.ownerDocument.defaultView;
    var Ev = /^pointer/.test(type) && win.PointerEvent ? win.PointerEvent : win.MouseEvent;
    el.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true, view: win }));
  }
  async function runStep(win, step) {
    var doc = win.document;
    if (typeof step === 'string') step = { js: step };
    if (step.js) {
      var r = (new win.Function(step.js)).call(win);
      if (r && typeof r.then === 'function') await r;
    } else if (step.click) {
      var el = H.find(doc, step.click, step.text);
      if (!el) throw new Error('找不到要点击的元素：' + step.click + (step.text ? '（文字含“' + step.text + '”）' : ''));
      el.scrollIntoView && el.scrollIntoView({ block: 'nearest' });
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (t) { fire(el, t); });
      el.click();
    } else if (step.hover) {
      var hv = H.find(doc, step.hover, step.text);
      if (!hv) throw new Error('找不到要悬停的元素：' + step.hover);
      ['pointerover', 'pointerenter', 'mouseover', 'mouseenter'].forEach(function (t) { fire(hv, t); });
      if (hv.focus) try { hv.focus(); } catch (x) {}
    } else if (step.hash != null) {
      win.location.hash = step.hash;
    } else if (step.input) {
      var inp = H.find(doc, step.input, step.text);
      if (!inp) throw new Error('找不到输入框：' + step.input);
      inp.focus && inp.focus();
      inp.value = step.value == null ? '' : step.value;
      inp.dispatchEvent(new win.Event('input', { bubbles: true }));
      inp.dispatchEvent(new win.Event('change', { bubbles: true }));
    } else if (step.waitFor) {
      var t0 = Date.now();
      while (!H.findAll(doc, step.waitFor, step.text, true).length) {
        if (Date.now() - t0 > (step.timeout || 3000)) throw new Error('等待元素出现超时：' + step.waitFor);
        await sleep(50);
      }
    } else if (step.wait) {
      await sleep(step.wait);
    } else {
      throw new Error('无法识别的进入步骤：' + JSON.stringify(step));
    }
    await sleep(step.after != null ? step.after : 40);
  }
  H.runSteps = async function (win, steps, isStale) {
    for (var i = 0; i < (steps || []).length; i++) {
      if (isStale && isStale()) return false;
      try { await runStep(win, steps[i]); } catch (e) { throw new Error('第 ' + (i + 1) + ' 步：' + (e && e.message || e)); }
    }
    return true;
  };

  H.load = function (iframe, e, opts) {
    var html = H.html(e.id);
    if (html == null) return Promise.reject(new Error('没有找到「' + e.name + '」的托管原型内容'));
    if (opts && opts.shim) html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, function (m) { return m + SHIM; }) : SHIM + html;
    if (iframe.getAttribute('sandbox') !== H.SANDBOX) iframe.setAttribute('sandbox', H.SANDBOX);
    return new Promise(function (res, rej) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; rej(new Error('托管原型加载超时')); } }, 15000);
      iframe.onload = function () { if (done) return; done = true; clearTimeout(t); res(); };
      iframe.srcdoc = html;
    });
  };
  /* 重新加载并进入某个状态；isStale 用于用户连续点击时放弃旧任务 */
  H.enter = async function (iframe, e, p, s, isStale, opts) {
    await H.load(iframe, e, opts);
    if (isStale && isStale()) return false;
    await frames(2);
    var win = iframe.contentWindow;
    if (e.boot) await H.runSteps(win, [].concat(e.boot), isStale);
    var steps = [].concat(p.enter || [], (s && s.enter) || []);
    var ok = await H.runSteps(win, steps, isStale);
    if (!ok) return false;
    await sleep(e.settle != null ? e.settle : 120);
    await frames(2);
    return true;
  };

  /* 元素归属：页面功能点（sel / data-fn）→ 本端公共组件；取最近的祖先 */
  H.fnEls = function (root, f, onlyVisible) {
    var out = [];
    if (f.sel) out = H.findAll(root, f.sel, f.text, onlyVisible);
    H.findAll(root, '[data-fn="' + String(f.id).replace(/"/g, '') + '"]', '', onlyVisible).forEach(function (el) { if (out.indexOf(el) < 0) out.push(el); });
    return out;
  };
  H.owner = function (el, p) {
    var best = null, bestDepth = -1;
    function depthOf(anc) { var d = 0, x = el; while (x && x !== anc) { d++; x = x.parentElement; } return x ? d : -1; }
    function consider(f, shared) {
      var anc = null;
      if (f.sel) {
        try { anc = el.closest(f.sel); } catch (e) { anc = null; }
        if (anc && f.text && !textOk(anc, f.text)) anc = null;
      }
      var df = el.closest('[data-fn="' + String(f.id).replace(/"/g, '') + '"]');
      if (df && (!anc || anc.contains(df))) anc = df;
      if (!anc) return;
      var d = depthOf(anc);
      if (d >= 0 && (bestDepth < 0 || d < bestDepth)) { best = { fn: f, shared: shared, el: anc }; bestDepth = d; }
    }
    (p.fns || []).forEach(function (f) { consider(f, false); });
    W.sharedFns(p.end).forEach(function (x) { consider(x.fn, true); });
    return best;
  };
  H.ignored = function (el, e) {
    return (e.ignore || []).some(function (ig) {
      var sel = typeof ig === 'string' ? ig : ig.sel;
      var anc;
      try { anc = el.closest(sel); } catch (x) { return false; }
      return !!anc && (typeof ig !== 'object' || !ig.text || textOk(anc, ig.text));
    });
  };
  /* 当前画面所有可见的可交互元素（包括 cursor:pointer 的自定义点击区域） */
  H.interactive = function (root) {
    var doc = root.ownerDocument || root;
    var win = doc.defaultView;
    var set = [];
    H.findAll(root, INTERACTIVE, '', false).forEach(function (el) { set.push(el); });
    var all = root.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (set.indexOf(el) >= 0) continue;
      var cs = win.getComputedStyle(el);
      if (cs.cursor !== 'pointer') continue;
      var par = el.parentElement;
      if (par && win.getComputedStyle(par).cursor === 'pointer') continue;
      set.push(el);
    }
    return set.filter(function (el) {
      if (el.tagName === 'LABEL' && el.querySelector('input,select,textarea')) return false;
      if (el.tagName === 'OPTION') return false;
      return H.visible(el);
    });
  };
})();
