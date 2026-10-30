// 弹窗导航栈体检：所有钻取路径都必须能原路返回
//
// 视图路径设计（一条路径 = 一层栈）：
//   仓库详情 → 某条记录的编辑表单        （用户报的核心问题）
//   仓库详情 → 新增一条同步记录表单
//   任务详情 → 任务编辑表单
//   仓库详情 → 某条记录 → 删除后 → 回到仓库详情
//
// 检查项：
//   1. 每条钻取路径都能用返回箭头退回上一层
//   2. 返回后内容是「上一层」的内容（不是空白、不是上一层的内容残留）
//   3. 顶层（从看板直接进入）不显示返回箭头
//   4. Esc 键：栈里还有上一层就退一层，没有就关闭弹窗
//   5. 保存后回到上一层；删除后回到上一层
//   6. 连续钻取两层后能逐层退回
const { launch } = require('./cdp.cjs');
const { spawn } = require('child_process');
const { seedFixture } = require('./fixture_db.cjs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '8281', 10);
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

    // 弹窗当前状态快照
    const snap = () => ev(`(function(){
      var dr=document.getElementById('drawer');
      return {
        打开: dr.classList.contains('on'),
        标题: document.getElementById('drawerTitle').textContent,
        返回箭头可见: document.getElementById('drawerBack').style.display !== 'none',
        有仓库记录行: document.querySelectorAll('#drawerBody .rd-row').length,
        有任务详情: !!document.querySelector('#drawerBody .dt-title'),
        有任务表单: !!document.getElementById('f_title'),
        有同步表单: !!document.getElementById('gf_repo'),
        仓库名: (document.getElementById('gf_repo')||{}).value || ''
      };
    })()`);
    const closeSheet = async () => {
      await ev('(function(){document.getElementById("closeDrawer").click();return 1})()');
      await wait(400);
    };
    const back = async () => {
      await ev('(function(){document.getElementById("drawerBack").click();return 1})()');
      await wait(450);
    };

    // ---------- 1. 顶层：仓库详情（从看板进入）不显示返回箭头 ----------
    await ev('(function(){document.querySelector("#ghList .repo-card").click();return 1})()');
    await wait(500);
    const s1 = await snap();
    check('顶层（仓库详情）：弹窗已打开', s1.打开);
    check('顶层（仓库详情）：有仓库记录列表', s1.有仓库记录行 > 0, s1.有仓库记录行 + ' 条');
    check('顶层（仓库详情）：不显示返回箭头', !s1.返回箭头可见);
    const repoTitle = s1.标题;

    // ---------- 2. 钻取：点记录行 → 记录编辑表单 ----------
    await ev('(function(){document.querySelector("#drawerBody .rd-row").click();return 1})()');
    await wait(500);
    const s2 = await snap();
    check('钻取：仓库详情 → 记录编辑表单', s2.有同步表单 && !s2.有仓库记录行, s2.标题);
    check('钻取：显示返回箭头', s2.返回箭头可见);

    // ---------- 3. 返回：回到仓库详情 ----------
    await back();
    const s3 = await snap();
    check('返回：回到仓库详情', s3.标题 === repoTitle && s3.有仓库记录行 > 0, s3.标题);
    check('返回：内容是上一层（记录列表还在）', s3.有仓库记录行 > 0 && !s3.有同步表单);
    check('返回：顶层不再显示返回箭头', !s3.返回箭头可见);
    check('返回：弹窗仍开着（没被误关）', s3.打开);

    // ---------- 4. 再钻取 → Esc 退回 ----------
    await ev('(function(){document.querySelector("#drawerBody .rd-row").click();return 1})()');
    await wait(450);
    await ev('(function(){document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));return 1})()');
    await wait(450);
    const s4 = await snap();
    check('Esc：栈里还有上一层就退一层（不关弹窗）', s4.打开 && s4.标题 === repoTitle, s4.标题);

    // ---------- 5. 仓库详情 → 新增同步记录 → 返回 ----------
    await ev('(function(){document.getElementById("repoAddBtn").click();return 1})()');
    await wait(500);
    const s5 = await snap();
    check('钻取：仓库详情 → 新增记录表单', s5.有同步表单 && s5.标题 === '记录同步', s5.标题);
    check('钻取：新增记录预填了仓库名', s5.仓库名.length > 0, s5.仓库名);
    check('钻取：显示返回箭头', s5.返回箭头可见);
    await back();
    const s6 = await snap();
    check('返回：从新增记录回到仓库详情', s6.标题 === repoTitle && s6.有仓库记录行 > 0, s6.标题);

    // ---------- 6. 任务详情 → 编辑表单 → 返回 ----------
    await closeSheet();
    await ev('(function(){document.querySelector("#board .card").click();return 1})()');
    await wait(500);
    const t1 = await snap();
    check('任务详情：顶层不显示返回箭头', t1.有任务详情 && !t1.返回箭头可见, t1.标题);
    await ev('(function(){document.getElementById("editBtn").click();return 1})()');
    await wait(450);
    const t2 = await snap();
    check('钻取：任务详情 → 编辑表单', t2.有任务表单 && !t2.有任务详情, t2.标题);
    check('钻取：显示返回箭头', t2.返回箭头可见);
    await back();
    const t3 = await snap();
    check('返回：从任务编辑回到任务详情', t3.有任务详情 && !t3.有任务表单, t3.标题);
    check('返回：任务详情仍在弹窗内', t3.打开);

    // ---------- 7. 保存后回到上一层 ----------
    // 钻取到某条 GitHub 记录 → 改内容保存 → 应退回仓库详情。
    // 先记住原内容，测完还原，不污染真实数据。
    await ev('(function(){document.querySelector("#ghList .repo-card").click();return 1})()');
    await wait(500);
    const origContent = await ev(`(function(){
      var el=document.querySelector('#drawerBody .rd-row');
      return el ? el.querySelector('.rd-content').textContent : '';
    })()`);
    await ev('(function(){document.querySelector("#drawerBody .rd-row").click();return 1})()');
    await wait(500);
    await ev('(function(){document.getElementById("gf_content").value="栈测试内容";document.getElementById("saveBtn").click();return 1})()');
    await wait(1300);
    const t4 = await snap();
    check('保存后：退回上一层（仓库详情）', t4.打开 && t4.标题 === repoTitle && t4.有仓库记录行 > 0, t4.标题);
    check('保存后：不在编辑表单里', !t4.有同步表单);
    await closeSheet();

    // 还原刚才改的那条记录
    await ev('(function(){document.querySelector("#ghList .repo-card").click();return 1})()');
    await wait(500);
    await ev('(function(){document.querySelector("#drawerBody .rd-row").click();return 1})()');
    await wait(500);
    await ev(`(function(){document.getElementById("gf_content").value=${JSON.stringify(origContent)};document.getElementById("saveBtn").click();return 1})()`);
    await wait(1300);
    await closeSheet();

    // ---------- 7b. 新建任务（顶层）：保存后关闭弹窗 ----------
    await ev('(function(){document.getElementById("addBtn").click();return 1})()');
    await wait(300);
    await ev('(function(){document.querySelector(\'[data-add="task"]\').click();return 1})()');
    await wait(500);
    const newForm = await snap();
    check('新建任务：顶层不显示返回箭头', newForm.有任务表单 && !newForm.返回箭头可见, newForm.标题);
    await ev('(function(){document.getElementById("f_title").value="栈测试临时任务";document.getElementById("saveBtn").click();return 1})()');
    await wait(1200);
    const t4b = await snap();
    check('新建任务保存后：弹窗关闭（顶层无上一层）', !t4b.打开, t4b.标题);
    // 清掉这条临时任务（测试自己造的，删掉不影响真实数据）
    await ev('(function(){var c=Array.prototype.filter.call(document.querySelectorAll("#board .card"),function(c){var t=c.querySelector(".c-title");return t&&t.textContent.indexOf("栈测试临时任务")>=0})[0];if(c)c.click();return 1})()');
    await wait(500);
    await ev('(function(){document.getElementById("delBtn").click();return 1})()');
    await wait(450);
    await ev('(function(){document.getElementById("cOk").click();return 1})()');
    await wait(1200);
    await closeSheet();

    // ---------- 8. 关闭后栈应清空（下次打开不该还有返回箭头） ----------
    await ev('(function(){document.querySelector("#ghList .repo-card").click();return 1})()');
    await wait(450);
    await ev('(function(){document.querySelector("#drawerBody .rd-row").click();return 1})()');
    await wait(450);
    await closeSheet();
    await ev('(function(){document.querySelector("#ghList .repo-card").click();return 1})()');
    await wait(450);
    const s8 = await snap();
    check('关闭后重开：栈已清空（无返回箭头）', s8.打开 && !s8.返回箭头可见 && s8.有仓库记录行 > 0);
    await closeSheet();

    // ---------- 9. 连续钻取两层 → 逐层退回 ----------
    await ev('(function(){document.querySelector("#ghList .repo-card").click();return 1})()');
    await wait(450);
    await ev('(function(){document.querySelector("#drawerBody .rd-row").click();return 1})()');
    await wait(450);
    const deep = await snap();
    check('深钻取：进入记录表单', deep.有同步表单);
    await back();
    const up1 = await snap();
    check('逐层退回：第 1 层 → 仓库详情', up1.标题 === repoTitle && up1.有仓库记录行 > 0);
    await back();
    const up2 = await snap();
    check('逐层退回：第 2 层 → 弹窗关闭', !up2.打开);

  } catch (e) {
    check('体检执行异常', false, e.message);
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
  console.log('弹窗导航栈体检 ALL PASS  (' + results.length + ' 项)');
})();
