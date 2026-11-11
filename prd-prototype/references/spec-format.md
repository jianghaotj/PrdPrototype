# 需求数据格式

项目结构：

```text
<项目目录>/
├─ prd/
│  ├─ product.js        产品级需求（W.product）
│  ├─ kit.js            公共外壳与公共功能点（W.shared、W.ui、W.MTABS）
│  ├─ scope.json        范围基线：新项目必须写；旧项目没有也能构建（格式见文末）
│  ├─ theme.css         可选：项目样式（高保真的配色、字阶、组件覆盖，见 hifi.md）
│  ├─ *.js              可选：共享演示数据、组件扩展（如 theme-kit.js）等，按文件名顺序加载
│  └─ pages/
│     ├─ M01-home.js    一个页面一个文件；文件名决定目录顺序
│     └─ P01-todo.js
├─ <产品名>-原型需求.html  构建产物（唯一交付文件）
├─ 归档/                 版本变化时自动保存的上一版
└─ .prd-build/           构建中间文件与失败排查文件（不交付）
```

加载顺序：`product.js` → `kit.js` → `prd/` 根目录其他 JS → `pages/**/*.js`（按文件名自然排序）。页面文件里可以直接使用 `W` 和 `h`。

## W.product({...})

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 英文短名，用于浏览器本地保存演示数据，如 `leave-approval`。项目建好后不要改，否则评审者浏览器里的演示数据会重置 |
| `name` | 是 | 产品名，也是默认输出文件名前缀 |
| `date`、`fidelity` | | 日期；保真度说明，默认“低保真线框”，`--hifi` 生成的项目为“高保真（视觉由 AI 自拟）” |
| `releases` | 是 | `[{ id: 'V1.0', date, summary }]`，最后一项为当前版本 |
| `background` | 是 | 业务背景（Markdown）：谁、什么场景、什么问题、本期做成什么 |
| `goals` | | 建设目标列表 |
| `scope.out` | 是 | 本期明确不做的内容，可为空数组但必须写 |
| `roles` | 是 | `[{ id, name, desc, perms: [] }]` |
| `ends` | 是 | 端，见下表 |
| `groups` | | 目录分组 `{ 端id: [['分组名', ['P01','P02']]] }`；不写时按页面的 `group` 字段自动分组 |
| `rules` | | 跨页面的业务规则（规则条目格式见后文） |
| `nfr` | | 非功能要求：性能、兼容、安全、埋点 |
| `dict` | | 数据字典 `[{ name, desc, fields: [{ key, name, type, desc }], states }]` |
| `flows` | | 核心流程，见后文 |
| `flowMap` | | 总流程图。不写时由 `flows` 自动汇总；写 `false` 不画；写 Mermaid 文本时直接用它（手画） |
| `sections` | | 自定义章节 `[{ title, md, at: 'end' }]`；不写 `at` 放在“概述”里，`at: 'end'` 单独成章 |
| `todo` | | 全局待确认事项（文字里不用再写 `[待确认]`） |
| `demo` | | 演示数据默认值，页面通过 `c.s` 读取 |
| `scenarios` | | `{ label: '数据场景', presets: [{ id, label, set }] }`，一键切换演示数据 |
| `clarify` | | 澄清记录 `[{ no, q, a, by }]` |
| `out` | | 输出文件名。默认 `<name>-原型需求.html`；原型阶段默认 `<name>-原型.html`。原型阶段不建议写 `out`，以免和完整版同名 |
| `stage` | | 写 `'prototype'` 进入原型阶段（见 `SKILL.md` 流程 E）；写其他值报 `PRODUCT`。完整需求阶段不写这一行 |
| `demoNote` | | 画板下方的数据说明，默认“画面中的数据均为演示数据” |

原型阶段（`stage: 'prototype'`）下，`background`、`scope.out`、`roles` 缺失或过短只给提醒。`name`、`id`、`ends`、`releases` 仍必填。

### 端 ends

