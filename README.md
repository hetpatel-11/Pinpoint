# Pinpoint

Pinpoint is a visual frontend review system for AI-assisted coding.

This repo now contains both parts of the project:

- the browser-based annotation app and MCP bridge in the repo root
- the desktop overlay companion app in `desktop-overlay/`

Together, they let you place pins on real UI, capture exact DOM context, save structured review data, and expose that context to an AI coding agent through MCP.

## Repo layout

```text
.
├── src/                  # browser annotation app
├── server/               # local API + MCP server for the web app
├── data/                 # saved annotation state
├── desktop-overlay/      # Electron desktop overlay companion app
└── README.md
```

## Root app

The root app is the web review flow:

- drag and place multiple pins on a live page
- attach comments to exact UI regions
- capture selector, bounds, text snippet, and HTML snippet
- save annotations into `data/review-state.json`
- expose those annotations through MCP tools

### Run the root app

Start the API:

```bash
npm run dev:api
```

Start the web app:

```bash
npm run dev:web
```

Start the MCP server:

```bash
npm run mcp
```

The Vite app runs on `http://localhost:5173` and proxies `/api` requests to `http://localhost:4545`.

### Root MCP tools

- `get_review_state`
- `list_annotations`
- `get_annotation`
- `get_batch_prompt`

## Desktop overlay

The desktop companion app lives in:

```text
desktop-overlay/
```

It is an Electron app intended for screen-level annotation and JetBrains-oriented workflows.

### Run the desktop app

```bash
cd desktop-overlay
npm install
npm run dev
```

### Desktop MCP server

```bash
cd desktop-overlay
npm run mcp
```

## Shared state

The root browser UI and root MCP server both use:

```text
data/review-state.json
```

That file is the source of truth for the current browser-based annotation session.
