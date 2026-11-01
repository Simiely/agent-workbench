// 变异测试：故意注入 bug，验证审计脚本真的能抓到（而不是永远 PASS）
// 用法：node tests/mutation_test.cjs
// 原理：把源码改坏 → 跑审计 → 必须 FAIL → 还原源码
// 这是「测试本身的可信度」验证：审计脚本自己也可能是假阳性。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.dirname(__dirname);
const SRC = path.join(ROOT, 'public', 'index.html');
const ORIG = fs.readFileSync(SRC, 'utf8');

// 每个变异：{ 名称, 审计脚本, 正则, 替换 }
const MUTATIONS = [
  {
    name: '返回箭头该藏没藏（syncSheetNav 不看栈深）',
    audit: 'audit_sheet_nav.cjs',
    port: '8290',
    re: /function syncSheetNav\(\) \{[\s\S]{0,200}?\n  \}/,
    rep: (m) => m.replace(/S\.ui\.sheetStack\.length \? '' : 'none'/, "''")
  },
  {
    name: 'backSheet 弹错层（返回内容不对）',
    audit: 'audit_sheet_nav.cjs',
    port: '8291',
    re: /var prev = S\.ui\.sheetStack\.pop\(\);/,
    rep: () => 'var prev = S.ui.sheetStack[0];'
  },
  {
    name: '返回时不重绘（只弹栈不渲染，内容残留）',
    audit: 'audit_sheet_nav.cjs',
    port: '8292',
    re: /function backSheet\(\) \{[\s\S]{0,600}?\n  \}/,
    rep: (m) => m.replace(/if \(!renderSheetLayer\(prev\)\) \{[\s\S]*?\n    \}/, 'if (false) { return; }')
  },
  {
    name: '整卡判定被卡内按钮抢走（点查看全部也开详情）',
    audit: 'audit_repo_card.cjs',
    port: '8293',
    // 把整卡判定插到路由表最前面 → 卡内按钮会被卡片抢走
    re: /var CLICK_ROUTES = \[/,
    rep: () => "var CLICK_ROUTES = [\n    { sel: '[data-repo-open]', run: function (n) { gotoSheet({ kind: 'repoDetail', id: null, repo: n.getAttribute('data-repo-open') }, 'root'); } },"
  },
  {
    name: '复制链接按钮被删（独立按钮消失）',
    audit: 'audit_repo_card.cjs',
    port: '8294',
    re: /<button class="repo-copy"[\s\S]*?<\/button>'/,
    rep: () => ''
  },
  {
    name: '弹窗不居中（.on 状态改成从边缘弹出）',
    audit: 'audit_sheet.cjs',
    port: '8295',
    re: /transform: translate\(-50%, -50%\) scale\(1\);/,
    rep: () => 'transform: translate(100%, 0) scale(1);'
  },
  {
    name: '弹窗动效退化（进场退场等长，失去不对称）',
    audit: 'audit_sheet.cjs',
    port: '8296',
    re: /--dur-in: 340ms;/,
    rep: () => '--dur-in: 200ms;'
  },
  {
    name: '磨砂玻璃失效（背景不模糊了）',
    audit: 'audit_sheet.cjs',
    port: '8297',
    // 全文两处 blur(14px)：第一处带 -webkit- 前缀，第二处是标准属性（浏览器实际生效的）。
    // 策略：只把「不带前缀的那处」改掉 —— 用负向前查找，不用跨行锚点（跨行在 JS 里易踩转义坑）。
    re: /(?<!-webkit-)backdrop-filter: blur\(14px\) saturate\(115%\);/,
    rep: () => 'backdrop-filter: none;'
  },
  {
    name: '守卫回流（setView 加非法值兜底）',
    audit: 'audit_no_guards.cjs',
    port: '8298',
    re: /function setView\(v\) \{/,
    rep: () => "function setView(v) {\n    if (!VIEW[v]) v = 'doing';"
  },
  {
    name: '状态直改回流（业务函数直接给 S 字段赋值）',
    audit: 'audit_no_guards.cjs',
    port: '8300',
    re: /function setView\(v\) \{/,
    rep: () => "function setView(v) {\n    S.ui.view = v;"
  },
  {
    name: 'XSS：仓库名不再转义',
    audit: 'audit_edge_cases.cjs',
    port: '8299',
    re: /'<span class="repo-name">' \+ escapeHtml\(g\.name\) \+ '<\/span>' \+/,
    rep: () => "'<span class=\"repo-name\">' + g.name + '</span>' +"
  },
];

let pass = 0, fail = 0, skip = 0;
for (const m of MUTATIONS) {
  const mutated = ORIG.replace(m.re, m.rep);
  if (mutated === ORIG) {
    console.log('  SKIP  ' + m.name + '  ← 变异点没匹配上');
    skip++;
    continue;
  }
  fs.writeFileSync(SRC, mutated, 'utf8');
  const r = spawnSync('node', [path.join(ROOT, 'tests', m.audit), m.port], {
    cwd: ROOT, encoding: 'utf8', timeout: 180000
  });
  const caught = r.status !== 0;
  console.log((caught ? '  PASS  ' : '  FAIL  ') + m.name +
    '  → ' + m.audit + (caught ? '  成功报警 ✓' : '  【没报警！审计脚本失灵】'));
  if (caught) pass++; else fail++;
}
fs.writeFileSync(SRC, ORIG, 'utf8');
console.log('\n源码已还原: ' + (fs.readFileSync(SRC, 'utf8') === ORIG));
console.log('变异测试: ' + pass + ' 项被捕获 / ' + fail + ' 项漏网 / ' + skip + ' 项跳过');
process.exit(fail ? 1 : 0);
