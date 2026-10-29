# BodyMake — 3月末までのボディメイク管理ダッシュボード

iPhone の **ヘルスケア** に集まる「体重・睡眠・食事・トレーニング」を毎日自動で取り込みます。
記録を分析して、**今日・今週・3月末・マイルストーン** の目標と、**食事・トレーニングの提案** をダッシュボードに表示します。

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
| **推移** | 体重（測定値・トレンド・計画ライン）、カロリー・タンパク質・睡眠の28日グラフ |

### 分析のしくみ

- **トレンド体重**：日々の水分による変動をならした指数移動平均。判定は全部これで行います
- **目標カロリー**：最初は基礎代謝（Mifflin-St Jeor）×活動係数で推定します。食事記録が貯まると「実際の摂取カロリー − 体重変化」から実測の消費カロリーに寄せていき、**毎日自動で再計算**します
- **減量ペース**：3月末までに必要なペースを計算します。ただし筋量を守るため **体重の1%/週** を上限にします（超える場合は警告と到達見込みを表示）
- **PFC**：タンパク質 2.0g/kg、脂質 25%（最低0.6g/kg）、残りを炭水化物
- **トレーニング**：週4回の分割法（プッシュ／下半身A／プル／下半身B）＋有酸素2回。期間を 基礎期 → 減量期 → 仕上げ期 に分けてセット数と回数を変えます。寝不足の日はボリュームを下げ、週の回数が足りなければ振り替えます

---

## セットアップ

### 1. 目標を設定する

`config/goals.json` を自分の数値に書き換えます（**初期値はサンプル**）。

| 項目 | 説明 |
|---|---|
| `profile.sex` / `age` / `heightCm` | `male` or `female`、年齢、身長 |
| `profile.activityLevel` | `sedentary` / `light` / `moderate` / `active`（トレ込みで普通は `moderate`） |
| `profile.startDate` / `startWeightKg` / `startBodyFatPct` | 計画の開始日と開始時の数値 |
| `goal.targetDate` / `targetWeightKg` / `targetBodyFatPct` | 3月末のゴール |
| `goal.maxWeeklyLossPct` | 1週間に落としてよい体重の上限（%）。既定 1.0 |
| `milestones` | 中間目標。`weightKg` / `bodyFatPct` を省略すると計画ラインから自動計算 |
| `daily` | 睡眠時間・歩数・タンパク質(g/kg)・脂質(%) |
| `weekly` | 筋トレ・有酸素の週あたり回数 |
| `program` | 曜日ごとのメニュー：`push` `pull` `lower` `lower2` `full` `cardio` `rest` |

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

### 5. （任意）AIコーチを有効にする

Settings → Secrets and variables → Actions → **New repository secret** で `ANTHROPIC_API_KEY` を登録します。
毎朝の定期実行で Claude（`claude-opus-5-5`）が、その日の記録と目標をもとにコメントを生成し、ダッシュボードに「AIコーチ」として表示します。
登録しない場合は、ルールベースの提案だけが表示されます。

---

## ファイル構成

```
config/goals.json          目標・プロフィール・トレーニング予定（編集する）
data/days/YYYY-MM-DD.json  iPhone から届いた日次データ（自動）
docs/index.html            ダッシュボード
docs/data.json             分析結果（自動生成）
scripts/ingest.mjs         受信データの正規化・保存
scripts/build.mjs          分析 → docs/data.json
scripts/demo.mjs           サンプルデータでデモ生成
scripts/lib/               分析ロジック（plan / training / advice / analyze / ai-coach）
guide/iphone-shortcut.md   iPhone 連携手順
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
