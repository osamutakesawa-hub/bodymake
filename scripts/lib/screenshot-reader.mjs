// FitnessPoint のスクリーンショット → 種目・重量・回数（Claude の画像読み取り）
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const MEDIA = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
export const isImage = (file) => Boolean(MEDIA[path.extname(file).toLowerCase()]);

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isWorkoutLog', 'date', 'exercises'],
  properties: {
    isWorkoutLog: { type: 'boolean', description: '筋トレの記録画面なら true' },
    date: { anyOf: [{ type: 'string' }, { type: 'null' }], description: '画面に表示されている実施日（YYYY-MM-DD）。表示がない・年が分からない場合は null' },
    exercises: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'sets'],
        properties: {
          name: { type: 'string', description: '種目名（画面の表記のまま）' },
          sets: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['weightKg', 'reps', 'warmup'],
              properties: {
                weightKg: { type: 'number', description: '重量（kg）。lbs表記ならkgに換算。自重なら0' },
                reps: { type: 'integer', description: '回数' },
                warmup: { type: 'boolean', description: 'ウォームアップと明示されているセットなら true' },
              },
            },
          },
        },
      },
    },
  },
};

const PROMPT = `これは筋トレ記録アプリ「Fitness Point」のスクリーンショットです。
画面に写っている種目ごとに、各セットの重量と回数を上から順にすべて書き出してください。
- 画面に写っていない種目やセットを推測で補わないこと
- 「60 kg × 10」「60kg 10回」「10 reps @ 60」などの表記をすべて重量と回数に分解する
- 種目名は画面の表記をそのまま使う（翻訳しない）
- 筋トレの記録画面でなければ isWorkoutLog を false にして exercises は空にする`;

export async function readScreenshot(file, client = new Anthropic()) {
  const data = fs.readFileSync(file).toString('base64');
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: MEDIA[path.extname(file).toLowerCase()], data } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  });
  if (response.stop_reason === 'refusal') throw new Error('画像の読み取りが拒否されました');
  if (response.stop_reason === 'max_tokens') throw new Error('読み取り結果が長すぎて途中で切れました');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}
