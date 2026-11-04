# 第三方组件

构建时会把以下开源组件内嵌进生成的单 HTML。它们不适用本项目的 MIT 授权，版权和许可归各自权利人所有；交付 HTML 末尾以注释形式保留了完整许可文本。

| 组件 | 版本 | 用途 | 许可 | 文件 |
| --- | --- | --- | --- | --- |
| [Marked](https://github.com/markedjs/marked) | 18.0.7 | Markdown 解析 | MIT | `prd-prototype/assets/vendor/marked.umd.js`、`marked-LICENSE` |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.2.7 | 需求文字与流程图的白名单清洗 | Apache-2.0 或 MPL-2.0（二选一） | `prd-prototype/assets/vendor/purify.min.js`、`DOMPurify-LICENSE` |
| [Mermaid](https://github.com/mermaid-js/mermaid) | 11.16.0 | 流程图、架构图（只在需求文字里用了 mermaid 代码块时才内嵌） | MIT | `prd-prototype/assets/vendor/mermaid.min.js`、`mermaid-LICENSE` |

`mermaid.min.js` 中保留了其构建产物所含依赖的版权注释，不得删除。
