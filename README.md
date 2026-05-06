# OpenCode Enhanced Sidebar

An enhanced sidebar plugin for [OpenCode](https://github.com/anomalyco/opencode) that adds real-time session analytics, tool tracking, and context health monitoring.

## Features

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

### 🔧 Tool Tracking (Separate Server Plugin)

- Per-session tool call statistics (doesn't cross-contaminate between conversations)
- MCP tools automatically grouped by provider with common prefixes stripped
- File read/write activity tracked for Hot Files display
- Success/fail rate and per-tool average timing

## Architecture

```
You → TUI Plugin (rounds-plugin.tsx)
  ├─ api.state.session.messages()  → static session data
  ├─ api.state.session.diff()      → file changes
  └─ polls _tool_stats_{sessionID}.json  ← every 1s

Server Plugin (tool-tracker.tsx)
  ├─ tool.execute.before   → records reads/writes (file paths)
  └─ tool.execute.after    → records counts/timing/success
       └─ writes _tool_stats_{sessionID}.json  (per-session, merge-safe)
```

## Installation

### Windows (PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

### Manual Installation

1. Copy `src/rounds-plugin.tsx` and `src/tool-tracker.tsx` to `~\.config\opencode\`
2. Add plugin references:
   - `tui.json`: `"plugin": ["./rounds-plugin.tsx"]`
   - `opencode.jsonc`: `"plugin": ["./tool-tracker.tsx"]`
3. Install dependencies: `cd ~\.config\opencode && npm install solid-js @opentui/solid`
4. Restart OpenCode

## Requirements

- OpenCode ≥ v1.14.x
- `@opencode-ai/plugin` (auto-installed by OpenCode)
- `solid-js`, `@opentui/solid` (required for TUI plugin rendering)

## Known Limitations

- Tool call events use V2 sync protocol which is filtered before reaching the TUI plugin API. The server plugin bridges this gap via JSON file polling.
- Historical session data is not available — tool tracking starts fresh each session.
- Scroll-to-message and session-switching are not possible from the TUI plugin API.
- macOS/Linux: manual installation only (install script is Windows-only).

## License

MIT © [nt-cubic](https://github.com/nt-cubic)
