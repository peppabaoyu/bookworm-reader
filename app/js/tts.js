'use strict';
/* 书虫 - 系统语音朗读: 开始/暂停/继续/停止, 0.5~2倍速, 逐句高亮跟读, 自动跨章节 */
(function () {
  const { $, el, clamp, toast, Store } = window.BW;

  const TTS = {
    active: false,
    paused: false,
    sentences: [],
    idx: 0,
    _spans: [],
    _token: 0,
    voices: [],

    init() {
      if (!('speechSynthesis' in window)) {
        $('#rd-tts').disabled = true;
        $('#rd-tts').title = '当前环境不支持语音合成';
        return;
      }
      const load = () => { this.voices = window.speechSynthesis.getVoices() || []; };
      load();
      window.speechSynthesis.onvoiceschanged = load;
      setTimeout(load, 600);

      $('#rd-tts').addEventListener('click', () => {
        if (this.active) { this.showBar(); return; }
        this.start();
      });
    },

    /* ---------- 声音 ---------- */
    groupedVoices() {
      const groups = { us: [], gb: [], en: [], zh: [], other: [] };
      for (const v of this.voices) {
        const lang = (v.lang || '').toLowerCase().replace('_', '-');
        if (lang.startsWith('en-us')) groups.us.push(v);
        else if (lang.startsWith('en-gb')) groups.gb.push(v);
        else if (lang.startsWith('en')) groups.en.push(v);
        else if (lang.startsWith('zh')) groups.zh.push(v);
        else groups.other.push(v);
      }
      const label = v => v.name.replace(/Microsoft |Google |\(.*?\)/g, '').trim() + (v.localService ? '' : ' (在线)');
      return [
        { key: 'us', name: '英语 · 美音', voices: groups.us, label },
        { key: 'gb', name: '英语 · 英音', voices: groups.gb, label },
        { key: 'en', name: '英语 · 其他口音', voices: groups.en, label },
        { key: 'zh', name: '中文', voices: groups.zh, label },
        { key: 'other', name: '其他语言', voices: groups.other, label }
      ].filter(g => g.voices.length);
    },

    defaultVoice() {
      const pick = (pred) => this.voices.find(pred);
      const naturalUS = pick(v => /en[-_]us/i.test(v.lang) && /natural|online/i.test(v.name));
      const us = pick(v => /en[-_]us/i.test(v.lang) && /zira|aria|jenny|emma|guy|david/i.test(v.name)) || pick(v => /en[-_]us/i.test(v.lang));
      const gb = pick(v => /en[-_]gb/i.test(v.lang));
      const anyEn = pick(v => /^en/i.test(v.lang));
      return naturalUS || us || gb || anyEn || this.voices[0] || null;
    },

    resolveVoice() {
      const name = Store.settings.ttsVoice;
      if (name) {
        const v = this.voices.find(v => v.name === name);
        if (v) return v;
      }
      return this.defaultVoice();
    },

    /* ---------- 朗读控制 ---------- */
    start() {
      const R = window.BW.Reader;
      if (!R.book) return;
      if (!this.voices.length) this.voices = window.speechSynthesis.getVoices() || [];
      const enVoice = this.resolveVoice();
      if (!enVoice || !/^en/i.test(enVoice.lang)) {
        toast('未找到英语语音，将使用默认声音朗读', 'error');
      }
      toast('正在解析句子…');
      this.sentences = R.buildSentences();
      if (!this.sentences.length) { toast('没有可朗读的内容', 'error'); return; }
      const g = R.currentG();
      let i = this.sentences.findIndex(s => s.gEnd > g);
      if (i < 0) i = 0;
      this.active = true;
      this.paused = false;
      this.idx = i;
      this.showBar();
      this.speakIdx();
    },

    speakIdx() {
      if (!this.active) return;
      if (this.idx >= this.sentences.length) { this.stop(); toast('已读完全书'); return; }
      const R = window.BW.Reader;
      const s = this.sentences[this.idx];
      const token = ++this._token;
      try { window.speechSynthesis.cancel(); } catch (e) {}
      if (this._spans.length) { R.unwrap('span.tts-cur'); this._spans = []; }
      this._spans = R.wrapRange(s.gStart, s.gEnd, { class: 'tts-cur' });
      R.gotoG(s.gStart, { save: false });
      R.trackPosition();

      const u = new SpeechSynthesisUtterance(s.text);
      const voice = this.resolveVoice();
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.rate = clamp(Store.settings.ttsRate || 1, 0.5, 2);
      u.pitch = 1;
      u.onend = () => {
        if (!this.active || token !== this._token) return;
        this.idx++;
        setTimeout(() => this.speakIdx(), 60);
      };
      u.onerror = (e) => {
        if (!this.active || token !== this._token) return;
        if (e && e.error === 'interrupted' || e && e.error === 'canceled') return;
        this.idx++;
        setTimeout(() => this.speakIdx(), 60);
      };
      window.speechSynthesis.speak(u);
      this.updateBar();
    },

    pause() {
      if (!this.active || this.paused) return;
      window.speechSynthesis.pause();
      this.paused = true;
      this.updateBar();
    },
    resume() {
      if (!this.active || !this.paused) return;
      window.speechSynthesis.resume();
      this.paused = false;
      this.updateBar();
    },
    togglePause() { this.paused ? this.resume() : this.pause(); },

    stop(silent) {
      const wasActive = this.active;
      this._token++;
      this.active = false;
      this.paused = false;
      try { window.speechSynthesis.cancel(); } catch (e) {}
      try { window.BW.Reader.unwrap('span.tts-cur'); } catch (e) {}
      this._spans = [];
      this.hideBar();
      if (wasActive && !silent) toast('已停止朗读');
    },

    setRate(r) {
      Store.settings.ttsRate = clamp(r, 0.5, 2);
      Store.saveSettings();
      if (this.active && !this.paused) this.speakIdx();  // 用新语速重读当前句
    },

    speakSelection(text) {
      if (!('speechSynthesis' in window)) { toast('当前环境不支持语音合成', 'error'); return; }
      const t = String(text || '').trim();
      if (!t) return;
      try { window.speechSynthesis.cancel(); } catch (e) {}
      const u = new SpeechSynthesisUtterance(t.slice(0, 1000));
      const v = this.resolveVoice();
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = clamp(Store.settings.ttsRate || 1, 0.5, 2);
      window.speechSynthesis.speak(u);
    },

    /* ---------- 悬浮控制条 ---------- */
    _bar: null,
    showBar() {
      if (this._bar) { this.updateBar(); return; }
      const bar = this._bar = el('div', { class: 'tts-bar' });
      const playBtn = el('button', { class: 'tts-play icon-btn', title: '暂停/继续', onclick: () => this.togglePause() }, '⏸');
      bar.appendChild(playBtn);
      bar.appendChild(el('button', { class: 'icon-btn', title: '停止', onclick: () => this.stop() }, '⏹'));
      bar.appendChild(el('button', {
        class: 'icon-btn', title: '上一句', onclick: () => { if (this.idx > 0) { this.idx--; this.speakIdx(); } }
      }, '⏮'));
      bar.appendChild(el('button', {
        class: 'icon-btn', title: '下一句', onclick: () => { if (this.idx < this.sentences.length - 1) { this.idx++; this.speakIdx(); } }
      }, '⏭'));

      const voiceSel = el('select', {
        class: 'tts-voice', title: '朗读声音',
        onchange: (e) => { Store.settings.ttsVoice = e.target.value; Store.saveSettings(); if (this.active && !this.paused) this.speakIdx(); }
      });
      this._fillVoices(voiceSel);
      bar.appendChild(voiceSel);

      const rate = el('select', {
        class: 'tts-rate', title: '语速',
        onchange: (e) => this.setRate(parseFloat(e.target.value))
      });
      for (const r of [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]) {
        rate.appendChild(el('option', { value: String(r) }, r + 'x'));
      }
      rate.value = String(Store.settings.ttsRate || 1);
      bar.appendChild(rate);

      const status = el('span', { class: 'tts-status' });
      bar.appendChild(status);
      document.body.appendChild(bar);
      this.updateBar();
    },

    _fillVoices(sel) {
      sel.innerHTML = '';
      for (const g of this.groupedVoices()) {
        const og = el('optgroup', { label: g.name });
        for (const v of g.voices) og.appendChild(el('option', { value: v.name }, g.label(v)));
        sel.appendChild(og);
      }
      const cur = Store.settings.ttsVoice || (this.defaultVoice() || {}).name || '';
      sel.value = cur;
    },

    updateBar() {
      if (!this._bar) return;
      const playBtn = $('.tts-play', this._bar);
      playBtn.textContent = this.paused ? '▶' : '⏸';
      const status = $('.tts-status', this._bar);
      const voiceSel = $('.tts-voice', this._bar);
      if (voiceSel && document.activeElement !== voiceSel) {
        const cur = Store.settings.ttsVoice || (this.defaultVoice() || {}).name || '';
        if (voiceSel.value !== cur) { this._fillVoices(voiceSel); }
      }
      const rateSel = $('.tts-rate', this._bar);
      if (rateSel && document.activeElement !== rateSel) rateSel.value = String(Store.settings.ttsRate || 1);
      if (this.active) {
        status.textContent = `${this.paused ? '已暂停' : '朗读中'} · ${this.idx + 1}/${this.sentences.length} 句`;
      }
    },

    hideBar() { if (this._bar) { this._bar.remove(); this._bar = null; } }
  };

  window.BW.TTS = TTS;
})();
