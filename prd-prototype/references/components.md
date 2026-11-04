# 线框组件与页面写法

页面的 `render(c)` 返回 HTML 字符串。用 `h.*` 组件拼页面，用 `data-*` 属性声明交互。组件只输出结构和语义类名，颜色、圆角、间距都在 `wire.css` 的设计变量里，换设计体系时不用改页面代码。

## 交互属性

| 属性 | 作用 | 组件里的写法 |
| --- | --- | --- |
| `data-fn="id"` | 把元素归属到功能点（必需） | `{ fn: 'id' }`、`h.fn('id', html)`、`'<div data-fn="id">'` |
| `data-go="P02"` `data-st="detail"` | 点击跳到某页某状态 | `{ go: 'P02', st: 'detail' }`、`h.go('P02', 'detail')` |
| `data-set="a=1"` | 跳转前修改演示数据 | `{ go: 'P02', set: 'a=1' }` |
| `data-act="toast"` `data-msg="…"` | 本地交互：`toast` 提示、`chk` 切换选中、`seg` 单选、`menu` 展开菜单，或自定义 | `{ act: 'toast', msg: '已复制' }` |
| `data-field="key"` | 控件对应的字段 | `{ field: 'key' }` |
| `data-demo` | 演示控件，不属于产品功能、不进需求 | `h.demo(html)` |
| `data-layer` | 弹层根节点（组件自动加） | `h.modal`、`h.drawer`、`h.sheet`、`h.alert` |
| `data-op="submit"` / `"nav"` | 覆盖构建检查对“是否改变数据”的自动判断（见 audit-codes.md 的 ERRORS） | `{ submit: true }` / `{ submit: false }` |

规则：

- **每个可交互元素都要在某个 `data-fn` 里**（按钮、链接、输入框、下拉、可点的卡片）。构建会逐页逐状态检查。
- 内置的返回箭头（`h.m` 的 `back`）、抽屉关闭叉（`h.drawer` 的 `close`）和面包屑（`h.crumb`）属于通用外壳，不需要功能点。
- 演示切换（如“看空状态”“以新用户登录”）用 `h.demo()` 包起来，它不算产品功能。
- 只在原型上“点一下没反应”的功能，也给 `{ act: 'toast', msg: '演示：……' }`，让评审知道这里可点。

## 组件

### 外壳

```js
h.app({ brand, sub, fn, home: ['P01', 'list'], nav: [{ key, label, go, st }], active, right, side, sideFn, body, over, cls })
h.m({ title, back: ['M01', 'list'], right, body, foot, footFn, over, tab, tabs, navFn, cls })   // 手机页面
h.cell(title, sub, { go, st, ic, right, fn })                                                   // 手机列表行
```

- `h.app` 的 `nav` 是顶部导航；传 `side: [{ key, label, go, ic }, { group: '分组' }]` 得到左侧菜单布局，`sideFn` 为侧栏功能点。
- `h.m` 的 `tab` 是底部导航当前项，底部导航项默认取 `W.MTABS = { fn, items: [{ key, label, ic, go, st }] }`；`label` 可以写 HTML（如加红点），但它是固定的，不随状态变化。
- `h.m` 的 `foot` 是横向排列的底栏，每个子元素等分宽度；放一个按钮会撑满整行。
- 推荐在 `kit.js` 封装 `W.ui.<端>(active, body, o)`，页面只写主体内容。

### 基础

```js
h.btn('文字', { k: 'pri' | 'txt' | 'red', sz: 'sm' | 'lg', cls: 'blk', ic: 'plus', go, st, set, act, msg, fn, dis: true })
h.a('文字', 'P02', 'detail', set, { fn })        // 文字链接
h.tag('待审批', 'warn')                           // 色系：gray acc ok warn err pend dark line
h.bn('info' | 'warn' | 'err' | 'ok' | 'gray', 'html', { fn })   // 提示条
h.ph('图表占位', { h: 200, w: 320 })              // 占位图
h.bar(60, { w: 120, cls: 'acc' })                 // 进度条
h.i('search', 16)                                 // 图标，名称见 h.icons
h.kpi('本月新增', '128', '较上月 +12%')
h.kv([['单号', 'QJ001'], ['时长', '1.5 天']])     // 键值对
h.empty('暂无数据', '说明', h.btn('新建'))         // 空状态
h.steps(['填写', '确认', '完成'], 1)              // 步骤条
h.menu(触发 html, [{ label, go, act, msg }, '-'], { fn })   // 下拉菜单
h.fn('id', html, 'span')                          // 用功能点包一段 html
h.demo(html, '演示切换')                           // 演示控件
h.crumb([['列表', 'P01', 'list'], ['详情']])       // 面包屑（不需要功能点）
```

图标名称：`play pause check lock pc phone home book user users clock cal cr cl cd x chat doc redo warn info copy plus minus upload download bell search filter edit trash more gear chart image link send star eye share box mic spk flag target grid menu`。不够用时在 `kit.js` 里 `h.addIcons({ name: '<path d="…"/>' })`（24×24 描边）。

