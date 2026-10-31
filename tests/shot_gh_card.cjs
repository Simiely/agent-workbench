// 复现「版本号撑破卡片」：灌一条多版本记录，检查记录行有没有溢出、截图取证
const { launch } = require('./cdp.cjs');
const http = require('http');
const fs = require('fs');
const PORT = process.argv[2] || '8626';
const OUT = process.argv[3] || 'C:/Temp/gh-card.png';

function post(p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
      let s = ''; res.on('data', d => s += d); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

(async () => {
  // 三个版本号挤在一行 —— 正是用户截图里的情况
  await post('/api/records', { db: 'github', properties: {
    '同步时间': { date: '2026-10-30T01:30:00Z' },
    '电脑': { text: '4070TiSuper' },
    'GitHub账号': { text: 'Simiely' },
    '仓库': { text: 'Simiely/local-llm-playbook' },
    '内容': { text: '多版本挤一行的溢出复现' },
    '同步版本': { text: 'v0.34.0, v0.35.0, v0.36.0' },
    '是否同步': { select: '已同步' },
    '仓库归档': { checkbox: false }
  } }).catch(e => console.log('写入失败(可能有同仓库记录):', e.message));

  const b = await launch();
  const { cdp } = b;
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1024, deviceScaleFactor: 2, mobile: false });
    await b.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor('document.querySelectorAll("#ghList .repo-card").length>0', 12000);
    await new Promise(r => setTimeout(r, 900));

    const m = await cdp.evalJson(`(function(){
      var cards = document.querySelectorAll('#ghList .repo-card');
      var out = [], target = null;
      for (var c = 0; c < cards.length; c++) {
        var card = cards[c];
        var ents = card.querySelectorAll('.repo-entry');
        for (var i = 0; i < ents.length; i++) {
          var e = ents[i];
          var ver = e.querySelector('.re-ver'), res = e.querySelector('.re-res');
          var vr = ver.getBoundingClientRect();
          var rr = res ? res.getBoundingClientRect() : null;
          var row = {
            repo: (card.querySelector('.repo-name') || {}).textContent || '',
            ver: ver.textContent.trim(),
            verClipped: ver.scrollWidth > ver.clientWidth + 1,
            hasTitle: !!ver.getAttribute('title') && ver.getAttribute('title').length > 0,
            overlapRes: rr ? vr.right > rr.left + 1 : false,
            entryOverflow: e.scrollWidth > e.clientWidth + 1,
            entryW: Math.round(e.getBoundingClientRect().width)
          };
          out.push(row);
          if (row.ver.indexOf('v0.34') >= 0) target = card;
        }
      }
      return { rows: out, targetName: target ? (target.querySelector('.repo-name') || {}).textContent : null };
    })()`);
    m.rows.filter(r => r.ver.indexOf('v0.34') >= 0 || r.verClipped || r.overlapRes || r.entryOverflow)
      .forEach(r => console.log('  [' + r.repo + '] 版本「' + r.ver + '」截断=' + r.verClipped +
        ' 有title=' + r.hasTitle + ' 压到状态标签=' + r.overlapRes + ' 整行溢出=' + r.entryOverflow + ' 行宽=' + r.entryW));
    console.log('  目标卡: ' + m.targetName + '（多版本那条）');

    const box = await cdp.evalJson(`(function(){
      var card = null;
      var cards = document.querySelectorAll('#ghList .repo-card');
      for (var i = 0; i < cards.length; i++) {
        if (cards[i].querySelector('.repo-name') && cards[i].querySelector('.repo-name').textContent.indexOf('local-llm-playbook') >= 0) { card = cards[i]; break; }
      }
      if (!card) card = document.querySelector('#ghList .repo-card');
      var r = card.getBoundingClientRect();
      return { x: Math.max(0, Math.round(r.x) - 6), y: Math.max(0, Math.round(r.y) - 6),
        width: Math.min(Math.round(r.width) + 12, 1366 - Math.max(0, Math.round(r.x) - 6)),
        height: Math.min(Math.round(r.height) + 12, 1024), scale: 2 };
    })()`);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: box });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    console.log('截图: ' + OUT);
  } catch (e) {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    await b.close();
  }
})();
