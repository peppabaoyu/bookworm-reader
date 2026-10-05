'use strict';
/* 书虫 - 程序化生成书籍封面 */
(function () {
  const PALETTES = [
    ['#8a5a3b', '#3d2a1e'], ['#3f5e78', '#1d2b38'], ['#5a7a4a', '#26331f'],
    ['#7a5a8a', '#2e2138'], ['#8a6a3b', '#382b1d'], ['#4a7a72', '#1f3330'],
    ['#8a4a4a', '#331d1d'], ['#4a5a8a', '#1f2438']
  ];

  function hashCode(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function wrapText(ctx, text, maxW) {
    const lines = [];
    let line = '';
    for (const ch of text) {
      if (ctx.measureText(line + ch).width > maxW && line) {
        lines.push(line); line = ch;
        if (lines.length >= 4) break;
      } else line += ch;
    }
    if (line && lines.length < 4) lines.push(line);
    if (lines.length === 4 && lines.join('').length < text.length) lines[3] = lines[3].replace(/.{0,2}$/, '…');
    return lines;
  }

  function genCover(title, author, fmt) {
    const W = 300, H = 420;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const [c1, c2] = PALETTES[hashCode(title || 'x') % PALETTES.length];

    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 纹理弧线
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(W * 0.85, H * 0.18, 40 + i * 26, Math.PI * 0.9, Math.PI * 1.9);
      ctx.stroke();
    }
    // 书脊
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, 0, 14, H);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(14, 0, 2, H);

    // 边框
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(26, 26, W - 40, H - 52);

    // 书名
    ctx.fillStyle = '#f5efe2';
    ctx.textAlign = 'center';
    ctx.font = '700 24px Georgia, "KaiTi", serif';
    const lines = wrapText(ctx, (title || '未命名').trim(), W - 80);
    let ty = H / 2 - (lines.length - 1) * 17 - 24;
    for (const ln of lines) { ctx.fillText(ln, W / 2 + 5, ty); ty += 34; }

    // 作者
    ctx.font = '400 14px Georgia, "KaiTi", serif';
    ctx.fillStyle = 'rgba(245,239,226,0.8)';
    if (author) ctx.fillText(author.slice(0, 18), W / 2 + 5, ty + 16);

    // 格式徽标
    ctx.font = '600 11px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    const bw = ctx.measureText(fmt.toUpperCase()).width + 14;
    ctx.fillRect(W - bw - 18, 16, bw, 20);
    ctx.fillStyle = '#f5efe2';
    ctx.fillText(fmt.toUpperCase(), W - 18 - bw / 2, 30);

    // 书虫标记
    ctx.strokeStyle = '#d4a24e';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(W / 2, H - 52, 10, Math.PI * 0.2, Math.PI * 1.6);
    ctx.stroke();
    ctx.fillStyle = '#d4a24e';
    ctx.beginPath(); ctx.arc(W / 2 + 10, H - 52, 3.4, 0, Math.PI * 2); ctx.fill();

    return cv.toDataURL('image/jpeg', 0.86);
  }

  window.BW.Covers = { genCover };
})();
