// 实拍：居中弹窗 + 导航栈返回箭头
const { launch } = require('./cdp.cjs');
const path = require('path'); const fs = require('fs');
const PORT = parseInt(process.argv[2] || '8193', 10);
const DIR = path.join(path.dirname(__dirname), 'design');
(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  let browser = null;
  try {
    browser = await launch();
    const { cdp } = browser;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor('(function(){return document.querySelectorAll("#ghList .repo-card").length>0})()', 15000);
    await new Promise(r => setTimeout(r, 900));
    const ev = e => cdp.evalJson(e); const wait = ms => new Promise(r => setTimeout(r, ms));
    const shot = async n => { const s = await cdp.send('Page.captureScreenshot',{format:'png'});
      const p = path.join(DIR, n); fs.writeFileSync(p, Buffer.from(s.data,'base64')); console.log('已保存 '+p); };

    // 仓库详情（顶层，无返回箭头）
    await ev('(function(){document.querySelector("#ghList .repo-card").click();return 1})()');
    await wait(700);
    await shot('sheet-repo-detail.png');

    // 钻取到记录编辑（显示返回箭头）
    await ev('(function(){document.querySelector("#drawerBody .rd-row").click();return 1})()');
    await wait(700);
    await shot('sheet-gh-form-back.png');

    // 返回
    await ev('(function(){document.getElementById("drawerBack").click();return 1})()');
    await wait(700);
    await shot('sheet-repo-detail.png');

    // 任务详情 → 编辑（返回箭头）
    await ev('(function(){document.getElementById("closeDrawer").click();return 1})()'); await wait(500);
    await ev('(function(){document.querySelector("#board .card").click();return 1})()'); await wait(700);
    await shot('sheet-task-detail.png');
    await ev('(function(){document.getElementById("editBtn").click();return 1})()'); await wait(700);
    await shot('sheet-task-form-back.png');
  } catch (e) { console.error('失败: '+e.message); process.exitCode = 1; }
  finally { if (browser) await browser.close(); }
})();
