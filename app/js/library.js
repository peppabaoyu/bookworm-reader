'use strict';
/* 书虫 - 书架 (首页): 封面网格 / 搜索 / 分类 / 最近阅读 / 删除 */
(function () {
  const { $, $$, el, toast, openModal, closeModal, showMenu, fmtTime, Store } = window.BW;

  const Lib = {
    query: '',
    category: '全部',   // 全部 | __recent | 未分类 | <分类名>
    sort: 'recent',     // recent | added | title

    visibleBooks() {
      let list = Store.books.slice();
      const q = this.query.trim().toLowerCase();
      if (q) {
        list = list.filter(b =>
          (b.title || '').toLowerCase().includes(q) ||
          (b.author || '').toLowerCase().includes(q) ||
          (b.category || '').toLowerCase().includes(q));
      }
      if (this.category === '__recent') {
        list = list.filter(b => this.readAt(b));
        list.sort((a, b) => this.readAt(b) - this.readAt(a));
      } else if (this.category === '未分类') {
        list = list.filter(b => !b.category);
      } else if (this.category !== '全部') {
        list = list.filter(b => b.category === this.category);
      }
      if (this.sort === 'added') list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      else if (this.sort === 'title') list.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh'));
      else if (this.sort === 'recent' && this.category !== '__recent') {
        list.sort((a, b) => this.readAt(b) - this.readAt(a) || (b.addedAt || 0) - (a.addedAt || 0));
      }
      return list;
    },

    readAt(b) { return (b.progress && b.progress.updatedAt) || b.lastReadAt || 0; },

    categories() {
      const map = new Map();
      for (const b of Store.books) if (b.category) map.set(b.category, (map.get(b.category) || 0) + 1);
      return Array.from(map.keys()).sort((a, b) => a.localeCompare(b, 'zh'));
    },

    render() {
      const root = $('#view-library');
      if (!root) return;
      const books = this.visibleBooks();
      this.renderChips(books.length);
      this.renderContinue();
      const grid = $('#lib-grid', root);
      grid.innerHTML = '';
      const empty = $('#lib-empty', root);
      const searching = this.query.trim() || this.category !== '全部';
      empty.hidden = !(Store.books.length === 0 || books.length === 0);
      $('.empty-title', empty).textContent = Store.books.length === 0 ? '书架还是空的' : '没有符合条件的书籍';
      $('.empty-sub', empty).textContent = Store.books.length === 0
        ? '点击右上角「导入书籍」，支持 TXT / EPUB / PDF / DOCX / MOBI / MD / HTML，也可以直接把文件拖进窗口'
        : '换个关键词或分类试试';
      for (const b of books) grid.appendChild(this.card(b));
    },

    renderContinue() {
      const btn = $('#btn-continue');
      const last = Store.lastReadBook();
      if (!last) { btn.hidden = true; return; }
      btn.hidden = false;
      btn.innerHTML = '';
      btn.appendChild(el('span', { class: 'cont-ico' }, '▶'));
      const pct = Math.round((last.progress && last.progress.percent || 0) * 100);
      btn.appendChild(el('span', {}, `继续阅读《${String(last.title).slice(0, 12)}》${pct ? ' · ' + pct + '%' : ''}`));
      btn.title = '继续上次的阅读';
      btn.onclick = () => window.BW.App.openReader(last.id);
    },

    renderChips(total) {
      const wrap = $('#lib-chips');
      wrap.innerHTML = '';
      const mk = (key, label, n) => el('button', {
        class: 'chip' + (this.category === key ? ' active' : ''),
        onclick: () => { this.category = key; this.render(); }
      }, label, el('span', { class: 'chip-n' }, String(n)));
      wrap.appendChild(mk('全部', '全部', Store.books.length));
      wrap.appendChild(mk('__recent', '最近阅读', Store.books.filter(b => this.readAt(b)).length));
      const unc = Store.books.filter(b => !b.category).length;
      if (unc) wrap.appendChild(mk('未分类', '未分类', unc));
      for (const c of this.categories()) wrap.appendChild(mk(c, c, Store.books.filter(b => b.category === c).length));

      const sort = $('#lib-sort');
      sort.value = this.sort;
    },

    card(b) {
      const pct = Math.round(((b.progress && b.progress.percent) || 0) * 100);
      const card = el('div', { class: 'book-card', onclick: () => window.BW.App.openReader(b.id) },
        el('div', { class: 'book-cover' },
          el('img', { src: b.cover || '', alt: b.title, draggable: 'false', loading: 'lazy' }),
          el('span', { class: 'book-fmt' }, (b.format || '').toUpperCase())),
        el('div', { class: 'book-info' },
          el('div', { class: 'book-title', title: b.title }, b.title),
          el('div', { class: 'book-meta' },
            el('span', { class: 'book-author', title: b.author }, b.author || '佚名'),
            b.category ? el('span', { class: 'book-cat' }, b.category) : null),
          el('div', { class: 'book-progress' },
            el('div', { class: 'book-bar' }, el('div', { class: 'book-bar-in', style: { width: pct + '%' } })),
            el('span', { class: 'book-pct' }, (pct ? pct + '%' : '未读')))),
        el('button', {
          class: 'book-more', title: '更多操作',
          onclick: (e) => { e.stopPropagation(); this.menu(e, b); }
        }, '⋯'));
      return card;
    },

    menu(ev, b) {
      const r = ev.currentTarget.getBoundingClientRect();
      showMenu(r.left, r.bottom + 4, [
        { icon: '📖', label: '打开 / 继续阅读', onclick: () => window.BW.App.openReader(b.id) },
        { icon: '✏️', label: '编辑信息 / 分类', onclick: () => this.editBookDialog(b) },
        Store.getNotes(b.id).length ? { icon: '📤', label: '导出笔记 (Markdown)', onclick: () => window.BW.Notes.exportMD(b) } : null,
        '-',
        { icon: '🗑', label: '删除书籍及笔记', danger: true, onclick: () => this.confirmDelete(b) }
      ]);
    },

    editBookDialog(b, afterImportMode) {
      return new Promise((resolve) => {
        const cats = this.categories();
        const titleIn = el('input', { class: 'input', value: b.title || '' });
        const authorIn = el('input', { class: 'input', value: b.author || '', placeholder: '未知作者可留空' });
        const catIn = el('input', { class: 'input', value: b.category || '', placeholder: '输入分类名，留空为「未分类」' });
        const list = el('div', { class: 'cat-quick' },
          cats.map(c => el('button', {
            class: 'chip' + (b.category === c ? ' active' : ''),
            onclick: () => { catIn.value = c; }
          }, c)));
        const save = async () => {
          const newTitle = titleIn.value.trim() || b.title;
          const patch = {
            title: newTitle,
            author: authorIn.value.trim(),
            category: catIn.value.trim()
          };
          // 程序生成的封面跟随书名/作者重绘
          if (b.coverGen && (patch.title !== b.title || patch.author !== b.author)) {
            patch.cover = window.BW.Covers.genCover(patch.title, patch.author, b.format);
          }
          await Store.updateBook(b.id, patch);
          Object.assign(b, patch);
          closeModal();
          this.render();
          if (window.BW.Reader.book && window.BW.Reader.book.id === b.id) {
            $('#rd-title').textContent = patch.title;
          }
          resolve();
        };
        openModal({
          title: (afterImportMode ? '导入成功，编辑这本书 — ' : '编辑信息 — ') + String(b.title).slice(0, 18),
          body: el('div', {},
            el('div', { class: 'field-label' }, '书名'), titleIn,
            el('div', { class: 'field-label' }, '作者'), authorIn,
            el('div', { class: 'field-label' }, '分类'), catIn,
            cats.length ? el('div', { class: 'field-label' }, '现有分类') : null, list),
          actions: [
            el('button', { class: 'btn ghost', onclick: () => { closeModal(); resolve(); } }, afterImportMode ? '跳过' : '取消'),
            el('button', { class: 'btn primary', onclick: save }, '保存')
          ]
        });
        setTimeout(() => { catIn.focus(); }, 80);
      });
    },

    confirmDelete(b) {
      const noteCount = Store.getNotes(b.id).length;
      openModal({
        title: '删除书籍',
        body: el('div', { class: 'confirm-body' },
          el('p', {}, `确定要删除《${b.title}》吗？`),
          el('p', { class: 'dim' }, `将同时删除原文件副本、阅读进度${noteCount ? `、${noteCount} 条笔记与书签` : ''}，此操作不可恢复。`)),
        actions: [
          el('button', { class: 'btn ghost', onclick: () => closeModal() }, '取消'),
          el('button', {
            class: 'btn danger', onclick: async () => {
              closeModal();
              await Store.removeBook(b.id);
              toast(`已删除《${b.title}》`);
              this.render();
            }
          }, '删除')
        ]
      });
    }
  };

  /* ---------- 导入 ---------- */
  async function importOne(entry) {
    const buf = entry.buf || await window.bw.readBookFile(entry.absPath);
    const parsed = await window.BW.Parsers.parseBuffer(buf, entry.ext, entry.name);
    let cover = parsed.cover || '';
    if (cover) { try { cover = await window.BW.Parsers.downscaleCover(cover); } catch (e) {} }
    const meta = {
      id: entry.id,
      title: parsed.title || window.BW.Parsers.cleanName(entry.name),
      author: parsed.author || '',
      format: parsed.format,
      category: '',
      cover,
      coverGen: !parsed.cover,   // 封面是否为程序生成(改名后需要重绘)
      addedAt: Date.now(),
      lastReadAt: 0,
      progress: null,
      wordCount: parsed.wordCount || 0,
      chapterCount: parsed.chapterCount || 0
    };
    if (!meta.cover) meta.cover = window.BW.Covers.genCover(meta.title, meta.author, meta.format);
    await window.bw.writeBookData(entry.id, 'content.json', JSON.stringify({ format: parsed.format, chapters: parsed.chapters }));
    await Store.addBook(meta);
    return meta;
  }

  async function importFromPaths(paths, opts) {
    if (!paths || !paths.length) return [];
    const created = [];
    let fail = 0;
    toast(`开始导入 ${paths.length} 个文件…`);
    for (const p of paths) {
      try {
        const entries = await window.bw.importFiles([p]);
        const entry = entries && entries[0];
        if (!entry || entry.error) throw new Error((entry && entry.error) || '导入失败');
        created.push(await importOne({ id: entry.id, absPath: entry.absPath, name: entry.name, ext: entry.ext }));
      } catch (err) {
        fail++;
        console.error('导入失败:', p, err);
        toast(`导入失败: ${(err && err.message) || err}`, 'error');
      }
    }
    if (created.length) toast(`成功导入 ${created.length} 本${fail ? `，${fail} 本失败` : ''}`);
    Lib.render();
    await afterImport(created, opts);
    return created;
  }

  /* 网页 / 安卓: 从浏览器 File 对象导入 */
  async function importFromFiles(files, opts) {
    if (!files || !files.length) return [];
    const created = [];
    let fail = 0;
    toast(`开始导入 ${files.length} 个文件…`);
    for (const f of files) {
      try {
        const ext = (f.name.match(/\.([a-z0-9]+)$/i) || [])[1] || '';
        if (!['txt', 'epub', 'pdf', 'docx', 'mobi', 'azw', 'azw3', 'md', 'markdown', 'html', 'htm'].includes(ext.toLowerCase())) {
          throw new Error('不支持的格式: .' + ext);
        }
        const id = 'bk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const buf = new Uint8Array(await f.arrayBuffer());
        created.push(await importOne({ id, buf, ext: ext.toLowerCase(), name: f.name }));
      } catch (err) {
        fail++;
        console.error('导入失败:', f.name, err);
        toast(`导入失败: ${(err && err.message) || err}`, 'error');
      }
    }
    if (created.length) toast(`成功导入 ${created.length} 本${fail ? `，${fail} 本失败` : ''}`);
    Lib.render();
    await afterImport(created, opts);
    return created;
  }

  /* 导入完成后逐本弹出信息编辑 */
  async function afterImport(created, opts) {
    if (!created || !created.length) return;
    if (opts && opts.skipEdit) return;
    let rest = created.slice();
    while (rest.length) {
      const b = rest[0];
      rest = rest.slice(1);
      await Lib.editBookDialog(b, true);
    }
  }

  function init() {
    const search = $('#lib-search');
    const doSearch = window.BW.debounce(() => { Lib.query = search.value; Lib.render(); }, 200);
    search.addEventListener('input', doSearch);
    search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; Lib.query = ''; Lib.render(); } });

    $('#btn-import').addEventListener('click', async () => {
      const r = await window.bw.selectAndImport();
      if (r.canceled) return;
      if (r.files && r.files.length) window.BW.importFromFiles(r.files);
      else if (r.paths && r.paths.length) window.BW.importFromPaths(r.paths);
    });
    $('#lib-sort').addEventListener('change', (e) => { Lib.sort = e.target.value; Lib.render(); });

    // 拖放导入
    const root = $('#view-library');
    let dragDepth = 0;
    document.addEventListener('dragenter', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
        dragDepth++; root.classList.add('dragging');
      }
    });
    document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; root.classList.remove('dragging'); } });
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', async (e) => {
      e.preventDefault(); dragDepth = 0; root.classList.remove('dragging');
      const files = Array.from(e.dataTransfer.files || []);
      if (!files.length) return;
      if (window.BW.PLATFORM === 'electron') {
        const paths = files.map(f => window.bw.pathForFile(f)).filter(Boolean);
        if (paths.length) importFromPaths(paths);
      } else {
        window.BW.importFromFiles(files);
      }
    });
  }

  window.BW.Lib = Lib;
  window.BW.importFromPaths = importFromPaths;
  window.BW.importFromFiles = importFromFiles;
  window.BW.LibInit = init;
})();
