W.page({
  id: 'P03', end: 'pc', group: '统计', title: '请假统计',
  goal: 'HR 每月按部门查看请假天数，导出后用于考勤核算，替代手工核对。',
  entry: '顶部导航“请假统计”',
  perm: 'HR；主管账号不显示此菜单',
  states: [
    { id: 'month', label: '按月查看', when: '默认显示上个自然月' }
  ],
  fns: [
    {
      id: 'month-pick', name: '统计月份',
      desc: '选择要统计的自然月，切换后表格和合计同时刷新。',
      fields: [
        { key: 'month', name: '月份', type: '年月', required: true, def: '上个自然月', rule: '可选范围：系统上线月份至本月' }
      ],
      src: '需求材料 · 痛点 3'
    },
    {
      id: 'dept-table', name: '部门请假汇总',
      desc: '按部门汇总当月**已通过**的请假天数；跨月的请假按落在当月的工作日拆分计入。',
      fields: [
        { key: 'dept', name: '部门', type: '文本', rule: '企业微信通讯录一级部门' },
        { key: 'people', name: '请假人数', type: '数字', rule: '当月有已通过请假的去重人数' },
        { key: 'annual', name: '年假', type: '数字（天）', rule: '当月已通过的年假天数合计' },
        { key: 'sick', name: '病假', type: '数字（天）', rule: '同上' },
        { key: 'personal', name: '事假', type: '数字（天）', rule: '同上' }
      ],
      empty: '当月没有已通过的请假时显示“本月没有请假记录”',
      rules: ['待审批、已驳回、已撤回的单据不计入统计'],
      src: '需求材料 · 澄清 Q4'
    },
    {
      id: 'export', name: '导出明细',
      desc: '导出当月所有已通过单据的明细（每张单据一行），文件名“请假明细-2026年10月.xlsx”。',
      rules: ['导出范围与当前月份一致，不受页面分页影响'],
      errors: ['超过 5000 行时改为后台生成，完成后通过企业微信发送下载链接 [AI 假设]'],
      status: 'assumed', statusNote: '导出格式和大数据量处理方式是 AI 补充的'
    }
  ],
  render: function () {
    var rows = [['教育产品部', 12, 9.5, 3, 2], ['教研部', 8, 6, 4, 0.5], ['市场部', 5, 3, 1, 1]];
    var body = '<div class="w"><div class="ph-h"><div><h1>请假统计</h1><p class="mut mt4">只统计已通过的请假，跨月请假按工作日拆分</p></div>' +
      '<div class="row g12"><span data-fn="month-pick">' + h.sel('2026 年 10 月', ['2026 年 10 月', '2026 年 9 月', '2026 年 8 月'], { field: 'month', style: 'width:160px' }) + '</span>' + h.btn(h.i('download', 16) + '导出明细', { fn: 'export', act: 'toast', msg: '演示：开始导出' }) + '</div></div>' +
      '<div data-fn="dept-table">' + h.table(['部门', '请假人数', '年假（天）', '病假（天）', '事假（天）'], rows.map(function (r) { return [r[0], r[1], r[2], r[3], r[4]]; }), { right: [1, 2, 3, 4] }) + '</div></div>';
    return W.ui.pc('stat', body);
  }
});