### 表单

```js
h.fld('标签', 控件, { req: 1, hint: '', err: '', field, fn })
h.inp('值', { e: 1 /* 值作为占位 */, bad: 1, field, type: 'number', date: 1, area: 1, rows: 4, dis: 1, style })
h.sel('当前值', ['选项1', '选项2'], { field, e: 1, style })
h.search('占位文字', { field, value: '已输入的内容', style })
h.opts(['A', 'B', 'C'], 0, { multi: 1, sq: 1, field })   // 按钮式单选/多选
h.ck('同意协议', true, { rd: 1, dis: 1, field })          // 复选/单选框
h.sw(true, { field })                                     // 开关
h.pills(['全部', '待处理'], 0, { field })                 // 筛选胶囊
h.tabs([['基本信息', 'P02', 'info'], ['操作记录', 'P02', 'log']], 0, { fn })   // 页签（每项可跳转到状态）
```

### 表单行为（内置校验、提交、筛选）

这些行为由组件自己实现，页面只声明。构建会把它们写进对应功能点的「规则」，不需要另外写。

```js
h.fld('请假事由', h.inp('', { area: 1, field: 'reason', fn: 'form' }), { req: 1, min: 5, max: 200, fn: 'form', field: 'reason' })  // req 必须与 fields 的 required 一致
h.form(html, { id: 'leave', fn: 'form' })                       // 表单容器，id 在页面内唯一
h.submit('提交申请', { form: 'leave', fn: 'submit', ok: { go: 'M01', st: 'list' }, append: 'list.items', appendName: '请假列表' })
h.search('搜索单号或事由', { fn: 'search', field: 'kw', filter: 'list' })   // 与 h.rows('list', rows, { fn, nomatch, empty }) 配对
```

- 提交：先校验必填和长度，不通过不发请求。通过后按钮进入“提交中”并禁用，重复点击只提交一次。
- 提交结果由演示数据顶层的 `submitFail` 决定。为 `true` 时，表单每次渲染后的第一次提交失败，失败保留已填内容，再点即成功。数据场景（`scenarios`）里设 `submitFail=true` 即可在界面上演示。
- 成功时 `append` 指向的演示数据新增一条（值来自表单字段，表单没有的字段用 `appendDefaults: {...}` 补上），然后跳转到 `ok`。
- 搜索：按列表行的文字实时筛选，没有匹配时显示 `nomatch` 的“没有匹配的结果”。`h.rows` 的 `items` 为空时直接显示 `empty`。
- `fields` 中输入字段的 `required` 必须和 `h.fld` 的 `req` 一致，否则构建报错（`FIELD_REQ`）。只检查放在 `h.fld` 里的控件。

### 列表与表格

```js
h.table(['列1', '列2', ''], rows /* 二维数组，单元格是 html */, { fn, empty: '暂无数据', right: [2] })
h.list([h.li(html, { go, st }), …], { fn, empty: '暂无数据' })
```

### 弹层

弹层就是页面的一个状态（`states` 里写 `layer`），用 `over` 参数叠在页面上。弹层打开时画板只显示弹层内的功能点圆点。

```js
h.modal('标题', 正文, 按钮 html, { fn, w: 480 })
h.drawer('标题', 正文, 底部 html, { fn, close: ['P01', 'list'], w: 480 })
h.sheet(正文, { title, fn })                       // 手机底部弹层
h.alert('确定撤回？', '<a data-go…>取消</a><a data-go…>确定</a>', { fn })   // 手机确认框
```

### 布局工具类

| 类别 | 类名 |
| --- | --- |
| 布局 | `row`（横排）`col`（竖排）`row.top` `row.base` `sb` `jc` `je` `wr` `f1` `fn` `ml-a` `grid` `c2` `c3` `c4` `c21` `c12` `c31` `w`（1200 居中）`w-s`（880）`w-xs`（560）`split` `pane` `foot` `pc-split` |
| 间距 | `g4 g6 g8 g10 g12 g16 g20 g24 g32`（gap）`mt4 mt6 mt8 mt12 mt16 mt20 mt24 mt32` `mb4 mb8 mb12 mb16 mb24` `p0 p8 p12 p16 p24` |
| 容器 | `card` `card.t`（紧凑）`card.dash` `card.flat` `card-h` `box` `box.dash` `box.fill` `hr` `list` `li` `ph-h`（页头） `crumb` |
| 文字 | `sm`（12）`md`（13）`lg`（16）`xl`（20）`big`（32 数字）`b`（加粗）`mut` `mut2`（次要色）`num`（等宽数字）`ctr` `rt` `lnk` |
| 其他 | `ava` `ava.l` `ic`（图标方块）`dot` `dot.ok/.warn/.err/.acc` `kpi` `emp` |

