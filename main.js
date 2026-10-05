'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, net, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');

const SMOKE = process.argv.includes('--smoke');
const SHOT = process.argv.includes('--shot');
const WEBTEST = process.argv.includes('--webtest');
const MODELTEST = process.argv.includes('--modeltest');
if (SMOKE || SHOT || WEBTEST || MODELTEST) {
  app.setPath('userData', path.join(os.tmpdir(), 'bookworm-smoke-' + Date.now()));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

let win = null;
let smokeConsoleErrors = [];

const userDataDir = () => app.getPath('userData');
const booksDir = () => path.join(userDataDir(), 'books');
const transDir = () => path.join(userDataDir(), 'translations');

function ensureDirs() {
  for (const d of [booksDir(), transDir()]) fs.mkdirSync(d, { recursive: true });
}

function safeUnder(base, target) {
  const b = path.resolve(base);
  const t = path.resolve(target);
  return t === b || t.startsWith(b + path.sep) ? t : null;
}

/* ---------------- window ---------------- */
function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(userDataDir(), 'window-state.json'), 'utf8'));
    if (s && s.width > 400 && s.height > 300) return s;
  } catch (e) {}
  return { width: 1280, height: 860, maximized: false };
}

function createWindow() {
  const st = loadWindowState();
  win = new BrowserWindow({
    width: st.width, height: st.height,
    x: st.x, y: st.y,
    minWidth: 920, minHeight: 600,
    show: false,
    backgroundColor: '#15151a',
    title: '书虫',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: WEBTEST ? undefined : path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });
  if (st.maximized) win.maximize();

  win.once('ready-to-show', () => {
    win.show();
    if (SHOT) runShot(win);
    if (WEBTEST) {
      try {
        const txt = fs.readFileSync(path.join(__dirname, 'assets', 'samples', 'sample-en.txt'));
        win.webContents.executeJavaScript('window.__WEBTEST_TXT = ' + JSON.stringify(txt.toString('base64')) + '; true;');
      } catch (e) {}
    }
  });
  const query = SMOKE ? { smoke: '1' } : (WEBTEST ? { webtest: '1' } : undefined);
  win.loadFile(path.join(__dirname, 'app', 'index.html'), query ? { query } : undefined);

  win.webContents.on('console-message', (...args) => {
    let level, message;
    if (typeof args[0] === 'object' && args[0] && 'message' in args[0]) { level = args[0].level; message = args[0].message; }
    else { level = args[1]; message = args[2]; }
    if ((SMOKE || WEBTEST) && level >= 2) smokeConsoleErrors.push(String(message).slice(0, 500));
    if (WEBTEST && message && String(message).startsWith('SMOKE_JSON:')) {
      const outArg = process.argv.find(a => a.startsWith('--smoke-out='));
      const line = String(message);
      if (outArg) { try { fs.writeFileSync(outArg.slice('--smoke-out='.length), line); } catch (e) {} }
      else console.log(line);
      const ok = /"ok":true/.test(line);
      setTimeout(() => app.exit(ok ? 0 : 1), 300);
    }
  });

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && (!app.isPackaged || SMOKE)) {
      win.webContents.toggleDevTools();
    }
  });

  win.on('close', () => {
    try {
      const b = win.getBounds();
      fs.writeFileSync(path.join(userDataDir(), 'window-state.json'),
        JSON.stringify({ ...b, maximized: win.isMaximized() }));
    } catch (e) {}
  });

  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  ensureDirs();
  if (MODELTEST) {
    const t0 = Date.now();
    const emit = (obj) => {
      const line = 'MODEL_JSON:' + JSON.stringify(obj);
      console.log(line);
      const outArg = process.argv.find(a => a.startsWith('--smoke-out='));
      if (outArg) { try { fs.writeFileSync(outArg.slice('--smoke-out='.length), line); } catch (e) {} }
    };
    getLocalTranslator()
      .then(tr => tr('The river ran below the road.', { max_new_tokens: 256 }))
      .then(r => { emit({ ok: true, ms: Date.now() - t0, zh: r[0] && r[0].translation_text }); app.exit(0); })
      .catch(e => { emit({ ok: false, error: String(e && e.message || e).slice(0, 300) }); app.exit(1); });
    return;
  }
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  // 后台探测 google 翻译可达性, 不通则直接禁用 10 分钟, 避免用户首次翻译时等待
  setTimeout(() => {
    if (googleOK()) {
      googleSingle('hello', 'zh-CN').catch(() => disableGoogle());
    }
  }, 2500);
  // 预热内置离线翻译模型, 开启中英对照时即秒出
  if (!SMOKE && !SHOT && !WEBTEST) {
    setTimeout(() => { getLocalTranslator().catch(() => {}); }, 12000);
  }
});

