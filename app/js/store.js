'use strict';
/* 书虫 - 数据存储 (library.json / settings.json / notes.json) */
(function () {
  const { $, toast } = window.BW;

  const DEFAULT_SETTINGS = {
    font: 'kaiti',          // kaiti | system | song | hei
    fontSize: 20,           // 14-36
    lineHeight: 1.75,
    theme: 'night',         // night | day | eye
    dayBg: '#f5efe2',       // 自定义日间背景
    mode: 'paged',          // paged | scroll
    searchEngine: 'bing',   // bing | baidu | google | wiki
    ttsVoice: '',           // voice name
    ttsRate: 1,             // 0.5-2
    customTranslateBase: '',// 自定义翻译接口(兼容 google translate_a/single)
    bilingual: false
  };

  const Store = {
    books: [],
    settings: { ...DEFAULT_SETTINGS },
    notes: {},              // {bookId: [note]}
    vocab: [],              // 生词本: [{word, bookId, bookTitle, addedAt, cats: []}]
    vocabCats: [],          // 自定义生词分类: ['考研核心', '生物学', ...]
    loaded: false,

    async init() {
      const [books, settings, notes, vocab, vocabCats] = await Promise.all([
        window.bw.loadStore('library.json'),
        window.bw.loadStore('settings.json'),
        window.bw.loadStore('notes.json'),
        window.bw.loadStore('vocab.json'),
        window.bw.loadStore('vocab-cats.json')
      ]);
      this.books = Array.isArray(books) ? books : [];
      this.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
      this.notes = notes || {};
      this.vocab = Array.isArray(vocab) ? vocab : [];
      this.vocabCats = Array.isArray(vocabCats) ? vocabCats : [];
      // 清理孤儿数据
      const ids = new Set(this.books.map(b => b.id));
      for (const k of Object.keys(this.notes)) if (!ids.has(k)) delete this.notes[k];
      this.loaded = true;
    },

    async saveLibrary() { await window.bw.saveStore('library.json', this.books); },
    async saveSettings() { await window.bw.saveStore('settings.json', this.settings); },
    async saveNotes() { await window.bw.saveStore('notes.json', this.notes); },
    async saveVocab() {
      await window.bw.saveStore('vocab.json', this.vocab);
      await window.bw.saveStore('vocab-cats.json', this.vocabCats);
    },

    getBook(id) { return this.books.find(b => b.id === id) || null; },

    async addBook(meta) {
      this.books.push(meta);
      await this.saveLibrary();
    },

    async updateBook(id, patch) {
      const b = this.getBook(id);
      if (!b) return;
      Object.assign(b, patch);
      await this.saveLibrary();
    },

    async removeBook(id) {
      this.books = this.books.filter(b => b.id !== id);
      delete this.notes[id];
      await Promise.all([this.saveLibrary(), this.saveNotes(), window.bw.deleteBookFiles(id)]);
    },

    getNotes(bookId) { return this.notes[bookId] || []; },
    async setNotes(bookId, list) {
      if (list.length) this.notes[bookId] = list;
      else delete this.notes[bookId];
      await this.saveNotes();
    },
    async addNote(bookId, note) {
      const list = this.getNotes(bookId);
      list.push(note);
      await this.setNotes(bookId, list);
      return note;
    },
    async updateNote(bookId, noteId, patch) {
      const n = this.getNotes(bookId).find(x => x.id === noteId);
      if (n) { Object.assign(n, patch); await this.saveNotes(); }
      return n;
    },
    async removeNote(bookId, noteId) {
      await this.setNotes(bookId, this.getNotes(bookId).filter(n => n.id !== noteId));
    },

    lastReadBook() {
      return this.books
        .filter(b => b.progress && b.progress.updatedAt)
        .sort((a, b) => b.progress.updatedAt - a.progress.updatedAt)[0] || null;
    },

    /* ---------- 生词本 ---------- */
    isVocabStarred(word, bookId) {
      const w = String(word || '').toLowerCase().trim();
      return this.vocab.some(v => v.word === w && (!bookId || v.bookId === bookId));
    },
    async addVocab(word, bookId, bookTitle) {
      const w = String(word || '').toLowerCase().trim();
      if (!w) return null;
      if (this.isVocabStarred(w, bookId)) return null;
      const entry = { word: w, bookId: bookId || '', bookTitle: bookTitle || '', addedAt: Date.now(), cats: [] };
      this.vocab.push(entry);
      await this.saveVocab();
      return entry;
    },
    async removeVocab(word, bookId) {
      const w = String(word || '').toLowerCase().trim();
      this.vocab = this.vocab.filter(v => !(v.word === w && (!bookId || v.bookId === bookId)));
      await this.saveVocab();
    },
    async assignVocabCat(word, cat, on) {
      const w = String(word || '').toLowerCase().trim();
      for (const v of this.vocab) {
        if (v.word !== w) continue;
        v.cats = v.cats || [];
        if (on && !v.cats.includes(cat)) v.cats.push(cat);
        if (!on) v.cats = v.cats.filter(c => c !== cat);
      }
      await this.saveVocab();
    },
    async addVocabCat(cat) {
      const c = String(cat || '').trim();
      if (c && !this.vocabCats.includes(c)) { this.vocabCats.push(c); await this.saveVocab(); }
      return c;
    },
    async removeVocabCat(cat) {
      this.vocabCats = this.vocabCats.filter(c => c !== cat);
      for (const v of this.vocab) v.cats = (v.cats || []).filter(x => x !== cat);
      await this.saveVocab();
    },
    /* 全部生词按词聚合: 重复出现次数(跨书添加次数) */
    vocabAggregated() {
      const map = new Map();
      for (const v of this.vocab) {
        if (!map.has(v.word)) map.set(v.word, { word: v.word, count: 0, books: [], cats: new Set(), lastAt: 0 });
        const agg = map.get(v.word);
        agg.count++;
        if (v.bookTitle && !agg.books.includes(v.bookTitle)) agg.books.push(v.bookTitle);
        (v.cats || []).forEach(c => agg.cats.add(c));
        agg.lastAt = Math.max(agg.lastAt, v.addedAt || 0);
      }
      return Array.from(map.values()).sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
    }
  };

  window.BW.Store = Store;
})();
