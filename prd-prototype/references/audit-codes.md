# 构建检查代码

`node scripts/build.mjs` 在无头浏览器中把每个页面的每个状态，在默认数据和每个数据场景下各渲染一遍，然后双向对账。任何“错误”都会阻止生成交付文件；“提醒”只显示，不阻止。

同一个元素在多个状态、多个数据场景下的问题只报一次，并列出出现的状态。统计里的“交互元素”按页面去重计数。

失败时会在 `<项目>/.prd-build/<文件名>.failed.html` 留一份排查文件，右侧“评审摘要”里也能看到问题列表。

## 错误

| 代码 | 含义 | 怎么改 |
| --- | --- | --- |
| `UNREGISTERED` | 原型里有按钮、链接、输入框或可点区域不属于任何功能点 | 是需求：登记功能点并用 `data-fn`（托管用 `sel`）绑定。不是需求：从原型删除。演示切换：放进 `h.demo()`。托管原型里不纳入的：写进 `end.ignore` 并写 `why` |
| `FN_UNUSED` | 需求里登记了功能点，原型里任何状态都没出现 | 原生：在原型中实现并绑定，或删除这条需求；纯后台逻辑写 `ui: false`。托管：核对 `sel`；检查元素是否被原型在 iframe 中隐藏（用 `end.boot`）；原型确实没画写 `gap` |
| `FN_UNKNOWN` | `data-fn` 指向的功能点不存在 | 改正 ID，或在本页 / 公共组件中登记 |
| `FN` | 功能点缺少 id 或 name，或 `gap` 没写成完整的一句话 | 按提示补全 |
| `FN_DESC` | 功能点缺交互说明 | 写 `desc`：用户怎么操作、系统怎么响应 |
| `FN_SRC` | 功能点既没有来源，也没标假设或待确认 | 有依据写 `src`；没有依据标 `status: 'assumed'` 或 `'pending'` |
| `FIELD_MISSING` | 功能点里有输入控件，但没有字段定义，或字段都没写必填 | 补 `fields`，输入字段写 `required: true / false` |
| `FIELD_UNDECLARED` | `data-field="key"` 在所属功能点的 `fields` 中找不到 | 在 `fields` 补上该 key，或改正 `data-field` |
| `FIELD` | 字段缺 `name` / `type`，或 `rule` 和 `options` 都没写，或绑定了控件却没写 `required` | 按提示补全 |
| `FIELD_REQ` | 字段在 `fields` 中的 `required` 与界面上 `h.fld` 的 `req` 不一致 | 两边改成一致：界面写 `req: 1`，或把 `fields` 的 `required` 改成对应值 |
| `LIST_FIELDS` | 列表/表格没有字段定义 | 用 `fields` 写清每列或每项的含义、格式、来源 |
| `LIST_EMPTY` | 列表/表格没写空数据表现 | 写 `empty` |
| `ERRORS` | 有改变数据的操作（按钮或链接，见下方词表），但没写异常处理 | 写 `errors`：校验失败、重复提交、并发冲突、权限不足、网络失败。误判时给元素加 `{ submit: false }`（`data-op="nav"`） |
| `STATE_WHEN` | 页面状态缺出现条件 | 写 `when` |
| `STATE` | 状态 ID 重复、缺 label、layer 取值不对 | 按提示修改 |
| `PAGE` | 页面缺 `title` 或 `goal` | 补全 |
| `PRODUCT` | 产品缺名称、背景、本期不做、角色、端或版本 | 补全 `product.js` |
| `END` | 端配置错误：device 不是 pc/mobile、没有页面、home 不存在 | 按提示修改 |
| `FN_DUP` | 功能点 ID 在本页重复，或与本端公共组件重名 | 改成唯一 ID |
| `FN_ROOT` | 功能点绑定在整个页面外壳上 | 绑定到具体区域 |
| `FN_REMOVED` | 标记为 `removed` 的功能点还在原型里 | 从 render 中删除 |
| `GO_TARGET` | `data-go` 或 `h.submit` 的 `ok` 跳转到不存在的页面或状态 | 改正目标 |
| `BEHAVE` | `h.submit` 的 `form` 找不到唯一的 `h.form`，或 `h.search` 的 `filter` 找不到唯一的 `h.rows` | 两边的 id 写成一致，且在页面内唯一 |
| `FLOW` | 流程步骤引用的页面或状态不存在 | 改正 |
| `PRESET` | `set` 引用了未登记的数据场景 | 在 `scenarios.presets` 中登记 |
| `RELEASE` | `changes` 引用了未登记的版本，或修改/移除没写 `note` | 按提示修改 |
| `RENDER` | 页面 `render` 或 `after` 抛出异常 | 修复代码；常见原因是读了不存在的演示数据 |
| `JS` | 浏览器运行时报错 | 打开 failed 文件看控制台 |
| `BOOT` | 注册阶段出错：页面 ID 重复、end 未声明 | 按提示修改 |
| `HOST` | 托管配置错误：找不到原型、`ignore` 没写原因；或本地样式的 `@import` 带 `layer()` / `supports()`，内联后无法保持原样 | 按提示修改 |
| `HOST_SEL` | 托管页面的功能点没有 `sel` | 给功能点补上 `sel`（CSS 选择器），绑定到原型里的对应元素 |
| `HOST_ENTER` | 进入步骤执行失败，或执行后 `match` 不成立 | 用 `probe-host.mjs --steps` 复现并修正 |
| `IMG_SRC` | 需求文字里的图片引用了本地路径或网址 | 改成 `data:image/...;base64,` 内嵌 |
| `TEXT` | 需求文字里有乱码，或 TODO、待补充、此处填写等占位 | 写真实内容；确实未定的写“… [待确认]” |
| `SINGLE_FILE` | 交付文件引用了外部或相对资源 | 把图片改成 data URI，去掉外链 |
| `HOST_NET` | 托管原型引用了网络脚本或样式（静态扫描到，或断网检查时运行发出）。断网后原型会失效 | 改为本地文件；托管原型确需联网，在该端写 `online: true` 显式放行（只对托管端生效，原生端无效） |
| `AC` | 功能点的 `ac` 格式不对：不是对象，或 `act` / `expect` 缺失或太短，或 `pre` 不是文字 | 写成 `ac: { pre: '…', act: '…', expect: '…' }`；`pre` 可省略 |
| `ROLE_ID` | 功能点的 `roles` 引用了未声明的角色 ID；或 `product.roles` 为空却写了 `fn.roles` | 检查角色 ID 拼写，或在 `product.roles` 补上该角色定义 |
| `SCOPE_FILE` | `prd/scope.json`（范围基线）不是合法 JSON，或 `pages` / `states` / `fns` 不是字符串数组 | 修正文件；不需要基线时删掉它 |

