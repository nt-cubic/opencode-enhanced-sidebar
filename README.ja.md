# OpenCode Enhanced Sidebar

[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md)

---

[OpenCode](https://github.com/anomalyco/opencode) **V2** の拡張サイドバープラグイン。リアルタイムのセッション分析、ツール追跡、コンテキストヘルスモニタリングを追加します。

![スクリーンショット](screenshot.png)

## 📋 目次

- [機能](#-機能)
- [アーキテクチャ](#-アーキテクチャ)
- [インストール](#-インストール)
- [要件](#-要件)
- [既知の制限](#-既知の制限)
- [ライセンス](#-ライセンス)

## 📊 機能

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

### 🔧 ツール追跡（サイドバーに内蔵）

- セッションごとのツール呼び出し統計（会話間でデータが混ざらない）
- MCPツールはサーバーごとに自動グループ化（共通プレフィックスは非表示）
- ファイルの読み取り/書き込みアクティビティを追跡し、Hot Filesに表示
- 成功率とツールごとの平均処理時間
- 統計はすべてセッションメッセージ自体から算出 — サーバープラグインもJSONファイルのポーリングも不要

## アーキテクチャ

OpenCode V2 のアシスタントメッセージはツール呼び出し状態（`content[].state`、`content[].time`）をインラインで保持するため、サイドバーは単一のターミナルプラグインです：

```
ユーザー → CLIプラグイン (plugins/enhanced-sidebar/tui.tsx)
  ├─ data.session.message.list()   → ライブメッセージウィンドウ（リアクティブ）
  ├─ client.message.list()         → 完全なトランスクリプトをページング取得（ターン終了ごとに更新）
  ├─ client.session.diff()         → ファイル変更（+/-）
  ├─ data.session.get()            → セッションのコスト、トークン、時刻
  └─ data.location.{model,mcp}     → コンテキスト上限、MCPサーバー名
```

## インストール

### Windows (PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

インストーラーは `plugins/enhanced-sidebar/` を `~\.config\opencode\plugins\enhanced-sidebar\` にコピーし、旧V1プラグインファイルを無効化して、設定に残った `./rounds-plugin.tsx`・`./tool-tracker.tsx` の不要なエントリを削除します。

### 手動インストール

1. `plugins/enhanced-sidebar/` ディレクトリを `~\.config\opencode\plugins\enhanced-sidebar\`（Windows）または `~/.config/opencode/plugins/enhanced-sidebar/`（macOS/Linux）にコピーします。
2. OpenCodeを再起動します。V2 は `plugins/enhanced-sidebar/tui.tsx` を自動的に検出するため、`opencode.jsonc` や `cli.json` への追記は不要です。
   - 明示的に参照したい場合（プロジェクト単位のインストールなど）は、`opencode.jsonc` に `"plugins": ["./plugins/enhanced-sidebar"]` を追加します。

## 要件

- OpenCode ≥ v2.0（V2プラグインAPI）
- npm install は不要：OpenCode は実行時に `@opencode/plugin/tui`、`solid-js`、`@opentui/solid` を解決します。

## 既知の制限

- OpenCode V1 はサポートしません。以前の V1 実装（`src/rounds-plugin.tsx`、`src/tool-tracker.tsx`）は git 履歴に残っています。
- セッション全体の統計はページングされたメッセージAPIでトランスクリプト全体を取得します。長いセッションはターン終了ごとに更新されます。
- メッセージへのスクロールやセッション切り替えは CLI プラグインAPIからは不可能です。
- macOS/Linux：手動インストールのみ（インストールスクリプトはWindows専用）。

## 開発

```sh
npm install
npm run typecheck   # OpenCode V2 プラグインAPIに対する TypeScript チェック
npm run smoke       # ヘッドレスレンダーテスト（Bun が必要: https://bun.sh）
```

## ライセンス

MIT © [nt-cubic](https://github.com/nt-cubic)
