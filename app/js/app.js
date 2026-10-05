'use strict';
/* 书虫 - 应用入口: 视图路由 / 全局应用 / Smoke 测试 */
(function () {
  const { $, el, toast, Store } = window.BW;

  const App = {
    async init() {
      await Store.init();
      window.BW.LibInit();
      window.BW.SearchInit();
      window.BW.TTS.init();
      this.bindReaderToolbar();
      this.bindSlider();
      this.applySettings();
      window.BW.Lib.render();

      window.addEventListener('error', (e) => {
        console.error('[书虫] 运行时错误:', e.message);
      });

      this.bindUpdateUI();
      // 启动后静默检查一次更新
      setTimeout(() => this.checkUpdate(false), 8000);

      // smoke / webtest
      const params = new URLSearchParams(location.search);
      if (params.get('smoke') === '1') {
        setTimeout(() => runSmoke(), 700);
      } else if (params.get('webtest') === '1') {
        setTimeout(() => runWebTest(), 700);
      }
    },

    /* ---------- 自动检查更新 ---------- */
    bindUpdateUI() {
      const banner = $('#update-banner');
      $('#ub-close').addEventListener('click', () => { banner.hidden = true; });
      $('#ub-download').addEventListener('click', () => {
        const url = banner.dataset.url;
        if (url) window.bw.openExternal(url);
      });
    },

    async checkUpdate(manual) {
      let r;
      try { r = await window.bw.checkUpdate(); }
      catch (e) { r = { status: 'error' }; }
      const banner = $('#update-banner');
      if (r.status === 'update-available') {
        $('#ub-text').textContent = `发现新版本 v${r.latest}（当前 v${r.current}）`;
        banner.dataset.url = r.url || '';
        banner.hidden = false;
        if (manual) toast(`发现新版本 v${r.latest}，可点击右上角横幅下载`);
      } else if (manual) {
        if (r.status === 'up-to-date') toast(`已是最新版本 v${r.current}`);
        else if (r.status === 'no-release') toast('暂未发布任何版本');
        else toast('检查更新失败，请检查网络', 'error');
      }
      return r;
    },

    bindReaderToolbar() {
      $('#rd-back').addEventListener('click', () => this.closeReader());
      $('#rd-toc').addEventListener('click', () => window.BW.Toc.open());
      $('#rd-search').addEventListener('click', () => window.BW.Search.open());
      $('#rd-bilingual').addEventListener('click', () => window.BW.Bilingual.toggle());
      $('#rd-tts').addEventListener('click', () => {
        if (!window.BW.TTS.active) window.BW.TTS.start();
      });
      $('#rd-notes').addEventListener('click', () => window.BW.Notes.toggle());
      $('#rd-bm').addEventListener('click', () => window.BW.Annotate.addBookmark());
      $('#rd-mode').addEventListener('click', () => window.BW.Reader.toggleMode());
      $('#rd-settings').addEventListener('click', () => window.BW.Settings.open());

      // 全局点击关闭弹层
      document.addEventListener('mousedown', (e) => {
        const A = window.BW.Annotate;
        if (A._toolbar && !A._toolbar.contains(e.target) && !window.getSelection().toString()) {
          // 延迟一帧判断, 避免误清
          setTimeout(() => {
            const sel = window.getSelection();
            if (!sel || !sel.toString().trim()) A.hideToolbar();
          }, 120);
        }
      });
    },

    bindSlider() {
      const slider = $('#rd-slider');
      const R = () => window.BW.Reader;
      slider.addEventListener('pointerdown', () => { R()._sliderDragging = true; });
      slider.addEventListener('input', () => {
        const r = R();
        if (!r.book) return;
        const frac = parseInt(slider.value, 10) / 1000;
        if (r.mode === 'paged') {
          r.page = Math.round(frac * (r.pages - 1));
          r.scroll.scrollLeft = r.page * r.pageStride;
          r.updatePositionUI();
        } else {
          const max = r.scroll.scrollHeight - r.scroll.clientHeight;
          r.scroll.scrollTop = frac * max;
          r.updatePositionUI();
        }
      });
      const done = () => {
        const r = R();
        r._sliderDragging = false;
        r.trackPosition();
        r.saveProgress(true);
      };
      slider.addEventListener('change', done);
      slider.addEventListener('pointerup', done);
    },

    openReader(id) {
      window.BW.Reader.open(id);
    },

    closeReader() {
      window.BW.Reader.close();
    },

    applySettings() {
      const s = Store.settings;
      const root = document.documentElement.style;
      const font = (window.BW.FONTS || []).find(f => f.key === s.font) || window.BW.FONTS[0];
      root.setProperty('--rd-font', font.stack);
      root.setProperty('--rd-fs', s.fontSize + 'px');
      root.setProperty('--rd-lh', String(s.lineHeight));
      root.setProperty('--day-bg', s.dayBg || '#f5efe2');
      const scroll = $('#page-scroll');
      if (scroll) scroll.dataset.theme = s.theme || 'night';
    }
  };

  /* ================= Smoke 测试 ================= */
  async function runSmoke() {
    const results = [];
    const errors = [];
    const step = async (name, fn) => {
      try {
        const r = await fn();
        results.push({ name, ok: true, info: r === undefined ? '' : String(r).slice(0, 120) });
      } catch (e) {
        results.push({ name, ok: false, info: String(e && e.message || e).slice(0, 200) });
        errors.push(name + ': ' + (e && e.message || e));
      }
    };
    const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const R = window.BW.Reader;

    let imported = [];
    await step('导入样例 (5 格式)', async () => {
      const s = await window.bw.getSmokeSamples();
      imported = await window.BW.importFromPaths([s.txtPath, s.epubPath, s.pdfPath, s.docxPath, s.mobiPath], { skipEdit: true });
      assert(imported.length === 5, `导入成功 ${imported.length}/5`);
      const fmts = imported.map(b => b.format).sort().join(',');
      assert(fmts === 'docx,epub,mobi,pdf,txt', '格式集合异常: ' + fmts);
      const docx = imported.find(b => b.format === 'docx');
      const mobi = imported.find(b => b.format === 'mobi');
      assert(docx && docx.chapterCount >= 2, 'DOCX 章节数: ' + (docx && docx.chapterCount));
      assert(mobi && mobi.chapterCount >= 2, 'MOBI 章节数: ' + (mobi && mobi.chapterCount));
      return imported.map(b => `${b.title}(${b.chapterCount}章/${b.format})`).join(', ');
    });

    let txtBook = null;
    await step('打开 TXT 并分页', async () => {
      txtBook = imported.find(b => b.format === 'txt');
      assert(!!txtBook, '未找到 txt');
      await R.open(txtBook.id);
      await delay(600);
      assert(!R.view.hidden, '阅读视图未显示');
      assert(R.pages >= 1 && isFinite(R.pages), '页数异常: ' + R.pages);
      R.nextPage(); R.nextPage();
      await delay(100);
      const g = R.currentG();
      assert(typeof g === 'number' && g >= 0, 'currentG 失败');
      R.gotoG(0);
      return `pages=${R.pages}, g=${g}`;
    });

    await step('保存并恢复进度', async () => {
      R.nextPage(); R.nextPage(); R.nextPage();
      R.saveProgress(true);
      await delay(900);
      const saved = JSON.parse(JSON.stringify(Store.getBook(txtBook.id).progress || {}));
      assert(saved && typeof saved.g === 'number', '进度未保存');
      R.gotoG(0, { save: false });
      await R.open(txtBook.id);
      await delay(500);
      const g = R.currentG();
      assert(Math.abs(g - saved.g) < 4000, `恢复位置偏差过大: ${g} vs ${saved.g}`);
      return `g=${g}`;
    });

    await step('全文搜索', async () => {
      window.BW.Search.open();
      $('#sp-input').value = 'river';
      window.BW.Search.run('river');
      await delay(200);
      const n = window.BW.Search.results.length;
      assert(n > 0, '搜索无结果');
      window.BW.Search.close();
      return `${n} 处`;
    });

    await step('高亮与批注 + 导出', async () => {
      const A = window.BW.Annotate;
      const text = R.getFullText();
      const g1 = text.indexOf('river');
      const g2 = g1 + 9;
      A.sel = { g1, g2, text: text.slice(g1, g2), rect: { left: 300, top: 300, width: 100, height: 20 }, plain: text.slice(g1, g2) };
      await A.quickAdd('#f7dc6f', 'hl');
      const notes = Store.getNotes(txtBook.id);
      assert(notes.length === 1 && notes[0].gStart === g1, '笔记未入库');
      const spans = R.inner.querySelectorAll(`[data-note-id="${notes[0].id}"]`);
      assert(spans.length > 0, '高亮未包裹');
      A.sel = { g1: g2 + 2, g2: g2 + 20, text: text.slice(g2 + 2, g2 + 20), rect: { left: 300, top: 300 }, plain: '' };
      await A.quickAdd('#a5d6a7', 'wavy');
      await window.BW.Annotate.addBookmark();
      assert(Store.getNotes(txtBook.id).length === 3, '书签未入库');
      window.BW.Toc.open();
      await delay(100);
      assert($('#toc-panel').querySelectorAll('.toc-item').length >= 2, '目录为空');
      window.BW.Toc.close();
      return `笔记 ${notes.length}`;
    });

    await step('滚动模式', async () => {
      R.setMode('scroll');
      await delay(200);
      assert(R.mode === 'scroll', '模式未切换');
      R.scroll.scrollTop = 800;
      await delay(100);
      const g = R.currentG();
      assert(typeof g === 'number' && g > 0, '滚动模式 currentG 失败: ' + g);
      R.setMode('paged');
      await delay(200);
      return 'ok';
    });

    await step('打开 EPUB', async () => {
      const epub = imported.find(b => b.format === 'epub');
      assert(!!epub, '未找到 epub');
      await R.open(epub.id);
      await delay(500);
      assert(R.chapters.length >= 3, 'EPUB 章节数: ' + R.chapters.length);
      assert(R.totalChars > 500, 'EPUB 内容过短');
      R.gotoG(R.chapterStartG(1));
      await delay(100);
      const g = R.currentG();
      assert(g > 0, 'EPUB 跳章失败');
      return `${R.chapters.length} 章, 跳转 g=${g}`;
    });

    await step('打开 PDF', async () => {
      const pdf = imported.find(b => b.format === 'pdf');
      assert(!!pdf, '未找到 pdf');
      await R.open(pdf.id);
      await delay(900);
      assert(R.totalChars > 20, 'PDF 文本过短: ' + R.totalChars);
      return `${R.chapters.length} 章`;
    });

    await step('设置读写与主题', async () => {
      const s = Store.settings;
      const old = s.theme;
      s.theme = s.theme === 'night' ? 'eye' : 'night';
      window.BW.App.applySettings();
      assert($('#page-scroll').dataset.theme === s.theme, '主题未应用');
      s.fontSize = 26;
      window.BW.App.applySettings();
      assert(document.documentElement.style.getPropertyValue('--rd-fs') === '26px', '字号未应用');
      s.theme = old; s.fontSize = 20;
      window.BW.App.applySettings();
      await Store.saveSettings();
      return 'ok';
    });

    await step('TTS 句子解析', async () => {
      await R.open(txtBook.id);
      await delay(400);
      const ss = R.buildSentences();
      assert(ss.length > 5, '句子数: ' + ss.length);
      const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
      return `${ss.length} 句, 系统 voices=${voices.length}`;
    });

    await step('打开 DOCX / MOBI', async () => {
      const docx = imported.find(b => b.format === 'docx');
      const mobi = imported.find(b => b.format === 'mobi');
      await R.open(docx.id);
      await delay(400);
      const gDocx = R.totalChars;
      assert(gDocx > 100, 'DOCX 内容过短: ' + gDocx);
      await R.open(mobi.id);
      await delay(400);
      const gMobi = R.totalChars;
      assert(gMobi > 100, 'MOBI 内容过短: ' + gMobi);
      R.gotoG(R.chapterStartG(1));
      await delay(150);
      const g = R.currentG();
      assert(g > 0, 'MOBI 跳章失败');
      return `docx=${gDocx}字 mobi=${gMobi}字 跳转g=${g}`;
    });

    await step('笔记面板与导出', async () => {
      await R.open(txtBook.id);
      await delay(350);
      window.BW.Notes.open();
      await delay(150);
      const items = $('#notes-panel').querySelectorAll('.np-item');
      assert(items.length >= 2, '面板条目: ' + items.length);
      window.BW.Notes.closePanel();
      R.close();
      await delay(200);
      assert(document.body.dataset.view === 'library', '未返回书架');
      assert(window.BW.Lib.visibleBooks().length === 5, '书架数量: ' + window.BW.Lib.visibleBooks().length);
      return 'ok';
    });

    await window.bw.smokeResult({ ok: errors.length === 0, results, errors });
  }

  /* ================= Web/安卓 shim 测试 ================= */
  async function runWebTest() {
    const results = [];
    const errors = [];
    const step = async (name, fn) => {
      try {
        const r = await fn();
        results.push({ name, ok: true, info: r === undefined ? '' : String(r).slice(0, 120) });
      } catch (e) {
        results.push({ name, ok: false, info: String(e && e.message || e).slice(0, 200) });
        errors.push(name + ': ' + (e && e.message || e));
      }
    };
    const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const R = window.BW.Reader;
    let imported = [];

    await step('平台识别与 shim', async () => {
      assert(window.BW.PLATFORM === 'web', 'PLATFORM=' + window.BW.PLATFORM);
      assert(window.bw && window.bw.saveStore && window.bw.translate, 'bw shim 不完整');
      return 'platform=' + window.BW.PLATFORM;
    });

    await step('IndexedDB 存储', async () => {
      await window.bw.saveStore('wt.json', { a: 1, list: [1, 2, 3] });
      const v = await window.bw.loadStore('wt.json');
      assert(v && v.a === 1 && v.list.length === 3, 'kv roundtrip 失败');
      return 'ok';
    });

    await step('Web 导入', async () => {
      assert(window.__WEBTEST_TXT, '样例未注入');
      const bin = atob(window.__WEBTEST_TXT);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const file = new File([u8], 'web-sample.txt', { type: 'text/plain' });
      imported = await window.BW.importFromFiles([file], { skipEdit: true });
      assert(imported.length === 1 && imported[0].chapterCount >= 2, '导入: ' + JSON.stringify(imported.map(b => b.title)));
      return imported[0].title + '(' + imported[0].chapterCount + '章)';
    });

    await step('Web 阅读器', async () => {
      await R.open(imported[0].id);
      await delay(600);
      assert(!R.view.hidden && R.pages >= 1, '分页失败 pages=' + R.pages);
      R.nextPage();
      const g = R.currentG();
      assert(typeof g === 'number' && g >= 0, 'currentG 失败');
      R.gotoG(0, { save: false });
      return 'pages=' + R.pages;
    });

    await step('搜索与批注', async () => {
      window.BW.Search.open();
      window.BW.Search.run('the');
      await delay(150);
      assert(window.BW.Search.results.length > 0, '搜索无结果');
      window.BW.Search.close();
      const A = window.BW.Annotate;
      const text = R.getFullText();
      const g1 = text.indexOf('the');
      A.sel = { g1, g2: g1 + 10, text: text.slice(g1, g1 + 10), rect: { left: 100, top: 100 }, plain: '' };
      await A.quickAdd('#f7dc6f', 'hl');
      assert(Store.getNotes(imported[0].id).length === 1, '批注未入库');
      return 'ok';
    });

    await step('Web 翻译直连', async () => {
      const r = await window.bw.translate(['hello world'], {});
      assert(r.results[0] && r.results[0].trim(), '翻译为空');
      return r.provider + ': ' + r.results[0];
    });

    await step('朗读句子解析', async () => {
      const ss = R.buildSentences();
      assert(ss.length > 5, '句子数: ' + ss.length);
      return ss.length + ' 句';
    });

    await step('删除清理', async () => {
      R.close();
      await delay(150);
      await Store.removeBook(imported[0].id);
      assert(window.BW.Lib.visibleBooks().length === 0, '删除失败');
      return 'ok';
    });

    console.log('SMOKE_JSON:' + JSON.stringify({ ok: errors.length === 0, results, errors }));
  }

  window.BW.App = App;
  document.addEventListener('DOMContentLoaded', () => { App.init(); });
})();
