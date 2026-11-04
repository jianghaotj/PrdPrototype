/* 产品级需求：背景、范围、角色、端、流程、全局规则、数据字典、澄清记录、版本。
   页面级需求写在 pages/*.js，与原型画法放在一起。 */
W.product({
  id: 'leave-approval',
  name: '请假审批',
  date: '2026-11-03',
  fidelity: '低保真线框',
  releases: [
    { id: 'V1.0', date: '2026-11-03', summary: '首版：员工手机端发起与查看请假，主管 PC 端审批，HR 查看月度统计' }
  ],

  background: '公司约 300 人，请假目前靠微信报备加纸质单据，主管审批后由 HR 手工录入考勤表。问题有三个：员工不知道自己还剩几天假；主管经常漏批，审批记录散在聊天里；HR 月底要花 2 天核对请假天数。\n\n本期把“发起 → 审批 → 余额扣减 → 月度统计”做成线上闭环。',
  goals: [
    '员工在手机上 1 分钟内完成一次请假申请，并随时看到剩余假期',
    '主管在 PC 审批台集中处理待审批单据，不再漏批',
    'HR 每月直接查看按部门汇总的请假天数，不再手工核对'
  ],
  scope: {
    out: [
      '加班、调休、出差申请（二期）',
      '多级审批和会签：本期只有直属主管一级审批',
      '与考勤机、薪资系统对接：HR 仍按月导出后手工处理',
      '请假余额的年度发放规则配置：本期由 HR 线下维护后批量导入 [待确认]'
    ]
  },
  roles: [
    { id: 'staff', name: '员工', desc: '发起请假、查看自己的请假记录和余额', perms: ['只能看到本人数据'] },
    { id: 'manager', name: '直属主管', desc: '审批直属下属的请假', perms: ['只能看到直属下属的单据', '不能审批自己的请假'] },
    { id: 'hr', name: 'HR', desc: '查看全公司请假统计，不参与审批', perms: ['可看全部部门', '不能通过或驳回单据'] }
  ],
  ends: [
    { id: 'm', name: '员工手机端', device: 'mobile', home: 'M01', desc: '企业微信内打开的 H5' },
    { id: 'pc', name: '审批台（PC）', device: 'pc', home: 'P01', url: 'leave.example.com', desc: '主管与 HR 使用；按登录账号的角色显示菜单' }
  ],

  rules: [
    { text: '时长按**工作日**计算，以 0.5 天为最小单位；周末和法定节假日不计入', src: '澄清 Q2' },
    { text: '提交时先冻结余额，审批通过后正式扣减；驳回或撤回后解冻', src: '澄清 Q3' },
    { text: '假期余额按自然年计算，每年 1 月 1 日清零重发 [待确认]', status: 'pending', src: 'HR 口头说明，待书面确认' },
    { text: '单据状态：待审批 → 已通过 / 已驳回；待审批时员工可撤回 → 已撤回', src: '需求材料' }
  ],
  nfr: [
    '审批结果在 1 分钟内通过企业微信消息通知员工 [AI 假设]'
  ],
  dict: [
    {
      name: '请假单', desc: '员工发起的一次请假申请',
      fields: [
        { key: 'no', name: '单号', type: '文本', desc: 'QJ + 年月日 + 4 位序号，如 QJ202611030012' },
        { key: 'type', name: '假期类型', type: '枚举', desc: '年假 / 事假 / 病假 / 调休（本期不可选）' },
        { key: 'start', name: '开始时间', type: '日期 + 上午/下午', desc: '精确到半天' },
        { key: 'end', name: '结束时间', type: '日期 + 上午/下午', desc: '不早于开始时间' },
        { key: 'days', name: '时长', type: '数字（天）', desc: '按工作日自动计算，0.5 天为单位' },
        { key: 'reason', name: '请假事由', type: '文本', desc: '5–200 字' },
        { key: 'status', name: '状态', type: '枚举', desc: '待审批 / 已通过 / 已驳回 / 已撤回' }
      ],
      states: ['待审批', '已通过 / 已驳回 / 已撤回']
    },
    {
      name: '假期余额', desc: '员工每种假期的可用天数',
      fields: [
        { key: 'total', name: '年度额度', type: '数字（天）', desc: 'HR 每年导入' },
        { key: 'frozen', name: '冻结中', type: '数字（天）', desc: '待审批单据占用的天数' },
        { key: 'left', name: '可用', type: '数字（天）', desc: '额度 − 已用 − 冻结中' }
      ]
    }
  ],
  flows: [
    {
      id: 'f1', name: '员工发起请假', ends: '员工手机端', preset: 'normal',
      desc: '首页 → 填写申请 → 确认提交 → 查看详情 → 撤回',
      steps: [
        { p: 'M01', st: 'list', tip: '首页能看到剩余年假 5 天。点“发起请假”。' },
        { p: 'M02', st: 'form', tip: '选择年假、开始和结束时间，时长自动算成 1.5 天。点“提交申请”。', label: '填写申请' },
        { p: 'M02', st: 'confirm', tip: '确认弹层再次展示时长和余额变化。点“确认提交”。', label: '确认提交' },
        { p: 'M03', st: 'pending', tip: '单据进入待审批，余额冻结 1.5 天。点“撤回申请”。', label: '待审批详情' },
        { p: 'M03', st: 'withdraw', tip: '撤回前二次确认。点“撤回”后余额解冻。', label: '撤回确认' }
      ]
    },
    {
      id: 'f2', name: '主管审批', ends: '审批台（PC）', preset: 'normal',
      desc: '待审批列表 → 查看详情 → 驳回并填写原因',
      steps: [
        { p: 'P01', st: 'list', tip: '默认只显示待审批。点第一行的“审批”。' },
        { p: 'P02', st: 'detail', tip: '抽屉中看到申请人本年度请假记录，辅助判断。点“驳回”。', label: '审批详情' },
        { p: 'P02', st: 'reject', tip: '驳回必须填写原因，员工会收到。点“确认驳回”。', label: '填写驳回原因' },
        { p: 'P01', st: 'list', tip: '处理完回到列表，该单据从“待审批”中消失。', label: '回到列表' }
      ]
    }
  ],

  /* 演示数据：页面通过 c.s 读取；预设用于一键切换数据场景 */
  demo: { balance: { annual: 5, sick: 8, personal: 3 }, hasRecords: true },
  scenarios: {
    label: '数据场景',
    presets: [
      { id: 'normal', label: '老员工（有余额、有记录）', set: { 'balance.annual': 5, hasRecords: true } },
      { id: 'newbie', label: '新员工（无记录）', set: { 'balance.annual': 5, hasRecords: false } },
      { id: 'nobalance', label: '年假用完', set: { 'balance.annual': 0, hasRecords: true } }
    ]
  },

  clarify: [
    { no: 'Q1', q: '审批是一级还是多级？', a: '本期只有直属主管一级；多级审批二期再做', by: '用户确认' },
    { no: 'Q2', q: '时长怎么算？是否扣除周末和节假日？', a: '按工作日计算，最小 0.5 天，节假日表由 HR 年初维护', by: '用户确认' },
    { no: 'Q3', q: '余额什么时候扣？', a: '提交即冻结，通过后扣减，驳回/撤回解冻（采纳 AI 推荐）', by: '采纳推荐' },
    { no: 'Q4', q: 'HR 是否需要审批权限？', a: '不需要，HR 只看统计', by: '用户确认' }
  ]
});