app.on('window-all-closed', () => { app.quit(); });

app.on('web-contents-created', (e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e2) => e2.preventDefault());
});

/* ---------------- import & file storage ---------------- */
const IMPORT_EXTS = ['.txt', '.epub', '.pdf', '.docx', '.mobi', '.azw', '.azw3', '.md', '.markdown', '.html', '.htm'];

ipcMain.handle('dialog:select-import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '导入书籍 / 文献',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '支持的文档', extensions: ['txt', 'epub', 'pdf', 'docx', 'mobi', 'azw', 'azw3', 'md', 'markdown', 'html', 'htm'] }]
  });
  if (r.canceled) return { canceled: true };
  return { canceled: false, paths: r.filePaths };
});

ipcMain.handle('fs:import-files', async (e, paths) => {
  ensureDirs();
  const out = [];
  for (const p of paths || []) {
    try {
      const ext = path.extname(p).toLowerCase();
      if (!IMPORT_EXTS.includes(ext)) continue;
      const id = 'bk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const dir = path.join(booksDir(), id);
      await fsp.mkdir(dir, { recursive: true });
      const safeName = path.basename(p).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || ('book' + ext);
      const dest = path.join(dir, 'source' + ext);
      await fsp.copyFile(p, dest);
      out.push({ id, absPath: dest, name: safeName, ext: ext.slice(1) });
    } catch (err) {
      out.push({ error: String(err && err.message || err), source: p });
    }
  }
  return out;
});

ipcMain.handle('fs:read-book-file', async (e, absPath) => {
  const t = safeUnder(booksDir(), absPath);
  if (!t) throw new Error('路径不在书库内');
  return new Uint8Array(await fsp.readFile(t));
});

ipcMain.handle('fs:read-book-data', async (e, id, name) => {
  const t = safeUnder(path.join(booksDir(), id), path.join(booksDir(), id, name));
  if (!t) throw new Error('非法路径');
  return await fsp.readFile(t, 'utf8');
});

ipcMain.handle('fs:write-book-data', async (e, id, name, content) => {
  const dir = path.join(booksDir(), id);
  const t = safeUnder(dir, path.join(dir, name));
  if (!t) throw new Error('非法路径');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(t, content, 'utf8');
  return true;
});

ipcMain.handle('fs:delete-book', async (e, id) => {
  const dir = safeUnder(booksDir(), path.join(booksDir(), id));
  if (!dir) throw new Error('非法路径');
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.rm(path.join(transDir(), id + '.json'), { force: true });
  return true;
});

ipcMain.handle('store:load', async (e, name) => {
  const t = safeUnder(userDataDir(), path.join(userDataDir(), name));
  if (!t || !/\.json$/.test(t)) throw new Error('非法路径');
  try { return JSON.parse(await fsp.readFile(t, 'utf8')); } catch (err) { return null; }
});

ipcMain.handle('store:save', async (e, name, value) => {
  const t = safeUnder(userDataDir(), path.join(userDataDir(), name));
  if (!t || !/\.json$/.test(t)) throw new Error('非法路径');
  await fsp.mkdir(path.dirname(t), { recursive: true });
  // 原子写: 先写临时文件再替换, 避免进程退出时写一半损坏数据
  const tmp = t + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(value), 'utf8');
  await fsp.rename(tmp, t);
  return true;
});

ipcMain.handle('trans:load', async (e, bookId) => {
  try {
    return JSON.parse(await fsp.readFile(path.join(transDir(), path.basename(bookId) + '.json'), 'utf8'));
  } catch (err) { return null; }
});

