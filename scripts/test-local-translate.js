'use strict';
/* 本地离线翻译模型测试 */
const path = require('path');

async function main() {
  const { pipeline, env } = require('@xenova/transformers');
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = path.join(__dirname, '..', 'app', 'models');
  const t0 = Date.now();
  const translator = await pipeline('translation', 'opus-mt-en-zh', { quantized: true });
  console.log('模型加载耗时:', ((Date.now() - t0) / 1000).toFixed(1) + 's');

  const sentences = [
    'The river ran below the road.',
    'He stopped to rest, and the hill above him was dark with pines.',
    'The road out of the village was narrow and old, and in the late afternoon the light lay along it like honey poured over stone.'
  ];
  const t1 = Date.now();
  for (const s of sentences) {
    const r = await translator(s, { max_new_tokens: 512 });
    console.log(`[${Date.now() - t1}ms] ${s}`);
    console.log('   → ' + (r[0] && r[0].translation_text));
  }
  console.log('本地翻译 OK');
}

main().catch(e => { console.error('FAIL:', e && e.message || e); process.exit(1); });
