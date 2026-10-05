'use strict';
/* 书虫 - 通用工具 */
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') n.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (k === 'html') n.innerHTML = v;
        else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return n;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function debounce(fn, ms) {
    let t = null;
    return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  }

  function uuid() {
    return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (sameDay) return `今天 ${hm}`;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  }

  function fmtNow() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  let toastWrap = null;
  function toast(msg, type) {
    if (!toastWrap) { toastWrap = el('div', { class: 'toast-wrap' }); document.body.appendChild(toastWrap); }
    const t = el('div', { class: 'toast ' + (type || '') }, msg);
    toastWrap.appendChild(t);
    setTimeout(() => { t.classList.add('show'); }, 10);
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 350);
    }, type === 'error' ? 4200 : 2400);
  }

  /* ---------- modal ---------- */
  let modalMask = null;
  function openModal(opts) {
    closeModal();
    modalMask = el('div', { class: 'modal-mask' },
      el('div', { class: 'modal' + (opts.cls ? ' ' + opts.cls : '') },
        el('div', { class: 'modal-head' },
          el('div', { class: 'modal-title' }, opts.title || ''),
          el('button', { class: 'icon-btn modal-x', onclick: () => closeModal() }, '✕')),
        el('div', { class: 'modal-body' }, opts.body || ''),
        opts.actions ? el('div', { class: 'modal-foot' }, opts.actions) : null
      ));
    modalMask.addEventListener('mousedown', (e) => { if (e.target === modalMask && opts.maskClose !== false) closeModal(); });
    document.body.appendChild(modalMask);
    return modalMask;
  }
  function closeModal() { if (modalMask) { modalMask.remove(); modalMask = null; } }
  function modalOpen() { return !!modalMask; }

  /* ---------- context menu ---------- */
  let ctxMenu = null;
  function showMenu(x, y, items) {
    hideMenu();
    ctxMenu = el('div', { class: 'ctx-menu' },
      items.filter(Boolean).map(it => it === '-' ? el('div', { class: 'ctx-sep' }) :
        el('div', { class: 'ctx-item' + (it.danger ? ' danger' : ''), onclick: () => { hideMenu(); it.onclick && it.onclick(); } },
          it.icon ? el('span', { class: 'ctx-ico' }, it.icon) : null, it.label)));
    document.body.appendChild(ctxMenu);
    const r = ctxMenu.getBoundingClientRect();
    ctxMenu.style.left = clamp(x, 8, window.innerWidth - r.width - 8) + 'px';
    ctxMenu.style.top = clamp(y, 8, window.innerHeight - r.height - 8) + 'px';
  }
  function hideMenu() { if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; } }
  document.addEventListener('mousedown', (e) => { if (ctxMenu && !ctxMenu.contains(e.target)) hideMenu(); });

  window.BW = window.BW || {};
  Object.assign(window.BW, { $, $$, el, escapeHtml, debounce, uuid, clamp, fmtTime, fmtNow, toast, openModal, closeModal, modalOpen, showMenu, hideMenu });
})();
