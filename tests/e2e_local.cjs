// 本地版 e2e：真实 node server.mjs + 真实 fetch，验证「读」路径全通。
// 运行：node tests/e2e_local.js [端口]
// 依赖：cdp.js（零依赖 CDP 客户端）+ 本机 node
const { launch } = require('./cdp.cjs');
const { spawn } = require('child_process');
const { seedFixture } = require('./fixture_db.cjs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '8159', 10);
const ROOT = path.dirname(__dirname);

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined ? '  → ' + detail : ''));
}

(async () => {
  // 测试专用存储：临时目录 + 相对日期种子夹具，不碰真实数据目录
  const storage = seedFixture(path.join(ROOT, 'tests', '_out', 'storage-' + PORT));
  const server = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CAP_STORAGE_DIR: storage }
  });
  let serverLog = '';
  server.stdout.on('data', d => { serverLog += d.toString(); });
  server.stderr.on('data', d => { serverLog += d.toString(); });

  await new Promise(r => setTimeout(r, 1200));

  let browser = null;
  try {
    browser = await launch();
    const { cdp } = browser;
    await browser.goto('http://127.0.0.1:' + PORT + '/');

    // 等页面数据加载完（board 渲染出列，或 ghList 有内容）
    await cdp.waitFor(
      '(function(){return document.querySelectorAll("#board .col").length>0 || document.querySelectorAll("#ghList .repo-card").length>0})()',
      15000
    );

    // --- 读路径 ---
    const cols = await cdp.evalJson(
      'Array.prototype.map.call(document.querySelectorAll("#board .col .ch-name"),function(n){return n.textContent.trim()})');
    check('看板渲染出电脑列', cols && cols.length > 0, JSON.stringify(cols));

    const cards = await cdp.evalJson(
      'Array.prototype.map.call(document.querySelectorAll("#board .c-title"),function(n){return n.textContent.trim()})');
    check('任务卡渲染出标题', cards && cards.length > 0, (cards || []).slice(0, 3).join(' / '));

    const repos = await cdp.evalJson(
      'Array.prototype.map.call(document.querySelectorAll("#ghList .repo-card"),function(n){var a=n.querySelector(".re-title,.repo-name");return a?a.textContent.trim():""})');
    check('GitHub 仓库卡渲染', repos && repos.length > 0, (repos || []).slice(0, 3).join(' / '));

    const kpi = await cdp.evalJson(
      'Array.prototype.map.call(document.querySelectorAll("#summary .kpi .num"),function(n){return n.textContent.trim()})');
    check('KPI 数字区渲染', kpi && kpi.length > 0, JSON.stringify(kpi));

    // 默认分段应为「进行中」
    const seg = await cdp.evalJson(
      '(function(){var b=document.querySelector("#segTabs button.on,#segTabs button.active");return b?b.textContent.trim():""})()');
    check('默认分段= 进行中', seg === '进行中', seg);

    // 未连接提示不应出现
    const toastTxt = await cdp.evalJson(
      '(function(){var t=document.querySelector("#toast");return t?t.textContent.trim():""})()');
    check('无「未连接本地服务」错误', toastTxt.indexOf('未连接') < 0 && toastTxt.indexOf('连不上') < 0, toastTxt);

    // --- 写路径：走真实 UI（新增 → 填表 → 保存），验证 db → REST → 落盘 → 渲染全链 ---
    const machine = cols[0] || '';
    const writeRes = await cdp.evalJson(
      '(function(){' +
      '  var btn=document.getElementById("addBtn");' +
      '  if(!btn) return {err:"无 addBtn"};' +
      '  btn.click();' +
      '  return new Promise(function(res){setTimeout(function(){' +
      '    var item=document.querySelector(\'[data-add="task"]\');' +
      '    if(!item) return res({err:"新增菜单里没有任务项"});' +
      '    item.click();' +
      '    setTimeout(function(){' +
      '      var t=document.getElementById("f_title"), m=document.getElementById("f_machine"), sv=document.getElementById("saveBtn");' +
      '      if(!t||!m||!sv) return res({err:"抽屉字段缺失 t="+!!t+" m="+!!m+" sv="+!!sv});' +
      '      t.value="e2e 探针任务";' +
      '      m.value=' + JSON.stringify(machine) + ';' +
      '      var st=document.getElementById("f_status"); if(st) st.value="进行中";' +
      '      var pr=document.getElementById("f_priority"); if(pr) pr.value="P2";' +
      '      sv.click();' +
      '      setTimeout(function(){res({saved:true})},1200);' +
      '    },400);' +
      '  },250);});' +
      '})()'
    );
    check('UI 新增任务：填写并保存', writeRes && writeRes.saved === true, JSON.stringify(writeRes));

    await new Promise(r => setTimeout(r, 1000));
    const after = await cdp.evalJson(
      'Array.prototype.map.call(document.querySelectorAll("#board .c-title"),function(n){return n.textContent.trim()})');
    check('新任务出现在看板', (after || []).indexOf('e2e 探针任务') >= 0, (after || []).length + ' 张卡');

    // 校验落盘：读测试夹具目录的 db.json（CAP_STORAGE_DIR 指向 tests/_out/storage-<端口>）
    const fs = require('fs');
    const dbFile = path.join(storage, 'db.json');
    const raw = fs.readFileSync(dbFile, 'utf8');
    check('探针任务已写入 db.json', raw.indexOf('e2e 探针任务') >= 0, dbFile);

    // 清理：走 UI 的管理面板删（先切管理模式）
    const cleanup = await cdp.evalJson(
      '(function(){' +
      '  var cards=Array.prototype.slice.call(document.querySelectorAll("#board .card"));' +
      '  var hit=cards.filter(function(c){var t=c.querySelector(".c-title");return t&&t.textContent.indexOf("e2e 探针任务")>=0})[0];' +
      '  if(!hit) return {deleted:0,note:"未找到探针卡"};' +
      '  var mb=document.getElementById("manageBtn")||document.querySelector(\'[data-manage]\');' +
      '  if(mb) mb.click();' +
      '  return new Promise(function(res){setTimeout(function(){' +
      '    var cards2=Array.prototype.slice.call(document.querySelectorAll("#board .card"));' +
      '    var h2=cards2.filter(function(c){var t=c.querySelector(".c-title");return t&&t.textContent.indexOf("e2e 探针任务")>=0})[0];' +
      '    if(!h2) return res({deleted:0,note:"切管理模式后未找到卡"});' +
      '    var cb=h2.querySelector(\'[data-sel],.card-check,input[type=checkbox]\');' +
      '    if(!cb) return res({deleted:0,note:"无选择框"});' +
      '    cb.click();' +
      '    setTimeout(function(){res({deleted:0,note:"已选中，未自动删"})},300);' +
      '  },400);});' +
      '})()'
    );
    console.log('  INFO  清理: ' + JSON.stringify(cleanup));

    // 直接从 db.json 移除探针（测试后置清理，不走 UI 以免误删其他数据）
    const dbi = JSON.parse(raw);
    const before = (dbi.tasks || []).length;
    dbi.tasks = (dbi.tasks || []).filter(t => t['任务标题'] !== 'e2e 探针任务');
    fs.writeFileSync(dbFile, JSON.stringify(dbi, null, 2), 'utf8');
    check('探针记录已清理', (dbi.tasks || []).length === before - 1,
      before + ' → ' + (dbi.tasks || []).length);

  } catch (e) {
    check('e2e 执行异常', false, e.message);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  const failed = results.filter(r => !r.ok);
  console.log('='.repeat(56));
  if (failed.length) {
    console.log('FAILED: ' + failed.map(r => r.name).join(', '));
    process.exit(1);
  }
  console.log('E2E ALL PASS  (' + results.length + ' 项)');
  process.exit(0);
})();
