// FitnessPoint のスクリーンショット → 種目・重量・回数（Claude の画像読み取り）
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const MEDIA = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
export const isImage = (file) => Boolean(MEDIA[path.extname(file).toLowerCase()]);

const nullable = (type, description) => ({ anyOf: [{ type }, { type: 'null' }], description });

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isWorkoutLog', 'date', 'summary', 'exercises'],
  properties: {
    isWorkoutLog: { type: 'boolean', description: '筋トレの記録画面なら true' },
    date: nullable('string', '画面に表示されている実施日（YYYY-MM-DD）。表示がない・年が分からない場合は null'),
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['exercises', 'sets', 'volumeKg', 'reps'],
      description: '画面上部の合計（エクササイズ・セット数・ボリューム・回数）。写っていなければ各値 null',
      properties: {
        exercises: nullable('integer', 'エクササイズ数'),
        sets: nullable('integer', 'セット数'),
        volumeKg: nullable('number', 'ボリューム（kg）'),
        reps: nullable('integer', '回数'),
      },
    },
    exercises: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'kind', 'sets'],
        properties: {
          name: { type: 'string', description: '種目名（画面の表記のまま）' },
          kind: { type: 'string', enum: ['strength', 'cardio'], description: '重量×回数なら strength、時間（分）で記録されていれば cardio' },
          sets: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['weightKg', 'reps', 'minutes', 'note'],
              properties: {
                weightKg: nullable('number', '重量（kg）。lbs表記ならkgに換算。自重なら0。時間の種目は null'),
                reps: nullable('integer', '回数（「レップ」）。時間の種目は null'),
                minutes: nullable('number', '時間で記録されたセットの分数。それ以外は null'),
                note: nullable('string', 'セットの下に小さく書かれたメモ（例：「1秒スクイーズ」）。なければ null'),
              },
            },
          },
        },
      },
    },
  },
};

const PROMPT = `これは筋トレ記録アプリ「Fitness Point」のワークアウト詳細画面のスクリーンショットです。
画面の表記は「#1: 100 kg x 20 レップ」（セット番号: 重量 x 回数）、時間で記録する種目は「#1: 40 分」です。
セットの下の小さい文字はそのセットのメモです。
- 写っている種目ごとに、各セットを上から順にすべて書き出す。写っていない種目やセットは推測で補わない
- 種目名は画面の表記をそのまま使う（翻訳しない）
- 画面上部に「エクササイズ」「セット数」「ボリューム」「回数」の合計が写っていれば summary に入れる
- 筋トレの記録画面でなければ isWorkoutLog を false にして exercises は空にする`;

/** Claude の出力を、テキスト解析と同じ形にそろえる */
function normalizeResult(r) {
  const exercises = r.exercises.map((e) => {
    const sets = e.sets.map((x) => {
      const out = x.minutes != null && x.reps == null ? { minutes: x.minutes } : { weightKg: x.weightKg ?? 0, reps: x.reps ?? 0 };
      if (x.note) out.note = x.note;
      return out;
    });
    const ex = { name: e.name, sets };
    if (e.kind === 'cardio') {
      ex.kind = 'cardio';
      ex.minutes = sets.reduce((n, x) => n + (x.minutes ?? 0), 0);
    }
    const notes = [...new Set(sets.map((x) => x.note).filter(Boolean))];
    if (notes.length) ex.note = notes.join(' / ');
    return ex;
  });
  const summary = r.summary && Object.values(r.summary).some((v) => v != null) ? r.summary : null;
  return { isWorkoutLog: r.isWorkoutLog, date: r.date, summary, exercises };
}

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
  return normalizeResult(JSON.parse(text));
}
