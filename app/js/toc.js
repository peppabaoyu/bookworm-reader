'use strict';
/* 书虫 - 目录面板 */
(function () {
  const { $, el } = window.BW;

  const Toc = {
    open() {
      window.BW.Search.close();
      window.BW.Notes.closePanel();
      const p = $('#toc-panel');
      if (!p.hidden) { p.hidden = true; return; }
      p.hidden = false;
      this.render();
    },
    close() { const p = $('#toc-panel'); if (p) p.hidden = true; },

    render() {
      const R = window.BW.Reader;
      const list = $('.toc-list', $('#toc-panel'));
      list.innerHTML = '';
      R.chapters.forEach((ch, i) => {
        const item = el('div', { class: 'toc-item', 'data-ci': String(i), title: ch.title },
          el('span', { class: 'toc-n' }, String(i + 1)),
          el('span', { class: 'toc-t' }, ch.title || `第 ${i + 1} 节`));
        item.addEventListener('click', () => {
          window.BW.Reader.gotoG(window.BW.Reader.chapterStartG(i));
          this.setActive(i);
        });
        list.appendChild(item);
      });
      const g = typeof R._lastG === 'number' ? R._lastG : 0;
      this.setActive(R.chapterOfG(g));
    },

    setActive(ci) {
      const list = $('.toc-list');
      if (!list) return;
      for (const it of list.children) {
        it.classList.toggle('active', +it.dataset.ci === ci);
      }
      const cur = list.querySelector('.toc-item.active');
      if (cur && !$('#toc-panel').hidden) {
        const r = cur.getBoundingClientRect();
        const pr = list.getBoundingClientRect();
        if (r.top < pr.top || r.bottom > pr.bottom) cur.scrollIntoView({ block: 'nearest' });
      }
    }
  };

  window.BW.Toc = Toc;
})();
