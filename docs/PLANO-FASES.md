> Documento histórico da versão anterior. O fluxo atual está descrito em README.pt-BR.md e SPEC-simplification.md.

# Claudex — Plano de Implementação (Fases 3–6 + pendências)

> Documento de handoff. Descreve o estado atual do projeto e o plano detalhado
> para continuar o desenvolvimento em outras sessões.
> Última atualização: 30/09/2026, após GitHub/CI e Browser QA da Fase 6.
> Fases 3–6 concluídas no escopo descrito nas entregas. Browser QA validado em Chrome/Edge e GitHub/CI validados na [PR #1 em rascunho](https://github.com/DiegoHerreraDaSilva/claudex/pull/1), com CI aprovado. Ver [entrega da Fase 6](FASE-6.md).

---

## 0. Como retomar (checklist rápido)

1. `cd C:\Users\dherrera\Desktop\Claudex`
2. `git status` e retomar a branch local `codex/phase6-devops`; consultar o remoto antes de sincronizar alterações.
3. `npm install` (se necessário).
4. `npm run build && npm run lint && npm test` — conferir os comandos e resultados nas entregas de cada fase.
5. Subir a UI para inspecionar: `npm run app:web` (porta 8080) e rodar
   `npm run ui:check -- http://127.0.0.1:8080` (script headless que captura erros de console).
6. Ler a seção da fase desejada (Fase 3 → seção 7, etc.).
7. **Regra de ouro de entrega:** apenas `git add/commit/push`. **NÃO** criar
   release/tag/versão sem o usuário pedir explicitamente.

---

## 1. Contexto

**Claudex** = app desktop local-first (Electron + modo web) que orquestra agentes
de código (Claude Code, Codex) e roteia tarefas com a API de decisão Jev (TypeSafe).
Cada "missão" roda em um **worktree git isolado** com branch própria e sessão
contínua; ao final o usuário faz **Apply/Discard** (merge manual).

**Visão:** "AI Engineering Control Center" — cockpit visual de operações
(Projects → Mission → Task Graph → Agents → Verification → Review → Git),
mantendo o chat como um dos painéis, não como o produto inteiro.

**Stack:** Node 22+/24, TypeScript strict ESM, Electron 33, front-end **vanilla
ESM sem bundler**. SDKs: `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`,
`zod` v4. Testes com `vitest`.

---

## 2. Estado atual

### Fases concluídas

| Fase | Escopo | Commit |
|------|--------|--------|
| — | Autonomia dos agentes (bypassPermissions + rede Codex) | `816ab45` |
| 0 | Domínio + Event Store + MissionService + custo + API de eventos | `deaaa00` |
| 1 | Novo shell (ESM), design tokens, Home, command palette, toasts | `3135500` |
| 2 | Mission Center (timeline, agent cards, task graph), intent preview, interrupt | `c1df1fa` |
| 3 | Verification & Review, correção limitada, resumo persistido e resultado da missão | ver [FASE-3.md](FASE-3.md) |
| 4 | Inteligência, busca, memória, contexto, terminal, checkpoints, Git e histórico | ver [FASE-4.md](FASE-4.md) |

### Base anterior (linha de base)
- `6d7d132` — v0.1.8, app com projetos/conversas, worktrees, routing Jev, Claude/Codex, dashboard legado.

### O que já existe e funciona
- **Domínio** em `src/domain/`: `mission`, `task`, `agent`, `review`, `checkpoint`,
  `verification`, `memory`, `event`, `diff` (index re-exporta tudo).
- **Event store** append-only (`missions/<id>/events.jsonl`), fila por missão,
  tolerante a linha corrompida.
- **MissionService** (`src/application/missionService.ts`): executa a missão
  (route Jev → planner opcional → implementer) emitindo `mission:event`,
  gravando mensagens no chat e actualizando uso/custo.
- **Custo estimado** (`src/infrastructure/pricing.ts`) + `/api/usage` com `costUsd`.
- **Preview** (`src/application/missionPreview.ts`) + `POST /api/preview`.
- **UI**: shell redimensionável, Home, Workspace (chat + pipeline), Inspector,
  Mission Center, Command Palette, modais (projeto/pasta/settings), toasts.
- **CLI/dashboard legado**: `src/orchestrator.ts` (fleet paralela) + `src/index.ts`.

- **Fase 3**: checks no worktree, revisão Claude/Jev, uma correção automática, `mission.json`, `/api/missions/:id/summary` e painéis de resultado.

### Pendências conhecidas
- **Fase 0.9**: a CLI (`claudex run`) ainda usa o `Orchestrator` para o fluxo
  paralelo; só compartilha `runPool`. Falta unificar 100% sobre o MissionService.
- Upload de anexos/contexto não existe.
- Sem SQLite (decisão: Event Store JSONL + JSON).

---

## 3. Arquitetura

```
presentation   server/appServer.ts (HTTP) + server/settingsChannel.ts (WS)
cli            index.ts (fachada) + orchestrator.ts (fleet legado)
ui (chat)      src/chat/**  (vanilla ESM: lib, components, views)
        │
        ▼
application    missionService · missionPreview · orchestrationService
        │
        ▼
domain         mission · task · agent · review · checkpoint · verification · memory · event
        │
        ▼
infrastructure persistence/eventStore · pricing
        │
        ▼
            agents/claude · agents/codex · jev · app/git · app/projects
```

Regra de dependência: `domain` não importa nada de `application`/`infra`.
`application` orquestra `domain` + `infrastructure` + agentes. A UI fala só com
a API HTTP/WS.

### Estrutura-alvo (para onde vamos)
```
src/
  domain/            (feito)
  application/       missionService, missionPreview, orchestrationService,
                     verificationService, reviewService, memoryService,
                     repoIntelligence, terminalService, fleetService   (a criar)
  infrastructure/    persistence/eventStore, pricing, process, github    (a criar)
  presentation/      (hoje server/)
  chat/              lib, components, views                              (feito)
```

---

## 4. Convenções de engenharia

- **Nada de comentários** no código, salvo quando o usuário pedir.
- Imports ESM com extensão `.js` (NodeNext).
- TypeScript `strict`; sem `any` explícito (permitido, mas evitar).
- **Sem framework/bundler** no front-end: JS puro em ES modules, servido
  estaticamente por `server/appServer.ts` (`serveStatic`). Ao adicionar arquivos
  em `src/chat/`, `scripts/copy-assets.mjs` copia a pasta inteira para `dist/chat`.
- **i18n obrigatório PT/EN** em `src/chat/lib/i18n.js` (`I18N.pt` e `I18N.en`,
  usar `t("chave")`). Sempre adicionar as duas traduções.
- **Design tokens** em `src/chat/style.css` (`--bg`, `--panel`, `--elev`,
  `--border`, `--text`, `--muted`, `--accent`, `--ok/warn/err`, `--sidebar-w`,
  `--right-w`). Reusar variáveis, não hardcode de cor.
- **Eventos de missão**: sempre gravar via `MissionService.record(...)` para
  aparecer na timeline e persistir no event store.
- **Windows/PowerShell**: não usar `&&`; usar `;` ou `if ($?) { }`. Evitar
  comandos longos. Nunca abrir o browser do usuário.

### Comandos
| Comando | Uso |
|---------|-----|
| `npm run build` | compila TS + copia assets para `dist/` |
| `npm run lint` | ESLint |
| `npm test` | vitest |
| `npm run app` | Electron (desktop real) |
| `npm run app:web` | servidor web em `:8080` (para dev/inspeção) |
| `npm run ui:check -- <url>` | smoke headless da UI (Electron), falha se houver erro de console |
| `npm run dist` | installer (só quando o usuário pedir release) |

---

## 5. Modelo de domínio (referência)

### Eventos (`src/domain/event.ts`)
`MissionEventType`:
`mission:started | mission:completed | mission:failed | mission:stopped`,
`router:decided`, `plan:created`,
`agent:started | agent:message | agent:tool | agent:completed | agent:failed`,
`diff:created`, `cost:updated`, `checkpoint:created`,
`verification:started | verification:completed`, `review:completed`.

`TaskEvent` = `{ id, missionId, taskId?, at, type, level, message, payload? }`
(`level`: `info | warn | error | success`).

### Entidades
- **Mission** = `{ id, projectId, title, intent, status, autonomy, route?, branch?,
  worktreePath?, baseBranch?, createdAt, startedAt?, finishedAt?, usage, costUsd,
  tasks[], agentRuns[], verification[], review?, checkpoints[] }`
  (`MissionStatus`: draft→planning→implementing→verifying→reviewing→ready→applied | failed | cancelled).
- **Task** = subtarefa com `dependsOn`, agent/model, status, usage/cost, filesTouched.
- **AgentRun** = `{ id, missionId, taskId?, agentKind, model, label, sessionId?,
  threadId?, usage, costUsd, startedAt, endedAt }`.
- **VerificationRun** = `{ id, missionId, kind: typecheck|build|tests|lint|security,
  status, summary, output?, durationMs?, at }`.
- **Review** = `{ id, missionId, taskId?, approved, source, summary,
  findings: {severity, message, file?, line?, rule?}[], at }`.
- **Checkpoint** = `{ id, missionId, index, commit, files[], createdAt }`.
- **MemoryEntry** = `{ id, projectId, kind: architecture|decision|convention, text, createdAt }`.

> Hoje a "missão" é materializada em `Conversation` (`src/app/projects.ts`):
> 1 conversa = 1 worktree + 1 branch + 1 sessão. A projeção `Mission` (com tasks,
> verification, review) é derivada e deve ser persistida em
> `missions/<id>/mission.json` na Fase 3.

### Persistência (em `%APPDATA%\Claudex`, ou `CLAUDEX_DATA_DIR`)
```
projects.json                          (ProjectRegistry, schemaVersion 2)
missions/<missionId>/events.jsonl      (EventStore — append-only)
missions/<missionId>/mission.json      (projeção — a criar na Fase 3)
checkpoints/<missionId>/<n>.json       (a criar na Fase 4)
memory/<projectId>.json                (a criar na Fase 4)
```

---

## 6. Superfície de API

### Atual
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | status/uptime |
| GET | `/api/credentials` | modo Claude/Codex/Jev |
| GET | `/api/usage` | uso dos planos + `tokens` + `costUsd` |
| GET/POST | `/api/projects` | listar / criar |
| GET/DELETE | `/api/projects/:id` | snapshot / remover |
| POST | `/api/validate-path` | valida repo git |
| POST | `/api/preview` | interpretação da missão |
| GET | `/api/fs/list?path=` | navegação de pastas |
| GET | `/api/missions/:id/events` | eventos da missão |
| DELETE | `/api/projects/:id/conversations/:cid` | remover conversa |

### WS (`envelope` — `src/server/protocol.ts`)
Enviados ao cliente: `projects`, `credentials`, `chat:message`, `chat:routing`,
`chat:turn`, `chat:diff`, `chat:error`, `mission:event`, `settings:ack`,
`account:start|output|done`.
Recebidos: `chat:send`, `chat:stop`, `chat:action`, `conversation:create|rename|delete`,
`project:delete`, `settings`, `account`.

### Planejado
`GET /api/missions/:id/summary`, `POST /api/missions/:id/{start,interrupt,restore,pr}`,
`GET/POST/DELETE /api/projects/:id/memory`, `POST /api/repo/ask`,
`GET /api/projects/:id/intelligence`, `GET /api/projects/:id/git`,
`GET /api/projects/:id/missions`, `POST /api/terminal`.

---

## 7. Fase 3 — Verification & Review (concluída)

Implementação e decisões finais em [FASE-3.md](FASE-3.md). O detalhamento abaixo é o plano original da fase.

**Objetivo:** após o agente implementar, rodar um pipeline de verificação no
worktree e uma revisão (AI + Jev), exibir findings com "corrigir
automaticamente", e fechar numa tela **MISSION COMPLETE**.

**Pré-requisitos:** Fase 2 (eventos + Mission Center).

### 3.1 Backend

1. **`src/infrastructure/process.ts`** (novo)
   `runCommand(command, args, { cwd, timeoutMs })` → `{ code, stdout, stderr, durationMs }`.
   Usar `spawn` com `windowsHide: true`; no Windows, `shell: true` para scripts npm.

2. **`src/application/verificationService.ts`** (novo)
   - Detectar stack no `worktreePath` (`package.json` → scripts; `tsconfig.json`; etc.).
   - Rodar, quando disponível e habilitado:
     - `typecheck`: `npm run typecheck` ou `npx tsc --noEmit`
     - `build`: `npm run build`
     - `tests`: `npm test` (parsear "N passed")
     - `lint`: `npm run lint`
     - `security`: `npm audit --json` (node) — best-effort, `skipped` se indisponível.
   - Retornar `VerificationRun[]`; emitir `verification:started` e
     `verification:completed` (nível `success`/`error`) via `MissionService`.
   - Timeouts por comando (ex.: 10 min) e nunca lançar: falha vira `status:"failed"`.
   - Permitir override de comandos por projeto (memória da Fase 4).

3. **`src/application/reviewService.ts`** (novo)
   - Rodar Claude `opus` com `outputSchema` JSON:
     `{ approved: boolean, summary: string, findings: {severity, file, line?, message}[] }`.
   - Combinar com `jev.reviewDiff(diff, plan)` (já existente em `src/jev.ts`).
   - Retornar `Review`; emitir `review:completed`.

4. **`MissionService`** (`src/application/missionService.ts`)
   - Após `diff:created`: rodar verificação → review.
   - Se reprovado e autonomia permitir, rodar **correção** (mesmo padrão de
     `requestCorrection` em `src/orchestrator.ts:384`), re-diffar e re-verificar
     (limite de 1–2 tentativas).
   - Persistir a projeção em `missions/<id>/mission.json`
     (`{ status, tasks, verification, review, usage, costUsd, files }`).
   - Adicionar `MissionStatus` transitions: `verifying` → `reviewing` → `ready`/`failed`.

5. **`src/app/chat.ts` + `src/server/appServer.ts`**
   - `GET /api/missions/:id/summary` → projeção agregada (mission.json + eventos).

### 3.2 Front-end

6. **`src/chat/views/missionCenter.js`**
   - Painel **Verification**: checklist typecheck/build/tests/lint/security com
     ícone ✓/✕/—, tempo e output colapsável.
   - **Review findings**: lista com severidade, arquivo:linha e botão
     **"corrigir automaticamente"** (emitindo um `chat:send` de correção via WS).
   - Card **MISSION COMPLETE** (quando `ready`): arquivos, `+/-`, testes,
     build/lint/security/review, custo, duração, `[REVIEW CHANGES][APPLY][DISCARD]`.

7. **i18n** (`src/chat/lib/i18n.js`): chaves `verification`, `verifyTypecheck`,
   `verifyBuild`, `verifyTests`, `verifyLint`, `verifySecurity`, `reviewFindings`,
   `fixAutomatically`, `missionComplete`, `passed`, `failed`, `skipped`.

### 3.3 Critérios de aceite
- Rodar uma missão num repo de exemplo produz `VerificationRun[]` corretos,
  visíveis na timeline e no painel.
- Se o projeto não tem os scripts, os itens aparecem como `skipped` (sem quebrar).
- "corrigir automaticamente" dispara nova execução e repete o pipeline.
- `GET /api/missions/:id/summary` retorna status/verification/review/custo.
- `build`/`lint`/`test` verdes; `ui:check` sem erros de console.

### 3.4 Ordem de commits sugerida
1. `infrastructure/process.ts` + testes (parse de saída, timeouts).
2. `verificationService` + eventos + integração no `MissionService`.
3. `reviewService` + eventos.
4. Persistência `mission.json` + `/api/missions/:id/summary`.
5. UI: painel de verificação + findings + MISSION COMPLETE + i18n.

### 3.5 Riscos
- Comandos npm no Windows (quoting) → usar `shell:true` e args simples.
- Repos grandes: limitar output capturado; timeouts agressivos.
- `npm audit` pode não existir/rede → tratar como `skipped`.

---

## 8. Fase 4 — Intelligence

**Concluída em 30/09/2026.** Comportamento, limites, API e verificação em [FASE-4.md](FASE-4.md). O escopo abaixo fica como referência.

**Objetivo:** repo map, ask-repo, memória do projeto, context inspector,
terminal, git workspace, checkpoints e histórico de missões.

### 4.1 Backend

1. **`src/application/repoIntelligence.ts`**
   - Stack (deps de `package.json`), estrutura de pastas, entry points,
     contagem de arquivos e cobertura (executando testes, opcional).
   - **Architecture map**: parsing de imports (TS/JS `import ... from`, `require`)
     para montar grafo de dependências (nós = arquivos/módulos).
   - `GET /api/projects/:id/intelligence`.

2. **`src/application/repoSearch.ts`** (ask-repo)
   - Walk de arquivos + busca léxica (regex) e índice de símbolos (funções/classes/export).
   - `POST /api/repo/ask { projectId, query }` → `{ matches: [{file, line, snippet}], confidence }`.
   - Sem embeddings por padrão (decisão aberta; avaliar depois).

3. **`src/application/memoryService.ts`**
   - CRUD em `memory/<projectId>.json` (architecture/decision/convention).
   - Injetar a memória automaticamente nos prompts (planner e implementer) —
     estender `buildPlannerPrompt` e `buildPrompt` no `MissionService`.
   - Rotas `GET/POST/DELETE /api/projects/:id/memory`.

4. **`src/application/terminalService.ts`**
   - Rodar comandos no projeto/worktree com streaming via WS (`terminal:out`).
   - Gate por autonomia (Fase 5): por padrão exige modo assisted/autonomous.

5. **Checkpoints**
   - Criar `Checkpoint` (commit hash) após cada run de agente e gravar em
     `checkpoints/<missionId>/<n>.json`; emitir `checkpoint:created`.
   - `POST /api/missions/:id/restore` → `resetHard` para o commit do checkpoint.

6. **Git workspace**
   - `GET /api/projects/:id/git` → branches/worktrees/status (reusar `app/git.ts` e `worktree.ts`).

7. **Histórico**
   - `GET /api/projects/:id/missions` → conversas + status + custo + duração
     (derivado de `projects.json` + `mission.json`).

### 4.2 Front-end
- Novas views (hoje placeholders): `intelligence`, `memory`, `history`, `worktrees`.
- Painel **Terminal** e **Context Inspector** no `#right` (novas abas).
- **Architecture map**: SVG simples (nós + arestas) a partir do grafo.
- **Checkpoints**: timeline com botão restaurar.

### 4.3 Critérios de aceite
- Ask-repo retorna arquivos reais com linha/snippet e confiança.
- Memória do projeto aparece nos prompts (verificável via timeline/prompt log).
- Checkpoints restauráveis; git workspace lista worktrees/branches.

---

## 9. Fase 5 — Autonomia

**Objetivo:** modos de autonomia visíveis e um permission broker real
(substituir o `bypassPermissions` fixo).

### 5.1 Modelo
- `AutonomyMode = manual | assisted | autonomous` por conversa
  (persistir em `Conversation.autonomy`; bump `SCHEMA_VERSION` → 3 com migração).
- Matriz de ações permitidas: `read`, `edit`, `tests`, `git`, `install`, `net`, `delete`.
  - manual: read
  - assisted: read, edit, tests, git
  - autonomous: tudo

### 5.2 Backend
- `src/application/permissionBroker.ts`: dado o modo, resolve:
  - Claude: `allowedTools`/`disallowedTools` + `canUseTool` callback para Bash.
  - Codex: `sandboxMode` (`read-only`/`workspace-write`/`danger-full-access`) e
    `approvalPolicy`.
- `MissionService` e `orchestrator` recebem o modo (default `autonomous` para
  preservar o comportamento atual).
- Emitir `mission:permission` (novo evento) quando uma ação for bloqueada.

### 5.3 Front-end
- Seletor de autonomia no header do Workspace + no command palette.
- Matriz de permissões no modal de settings.
- Modal de aprovação quando `assisted` e ação fora da allowlist.

### 5.4 Critérios de aceite
- Trocar o modo muda o comportamento real dos agentes (ex.: manual não edita).
- Default `autonomous` mantém o fluxo atual funcionando.

---

## 10. Fase 6 — DevOps

**Objetivo:** GitHub/PR/CI e Browser QA.

### 6.1 GitHub (`src/infrastructure/github.ts`)

Implementado e validado com GitHub real na PR #1; ver [FASE-6.md](FASE-6.md). O `gh` está instalado e autenticado; publicação, reuso de PR, hash e CI aprovado foram confirmados.
- Usar `gh`; autenticar com `gh auth login` antes da validação com GitHub real.
- `POST /api/missions/:id/pr` → abre PR da branch da missão (`gh pr create`).
- `GET /api/missions/:id/checks` → `gh pr checks` (status de CI).

### 6.2 Browser QA
- Escolha resolvida: Playwright com Google Chrome ou Microsoft Edge instalado, conforme preferência do usuário.
- Implementado: verificação de carregamento local, erros e captura no Mission Center; ver [FASE-6.md](FASE-6.md).
- Perfil isolado, origem local restrita e respeito aos modos de autonomia.

### 6.3 Critérios de aceite
- Abrir PR a partir de uma missão pronta e ver o status dos checks.

---

## 11. Design system / componentes (referência)

**Padrão de escrita:** frases, rótulos, botões e mensagens da interface começam com letra maiúscula em português e inglês. Manter nomes de arquivos, comandos e dados fornecidos pelo usuário como recebidos.

**Componentes atuais** (`src/chat/components/`): `commandPalette`, `toast`,
`confirm`, `previewModal`.

**Helpers** (`src/chat/lib/`): `dom.js` (`el`, `clear`, `frag`, `escapeHtml`),
`i18n.js` (`t`, `setLang`, `getLang`, `applyStatic`, `roleLabel`),
`api.js`, `store.js` (`state`, `patch`, `notify`, `subscribe`, `currentProject`,
`currentConversation`, `conversationMessages`, `currentDiff`, `isRunning`),
`socket.js` (`initSocket`, `send`, `isConnected`).

**Views** (`src/chat/views/`): `sidebar`, `home`, `workspace`, `inspector`,
`missionCenter`, `modals`, `placeholder`.

**Componentes a criar**: `statusBadge`, `agentCard`, `taskNode`, `timelineItem`,
`metric`, `diffViewer`, `reviewFinding`, `checkpointCard` (podem nascer
extraindo o que já está inline em `missionCenter.js`/`workspace.js`).

**Padrão de render:** `app.js` mantém `subscribe(renderAll)`; cada view expõe
`renderX(root, actions)`. Estado vive em `store.state`; atualizações via `patch`
ou `notify`. O `actions` é montado em `app.js` (um único objeto).

---

## 12. Testes & verificação

- **Unit**: `vitest` em `tests/`. Já existem: `routing`, `registry`,
  `eventStore`, `pricing`, `diff`. Adicionar por fase: `process`,
  `verificationService`, `reviewService`, `memoryService`, `repoSearch`,
  `permissionBroker`.
- **UI smoke**: `npm run app:web` + `npm run ui:check -- http://127.0.0.1:8080`.
  O script (`scripts/ui-check.mjs`) carrega a UI no Electron, captura
  `console-message`/`did-fail-load` e faz um probe do DOM; sai com código ≠ 0
  em caso de erro.
- **Sintaxe JS**: como o front-end não é compilado, rodar `node --check` em cada
  `.js` de `src/chat` antes de commitar (ver Apêndice A).
- **Antes de cada commit**: `npm run build && npm run lint && npm test`.

---

## 13. Riscos e decisões abertas

1. **Ask-repo / embeddings**: sem provider de embeddings. Plano inicial é busca
   léxica + índice de símbolos; embeddings depois (via Jev ou API).
2. **Browser QA**: resolvido com `playwright-core` e Chrome/Edge instalado. Escopo atual: carregamento local e captura; fluxos completos não estão incluídos.
3. **SQLite**: adiado. `node:sqlite` não existe no Electron 33 (Node 20) e
   `better-sqlite3` exige rebuild nativo. Manter JSONL + JSON.
4. **Custo `$`** é estimativa (tabela em `pricing.ts`); Codex subscription não
   expõe quota.
5. **Migração de dados**: Fase 5 sobe `SCHEMA_VERSION` para 3 (adiciona
   `autonomy`); a migração deve ser reversível e manter backup de `projects.json`.
6. **UI grande em vanilla**: mitigada por módulos + store; seguir disciplina de
   componentes e não criar arquivos gigantes.
7. **Segurança**: agentes rodam com privilégios do usuário (Fase 0 habilitou
   bypass de permissão). O permission broker da Fase 5 é o caminho para reduzir
   o raio de ação por missão.

---

## Apêndice A — Snippets úteis

**Sintaxe dos módulos JS da UI:**
```powershell
$files = Get-ChildItem -Recurse -File src\chat -Include *.js | ForEach-Object { $_.FullName }
foreach ($f in $files) { node --check $f; if ($LASTEXITCODE -ne 0) { Write-Output "FAIL $f" } }
```

**Smoke da UI (headless):**
```powershell
$env:WS_PORT="8099"; $env:CLAUDEX_DATA_DIR="$env:TEMP\claudex-smoke"
Start-Process node -ArgumentList 'dist/index.js','app' -NoNewWindow
Start-Sleep 4
npm run ui:check -- http://127.0.0.1:8099
```

**Preview / usage (live):**
```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8080/api/usage
Invoke-RestMethod -Uri http://127.0.0.1:8080/api/preview -Method Post -ContentType 'application/json' -Body '{"text":"implementar oauth"}'
```

**Estrutura de diretórios pretendida (front-end):**
```
src/chat/
├── components/     commandPalette, toast, confirm, previewModal (+ statusBadge, agentCard, ...)
├── views/          sidebar, home, workspace, inspector, missionCenter, modals, placeholder
├── lib/            dom, i18n, api, store, socket
├── app.js          entry (boot, render loop, atalhos, resizers)
├── index.html
└── style.css
```

**Referências de código importantes:**
- `src/application/missionService.ts` — execução da missão, `MissionChannel`, `record`, `planSchema`.
- `src/application/missionPreview.ts` — `buildPreview`.
- `src/app/chat.ts` — `ChatService` (adaptador; `send`, `preview`, `missionEvents`).
- `src/server/appServer.ts` — rotas HTTP + WS.
- `src/orchestrator.ts` — `requestCorrection` (padrão para auto-correção) e fleet paralela.
- `src/chat/views/missionCenter.js` — onde entra a UI de verificação/review.
