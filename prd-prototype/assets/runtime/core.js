/* 原型需求 · 核心：注册接口、演示数据、线框组件函数。页面文件通过 W.page 注册。 */
(function () {
  'use strict';
  var W = (window.W = window.W || {});
  W.pages = {};
  W.order = {};
  W.sharedGroups = [];
  W.P = null;
  W.h = {};
  W.errors = [];
  var h = W.h;
  /* 页面文件可直接使用 h.*，无需每个文件再声明 */
  window.h = h;

  function fail(msg) {
    W.errors.push(msg);
    if (window.console) console.error('[原型需求] ' + msg);
  }

  /* ---------- 注册 ---------- */
  W.product = function (cfg) {
    if (W.P) fail('W.product 只能调用一次');
    W.P = cfg || {};
    (W.P.ends || []).forEach(function (e) { W.order[e.id] = W.order[e.id] || []; });
    initStore();
  };
  W.page = function (p) {
    if (!p || !p.id) { fail('W.page 缺少 id'); return; }
    if (W.pages[p.id]) { fail('页面 ID 重复：' + p.id); return; }
    if (!W.P) { fail('W.page(' + p.id + ') 在 W.product 之前执行；请把 product.js 放在页面文件之前'); return; }
    if (!W.order[p.end]) { fail('页面 ' + p.id + ' 的 end「' + p.end + '」没有在 product.ends 中声明'); return; }
    p.states = p.states || [];
    p.fns = p.fns || [];
    W.pages[p.id] = p;
    W.order[p.end].push(p.id);
  };
  W.reg = W.page;
  W.shared = function (s) {
    if (!s || !s.id || !s.end) { fail('W.shared 需要 id 和 end'); return; }
    s.fns = s.fns || [];
    W.sharedGroups.push(s);
  };
  W.end = function (id) { return (W.P.ends || []).find(function (e) { return e.id === id; }); };
  W.sharedFns = function (end) {
    var out = [];
    W.sharedGroups.forEach(function (g) {
      if (g.end === end || g.end === '*') g.fns.forEach(function (f) { out.push({ fn: f, group: g }); });
    });
    return out;
  };
  /* 在页面中解析 data-fn：先找本页，再找本端公共组件 */
  W.findFn = function (page, id) {
    var f = (page.fns || []).find(function (x) { return x.id === id; });
    if (f) return { fn: f, page: page, shared: false };
    var s = W.sharedFns(page.end).find(function (x) { return x.fn.id === id; });
    return s ? { fn: s.fn, group: s.group, shared: true } : null;
  };

  /* ---------- 演示数据（跨页面的全局状态） ---------- */
  var KEY;
  function clone(o) { return JSON.parse(JSON.stringify(o || {})); }
  function def() { return clone((W.P && W.P.demo) || {}); }
  function initStore() {
    KEY = 'prd-proto:' + (W.P.id || W.P.name || 'demo');
    W.store = def();
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && typeof s === 'object') W.store = Object.assign(def(), s);
    } catch (e) {}
  }
  W.save = function () { if (W._noSave) return; try { localStorage.setItem(KEY, JSON.stringify(W.store)); } catch (e) {} };
  W.reset = function () { W.store = def(); W.save(); };
  W.presets = function () { return (W.P.scenarios && W.P.scenarios.presets) || []; };
  function setPath(o, k, v) {
    var path = k.split('.');
    for (var j = 0; j < path.length - 1; j++) o = o[path[j]] = (o[path[j]] && typeof o[path[j]] === 'object') ? o[path[j]] : {};
    o[path[path.length - 1]] = v;
  }
  function getPath(o, k) {
    return k.split('.').reduce(function (a, x) { return a == null ? a : a[x]; }, o);
  }
  function parseVal(v) {
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  }
  /* "preset=empty;user.role=admin;count=3" 或 { 'user.role': 'admin' } */
  W.applySet = function (set) {
    if (!set) return;
    if (typeof set === 'string' && /^\s*\{/.test(set)) { try { set = JSON.parse(set); } catch (e) { fail('data-set 不是合法 JSON：' + set); return; } }
    if (typeof set === 'object') {
      Object.keys(set).forEach(function (k) {
        if (k === 'preset') W.applySet(presetSet(set[k]));
        else setPath(W.store, k, clone({ v: set[k] }).v);
      });
    } else {
      String(set).split(';').forEach(function (pair) {
        var i = pair.indexOf('=');
        if (i < 0) return;
        var k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
        if (!k) return;
        if (k === 'preset') W.applySet(presetSet(v));
        else setPath(W.store, k, parseVal(v));
      });
    }
    W.save();
  };
  function presetSet(id) {
    var p = W.presets().find(function (x) { return x.id === id; });
    if (!p) { fail('未知的演示预设：' + id); return null; }
    return p.set;
  }
  function setPairs(set) {
    var out = {};
    if (!set) return out;
    if (typeof set === 'string' && /^\s*\{/.test(set)) { try { return JSON.parse(set); } catch (e) { return out; } }
    if (typeof set === 'object') return set;
    String(set).split(';').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i > 0) out[pair.slice(0, i).trim()] = parseVal(pair.slice(i + 1).trim());
    });
    return out;
  }
  W.presetId = function () {
    var hit = W.presets().find(function (p) {
      var pairs = setPairs(p.set);
      return Object.keys(pairs).every(function (k) { return JSON.stringify(getPath(W.store, k)) === JSON.stringify(pairs[k]); });
    });
    return hit ? hit.id : null;
  };
  W.get = function (k) { return getPath(W.store, k); };

  /* ---------- 基础组件 ---------- */
  h.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  /* 通用属性：fn 功能点、field 字段、go 跳转、act 本地交互、demo 演示控件 */
  h.attrs = function (o) {
    o = o || {};
    var a = '';
    if (o.fn) a += ' data-fn="' + h.esc(o.fn) + '"';
    if (o.field) a += ' data-field="' + h.esc(o.field) + '"';
    if (o.go) a += h.go(o.go, o.st, o.set);
    if (o.act) a += ' data-act="' + h.esc(o.act) + '"';
    if (o.msg) a += ' data-msg="' + h.esc(o.msg) + '"';
    if (o.demo) a += ' data-demo';
    if (o.id) a += ' id="' + h.esc(o.id) + '"';
    if (o.title) a += ' title="' + h.esc(o.title) + '"';
    if (o.submit != null) a += h.op(o.submit);
    if (o.attr) a += ' ' + o.attr;
    return a;
  };
  h.go = function (id, st, set) {
    return ' data-go="' + h.esc(id) + '"' + (st ? ' data-st="' + h.esc(st) + '"' : '') + (set ? ' data-set="' + h.esc(typeof set === 'object' ? JSON.stringify(set) : set) + '"' : '');
  };
  /* 功能点包裹：h.fn('submit', html) 或 h.fn('submit', html, 'span') */
  h.fn = function (id, html, tag, cls) {
    tag = tag || 'div';
    return '<' + tag + ' data-fn="' + h.esc(id) + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + html + '</' + tag + '>';
  };
  /* 仅用于演示的控件（如“以新用户登录”切换），不属于产品功能，不进入需求 */
  h.demo = function (html, label) {
    return '<div class="demo-box" data-demo><span class="demo-lb">' + (label || '演示切换') + '</span>' + html + '</div>';
  };
  /* h.btn('文字', {k:'pri', sz:'sm', go:'P01', st:'x', act:'toast', msg:'', dis:true, ic:'plus', fn:'', cls:''}) */
  h.btn = function (label, o) {
    o = o || {};
    return '<button class="btn ' + (o.k || '') + ' ' + (o.sz || '') + ' ' + (o.cls || '') + '"' + h.attrs(o) + (o.dis ? ' disabled' : '') + '>' + (o.ic ? h.i(o.ic, 16) : '') + label + '</button>';
  };
  h.a = function (label, id, st, set, o) {
    return '<a class="lnk"' + h.go(id, st, set) + h.attrs(o) + '>' + label + '</a>';
  };
  h.tag = function (t, k) { return '<span class="tag t-' + (k || 'gray') + '">' + t + '</span>'; };
  h.ph = function (label, o) {
    o = o || {};
    var st = 'height:' + (o.h || 120) + 'px;' + (o.w ? 'width:' + o.w + 'px;' : 'width:100%;') + (o.style || '');
    return '<div class="ph" style="' + st + '"><span>' + label + '</span></div>';
  };
  h.bn = function (kind, html, o) {
    o = o || {};
    var icon = { info: 'info', warn: 'warn', err: 'warn', ok: 'check', gray: 'info' }[kind] || 'info';
    return '<div class="bn bn-' + kind + (o.cls ? ' ' + o.cls : '') + '"' + h.attrs(o) + '>' + h.i(o.ic || icon, 15) + '<div class="f1">' + html + '</div></div>';
  };
  h.bar = function (pct, o) {
    o = o || {};
    return '<div class="bar ' + (o.cls || '') + '"' + (o.w ? ' style="width:' + o.w + 'px"' : '') + '><i style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></div>';
  };
  /* 表单项：h.fld('标签', 控件, {req:1, hint:'', err:'', field:'key', fn:''}) */
  h.fld = function (label, inner, o) {
    o = o || {};
    var v = (o.req ? ' data-req="1"' : '') + (o.min != null ? ' data-min="' + (+o.min) + '"' : '') + (o.max != null ? ' data-max="' + (+o.max) + '"' : '');
    return '<div class="fld"' + h.attrs({ fn: o.fn, field: o.field }) + v + '>' + (label ? '<div class="lbl">' + label + (o.req ? '<em>*</em>' : '') + '</div>' : '') + inner + (o.hint ? '<div class="hint">' + o.hint + '</div>' : '') + (o.err ? '<div class="ferr">' + o.err + '</div>' : '') + '</div>';
  };
  /* 输入框：h.inp('值')；{e:1} 时作占位；{sel:1, options:[]} 下拉；{date:1} 日期；{area:1, rows:4} 多行 */
  h.inp = function (v, o) {
    o = o || {};
    var cls = 'inp' + (o.bad ? ' bad' : '') + (o.cls ? ' ' + o.cls : ''), st = o.style ? ' style="' + o.style + '"' : '';
    var a = ' data-ctl' + h.attrs({ fn: o.fn, field: o.field }) + (o.dis ? ' disabled' : '');
    if (o.area) {
      return '<textarea class="' + cls + ' area"' + st + a + ' rows="' + (o.rows || 4) + '"' + (o.e ? ' placeholder="' + h.esc(v) + '">' : '>' + h.esc(v)) + '</textarea>';
    }
    if (o.date || (o.sel && /^\d{4}-\d{2}-\d{2}$/.test(v))) {
      return '<input type="date" class="' + cls + '"' + st + a + ' value="' + (o.e ? '' : h.esc(v)) + '">';
    }
    if (o.sel) {
      var list = o.options || [v];
      return '<select class="' + cls + (o.e ? ' e' : '') + '" data-pick' + st + a + '>' + (o.e ? '<option value="" selected>' + h.esc(v) + '</option>' : '') +
        list.map(function (x) { return '<option' + (x === v && !o.e ? ' selected' : '') + '>' + h.esc(x) + '</option>'; }).join('') + '</select>';
    }
    return '<input type="' + (o.type || 'text') + '" class="' + cls + '"' + st + a + (o.e ? ' placeholder="' + h.esc(v) + '" value=""' : ' value="' + h.esc(v) + '"') + '>';
  };
  h.sel = function (v, options, o) { o = o || {}; o.sel = 1; o.options = options; return h.inp(v, o); };
  h.search = function (ph, o) {
    o = o || {};
    return '<div class="inp srch"' + (o.style ? ' style="' + o.style + '"' : '') + '>' + h.i('search', 15) + '<input class="bare" data-ctl' + h.attrs({ fn: o.fn, field: o.field }) + (o.filter ? ' data-filter="' + h.esc(o.filter) + '"' : '') + ' placeholder="' + h.esc(ph) + '" value="' + h.esc(o.value || '') + '"></div>';
  };
  /* 单选/多选按钮组：h.opts(['a','b'], 0, {multi:1, field:'k'}) */
  h.opts = function (list, on, o) {
    o = o || {};
    return '<div class="opts" data-seg data-ctl' + h.attrs({ fn: o.fn, field: o.field }) + '>' + list.map(function (t, i) {
      var isOn = Array.isArray(on) ? on.indexOf(i) >= 0 : i === on;
      return '<span class="opt ' + (o.sq ? 'sq ' : '') + (isOn ? 'on' : '') + '" data-act="' + (o.multi ? 'chk' : 'seg') + '">' + t + '</span>';
    }).join('') + '</div>';
  };
  /* 复选/单选框：h.ck('文字', true, {rd:1, dis:1, field:'k'}) */
  h.ck = function (label, on, o) {
    o = o || {};
    return '<span class="ck ' + (o.rd ? 'rd ' : '') + (on ? 'on ' : '') + (o.dis ? 'dis ' : '') + (o.cls || '') + '" data-ctl' + h.attrs({ fn: o.fn, field: o.field, attr: o.attr }) + (o.dis ? '' : ' data-act="' + (o.rd ? 'seg' : 'chk') + '"') + '>' + label + '</span>';
  };
  h.sw = function (on, o) {
    o = o || {};
    return '<span class="sw ' + (on ? 'on' : '') + '" data-ctl data-act="chk"' + h.attrs({ fn: o.fn, field: o.field }) + '><i></i></span>';
  };
  /* 页签：list = [[文字, 跳转页面, 状态, set]]；没有跳转的项为纯展示 */
  h.tabs = function (list, on, o) {
    o = o || {};
    return '<div class="tabs"' + h.attrs({ fn: o.fn }) + '>' + list.map(function (t, i) {
      return '<a class="' + (i === on ? 'on' : '') + '"' + (t[1] ? h.go(t[1], t[2], t[3]) : '') + '>' + t[0] + '</a>';
    }).join('') + '</div>';
  };
  /* 筛选胶囊：本地切换 */
  h.pills = function (list, on, o) {
    o = o || {};
    return '<div class="pills" data-seg data-ctl' + h.attrs({ fn: o.fn, field: o.field }) + '>' + list.map(function (t, i) {
      return '<span class="pill ' + (i === on ? 'on' : '') + '" data-act="seg">' + t + '</span>';
    }).join('') + '</div>';
  };
  /* 表格：h.table(['列1','列2'], [[...],[...]], {fn:'list', empty:'暂无数据'}) */
  h.table = function (cols, rows, o) {
    o = o || {};
    var body = rows && rows.length ? rows.map(function (r) {
      return '<tr>' + r.map(function (c, i) { return '<td' + (o.right && o.right.indexOf(i) >= 0 ? ' class="rt"' : '') + '>' + (c == null ? '' : c) + '</td>'; }).join('') + '</tr>';
    }).join('') : '<tr><td colspan="' + cols.length + '" class="tbl-empty">' + (o.empty || '暂无数据') + '</td></tr>';
    return '<div class="tbl-w ' + (o.cls || '') + '" data-list' + h.attrs({ fn: o.fn }) + '><table class="tbl"><tr>' + cols.map(function (c, i) { return '<th' + (o.right && o.right.indexOf(i) >= 0 ? ' class="rt"' : '') + '>' + c + '</th>'; }).join('') + '</tr>' + body + '</table></div>';
  };
  /* 列表：h.list([html, html], {fn:'list'})；每项为一行 */
  h.list = function (items, o) {
    o = o || {};
    return '<div class="list ' + (o.cls || '') + '" data-list' + h.attrs({ fn: o.fn }) + '>' + (items && items.length ? items.join('') : '<div class="li empty-li">' + (o.empty || '暂无数据') + '</div>') + '</div>';
  };
  h.li = function (html, o) { o = o || {}; return '<div class="li ' + (o.cls || '') + '"' + h.attrs(o) + '>' + html + '</div>'; };
  /* 键值对：h.kv([['标签','值'],...]) */
  h.kv = function (pairs, o) {
    o = o || {};
    return '<dl class="kv ' + (o.cls || '') + '"' + h.attrs({ fn: o.fn }) + '>' + pairs.map(function (p) { return '<dt>' + p[0] + '</dt><dd>' + p[1] + '</dd>'; }).join('') + '</dl>';
  };
  h.empty = function (title, desc, action) {
    return '<div class="emp">' + h.i('box', 36) + '<div class="b mt12">' + title + '</div>' + (desc ? '<p class="sm mut2 mt4">' + desc + '</p>' : '') + (action ? '<div class="mt16">' + action + '</div>' : '') + '</div>';
  };
  /* 面包屑：普通导航，不需要登记功能点。list = [['列表', 'P01', 'list'], ['详情']] */
  h.crumb = function (list) {
    return '<div class="crumb" data-chrome="crumb">' + list.map(function (x) {
      return x[1] ? '<a' + h.go(x[1], x[2], x[3]) + '>' + x[0] + '</a>' : '<span>' + x[0] + '</span>';
    }).join(' / ') + '</div>';
  };
  /* 强制声明某个按钮是否为“改变数据的操作”，覆盖构建检查的自动判断 */
  h.op = function (isSubmit) { return ' data-op="' + (isSubmit ? 'submit' : 'nav') + '"'; };
  h.steps = function (names, cur) {
    return '<div class="steps">' + names.map(function (n, i) {
      var cls = i === cur ? 'on' : i < cur ? 'ok' : '';
      return '<span class="step ' + cls + '"><b>' + (i < cur ? h.i('check', 12) : i + 1) + '</b>' + n + '</span>';
    }).join('<span class="step-l"></span>') + '</div>';
  };
  h.kpi = function (k, v, sub) { return '<div class="kpi"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (sub ? '<div class="sm mut2">' + sub + '</div>' : '') + '</div>'; };
  /* 弹层：自动带 data-layer，标注只显示最高层 */
  h.modal = function (title, body, actions, o) {
    o = o || {};
    return '<div class="ov" data-layer="modal"><div class="dlg"' + h.attrs({ fn: o.fn }) + (o.w ? ' style="width:' + o.w + 'px"' : '') + '><h3>' + title + '</h3><div class="dlg-b">' + body + '</div>' + (actions ? '<div class="dlg-a">' + actions + '</div>' : '') + '</div></div>';
  };
  h.drawer = function (title, body, foot, o) {
    o = o || {};
    var close = o.close ? '<a class="lnk md" data-chrome="close" title="关闭"' + h.go(o.close[0], o.close[1]) + '>' + h.i('x', 18) + '</a>' : '';
    return '<div class="ov ov-r" data-layer="drawer"><div class="drw"' + h.attrs({ fn: o.fn }) + (o.w ? ' style="width:' + o.w + 'px"' : '') + '><div class="drw-h"><h3>' + title + '</h3>' + close + '</div><div class="drw-b">' + body + '</div>' + (foot ? '<div class="drw-f">' + foot + '</div>' : '') + '</div></div>';
  };
  h.sheet = function (body, o) {
    o = o || {};
    return '<div class="m-sheet" data-layer="sheet"><div class="sh"' + h.attrs({ fn: o.fn }) + '><div class="grab"></div>' + (o.title ? '<div class="sh-t">' + o.title + '</div>' : '') + body + '</div></div>';
  };
  h.alert = function (text, actions, o) {
    o = o || {};
    return '<div class="m-alert" data-layer="alert"><div class="al"' + h.attrs({ fn: o.fn }) + '><p>' + text + '</p><div class="ab2">' + actions + '</div></div></div>';
  };
  h.toast = function (t) { return '<div class="toast">' + t + '</div>'; };
  h.menu = function (trigger, items, o) {
    o = o || {};
    return '<div class="menu"' + h.attrs({ fn: o.fn }) + '><span data-act="menu" class="menu-t">' + trigger + '</span><div class="menu-pop">' + items.map(function (it) {
      if (it === '-') return '<div class="sep"></div>';
      return '<a' + h.attrs(it) + '>' + it.label + '</a>';
    }).join('') + '</div></div>';
  };

  /* ---------- 图标（线框描边） ---------- */
  var IC = {
    play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    pc: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
    phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    home: '<path d="M4 11l8-7 8 7M6 9.5V20h12V9.5"/>',
    book: '<path d="M4 5.5C6 4.5 9 4.5 12 6c3-1.5 6-1.5 8-.5V19c-2-1-5-1-8 .5-3-1.5-6-1.5-8-.5z"/><path d="M12 6v13.5"/>',
    user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1-3.8 4-5.8 7.5-5.8s6.5 2 7.5 5.8"/>',
    users: '<circle cx="9" cy="9" r="3.4"/><path d="M3 19.5c.8-3.3 3.2-5 6-5s5.2 1.7 6 5M15.5 5.8a3.2 3.2 0 0 1 0 6.3M17.5 14.6c1.8.6 3 2.2 3.5 4.9"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    cr: '<path d="M9.5 6l6 6-6 6"/>',
    cl: '<path d="M14.5 6l-6 6 6 6"/>',
    cd: '<path d="M6 9.5l6 6 6-6"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    chat: '<path d="M4.5 5.5h15v10h-9l-4.5 3.5v-3.5h-1.5z"/>',
    doc: '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h6"/>',
    redo: '<path d="M19 12a7 7 0 1 1-2.1-5M19 4.5V9h-4.5"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.3"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.3"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
    bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21h4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
    more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.5M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.8 1.8M16.2 16.2L18 18M6 18l1.8-1.8M16.2 7.8L18 6"/>',
    chart: '<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    send: '<path d="M4 12l16-7-6 16-3-6.5z"/><path d="M11 14.5L20 5"/>',
    star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    share: '<circle cx="6" cy="12" r="2.5"/><circle cx="17.5" cy="6" r="2.5"/><circle cx="17.5" cy="18" r="2.5"/><path d="M8.3 10.8l7-3.6M8.3 13.2l7 3.6"/>',
    box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    spk: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"/>',
    flag: '<path d="M6 21V4M6 4.5h11l-2 4 2 4H6"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>'
  };
  h.icons = Object.keys(IC);
  h.i = function (n, s) {
    s = s || 18;
    if (!IC[n]) fail('未知图标：' + n + '（可用：' + h.icons.join(' ') + '）');
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[n] || '') + '</svg>';
  };
  h.addIcons = function (map) { Object.keys(map).forEach(function (k) { IC[k] = map[k]; }); h.icons = Object.keys(IC); };

  /* ---------- PC 应用外壳 ----------
     h.app({ brand:'名称', sub:'教师端', fn:'shell-head', nav:[{label, go, st, key}], active:'key',
             right:'html', body:'html', over:'html', cls:'', home:['P01','list'] }) */
  h.app = function (o) {
    o = o || {};
    var nav = (o.nav || []).map(function (n) {
      return '<a class="' + (n.key === o.active ? 'on' : '') + '"' + (n.go ? h.go(n.go, n.st, n.set) : '') + '>' + n.label + '</a>';
    }).join('');
    var head = '<div class="hdr"' + h.attrs({ fn: o.fn }) + '><div class="logo"' + (o.home ? h.go(o.home[0], o.home[1]) : '') + '><i></i>' + (o.brand || '') + (o.sub ? '<small>' + o.sub + '</small>' : '') + '</div>' +
      (nav ? '<nav class="nav">' + nav + '</nav>' : '') + '<div class="top-r">' + (o.right || '') + '</div></div>';
    if (o.side) {
      return '<div class="pc">' + head + '<div class="pc-split"><aside class="sidenav"' + h.attrs({ fn: o.sideFn }) + '>' + o.side.map(function (n) {
        if (n.group) return '<div class="sn-g">' + n.group + '</div>';
        return '<a class="' + (n.key === o.active ? 'on' : '') + '"' + (n.go ? h.go(n.go, n.st, n.set) : '') + '>' + (n.ic ? h.i(n.ic, 16) : '') + n.label + '</a>';
      }).join('') + '</aside><div class="body ' + (o.cls || '') + '">' + (o.body || '') + '</div></div>' + (o.over || '') + '</div>';
    }
    return '<div class="pc">' + head + '<div class="body ' + (o.cls || '') + '">' + (o.body || '') + '</div>' + (o.over || '') + '</div>';
  };

  /* ---------- 手机外壳 ----------
     h.m({ title:'标题', back:['M01','list'], right:'html', body:'html', foot:'html', over:'html',
           tab:'key', tabs:{ fn:'tabbar', items:[{key,label,ic,go,st}] }, navFn:'', cls:'' })
     tabs 不传时使用 W.MTABS（可在 kit.js 中统一定义） */
  h.m = function (o) {
    o = o || {};
    var nav = '';
    if (o.title != null) {
      nav = '<div class="m-nav"' + h.attrs({ fn: o.navFn }) + '>' + (o.back ? '<a class="m-back" data-chrome="back" title="返回"' + h.go(o.back[0], o.back[1], o.back[2]) + '>' + h.i('cl', 24) + '</a>' : '') + '<span class="t">' + o.title + '</span>' + (o.right ? '<span class="m-nr">' + o.right + '</span>' : '') + '</div>';
    }
    var tabs = o.tabs || W.MTABS;
    var tab = o.tab && tabs ? '<div class="m-tab"' + h.attrs({ fn: tabs.fn }) + '>' + tabs.items.map(function (t) {
      return '<a class="' + (t.key === o.tab ? 'on' : '') + '"' + (t.go ? h.go(t.go, t.st) : '') + '>' + h.i(t.ic || 'grid', 22) + t.label + '</a>';
    }).join('') + '</div>' : '';
    return '<div class="m"><div class="m-sb"><span>9:41</span><span class="bt">5G <i></i></span></div>' + nav +
      '<div class="m-body ' + (o.cls || '') + '">' + (o.body || '') + '</div>' + (o.foot ? '<div class="m-foot"' + h.attrs({ fn: o.footFn }) + '>' + o.foot + '</div>' : '') + tab + (o.over || '') + '</div>';
  };
  h.cell = function (title, sub, o) {
    o = o || {};
    return '<div class="m-cell"' + h.attrs(o) + '>' + (o.ic ? h.i(o.ic, 20) : '') + '<div class="f1"><div class="b">' + title + '</div>' + (sub ? '<div class="sm mut2 mt4">' + sub + '</div>' : '') + '</div>' + (o.right != null ? o.right : (o.go ? h.i('cr', 18) : '')) + '</div>';
  };
})();