## 提醒

| 代码 | 含义 |
| --- | --- |
| `SCOPE` | “本期不做”为空 |
| `UNREACHABLE` | 页面没有任何入口（不是首页、不在流程中、没有按钮跳过来） |
| `LAYER` | 状态声明了弹层但没渲染弹层组件，或渲染了弹层但状态没声明 `layer` |
| `FN_BROAD` | 一个功能点下可交互元素超过 15 个（列表行内的除外），可能需要拆分 |
| `FLOW` | 流程步骤没写 `tip` |
| `HOST_MATCH` | 托管页面没有 `match`，点击原型时右侧需求不会自动切换 |
| `HOST_RES` | 托管原型引用了网络图片、字体或不存在的文件 |
| `ONLINE` | 端写了 `online: true`，其中的网络脚本或样式已放行。交付后需联网才能正常显示，交付说明里要标“需联网” |
| `RES` | 浏览时有资源加载失败（通常是托管原型引用的图片不存在），或断网检查时原型请求了网络图片、字体等资源 |
| `HOST_DIALOG` | 进入步骤触发了原生 alert / confirm / prompt，检查时已自动确认 |
| `IGNORED` | 有多少原型元素按 `end.ignore` 不纳入本次需求 |
| `GAP_NATIVE` | 原生线框原型写了 `gap`：原生原型应直接画出来 |
| `GAP` | 写了 `gap`，但原型里能找到绑定的元素 |
| `UNKNOWN_KEY` | 页面、状态、功能点、字段或产品上有不认识的字段名（多为拼写错误或放错位置），不会生效 |
| `AC_MISSING` | 核心流程里出现的功能点还没写 `ac`。按页面合并成一条；只是建议，测试可以直接据此写用例 |
| `SCOPE_ADDED` | 范围基线（`prd/scope.json`）里没有的页面、状态或功能点，即确认范围后新增的。按 `SKILL.md` 硬性规则“范围确认”处理：已确认的刷新基线，超出的列给用户，不纳入本期则删掉。需求文档“范围确认后新增”一章会列出 |
| `SCOPE_REMOVED` | 基线里有、原型里已没有的页面、状态或功能点（直接删掉，没有用 `removed` 标记）。处理方式同 `SCOPE_ADDED` |

