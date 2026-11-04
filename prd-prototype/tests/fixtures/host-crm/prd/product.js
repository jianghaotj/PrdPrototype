/* 托管模式样例：为已有的 crm.html 补需求。原型文件保持原样，构建时内联进单 HTML。 */
W.product({
  id: 'crm-host-demo',
  name: '客户管理',
  date: '2026-11-03',
  fidelity: '已有原型 + 需求标注',
  releases: [{ id: 'V1.0', date: '2026-11-03', summary: '为已有原型补齐需求说明' }],
  background: '销售团队目前用 Excel 记录客户，负责人变更和跟进情况无法追踪。本期上线客户列表与新建客户，工作台展示待跟进数量。',
  scope: {
    out: [
      '导出 Excel：已有原型中存在该按钮，本期不做',
      'AI 助手：已有原型中存在该入口，本期不做'
    ]
  },
  roles: [
    { id: 'sales', name: '销售', desc: '维护自己负责的客户', perms: ['只能看到本人负责的客户'] },
    { id: 'leader', name: '销售主管', desc: '查看团队全部客户', perms: ['可看本团队全部客户'] }
  ],
  ends: [
    {
      id: 'web', name: '管理后台', device: 'pc', host: '../existing/crm.html', width: 1440, height: 900, home: 'D01',
      ignore: [
        { sel: '#btn-export', why: '原型多出的“导出 Excel”，本期不做' },
        { sel: '.ai-fab', why: '原型多出的 AI 助手入口，本期不做' }
      ]
    }
  ],
  flows: [
    {
      id: 'f1', name: '新建客户', desc: '工作台 → 客户列表 → 新建客户',
      steps: [
        { p: 'D01', st: 'default', tip: '点“待跟进”卡片进入客户列表。' },
        { p: 'C01', st: 'list', tip: '点右上角“新建客户”。' },
        { p: 'C01', st: 'new', tip: '填写客户名称和手机号后保存。' }
      ]
    }
  ]
});

W.shared({
  id: 'web-shell', end: 'web', title: '侧边导航',
  fns: [
    { id: 'side-nav', name: '侧边导航', sel: '.sidebar', desc: '左侧固定导航：工作台、客户列表，当前页面高亮。', src: '需求材料' }
  ]
});
