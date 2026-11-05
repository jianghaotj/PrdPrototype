/* 产品级需求。页面级需求写在 pages/*.js。
   本样例没有真实需求来源：背景、角色、字段、规则、流程都是 AI 假设，正文或条目状态里均已标出。 */
W.product({
  id: 'course-mgmt',
  name: '课程管理',
  date: '2026-11-04',
  fidelity: '高保真（高教 PC 规范包 gaodeng-pc）',
  releases: [
    { id: 'V1.0', date: '2026-11-04', summary: '首版：教务管理台课程列表，含筛选、分页、新建课程和详情抽屉' }
  ],

  background: '高校教务处每学期要整理一次开课课程目录，目前在 Excel 里维护。新增课程后，教务员要手工核对学院、学分和课程代码，经常漏填或重号。本期在教务管理台做一个课程列表页：能按名称或代码找课，能新增课程并在提交前拦住漏填，提交失败时保留已填内容。 [AI 假设]',
  goals: [
    '教务员在一个列表里找到本学期全部开课课程 [AI 假设]',
    '新建课程时，必填项和长度错误在提交前拦住，不发出请求 [AI 假设]',
    '提交失败后不需要重新填写，原内容保留，可直接重试 [AI 假设]'
  ],
  scope: {
    out: [
      '排课、选课、成绩等教务模块 [AI 假设]',
      '课程编辑、停用与删除：本期只新增与查看 [AI 假设]',
      '导入、导出 Excel [AI 假设]',
      '多学期切换：页面固定显示 2026–2027 学年第一学期 [AI 假设]'
    ]
  },
  roles: [
    { id: 'admin', name: '教务处课程管理员', desc: '维护全校本学期开课课程：查看列表、新建课程、查看详情 [AI 假设]', perms: ['可查看全部学院的课程 [AI 假设]'] },
    { id: 'secretary', name: '学院教学秘书', desc: '只读，查看本学院的开课课程 [AI 假设]', perms: ['看不到“新建课程”按钮 [AI 假设]'] }
  ],
  ends: [
    { id: 'pc', name: '教务管理台', device: 'pc', home: 'P01', url: 'jw.example.com', desc: '教务处工作人员使用的 PC 管理台。本样例只做 PC 端，画面为管理员视角 [AI 假设]', width: 1440, height: 900 }
  ],

  rules: [
    { text: '课程代码在同一学期内唯一，重复时不能提交', status: 'assumed' },
    { text: '本期学期固定为 2026–2027 学年第一学期，列表只显示该学期的开课课程', status: 'assumed' },
    { text: '新增课程的任课教师默认为“待指定”，状态默认为“待排课”，本页不指定教师', status: 'assumed' },
    { text: '新增成功的课程排在列表最前', status: 'assumed' }
  ],
  nfr: [
    '列表 500 门课程以内，搜索结果在 1 秒内返回 [AI 假设]',
    '本期只做 PC 端，按 1440×900 视口设计，不做小屏适配 [AI 假设]'
  ],
  dict: [
    {
      name: '开课课程', desc: '某学期内某学院开设的一门课程 [AI 假设]',
      fields: [
        { key: 'no', name: '课程代码', type: '文本', desc: '6–12 位字母或数字' },
        { key: 'name', name: '课程名称', type: '文本', desc: '2–30 字' },
        { key: 'college', name: '开课学院', type: '枚举', desc: '学院基础数据，样例列出 3 个学院' },
        { key: 'credit', name: '学分', type: '数字', desc: '1–4 的整数' },
        { key: 'teacher', name: '任课教师', type: '文本', desc: '本页不指定，默认“待指定”' },
        { key: 'status', name: '状态', type: '枚举', desc: '待排课 / 已发布' },
        { key: 'note', name: '备注', type: '文本', desc: '选填，最多 200 字' }
      ]
    }
  ],
  flows: [
    {
      id: 'f1', name: '新增开课课程（代表流程）', ends: '教务管理台', preset: 'submit-fail',
      desc: '列表筛选 → 新建弹窗校验 → 提交失败后重试 → 列表更新 → 详情抽屉 [AI 假设]',
      steps: [
        { p: 'P01', st: 'list', label: '列表筛选', tip: '列表默认 9 门课程。在搜索框输入“高等”，列表只留下两门匹配的课程；清空搜索后点“新建课程”。' },
        { p: 'P01', st: 'create', label: '空提交被拦', tip: '弹窗打开后直接点“提交”：四个必填项下方提示“请填写…”，表单顶部提示“有 4 项需要修改”，不发出请求。' },
        { p: 'P01', st: 'create', label: '提交失败', tip: '按提示填写四个必填项后点“提交”。本次是演示的提交失败：顶部提示“提交失败，网络异常”，已填内容保留。再点一次“提交”即成功。' },
        { p: 'P01', st: 'list', label: '列表更新', tip: '弹窗关闭，新课程排在列表最前，分页显示“第 1~10 条 / 共 10 条”。点新课程行的“详情”。' },
        { p: 'P01', st: 'detail', label: '课程详情', tip: '右侧抽屉展示课程信息和备注。点右上角关闭返回列表。' }
      ]
    }
  ],

  /* 演示数据：页面通过 c.s 读取；提交成功后 list.items 前面新增一条 */
  demo: {
    list: {
      items: [
        { id: 'C01', no: 'CS2101', name: '高等数学 A（上）', college: '计算机学院', credit: '4', teacher: '王立新', status: '已发布', note: '大一新生必修，周二、周四 1–2 节' },
        { id: 'C02', no: 'CS2102', name: '高等数学 A（下）', college: '计算机学院', credit: '4', teacher: '王立新', status: '已发布', note: '' },
        { id: 'C03', no: 'FL2105', name: '大学英语（一）', college: '外国语学院', credit: '2', teacher: '赵敏', status: '已发布', note: '' },
        { id: 'C04', no: 'FL2106', name: '高级英语写作', college: '外国语学院', credit: '2', teacher: '待指定', status: '待排课', note: '' },
        { id: 'C05', no: 'EM3010', name: '管理学原理', college: '经济管理学院', credit: '3', teacher: '陈思远', status: '已发布', note: '' },
        { id: 'C06', no: 'CS3015', name: '数据结构', college: '计算机学院', credit: '3', teacher: '李国强', status: '已发布', note: '需要先修程序设计基础' },
        { id: 'C07', no: 'EM3022', name: '微观经济学', college: '经济管理学院', credit: '3', teacher: '待指定', status: '待排课', note: '' },
        { id: 'C08', no: 'CS3018', name: '操作系统', college: '计算机学院', credit: '3', teacher: '周婷', status: '已发布', note: '' },
        { id: 'C09', no: 'FL3011', name: '第二外语（日语）', college: '外国语学院', credit: '2', teacher: '孙萌', status: '已发布', note: '' }
      ]
    },
    submitFail: false
  },
  scenarios: {
    label: '数据场景',
    presets: [
      { id: 'submit-ok', label: '提交成功', set: 'submitFail=false' },
      { id: 'submit-fail', label: '提交失败', set: 'submitFail=true' }
    ]
  },

  /* 需求澄清记录：样例没有与需求方的澄清，全部内容见上方“AI 假设”标记 */
  clarify: []
});
