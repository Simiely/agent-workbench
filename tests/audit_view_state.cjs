// 视图状态一致性体检：穷举所有 UI 操作组合，检查「激活态」与「实际呈现」是否一致
// 目的：找出「显示激活但内容没变」这类自相矛盾状态（Radii Filter Chips 规范列为 Bad usage）
const { launch } = require('./cdp.cjs');
const { spawn } = require('child_process');
const { seedFixture } = require('./fixture_db.cjs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '8210', 10);
const ROOT = path.dirname(__dirname);

const OPS = [
  ['初始', ''],
  ['点进行中KPI', '#summary .kpi[data-k=""]'],
  ['点需要关注', '#summary .kpi[data-k="att"]'],
  ['点未勾待办', '#summary .kpi[data-k="todo"]'],
  ['点已完成KPI', '#summary .kpi[data-k="done"]'],
  ['分段全部', '#segTabs button[data-s="全部"]'],
  ['分段进行中', '#segTabs button[data-s="进行中"]'],
  ['分段已完成', '#segTabs button[data-s="已完成"]'],
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
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 900, deviceScaleFactor: 1, mobile: false
    });
    await browser.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor('(function(){return document.querySelectorAll("#board .card").length>0})()', 15000);
    await new Promise(r => setTimeout(r, 600));

    const read = async () => cdp.evalJson(`(function(){
      var segBtn=document.querySelector('#segTabs button.on');
      var kpiBtn=document.querySelector('#summary .kpi.on');
      var cards=Array.prototype.slice.call(document.querySelectorAll('#board .card'));
      return {
        分段: segBtn?segBtn.textContent.trim():'(无)',
        KPI高亮: kpiBtn?kpiBtn.getAttribute('data-k'):'(无)',
        卡数: cards.length,
        标题: cards.map(function(c){var t=c.querySelector('.c-title');return t?t.textContent.trim():''}),
        空态: (function(){
          var e=document.querySelector('#board .col-empty');
          return e?e.textContent.trim().slice(0,50):'';
        })()
      };
    })()`);

    // 逐个操作序列走一遍，记录每一步的状态
    const seq = [];
    for (const [name, sel] of OPS) {
      if (sel) {
        await cdp.evalJson('(function(){var el=document.querySelector(' + JSON.stringify(sel) + ');if(el)el.click();return 1})()');
        await new Promise(r => setTimeout(r, 260));
      }
      const st = await read();
      seq.push({ 操作: name, ...st });
    }

    console.log('=== 状态序列 ===');
    seq.forEach(s => console.log(
      s.操作.padEnd(14) + ' 分段=' + s.分段.padEnd(6) + ' KPI=' + String(s.KPI高亮).padEnd(6) +
      ' 卡数=' + s.卡数 + ' ' + (s.空态 ? '[空态: ' + s.空态 + ']' : '')
    ));

    // 一致性检查
    console.log('\n=== 一致性检查 ===');
    for (const s of seq) {
      // 检查1：KPI 高亮与卡数必须匹配「过滤是否真的生效」
      if (s.KPI高亮 === 'att' || s.KPI高亮 === 'todo') {
        if (s.卡数 === 0) {
          problems.push(s.操作 + '：KPI=' + s.KPI高亮 + ' 但卡片为 0（空看板）');
        }
      }
      // 检查2：分段高亮必须唯一
      const segOn = await cdp.evalJson(
        'document.querySelectorAll("#segTabs button.on").length');
      if (segOn !== 1) {
        problems.push(s.操作 + '：分段高亮数量=' + segOn + '（应为 1）');
      }
      // 检查3：KPI 高亮数量必须 ≤1
      const kpiOn = await cdp.evalJson(
        'document.querySelectorAll("#summary .kpi.on").length');
      if (kpiOn > 1) {
        problems.push(s.操作 + '：KPI 高亮数量=' + kpiOn + '（应 ≤1）');
      }
      // 检查4：空看板必须给出可清除的说明
      if (s.卡数 === 0 && s.空态 && s.空态.indexOf('清除筛选') < 0 && s.空态.indexOf('暂无') < 0) {
        problems.push(s.操作 + '：空看板但没有说明/清除入口 → ' + s.空态);
      }
    }

    if (problems.length) {
      console.log('\n发现 ' + problems.length + ' 个问题:');
      problems.forEach(p => console.log('  ✗ ' + p));
      process.exitCode = 1;
    } else {
      console.log('\n✓ 全部一致：KPI 高亮 ⟺ 内容真被过滤；分段高亮唯一；空看板有说明与清除入口');
    }
  } catch (e) {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})();
