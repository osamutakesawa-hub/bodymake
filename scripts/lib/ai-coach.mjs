// （任意）Claude によるパーソナルコーチのコメント。ANTHROPIC_API_KEY があるときだけ動く
import Anthropic from '@anthropic-ai/sdk';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'today', 'nutrition', 'training', 'recovery', 'weekFocus'],
  properties: {
    headline: { type: 'string', description: '今日のひとこと（40字以内）' },
    today: { type: 'array', items: { type: 'string' }, description: '今日やるべき具体的な行動 3つ' },
    nutrition: { type: 'array', items: { type: 'string' }, description: '食事の具体的な提案（食品名・量つき）' },
    training: { type: 'array', items: { type: 'string' }, description: 'トレーニングの提案（重量・回数の進め方）' },
    recovery: { type: 'array', items: { type: 'string' }, description: '睡眠・回復の提案' },
    weekFocus: { type: 'string', description: '今週の重点テーマ（1文）' },
  },
};

const SYSTEM = `あなたは日本語で指導するボディメイクのパーソナルトレーナー兼管理栄養士です。
ユーザーの目標は JSON の goal にあります（mode が recomp なら「筋肉を最大限増やしつつ体脂肪率を下げる」、cut なら「筋量を守りながら減量」）。
recomp では体重の増減ではなく、体脂肪率と除脂肪体重のトレンドで評価してください。年齢（profile.age）に合った回復と関節への配慮も入れてください。
渡される JSON は、iPhone のヘルスケアから集計した記録と、ルールベースで算出済みの目標値・アドバイスです。
- 目標カロリーやPFCの数値はJSONの targets を正とし、勝手に別の数値を作らないこと
- 抽象論ではなく「何を・どれだけ・いつ」が分かる行動に落とすこと（日本のコンビニや定食でも実行できる例を優先）
- データが不足している項目は推測せず、記録を促すこと
- 医療的な診断はしないこと。体調不良や極端な数値がある場合は休養と専門家への相談を勧めること`;

function summarize(d) {
  return {
    today: d.today,
    profile: d.profile,
    current: d.current,
    goal: d.goal,
    targets: d.targets,
    energy: d.energy,
    todayGoals: d.todayGoals,
    week: { goals: d.week.goals, plan: d.week.plan.map(({ date, name, done }) => ({ date, name, done })) },
    training: d.training,
    milestones: d.milestones,
    ruleAdvice: d.advice.map(({ level, title, detail }) => ({ level, title, detail })),
    last14days: d.series.daily.slice(-14),
  };
}

export async function aiCoach(dashboard) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: `今日の記録と目標です。今日のコーチングをください。\n\n${JSON.stringify(summarize(dashboard))}` }],
  });
  if (response.stop_reason === 'refusal') {
    console.warn('AIコーチ: リクエストが拒否されました', response.stop_details);
    return null;
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { ...JSON.parse(text), model: response.model, generatedAt: new Date().toISOString() };
}
