W.page({
  id: 'C01', end: 'web', group: '客户', title: '客户列表',
  goal: '销售查找和维护自己负责的客户，新建客户时校验手机号唯一。',
  match: '#page-customers',
  enter: [{ js: "showPage('customers')" }],
  states: [
    { id: 'list', label: '列表', when: '点击侧边导航“客户列表”或工作台“待跟进”' },
    { id: 'new', label: '新建客户', when: '点击“新建客户”', layer: 'modal', enter: [{ click: '#btn-new' }], match: '#modal-new' }
  ],
  fns: [
    {
      id: 'filter', name: '搜索与等级筛选', sel: '#kw, #level',
      desc: '搜索框按客户名称或手机号模糊匹配，回车或停止输入 300 毫秒后查询；等级下拉与搜索条件同时生效。',
      fields: [
        { key: 'kw', name: '关键词', type: '文本', required: false, rule: '匹配客户名称或手机号后 4 位' },
        { key: 'level', name: '客户等级', type: '枚举', required: false, options: ['全部等级', 'A 类', 'B 类', 'C 类'], rule: '默认全部等级' }
      ],
      src: '需求材料'
    },
    {
      id: 'create', name: '新建客户入口', sel: '#btn-new',
      desc: '点击后打开新建客户弹窗。',
      src: '需求材料'
    },
    {
      id: 'table', name: '客户表格', sel: '#customer-table',
      desc: '显示本人负责的客户（主管看本团队），按创建时间倒序，每页 20 条。“编辑”打开与新建相同的弹窗并带入数据。',
      fields: [
        { key: 'name', name: '客户名称', type: '文本', rule: '完整显示，超过 20 字省略' },
        { key: 'phone', name: '手机号', type: '文本', rule: '中间 4 位脱敏' },
        { key: 'level', name: '等级', type: '枚举', options: ['A 类', 'B 类', 'C 类'] },
        { key: 'owner', name: '负责人', type: '文本', rule: '客户当前负责销售' }
      ],
      empty: '显示“暂无客户”，并提供“新建客户”按钮',
      src: '需求材料'
    },
    {
      id: 'form', name: '新建客户表单', sel: '#modal-new .modal',
      desc: '填写客户名称、手机号和等级后保存，保存成功后关闭弹窗并刷新列表。',
      fields: [
        { key: 'name', name: '客户名称', type: '文本', required: true, rule: '2–50 字' },
        { key: 'phone', name: '手机号', type: '文本', required: true, rule: '11 位手机号；同一公司内唯一' },
        { key: 'level', name: '客户等级', type: '枚举', required: false, options: ['A 类', 'B 类', 'C 类'], def: 'C 类' }
      ],
      errors: ['手机号已存在：提示“该手机号已是 xx 的客户”，不允许保存', '保存失败：保留填写内容并提示重试'],
      src: '需求材料'
    }
  ]
});