写了不存在的类名不会报错，只会没有效果，请从上表中选。

## 页面写法范式

### 列表页

```js
render: function (c) {
  var empty = c.st === 'empty';
  return W.ui.pc('P01', '<div class="w"><div class="ph-h"><h1>订单列表</h1>' + h.btn('新建订单', { k: 'pri', go: 'P02', st: 'new', fn: 'create' }) + '</div>' +
    '<div class="row g12" data-fn="filter">' + h.pills(['全部', '待支付'], 0, { field: 'status' }) + h.search('订单号', { field: 'kw' }) + '</div>' +
    '<div class="mt16" data-fn="table">' + h.table(['订单号', '金额', ''], empty ? [] : rows, { empty: '暂无订单' }) + '</div></div>');
}
```

### 表单页（含校验失败状态）

```js
render: function (c) {
  var err = c.st === 'err';
  return h.m({ title: '发起请假', back: ['M01', 'list'],
    body: h.fn('form', h.fld('事由', h.inp(err ? '' : '回老家', { area: 1, field: 'reason', bad: err }), { req: 1, err: err ? '请填写事由' : '' })),
    foot: h.btn('提交', { k: 'pri', go: 'M02', st: 'confirm', fn: 'submit' }) });
}
```

### 抽屉/弹窗叠在另一个页面上

```js
render: function (c) {
  var bg = W.pages.P01.render({ st: 'list', s: c.s, p: W.pages.P01 });   // 复用底层页面
  var drawer = h.drawer('审批详情', '<div data-fn="summary">…</div>', '<div data-fn="decide">…</div>', { close: ['P01', 'list'] });
  return bg.replace(/<\/div>$/, drawer + '</div>');
}
```

底层页面的功能点按它所属的页面识别；弹层状态只检查最高层里的元素。

### 根据演示数据变化

```js
var b = c.s.balance;                         // product.demo 中的数据
h.btn('提交', { go: 'M03', st: 'pending', set: 'balance.frozen=1.5' });
```

### 自定义交互

```js
acts: {
  addRow: function (el, x) { x.toast('已添加一行'); }   // x: { st, s, p, nav, toast, render, root }
}
// 用法：h.btn('添加', { act: 'addRow', fn: 'rows' })
```

需要输入联动（如实时字数）时在 `after(root, c)` 里给 root 内的元素绑定事件。

## 线框阶段的样式约束

- 优先用组件和工具类；不写颜色。选用规范包时同样不写色值，颜色和尺寸由规范包的变量给出。
- 内联样式只用于尺寸、字号和字距（如签到码输入框 `style="font-size:26px;letter-spacing:8px"`），因为表单控件上的字号会被组件样式覆盖。
- 圆点压住文字时，用功能点的 `dot` 调整，不要为了圆点去改布局。

## 公共组件的圆点

公共组件（导航、底部 Tab）的圆点默认不显示，避免每页重复；右侧面板“公共组件”一栏可以打开。所以截图诊断里“圆点数”会少于“可见功能点数”。

## 换成团队设计体系

1. 在 `prd/theme.css` 覆盖 `.ab` 上的设计变量（`--ink --acc --line --fill --r --font` 等）。
2. 需要时在 `theme.css` 里重写组件类（`.btn .card .tbl .inp .tag` 等）。
3. 组件不够用时在 `kit.js` 里新增 `h.xxx`，页面统一调用；不要在页面里直接写颜色。

页面代码、需求数据和检查规则都不用改。

## 规范包（设计主题）

`new.mjs --theme gaodeng-pc` 会把规范包的 `tokens.css` 和 `theme.css` 合并为 `prd/theme.css`，并复制 `theme-kit.js` 到 `prd/`。规范包的变量和样式只作用于 PC 画板（`.ab[data-device="pc"]`），手机画板保持线框。页面代码不用改，只调用 `h.*`。规范包里的组件变化：

- 按钮三档：默认 40 高；`sz: 'sm'` 为 32（弹窗、表格内自动为 32）；`sz: 'xs'` 为 24。
- 对话框：`h.modal(标题, 正文, 按钮, { size: 's' | 'm' | 'l' | 'xl', fn })`，宽 480/640/720/960；也可用 `w` 指定。
- 缺省页：`h.empty(标题, 副标题, 引导按钮, { kind: 'blank' | 'info' | 'system' })`。`h.table` 没有数据时直接用缺省页替代表格。
- 分页：`h.pager(总行数, { page, fn })`。默认每页 10 行。总行数不足 10 时隐藏页码，保留“共 N 条”；是否连总数一起隐藏待确认（CONFLICTS C25）。翻页按钮只作展示。
- 标签：2px 圆角；选中的页签、选项、开关用品牌色。

要改规范包本身时，改 `themes/<名称>/` 下的文件；要给某个项目加组件，在该项目的 `prd/` 里新增 `h.xxx`，不要在页面里直接写颜色。
