# Pinpoint

Pinpoint is a visual annotation overlay for frontend review.

It lets you drag pins onto a live website, attach comments to exact UI regions, save those annotations to disk, and expose the same structured context to an AI coding agent through MCP.

## What it does

- wraps a real web page with a reusable `PinpointOverlay`
- lets you drag and place multiple pins anywhere on the page
- captures a CSS selector, bounds, text snippet, and comment for each pin
- saves annotations through a local API into `data/review-state.json`
- exposes those annotations to agents through an MCP server

## How it works

1. Open the web app and drag a pin onto the page.
2. Add a comment describing the frontend change you want.
3. Pinpoint stores the annotation metadata in `data/review-state.json`.
4. Your AI coding agent reads that same state through MCP tools.
5. The agent can then edit the matching frontend area with much tighter context.

## Run it locally

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

## MCP tools

The MCP server exposes:

- `get_review_state`
- `list_annotations`
- `get_annotation`
- `get_batch_prompt`

## Shared state

The browser UI and MCP server both use:

```text
data/review-state.json
```

That file is the source of truth for the current annotation session.

## Using Pinpoint on your own app

The current app includes a demo website, but the overlay is designed to be reusable.

Wrap your app with `PinpointOverlay` from `src/App.tsx`, run the local API, and keep the MCP server connected so your coding agent can consume the saved annotations.
