# 原型需求 · prd-prototype

> 一份需求数据，同时生成可点击的线框原型和完整的需求文档，打包成一个离线 HTML。

面向 AI Agent 的产品技能。它把“线框原型”和“需求文档”合成同一份数据：功能点既是原型上的编号圆点，也是右侧面板的卡片，也是需求文档里的条目。构建时在无头浏览器里逐页逐状态渲染原型，和需求双向对账，对不上就不交付。

## 解决什么问题

| 团队反馈的问题 | 做法 |
| --- | --- |
| AI 生成原型时多出很多需求里找不到的功能 | 原型里每个按钮、链接、输入框都必须属于已登记的功能点，否则构建失败 |
| 照着 HTML 写需求，不是缺交互说明就是缺数据定义 | 按原型实际渲染出的元素反查：每个状态要有出现条件，有输入就要有字段定义和必填，有列表就要有空数据说明，有提交/删除就要有异常处理 |
| 只给几句话就生成原型，AI 自由发挥 | 先轻量澄清（最多 2 轮、每轮不超过 6 题、每题带推荐答案），再确认范围清单，确认后才画；没有依据的内容必须标“AI 假设”或“待确认” |
| 原型和文档两份文件，研发测试读着不连贯 | 只交一个 HTML：左侧页面目录、中间原型、右侧本页需求；顶部“需求文档”是全文，可导出 Markdown、打印 PDF |

## 交付物长什么样

- **需求文档**（首页）：概述与范围、角色权限、信息架构、核心流程、全局规则、逐页需求（页面目标、状态与出现条件、功能点、字段表、规则、异常与边界）、公共组件、数据字典、需求与原型的差异、待确认与 AI 假设、澄清记录、变更记录。
- **各端页面**：PC 浏览器框或手机框画板；编号圆点与右侧功能点卡片一一对应，点击互相定位并高亮目标区域；弹层状态只显示最高层的功能点。
- **核心流程**：逐步演示，直接点画板里的按钮也会前进。
- **工具**：热区 `H`、标注圆点 `N`、缩放、目录/需求面板开关、数据场景切换、重置演示数据、本版变化。

保留了 i 雅思线框原型的浏览结构（页面目录、热区、页面状态、核心流程、缩放、重置数据），把“页面说明”升级成可评审的需求，把“总览”升级成全文需求文档。

## 两种用法

**从需求开始（原生线框）**：需求材料或几句话 → 轻量澄清 → 范围清单确认 → 写需求数据和页面 → 构建对账 → 交付。线框组件和设计变量分离，换成团队设计体系时只改样式层。

**给已有 HTML 补需求（托管模式）**：同事已有的 AI 原型保持原样，放进 sandbox iframe 运行；用选择器把功能点绑定到原有元素。原型里有、本期不做的元素用虚线框标出；需求里有、原型没画的功能单独列出。适合“先有 HTML、又有一份对不上的 PRD”的情况。

## 安装

要求：Node.js 18+；本机有 Chrome、Edge 或 Chromium（构建检查和截图用，找不到时设置 `CHROME_PATH`）。不需要 npm 安装任何依赖。

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
node prd-prototype/scripts/new.mjs <项目目录> --name "产品名" --host 已有原型.html
node prd-prototype/scripts/probe-host.mjs 已有原型.html [--steps '[...]'] [--shot a.png]
node prd-prototype/scripts/build.mjs <项目目录> [--md]
node prd-prototype/scripts/snap.mjs <产物.html> [--view "#/p/P01/list"]
node prd-prototype/scripts/test-skill.mjs
```

## 样例

`prd-prototype/examples/leave-approval/` 是完整样例：员工手机端发起请假、主管 PC 端审批、HR 查看统计。包括表单、校验失败状态、确认底部弹层、列表、抽屉叠弹窗、数据场景切换、两条核心流程、待确认和 AI 假设标记。直接打开 `请假审批-原型需求.html` 即可。

## 质量

`node prd-prototype/scripts/test-skill.mjs` 覆盖：样例构建、托管构建、20 余类门禁反例（每类都必须拦住且不覆盖已有交付文件）、托管反例、版本迭代与归档、浏览器端交互（圆点定位、状态切换、弹层层级、流程演示、快捷键、窄屏、托管状态识别、sandbox）、内容安全（DOMPurify 清洗）、脚手架。

## 目录

```text
prd-prototype/
├─ SKILL.md            技能入口与流程
├─ references/         澄清、需求格式、组件、托管模式、版本迭代、检查代码
├─ assets/runtime/     浏览器外壳、组件、文档生成、检查逻辑
├─ assets/template/    新项目模板
├─ assets/vendor/      Marked、DOMPurify、Mermaid 及许可
├─ scripts/            新建、构建、探测、截图、回归测试
├─ examples/           完整样例
└─ tests/fixtures/     托管模式夹具
```

## 来源与许可

- 浏览结构来自 i 雅思一期交互线框原型。
- 版本迭代、内容安全、单文件审计等思路来自「原型标注」技能（基于 [lin96008-maxlin/prototype-annotation](https://github.com/lin96008-maxlin/prototype-annotation) 二次开发，MIT）。
- 轻量澄清借鉴了 [mattpocock/skills](https://github.com/mattpocock/skills) 中 grilling 的做法：每题给推荐答案、回“是”即采纳、事实自己查；去掉了“问到所有分支走完为止”。
- 第三方组件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目代码按 [MIT License](LICENSE) 发布。
