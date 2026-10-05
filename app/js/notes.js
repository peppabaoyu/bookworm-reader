'use strict';
/* 书虫 - 批注系统: 选中工具条 / 高亮 / 下划线 / 波浪线 / 批注 / 书签 / 笔记面板 / 导出MD */
(function () {
  const { $, $$, el, toast, openModal, closeModal, uuid, fmtNow, Store } = window.BW;

  const QUICK_YELLOW = '#f7dc6f';
  const QUICK_GREEN = '#a5d6a7';
  const PALETTE = [
    { name: '金黄', c: '#e8b940' },
    { name: '草绿', c: '#7cb342' },
    { name: '天蓝', c: '#4fc3f7' },
    { name: '樱粉', c: '#f48fb1' }
  ];
  const STYLE_NAMES = { hl: '色块', line: '直线', wavy: '波浪线' };

  const Annotate = {
    sel: null,       // {g1,g2,text,rect}
    _toolbar: null,
    _pop: null,

    /* ---------- 选中检测 ---------- */
    onMaybeSelection() {
      const R = window.BW.Reader;
      if (!R.book || R.view.hidden) return;
      if (this._suppressToolbarOnce) { this._suppressToolbarOnce = false; return; }
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { this.hideToolbar(); return; }
      const text = sel.toString().replace(/\s+/g, ' ').trim();
      if (!text) { this.hideToolbar(); return; }
      const range = sel.getRangeAt(0);
      if (!R.inner.contains(range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode)) {
        this.hideToolbar(); return;
      }
      const g1 = this.pointG(range.startContainer, range.startOffset, true);
      let g2 = this.pointG(range.endContainer, range.endOffset, false);
      if (g1 === null || g2 === null || g2 <= g1) { this.hideToolbar(); return; }
      const rect = range.getBoundingClientRect();
      this.sel = { g1, g2, text, rect, plain: sel.toString() };
      // 中英对照: 选中英语句子时高亮对应中文
      if (R.bilingual) window.BW.Bilingual.flashPairForG(g1, g2);
      this.showToolbar(rect);
    },

    pointG(node, offset, atStart) {
      const R = window.BW.Reader;
      R.ensureIndex();
      if (node.nodeType === 3) return R.gOfNode(node, offset);
      if (!R.nodeIndex.length) return null;
      if (atStart) {
        for (const e of R.nodeIndex) {
          if (node.contains(e.node)) {
            let anc = e.node;
            while (anc.parentNode && anc.parentNode !== node) anc = anc.parentNode;
            const idx = Array.prototype.indexOf.call(node.childNodes, anc);
            if (idx >= offset) return e.start;
          }
        }
        return R.totalChars;
      } else {
        for (let i = R.nodeIndex.length - 1; i >= 0; i--) {
          const e = R.nodeIndex[i];
          if (node.contains(e.node)) {
            let anc = e.node;
            while (anc.parentNode && anc.parentNode !== node) anc = anc.parentNode;
            const idx = Array.prototype.indexOf.call(node.childNodes, anc);
            if (idx < offset) return e.start + e.node.data.length;
          }
        }
        return 0;
      }
    },

    /* ---------- 工具条 ---------- */
    showToolbar(rect) {
      this.hideToolbar();
      const t = this._toolbar = el('div', { class: 'sel-toolbar' });
      const btn = (label, title, fn, cls) => el('button', { class: 'sel-btn ' + (cls || ''), title, onclick: fn }, label);
      t.appendChild(btn('黄', '黄色高亮', () => this.quickAdd(QUICK_YELLOW, 'hl'), 'swatch-y'));
      t.appendChild(btn('绿', '绿色高亮', () => this.quickAdd(QUICK_GREEN, 'hl'), 'swatch-g'));
      t.appendChild(btn('──', '添加直线标记', () => this.quickAdd(PALETTE[0].c, 'line')));
      t.appendChild(btn('～～', '添加波浪线标记', () => this.quickAdd(PALETTE[0].c, 'wavy')));
      t.appendChild(btn('✎ 批注', '写批注', () => this.openEditor()));
      t.appendChild(btn('译', '翻译', () => window.BW.Trans.show(this.sel.plain, this.sel.rect), 'accent'));
      t.appendChild(btn('🔍', '在浏览器中搜索', () => this.searchSelection(), 'accent'));
      t.appendChild(btn('🔊', '朗读选中内容', () => window.BW.TTS.speakSelection(this.sel.plain)));
      document.body.appendChild(t);
      const r = t.getBoundingClientRect();
      let x = clamp(rect.left + rect.width / 2 - r.width / 2, 10, window.innerWidth - r.width - 10);
      let y = rect.top - r.height - 10;
      if (y < 60) y = rect.bottom + 10;
      t.style.left = x + 'px';
      t.style.top = y + 'px';
      // 阻止工具条内点击导致选区丢失
      t.addEventListener('mousedown', e => e.preventDefault());
    },

    hideToolbar() {
      if (this._toolbar) { this._toolbar.remove(); this._toolbar = null; }
    },

    clearSelection() {
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
      this.hideToolbar();
    },

    searchSelection() {
      if (!this.sel) return;
      window.BW.searchInBrowser(this.sel.plain);
      this.clearSelection();
    },

    /* ---------- 添加笔记 ---------- */
    async quickAdd(color, style) {
      if (!this.sel) return;
      const R = window.BW.Reader;
      const { g1, g2, text } = this.sel;
      const note = {
        id: uuid(), type: 'note', gStart: g1, gEnd: g2, text,
        color, style, comment: '',
        chapterIndex: R.chapterOfG(g1),
        createdAt: Date.now(), updatedAt: Date.now()
      };
      await Store.addNote(R.book.id, note);
      R.wrapRange(g1, g2, { class: 'nt nt-' + style, style: '--nc:' + color, 'data-note-id': note.id });
      this.sel = null;
      this.clearSelection();
      this.hideToolbar();
      if (window.BW.Notes.panelOpen()) window.BW.Notes.renderPanel();
    },

    openEditor(existing) {
      const isNew = !existing;
      const s = this.sel;
      if (isNew && !s) return;
      const R = window.BW.Reader;
      let color = existing ? existing.color : PALETTE[0].c;
      let style = existing ? existing.style : 'hl';
      const excerpt = existing ? existing.text : s.text;

      const ta = el('textarea', { class: 'input note-ta', placeholder: '写下你的想法…' });
      ta.value = existing ? (existing.comment || '') : '';
      const exBox = el('div', { class: 'note-excerpt' }, excerpt.length > 260 ? excerpt.slice(0, 260) + '…' : excerpt);
      const palRow = el('div', { class: 'pal-row' });
      const styleRow = el('div', { class: 'style-row' });
      const syncUI = () => {
        $$('.pal-dot', palRow).forEach(d => d.classList.toggle('active', d.dataset.c === color));
        $$('.style-opt', styleRow).forEach(o => o.classList.toggle('active', o.dataset.s === style));
      };
      for (const p of PALETTE) {
        palRow.appendChild(el('button', {
          class: 'pal-dot', 'data-c': p.c, style: { background: p.c }, title: p.name,
          onclick: () => { color = p.c; syncUI(); }
        }));
      }
      for (const [k, label] of Object.entries(STYLE_NAMES)) {
        styleRow.appendChild(el('button', {
          class: 'style-opt', 'data-s': k,
          onclick: () => { style = k; syncUI(); }
        }, label));
      }
      syncUI();

      const actions = [];
      if (!isNew) {
        actions.push(el('button', {
          class: 'btn danger left', onclick: async () => {
            await this.deleteNote(existing.id);
            closeModal();
          }
        }, '删除'));
      }
      actions.push(el('button', { class: 'btn ghost', onclick: () => closeModal() }, '取消'));
      actions.push(el('button', {
        class: 'btn primary', onclick: async () => {
          if (isNew) {
            const note = {
              id: uuid(), type: 'note', gStart: s.g1, gEnd: s.g2, text: s.text,
              color, style, comment: ta.value.trim(),
              chapterIndex: R.chapterOfG(s.g1),
              createdAt: Date.now(), updatedAt: Date.now()
            };
            await Store.addNote(R.book.id, note);
            R.wrapRange(s.g1, s.g2, { class: 'nt nt-' + style, style: '--nc:' + color, 'data-note-id': note.id });
            this.sel = null;
            this.clearSelection();
          } else {
            existing.color = color; existing.style = style;
            existing.comment = ta.value.trim();
            existing.updatedAt = Date.now();
            await Store.saveNotes();
            this.refreshSpan(existing.id);
          }
          closeModal();
          if (window.BW.Notes.panelOpen()) window.BW.Notes.renderPanel();
        }
      }, isNew ? '保存批注' : '保存修改'));

      openModal({
        title: isNew ? '写批注' : '编辑批注',
        cls: 'note-editor',
        body: el('div', {},
          el('div', { class: 'field-label' }, '原文'), exBox,
          el('div', { class: 'field-label' }, '我的批注'), ta,
          el('div', { class: 'field-label' }, '颜色'), palRow,
          el('div', { class: 'field-label' }, '样式'), styleRow),
        actions
      });
      setTimeout(() => ta.focus(), 60);
      this.hideToolbar();
    },

    /* ---------- 笔记 span 交互 ---------- */
    onSpanClick(noteId, x, y) {
      const R = window.BW.Reader;
      const note = Store.getNotes(R.book.id).find(n => n.id === noteId);
      if (!note) return;
      this.hidePop();
      const pop = this._pop = el('div', { class: 'note-pop' });
      if (note.type === 'bookmark') {
        pop.appendChild(el('div', { class: 'np-tag' }, '🔖 书签 · ' + (window.BW.fmtTime(note.createdAt))));
        pop.appendChild(el('div', { class: 'np-text' }, note.text || ''));
      } else {
        pop.appendChild(el('div', { class: 'np-tag' },
          el('span', { class: 'np-dot', style: { background: note.color } }),
          STYLE_NAMES[note.style] || '高亮' + ' · ' + window.BW.fmtTime(note.createdAt)));
        pop.appendChild(el('div', { class: 'np-text' }, note.text));
        if (note.comment) pop.appendChild(el('div', { class: 'np-comment' }, note.comment));
        else pop.appendChild(el('div', { class: 'np-comment dim' }, '(无批注)'));
      }
      const row = el('div', { class: 'np-actions' });
      if (note.type === 'note') {
        row.appendChild(el('button', { class: 'btn tiny', onclick: () => { this.hidePop(); this.openEditor(note); } }, '编辑'));
      }
      row.appendChild(el('button', {
        class: 'btn tiny', onclick: () => {
          this.hidePop();
          Reader_safeGoto(note);
          this.clearSelection();
        }
      }, '跳转'));
      row.appendChild(el('button', { class: 'btn tiny danger', onclick: async () => { this.hidePop(); await this.deleteNote(note.id); } }, '删除'));
      pop.appendChild(row);
      document.body.appendChild(pop);
      const r = pop.getBoundingClientRect();
      pop.style.left = clamp(x - r.width / 2, 10, window.innerWidth - r.width - 10) + 'px';
      pop.style.top = clamp(y - r.height - 14, 60, window.innerHeight - r.height - 10) + 'px';
      pop.addEventListener('mousedown', e => e.stopPropagation());
    },

    hidePop() { if (this._pop) { this._pop.remove(); this._pop = null; } },

    async deleteNote(id) {
      const R = window.BW.Reader;
      await Store.removeNote(R.book.id, id);
      R.unwrap(`[data-note-id="${id}"]`);
      toast('已删除');
      if (window.BW.Notes.panelOpen()) window.BW.Notes.renderPanel();
    },

    refreshSpan(id) {
      const R = window.BW.Reader;
      const note = Store.getNotes(R.book.id).find(n => n.id === id);
      R.unwrap(`[data-note-id="${id}"]`);
      if (note && note.type === 'note' && note.gEnd > note.gStart) {
        R.wrapRange(note.gStart, note.gEnd, { class: 'nt nt-' + note.style, style: '--nc:' + note.color, 'data-note-id': note.id });
      }
    },

    /* ---------- 应用全部笔记 ---------- */
    applyAll() {
      const R = window.BW.Reader;
      if (!R.book) return;
      const notes = Store.getNotes(R.book.id)
        .filter(n => n.type === 'note' && n.gEnd > n.gStart)
        .sort((a, b) => b.gStart - a.gStart);
      for (const n of notes) {
        try {
          R.wrapRange(n.gStart, n.gEnd, { class: 'nt nt-' + n.style, style: '--nc:' + n.color, 'data-note-id': n.id });
        } catch (e) { /* 锚点失效时忽略 */ }
      }
    },

    /* ---------- 书签 ---------- */
    async addBookmark() {
      const R = window.BW.Reader;
      if (!R.book) return;
      const g = R.currentG();
      const ci = R.chapterOfG(g);
      const ch = R.chapters[ci];
      const text = (ch && ch.title ? ch.title + ' · ' : '') + R.getFullText().slice(g, g + 40).replace(/\s+/g, ' ').trim();
      const bm = {
        id: uuid(), type: 'bookmark', gStart: g, gEnd: g, text,
        chapterIndex: ci, color: '#d4a24e', style: 'bookmark',
        comment: '', createdAt: Date.now(), updatedAt: Date.now()
      };
      await Store.addNote(R.book.id, bm);
      toast('已添加书签');
      if (window.BW.Notes.panelOpen()) window.BW.Notes.renderPanel();
    }
  };

  function Reader_safeGoto(note) {
    const R = window.BW.Reader;
    R.gotoG(note.gStart);
    if (note.gEnd > note.gStart) R.flashRange(note.gStart, note.gEnd);
  }

  /* ============ 笔记面板 ============ */
  const Panel = {
    tab: 'note',   // note | bookmark
    query: '',

    panelOpen() { const p = $('#notes-panel'); return p && !p.hidden; },

    open() {
      $('#toc-panel').hidden = true;
      $('#search-panel').hidden = true;
      $('#notes-panel').hidden = false;
      this.renderPanel();
    },
    closePanel() { const p = $('#notes-panel'); if (p) p.hidden = true; },
    toggle() { this.panelOpen() ? this.closePanel() : this.open(); },

    renderPanel() {
      const R = window.BW.Reader;
      const panel = $('#notes-panel');
      if (!panel || !R.book) return;
      const notes = Store.getNotes(R.book.id);
      const list = notes.filter(n => n.type === this.tab);
      const q = this.query.trim().toLowerCase();
      const filtered = q ? list.filter(n => {
        const chTitle = (R.chapters[n.chapterIndex] && R.chapters[n.chapterIndex].title) || '';
        return (n.text || '').toLowerCase().includes(q) ||
          (n.comment || '').toLowerCase().includes(q) ||
          chTitle.toLowerCase().includes(q);
      }) : list;
      filtered.sort((a, b) => a.gStart - b.gStart);

      const head = $('.np-head', panel);
      head.innerHTML = '';
      head.appendChild(el('div', { class: 'np-title' }, '笔记与书签'));
      head.appendChild(el('button', {
        class: 'btn tiny ghost', title: '导出本书笔记为 Markdown',
        onclick: () => window.BW.Notes.exportMD(R.book)
      }, '导出 MD'));
      head.appendChild(el('button', { class: 'icon-btn', onclick: () => this.closePanel() }, '✕'));

      const tabs = $('.np-tabs', panel);
      tabs.innerHTML = '';
      const mkTab = (key, label) => el('button', {
        class: 'np-tab' + (this.tab === key ? ' active' : ''),
        onclick: () => { this.tab = key; this.renderPanel(); }
      }, label + ' (' + notes.filter(n => n.type === key).length + ')');
      tabs.appendChild(mkTab('note', '批注标记'));
      tabs.appendChild(mkTab('bookmark', '书签'));

      const searchBox = $('.np-search', panel);
      searchBox.innerHTML = '';
      const input = el('input', { class: 'input', placeholder: '搜索原文、批注或章节…', value: this.query });
      input.addEventListener('input', window.BW.debounce(() => { this.query = input.value; this.renderList(filtered); }, 150));
      searchBox.appendChild(input);

      this.renderList(filtered);
    },

    renderList(items) {
      const R = window.BW.Reader;
      const listEl = $('.np-list', $('#notes-panel'));
      listEl.innerHTML = '';
      if (!items.length) {
        listEl.appendChild(el('div', { class: 'np-empty' }, this.query ? '没有匹配的记录' : (this.tab === 'note' ? '选中正文即可添加高亮或批注' : '点击右上角书签图标保存当前位置')));
        return;
      }
      for (const n of items) {
        const ch = R.chapters[n.chapterIndex];
        const item = el('div', { class: 'np-item' + (n.type === 'bookmark' ? ' bm' : '') },
          el('div', { class: 'np-item-head' },
            n.type === 'note'
              ? el('span', { class: 'np-dot', style: { background: n.color } })
              : el('span', { class: 'np-bm-ico' }, '🔖'),
            el('span', { class: 'np-ch' }, (ch && ch.title) || '正文'),
            el('span', { class: 'np-time' }, window.BW.fmtTime(n.createdAt))),
          el('div', { class: 'np-item-text' }, n.text ? (n.text.length > 120 ? n.text.slice(0, 120) + '…' : n.text) : ''),
          n.comment ? el('div', { class: 'np-item-cmt' }, n.comment) : null,
          el('div', { class: 'np-item-ops' },
            n.type === 'note' ? el('button', { class: 'btn tiny ghost', onclick: (e) => { e.stopPropagation(); this.openEditor(n); } }, '编辑') : null,
            el('button', {
              class: 'btn tiny ghost', onclick: (e) => {
                e.stopPropagation();
                Reader_safeGoto(n);
              }
            }, '跳转'),
            el('button', { class: 'btn tiny ghost danger', onclick: (e) => { e.stopPropagation(); window.BW.Annotate.deleteNote(n.id); } }, '删除')));
        item.addEventListener('click', () => Reader_safeGoto(n));
        listEl.appendChild(item);
      }
    }
  };

  /* ============ 导出 Markdown ============ */
  async function exportMD(book) {
    const R = window.BW.Reader;
    const notes = Store.getNotes(book.id).slice().sort((a, b) => a.gStart - b.gStart);
    const marks = notes.filter(n => n.type === 'note');
    const bms = notes.filter(n => n.type === 'bookmark');
    if (!notes.length) { toast('这本书还没有笔记或书签', 'error'); return; }

    const lines = [];
    lines.push(`# 《${book.title}》读书笔记`);
    lines.push('');
    lines.push(`- **作者**：${book.author || '佚名'}`);
    lines.push(`- **导出时间**：${fmtNow()}`);
    lines.push(`- **统计**：批注标记 ${marks.length} 条 · 书签 ${bms.length} 枚`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // 按章节分组
    const groups = new Map();
    for (const n of marks) {
      const key = n.chapterIndex || 0;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    }
    for (const [ci, list] of Array.from(groups.entries()).sort((a, b) => a[0] - b[0])) {
      const ch = book && R.book && R.book.id === book.id ? (R.chapters[ci] && R.chapters[ci].title) : '';
      lines.push(`## ${ch || `第 ${ci + 1} 节`}`);
      lines.push('');
      for (const n of list) {
        const styleLabel = n.style === 'hl' ? '高亮' : n.style === 'line' ? '直线' : n.style === 'wavy' ? '波浪线' : '标记';
        lines.push(`> ${n.text.replace(/\n+/g, ' ')}`);
        lines.push('');
        lines.push(`- 标记：${styleLabel}`);
        if (n.comment) { lines.push(`- 批注：${n.comment.replace(/\n+/g, ' ')}`); }
        lines.push(`- 时间：${fmtNow2(n.createdAt)}`);
        lines.push('');
      }
    }
    if (bms.length) {
      lines.push('## 书签');
      lines.push('');
      for (const b of bms) {
        const ch = R.book && R.book.id === book.id ? (R.chapters[b.chapterIndex] && R.chapters[b.chapterIndex].title) : '';
        lines.push(`- 🔖 [${ch || '正文'}] ${b.text} （${fmtNow2(b.createdAt)}）`);
      }
      lines.push('');
    }
    lines.push(`> 由「书虫」导出`);

    const path = await window.bw.saveTextFile({
      defaultName: `${book.title.replace(/[\\/:*?"<>|]/g, '_')}-笔记.md`,
      content: lines.join('\n')
    });
    if (path) toast('已导出: ' + path);
  }

  function fmtNow2(ts) {
    const d = new Date(ts);
    const p = x => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // Annotate 与 Panel 合并为同一个对象, BW.Annotate 与 BW.Notes 等价
  const NotesAPI = Object.assign({}, Annotate, Panel);
  NotesAPI.exportMD = exportMD;
  NotesAPI.PALETTE = PALETTE;
  window.BW.Annotate = NotesAPI;
  window.BW.Notes = NotesAPI;
})();
