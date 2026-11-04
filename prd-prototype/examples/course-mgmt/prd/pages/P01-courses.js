/* 课程管理（P01）：列表（筛选、分页）→ 新建课程弹窗（校验、提交、失败重试）→ 课程详情抽屉。
   辅助函数放在闭包里，避免成为全局变量。 */
(function () {
  var h = W.h;
  var COLLEGES = ['计算机学院', '外国语学院', '经济管理学院'];
  var CREDITS = ['1', '2', '3', '4'];
  var PAGE = 10;   /* 每页 10 条，与 h.pager 一致。原型只渲染第 1 页的行 */

  /* 列表样式按 gaodeng-pc 表格规范 [6.5]，取值与 theme.css §6 的 .tbl th / .tbl td 相同：
     表头 54 高、LV6 底、14px Medium、LV1 字、底边 LV5；行 54 高、14px、LV2 字、行线 LV6。
     列表用 h.rows 的弹性行实现（搜索筛选依赖它），所以样式直接写在行上，不套 .tbl。 */
  var TH = 'height:var(--row-h);padding:0 12px;background:var(--surface);border-bottom:1px solid var(--border);color:var(--fg);font-size:var(--text-sm);font-weight:var(--fw-medium)';
  var TD = 'height:var(--row-h);padding:0 12px;border-bottom:1px solid var(--surface);color:var(--fg-2);font-size:var(--text-sm)';

  /* 列表的列宽与表头一致；name 列占满剩余宽度 */
  function cell(text, px) {
    return '<span' + (px ? ' style="width:' + px + 'px"' : ' class="f1"') + '>' + text + '</span>';
  }
  function head() {
    return '<div class="row g12" style="' + TH + '">' +
      cell('课程代码', 120) + cell('课程名称') + cell('开课学院', 168) + cell('学分', 64) + cell('任课教师', 120) + cell('状态', 96) + cell('', 64) +
      '</div>';
  }
  function row(x) {
    return '<div class="row g12" style="' + TD + '">' +
      cell(h.esc(x.no), 120) +
      cell(h.esc(x.name)) +
      cell(h.esc(x.college), 168) + cell(h.esc(x.credit), 64) + cell(h.esc(x.teacher), 120) +
      '<span style="width:96px">' + h.tag(h.esc(x.status), x.status === '已发布' ? 'ok' : 'warn') + '</span>' +
      '<span style="width:64px">' + h.btn('详情', { k: 'txt', sz: 'sm', go: 'P01', st: 'detail', set: { pick: x.id }, fn: 'table' }) + '</span>' +
      '</div>';
  }

  /* 新建课程弹窗（中号 640）。必填与长度写在 h.fld 上，和 fields 的 required 保持一致 */
  function createDlg() {
    var body = h.form(
      '<div style="display:flex;flex-direction:column;gap:16px">' +
      h.fld('课程代码', h.inp('6–12 位字母或数字', { e: 1, field: 'no', fn: 'create-form' }), { req: 1, min: 6, max: 12, field: 'no', fn: 'create-form', hint: '同一学期内唯一' }) +
      h.fld('课程名称', h.inp('2–30 字', { e: 1, field: 'name', fn: 'create-form' }), { req: 1, min: 2, max: 30, field: 'name', fn: 'create-form' }) +
      h.fld('开课学院', h.inp('请选择开课学院', { sel: 1, e: 1, options: COLLEGES, field: 'college', fn: 'create-form' }), { req: 1, field: 'college', fn: 'create-form' }) +
      h.fld('学分', h.inp('请选择学分', { sel: 1, e: 1, options: CREDITS, field: 'credit', fn: 'create-form' }), { req: 1, field: 'credit', fn: 'create-form' }) +
      h.fld('备注', h.inp('选填，最多 200 字', { area: 1, rows: 3, e: 1, field: 'note', fn: 'create-form' }), { max: 200, field: 'note', fn: 'create-form' }) +
      '</div>',
      { id: 'course', fn: 'create-form' });
    var actions = h.btn('取消', { go: 'P01', st: 'list', fn: 'submit' }) +
      h.submit('提交', {
        form: 'course', fn: 'submit', ok: { go: 'P01', st: 'list' },
        append: 'list.items', appendName: '开课课程列表', appendDefaults: { teacher: '待指定', status: '待排课' }
      });
    return h.modal('新建课程', body, actions, { size: 'm', fn: 'create-form' });
  }

  /* 课程详情抽屉：只读。pick 为列表行上“详情”记下的课程 ID，找不到时显示第一门 */
  function detailDrawer(items, pick) {
    var x = items.filter(function (r) { return r.id === pick; })[0] || items[0];
    if (!x) return '';
    return h.drawer('课程详情', h.kv([
      ['课程代码', h.esc(x.no)], ['课程名称', h.esc(x.name)], ['开课学院', h.esc(x.college)],
      ['学分', h.esc(x.credit)], ['任课教师', h.esc(x.teacher)], ['状态', h.esc(x.status)],
      ['备注', h.esc(x.note || '—')]
    ]), '', { close: ['P01', 'list'], fn: 'detail', w: 480 });
  }

  W.page({
    id: 'P01', end: 'pc', group: '课程', title: '课程管理',
    goal: '教务处课程管理员查看本学期全部开课课程，按名称或代码找课；新增一门开课课程，提交前拦住漏填，提交失败时保留已填内容并可重试；查看单门课程的详情。 [AI 假设]',
    entry: '顶部导航“课程管理”，默认首页 [AI 假设]',
    perm: '教务处课程管理员（本画面为管理员视角）；学院教学秘书只读，看不到“新建课程”按钮 [AI 假设]',
    scenarios: true,
    states: [
      { id: 'list', label: '课程列表', when: '进入页面；新增成功、点“取消”、关闭详情抽屉后回到列表。演示数据中本学期有开课课程（默认 9 门）' },
      { id: 'create', label: '新建课程弹窗', when: '在列表点“新建课程”', layer: 'modal' },
      { id: 'detail', label: '课程详情抽屉', when: '在列表某一行点“详情”', layer: 'drawer' }
    ],
    fns: [
      {
        id: 'filter', name: '课程搜索',
        desc: '在搜索框输入课程名称或课程代码，列表立即只保留包含这些文字的行（不区分大小写）。没有匹配的课程时，列表区域显示“没有匹配的结果”。清空搜索框后恢复全部课程。原型限制：只在第 1 页的 10 行中匹配。',
        fields: [{ key: 'kw', name: '搜索关键词', type: '文本', required: false, rule: '匹配课程名称或课程代码，包含即命中；不区分大小写；最多 30 字' }],
        status: 'assumed', statusNote: '搜索范围（只匹配名称和代码）与字数上限是 AI 补充的，需求材料没有写明',
        ac: { pre: '列表中有 9 门开课课程', act: '在搜索框输入“高等”', expect: '列表只留下名称含“高等”的两门课程，其余行隐藏' }
      },
      {
        id: 'table', name: '开课课程列表',
        desc: '列表按数据顺序显示，新增成功的课程排在最前。每行显示课程代码、课程名称、开课学院、学分、任课教师和状态。点行尾“详情”，打开该课程的详情抽屉。',
        fields: [
          { key: 'no', name: '课程代码', type: '文本', rule: '新建时填写，6–12 位' },
          { key: 'name', name: '课程名称', type: '文本', rule: '新建时填写，2–30 字' },
          { key: 'college', name: '开课学院', type: '枚举', options: COLLEGES },
          { key: 'credit', name: '学分', type: '数字', rule: '1–4 的整数' },
          { key: 'teacher', name: '任课教师', type: '文本', rule: '新增课程默认“待指定”，本页不修改' },
          { key: 'status', name: '状态', type: '枚举', options: ['待排课', '已发布'], rule: '新增课程默认“待排课”' }
        ],
        empty: '本学期还没有开课课程：列表区域显示“本学期暂无开课课程”，并给出“新建课程”按钮',
        status: 'assumed', statusNote: '列表的列、排序和空状态文案是 AI 补充的',
        ac: { pre: '本学期已有 9 门开课课程', act: '打开课程管理页', expect: '列表显示 9 行，底部分页显示“共 9 条”' }
      },
      {
        id: 'pager', name: '分页计数',
        desc: '每页 10 条。课程不足 10 条时只显示“共 N 条”；10 条及以上时显示页码和“第 X~Y 条 / 共 N 条”。搜索后，计数和页码按匹配的结果计算，匹配超过 10 条时可以翻页。原型限制：原型只展示第 1 页，搜索时计数不变；翻页按钮只作展示。',
        status: 'assumed', statusNote: '每页 10 条按 gaodeng-pc 规范的分页规则；搜索时计数的口径是 AI 假设',
        ac: { pre: '列表中已有 9 门课程，新增 1 门后共 10 条', act: '打开课程管理页', expect: '分页显示“第 1~10 条 / 共 10 条”，只有页码 1' }
      },
      {
        id: 'create-entry', name: '新建课程入口',
        desc: '点“新建课程”，在列表上方弹出新建弹窗，列表保持在背后，不离开页面。',
        status: 'assumed', statusNote: '按钮位置和文字是 AI 补充的',
        ac: { pre: '列表页已打开', act: '点击“新建课程”', expect: '弹出“新建课程”弹窗，四个必填项为空，列表仍在弹窗后面' }
      },
      {
        id: 'create-form', name: '新建课程表单',
        desc: '弹窗里填写课程代码、课程名称、开课学院、学分和备注。提交前校验必填项和长度，不通过的字段在下方提示原因。',
        fields: [
          { key: 'no', name: '课程代码', type: '文本', required: true, rule: '6–12 位字母或数字；同一学期内唯一' },
          { key: 'name', name: '课程名称', type: '文本', required: true, rule: '2–30 字' },
          { key: 'college', name: '开课学院', type: '枚举', required: true, options: COLLEGES },
          { key: 'credit', name: '学分', type: '数字', required: true, options: CREDITS, rule: '整数，1–4 学分' },
          { key: 'note', name: '备注', type: '文本', required: false, rule: '选填，最多 200 字' }
        ],
        status: 'assumed', statusNote: '字段清单、必填项和长度范围是 AI 补充的，需求材料没有给出',
        ac: { pre: '弹窗已打开，四个必填项为空', act: '直接点击“提交”', expect: '四个必填项下方提示“请填写…”，表单顶部提示“有 4 项需要修改”，不发出请求' }
      },
      {
        id: 'submit', name: '提交新建课程',
        desc: '点“提交”：先校验，不通过则不发出请求。通过后提交，成功则关闭弹窗，课程插入列表最前，分页计数加 1。点“取消”关闭弹窗，已填内容不保留。',
        errors: [
          '必填项为空或长度不对：不发出请求，字段下方提示原因，表单顶部提示“有 N 项需要修改”',
          '提交失败（网络异常）：保留已填内容，表单顶部提示“提交失败，网络异常”，可直接再次点“提交”',
          '提交中：提交按钮显示“提交中…”并禁用，重复点击只提交一次',
          '课程代码与本学期已有课程重复：服务端拒绝提交，保留已填内容，表单顶部提示“课程代码已存在”，修改课程代码后可再次提交。原型不演示此分支'
        ],
        status: 'assumed', statusNote: '提交成功与失败的分支、课程代码重复的提示、取消后不保留内容，都是 AI 补充的',
        ac: { pre: '列表中已有 9 门课程，弹窗内四个必填项都已按规则填写，数据场景为“提交成功”', act: '点击“提交”', expect: '弹窗关闭，列表顶部出现该课程，分页显示“第 1~10 条 / 共 10 条”' }
      },
      {
        id: 'detail', name: '课程详情抽屉',
        desc: '右侧滑出抽屉，只读显示所选课程的课程代码、名称、开课学院、学分、任课教师、状态和备注。点右上角关闭返回列表。本期不在抽屉中编辑。',
        fields: [
          { key: 'no', name: '课程代码', type: '文本', rule: '与列表一致，不可修改' },
          { key: 'name', name: '课程名称', type: '文本', rule: '与列表一致' },
          { key: 'college', name: '开课学院', type: '枚举', options: COLLEGES },
          { key: 'credit', name: '学分', type: '数字', rule: '1–4 的整数' },
          { key: 'teacher', name: '任课教师', type: '文本', rule: '未指定时显示“待指定”' },
          { key: 'status', name: '状态', type: '枚举', options: ['待排课', '已发布'] },
          { key: 'note', name: '备注', type: '文本', rule: '未填写时显示“—”' }
        ],
        status: 'assumed', statusNote: '抽屉的字段范围和“只读、不编辑”是 AI 补充的',
        ac: { pre: '列表中有一门课程', act: '点击该课程行的“详情”', expect: '右侧抽屉打开，显示该课程的全部字段；点关闭后回到列表' }
      }
    ],
    render: function (c) {
      var items = (c.s.list && c.s.list.items) || [];
      var empty = h.empty('本学期暂无开课课程', '点击“新建课程”添加第一门课程',
        h.btn('新建课程', { k: 'pri', go: 'P01', st: 'create', fn: 'create-entry', ic: 'plus' }));
      var body = '<div class="w">' +
        '<div class="ph-h"><div><h1>课程管理</h1><p class="mut mt4">2026–2027 学年第一学期 · 开课课程</p></div></div>' +
        '<div class="row g12">' +
          h.search('搜索课程名称或代码', { fn: 'filter', field: 'kw', filter: 'list', style: 'width:300px' }) +
          '<span class="ml-a"></span>' +
          h.btn('新建课程', { k: 'pri', go: 'P01', st: 'create', fn: 'create-entry', ic: 'plus' }) +
        '</div>' +
        '<div class="mt16">' + (items.length ? head() : '') +
          h.rows('list', items.slice(0, PAGE).map(function (x) { return row(x); }), { fn: 'table', empty: empty, nomatch: '换个课程名称或代码试试' }) +
        '</div>' +
        h.pager(items.length, { fn: 'pager' }) +
        '</div>';
      var over = c.st === 'create' ? createDlg() : c.st === 'detail' ? detailDrawer(items, c.s.pick) : '';
      return W.ui.pc('P01', body, { over: over });
    }
  });
})();
