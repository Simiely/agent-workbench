// GitHub 看板布局实拍：截取 GitHub 栏 + 报告新容器状态
const { launch } = require('./cdp.cjs');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.argv[2] || '8194', 10);
const OUT = process.argv[3] || 'C:/Temp/awb-gh.png';

(async () => {
  let browser = null;
  try {
    browser = await launch();
    const { cdp } = browser;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 900, deviceScaleFactor: 1, mobile: false
    });
    await browser.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor(
      '(function(){return document.querySelectorAll("#ghList .repo-card").length>0})()', 15000);
    await new Promise(r => setTimeout(r, 900));

    const info = await cdp.evalJson(
      '(function(){' +
      'var f=document.querySelector("#ghF_machine"),k=document.querySelector("#ghKpis");' +
      'var l=document.querySelector("#ghIntensity .gi-list");' +
      'return {' +
      ' ghKpiCount: document.querySelectorAll("#ghKpis .kpi").length,' +
      ' ghKpiText: Array.prototype.map.call(document.querySelectorAll("#ghKpis .kpi"),function(x){return x.textContent.trim()}),' +
      ' kpiRightOfSelect: (f&&k)?(k.getBoundingClientRect().left>=f.getBoundingClientRect().right-1):null,' +
      ' ghIntensityRows: document.querySelectorAll("#ghIntensity .gi-row").length,' +
      ' giListClientH: l?l.clientHeight:null,' +
      ' giListScrollH: l?l.scrollHeight:null,' +
      ' giVisibleRows: l?Math.round(l.clientHeight/21):null,' +
      ' giFirstRows: Array.prototype.slice.call(document.querySelectorAll("#ghIntensity .gi-row"),0,6).map(function(r){return r.textContent.trim()}),' +
      ' overflow: (function(){var bad=[];["viewBoard","viewGithub"].forEach(function(id){var p=document.getElementById(id);' +
      '  if(p.scrollWidth>p.clientWidth+1)bad.push(id+"横向溢出");});' +
      '  if(document.body.scrollWidth>window.innerWidth+1)bad.push("body溢出");return bad;})()' +
      '}})()');
    console.log(JSON.stringify(info, null, 1));

    // 只截 GitHub 栏
    const box = await cdp.evalJson(
      '(function(){var r=document.getElementById("viewGithub").getBoundingClientRect();' +
      'return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})()');
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: box.x, y: box.y, width: box.w, height: Math.min(box.h, 620), scale: 1 }
    });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    console.log('截图已保存: ' + OUT);
  } catch (e) {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
