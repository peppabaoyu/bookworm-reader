'use strict';
/* 书虫 - 查词卡: 牛津式词典条目 (音标/释义/例句/同义词/形近词) + 生词本
   双击可嵌套查询卡内任何单词; 短语/整句走翻译通道 */
(function () {
  const { $, el, clamp, toast, Store } = window.BW;

  const ENGINES = {
    bing: { name: 'Bing', url: q => 'https://www.bing.com/search?q=' + encodeURIComponent(q) },
    baidu: { name: '百度', url: q => 'https://www.baidu.com/s?wd=' + encodeURIComponent(q) },
    google: { name: 'Google', url: q => 'https://www.google.com/search?q=' + encodeURIComponent(q) },
    wiki: { name: '维基百科', url: q => 'https://en.wikipedia.org/w/index.php?search=' + encodeURIComponent(q) }
  };

  function searchInBrowser(text) {
    const engine = Store.settings.searchEngine || 'bing';
    const url = (ENGINES[engine] || ENGINES.bing).url(text.trim().slice(0, 300));
    window.bw.openExternal(url);
  }

  const Trans = {
    _pop: null,
    _history: [],

    /* ---------- 入口 ---------- */
    async show(text, rect, opts) {
      text = String(text || '').trim().slice(0, 600);
      if (!text) return;
      const isWord = /^[A-Za-z][A-Za-z'’-]*$/.test(text);
      if (isWord) {
        await window.BW.Dictionary.ensure();
        const entry = window.BW.Dictionary.lookup(text);
        if (entry) { this._showDict(entry, rect, opts); return; }
      }
      this._showTranslate(text, rect, opts);
    },

    _mount(pop, rect) {
      this.hide();
      this._pop = pop;
      pop.addEventListener('mousedown', e => e.stopPropagation());
      document.body.appendChild(pop);
      const r = pop.getBoundingClientRect();
      pop.style.left = clamp((rect ? rect.left + rect.width / 2 : window.innerWidth / 2) - r.width / 2, 10, window.innerWidth - r.width - 10) + 'px';
      pop.style.top = clamp((rect ? rect.bottom + 10 : 120), 56, Math.max(60, window.innerHeight - r.height - 10)) + 'px';
    },

    /* ---------- 词典卡 (牛津式) ---------- */
    _showDict(entry, rect, opts) {
      const D = window.BW.Dictionary;
      const pop = el('div', { class: 'trans-pop dict-pop' });
      const R = window.BW.Reader;
      const bookId = R.book ? R.book.id : '';
      const bookTitle = R.book ? R.book.title : '';

      // 头部: 单词 + 发音 + 生词本 + 关闭
      const head = el('div', { class: 'dp-head' },
        el('div', { class: 'dp-word' },
          el('span', { class: 'dp-w', title: '双击卡片内单词可继续查询' }, entry.word),
          el('button', { class: 'icon-btn dp-play', title: '播放读音', onclick: () => window.BW.TTS.speakSelection(entry.word) }, '🔊')),
        el('div', { class: 'dp-head-ops' },
          el('button', {
            class: 'icon-btn dp-star' + (Store.isVocabStarred(entry.word, bookId) ? ' on' : ''),
            title: Store.isVocabStarred(entry.word, bookId) ? '从生词本移除' : '加入生词本',
            onclick: async (e) => {
              const btn = e.currentTarget;
              if (Store.isVocabStarred(entry.word, bookId)) {
                await Store.removeVocab(entry.word, bookId);
                btn.classList.remove('on');
                toast('已移出生词本');
              } else {
                await Store.addVocab(entry.word, bookId, bookTitle);
                btn.classList.add('on');
                toast('已加入生词本' + (bookTitle ? `（《${bookTitle.slice(0, 12)}》）` : ''));
                if (window.BW.Notes.panelOpen() && window.BW.Notes.tab === 'vocab') window.BW.Notes.renderPanel();
              }
            }
          }, '★'),
          el('button', { class: 'icon-btn', onclick: () => this.hide() }, '✕')));
      pop.appendChild(head);

      // 音标
      if (entry.phonetic) {
        pop.appendChild(el('div', { class: 'dp-phon' },
          el('span', {}, '/' + entry.phonetic.replace(/^\/|\/$/g, '') + '/'),
          el('button', { class: 'icon-btn dp-mini-play', title: '播放', onclick: () => window.BW.TTS.speakSelection(entry.word) }, '▶')));
      }

      // 中文释义 (按词性分条)
      if (entry.zh) {
        const zhBox = el('div', { class: 'dp-zh' });
        entry.zh.split('⏎').filter(s => s.trim()).slice(0, 8).forEach(line => {
          zhBox.appendChild(el('div', { class: 'dp-sense dbl' }, line.trim()));
        });
        pop.appendChild(zhBox);
      }

      // 英文释义
      if (entry.en) {
        pop.appendChild(el('div', { class: 'dp-en' }, entry.en.slice(0, 260)));
      }

      // 文中例句 (原句 + 机器翻译异步填充)
      if (opts && opts.sentence) {
        const box = el('div', { class: 'dp-sentence' },
          el('div', { class: 'dp-s-en dbl' }, opts.sentence),
          el('div', { class: 'dp-s-zh dim' }, '翻译中…'));
        pop.appendChild(box);
        window.bw.translate([opts.sentence], { customBase: Store.settings.customTranslateBase })
          .then(resp => { const zhBox = $('.dp-s-zh', box); if (zhBox) zhBox.textContent = resp.results[0] || ''; })
          .catch(() => { const zhBox = $('.dp-s-zh', box); if (zhBox) zhBox.textContent = '（例句翻译不可用）'; });
      }

      // 词形变化
      if (entry.exchange.length) {
        const row = el('div', { class: 'dp-row' }, el('span', { class: 'dp-label' }, '词形'));
        for (const f of entry.exchange.slice(0, 6)) {
          row.appendChild(el('span', { class: 'dp-chip dbl-chip', title: f.label, onclick: () => this.lookupWord(f.w, opts) }, f.w));
        }
        pop.appendChild(row);
      }

      // 同义词
      if (entry.synonyms && entry.synonyms.length) {
        const row = el('div', { class: 'dp-row' }, el('span', { class: 'dp-label' }, '同义词'));
        for (const s of entry.synonyms.slice(0, 10)) {
          row.appendChild(el('span', { class: 'dp-chip dbl-chip', onclick: () => this.lookupWord(s, opts) }, s));
        }
        pop.appendChild(row);
      }

      // 形近词
      if (entry.similar && entry.similar.length) {
        const row = el('div', { class: 'dp-row' }, el('span', { class: 'dp-label' }, '形近词'));
        for (const s of entry.similar.slice(0, 8)) {
          row.appendChild(el('span', { class: 'dp-chip dbl-chip', onclick: () => this.lookupWord(s, opts) }, s));
        }
        pop.appendChild(row);
      }

      // 底部: 历史返回 + 浏览器搜索
      const ops = el('div', { class: 'tp-ops' });
      if (this._history.length) {
        ops.appendChild(el('button', {
          class: 'btn tiny ghost', onclick: () => {
            const prev = this._history.pop();
            this.lookupWord(prev.word, prev.opts, true);
          }
        }, '← ' + (this._history[this._history.length - 1] || { word: '' }).word.slice(0, 14)));
      }
      ops.appendChild(el('button', { class: 'btn tiny', title: '播放读音', onclick: () => window.BW.TTS.speakSelection(entry.word) }, '🔊 朗读'));
      for (const key of Object.keys(ENGINES)) {
        ops.appendChild(el('button', { class: 'btn tiny ghost', onclick: () => window.bw.openExternal(ENGINES[key].url(entry.word)) }, ENGINES[key].name));
      }
      pop.appendChild(ops);

      pop.addEventListener('dblclick', (e) => {
        const w = this._wordAt(e.clientX, e.clientY, pop);
        if (w && w !== entry.word) this.lookupWord(w, opts);
      });
      this._mount(pop, rect);
    },

    /* ---------- 翻译卡 (短语/句子/未收录词) ---------- */
    _showTranslate(text, rect, opts) {
      const pop = el('div', { class: 'trans-pop' });
      pop.appendChild(el('div', { class: 'tp-orig', title: text }, text));
      const resultBox = el('div', { class: 'tp-result' }, el('span', { class: 'dim' }, '翻译中…'));
      pop.appendChild(resultBox);
      const dictBox = el('div', { class: 'tp-dict' });
      pop.appendChild(dictBox);
      const ops = el('div', { class: 'tp-ops' });
      ops.appendChild(el('button', { class: 'btn tiny', title: '朗读', onclick: () => window.BW.TTS.speakSelection(text) }, '🔊'));
      ops.appendChild(el('button', {
        class: 'btn tiny', onclick: async () => {
          try { await navigator.clipboard.writeText(currentZh); toast('已复制译文'); } catch (e) {}
        }
      }, '复制'));
      for (const key of Object.keys(ENGINES)) {
        ops.appendChild(el('button', { class: 'btn tiny ghost', onclick: () => window.bw.openExternal(ENGINES[key].url(text.slice(0, 120))) }, ENGINES[key].name));
      }
      pop.appendChild(ops);
      pop.addEventListener('dblclick', (e) => {
        const w = this._wordAt(e.clientX, e.clientY, pop);
        if (w) this.lookupWord(w, opts);
      });
      this._mount(pop, rect);

      let currentZh = '';
      window.bw.translate([text], { customBase: Store.settings.customTranslateBase })
        .then(resp => {
          currentZh = resp.results[0] || '';
          resultBox.innerHTML = '';
          resultBox.appendChild(el('div', { class: 'tp-zh' }, currentZh || '(无结果)'));
          if (resp.provider) resultBox.appendChild(el('div', { class: 'tp-provider' }, '来源: ' + resp.provider));
        })
        .catch(err => {
          resultBox.innerHTML = '';
          resultBox.appendChild(el('div', { class: 'tp-zh err' }, String(err && err.message || err)));
        });

      const isWord = /^[A-Za-z][A-Za-z'’-]*$/.test(text);
      if (isWord) {
        window.bw.lookupDictionary(text.toLowerCase()).then(d => {
          if (!d) return;
          dictBox.innerHTML = '';
          if (d.phonetic) dictBox.appendChild(el('div', { class: 'tp-phon' }, '/' + d.phonetic.replace(/^\/|\/$/g, '') + '/'));
          for (const m of d.meanings || []) {
            dictBox.appendChild(el('div', { class: 'tp-mean' },
              el('span', { class: 'tp-pos' }, m.pos),
              el('span', {}, (m.def || []).join('； ').slice(0, 140))));
          }
        });
      }
    },

    /* ---------- 嵌套查询 ---------- */
    async lookupWord(word, opts, fromHistory) {
      word = String(word || '').trim();
      if (!word) return;
      if (!fromHistory && this._pop && this._pop.querySelector('.dp-w')) {
        this._history.push({ word: this._pop.querySelector('.dp-w').textContent, opts });
        if (this._history.length > 12) this._history.shift();
      }
      window.BW.TTS.speakSelection(word);
      await window.BW.Dictionary.ensure();
      const entry = window.BW.Dictionary.lookup(word);
      if (entry) this._showDict(entry, this._lastRect || null, opts || {});
      else this._showTranslate(word, this._lastRect || null, opts || {});
    },

    _wordAt(x, y, root) {
      const r = document.caretRangeFromPoint(x, y);
      if (!r || !root.contains(r.startContainer)) return null;
      const node = r.startContainer.nodeType === 3 ? r.startContainer : null;
      if (!node) return null;
      const text = node.data;
      let start = r.startOffset, end = r.startOffset;
      while (start > 0 && /[A-Za-z'’-]/.test(text[start - 1])) start--;
      while (end < text.length && /[A-Za-z'’-]/.test(text[end])) end++;
      const w = text.slice(start, end).replace(/^[’'-]+|[’'-]+$/g, '');
      return /^[A-Za-z][A-Za-z'’-]*$/.test(w) ? w : null;
    },

    hide() { if (this._pop) { this._pop.remove(); this._pop = null; } if (this._history) this._history = []; }
  };

  document.addEventListener('mousedown', (e) => {
    if (Trans._pop && !Trans._pop.contains(e.target)) Trans.hide();
    if (window.BW.Annotate && window.BW.Annotate.hidePop) window.BW.Annotate.hidePop();
  });
  document.addEventListener('wheel', () => { Trans.hide(); }, { passive: true });

  window.BW.Trans = Trans;
  window.BW.searchInBrowser = searchInBrowser;
  window.BW.ENGINES = ENGINES;
})();
