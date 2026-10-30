// 边界情况体检：空数据 / 超长文本 / 特殊字符(XSS) / 孤儿任务 / 缺字段
// 目的：验证异常输入不会让页面报错、不会造成注入、不会丢数据
const { launch } = require('./cdp.cjs');
const { spawn } = require('child_process');
const { seedFixture } = require('./fixture_db.cjs');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.argv[2] || '8174', 10);
const ROOT = path.dirname(__dirname);
// 测试专用存储：临时目录 + 相对日期种子夹具，不碰真实数据目录（顶部先落夹具供快照读取）
const DB = path.join(seedFixture(path.join(ROOT, 'tests', '_out', 'storage-' + PORT)), 'db.json');
const orig = fs.readFileSync(DB, 'utf8');

const SCENARIOS = [
  ['空数据', { tasks: [], machines: [], github: [] }],
  ['超长文本', {
    tasks: [{ _id: 't1', '任务标题': 'A'.repeat(300), '状态': '进行中', '优先级': 'P0',
      '所在电脑': '超长机', '进度': 'B'.repeat(500), '待办': '[ ] C'.repeat(100),
      '更新时间': '2026-10-30T04:00:00Z', '排序': 1 }],
    machines: [{ _id: 'm1', '机器名': '超长机', '位置': 'D'.repeat(200), '排序': 1 }],
    github: []
  }],
  ['特殊字符/XSS', {
    tasks: [{ _id: 't1', '任务标题': '<script>window.__X1__=1</script>', '状态': '进行中',
      '优先级': 'P1', '所在电脑': '<img src=x onerror="window.__X2__=1">', '进度': '<b>粗</b>',
      '待办': '[ ] <svg onload=window.__X3__=1>', '更新时间': '2026-10-30T04:00:00Z', '排序': 1 }],
    machines: [{ _id: 'm1', '机器名': '<script>window.__X4__=1</script>', '排序': 1 }],
    github: [{ _id: 'g1', '仓库': '<script>window.__X5__=1</script>', '内容': 'x',
      '是否同步': '已同步', '同步时间': '2026-10-30T04:00:00Z' }]
  }],
  ['孤儿任务', {
    tasks: [{ _id: 't1', '任务标题': '孤儿', '状态': '进行中', '优先级': 'P1',
      '所在电脑': '不存在的机器', '更新时间': '2026-10-30T04:00:00Z', '排序': 1 }],
    machines: [], github: []
  }],
  ['缺字段', {
    tasks: [{ _id: 't1', '任务标题': '只有标题' }], machines: [], github: []
  }],
  ['异常状态值', {
    tasks: [{ _id: 't1', '任务标题': '奇怪状态', '状态': '不知道', '优先级': 'P9',
      '所在电脑': '机', '更新时间': '不是日期', '排序': '不是数字' }],
    machines: [{ _id: 'm1', '机器名': '机', '排序': 1 }], github: []
  }],
];

(async () => {
  // 测试专用存储：临时目录 + 相对日期种子夹具，不碰真实数据目录
  const storage = seedFixture(path.join(ROOT, 'tests', '_out', 'storage-' + PORT));
  const server = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CAP_STORAGE_DIR: storage }
  });
  server.stdout.on('data', () => {});
  await new Promise(r => setTimeout(r, 1200));

  let browser = null;
  const problems = [];
  try {
    browser = await launch();
    const { cdp } = browser;
    const errs = [];
    cdp.ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        errs.push('EXC: ' + ((d.exception && (d.exception.description || d.exception.value)) || d.text));
      }
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        errs.push('LOG: ' + m.params.entry.text);
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');

    for (const [name, data] of SCENARIOS) {
      fs.writeFileSync(DB, JSON.stringify(data, null, 2), 'utf8');
      errs.length = 0;
      await browser.goto('http://127.0.0.1:' + PORT + '/');
      await new Promise(r => setTimeout(r, 1400));

      const st = await cdp.evalJson(`(function(){
        return {
          卡片数: document.querySelectorAll('#board .card').length,
          孤儿列: document.querySelectorAll('#board .col-orphan').length,
          注入script: document.querySelectorAll('#board script, #ghList script').length,
          注入img: document.querySelectorAll('#board img, #ghList img').length,
          注入svg: document.querySelectorAll('#board svg[onload]').length,
          XSS触发: [1,2,3,4,5].filter(function(i){return typeof window['__X'+i+'__']!=='undefined'}).length,
          标题文本: (function(){var t=document.querySelector('#board .c-title');return t?t.textContent:''})(),
          空态: (function(){var e=document.querySelector('#board .col-empty');return e?e.textContent.trim().slice(0,40):''})()
        };
      })()`);

      const jsErr = errs.filter(e => !/favicon|net::ERR_FILE/i.test(e));
      const xss = st.注入script > 0 || st.注入img > 0 || st.注入svg > 0 || st.XSS触发 > 0;
      const bad = [];
      if (jsErr.length) bad.push('JS 报错: ' + jsErr[0]);
      if (xss) bad.push('XSS 注入! script=' + st.注入script + ' img=' + st.注入img + ' XSS触发=' + st.XSS触发);
      if (st.卡片数 === 0 && data.tasks.length > 0) bad.push('有任务但没渲染卡片');
      if (data.tasks.length > 0 && st.孤儿列 === 0 &&
          data.tasks.some(t => t['所在电脑'] && !data.machines.some(m => m['机器名'] === t['所在电脑']))) {
        bad.push('孤儿任务没有落进兜底列');
      }

      if (bad.length) {
        problems.push(name + ' → ' + bad.join('; '));
        console.log('  FAIL  ' + name + '  ' + bad.join('; '));
      } else {
        console.log('  PASS  ' + name + '  卡片=' + st.卡片数 + ' 孤儿列=' + st.孤儿列 +
          (st.空态 ? ' 空态="' + st.空态 + '"' : ''));
      }
    }
  } catch (e) {
    problems.push('执行异常: ' + e.message);
    console.error('失败: ' + e.message);
  } finally {
    fs.writeFileSync(DB, orig, 'utf8');
    if (browser) await browser.close();
    server.kill();
  }

  console.log('='.repeat(56));
  if (problems.length) {
    console.log('发现 ' + problems.length + ' 个问题:');
    problems.forEach(p => console.log('  ✗ ' + p));
    process.exit(1);
  }
  console.log('✓ 边界情况全部通过：无 JS 报错、无 XSS、孤儿任务有兜底');
})();
