'use strict';
/* 从 ECDICT sqlite 构建 内置精简词典 (dict.tsv) + Moby 同义词库 (thesaurus.tsv)
   产物: app/data/dict.tsv, app/data/thesaurus.tsv (不入 git, 打包时内置) */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'app', 'data');
fs.mkdirSync(outDir, { recursive: true });

const CAP = parseInt(process.env.DICT_CAP || '140000', 10);

/* ---------- 1. ECDICT → dict.tsv ---------- */
const dbPath = path.join(__dirname, '..', '.android-tools', 'stardict.db');
if (!fs.existsSync(dbPath)) { console.error('未找到', dbPath); process.exit(1); }
const db = new DatabaseSync(dbPath);

const clean = (s) => String(s || '')
  .replace(/[\r\n]+/g, '⏎')
  .replace(/\t/g, ' ')
  .trim();

// 词频优先: frq(当代语料库词频排名, 小=常用) + bnc + oxford 标记
const rows = db.prepare(`
  SELECT word, phonetic, definition, translation, exchange, pos, frq, bnc, oxford
  FROM stardict
  WHERE (frq > 0 OR bnc > 0 OR oxford = 1)
  ORDER BY CASE WHEN frq > 0 THEN frq ELSE 100000 + bnc END ASC
  LIMIT ${CAP}
`).all();
console.log('ECDICT 选中词条:', rows.length);

const tsv = [];
for (const r of rows) {
  const word = clean(r.word).toLowerCase();
  if (!word || /\s/.test(word)) continue;          // 跳过短语词条, 保持单词查询精准
  const zh = clean(r.translation).slice(0, 400);
  const en = clean(r.definition).slice(0, 300);
  if (!zh && !en) continue;
  const p = clean(r.phonetic).slice(0, 40);
  const ex = clean(r.exchange).slice(0, 80);
  const pos = clean(r.pos).slice(0, 30);
  const frq = r.frq || 0;
  tsv.push([word, p, zh, en, ex, pos, String(frq)].join('\t'));
}
fs.writeFileSync(path.join(outDir, 'dict.tsv'), tsv.join('\n'), 'utf8');
console.log('dict.tsv:', tsv.length, '条,', Math.round(fs.statSync(path.join(outDir, 'dict.tsv')).size / 1048576) + 'MB');

/* ---------- 2. Moby → thesaurus.tsv ---------- */
const mobyPath = path.join(__dirname, '..', '.android-tools', 'moby-master', 'words.txt');
if (fs.existsSync(mobyPath)) {
  const lines = fs.readFileSync(mobyPath, 'utf8').split('\n');
  const out = [];
  for (const ln of lines) {
    const parts = ln.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (parts.length < 2) continue;
    const head = parts[0];
    const syns = parts.slice(1, 15).join('|');       // 每词最多 14 个同义词
    out.push(head + '\t' + syns);
  }
  fs.writeFileSync(path.join(outDir, 'thesaurus.tsv'), out.join('\n'), 'utf8');
  console.log('thesaurus.tsv:', out.length, '条,', Math.round(fs.statSync(path.join(outDir, 'thesaurus.tsv')).size / 1048576) + 'MB');
} else {
  console.log('跳过 Moby (文件不存在)');
}

/* ---------- 3. 清理临时大文件 ---------- */
try {
  fs.rmSync(path.join(__dirname, '..', '.android-tools', 'stardict.db'), { force: true });
  fs.rmSync(path.join(__dirname, '..', '.android-tools', 'ecdict-sqlite.zip'), { force: true });
  console.log('临时大文件已清理');
} catch (e) {}
