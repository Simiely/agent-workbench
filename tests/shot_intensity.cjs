// 开发强度 v37 实拍：头部方块格子(写数字) + 本周/本月/近3个月 + 按年日历(数字开关)
// Esc 一律走 CDP 原生按键注入 —— 合成 dispatchEvent 在 headless 里到不了主 world 监听器
const { launch } = require('./cdp.cjs');
const fs = require('fs');

const PORT = parseInt(process.argv[2] || '8194', 10);
const OUT = process.argv[3] || 'C:/Temp/awb-gi.png';

async function escKey(cdp) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
}

(async () => {
  let browser = null;
  try {
    browser = await launch();
    const { cdp } = browser;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 900, deviceScaleFactor: 1, mobile: false
    });
    await browser.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor('(function(){return document.querySelectorAll("#ghIntensity .gi-cell").length>0})()', 15000);
    await new Promise(r => setTimeout(r, 700));

    const head = await cdp.evalJson(`(function(){
      var cells=Array.prototype.slice.call(document.querySelectorAll('#ghIntensity .gi-cell'));
      return {
        格子数: cells.length,
        默认范围: (document.querySelector('#ghIntensity .gi-range.on')||{}).textContent,
        格内日期数: document.querySelectorAll('#ghIntensity .gi-cell em').length,
        首列: cells[0].getAttribute('data-gi-day'),
        末列: cells[cells.length-1].getAttribute('data-gi-day'),
        写数字格子: document.querySelectorAll('#ghIntensity .gi-cell i').length,
        面板高: Math.round(document.getElementById('ghIntensity').getBoundingClientRect().height),
        kpi占位: (function(){var k=document.querySelector('#summary .kpis');return k.offsetHeight+12;})()
      };
    })()`);
    console.log('头部:', JSON.stringify(head, null, 1));

    // 截头部
    const box = await cdp.evalJson(
      '(function(){var r=document.getElementById("ghIntensity").getBoundingClientRect();' +
      'return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})()');
    let shot = await cdp.send('Page.captureScreenshot', {
      format: 'png', clip: { x: box.x - 8, y: box.y - 8, width: box.w + 16, height: box.h + 16, scale: 1 }
    });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));

    // 打开日历
    await cdp.evalJson('(function(){document.querySelector("#ghIntensity .gi-label").click();return 1})()');
    await new Promise(r => setTimeout(r, 600));
    const sheet = await cdp.evalJson(`(function(){
      return {
        打开: document.getElementById('drawer').classList.contains('on'),
        xl加宽: document.getElementById('drawer').className.indexOf('xl')>=0,
        弹窗宽: Math.round(document.getElementById('drawer').getBoundingClientRect().width),
        年份: document.querySelector('.hm-nav b').textContent,
        next禁用: document.querySelector('[data-hm-year=next]').disabled,
        汇总: document.querySelector('.hm-summary').textContent,
        周列数: document.querySelectorAll('.hm-week').length,
        格子数: document.querySelectorAll('.hm[data-hm-day]').length,
        月标签数: document.querySelectorAll('.hm-months span').length,
        数字默认开: document.querySelector('[data-hm-num]').className.indexOf('on')>=0,
        数字格数: document.querySelectorAll('#drawerBody .hm i').length,
        无横向滚动: (function(){var s=document.querySelector('#drawerBody .hm-scroll');return s? s.scrollWidth<=s.clientWidth+1 : null;})()
      };
    })()`);
    console.log('日历:', JSON.stringify(sheet, null, 1));

    // 切上一年再切回来
    await cdp.evalJson('(function(){document.querySelector("[data-hm-year=prev]").click();return 1})()');
    await new Promise(r => setTimeout(r, 400));
    const prev = await cdp.evalJson('(function(){return { 年份: document.querySelector(".hm-nav b").textContent, 格子: document.querySelectorAll(".hm[data-hm-day]").length, 数字格: document.querySelectorAll("#drawerBody .hm i").length };})()');
    console.log('上一年:', JSON.stringify(prev));
    await cdp.evalJson('(function(){document.querySelector("[data-hm-year=next]").click();return 1})()');
    await new Promise(r => setTimeout(r, 400));

    // 截日历（带数字）
    const dbox = await cdp.evalJson(
      '(function(){var r=document.getElementById("drawer").getBoundingClientRect();' +
      'return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})()');
    shot = await cdp.send('Page.captureScreenshot', {
      format: 'png', clip: { x: dbox.x, y: dbox.y, width: dbox.w, height: dbox.h, scale: 1 }
    });
    fs.writeFileSync(OUT.replace('.png', '-calendar.png'), Buffer.from(shot.data, 'base64'));
    console.log('截图已保存: ' + OUT + ' + ' + OUT.replace('.png', '-calendar.png'));

    // tooltip
    await cdp.evalJson(`(function(){
      var c=document.querySelector('#drawerBody .hm[data-hm-n]:not([data-hm-n="0"])')||document.querySelector('#drawerBody .hm[data-hm-day]');
      c.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));return 1;
    })()`);
    await new Promise(r => setTimeout(r, 300));
    const tip = await cdp.evalJson(`(function(){
      var t=document.querySelector('.hm-tip');
      return t?{可见: t.style.display!=='none', 文本: t.textContent.trim()}:null;
    })()`);
    console.log('tooltip:', JSON.stringify(tip));

    // Esc：原生按键注入
    await escKey(cdp);
    await new Promise(r => setTimeout(r, 500));
    const closed = await cdp.evalJson('(function(){return { 关闭: !document.getElementById("drawer").classList.contains("on"), xl还原: document.getElementById("drawer").className.indexOf("xl")<0 };})()');
    console.log('Esc:', JSON.stringify(closed));
  } catch (e) {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
