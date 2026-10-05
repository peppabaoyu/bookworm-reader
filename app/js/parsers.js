'use strict';
/* 书虫 - 文档解析: TXT / EPUB / PDF / DOCX / MOBI / MD / HTML → 统一章节模型 */
(function () {
  const { escapeHtml } = window.BW;

  /* ---------- 外部库自愈式加载 ---------- */
  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => { s.remove(); reject(new Error('加载失败: ' + src)); };
      document.head.appendChild(s);
    });
  }

  async function ensureExternalLib(getter, rel, label) {
    if (getter()) return;
    // 依次尝试: app.asar.unpacked 路径 → asar 内路径
    const unpacked = location.href.replace(/app\.asar([\/\\])/, 'app.asar.unpacked$1');
    const candidates = [];
    if (unpacked !== location.href) candidates.push(new URL(rel, unpacked).href);
    candidates.push(new URL(rel, location.href).href);
    for (const c of candidates) {
      try { await loadScriptOnce(c); } catch (e) {}
      if (getter()) return;
    }
    throw new Error(label + '组件加载失败，请重启应用重试');
  }

  const ensureJsZip = () => ensureExternalLib(() => window.JSZip, 'js/pdfjs/jszip.min.js', 'ZIP 解压');
  const ensurePdfJs = () => ensureExternalLib(() => window.pdfjsLib, 'js/pdfjs/pdf.min.js', 'PDF 引擎');
  const ensurePdfWorker = () => ensureExternalLib(() => globalThis.pdfjsWorker, 'js/pdfjs/pdf.worker.min.js', 'PDF 引擎');

  /* ---------- 文本解码 ---------- */
  function decodeText(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(u8.slice(3));
    }
    if (u8.length >= 2 && ((u8[0] === 0xFF && u8[1] === 0xFE) || (u8[0] === 0xFE && u8[1] === 0xFF))) {
      return new TextDecoder('utf-16').decode(u8);
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); }
    catch (e) {
      try { return new TextDecoder('gb18030').decode(u8); }
      catch (e2) { return new TextDecoder('utf-8').decode(u8); }
    }
  }

  function isCJK(s) {
    const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
    return cjk > s.length * 0.15;
  }

  /* ---------- 章节组装 (TXT/DOCX/MOBI 共用) ---------- */
  const CHAPTER_LINE = /^\s*(chapter\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty).{0,40}|第\s*[0-9０-９一二三四五六七八九十百千零〇两]+\s*[章节卷部回篇讲].{0,30}|序章|楔子|序言|前言|自序|译序|后记|尾声|附录[一二三四五六七八九十]?\s*.{0,20}|prologue|epilogue|part\s+(one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|[0-9ivxlc]+).{0,40})\s*$/i;

  function assembleChapters(rawText) {
    let text = String(rawText || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/^\uFEFF/, '');
    const lines = text.split('\n');
    const marks = [];
    lines.forEach((ln, i) => {
      if (ln.trim().length > 0 && ln.trim().length <= 60 && CHAPTER_LINE.test(ln)) marks.push(i);
    });
    let chapters;
    if (marks.length >= 2 && marks[0] <= 30) {
      chapters = [];
      if (marks[0] > 0) {
        const pre = lines.slice(0, marks[0]).join('\n').trim();
        if (pre.length > 30) chapters.push({ title: '开篇', body: pre });
      }
      for (let i = 0; i < marks.length; i++) {
        const end = i + 1 < marks.length ? marks[i + 1] : lines.length;
        chapters.push({ title: lines[marks[i]].trim().replace(/^#+\s*/, ''), body: lines.slice(marks[i] + 1, end).join('\n') });
      }
    } else {
      chapters = [{ title: '正文', body: text }];
    }

    const hardBlank = /\n\s*\n/.test(text);
    const out = chapters.map((c, ci) => {
      let paras;
      if (hardBlank) {
        const groups = c.body.split(/\n\s*\n+/);
        paras = groups.map(g => g.split('\n').map(s => s.trim()).filter(Boolean).join(isCJK(g) ? '' : ' '));
      } else {
        paras = c.body.split('\n').map(s => s.trim()).filter(Boolean);
      }
      paras = paras.filter(p => p.length > 0);
      const html = paras.map(p => '<p>' + escapeHtml(p) + '</p>').join('\n');
      const t = paras.join('\n\n');
      return { title: c.title || `第 ${ci + 1} 节`, html, text: t };
    }).filter(c => c.text.length > 0);

    return out.length ? out : [{ title: '正文', html: '', text: '' }];
  }

  function parseTxt(buf, name) {
    const chapters = assembleChapters(decodeText(buf));
    return { title: cleanName(name), author: '', format: 'txt', chapters };
  }

  function cleanName(name) {
    return String(name || '未命名').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() || '未命名';
  }

  /* ---------- 通用 HTML 清洗 ---------- */
  const ALLOWED = new Set(['P','DIV','SECTION','ARTICLE','H1','H2','H3','H4','H5','H6','BR','EM','STRONG','I','B','U','S','BLOCKQUOTE','Q','UL','OL','LI','TABLE','THEAD','TBODY','TFOOT','TR','TD','TH','IMG','FIGURE','FIGCAPTION','SUP','SUB','HR','PRE','CODE','SPAN','A','CENTER','SMALL','CITE']);

  function sanitizeInto(srcNode, destParent, imgResolver) {
    for (const child of Array.from(srcNode.childNodes)) {
      if (child.nodeType === 3) {
        if (child.data.trim() || (destParent.lastChild && destParent.lastChild.nodeType === 1)) {
          destParent.appendChild(document.createTextNode(child.data));
        }
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META' || tag === 'NOSCRIPT' || tag === 'HEAD' || tag === 'SVG' || tag === 'VIDEO' || tag === 'AUDIO' || tag === 'IFRAME' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'FORM' || tag === 'OBJECT' || tag === 'EMBED') continue;
      if (!ALLOWED.has(tag)) { sanitizeInto(child, destParent, imgResolver); continue; }
      const ne = document.createElement(tag.toLowerCase());
      if (tag === 'IMG') {
        const resolved = imgResolver ? imgResolver(child.getAttribute('src')) : null;
        if (resolved) { ne.setAttribute('src', resolved); ne.setAttribute('class', 'book-img'); destParent.appendChild(ne); }
        else if (child.getAttribute('alt')) destParent.appendChild(document.createTextNode('[' + child.getAttribute('alt') + ']'));
        continue;
      }
      if (tag === 'A') ne.setAttribute('data-link', child.getAttribute('href') || '');
      if (tag === 'TD' || tag === 'TH') {
        if (child.getAttribute('colspan')) ne.setAttribute('colspan', child.getAttribute('colspan'));
        if (child.getAttribute('rowspan')) ne.setAttribute('rowspan', child.getAttribute('rowspan'));
      }
      destParent.appendChild(ne);
      sanitizeInto(child, ne, imgResolver);
    }
  }

  function normalizeHTML(container) {
    // 合并空段落, 修剪空白
    for (const p of container.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, pre, figcaption')) {
      if (!p.textContent.trim() && !p.querySelector('img') && p.tagName !== 'TD' && p.tagName !== 'TH') {
        p.remove();
      }
    }
    return container;
  }

  /* ---------- EPUB ---------- */
  async function parseEpub(buf, name) {
    await ensureJsZip();
    const zip = await JSZip.loadAsync(buf);
    const containerFile = zip.file('META-INF/container.xml');
    if (!containerFile) throw new Error('不是有效的 EPUB（缺少 container.xml）');
    const cdoc = new DOMParser().parseFromString(await containerFile.async('string'), 'application/xml');
    const rootfileEl = cdoc.getElementsByTagName('rootfile')[0];
    const opfPath = rootfileEl && (rootfileEl.getAttribute('full-path') || rootfileEl.getAttribute('full-path'.slice(0)));
    if (!opfPath) throw new Error('EPUB 缺少 OPF');
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const opfDoc = new DOMParser().parseFromString(await zip.file(opfPath).async('string'), 'application/xml');

    const metaText = (local) => {
      const els = opfDoc.getElementsByTagNameNS('*', local);
      return els.length ? els[0].textContent.trim() : '';
    };
    const title = metaText('title') || cleanName(name);
    const author = metaText('creator') || '';

    // manifest
    const items = {};
    for (const it of opfDoc.getElementsByTagNameNS('*', 'item')) {
      items[it.getAttribute('id')] = {
        href: it.getAttribute('href'),
        type: it.getAttribute('media-type') || '',
        props: it.getAttribute('properties') || ''
      };
    }
    const resolve = (href) => {
      if (!href) return null;
      const dec = href.split('#')[0];
      const parts = (opfDir + dec).split('/');
      const stack = [];
      for (const p of parts) { if (p === '..') stack.pop(); else if (p && p !== '.') stack.push(p); }
      const full = decodeURIComponent(stack.join('/'));
      return zip.file(full) || zip.file(stack.join('/')) || null;
    };

    // spine
    const spineIds = Array.from(opfDoc.getElementsByTagNameNS('*', 'itemref'))
      .map(r => r.getAttribute('idref')).filter(id => items[id]);
    if (!spineIds.length) throw new Error('EPUB 没有可读内容');

    // cover
    let cover = null;
    try {
      let coverItem = null;
      for (const it of Object.values(items)) if (it.props.includes('cover-image')) coverItem = it;
      if (!coverItem) {
        const m = opfDoc.querySelector ? null : null;
        for (const mt of opfDoc.getElementsByTagNameNS('*', 'meta')) {
          if (mt.getAttribute('name') === 'cover') coverItem = items[mt.getAttribute('content')];
        }
      }
      if (coverItem) {
        const f = resolve(coverItem.href);
        if (f) {
          const data = await f.async('base64');
          cover = 'data:' + (coverItem.type || 'image/jpeg') + ';base64,' + data;
          if (cover.length > 3_500_000) cover = null;
        }
      }
    } catch (e) { cover = null; }

    // toc
    const tocEntries = [];
    try {
      let ncxFile = null;
      for (const it of Object.values(items)) if (it.type === 'application/x-dtbncx+xml') ncxFile = it;
      if (ncxFile) {
        const f = resolve(ncxFile.href);
        if (f) {
          const doc = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
          for (const np of doc.getElementsByTagNameNS('*', 'navPoint')) {
            const label = np.getElementsByTagNameNS('*', 'text')[0];
            const content = np.getElementsByTagNameNS('*', 'content')[0];
            if (label && content) tocEntries.push({ label: label.textContent.trim(), src: content.getAttribute('src') || '' });
          }
        }
      }
      if (!tocEntries.length) {
        for (const it of Object.values(items)) if (it.props.split(/\s+/).includes('nav')) {
          const f = resolve(it.href);
          if (!f) continue;
          const doc = new DOMParser().parseFromString(await f.async('string'), 'text/html');
          const baseDir = it.href.includes('/') ? it.href.slice(0, it.href.lastIndexOf('/') + 1) : '';
          for (const a of doc.querySelectorAll('nav a[href]')) {
            tocEntries.push({ label: a.textContent.trim(), src: baseDir + a.getAttribute('href') });
          }
          break;
        }
      }
    } catch (e) {}

    // 图片解析器
    const imgCount = { n: 0 };
    const imgResolverFor = (chapterDir) => (src) => {
      if (!src || imgCount.n > 80) return null;
      if (/^data:/i.test(src)) return src;
      const parts = (chapterDir + src.split('#')[0]).split('/');
      const stack = [];
      for (const p of parts) { if (p === '..') stack.pop(); else if (p && p !== '.') stack.push(p); }
      const f = zip.file(decodeURIComponent(stack.join('/')));
      if (!f) return null;
      const ext = (stack[stack.length - 1] || '').split('.').pop().toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      if (f._data && f._data.uncompressedSize > 2_500_000) return null;
      imgCount.n++;
      return 'data:' + mime + ';base64,' + f.async('base64');
    };

    // 章节
    const chapters = [];
    const tocBase = new Map();
    for (const te of tocEntries) {
      const file = decodeURIComponent((te.src || '').split('#')[0]);
      if (!tocBase.has(file)) tocBase.set(file, te.label);
    }
    for (let i = 0; i < spineIds.length; i++) {
      const item = items[spineIds[i]];
      const f = resolve(item.href);
      if (!f) continue;
      const raw = await f.async('string');
      let doc;
      try { doc = new DOMParser().parseFromString(raw, 'application/xhtml+xml'); if (doc.getElementsByTagName('parsererror').length) throw 0; }
      catch (e) { doc = new DOMParser().parseFromString(raw, 'text/html'); }
      const body = doc.body || doc.getElementsByTagName('body')[0];
      if (!body) continue;
      for (const bad of body.querySelectorAll('script,style,link,meta,noscript')) bad.remove();
      const chapterDir = item.href.includes('/') ? item.href.slice(0, item.href.lastIndexOf('/') + 1) : '';
      const holder = document.createElement('div');
      sanitizeInto(body, holder, imgResolverFor(chapterDir));
      normalizeHTML(holder);
      const html = holder.innerHTML.trim();
      const text = holder.textContent.replace(/\s*\n\s*/g, '\n').trim();
      if (!text && !html) continue;
      let chTitle = tocBase.get(decodeURIComponent(item.href)) || '';
      const firstH = holder.querySelector('h1,h2,h3');
      if (!chTitle && firstH) chTitle = firstH.textContent.trim().slice(0, 60);
      // 正文首个标题与章节名重复时移除, 避免标题显示两次
      if (firstH && chTitle && firstH.textContent.trim() === chTitle) firstH.remove();
      if (!chTitle) chTitle = `第 ${chapters.length + 1} 节`;
      chapters.push({ title: chTitle || `第 ${chapters.length + 1} 节`, html, text });
    }
    if (!chapters.length) throw new Error('EPUB 内容为空');
    return { title, author, format: 'epub', chapters, cover };
  }

  /* ---------- PDF ---------- */
  async function parsePdf(buf, name) {
    // 自愈式加载 PDF 引擎: pdf.min.js + pdf.worker.min.js 均在主线程以普通脚本运行
    await ensurePdfJs();
    if (!globalThis.pdfjsWorker) {
      try { await ensurePdfWorker(); } catch (e) {}
    }
    if (!globalThis.pdfjsWorker) {
      // 兜底: 让 pdf.js 自行通过 workerSrc 加载(其内部会回退到主线程 fake worker)
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('js/pdfjs/pdf.worker.min.js', location.href).href;
    }
    const pdfjs = window.pdfjsLib;
    const doc = await pdfjs.getDocument({ data: buf instanceof Uint8Array ? buf : new Uint8Array(buf), isEvalSupported: false, useSystemFonts: true }).promise;

    // 目录
    let outlineItems = [];
    try {
      const outline = await doc.getOutline();
      const walk = async (items, depth) => {
        for (const it of (items || [])) {
          let pageIdx = null;
          try {
            let dest = it.dest;
            if (typeof dest === 'string') dest = await doc.getDestination(dest);
            if (Array.isArray(dest) && dest[0]) pageIdx = await doc.getPageIndex(dest[0]);
          } catch (e) {}
          if (pageIdx !== null && depth <= 1) outlineItems.push({ title: (it.title || '').trim(), page: pageIdx });
          if (it.items && depth <= 1) await walk(it.items, depth + 1);
        }
      };
      await walk(outline, 0);
    } catch (e) {}
    outlineItems = outlineItems.filter(o => o.title).sort((a, b) => a.page - b.page);
    if (outlineItems.length && outlineItems[0].page > 0) outlineItems.unshift({ title: '开篇', page: 0 });

    const pageText = async (n) => {
      const page = await doc.getPage(n + 1);
      const tc = await page.getTextContent();
      const linesMap = new Map();
      for (const it of tc.items) {
        if (!it.str) continue;
        const y = Math.round(it.transform[5]);
        if (!linesMap.has(y)) linesMap.set(y, []);
        linesMap.get(y).push({ x: it.transform[4], s: it.str });
      }
      const ys = Array.from(linesMap.keys()).sort((a, b) => b - a);
      const lines = ys.map(y => linesMap.get(y).sort((a, b) => a.x - b.x).map(o => o.s).join(''));
      let gaps = [];
      for (let i = 1; i < ys.length; i++) gaps.push(ys[i - 1] - ys[i]);
      gaps = gaps.filter(g => g > 0).sort((a, b) => a - b);
      const medGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 12;
      const paras = [];
      let cur = '';
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (!ln.trim()) { if (cur) { paras.push(cur); cur = ''; } continue; }
        if (!cur) { cur = ln; }
        else {
          const gap = ys[i - 1] - ys[i];
          if (cur.endsWith('-')) cur = cur.slice(0, -1) + ln;
          else if (gap > medGap * 1.55) { paras.push(cur); cur = ln; }
          else cur += (isCJK(cur + ln) ? '' : ' ') + ln;
        }
      }
      if (cur) paras.push(cur);
      return paras.filter(p => p.trim());
    };

    const ranges = [];
    if (outlineItems.length >= 2) {
      for (let i = 0; i < outlineItems.length; i++) {
        const start = outlineItems[i].page;
        const end = i + 1 < outlineItems.length ? outlineItems[i + 1].page : doc.numPages;
        ranges.push({ title: outlineItems[i].title.slice(0, 60), from: start, to: Math.min(end, doc.numPages - 1) });
      }
    } else {
      const step = 10;
      for (let p = 0; p < doc.numPages; p += step) {
        ranges.push({ title: `第 ${p + 1}–${Math.min(p + step, doc.numPages)} 页`, from: p, to: Math.min(p + step - 1, doc.numPages - 1) });
      }
    }

    const chapters = [];
    for (const r of ranges) {
      const allParas = [];
      for (let p = r.from; p <= r.to; p++) {
        try { allParas.push(...await pageText(p)); } catch (e) {}
      }
      if (!allParas.length) continue;
      chapters.push({
        title: r.title || `第 ${chapters.length + 1} 节`,
        html: allParas.map(p => '<p>' + escapeHtml(p) + '</p>').join('\n'),
        text: allParas.join('\n\n')
      });
    }
    if (!chapters.length) throw new Error('PDF 中没有可提取的文字（可能是扫描版）');
    let author = '';
    try { const m = await doc.getMetadata(); author = (m.info && m.info.Author) || ''; } catch (e) {}
    return {
      title: cleanName(name), author,
      format: 'pdf', chapters,
      pages: doc.numPages
    };
  }

  /* ---------- DOCX (Word 文献) ---------- */
  function xmlDecode(s) {
    return String(s || '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(/&amp;/g, '&');
  }

  async function parseDocx(buf, name) {
    await ensureJsZip();
    const zip = await JSZip.loadAsync(buf);
    const docFile = zip.file('word/document.xml');
    if (!docFile) throw new Error('不是有效的 DOCX 文件');
    const xml = await docFile.async('string');
    const paras = [];
    const pRe = /<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
    let m;
    while ((m = pRe.exec(xml))) {
      const p = m[0];
      let text = '';
      const tRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
      let t;
      while ((t = tRe.exec(p))) text += t[1];
      if (/<w:tab[^>]*\/>/.test(p)) text += '\t';
      paras.push(xmlDecode(text).replace(/\s+$/, ''));
    }
    let title = '', author = '';
    try {
      const core = zip.file('docProps/core.xml');
      if (core) {
        const cx = await core.async('string');
        title = (cx.match(/<dc:title>([\s\S]*?)<\/dc:title>/) || [])[1] || '';
        author = (cx.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/) || [])[1] || '';
      }
    } catch (e) {}
    const text = paras.filter(p => p.trim()).join('\n');
    if (!text.trim()) throw new Error('DOCX 中没有可提取的文字');
    return {
      title: xmlDecode(title).trim() || cleanName(name),
      author: xmlDecode(author).trim(),
      format: 'docx', chapters: assembleChapters(text)
    };
  }

  /* ---------- MOBI / AZW / AZW3 ---------- */
  function palmDocDecompress(u8) {
    const arr = [];
    let i = 0;
    while (i < u8.length) {
      const b = u8[i++];
      if (b === 0) arr.push(0);
      else if (b <= 8) { for (let k = 0; k < b && i < u8.length; k++) arr.push(u8[i++]); }
      else if (b < 0x80) arr.push(b);
      else if (b < 0xc0) {
        if (i >= u8.length) break;
        const b2 = u8[i++];
        const dist = ((((b & 0x3f) << 8) | b2) >> 3) & 0x7ff;
        const len = (b2 & 7) + 3;
        if (dist === 0 || dist > arr.length) { arr.push(0x20); continue; }
        for (let k = 0; k < len; k++) arr.push(arr[arr.length - dist]);
      } else { arr.push(0x20); arr.push(b & 0x7f); }
    }
    return new Uint8Array(arr);
  }

  function sizeOfTrailingEntry(u8) {
    let bitpos = 0, result = 0, size = u8.length;
    if (size <= 0) return 0;
    while (true) {
      const v = u8[size - 1];
      result |= (v & 0x7f) << bitpos;
      bitpos += 7; size -= 1;
      if ((v & 0x80) !== 0 || bitpos >= 28 || size === 0) return result;
    }
  }

  function trimTrailing(u8, flags) {
    // 位15..1: 变长尾随条目(高位先去); 位0: 多字节跨记录重叠
    for (let i = 15; i >= 1; i--) {
      if ((flags & (1 << i)) && u8.length) {
        const num = sizeOfTrailingEntry(u8);
        if (num > 0 && num < u8.length) u8 = u8.subarray(0, u8.length - num);
        else break;
      }
    }
    if ((flags & 1) && u8.length) {
      const num = (u8[u8.length - 1] & 0x3) + 1;
      if (num < u8.length) u8 = u8.subarray(0, u8.length - num);
    }
    return u8;
  }

  async function parseMobi(buf, name) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (u8.length < 132) throw new Error('文件太小，不是有效的 MOBI');
    const creator = String.fromCharCode(u8[64], u8[65], u8[66], u8[67]);
    if (creator !== 'MOBI') throw new Error('不是有效的 MOBI/AZW 文件');
    const numRecords = dv.getUint16(76);
    if (numRecords < 2) throw new Error('MOBI 记录异常');
    const recs = [];
    for (let i = 0; i < numRecords; i++) {
      recs.push(Math.min(dv.getUint32(78 + i * 8), u8.length));
    }
    recs.push(u8.length);
    const r0 = recs[0];
    const compression = dv.getUint16(r0);
    const recordCount = dv.getUint16(r0 + 8);
    const encryption = dv.getUint16(r0 + 12);
    if (encryption !== 0) throw new Error('该文件有 DRM 保护（加密），无法读取');
    if (compression === 17480) throw new Error('该文件使用 HUFF/CDIC 压缩，暂不支持');
    if (compression !== 1 && compression !== 2) throw new Error('未知的压缩类型: ' + compression);
    const textEncoding = dv.getUint32(r0 + 28) === 1252 ? 'windows-1252' : 'utf-8';
    const dec = new TextDecoder(textEncoding);

    let title = '', headerLength = 0, hasMobi = false, extraFlags = 0;
    if (String.fromCharCode(u8[r0 + 16], u8[r0 + 17], u8[r0 + 18], u8[r0 + 19]) === 'MOBI') {
      hasMobi = true;
      headerLength = dv.getUint32(r0 + 20);
      const fullNameOff = dv.getUint32(r0 + 84);
      const fullNameLen = dv.getUint32(r0 + 88);
      if (fullNameOff > 0 && fullNameLen > 0 && r0 + fullNameOff + fullNameLen <= u8.length) {
        try { title = dec.decode(u8.subarray(r0 + fullNameOff, r0 + fullNameOff + fullNameLen)); } catch (e) {}
      }
      if (headerLength >= 232) extraFlags = dv.getUint16(r0 + 16 + headerLength - 2);
    }
    let author = '';
    try {
      if (hasMobi && headerLength >= 226 && (dv.getUint32(r0 + 128) & 0x40)) {
        let p = r0 + 16 + headerLength;
        if (String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]) === 'EXTH') {
          const count = dv.getUint32(p + 8);
          let q = p + 12;
          for (let i = 0; i < count && q + 8 <= u8.length; i++) {
            const rtype = dv.getUint32(q), rlen = Math.max(8, dv.getUint32(q + 4));
            const val = () => { try { return dec.decode(u8.subarray(q + 8, Math.min(q + rlen, u8.length))).replace(/\0+$/, '').trim(); } catch (e) { return ''; } };
            if (rtype === 100 && !author) author = val();
            if (rtype === 503 && val()) title = val();
            q += rlen;
          }
        }
      }
    } catch (e) {}

    let html = '';
    for (let i = 1; i <= recordCount && i < numRecords; i++) {
      let rec = u8.subarray(recs[i], recs[i + 1]);
      if (compression === 2) { try { rec = palmDocDecompress(rec); } catch (e) { break; } }
      rec = trimTrailing(rec, extraFlags);
      try { html += dec.decode(rec, { stream: i < recordCount }); } catch (e) { html += dec.decode(rec); }
    }
    const text = html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(/&amp;/g, '&')
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
    if (text.replace(/\s/g, '').length < 10) throw new Error('MOBI 中没有可提取的文字');
    return {
      title: title.trim() || cleanName(name),
      author: author.trim(),
      format: 'mobi', chapters: assembleChapters(text)
    };
  }

  /* ---------- Markdown ---------- */
  function mdInline(s) {
    return escapeHtml(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  }

  function parseMd(buf, name) {
    const text = decodeText(buf).replace(/\r\n?/g, '\n');
    const lines = text.split('\n');
    const chapters = [];
    let cur = { title: cleanName(name), lines: [] };
    for (const ln of lines) {
      const m = ln.match(/^(#{1,2})\s+(.*)$/);
      if (m) {
        if (cur.lines.some(x => x.trim())) chapters.push(cur);
        cur = { title: m[2].trim().slice(0, 60) || '正文', lines: [] };
      } else cur.lines.push(ln);
    }
    if (cur.lines.some(x => x.trim())) chapters.push(cur);
    const out = chapters.map((c, i) => {
      const paras = c.lines.join('\n').split(/\n\s*\n/).map(g => g.split('\n').map(s => s.trim()).filter(Boolean).join('\n')).filter(Boolean);
      const html = paras.map(p => {
        const hm = p.match(/^(#{3,6})\s+(.*)$/);
        if (hm) return `<h4>${mdInline(hm[2])}</h4>`;
        return '<p>' + p.split('\n').map(mdInline).join('<br>') + '</p>';
      }).join('\n');
      return { title: c.title || `第 ${i + 1} 节`, html, text: paras.join('\n\n') };
    });
    return { title: cleanName(name), author: '', format: 'md', chapters: out.length ? out : [{ title: '正文', html: '', text: '' }] };
  }

  /* ---------- 单个 HTML 文件 ---------- */
  function parseHtmlFile(buf, name) {
    const raw = decodeText(buf);
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    for (const bad of doc.querySelectorAll('script,style,link,meta,noscript,iframe,form,input,button')) bad.remove();
    const body = doc.body;
    const holder = document.createElement('div');
    sanitizeInto(body, holder, () => null);
    normalizeHTML(holder);

    const chapters = [];
    let curTitle = cleanName(name);
    let curHolder = document.createElement('div');
    const flush = () => {
      const html = curHolder.innerHTML.trim();
      const text = curHolder.textContent.replace(/\s*\n\s*/g, '\n').trim();
      if (text) chapters.push({ title: curTitle, html, text });
      curHolder = document.createElement('div');
    };
    for (const node of Array.from(holder.childNodes)) {
      if (node.nodeType === 1 && /^H[12]$/.test(node.tagName)) {
        flush();
        curTitle = node.textContent.trim().slice(0, 60) || curTitle;
        continue;
      }
      curHolder.appendChild(node.cloneNode(true));
    }
    flush();
    return {
      title: (doc.title || '').trim() || cleanName(name), author: '',
      format: 'html', chapters: chapters.length ? chapters : [{ title: '正文', html: holder.innerHTML, text: holder.textContent.trim() }]
    };
  }

  /* ---------- 入口 ---------- */
  async function parseFile(entry) {
    const buf = await window.bw.readBookFile(entry.absPath);
    let parsed;
    switch (entry.ext) {
      case 'txt': parsed = parseTxt(buf, entry.name); break;
      case 'epub': parsed = await parseEpub(buf, entry.name); break;
      case 'pdf': parsed = await parsePdf(buf, entry.name); break;
      case 'docx': parsed = await parseDocx(buf, entry.name); break;
      case 'mobi': case 'azw': case 'azw3': parsed = await parseMobi(buf, entry.name); break;
      case 'md': case 'markdown': parsed = parseMd(buf, entry.name); break;
      case 'html': case 'htm': parsed = parseHtmlFile(buf, entry.name); break;
      default: throw new Error('不支持的格式: ' + entry.ext);
    }
    // 重名书籍标题去重信息
    const words = parsed.chapters.reduce((acc, c) => {
      const latin = (c.text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;
      const cjk = (c.text.match(/[\u4e00-\u9fff]/g) || []).length;
      return acc + latin + cjk;
    }, 0);
    parsed.wordCount = words;
    parsed.chapterCount = parsed.chapters.length;
    return parsed;
  }

  function downscaleCover(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const W = 400, H = 560;
          const scale = Math.max(W / img.width, H / img.height);
          const cw = Math.round(img.width * scale), ch = Math.round(img.height * scale);
          const cv = document.createElement('canvas');
          cv.width = W; cv.height = H;
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#1c1c22'; ctx.fillRect(0, 0, W, H);
          ctx.drawImage(img, (W - cw) / 2, (H - ch) / 2, cw, ch);
          resolve(cv.toDataURL('image/jpeg', 0.85));
        } catch (e) { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  window.BW.Parsers = { parseFile, downscaleCover, decodeText, cleanName };
})();