ipcMain.handle('trans:save', async (e, bookId, obj) => {
  await fsp.mkdir(transDir(), { recursive: true });
  const t = path.join(transDir(), path.basename(bookId) + '.json');
  const tmp = t + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(obj), 'utf8');
  await fsp.rename(tmp, t);
  return true;
});

/* ---------------- 内置离线翻译模型 (本地优先, 网络兜底) ---------------- */
const MODEL_DIR_NAME = 'opus-mt-en-zh';

function modelDir() {
  // 打包后 asarUnpack 到 app.asar.unpacked; 开发时在 app/models
  const dev = path.join(__dirname, 'app', 'models', MODEL_DIR_NAME);
  if (fs.existsSync(path.join(dev, 'config.json'))) return path.dirname(dev);
  const packed = path.join(__dirname, 'app.asar.unpacked', 'app', 'models', MODEL_DIR_NAME);
  if (fs.existsSync(path.join(packed, 'config.json'))) return path.dirname(packed);
  return null;
}

let localTranslator = null;
let localLoadState = 'idle';   // idle | loading | ready | failed
let localLoadPromise = null;

function getLocalTranslator() {
  if (localLoadState === 'ready') return Promise.resolve(localTranslator);
  if (localLoadState === 'failed') return Promise.reject(new Error('本地模型不可用'));
  if (!localLoadPromise) {
    localLoadState = 'loading';
    localLoadPromise = (async () => {
      const dir = modelDir();
      if (!dir) throw new Error('未找到内置翻译模型');
      // @xenova/transformers 是 ESM, Electron 33 的 Node 20 需用动态 import
      const mod = await import('@xenova/transformers');
      const pipeline = mod.pipeline || (mod.default && mod.default.pipeline);
      const env = mod.env || (mod.default && mod.default.env);
      env.allowLocalModels = true;
      env.allowRemoteModels = false;   // 完全离线
      env.localModelPath = dir;        // 模型根目录, 以名称引用 opus-mt-en-zh
      localTranslator = await pipeline('translation', MODEL_DIR_NAME, { quantized: true });
      localLoadState = 'ready';
      console.log('内置离线翻译模型已加载');
      return localTranslator;
    })().catch(err => {
      localLoadState = 'failed';
      console.error('本地翻译模型加载失败, 将使用网络翻译:', String(err && err.message || err).slice(0, 200));
      throw err;
    });
  }
  return localLoadPromise;
}

async function translateLocal(texts, to) {
  if (to !== 'zh-CN') throw new Error('本地模型仅支持英译中');
  const translator = await getLocalTranslator();
  const out = [];
  for (const t of texts) {
    const r = await translator(String(t || '').slice(0, 900), { max_new_tokens: 512 });
    out.push((r && r[0] && r[0].translation_text || '').trim());
  }
  return out;
}

/* ---------------- translation providers (网络兜底) ---------------- */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BookwormReader/1.0';
// 网络级失败后短暂禁用 google, 避免每句都等超时
let googleDisabledUntil = 0;
const googleOK = () => Date.now() > googleDisabledUntil;
const disableGoogle = () => { googleDisabledUntil = Date.now() + 10 * 60 * 1000; };

