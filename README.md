# Claudex

🌐 **English** · [Português (BR)](README.pt-BR.md)

**A local-first desktop orchestrator that routes your coding tasks across Claude Code, Codex, and the Jev (TypeSafe) decision API — with a chat interface.**

You describe a task in plain language. Claudex asks Jev (a fast decision model) how the work should be handled, then routes it to the right agent, runs it inside an isolated git worktree of *your* project folder, shows you the diff, and lets you apply or discard it. Everything runs on your machine with **your own accounts and API keys**.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

---

## How routing works

```
                 ┌──────────────┐
                 │    INPUT     │  your message in the chat
                 └──────┬───────┘
                        ▼
                 ┌──────────────┐
                 │     JEV      │  TypeSafe decision model (or local heuristic fallback)
                 └──────┬───────┘
              simples implementação │ precisa planejar algo
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
             ┌────────────┐                  ┌────────────┐
             │   SONNET   │                  │    OPUS    │  (plans first)
             └────────────┘                  └─────┬──────┘
                                          feature complexa │ feature mais simples
                                        ┌──────────────────┴──────────────────┐
                                        ▼                                     ▼
                                 ┌────────────┐                        ┌────────────┐
                                 │   SOL 6    │                        │   SONNET   │
                                 │ (Codex)    │                        └────────────┘
                                 └────────────┘
```

- **Simple implementation** → Claude **Sonnet** implements directly.
- **Needs planning** → Claude **Opus** writes a plan and decides if it is a **complex feature** (→ Codex **Sol 6**) or a **simpler feature** (→ **Sonnet**).

If the TypeSafe API is unavailable (no key, `429`/`529`/`5xx`), Claudex falls back to a local heuristic router so the workflow never stalls.

---

## Features

- **Desktop chat app** (Electron) with a **native folder picker**, plus a browser mode.
- **Projects**: register any folder that is a git repository; each project keeps its own conversation.
- **Continuous sessions**: follow-ups resume the same Claude `session_id` or Codex `thread_id`.
- **Isolated git worktrees**: agents never touch your working tree directly.
- **Manual review**: an **Apply** / **Discard** bar shows the diff of what the agents changed.
- **In-app credentials**: connect/disconnect Claude and Codex, paste API keys, see account/plan.
- **Local-first & private**: no telemetry; credentials and keys stay on your machine.
- **CLI + live dashboard** for scripted, non-interactive runs.
- **Dark / light theme**.

---

## Requirements

