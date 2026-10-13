# OpenCode Enhanced Sidebar

[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md)

---

An enhanced sidebar plugin for [OpenCode](https://github.com/anomalyco/opencode) **V2** that adds real-time session analytics, tool tracking, and context health monitoring.

![Screenshot](screenshot.png)

## 📋 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Installation](#-installation)
- [Requirements](#-requirements)
- [Known Limitations](#-known-limitations)
- [License](#-license)

## 📊 Features

### 📊 7 Collapsible Cards

| Card | Description |
|------|-------------|
| **Context Health** `[SAFE]/[RISK]/[HIGH]` | Context usage bar, cache hit rate, hallucination risk index, token density |
| **Performance** | Session duration, avg time per turn, live turn timer, TPS (tokens/second) |
| **Cost & Efficiency** | Total cost, cumulative output/reasoning tokens, R/O ratio per session and per turn |
| **Agents** | Main agent distribution (e.g. Build / Plan ratios) |
| **Tools** | Tool call counts split by Built-in vs MCP, success/fail rate, action chain, avg tool time |
| **Model & Session** | Active model, context limit, message distribution, per-turn context breakdown |
| **Hot Files** | Most-read and most-modified files with full paths and read/edit counts |

### ⏱️ Live Timer

A real-time counter showing how long the current AI turn has been running. Updates every second.

### 🔧 Tool Tracking (Built Into the Sidebar)

- Per-session tool call statistics (doesn't cross-contaminate between conversations)
- MCP tools automatically grouped by server, with the server prefix stripped
- File read/write activity tracked for the Hot Files card
- Success/fail rate and per-tool average timing
- All statistics are derived from the session transcript itself — there is no companion server plugin and no JSON file polling

## Architecture

OpenCode V2 assistant messages carry inline tool state (`content[].state`, `content[].time`), so the sidebar is a single terminal plugin:

```
You → CLI plugin (plugins/enhanced-sidebar/tui.tsx)
  ├─ data.session.message.list()   → live message window (reactive)
  ├─ client.message.list()         → full transcript, paginated (refreshed each turn)
  ├─ client.session.diff()         → changed files (+/-)
  ├─ data.session.get()            → session cost, tokens, timestamps
  └─ data.location.{model,mcp}     → context limits, MCP server names
```

## Installation

### Windows (PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

The installer copies `plugins/enhanced-sidebar/` to `~\.config\opencode\plugins\enhanced-sidebar\`, disables leftover V1 plugin files, and removes stale `./rounds-plugin.tsx` / `./tool-tracker.tsx` config entries.

### Manual installation

1. Copy the `plugins/enhanced-sidebar/` directory to `~\.config\opencode\plugins\enhanced-sidebar\` (Windows) or `~/.config/opencode/plugins/enhanced-sidebar/` (macOS/Linux).
2. Restart OpenCode. V2 discovers `plugins/enhanced-sidebar/tui.tsx` automatically — no `opencode.jsonc` or `cli.json` entry is required.
   - Prefer an explicit reference (for example a project-local install)? Add `"plugins": ["./plugins/enhanced-sidebar"]` to `opencode.jsonc`.

## Requirements

- OpenCode ≥ v2.0 (V2 plugin API)
- No npm install needed: OpenCode resolves `@opencode/plugin/tui`, `solid-js`, and `@opentui/solid` at runtime.

## Known Limitations

- OpenCode V1 is not supported. The previous V1 implementation (`src/rounds-plugin.tsx`, `src/tool-tracker.tsx`) remains available in git history.
- Session-wide statistics load the full transcript through the paged messages API; long sessions are refreshed once per finished turn.
- Scroll-to-message and session-switching are not possible from the CLI plugin API.
- macOS/Linux: manual installation only (install script is Windows-only).

## Development

```sh
npm install
npm run typecheck   # TypeScript check against the OpenCode V2 plugin API
npm run smoke       # headless render test (requires Bun: https://bun.sh)
```

## License

MIT © [nt-cubic](https://github.com/nt-cubic)
