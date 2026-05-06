import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show, createSignal, onMount, onCleanup } from "solid-js"
import { readdirSync, readFileSync, existsSync } from "fs"
import { join, basename } from "path"
import { homedir } from "os"

const id = "sidebar-stats"

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

function Bar(props: { pct: number; fg: string; bg: string }) {
  const filled = Math.min(Math.round((props.pct / 100) * 20), 20)
  return (
    <text>
      <span style={{ fg: props.fg }}>{"█".repeat(filled)}</span>
      <span style={{ fg: props.bg }}>{"░".repeat(Math.max(20 - filled, 0))}</span>
    </text>
  )
}

function FileTree(props: { dir: string; theme: Record<string, string>; depth?: number }) {
  const depth = props.depth ?? 0
  const [open, setOpen] = createSignal(depth < 1)
  const [items, setItems] = createSignal<{ name: string; isDir: boolean }[]>([])
  const indent = "  ".repeat(depth)
  createMemo(() => {
    if (open()) {
      try {
        const entries = readdirSync(props.dir, { withFileTypes: true })
        setItems(entries.filter((e) => !e.name.startsWith(".")).sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1
          if (!a.isDirectory() && b.isDirectory()) return 1
          return a.name.localeCompare(b.name)
        }).map((e) => ({ name: e.name, isDir: e.isDirectory() })))
      } catch { setItems([]) }
    }
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

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const t = theme()

  const userCount = createMemo(() => msg().filter((m) => m.role === "user").length)
  const asstCount = createMemo(() => msg().filter((m) => m.role === "assistant").length)

  const last = createMemo(() => {
    for (let i = msg().length - 1; i >= 0; i--) {
      const m = msg()[i]
      if (m.role !== "assistant") continue
      const tk = (m as Record<string, unknown>).tokens as Record<string, unknown> | undefined
      if (tk && typeof tk.output === "number" && tk.output > 0) return m as Record<string, unknown>
    }
    return null
  })

  // ——— stats ———
  const stats = createMemo(() => {
    let out = 0, rsn = 0, cost = 0, errs = 0, cacheR = 0, cacheW = 0, input = 0
    let firstCreated = 0, lastCompleted = 0, sumAsstMs = 0, asstTurns = 0
    const agents: Record<string, number> = {}
    for (const m of msg()) {
      const agent = (m as Record<string, unknown>).agent as string | undefined
      if (agent) agents[agent] = (agents[agent] || 0) + 1
      const tm = (m as Record<string, unknown>).time as Record<string, unknown> | undefined
      const created = (tm?.created as number) || 0
      if (created > 0 && (!firstCreated || created < firstCreated)) firstCreated = created
      if (m.role !== "assistant") continue
      const tk = (m as Record<string, unknown>).tokens as Record<string, unknown> | undefined
      input += (tk?.input as number) || 0; out += (tk?.output as number) || 0; rsn += (tk?.reasoning as number) || 0
      const cache = tk?.cache as Record<string, unknown> | undefined
      cacheR += (cache?.read as number) || 0; cacheW += (cache?.write as number) || 0
      cost += ((m as Record<string, unknown>).cost as number) || 0
      if ((m as Record<string, unknown>).error) errs++
      const completed = (tm?.completed as number) || 0
      if (completed > lastCompleted) lastCompleted = completed
      const dur = completed > 0 ? completed - created : 0
      if (dur > 0) { sumAsstMs += dur; asstTurns++ }
    }
    const sessionMs = lastCompleted > 0 && firstCreated > 0 ? lastCompleted - firstCreated : 0
    const avgTurnMs = userCount() > 0 ? Math.round(sumAsstMs / userCount()) : 0
    return { out, rsn, cost, errs, cacheR, cacheW, input, agents, sessionMs, avgTurnMs, firstCreated, lastCompleted }
  })

  const lastTokens = createMemo(() => {
    const m = last(); if (!m) return null
    const tk = m.tokens as Record<string, unknown>; const cache = tk.cache as Record<string, unknown> | undefined
    return { input: (tk.input as number) || 0, output: (tk.output as number) || 0, reasoning: (tk.reasoning as number) || 0, cacheR: (cache?.read as number) || 0, cacheW: (cache?.write as number) || 0 }
  })

  const modelName = createMemo(() => { const m = last(); return m ? `${m.modelID} (${m.providerID})` : null })
  const ctxLimit = createMemo(() => {
    const m = last(); if (!m) return null
    return props.api.state.provider.find((x) => x.id === (m.providerID as string))?.models[m.modelID as string]?.limit?.context ?? null
  })
  const ctxPct = createMemo(() => {
    const limit = ctxLimit(); const lt = lastTokens()
    return (limit && lt) ? Math.round(((lt.input + lt.output + lt.reasoning + lt.cacheR + lt.cacheW) / limit) * 100) : null
  })
  const cacheEfficiency = createMemo(() => {
    const s = stats(); const d = s.input + s.cacheR + s.cacheW; return d > 0 ? ((s.cacheR / d) * 100).toFixed(0) : null
  })
  const density = createMemo(() => {
    const total = msg().length; return total > 0 ? Math.round((stats().out + stats().rsn) / total) : 0
  })
  const avgTpt = createMemo(() => userCount() > 0 ? Math.round((stats().out + stats().rsn) / userCount()) : 0)

  // ——— live / last turn timing ———
  const turnAnchor = createMemo(() => {
    const all = msg()
    let lastUserIdx = -1
    for (let i = all.length - 1; i >= 0; i--) { if (all[i].role === "user") { lastUserIdx = i; break } }
    if (lastUserIdx < 0) return null
    let firstAsstCreated = 0, lastAsstCompleted = 0
    let lastAsst: Record<string, unknown> | undefined
    for (let i = lastUserIdx + 1; i < all.length; i++) {
      const m = all[i]; if (m.role !== "assistant") continue
      const rm = m as Record<string, unknown>
      lastAsst = rm
      const tm = rm.time as Record<string, unknown> | undefined
      const c = (tm?.created as number) || 0
      if (c > 0 && (!firstAsstCreated || c < firstAsstCreated)) firstAsstCreated = c
      const done = (tm?.completed as number) || 0
      if (done > lastAsstCompleted) lastAsstCompleted = done
    }
    const lastDone = lastAsst ? ((lastAsst.time as Record<string, unknown> | undefined)?.completed as number) || 0 : 0
    return { firstCreated: firstAsstCreated, lastCompleted: lastAsstCompleted, lastDone }
  })

  const lastUserCreated = createMemo(() => {
    for (let i = msg().length - 1; i >= 0; i--) {
      const m = msg()[i]; if (m.role !== "user") continue
      const tm = (m as Record<string, unknown>).time as Record<string, unknown> | undefined
      return (tm?.created as number) || 0
    }
    return 0
  })

  const liveMs = createMemo(() => {
    const a = turnAnchor(); if (!a || !a.firstCreated) return 0
    // stop only when the LAST assistant in the turn has completed
    if (a.lastDone > 0) return 0
    return nowTs() - a.firstCreated
  })

  const lastTurnMs = createMemo(() => {
    const a = turnAnchor(); if (!a || !a.firstCreated || !a.lastCompleted) return 0
    return a.lastCompleted - a.firstCreated
  })
  const tps = createMemo(() => {
    const m = last(); const lt = lastTokens()
    if (!m || !lt || lt.output === 0) return null
    const tm = m.time as Record<string, unknown> | undefined
    const dur = ((tm?.completed as number) || 0) - ((tm?.created as number) || 0)
    return dur > 0 ? Math.round(lt.output / (dur / 1000)) : null
  })
  const reLast = createMemo(() => { const lt = lastTokens(); return (lt && lt.output > 0) ? (lt.reasoning / lt.output).toFixed(2) : null })
  const reSession = createMemo(() => { const s = stats(); return s.out > 0 ? (s.rsn / s.out).toFixed(2) : null })
  const risk = createMemo(() => {
    const ctx = ctxPct(); const lt = lastTokens()
    if (ctx === null || !lt || lt.output === 0) return null
    const cur = lt.reasoning / lt.output; const avg = stats().out > 0 ? stats().rsn / stats().out : cur
    if (ctx > 90) return { level: "high", fg: t.error }
    if (ctx > 75 && cur < avg * 0.4) return { level: "medium", fg: t.warning }
    if (ctx > 60 && cur < avg * 0.2) return { level: "low", fg: t.textMuted }
    return null
  })

  const agentRows = createMemo(() => {
    const a = stats().agents; const keys = Object.keys(a); const total = keys.reduce((s, k) => s + a[k], 0)
    return keys.sort((x, y) => a[y] - a[x]).map((k) => ({ name: k, count: a[k], pct: total > 0 ? ((a[k] / total) * 100).toFixed(0) : "0" }))
  })

  // ——— server-plugin tool stats (polled from JSON) ———
  const STATS_PATH = join(homedir(), ".config", "opencode", `_tool_stats_${(props.session_id).replace(/[\\/:*?"<>|]/g, "_")}.json`)
  interface ToolEntry { count: number; totalMs: number; errors: number }
  interface ToolStats { tools: Record<string, ToolEntry>; chain: string[]; lastStepMs: number; ok: number; fail: number; reads: Record<string, number>; writes: Record<string, number> }

  function loadToolStats(): ToolStats | null {
    try { if (existsSync(STATS_PATH)) return JSON.parse(readFileSync(STATS_PATH, "utf-8")) } catch {}
    return null
  }

  const [toolStats, setToolStats] = createSignal<ToolStats | null>(loadToolStats())
  const [nowTs, setNowTs] = createSignal(Date.now())

  onMount(() => {
    const id = setInterval(() => { setToolStats(loadToolStats()); setNowTs(Date.now()) }, 1000)
    onCleanup(() => clearInterval(id))
  })

  const mcpPrefixes = createMemo(() => {
    const s = toolStats(); if (!s) return new Set<string>()
    const p = new Set<string>()
    for (const k of Object.keys(s.tools)) {
      const i = k.indexOf("_")
      if (i > 0 && k[i - 1] === k[i - 1] && i < k.length - 1) { // has underscore with content on both sides
        // check prefix looks like MCP name (contains dash or is not a simple word)
        const prefix = k.slice(0, i)
        if (/[A-Z]/.test(prefix) || prefix.includes("-") || prefix.includes(".")) p.add(prefix)
      }
    }
    return p
  })

  const isMcp = createMemo(() => (k: string) => {
    for (const p of mcpPrefixes()) if (k.startsWith(p + "_")) return true
    return false
  })

  const toolRows = createMemo(() => {
    const s = toolStats(); if (!s) return []
    const keys = Object.keys(s.tools)
    const total = keys.reduce((sum, k) => sum + s.tools[k].count, 0)
    const isMcpFn = isMcp()
    return keys.filter((k) => !isMcpFn(k)).sort((a, b) => s.tools[b].count - s.tools[a].count)
      .map((k) => ({ name: k, count: s.tools[k].count, pct: total > 0 ? ((s.tools[k].count / total) * 100).toFixed(0) : "0" }))
  })

  const mcpGroups = createMemo(() => {
    const s = toolStats(); if (!s) return []
    const isMcpFn = isMcp()
    const groups: Record<string, { tool: string; count: number; pct: string }[]> = {}
    const total = Object.values(s.tools).reduce((sum, v) => sum + v.count, 0)
    for (const k of Object.keys(s.tools).filter(isMcpFn)) {
      const i = k.indexOf("_")
      const mcp = k.slice(0, i)
      const tool = k.slice(i + 1)
      ;(groups[mcp] ??= []).push({
        tool,
        count: s.tools[k].count,
        pct: total > 0 ? ((s.tools[k].count / total) * 100).toFixed(0) : "0",
      })
    }
    return Object.entries(groups).map(([mcp, tools]) => ({
      mcp,
      tools: tools.sort((a, b) => b.count - a.count),
      total: tools.reduce((s, t) => s + t.count, 0),
    })).sort((a, b) => b.total - a.total)
  })

  const hotFiles = createMemo(() => {
    const fm: Record<string, { adds: number; dels: number }> = {}
    for (const d of props.api.state.session.diff(props.session_id)) {
      const f = d.file; fm[f] = fm[f] || { adds: 0, dels: 0 }
      fm[f].adds += d.additions; fm[f].dels += d.deletions
    }
    for (const m of msg()) {
      if (m.role !== "user") continue
      const s = (m as Record<string, unknown>).summary as Record<string, unknown> | undefined
      const diffs = s?.diffs as Array<Record<string, unknown>> | undefined
      if (!diffs) continue
      for (const d of diffs) {
        const f = d.file as string; fm[f] = fm[f] || { adds: 0, dels: 0 }
        fm[f].adds += (d.additions as number) || 0; fm[f].dels += (d.deletions as number) || 0
      }
    }
    return Object.entries(fm).sort(([,a],[,b]) => b.adds+b.dels-(a.adds+a.dels)).slice(0,5)
      .map(([file,{adds,dels}]) => ({ file: file.split("/").pop() || file, path: file, adds, dels }))
  })

  const readFiles = createMemo(() => {
    const s = toolStats(); if (!s?.reads) return []
    return Object.entries(s.reads).sort(([,a],[,b]) => b - a).slice(0, 5)
      .map(([fp, cnt]) => ({ file: basename(fp), path: fp, count: cnt }))
  })
  const writeFiles = createMemo(() => {
    const s = toolStats(); if (!s?.writes) return []
    return Object.entries(s.writes).sort(([,a],[,b]) => b - a).slice(0, 5)
      .map(([fp, cnt]) => ({ file: basename(fp), path: fp, count: cnt }))
  })

  const avgToolMs = createMemo(() => {
    const s = toolStats(); if (!s) return 0
    const e = Object.entries(s.tools).filter(([,v]) => v.count > 0)
    if (e.length === 0) return 0
    return e.reduce((sum, [,v]) => sum + v.totalMs / v.count, 0) / e.length
  })

  const [show1, set1] = createSignal(true)
  const [show2, set2] = createSignal(true)
  const [show3, set3] = createSignal(false)
  const [show4, set4] = createSignal(false)
  const [show5, set5] = createSignal(false)
  const [showAg, setAg] = createSignal(true)
  const [showHot, setHot] = createSignal(false)
  const [showDir, setDir] = createSignal(false)
  const dirPath = () => props.api.state.path.directory

  return (
    <box gap={1}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => set1((x) => !x)}>
          <text fg={t.text}>{show1() ? "▼" : "▶"}</text>
          <text fg={t.text}><b>Context Health</b></text>
          <Show when={risk()} fallback={<text fg={t.textMuted}>[SAFE]</text>}>
            {(r) => <text fg={r().fg}>[{r().level === "high" ? "HIGH" : r().level === "medium" ? "RISK" : ""}]</text>}
          </Show>
        </box>
        <Show when={show1()}>
          <Show when={ctxPct() !== null}>
            <box>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={t.textMuted}>Usage</text>
                <text fg={t.text}>{ctxPct()}% · {n(ctxLimit()!)} max</text>
              </box>
              <Bar pct={Math.min(ctxPct()!, 100)} fg={ctxPct()! > 95 ? t.error : ctxPct()! > 80 ? t.warning : t.primary} bg={t.textMuted} />
            </box>
          </Show>
          <Show when={cacheEfficiency() !== null}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t.textMuted}>Cache hit</text>
              <text fg={t.text}>{cacheEfficiency()}%</text>
            </box>
          </Show>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={t.textMuted}>Density</text>
            <text fg={t.text}>{n(density())} tok/msg</text>
          </box>
          <Show when={stats().errs > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t.error}>Errors</text>
              <text fg={t.error}>{stats().errs}</text>
            </box>
          </Show>
        </Show>
      </box>

      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => set2((x) => !x)}>
          <text fg={t.text}>{show2() ? "▼" : "▶"}</text>
          <text fg={t.text}><b>Performance</b></text>
        </box>
        <Show when={show2()}>
          <Show when={stats().sessionMs > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t.textMuted}>Duration</text>
              <text fg={t.text}>{fmtMs(stats().sessionMs)}</text>
            </box>
          </Show>
          <Show when={stats().avgTurnMs > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t.textMuted}>Avg time / turn</text>
              <text fg={t.text}>{fmtMs(stats().avgTurnMs)}</text>
            </box>
          </Show>
          <Show when={lastTurnMs() > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t.textMuted}>Last turn (done)</text>
              <text fg={t.text}>{fmtMs(lastTurnMs())}</text>
            </box>
          </Show>
          <Show when={liveMs() > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t.textMuted}>Live</text>
              <text fg={t.text}>{fmtMs(liveMs())}</text>
            </box>
          </Show>
          <Show when={tps() !== null}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t.textMuted}>TPS</text>
              <text fg={t.text}>{n(tps()!)} tok/s</text>
            </box>
          </Show>
        </Show>
      </box>

      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => set4((x) => !x)}>
          <text fg={t.text}>{show4() ? "▼" : "▶"}</text>
          <text fg={t.text}><b>Cost & Efficiency</b></text>
        </box>
        <Show when={show4()}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={t.textMuted}>Cost</text>
            <text fg={t.text}>${stats().cost.toFixed(4)}</text>
          </box>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={t.textMuted}>Output (total)</text>
            <text fg={t.text}>{n(stats().out)} tok</text>
          </box>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={t.textMuted}>Reasoning (total)</text>
            <text fg={t.text}>{n(stats().rsn)} tok</text>
          </box>
          <Show when={reSession() !== null}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t.textMuted}>R/O (session)</text>
              <text fg={t.text}>{reSession()}x</text>
            </box>
          </Show>
          <Show when={reLast() !== null}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t.textMuted}>R/O (last turn)</text>
              <text fg={t.text}>{reLast()}x{Number(reLast()!) > 1.5 ? " thinking" : ""}</text>
            </box>
          </Show>
        </Show>
      </box>

      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => setAg((x) => !x)}>
          <text fg={t.text}>{showAg() ? "▼" : "▶"}</text>
          <text fg={t.text}><b>Agents</b></text>
        </box>
        <Show when={showAg()}>
          <Show when={agentRows().length > 0} fallback={<text fg={t.textMuted}>No data</text>}>
            <For each={agentRows()}>{(item) => (
              <box flexDirection="row" justifyContent="space-between">
                <text fg={t.textMuted}>{item.name}</text>
                <text fg={t.text}>{item.count} <span style={{ fg: t.textMuted }}>{item.pct}%</span></text>
              </box>
            )}</For>
          </Show>
        </Show>
      </box>

      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => set3((x) => !x)}>
          <text fg={t.text}>{show3() ? "▼" : "▶"}</text>
          <text fg={t.text}><b>Tools</b></text>
        </box>
        <Show when={show3()}>
          <Show when={toolStats() && (toolRows().length > 0 || mcpGroups().length > 0)} fallback={<text fg={t.textMuted}>No tool activity yet</text>}>
            <Show when={toolRows().length > 0}>
              <text fg={t.textMuted}>Built-in:</text>
              <For each={toolRows()}>{(item) => (
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={t.textMuted}>  {item.name}</text>
                  <text fg={t.text}>{item.count} <span style={{ fg: t.textMuted }}>{item.pct}%</span></text>
                </box>
              )}</For>
            </Show>
            <Show when={mcpGroups().length > 0}>
              <For each={mcpGroups()}>{(g) => (
                <box>
                  <text fg={t.textMuted}>[{g.mcp}]</text>
                  <For each={g.tools}>{(item) => (
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={t.textMuted}>  {item.tool}</text>
                      <text fg={t.text}>{item.count} <span style={{ fg: t.textMuted }}>{item.pct}%</span></text>
                    </box>
                  )}</For>
                </box>
              )}</For>
            </Show>
          </Show>
          <Show when={toolStats() && toolStats()!.ok + toolStats()!.fail > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t.textMuted}>Success / fail</text>
              <text fg={t.text}>{toolStats()!.ok}/{toolStats()!.ok + toolStats()!.fail}
                <Show when={toolStats()!.fail > 0}><span style={{ fg: t.error }}> ({toolStats()!.fail} fail)</span></Show>
              </text>
            </box>
          </Show>
          <Show when={toolStats() && toolStats()!.chain.length > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t.textMuted}>Chain</text>
              <text fg={t.text}>{toolStats()!.chain.slice(-5).join("→")}</text>
            </box>
          </Show>
          <Show when={avgToolMs() > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t.textMuted}>Avg tool</text>
              <text fg={t.text}>{fmtMs(avgToolMs())}</text>
            </box>
          </Show>
          <Show when={toolStats() && toolStats()!.lastStepMs > 0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t.textMuted}>Last step</text>
              <text fg={t.text}>{fmtMs(toolStats()!.lastStepMs)}</text>
            </box>
          </Show>
        </Show>
      </box>

      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => set5((x) => !x)}>
          <text fg={t.text}>{show5() ? "▼" : "▶"}</text>
          <text fg={t.text}><b>Model & Session</b></text>
        </box>
        <Show when={show5()}>
          <Show when={modelName()}><text fg={t.textMuted}>{modelName()}</text></Show>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={t.textMuted}>Messages</text>
            <text fg={t.text}>User {userCount()} · Asst {asstCount()}</text>
          </box>
          <Show when={lastTokens()}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t.textMuted}>Last input</text>
              <text fg={t.text}>{n(lastTokens()!.input)} tok</text>
            </box>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t.textMuted}>Last output</text>
              <text fg={t.text}>{n(lastTokens()!.output)} tok</text>
            </box>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={t.textMuted}>Last reasoning</text>
              <text fg={t.text}>{n(lastTokens()!.reasoning)} tok</text>
            </box>
          </Show>
        </Show>
      </box>

      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => setHot((x) => !x)}>
          <text fg={t.text}>{showHot() ? "▼" : "▶"}</text>
          <text fg={t.text}><b>Hot Files</b></text>
        </box>
        <Show when={showHot()}>
          <Show
            when={readFiles().length > 0 || writeFiles().length > 0 || hotFiles().length > 0}
            fallback={<text fg={t.textMuted}>No file activity yet</text>}
          >
            <Show when={readFiles().length > 0}>
              <text fg={t.textMuted}>Read ({readFiles().length}):</text>
              <For each={readFiles()}>{(f) => (
                <box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={t.text}>📄 {f.file}</text>
                    <text fg={t.textMuted}>{f.count}x</text>
                  </box>
                  <text fg={t.textMuted}>  {f.path}</text>
                </box>
              )}</For>
            </Show>
            <Show when={writeFiles().length > 0}>
              <text fg={t.textMuted}>Modified ({writeFiles().length}):</text>
              <For each={writeFiles()}>{(f) => (
                <box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={t.text}>✏️ {f.file}</text>
                    <text fg={t.textMuted}>{f.count}x</text>
                  </box>
                  <text fg={t.textMuted}>  {f.path}</text>
                </box>
              )}</For>
            </Show>
            <Show when={hotFiles().length > 0}>
              <text fg={t.textMuted}>Changed:</text>
              <For each={hotFiles()}>{(f) => (
                <box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={t.text}>✏️ {f.file}</text>
                    <box flexDirection="row" gap={1} flexShrink={0}>
                      <Show when={f.adds > 0}><text fg={t.diffAdded}>+{f.adds}</text></Show>
                      <Show when={f.dels > 0}><text fg={t.diffRemoved}>-{f.dels}</text></Show>
                    </box>
                  </box>
                  <text fg={t.textMuted}>  {f.path}</text>
                </box>
              )}</For>
            </Show>
          </Show>
        </Show>
      </box>

      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => setDir((x) => !x)}>
          <text fg={t.text}>{showDir() ? "▼" : "▶"}</text>
          <text fg={t.text}><b>Directory</b></text>
        </box>
        <Show when={showDir()}><FileTree dir={dirPath()} theme={t} /></Show>
      </box>

      <box>
        <text fg={t.text}><b>Session Info</b></text>
        <text fg={t.textMuted}>Created: {fmtTs(stats().firstCreated)}</text>
        <text fg={t.textMuted}>Last active: {fmtTs(stats().lastCompleted)}</text>
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api) => { api.slots.register({ order: 150, slots: { sidebar_content(_ctx, props) { return <View api={api} session_id={props.session_id} /> } } }) }
const plugin: TuiPluginModule & { id: string } = { id, tui }
export default plugin
