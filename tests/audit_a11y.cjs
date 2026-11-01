// 无障碍体检：键盘可达 / aria 播报 / 图标按钮可访问名 / 表单 label 关联
// 为什么要有这个：这些点在 mock 套件里测不出来（它们不产生任何业务数据变化），
// 只能靠真实浏览器 + 真实键盘事件验证。
const { launch } = require('./cdp.cjs');
const { spawn } = require('child_process');
const { seedFixture } = require('./fixture_db.cjs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '8183', 10);
const ROOT = path.dirname(__dirname);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined && detail !== '' ? '  → ' + detail : ''));
}

async function key(cdp, k) {
  const code = k === 'Enter' ? 13 : k === 'Escape' ? 27 : k === ' ' ? 32 : 0;
  const keyName = k === ' ' ? ' ' : k;
  const codeName = k === 'Enter' ? 'Enter' : k === 'Escape' ? 'Escape' : 'Space';
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code: codeName, windowsVirtualKeyCode: code, text: k === ' ' ? ' ' : undefined });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: codeName, windowsVirtualKeyCode: code });
}

(async () => {
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor('(function(){return document.querySelectorAll("#board .card").length>0})()', 15000);
    await new Promise(r => setTimeout(r, 600));

    const ev = expr => cdp.evalJson(expr);
    const wait = ms => new Promise(r => setTimeout(r, ms));

    // ---------- 1. toast 对读屏可感知 ----------
    const toast = await ev(`(function(){var t=document.getElementById('toast');return {role:t.getAttribute('role'),live:t.getAttribute('aria-live')} })()`);
    check('toast 有 role=status 与 aria-live=polite', toast.role === 'status' && toast.live === 'polite', JSON.stringify(toast));

    // ---------- 2. 图标按钮都有可访问名 ----------
    const iconBtns = await ev(`(function(){
      var bs=document.querySelectorAll('button.icon-btn'), bad=[];
      for(var i=0;i<bs.length;i++){
        var b=bs[i], name=(b.getAttribute('aria-label')||'').trim() || (b.textContent||'').trim();
        if(!name) bad.push(b.id||b.className);
      }
      return {total:bs.length, bad:bad};
    })()`);
    check('所有图标按钮都有可访问名（aria-label 或文本）', iconBtns.total > 0 && iconBtns.bad.length === 0, JSON.stringify(iconBtns));

    // ---------- 3. 卡片：可聚焦 + 有角色 + 有可读名 ----------
    const cardA11y = await ev(`(function(){
      var c=document.querySelector('#board .card');
      if(!c) return null;
      return {tab:c.getAttribute('tabindex'), role:c.getAttribute('role'), label:c.getAttribute('aria-label')};
    })()`);
    check('任务卡可 Tab 聚焦（tabindex=0）', cardA11y && cardA11y.tab === '0', JSON.stringify(cardA11y));
    check('任务卡有 button 角色与可读名', cardA11y && cardA11y.role === 'button' && /打开任务详情/.test(cardA11y.label || ''), JSON.stringify(cardA11y));
    const repoA11y = await ev(`(function(){
      var c=document.querySelector('#ghList .repo-card');
      if(!c) return null;
      return {tab:c.getAttribute('tabindex'), role:c.getAttribute('role'), label:c.getAttribute('aria-label')};
    })()`);
    check('仓库卡可 Tab 聚焦且有可读名', repoA11y && repoA11y.tab === '0' && repoA11y.role === 'button' && /打开仓库详情/.test(repoA11y.label || ''), JSON.stringify(repoA11y));

    // ---------- 4. 键盘 Enter 打开任务详情（与鼠标点卡片等价） ----------
    await ev(`(function(){var c=document.querySelector('#board .card');c.focus();return c===document.activeElement})()`);
    await wait(120);
    await key(cdp, 'Enter');
    await wait(400);
    const opened = await ev(`(function(){return {on:document.getElementById('drawer').className.indexOf('on')>=0, title:document.getElementById('drawerTitle').textContent.trim(), kind:document.getElementById('saveBtn').style.display}})()`);
    check('键盘 Enter 打开任务详情', opened.on === true && opened.title === '任务详情', JSON.stringify(opened));
    await key(cdp, 'Escape');
    await wait(300);
    check('Esc 能关闭（键盘闭环）', await ev(`(function(){return document.getElementById('drawer').className.indexOf('on')<0})()`));

    // ---------- 5. 管理模式：Enter 是「选中」，不会误开详情 ----------
    await ev(`(function(){document.getElementById('manageBtn').click();return 1})()`);
    await wait(250);
    const selBefore = await ev(`(function(){return document.querySelectorAll('#board .card.sel').length})()`);
    await ev(`(function(){var c=document.querySelector('#board .card');c.focus();return 1})()`);
    await key(cdp, 'Enter');
    await wait(350);
    const managed = await ev(`(function(){return {sel:document.querySelectorAll('#board .card.sel').length, drawer:document.getElementById('drawer').className.indexOf('on')>=0}})()`);
    check('管理模式 Enter = 选中卡片，不打开详情', managed.sel === selBefore + 1 && managed.drawer === false, JSON.stringify(managed));
    await ev(`(function(){document.getElementById('manageBtn').click();return 1})()`);
    await wait(200);

    // ---------- 6. 表单 label 与控件关联（静态筛选 + 动态表单） ----------
    const staticLabels = await ev(`(function(){
      var ls=document.querySelectorAll('label[for]'), bad=[];
      for(var i=0;i<ls.length;i++){ if(!document.getElementById(ls[i].getAttribute('for'))) bad.push(ls[i].getAttribute('for')); }
      return {total:ls.length, bad:bad};
    })()`);
    check('静态 label 的 for 都指向真实控件', staticLabels.total > 0 && staticLabels.bad.length === 0, JSON.stringify(staticLabels));

    await ev(`(function(){document.getElementById('addBtn').click();return 1})()`);
    await wait(260);
    await ev(`(function(){document.querySelector('[data-add="task"]').click();return 1})()`);
    await wait(400);
    const formLabels = await ev(`(function(){
      var fs=document.querySelectorAll('#drawerBody .field'), bad=[];
      for(var i=0;i<fs.length;i++){
        var lab=fs[i].querySelector('label'), ctl=fs[i].querySelector('input,select,textarea');
        if(!lab || !ctl) continue;                       // 纯说明型 field 不参与
        if(lab.classList.contains('check-line')) continue; // 包裹式 label 自带关联
        var f=lab.getAttribute('for');
        if(!f || !document.getElementById(f) || document.getElementById(f)!==ctl) bad.push((lab.textContent||'').trim());
      }
      return {total:fs.length, bad:bad};
    })()`);
    check('新建任务表单里每个控件都有对应 label', formLabels.bad.length === 0, JSON.stringify(formLabels));
  } catch (e) {
    check('执行未抛错', false, e && e.message);
    console.error(e);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  const failed = results.filter(r => !r.ok);
  console.log('');
  if (failed.length) {
    console.log('FAILED ' + failed.length + '/' + results.length);
    failed.forEach(f => console.log('  - ' + f.name));
    process.exit(1);
  }
  console.log('ALL PASS (' + results.length + ' 项)');
})();
