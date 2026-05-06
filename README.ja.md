# OpenCode Enhanced Sidebar

[OpenCode](https://github.com/anomalyco/opencode) の拡張サイドバープラグイン。リアルタイムのセッション分析、ツール追跡、コンテキストヘルスモニタリングを追加します。

## 機能

### 📊 7枚の折りたたみカード

| カード | 説明 |
|------|-------------|
| **Context Health** `[SAFE]/[RISK]/[HIGH]` | コンテキスト使用率バー、キャッシュヒット率、幻覚リスク指数、トークン密度 |
| **Performance** | セッション時間、ターンごとの平均時間、ライブターンタイマー、TPS（トークン/秒） |
| **Cost & Efficiency** | 総コスト、累積出力/推論トークン、セッション・ターンごとのR/O比 |
| **Agents** | メインエージェントの分布（例：Build / Plan 比率） |
| **Tools** | ビルトイン vs MCP 別のツール呼び出し回数、成功率、アクションチェーン、平均ツール時間 |
| **Model & Session** | アクティブモデル、コンテキスト上限、メッセージ分布、ターンごとのコンテキスト内訳 |
| **Hot Files** | 読み取り/変更の多いファイル（フルパス＋回数表示） |

### ⏱️ ライブタイマー

現在のAIターンの実行時間を1秒ごとに更新するリアルタイムカウンター。

### 🔧 ツール追跡（独立したサーバープラグイン）

- セッションごとのツール呼び出し統計（会話間でデータが混ざらない）
- MCPツールはプロバイダーごとに自動グループ化（共通プレフィックスは非表示）
- ファイルの読み取り/書き込みアクティビティを追跡し、Hot Filesに表示
- 成功率とツールごとの平均処理時間

## アーキテクチャ

```
ユーザー → TUIプラグイン (rounds-plugin.tsx)
  ├─ api.state.session.messages()  → 静的セッションデータ
  ├─ api.state.session.diff()      → ファイル変更
  └─ _tool_stats_{sessionID}.json を1秒ごとにポーリング

サーバープラグイン (tool-tracker.tsx)
  ├─ tool.execute.before   → 読み取り/書き込みを記録（ファイルパス）
  └─ tool.execute.after    → 回数/時間/成功率を記録
       └─ _tool_stats_{sessionID}.json に書き込み（セッションごと、マージ安全）
```

## インストール

### Windows (PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

### 手動インストール

1. `src/rounds-plugin.tsx` と `src/tool-tracker.tsx` を `~\.config\opencode\` にコピー
2. プラグイン参照を追加：
   - `tui.json`: `"plugin": ["./rounds-plugin.tsx"]`
   - `opencode.jsonc`: `"plugin": ["./tool-tracker.tsx"]`
3. 依存関係をインストール: `cd ~\.config\opencode && npm install solid-js @opentui/solid`
4. OpenCodeを再起動

## 要件

- OpenCode ≥ v1.14.x
- `@opencode-ai/plugin`（OpenCodeが自動インストール）
- `solid-js`、`@opentui/solid`（TUIプラグインのレンダリングに必要）

## 既知の制限

- ツール呼び出しイベントはV2同期プロトコルを使用し、TUIプラグインAPIに到達する前にフィルタリングされます。サーバープラグインがJSONファイルのポーリングでこのギャップを埋めます。
- 過去のセッションデータは利用できません — ツール追跡は各セッションで新規開始します。
- メッセージへのスクロールやセッション切り替えはTUIプラグインAPIからは不可能です。
- macOS/Linux：手動インストールのみ（インストールスクリプトはWindows専用）。

## ライセンス

MIT © [nt-cubic](https://github.com/nt-cubic)
