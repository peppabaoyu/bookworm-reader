'use strict';
/* 书虫 - 平台适配层: 在安卓 WebView / 普通浏览器中提供 window.bw 的等价实现
   Electron 下 preload.js 已注入 bw, 此文件不做任何事 */
(function () {
  if (window.bw && window.bw.loadStore) { window.BW.PLATFORM = 'electron'; return; }

  const IS_ANDROID = !!window.AndroidTTS || /Android/i.test(navigator.userAgent);
  window.BW.PLATFORM = IS_ANDROID ? 'android' : 'web';

  /* ---------- IndexedDB 基础 ---------- */
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const req = indexedDB.open('bookworm', 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
          if (!d.objectStoreNames.contains('books')) d.createObjectStore('books');
          if (!d.objectStoreNames.contains('trans')) d.createObjectStore('trans');
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    }
    return dbp;
  }
  function idbPut(store, key, val) {
    return db().then(d => new Promise((res, rej) => {
      const t = d.transaction(store, 'readwrite');
      t.objectStore(store).put(val, key);
      t.oncomplete = () => res(true);
      t.onerror = () => rej(t.error);
    }));
  }
  function idbGet(store, key) {
    return db().then(d => new Promise((res, rej) => {
      const rq = d.transaction(store, 'readonly').objectStore(store).get(key);
      rq.onsuccess = () => res(rq.result === undefined ? null : rq.result);
      rq.onerror = () => rej(rq.error);
    }));
  }

  /* ---------- 翻译 (渲染进程直连, 与主进程逻辑一致) ---------- */
  let googleDead = 0;
  async function translateOne(text, to) {
    if (Date.now() > googleDead) {
      try {
        const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=' + to + '&dt=t&q=' + encodeURIComponent(text));
        if (r.ok) {
          const d = await r.json();
          if (Array.isArray(d) && Array.isArray(d[0])) return d[0].map(s => (s && s[0]) || '').join('');
        }
      } catch (e) {}
      googleDead = Date.now() + 10 * 60 * 1000;
    }
    try {
      const r = await fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text.slice(0, 480)) + '&langpair=en|' + to);
      if (r.ok) {
        const d = await r.json();
        const t = d && d.responseData && d.responseData.translatedText;
        if (t) return String(t).replace(/\s*MYMEMORY WARNING:.*$/i, '').trim();
      }
    } catch (e) {}
    return null;
  }

  const shim = {
    platformReady: true,

    /* ---------- 存储 ---------- */
    loadStore: (name) => idbGet('kv', name),
    saveStore: async (name, value) => idbPut('kv', name, JSON.parse(JSON.stringify(value))),

    readBookFile: async (absPath) => idbGet('books', absPath),
    readBookData: async (id, name) => idbGet('books', 'books/' + id + '/' + name),
    writeBookData: async (id, name, content) => idbPut('books', 'books/' + id + '/' + name, content),
    deleteBookFiles: async (id) => {
      const d = await db();
      return new Promise((res, rej) => {
        const t = d.transaction(['books', 'trans'], 'readwrite');
        const rq = t.objectStore('books').openCursor(IDBKeyRange.bound('books/' + id + '/', 'books/' + id + '/\uffff'));
        rq.onsuccess = () => { const c = rq.result; if (c) { c.delete(); c.continue(); } };
        t.objectStore('trans').delete(id + '.json');
        t.oncomplete = () => res(true);
        t.onerror = () => rej(t.error);
      });
    },

    loadTranslation: (bookId) => idbGet('trans', bookId + '.json'),
    saveTranslation: (bookId, obj) => idbPut('trans', bookId + '.json', obj),

    /* ---------- 导入: 隐藏 file input ---------- */
    selectAndImport: () => new Promise((res) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.multiple = true;
      inp.accept = '.txt,.epub,.pdf,.docx,.mobi,.azw,.azw3,.md,.markdown,.html,.htm';
      inp.style.display = 'none';
      let done = false;
      const finish = (files) => { if (done) return; done = true; inp.remove(); res({ canceled: !files, files: files || [] }); };
      inp.addEventListener('change', () => finish(Array.from(inp.files || [])));
      inp.addEventListener('cancel', () => finish(null));
      document.body.appendChild(inp);
      inp.click();
      // 某些 WebView 不触发 cancel, 超时兜底
      setTimeout(() => { if (!done && !inp.files.length) finish(null); }, 5 * 60 * 1000);
    }),
    pathForFile: () => null,

    /* ---------- 网络 ---------- */
    translate: async (texts, opts) => {
      const to = (opts && opts.to) || 'zh-CN';
      const arr = (texts || []).map(t => String(t || ''));
      const out = new Array(arr.length);
      let i = 0, good = 0;
      async function worker() {
        while (i < arr.length) {
          const idx = i++;
          const r = await translateOne(arr[idx], to);
          out[idx] = r;
          if (r && r.trim()) good++;
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, arr.length || 1) }, worker));
      if (good >= Math.ceil(arr.length * 0.7) && good > 0) {
        return { results: out.map(x => x || ''), provider: IS_ANDROID ? 'android-web' : 'web' };
      }
      throw new Error('所有翻译服务都失败了，请检查网络');
    },

    lookupDictionary: async (word) => {
      try {
        const r = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word));
        if (!r.ok) return null;
        const data = await r.json();
        if (!Array.isArray(data) || !data.length) return null;
        const entry = data[0];
        const ph = (entry.phonetics || []).find(p => p.text) || {};
        const meanings = (entry.meanings || []).slice(0, 3).map(m => ({
          pos: m.partOfSpeech,
          def: (m.definitions || []).slice(0, 2).map(d => d.definition)
        }));
        return { word: entry.word, phonetic: ph.text || '', meanings };
      } catch (e) { return null; }
    },

    openExternal: (url) => { try { window.open(url, '_blank'); } catch (e) {} return true; },

    saveTextFile: async (opts) => {
      if (window.AndroidBridge && AndroidBridge.downloadFile) {
        AndroidBridge.downloadFile(opts.defaultName || '笔记.md', opts.content || '');
        return '已保存到下载目录';
      }
      const blob = new Blob([opts.content || ''], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = opts.defaultName || '笔记.md';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
      return '已下载';
    },

    appVersion: async () => window.BW.APP_VERSION || '1.0.0',

    readAppData: async (name) => {
      if (window.AndroidBridge && AndroidBridge.readAsset) {
        try { return AndroidBridge.readAsset('app/data/' + name); } catch (e) { return null; }
      }
      try {
        const r = await fetch('data/' + name);
        if (!r.ok) return null;
        return await r.text();
      } catch (e) { return null; }
    },

    checkUpdate: async () => {
      try {
        let repo = 'peppabaoyu/bookworm-reader';
        const r = await fetch('https://api.github.com/repos/' + repo + '/releases/latest', {
          headers: { 'Accept': 'application/vnd.github+json' }, signal: AbortSignal.timeout(9000)
        });
        if (!r.ok) return { status: r.status === 404 ? 'no-release' : 'error' };
        const data = await r.json();
        const latest = String(data.tag_name || '').replace(/^v/i, '');
        const current = await shim.appVersion();
        if (latest && window.BW.gtVersion(latest, current)) {
          const assets = data.assets || [];
          // 手机选 apk, 其余(浏览器/桌面)选 exe
          const isAndroid = /android/i.test(navigator.userAgent) || !!window.AndroidBridge;
          const asset = assets.find(a => isAndroid ? /\.apk$/i.test(a.name) : /\.exe$/i.test(a.name))
            || assets.find(a => !((isAndroid && /\.exe$/i.test(a.name)) || (!isAndroid && /\.apk$/i.test(a.name))))
            || assets[0];
          return { status: 'update-available', latest, current, url: asset ? asset.browser_download_url : data.html_url, notes: String(data.body || '').slice(0, 600) };
        }
        return { status: 'up-to-date', current, latest };
      } catch (e) { return { status: 'error', error: String(e && e.message || e) }; }
    },

    getSmokeSamples: async () => null,
    smokeResult: async () => {}
  };

  window.bw = shim;
  console.log('[书虫] 运行于 ' + (IS_ANDROID ? 'Android WebView' : '浏览器') + ' 模式');
})();
