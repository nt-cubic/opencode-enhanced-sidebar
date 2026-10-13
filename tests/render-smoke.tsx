/**
 * Headless render smoke test for the Enhanced Sidebar plugin.
 *
 * Renders the sidebar View against a mocked plugin context using the OpenTUI
 * in-memory test renderer and checks that the cards draw meaningful values.
 *
 * Uses the same Solid JSX pipeline as OpenCode itself, so it must run under
 * Bun:
 *
 *   bun --preload @opentui/solid/preload tests/render-smoke.tsx
 */
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { View } from "../plugins/enhanced-sidebar/tui.js"

const color = (hex: string) => RGBA.fromHex(hex)

const theme = {
  text: {
    base: color("#ffffff"),
    muted: color("#808080"),
    action: { primary: { base: color("#4a9eff") } },
    feedback: {
      error: { base: color("#ff5555") },
      warning: { base: color("#ffaa00") },
    },
  },
  diff: { text: { added: color("#50fa7b"), removed: color("#ff5555") } },
}

const now = Date.now()

const assistant = (id: string, extra: Record<string, unknown>) => ({
  id,
  type: "assistant",
  agent: "build",
  model: { id: "test-model", providerID: "test-provider" },
  content: [],
  time: { created: now - 60_000, completed: now - 50_000 },
  ...extra,
})

const messages = [
  { id: "msg_user_1", type: "user", text: "hello", time: { created: now - 70_000 } },
  assistant("msg_asst_1", {
    tokens: { input: 1_000, output: 500, reasoning: 200, cache: { read: 800, write: 100 } },
    cost: 0.0123,
    content: [
      {
        type: "tool",
        id: "call_1",
        name: "read",
        executed: true,
        state: {
          status: "completed",
          input: { filePath: "C:/project/src/app.ts" },
          content: [{ type: "text", text: "..." }],
        },
        time: { created: now - 65_000, ran: now - 65_000, completed: now - 64_780 },
      },
      {
        type: "tool",
        id: "call_2",
        name: "blender_execute_blender_code",
        executed: true,
        state: {
          status: "completed",
          input: { code: "bpy.ops.mesh.primitive_cube_add()" },
          content: [{ type: "text", text: "ok" }],
        },
        time: { created: now - 63_000, ran: now - 63_000, completed: now - 62_000 },
      },
    ],
  }),
]

const data = {
  on: () => () => {},
  session: {
    message: { list: () => messages },
    get: () => ({
      id: "ses_smoke",
      cost: 0.0123,
      tokens: { input: 1_000, output: 500, reasoning: 200, cache: { read: 800, write: 100 } },
      time: { created: now - 70_000, updated: now - 50_000 },
    }),
    status: () => "idle",
  },
  location: {
    default: () => ({ directory: process.cwd() }),
    model: {
      list: () => [
        {
          id: "test-model",
          modelID: "test-model",
          providerID: "test-provider",
          name: "Test Model",
          limit: { context: 200_000, output: 8_000 },
        },
      ],
    },
    mcp: { server: { list: () => [{ name: "blender", status: { type: "connected" } }] } },
  },
}

const client = {
  message: { list: async () => ({ data: messages, cursor: { previous: null, next: null } }) },
  session: {
    diff: async () => [
      { file: "src/app.ts", patch: "", additions: 12, deletions: 3, status: "modified" },
    ],
  },
}

const context = {
  options: {},
  location: { directory: process.cwd() },
  app: { version: "smoke", channel: "test" },
  client,
  data,
  theme,
} as unknown as Context

const setup = await testRender(() => <View context={context} sessionID="ses_smoke" />, {
  width: 100,
  height: 50,
})
await new Promise((resolve) => setTimeout(resolve, 50))
await setup.flush()
const frame = setup.captureCharFrame()

const expected = [
  "Context Health",
  "Usage",
  "1% · 200,000 max",
  "Cache hit",
  "42%",
  "Density",
  "350 tok/msg",
  "Performance",
  "Duration",
  "20.0s",
  "Avg time / turn",
  "10.0s",
  "TPS",
  "50 tok/s",
  "Cost & Efficiency",
  "Agents",
  "build",
  "100%",
  "Tools",
  "Model & Session",
  "Hot Files",
  "Directory",
  "Session Info",
  "Created:",
  "Last active:",
]
const missing = expected.filter((label) => !frame.includes(label))
if (missing.length > 0) {
  console.error(`smoke test failed; missing: ${missing.join(", ")}`)
  console.error(frame)
  process.exit(1)
}
console.log("render smoke test passed")
setup.renderer.destroy()
