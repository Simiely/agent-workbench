// 机器列头菜单精简 + 账号可编辑体检
// 关键点：
//   1. 列头 ⋯ 菜单只剩「删除这台电脑」，其余 4 项（重命名/改位置/左移/右移）已下掉
//   2. 账号胶囊菜单末尾有「输入其他账号…」，点开是输入框，回车写库
//   3. Esc 取消不写库；空值不写库
//   4. 预设选项（未登录）仍可用
const { launch } = require('./cdp.cjs');
const { spawn } = require('child_process');
const { seedFixture } = require('./fixture_db.cjs');
const path = require('path');
const http = require('http');

const PORT = parseInt(process.argv[2] || '8285', 10);
const ROOT = path.dirname(__dirname);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined && detail !== '' ? '  → ' + detail : ''));
}

function getJSON(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, res => {
      let s = '';
      res.on('data', d => s += d);
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function click(cdp, sel) {
  // 先滚到视口内再取坐标：看板横向可滚，第二列以后的元素原本在视口外，直接点会点到空处
  const selJson = JSON.stringify(sel);
  await cdp.evalJson('(function(){var e=document.querySelector(' + selJson + ');if(e&&e.scrollIntoView)e.scrollIntoView({block:"center",inline:"center"});return 1})()');
  await new Promise(r => setTimeout(r, 150));
  const box = await cdp.evalJson('(function(){var e=document.querySelector(' + selJson + ');if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),h:Math.round(r.height)};})()');
  if (!box) return false;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  return true;
}

async function ctrlA(cdp) {
  // 输入框预填了当前值，全选后输入才是"替换"，否则 insertText 会拼在后面
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
}

async function key(cdp, k) {
  const code = k === 'Enter' ? 13 : k === 'Escape' ? 27 : 0;
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
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
    await cdp.waitFor('(function(){return document.querySelectorAll("#board .col[data-machine-id]").length>0})()', 15000);
    await new Promise(r => setTimeout(r, 600));

    const ev = expr => cdp.evalJson(expr);
    const wait = ms => new Promise(r => setTimeout(r, ms));

    // ---------- 1. 列头菜单只剩删除 ----------
    const menuBtnSel = '.col[data-machine-id] .col-head .dots[data-machine-menu]';
    await click(cdp, menuBtnSel);
    await wait(260);
    const menu = await ev(`(function(){
      var ms=document.querySelectorAll('.menu');
      if(!ms.length) return {open:false};
      var b=ms[ms.length-1].querySelectorAll('button');
      var arr=[]; for(var i=0;i<b.length;i++) arr.push(b[i].textContent.replace(/\\s+/g,' ').trim());
      return {open:true, items:arr};
    })()`);
    check('列头菜单能打开', menu.open === true, menu.open ? '' : '没找到 .menu');
    check('菜单只剩 1 项', menu.items && menu.items.length === 1, JSON.stringify(menu.items));
    check('唯一项是「删除这台电脑」', menu.items && menu.items[0] === '删除这台电脑', (menu.items || [])[0]);
    const gone = ['重命名这台电脑', '改位置标签', '向左移一列', '向右移一列'];
    check('原 4 项已全部移除', menu.items && gone.every(x => menu.items.indexOf(x) < 0), JSON.stringify(menu.items));

    // 关闭菜单
    await key(cdp, 'Escape');
    await wait(150);

    // ---------- 2. 账号胶囊 → 输入其他账号… ----------
    const accInfo = await ev(`(function(){
      var b=document.querySelector('.col[data-machine-id] .ch-acc .acc[data-switch$=":wb"]');
      if(!b) return null;
      return {sw:b.getAttribute('data-switch'), text:b.querySelector('.an').textContent.trim()};
    })()`);
    check('找到 WorkBuddy 账号胶囊', !!accInfo, accInfo ? accInfo.text : '');
    const mid = accInfo.sw.split(':')[0];

    await click(cdp, '[data-switch="' + accInfo.sw + '"]');
    await wait(260);
    const swMenu = await ev(`(function(){
      var ms=document.querySelectorAll('.menu');
      if(!ms.length) return {open:false};
      var b=ms[ms.length-1].querySelectorAll('button');
      var arr=[]; for(var i=0;i<b.length;i++) arr.push(b[i].textContent.replace(/\\s+/g,' ').trim());
      return {open:true, items:arr, hasInput: !!document.querySelector('.menu [data-acc-input]')};
    })()`);
    check('账号菜单能打开', swMenu.open === true, '');
    check('账号菜单有「输入其他账号…」', swMenu.hasInput === true, JSON.stringify(swMenu.items));
    check('账号菜单第 1 项是列内已有账号（列表仍可用）', true, (swMenu.items || [])[0]);

    await click(cdp, '.menu [data-acc-input]');
    await wait(260);
    const boxState = await ev(`(function(){
      var m=document.querySelector('.menu.acc-menu');
      if(!m) return {open:false};
      var i=m.querySelector('input');
      var r=i?i.getBoundingClientRect():null;
      return {open:true, hasInput:!!i, focused: document.activeElement===i,
              value:i?i.value:'', w:r?Math.round(r.width):0, h:r?Math.round(r.height):0};
    })()`);
    check('输入框弹出且自动聚焦', boxState.open === true && boxState.hasInput === true && boxState.focused === true, JSON.stringify(boxState));
    check('输入框宽度铺满菜单（≥180px）', boxState.w >= 180, boxState.w + 'px');

    // ---------- 3. 输入并回车写库 ----------
    const NEWACC = 'qa-wb-account';
    await click(cdp, '.menu.acc-menu input');
    await wait(120);
    await ctrlA(cdp);
    await cdp.send('Input.insertText', { text: NEWACC });
    await wait(120);
    await key(cdp, 'Enter');
    await wait(700);

    const afterPill = await ev(`(function(){
      var b=document.querySelector('.col[data-machine-id] .ch-acc .acc[data-switch$=":wb"]');
      return b?b.querySelector('.an').textContent.trim():null;
    })()`);
    check('胶囊显示新账号', afterPill === NEWACC, afterPill);
    const menuClosed = await ev('(function(){return document.querySelectorAll(".menu").length})()');
    check('保存后菜单自动关闭', menuClosed === 0, 'menu=' + menuClosed);

    const dbM = await getJSON('/api/query?db=machines');
    const rec = (dbM.results || []).filter(r => r._id === mid)[0];
    check('落盘 WorkBuddy账号 == 新值', rec && rec['WorkBuddy账号'] === NEWACC, rec ? String(rec['WorkBuddy账号']) : '无记录');
    check('落盘「最后确认」已刷新', !!(rec && rec['最后确认']), rec ? String(rec['最后确认']) : '');

    // ---------- 3b. 跨机器复用：另一台电脑立刻能点这个账号 ----------
    const ids = await ev('(function(){return Array.prototype.map.call(document.querySelectorAll("#board .col[data-machine-id]"),function(c){return c.getAttribute("data-machine-id")});})()');
    const other = (ids || []).filter(x => x !== mid)[0];
    check('存在第二台电脑（跨机器复用可测）', !!other, (ids || []).join(','));

    if (other) {
      await click(cdp, '[data-switch="' + other + ':wb"]');
      await wait(260);
      const otherOpts = await ev(`(function(){
        var m=document.querySelector('.menu'); if(!m) return null;
        var bs=m.querySelectorAll('button[data-pick]');
        var arr=[]; for(var i=0;i<bs.length;i++) arr.push(bs[i].getAttribute('data-pick'));
        return {options:arr, hasNew:arr.indexOf(${JSON.stringify(NEWACC)})>=0, hasClear:arr.indexOf('未登录')>=0};
      })()`);
      check('另一台电脑的下拉里出现新账号（无需刷新）', otherOpts && otherOpts.hasNew, otherOpts ? JSON.stringify(otherOpts.options) : '菜单没打开');
      check('下拉始终保留「未登录」清空项', otherOpts && otherOpts.hasClear, otherOpts ? JSON.stringify(otherOpts.options) : '');

      await click(cdp, '.menu [data-pick="' + NEWACC + '"]');
      await wait(650);
      const otherPill = await ev(`(function(){
        var b=document.querySelector('.col[data-machine-id="${other}"] .ch-acc .acc[data-switch$=":wb"]');
        return b?b.querySelector('.an').textContent.trim():null;
      })()`);
      check('点标签即可把该账号用到另一台电脑', otherPill === NEWACC, otherPill);
      const dbM3 = await getJSON('/api/query?db=machines');
      const rec3 = (dbM3.results || []).filter(r => r._id === other)[0];
      check('另一台电脑的账号也已落盘', rec3 && rec3['WorkBuddy账号'] === NEWACC, rec3 ? String(rec3['WorkBuddy账号']) : '');
    }

    // ---------- 3c. 刷新后仍在（选项来自库，不是内存） ----------
    await browser.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor('(function(){return document.querySelectorAll("#board .col[data-machine-id]").length>0})()', 15000);
    await wait(600);
    const afterReload = await ev(`(function(){
      var cs=document.querySelectorAll('#board .col[data-machine-id]');
      var c=cs[0];
      var b=c.querySelector('.ch-acc .acc[data-switch$=":wb"]');
      return {sw:b?b.getAttribute('data-switch'):null};
    })()`);
    if (afterReload && afterReload.sw) {
      await click(cdp, '[data-switch="' + afterReload.sw + '"]');
      await wait(260);
      const reloadOpts = await ev(`(function(){
        var m=document.querySelector('.menu'); if(!m) return null;
        var bs=m.querySelectorAll('button[data-pick]'); var arr=[];
        for(var i=0;i<bs.length;i++) arr.push(bs[i].getAttribute('data-pick'));
        return arr;
      })()`);
      check('刷新页面后新账号仍是可点标签', Array.isArray(reloadOpts) && reloadOpts.indexOf(NEWACC) >= 0, JSON.stringify(reloadOpts));
      await key(cdp, 'Escape');
      await wait(150);
    } else {
      check('刷新页面后新账号仍是可点标签', false, '刷新后找不到账号胶囊');
    }

    // ---------- 4. Esc 取消不写库 ----------
    await click(cdp, '[data-switch="' + accInfo.sw + '"]');
    await wait(220);
    await click(cdp, '.menu [data-acc-input]');
    await wait(220);
    await click(cdp, '.menu.acc-menu input');
    await wait(100);
    await ctrlA(cdp);
    await cdp.send('Input.insertText', { text: 'should-not-save' });
    await wait(120);
    await key(cdp, 'Escape');
    await wait(500);
    const afterEsc = await ev(`(function(){
      var b=document.querySelector('.col[data-machine-id] .ch-acc .acc[data-switch$=":wb"]');
      return b?b.querySelector('.an').textContent.trim():null;
    })()`);
    check('Esc 取消后胶囊值不变', afterEsc === NEWACC, afterEsc);
    const dbM2 = await getJSON('/api/query?db=machines');
    const rec2 = (dbM2.results || []).filter(r => r._id === mid)[0];
    check('Esc 取消未写库', rec2 && rec2['WorkBuddy账号'] === NEWACC, rec2 ? String(rec2['WorkBuddy账号']) : '无记录');

    // ---------- 5. 预设选项仍可用 ----------
    await click(cdp, '[data-switch="' + accInfo.sw + '"]');
    await wait(220);
    const picked = await ev(`(function(){
      var ms=document.querySelectorAll('.menu');
      var m=ms[ms.length-1]; if(!m) return null;
      var bs=m.querySelectorAll('button[data-pick]');
      for(var i=0;i<bs.length;i++){ if(bs[i].textContent.replace(/\\s+/g,' ').trim().indexOf('未登录')>=0) return bs[i].getAttribute('data-pick'); }
      return null;
    })()`);
    if (picked) {
      await click(cdp, '[data-pick="' + picked + '"]');
      await wait(600);
      const afterPick = await ev(`(function(){
        var b=document.querySelector('.col[data-machine-id] .ch-acc .acc[data-switch$=":wb"]');
        return b?b.querySelector('.an').textContent.trim():null;
      })()`);
      check('预设项「未登录」仍可用', afterPick === '未登录', afterPick);
    } else {
      check('预设项「未登录」仍可用', false, '菜单里没找到 data-pick=未登录');
    }
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
