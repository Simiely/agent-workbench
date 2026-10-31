// 打包版视觉验收：真实线上数据形态（3 台机、2 台有号、1 台空）
const { launch } = require('./cdp.cjs');
const fs = require('fs');

const PORT = parseInt(process.argv[2] || '8614', 10);
const OUT = process.argv[3] || 'C:/Temp/pack_board.png';

(async () => {
  const browser = await launch();
  const { cdp } = browser;
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    await browser.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor('document.querySelectorAll("#board .col").length>0', 15000);
    await new Promise(r => setTimeout(r, 900));

    const info = await cdp.evalJson(`(function(){
      var cols = [].map.call(document.querySelectorAll('#board .col'), function(c){
        var nm = (c.querySelector('.ch-name')||{}).textContent||'';
        var accs = [].map.call(c.querySelectorAll('.ch-acc .acc'), function(a){
          var an = a.querySelector('.an'), cn = a.querySelector('.cnt');
          return (an?an.textContent.trim():'') + (cn?'('+cn.textContent.trim()+')':'');
        });
        return { name: nm.trim(), accs: accs };
      });
      return { cols: cols, cards: document.querySelectorAll('#board .card').length };
    })()`);
    console.log('看板: ' + JSON.stringify(info));

    const s1 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT, Buffer.from(s1.data, 'base64'));

    // 空账号的机器：点开面板看空态
    const empty = await cdp.evalJson(`(function(){
      var cols = document.querySelectorAll('#board .col');
      for (var i=0;i<cols.length;i++){
        var a = cols[i].querySelector('.ch-acc .acc');
        if (a && a.classList.contains('empty')) { a.click(); return cols[i].getAttribute('data-machine') || i; }
      }
      return null;
    })()`);
    await new Promise(r => setTimeout(r, 500));
    const panel = await cdp.evalJson(`(function(){
      var p=document.querySelector('[data-acc-panel]'); if(!p) return null;
      var r=p.getBoundingClientRect();
      return { title:(p.querySelector('.mh')||{}).textContent||'', w:Math.round(r.width), h:Math.round(r.height),
               buttons:[].map.call(p.querySelectorAll('.acc-foot button'),function(b){return b.textContent.trim()}),
               text:(p.querySelector('.acc-empty')||{}).textContent||'' };
    })()`);
    console.log('空态面板(' + empty + '): ' + JSON.stringify(panel));
    if (panel) {
      const clip = { x: 0, y: Math.max(0, (await cdp.evalJson(`(function(){var r=document.querySelector('[data-acc-panel]').getBoundingClientRect();return Math.round(r.top)})()`)) - 40),
        width: 720, height: 420, scale: 2 };
      const s2 = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
      fs.writeFileSync(OUT.replace('.png', '_empty.png'), Buffer.from(s2.data, 'base64'));
    }
    console.log('ok');
  } catch (e) {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