- **Node.js 22+** and **git** on your `PATH`
- A **Claude Pro/Max** subscription *or* an `ANTHROPIC_API_KEY`
- A **ChatGPT Plus/Pro** subscription *or* an `OPENAI_API_KEY` (for the Codex path)
- A **TypeSafe (Jev) API key** — optional; without it Claudex uses the local heuristic router
  (get one at https://console.typesafe.ai/keys)

Claudex uses the **official SDKs** for authentication — it never extracts or reuses OAuth tokens in third-party tools:

- Claude: `@anthropic-ai/claude-agent-sdk` (reads `~/.claude/.credentials.json`)
- Codex: `@openai/codex-sdk` (reads `~/.codex/auth.json`)

---

## Install (from source)

```bash
git clone https://github.com/DiegoHerreraDaSilva/claudex.git
cd claudex
npm install
npm run build
```

> The folder you point Claudex at must be a git repository. If it isn't yet:
> ```bash
> cd /path/to/your/project
> git init && git commit --allow-empty -m "init"
> ```

---

## Run

**Desktop app (Electron window):**

```bash
npm run app
```

**Browser mode (same backend, served locally):**

```bash
npm run app:web
# then open http://localhost:8080
```

On Windows you can create a desktop shortcut to `npm run app` (see `desktop/`).

---

## Connect your accounts and API keys

Open the app, click **settings** (top-right), and use the connect/disconnect buttons or the key fields. Anything you save is written to `.env` on your machine (which is git-ignored).

| Provider | Connect with subscription | Or use an API key |
| --- | --- | --- |
| **Claude** | **Connect** runs `claude auth login` (opens your browser to sign in with Claude Pro/Max) | paste `ANTHROPIC_API_KEY` |
| **Codex** | **Connect** runs `codex login` → *Sign in with ChatGPT* | paste `OPENAI_API_KEY` |
| **Jev / TypeSafe** | — | paste `TYPESAFE_API_KEY` (https://console.typesafe.ai/keys) |

**Disconnect** runs the matching logout (`claude auth logout` / `codex logout`) and removes the stored credentials.

> **Important:** if `ANTHROPIC_API_KEY` is set, the Anthropic SDK uses it and **ignores your Claude subscription** (token billing). Unset it to use Pro/Max. The app warns you when it is present. Same idea for `OPENAI_API_KEY` vs. the ChatGPT login.

You can also configure everything from the CLI by copying `.env.example` to `.env`.

---

## Using the app

1. **New project** → **choose folder** (native picker in the desktop app; a built-in folder browser in the web UI). Folders that are git repositories are tagged `git`.
2. Type your task and **send**. You'll see the Jev decision (e.g. `precisa planejar → claude:opus`, then `feature complexa → gpt-6-sol`), the plan, and the agent's tool calls streaming live.
3. Review the **diff** on the right. Click **Apply** to merge the project branch into your branch, or **Discard** to throw the changes away.

### Resume / continuity

- Claude runs return a `session_id` → resumed on your next message in the same project.
- Codex runs return a `thread_id` → resumed the same way.
- Handles are visible in the **session** tab and persisted in each project's state.

---

## Configuration (`.env`)

```dotenv
# Credentials for the model subscriptions are read by the SDKs:
#   Claude: ~/.claude/.credentials.json  (created by `claude auth login`)
#   Codex:  ~/.codex/auth.json           (created by `codex login`)
# Do NOT set ANTHROPIC_API_KEY if you want to use your Claude subscription.

TYPESAFE_API_KEY=sua-chave
TYPESAFE_BASE_URL=https://api.typesafe.ai
JEV_MODEL=jev-latest
JEV_CACHE_TTL=3600
WS_PORT=8080
AGENT_TIMEOUT_MS=600000
MAX_PARALLEL_TASKS=3
DEFAULT_PLANNER_MODEL=opus
DEFAULT_SIMPLE_MODEL=sonnet
DEFAULT_COMPLEX_MODEL=gpt-6-sol
```

---

## CLI

The same engine is available from the command line:

```bash
claudex run "<description>"   # full flow: route, execute in worktrees, review, merge
claudex app                   # chat app server (browser mode)
claudex dashboard             # WS + HTTP fleet dashboard (works while idle)
claudex status                # print the fleet snapshot
claudex worktrees             # list active worktrees
claudex clean                 # remove orphan worktrees and branches
```

Options for `run`:

| Flag | Effect |
| --- | --- |
| `--subtasks <json>` | Split the work manually, e.g. `'["a","b"]'` |
| `--cleanup` | Remove worktrees after finishing |
| `--dry-run` | Ask Jev for routing only; run no agents |
| `--no-server` | Do not start the dashboard during the run |

Smoke tests:

```bash
npm run smoke:jev                      # one Jev question (or heuristic fallback)
npm run smoke:worktree                 # create → diff → list → remove
SMOKE_AGENTS=1 npm run smoke:agents    # real Claude + Codex runs (uses your subscriptions)
```

---

## Project layout

```
desktop/                Electron shell (main + preload)
src/
  index.ts              CLI entry point
  app/
    projects.ts         project registry (per-project folders)
    chat.ts             chat service: Jev routing tree, sessions, worktrees, apply/discard
    git.ts              git helpers (worktrees, commit, diff, merge, reset)
  agents/
    claude.ts           Claude Agent SDK wrapper
    codex.ts            Codex SDK wrapper
    types.ts            shared agent types
  jev.ts                TypeSafe Jev client (retry, cache, heuristic fallback)
  orchestrator.ts       non-interactive fleet orchestrator (CLI)
  worktree.ts           worktree manager for the CLI
  server/
    appServer.ts        HTTP + WebSocket server for the chat app
    ws.ts / static.ts   realtime + static server for the dashboard
  chat/                 chat UI (HTML/CSS/JS, no framework)
  dashboard/            fleet dashboard UI
  accounts.ts           login/logout for Claude and Codex (auth management)
```

---

## Security & privacy

- Everything runs **locally**. No data is sent anywhere except to the model providers and TypeSafe, using *your* credentials.
- `.env`, `~/.claude/`, and `~/.codex/` are **never** committed; `.env` is git-ignored.
- Agents run in **isolated git worktrees**, and changes only reach your branch when you click **Apply**.

---

## Notes on API contracts (verified)

- **Claude**: the TypeScript SDK is `@anthropic-ai/claude-agent-sdk`. The older `@anthropic-ai/claude-code` package is only the CLI installer and no longer exports `query()`.
- **Codex**: `@openai/codex-sdk` streamed events are `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.started`, `item.updated`, `item.completed`, `error`. The worktree path is passed via `startThread({ workingDirectory })`.
- **Jev**: `POST {TYPESAFE_BASE_URL}/v1/systemone` with `{ state, model, questions }` returns `{ model, answers, usage }`. A Noul answer is `{ type: "noul", noul }` (no `confidence`, unlike Choice/Score). Retries cover `429` and `529`. Input costs $0.042/MTok; output is free.
- Structured output uses `zod` 4's built-in `z.toJSONSchema()` (the Agent SDK requires `zod@^4`).

---

## Contributing

Issues and pull requests are welcome. Please run `npm run typecheck && npm run build` before opening a PR.

## License

[MIT](LICENSE) © Diego Herrera
