W.page({
  id: 'D01', end: 'web', group: '工作台', title: '工作台',
  goal: '销售登录后先看到本月新增、待跟进和成交数量，从“待跟进”直接进入需要处理的客户。',
  match: '#page-dashboard',
  enter: [{ js: "showPage('dashboard')" }],
  states: [
    { id: 'default', label: '默认', when: '登录后进入，或点击侧边导航“工作台”' }
  ],
  fns: [
    {
      id: 'kpis', name: '本月指标', sel: '.kpis',
      desc: '三张指标卡分别显示本月新增客户、待跟进、本月成交数量。点击“待跟进”进入客户列表并只显示待跟进客户。',
      fields: [
        { key: 'new', name: '本月新增客户', type: '数字', rule: '本自然月内创建的客户数，按负责人统计' },
        { key: 'follow', name: '待跟进', type: '数字', rule: '超过 7 天没有跟进记录的客户数 [待确认]' },
        { key: 'deal', name: '本月成交', type: '数字', rule: '本自然月内状态变为“已成交”的客户数' }
      ],
      rules: ['“本月新增”和“本月成交”卡片本期不可点击 [AI 假设]'],
      src: '需求材料'
    }
  ]
});
