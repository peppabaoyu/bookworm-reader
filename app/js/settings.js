'use strict';
/* 书虫 - 显示与功能设置 */
(function () {
  const { $, $$, el, openModal, closeModal, toast, clamp, Store } = window.BW;

  const FONTS = [
    { key: 'kaiti', name: '楷体（正楷）', stack: '"KaiTi","楷体","STKaiti","BiauKai","DFKai-SB",serif' },
    { key: 'system', name: '系统字体', stack: '"Segoe UI","Microsoft YaHei","PingFang SC",system-ui,sans-serif' },
    { key: 'song', name: '宋体 / 衬线', stack: '"SimSun","宋体","NSimSun",Georgia,"Times New Roman",serif' },
    { key: 'hei', name: '黑体 / 无衬线', stack: '"Microsoft YaHei","微软雅黑","SimHei",system-ui,sans-serif' }
  ];
  const THEMES = [
    { key: 'day', name: '日间', icon: '☀️' },
    { key: 'night', name: '夜间', icon: '🌙' },
    { key: 'eye', name: '护眼', icon: '🌿' }
  ];

  const Settings = {
    open() {
      const s = Store.settings;
      const R = window.BW.Reader;
      const mode = R.book ? R.mode : s.mode;

      const modeRow = el('div', { class: 'set-row' },
        el('div', { class: 'field-label' }, '翻页方式'),
        el('div', { class: 'seg-row' },
          ['paged', 'scroll'].map(m => el('button', {
            class: 'seg-opt' + (mode === m ? ' active' : ''), 'data-v': m,
            onclick: (e) => { $$('.seg-opt', modeRow).forEach(o => o.classList.remove('active')); e.currentTarget.classList.add('active'); }
          }, m === 'paged' ? '⇄ 分页' : '↕ 连续滚动'))));

      const fontSel = el('select', { class: 'input' },
        FONTS.map(f => el('option', { value: f.key }, f.name)));
      fontSel.value = s.font;

      const fsVal = el('span', { class: 'fs-val' }, s.fontSize + 'px');
      const fs = el('input', { type: 'range', min: '14', max: '36', step: '1', value: String(s.fontSize) });
      fs.addEventListener('input', () => { fsVal.textContent = fs.value + 'px'; });

      const lhSel = el('select', { class: 'input' },
        [['1.5', '紧凑 1.5'], ['1.75', '标准 1.75'], ['2', '宽松 2.0']].map(([v, n]) => el('option', { value: v }, n)));
      lhSel.value = String(s.lineHeight);

      const themeRow = el('div', { class: 'seg-row' },
        THEMES.map(t => el('button', {
          class: 'seg-opt' + (s.theme === t.key ? ' active' : ''), 'data-v': t.key,
          onclick: (e) => {
            $$('.seg-opt', themeRow).forEach(o => o.classList.remove('active'));
            e.currentTarget.classList.add('active');
            dayBgRow.style.display = t.key === 'day' ? '' : 'none';
          }
        }, `${t.icon} ${t.name}`)));

      const dayBg = el('input', { type: 'color', value: s.dayBg || '#f5efe2', title: '自定义日间背景颜色' });
      const dayBgRow = el('div', { class: 'set-row', style: { display: s.theme === 'day' ? '' : 'none' } },
        el('div', { class: 'field-label' }, '自定义日间背景'), dayBg);

      const engineSel = el('select', { class: 'input' },
        Object.entries(window.BW.ENGINES).map(([k, v]) => el('option', { value: k }, v.name)));
      engineSel.value = s.searchEngine;

      // 朗读
      const voiceSel = el('select', { class: 'input' });
      voiceSel.appendChild(el('option', { value: '' }, '自动（默认美音）'));
      for (const g of window.BW.TTS.groupedVoices()) {
        const og = el('optgroup', { label: g.name });
        for (const v of g.voices) og.appendChild(el('option', { value: v.name }, g.label(v)));
        voiceSel.appendChild(og);
      }
      voiceSel.value = s.ttsVoice || '';
      const rateVal = el('span', { class: 'fs-val' }, (s.ttsRate || 1) + 'x');
      const rate = el('input', { type: 'range', min: '0.5', max: '2', step: '0.25', value: String(s.ttsRate || 1) });
      rate.addEventListener('input', () => { rateVal.textContent = rate.value + 'x'; });
      const testBtn = el('button', {
        class: 'btn tiny', onclick: () => {
          Store.settings.ttsVoice = voiceSel.value;
          Store.settings.ttsRate = parseFloat(rate.value);
          window.BW.TTS.speakSelection('Reading is a basic tool in the living of a good life.');
        }
      }, '🔊 试听');

      const customBase = el('input', { class: 'input', placeholder: '可选，兼容 Google 翻译的接口地址（如自建代理）' });
      customBase.value = s.customTranslateBase || '';

      // 关于 / 检查更新
      const aboutRow = el('div', { class: 'set-row', style: { alignItems: 'center' } });
      const verSpan = el('span', { class: 'dim', style: { flex: '1' } }, '当前版本 v…');
      window.bw.appVersion().then(v => { verSpan.textContent = '当前版本 v' + v; });
      aboutRow.appendChild(verSpan);
      aboutRow.appendChild(el('button', {
        class: 'btn tiny', onclick: (e) => {
          const btn = e.currentTarget;
          btn.disabled = true; btn.textContent = '检查中…';
          window.BW.App.checkUpdate(true).finally(() => { btn.disabled = false; btn.textContent = '检查更新'; });
        }
      }, '检查更新'));

      openModal({
        title: '设置',
        cls: 'settings-modal',
        body: el('div', { class: 'settings-body' },
          modeRow,
          el('div', { class: 'field-label' }, '字体'), fontSel,
          el('div', { class: 'set-row' },
            el('div', { style: { flex: '1' } }, el('div', { class: 'field-label' }, '字号（14–36）'), fs),
            fsVal),
          el('div', { class: 'set-row' },
            el('div', { style: { flex: '1' } }, el('div', { class: 'field-label' }, '行距'), lhSel)),
          el('div', { class: 'field-label' }, '配色'), themeRow, dayBgRow,
          el('div', { class: 'field-label' }, '选中搜索用的搜索引擎'), engineSel,
          el('div', { class: 'field-label' }, '朗读声音（默认标准美音，可选英音）'), voiceSel,
          el('div', { class: 'set-row' },
            el('div', { style: { flex: '1' } }, el('div', { class: 'field-label' }, '语速（0.5–2 倍）'), rate),
            rateVal, testBtn),
          el('div', { class: 'field-label' }, '自定义翻译接口'), customBase,
          el('div', { class: 'field-label' }, '关于'), aboutRow),
        actions: [
          el('button', { class: 'btn ghost', onclick: () => closeModal() }, '取消'),
          el('button', {
            class: 'btn primary', onclick: async () => {
              const newMode = $('.seg-opt.active', modeRow).dataset.v;
              s.font = fontSel.value;
              s.fontSize = parseInt(fs.value, 10);
              s.lineHeight = parseFloat(lhSel.value);
              s.theme = $('.seg-opt.active', themeRow).dataset.v;
              s.dayBg = dayBg.value;
              s.searchEngine = engineSel.value;
              s.ttsVoice = voiceSel.value;
              s.ttsRate = parseFloat(rate.value);
              s.customTranslateBase = customBase.value.trim();
              if (mode !== newMode) { closeModal(); window.BW.Reader.setMode(newMode); }
              else { s.mode = mode; await Store.saveSettings(); closeModal(); }
              window.BW.App.applySettings();
              if (window.BW.Reader.book && !window.BW.Reader.view.hidden) {
                window.BW.Reader.relayout();
              }
              toast('设置已保存');
            }
          }, '保存')
        ]
      });
    }
  };

  window.BW.Settings = Settings;
  window.BW.FONTS = FONTS;
})();
