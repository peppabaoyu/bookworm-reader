'use strict';
/* 构建准备: 复制 pdfjs/jszip 资源 + 从 package.json 生成版本文件 */
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

// 版本文件
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(root, 'app', 'version.js'),
  "'use strict';\n/* 由 scripts/prepare.js 从 package.json 生成 */\nwindow.BW = window.BW || {};\nwindow.BW.APP_VERSION = '" + pkg.version + "';\n");
console.log('version.js →', pkg.version);

