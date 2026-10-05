'use strict';
/* 从用户提供的图片生成圆角应用图标 (多尺寸 PNG + 多条目 ICO)
   用法: npx electron scripts/icon-from-image.js [图片路径] */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

app.whenReady().then(async () => {
  try {
    const root = path.join(__dirname, '..');
    const src = process.argv[2] || path.join(root, 'assets', 'avatar-src.jpg');
    const b64 = fs.readFileSync(src).toString('base64');
    const mime = src.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await win.loadFile(path.join(__dirname, 'icon-page.html'));
    const out = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image();
      img.src = 'data:${mime};base64,${b64}';
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('图片解码失败')); });
      const sizes = [256, 128, 96, 64, 48, 32, 16];
      const result = {};
      for (const S of sizes) {
        const cv = document.createElement('canvas');
        cv.width = S; cv.height = S;
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, S, S);
        const r = Math.round(S * 0.22);          // 圆角半径 22%
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.arcTo(S, 0, S, S, r);
        ctx.arcTo(S, S, 0, S, r);
        ctx.arcTo(0, S, 0, 0, r);
        ctx.arcTo(0, 0, S, 0, r);
        ctx.closePath();
        ctx.clip();
        const iw = img.naturalWidth, ih = img.naturalHeight;
        const scale = Math.max(S / iw, S / ih);  // cover 裁剪
        ctx.drawImage(img, (S - iw * scale) / 2, (S - ih * scale) / 2, iw * scale, ih * scale);
        result[S] = cv.toDataURL('image/png');
      }
      return result;
    })()`, true);

    const pngOf = (size) => Buffer.from(out[String(size)].split(',')[1], 'base64');
    fs.writeFileSync(path.join(root, 'assets', 'icon.png'), pngOf(256));

    /* 多条目 ICO */
    const sizes = [256, 128, 96, 64, 48, 32, 16];
    const pngs = sizes.map(pngOf);
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
    const entries = [];
    let offset = 6 + sizes.length * 16;
    for (let i = 0; i < sizes.length; i++) {
      const S = sizes[i];
      const e = Buffer.alloc(16);
      e[0] = S === 256 ? 0 : S;
      e[1] = S === 256 ? 0 : S;
      e.writeUInt16LE(1, 4);
      e.writeUInt16LE(32, 6);
      e.writeUInt32LE(pngs[i].length, 8);
      e.writeUInt32LE(offset, 12);
      entries.push(e);
      offset += pngs[i].length;
    }
    const ico = Buffer.concat([header, ...entries, ...pngs]);
    fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), ico);

    console.log('ICON_JSON:' + JSON.stringify({ ok: true, png: pngOf(256).length, ico: ico.length }));
  } catch (err) {
    console.log('ICON_JSON:' + JSON.stringify({ ok: false, error: String(err && err.message || err) }));
  } finally {
    setTimeout(() => app.exit(0), 100);
  }
});
