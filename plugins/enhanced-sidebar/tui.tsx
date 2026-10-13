/**
 * OpenCode Enhanced Sidebar — OpenCode V2 CLI plugin.
 *
 * Registers a `sidebar.content` slot with real-time session analytics.
 * All statistics are derived from V2 server data:
 *
 *   context.data.session.*         → live session info / cached message window
 *   context.client.message.list()  → full session transcript (paginated)
 *   context.client.session.diff()  → changed files
 *   context.data.location.*        → models, MCP servers
 *
 * No companion server plugin is needed: V2 assistant messages carry inline
 * tool call state (`content[].state`, `content[].time`), so the sidebar can
 * compute tool statistics directly from the transcript.
 */
import type { RGBA } from "@opentui/core"
import type { FileDiffInfo, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { readdirSync } from "node:fs"
import { basename, join } from "node:path"

const id = "enhanced-sidebar"

const n = (v: number) => v.toLocaleString()

function fmtMs(ms: number): string {
  if (ms <= 0) return "--"
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${m}m ${s}s`
}

function fmtTs(ts: number): string {
  if (ts <= 0) return "--"
  return new Date(ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

function createdOf(message: SessionMessageInfo): number {
  return (message as { time?: { created?: number } }).time?.created ?? 0
}

/** Merge the full fetched transcript with the live (possibly partial) store window. */
function mergeMessages(base: SessionMessageInfo[], live: SessionMessageInfo[]): SessionMessageInfo[] {
  if (live.length === 0) return base
  if (base.length === 0) return live
  const byID = new Map<string, SessionMessageInfo>()
  for (const message of base) byID.set(message.id, message)
  for (const message of live) byID.set(message.id, message)
  return [...byID.values()].sort((a, b) => createdOf(a) - createdOf(b))
}

type ToolInput = Record<string, unknown>

function toolInput(tool: SessionMessageAssistantTool): ToolInput | null {
  const input = tool.state.status === "streaming" ? undefined : tool.state.input
  return input && typeof input === "object" ? (input as ToolInput) : null
}

function filePathOf(input: ToolInput | null): string | null {
  if (!input) return null
  const value = input.filePath ?? input.filepath ?? input.file ?? input.path
  return typeof value === "string" && value ? value : null
}

function toolDuration(tool: SessionMessageAssistantTool): number {
  const created = tool.time.created
  const ran = tool.time.ran ?? 0
  const completed = tool.time.completed ?? 0
  if (!completed) return 0
  return ran > 0 ? completed - ran : created > 0 ? completed - created : 0
}

type Colors = {
  text: RGBA
  textMuted: RGBA
  error: RGBA
  warning: RGBA
  primary: RGBA
  diffAdded: RGBA
  diffRemoved: RGBA
}

function colors(theme: Context["theme"]): Colors {
  return {
    text: theme.text.base,
    textMuted: theme.text.muted,
    error: theme.text.feedback.error.base,
    warning: theme.text.feedback.warning.base,
    primary: theme.text.action.primary.base,
    diffAdded: theme.diff.text.added,
    diffRemoved: theme.diff.text.removed,
  }
}

function Bar(props: { pct: number; fg: RGBA; bg: RGBA }) {
  const filled = Math.min(Math.round((props.pct / 100) * 20), 20)
  return (
    <text>
      <span style={{ fg: props.fg }}>{"█".repeat(filled)}</span>
      <span style={{ fg: props.bg }}>{"░".repeat(Math.max(20 - filled, 0))}</span>
    </text>
  )
}

function FileTree(props: { dir: string; theme: Colors; depth?: number }) {
  const depth = props.depth ?? 0
  const [open, setOpen] = createSignal(depth < 1)
  const [items, setItems] = createSignal<{ name: string; isDir: boolean }[]>([])
  const indent = "  ".repeat(depth)
  createEffect(() => {
    if (!open()) return
    try {
      const entries = readdirSync(props.dir, { withFileTypes: true })
      setItems(entries.filter((e) => !e.name.startsWith(".")).sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1
        if (!a.isDirectory() && b.isDirectory()) return 1
        return a.name.localeCompare(b.name)
      }).map((e) => ({ name: e.name, isDir: e.isDirectory() })))
    } catch { setItems([]) }
  })
  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={() => setOpen((x) => !x)}>
        <text fg={props.theme.text}>{open() ? "▼" : "▶"}</text>
        <text fg={props.theme.text}>{basename(props.dir)}</text>
      </box>
      <Show when={open()}>
        <For each={items()}>{(item) => item.isDir
          ? <FileTree dir={join(props.dir, item.name)} theme={props.theme} depth={depth + 1} />
          : <text fg={props.theme.textMuted}>{indent}  {item.name}</text>}</For>
      </Show>
    </box>
  )
}

/** Fetch the complete transcript of a session through the paged messages API. */
async function fetchTranscript(client: Context["client"], sessionID: string): Promise<SessionMessageInfo[]> {
  const messages: SessionMessageInfo[] = []
  let cursor: string | undefined
  while (true) {
    const page = await client.message.list(
      cursor ? { sessionID, limit: 200, cursor } : { sessionID, limit: 200, order: "desc" },
    )
    messages.push(...page.data)
    const next = page.cursor.next ?? undefined
    if (!next) break
    cursor = next
  }
  return messages.reverse()
}

export function View(props: { context: Context; sessionID: string }) {
  const context = props.context
  const t = createMemo(() => colors(context.theme))
  const location = createMemo(() => context.location ?? context.data.location.default())

  // ——— session & full transcript ———
  const [messages, setMessages] = createSignal<SessionMessageInfo[]>([])
  const [diffs, setDiffs] = createSignal<FileDiffInfo[]>([])

  const live = createMemo(() => context.data.session.message.list(props.sessionID))
  const msg = createMemo(() => mergeMessages(messages(), live()))

  const session = createMemo(() => context.data.session.get(props.sessionID))
  const status = createMemo(() => context.data.session.status(props.sessionID))

  const load = (sessionID: string) => {
    void Promise.allSettled([
      fetchTranscript(context.client, sessionID),
      context.client.session.diff({ sessionID }),
    ]).then(([transcript, diff]) => {
      if (props.sessionID !== sessionID) return
      if (transcript.status === "fulfilled") setMessages(transcript.value)
      if (diff.status === "fulfilled") setDiffs(diff.value)
    })
  }

  createEffect(() => {
    const sessionID = props.sessionID
    setMessages([])
    setDiffs([])
    load(sessionID)
  })

  onMount(() => {
    let pending: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(pending)
      pending = setTimeout(() => load(props.sessionID), 250)
    }
    const stops = [
      context.data.on("session.execution.succeeded", (event) => {
        if (event.data.sessionID === props.sessionID) refresh()
      }),
      context.data.on("session.execution.failed", (event) => {
        if (event.data.sessionID === props.sessionID) refresh()
      }),
      context.data.on("session.compaction.ended", (event) => {
        if (event.data.sessionID === props.sessionID) refresh()
      }),
    ]
    onCleanup(() => {
      clearTimeout(pending)
      for (const stop of stops) stop()
    })
  })

  const userCount = createMemo(() => msg().filter((m) => m.type === "user").length)
  const asstCount = createMemo(() => msg().filter((m) => m.type === "assistant").length)

  const last = createMemo(() => {
    const all = msg()
    for (let i = all.length - 1; i >= 0; i--) {
      const m = all[i]
      if (m.type !== "assistant") continue
      if (m.tokens && typeof m.tokens.output === "number" && m.tokens.output > 0) return m
    }
    return null
  })

  // ——— stats ———
  const stats = createMemo(() => {
    let out = 0, rsn = 0, cost = 0, errs = 0, cacheR = 0, cacheW = 0, input = 0
    let firstCreated = 0, lastCompleted = 0, sumAsstMs = 0
    const agents: Record<string, number> = {}
    for (const m of msg()) {
      const created = createdOf(m)
      if (created > 0 && (!firstCreated || created < firstCreated)) firstCreated = created
      if (m.type !== "assistant") continue
      agents[m.agent] = (agents[m.agent] || 0) + 1
      input += m.tokens?.input ?? 0
      out += m.tokens?.output ?? 0
      rsn += m.tokens?.reasoning ?? 0
      cacheR += m.tokens?.cache?.read ?? 0
      cacheW += m.tokens?.cache?.write ?? 0
      cost += m.cost ?? 0
      if (m.error) errs++
      const completed = m.time?.completed ?? 0
      if (completed > lastCompleted) lastCompleted = completed
      const dur = completed > 0 && created > 0 ? completed - created : 0
      if (dur > 0) sumAsstMs += dur
    }
    const sessionMs = lastCompleted > 0 && firstCreated > 0 ? lastCompleted - firstCreated : 0
    const avgTurnMs = userCount() > 0 ? Math.round(sumAsstMs / userCount()) : 0
    return { out, rsn, cost, errs, cacheR, cacheW, input, agents, sessionMs, avgTurnMs, firstCreated, lastCompleted }
  })

  /** Session-level totals from the reactive session record (survive compaction). */
  const sessionTokens = createMemo(() => {
    const info = session()
    if (!info) return null
    return info.tokens
  })
  const sessionCost = createMemo(() => session()?.cost ?? stats().cost)

  const lastTokens = createMemo(() => {
    const m = last()
    if (!m) return null
    const tokens = m.tokens
    if (!tokens) return null
    return {
      input: tokens.input ?? 0,
      output: tokens.output ?? 0,
      reasoning: tokens.reasoning ?? 0,
      cacheR: tokens.cache?.read ?? 0,
      cacheW: tokens.cache?.write ?? 0,
    }
  })

  const modelName = createMemo(() => {
    const m = last()
    if (!m) return null
    const variant = m.model.variant ?? ""
    return `${m.model.id} (${m.model.providerID})${variant ? ` [${variant}]` : ""}`
  })
  const ctxLimit = createMemo(() => {
    const m = last()
    if (!m) return null
    const models = context.data.location.model.list(location()) ?? []
    const found = models.find(
      (model) => model.providerID === m.model.providerID && (model.id === m.model.id || model.modelID === m.model.id),
    )
    return found?.limit.context ?? null
  })
  const ctxPct = createMemo(() => {
    const limit = ctxLimit()
    const lt = lastTokens()
    return (limit && lt) ? Math.round(((lt.input + lt.output + lt.reasoning + lt.cacheR + lt.cacheW) / limit) * 100) : null
  })
  const cacheEfficiency = createMemo(() => {
    const tokens = sessionTokens()
    const source = tokens ?? { input: stats().input, cache: { read: stats().cacheR, write: stats().cacheW } }
    const denominator = source.input + source.cache.read + source.cache.write
    return denominator > 0 ? ((source.cache.read / denominator) * 100).toFixed(0) : null
  })
  const density = createMemo(() => {
    const total = msg().length
    const tokens = sessionTokens()
    const out = tokens ? tokens.output + tokens.reasoning : stats().out + stats().rsn
    return total > 0 ? Math.round(out / total) : 0
  })

  // ——— step counts: one assistant message per model call ———
  const stepCounts = createMemo(() => {
    const all = msg()
    let lastUserIdx = -1
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].type === "user") { lastUserIdx = i; break }
    }
    let totalSteps = 0
    let roundSteps = 0
    for (let i = 0; i < all.length; i++) {
      if (all[i].type !== "assistant") continue
      totalSteps++
      if (i > lastUserIdx) roundSteps++
    }
    return { totalSteps, roundSteps }
  })

  // ——— live / last turn timing ———
  const turnAnchor = createMemo(() => {
    const all = msg()
    let lastUserIdx = -1
    for (let i = all.length - 1; i >= 0; i--) { if (all[i].type === "user") { lastUserIdx = i; break } }
    if (lastUserIdx < 0) return null
    let firstCreated = 0, lastCompleted = 0, lastDone = 0
    for (let i = lastUserIdx + 1; i < all.length; i++) {
      const m = all[i]
      if (m.type !== "assistant") continue
      const created = m.time?.created ?? 0
      if (created > 0 && (!firstCreated || created < firstCreated)) firstCreated = created
      const completed = m.time?.completed ?? 0
      if (completed > lastCompleted) lastCompleted = completed
      lastDone = completed
    }
    return { firstCreated, lastCompleted, lastDone }
  })

  const [nowTs, setNowTs] = createSignal(Date.now())

  onMount(() => {
    const interval = setInterval(() => setNowTs(Date.now()), 1000)
    onCleanup(() => clearInterval(interval))
  })

  const liveMs = createMemo(() => {
    const anchor = turnAnchor()
    if (!anchor || !anchor.firstCreated) return 0
    if (anchor.lastDone > 0 || status() !== "running") return 0
    return nowTs() - anchor.firstCreated
  })

  const lastTurnMs = createMemo(() => {
    const anchor = turnAnchor()
    if (!anchor || !anchor.firstCreated || !anchor.lastCompleted) return 0
    return anchor.lastCompleted - anchor.firstCreated
  })
  const tps = createMemo(() => {
    const m = last()
    const lt = lastTokens()
    if (!m || !lt || lt.output === 0) return null
    const created = m.time?.created ?? 0
    const completed = m.time?.completed ?? 0
    const dur = completed - created
    return dur > 0 ? Math.round(lt.output / (dur / 1000)) : null
  })
  const reLast = createMemo(() => {
    const lt = lastTokens()
    return (lt && lt.output > 0) ? (lt.reasoning / lt.output).toFixed(2) : null
  })
  const reSession = createMemo(() => {
    const tokens = sessionTokens() ?? { output: stats().out, reasoning: stats().rsn }
    return tokens.output > 0 ? (tokens.reasoning / tokens.output).toFixed(2) : null
  })
  const risk = createMemo(() => {
    const ctx = ctxPct()
    const lt = lastTokens()
    if (ctx === null || !lt || lt.output === 0) return null
    const current = lt.reasoning / lt.output
    const average = stats().out > 0 ? stats().rsn / stats().out : current
    if (ctx > 90) return { level: "high", fg: t().error }
    if (ctx > 75 && current < average * 0.4) return { level: "medium", fg: t().warning }
    if (ctx > 60 && current < average * 0.2) return { level: "low", fg: t().textMuted }
    return null
  })

  const agentRows = createMemo(() => {
    const agents = stats().agents
    const keys = Object.keys(agents)
    const total = keys.reduce((sum, key) => sum + agents[key], 0)
    return keys.sort((x, y) => agents[y] - agents[x]).map((key) => ({
      name: key,
      count: agents[key],
      pct: total > 0 ? ((agents[key] / total) * 100).toFixed(0) : "0",
    }))
  })

  // ——— tool statistics derived from assistant message content ———
  const tools = createMemo(() => {
    const entries: { name: string; count: number; errors: number; totalMs: number }[] = []
    const readFiles: Record<string, number> = {}
    const writeFiles: Record<string, number> = {}
    const chain: string[] = []
    let lastStepMs = 0
    let ok = 0
    let fail = 0
    for (const message of msg()) {
      if (message.type !== "assistant") continue
      for (const part of message.content) {
        if (part.type !== "tool") continue
        let entry = entries.find((candidate) => candidate.name === part.name)
        if (!entry) {
          entry = { name: part.name, count: 0, errors: 0, totalMs: 0 }
          entries.push(entry)
        }
        entry.count++
        const ms = toolDuration(part)
        if (ms > 0) {
          entry.totalMs += ms
          lastStepMs = ms
        }
        if (part.state.status === "error") {
          entry.errors++
          fail++
        } else if (part.state.status === "completed") {
          ok++
        }
        const path = filePathOf(toolInput(part))
        if (path) {
          if (part.name === "read") readFiles[path] = (readFiles[path] || 0) + 1
          else if (part.name === "write" || part.name === "edit" || part.name === "apply_patch")
            writeFiles[path] = (writeFiles[path] || 0) + 1
        }
        chain.push(part.name)
        if (chain.length > 5) chain.shift()
      }
    }
    return { entries, readFiles, writeFiles, chain, lastStepMs, ok, fail }
  })

  const mcpPrefixes = createMemo(() => {
    const servers = context.data.location.mcp.server.list(location()) ?? []
    const prefixes = new Set<string>(servers.map((server) => server.name.replace(/[^a-zA-Z0-9_-]/g, "_")))
    if (prefixes.size === 0) {
      // Fallback heuristic when the MCP catalog is unavailable.
      for (const entry of tools().entries) {
        const index = entry.name.indexOf("_")
        if (index <= 0 || entry.name[index - 1] === "_" || index >= entry.name.length - 1) continue
        const prefix = entry.name.slice(0, index)
        if (/[A-Z]/.test(prefix) || prefix.includes("-") || prefix.includes(".")) prefixes.add(prefix)
      }
    }
    return prefixes
  })

  const isMcp = createMemo(() => (name: string) => {
    for (const prefix of mcpPrefixes()) if (name.startsWith(prefix + "_")) return true
    return false
  })

  const toolRows = createMemo(() => {
    const result = tools()
    if (result.entries.length === 0) return []
    const total = result.entries.reduce((sum, entry) => sum + entry.count, 0)
    const isMcpFn = isMcp()
    return result.entries.filter((entry) => !isMcpFn(entry.name))
      .sort((a, b) => b.count - a.count)
      .map((entry) => ({
        name: entry.name,
        count: entry.count,
        pct: total > 0 ? ((entry.count / total) * 100).toFixed(0) : "0",
      }))
  })

  const mcpGroups = createMemo(() => {
    const result = tools()
    if (result.entries.length === 0) return []
    const isMcpFn = isMcp()
    const total = result.entries.reduce((sum, entry) => sum + entry.count, 0)
    const groups: Record<string, { tool: string; count: number; pct: string }[]> = {}
    for (const entry of result.entries.filter((candidate) => isMcpFn(candidate.name))) {
      const index = entry.name.indexOf("_")
      const mcp = entry.name.slice(0, index)
      const tool = entry.name.slice(index + 1)
      ;(groups[mcp] ??= []).push({
        tool,
        count: entry.count,
        pct: total > 0 ? ((entry.count / total) * 100).toFixed(0) : "0",
      })
    }
    return Object.entries(groups).map(([mcp, list]) => ({
      mcp,
      tools: list.sort((a, b) => b.count - a.count),
      total: list.reduce((sum, entry) => sum + entry.count, 0),
    })).sort((a, b) => b.total - a.total)
  })

  const hotFiles = createMemo(() => {
    const files: Record<string, { adds: number; dels: number }> = {}
    for (const diff of diffs()) {
      const file = files[diff.file] ??= { adds: 0, dels: 0 }
      file.adds += diff.additions
      file.dels += diff.deletions
    }
    return Object.entries(files).sort(([, a], [, b]) => b.adds + b.dels - (a.adds + a.dels)).slice(0, 5)
      .map(([file, { adds, dels }]) => ({ file: file.split("/").pop() || file, path: file, adds, dels }))
  })

  const readFiles = createMemo(() => {
    const reads = tools().readFiles
    return Object.entries(reads).sort(([, a], [, b]) => b - a).slice(0, 5)
      .map(([path, count]) => ({ file: basename(path), path, count }))
  })
  const writeFiles = createMemo(() => {
    const writes = tools().writeFiles
    return Object.entries(writes).sort(([, a], [, b]) => b - a).slice(0, 5)
      .map(([path, count]) => ({ file: basename(path), path, count }))
  })

  const avgToolMs = createMemo(() => {
    const entries = tools().entries.filter((entry) => entry.count > 0)
    if (entries.length === 0) return 0
    return entries.reduce((sum, entry) => sum + entry.totalMs / entry.count, 0) / entries.length
  })

  const [show1, set1] = createSignal(true)
  const [show2, set2] = createSignal(true)
  const [show3, set3] = createSignal(false)
  const [show4, set4] = createSignal(false)
  const [show5, set5] = createSignal(false)
  const [showAg, setAg] = createSignal(true)
  const [showHot, setHot] = createSignal(false)
  const [showDir, setDir] = createSignal(false)
  const dirPath = () => context.location?.directory ?? process.cwd()

  return (
    <box gap={1}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => set1((x) => !x)}>
          <text fg={t().text}>{show1() ? "▼" : "▶"}</text>
          <text fg={t().text}><b>Context Health</b></text>
          <Show when={risk()} fallback={<text fg={t().textMuted}>[SAFE]</text>}>
            {(r) => <text fg={r().fg}>[{r().level === "high" ? "HIGH" : r().level === "medium" ? "RISK" : ""}]</text>}
          </Show>
        </box>
        <Show when={show1()}>
          <Show when={ctxPct() !== null}>
            <box>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={t().textMuted}>Usage</text>
                <text fg={t().text}>{ctxPct()}% · {n(ctxLimit()!)} max</text>
              </box>
              <Bar pct={Math.min(ctxPct()!, 100)} fg={ctxPct()! > 95 ? t().error : ctxPct()! > 80 ? t().warning : t().primary} bg={t().textMuted} />
            </box>
          </Show>
          <Show when={cacheEfficiency() !== null}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().textMuted}>Cache hit</text>
              <text fg={t().text}>{cacheEfficiency()}%</text>
            </box>
          </Show>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={t().textMuted}>Density</text>
            <text fg={t().text}>{n(density())} tok/msg</text>
          </box>
          <Show when={stats().errs > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().error}>Errors</text>
              <text fg={t().error}>{stats().errs}</text>
            </box>
          </Show>
        </Show>
      </box>

      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => set2((x) => !x)}>
          <text fg={t().text}>{show2() ? "▼" : "▶"}</text>
          <text fg={t().text}><b>Performance</b></text>
        </box>
        <Show when={show2()}>
          <Show when={stats().sessionMs > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().textMuted}>Duration</text>
              <text fg={t().text}>{fmtMs(stats().sessionMs)}</text>
            </box>
          </Show>
          <Show when={stats().avgTurnMs > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().textMuted}>Avg time / turn</text>
              <text fg={t().text}>{fmtMs(stats().avgTurnMs)}</text>
            </box>
          </Show>
          <Show when={lastTurnMs() > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().textMuted}>Last turn (done)</text>
              <text fg={t().text}>{fmtMs(lastTurnMs())}</text>
            </box>
          </Show>
          <Show when={liveMs() > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().textMuted}>Live</text>
              <text fg={t().text}>{fmtMs(liveMs())}</text>
            </box>
          </Show>
          <Show when={tps() !== null}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().textMuted}>TPS</text>
              <text fg={t().text}>{n(tps()!)} tok/s</text>
            </box>
          </Show>
        </Show>
      </box>

      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => set4((x) => !x)}>
          <text fg={t().text}>{show4() ? "▼" : "▶"}</text>
          <text fg={t().text}><b>Cost &amp; Efficiency</b></text>
        </box>
        <Show when={show4()}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={t().textMuted}>Cost</text>
            <text fg={t().text}>${sessionCost().toFixed(4)}</text>
          </box>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={t().textMuted}>Output (total)</text>
            <text fg={t().text}>{n(sessionTokens()?.output ?? stats().out)} tok</text>
          </box>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={t().textMuted}>Reasoning (total)</text>
            <text fg={t().text}>{n(sessionTokens()?.reasoning ?? stats().rsn)} tok</text>
          </box>
          <Show when={reSession() !== null}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().textMuted}>R/O (session)</text>
              <text fg={t().text}>{reSession()}x</text>
            </box>
          </Show>
          <Show when={reLast() !== null}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().textMuted}>R/O (last turn)</text>
              <text fg={t().text}>{reLast()}x{Number(reLast()!) > 1.5 ? " thinking" : ""}</text>
            </box>
          </Show>
          <Show when={stepCounts().totalSteps > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().textMuted}>Calls (session)</text>
              <text fg={t().text}>{n(stepCounts().totalSteps)}</text>
            </box>
          </Show>
          <Show when={stepCounts().roundSteps > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().textMuted}>Calls (round)</text>
              <text fg={t().text}>{n(stepCounts().roundSteps)}</text>
            </box>
          </Show>
        </Show>
      </box>

      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => setAg((x) => !x)}>
          <text fg={t().text}>{showAg() ? "▼" : "▶"}</text>
          <text fg={t().text}><b>Agents</b></text>
        </box>
        <Show when={showAg()}>
          <Show when={agentRows().length > 0} fallback={<text fg={t().textMuted}>No data</text>}>
            <For each={agentRows()}>{(item) => (
              <box flexDirection="row" justifyContent="space-between">
                <text fg={t().textMuted}>{item.name}</text>
                <text fg={t().text}>{item.count} <span style={{ fg: t().textMuted }}>{item.pct}%</span></text>
              </box>
            )}</For>
          </Show>
        </Show>
      </box>

      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => set3((x) => !x)}>
          <text fg={t().text}>{show3() ? "▼" : "▶"}</text>
          <text fg={t().text}><b>Tools</b></text>
        </box>
        <Show when={show3()}>
          <Show when={toolRows().length > 0 || mcpGroups().length > 0} fallback={<text fg={t().textMuted}>No tool activity yet</text>}>
            <Show when={toolRows().length > 0}>
              <text fg={t().textMuted}>Built-in:</text>
              <For each={toolRows()}>{(item) => (
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={t().textMuted}>  {item.name}</text>
                  <text fg={t().text}>{item.count} <span style={{ fg: t().textMuted }}>{item.pct}%</span></text>
                </box>
              )}</For>
            </Show>
            <Show when={mcpGroups().length > 0}>
              <For each={mcpGroups()}>{(group) => (
                <box>
                  <text fg={t().textMuted}>[{group.mcp}]</text>
                  <For each={group.tools}>{(item) => (
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={t().textMuted}>  {item.tool}</text>
                      <text fg={t().text}>{item.count} <span style={{ fg: t().textMuted }}>{item.pct}%</span></text>
                    </box>
                  )}</For>
                </box>
              )}</For>
            </Show>
          </Show>
          <Show when={tools().ok + tools().fail > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().textMuted}>Success / fail</text>
              <text fg={t().text}>{tools().ok}/{tools().ok + tools().fail}
                <Show when={tools().fail > 0}><span style={{ fg: t().error }}> ({tools().fail} fail)</span></Show>
              </text>
            </box>
          </Show>
          <Show when={tools().chain.length > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().textMuted}>Chain</text>
              <text fg={t().text}>{tools().chain.join("→")}</text>
            </box>
          </Show>
          <Show when={avgToolMs() > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().textMuted}>Avg tool</text>
              <text fg={t().text}>{fmtMs(avgToolMs())}</text>
            </box>
          </Show>
          <Show when={tools().lastStepMs > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().textMuted}>Last step</text>
              <text fg={t().text}>{fmtMs(tools().lastStepMs)}</text>
            </box>
          </Show>
        </Show>
      </box>

      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => set5((x) => !x)}>
          <text fg={t().text}>{show5() ? "▼" : "▶"}</text>
          <text fg={t().text}><b>Model &amp; Session</b></text>
        </box>
        <Show when={show5()}>
          <Show when={modelName()}><text fg={t().textMuted}>{modelName()}</text></Show>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={t().textMuted}>Messages</text>
            <text fg={t().text}>User {userCount()} · Asst {asstCount()}</text>
          </box>
          <Show when={lastTokens()}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().textMuted}>Last input</text>
              <text fg={t().text}>{n(lastTokens()!.input)} tok</text>
            </box>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().textMuted}>Last output</text>
              <text fg={t().text}>{n(lastTokens()!.output)} tok</text>
            </box>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t().textMuted}>Last reasoning</text>
              <text fg={t().text}>{n(lastTokens()!.reasoning)} tok</text>
            </box>
          </Show>
        </Show>
      </box>

      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => setHot((x) => !x)}>
          <text fg={t().text}>{showHot() ? "▼" : "▶"}</text>
          <text fg={t().text}><b>Hot Files</b></text>
        </box>
        <Show when={showHot()}>
          <Show
            when={readFiles().length > 0 || writeFiles().length > 0 || hotFiles().length > 0}
            fallback={<text fg={t().textMuted}>No file activity yet</text>}
          >
            <Show when={readFiles().length > 0}>
              <text fg={t().textMuted}>Read ({readFiles().length}):</text>
              <For each={readFiles()}>{(file) => (
                <box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={t().text}>📄 {file.file}</text>
                    <text fg={t().textMuted}>{file.count}x</text>
                  </box>
                  <text fg={t().textMuted}>  {file.path}</text>
                </box>
              )}</For>
            </Show>
            <Show when={writeFiles().length > 0}>
              <text fg={t().textMuted}>Modified ({writeFiles().length}):</text>
              <For each={writeFiles()}>{(file) => (
                <box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={t().text}>✏️ {file.file}</text>
                    <text fg={t().textMuted}>{file.count}x</text>
                  </box>
                  <text fg={t().textMuted}>  {file.path}</text>
                </box>
              )}</For>
            </Show>
            <Show when={hotFiles().length > 0}>
              <text fg={t().textMuted}>Changed:</text>
              <For each={hotFiles()}>{(file) => (
                <box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={t().text}>✏️ {file.file}</text>
                    <box flexDirection="row" gap={1} flexShrink={0}>
                      <Show when={file.adds > 0}><text fg={t().diffAdded}>+{file.adds}</text></Show>
                      <Show when={file.dels > 0}><text fg={t().diffRemoved}>-{file.dels}</text></Show>
                    </box>
                  </box>
                  <text fg={t().textMuted}>  {file.path}</text>
                </box>
              )}</For>
            </Show>
          </Show>
        </Show>
      </box>

      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => setDir((x) => !x)}>
          <text fg={t().text}>{showDir() ? "▼" : "▶"}</text>
          <text fg={t().text}><b>Directory</b></text>
        </box>
        <Show when={showDir()}><FileTree dir={dirPath()} theme={t()} /></Show>
      </box>

      <box>
        <text fg={t().text}><b>Session Info</b></text>
        <text fg={t().textMuted}>Created: {fmtTs(session()?.time.created ?? stats().firstCreated)}</text>
        <text fg={t().textMuted}>Last active: {fmtTs(session()?.time.updated ?? stats().lastCompleted)}</text>
      </box>
    </box>
  )
}

export default Plugin.define({
  id,
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => <View context={context} sessionID={sessionID} />,
    })
  },
})
