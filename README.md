# BodyMake — 3月末までのボディメイク管理ダッシュボード

iPhone の **ヘルスケア** に集まる「体重・睡眠・食事・トレーニング」を毎日自動で取り込みます。
記録を分析して、**今日・今週・3月末・マイルストーン** の目標と、**食事・トレーニングの提案** をダッシュボードに表示します。

使用アプリ：体重＝**タニタ（ヘルスプラネット）**／睡眠＝**Sleep Cycle**／食事＝**カロミル**／筋トレ＝**フィットネスポイント**（`config/goals.json` の `apps` で変更可）

```
睡眠/食事/筋トレ/体重計アプリ ─▶ ヘルスケア ─▶ ショートカット(自動) ─▶ GitHub Actions ─▶ docs/data.json ─▶ ダッシュボード
```

## できること

| 画面 | 内容 |
|---|---|
| **今日の目標** | 体重測定・睡眠・カロリー・PFC・歩数・トレーニングの達成状況、残りカロリーとタンパク質、朝昼夕の食事プラン、今日の筋トレメニュー |
| **コーチからの提案** | 停滞・落ちすぎ・タンパク質不足・睡眠不足・歩数・トレ回数不足などを検知し、具体的な行動を提案（任意で Claude によるAIコーチも） |
| **今週の目標** | 月〜日の予定と実績、筋トレ/有酸素回数、平均カロリー・タンパク質・睡眠・歩数、体重変化、測定日数 |
| **3月末ゴール** | 目標体重・体脂肪率、進捗バー、今のペースでの3月末予測、必要ペース（安全上限つき） |
| **マイルストーン** | 月末ごとの目標体重・体脂肪率と達成判定 |
| **筋力の推移** | FitnessPoint のログ（CSV・スクリーンショット）から、種目ごとの推定1RM、4週間の伸び、停滞、部位別の週セット数を表示。今日のメニューに「前回 → 今日の目標重量」を表示 |
| **推移** | 体重（測定値・トレンド・計画ライン）、カロリー・タンパク質・睡眠の28日グラフ |

### 分析のしくみ

目標モードは2つあります（`goal.mode`）。

| モード | 目的 | 判定の中心 |
|---|---|---|
| `recomp`（現在の設定） | 筋肉を最大限増やしつつ、体脂肪率を下げる | 体脂肪率・除脂肪体重のトレンド |
| `cut` | 筋肉を守りながら減量する | 体重のトレンド |

- **トレンド値**：体重・体脂肪率・除脂肪体重は、日々の水分によるブレをならした指数移動平均で判定します。体組成計の体脂肪率は1日に1〜2%ぶれるので、2週間の流れで見ます
- **リコンプの目標体重**：目標除脂肪体重 ÷ (1 − 目標体脂肪率) で決まります。例：除脂肪 63.6kg → 65.6kg（+2kg）、体脂肪率 22% → 体重 約84kg
- **目標カロリー**：最初は基礎代謝（Mifflin-St Jeor）×活動係数で推定します。食事記録が貯まると、実際の摂取カロリーと体重変化から逆算した消費カロリーに寄せて、毎日自動で再計算します
  - リコンプでは、落とす必要がある **脂肪の量だけ** からカロリー不足を決めます（筋肉を守るため、体重の0.5%/週が上限）
  - **重い日は +150kcal、軽い日・休養日は少なめ** に配分します（週の合計は同じ）
- **PFC**：タンパク質 2.0g/kg、脂質 25%（最低0.6g/kg）、残りを炭水化物
- **トレーニング**：`program` の曜日ごとの部位と強度（軽い日／重い日）に合わせて、セット数・回数・RPE を出します
  - 期間は 適応期 → 筋肥大期 → 仕上げ期 の3段階です
  - 6週ごとに回復週（デロード）を入れます
  - 寝不足の日はボリュームを下げます

---

## セットアップ

### 1. 目標を設定する

`config/goals.json` に自分の数値を入れます（現在は 49歳・167cm・86kg・体脂肪率26.1% → 3月末 22% で設定済み）。

