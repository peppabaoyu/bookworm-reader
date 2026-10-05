'use strict';
/* 构建准备: 把 pdfjs 的 UMD 构建复制到 app/js/pdfjs (便于 asarUnpack) */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build');
const destDir = path.join(root, 'app', 'js', 'pdfjs');

fs.mkdirSync(destDir, { recursive: true });
for (const f of ['pdf.min.js', 'pdf.worker.min.js']) {
  fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
  console.log('copied', f);
}
// jszip 也复制一份, 避免 index.html 直接引用 node_modules 在打包后路径混乱
const jszipSrc = path.join(root, 'node_modules', 'jszip', 'dist', 'jszip.min.js');
fs.copyFileSync(jszipSrc, path.join(destDir, 'jszip.min.js'));
console.log('copied jszip.min.js');
