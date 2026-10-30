// 端到端旅程测试：模拟用户的完整操作链路，检查有没有断裂
// 这不是「测某个函数」，而是「走一遍真实使用流程」，看体验是否连贯
const { launch } = require('./cdp.cjs');
const { spawn } = require('child_process');
const { seedFixture } = require('./fixture_db.cjs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '8298', 10);
const ROOT = path.dirname(__dirname);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined && detail !== '' ? '  → ' + detail : ''));
}

(async () => {
  // 测试专用存储：临时目录 + 相对日期种子夹具，不碰真实数据目录
  const storage = seedFixture(path.join(ROOT, 'tests', '_out', 'storage-' + PORT));
  const server = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CAP_STORAGE_DIR: storage }
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 1200));

  let browser = null;
  try {
    browser = await launch();
    const { cdp } = browser;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 900, deviceScaleFactor: 1, mobile: false
    });
    await browser.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor('(function(){return document.querySelectorAll("#ghList .repo-card").length>0})()', 15000);
    await cdp.waitFor('(function(){return document.querySelectorAll("#board .card").length>0})()', 15000);
    await new Promise(r => setTimeout(r, 700));

    const ev = expr => cdp.evalJson(expr);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const sheetOpen = () => ev('(function(){return document.getElementById("drawer").classList.contains("on")})()');
    const title = () => ev('(function(){return document.getElementById("drawerTitle").textContent})()');

    // ═══ 旅程 1：GitHub 侧完整链路 ═══
    // 仓库卡 → 详情 → 编辑某条 → 返回 → 再编辑另一条 → 返回 → 关闭
    await ev('(function(){document.querySelector("#ghList .repo-card").click();return 1})()');
    await wait(500);
    const repoT = await title();
    check('旅程1-① 点仓库卡 → 仓库详情', (await sheetOpen()) && (await ev('(function(){return document.querySelectorAll("#drawerBody .rd-row").length})()')) > 0, repoT);

    await ev('(function(){document.querySelector("#drawerBody .rd-row").click();return 1})()');
    await wait(450);
    check('旅程1-② 点记录 → 编辑表单', (await ev('(function(){return !!document.getElementById("gf_repo")})()')) && (await ev('(function(){return document.getElementById("drawerBack").style.display!=="none"})()')));

    await ev('(function(){document.getElementById("drawerBack").click();return 1})()');
    await wait(450);
    check('旅程1-③ 返回 → 仓库详情', (await title()) === repoT && (await ev('(function(){return document.querySelectorAll("#drawerBody .rd-row").length})()')) > 0);

    // 换一条记录再编辑（验证栈能重复使用，不是只能钻取一次）
    await ev('(function(){document.querySelectorAll("#drawerBody .rd-row")[1].click();return 1})()');
    await wait(450);
    check('旅程1-④ 换另一条记录再编辑', (await ev('(function(){return !!document.getElementById("gf_repo")})()')));

    await ev('(function(){document.getElementById("drawerBack").click();return 1})()');
    await wait(450);
    check('旅程1-⑤ 再返回 → 仓库详情', (await title()) === repoT);

    await ev('(function(){document.getElementById("closeDrawer").click();return 1})()');
    await wait(400);
    check('旅程1-⑥ 关闭 → 弹窗收起', !(await sheetOpen()));

    // ═══ 旅程 2：任务侧完整链路 ═══
    // 任务卡 → 详情 → 编辑 → 返回 → 复制交接 → 关闭
    await ev('(function(){document.querySelector("#board .card").click();return 1})()');
    await wait(500);
    const taskT = await title();
    check('旅程2-① 点任务卡 → 详情', (await sheetOpen()) && (await ev('(function(){return !!document.querySelector(".dt-title")})()')), taskT);

    await ev('(function(){document.getElementById("editBtn").click();return 1})()');
    await wait(450);
    check('旅程2-② 点编辑 → 表单', (await ev('(function(){return !!document.getElementById("f_title")})()')));

    await ev('(function(){document.getElementById("drawerBack").click();return 1})()');
    await wait(450);
    check('旅程2-③ 返回 → 详情', (await title()) === taskT && (await ev('(function(){return !!document.querySelector(".dt-title")})()')));

    // 复制交接（详情层的操作）
    await ev('(function(){document.getElementById("copyBtn").click();return 1})()');
    await wait(400);
    check('旅程2-④ 复制交接不破坏弹窗', (await sheetOpen()) && (await title()) === taskT);

    await ev('(function(){document.getElementById("closeDrawer").click();return 1})()');
    await wait(400);
    check('旅程2-⑤ 关闭 → 弹窗收起', !(await sheetOpen()));

    // ═══ 旅程 3：跨面板切换不应串状态 ═══
    // 任务详情开着 → 关掉 → 开仓库详情 → 标题/底栏应是仓库的，不是残留的任务的
    await ev('(function(){document.querySelector("#board .card").click();return 1})()');
    await wait(500);
    await ev('(function(){document.getElementById("closeDrawer").click();return 1})()');
    await wait(400);
    await ev('(function(){document.querySelector("#ghList .repo-card").click();return 1})()');
    await wait(500);
    const cross = await ev(`(function(){
      return {
        标题: document.getElementById('drawerTitle').textContent,
        有任务详情: !!document.querySelector('#drawerBody .dt-title'),
        有仓库记录: document.querySelectorAll('#drawerBody .rd-row').length,
        记录同步按钮: document.getElementById('repoAddBtn').style.display !== 'none',
        编辑按钮: document.getElementById('editBtn').style.display !== 'none',
        返回箭头: document.getElementById('drawerBack').style.display !== 'none'
      };
    })()`);
    check('旅程3-① 换面板：内容是仓库的', cross.有仓库记录 > 0 && !cross.有任务详情, cross.标题);
    check('旅程3-② 换面板：底栏是仓库的', cross.记录同步按钮 && !cross.编辑按钮);
    check('旅程3-③ 换面板：无残留返回箭头', !cross.返回箭头);

    // ═══ 旅程 4：弹窗开着时看板仍可用吗 ═══
    // 弹窗有遮罩，看板应该点不到（这是预期行为），但 Esc 应该能关
    await ev('(function(){document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));return 1})()');
    await wait(450);
    check('旅程4-① Esc 关掉顶层弹窗', !(await sheetOpen()));

    // ═══ 旅程 5：快速连续点击不应错乱 ═══
    await ev('(function(){document.querySelector("#ghList .repo-card").click();return 1})()');
    await wait(120);
    await ev('(function(){document.querySelector("#drawerBody .rd-row").click();return 1})()');
    await wait(120);
    await ev('(function(){document.getElementById("drawerBack").click();return 1})()');
    await wait(120);
    await ev('(function(){document.getElementById("drawerBack").click();return 1})()');
    await wait(500);
    const fast = await ev(`(function(){
      return {
        弹窗开: document.getElementById('drawer').classList.contains('on'),
        返回箭头: document.getElementById('drawerBack').style.display !== 'none',
        标题: document.getElementById('drawerTitle').textContent
      };
    })()`);
    check('旅程5-① 快速连点后状态正确（栈退空→关闭）', !fast.弹窗开 && !fast.返回箭头, fast.标题);

    // ═══ 旅程 6：管理模式与弹窗互不干扰 ═══
    await ev('(function(){document.getElementById("manageBtn").click();return 1})()');
    await wait(450);
    await ev('(function(){document.querySelector("#ghList .repo-entry").click();return 1})()');
    await wait(400);
    const mg = await ev(`(function(){
      return {
        弹窗开: document.getElementById('drawer').classList.contains('on'),
        已选: document.querySelectorAll('#ghList .repo-entry.sel').length
      };
    })()`);
    check('旅程6-① 管理模式点记录：只选中不开弹窗', !mg.弹窗开 && mg.已选 > 0);
    await ev('(function(){document.getElementById("manageBtn").click();return 1})()');
    await wait(400);
    check('旅程6-② 退出管理模式', (await ev('(function(){return document.querySelectorAll("#ghList .repo-entry.sel").length})()')) === 0);

  } catch (e) {
    check('旅程执行异常', false, e.message);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  const failed = results.filter(r => !r.ok);
  console.log('='.repeat(58));
  if (failed.length) {
    console.log('FAILED: ' + failed.map(r => r.name).join(', '));
    process.exit(1);
  }
  console.log('端到端旅程 ALL PASS  (' + results.length + ' 项)');
})();
