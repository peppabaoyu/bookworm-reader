'use strict';
/* 书虫 - 翻译: 选中弹窗 + 单词发音 + 浏览器搜索 */
(function () {
  const { $, el, clamp, toast } = window.BW;

  const ENGINES = {
    bing: { name: 'Bing', url: q => 'https://www.bing.com/search?q=' + encodeURIComponent(q) },
    baidu: { name: '百度', url: q => 'https://www.baidu.com/s?wd=' + encodeURIComponent(q) },
    google: { name: 'Google', url: q => 'https://www.google.com/search?q=' + encodeURIComponent(q) },
    wiki: { name: '维基百科', url: q => 'https://en.wikipedia.org/w/index.php?search=' + encodeURIComponent(q) }
  };

  function searchInBrowser(text) {
    const engine = window.BW.Store.settings.searchEngine || 'bing';
    const url = (ENGINES[engine] || ENGINES.bing).url(text.trim().slice(0, 300));
    window.bw.openExternal(url);
  }

  const Trans = {
    _pop: null,

    async show(text, rect) {
      text = String(text || '').trim().slice(0, 600);
      if (!text) return;
      this.hide();
      const pop = this._pop = el('div', { class: 'trans-pop' });
      pop.appendChild(el('div', { class: 'tp-orig', title: text }, text));

      const resultBox = el('div', { class: 'tp-result' }, el('span', { class: 'dim' }, '翻译中…'));
      pop.appendChild(resultBox);
      const dictBox = el('div', { class: 'tp-dict' });
      pop.appendChild(dictBox);

      // 操作行
      const ops = el('div', { class: 'tp-ops' });
      const playBtn = el('button', { class: 'btn tiny', title: '朗读原句', onclick: () => window.BW.TTS.speakSelection(text) }, '🔊 朗读');
      const copyBtn = el('button', {
        class: 'btn tiny', onclick: async () => {
          try { await navigator.clipboard.writeText(currentZh); toast('已复制译文'); } catch (e) {}
        }
      }, '复制');
      ops.appendChild(playBtn);
      ops.appendChild(copyBtn);
      // 引擎快捷
      for (const key of Object.keys(ENGINES)) {
        ops.appendChild(el('button', {
          class: 'btn tiny ghost', onclick: () => {
            window.bw.openExternal(ENGINES[key].url(text.slice(0, 120)));
          }
        }, ENGINES[key].name));
      }
      pop.appendChild(ops);
      document.body.appendChild(pop);
      pop.addEventListener('mousedown', e => e.stopPropagation());
      const r = pop.getBoundingClientRect();
      pop.style.left = clamp((rect ? rect.left + rect.width / 2 : window.innerWidth / 2) - r.width / 2, 10, window.innerWidth - r.width - 10) + 'px';
      pop.style.top = clamp((rect ? rect.bottom + 10 : 120), 60, window.innerHeight - r.height - 10) + 'px';

      let currentZh = '';
      try {
        const resp = await window.bw.translate([text], { customBase: window.BW.Store.settings.customTranslateBase });
        currentZh = resp.results[0] || '';
        resultBox.innerHTML = '';
        resultBox.appendChild(el('div', { class: 'tp-zh' }, currentZh || '(无结果)'));
        if (resp.provider) resultBox.appendChild(el('div', { class: 'tp-provider' }, '来源: ' + resp.provider));
      } catch (err) {
        resultBox.innerHTML = '';
        resultBox.appendChild(el('div', { class: 'tp-zh err' }, String(err && err.message || err)));
      }

      // 单词附加词典信息
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

    hide() { if (this._pop) { this._pop.remove(); this._pop = null; } }
  };

  // 点击别处关闭
  document.addEventListener('mousedown', (e) => {
    if (Trans._pop && !Trans._pop.contains(e.target)) Trans.hide();
    if (window.BW.Annotate) window.BW.Annotate.hidePop && window.BW.Annotate.hidePop();
  });
  // 滚动/翻页时关闭弹层
  document.addEventListener('wheel', () => { Trans.hide(); }, { passive: true });

  window.BW.Trans = Trans;
  window.BW.searchInBrowser = searchInBrowser;
  window.BW.ENGINES = ENGINES;
})();