async function fetchText(url, opts = {}, timeout = 12000) {
  const res = await net.fetch(url, {
    method: opts.method || 'GET',
    headers: { 'User-Agent': UA, ...(opts.headers || {}) },
    body: opts.body,
    signal: AbortSignal.timeout(timeout)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res;
}

function googleSingleUrl(base, text, to) {
  return (base || 'https://translate.googleapis.com') +
    '/translate_a/single?client=gtx&sl=en&tl=' + to + '&dt=t&q=' + encodeURIComponent(text);
}

async function googleSingle(text, to, base) {
  const res = await fetchText(googleSingleUrl(base, text, to), {}, 7000);
  const data = await res.json();
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('google:bad');
  return data[0].map(s => (s && s[0]) || '').join('');
}

async function googleBatch(texts, to) {
  const body = new URLSearchParams();
  for (const t of texts) body.append('q', t);
  const res = await fetchText('https://translate.googleapis.com/translate_a/t?client=gtx&sl=en&tl=' + to, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  }, 8000);
  const data = await res.json();
  if (!Array.isArray(data) || data.length !== texts.length) throw new Error('google:batch-mismatch');
  return data.map(r => typeof r === 'string' ? r : (Array.isArray(r) ? (r[0] || '') : ''));
}

let mymemErrLogged = 0;
async function myMemoryOne(text, to) {
  try {
    const q = text.length > 480 ? text.slice(0, 480) : text;
    const res = await fetchText('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q) +
      '&langpair=en|' + (to === 'zh-CN' ? 'zh-CN' : to), {}, 9000);
    const data = await res.json();
    const t = data && data.responseData && data.responseData.translatedText;
    if (!t) throw new Error('mymemory:bad ' + JSON.stringify(data).slice(0, 160));
    return String(t).replace(/\s*MYMEMORY WARNING:.*$/i, '').trim();
  } catch (err) {
    if (mymemErrLogged < 4) { mymemErrLogged++; console.error('MYMEM_FAIL:', JSON.stringify(text.slice(0, 50)), String(err && err.message || err).slice(0, 180)); }
    throw err;
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch (err) { out[idx] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

ipcMain.handle('net:translate', async (e, texts, opts) => {
  const to = (opts && opts.to) || 'zh-CN';
  const customBase = (opts && opts.customBase) || '';
  const arr = (texts || []).map(t => String(t || ''));
  if (!arr.length) return { results: [], provider: 'none' };

  // 0) 内置离线模型 (断网兜底; 联网时网络通道通常更快, 故作后备)
  const localAvailable = modelDir() && localLoadState !== 'failed';
  if (opts && opts.forceLocal && localAvailable) {
    try {
      const r = await translateLocal(arr, to);
      if (r.every(x => x && x.trim())) return { results: r, provider: '内置离线模型' };
    } catch (err) { /* 落到网络 */ }
  }

  // 1) custom google-compatible endpoint
  const googleErr = (err) => {
    // 网络不通(非 HTTP 业务错误)时禁用 10 分钟
    const msg = String(err && err.message || err);
    if (/timeout|aborted|network|fetch failed|ECONN|ENOTFOUND|HTTP 5\d\d/i.test(msg)) disableGoogle();
  };
  if (customBase) {
    const r = await mapLimit(arr, 3, t => googleSingle(t, to, customBase.replace(/\/+$/, '')));
    if (r.every(x => x !== null)) return { results: r, provider: 'custom' };
  }
  // 2) google batch, then google single
  if (googleOK()) {
    try {
      if (arr.length > 1 && arr.every(t => t.length < 4000)) {
        const r = await googleBatch(arr, to);
        if (r.every(x => x && x.trim())) return { results: r, provider: 'google' };
      }
    } catch (err) { googleErr(err); }
    const r = await mapLimit(arr, 4, async t => {
      try { return await googleSingle(t, to); } catch (e1) { googleErr(e1); return null; }
    });
    if (r.every(x => x !== null && x.trim())) return { results: r, provider: 'google' };
  }
  // 3) mymemory 逐句 (温和限速, 该服务有速率限制)
  {
    const r = await mapLimit(arr, 3, async (t, i) => {
      if (i > 0 && i % 3 === 0) await new Promise(res => setTimeout(res, 350));
      return myMemoryOne(t, to);
    });
    const good = r.filter(x => x !== null && x.trim()).length;
    if (good >= Math.ceil(arr.length * 0.7)) {
      return { results: r.map(x => x || ''), provider: 'mymemory' };
    }
  }
  // 4) 内置离线模型兜底 (断网也可用, 速度约数秒/句)
  if (localAvailable) {
    try {
      const r = await translateLocal(arr, to);
      if (r.every(x => x && x.trim())) return { results: r, provider: '内置离线模型' };
    } catch (err) {}
  }
  throw new Error('所有翻译服务都失败了，请在设置中配置自定义翻译接口，或检查网络');
});

ipcMain.handle('net:dictionary', async (e, word) => {
  try {
    const res = await fetchText('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word), {}, 8000);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    const entry = data[0];
    const phonetic = (entry.phonetics || []).find(p => p.text) || {};
    const meanings = (entry.meanings || []).slice(0, 3).map(m => ({
      pos: m.partOfSpeech,
      def: (m.definitions || []).slice(0, 2).map(d => d.definition)
    }));
    return { word: entry.word, phonetic: phonetic.text || '', meanings };
  } catch (err) { return null; }
});

/* ---------------- misc ---------------- */
ipcMain.handle('shell:open-external', async (e, url) => {
  if (!/^https?:\/\//i.test(url)) throw new Error('仅允许 http/https 链接');
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('dialog:save-text', async (e, opts) => {
  const r = await dialog.showSaveDialog(win, {
    title: '导出笔记',
    defaultPath: (opts && opts.defaultName) || '笔记.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (r.canceled || !r.filePath) return null;
  await fsp.writeFile(r.filePath, opts.content, 'utf8');
  return r.filePath;
});

ipcMain.handle('app:version', () => app.getVersion());

/* 内置词典数据 (牛津式查词卡用) */
ipcMain.handle('app:read-data', (e, name) => {
  if (!/^[a-z0-9_-]+\.tsv$/i.test(name)) throw new Error('非法文件名');
  const candidates = [
    path.join(__dirname, 'app', 'data', name),
    path.join(__dirname, 'app.asar.unpacked', 'app', 'data', name)
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  return null;
});

/* ---------------- 自动检查更新 (GitHub Releases) ---------------- */
function updateRepo() {
  // 允许用 userData/update-repo.json 覆盖, 无需重新打包即可指向自己的仓库
  try {
    const c = JSON.parse(fs.readFileSync(path.join(userDataDir(), 'update-repo.json'), 'utf8'));
    if (c && typeof c.repo === 'string' && c.repo.includes('/')) return c.repo;
  } catch (err) {}
  return 'peppabaoyu/bookworm-reader';
}

function isNewerVersion(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

ipcMain.handle('updater:check', async () => {
  try {
    const res = await net.fetch('https://api.github.com/repos/' + updateRepo() + '/releases/latest', {
      headers: { 'User-Agent': UA, 'Accept': 'application/vnd.github+json' },
      signal: AbortSignal.timeout(9000)
    });
    if (!res.ok) return { status: res.status === 404 ? 'no-release' : 'error' };
    const data = await res.json();
    const latest = String(data.tag_name || '').replace(/^v/i, '');
    const current = app.getVersion();
    if (!latest) return { status: 'error' };
    if (isNewerVersion(latest, current)) {
      const assets = data.assets || [];
      const asset = assets.find(a => /书虫|bookworm|\.exe$/i.test(a.name)) || assets[0];
      return {
        status: 'update-available',
        latest, current,
        url: asset ? asset.browser_download_url : data.html_url,
        notes: String(data.body || '').slice(0, 600)
      };
    }
    return { status: 'up-to-date', current, latest };
  } catch (err) {
    return { status: 'error', error: String(err && err.message || err) };
  }
});

/* ---------------- screenshot 验证模式 ---------------- */
const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function runShot(win) {
  const shotsDir = path.join(__dirname, 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const snap = async (name) => {
    await delay(250);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shotsDir, name + '.png'), img.toPNG());
    console.log('SHOT saved', name);
  };
  const js = async (code) => {
    try {
      return await win.webContents.executeJavaScript(
        `(async () => { try { return await (${code}); } catch (e) { return 'JS_ERR: ' + (e && e.stack || e); } })()`, true);
    } catch (err) { return 'EXEC_ERR: ' + (err && err.message); }
  };
  js.log = (r) => { if (typeof r === 'string' && (r.startsWith('JS_ERR') || r.startsWith('EXEC_ERR'))) console.error(r); return r; };
  try {
    await delay(1000);
    await js(`window.addEventListener('unhandledrejection', e => console.error('UNHANDLED', e.reason && e.reason.stack || e.reason))`);
    await snap('01-library-empty');

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-shots-'));
    const txtPath = path.join(tmp, 'The Lantern on the Hill.txt');
    fs.copyFileSync(path.join(__dirname, 'assets', 'samples', 'sample-en.txt'), txtPath);
    const epubPath = path.join(tmp, 'The River Bank.epub');
    await buildSampleEpub(epubPath);
    const docxPath = path.join(tmp, 'Sample DOCX Reader.docx');
    await buildSampleDocx(docxPath);
    const mobiPath = path.join(tmp, 'Sample MOBI Book.mobi');
    await buildSampleMobi(mobiPath);
    const metas = await js(`window.BW.importFromPaths(${JSON.stringify([txtPath, epubPath, docxPath, mobiPath])}).then(m => m.map(b => ({ id: b.id, format: b.format })))`);
    await delay(600);
    await snap('02-library');

    const txt = metas.find(m => m.format === 'txt');
    const epub = metas.find(m => m.format === 'epub');

    console.log('openReader result:', await js(`window.BW.App.openReader(${JSON.stringify(txt.id)}), window.BW.Reader.book && window.BW.Reader.book.id`));
    await delay(900);
    await snap('03-reader-paged');

    // 制造一个高亮和一个波浪线, 便于检查样式
    await js(`(async () => {
      const R = window.BW.Reader, A = window.BW.Annotate;
      const text = R.getFullText();
      const g1 = text.indexOf('river'), g2 = g1 + 9;
      A.sel = { g1, g2, text: text.slice(g1, g2), rect: { left: 400, top: 300, width: 120, height: 20 }, plain: text.slice(g1, g2) };
      await A.quickAdd('#f7dc6f', 'hl');
      const g3 = text.indexOf('milestone'), g4 = g3 + 14;
      A.sel = { g1: g3, g2: g4, text: text.slice(g3, g4), rect: { left: 400, top: 300 }, plain: '' };
      await A.quickAdd('#7cb342', 'wavy');
    })()`);
    await delay(300);
    await snap('04-highlight');

    await js(`window.BW.Notes.open()`);
    await delay(350);
    await snap('05-notes-panel');
    await js(`window.BW.Notes.closePanel()`);

    await js(`(async () => { window.BW.Search.open(); document.querySelector('#sp-input').value = 'the'; window.BW.Search.run('the'); })()`);
    await delay(400);
    await snap('06-search');
    await js(`window.BW.Search.close()`);

    // 中英对照 (翻译依赖网络, 失败也不影响截图)
    await js(`window.BW.Bilingual.toggle()`);
    await delay(26000);
    await snap('07-bilingual');
    await js(`window.BW.Bilingual.toggle()`);
    await delay(600);

    await js(`window.BW.Toc.open()`);
    await delay(300);
    await snap('08-toc');
    await js(`window.BW.Toc.close()`);

    // 打开 EPUB 看排版
    await js(`window.BW.App.openReader(${JSON.stringify(epub.id)})`);
    await delay(900);
    await snap('09-epub');

    await js(`window.BW.Settings.open()`);
    await delay(350);
    await snap('10-settings');

    await js(`window.BW.closeModal(); window.BW.Reader.close()`);
    await delay(400);
    await js(`window.BW.TTS.showBar()`);
    await delay(250);
    await snap('11-library-final-ttsbar');

    console.log('SHOT_DONE');
    setTimeout(() => app.exit(0), 400);
  } catch (err) {
    console.error('SHOT_FAIL', err);
    setTimeout(() => app.exit(1), 400);
  }
}

/* ---------------- smoke test ---------------- */
ipcMain.handle('smoke:samples', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-samples-'));
  const txtPath = path.join(tmp, 'sample-en.txt');
  fs.copyFileSync(path.join(__dirname, 'assets', 'samples', 'sample-en.txt'), txtPath);
  const epubPath = path.join(tmp, 'sample.epub');
  await buildSampleEpub(epubPath);
  const pdfPath = path.join(tmp, 'sample.pdf');
  await buildSamplePdf(pdfPath);
  const docxPath = path.join(tmp, 'sample.docx');
  await buildSampleDocx(docxPath);
  const mobiPath = path.join(tmp, 'sample.mobi');
  await buildSampleMobi(mobiPath);
  return { txtPath, epubPath, pdfPath, docxPath, mobiPath };
});

ipcMain.handle('smoke:result', (e, result) => {
  result.consoleErrors = smokeConsoleErrors.slice(0, 20);
  const line = 'SMOKE_JSON:' + JSON.stringify(result);
  console.log(line);
  try {
    const outArg = process.argv.find(a => a.startsWith('--smoke-out='));
    if (outArg) fs.writeFileSync(outArg.slice('--smoke-out='.length), line);
  } catch (err) {}
  setTimeout(() => app.exit(result.ok ? 0 : 1), 300);
  return true;
});

async function buildSampleEpub(dest) {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const chapters = [
    ['The River Bank', '<p>The mole had been working all morning, sweeping his little house and the dust of spring hung in the bright air.</p><p>"This is fine," he said to himself, and he scrambled up the warm slope towards the sunlight. Suddenly a shadow crossed his path, and the Mole looked up to see the River for the very first time.</p><p>Never in his life had he seen a river so shiny and so chattering and so full of jokes. It giggled and glucked and swirlled along, and the Mole followed it without knowing why.</p>'],
    ['The Open Road', '<p>"Ratty," said the Mole, "please, I want to row, I want to learn!" The Rat smiled and handed over the sculls, and the little boat wobbled away from the bank.</p><p>Beyond the hedge the world was wide and golden. The wind talked in the reeds and far away a road ran towards a horizon that promised everything.</p>'],
    ['Dulce Domum', '<p>One day the Mole smelled the air of his old home, and tears came into his eyes. The Rat turned the boat at once, and they found the little door under the blackbat shadow of the root.</p><p>The Mice sang carols, and the Mole understood that a home is not a house but a warm place in the heart.</p>']
  ];
  zip.file('OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Sample English Reader</dc:title><dc:creator>K. Test</dc:creator>
<dc:language>en</dc:language><dc:identifier id="uid">urn:uuid:sample-bookworm-0001</dc:identifier>
<meta name="cover" content="cover-img"/></metadata>
<manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="cover-img" href="cover.jpg" media-type="image/jpeg"/>
${chapters.map((c, i) => `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine toc="ncx">${chapters.map((c, i) => `<itemref idref="ch${i + 1}"/>`).join('\n')}</spine></package>`);
  zip.file('OEBPS/toc.ncx',
    `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head/><docTitle><text>Sample English Reader</text></docTitle><navMap>
${chapters.map((c, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${c[0]}</text></navLabel><content src="ch${i + 1}.xhtml"/></navPoint>`).join('\n')}
</navMap></ncx>`);
  for (let i = 0; i < chapters.length; i++) {
    zip.file(`OEBPS/ch${i + 1}.xhtml`,
      `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${chapters[i][0]}</title></head><body><h1>${chapters[i][0]}</h1>${chapters[i][1]}</body></html>`);
  }
  // 1x1 jpeg (valid jpeg header) as cover
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
  zip.file('OEBPS/cover.jpg', jpeg);
  await fs.promises.writeFile(dest, await zip.generateAsync({ type: 'nodebuffer' }));
}

async function buildSampleDocx(dest) {
  const JSZip = require('jszip');
  const zip = new JSZip();
  const para = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  zip.file('word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${para('Sample DOCX Reader')}
${para('by Z. Writer')}
${para('Chapter One: The Paper Windmill')}
${para('The laboratory was quiet except for the hum of instruments, and in that hum the student heard a kind of music that no concert hall could imitate. Every dial and every wire promised a question worth asking.')}
${para('She folded a paper windmill from the margin of her notes and pinned it above the desk, where the draft from the vent made it spin all afternoon, patient and bright.')}
${para('Chapter Two: The Quiet Result')}
${para('On the third day the numbers settled into a pattern that nobody had predicted, and the pattern was beautiful, and the beauty was evidence.')}
</w:body></w:document>`);
  zip.file('docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Sample DOCX Reader</dc:title><dc:creator>Z. Writer</dc:creator></cp:coreProperties>`);
  zip.file('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  await fs.promises.writeFile(dest, await zip.generateAsync({ type: 'nodebuffer' }));
}

function buildSampleMobi(dest) {
  // 无压缩(compression=1)的极简 MOBI: PDB 头 + MOBI 头 + 文本记录
  const text = [
    'Chapter One: The Glass Harbor',
    '',
    'The tide brought in light instead of water that year, and the whole town learned to read by the reflections it left on the pier.',
    'Mira counted the lamps that drifted past her window each night, and by the fortieth night she had begun to understand their grammar.',
    'Chapter Two: The Keeper of Numbers',
    '',
    'Her grandfather had kept a ledger of every lamp the harbor had ever swallowed, and on her twelfth birthday he handed her the pen.',
    'A ledger is a promise made to the future, he said, and promises are the only lamps that never go out.'
  ].join('\n\n');
  const textBytes = Buffer.from(text, 'utf8');
  const textChunks = [];
  const CHUNK = 4096;
  for (let i = 0; i < textBytes.length; i += CHUNK) textChunks.push(textBytes.slice(i, i + CHUNK));
  const numRecords = 1 + textChunks.length;

  // MOBI 记录0: PalmDOC头(16) + MOBI头(232) + 全名
  const nameStr = Buffer.from('Sample MOBI Book', 'utf8');
  const r0 = Buffer.alloc(16 + 232 + nameStr.length + 2);
  r0.writeUInt16BE(1, 0);                    // compression = 1 (无压缩)
  r0.writeUInt32BE(textBytes.length, 4);     // textLength
  r0.writeUInt16BE(textChunks.length, 8);    // recordCount
  r0.writeUInt16BE(4096, 10);                // recordSize
  r0.writeUInt16BE(0, 12);                   // encryption = 0
  r0.write('MOBI', 16, 'latin1');            // magic
  r0.writeUInt32BE(232, 20);                 // headerLength
  r0.writeUInt32BE(2, 24);                   // mobiType = 2 (book)
  r0.writeUInt32BE(65001, 28);               // textEncoding = utf-8
  r0.writeUInt32BE(1, 32);                   // unique-ID
  r0.writeUInt32BE(0, 84);                   // fullNameOffset 占位, 下面填
  r0.writeUInt32BE(nameStr.length, 88);
  r0.writeUInt32BE(0, 128);                  // exthFlags: 无 EXTH
  r0.writeUInt16BE(0, 16 + 232 - 2);         // extraDataFlags = 0
  const nameOff = 16 + 232;
  nameStr.copy(r0, nameOff);
  r0.writeUInt32BE(nameOff, 84);
  r0.writeUInt16BE(0, r0.length - 2);

  // PDB 头
  const pdb = Buffer.alloc(78 + numRecords * 8);
  Buffer.from('SampleMOBI', 'utf8').copy(pdb, 0, 0, Math.min(31, 'SampleMOBI'.length));
  pdb.write('BOOK', 60, 'latin1');
  pdb.write('MOBI', 64, 'latin1');
  pdb.writeUInt32BE(Date.now() / 1000 | 0, 36);
  pdb.writeUInt32BE(0, 72);              // nextRecordListID
  pdb.writeUInt16BE(numRecords, 76);     // numRecords @76
  let offset = pdb.length;
  const offsets = [offset];
  offset += r0.length;
  for (const c of textChunks) { offsets.push(offset); offset += c.length; }
  for (let i = 0; i < numRecords; i++) {
    pdb.writeUInt32BE(offsets[i], 78 + i * 8);
    pdb.writeUInt8(0, 82 + i * 8);
    pdb.writeUInt16BE(i & 0xffff, 83 + i * 8 + 1);
  }
  const out = Buffer.concat([pdb, r0, ...textChunks]);
  fs.writeFileSync(dest, out);
}

function buildSamplePdf(dest) {
  const lines = ['The Bookworm PDF Sample', '', 'This little document exists only to be parsed.', 'Reading software should stay quiet and fast.'];
  let content = 'BT /F1 14 Tf 72 720 Td 14 TL\n';
  for (const l of lines) content += `(${l.replace(/([()\\])/g, '\\$1')}) Tj T*\n`;
  content += 'ET';
  const objs = [];
  objs[1] = '<</Type/Catalog/Pages 2 0 R>>';
  objs[2] = '<</Type/Pages/Kids[3 0 R]/Count 1>>';
  objs[3] = '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>';
  objs[4] = `<</Length ${content.length}>>\nstream\n${content}\nendstream`;
  objs[5] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>';
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`;
  fs.writeFileSync(dest, pdf, 'latin1');
}
