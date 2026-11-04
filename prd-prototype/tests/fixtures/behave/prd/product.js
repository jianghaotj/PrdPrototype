/* 组件内置行为的回归夹具（test-skill.mjs 使用）：列表搜索筛选 + 表单校验与提交。 */
W.product({
  id: 'behave-fixture',
  name: '组件行为夹具',
  date: '2026-11-04',
  fidelity: '低保真线框',
  releases: [{ id: 'V1.0', date: '2026-11-04', summary: '回归夹具' }],
  background: '用于回归测试组件内置行为：必填与长度校验、提交的加载和重复点击、失败重试、列表搜索筛选。文字没有业务含义。',
  goals: ['验证组件内置行为在构建与浏览器中都按规则工作'],
  scope: { out: ['真实提交、上传与权限'] },
  roles: [{ id: 'staff', name: '员工', desc: '发起请假、查看自己的请假单', perms: ['只能看到本人数据'] }],
  ends: [{ id: 'm', name: '员工手机端', device: 'mobile', home: 'M01', desc: '夹具' }],
  rules: [{ text: '请假单按提交时间倒序展示', src: '夹具' }],
  demo: {
    list: { items: [
      { no: 'QJ001', type: '年假', reason: '家中有事需回老家处理' },
      { no: 'QJ002', type: '病假', reason: '感冒发烧，需要休息两天' }
    ] },
    submitFail: false
  },
  scenarios: {
    label: '数据场景',
    presets: [
      { id: 'submit-fail', label: '提交失败', set: 'submitFail=true' },
      { id: 'submit-ok', label: '提交成功', set: 'submitFail=false' }
    ]
  }
});
