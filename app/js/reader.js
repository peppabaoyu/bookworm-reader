'use strict';
/* 书虫 - 阅读器: 分页/连续滚动、锚点定位、翻页、目录、进度 */
(function () {
  const { $, $$, el, clamp, debounce, toast, Store } = window.BW;

  const PAGE_PAD_V = 10;

  const Reader = {
    book: null,
    chapters: [],
    mode: 'paged',
    bilingual: false,

    // 渲染状态
    sections: [],
    nodeIndex: [],
    nodeMap: new Map(),
    chapterStarts: [],
    totalChars: 0,
    indexDirty: true,

    pages: 1,
    page: 0,
    _sliderDragging: false,

    /* ---------- DOM 引用 ---------- */
    get view() { return $('#view-reader'); },
    get scroll() { return $('#page-scroll'); },
    get inner() { return $('#page-inner'); },

    /* ---------- 打开 / 关闭 ---------- */
    async open(bookId) {
      const book = Store.getBook(bookId);
      if (!book) { toast('书籍不存在', 'error'); return; }
      this.book = book;
      let content;
      try {
        content = JSON.parse(await window.bw.readBookData(bookId, 'content.json'));
      } catch (e) {
        toast('书籍内容读取失败，请重新导入', 'error');
        return;
      }
      this.chapters = content.chapters || [];
      this.bilingual = !!Store.settings.bilingual;
      this.mode = Store.settings.mode || 'paged';
      this._bindOnce();

      $('#rd-title').textContent = book.title;
      document.title = book.title + ' - 书虫';
      await Store.updateBook(bookId, { lastReadAt: Date.now() });

      this.renderContent();
      this.view.hidden = false;
      document.body.dataset.view = 'reader';

      // 打开面板复位
      window.BW.Search.close();
      window.BW.Notes.closePanel();
      window.BW.TTS.stop(true);
      $('#rd-bilingual').classList.toggle('on', this.bilingual);
      $('#rd-mode').textContent = this.mode === 'paged' ? ' ⇄ 分页' : ' ↕ 滚动';

      // 恢复进度
      const p = book.progress;
      requestAnimationFrame(() => {
        this.layout();
        if (p && typeof p.g === 'number' && this.totalChars > 0) {
          this.gotoG(clamp(p.g, 0, Math.max(0, this.totalChars - 1)), { save: false });
        } else {
          this.gotoG(0, { save: false });
        }
        this.updatePositionUI(true);
        if (this.bilingual) window.BW.Bilingual.ensureAround();
      });
    },

    close() {
      this.saveProgress(true);
      window.BW.TTS.stop(true);
      window.BW.Search.close();
      window.BW.Notes.closePanel();
      $('#toc-panel').hidden = true;
      document.title = '书虫';
      this.book = null;
      this.view.hidden = true;
      document.body.dataset.view = 'library';
      window.BW.Lib.render();
    },

    /* ---------- 内容渲染 ---------- */
    renderContent() {
      const inner = this.inner;
      inner.innerHTML = '';
      inner.classList.toggle('bilingual', this.bilingual);
      this.sections = [];
      this.chapters.forEach((ch, i) => {
        const sec = el('section', { class: 'chapter', 'data-ch': String(i) },
          el('h2', { class: 'ch-title' }, ch.title || `第 ${i + 1} 节`));
        const body = el('div', { class: 'ch-body' });
        body.innerHTML = ch.html || `<p>${window.BW.escapeHtml(ch.text || '')}</p>`;
        sec.appendChild(body);
        inner.appendChild(sec);
        this.sections.push(sec);
      });
      if (this.bilingual) window.BW.Bilingual.prepareDOM();
      this.indexDirty = true;
      this._sentCacheDirty = true;
      this.buildIndex();
      window.BW.Notes.applyAll();
      this.buildIndex();
      this.layout();
    },

    /* ---------- 全局文本锚点 (跳过中文对照节点) ---------- */
    buildIndex() {
      const inner = this.inner;
      const walker = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (!n.data || !n.data.trim()) return NodeFilter.FILTER_REJECT;
          const p = n.parentElement;
          if (p && p.closest('[data-zh]')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const nodes = [];
      const map = new Map();
      const starts = new Array(this.chapters.length).fill(-1);
      let pos = 0, curCh = -1;
      let n;
      while ((n = walker.nextNode())) {
        let sec = null;
        let p = n.parentElement;
        while (p && p !== inner) {
          if (p.classList && p.classList.contains('chapter')) { sec = +p.dataset.ch; break; }
          p = p.parentElement;
        }
        if (sec !== null && sec !== curCh) {
          curCh = sec;
          if (starts[sec] === -1) starts[sec] = pos;
        }
        const e = { node: n, start: pos };
        nodes.push(e);
        map.set(n, e);
        pos += n.data.length;
      }
      let run = pos;
      for (let i = starts.length - 1; i >= 0; i--) {
        if (starts[i] === -1) starts[i] = run;
        run = starts[i];
      }
      this.nodeIndex = nodes;
      this.nodeMap = map;
      this.chapterStarts = starts;
      this.totalChars = pos;
      this.indexDirty = false;
    },

    ensureIndex() { if (this.indexDirty || !this.nodeIndex.length) this.buildIndex(); },

    locate(g) {
      this.ensureIndex();
      const arr = this.nodeIndex;
      if (!arr.length) return null;
      g = clamp(g, 0, Math.max(0, this.totalChars - 1));
      let lo = 0, hi = arr.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (arr[mid].start <= g) lo = mid; else hi = mid - 1;
      }
      return { node: arr[lo].node, offset: clamp(g - arr[lo].start, 0, arr[lo].node.data.length) };
    },

    gOfNode(node, offset) {
      this.ensureIndex();
      const e = this.nodeMap.get(node);
      return e ? e.start + offset : null;
    },

    chapterOfG(g) {
      this.ensureIndex();
      const s = this.chapterStarts;
      let lo = 0, hi = s.length - 1;
      if (!s.length || s[hi] <= 0 && this.totalChars === 0) return 0;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (s[mid] <= g) lo = mid; else hi = mid - 1;
      }
      return lo;
    },

    chapterStartG(i) {
      this.ensureIndex();
      return this.chapterStarts[i] !== undefined ? this.chapterStarts[i] : 0;
    },

    /* ---------- 区间包裹 (高亮/朗读/闪烁) ---------- */
    wrapRange(g1, g2, attrs) {
      this.ensureIndex();
      if (g2 <= g1 || !this.nodeIndex.length) return [];
      const a = this.locate(g1), b = this.locate(g2 - 1);
      if (!a || !b) return [];
      let startNode, endNode;
      if (a.node === b.node) {
        let n = a.node;
        if (b.offset + 1 < n.data.length) n.splitText(b.offset + 1);
        startNode = a.offset > 0 ? n.splitText(a.offset) : n;
        endNode = startNode;
      } else {
        startNode = a.offset > 0 ? a.node.splitText(a.offset) : a.node;
        if (b.offset + 1 < b.node.data.length) b.node.splitText(b.offset + 1);
        endNode = b.node;
      }
      // 收集 startNode..endNode 之间的文本节点
      const walker = document.createTreeWalker(this.inner, NodeFilter.SHOW_TEXT);
      const col = [];
      let started = false, m;
      while ((m = walker.nextNode())) {
        if (m === startNode) started = true;
        if (started) col.push(m);
        if (m === endNode) break;
      }
      const spans = [];
      for (const tn of col) {
        if (!tn.data) continue;
        const sp = document.createElement('span');
        for (const [k, v] of Object.entries(attrs)) sp.setAttribute(k, v);
        tn.parentNode.insertBefore(sp, tn);
        sp.appendChild(tn);
        spans.push(sp);
      }
      this.indexDirty = true;
      return spans;
    },

    unwrap(selector) {
      let removed = false;
      for (const sp of this.inner.querySelectorAll(selector)) {
        const parent = sp.parentNode;
        while (sp.firstChild) parent.insertBefore(sp.firstChild, sp);
        sp.remove();
        removed = true;
      }
      if (removed) this.indexDirty = true;
      parentClean(this.inner);
      return removed;
    },

    flashRange(g1, g2) {
      this.unwrap('span.bw-flash');
      const spans = this.wrapRange(g1, g2, { class: 'bw-flash' });
      if (spans.length) setTimeout(() => this.unwrap('span.bw-flash'), 1800);
    },

    /* ---------- 布局与分页 ---------- */
    layout() {
      const scroll = this.scroll, inner = this.inner;
      if (!scroll || !inner) return;
      const W = scroll.clientWidth, H = scroll.clientHeight;
      if (!W || !H) return;
      if (this.mode === 'paged') {
        const P = clamp(Math.round(W * 0.055), 26, 60);
        inner.style.height = H + 'px';
        inner.style.padding = PAGE_PAD_V + 'px ' + P + 'px ' + (PAGE_PAD_V + 6) + 'px ' + P + 'px';
        inner.style.columnWidth = (W - 2 * P) + 'px';
        inner.style.columnGap = (2 * P) + 'px';
        inner.style.columnFill = 'auto';
        this.pageStride = W;
        // 计算总页数
        this.pages = Math.max(1, Math.round((inner.scrollWidth + P) / W));
        this.page = clamp(this.page, 0, this.pages - 1);
        scroll.scrollLeft = this.page * W;
      } else {
        inner.style.height = '';
        inner.style.padding = '18px 40px 120px';
        inner.style.columnWidth = '';
        inner.style.columnGap = '';
        inner.style.columnFill = '';
        scroll.scrollLeft = 0;
      }
      inner.classList.toggle('paged', this.mode === 'paged');
    },

    relayout() {
      const g = this.currentG();
      this.layout();
      if (typeof g === 'number') this.gotoG(g, { save: false });
      this.updatePositionUI(true);
    },

    gotoPage(p, opts) {
      if (this.mode !== 'paged') return;
      this.page = clamp(p, 0, this.pages - 1);
      this.scroll.scrollLeft = this.page * this.pageStride;
      this.updatePositionUI();
      if (!opts || opts.save !== false) this.saveProgress();
    },

    nextPage() {
      if (this.mode !== 'paged') { this.scrollByViewport(1); return; }
      if (this.page >= this.pages - 1) { this.saveProgress(true); return; }
      this.gotoPage(this.page + 1);
    },
    prevPage() {
      if (this.mode !== 'paged') { this.scrollByViewport(-1); return; }
      if (this.page <= 0) return;
      this.gotoPage(this.page - 1);
    },
    scrollByViewport(dir) {
      const H = this.scroll.clientHeight;
      this.scroll.scrollTop += dir * (H - 80);
      this.updatePositionUI();
      this.saveProgress();
    },

    /* ---------- 定位 ---------- */
    gotoG(g, opts) {
      opts = opts || {};
      if (this.mode === 'paged') {
        const a = this.locate(g);
        if (!a) return;
        const range = document.createRange();
        try { range.setStart(a.node, a.offset); range.collapse(true); } catch (e) { return; }
        const rects = range.getClientRects();
        const rect = rects.length ? rects[0] : a.node.parentElement.getBoundingClientRect();
        const srect = this.scroll.getBoundingClientRect();
        const innerStyle = getComputedStyle(this.inner);
        const padL = parseFloat(innerStyle.paddingLeft) || 0;
        const docX = rect.left - srect.left + this.scroll.scrollLeft;
        let page = Math.floor((docX - padL) / (this.pageStride || this.scroll.clientWidth));
        page = clamp(page, 0, Math.max(0, this.pages - 1));
        this.page = page;
        this.scroll.scrollLeft = page * this.pageStride;
      } else {
        const a = this.locate(g);
        if (!a) return;
        const range = document.createRange();
        try { range.setStart(a.node, a.offset); range.collapse(true); } catch (e) { return; }
        const rect = range.getBoundingClientRect();
        const srect = this.scroll.getBoundingClientRect();
        this.scroll.scrollTop += rect.top - srect.top - 90;
      }
      this.updatePositionUI();
      if (opts.save !== false) this.saveProgress();
      if (opts.flash) { /* 由调用者处理 */ }
    },

    currentG() {
      const scroll = this.scroll;
      const srect = scroll.getBoundingClientRect();
      if (this.mode === 'paged') {
        const innerStyle = getComputedStyle(this.inner);
        const padL = parseFloat(innerStyle.paddingLeft) || 0;
        const x = srect.left + padL + 24;
        const ys = [0.3, 0.45, 0.6, 0.18, 0.75, 0.12, 0.88];
        for (const f of ys) {
          const r = document.caretRangeFromPoint(x, srect.top + srect.height * f);
          if (r && r.startContainer.nodeType === 3) {
            const g = this.gOfNode(r.startContainer, r.startOffset);
            if (g !== null) return g;
          }
        }
      } else {
        for (const f of [0.12, 0.2, 0.3, 0.45]) {
          const r = document.caretRangeFromPoint(srect.left + srect.width / 2, srect.top + srect.height * f);
          if (r && r.startContainer.nodeType === 3) {
            const g = this.gOfNode(r.startContainer, r.startOffset);
            if (g !== null) return g;
          }
        }
      }
      // 兜底: 当前页首
      if (this.mode === 'paged') return Math.min(this.page * 1, this.totalChars - 1) * 0 + (this._lastG || 0);
      return this._lastG || 0;
    },

    /* ---------- 位置 UI 与保存 ---------- */
    updatePositionUI(force) {
      const slider = $('#rd-slider');
      const pctEl = $('#rd-pct');
      const chEl = $('#rd-chapter');
      let frac = 0;
      if (this.mode === 'paged') {
        frac = this.pages > 1 ? this.page / (this.pages - 1) : 0;
        if (!this._sliderDragging) slider.value = String(Math.round(frac * 1000));
        pctEl.textContent = Math.round(frac * 100) + '%' + (this.pages > 1 ? ` · ${this.page + 1}/${this.pages} 页` : '');
      } else {
        const max = this.scroll.scrollHeight - this.scroll.clientHeight;
        frac = max > 0 ? clamp(this.scroll.scrollTop / max, 0, 1) : 0;
        if (!this._sliderDragging) slider.value = String(Math.round(frac * 1000));
        pctEl.textContent = Math.round(frac * 100) + '%';
      }
      const g = this._lastG;
      const ci = typeof g === 'number' ? this.chapterOfG(g) : 0;
      const ch = this.chapters[ci];
      chEl.textContent = ch ? (ch.title || `第 ${ci + 1} 节`) : '';
      window.BW.Toc && window.BW.Toc.setActive(ci);
      this._lastG = typeof this._lastG === 'number' ? this._lastG : 0;
      if (force) this._posFrac = frac;
      if (this.bilingual) window.BW.Bilingual.onPositionChange(ci);
    },

    trackPosition() {
      const g = this.currentG();
      if (typeof g === 'number' && g >= 0) this._lastG = g;
      this.updatePositionUI();
    },

    saveProgress: debounce(function (force) {
      const R = window.BW.Reader;
      if (!R.book) return;
      const g = R.currentG();
      if (typeof g !== 'number' || R.totalChars <= 0) return;
      R._lastG = g;
      const percent = R.totalChars ? g / R.totalChars : 0;
      const chapterIndex = R.chapterOfG(g);
      Store.updateBook(R.book.id, {
        progress: { g, percent, chapterIndex, mode: R.mode, updatedAt: Date.now() },
        lastReadAt: Date.now()
      });
    }, 700),

    /* ---------- 交互 ---------- */
    _bindOnce() {
      if (this._bound) return;
      this._bound = true;
      const scroll = this.scroll;
      const isTouch = ('ontouchstart' in window) || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
      this._isTouch = isTouch;

      /* 翻页方式: 电脑 = 滚轮 / PageUp·PageDown / ←→ / 空格; 手机 = 滑动
         点击不再翻页 —— 双击查词与点击翻页彻底解耦 */

      /* ---------- 手机端触摸手势 ----------
         滑动一次翻一页 (页面位置不做拖跟, 永远对齐页边界, 不会卡在两页之间)
         长按单词 = 播放读音 + 牛津式查词卡 (比双击可靠) ---------- */
      let tsX = 0, tsY = 0, tsT = 0, swiping = false;
      let lpTimer = 0, lpFired = false;
      let lastTapAt = 0, lastTapX = 0, lastTapY = 0;
      const clearLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = 0; } };

      scroll.addEventListener('touchstart', (e) => {
        tsX = e.touches[0].clientX; tsY = e.touches[0].clientY;
        tsT = Date.now(); swiping = false; lpFired = false;
        clearLp();
        lpTimer = setTimeout(() => {
          lpFired = true;
          try { if (navigator.vibrate) navigator.vibrate(30); } catch (err) {}
          this._doubleTapLookup(tsX, tsY);   // 长按 → 查词
        }, 550);
      }, { passive: true });

      scroll.addEventListener('touchmove', (e) => {
        const dx = e.touches[0].clientX - tsX;
        const dy = e.touches[0].clientY - tsY;
        if (!lpFired && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) clearLp();   // 移动即取消长按
        if (this.mode === 'paged') {
          if (!swiping && Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) + 6) swiping = true;
          if (swiping) e.preventDefault();
        }
      }, { passive: false });

      const endGesture = (e) => {
        clearLp();
        const t = e.changedTouches ? e.changedTouches[0] : null;
        if (lpFired) {
          lpFired = false;
          window.BW.Annotate._suppressToolbarOnce = true;   // 长按后抑制选区工具条
          return;
        }
        if (!t) return;
        // 滑动翻页 (仅分页模式): 一次滑动只翻一页
        if (this.mode === 'paged' && swiping) {
          const dx = t.clientX - tsX;
          swiping = false;
          lastTapAt = 0;
          if (dx < -45) this.nextPage();
          else if (dx > 45) this.prevPage();
          return;   // 页面位置从未偏离页边界, 无需回弹
        }
        // 轻点双击检测 (保留为长按之外的辅助手段)
        const drag = Math.hypot(t.clientX - tsX, t.clientY - tsY);
        if (drag < 14 && Date.now() - lastTapAt < 400 && Math.abs(t.clientX - lastTapX) < 48 && Math.abs(t.clientY - lastTapY) < 48) {
          lastTapAt = 0;
          this._doubleTapLookup(t.clientX, t.clientY);
        } else if (drag < 14) {
          lastTapAt = Date.now(); lastTapX = t.clientX; lastTapY = t.clientY;
        } else {
          lastTapAt = 0;
        }
      };
      scroll.addEventListener('touchend', endGesture);
      scroll.addEventListener('touchcancel', () => { clearLp(); swiping = false; });

      /* 电脑端滚轮: 分页模式一格滚轮翻一页 (连续滚动模式保持原生滚动) */
      scroll.addEventListener('wheel', (e) => {
        if (this.mode !== 'paged' || isTouch) return;
        if (Math.abs(e.deltaY) < 12 && Math.abs(e.deltaX) < 12) return;
        e.preventDefault();
        const now = Date.now();
        if (now - (this._wheelAt || 0) < 380) return;   // 惯性节流: 一次手势只翻一页
        this._wheelAt = now;
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (d > 0) this.nextPage(); else this.prevPage();
      }, { passive: false });

      // 双击词语 → 播放标准读音 + 牛津式查词卡 (电脑主通道; 手机端作为触摸检测的兜底)
      scroll.addEventListener('dblclick', (e) => {
        const now = Date.now();
        if (isTouch && now - (this._lastLookupAt || 0) < 700) return;   // 触摸手动检测已处理
        setTimeout(() => {
          const sel = window.getSelection();
          const raw = sel ? sel.toString() : '';
          const m = raw.match(/[A-Za-z][A-Za-z'’-]*/);
          if (m && m[0].length > 0 && m[0].length <= 40) {
            window.BW.Annotate._suppressToolbarOnce = true;
            window.BW.TTS.speakSelection(m[0]);
            this._lastLookupAt = Date.now();
            let rect = null, sentence = '';
            try {
              const range = sel.getRangeAt(0);
              rect = range.getBoundingClientRect();
              const g = window.BW.Annotate.pointG(range.startContainer, range.startOffset, true);
              if (typeof g === 'number') sentence = this.sentenceAtG(g);
            } catch (err) {}
            window.BW.Trans.show(m[0], rect && rect.width ? rect : { left: e.clientX, top: e.clientY, width: 0, height: 0 }, { sentence });
          }
        }, 10);
      });

      scroll.addEventListener('mouseup', () => {
        setTimeout(() => window.BW.Annotate.onMaybeSelection(), 10);
      });

      scroll.addEventListener('scroll', () => {
        if (this.mode === 'scroll') { this.trackPosition(); this.saveProgress(); }
      }, { passive: true });

      scroll.addEventListener('click', (e) => {
        const noteSpan = e.target.closest && e.target.closest('[data-note-id]');
        if (noteSpan) {
          const sel = window.getSelection();
          if (!sel || sel.isCollapsed || !sel.toString().trim()) {
            window.BW.Notes.onSpanClick(noteSpan.getAttribute('data-note-id'), e.clientX, e.clientY);
          }
          return;
        }
        if (this.bilingual) {
          const enS = e.target.closest && e.target.closest('.en-s');
          if (enS) window.BW.Bilingual.flashPair(enS);
        }
      });

      // 窗口尺寸变化 → 重排
      const ro = new ResizeObserver(debounce(() => {
        if (this.book && this.view && !this.view.hidden) this.relayout();
      }, 180));
      ro.observe(scroll);

      // 保存
      window.addEventListener('beforeunload', () => { try { this.saveProgress(true); } catch (e) {} });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { try { this.saveProgress(true); } catch (e) {} }
      });

      // 底部翻页按钮 (所有平台可见, 不依赖键盘/手势)
      $('#rd-prev').addEventListener('click', () => { this.mode === 'paged' ? this.prevPage() : this.scrollByViewport(-1); });
      $('#rd-next').addEventListener('click', () => { this.mode === 'paged' ? this.nextPage() : this.scrollByViewport(1); });

      // 键盘 (document 捕获阶段 + e.key/e.code 双匹配, 保证翻页键可靠)
      document.addEventListener('keydown', (e) => {
        if (!this.book || this.view.hidden) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (window.BW.modalOpen()) return;
        if ((e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 'f') {
          e.preventDefault();
          window.BW.Search.open();
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const code = e.code || '', key = e.key || '';
        let act = null;
        if (key === 'ArrowRight' || code === 'ArrowRight' || key === 'PageDown' || code === 'PageDown' || key === ' ' || code === 'Space') act = 'next';
        else if (key === 'ArrowLeft' || code === 'ArrowLeft' || key === 'PageUp' || code === 'PageUp') act = 'prev';
        else if (key === 'Home' || code === 'Home') act = 'home';
        else if (key === 'End' || code === 'End') act = 'end';
        if (!act) return;
        e.preventDefault();
        if (act === 'next') { this.mode === 'paged' ? this.nextPage() : this.scrollByViewport(1); }
        else if (act === 'prev') { this.mode === 'paged' ? this.prevPage() : this.scrollByViewport(-1); }
        else if (act === 'home') this.gotoG(0);
        else this.gotoG(Math.max(0, this.totalChars - 2));
      }, true);
    },

    setMode(m) {
      if (this.mode === m) return;
      const g = this.currentG();
      this.mode = m;
      Store.settings.mode = m;
      Store.saveSettings();
      $('#rd-mode').textContent = m === 'paged' ? ' ⇄ 分页' : ' ↕ 滚动';
      this.scroll.scrollTop = 0;
      this.layout();
      this.page = 0;
      if (typeof g === 'number') this.gotoG(g, { save: false });
      this.updatePositionUI(true);
      this.saveProgress(true);
      toast(m === 'paged' ? '已切换为分页模式' : '已切换为连续滚动模式');
    },

    toggleMode() { this.setMode(this.mode === 'paged' ? 'scroll' : 'paged'); },

    /* ---------- 供 TTS/搜索 使用 ---------- */
    buildSentences() {
      this.ensureIndex();
      const Seg = (window.Intl && Intl.Segmenter) ? new Intl.Segmenter('en', { granularity: 'sentence' }) : null;
      const out = [];
      const n = this.chapters.length;
      if (!n || !this.nodeIndex.length) return out;
      // 按章节归组文本节点
      const chapNodes = Array.from({ length: n }, () => []);
      const bounds = this.chapterStarts;
      for (const e of this.nodeIndex) {
        const g = e.start;
        let lo = 0, hi = n - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bounds[mid] <= g) lo = mid; else hi = mid - 1; }
        chapNodes[lo].push(e);
      }
      for (let ci = 0; ci < n; ci++) {
        const start = bounds[ci];
        if (!chapNodes[ci].length) continue;
        let text = '';
        for (const e of chapNodes[ci]) text += e.node.data;
        const push = (s, e2) => {
          const t = text.slice(s, e2).trim();
          if (t) out.push({ gStart: start + s, gEnd: start + e2, text: t });
        };
        if (Seg) {
          for (const seg of Seg.segment(text)) {
            push(seg.index, seg.index + seg.segment.length);
          }
        } else {
          const re = /[^.!?]+[.!?]+["')\]]*\s*/g;
          let prev = 0, mm;
          while ((mm = re.exec(text))) { push(prev, mm.index + mm[0].length); prev = mm.index + mm[0].length; }
          if (prev < text.length) push(prev, text.length);
        }
      }
      return out;
    },

    /* 手机端双击: 播放读音 + 牛津式查词卡 */
    _doubleTapLookup(x, y) {
      const now = Date.now();
      if (now - (this._lastLookupAt || 0) < 350) return;   // 防重复触发
      this._lastLookupAt = now;
      setTimeout(() => {
        try {
          const r = document.caretRangeFromPoint(x, y);
          if (!r || !this.inner.contains(r.startContainer)) return;
          let word = null;
          if (r.startContainer.nodeType === 3) {
            const text = r.startContainer.data;
            let start = r.startOffset, end = r.startOffset;
            while (start > 0 && /[A-Za-z'’-]/.test(text[start - 1])) start--;
            while (end < text.length && /[A-Za-z'’-]/.test(text[end])) end++;
            const w = text.slice(start, end).replace(/^[’'-]+|[’'-]+$/g, '');
            if (/^[A-Za-z][A-Za-z'’-]*$/.test(w)) word = w;
          }
          if (!word) return;
          window.BW.Annotate._suppressToolbarOnce = true;
          window.BW.TTS.speakSelection(word);
          this._lastLookupAt = Date.now();
          let sentence = '';
          try {
            const g = this.gOfNode(r.startContainer, r.startOffset);
            if (g !== null) sentence = this.sentenceAtG(g);
          } catch (e) {}
          window.BW.Trans.show(word, { left: x - 40, top: y, width: 80, height: 20 }, { sentence });
        } catch (e) {}
      }, 20);
    },

    getFullText() {
      this.ensureIndex();
      return this.nodeIndex.map(e => e.node.data).join('');
    },

    /* 双击查词用: 定位 g 所在句子 (带缓存) */
    sentenceAtG(g) {
      try {
        if (!this._sentCache || this._sentCacheDirty) {
          this._sentCache = this.buildSentences();
          this._sentCacheDirty = false;
        }
        const arr = this._sentCache;
        let lo = 0, hi = arr.length - 1;
        if (!arr.length) return '';
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (arr[mid].gStart <= g) lo = mid; else hi = mid - 1;
        }
        const s = arr[lo];
        return g >= s.gStart && g <= s.gEnd ? s.text : '';
      } catch (e) { return ''; }
    }
  };

  function parentClean(root) {
    for (const sp of root.querySelectorAll('span')) {
      if (!sp.className && !sp.getAttribute('data-note-id') && !sp.getAttribute('data-si') && sp.childNodes.length === 0) sp.remove();
    }
  }

  window.BW.Reader = Reader;
})();
