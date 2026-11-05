/* 原型需求浏览器：路由、画板缩放、热区、标注圆点、需求面板、需求文档、流程演示、托管原型。 */
(function () {
  'use strict';
  var W = window.W, h = W.h, D = W.doc, HOST = W.host;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  var ui = { zoom: 'fit', last: {}, scale: 1, cur: null, sel: null, visible: {}, docKey: '', enterSeq: 0, hostEnd: null, unknown: false, proto: false };
  var PREF;
  function pref(k, v) {
    try {
      var o = JSON.parse(localStorage.getItem(PREF) || '{}');
      if (v === undefined) return o[k];
      o[k] = v;
      localStorage.setItem(PREF, JSON.stringify(o));
    } catch (e) { return undefined; }
  }

  /* ---------- 启动整理 ---------- */
  function finalize() {
    var P = W.P;
    P.ends = P.ends || [];
    P.groups = P.groups || {};
    P.ends.forEach(function (e) {
      var ids = W.order[e.id] || [];
      var given = P.groups[e.id];
      var groups;
      if (given && given.length) {
        groups = given.map(function (g) { return [g[0], g[1].filter(function (id) { return W.pages[id]; })]; }).filter(function (g) { return g[1].length; });
      } else {
        groups = [];
        ids.forEach(function (id) {
          var gname = W.pages[id].group || '页面';
          var g = groups.find(function (x) { return x[0] === gname; });
          if (!g) groups.push(g = [gname, []]);
          g[1].push(id);
        });
      }
      var listed = {};
      groups.forEach(function (g) { g[1].forEach(function (id) { listed[id] = 1; }); });
      var rest = ids.filter(function (id) { return !listed[id]; });
      if (rest.length) groups.push(['其他', rest]);
      P.groups[e.id] = groups;
      ui.last[e.id] = e.home && W.pages[e.home] ? e.home : ids[0];
    });
    if (!P.releases || !P.releases.length) P.releases = [{ id: P.version || 'V1.0', date: P.date || '' }];
    D.inheritChanges();
    try { var a = document.getElementById('prd-audit'); W.audit = a && a.textContent.trim() ? JSON.parse(a.textContent) : null; } catch (e) { W.audit = null; }
    W.behaveApply(W.audit);
    PREF = 'prd-viewer:' + (P.id || P.name);
    /* 原型阶段：打开即原型，没有需求文档栏目、需求面板、需求按钮，圆点默认隐藏且不记住偏好 */
    ui.proto = P.stage === 'prototype';
  }
  function protoHome() { return ui.last[W.P.ends[0].id]; }

  /* ---------- 路由 ---------- */
  function parse() {
    var raw = location.hash.replace(/^#\/?/, '');
    var q = {}, qi = raw.indexOf('?');
    if (qi >= 0) {
      raw.slice(qi + 1).split('&').forEach(function (x) {
        if (!x) return;
        var kv = x.split('=');
        q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
      });
      raw = raw.slice(0, qi);
    }
    var parts = raw.split('/').filter(Boolean).map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
    if (parts[0] === 'p' && parts[1] && W.pages[parts[1]]) return { view: 'page', id: parts[1], st: parts[2] || '', q: q };
    if (parts[0] === 'flow') return { view: 'flow', q: q };
    if (parts[0] === 'end' && W.end(parts[1])) return { view: 'page', id: ui.last[parts[1]], st: '', q: q };
    /* 原型阶段没有需求文档，#/doc 和空路由都回到第一个端的首页 */
    if (ui.proto) return { view: 'page', id: protoHome(), st: '', q: q };
    if (parts[0] === 'doc') return { view: 'doc', anchor: parts[1] || '', q: q };
    return { view: 'doc', anchor: '', q: q };
  }
  function hashFor(id, st, q) {
    var s = '#/p/' + id + (st ? '/' + encodeURIComponent(st) : '');
    var qs = Object.keys(q || {}).filter(function (k) { return q[k] !== undefined && q[k] !== '' && q[k] !== null; })
      .map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&');
    return s + (qs ? '?' + qs : '');
  }
  W.hashFor = hashFor;
  function stOf(id, st) {
    var p = W.pages[id];
    if (!p) return st || '';
    if (st && p.states.some(function (s) { return s.id === st; })) return st;
    return p.states[0] ? p.states[0].id : '';
  }
  function stateObj(p, st) { return p.states.find(function (s) { return s.id === st; }) || null; }
  function flowById(id) { return (W.P.flows || []).find(function (f) { return f.id === id; }); }
  function sameStep(s, id, st) { return s.p === id && stOf(s.p, s.st) === stOf(id, st); }
  function matchStep(f, i, id, st) {
    if (f.steps[i + 1] && sameStep(f.steps[i + 1], id, st)) return i + 1;
    if (f.steps[i] && sameStep(f.steps[i], id, st)) return i;
    for (var j = i + 1; j < f.steps.length; j++) if (sameStep(f.steps[j], id, st)) return j;
    for (j = 0; j < i; j++) if (sameStep(f.steps[j], id, st)) return j;
    return i;
  }
  function flowQ(id, st) {
    var r = parse(), q = {};
    if (r.q.f && flowById(r.q.f)) {
      var f = flowById(r.q.f);
      q.f = f.id;
      q.i = matchStep(f, +r.q.i || 0, id, st);
    }
    return q;
  }
  function nav(id, st, set, extra) {
    if (id === 'back') { history.back(); return; }
    if (!W.pages[id]) { toast('页面「' + id + '」不存在'); return; }
    /* 先应用目标状态的数据，再应用按钮上的 data-set：按钮的意图更具体，优先 */
    var so = stateObj(W.pages[id], stOf(id, st));
    if (so && so.set) W.applySet(so.set);
    if (set) W.applySet(set);
    ui.navKey = id + '|' + stOf(id, st);
    var q = flowQ(id, st);
    if (extra) Object.keys(extra).forEach(function (k) { q[k] = extra[k]; });
    var target = hashFor(id, st, q);
    if (target === location.hash) render(); else location.hash = target;
  }
  W.nav = nav;
  function goStep(fid, j) {
    var f = flowById(fid);
    if (!f) return;
    j = Math.max(0, Math.min(f.steps.length - 1, j));
    if (j === 0 && f.preset) W.applySet('preset=' + f.preset);
    if (f.set && j === 0) W.applySet(f.set);
    for (var k = 0; k <= j; k++) if (f.steps[k].set) W.applySet(f.steps[k].set);
    var s = f.steps[j];
    var so = stateObj(W.pages[s.p], stOf(s.p, s.st));
    if (so && so.set) W.applySet(so.set);
    for (var k2 = 0; k2 <= j; k2++) if (k2 === j && f.steps[k2].set) W.applySet(f.steps[k2].set);
    ui.navKey = s.p + '|' + stOf(s.p, s.st);
    location.hash = hashFor(s.p, s.st, { f: fid, i: j });
  }
  W.goStep = goStep;

  /* ---------- 顶栏 ---------- */
  function renderTop() {
    var P = W.P;
    var tabs = (ui.proto ? '' : '<a data-tab="doc">需求文档</a>') + P.ends.map(function (e) { return '<a data-tab="' + h.esc(e.id) + '">' + h.esc(e.name) + '</a>'; }).join('') + ((P.flows || []).length ? '<a data-tab="flow">核心流程</a>' : '');
    var a = W.audit, badge = '';
    if (a && ui.proto) {
      badge = '<span class="audit-badge ' + (a.ok ? 'ok' : 'bad') + '" style="cursor:default" title="构建检查时间：' + D.localTime(a.at) + '">' + (a.ok ? '原型阶段 · 检查通过' : '原型阶段 · 检查未通过') + '</span>';
    } else if (a) {
      var st0 = D.stats();
      var parts = [];
      if (st0.pending) parts.push('待确认 ' + st0.pending);
      if (st0.assumed) parts.push('AI 假设 ' + st0.assumed);
      if (a.needOnline) parts.unshift('需联网');
      badge = '<a class="audit-badge ' + (a.ok ? 'ok' : 'bad') + '" href="#/doc" title="构建检查时间：' + D.localTime(a.at) + '">' + (a.ok ? '检查通过' : '检查未通过') + (parts.length ? ' · ' + parts.join(' · ') : '') + '</a>';
    }
    $('#top').innerHTML = '<a class="brand" data-tab="doc"><span class="brand-m">' + h.esc((P.name || '原')[0]) + '</span><span class="t">' + h.esc(P.name || '') + '</span><small>' + h.esc([D.cur(), P.date, P.fidelity || '低保真'].filter(Boolean).join(' · ')) + '</small></a>' +
      '<nav class="vtabs">' + tabs + '</nav>' +
      '<div class="vtools">' + badge +
      '<button class="vbtn" data-tool="hot" title="显示画板中所有可点击区域">热区 <kbd>H</kbd></button>' +
      '<button class="vbtn" data-tool="dots" title="显示或隐藏功能点标注圆点">标注 <kbd>N</kbd></button>' +
      (D.multiRelease() ? '<button class="vbtn chg" data-tool="chg" title="只看 ' + h.esc(D.cur()) + ' 新增、修改、移除的功能点">本版变化</button>' : '') +
      '<button class="vbtn" data-tool="zoom" id="zoomBtn"><span class="lb">适应窗口</span></button>' +
      '<button class="vbtn" data-tool="left"><span class="lb">目录</span></button>' +
      (ui.proto ? '' : '<button class="vbtn" data-tool="right"><span class="lb">需求</span></button>') +
      (W.presets().length || Object.keys(W.P.demo || {}).length || P.ends.some(function (e) { return e.resetKeys; }) ? '<button class="vbtn" data-tool="reset" title="把演示数据恢复为默认"><span class="lb">重置演示数据</span></button>' : '') +
      '</div>';
  }
  function setTab(tab) { $$('.vtabs a').forEach(function (a) { a.classList.toggle('on', a.dataset.tab === tab); }); }
  function syncTools() {
    var narrow = innerWidth <= 1100, B = document.body.classList;
    var l = $('[data-tool="left"]'), r = $('[data-tool="right"]');
    if (l) l.classList.toggle('on', narrow ? B.contains('m-l') : !B.contains('no-l'));
    if (r) r.classList.toggle('on', narrow ? B.contains('m-r') : !B.contains('no-r'));
    var d = $('[data-tool="dots"]');
    if (d) d.classList.toggle('on', !B.contains('no-dots'));
    var c = $('[data-tool="chg"]');
    if (c) c.classList.toggle('on', B.contains('chg-on'));
    var hot = $('[data-tool="hot"]');
    if (hot) hot.classList.toggle('on', B.contains('hot'));
  }

  /* ---------- 主渲染 ---------- */
  function render(o) {
    o = o || {};
    var r = parse();
    document.body.classList.remove('m-l', 'm-r');
    if (r.view === 'doc') return renderDoc(r);
    if (r.view === 'flow') return renderFlowIndex(r);
    var p = W.pages[r.id];
    var st = stOf(r.id, r.st);
    var flow = r.q.f ? flowById(r.q.f) : null;
    /* 直接打开链接、刷新或前进后退进入某个状态时，也应用该状态的演示数据（经 nav 进入的已应用过） */
    var key = p.id + '|' + st;
    if (key !== ui.lastKey && key !== ui.navKey && !o.fromDetect && !o.keepSel) {
      var so0 = stateObj(p, st);
      if (so0 && so0.set) W.applySet(so0.set);
    }
    ui.navKey = null;
    ui.lastKey = key;
    document.body.classList.toggle('flow-on', !!flow);
    setTab(flow ? 'flow' : p.end);
    ui.last[p.end] = p.id;
    ui.cur = { p: p, st: st, flow: flow, q: r.q };
    ui.docKey = '';
    ui.unknown = false;
    if (!o.keepSel) ui.sel = r.q.fn || null;
    var paintNow = HOST.isHosted(p) ? renderHosted(p, st, o.fromDetect) : (renderNative(p, st, r.q), true);
    renderLeft(p.end, r, flow);
    if (!ui.proto) renderRight(p, st);
    renderFlowbar(r, flow);
    if (paintNow) afterPaint();
  }
  W.render = render;

  function devHTML(e, inner, url) {
    var m = e.device === 'mobile';
    if (m) return '<div class="dev dev-m" id="dev" data-end="' + h.esc(e.id) + '"><div class="scr" id="scr">' + inner + '<div id="dots"></div></div></div>';
    return '<div class="dev dev-pc" id="dev" data-end="' + h.esc(e.id) + '"><div class="dev-bar"><i></i><i></i><i></i><span class="url">' + h.esc(url || e.url || '演示地址') + '</span></div><div class="scr" id="scr">' + inner + '<div id="dots"></div></div></div>';
  }
  function capHTML(p, st) {
    var so = stateObj(p, st);
    return '<b>' + h.esc(p.id + ' ' + p.title) + '</b>' + (so ? ' · 状态：' + h.esc(so.label) : '') +
      (ui.unknown ? ' · <span class="unk">当前画面未在需求中登记</span>' : '') +
      '<span class="demo">' + h.esc(W.P.demoNote || '画面中的数据均为演示数据') + '</span>';
  }
  function renderNative(p, st, q) {
    var e = W.end(p.end);
    var ctx = { st: st, s: W.store, p: p, q: q || {}, end: e };
    var html;
    /* 组件扩展（如规范包 theme-kit.js）按这个值判断当前端，手机端走原有实现 */
    W.device = e.device === 'mobile' ? 'mobile' : 'pc';
    try { html = p.render(ctx); } catch (err) {
      console.error(err);
      html = '<div style="padding:40px;color:#c4322a">渲染出错：' + h.esc(err.message) + '</div>';
    }
    ui.hostEnd = null;
    var device = e.device === 'mobile' ? 'mobile' : 'pc';
    $('#stage-in').innerHTML = '<div id="devwrap">' + devHTML(e, '<div class="ab" id="ab" data-device="' + device + '">' + html + '</div>') + '</div><div class="cap">' + capHTML(p, st) + '</div>';
    fit();
    var ab = $('#ab');
    $$('.body,.pane,.m-body,.drw-b', ab).forEach(function (el) { el.scrollTop = 0; });
    if (p.after) { try { p.after(ab, ctx); } catch (err) { console.error(err); } }
  }

  /* 托管原型：同一端复用 iframe，切换页面状态时重新进入 */
  function renderHosted(p, st, fromDetect) {
    var e = W.end(p.end);
    var frame = $('#hostf');
    if (!frame || ui.hostEnd !== e.id) {
      $('#stage-in').innerHTML = '<div id="devwrap">' + devHTML(e, '<iframe id="hostf" sandbox="' + HOST.SANDBOX + '" title="' + h.esc(e.name) + '原型"></iframe>') + '</div><div class="cap">' + capHTML(p, st) + '</div>';
      ui.hostEnd = e.id;
      frame = $('#hostf');
      fit();
      fromDetect = false;
    } else {
      $('.cap').innerHTML = capHTML(p, st);
    }
    if (fromDetect) return true;
    var seq = ++ui.enterSeq;
    $('#dots').innerHTML = '';
    HOST.enter(frame, e, p, stateObj(p, st), function () { return seq !== ui.enterSeq; }).then(function (ok) {
      if (!ok || seq !== ui.enterSeq) return;
      hookFrame(frame);
      afterPaint();
    }).catch(function (err) {
      if (seq !== ui.enterSeq) return;
      $('.cap').innerHTML = capHTML(p, st) + '<div style="color:#c4322a;margin-top:6px">进入该状态失败：' + h.esc(err.message) + '</div>';
      hookFrame(frame);
      afterPaint();
    });
    return false;
  }
  var HOT_CSS = 'html.prd-hot a[href],html.prd-hot button,html.prd-hot input,html.prd-hot select,html.prd-hot textarea,html.prd-hot [onclick],html.prd-hot [role=button],html.prd-hot [role=tab],html.prd-hot [data-fn]{outline:2px solid rgba(47,91,234,.6)!important;outline-offset:1px}';
  function hookFrame(frame) {
    var doc = frame.contentDocument, win = frame.contentWindow;
    if (!doc || doc.__prdHooked) return;
    doc.__prdHooked = true;
    var st = doc.createElement('style');
    st.textContent = HOT_CSS;
    (doc.head || doc.documentElement).appendChild(st);
    doc.documentElement.classList.toggle('prd-hot', document.body.classList.contains('hot'));
    var t1, t2;
    function later() {
      clearTimeout(t1);
      t1 = setTimeout(detect, 140);
    }
    doc.addEventListener('click', later, true);
    doc.addEventListener('keyup', later, true);
    doc.addEventListener('scroll', function () { clearTimeout(t2); t2 = setTimeout(placeDots, 30); }, true);
    win.addEventListener('hashchange', later);
    try {
      new win.MutationObserver(later).observe(doc.body || doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden'] });
    } catch (e) {}
    doc.addEventListener('keydown', function (ev) {
      if (ev.target.closest && ev.target.closest('input,textarea,select,[contenteditable]')) return;
      onKey(ev);
    });
  }
  /* 托管原型内点击后，识别当前画面属于哪个页面状态 */
  function detect() {
    var frame = $('#hostf');
    if (!frame || !ui.cur) return;
    var win = frame.contentWindow, e = W.end(ui.hostEnd);
    if (!win || !e) return;
    var best = null, score = -1;
    (W.order[e.id] || []).forEach(function (id) {
      var p = W.pages[id];
      if (!HOST.isHosted(p)) return;
      p.states.forEach(function (s, i) {
        var m = HOST.stateMatch(p, s);
        if (!m || !HOST.match(win, m)) return;
        var sc = (s.layer ? 1000 : 0) + (p.id === ui.cur.p.id ? 100 : 0) + (s.id === ui.cur.st ? 10 : 0) + (s.match ? 5 : 0) - i * 0.01;
        if (sc > score) { score = sc; best = { p: p, s: s }; }
      });
    });
    if (best && (best.p.id !== ui.cur.p.id || best.s.id !== ui.cur.st)) {
      history.replaceState(null, '', hashFor(best.p.id, best.s.id, flowQ(best.p.id, best.s.id)));
      render({ fromDetect: true });
      return;
    }
    var wasUnknown = ui.unknown;
    ui.unknown = !best;
    if (wasUnknown !== ui.unknown) $('.cap').innerHTML = capHTML(ui.cur.p, ui.cur.st);
    afterPaint();
  }

  /* ---------- 标注圆点 ---------- */
  var LAYER_ORDER = ['drawer', 'sheet', 'modal', 'popover', 'alert'];
  function topLayer(root) {
    var ls = $$('[data-layer]', root);
    if (!ls.length) return null;
    ls.sort(function (a, b) { return LAYER_ORDER.indexOf(a.dataset.layer) - LAYER_ORDER.indexOf(b.dataset.layer); });
    return ls[ls.length - 1];
  }
  function isVis(el) {
    if (!el || !el.isConnected) return false;
    var r = el.getClientRects();
    if (!r.length) return false;
    var cs = el.ownerDocument.defaultView.getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }
  function chgOn() { return document.body.classList.contains('chg-on'); }
  /* 返回当前画面中每个功能点的可见元素 */
  function currentEls() {
    var c = ui.cur;
    if (!c) return { list: [], ctx: null };
    var p = c.p, out = [];
    var shared = W.sharedFns(p.end).map(function (x) { return x.fn; });
    if (HOST.isHosted(p)) {
      var frame = $('#hostf');
      var doc = frame && frame.contentDocument;
      if (!doc || !doc.body) return { list: [], ctx: null };
      var root = HOST.layerRoot(doc, p, stateObj(p, c.st));
      p.fns.forEach(function (f, i) { if (!D.removed(f)) { var els = HOST.fnEls(root, f, true); if (els.length) out.push({ f: f, i: i, els: els }); } });
      shared.forEach(function (f, i) { if (!D.removed(f)) { var els = HOST.fnEls(root, f, true); if (els.length) out.push({ f: f, i: i, els: els, shared: true }); } });
      return { list: out, ctx: { hosted: true } };
    }
    var ab = $('#ab');
    if (!ab) return { list: [], ctx: null };
    var top = topLayer(ab) || ab;
    function els(f) { return $$('[data-fn="' + String(f.id).replace(/"/g, '') + '"]', top).filter(isVis); }
    p.fns.forEach(function (f, i) { if (!D.removed(f)) { var e = els(f); if (e.length) out.push({ f: f, i: i, els: e }); } });
    shared.forEach(function (f, i) { if (!D.removed(f)) { var e = els(f); if (e.length) out.push({ f: f, i: i, els: e, shared: true }); } });
    return { list: out, ctx: { hosted: false } };
  }
  function rectIn(el, hosted) {
    var r = el.getBoundingClientRect();
    if (hosted) return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    var sr = $('#scr').getBoundingClientRect(), s = ui.scale || 1;
    return { l: (r.left - sr.left) / s, t: (r.top - sr.top) / s, r: (r.right - sr.left) / s, b: (r.bottom - sr.top) / s };
  }
  function placeDots() {
    var box = $('#dots'), scr = $('#scr');
    if (!box || !scr) return;
    var res = currentEls();
    ui.visible = {};
    res.list.forEach(function (x) { ui.visible[(x.shared ? 'S:' : '') + x.f.id] = true; });
    syncCards();
    var hosted = res.ctx && res.ctx.hosted;
    var sw = scr.offsetWidth, sh = scr.offsetHeight;
    var placed = [], html = '';
    var only = chgOn(), showShared = pref('sharedDots');
    res.list.forEach(function (x) {
      if (x.shared && !showShared) return;
      var c = D.chg(x.f);
      if (only && !c) return;
      var el = x.els[0];
      var r = rectIn(el, hosted);
      if (r.b < 0 || r.t > sh || r.r < 0 || r.l > sw) return;
      /* 默认放在元素右上角外侧，尽量不压住文字；dot 可写 0–1 之外的值把圆点放到元素外 */
      var pos = x.f.dot;
      var px, py;
      if (pos) { px = r.l + (r.r - r.l) * pos[0]; py = r.t + (r.b - r.t) * pos[1]; }
      else { px = r.r + 2; py = r.t - 2; }
      px = Math.max(12, Math.min(sw - 12, px));
      py = Math.max(12, Math.min(sh - 12, py));
      for (var k = 0; k < 6; k++) {
        if (!placed.some(function (q) { return Math.abs(q[0] - px) < 20 && Math.abs(q[1] - py) < 20; })) break;
        px = Math.max(12, px - 22);
      }
      placed.push([px, py]);
      var st = D.status(x.f);
      var cls = 'fdot' + (st !== 'confirmed' ? ' st-' + st : '') + (c && (only || D.multiRelease()) ? ' v-' + (c.type === 'added' ? 'add' : 'mod') : '') + (ui.sel === x.f.id ? ' on' : '');
      var key = (x.shared ? 'S:' : '') + x.f.id;
      html += '<span class="' + cls + '" data-fdot="' + h.esc(key) + '" style="left:' + px.toFixed(1) + 'px;top:' + py.toFixed(1) + 'px" title="' + h.esc(x.f.name) + '">' + (x.shared ? D.letter(x.i) : x.i + 1) + '</span>';
    });
    /* 托管原型里“有但不纳入本次需求”的元素：虚线框出，每条规则最多标 3 处，避免评审误以为要做 */
    if (hosted && ui.cur) {
      var e = W.end(ui.cur.p.end), fd = $('#hostf').contentDocument;
      var lroot = HOST.layerRoot(fd, ui.cur.p, stateObj(ui.cur.p, ui.cur.st));
      var per = {};
      HOST.ignoreEls(lroot, e).forEach(function (x) {
        per[x.i] = (per[x.i] || 0) + 1;
        if (per[x.i] > 3) return;
        var r = rectIn(x.el, true);
        if (r.b < 0 || r.t > sh || r.r < 0 || r.l > sw) return;
        var l = Math.max(0, r.l), t = Math.max(0, r.t), w = Math.min(sw, r.r) - l, hh = Math.min(sh, r.b) - t;
        var tip = h.esc((x.ig.name ? x.ig.name + '：' : '') + (x.ig.why || ''));
        var lb = x.ig.label || '本期不做';
        /* 小元素放不下文字标签时只画虚线框和角标，避免盖住原型内容；悬停可看原因 */
        var small = w < lb.length * 12 + 24 || hh < 22;
        html += '<span class="xbox' + (small ? ' sm' : '') + '" style="left:' + l.toFixed(1) + 'px;top:' + t.toFixed(1) + 'px;width:' + w.toFixed(1) + 'px;height:' + hh.toFixed(1) + 'px" title="' + h.esc(lb) + (tip ? '：' + tip : '') + '"><i>' + (small ? '✕' : h.esc(lb)) + '</i></span>';
      });
    }
    box.style.setProperty('--inv', String(1 / (ui.scale || 1)));
    box.innerHTML = html;
    $$('.fdot,.xbox i', box).forEach(function (d) { d.style.transform = 'scale(' + (1 / (ui.scale || 1)).toFixed(3) + ')'; });
    if (ui.hl) drawBoxes(ui.hl);
  }
  var pdT;
  function placeDotsSoon() { clearTimeout(pdT); pdT = setTimeout(placeDots, 40); }
  function afterPaint() {
    placeDots();
    setTimeout(placeDots, 260);
    setTimeout(placeDots, 900);
    if (ui.sel) setTimeout(function () { selectFn(ui.sel, true); }, 60);
  }
  function drawBoxes(key) {
    var box = $('#dots');
    if (!box) return;
    $$('.fbox', box).forEach(function (x) { x.remove(); });
    if (!key) return;
    var res = currentEls();
    var x = res.list.find(function (y) { return (y.shared ? 'S:' : '') + y.f.id === key; });
    if (!x) return;
    x.els.slice(0, 30).forEach(function (el) {
      var r = rectIn(el, res.ctx.hosted);
      var b = document.createElement('div');
      b.className = 'fbox';
      b.style.cssText = 'left:' + (r.l - 3) + 'px;top:' + (r.t - 3) + 'px;width:' + (r.r - r.l + 6) + 'px;height:' + (r.b - r.t + 6) + 'px';
      box.insertBefore(b, box.firstChild);
    });
  }
  function selectFn(key, scroll) {
    ui.sel = key;
    $$('.fc').forEach(function (c) { c.classList.toggle('on', c.dataset.fid === key); });
    $$('.fdot').forEach(function (d) { d.classList.toggle('on', d.dataset.fdot === key); });
    var card = $('.fc[data-fid="' + String(key).replace(/"/g, '') + '"]');
    if (card) {
      card.classList.remove('fold');
      if (scroll) {
        if (!ui.proto && innerWidth > 1100 && document.body.classList.contains('no-r')) { document.body.classList.remove('no-r'); setTimeout(fit, 220); syncTools(); }
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
    ui.hl = key;
    drawBoxes(key);
    clearTimeout(ui.hlT);
    ui.hlT = setTimeout(function () { ui.hl = null; drawBoxes(null); }, 1600);
  }

  /* ---------- 左侧目录 ---------- */
  function renderLeft(tab, r, flow) {
    var L = $('#left');
    if (tab === 'flow' || flow) {
      var cur = flow ? flow.id : null, ci = r && r.q ? +r.q.i || 0 : 0;
      L.innerHTML = '<div class="nv-head">点击流程开始演示；演示中直接点画板里的按钮也会前进，键盘 ← → 切换步骤。</div>' + (W.P.flows || []).map(function (f) {
        var on = f.id === cur;
        var steps = on ? '<div class="fl-s">' + f.steps.map(function (s, i) {
          var pg = W.pages[s.p];
          return '<a class="' + (i === ci ? 'on' : i < ci ? 'past' : '') + '" data-step="' + h.esc(f.id + '|' + i) + '"><i>' + (i + 1) + '</i><span>' + h.esc(s.p + ' ' + (s.label || (pg && pg.title) || '')) + '</span></a>';
        }).join('') + '</div>' : '';
        return '<div class="fl ' + (on ? 'on' : '') + '"><a class="fl-h" data-step="' + h.esc(f.id) + '|0"><b>' + h.esc(f.name) + '</b><span>' + f.steps.length + ' 步' + (f.ends ? ' · ' + h.esc(f.ends) : '') + '</span></a>' + steps + '</div>';
      }).join('');
      return;
    }
    var e = W.end(tab);
    var only = chgOn();
    L.innerHTML = '<div class="nv-head">' + h.esc(e.name) + ' · ' + (W.order[e.id] || []).length + ' 个页面' + (only ? ' · 圆点表示本版有变化' : '') + '</div>' + W.P.groups[e.id].map(function (g) {
      return '<div class="nv-g"><h4>' + h.esc(g[0]) + '</h4>' + g[1].map(function (id) {
        var p = W.pages[id];
        var pc = D.chg(p), mark = '';
        if (pc) mark = '<span class="vm ' + (pc.type === 'added' ? 'add' : pc.type === 'removed' ? 'del' : 'mod') + '"></span>';
        else if (D.pageChanged(p)) mark = '<span class="vm mod"></span>';
        return '<a class="nv-i ' + (r && r.id === id ? 'on' : '') + '" href="' + hashFor(id) + '"><code>' + h.esc(id) + '</code><span>' + h.esc(p.title) + '</span>' + (D.multiRelease() ? mark : '') + '<span class="c" title="状态数">' + p.states.length + '</span></a>';
      }).join('') + '</div>';
    }).join('');
  }

  /* ---------- 右侧需求面板 ---------- */
  function cardHTML(f, i, p, states, shared) {
    var key = (shared ? 'S:' : '') + f.id;
    var st = D.status(f);
    var removed = D.removed(f);
    var n = shared ? D.letter(i) : i + 1;
    return '<div class="fc' + (removed ? ' removed fold' : '') + '" data-fid="' + h.esc(key) + '"><div class="fc-h" data-fc="' + h.esc(key) + '"><span class="n' + (shared ? ' sh' : st !== 'confirmed' ? ' st-' + st : '') + '">' + n + '</span><b>' + h.esc(f.name) + '<span class="fid">' + h.esc(f.id) + '</span> ' + D.badgeHTML(f, D.multiRelease() ? D.cur() : '__none__') + (f.ui === false ? '<span class="bdg ui">无界面</span>' : '') + '</b></div>' +
      '<div class="fc-b">' + D.fnBodyHTML(f, p, { states: states, ver: D.multiRelease() ? D.cur() : '__none__', showRemoved: chgOn() }) + '</div></div>';
  }
  function renderRight(p, st) {
    var e = W.end(p.end), md = W.md, only = chgOn();
    var so = stateObj(p, st);
    var fs = D.fnStates(p) || {};
    var s = '<div class="np"><div class="np-id">' + h.esc(p.id) + ' · ' + h.esc(e.name) + D.badgeHTML(p, D.multiRelease() ? D.cur() : '__none__') + '</div><h2>' + h.esc(p.title) + '</h2>' +
      (p.goal ? '<p class="goal">' + md.inline(p.goal) + '</p>' : '') +
      (p.entry ? '<div class="meta"><b>入口与前置：</b>' + md.inline(p.entry) + '</div>' : '') +
      (p.perm ? '<div class="meta"><b>角色权限：</b>' + md.inline(p.perm) + '</div>' : '');
    if (p.states.length) {
      s += '<div class="np-sec"><h3>页面状态<span>' + p.states.length + ' 个</span></h3><div class="chips">' + p.states.map(function (x) {
        return '<a class="chip ' + (x.id === st ? 'on' : '') + '" data-nav="' + h.esc(p.id + '|' + x.id) + '">' + h.esc(x.label) + '</a>';
      }).join('') + '</div>' + (so && so.when ? '<div class="when"><b>出现条件</b>：' + md.inline(so.when) + '</div>' : '') + '</div>';
    }
    if (p.scenarios && W.presets().length) {
      var pid = W.presetId();
      s += '<div class="np-sec"><h3>' + h.esc((W.P.scenarios && W.P.scenarios.label) || '演示数据') + '<span>全局，跨页面生效</span></h3><div class="chips">' + W.presets().map(function (x) {
        return '<a class="chip ' + (x.id === pid ? 'on' : '') + '" data-preset="' + h.esc(x.id) + '">' + h.esc(x.label) + '</a>';
      }).join('') + '</div></div>';
    }
    var fns = p.fns.filter(function (f) { return only || !D.removed(f); });
    var cnt = only ? fns.filter(function (f) { return D.chg(f); }).length : fns.length;
    s += '<div class="np-sec"><h3>功能点<span class="r"><span>' + (only ? '本版变化 ' : '') + cnt + ' 个</span><span class="mini-sw' + (document.body.classList.contains('no-dots') ? '' : ' on') + '" data-tool="dots" title="显示或隐藏标注圆点"><i></i>圆点</span></span></h3>';
    s += fns.length ? fns.map(function (f) { return cardHTML(f, p.fns.indexOf(f), p, fs[f.id], false); }).join('') : '<p class="hintline">本页没有功能点。</p>';
    s += '<div class="legend"><span><i></i>已确认</span><span><i class="p"></i>待确认</span><span><i class="a"></i>AI 假设</span>' + (D.multiRelease() ? '<span><i class="add"></i>本版新增</span><span><i class="mod"></i>本版修改</span>' : '') + '</div></div>';
    var pr = D.items(p.rules).filter(function (x) { return only ? D.chg(x) : !D.removed(x); });
    if (pr.length) s += '<div class="np-sec"><h3>页面规则</h3><ul>' + pr.map(function (x) { return '<li>' + md.inline(x.text) + D.badgeHTML(x, D.multiRelease() ? D.cur() : '__none__') + '</li>'; }).join('') + '</ul></div>';
    if (p.todo && p.todo.length) s += '<div class="np-sec"><h3>待确认</h3><ul>' + p.todo.map(function (t) { return '<li>' + md.inline(typeof t === 'string' ? t : t.text) + ' <span class="bdg pending">待确认</span></li>'; }).join('') + '</ul></div>';
    var links = W.audit && W.audit.links ? W.audit.links[p.id] : null;
    if (links && links.length) {
      s += '<div class="np-sec"><h3>从这些地方进入</h3><div class="lk">' + links.slice(0, 12).map(function (x) {
        var fp = W.pages[x.from];
        return '<a data-nav="' + h.esc(x.from + '|' + (x.fromSt || '')) + '"><code>' + h.esc(x.from) + '</code><span>' + h.esc((fp ? fp.title : '') + '「' + x.label + '」') + (x.st ? ' → ' + h.esc(D.stateLabel(p, x.st)) : '') + '</span></a>';
      }).join('') + '</div></div>';
    }
    if (!HOST.isHosted(p)) s += '<div class="np-sec"><h3>本页可跳转</h3><div class="lk" id="np-links"></div></div>';
    var shared = W.sharedFns(p.end);
    if (shared.length) {
      s += '<div class="np-sec"><h3>公共组件<span class="r"><span class="mini-sw' + (pref('sharedDots') ? ' on' : '') + '" data-tool="sdots" title="在画板上显示公共组件的标注"><i></i>圆点</span></span></h3>' +
        shared.filter(function (x) { return only || !D.removed(x.fn); }).map(function (x, i) { return cardHTML(x.fn, i, null, null, true).replace('class="fc', 'class="fc fold'); }).join('') + '</div>';
    }
    s += '<a class="tolink" href="#/doc/d-pg-' + h.esc(p.id) + '">在需求文档中查看本页 →</a></div>';
    $('#right').innerHTML = s;
    if (!HOST.isHosted(p)) collectLinks();
  }
  function collectLinks() {
    var seen = {}, out = [];
    var ab = $('#ab');
    if (!ab) return;
    $$('[data-go]', topLayer(ab) || ab).forEach(function (el) {
      var id = el.dataset.go, stt = el.dataset.st || '';
      if (!W.pages[id] || el.closest('[data-demo]')) return;
      var key = id + '|' + stOf(id, stt);
      if (seen[key]) return;
      seen[key] = 1;
      var lb = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18) || el.getAttribute('title') || '（图标）';
      var tp = W.pages[id], so = stateObj(tp, stOf(id, stt));
      out.push('<a data-nav="' + h.esc(id + '|' + stt) + '" data-set="' + h.esc(el.dataset.set || '') + '"><code>' + h.esc(id) + '</code><span>「' + h.esc(lb) + '」→ ' + h.esc(tp.title) + (so && tp.states.length > 1 ? '（' + h.esc(so.label) + '）' : '') + '</span></a>');
    });
    var box = $('#np-links');
    if (box) box.innerHTML = out.length ? out.join('') : '<span class="hintline">本页没有跳转</span>';
  }
  function syncCards() {
    var only = chgOn();
    $$('#right .fc').forEach(function (c) {
      var key = c.dataset.fid;
      if (/^S:/.test(key)) return;
      var vis = !!ui.visible[key];
      var f = ui.cur && ui.cur.p.fns.find(function (x) { return x.id === key; });
      var changed = f && D.chg(f);
      var wasOff = c.classList.contains('off');
      c.classList.toggle('off', !vis && !(f && D.removed(f)));
      if (c.dataset.init !== '1' || wasOff !== c.classList.contains('off')) {
        c.classList.toggle('fold', (!vis || (only && !changed)) && ui.sel !== key);
        c.dataset.init = '1';
      }
    });
  }

  /* ---------- 流程条 ---------- */
  function renderFlowbar(r, flow) {
    var fb = $('#flowbar');
    if (!flow) { fb.innerHTML = ''; fb.dataset.f = ''; return; }
    var i = Math.min(+r.q.i || 0, flow.steps.length - 1), s = flow.steps[i];
    var on = sameStep(s, r.id, r.st);
    var pg = W.pages[s.p];
    fb.innerHTML = '<span class="fb-t">' + h.esc(flow.name) + '<br>第 ' + (i + 1) + ' / ' + flow.steps.length + ' 步</span>' +
      '<span class="fb-n">' + (on ? '<b>' + h.esc(s.label || (pg && pg.title) || '') + '</b>　' + W.md.inline(s.tip || '') : '<span class="off">当前页面不在流程中。</span>可点“回到第 ' + (i + 1) + ' 步”继续演示。') + '</span>' +
      (on ? '' : '<button data-fb="cur">回到第 ' + (i + 1) + ' 步</button>') +
      '<button data-fb="prev"' + (i === 0 ? ' disabled' : '') + '>上一步</button>' +
      '<button class="p" data-fb="next"' + (i >= flow.steps.length - 1 ? ' disabled' : '') + '>下一步</button>' +
      '<button data-fb="exit">退出流程</button>';
    fb.dataset.f = flow.id;
    fb.dataset.i = i;
  }
  function renderFlowIndex(r) {
    document.body.classList.remove('flow-on');
    setTab('flow');
    ui.cur = null;
    ui.hostEnd = null;
    ui.docKey = '';
    renderLeft('flow', r, null);
    if (!ui.proto) $('#right').innerHTML = '<div class="np"><h2>核心流程</h2><p class="goal">从左侧选择一条流程。演示中可以直接点击画板里的按钮前进，也可以使用底部的“上一步／下一步”。</p></div>';
    $('#stage-in').innerHTML = '<div class="doc"><h1>核心流程演示</h1><p>共 ' + (W.P.flows || []).length + ' 条流程。</p>' + (W.P.flows || []).map(function (f) {
      return '<h3>' + h.esc(f.name) + '</h3>' + (f.desc ? '<p>' + W.md.inline(f.desc) + '</p>' : '') + '<p><a href="#" data-step="' + h.esc(f.id) + '|0">▶ 开始演示（' + f.steps.length + ' 步）</a></p>';
    }).join('') + '</div>';
    $('#flowbar').innerHTML = '';
  }

  /* ---------- 需求文档 ---------- */
  function statsHTML(only) {
    var st = D.stats(), a = W.audit;
    if (only) {
      var log = D.changelog().filter(function (x) { return x.ver === st.release; });
      var c3 = ['added', 'modified', 'removed'].map(function (t) { return log.filter(function (x) { return x.type === t; }).length; });
      return '<div class="stats"><div><b>' + log.length + '</b><span>' + h.esc(st.release) + ' 变化</span></div><div><b>' + c3[0] + '</b><span>新增</span></div><div><b>' + c3[1] + '</b><span>修改</span></div><div><b>' + c3[2] + '</b><span>移除</span></div></div>';
    }
    var cells = [['页面', st.pages], ['页面状态', st.states], ['功能点', st.fns], ['字段', st.fields], ['待确认', st.pending], ['AI 假设', st.assumed]];
    if (D.multiRelease()) cells.push([st.release + ' 变化', st.changes]);
    if (a) cells.push(['交互元素覆盖', a.stats.interactive ? Math.round(a.stats.covered / a.stats.interactive * 100) + '%' : '—']);
    if (a && a.needOnline) cells.push(['交付条件', '需联网']);
    return '<div class="stats">' + cells.map(function (c) { return '<div><b>' + c[1] + '</b><span>' + c[0] + '</span></div>'; }).join('') + '</div>';
  }
  function renderDoc(r) {
    document.body.classList.remove('flow-on');
    setTab('doc');
    ui.cur = null;
    ui.hostEnd = null;
    var only = chgOn() && D.multiRelease();
    var key = 'doc|' + only;
    if (ui.docKey !== key) {
      var md = D.markdown({ html: true, changesOnly: only, stats: statsHTML(only) });
      $('#stage-in').innerHTML = '<div class="doc" id="doc"><div class="doc-bar"><span class="l">需求文档与原型同源；改需求请改源文件后重新构建</span>' +
        (D.multiRelease() ? '<button class="vbtn chg' + (only ? ' on' : '') + '" data-tool="chg">只看 ' + h.esc(D.cur()) + ' 变化</button>' : '') +
        '<button class="vbtn" data-act-doc="print">打印 / 存为 PDF</button><button class="vbtn" data-act-doc="md">导出 Markdown</button></div><div id="docbody"></div></div>';
      W.md.into($('#docbody'), md);
      ui.docKey = key;
      renderDocLeft();
      renderDocRight();
    }
    $('#flowbar').innerHTML = '';
    var target = r.anchor && document.getElementById(r.anchor);
    var stage = $('#stage');
    if (target) {
      requestAnimationFrame(function () { stage.scrollTop += target.getBoundingClientRect().top - stage.getBoundingClientRect().top - 56; });
    } else if (!r.anchor) stage.scrollTop = 0;
    $$('#left .nv-i').forEach(function (a) { a.classList.toggle('on', a.dataset.anchor === r.anchor); });
  }
  function renderDocLeft() {
    $('#left').innerHTML = '<div class="nv-head">需求文档目录</div><div class="nv-g">' + (D.lastToc || []).map(function (t) {
      return '<a class="nv-i' + (t.level === 2 ? ' sub' : '') + '" href="#/doc/' + h.esc(t.id) + '" data-anchor="' + h.esc(t.id) + '">' + (t.page ? '<code>' + h.esc(t.page) + '</code><span>' + h.esc(t.title.slice(t.page.length + 1)) + '</span>' : '<span>' + h.esc(t.title) + '</span>') + '</a>';
    }).join('') + '</div>';
  }
  function renderDocRight() {
    var st = D.stats(), a = W.audit, pend = D.pendingList();
    var s = '<div class="np"><h2>评审摘要</h2><p class="goal">' + h.esc(W.P.name) + ' · ' + h.esc(st.release) + '</p>' +
      '<div class="np-sec"><div class="sum-k"><div><b>' + st.pages + '</b><span>页面</span></div><div><b>' + st.fns + '</b><span>功能点</span></div><div><b>' + st.pending + '</b><span>待确认</span></div><div><b>' + st.assumed + '</b><span>AI 假设</span></div></div></div>';
    if (a) {
      s += '<div class="np-sec"><h3>构建检查<span>' + h.esc(D.localTime(a.at)) + '</span></h3>' +
        '<div class="issue ' + (a.ok ? '' : 'e') + '">' + (a.ok ? '通过：原型中 ' + a.stats.interactive + ' 个可交互元素全部对应到需求功能点' + (a.stats.ignored ? '（另有 ' + a.stats.ignored + ' 个标为不纳入本次需求）' : '') + '，需求中的功能点全部在原型中出现' + (st.gaps ? '或已标注“原型未体现”' : '') + '。' : '未通过：' + a.errors.length + ' 个问题') + (a.needOnline ? '本原型标为“需联网”，交付后需联网才能完整使用。' : '') + '</div>' +
        (a.errors || []).slice(0, 10).map(function (x) { return '<div class="issue e">' + h.esc(x.msg) + '</div>'; }).join('') +
        /* “需联网”提醒不参与截断，保证交付方一定能看到 */
        (a.warns || []).filter(function (x) { return x.code === 'ONLINE'; }).map(function (x) { return '<div class="issue w">' + h.esc(x.msg) + '</div>'; }).join('') +
        (a.warns || []).filter(function (x) { return x.code !== 'ONLINE'; }).slice(0, 12).map(function (x) { return '<div class="issue w">' + h.esc(x.msg) + '</div>'; }).join('') + '</div>';
    } else s += '<div class="np-sec"><h3>构建检查</h3><div class="issue w">此文件未经过构建检查。</div></div>';
    if (W.errors.length) s += '<div class="np-sec"><h3>运行错误</h3>' + W.errors.slice(0, 20).map(function (m) { return '<div class="issue e">' + h.esc(m) + '</div>'; }).join('') + '</div>';
    s += '<div class="np-sec"><h3>浏览方式</h3><ul>' +
      '<li>顶部切换<b>端</b>，左侧目录选页面；右侧是本页需求，切换页面状态看不同情况</li>' +
      '<li>画板上的<b>编号圆点</b>对应右侧功能点，点击互相定位；按 <kbd>N</kbd> 显示或隐藏</li>' +
      '<li>按 <kbd>H</kbd> 显示所有可点击区域；画板里的按钮可以直接点</li>' +
      ((W.P.flows || []).length ? '<li>“核心流程”逐步演示，键盘 ← → 切换步骤</li>' : '') +
      '<li>本文档可导出 Markdown 或打印为 PDF，内容与原型同源</li></ul></div>';
    if (pend.length) {
      s += '<div class="np-sec"><h3>待确认与 AI 假设<span>' + pend.length + ' 条</span></h3><div class="pend-l">' + pend.slice(0, 60).map(function (x) {
        return '<a href="' + h.esc(x.href || '#/doc') + '"><span class="bdg ' + (x.type === 'pending' ? 'pending' : 'assumed') + '">' + (x.type === 'pending' ? '待确认' : 'AI 假设') + '</span><code>' + h.esc(x.where) + '</code>' + W.md.inline(x.text.slice(0, 80)) + '</a>';
      }).join('') + '</div></div>';
    }
    s += '</div>';
    $('#right').innerHTML = s;
  }
  function exportMd() {
    var md = D.markdown({ html: false, changesOnly: chgOn() && D.multiRelease() });
    var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (W.P.name || '需求') + '-需求文档-' + D.cur() + (chgOn() && D.multiRelease() ? '-本版变化' : '') + '.md';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- 画板缩放 ---------- */
  function fit() {
    var dev = $('#dev');
    if (!dev) return;
    var e = W.end(dev.dataset.end) || {};
    var wrap = $('#devwrap'), stage = $('#stage'), scr = $('#scr');
    var availW = stage.clientWidth - 48;
    var flowH = document.body.classList.contains('flow-on') ? 84 : 0;
    var availH = stage.clientHeight - 40 - 44 - flowH;
    var s, hosted = !!$('#hostf');
    var sz = hosted ? HOST.size(e) : { w: e.width || (e.device === 'mobile' ? 375 : 1280), h: e.height || (e.device === 'mobile' ? 812 : 800) };
    if (dev.classList.contains('dev-m')) {
      var DW = sz.w + 22, DH = sz.h + 22;
      s = ui.zoom === 'fit' ? Math.min(1, availW / DW, availH / DH) : 1;
      s = Math.max(s, 0.4);
      scr.style.width = sz.w + 'px';
      scr.style.height = sz.h + 'px';
      dev.style.transform = 'scale(' + s + ')';
      wrap.style.width = DW * s + 'px';
      wrap.style.height = DH * s + 'px';
    } else {
      var PW = sz.w + 2;
      s = ui.zoom === 'fit' ? Math.min(1, availW / PW) : 1;
      s = Math.max(s, 0.25);
      var scrH = ui.zoom === 'fit' ? Math.max(e.minHeight || 600, Math.round(availH / s) - 34) : sz.h;
      scr.style.width = sz.w + 'px';
      scr.style.height = scrH + 'px';
      dev.style.transform = 'scale(' + s + ')';
      wrap.style.width = PW * s + 'px';
      wrap.style.height = (scrH + 34) * s + 'px';
    }
    ui.scale = s;
    var zb = $('#zoomBtn .lb');
    if (zb) zb.textContent = ui.zoom === 'fit' ? '适应窗口 ' + Math.round(s * 100) + '%' : '实际尺寸 100%';
    placeDotsSoon();
  }

  /* ---------- 画板内交互 ---------- */
  function toast(msg) {
    var root = $('#ab > *') || $('#ab');
    if (!root) return;
    var old = $('.toast.tmp', root);
    if (old) old.remove();
    var t = document.createElement('div');
    t.className = 'toast tmp';
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }
  W.toast = toast;
  W.acts = W.acts || {};
  function runAct(act, el) {
    var c = ui.cur;
    if (act === 'chk') {
      if (el.classList.contains('dis')) return;
      el.classList.toggle('on');
    } else if (act === 'seg') {
      var g = el.closest('[data-seg]') || el.parentNode;
      $$('[data-act="seg"]', g).forEach(function (x) { if ((x.closest('[data-seg]') || x.parentNode) === g) x.classList.remove('on'); });
      el.classList.add('on');
    } else if (act === 'menu') {
      el.closest('.menu').classList.toggle('open');
    } else if (act === 'toast') {
      toast(el.dataset.msg || '演示：此操作在原型中不展开');
    } else {
      var fn = (c && c.p.acts && c.p.acts[act]) || W.acts[act];
      if (fn) {
        try { fn(el, { st: c && c.st, s: W.store, p: c && c.p, nav: nav, toast: toast, render: render, root: $('#ab') }); } catch (e) { console.error(e); toast('交互出错：' + e.message); }
      } else toast('演示：' + act);
    }
    if (c) placeDotsSoon();
  }

  /* ---------- 事件 ---------- */
  function onKey(e) {
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'h' || e.key === 'H') toggleHot();
    if (e.key === 'n' || e.key === 'N') toggleDots();
    var fb = $('#flowbar');
    if (document.body.classList.contains('flow-on') && fb.dataset.f) {
      if (e.key === 'ArrowRight') goStep(fb.dataset.f, +fb.dataset.i + 1);
      if (e.key === 'ArrowLeft') goStep(fb.dataset.f, +fb.dataset.i - 1);
    }
  }
  function toggleHot() {
    document.body.classList.toggle('hot');
    var f = $('#hostf');
    if (f && f.contentDocument) f.contentDocument.documentElement.classList.toggle('prd-hot', document.body.classList.contains('hot'));
    syncTools();
  }
  function toggleDots() {
    document.body.classList.toggle('no-dots');
    if (!ui.proto) pref('noDots', document.body.classList.contains('no-dots'));
    $$('.mini-sw[data-tool="dots"]').forEach(function (x) { x.classList.toggle('on', !document.body.classList.contains('no-dots')); });
    syncTools();
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    var tb = t.closest('[data-tab]');
    if (tb) {
      e.preventDefault();
      var tab = tb.dataset.tab;
      if (tab === 'doc') location.hash = '#/doc';
      else if (tab === 'flow') location.hash = '#/flow';
      else location.hash = hashFor(ui.last[tab]);
      return;
    }
    var fdot = t.closest('[data-fdot]');
    if (fdot) { selectFn(fdot.dataset.fdot, true); return; }
    var fch = t.closest('[data-fc]');
    if (fch) {
      var card = fch.parentNode;
      var key = fch.dataset.fc;
      if (ui.sel === key && !card.classList.contains('fold')) { card.classList.add('fold'); ui.sel = null; $$('.fdot').forEach(function (d) { d.classList.remove('on'); }); drawBoxes(null); }
      else selectFn(key, false);
      return;
    }
    var nv = t.closest('[data-nav]');
    if (nv && !t.closest('#ab')) {
      e.preventDefault();
      var pr = nv.dataset.nav.split('|');
      nav(pr[0], pr[1], nv.dataset.set || '', nv.dataset.fnsel ? { fn: nv.dataset.fnsel } : null);
      return;
    }
    var ps = t.closest('[data-preset]');
    if (ps) { W.applySet('preset=' + ps.dataset.preset); render({ keepSel: true }); return; }
    var sp = t.closest('[data-step]');
    if (sp) {
      e.preventDefault();
      var a = sp.dataset.step.split('|');
      goStep(a[0], +a[1]);
      return;
    }
    var fbb = t.closest('[data-fb]');
    if (fbb) {
      var fb = $('#flowbar'), fid = fb.dataset.f, i = +fb.dataset.i, k = fbb.dataset.fb;
      if (k === 'next') goStep(fid, i + 1);
      else if (k === 'prev') goStep(fid, i - 1);
      else if (k === 'cur') goStep(fid, i);
      else if (k === 'exit') { var r = parse(); location.hash = hashFor(r.id, r.st); }
      return;
    }
    var ad = t.closest('[data-act-doc]');
    if (ad) {
      if (ad.dataset.actDoc === 'md') exportMd();
      if (ad.dataset.actDoc === 'print') window.print();
      return;
    }
    var tool = t.closest('[data-tool]');
    if (tool) {
      var k2 = tool.dataset.tool, B = document.body.classList;
      if (k2 === 'hot') toggleHot();
      if (k2 === 'dots') toggleDots();
      if (k2 === 'sdots') { pref('sharedDots', !pref('sharedDots')); tool.classList.toggle('on', !!pref('sharedDots')); placeDots(); }
      if (k2 === 'chg') { B.toggle('chg-on'); pref('chg', B.contains('chg-on')); ui.docKey = ''; render({ keepSel: true }); }
      if (k2 === 'zoom') { ui.zoom = ui.zoom === 'fit' ? '100' : 'fit'; fit(); }
      if (k2 === 'left') { if (innerWidth <= 1100) { B.toggle('m-l'); B.remove('m-r'); } else B.toggle('no-l'); setTimeout(fit, 220); }
      if (k2 === 'right') { if (innerWidth <= 1100) { B.toggle('m-r'); B.remove('m-l'); } else B.toggle('no-r'); setTimeout(fit, 220); }
      if (k2 === 'reset') {
        W.reset();
        W.P.ends.forEach(function (en) { (en.resetKeys || []).forEach(function (pre) { try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf(pre) === 0) localStorage.removeItem(k); }); } catch (x) {} }); });
        ui.hostEnd = null;
        render({ keepSel: true });
        toast('演示数据已重置');
      }
      syncTools();
      return;
    }
    var ab = t.closest('#ab');
    if (!ab) {
      $$('.menu.open').forEach(function (m) { m.classList.remove('open'); });
      return;
    }
    $$('.menu.open', ab).forEach(function (m) { if (!m.contains(t)) m.classList.remove('open'); });
    var el = t.closest('[data-go],[data-act]');
    if (!el) {
      if (!t.closest('input,textarea,select,label,[contenteditable],.menu-pop,[data-ctl]')) {
        ab.classList.add('flash');
        clearTimeout(ab._ft);
        ab._ft = setTimeout(function () { ab.classList.remove('flash'); }, 700);
      }
      return;
    }
    if (el.hasAttribute('disabled') || el.classList.contains('dis')) return;
    e.preventDefault();
    if (el.dataset.act) runAct(el.dataset.act, el);
    if (el.dataset.go) nav(el.dataset.go, el.dataset.st || '', el.dataset.set || '');
  });
  document.addEventListener('mouseover', function (e) {
    var c = e.target.closest && e.target.closest('.fc');
    var key = c ? c.dataset.fid : null;
    if (key === ui.hover) return;
    ui.hover = key;
    if (!ui.hl) drawBoxes(key);
  });
  document.addEventListener('change', function (e) {
    var sl = e.target;
    if (sl.matches && sl.matches('select[data-pick]')) sl.classList.toggle('e', !sl.value);
  });
  document.addEventListener('scroll', function (e) { if (e.target.closest && e.target.closest('#ab')) placeDotsSoon(); }, true);
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', function () { setTimeout(syncTools, 0); });
  window.addEventListener('hashchange', function () { render(); });
  window.addEventListener('resize', function () { clearTimeout(window._rz); window._rz = setTimeout(function () { fit(); if (ui.cur) placeDots(); }, 80); });

  /* 供构建脚本与回归测试读取当前画面状态 */
  W.viewerDiag = function () {
    var r = parse();
    return {
      view: r.view, page: ui.cur && ui.cur.p.id, state: ui.cur && ui.cur.st,
      dots: $$('#dots .fdot').map(function (d) { return d.dataset.fdot; }),
      visibleFns: Object.keys(ui.visible || {}),
      sharedVisible: Object.keys(ui.visible || {}).filter(function (k) { return /^S:/.test(k); }).length,
      sharedDots: !!pref('sharedDots'),
      ignoredMarks: $$('#dots .xbox').length,
      cards: $$('#right .fc').length,
      unknown: ui.unknown, scale: ui.scale, errors: W.errors.slice()
    };
  };

  function boot() {
    if (!W.P) {
      document.body.innerHTML = '<div class="boot-err"><h2>原型需求数据缺失</h2><p>没有找到 W.product(...)。</p></div>';
      return;
    }
    finalize();
    if (ui.proto) document.body.classList.add('no-dots', 'no-r');
    else if (pref('noDots')) document.body.classList.add('no-dots');
    if (pref('chg') && D.multiRelease()) document.body.classList.add('chg-on');
    document.body.classList.add('no-anim');
    if (innerWidth < 1500 && innerWidth > 1100) document.body.classList.add('no-l');
    renderTop();
    render();
    syncTools();
    setTimeout(function () { document.body.classList.remove('no-anim'); }, 50);
    $('#app').addEventListener('transitionend', function (e) { if (e.target.id === 'app') fit(); });
    window.__PRD_READY = true;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
