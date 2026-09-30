# Contributing to Claudex

Thanks for your interest! Issues and pull requests are welcome.

## Development setup

```bash
git clone https://github.com/DiegoHerreraDaSilva/claudex.git
cd claudex
npm install
npm run build
```

Requirements: **Node.js 22+** and **git**.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Compile TypeScript and copy the UI assets to `dist/` |
| `npm run typecheck` | Type-check only (no emit) |
| `npm test` | Run the unit tests (vitest) |
| `npm run format` | Format with Prettier |
| `npm run app` | Launch the Electron desktop app |
| `npm run app:web` | Serve the chat app in the browser (`http://localhost:8080`) |
| `npm run smoke:jev` / `smoke:worktree` / `smoke:agents` | Manual smoke tests |

## Before opening a PR

1. `npm run typecheck && npm run build && npm test` must pass.
2. Keep the change focused; add or update tests for logic you touch.
3. Do not commit secrets — `.env`, `~/.claude/`, and `~/.codex/` are never tracked.

## Architecture at a glance

- `src/app/chat.ts` — the routing tree (Jev → Sonnet / Opus → Sol 6 / Sonnet), sessions, worktrees, apply/discard.
- `src/app/projects.ts` — project + conversation storage (versioned, atomic writes).
- `src/app/git.ts` — git helpers (worktrees, commit, diff, merge, reset).
- `src/agents/*` — thin wrappers over the official Claude and Codex SDKs.
- `src/server/*` — HTTP + WebSocket app server and the fleet dashboard.
- `src/chat/*` — the chat UI (plain HTML/CSS/JS, PT/EN).

See the README for the full picture.
