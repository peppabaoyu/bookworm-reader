'use strict';
/* 书虫 - 中英对照: 英文段落后附加中文翻译, 选中英语句子高亮对应中文 */
(function () {
  const { $, el, toast, Store } = window.BW;

  const BLOCK_SEL = 'p, h1, h3, h4, h5, h6, blockquote, li, td, div.ch-p';
  const MIN_LEN = 2;

  const Bilingual = {
    cache: null,          // {sentences: {enText: zh}}
    _done: new Set(),     // 已翻译章节
    _pending: new Set(),

    async loadCache(bookId) {
      this.cache = (await window.bw.loadTranslation(bookId)) || { sentences: {} };
    },
    async saveCache() {
      if (this.cache && window.BW.Reader.book) await window.bw.saveTranslation(window.BW.Reader.book.id, this.cache);
    },

    async toggle() {
      const R = window.BW.Reader;
      if (!R.book) return;
      const g = R.currentG();
      R.bilingual = !R.bilingual;
      Store.settings.bilingual = R.bilingual;
      await Store.saveSettings();
      $('#rd-bilingual').classList.toggle('on', R.bilingual);
      if (R.bilingual) await this.loadCache(R.book.id);
      R.renderContent();
      R.layout();
      R.gotoG(g, { save: false });
      R.updatePositionUI(true);
      if (R.bilingual) this.ensureAround();
      toast(R.bilingual ? '中英对照已开启，正在翻译当前章节…' : '中英对照已关闭');
    },

    /* 在渲染后的内容里插入中文段落 (Reader.renderContent 调用) */
    prepareDOM() {
      const R = window.BW.Reader;
      const inner = R.inner;
      inner.classList.add('bilingual');
      let uid = 0;
      for (const sec of inner.querySelectorAll('.chapter')) {
        const blocks = [];
        for (const b of sec.querySelectorAll(BLOCK_SEL)) {
          if (b.classList.contains('ch-title')) continue;
          // 跳过嵌套在其它候选块内的块
          const anc = b.parentElement && b.parentElement.closest(BLOCK_SEL);
          if (anc && !anc.classList.contains('chapter')) continue;
          const direct = b.textContent.trim();
          if (direct.length < MIN_LEN) continue;
          blocks.push(b);
        }
        for (const b of blocks) {
          // 收集块内英文文本节点
          const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, {
            acceptNode(n) { return n.data && n.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; }
          });
          const nodes = [];
          let text = '', n;
          while ((n = walker.nextNode())) { nodes.push({ node: n, at: text.length }); text += n.data; }
          if (!text.trim()) continue;

          // 分句
          let ranges = [];
          if (window.Intl && Intl.Segmenter) {
            const Seg = this._seg || (this._seg = new Intl.Segmenter('en', { granularity: 'sentence' }));
            let prev = 0;
            for (const seg of Seg.segment(text)) {
              const end = seg.index + seg.segment.length;
              if (end > prev) { ranges.push([prev, end]); prev = end; }
            }
            if (prev < text.length) ranges.push([prev, text.length]);
          } else {
            const re = /[^.!?]+[.!?]+["')\]]*\s*/g;
            let prev = 0, m;
            while ((m = re.exec(text))) { ranges.push([prev, m.index + m[0].length]); prev = m.index + m[0].length; }
            if (prev < text.length) ranges.push([prev, text.length]);
          }
          // 过滤纯空白句
          ranges = ranges.filter(([s, e]) => text.slice(s, e).trim().length > 0);
          if (!ranges.length) continue;

          // 包裹英文句 (每次现场收集节点, 前序包裹会分裂文本节点)
          const enSpans = [];
          ranges.forEach(([s, e], si) => {
            const spans = this._wrapLocal(b, s, e, { class: 'en-s', 'data-si': String(si) });
            for (const sp of spans) enSpans.push({ si, span: sp, text: sp.textContent });
          });
          if (!enSpans.length) continue;

          // 中文对照块
          uid++;
          b.setAttribute('data-blk', 'b' + uid);
          const zh = el('div', { class: 'zh-para', 'data-zh': '1', 'data-for': 'b' + uid });
          for (const { si, text: t } of enSpans) {
            const cached = this.cache && this.cache.sentences[t.trim()];
            zh.appendChild(el('span', {
              class: 'zh-s' + (cached ? '' : ' pending'), 'data-si': String(si)
            }, cached || '· · ·'));
          }
          b.after(zh);
        }
      }
    },

    _wrapLocal(block, s, e, attrs) {
      // 在块内包裹 [s,e) 字符范围; 每次调用现场收集文本节点(此前包裹会分裂节点)
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode(n) { return n.data && n.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; }
      });
      const nodes = [];
      let pos = 0, n;
      while ((n = walker.nextNode())) { nodes.push({ node: n, at: pos }); pos += n.data.length; }
      const spans = [];
      for (const { node, at } of nodes) {
        const ns = at, ne = at + node.data.length;
        if (ne <= s || ns >= e) continue;
        let target = node;
        let ls = Math.max(0, s - ns), le = Math.min(node.data.length, e - ns);
        if (le < node.data.length) target.splitText(le);
        if (ls > 0) target = target.splitText(ls);
        const sp = document.createElement('span');
        for (const [k, v] of Object.entries(attrs)) sp.setAttribute(k, v);
        target.parentNode.insertBefore(sp, target);
        sp.appendChild(target);
        spans.push(sp);
      }
      return spans;
    },

    /* ---------- 按需翻译 ---------- */
    onPositionChange(ci) {
      const R = window.BW.Reader;
      if (!R.bilingual || !R.book) return;
      this.ensureAround();
    },

    ensureAround() {
      const R = window.BW.Reader;
      if (!R.bilingual || !R.book) return;
      const ci = typeof R._lastG === 'number' ? R.chapterOfG(R._lastG) : 0;
      this.ensureChapters([ci, Math.min(ci + 1, R.chapters.length - 1)]);
    },

    async ensureChapters(cis) {
      const R = window.BW.Reader;
      const texts = [];
      const spansByChapter = new Map();
      for (const ci of cis) {
        if (ci == null || ci < 0 || ci >= R.sections.length) continue;
        if (this._done.has(ci) || this._pending.has(ci)) continue;
        const spans = Array.from(R.sections[ci].querySelectorAll('.en-s'));
        if (!spans.length) { this._done.add(ci); continue; }
        spansByChapter.set(ci, spans);
        for (const sp of spans) {
          const t = sp.textContent.trim();
          if (t && !(this.cache.sentences.hasOwnProperty(t))) texts.push(t);
        }
        this._pending.add(ci);
      }
      if (!spansByChapter.size) return;
      try {
        const uniq = Array.from(new Set(texts));
        const run = async (list, size, gap) => {
          const chunks = [];
          for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
          for (const chunk of chunks) {
            try {
              const resp = await window.bw.translate(chunk, { customBase: Store.settings.customTranslateBase });
              chunk.forEach((t, j) => { this.cache.sentences[t] = (resp.results[j] || '').trim(); });
            } catch (err) { /* 留空, 由重试或占位处理 */ }
            if (gap) await new Promise(r => setTimeout(r, gap));
          }
        };
        await run(uniq, 8, 500);
        // 失败的句子(被限流等)间隔后重试一轮
        const failed = uniq.filter(t => !this.cache.sentences[t]);
        if (failed.length) {
          await new Promise(r => setTimeout(r, 1600));
          await run(failed, 4, 900);
        }
      } finally {
        for (const [ci, spans] of spansByChapter) {
          for (const sp of spans) {
            const key = sp.textContent.trim();
            const zhSpan = sp.closest('[data-blk]') && sp.closest('[data-blk]').nextElementSibling;
            const target = zhSpan && zhSpan.hasAttribute('data-zh')
              ? zhSpan.querySelector(`.zh-s[data-si="${sp.getAttribute('data-si')}"]`) : null;
            const zh = this.cache.sentences[key];
            if (target) {
              target.textContent = zh || '（未译）';
              target.classList.toggle('pending', !zh);
            }
          }
          this._pending.delete(ci);
          this._done.add(ci);
        }
        await this.saveCache();
      }
    },

    /* ---------- 句子联动高亮 ---------- */
    flashPair(enSpan) {
      if (!enSpan || !enSpan.classList.contains('en-s')) return;
      const blk = enSpan.closest('[data-blk]');
      if (!blk) return;
      const zh = blk.nextElementSibling;
      if (!zh || !zh.hasAttribute('data-zh')) return;
      const target = zh.querySelector(`.zh-s[data-si="${enSpan.getAttribute('data-si')}"]`);
      if (!target) return;
      target.classList.remove('zh-flash');
      void target.offsetWidth;
      target.classList.add('zh-flash');
      setTimeout(() => target.classList.remove('zh-flash'), 2200);
    },

    flashPairForG(g1, g2) {
      const R = window.BW.Reader;
      const a = R.locate(g1);
      if (!a) return;
      const enSpan = a.node.parentElement && a.node.parentElement.closest('.en-s');
      if (enSpan) this.flashPair(enSpan);
    }
  };

  window.BW.Bilingual = Bilingual;
})();
