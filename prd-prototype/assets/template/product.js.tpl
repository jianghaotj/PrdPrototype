/* 产品级需求。页面级需求写在 pages/*.js。字段说明见技能 references/spec-format.md。
   没有依据的内容写成 “… [待确认]” 或 “… [AI 假设]”，不要当作已确认事实。 */
W.product({
  id: '{{id}}',
  name: '{{name}}',
  date: '{{date}}',
  fidelity: '低保真线框',
  releases: [
    { id: 'V1.0', date: '{{date}}', summary: '首版' }
  ],

  /* 业务背景：谁、在什么场景、遇到什么问题、本期要做成什么（必填） */
  background: '',
  goals: [],
  /* 本期明确不做的内容（必填，防止原型自由发挥） */
  scope: { out: [] },
  /* 角色与权限（必填） */
  roles: [
    // { id: 'admin', name: '管理员', desc: '', perms: [] }
  ],
  ends: [
{{ends}}
  ],

  /* 跨页面的业务规则 */
  rules: [],
  /* 非功能要求：性能、兼容、安全、埋点等 */
  nfr: [],
  /* 数据字典：核心业务对象 */
  dict: [],
  /* 核心流程：用于“核心流程”演示 */
  flows: [],

  /* 演示数据：页面通过 c.s 读取；预设用于一键切换数据场景 */
  demo: {},
  scenarios: { label: '数据场景', presets: [] },

  /* 需求澄清记录 */
  clarify: []
});
