# 导出给开发和测试

把功能点、字段、验收条件导出成 CSV，Excel 可直接打开；需要截图时再导出研发包。

## 在交付 HTML 里导出

- **默认模式**：打开「需求文档」，文档栏有「导出 CSV」，与「导出 Markdown」并列。下载一个合并文件：`<产品名>-研发测试清单-<版本>.csv`，带 UTF-8 BOM。文件里用 `sheet` 列区分三张表：`fns`（功能点）、`fields`（字段）、`ac`（验收条件）。
- **原型阶段**：没有需求文档栏。顶栏有「清单」按钮，下载同一份合并 CSV。

公共组件的 `pageId` 写作 `S:<端ID>`（与评审意见的挂点写法一致）。已标记为移除（`removed`）的功能点和字段不导出。单元格按 RFC 4180 转义（逗号、双引号、换行）。

## 命令行

```bash
# 检查通过后，在交付文件旁写三份 CSV（功能点、字段、验收条件）
node scripts/build.mjs <项目目录> --csv

# 检查通过后，写研发包到 export/<产品名>-研发包-<版本>/
node scripts/build.mjs <项目目录> --export-pack
```

- `--csv`：三份文件名是 `<产品名>-功能点-<版本>.csv`、`<产品名>-字段-<版本>.csv`、`<产品名>-验收条件-<版本>.csv`，各带 UTF-8 BOM。原型阶段也能用（与 `--md` 不同；`--md` 在原型阶段仍会报错）。没有验收条件时，验收条件文件只有表头。
- `--export-pack`：目录里有上述三份 CSV、`pages/`（每个页面默认状态的截图）、`清单.md`（功能点表 + 截图引用）。默认不导出；检查未通过时不写目录。
- `--draft` 不能和 `--csv`、`--export-pack` 一起用。

## 三张表列

| 表 | 列 |
| --- | --- |
| 功能点 | pageId, pageTitle, endId, fnId, fnName, desc, perm, src, status |
| 字段 | pageId, fnId, fnName, key, name, type, required, def, options, rule |
| 验收条件 | pageId, fnId, fnName, pre, act, expect |

合并 CSV 的列是以上并集，外加最前面的 `sheet`。`status` 只写「待确认」或「AI 假设」，已确认留空。`required` 写作「是」或「否」。`options` 多个值用顿号「、」连接；`def` 是默认值。
