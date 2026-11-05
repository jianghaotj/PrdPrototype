/* gaodeng-pc 组件扩展。new.mjs --theme gaodeng-pc 会把本文件复制为 prd/theme-kit.js。
   在 core.js 之后加载，覆盖 h.modal、h.empty、h.table，并新增 h.pager。
   只作用于 PC 画板：运行时把当前端写入 W.device（'pc' 或 'mobile'），手机端一律调用原来的组件实现，输出与不带规范包时一致。
   页面调用方式不变；不选用规范包时不加载，线框组件保持原样。 */
(function () {
  'use strict';
  var W = window.W;
  var h = W.h;
  var base = { modal: h.modal, table: h.table, empty: h.empty };
  var DLG_W = { s: 480, m: 640, l: 720, xl: 960 };
  var EMP_ICON = { blank: 'box', info: 'info', system: 'warn' };
  var PAGE_SIZE = 10;

  function onPc() { return W.device === 'pc'; }

  /* 对话框四档宽度 [7.1]：h.modal(标题, 正文, 按钮, { size: 's' | 'm' | 'l' | 'xl', fn })。
     也可以直接用 o.w 指定宽度（如 480）。PC 端不写 size 时为 480。 */
  h.modal = function (title, body, actions, o) {
    if (!onPc()) return base.modal(title, body, actions, o);
    o = Object.assign({}, o || {});
    if (o.size && !DLG_W[o.size]) W.errors.push('h.modal 的 size 只能是 s、m、l、xl（当前：' + o.size + '）');
    if (!o.w) o.w = DLG_W[o.size] || DLG_W.s;
    return base.modal(title, body, actions, o);
  };

  /* 缺省页 [6.3]：图形、标题、副标题、引导按钮。
     h.empty(标题, 副标题, 引导按钮 html, { kind: 'blank' | 'info' | 'system' })
     blank 空白（暂无数据、搜索无结果）；info 信息（内容已删除、无权限）；system 系统（加载失败、网络异常）。 */
  h.empty = function (title, desc, action, o) {
    if (!onPc()) return base.empty(title, desc, action);
    o = o || {};
    var kind = EMP_ICON[o.kind] ? o.kind : 'blank';
    return '<div class="emp" data-empty="' + kind + '"><div class="emp-ic">' + h.i(EMP_ICON[kind], 40) + '</div>' +
      '<div class="emp-t">' + title + '</div>' +
      (desc ? '<p class="emp-d">' + desc + '</p>' : '') +
      (action ? '<div class="mt16">' + action + '</div>' : '') + '</div>';
  };

  /* 整表没有数据时用缺省页代替表格 [6.3、6.5]。
     h.table(列名, 行, { fn, empty: 标题, emptyDesc, emptyAction, emptyKind }) */
  h.table = function (cols, rows, o) {
    if (!onPc()) return base.table(cols, rows, o);
    o = o || {};
    if (rows && rows.length) return base.table(cols, rows, o);
    return '<div data-list' + h.attrs({ fn: o.fn }) + '>' +
      h.empty(o.empty || '暂无数据', o.emptyDesc, o.emptyAction, { kind: o.emptyKind }) + '</div>';
  };

  /* 分页 [6.5]：默认每页 10 行，页码显示规则按规范原文。
     总行数不足 10 时隐藏页码，保留“共 N 条”；超过 10 行时显示页码和“第 X~Y 条 / 共 N 条”。
     是否连“共 N 条”一起隐藏，原文未明确，见 CONFLICTS C25（待确认）。
     h.pager(总行数, { page: 当前页, fn: 功能点 })
     翻页按钮只作展示，不可点击（AI 假设）；带输入操作的表格用滚动，不用分页。
     手机端没有分页组件，返回空串。 */
  h.pager = function (total, o) {
    if (!onPc()) return '';
    o = o || {};
    total = Math.max(0, Number(total) || 0);
    var attrs = h.attrs({ fn: o.fn });
    if (total < PAGE_SIZE) return '<div class="pager"' + attrs + '><span>共 ' + total + ' 条</span></div>';
    var pages = Math.ceil(total / PAGE_SIZE);
    var cur = Math.min(Math.max(Number(o.page) || 1, 1), pages);
    var from = (cur - 1) * PAGE_SIZE + 1;
    var to = Math.min(cur * PAGE_SIZE, total);
    var nums = '';
    for (var i = 1; i <= pages; i++) nums += '<span class="pg-n' + (i === cur ? ' on' : '') + '">' + i + '</span>';
    return '<div class="pager"' + attrs + '><span>第 ' + from + '~' + to + ' 条 / 共 ' + total + ' 条</span>' +
      '<span class="pg-b' + (cur === 1 ? ' dis' : '') + '">' + h.i('cl', 14) + '</span>' + nums +
      '<span class="pg-b' + (cur === pages ? ' dis' : '') + '">' + h.i('cr', 14) + '</span></div>';
  };
})();
