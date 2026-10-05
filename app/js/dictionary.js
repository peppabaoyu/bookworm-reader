'use strict';
/* 书虫 - 内置词典: ECDICT 精简词库 + Moby 同义词库 (离线, 毫秒级查询) */
(function () {
  const Dictionary = {
    words: new Map(),     // word → {p, zh, en, ex, pos, frq}
    syn: new Map(),       // word → [同义词]
    sorted: [],           // 词表 (形近词用)
    loaded: false,
    _loading: null,

    async ensure() {
      if (this.loaded) return true;
      if (this._loading) return this._loading;
      this._loading = (async () => {
        try {
          const [dict, thes] = await Promise.all([
            window.bw.readAppData('dict.tsv'),
            window.bw.readAppData('thesaurus.tsv')
          ]);
          if (dict) {
            for (const line of dict.split('\n')) {
              const c = line.split('\t');
              if (c.length < 7 || !c[0]) continue;
              this.words.set(c[0], { p: c[1], zh: c[2], en: c[3], ex: c[4], pos: c[5], frq: +c[6] || 0 });
            }
            this.sorted = Array.from(this.words.keys());
          }
          if (thes) {
            for (const line of thes.split('\n')) {
              const i = line.indexOf('\t');
              if (i < 0) continue;
              this.syn.set(line.slice(0, i), line.slice(i + 1).split('|'));
            }
          }
          this.loaded = true;
          console.log('[书虫] 内置词典就绪:', this.words.size, '词,', this.syn.size, '组同义词');
          return true;
        } catch (e) {
          console.error('词典加载失败:', e);
          this._loading = null;
          return false;
        }
      })();
      return this._loading;
    },

    /* 解析 ECDICT exchange 字段: 0:复数/p:过去式/d:过去分词/i:现在分词/3:第三人称/r:比较级/t:最高级 */
    parseExchange(ex) {
      const out = [];
      if (!ex) return out;
      const names = { 0: '复数', 1: '原型变化', p: '过去式', d: '过去分词', i: '现在分词', 3: '第三人称单数', r: '比较级', t: '最高级', s: '第三人称单数' };
      for (const seg of ex.split('/')) {
        const i = seg.indexOf(':');
        if (i < 1) continue;
        const label = names[seg.slice(0, i)] || '';
        const w = seg.slice(i + 1);
        if (label && w) out.push({ label, w });
      }
      return out;
    },

    lookup(wordRaw) {
      const word = String(wordRaw || '').toLowerCase().trim().replace(/[.,;:!?"'’]+$/, '').replace(/^['’]+/, '');
      if (!word || !this.loaded) return null;
      const entry = this.words.get(word);
      if (!entry) return null;
      // 形近词: 同前缀优先 + 编辑距离 ≤ 2
      const similar = [];
      const prefix = word.slice(0, Math.max(3, Math.floor(word.length / 2)));
      for (const w of this.sorted) {
        if (w === word) continue;
        if (w.startsWith(prefix) || Math.abs(w.length - word.length) <= 1) {
          if (lev(word, w) <= (word.length > 6 ? 2 : 1)) similar.push(w);
          if (similar.length >= 10) break;
        }
      }
      return {
        word,
        phonetic: entry.p,
        zh: entry.zh,
        en: entry.en,
        exchange: this.parseExchange(entry.ex),
        pos: entry.pos,
        frq: entry.frq,
        synonyms: (this.syn.get(word) || []).slice(0, 12),
        similar
      };
    },

    has(word) { return this.words.has(String(word || '').toLowerCase().trim()); }
  };

  function lev(a, b) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 2) return 9;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = dp[0]; dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return dp[n];
  }

  window.BW.Dictionary = Dictionary;
})();
