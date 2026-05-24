import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const BASE = join(homedir(), ".config", "opencode")

function statsFile(sid: string) {
  return join(BASE, `_tool_stats_${sid.replace(/[\\/:*?"<>|]/g, "_")}.json`)
}

function ensureDir() {
  try { if (!existsSync(BASE)) mkdirSync(BASE, { recursive: true }) } catch {}
}

interface ToolEntry { count: number; totalMs: number; errors: number }
interface ToolStats {
  tools: Record<string, ToolEntry>
  chain: string[]
  lastStepMs: number
  ok: number
  fail: number
  reads: Record<string, number>
  writes: Record<string, number>
}

const starts: Record<string, number> = {}
const cache = new Map<string, ToolStats>()

function load(sid: string): ToolStats {
  let c = cache.get(sid)
  if (c) return c
  try {
    const f = statsFile(sid)
    if (existsSync(f)) {
      const d = JSON.parse(readFileSync(f, "utf-8"))
      c = { ...d, reads: d.reads || {}, writes: d.writes || {} } as ToolStats
    }
  } catch {}
  c = c || { tools: {}, chain: [], lastStepMs: 0, ok: 0, fail: 0, reads: {}, writes: {} }
  cache.set(sid, c)
  return c
}

function save(sid: string, s: ToolStats) {
  try {
    ensureDir()
    const f = statsFile(sid)
    const existing = existsSync(f) ? JSON.parse(readFileSync(f, "utf-8")) : {}
    const merged = { ...existing, ...s, reads: s.reads || existing.reads || {}, writes: s.writes || existing.writes || {} }
    writeFileSync(f, JSON.stringify(merged))
  } catch {}
}

const STATS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function cleanupOldStats() {
  try {
    const now = Date.now()
    for (const f of readdirSync(BASE)) {
      if (!f.startsWith("_tool_stats_") || !f.endsWith(".json")) continue
      const fp = join(BASE, f)
      if (now - statSync(fp).mtimeMs > STATS_MAX_AGE_MS) {
        unlinkSync(fp)
      }
    }
  } catch {}
}

function extractPath(args: any): string | null {
  if (!args) return null
  const fp = args.filePath || args.filepath || args.file || args.path
  if (typeof fp === "string" && fp) return fp
  return null
}

export const server = async () => {
  ensureDir()
  cleanupOldStats()

  return {
    "tool.execute.before": async (input: { tool: string; callID: string; sessionID: string }, output: { args: any }) => {
      starts[input.callID] = Date.now()
      const stats = load(input.sessionID)
      const fp = extractPath(output?.args)
      if (!fp) return
      if (input.tool === "read") {
        stats.reads[fp] = (stats.reads[fp] || 0) + 1
        save(input.sessionID, stats)
      } else if (input.tool === "write" || input.tool === "edit" || input.tool === "apply_patch") {
        stats.writes[fp] = (stats.writes[fp] || 0) + 1
        save(input.sessionID, stats)
      }
    },

    "tool.execute.after": async (input: { tool: string; callID: string; sessionID: string }, output: { output: string; metadata: Record<string, any>; isError?: boolean }) => {
      const stats = load(input.sessionID)
      const t = input.tool
      stats.tools[t] = stats.tools[t] || { count: 0, totalMs: 0, errors: 0 }
      stats.tools[t].count++

      const start = starts[input.callID]
      if (start) {
        const ms = Date.now() - start
        stats.tools[t].totalMs += ms
        stats.lastStepMs = ms
        delete starts[input.callID]
      }

      const isError = (
        output?.metadata?.error ||
        output?.isError ||
        (typeof output?.metadata?.exit === "number" && output?.metadata?.exit !== 0) ||
        /^(Error|ERROR|error):/.test(output?.output || "")
      )

      if (isError) {
        stats.tools[t].errors++
        stats.fail++
      } else {
        stats.ok++
      }

      stats.chain.push(t)
      if (stats.chain.length > 5) stats.chain.shift()

      save(input.sessionID, stats)
    },
  }
}

const plugin = { id: "tool-tracker", server }
export default plugin
