// 规范包（设计主题）：列出可用规范包，并把规范包安装到项目的 prd/ 目录。
// 规范包目录结构：themes/<名称>/{tokens.css, theme.css, theme-kit.js}（另有 DESIGN.md、CONFLICTS.md 作说明）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const THEMES_DIR = path.resolve(here, '..', '..', 'themes');
const REQUIRED = ['tokens.css', 'theme.css', 'theme-kit.js'];

export function listThemes() {
  if (!fs.existsSync(THEMES_DIR)) return [];
  return fs.readdirSync(THEMES_DIR)
    .filter((n) => REQUIRED.every((f) => fs.existsSync(path.join(THEMES_DIR, n, f))))
    .sort();
}

export function resolveTheme(name) {
  if (!/^[\w-]+$/.test(name || '')) throw new Error('--theme 的名称只能包含字母、数字、- 和 _');
  const dir = path.join(THEMES_DIR, name);
  const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length) throw new Error('规范包「' + name + '」不存在或不完整（缺少 ' + missing.join('、') + '）。可用的规范包：' + (listThemes().join('、') || '无'));
  return dir;
}

/* 安装到 prd/：theme.css = tokens.css + theme.css（构建时内联进交付文件）；组件扩展复制为 theme-kit.js。 */
export function installTheme(prdDir, name) {
  const dir = resolveTheme(name);
  const css = fs.readFileSync(path.join(dir, 'tokens.css'), 'utf8') + '\n' + fs.readFileSync(path.join(dir, 'theme.css'), 'utf8');
  fs.writeFileSync(path.join(prdDir, 'theme.css'), css);
  fs.copyFileSync(path.join(dir, 'theme-kit.js'), path.join(prdDir, 'theme-kit.js'));
  return ['theme.css', 'theme-kit.js'];
}
