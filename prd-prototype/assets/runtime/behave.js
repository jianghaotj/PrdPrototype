/* 组件内置行为：表单必填与长度校验、提交（校验、加载、防重复、失败重试、成功后更新演示数据）、列表搜索筛选。
   页面用 h.form / h.fld({req, min, max}) / h.submit / h.search({filter}) / h.rows 声明，行为由这里统一实现。
   这些行为会被收集成规则，写进需求文档（W.audit.behave → 功能点「规则」）。 */
(function () {
  'use strict';
  var W = window.W;
  var h = W.h;
  var SUBMIT_MS = 600;            /* 演示用的提交耗时，用来展示加载态 */
  var FAIL_KEY = 'submitFail';    /* 演示数据顶层的开关（W.get 的路径）。为 true 时表单首次提交失败，见 acts 里的说明 */

  /* CSS 选择器里的属性值要转义，避免 id 中的引号或空格破坏选择器 */
  function attrVal(v) {
    return (window.CSS && CSS.escape) ? CSS.escape(String(v)) : String(v).replace(/["\\]/g, '\\$&');
  }

  /* ---------- 组件 ---------- */

  /* 表单容器：h.form(html, { id: 'leave', fn: 'form' })。id 在页面内唯一，提交按钮用它找到字段 */
  h.form = function (html, o) {
    o = o || {};
    return '<div class="wb-form"' + h.attrs({ fn: o.fn }) + ' data-form="' + h.esc(o.id || 'form') + '">' + html + '</div>';
  };

  /* 提交按钮：h.submit('提交申请', { form: 'leave', fn: 'submit', ok: { go: 'M01', st: 'list' }, append: 'list.items', appendName: '请假列表', appendDefaults: { no: '新申请', type: '事假' } })
     校验不通过不发请求；成功后 append 指向的演示数据新增一条（表单值，再加上 appendDefaults 补的表单外字段），并跳转到 ok；失败保留内容，可重试。 */
  h.submit = function (label, o) {
    o = o || {};
    var a = ' data-form="' + h.esc(o.form || 'form') + '"';
    if (o.ok && o.ok.go) a += ' data-ok-go="' + h.esc(o.ok.go) + '" data-ok-st="' + h.esc(o.ok.st || '') + '"';
    if (o.append) a += ' data-append="' + h.esc(o.append) + '" data-append-name="' + h.esc(o.appendName || o.append) + '"';
    if (o.appendDefaults) a += ' data-append-defaults="' + h.esc(JSON.stringify(o.appendDefaults)) + '"';
    return h.btn(label, { k: o.k || 'pri', cls: o.cls, fn: o.fn, act: 'form-submit', submit: true, attr: a.replace(/^ /, '') });
  };

  /* 可筛选列表：h.rows('list', [rowHtml, ...], { fn, empty })。搜索框用 h.search(ph, { filter: 'list' }) 与之配对。
     items 为空时直接返回 empty（由页面给出空状态）。 */
  h.rows = function (id, items, o) {
    o = o || {};
    if (!items || !items.length) return o.empty || '';
    return '<div data-fscope="' + h.esc(id) + '"' + h.attrs({ fn: o.fn }) + '>' +
      items.map(function (x) { return '<div data-frow>' + x + '</div>'; }).join('') +
      '<div data-fnomatch style="display:none">' + h.empty('没有匹配的结果', o.nomatch || '换个关键词试试') + '</div></div>';
  };

  /* ---------- 校验 ---------- */

  function fldName(fld) {
    var l = fld.querySelector('.lbl');
    return ((l ? l.textContent : '') || '').replace(/\*/g, '').trim() || '该字段';
  }
  function fldValue(fld) {
    var c = fld.querySelector('input,textarea,select');
    if (c) return String(c.value || '').trim();
    return Array.prototype.map.call(fld.querySelectorAll('.opt.on,.pill.on'), function (t) { return t.textContent.trim(); }).join('、');
  }
  function fldKey(fld) {
    var k = fld.getAttribute('data-field');
    if (k) return k;
    var c = fld.querySelector('[data-field]');
    return c ? c.getAttribute('data-field') : '';
  }
  /* 返回本字段的错误文字，没有错误返回空串 */
  function checkFld(fld) {
    var v = fldValue(fld), min = fld.getAttribute('data-min'), max = fld.getAttribute('data-max');
    if (fld.hasAttribute('data-req') && !v) return '请填写' + fldName(fld);
    if (v && min != null && v.length < +min) return fldName(fld) + '至少 ' + min + ' 个字';
    if (v && max != null && v.length > +max) return fldName(fld) + '最多 ' + max + ' 个字';
    return '';
  }
  function setErr(fld, msg) {
    var e = fld.querySelector('.ferr[data-auto]');
    if (!msg) {
      if (e) {
        e.parentNode.removeChild(e);
        fld.querySelectorAll('.inp').forEach(function (c) { c.classList.remove('bad'); });
      }
      return;
    }
    if (!e) {
      e = document.createElement('div');
      e.className = 'ferr';
      e.setAttribute('data-auto', '1');
      fld.appendChild(e);
    }
    e.textContent = msg;
    fld.querySelectorAll('.inp').forEach(function (c) { c.classList.add('bad'); });
  }
  function showFormErr(form, text) {
    var old = form.querySelector('.wb-form-err');
    if (old) old.parentNode.removeChild(old);
    if (!text) return;
    form.insertAdjacentHTML('afterbegin', h.bn('err', h.esc(text), { cls: 'wb-form-err' }));
  }
  /* 校验整个表单，返回是否通过；不通过时在字段下方提示并聚焦第一个错误 */
  function validate(form) {
    var first = null, n = 0;
    Array.prototype.forEach.call(form.querySelectorAll('.fld[data-req],.fld[data-min],.fld[data-max]'), function (fld) {
      var msg = checkFld(fld);
      setErr(fld, msg);
      if (msg) { n++; if (!first) first = fld; }
    });
    showFormErr(form, n ? '有 ' + n + ' 项需要修改，请按提示更正后再提交' : '');
    if (first) {
      var c = first.querySelector('input,textarea,select');
      if (c && c.focus) c.focus();
    }
    return !first;
  }
  /* 提交成功时把表单值整理成一行数据；表单没有的字段用 defaults 补上，表单值优先 */
  function collect(form, defaults) {
    var row = {};
    Object.keys(defaults || {}).forEach(function (k) { row[k] = defaults[k]; });
    Array.prototype.forEach.call(form.querySelectorAll('.fld'), function (fld) {
      var k = fldKey(fld);
      if (k) row[k] = fldValue(fld);
    });
    row.id = 'new-' + Date.now();
    return row;
  }

  /* ---------- 提交 ---------- */

  W.acts = W.acts || {};
  W.acts['form-submit'] = function (el, x) {
    if (el.dataset.busy) return;             /* 提交中：忽略重复点击 */
    var form = document.querySelector('.wb-form[data-form="' + attrVal(el.getAttribute('data-form')) + '"]');
    if (!form) { if (x.toast) x.toast('演示：找不到表单「' + el.getAttribute('data-form') + '」'); return; }
    if (!validate(form)) return;
    el.dataset.busy = '1';
    el.disabled = true;
    var orig = el.innerHTML;
    el.innerHTML = '提交中…';
    setTimeout(function () {
      if (!el.isConnected) return;           /* 页面已切换 */
      el.dataset.busy = '';
      el.disabled = false;
      el.innerHTML = orig;
      /* 失败演示：开关为 true 时，同一次渲染出来的表单，第一次提交失败；保留内容，再点即成功。
         切换数据场景或重新进入页面会重新渲染表单，计数随之重置。 */
      if (W.get(FAIL_KEY) && !form.dataset.failedOnce) {
        form.dataset.failedOnce = '1';
        showFormErr(form, '提交失败，网络异常。已填写的内容已保留，请重试。');
        return;
      }
      showFormErr(form, '');
      var path = el.getAttribute('data-append');
      if (path) {
        var defs = {};
        try { defs = JSON.parse(el.getAttribute('data-append-defaults') || '{}'); } catch (e) { defs = {}; }
        var set = {};
        set[path] = [collect(form, defs)].concat(W.get(path) || []);
        W.applySet(set);
      }
      if (el.getAttribute('data-ok-go')) x.nav(el.getAttribute('data-ok-go'), el.getAttribute('data-ok-st') || '');
      else x.render();
    }, SUBMIT_MS);
  };

  /* ---------- 筛选与清除错误（事件委托） ---------- */

  function applyFilter(id, q) {
    var scope = document.querySelector('[data-fscope="' + attrVal(id) + '"]');
    if (!scope) return;
    q = String(q || '').trim().toLowerCase();
    var rows = scope.querySelectorAll('[data-frow]'), hit = 0;
    Array.prototype.forEach.call(rows, function (r) {
      var ok = !q || r.textContent.toLowerCase().indexOf(q) >= 0;
      r.style.display = ok ? '' : 'none';
      if (ok) hit++;
    });
    var nm = scope.querySelector('[data-fnomatch]');
    if (nm) nm.style.display = hit === 0 && rows.length ? '' : 'none';
  }
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    if (t.getAttribute('data-filter')) applyFilter(t.getAttribute('data-filter'), t.value);
    var fld = t.closest && t.closest('.fld');
    if (fld && fld.querySelector('.ferr[data-auto]')) setErr(fld, checkFld(fld));
  });

  /* ---------- 规则收集（供审计写入需求文档） ---------- */

  /* 扫描渲染结果，返回 [{ fn, text }]。文字是对组件行为的说明，不需要功能点另外写。 */
  W.behaveCollect = function (scope) {
    var out = [];
    function owner(el) { var o = el.closest('[data-fn]'); return o ? o.getAttribute('data-fn') : null; }
    function add(el, text) { var fn = owner(el); if (fn) out.push({ fn: fn, text: text }); }
    /* 必填与长度只对 .wb-form 里、且有 h.submit 配对的表单生成规则。没有提交按钮的 h.fld 只是摆放，不做组件级校验。 */
    var paired = {};
    Array.prototype.forEach.call(scope.querySelectorAll('[data-act="form-submit"]'), function (el) { paired[el.getAttribute('data-form')] = true; });
    Array.prototype.forEach.call(scope.querySelectorAll('.wb-form'), function (form) {
      if (!paired[form.getAttribute('data-form')]) return;
      Array.prototype.forEach.call(form.querySelectorAll('.fld[data-req],.fld[data-min],.fld[data-max]'), function (fld) {
        var n = fldName(fld), min = fld.getAttribute('data-min'), max = fld.getAttribute('data-max');
        if (fld.hasAttribute('data-req')) add(fld, n + '为必填项，为空时不能提交');
        if (min != null && max != null) add(fld, n + '长度为 ' + min + '–' + max + ' 个字，不在此范围内时不能提交');
        else if (min != null) add(fld, n + '至少 ' + min + ' 个字，不足时不能提交');
        else if (max != null) add(fld, n + '最多 ' + max + ' 个字，超出时不能提交');
      });
    });
    /* 演示数据里有没有能让提交失败的场景，决定规则里要不要提“可切换” */
    var canFail = W.presets().some(function (p) {
      var s = JSON.stringify(p.set || '');
      return s.indexOf(FAIL_KEY) >= 0 && s.indexOf('true') >= 0;
    });
    Array.prototype.forEach.call(scope.querySelectorAll('[data-act="form-submit"]'), function (el) {
      add(el, '提交前先校验必填项和长度，不通过时在字段下方提示，不发出请求');
      add(el, '提交中按钮禁用，重复点击只提交一次');
      add(el, '提交失败时保留已填内容并提示，可直接重试' + (canFail ? '（可在数据场景中切换，演示首次提交失败）' : ''));
      var go = el.getAttribute('data-ok-go');
      var acts = [];
      if (el.getAttribute('data-append')) acts.push('在「' + el.getAttribute('data-append-name') + '」中新增一条');
      if (go && W.pages[go]) acts.push('进入「' + W.pages[go].title + '」');
      add(el, acts.length ? '提交成功后' + acts.join('，') : '提交成功后刷新当前页面');
    });
    Array.prototype.forEach.call(scope.querySelectorAll('[data-filter]'), function (el) {
      add(el, '列表内容随输入实时筛选（匹配列表行中的文字），无匹配项时显示“没有匹配的结果”');
    });
    return out;
  };

  /* 把审计得到的规则挂到功能点的 auto 上，需求文档和摘要读取 f.auto */
  W.behaveApply = function (audit) {
    if (!audit || !audit.behave) return;
    Object.keys(audit.behave).forEach(function (pid) {
      var p = W.pages[pid];
      if (!p) return;
      (p.fns || []).forEach(function (f) { f.auto = audit.behave[pid][f.id] || []; });
    });
  };
})();