## “改变数据的操作”词表（ERRORS）

按钮、链接或 `role=button` 元素的文字不超过 10 个字、包含下列词，且不以“进入、查看、去、前往、返回、打开、了解、预览”开头时，视为改变数据的操作。以下情况不算：位于导航、页签、面包屑、分页、菜单里；按钮不可点（`dis: true`）；点击后只是打开一个弹层状态（如“预约”打开确认底部弹层，异常处理写在确认弹层的功能点上）。

提交、保存、确认、确定、发布、创建、删除、移除、撤回、撤销、作废、停用、启用、支付、付款、发送、导入、上传、通过、驳回、拒绝、下单、购买、解绑、注销、转交、归档、补签、签到、结束、取消订单、退款、申请、预约、续借、借出、归还、报名、领取、兑换

自动判断不准时，用 `h.btn('签到', { submit: true, fn: 'checkin' })` 强制视为提交，或 `{ submit: false }` 视为导航。

## 原型阶段（`product.stage: 'prototype'`）

写了 `stage: 'prototype'` 时，下表的代码从错误降为提醒（构建结果里标为 `soft`）。缺了不阻止交付。删掉 `stage` 重新构建后，没补的项会变回错误。命令行把这些条目合并成一行“原型阶段：以下需求检查降为提醒……”，按代码列出条数。

| 代码 | 原型阶段下降为提醒的情况 |
| --- | --- |
| `PRODUCT` | `background` 缺失或过短；`scope.out` 没写；`roles` 为空 |
| `FN_DESC` | 功能点缺交互说明 `desc` |
| `FN_SRC` | 功能点没有 `src`，且没标 `assumed` / `pending` |
| `FIELD` | 字段缺 `name` 或 `type`，或 `rule` 和 `options` 都没写；绑定了输入控件却没写 `required` |
| `FIELD_MISSING` | 有输入控件但 `fields` 缺失，或 `fields` 都没写 `required` |
| `FIELD_UNDECLARED` | `data-field` 在所属功能点的 `fields` 中找不到 |
| `LIST_FIELDS`、`LIST_EMPTY` | 列表或表格没写 `fields`、`empty` |
| `ERRORS` | 有改变数据的操作，但没写 `errors` |
| `PAGE` | 页面缺 `goal`（缺 `title` 仍报错） |
| `STATE_WHEN` | 页面状态缺 `when` |

以下仍是错误，原型阶段不放宽：`UNREGISTERED`（原型里的可点元素没登记）、`FN_UNUSED`（登记了功能点但原型里没画）、`HOST_SEL`（托管页面的功能点没有 `sel`）、`HOST`（托管配置错误，包括 `ignore` 没写原因）、`TEXT`（含“待补充”“TODO”占位）、`PRODUCT` 的 `name`、`id`、`ends`、`releases`，`stage` 写成其他值、`FIELD_REQ`、`FN_SRC` 的 `status` 取值错误，以及表里其他代码。`SCOPE_ADDED` 和 `SCOPE_REMOVED` 在两种模式下都只是提醒。

原型阶段仍会打印 `AC_MISSING` 提醒，以及待确认与 AI 假设的数量。这些是正常输出，不是隐藏起来的内容。

## 不要这样“修”

- 为了通过检查删掉真实需求，或把真实功能塞进 `h.demo()` / `ignore`。
- 用一个大功能点包住整页来消除 `UNREGISTERED`。
- 把没有依据的内容写上 `src` 冒充已确认。
- 用 `--draft` 产物交付。
- 为了通过检查给完整需求项目写 `stage: 'prototype'`。原型阶段不是绕过检查的开关。
- 原型阶段里用“待补充”占位代替留空。`TEXT` 仍会报错，不写即可。
