# Usage — `jev` CLI

Practical examples for every `jev` command. See the [README](../README.md) for setup,
authentication and architecture.

## Setup

```bash
npm install
npm run build
npm link            # optional: exposes `jev` globally
# without linking:  node dist/index.js <command>
```

Run `jev` from inside the git repository you want the agents to work on. Set
`TYPESAFE_API_KEY` in `.env` (without it, routing falls back to a local heuristic).

## Commands

| Command | Purpose |
| --- | --- |
| `claudex run "<description>"` | Full flow: route, execute in worktrees, review, merge |
| `claudex dashboard` | Start the WS + HTTP dashboard on http://localhost:8080 |
| `claudex status` | Print the fleet snapshot |
| `claudex worktrees` | List active worktrees |
| `claudex clean` | Remove orphan worktrees and branches |

## `claudex run`

### Single task

```bash
claudex run "adicionar endpoint /health"
```

Jev classifies the complexity and routes the task to Claude Code or Codex (see the routing
table in the README).

### Preview routing without running agents

```bash
claudex run "refatorar o módulo de autenticação" --dry-run
```

Only asks Jev where the task would go; no agents start and nothing is changed.

### Manual subtasks (strings)

```bash
claudex run "adicionar endpoint /health" \
  --subtasks '["criar rota /health", "documentar /health no README"]'
```

### Manual subtasks (objects with ids)

```bash
claudex run "migrar autenticação" \
  --subtasks '[{"id":"auth","description":"trocar sessão por JWT"},{"id":"tests","description":"atualizar testes de login"}]'
```

> On PowerShell, wrap the JSON in single quotes and escape inner double quotes, or use a
> here-string / variable: `$s = '["a","b"]'; claudex run "x" --subtasks $s`.

### Clean up worktrees afterwards

```bash
claudex run "corrigir typo no README" --cleanup
```

### Run without the dashboard

```bash
claudex run "atualizar dependências" --no-server
```

### Combining flags

```bash
claudex run "adicionar cache" --subtasks '["implementar cache LRU","testes do cache"]' --cleanup --no-server
```

## `claudex dashboard`

```bash
claudex dashboard
```

Open http://localhost:8080. It works while idle. In the command input you can type
`pause`, `resume` or `kill <taskId>`. `claudex run` starts the dashboard automatically unless
`--no-server` is given.

## `claudex status`

```bash
claudex status
```

Prints the current fleet snapshot (tasks, agents, status).

## `claudex worktrees` and `claudex clean`

```bash
claudex worktrees   # list worktrees under .worktrees/
claudex clean       # remove orphan worktrees and their branches
```

Use `clean` after an interrupted run.

## Typical workflow

```bash
claudex run "feature X" --dry-run     # 1. check the routing
claudex run "feature X"               # 2. execute, review and merge
claudex worktrees                     # 3. inspect leftovers
claudex clean                         # 4. tidy up
```

## Troubleshooting

- **`--subtasks requires a JSON argument`** / **`must be a JSON array`** — pass a valid JSON
  array of strings or `{description}` objects.
- **Warning about `ANTHROPIC_API_KEY`** — unset it, otherwise the Claude SDK bills tokens
  instead of using your subscription.
- **Jev unavailable (429/529/5xx or no key)** — the local heuristic router is used automatically.
