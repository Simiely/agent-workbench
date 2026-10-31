// 账号面板视觉核查：几何测量 + 高倍裁剪截图。用法：node tests/shot_acc_detail.cjs <port> <outPrefix>
const { launch } = require('./cdp.cjs');
const fs = require('fs');

const PORT = parseInt(process.argv[2] || '8304', 10);
const PREFIX = process.argv[3] || 'C:/Temp/acc';

(async () => {
  const browser = await launch();
  const { cdp } = browser;
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 820, deviceScaleFactor: 2, mobile: false
    });
    await browser.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor('document.querySelectorAll("#board .col").length>0', 15000);
    await new Promise(r => setTimeout(r, 900));

    // 打开第一台电脑的 WorkBuddy 账号面板
    await cdp.evalJson('(function(){var b=document.querySelector("[data-switch]");if(!b)return 0;b.click();return 1})()');
    await cdp.waitFor('!!document.querySelector("[data-acc-panel]")', 5000);
    await new Promise(r => setTimeout(r, 350));

    const geo = await cdp.evalJson(`(function(){
      var p = document.querySelector('[data-acc-panel]');
      var r = p.getBoundingClientRect();
      var rows = [].map.call(p.querySelectorAll('.acc-row'), function(n){
        var nr = n.getBoundingClientRect();
        return { h: Math.round(nr.height), w: Math.round(nr.width), text: n.textContent.replace(/\\s+/g,' ').trim() };
      });
      var icos = [].map.call(p.querySelectorAll('.acc-ico'), function(n){
        var b = n.getBoundingClientRect();
        var cs = getComputedStyle(n);
        return { w: Math.round(b.width), h: Math.round(b.height), pad: cs.padding, ovf: n.scrollWidth > n.clientWidth + 1 };
      });
      var btns = [].map.call(p.querySelectorAll('.acc-foot button'), function(n){
        var b = n.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height), t: n.textContent.trim() };
      });
      return {
        rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom) },
        vw: innerWidth, vh: innerHeight,
        overflowRight: Math.round(r.right) > innerWidth,
        overflowBottom: Math.round(r.bottom) > innerHeight,
        rows: rows, icos: icos, btns: btns,
        scrollH: p.scrollHeight, clientH: p.clientHeight
      };
    })()`);
    console.log('几何: ' + JSON.stringify(geo, null, 1));

    // 裁剪截图：面板 + 周边 12px 留白
    const clip1 = {
      x: Math.max(0, geo.rect.l - 14), y: Math.max(0, geo.rect.t - 30),
      width: Math.min(geo.rect.w + 28, 1280 - Math.max(0, geo.rect.l - 14)),
      height: geo.rect.h + 44, scale: 2
    };
    const s1 = await cdp.send('Page.captureScreenshot', { format: 'png', clip: clip1, captureBeyondViewport: true });
    fs.writeFileSync(PREFIX + '_list.png', Buffer.from(s1.data, 'base64'));

    // 新增态
    await cdp.evalJson('(function(){var b=document.querySelector("[data-acc-add]");if(!b)return 0;b.click();return 1})()');
    await new Promise(r => setTimeout(r, 300));
    const geo2 = await cdp.evalJson(`(function(){
      var p = document.querySelector('[data-acc-panel]');
      var r = p.getBoundingClientRect();
      var i = p.querySelector('[data-acc-field]');
      var ir = i ? i.getBoundingClientRect() : null;
      var fb = [].map.call(p.querySelectorAll('.acc-form-btns button'), function(n){
        var b = n.getBoundingClientRect(); return { w: Math.round(b.width), t: n.textContent.trim() };
      });
      return {
        rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom) },
        input: ir ? { w: Math.round(ir.width), h: Math.round(ir.height), val: i.value, ph: i.placeholder } : null,
        focused: document.activeElement === i,
        formBtns: fb, overflowBottom: Math.round(r.bottom) > innerHeight
      };
    })()`);
    console.log('新增态: ' + JSON.stringify(geo2, null, 1));
    const clip2 = {
      x: Math.max(0, geo2.rect.l - 14), y: Math.max(0, geo2.rect.t - 30),
      width: Math.min(geo2.rect.w + 28, 1280 - Math.max(0, geo2.rect.l - 14)),
      height: geo2.rect.h + 44, scale: 2
    };
    const s2 = await cdp.send('Page.captureScreenshot', { format: 'png', clip: clip2, captureBeyondViewport: true });
    fs.writeFileSync(PREFIX + '_add.png', Buffer.from(s2.data, 'base64'));

    // 视口边缘：滚到底，开最后一台电脑的面板，检查是否被裁
    await cdp.evalJson('(function(){if(window.scrollTo)scrollTo(0,document.body.scrollHeight);var c=document.querySelectorAll("#board .col");if(c.length)c[c.length-1].scrollIntoView({block:"end"});return 1})()');
    await new Promise(r => setTimeout(r, 400));
    const geoC = await cdp.evalJson(`(function(){
      var all = document.querySelectorAll('[data-switch]');
      if(!all.length) return {err:'no pill'};
      var last = all[all.length-1];
      last.click();
      var p = document.querySelector('[data-acc-panel]');
      if(!p) return {err:'panel missing'};
      var r = p.getBoundingClientRect();
      return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width),
               b: Math.round(r.bottom), vh: innerHeight, vw: innerWidth,
               clipped: Math.round(r.bottom) > innerHeight + 1 || Math.round(r.right) > innerWidth + 1 };
    })()`);
    console.log('贴边: ' + JSON.stringify(geoC));
    if (!geoC.err) {
      const clip3 = {
        x: Math.max(0, geoC.l - 14), y: Math.max(0, geoC.t - 20),
        width: Math.min(geoC.w + 28, 1280 - Math.max(0, geoC.l - 14)),
        height: Math.min(geoC.b + 20 - Math.max(0, geoC.t - 20), 820 - Math.max(0, geoC.t - 20)),
        scale: 2
      };
      const s3 = await cdp.send('Page.captureScreenshot', { format: 'png', clip: clip3, captureBeyondViewport: true });
      fs.writeFileSync(PREFIX + '_edge.png', Buffer.from(s3.data, 'base64'));
    }

    // 压力态：库里预置了长账号名 + 多条，重载后看列表滚动与省略号
    await cdp.evalJson('(function(){if(window.scrollTo)scrollTo(0,0);return 1})()');
    await browser.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor('document.querySelectorAll("#board .col").length>0', 15000);
    await new Promise(r => setTimeout(r, 700));
    await cdp.evalJson(`(function(){
      var b = document.querySelector('[data-switch]');
      if(!b) return 0;
      b.click();
      var q = document.querySelector('[data-acc-panel]');
      if(!q) return 0;
      var l = q.querySelector('.acc-list');
      var nm = q.querySelector('.acc-row .nm');
      var r = q.getBoundingClientRect();
      return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
               rows: q.querySelectorAll('.acc-row').length,
               listScroll: l ? l.scrollHeight + '/' + l.clientHeight : '-',
               nmClipped: nm ? nm.scrollWidth > nm.clientWidth + 1 : null };
    })()`).then(v => console.log('压力态: ' + JSON.stringify(v))).catch(e => console.log('压力态失败: ' + e.message));
    await new Promise(r => setTimeout(r, 300));
    const geoP = await cdp.evalJson(`(function(){
      var q = document.querySelector('[data-acc-panel]');
      if(!q) return null;
      var r = q.getBoundingClientRect();
      var nm = q.querySelector('.acc-row .nm');
      return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
               nmClipped: nm ? nm.scrollWidth > nm.clientWidth + 1 : null };
    })()`);
    console.log('压力态几何: ' + JSON.stringify(geoP));
    if (geoP) {
      const clip4 = {
        x: Math.max(0, geoP.l - 14), y: Math.max(0, geoP.t - 30),
        width: Math.min(geoP.w + 28, 1280 - Math.max(0, geoP.l - 14)),
        height: geoP.h + 44, scale: 2
      };
      const s4 = await cdp.send('Page.captureScreenshot', { format: 'png', clip: clip4, captureBeyondViewport: true });
      fs.writeFileSync(PREFIX + '_long.png', Buffer.from(s4.data, 'base64'));
    }
    console.log('ok');
  } catch (e) {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
