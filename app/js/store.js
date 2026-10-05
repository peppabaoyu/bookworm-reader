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
    loaded: false,

    async init() {
      const [books, settings, notes] = await Promise.all([
        window.bw.loadStore('library.json'),
        window.bw.loadStore('settings.json'),
        window.bw.loadStore('notes.json')
      ]);
      this.books = Array.isArray(books) ? books : [];
      this.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
      this.notes = notes || {};
      // 清理孤儿数据
      const ids = new Set(this.books.map(b => b.id));
      for (const k of Object.keys(this.notes)) if (!ids.has(k)) delete this.notes[k];
      this.loaded = true;
    },

    async saveLibrary() { await window.bw.saveStore('library.json', this.books); },
    async saveSettings() { await window.bw.saveStore('settings.json', this.settings); },
    async saveNotes() { await window.bw.saveStore('notes.json', this.notes); },

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
    }
  };

  window.BW.Store = Store;
})();
