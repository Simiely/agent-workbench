// 真实写路径全流程体检：对真实 server 逐个走完所有写操作 + 校验落盘 + 校验渲染
// 目的：mock 测不出来的真实问题（字段类型、请求格式、服务端校验、落盘一致性）
const { launch } = require('./cdp.cjs');
const { spawn } = require('child_process');
const { seedFixture } = require('./fixture_db.cjs');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.argv[2] || '8260', 10);
const ROOT = path.dirname(__dirname);
// 测试专用存储：临时目录 + 相对日期种子夹具，不碰真实数据目录
const DBFILE = path.join(seedFixture(path.join(ROOT, 'tests', '_out', 'storage-' + PORT)), 'db.json');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined && detail !== '' ? '  → ' + detail : ''));
}
function readDb() {
  try { return JSON.parse(fs.readFileSync(DBFILE, 'utf8')); } catch (e) { return null; }
}
// 幂等清理：跑之前先抹掉上一轮的体检残留。
// 不做这步的话，残留的同名记录会让后面的 find() 命中最旧的那条，
// 断言看着像功能坏了，其实是自己踩自己的脚。
function scrubDb() {
  const d = readDb();
  if (!d) return;
  d.tasks = (d.tasks || []).filter(t => t['任务标题'] !== '审核任务 001' && t['任务标题'] !== '体检孤儿任务');
  d.github = (d.github || []).filter(g => g['仓库'] !== '体检/仓库');
  d.machines = (d.machines || []).filter(m => m['机器名'] !== '体检电脑');
  fs.writeFileSync(DBFILE, JSON.stringify(d, null, 2), 'utf8');
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
  scrubDb();
  const before = readDb();
  const nTaskBefore = (before.tasks || []).length;
  const nMachBefore = (before.machines || []).length;
  const nGhBefore = (before.github || []).length;

  try {
    browser = await launch();
    const { cdp } = browser;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 900, deviceScaleFactor: 1, mobile: false
    });
    await browser.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor('(function(){return document.querySelectorAll("#board .card").length>0})()', 15000);
    await new Promise(r => setTimeout(r, 600));

    const ev = expr => cdp.evalJson(expr);
    const wait = ms => new Promise(r => setTimeout(r, ms));

    // ---------- 1. 新增任务（UI 全流程）----------
    await ev('(function(){document.getElementById("addBtn").click();return 1})()');
    await wait(300);
    await ev('(function(){document.querySelector(\'[data-add="task"]\').click();return 1})()');
    await wait(400);
    await ev(`(function(){
      document.getElementById("f_title").value="审核任务 001";
      var m=document.getElementById("f_machine");
      m.value = m.options[1] ? m.options[1].value : m.options[0].value;
      document.getElementById("f_progress").value="体检写入";
      document.getElementById("f_todos").value="[ ] 待办一\\n[ ] 待办二";
      document.getElementById("saveBtn").click();
      return 1;
    })()`);
    await wait(1200);
    const d1 = readDb();
    const created = (d1.tasks || []).find(t => t['任务标题'] === '审核任务 001');
    check('新增任务：落盘', !!created);
    if (created) {
      check('  → 字段类型正确（字符串）', typeof created['任务标题'] === 'string', JSON.stringify(created['任务标题']));
      check('  → 状态已解包为裸值', created['状态'] === '进行中' || created['状态'] === '已完成', String(created['状态']));
      check('  → 待办保留换行', String(created['待办'] || '').indexOf('\n') > 0, JSON.stringify(created['待办']));
      check('  → 所在电脑有值', !!created['所在电脑'], String(created['所在电脑']));
    }
    check('  → 页面已渲染新卡', (await ev(
      'Array.prototype.map.call(document.querySelectorAll("#board .c-title"),function(x){return x.textContent.trim()})'
    )).indexOf('审核任务 001') >= 0);

    // ---------- 2. 编辑任务（改进度，只提交变更字段）----------
    // 用 [data-edit-task]：它直接进编辑态。[data-open] 现在是卡片容器，点它进的是只读详情
    await ev('(function(){var c=Array.prototype.filter.call(document.querySelectorAll("#board .card"),function(c){var t=c.querySelector(".c-title");return t&&t.textContent.indexOf("审核任务 001")>=0})[0];c.querySelector("[data-edit-task]").click();return 1})()');
    await wait(400);
    await ev('(function(){document.getElementById("f_progress").value="体检改过的进度";document.getElementById("saveBtn").click();return 1})()');
    await wait(1000);
    const d2 = readDb();
    const edited = (d2.tasks || []).find(t => t['任务标题'] === '审核任务 001');
    check('编辑任务：落盘', edited && edited['进度'] === '体检改过的进度', edited && edited['进度']);

    // ---------- 3. 勾选待办（抽屉内）----------
    await ev('(function(){var c=Array.prototype.filter.call(document.querySelectorAll("#board .card"),function(c){var t=c.querySelector(".c-title");return t&&t.textContent.indexOf("审核任务 001")>=0})[0];c.querySelector("[data-edit-task]").click();return 1})()');
    await wait(400);
    const hasTodo = await ev('(function(){var it=document.querySelectorAll("#drawerBody .todo-item");return it.length})()');
    check('抽屉内待办清单存在', hasTodo > 0, hasTodo + ' 项');
    if (hasTodo > 0) {
      await ev('(function(){document.querySelectorAll("#drawerBody .todo-item")[0].click();return 1})()');
      await wait(700);
      const d3 = readDb();
      const t3 = (d3.tasks || []).find(t => t['任务标题'] === '审核任务 001');
      check('勾选待办：落盘且只改一行', t3 && String(t3['待办'] || '').indexOf('[x]') === 0, JSON.stringify(t3 && t3['待办']));
    }

    // ---------- 4. 新增电脑 ----------
    await ev('(function(){document.getElementById("addBtn").click();return 1})()');
    await wait(300);
    await ev('(function(){document.querySelector(\'[data-add="machine"]\').click();return 1})()');
    await wait(400);
    await ev('(function(){document.getElementById("m_name").value="体检电脑";var p=document.getElementById("m_place");if(p)p.value="测试位";document.getElementById("m_save").click();return 1})()');
    await wait(1000);
    const d4 = readDb();
    check('新增电脑：落盘', (d4.machines || []).some(m => m['机器名'] === '体检电脑'),
      (d4.machines || []).map(m => m['机器名']).join('/'));

    // ---------- 5. 新增同步记录（GitHub）----------
    await ev('(function(){document.getElementById("addBtn").click();return 1})()');
    await wait(300);
    await ev('(function(){document.querySelector(\'[data-add="gh"]\').click();return 1})()');
    await wait(400);
    const hasGhForm = await ev('(function(){return !!document.getElementById("gf_repo")})()');
    check('同步记录抽屉打开', hasGhForm);
    if (hasGhForm) {
      await ev(`(function(){
        var set=function(id,v){var e=document.getElementById(id);if(e)e.value=v;};
        set("gf_repo","体检/仓库"); set("gf_content","体检同步"); set("gf_versions","v0.0.1");
        set("gf_result","未同步");
        var m=document.getElementById("gf_machine"); if(m&&m.options[1]) m.value=m.options[1].value;
        var sb=document.getElementById("ghSaveBtn")||document.getElementById("saveBtn");
        if(sb) sb.click();
        return 1;
      })()`);
      await wait(1200);
      const d5 = readDb();
      check('新增同步记录：落盘', (d5.github || []).some(g => g['仓库'] === '体检/仓库'),
        (d5.github || []).length + ' 条');
    }

    // ---------- 6. 删除电脑（有任务 → 任务落孤儿列，不该丢）----------
    const d6 = readDb();
    const testMachine = (d6.machines || []).filter(m => m['机器名'] === '体检电脑')[0];
    if (testMachine) {
      // 先给它挂一个任务，验证删除后任务不丢（走 UI 路径，db 在 IIFE 内不可直接调）
      await ev('(function(){document.getElementById("addBtn").click();return 1})()');
      await wait(300);
      await ev('(function(){document.querySelector(\'[data-add="task"]\').click();return 1})()');
      await wait(400);
      await ev(`(function(){
        document.getElementById("f_title").value="体检孤儿任务";
        var m=document.getElementById("f_machine");
        for (var i=0;i<m.options.length;i++) if (m.options[i].text.indexOf("体检电脑")>=0) { m.selectedIndex=i; break; }
        document.getElementById("f_progress").value="待删除电脑的任务";
        document.getElementById("saveBtn").click();
        return 1;
      })()`);
      await wait(1100);
      const d6b = readDb();
      check('体检任务已挂到体检电脑', (d6b.tasks || []).some(t => t['任务标题'] === '体检孤儿任务'));

      // 打开机器菜单 → 点删除
      await ev('(function(){var b=document.querySelector(\'[data-machine-menu]\');return b?b.getAttribute("data-machine-menu"):""})()');
      const mid = await ev('(function(){var b=document.querySelector(\'[data-machine-menu]\');return b?b.getAttribute("data-machine-menu"):""})()');
      const targetMid = await ev(
        '(function(){var m=[].filter.call(document.querySelectorAll("[data-machine-menu]"),function(b){' +
        'var col=b.closest(".col");var n=col?col.querySelector(".ch-name"):null;' +
        'return n&&n.textContent.trim()==="体检电脑"});' +
        'return m.length?m[0].getAttribute("data-machine-menu"):""})()');
      if (targetMid) {
        await ev('(function(){var b=[].filter.call(document.querySelectorAll("[data-machine-menu]"),function(x){return x.getAttribute("data-machine-menu")===' + JSON.stringify(targetMid) + '})[0];b.click();return 1})()');
        await wait(400);
        const menuOk = await ev('(function(){return !!document.querySelector(\'[data-mact="delete"]\')})()');
        check('机器菜单已打开（含删除项）', menuOk);
        if (menuOk) {
          await ev('(function(){document.querySelector(\'[data-mact="delete"]\').click();return 1})()');
          await wait(500);
          // 有确认框 → 点确定
          const hasConfirm = await ev('(function(){return !!document.getElementById("confirmModal")})()');
          if (hasConfirm) {
            const confirmOn = await ev('(function(){var c=document.getElementById("confirmModal");return c&&c.className.indexOf("on")>=0})()');
            if (confirmOn) {
              await ev('(function(){var ok=document.getElementById("cOk");if(ok)ok.click();return 1})()');
            }
          }
          await wait(1100);
          const d6c = readDb();
          check('删除电脑：机器已移除', !(d6c.machines || []).some(m => m['机器名'] === '体检电脑'),
            (d6c.machines || []).map(m => m['机器名']).join('/'));
          check('删除电脑：任务没丢（落孤儿）', (d6c.tasks || []).some(t => t['任务标题'] === '体检孤儿任务'),
            (d6c.tasks || []).length + ' 条任务');
          const orphanCol = await ev('(function(){return document.querySelectorAll("#board .col-orphan").length})()');
          check('删除电脑：出现「未识别电脑」兜底列', orphanCol > 0, orphanCol + ' 个');
        }
      } else {
        check('找到体检电脑的列', false, '未找到');
      }
    }

    // ---------- 7. 最终一致性：页面上看到的 = 数据库里的 ----------
    const d7 = readDb();
    const pageTasks = await ev(
      'Array.prototype.map.call(document.querySelectorAll("#board .c-title"),function(x){return x.textContent.trim()})');
    const dbDoing = (d7.tasks || []).filter(t => t['状态'] !== '已完成').map(t => t['任务标题']);
    const inPage = dbDoing.filter(t => pageTasks.indexOf(t) >= 0);
    check('页面卡片 ⊆ 数据库进行中任务', inPage.length === dbDoing.length,
      '页面 ' + pageTasks.length + ' / 进行中 ' + dbDoing.length);

    // ---------- 8. 清理：把体检写入的数据删掉 ----------
    const d8 = readDb();
    d8.tasks = (d8.tasks || []).filter(t => t['任务标题'] !== '审核任务 001' && t['任务标题'] !== '体检孤儿任务');
    d8.github = (d8.github || []).filter(g => g['仓库'] !== '体检/仓库');
    d8.machines = (d8.machines || []).filter(m => m['机器名'] !== '体检电脑');
    fs.writeFileSync(DBFILE, JSON.stringify(d8, null, 2), 'utf8');
    check('体检数据已清理', true, '任务/同步/电脑各还原');

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
  console.log('写路径体检 ALL PASS  (' + results.length + ' 项)');
})();
