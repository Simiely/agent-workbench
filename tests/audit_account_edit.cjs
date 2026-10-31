// 登录账号：一台电脑 × 一个平台可以有多个号，且能新增 / 改名 / 删除 / 设为当前。
// 关键回归：**新增一个号不能覆盖已有的号**（旧实现只有单值字段，新增 = 重命名）。
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
  // 看板横向可滚，第二列之后的元素原本在视口外，直接点会点到空处
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
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
}

async function key(cdp, k) {
  const code = k === 'Enter' ? 13 : k === 'Escape' ? 27 : 0;
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
}

// 面板里的账号行文本（当前账号带「当前」）
function rowsExpr() {
  return `(function(){
    var p=document.querySelector('.acc-panel'); if(!p) return null;
    var rs=p.querySelectorAll('.acc-row'); var out=[];
    for(var i=0;i<rs.length;i++) out.push(rs[i].querySelector('.nm').textContent.trim()+(rs[i].classList.contains('on')?'*':''));
    return out;
  })()`;
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

    // m1 = 台式机-家，WB 池里有 WB-主号(当前) + WB-备用号
    const PILL = '.col[data-machine-id="m1"] .ch-acc .acc[data-switch="m1:wb"]';

    // ---------- 1. 胶囊显示当前账号 + 账号数角标 ----------
    const pill = await ev(`(function(){
      var b=document.querySelector('${PILL}'); if(!b) return null;
      var c=b.querySelector('.cnt');
      return {name:b.querySelector('.an').textContent.trim(), cnt:c?c.textContent.trim():''};
    })()`);
    check('胶囊显示当前账号', pill && pill.name === 'WB-主号', pill && pill.name);
    check('胶囊带账号数角标 2', pill && pill.cnt === '2', pill && pill.cnt);

    // ---------- 2. 打开面板：只列本机该平台的号 ----------
    await click(cdp, PILL);
    await wait(260);
    const rows1 = await ev(rowsExpr());
    check('面板能打开', Array.isArray(rows1), rows1 === null ? '没找到 .acc-panel' : '');
    check('只列本机 WorkBuddy 的号', JSON.stringify(rows1) === JSON.stringify(['WB-主号*', 'WB-备用号']), JSON.stringify(rows1));
    check('当前号带「当前」标记', rows1 && rows1[0] === 'WB-主号*', rows1 && rows1[0]);

    // 改名 / 删除入口必须常驻可见：藏在 :hover 里等于没有入口（用户就是这么找不到删除的）
    const opsVis = await ev(`(function(){
      var rs=document.querySelectorAll('.acc-panel .acc-row');
      if(rs.length<2) return null;
      var ops=rs[1].querySelector('.ops'), ico=rs[1].querySelector('.acc-ico');
      if(!ops||!ico) return null;
      var cs=getComputedStyle(ops), ir=ico.getBoundingClientRect();
      return {op:cs.opacity, disp:cs.display, w:Math.round(ir.width), h:Math.round(ir.height),
              icos:rs[1].querySelectorAll('.acc-ico').length};
    })()`);
    check('非当前行也直接看到改名/删除图标', opsVis && opsVis.op === '1' && opsVis.disp !== 'none' &&
      opsVis.w >= 10 && opsVis.h >= 10 && opsVis.icos === 2, JSON.stringify(opsVis));
    const icoSvg = await ev(`(function(){
      var s=document.querySelectorAll('.acc-panel .acc-ico svg');
      return {n:s.length, vb:(s[0]&&s[0].getAttribute('viewBox'))||''};
    })()`);
    check('图标是内联 SVG（不依赖系统 dingbat 字形）', icoSvg && icoSvg.n === 4 && icoSvg.vb === '0 0 12 12',
      JSON.stringify(icoSvg));

    // ---------- 3. 新增：输入框必须是空的（旧实现预填当前值 → 看起来像改名）----------
    await click(cdp, '.acc-panel [data-acc-add]');
    await wait(240);
    const inputVal = await ev(`(function(){var i=document.querySelector('.acc-panel [data-acc-field]');return i?i.value:null})()`);
    check('新增输入框默认为空', inputVal === '', JSON.stringify(inputVal));
    const btnText = await ev(`(function(){var b=document.querySelector('.acc-panel [data-acc-save]');return b?b.textContent.trim():null})()`);
    check('新增按钮文案是「添加」', btnText === '添加', btnText);

    // ---------- 4. 真键盘输入 + 回车，新增第二个号 ----------
    await click(cdp, '.acc-panel [data-acc-field]');
    await wait(80);
    await cdp.send('Input.insertText', { text: 'WB-测试号' });
    await wait(120);
    await key(cdp, 'Enter');
    await wait(900);
    const rows2 = await ev(rowsExpr());
    check('新增后原有的号都还在', Array.isArray(rows2) && rows2.indexOf('WB-主号*') >= 0 && rows2.indexOf('WB-备用号') >= 0,
      JSON.stringify(rows2));
    check('新增后池里有 3 个号', Array.isArray(rows2) && rows2.length === 3, JSON.stringify(rows2));

    const d1 = await getJSON('/api/query?db=accounts');
    const pool1 = (d1.results || []).filter(a => a['所属电脑'] === '台式机-家' && a['平台'] === 'WorkBuddy');
    check('库里落成 3 条账号记录', pool1.length === 3, pool1.map(a => a['账号名']).join('/'));
    check('新增的号不是当前', (pool1.filter(a => a['账号名'] === 'WB-测试号')[0] || {})['当前'] === false,
      String((pool1.filter(a => a['账号名'] === 'WB-测试号')[0] || {})['当前']));

    const m1a = await getJSON('/api/query?db=machines');
    const mac1 = (m1a.results || []).filter(m => m['机器名'] === '台式机-家')[0] || {};
    check('机器表当前账号没被新增改动', mac1['WorkBuddy账号'] === 'WB-主号', String(mac1['WorkBuddy账号']));

    // ---------- 5. 点另一个号 = 设为当前（只切当前，不删不改名）----------
    await click(cdp, '.acc-panel .acc-list .acc-row:nth-child(3) .nm');
    await wait(700);
    const rows3 = await ev(rowsExpr());
    check('点一下即切换当前账号', Array.isArray(rows3) && rows3.indexOf('WB-测试号*') >= 0, JSON.stringify(rows3));
    const d2 = await getJSON('/api/query?db=accounts');
    const pool2 = (d2.results || []).filter(a => a['所属电脑'] === '台式机-家' && a['平台'] === 'WorkBuddy');
    check('同池只有一条「当前」', pool2.filter(a => a['当前'] === true).length === 1,
      pool2.filter(a => a['当前'] === true).map(a => a['账号名']).join('/'));
    const pill2 = await ev(`(function(){var b=document.querySelector('${PILL}');return b?b.querySelector('.an').textContent.trim():null})()`);
    check('胶囊跟着变成新当前', pill2 === 'WB-测试号', pill2);

    // ---------- 6. 改名：预填旧名，改完当前指针跟着走 ----------
    const rid = (pool2.filter(a => a['账号名'] === 'WB-测试号')[0] || {})._id;
    await click(cdp, '.acc-panel [data-acc-rename="' + rid + '"]');
    await wait(240);
    const renameVal = await ev(`(function(){var i=document.querySelector('.acc-panel [data-acc-field]');return i?i.value:null})()`);
    check('改名输入框预填旧名', renameVal === 'WB-测试号', JSON.stringify(renameVal));
    await click(cdp, '.acc-panel [data-acc-field]');
    await ctrlA(cdp);
    await cdp.send('Input.insertText', { text: 'WB-测试号2' });
    await wait(120);
    await key(cdp, 'Enter');
    await wait(800);
    const d3 = await getJSON('/api/query?db=accounts');
    const renamed = (d3.results || []).filter(a => a._id === rid)[0] || {};
    check('改名已落库', renamed['账号名'] === 'WB-测试号2', String(renamed['账号名']));
    check('改名后仍是当前', renamed['当前'] === true, String(renamed['当前']));
    const pill3 = await ev(`(function(){var b=document.querySelector('${PILL}');return b?b.querySelector('.an').textContent.trim():null})()`);
    check('胶囊同步新名字', pill3 === 'WB-测试号2', pill3);

    // ---------- 7. 删除当前账号：确认后从列表移除，当前顺延 ----------
    await click(cdp, '.acc-panel [data-acc-del="' + rid + '"]');
    await wait(300);
    const confirmOn = await ev(`(function(){var m=document.getElementById('confirmModal');return !!(m&&m.classList.contains('on'))})()`);
    check('删除前有确认框', confirmOn === true, String(confirmOn));
    await click(cdp, '#cOk');
    await wait(900);
    const rows4 = await ev(rowsExpr());
    check('删除后该号消失', Array.isArray(rows4) && rows4.join('/').indexOf('WB-测试号2') < 0, JSON.stringify(rows4));
    check('删除后当前顺延到剩下的号', Array.isArray(rows4) && rows4.length === 2 && rows4.filter(r => r.slice(-1) === '*').length === 1,
      JSON.stringify(rows4));
    const d4 = await getJSON('/api/query?db=accounts');
    const pool4 = (d4.results || []).filter(a => a['所属电脑'] === '台式机-家' && a['平台'] === 'WorkBuddy');
    check('库里也只剩 2 条', pool4.length === 2, pool4.map(a => a['账号名']).join('/'));

    // ---------- 8. 清除登录态：账号留着，当前置空 ----------
    const clearBtn = await ev(`(function(){return !!document.querySelector('.acc-panel [data-acc-clear]')})()`);
    check('有当前账号时提供「清除登录态」', clearBtn === true, String(clearBtn));
    if (clearBtn) {
      await click(cdp, '.acc-panel [data-acc-clear]');
      await wait(800);
      const pill4 = await ev(`(function(){var b=document.querySelector('${PILL}');if(!b)return null;var c=b.querySelector('.cnt');return {name:b.querySelector('.an').textContent.trim(),cnt:c?c.textContent.trim():'',empty:b.classList.contains('empty')}})()`);
      check('清除后胶囊显示未登录', pill4 && pill4.name === '未登录' && pill4.empty, pill4 && pill4.name);
      check('清除后角标仍在（账号没丢）', pill4 && pill4.cnt === '2', pill4 && pill4.cnt);
      const d5 = await getJSON('/api/query?db=accounts');
      const pool5 = (d5.results || []).filter(a => a['所属电脑'] === '台式机-家' && a['平台'] === 'WorkBuddy');
      check('清除后账号仍有 2 条、当前为 0', pool5.length === 2 && pool5.filter(a => a['当前'] === true).length === 0,
        pool5.map(a => a['账号名'] + (a['当前'] ? '*' : '')).join('/'));
      const m5 = await getJSON('/api/query?db=machines');
      const mac5 = (m5.results || []).filter(m => m['机器名'] === '台式机-家')[0] || {};
      check('机器表派生字段变空', mac5['WorkBuddy账号'] === '', JSON.stringify(mac5['WorkBuddy账号']));
    }

    // ---------- 9. 别的电脑不受影响 ----------
    const d6 = await getJSON('/api/query?db=accounts');
    const other = (d6.results || []).filter(a => a['所属电脑'] === '笔记本' && a['平台'] === 'WorkBuddy');
    check('另一台电脑的账号没被波及', other.length === 1 && other[0]['账号名'] === 'WB-副号' && other[0]['当前'] === true,
      other.map(a => a['账号名'] + (a['当前'] ? '*' : '')).join('/'));

    // ---------- 10. 面板不混入别的电脑的账号 ----------
    await key(cdp, 'Escape');
    await wait(200);
    await click(cdp, '.col[data-machine-id="m2"] .ch-acc .acc[data-switch="m2:wb"]');
    await wait(300);
    const rows6 = await ev(rowsExpr());
    check('另一台电脑的面板只列自己的号', JSON.stringify(rows6) === JSON.stringify(['WB-副号*']), JSON.stringify(rows6));
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
