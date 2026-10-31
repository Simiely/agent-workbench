// UI v2 原型截图 + 几何自检：在目标分辨率下确认没有横向溢出、tbar 不遮挡首屏内容
const { launch } = require('./cdp.cjs');
const path = require('path');
const fs = require('fs');
const url = require('url');

const W = parseInt(process.argv[2] || '1366', 10);
const H = parseInt(process.argv[3] || '1024', 10);
const OUT = process.argv[4] || ('C:/Temp/uiv2-' + W + 'x' + H + '.png');
const VIEW = process.argv[5] || 'board';
const QS = process.argv[6] || 'clean';
const FILE = url.pathToFileURL(path.join(path.dirname(__dirname), 'design', 'ui-v2.html')).href + (QS ? '?' + QS : '');

(async () => {
  const browser = await launch();
  const { cdp } = browser;
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
    await browser.goto(FILE);
    await cdp.waitFor('!!document.querySelector("#board .col")', 8000);
    await new Promise(r => setTimeout(r, 500));

    if (VIEW !== 'board') {
      await cdp.evalJson(`(function(){var b=document.querySelector('.seg button[data-view="${VIEW}"]');if(b)b.click();return 1})()`);
      await new Promise(r => setTimeout(r, 550));
    }

    const geo = await cdp.evalJson(`(function(){
      var app=document.querySelector('.app'), tb=document.querySelector('.tbar'), sc=document.querySelector('.scroll');
      var first=document.querySelector('.view.on .view-h')||document.querySelector('.view.on .board');
      var fr=first.getBoundingClientRect(), tr=tb.getBoundingClientRect();
      return {
        vw: innerWidth, vh: innerHeight,
        docScrollW: document.documentElement.scrollWidth,
        appW: Math.round(app.getBoundingClientRect().width),
        tbarH: Math.round(tr.height),
        firstTop: Math.round(fr.top),
        gapUnderTbar: Math.round(fr.top - tr.bottom),
        boardScrollW: (function(){var b=document.querySelector('.board');return b?b.scrollWidth+'/'+b.clientWidth:'-'})(),
        cols: document.querySelectorAll('.board .col').length,
        colW: (function(){var c=document.querySelector('.board .col');return c?Math.round(c.getBoundingClientRect().width):0})(),
        segW: Math.round(document.querySelector('.seg').getBoundingClientRect().width),
        segOverflow: (function(){var s=document.querySelector('.seg');return s.scrollWidth>s.clientWidth+1})(),
        hOverflow: document.documentElement.scrollWidth > innerWidth + 1
      };
    })()`);
    console.log('几何 ' + W + 'x' + H + ' [' + VIEW + ']: ' + JSON.stringify(geo));

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    console.log('截图: ' + OUT);
  } catch (e) {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
