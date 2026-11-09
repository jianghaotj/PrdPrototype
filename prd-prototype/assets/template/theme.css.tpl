/* ─────────────────────────────────────────────────────────────────────────
 * 高保真样式骨架（new.mjs --hifi 生成，构建时内联进交付 HTML）
 *
 * 视觉由模型自行设计，不绑定任何公司规范。动笔前读 references/hifi.md：
 *   1. 先按产品和用户写一句视觉方向，再定下面的变量；方向写进文件头这段注释。
 *   2. 选择器都要以 .ab 开头（只改画板，不改评审外壳）。只改 PC 画板用 .ab[data-device="pc"]，只改手机画板用 .ab[data-device="mobile"]。
 *   3. 页面代码不写色值。颜色、字号、圆角、阴影都放在这里，页面只用 h.* 组件和这里定义的类。
 *   4. 不引用网络字体、图片或样式（断网检查会拦）。字体用系统字体栈，图标用内联 SVG（h.i）。
 *
 * 下面的变量名与 wire.css 相同，取消注释并改成你定的值即可。没改的变量保持线框默认值。
 * ───────────────────────────────────────────────────────────────────────── */

.ab {
  /* 文字：正文、次级、说明（说明文字在白底上对比度不低于 4.5:1） */
  /* --ink: #1d2129; --ink2: #4e5969; --ink3: #86909c; */

  /* 线与底：分割线、浅分割线、填充、深一级填充、页面底色 */
  /* --line: #dcdfe4; --line2: #eceef1; --fill: #f5f6f8; --fill2: #eceef2; --pg: #f6f7f9; */

  /* 主色与浅底（主按钮、当前项、链接） */
  /* --acc: #2f5bea; --accw: #eaf0ff; */

  /* 语义色：成功、警告、错误，各有一个浅底 */
  /* --ok: #1e7f4f; --okw: #e7f5ed; --warn: #8a5d00; --warnw: #fff7df; --err: #c4322a; --errw: #fdeceb; */

  /* 圆角：控件、卡片 */
  /* --r: 8px; --r-lg: 10px; */
}

/* 组件覆盖示例（按需取消注释并改写）：
.ab .btn.pri { background: var(--acc); border-color: var(--acc); color: #fff; }
.ab .btn.pri:hover { filter: brightness(.92); }
.ab .btn:focus-visible, .ab .inp:focus-within { outline: none; box-shadow: 0 0 0 3px var(--accw); }
.ab .card { box-shadow: 0 1px 3px rgba(0, 0, 0, .06); }
*/
