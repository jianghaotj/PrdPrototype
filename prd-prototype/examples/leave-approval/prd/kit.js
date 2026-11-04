/* 项目公共组件：两端外壳（导航）登记为公共功能点，页面直接调用 W.ui.* */
(function () {
  var h = W.h;

  W.shared({
    id: 'pc-shell', end: 'pc', title: 'PC 顶部导航',
    fns: [
      {
        id: 'pc-nav', name: '顶部导航与账号菜单',
        desc: '按登录账号的角色显示菜单：主管看到“待我审批”，HR 看到“请假统计”，两种角色都有时两个菜单都显示。右侧头像菜单可退出登录。',
        rules: ['菜单根据角色动态显示，没有权限的菜单不出现，而不是置灰', '“待我审批”右侧数字为当前待审批单据数，超过 99 显示 99+'],
        src: '需求材料 · 角色说明'
      }
    ]
  });
  W.shared({
    id: 'm-shell', end: 'm', title: '手机端底部导航',
    fns: [
      {
        id: 'm-tab', name: '底部导航',
        desc: '两个入口：“请假”（首页）和“我的”（个人信息，本期只展示姓名、部门和直属主管）。',
        src: '需求材料'
      }
    ]
  });

  W.MTABS = { fn: 'm-tab', items: [{ key: 'home', label: '请假', ic: 'cal', go: 'M01', st: 'list' }, { key: 'me', label: '我的', ic: 'user', go: 'M04', st: 'me' }] };

  W.ui = {
    pc: function (active, body, o) {
      o = o || {};
      return h.app({
        brand: '请假审批', sub: '审批台', fn: 'pc-nav', home: ['P01', 'list'], active: active,
        nav: [{ key: 'todo', label: '待我审批 <span class="tag t-err" style="margin-left:4px">3</span>', go: 'P01', st: 'list' }, { key: 'stat', label: '请假统计', go: 'P03', st: 'month' }],
        right: h.menu('<span class="row g8"><span class="ava">王</span>王经理</span>', [{ label: '退出登录', act: 'toast', msg: '演示：退出登录' }]),
        body: body, over: o.over
      });
    }
  };
})();
