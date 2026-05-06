# OpenCode Enhanced Sidebar

为 [OpenCode](https://github.com/anomalyco/opencode) 打造的增强侧边栏插件，提供实时会话分析、工具追踪和上下文健康监控。

## 📋 目录

- [功能](#-功能)
- [架构](#-架构)
- [安装](#-安装)
- [环境要求](#-环境要求)
- [已知限制](#-已知限制)
- [许可证](#-许可证)

## 📊 功能

### 📊 7 张折叠卡片

| 卡片 | 说明 |
|------|------|
| **Context Health** `[SAFE]/[RISK]/[HIGH]` | 上下文使用率条、缓存命中率、幻觉风险指数、对话密度 |
| **Performance** | 会话总时长、每轮均耗时、实时计时、TPS（每秒 Token） |
| **Cost & Efficiency** | 总花费、累积 Output/Reasoning Token、会话/末轮推理效率比 |
| **Agents** | 主智能体分布（如 Build / Plan 占比） |
| **Tools** | 内置工具 vs MCP 工具分类调用次数、成功率、动作链、平均工具耗时 |
| **Model & Session** | 当前模型、上下文上限、消息分布、每轮上下文组成 |
| **Hot Files** | 最常读取和修改的文件列表（含完整路径和次数） |

### ⏱️ Live 实时计时

每秒刷新，显示当前 AI 轮次已运行时长。轮次完成时自动停止。

### 🔧 工具追踪（独立 Server 插件）

- 按会话隔离的工具调用统计（不同对话互不污染）
- MCP 工具按供应方自动分组，隐藏公共前缀
- 文件读写活动追踪，供 Hot Files 展示
- 成功率/失败率和每种工具的平均耗时

## 架构

```
你 → TUI 插件 (rounds-plugin.tsx)
  ├─ api.state.session.messages()  → 静态会话数据
  ├─ api.state.session.diff()      → 文件变更
  └─ 轮询 _tool_stats_{sessionID}.json  ← 每 1 秒

Server 插件 (tool-tracker.tsx)
  ├─ tool.execute.before   → 记录文件读写（文件路径）
  └─ tool.execute.after    → 记录次数/耗时/成功率
       └─ 写入 _tool_stats_{sessionID}.json（按会话隔离，安全合并）
```

## 安装

### Windows（一键）

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

### 手动安装

1. 将 `src/rounds-plugin.tsx` 和 `src/tool-tracker.tsx` 复制到 `~\.config\opencode\`
2. 添加插件引用：
   - `tui.json`：`"plugin": ["./rounds-plugin.tsx"]`
   - `opencode.jsonc`：`"plugin": ["./tool-tracker.tsx"]`
3. 安装依赖：`cd ~\.config\opencode && npm install solid-js @opentui/solid`
4. 重启 OpenCode

## 环境要求

- OpenCode ≥ v1.14.x
- `@opencode-ai/plugin`（OpenCode 自动安装）
- `solid-js`、`@opentui/solid`（TUI 插件渲染所需）

## 已知限制

- 工具调用事件使用 V2 sync 协议，在到达 TUI 插件前被过滤。Server 插件通过 JSON 文件轮询桥接。
- 历史会话数据不可用——每个会话的工具追踪从零开始。
- TUI 插件 API 不支持滚动到指定消息或切换会话。
- macOS/Linux：仅支持手动安装（安装脚本仅 Windows）。

## 许可证

MIT © [nt-cubic](https://github.com/nt-cubic)
