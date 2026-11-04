/* 构建检查：需求完整性 + 原型与需求双向对账。构建脚本在无头浏览器中调用 W.runAudit()。 */
(function () {
  'use strict';
  var W = window.W, h = W.h, D = W.doc;
  /* 会改变业务数据的操作：按钮或链接文字含这些词时，所属功能点必须写 errors。
     以“进入、查看、去、前往、返回、打开”开头的是导航，不算。完整词表见 references/audit-codes.md */
  var SUBMIT = /提交|保存|确认|确定|发布|创建|删除|移除|撤回|撤销|作废|停用|启用|支付|付款|发送|导入|上传|通过|驳回|拒绝|下单|购买|解绑|注销|转交|归档|补签|签到|结束|取消订单|退款|申请|预约|续借|借出|归还|报名|领取|兑换/;
  var NAV_PREFIX = /^(?:进入|查看|去|前往|返回|打开|了解|预览)/;
  W.SUBMIT_WORDS = SUBMIT.source;
  var CONTROL = 'input,select,textarea,[data-ctl],[contenteditable=""],[contenteditable="true"]';
  var LAYER_ORDER = ['drawer', 'sheet', 'modal', 'popover', 'alert'];
  var NATIVE_INTERACTIVE = '[data-go],[data-act],button,a,input,select,textarea,[data-ctl]';

  function label(el) {
    var t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim();
    var tx = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      var f = el.closest('.fld');
      var lb = f && f.querySelector('.lbl');
      t = t || (lb ? lb.textContent.trim() : '') || el.name || el.id || '';
      return (el.tagName === 'SELECT' ? '下拉框' : '输入框') + (t ? '「' + t.slice(0, 20) + '」' : '');
    }
    var kind = el.tagName === 'BUTTON' || /\bbtn\b/.test(el.className) ? '按钮' : el.tagName === 'A' ? '链接' : '可点击元素';
    var s = tx || t;
    if (!s) {
      var cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      s = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '');
    }
    return kind + '「' + s.slice(0, 24) + (s.length > 24 ? '…' : '') + '」';
  }
  var NAV_CTX = 'nav,[role=navigation],[role=tablist],.nav,.m-tab,.sidenav,.sidebar,.tabs,.crumb,.breadcrumb,.menu-pop,.pager,.pagination';
  function isSubmitLike(el) {
    if (el.hasAttribute('data-op')) return el.getAttribute('data-op') === 'submit';
    /* 导航区域里的菜单项、不可点的按钮、只是打开确认弹层的按钮，都不算改变数据的操作 */
    if (el.closest(NAV_CTX)) return false;
    if (el.disabled || el.hasAttribute('disabled') || /\bdis\b/.test(typeof el.className === 'string' ? el.className : '')) return false;
    var go = el.getAttribute('data-go');
    if (go && W.pages[go]) {
      var tp = W.pages[go], tst = el.getAttribute('data-st') || (tp.states[0] && tp.states[0].id);
      var so = tp.states.find(function (x) { return x.id === tst; });
      if (so && so.layer) return false;
    }
    var cls = typeof el.className === 'string' ? el.className : '';
    if (!(el.tagName === 'BUTTON' || el.tagName === 'A' || /\bbtn\b/.test(cls) || el.getAttribute('role') === 'button' || (el.tagName === 'INPUT' && /submit|button/i.test(el.type)))) return false;
    var t = (el.textContent || el.value || '').replace(/\s+/g, '').trim();
    return t.length > 0 && t.length <= 10 && SUBMIT.test(t) && !NAV_PREFIX.test(t);
  }
  /* 内置返回、关闭按钮属于通用外壳，不算功能；只认组件生成的纯图标按钮 */
  function isChrome(el) {
    var c = el.getAttribute('data-chrome') || (el.closest('[data-chrome="crumb"]') ? 'crumb' : '');
    if (c === 'crumb') return true;
    return (c === 'back' || c === 'close') && !(el.textContent || '').trim();
  }
  function fieldKeys(f) { return (f.fields || []).map(function (x) { return x.key; }).filter(Boolean); }

  W.runAudit = async function (opts) {
    opts = opts || {};
    var R = { errors: [], warns: [], fnStates: {}, links: {}, behave: {}, interactive: 0, covered: 0, renders: 0, ignored: 0, dialogs: [] };
    var uniq = {}, unreg = {}, unregOrder = [];
    /* 交互元素按“页面 + 元素文字 + 归属”去重计数，避免同一按钮在多个状态、多个数据场景下重复计 */
    function countEl(p, el, fnId) {
      var k = p.id + '|' + label(el) + '|' + (fnId || '');
      if (!uniq[k]) { uniq[k] = 1; R.interactive++; if (fnId) R.covered++; }
    }
    function unregistered(p, s, el, preset, hint) {
      var k = p.id + '|' + label(el);
      if (!unreg[k]) { unreg[k] = { p: p, label: label(el), states: [], presets: [], hint: hint }; unregOrder.push(k); }
      var u = unreg[k];
      if (u.states.indexOf(s.label) < 0) u.states.push(s.label);
      if (preset && u.presets.indexOf(preset) < 0) u.presets.push(preset);
    }
    var seenErr = {};
    function E(code, msg, where) { var k = code + msg; if (seenErr[k]) return; seenErr[k] = 1; R.errors.push({ code: code, msg: msg, where: where || '' }); }
    function Wn(code, msg, where) { var k = 'w' + code + msg; if (seenErr[k]) return; seenErr[k] = 1; R.warns.push({ code: code, msg: msg, where: where || '' }); }
    var P = W.P;
    W.errors.forEach(function (m) { E('BOOT', m); });
    if (!P) { E('BOOT', '缺少 W.product(...)'); return finish(R); }

    /* ---------- 一、需求完整性（静态） ---------- */
    if (!P.name) E('PRODUCT', 'product.name 未填写产品名称');
    if (!P.id) E('PRODUCT', 'product.id 未填写（用于本地存储，建议英文短名）');
    if (!P.background || String(P.background).length < 20) E('PRODUCT', 'product.background 业务背景缺失或过短（至少说明谁、在什么场景、要解决什么问题）');
    if (!P.scope || !Array.isArray(P.scope.out)) E('PRODUCT', 'product.scope.out 未声明“本期不做”的内容；没有边界会导致原型自由发挥');
    else if (!P.scope.out.length) Wn('SCOPE', '“本期不做”为空，请确认是否真的没有排除项');
    if (!P.roles || !P.roles.length) E('PRODUCT', 'product.roles 未声明角色');
    if (!P.ends || !P.ends.length) E('PRODUCT', 'product.ends 未声明任何端');
    var rels = (P.releases || []).map(function (r) { return r.id; });
    if (!rels.length) E('PRODUCT', 'product.releases 至少需要一个版本，例如 [{ id: "V1.0", date: "2026-11-03", summary: "首版" }]');
    function checkChanges(x, where) {
      (x && x.changes || []).forEach(function (c) {
        if (rels.indexOf(c.ver) < 0) E('RELEASE', where + '：changes 引用了未登记的版本「' + c.ver + '」');
        if (['added', 'modified', 'removed'].indexOf(c.type) < 0) E('RELEASE', where + '：changes.type 只能是 added / modified / removed');
        if (c.type !== 'added' && !c.note) E('RELEASE', where + '：' + c.ver + ' 的修改或移除需要写 note 说明原因');
      });
    }
    D.items(P.rules).forEach(function (r, i) { checkChanges(r, '全局规则 ' + (i + 1)); });
    D.items(P.goals).forEach(function (r, i) { checkChanges(r, '建设目标 ' + (i + 1)); });
    D.items(P.scope && P.scope.out).forEach(function (r, i) { checkChanges(r, '本期不做 ' + (i + 1)); });
    D.items(P.nfr).forEach(function (r, i) { checkChanges(r, '非功能要求 ' + (i + 1)); });
    (P.roles || []).forEach(function (r) { checkChanges(r, '角色「' + r.name + '」'); });
    (P.dict || []).forEach(function (d) { checkChanges(d, '数据字典「' + d.name + '」'); (d.fields || []).forEach(function (x) { checkChanges(x, '数据字典「' + d.name + '」字段「' + x.name + '」'); }); });
    (P.todo || []).forEach(function (t, i) { if (typeof t === 'object') checkChanges(t, '全局待确认 ' + (i + 1)); });
    (P.flows || []).forEach(function (f) { checkChanges(f, '流程「' + f.name + '」'); });

    /* 未知字段：多半是拼写错误或放错了位置（如在字段上写 src），只提醒不阻止 */
    var KNOWN = {
      page: 'id end group title goal entry perm scenarios states fns rules todo render after acts changes match enter host',
      state: 'id label when layer set enter match changes',
      fn: 'id name desc fields rules errors empty perm src status statusNote ui gap dot sel text changes ac',
      field: 'key name type required def options rule status statusNote changes',
      product: 'id name date fidelity version current releases background goals scope roles ends groups rules nfr dict flows sections todo demo scenarios clarify out demoNote outOfScope'
    };
    function unknown(obj, kind, where) {
      if (!obj || typeof obj !== 'object') return;
      var ok = KNOWN[kind].split(' ');
      Object.keys(obj).forEach(function (k) { if (ok.indexOf(k) < 0) Wn('UNKNOWN_KEY', where + ' 有未识别的字段「' + k + '」，不会生效（可用：' + ok.join(' ') + '）'); });
    }
    unknown(P, 'product', 'product');
    (P.ends || []).forEach(function (e) {
      if (!e.id || !e.name) E('END', '每个端都需要 id 和 name');
      if (['pc', 'mobile'].indexOf(e.device) < 0) E('END', '端「' + e.name + '」的 device 只能是 pc 或 mobile');
      if (!(W.order[e.id] || []).length) E('END', '端「' + e.name + '」没有页面');
      if (e.home && !W.pages[e.home]) E('END', '端「' + e.name + '」的 home 页面「' + e.home + '」不存在');
      (e.ignore || []).forEach(function (ig) { if (typeof ig === 'string' || !ig.why || !ig.sel) E('HOST', '端「' + e.name + '」的 ignore 每一项都要写成 { sel, name, why }，说明为什么原型里有但不纳入本次需求'); });
      if ((W.order[e.id] || []).some(function (id) { return W.host.isHosted(W.pages[id]); }) && W.host.html(e.id) == null) E('HOST', '端「' + e.name + '」有托管页面，但构建产物中没有托管原型（检查 end.host 文件路径）');
    });
    var presetIds = W.presets().map(function (x) { return x.id; });
    W.sharedGroups.forEach(function (g) {
      if (g.end !== '*' && !W.end(g.end)) E('SHARED', '公共组件「' + (g.title || g.id) + '」的 end「' + g.end + '」不存在');
      if (!g.title) E('SHARED', '公共组件 ' + g.id + ' 缺少 title');
      g.fns.forEach(function (f) { checkFn(f, null, '公共组件「' + (g.title || g.id) + '」'); unknown(f, 'fn', '公共组件「' + (g.title || g.id) + '」功能点「' + (f.name || f.id) + '」'); });
    });
    var sharedIds = {};
    W.sharedGroups.forEach(function (g) { g.fns.forEach(function (f) { var k = g.end + ':' + f.id; if (sharedIds[k]) E('FN_DUP', '公共组件功能点 ID 重复：' + f.id); sharedIds[k] = 1; }); });

    function checkFn(f, p, where) {
      var w = where + ' · 功能点「' + (f.name || f.id) + '」';
      if (!f.id) E('FN', where + '：有功能点缺少 id');
      if (!f.name) E('FN', w + ' 缺少 name');
      if (D.removed(f)) { checkChanges(f, w); return; }
      if (f.gap != null && (typeof f.gap !== 'string' || f.gap.length < 4)) E('FN', w + ' 的 gap 要写成一句话：原型里缺了什么、以哪份需求为准');
      if (!f.desc || String(f.desc).replace(/\s/g, '').length < 8) E('FN_DESC', w + ' 缺少交互说明 desc（写清用户怎么操作、系统怎么响应，至少一句完整的话）');
      var st = f.status;
      if (st && ['pending', 'assumed', 'confirmed'].indexOf(st) < 0) E('FN_SRC', w + ' 的 status 只能是 confirmed / pending / assumed');
      if (!f.src && st !== 'pending' && st !== 'assumed') E('FN_SRC', w + ' 没有来源 src；有依据就写来源（如“需求材料 §2”“澄清 Q3”），没有依据就标 status: "assumed"（AI 假设）或 "pending"（待确认）');
      /* 验收条件 ac（可选）：写了就必须有用户操作和预期结果 */
      if (f.ac != null) {
        if (typeof f.ac !== 'object' || Array.isArray(f.ac)) E('AC', w + ' 的 ac 要写成对象 { pre, act, expect }（前置条件、用户操作、预期结果）');
        else {
          if (f.ac.pre != null && typeof f.ac.pre !== 'string') E('AC', w + ' 的 ac.pre（前置条件）要写成文字');
          if (!f.ac.act || typeof f.ac.act !== 'string' || f.ac.act.replace(/\s/g, '').length < 4) E('AC', w + ' 的 ac 缺少 act（用户操作），要写成一句完整的话');
          if (!f.ac.expect || typeof f.ac.expect !== 'string' || f.ac.expect.replace(/\s/g, '').length < 4) E('AC', w + ' 的 ac 缺少 expect（预期结果），要写成一句完整的话');
          Object.keys(f.ac).forEach(function (k) { if (['pre', 'act', 'expect'].indexOf(k) < 0) Wn('UNKNOWN_KEY', w + ' 的 ac 有未识别的字段「' + k + '」（可用：pre、act、expect）'); });
        }
      }
      (f.fields || []).forEach(function (x) {
        var fw = w + ' 的字段「' + (x.name || x.key || '?') + '」';
        if (!x.name) E('FIELD', fw + ' 缺少 name');
        if (!x.type) E('FIELD', fw + ' 缺少 type（如 文本 / 数字 / 枚举 / 日期 / 金额 / 文件）');
        if (!x.rule && !x.options) E('FIELD', fw + ' 缺少 rule（校验、格式、口径或来源）或 options（可选值）');
        if (x.required != null && typeof x.required !== 'boolean') E('FIELD', fw + ' 的 required 只能写 true 或 false');
        checkChanges(x, fw);
      });
      checkChanges(f, w);
      D.items(f.rules).forEach(function (r, i) { checkChanges(r, w + ' 规则 ' + (i + 1)); });
      D.items(f.errors).forEach(function (r, i) { checkChanges(r, w + ' 异常 ' + (i + 1)); });
      if (p && sharedIds[p.end + ':' + f.id]) E('FN_DUP', w + ' 的 ID 与本端公共组件重名，data-fn 会无法区分');
    }

    var pageList = [];
    (P.ends || []).forEach(function (e) { (W.order[e.id] || []).forEach(function (id) { pageList.push(W.pages[id]); }); });
    pageList.forEach(function (p) {
      var where = p.id + ' ' + (p.title || '');
      unknown(p, 'page', where);
      p.states.forEach(function (s) { unknown(s, 'state', where + ' 状态「' + (s.label || s.id) + '」'); checkChanges(s, where + ' 状态「' + (s.label || s.id) + '」'); });
      p.fns.forEach(function (f) { unknown(f, 'fn', where + ' 功能点「' + (f.name || f.id) + '」'); (f.fields || []).forEach(function (x) { unknown(x, 'field', where + ' 功能点「' + (f.name || f.id) + '」的字段「' + (x.name || x.key) + '」'); }); });
      if (!p.title) E('PAGE', p.id + ' 缺少 title');
      if (!p.goal) E('PAGE', where + ' 缺少页面目标 goal（谁在什么情况下用这个页面完成什么）');
      if (!p.states.length) E('STATE', where + ' 没有声明页面状态 states（至少一个默认状态）');
      var sids = {};
      p.states.forEach(function (s) {
        if (!s.id || !s.label) E('STATE', where + '：状态需要 id 和 label');
        if (sids[s.id]) E('STATE', where + '：状态 ID 重复「' + s.id + '」');
        sids[s.id] = 1;
        if (!s.when || String(s.when).length < 4) E('STATE_WHEN', where + ' 的状态「' + (s.label || s.id) + '」缺少出现条件 when（什么数据或操作下会看到这个状态）');
        if (s.layer && ['modal', 'drawer', 'sheet', 'alert', 'popover'].indexOf(s.layer) < 0) E('STATE', where + ' 的状态「' + s.label + '」layer 只能是 modal / drawer / sheet / alert / popover');
        if (s.set) checkSet(s.set, where + ' 状态「' + s.label + '」');
      });
      var fids = {};
      p.fns.forEach(function (f) {
        if (fids[f.id]) E('FN_DUP', where + '：功能点 ID 重复「' + f.id + '」');
        fids[f.id] = 1;
        checkFn(f, p, where);
      });
      D.items(p.rules).forEach(function (r, i) { checkChanges(r, where + ' 页面规则 ' + (i + 1)); });
      checkChanges(p, where);
      if (W.host.isHosted(p)) {
        p.fns.forEach(function (f) { if (!f.sel && f.ui !== false && !f.gap && !D.removed(f)) E('HOST_SEL', where + ' · 功能点「' + f.name + '」是托管页面，需要 sel（CSS 选择器）绑定原型元素，或在原型副本上加 data-fn="' + f.id + '"', where); });
        if (!p.match && !p.states.some(function (s) { return s.match; })) Wn('HOST_MATCH', where + ' 没有 match，在原型里点击跳转到此页时，右侧需求面板无法自动切换');
      }
    });
    function checkSet(set, where) {
      var str = typeof set === 'string' ? set : '';
      var m = /(?:^|;)\s*preset\s*=\s*([^;]+)/.exec(str);
      if (m && presetIds.indexOf(m[1].trim()) < 0) E('PRESET', where + ' 引用了未登记的演示预设「' + m[1].trim() + '」');
      if (typeof set === 'object' && set.preset && presetIds.indexOf(set.preset) < 0) E('PRESET', where + ' 引用了未登记的演示预设「' + set.preset + '」');
    }
    (P.flows || []).forEach(function (f) {
      if (!f.id || !f.name) E('FLOW', '核心流程需要 id 和 name');
      if (!f.steps || !f.steps.length) E('FLOW', '流程「' + f.name + '」没有步骤');
      (f.steps || []).forEach(function (s, i) {
        var p = W.pages[s.p];
        if (!p) E('FLOW', '流程「' + f.name + '」第 ' + (i + 1) + ' 步的页面「' + s.p + '」不存在');
        else if (s.st && !p.states.some(function (x) { return x.id === s.st; })) E('FLOW', '流程「' + f.name + '」第 ' + (i + 1) + ' 步的状态「' + s.st + '」在 ' + s.p + ' 中不存在');
        if (!s.tip) Wn('FLOW', '流程「' + f.name + '」第 ' + (i + 1) + ' 步没有 tip，演示时不知道下一步点哪里');
        if (s.set) checkSet(s.set, '流程「' + f.name + '」第 ' + (i + 1) + ' 步');
      });
      if (f.preset) checkSet('preset=' + f.preset, '流程「' + f.name + '」');
    });

    /* 需求文字中的图片必须内嵌，交付文件才能离线打开 */
    (function scanText() {
      var bad = [];
      function walk(v, where) {
        if (typeof v === 'string') {
          var m = /!\[[^\]]*\]\(\s*(?!data:image\/)([^)\s]+)|<img\b[^>]*\bsrc\s*=\s*["']?(?!data:image\/)([^"'\s>]+)/i.exec(v);
          if (m) bad.push(where + '：' + (m[1] || m[2]).slice(0, 60));
          if (/\uFFFD|锟斤拷|烫烫烫/.test(v)) E('TEXT', where + ' 出现乱码字符');
          if (/\b(?:TODO|TBD|lorem ipsum)\b|待补充|此处填写|XXX{2,}/i.test(v)) E('TEXT', where + ' 还有占位文字：' + v.slice(0, 40));
        } else if (Array.isArray(v)) v.forEach(function (x, i) { walk(x, where); });
        else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { if (typeof v[k] !== 'function' && k !== 'enter' && k !== 'boot' && k !== 'demo') walk(v[k], where); });
      }
      walk(P, 'product');
      Object.keys(W.pages).forEach(function (id) { walk(W.pages[id], id + ' ' + (W.pages[id].title || '')); });
      W.sharedGroups.forEach(function (g) { walk(g, '公共组件「' + (g.title || g.id) + '」'); });
      bad.slice(0, 20).forEach(function (m) { E('IMG_SRC', m + ' —— 需求文字里的图片必须是 data:image/... 内嵌，不能引用本地路径或网址'); });
    })();

    /* ---------- 二、原型 ↔ 需求对账（渲染每个页面的每个状态） ---------- */
    var seen = {};          /* seen[pid][fid] = [stateIds] */
    var seenShared = {};    /* seenShared[end:fid] = true */
    var fnBox = {};         /* 功能点是否包含控件/列表/提交类按钮 */
    function mark(pid, fid, sid) {
      seen[pid] = seen[pid] || {};
      var a = seen[pid][fid] = seen[pid][fid] || [];
      if (a.indexOf(sid) < 0) a.push(sid);
    }
    function need(p, ref, kind, sample, where) {
      var key = (ref.shared ? 'S:' + p.end : p.id) + ':' + ref.fn.id;
      var b = fnBox[key] = fnBox[key] || { fn: ref.fn, where: where, ctl: [], list: false, submit: [], fieldsBound: {} };
      if (kind === 'ctl' && b.ctl.indexOf(sample) < 0) b.ctl.push(sample);
      if (kind === 'list') b.list = true;
      if (kind === 'submit' && b.submit.indexOf(sample) < 0) b.submit.push(sample);
      if (kind === 'field') b.fieldsBound[sample] = 1;
    }

    var saved = JSON.stringify(W.store);
    var prevNoSave = W._noSave;
    W._noSave = true;
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-40000px;top:0;width:1280px;height:900px;overflow:hidden;visibility:hidden';
    box.innerHTML = '<div class="scr"><div class="ab"></div></div>';
    document.body.appendChild(box);
    var ab = box.querySelector('.ab');
    var defaults = JSON.stringify(W.P.demo || {});

    for (var pi = 0; pi < pageList.length; pi++) {
      var p = pageList[pi];
      if (W.host.isHosted(p)) continue;
      var e = W.end(p.end) || {};
      box.style.width = (e.width || (e.device === 'mobile' ? 375 : 1280)) + 'px';
      ab.setAttribute('data-device', e.device === 'mobile' ? 'mobile' : 'pc');
      W.device = e.device === 'mobile' ? 'mobile' : 'pc';
      var sets = [null].concat(presetIds);
      for (var si = 0; si < p.states.length; si++) {
        var s = p.states[si];
        var where = p.id + ' ' + p.title + ' · 状态「' + s.label + '」';
        for (var k = 0; k < sets.length; k++) {
          /* 与浏览时一致：进入状态时应用 state.set，之后评审者还可以切换任意数据场景 */
          W.store = JSON.parse(defaults);
          if (s.set) W.applySet(s.set);
          if (sets[k]) W.applySet('preset=' + sets[k]);
          var ctx = { st: s.id, s: W.store, p: p, q: {}, end: e, audit: true };
          var html;
          try { html = p.render(ctx); } catch (err) { E('RENDER', where + ' 渲染出错：' + (err && err.message || err) + (sets[k] ? '（数据场景 ' + sets[k] + '）' : '')); break; }
          if (typeof html !== 'string') { E('RENDER', where + ' 的 render 没有返回 HTML 字符串'); continue; }
          R.renders++;
          ab.innerHTML = html;
          if (p.after) { try { p.after(ab, ctx); } catch (err) { E('RENDER', where + ' 的 after() 出错：' + (err && err.message || err)); } }
          scanNative(p, s, where, sets[k]);
        }
      }
    }
    function topLayer(root) {
      var ls = Array.prototype.slice.call(root.querySelectorAll('[data-layer]'));
      if (!ls.length) return null;
      ls.sort(function (a, b) { return LAYER_ORDER.indexOf(a.getAttribute('data-layer')) - LAYER_ORDER.indexOf(b.getAttribute('data-layer')); });
      return ls[ls.length - 1];
    }
    /* 弹层下方的底层页面可能来自其他页面（如列表上的详情抽屉），按 ID 在同端页面中查找 */
    function findAny(p, id) {
      var r = W.findFn(p, id);
      if (r) return r;
      var ids = W.order[p.end] || [];
      for (var i = 0; i < ids.length; i++) { var q = W.pages[ids[i]]; var f = q.fns.find(function (x) { return x.id === id; }); if (f) return { fn: f, page: q, shared: false, other: true }; }
      return null;
    }
    function scanNative(p, s, where, preset) {
      var shell = ab.firstElementChild;
      var top = topLayer(ab);
      var scope = top || ab;
      if (s.layer && !top) Wn('LAYER', where + ' 声明为弹层（' + s.layer + '），但渲染结果里没有弹层组件（h.modal / h.drawer / h.sheet / h.alert）');
      if (!s.layer && top) Wn('LAYER', where + ' 渲染出了弹层，但状态没有声明 layer；请在 states 中写 layer: "' + top.getAttribute('data-layer') + '"');
      /* data-fn 必须能解析；弹层状态只核对最高层 */
      ab.querySelectorAll('[data-fn]').forEach(function (el) {
        var id = el.getAttribute('data-fn');
        var inTop = !top || top.contains(el) || el.contains(top);
        var ref = inTop ? W.findFn(p, id) : findAny(p, id);
        if (!ref) { E('FN_UNKNOWN', where + '：原型里 data-fn="' + id + '" 没有对应的功能点（本页 fns 或本端公共组件里都找不到）'); return; }
        if (ref.other) return;
        if (D.removed(ref.fn)) E('FN_REMOVED', where + '：功能点「' + ref.fn.name + '」已标记移除，但原型里还在显示');
        if (el === shell || el === ab) E('FN_ROOT', where + '：功能点「' + ref.fn.name + '」绑定在整个页面外壳上，范围过大；请绑定到具体区域');
        if (ref.shared) seenShared[p.end + ':' + id] = true;
        else if (!top || top.contains(el)) mark(p.id, id, s.id);
      });
      /* 每个可交互元素都必须属于某个功能点 */
      var els = Array.prototype.slice.call(scope.querySelectorAll(NATIVE_INTERACTIVE)).filter(function (el) { return !el.closest('[data-demo]') && !isChrome(el); });
      var uncovered = [];
      var perFn = {};
      els.forEach(function (el) {
        var o = el.closest('[data-fn]');
        var ref = o && W.findFn(p, o.getAttribute('data-fn'));
        countEl(p, el, ref && ref.fn.id);
        if (!ref) { uncovered.push(el); return; }
        if (!el.closest('[data-list]')) perFn[ref.fn.id] = (perFn[ref.fn.id] || 0) + 1;
        if (el.matches(CONTROL)) need(p, ref, 'ctl', label(el), where);
        if (isSubmitLike(el)) need(p, ref, 'submit', label(el), where);
      });
      uncovered.filter(function (el) { return !uncovered.some(function (x) { return x !== el && x.contains(el); }); }).forEach(function (el) {
        unregistered(p, s, el, preset, '它若是需求，请在本页 fns 登记并用 data-fn 绑定；若不是需求，请从原型删除；若只是演示切换，请放进 h.demo()');
      });
      Object.keys(perFn).forEach(function (id) { if (perFn[id] > 15) Wn('FN_BROAD', where + '：功能点「' + id + '」下有 ' + perFn[id] + ' 个可交互元素，可能把多个功能混在一起，建议拆分'); });
      scope.querySelectorAll('[data-list]').forEach(function (el) {
        var o = el.closest('[data-fn]');
        var ref = o && W.findFn(p, o.getAttribute('data-fn'));
        if (ref) need(p, ref, 'list', '', where);
        else E('UNREGISTERED', where + '：有列表或表格不属于任何功能点，列表的字段口径无处说明');
      });
      scope.querySelectorAll('[data-field]').forEach(function (el) {
        var o = el.closest('[data-fn]');
        var ref = o && W.findFn(p, o.getAttribute('data-fn'));
        var key = el.getAttribute('data-field');
        if (!ref) return;
        if (fieldKeys(ref.fn).indexOf(key) < 0) E('FIELD_UNDECLARED', where + '：元素 data-field="' + key + '" 没有在功能点「' + ref.fn.name + '」的 fields 中定义');
        var dec = (ref.fn.fields || []).find(function (x) { return x.key === key; });
        /* 必填一致性以 h.fld 为准（只有它带组件级校验）。data-field 可以写在 h.fld 上，也可以只写在控件上。
           写在 h.fld 上时由这里检查；只写在控件上时由所在的 h.fld 检查，避免同一个字段报两次。 */
        var fld = el.classList.contains('fld') ? el : (el.matches(CONTROL) && !el.closest('.fld[data-field]') ? el.closest('.fld') : null);
        if (dec && typeof dec.required === 'boolean' && fld) {
          var has = fld.hasAttribute('data-req');
          if (has !== dec.required) E('FIELD_REQ', where + '：字段「' + (dec.name || key) + '」在 fields 中是 required: ' + dec.required + '，界面上的 h.fld 却是' + (has ? '必填' : '非必填') + '。两边要一致：h.fld 写 req: 1，或把 fields 改成对应的值');
        }
        if (el.matches(CONTROL) || el.querySelector(CONTROL)) need(p, ref, 'field', key, where);
      });
      /* 组件行为（必填、长度、提交、筛选）转成规则，写进需求文档 */
      W.behaveCollect(scope).forEach(function (x) {
        var m = R.behave[p.id] = R.behave[p.id] || {};
        var l = m[x.fn] = m[x.fn] || [];
        if (l.indexOf(x.text) < 0) l.push(x.text);
      });
      /* 跳转目标 */
      scope.querySelectorAll('[data-go]').forEach(function (el) {
        var id = el.getAttribute('data-go'), st = el.getAttribute('data-st') || '';
        if (id === 'back') return;
        var tp = W.pages[id];
        if (!tp) { E('GO_TARGET', where + '：' + label(el) + ' 跳转到不存在的页面「' + id + '」'); return; }
        if (st && !tp.states.some(function (x) { return x.id === st; })) { E('GO_TARGET', where + '：' + label(el) + ' 跳转到 ' + id + ' 不存在的状态「' + st + '」'); return; }
        if (el.closest('[data-demo]')) return;
        var L = R.links[id] = R.links[id] || [];
        var lb = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18) || el.getAttribute('title') || '（图标）';
        if (id === p.id) return;
        if (!L.some(function (x) { return x.from === p.id && x.label === lb && x.st === st; })) L.push({ from: p.id, fromSt: s.id, label: lb, st: st });
      });
    }

    /* 托管页面：逐状态加载原有 HTML */
    var hostedPages = pageList.filter(function (p) { return W.host.isHosted(p); });
    if (hostedPages.length) {
      /* 每个托管端一个隐藏 iframe，name 为 prd-host-audit-<端 id>，构建脚本据此把网络请求归到对应端 */
      var hostFrames = {};
      for (var hi = 0; hi < hostedPages.length; hi++) {
        var hp = hostedPages[hi];
        var he = W.end(hp.end);
        if (!he || W.host.html(he.id) == null) continue;
        var frame = hostFrames[he.id];
        if (!frame) {
          frame = document.createElement('iframe');
          frame.name = 'prd-host-audit-' + he.id;
          frame.setAttribute('aria-hidden', 'true');
          document.body.appendChild(frame);
          hostFrames[he.id] = frame;
        }
        var sz = W.host.size(he);
        frame.style.cssText = 'position:fixed;left:-40000px;top:0;border:0;width:' + sz.w + 'px;height:' + sz.h + 'px';
        for (var hs = 0; hs < hp.states.length; hs++) {
          var st = hp.states[hs];
          var hw = hp.id + ' ' + hp.title + ' · 状态「' + st.label + '」';
          try {
            await W.host.enter(frame, he, hp, st, null, { shim: true });
          } catch (err) { E('HOST_ENTER', hw + ' 进入步骤执行失败：' + (err && err.message || err)); continue; }
          var dl = (frame.contentWindow && frame.contentWindow.__prdDialogs) || [];
          if (dl.length) Wn('HOST_DIALOG', hw + '：进入步骤触发了原生对话框（' + dl.map(function (d) { return d[0] + '「' + d[1].slice(0, 20) + '」'; }).join('、') + '）。检查时已自动确认；原生对话框无法标注，请把它的规则写进触发它的功能点'); 
          R.renders++;
          var win = frame.contentWindow;
          var m = W.host.stateMatch(hp, st);
          if (m && !W.host.match(win, m)) E('HOST_ENTER', hw + '：执行进入步骤后，match 条件不成立（' + JSON.stringify(m) + '）。请检查 enter 或 match');
          scanHosted(hp, st, he, win, hw);
        }
      }
      Object.keys(hostFrames).forEach(function (k) { hostFrames[k].remove(); });
    }
    function scanHosted(p, s, e, win, where) {
      var doc = win.document;
      var root = W.host.layerRoot(doc, p, s);
      var all = W.host.interactive(root);
      var els = all.filter(function (el) { return !W.host.ignored(el, e); });
      R.ignored += all.length - els.length;
      var uncovered = [], perFn = {};
      els.forEach(function (el) {
        var o = W.host.owner(el, p);
        countEl(p, el, o && o.fn.id);
        if (!o) { uncovered.push(el); return; }
        if (o.el === doc.body || o.el === doc.documentElement) E('FN_ROOT', where + '：功能点「' + o.fn.name + '」的 sel 匹配到了整个页面，范围过大');
        if (D.removed(o.fn)) E('FN_REMOVED', where + '：功能点「' + o.fn.name + '」已标记移除，但原型里还在显示');
        if (!el.closest('table')) perFn[o.fn.id] = (perFn[o.fn.id] || 0) + 1;
        var ref = { fn: o.fn, shared: o.shared };
        if (el.matches(CONTROL)) need(p, ref, 'ctl', label(el), where);
        if (isSubmitLike(el)) need(p, ref, 'submit', label(el), where);
      });
      uncovered.filter(function (el) { return !uncovered.some(function (x) { return x !== el && x.contains(el); }); }).forEach(function (el) {
        unregistered(p, s, el, null, '它若是需求，请登记功能点并用 sel 绑定；若不纳入本次需求，请加入 end.ignore 并写明原因');
      });
      Object.keys(perFn).forEach(function (id) { if (perFn[id] > 15) Wn('FN_BROAD', where + '：功能点「' + id + '」下有 ' + perFn[id] + ' 个可交互元素，可能把多个功能混在一起，建议拆分'); });
      p.fns.concat(W.sharedFns(p.end).map(function (x) { return x.fn; })).forEach(function (f) {
        var shared = p.fns.indexOf(f) < 0;
        var vis = W.host.fnEls(root, f, true);
        if (!vis.length) return;
        if (shared) seenShared[p.end + ':' + f.id] = true;
        else mark(p.id, f.id, s.id);
        if (vis.some(function (el) { return el.tagName === 'TABLE' || el.querySelector('table,[role=list],[role=grid]'); })) need(p, { fn: f, shared: shared }, 'list', '', where);
      });
    }

    unregOrder.forEach(function (k) {
      var u = unreg[k];
      E('UNREGISTERED', u.p.id + ' ' + u.p.title + '：' + u.label + ' 不属于任何功能点（出现在状态：' + u.states.join('、') + (u.presets.length ? '；数据场景：' + u.presets.join('、') : '') + '）。' + u.hint);
    });
    document.body.removeChild(box);
    W.store = JSON.parse(saved);
    W._noSave = prevNoSave;

    /* 需求有、原型没有 */
    pageList.forEach(function (p) {
      var hosted = W.host.isHosted(p);
      p.fns.forEach(function (f) {
        if (D.removed(f) || f.ui === false) return;
        if (f.gap) {
          if (!hosted) Wn('GAP_NATIVE', p.id + ' ' + p.title + ' · 功能点「' + f.name + '」写了 gap（原型未体现）。原生线框原型应直接画出来，gap 只用于已有 HTML');
          if (seen[p.id] && seen[p.id][f.id]) Wn('GAP', p.id + ' · 功能点「' + f.name + '」写了 gap，但原型里能找到它绑定的元素，请确认是否已经画出');
          return;
        }
        if (!(seen[p.id] && seen[p.id][f.id])) {
          E('FN_UNUSED', p.id + ' ' + p.title + ' · 功能点「' + f.name + '」在任何状态的原型里都没有出现。' + (hosted
            ? '托管页面请依次排查：sel 是否写对（用 probe-host.mjs 核对）；元素是否在 iframe 里被原型自己隐藏（可用 end.boot 处理）；原型确实没有这个功能时写 gap 说明“原型未体现、以需求为准”'
            : '请在原型中实现并绑定，或者删掉这条需求；纯后台逻辑请写 ui: false'));
        }
      });
    });
    W.sharedGroups.forEach(function (g) {
      g.fns.forEach(function (f) {
        if (D.removed(f) || f.ui === false) return;
        var ends = g.end === '*' ? (P.ends || []).map(function (e) { return e.id; }) : [g.end];
        if (!ends.some(function (en) { return seenShared[en + ':' + f.id]; })) E('FN_UNUSED', '公共组件「' + g.title + '」· 功能点「' + f.name + '」没有在任何页面出现');
      });
    });
    /* 核心流程里出现的功能点建议写 ac，测试可直接据此写用例；只提醒，不阻止交付 */
    /* 按页面汇总：同一页面的未写 ac 功能点合并成一条提醒，避免样例里逐条刷屏 */
    (function acHints() {
      var done = {}, byPage = [], byId = {};
      (P.flows || []).forEach(function (fl) {
        (fl.steps || []).forEach(function (s) {
          var sp = W.pages[s.p];
          if (!sp) return;
          sp.fns.forEach(function (f) {
            var key = sp.id + '/' + f.id;
            var sts = (seen[sp.id] && seen[sp.id][f.id]) || [];
            if (done[key] || D.removed(f) || f.ui === false || f.ac) return;
            if (s.st && sts.indexOf(s.st) < 0) return;
            done[key] = 1;
            if (!byId[sp.id]) { byId[sp.id] = { page: sp, names: [], flows: [] }; byPage.push(byId[sp.id]); }
            byId[sp.id].names.push('「' + f.name + '」');
            if (byId[sp.id].flows.indexOf(fl.name) < 0) byId[sp.id].flows.push(fl.name);
          });
        });
      });
      byPage.forEach(function (b) {
        Wn('AC_MISSING', b.page.id + ' ' + b.page.title + ' · 核心流程「' + b.flows.join('」「') + '」中有 ' + b.names.length + ' 个功能点未写 ac：' + b.names.join('、') + '。建议写 ac（前置条件、用户操作、预期结果），测试可直接据此写用例');
      });
    })();
    /* 字段、列表、提交类操作的说明是否完整 */
    Object.keys(fnBox).forEach(function (k) {
      var b = fnBox[k], f = b.fn, nm = '功能点「' + f.name + '」（' + b.where.split(' · ')[0] + '）';
      if (b.ctl.length && !(f.fields || []).length) E('FIELD_MISSING', nm + ' 包含 ' + b.ctl.slice(0, 3).join('、') + (b.ctl.length > 3 ? ' 等 ' + b.ctl.length + ' 个控件' : '') + '，但没有定义 fields（类型、必填、校验、默认值）');
      var noneReq = b.ctl.length && (f.fields || []).length && !(f.fields || []).some(function (x) { return typeof x.required === 'boolean'; });
      if (noneReq) E('FIELD_MISSING', nm + ' 有输入控件，但 fields 都没有写 required: true / false');
      if (!noneReq) Object.keys(b.fieldsBound).forEach(function (key) {
        var x = (f.fields || []).find(function (y) { return y.key === key; });
        if (x && typeof x.required !== 'boolean') E('FIELD', nm + ' 的字段「' + (x.name || key) + '」绑定了输入控件，需要写 required: true / false');
      });
      if (b.list && !(f.fields || []).length) E('LIST_FIELDS', nm + ' 是列表或表格，需要用 fields 定义每一列/每一项的含义、格式和来源');
      if (b.list && !f.empty) E('LIST_EMPTY', nm + ' 是列表或表格，需要写 empty：没有数据时显示什么、能做什么');
      if (b.submit.length && !D.items(f.errors).length) E('ERRORS', nm + ' 包含 ' + b.submit.slice(0, 3).join('、') + '，需要写 errors：失败、重复提交、权限不足或网络异常时怎么处理');
    });
    /* 可达性 */
    pageList.forEach(function (p) {
      var e = W.end(p.end);
      if (W.host.isHosted(p)) return;
      var inFlow = (P.flows || []).some(function (f) { return f.steps.some(function (s) { return s.p === p.id; }); });
      if (!(R.links[p.id] || []).length && !(e && e.home === p.id) && !inFlow && (W.order[p.end] || [])[0] !== p.id) Wn('UNREACHABLE', p.id + ' ' + p.title + ' 没有任何入口跳转到它（不在首页、流程中，也没有按钮链接过来）');
    });
    R.fnStates = seen;
    if (R.ignored) Wn('IGNORED', '有 ' + R.ignored + ' 个原型元素按 end.ignore 标为不纳入本次需求，未计入覆盖率');
    return finish(R);
  };

  /* 范围基线：页面、状态、功能点（含公共组件功能点）的清单。key 稳定，用于和 prd/scope.json 对比 */
  W.scopeInventory = function () {
    var P = W.P, out = { pages: [], states: [], fns: [] };
    if (!P || !W.order) return out;
    (P.ends || []).forEach(function (e) {
      (W.order[e.id] || []).forEach(function (id) {
        var p = W.pages[id];
        if (!p) return;
        var pl = (p.title || '');
        out.pages.push({ k: p.id, l: p.id + ' ' + pl });
        (p.states || []).forEach(function (s) { out.states.push({ k: p.id + '/' + s.id, l: p.id + ' ' + pl + ' · 状态「' + (s.label || s.id) + '」' }); });
        (p.fns || []).forEach(function (f) { out.fns.push({ k: p.id + '/' + f.id, l: p.id + ' ' + pl + ' · 功能点「' + (f.name || f.id) + '」' }); });
      });
    });
    W.sharedGroups.forEach(function (g) {
      (g.fns || []).forEach(function (f) { out.fns.push({ k: '公共/' + (g.id || '') + '/' + f.id, l: '公共组件「' + (g.title || g.id) + '」 · 功能点「' + (f.name || f.id) + '」' }); });
    });
    return out;
  };
  /* 读取构建时嵌入的基线（prd/scope.json），没有则返回 null */
  W.scopeBaseline = function () {
    var el = document.getElementById('prd-scope');
    try { var t = el && el.textContent.trim(); return t ? JSON.parse(t) : null; } catch (e) { return null; }
  };
  /* 当前清单与基线对比：返回 null 表示没有基线。新增和移除都只提醒，不阻止交付 */
  W.scopeDiff = function () {
    var base = W.scopeBaseline();
    if (!base) return null;
    var inv = W.scopeInventory(), added = [], removed = [];
    var kinds = { pages: '页面', states: '状态', fns: '功能点' };
    ['pages', 'states', 'fns'].forEach(function (kind) {
      var have = base[kind] || [];
      var cur = inv[kind];
      var curKeys = cur.map(function (x) { return x.k; });
      cur.forEach(function (x) { if (have.indexOf(x.k) < 0) added.push({ kind: kinds[kind], key: x.k, label: x.l }); });
      have.forEach(function (k) { if (curKeys.indexOf(k) < 0) removed.push({ kind: kinds[kind], key: k }); });
    });
    return { release: base.release || '', confirmedAt: base.confirmedAt || '', added: added, removed: removed };
  };

  function finish(R) {
    var st = D.stats();
    W.behaveApply({ behave: R.behave });
    return {
      behave: R.behave,
      ok: R.errors.length === 0,
      at: new Date().toISOString(),
      release: st.release,
      errors: R.errors,
      warns: R.warns,
      stats: Object.assign(st, { interactive: R.interactive, covered: R.covered, ignored: R.ignored || 0, renders: R.renders, errors: R.errors.length, warns: R.warns.length }),
      fnStates: R.fnStates,
      links: R.links,
      inventory: W.scopeInventory(),
      scope: W.scopeDiff()
    };
  }
})();
