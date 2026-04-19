/**
 * Pinpoint Desktop — MCP Server
 *
 * Gives the AI agent eyes and hands on the user's screen.
 * Primary workflow: capture_screen → preview_click → (user confirms) → click happens.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const OVERLAY_API = 'http://127.0.0.1:4546'

async function api(method: string, path: string, body?: unknown) {
  let res: Response

  try {
    res = await fetch(`${OVERLAY_API}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (error) {
    throw new Error(
      `Pinpoint Desktop overlay is not reachable at ${OVERLAY_API}. Start the overlay app with \`cd desktop-overlay && npm run dev\`. Original error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  const payload = await res.json()

  if (!res.ok) {
    throw new Error(
      typeof payload?.error === 'string'
        ? payload.error
        : `Overlay API request failed for ${method} ${path}`,
    )
  }

  return payload
}

const server = new McpServer({
  name: 'pinpoint-desktop',
  version: '0.2.0',
  instructions: `
You have vision and cursor control over the user's screen.

ALWAYS use this loop:
1. capture_screen → see the screen
2. Analyze the screenshot to find the element
3. point_cursor(x, y, "Click the X button") → arrow appears on screen instantly
4. Tell the user: "Click there" in your chat response
5. capture_screen again → see what changed
6. Repeat until done

NEVER guess coordinates without first calling capture_screen.
NEVER use set_guidance instead of actually pointing at something.
`.trim(),
})

// ── Tool: capture_screen — CALL THIS FIRST ───────────────────────────────────

server.tool(
  'overlay_health',
  'Check whether the Pinpoint Desktop overlay app is running and ready to receive cursor guidance commands.',
  {},
  async () => {
    const health = await api('GET', '/api/health')
    return {
      content: [
        {
          type: 'text',
          text: `Overlay ready: ${JSON.stringify(health, null, 2)}`,
        },
      ],
    }
  },
)

server.tool(
  'capture_screen',
  `CALL THIS FIRST before any other action.
Takes a screenshot of the user's primary display and returns it as an image.
Analyze the screenshot to find the coordinates of the UI element you need to click.
Call this again after every click to see the updated screen state.`,
  {},
  async () => {
    const { image, mimeType } = await api('POST', '/api/screenshot', {})
    return {
      content: [{ type: 'image', data: image, mimeType }],
    }
  },
)

// ── Tool: preview_click — CALL THIS TO INTERACT ──────────────────────────────

server.tool(
  'point_cursor',
  `Move a visible blue arrow cursor on the user's screen to specific coordinates.
Returns IMMEDIATELY — does not block.
The user sees a flying blue arrow pointing at the target with a label.
Their real system cursor also moves there.
Use this to show the user exactly where to click, then tell them to click.
After they click, call capture_screen to see the result.

Workflow: capture_screen → find element → point_cursor → tell user to click → capture_screen again.`,
  {
    x: z.number().describe('Screen X in pixels'),
    y: z.number().describe('Screen Y in pixels'),
    reason: z.string().describe('Short label shown next to the cursor, e.g. "Click the Commit button"'),
  },
  async ({ x, y, reason }) => {
    await api('POST', '/api/cursor', { x, y, reason })
    return {
      content: [{ type: 'text', text: `Cursor moved to (${x}, ${y}). Label: "${reason}". The overlay should now show the guide cursor. Tell the user to click there, then call capture_screen to see the result.` }],
    }
  },
)

server.tool(
  'hide_cursor',
  'Hide the agent cursor arrow from the screen.',
  {},
  async () => {
    await api('DELETE', '/api/cursor')
    return { content: [{ type: 'text', text: 'Cursor hidden.' }] }
  },
)

// ── Tool: set_guidance — status bar message only ─────────────────────────────

server.tool(
  'set_guidance',
  `Set a short message in the status bar overlay.
Use this ONLY to tell the user what you are about to do, before calling capture_screen.
Do NOT use this as a substitute for actually interacting with the screen.`,
  {
    message: z.string().describe('Brief message shown in the floating status bar'),
    step: z.number().int().min(1).optional(),
    total_steps: z.number().int().min(1).optional(),
  },
  async ({ message, step, total_steps }) => {
    await api('POST', '/api/guidance', { message, step, totalSteps: total_steps })
    return { content: [{ type: 'text', text: `Status bar: "${message}"` }] }
  },
)

// ── Tool: place_pin — annotate without clicking ──────────────────────────────

server.tool(
  'place_pin',
  'Place a numbered annotation pin at a screen coordinate with an instruction label. ' +
  'Use this when you want to point something out to the user without clicking it.',
  {
    x: z.number(),
    y: z.number(),
    number: z.number().int().min(1),
    message: z.string(),
    color: z.string().optional(),
    id: z.string().optional(),
  },
  async ({ x, y, number, message, color, id }) => {
    const pin = { id: id ?? `pin-${Date.now()}`, x, y, number, message, color }
    const result = await api('POST', '/api/pins', pin)
    return { content: [{ type: 'text', text: `Pin ${number} placed at (${x}, ${y}). ID: ${result.id}` }] }
  },
)

// ── Tool: clear_all ───────────────────────────────────────────────────────────

server.tool(
  'clear_all',
  'Remove all pins and clear the status bar message. Call when the task is complete.',
  {},
  async () => {
    await Promise.all([api('DELETE', '/api/pins'), api('DELETE', '/api/guidance')])
    return { content: [{ type: 'text', text: 'Overlay cleared.' }] }
  },
)

// ── Tool: get_screen_info ─────────────────────────────────────────────────────

server.tool(
  'get_screen_info',
  'Get screen dimensions and current cursor position. ' +
  'Useful for understanding the coordinate space before analyzing a screenshot.',
  {},
  async () => {
    const info = await api('GET', '/api/screen')
    return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] }
  },
)

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[pinpoint-mcp] Ready')
}

main().catch(console.error)
