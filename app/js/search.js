'use strict';
/* 书虫 - 全文搜索 (Ctrl+F) + 系统浏览器选中搜索 */
(function () {
  const { $, el, toast } = window.BW;

  const Search = {
    results: [],

    open() {
      $('#toc-panel').hidden = true;
      $('#notes-panel').hidden = true;
      $('#search-panel').hidden = false;
      const input = $('#sp-input');
      input.focus();
      input.select();
      if (input.value) this.run(input.value);
    },

    close() { const p = $('#search-panel'); if (p) p.hidden = true; },

    async run(qRaw) {
      const R = window.BW.Reader;
      const q = qRaw.trim();
      const listEl = $('#sp-results');
      const metaEl = $('#sp-meta');
      listEl.innerHTML = '';
      if (!q || !R.book) { metaEl.textContent = ''; return; }
      const lowerQ = q.toLowerCase();
      const text = R.getFullText().toLowerCase();
      const t0 = performance.now();
      const results = [];
      let pos = 0;
      while (results.length < 300) {
        const i = text.indexOf(lowerQ, pos);
        if (i < 0) break;
        results.push(i);
        pos = i + Math.max(1, lowerQ.length);
      }
      this.results = results.map(g0 => {
        const g = g0;
        const ci = R.chapterOfG(g);
        const ch = R.chapters[ci];
        const raw = R.getFullText(); // 原文大小写
        const snippet = raw.slice(Math.max(0, g - 36), g).replace(/\s+/g, ' ') +
          '⟪' + raw.slice(g, g + q.length) + '⟫' +
          raw.slice(g + q.length, g + q.length + 44).replace(/\s+/g, ' ');
        return { g, ci, chapter: (ch && ch.title) || '正文', snippet };
      });
      // getFullText 调两次太浪费, 简化: 上面循环已经生成 (小优化略过)
      const ms = Math.round(performance.now() - t0);
      metaEl.textContent = results.length ? `找到 ${results.length} 处${results.length >= 300 ? '（显示前 300 条）' : ''} · ${ms}ms` : '没有找到';
      if (!results.length) return;
      const frag = document.createDocumentFragment();
      for (const r of this.results) {
        const item = el('div', { class: 'sp-item' },
          el('div', { class: 'sp-ch' }, r.chapter),
          el('div', { class: 'sp-snippet' }));
        const [before, hit, after] = r.snippet.split('⟪');
        const [hitText, afterText] = [hit, after && after.replace('⟫', '')];
        item.lastChild.appendChild(document.createTextNode(before));
        item.lastChild.appendChild(el('mark', {}, hitText || ''));
        item.lastChild.appendChild(document.createTextNode(afterText || ''));
        item.addEventListener('click', () => {
          window.BW.Reader.gotoG(r.g, { save: false });
          window.BW.Reader.flashRange(r.g, r.g + q.length);
        });
        frag.appendChild(item);
      }
      listEl.appendChild(frag);
    }
  };

  function init() {
    const input = $('#sp-input');
    let t = null;
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => Search.run(input.value), 250); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') Search.close(); });
    $('#sp-close').addEventListener('click', () => Search.close());
  }

  window.BW.Search = Search;
  window.BW.SearchInit = init;
})();
