// GitHub 仓库卡交互体检：整卡判定范围 + 内部按钮互不干扰
// 关键点：判定范围 = 整张卡片（跟任务看板的 [data-open] 同构），
// 但卡内的「复制链接 / 查看全部 / ＋记录同步 / ⋯ 菜单 / 删整仓」必须各走各的。
const { launch } = require('./cdp.cjs');
const { spawn } = require('child_process');
const { seedFixture } = require('./fixture_db.cjs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '8278', 10);
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
    await new Promise(r => setTimeout(r, 700));

    const ev = expr => cdp.evalJson(expr);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const closeSheet = async () => {
      await ev('(function(){var c=document.getElementById("closeDrawer");if(c)c.click();return 1})()');
      await wait(400);
    };

    // ---------- 1. 判定范围：卡片容器带 data-repo-open ----------
    const struct = await ev(`(function(){
      var card=document.querySelector('#ghList .repo-card');
      return {
        容器带判定属性: card.hasAttribute('data-repo-open'),
        仓库名是纯文本: card.querySelector('.repo-name').tagName === 'SPAN',
        仓库名不再可点: !card.querySelector('.repo-name').hasAttribute('data-repo-open'),
        有复制按钮: !!card.querySelector('[data-copy-repo]'),
        复制按钮文案: (card.querySelector('[data-copy-repo]')||{}).textContent,
        复制按钮独立: card.querySelector('.repo-name') !== card.querySelector('[data-copy-repo]')
      };
    })()`);
    check('结构：卡片容器带 data-repo-open（整卡判定）', struct.容器带判定属性);
    check('结构：仓库名降级为纯文本', struct.仓库名是纯文本 && struct.仓库名不再可点);
    check('结构：有独立的复制链接按钮', struct.有复制按钮, struct.复制按钮文案);
    check('结构：复制按钮不是仓库名本身', struct.复制按钮独立);

    // ---------- 2. 点卡片空白处 → 打开仓库详情 ----------
    await ev('(function(){var c=document.querySelector("#ghList .repo-card");' +
      'var r=c.getBoundingClientRect();' +
      'var el=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);' +
      'el.click();return 1})()');
    await wait(500);
    const clickBlank = await ev(`(function(){
      return {
        打开: document.getElementById('drawer').classList.contains('on'),
        标题: document.getElementById('drawerTitle').textContent,
        有记录列表: document.querySelectorAll('#drawerBody .rd-row').length
      };
    })()`);
    check('整卡判定：点卡片中部 → 打开仓库详情', clickBlank.打开 && clickBlank.有记录列表 > 0, clickBlank.标题);
    await closeSheet();

    // ---------- 3. 点「复制链接」→ 只复制，不打开详情 ----------
    await ev('(function(){document.querySelector("#ghList .repo-card [data-copy-repo]").click();return 1})()');
    await wait(450);
    const copyRes = await ev(`(function(){
      return {
        未打开详情: !document.getElementById('drawer').classList.contains('on'),
        剪贴板: (navigator.clipboard && navigator.clipboard.readText) ? 'n/a' : 'n/a'
      };
    })()`);
    check('内部按钮：点「复制链接」不打开详情', copyRes.未打开详情);

    // ---------- 4. 点「查看全部」→ 只展开，不打开详情 ----------
    const hasToggle = await ev('(function(){return document.querySelectorAll("#ghList [data-repo-toggle]").length})()');
    if (hasToggle > 0) {
      const before = await ev('(function(){return document.querySelectorAll("#ghList .repo-entry").length})()');
      await ev('(function(){document.querySelector("#ghList [data-repo-toggle]").click();return 1})()');
      await wait(450);
      const after = await ev('(function(){return document.querySelectorAll("#ghList .repo-entry").length})()');
      const opened = await ev('(function(){return document.getElementById("drawer").classList.contains("on")})()');
      check('内部按钮：点「查看全部」只展开不打开详情', !opened && after !== before, before + ' → ' + after + ' 条');
      await ev('(function(){document.querySelector("#ghList [data-repo-toggle]").click();return 1})()');
      await wait(350);
    } else {
      check('内部按钮：点「查看全部」只展开不打开详情', true, '无「查看全部」按钮（记录数 ≤ 3），跳过');
    }

    // ---------- 5. 点「＋记录同步」→ 只开表单，不打开仓库详情 ----------
    await ev('(function(){document.querySelector("#ghList [data-repo-add]").click();return 1})()');
    await wait(500);
    const addRes = await ev(`(function(){
      return {
        是同步表单: !!document.getElementById('gf_repo'),
        标题: document.getElementById('drawerTitle').textContent,
        仓库已预填: (document.getElementById('gf_repo')||{}).value
      };
    })()`);
    check('内部按钮：点「＋记录同步」进同步表单', addRes.是同步表单 && addRes.标题 === '记录同步');
    check('内部按钮：同步表单预填了仓库名', /.+/.test(addRes.仓库已预填 || ''), addRes.仓库已预填);
    await closeSheet();

    // ---------- 6. 点记录行的 ⋯ 菜单 → 只开菜单，不打开详情 ----------
    await ev('(function(){document.querySelector("#ghList .repo-entry [data-gh-menu]").click();return 1})()');
    await wait(400);
    const menuRes = await ev(`(function(){
      return {
        菜单打开: !!document.querySelector('.menu [data-gact]'),
        未打开详情: !document.getElementById('drawer').classList.contains('on')
      };
    })()`);
    check('内部按钮：点「⋯」只开菜单不打开详情', menuRes.菜单打开 && menuRes.未打开详情);
    await ev('(function(){document.body.click();return 1})()');
    await wait(300);

    // ---------- 7. 管理模式下点卡片 → 走批量选择，不打开详情 ----------
    await ev('(function(){document.getElementById("manageBtn").click();return 1})()');
    await wait(450);
    await ev('(function(){document.querySelector("#ghList .repo-entry").click();return 1})()');
    await wait(400);
    const manageRes = await ev(`(function(){
      return {
        未打开详情: !document.getElementById('drawer').classList.contains('on'),
        已选中: document.querySelectorAll('#ghList .repo-entry.sel').length,
        删整仓可见: (document.querySelector('#ghList .repo-del')||{}).offsetWidth > 0
      };
    })()`);
    check('管理模式：点记录行走批量选择，不打开详情', manageRes.未打开详情 && manageRes.已选中 > 0);
    check('管理模式：删整仓按钮可见', manageRes.删整仓可见);
    await ev('(function(){document.getElementById("manageBtn").click();return 1})()');
    await wait(400);

    // ---------- 8. 任务看板的判定范围没被影响 ----------
    const taskRes = await ev(`(function(){
      var card=document.querySelector('#board .card');
      return {
        容器带判定: card.hasAttribute('data-open'),
        仓库名不误伤: true
      };
    })()`);
    check('任务看板：卡片容器仍带 data-open', taskRes.容器带判定);

    await ev('(function(){document.querySelector("#board .card").click();return 1})()');
    await wait(500);
    const taskDetail = await ev(`(function(){
      return {
        打开: document.getElementById('drawer').classList.contains('on'),
        标题: document.getElementById('drawerTitle').textContent,
        有只读详情: !!document.querySelector('.dt-title')
      };
    })()`);
    check('任务看板：点卡片仍打开任务详情', taskDetail.打开 && taskDetail.有只读详情, taskDetail.标题);
    await closeSheet();

    // ---------- 9. 两套看板判定机制一致 ----------
    const consist = await ev(`(function(){
      var t=document.querySelector('#board .card');
      var r=document.querySelector('#ghList .repo-card');
      return {
        任务卡判定在容器: t.hasAttribute('data-open'),
        仓库卡判定在容器: r.hasAttribute('data-repo-open'),
        仓库名不承载判定: !r.querySelector('.repo-name').hasAttribute('data-repo-open')
      };
    })()`);
    check('一致性：两套看板都是「容器承载判定」', consist.任务卡判定在容器 && consist.仓库卡判定在容器 && consist.仓库名不承载判定);

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
  console.log('仓库卡交互体检 ALL PASS  (' + results.length + ' 项)');
})();