| 字段 | 说明 |
| --- | --- |
| `id`、`name` | 端 ID（页面的 `end` 引用它）和显示名称 |
| `device` | `pc` 或 `mobile`，决定浏览器框或手机框 |
| `home` | 该端首页的页面 ID |
| `url` | PC 地址栏里的演示地址 |
| `desc` | 端的说明，进入“信息架构” |
| `width`、`height` | 画板尺寸，默认 PC 1280 宽、手机 375×812；`new.mjs --hifi` 生成的 PC 端为 1440×900 |
| `host`、`ignore`、`boot`、`settle`、`resetKeys`、`online` | 托管模式专用，见 `host-mode.md`。`online: true` 放行该端的网络脚本和样式（需联网） |

## W.page({...})

```js
W.page({
  id: 'P01', end: 'pc', group: '审批', title: '待我审批',
  goal: '主管集中处理直属下属的请假单，优先处理开始时间最近的单据。',
  entry: '审批台默认首页；企业微信消息直达',
  perm: '直属主管；HR 不显示此菜单',
  scenarios: true,                    // 右侧显示“数据场景”切换
  states: [
    { id: 'list', label: '有待审批', when: '直属下属至少有 1 条待审批单据' },
    { id: 'empty', label: '全部处理完', when: '筛选“待审批”且没有单据', set: 'preset=empty' },
    { id: 'reject', label: '填写驳回原因', when: '点击“驳回”', layer: 'modal' }
  ],
  fns: [ /* 功能点 */ ],
  rules: [ /* 页面级规则 */ ],
  todo: [ /* 页面待确认 */ ],
  render: function (c) { /* 返回 HTML 字符串 */ },
  after: function (root, c) { /* 可选：渲染后绑定额外交互 */ },
  acts: { /* 可选：自定义 data-act */ }
});
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 页面编号，建议 PC 用 P01、手机用 M01、其他端自定前缀 |
| `end` | 是 | 所属端 ID |
| `title`、`goal` | 是 | 页面名称；页面目标（谁、在什么情况下、完成什么） |
| `group` | | 目录分组 |
| `entry`、`perm` | | 入口与前置条件；角色权限 |
| `states` | 是 | 至少一个。`when` 必填：什么数据或操作下出现 |
| `states[].layer` | | 弹层状态：`drawer` / `sheet` / `modal` / `alert` / `popover`。画板和需求面板只显示最高层的功能点 |
| `states[].set` | | 进入该状态时应用的演示数据，如 `'preset=empty'` 或 `{ 'list.count': 0 }`。演示数据会跨页面保留，所以依赖数据的“正常”状态也要写 `set` 复位（如 `'preset=normal'`），否则从“空状态”切回来仍是空的 |
| `render(c)` | 原生页面必填 | `c.st` 当前状态 ID、`c.s` 演示数据、`c.p` 页面、`c.q` 地址参数、`c.end` 端 |

## 功能点 fns

功能点是需求的最小评审单元：一个用户能感知的区域或操作。它同时是原型上的编号圆点、右侧面板的卡片、需求文档里的条目。

```js
{
  id: 'form', name: '请假信息表单',
  desc: '依次选择类型、开始和结束时间、填写事由；起止时间选好后立即按工作日计算时长。',
  fields: [
    { key: 'type', name: '假期类型', type: '枚举', required: true, options: ['年假', '事假', '病假'], def: '年假' },
    { key: 'reason', name: '请假事由', type: '文本', required: true, rule: '5–200 字，实时显示字数' },
    { key: 'days', name: '时长', type: '数字（天）', rule: '只读，按工作日自动计算' }
  ],
  rules: ['切换类型时保留已填的时间和事由', '离开页面时提示“放弃本次填写？” [AI 假设]'],
  errors: ['网络失败：提示“提交失败，请重试”，保留填写内容'],
  empty: '……',              // 列表/表格必填：没有数据时显示什么、能做什么
  perm: '……',               // 与页面不同的权限
  roles: ['admin', 'manager'],  // 可选：只有这些角色的用户能看到该功能点；缺省或空数组 = 所有角色可见
  src: '需求材料 §2 · 澄清 Q2',
  status: 'assumed',        // 可选：pending 待确认 / assumed AI 假设；不写视为已确认
  statusNote: '……',         // 为什么是假设或待确认；会显示在清单里，要能单独读懂
  ui: false,                // 可选：无界面的后台逻辑（定时任务、通知规则），不要求出现在原型中
  ac: {                     // 可选：验收条件，测试可直接据此写用例
    pre: '已有一条未审批的单据',   // 前置条件，可省略
    act: '点击“通过”并确认',       // 用户操作，一句完整的话
    expect: '单据状态变为已通过，申请人收到通知'  // 预期结果，一句完整的话
  },
  gap: '原型未画出……',      // 可选，仅托管模式：需求有、已有原型没画，以需求为准
  dot: [1.05, -0.3]         // 可选：圆点位置，按元素宽高的比例；默认在右上角外侧。可以写 0–1 之外的值把圆点放到元素外
}
```

构建检查对功能点的要求：

| 原型中出现了 | 功能点必须写 |
| --- | --- |
| 任何功能点 | `desc`（至少一句完整的话）；`src`，或 `status: 'assumed' / 'pending'` |
| 输入框、下拉、选项组、开关等控件 | `fields`，至少一个字段写 `required: true / false`；用 `data-field` 绑定在输入控件上的字段都要写 `required`（纯展示字段不用） |
| 列表或表格（`h.table`、`h.list`） | `fields`（每列/每项的含义、格式、来源）和 `empty` |
| 提交、保存、删除、通过、驳回、支付、上传等按钮 | `errors`（失败、重复提交、权限不足、并发冲突） |

原型阶段（`stage: 'prototype'`）下，上表里的 `desc`、`src`、`fields`、`empty`、`errors` 缺失只给提醒，见 `audit-codes.md`“原型阶段”。原型里的可点元素仍要登记成功能点。

`ac`（验收条件）可选。核心流程里出现的功能点建议写上，写不写由需求方决定：没写时构建给出 `AC_MISSING` 提醒，不阻止交付。写了的功能点会集中列在需求文档的“验收条件”一章。

### 字段 fields

| 字段 | 说明 |
| --- | --- |
| `key` | 英文键，与原型中的 `data-field` 对应 |
| `name`、`type` | 必填。类型用业务语言：文本、数字、金额、枚举、日期、时间、图片、文件…… |
| `required` | 输入字段写 `true` / `false`；纯展示字段不写 |
| `def`、`options` | 默认值；可选值（数组或文字） |
| `rule` | 校验、格式、计算口径或数据来源；`rule` 和 `options` 至少写一个 |
| `status`、`statusNote` | 同功能点 |

字段没有 `src`，来源写在所属功能点上。写了不认识的字段名（拼写错误或放错位置）时，构建会给出 `UNKNOWN_KEY` 提醒。

## 规则条目

`rules`、`errors`、`goals`、`nfr`、`scope.out` 的每一项可以是字符串，也可以是对象：

```js
'审批通过后自动扣减余额'
'余额按自然年清零 [待确认]'
{ text: '时长按工作日计算', src: '澄清 Q2' }
{ text: '提交即冻结余额', status: 'assumed', changes: [{ ver: 'V1.1', type: 'added' }] }
```

文字中的 `[待确认]`、`[AI 假设]` 会显示为徽标，并进入“待确认与 AI 假设”清单。会被收集的位置：背景、目标、本期不做、角色、全局规则、非功能要求、数据字典、自定义章节；页面的目标、入口、权限、状态 `when`；功能点的 `desc`、`empty`、`perm`、字段的 `rule` / `def` / `options`、`rules`、`errors`。

条目已经标了 `status` 时，文字里不用再写标记。

`src` 与 `status` 可以同时写：`src` 说明已有的部分依据，`status: 'assumed'` 表示这条结论本身仍是 AI 的推断。例如需求只说“看预约列表”，筛选项是 AI 补的，就写 `src: '需求原文'` 加 `status: 'assumed'`，并在 `statusNote` 写清哪部分是推断。

## 公共组件 W.shared

跨页面重复出现的外壳（顶部导航、底部 Tab、全局搜索）登记一次：

```js
W.shared({
  id: 'pc-shell', end: 'pc', title: 'PC 顶部导航',      // end: '*' 表示所有端
  fns: [{ id: 'pc-nav', name: '顶部导航与账号菜单', desc: '……', rules: ['……'], src: '……' }]
});
```

公共功能点的 ID 不能与该端页面的功能点重名。页面里用 `data-fn="pc-nav"` 绑定即可。

## 核心流程 flows

```js
{
  id: 'f1', name: '员工发起请假', ends: '员工手机端', preset: 'normal',
  desc: '首页 → 填写 → 确认 → 详情',
  steps: [
    { p: 'M01', st: 'list', tip: '点“发起请假”。' },
    { p: 'M02', st: 'confirm', tip: '确认弹层复述时长和余额变化。点“确认提交”。', label: '确认提交', set: 'balance.annual=3.5' },
    { p: 'M02', st: 'nobalance', branch: '余额不足', tip: '……' }
  ]
}
```

`tip` 告诉演示者这一步看什么、点哪里。演示时点画板上的按钮也会自动前进到匹配的步骤。一条流程可以跨端（如 PC 发起、手机端响应），`ends` 只是显示文字。

**总流程图**：需求文档“核心流程”一章开头、“核心流程”演示页上方，自动画一张图，把所有流程汇总在一起，用于汇报时快速过一遍。不用另写数据：

- 一个页面一个方框，同一页里的弹窗和状态合在一起；按步骤顺序连箭头，箭头上标第几条流程（①②…），流程开始的页面画成实心胶囊并标 ▶。
- 每个端一块、一种颜色，从上往下排；跨端的箭头是虚线。
- 关键分支在进入分支的那一步写 `branch`（一小段文字，12 字以内），它会写在箭头上并用橙色标出；分支停在同一页时画成回到本页的箭头。
- 流程名不要再带“流程 1 ·”这类编号，图和文档统一按 ①②… 编号。
- 构建时把图预先渲染成 SVG 放进交付文件，不为它内嵌 Mermaid 库；导出的 Markdown 里是 Mermaid 代码。点图可以放大。
- 自动图不合适时，在 `product.flowMap` 写 Mermaid 文本手画；写 `false` 不画。手画的语法错会报 `FLOW` 并阻止交付。

## 演示数据

- `demo` 是默认数据，`c.s` 读取；`set` 字符串格式 `'a=1;b.c=true;preset=empty'`，或对象 `{ 'b.c': true }`。
- `data-set` 可挂在跳转元素上，如 `h.btn('补签', { go: 'P02', st: 'ended', set: 'stu.s3=done' })`。
- 跳转时的顺序：先应用目标状态的 `states[].set`，再应用按钮上的 `data-set`（按钮更具体，后者优先）。
- 演示数据保存在评审者的浏览器里，跨页面、刷新后都保留；顶栏“重置演示数据”恢复默认。
- 构建检查对每个状态：先应用该状态的 `set`，再分别套用默认数据和每个数据场景各渲染一遍。只在某个数据场景才出现的按钮也会被检查。

## 版本 changes

见 `iteration.md`。页面、功能点、字段、规则都可以带 `changes: [{ ver, type: 'added' | 'modified' | 'removed', note }]`。

## 写作要求

需求写给研发和测试看，要能直接据此开发和设计用例。

- `desc` 写**交互**：用户做什么、系统怎么响应、结果去哪。不写“展示 xx 信息”这类看图就知道的话。
- `rules` 写**看不出来的业务规则**：计算口径、权限差异、状态条件、联动、影响范围。
- `errors` 写**会出错的地方**：校验失败、并发、重复提交、权限不足、网络失败，以及失败后界面怎么样。
- `fields.rule` 写**可验证的约束**：长度、范围、格式、唯一性、默认值来源、脱敏方式。
- 状态的 `when` 写**触发条件**，测试能据此造数据。
- 不要为标题、返回、普通导航单独写功能点：顶部/底部导航登记为公共组件，面包屑用 `h.crumb()`，返回箭头和抽屉关闭叉由组件自动豁免。
- 一个功能点内可交互元素超过 15 个，通常说明它应该拆开。
- 数量由页面复杂度决定：简单页面 1–3 个功能点，复杂页面 6–10 个；不为凑数拆分。

## 范围基线 prd/scope.json

范围基线记录用户确认范围时的页面、状态、功能点。构建时拿它和当前原型对比：确认之后新增的内容给出 `SCOPE_ADDED`，删掉的给出 `SCOPE_REMOVED`，并列入需求文档“范围确认后新增”一章。两类提醒都不阻止交付。用 `changes` 标为 `removed` 的条目还留在数据里，不报 `SCOPE_REMOVED`；范围汇报要同时看基线差异和本版 `changes`，标记移除的从 `changes` 统计。

**什么时候写**

- **新建（流程 A）**：用户确认范围清单后，先用 `new.mjs` 建项目（它会生成 `prd/kit.js` 里的公共导航），再在写页面代码之前，Agent 按清单手写 `prd/scope.json`。清单里的每个页面、状态、功能点都要列入，`kit.js` 里的公共功能点（如 `公共/pc-shell/pc-nav`、`公共/m-shell/m-tab`）也要列入。这样，写页面期间多出来的内容会被当作“确认后新增”。
- **修改、迭代（流程 C、D）**：增删按 `SKILL.md` 硬性规则“范围确认”处理，用 `node scripts/build.mjs <项目目录> --scope-baseline` 刷新基线。
- 只改文字、不增删页面、状态或功能点时，不需要动这个文件。
- 旧项目没有这个文件也能构建，只是不做增删对比。

**格式**

```json
{
  "release": "V1.0",
  "confirmedAt": "2026-11-04",
  "pages": ["M01", "M02", "P01"],
  "states": ["M01/list", "M01/empty", "M02/form", "M02/err"],
  "fns": ["M01/balance", "M02/submit", "P01/table", "公共/pc-shell/pc-nav"]
}
```

| 字段 | 说明 |
| --- | --- |
| `release` | 确认范围的版本，如 `V1.0` |
| `confirmedAt` | 用户确认范围的日期，`YYYY-MM-DD` |
| `pages`、`states`、`fns` | 字符串数组，三项都要写；没有内容时写 `[]` |

**key 规则**：编号必须和 `W.page` 的 `id`、状态的 `id`、功能点的 `id` 完全一致（区分大小写）。

| 类别 | 写法 | 示例 |
| --- | --- | --- |
| 页面 `pages` | `页面ID` | `M02` |
| 状态 `states` | `页面ID/状态ID` | `M02/err` |
| 功能点 `fns` | `页面ID/功能点ID` | `M02/submit` |
| 公共组件功能点 `fns` | `公共/组ID/功能点ID`（组 ID 是 `W.shared` 的 `id`） | `公共/pc-shell/pc-nav` |

key 写错会同时出现 `SCOPE_ADDED`（新 key 不在基线里）和 `SCOPE_REMOVED`（基线里的 key 找不到），按提醒改正即可。文件不是合法 JSON，或 `pages` / `states` / `fns` 不是字符串数组时，构建给出 `SCOPE_FILE` 并阻止交付。

**由 `--scope-baseline` 生成**：刷新时构建会按当前原型覆盖文件。确认日期不是当天时，加 `--confirmed-at YYYY-MM-DD`。