| 項目 | 説明 |
|---|---|
| `profile.sex` / `age` / `heightCm` | `male` or `female`、年齢、身長 |
| `profile.activityLevel` | `sedentary` / `light` / `moderate` / `active`（トレ込みで普通は `moderate`。実測で自動補正されます） |
| `profile.startDate` / `startWeightKg` / `startBodyFatPct` | 計画の開始日と開始時の数値 |
| `goal.mode` | `recomp`（筋肉↑・体脂肪率↓）または `cut`（減量） |
| `goal.targetDate` / `targetBodyFatPct` | 3月末のゴール |
| `goal.leanGainKg` | （recomp）期間中に増やす除脂肪体重の目標。既定 2.0。`targetLeanMassKg` で直接指定も可 |
| `goal.targetWeightKg` | （cut）目標体重。recomp では自動計算 |
| `goal.maxWeeklyLossPct` | 1週間に落としてよい体重の上限（%）。recomp は 0.5、cut は 1.0 が目安 |
| `milestones` | 中間目標。`weightKg` / `bodyFatPct` を省略すると計画ラインから自動計算 |
| `daily` | 睡眠時間・歩数・タンパク質(g/kg)・脂質(%)・重い日の追加カロリー（`heavyDayBonusKcal`） |
| `weekly` | 筋トレ・有酸素の週あたり回数、回復週の間隔（`deloadEveryWeeks`） |
| `program` | 曜日ごとの `部位:強度`。部位は `back_shoulders` `legs` `chest_arms` `push` `pull` `lower` `lower2` `full` `cardio` `rest`、強度は `light`（軽い日）/ `heavy`（重い日） |
| `apps` | 同期状況に表示するアプリ名 |

### 2. main ブランチに入れる

iPhone からの同期（`repository_dispatch`）と毎朝の再計算は、**デフォルトブランチ** のワークフローだけが動きます。このブランチを main にマージしてください。

### 3. ダッシュボードを公開する

GitHub → Settings → **Pages** → Source: *Deploy from a branch* → Branch: `main` / フォルダ: `/docs`。
`https://<ユーザー名>.github.io/bodymake/` で開けます。iPhone の Safari で開いて **共有 → ホーム画面に追加** すると、アプリのように使えます。

> ⚠️ **プライバシー**：GitHub Pages のサイトは誰でも閲覧できます。**公開リポジトリの場合は記録データ（`data/`）も公開されます。**
> 体重などを公開したくない場合は、リポジトリを **Private** にしたうえで、次のどれかにしてください。
> - 有料プラン（Pro）で Private リポジトリの Pages を使う
> - Cloudflare Pages や Netlify（無料）に Private リポジトリをつなぎ、公開フォルダを `docs` にしてアクセス制限をかける
> - 公開せず、ローカルで `npm run serve` して見る

### 4. iPhone の連携を設定する

👉 **[guide/iphone-shortcut.md](guide/iphone-shortcut.md)**

各アプリ → ヘルスケア連携をオンにします。GitHub のトークンを作り、ショートカット「BodyMake 同期」を作って、オートメーションで1日数回自動実行します。

### 5. FitnessPoint のトレーニングログを連携する

👉 **[guide/fitnesspoint.md](guide/fitnesspoint.md)**

過去ログは CSV で一括インポートし、毎日の記録はスクリーンショットを共有シートから送ります。スクリーンショットは iPhone の文字認識で読み取るので、無料で使えます（Claude で画像を読み取る方式も選べます）。

### 6. （任意）AIコーチを有効にする

Settings → Secrets and variables → Actions → **New repository secret** で `ANTHROPIC_API_KEY` を登録します。
毎朝の定期実行で Claude（`claude-opus-5-5`）が、その日の記録と目標をもとにコメントを生成し、ダッシュボードに「AIコーチ」として表示します。
このキーは、FitnessPoint のスクリーンショットを Claude で読み取る方式にも使います。
登録しない場合は、ルールベースの提案だけが表示されます（CSV のインポートはキーなしで使えます）。

---

## ファイル構成

```
config/goals.json          目標・プロフィール・トレーニング予定（編集する）
data/days/YYYY-MM-DD.json  iPhone から届いた日次データ（自動）
data/inbox/                FitnessPoint の CSV・スクショの受け口（取り込み後に削除）
data/training/YYYY-MM-DD.json  筋トレログ（種目・重量・回数）
docs/index.html            ダッシュボード
docs/data.json             分析結果（自動生成）
scripts/ingest.mjs         受信データの正規化・保存
scripts/build.mjs          分析 → docs/data.json
scripts/demo.mjs           サンプルデータでデモ生成
scripts/import-training.mjs  FitnessPoint の CSV・スクショの取り込み
scripts/lib/               分析ロジック（plan / training / advice / analyze / ai-coach）
guide/iphone-shortcut.md   iPhone 連携手順
guide/fitnesspoint.md      FitnessPoint 連携手順
.github/workflows/sync.yml 同期・毎朝の再計算
```

## ローカルで動かす

```bash
npm install
npm run demo     # サンプルデータでダッシュボードを生成
npm run serve    # http://localhost:8080
npm test

# 手動でデータを入れて再計算
echo '{"date":"2026-11-01","weight":{"kg":74.8},"nutrition":{"kcal":2100,"proteinG":150}}' | npm run ingest
npm run build
```

> 最初の同期までは `docs/data.json` がデモデータです（画面上部に「デモ表示」と出ます）。最初の同期で自分のデータに置き換わります。

## 注意

このツールの数値は一般的な推定式にもとづく目安で、医療上のアドバイスではありません。持病がある場合や、体調に異変があるときは医師に相談してください。
