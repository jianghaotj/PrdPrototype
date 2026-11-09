# 原型需求 · prd-prototype

> 一份需求数据，同时生成可点击的原型（线框或高保真）和完整的需求文档，打包成一个离线 HTML。

![原型需求：线框原型与需求文档同源](docs/images/prd-prototype-cover.png)

[![Version](https://img.shields.io/badge/version-1.2.0-8f7650)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-1f1a14)](LICENSE)
[![Output](https://img.shields.io/badge/output-Single_HTML-315d93)](#交付物长什么样)
[![Node](https://img.shields.io/badge/node-18%2B-2e6b4f)](#安装)

「原型需求」是一个面向 AI Agent 的产品技能。它把原型和需求文档写进同一份数据。原型上的编号圆点、右侧的功能点卡片、需求文档里的条目，都指向同一个功能点。

构建时，脚本会在无头浏览器里逐页、逐状态渲染原型，再和需求数据对账。对不上就不交付。

## 解决什么问题

| 团队反馈的问题 | 做法 |
| --- | --- |
| AI 生成原型时多出很多需求里找不到的功能 | 原型里每个按钮、链接、输入框都必须属于已登记的功能点，否则构建失败 |
| 照着 HTML 写需求，不是缺交互说明就是缺数据定义 | 按原型实际渲染出的元素反查：每个状态要有出现条件，有输入就要有字段定义和必填，有列表就要有空数据说明，有提交或删除就要有异常处理 |
| 只给几句话就生成原型，AI 自由发挥 | 先轻量澄清（最多 2 轮、每轮不超过 6 题、每题带推荐答案），再确认范围清单，确认后才画；没有依据的内容必须标“AI 假设”或“待确认” |
| 原型和文档两份文件，研发测试读着不连贯 | 只交一个 HTML：左侧页面目录、中间原型、右侧本页需求；顶部“切换”下拉框选需求文档（全文，可导出 Markdown、CSV、打印 PDF）、各端原型或核心流程 |

## 交付物长什么样

- **需求文档**（首页）：概述与范围、角色权限、信息架构、核心流程、全局规则、逐页需求（页面目标、状态与出现条件、功能点、字段表、规则、异常与边界）、公共组件、数据字典、需求与原型的差异、待确认与 AI 假设、澄清记录、变更记录。
- **顶部切换**：一个下拉框，选项是需求文档、各端原型（写着 PC 或手机、页面数）和核心流程。窗口宽 1100 及以下时顶栏分两行，下拉框在第一行，工具按钮排在第二行；手机宽度时下拉框占满第一行。支持键盘：↓ 打开，↑ ↓ Home End 移动，Enter 选中，Esc 收起。
- **各端页面**：PC 浏览器框或手机框画板。画板上的编号圆点与右侧功能点卡片一一对应，点击互相定位，并高亮目标区域。弹层状态只显示最高层的功能点。
- **核心流程**：逐步演示。直接点画板里的按钮也会前进。
- **工具**：热区（`H`）、标注圆点（`N`）、缩放、目录和需求面板开关、数据场景切换、重置演示数据、本版变化、意见、清单（原型阶段顶栏，导出研发测试 CSV）、角色下拉（有 `product.roles` 时，按角色过滤画板与需求卡片）。
- **意见**：评审的人可以在功能点上留意见，然后导出一个 JSON 文件。意见只存在评审人自己的浏览器里，不上传。`scripts/merge-comments.mjs` 把几份 JSON 合并成按功能点分组的 Markdown，交给修改需求的人或 Agent 逐条处理。
- **研发测试清单**：默认模式在需求文档栏点「导出 CSV」，原型阶段在顶栏点「清单」，下载功能点、字段、验收条件（UTF-8 带 BOM，Excel 可直接打开）。命令行用 `build.mjs --csv` 写三份 CSV，或 `--export-pack` 再带上每页截图和清单.md。
- **声明式交互**：表单必填和长度校验、提交（防重复点击、失败后可重试、成功后更新列表）、搜索筛选。这些由组件实现，规则会自动写进需求文档。
- **范围基线**（可选）：确认范围后写入 `prd/scope.json`。之后新增或移除的页面、状态、功能点只给提醒，并在需求文档单列“范围确认后新增”。
- **验收条件**（可选）：功能点可以写 `ac`（前置条件、用户操作、预期结果），集中列在需求文档的“验收条件”一章。
- **断网门槛**：构建时断网运行检查。托管原型引用的网络脚本和样式会阻止交付。确需联网的端写 `online: true`，交付物会标“需联网”。
- **高保真**（可选）：`new.mjs --hifi` 生成样式骨架 `prd/theme.css`。配色、字阶、间距、组件状态由 Agent 按产品自行设计（做法见 `references/hifi.md`），不绑定任何公司设计规范。需求和对账检查与线框完全一样。

## 真实截图

下面的截图由技能生成，没有手工绘制或修改。流程是：`build.mjs` 构建 `examples/` 下的样例，再由 `snap.mjs` 截取画面。画面里的数据都是演示数据，画板下方标有“画面中的数据均为演示数据”。

### 高保真样例：课程管理（视觉由 AI 自拟）

![需求文档首页：统计数字与构建检查结果](docs/images/course-mgmt-doc.png)

需求文档首页。顶部统计和右侧的评审摘要都来自构建结果。

![课程列表：画板上的编号圆点与右侧功能点对应](docs/images/course-mgmt-list.png)

课程列表页。画板上的编号圆点对应右侧的功能点卡片。配色和组件样式写在样例的 `prd/theme.css` 里，是 AI 按“高校教务后台”自拟的。

![新建课程弹窗：提交时未通过的必填项在字段下方给出原因](docs/images/course-mgmt-create-validation.png)

新建课程弹窗。提交空表单时，未通过的必填项在字段下方给出原因。

### 线框样例：请假审批

![手机端请假首页：年假、病假、事假余额与最近请假记录](docs/images/leave-approval-mobile-home.png)

手机端请假首页。

![PC 审批详情：右侧抽屉展示申请信息与申请人本年度请假](docs/images/leave-approval-pc-review.png)

PC 审批详情抽屉。左侧列表保持可见，抽屉覆盖在右侧。

![HR 请假统计：按月查看，可导出明细](docs/images/leave-approval-stats.png)

HR 请假统计页。

## 两种用法

**从需求开始（原生）**：需求材料或几句话，经过轻量澄清和范围清单确认，再写需求数据和页面，构建对账后交付。默认出线框；要高保真时加 `--hifi`，视觉只写在样式层（`prd/theme.css`），页面代码不写色值。

**给已有 HTML 补需求（托管模式）**：同事已有的 AI 原型保持原样，放进 sandbox iframe 里运行。用选择器把功能点绑定到原有元素。原型里有、本期不做的元素用虚线框标出。需求里有、原型没画的功能单独列出。适合“已经有 HTML，又有一份对不上的 PRD”的情况。

## 原型阶段：先出样子，需求以后再补

需求还没定，只想先让领导或同事看看产品样子时，在 `prd/product.js` 里写 `stage: 'prototype'`。

- 功能点只写编号和名称，不写交互说明、字段和异常处理。这些缺失只给提醒。
- 交付 `<产品名>-原型.html`。打开直接进第一个端的首页，切换下拉框里没有“需求文档”这一项，也没有需求面板，编号圆点默认隐藏，按 `N` 可以打开。圆点的显示状态不会保存。
- 顶部显示“原型阶段 · 检查通过”。
- 原型本身照常检查：原型里多出的、没登记的按钮，登记了却没画出来的功能点，写错的字段或跳转，仍然阻止交付。
- 原型阶段不能用 `--md` 导出需求文档，会直接报错。托管模式（已有 HTML 补需求）也能用原型阶段：绑定和 `ignore` 仍要写，虚线框和圆点默认隐藏，按 `N` 显示。
- 需求定了：删掉 `stage` 那一行，重新构建。之前降为提醒的需求检查会变回错误，错误清单就是还要补的需求。

原型阶段不是绕过检查的开关。需求已经定下来的项目，不要写这一行。

![会议室列表：顶部标“原型阶段 · 检查通过”，切换下拉框里没有需求文档，圆点已隐藏](docs/images/prototype-stage-meeting-list.png)

![预订弹窗：点“预订”打开的确认弹层，字段和按钮照常可操作](docs/images/prototype-stage-meeting-book.png)

## 安装

要求：

- Node.js 18 或更高版本。
- 本机装有 Chrome、Edge 或 Chromium。构建检查和截图要用到它。找不到时，设置环境变量 `CHROME_PATH`。

不需要通过 npm 安装任何依赖。

把 `prd-prototype/` 整个目录复制到 Agent 的 Skills 目录，例如：

```text
~/.claude/skills/prd-prototype
~/.codex/skills/prd-prototype
~/.kiro/skills/prd-prototype
```

## 怎么说

```text
使用 prd-prototype，根据 docs/需求.md 做一个交互原型和需求文档。
```

```text
使用 prd-prototype，给 demo/发布任务.html 补需求，PRD 在 demo/发布任务-PRD.md。原型画面保持原样。
```

```text
使用 prd-prototype，按评审意见修改 ./课堂签到 项目：补签需要填写原因。
```

```text
使用 prd-prototype，基于 ./请假审批 做 V1.1：统计页支持导出明细，去掉申请人历史。
```

## 命令

```bash
node prd-prototype/scripts/new.mjs <项目目录> --name "产品名" --id short-name --end pc:管理后台 --end mobile:员工手机端
node prd-prototype/scripts/new.mjs <项目目录> --name "产品名" --id short-name --end pc:管理后台 --hifi
node prd-prototype/scripts/new.mjs <项目目录> --name "产品名" --host 已有原型.html
node prd-prototype/scripts/probe-host.mjs 已有原型.html [--steps '[...]'] [--shot a.png]
node prd-prototype/scripts/build.mjs <项目目录> [--md] [--csv] [--export-pack]
node prd-prototype/scripts/build.mjs <项目目录> --scope-baseline --confirmed-at 2026-11-04
node prd-prototype/scripts/snap.mjs <产物.html> [--view "#/p/P01/list"]
node prd-prototype/scripts/merge-comments.mjs 意见A.json 意见B.json -o 评审意见合并.md [--prd <项目目录>]
node prd-prototype/scripts/test-skill.mjs
```

各命令的作用：

- `new.mjs`：生成项目骨架。`--hifi` 出高保真（生成样式骨架，PC 端 1440×900），`--host` 进入托管模式。
- `build.mjs`：构建并对账。`--md` 同时导出需求文档 Markdown。`--csv` 写出功能点/字段/验收条件三份 CSV（原型阶段也可用）。`--export-pack` 写出研发包（CSV + 每页截图 + 清单.md）。`--scope-baseline` 在用户确认范围增删后，刷新 `prd/scope.json`。
- `probe-host.mjs`：探测已有 HTML 的结构和风险点。
- `snap.mjs`：截取交付物的各个视图，用来检查画面。
- `merge-comments.mjs`：把交付物里导出的评审意见 JSON 合并成 Markdown，每条带序号。
- `test-skill.mjs`：技能自身的回归测试。

## 样例

`prd-prototype/examples/leave-approval/` 是线框基线样例。员工在手机端发起请假，主管在 PC 端审批，HR 查看统计。样例包括表单、校验失败状态、确认底部弹层、列表、抽屉叠弹窗、数据场景切换、两条核心流程，以及待确认和 AI 假设标记。直接打开 `请假审批-原型需求.html` 即可。

`prd-prototype/examples/course-mgmt/` 是 PC 高保真样例，视觉由 AI 自拟（`prd/theme.css`、`prd/theme-kit.js`）。它是课程管理后台，包含列表搜索与分页、新建课程弹窗（校验、提交失败后重试、列表更新）和课程详情抽屉。业务内容都是 AI 假设，并在文档中标出。直接打开 `课程管理-原型需求.html` 即可。

## 质量

`node prd-prototype/scripts/test-skill.mjs` 应全部通过。测试覆盖以下内容：

- 两个样例的构建，以及托管构建。
- 20 余类门禁反例。每类都必须拦住，并且不覆盖已有交付文件。
- 托管模式反例。
- 断网门槛：`HOST_NET` 拦截，`online: true` 放行。
- 范围基线：`SCOPE_ADDED`、`SCOPE_REMOVED` 和 `--scope-baseline`。
- 声明式交互：校验、提交、搜索筛选、`FIELD_REQ`。
- 高保真：`--hifi` 骨架、`--theme` 已移除的提示、旧项目自带 `theme.css` / `theme-kit.js` 照常纳入、PC 作用域、对话框、分页、缺省页。
- 版本迭代与归档。
- 评审意见：留意见、刷新后保留、导出 JSON、原型阶段和托管原型阶段的面板，以及多份意见的合并。
- 研发测试导出：合并 CSV 下载、BOM 与转义、`--csv` 三份文件、原型阶段「清单」、托管模式、`--export-pack` 研发包，以及检查失败时不写出。
- 按角色看原型：`ROLE_ID` 校验、顶栏角色下拉、秘书角色隐藏新建、原型阶段与托管按 `sel` 过滤、刷新后记住角色。
- 浏览器端交互：顶部切换下拉框（1600、1024、390 宽，点选、键盘、点外面收起，选完后快捷键仍可用）、圆点定位、状态切换、弹层层级、流程演示、快捷键、窄屏、托管状态识别、sandbox。
- 内容安全：DOMPurify 清洗。
- 脚手架。

## 目录

```text
docs/images/         README 题图与截图
prd-prototype/
├─ SKILL.md            技能入口与流程
├─ references/         澄清、需求格式、组件、高保真、托管模式、版本迭代、检查代码
├─ assets/runtime/     浏览器外壳、组件、文档生成、检查逻辑
├─ assets/template/    新项目模板
├─ assets/vendor/      Marked、DOMPurify、Mermaid 及许可
├─ scripts/            新建、构建、探测、截图、回归测试
├─ examples/           完整样例
└─ tests/fixtures/     托管模式夹具
```

版本变化记录在 [CHANGELOG.md](CHANGELOG.md)。

## 来源与许可

- 浏览结构（页面目录、热区、页面状态、核心流程、缩放、重置数据）参考了团队内的一期交互线框原型。
- 版本迭代、内容安全、单文件审计等思路来自「原型标注」技能（基于 [lin96008-maxlin/prototype-annotation](https://github.com/lin96008-maxlin/prototype-annotation) 二次开发，MIT）。
- 轻量澄清借鉴了 [mattpocock/skills](https://github.com/mattpocock/skills) 中 grilling 的做法：每题给推荐答案，回“是”即采纳，事实自己查。去掉了“问到所有分支走完为止”。
- 题图由 [Guizang Social Card Skill](https://github.com/op7418/guizang-social-card-skill) 的 Editorial 模板生成。该模板按 AGPL-3.0 许可，题图源文件不在本仓库中。
- 第三方组件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目代码按 [MIT License](LICENSE) 发布。
