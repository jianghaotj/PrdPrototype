W.page({
  id: 'M04', end: 'm', group: '我的', title: '我的',
  goal: '员工核对自己的部门和直属主管，确认请假会发给谁审批。',
  entry: '底部导航“我的”',
  states: [
    { id: 'me', label: '默认', when: '任何员工进入' }
  ],
  fns: [
    {
      id: 'profile', name: '个人信息',
      desc: '只读展示姓名、部门、直属主管，数据来自企业微信通讯录，每天凌晨同步一次。',
      fields: [
        { key: 'dept', name: '部门', type: '文本', rule: '企业微信通讯录的主部门' },
        { key: 'leader', name: '直属主管', type: '文本', rule: '为空时显示“未设置，请联系 HR”，此时提交的请假自动通过 [待确认]' }
      ],
      rules: ['信息有误时引导员工联系 HR 修改通讯录，本系统不提供修改入口'],
      src: '需求材料 · 角色说明'
    }
  ],
  render: function () {
    return h.m({
      title: '我的', tab: 'me',
      body: '<div class="card row g12"><span class="ava l">林</span><div><b class="lg">林晓</b><div class="sm mut2 mt4">工号 10086</div></div></div>' +
        '<div class="m-group mt12" data-fn="profile">' + h.cell('部门', '产品中心 / 教育产品部') + h.cell('直属主管', '王经理') + '</div>' +
        '<p class="sm mut2 mt12">信息有误请联系 HR 修改企业微信通讯录。</p>'
    });
  }
});
