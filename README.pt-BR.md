# Claudex

**Orquestrador desktop local-first que roteia suas tarefas de código entre Claude Code, Codex e a API de decisão Jev (TypeSafe) — com uma interface de chat.**

Você descreve a tarefa em linguagem natural. O Claudex pergunta ao Jev (um modelo de decisão rápido) como o trabalho deve ser tratado, encaminha para o agente certo, executa dentro de um *git worktree* isolado da **sua** pasta, mostra o diff e deixa você **Aplicar** ou **Descartar**. Tudo roda na sua máquina, com **suas contas e chaves de API**.

🌐 [English](README.md) · **Português (BR)**

---

## Como o roteamento funciona

```
                 ┌──────────────┐
                 │    INPUT     │  sua mensagem no chat
                 └──────┬───────┘
                        ▼
                 ┌──────────────┐
                 │     JEV      │  modelo de decisão da TypeSafe (ou heurística local)
                 └──────┬───────┘
              simples implementação │ precisa planejar algo
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
             ┌────────────┐                  ┌────────────┐
             │   SONNET   │                  │    OPUS    │  (planeja primeiro)
             └────────────┘                  └─────┬──────┘
                                          feature complexa │ feature mais simples
                                        ┌──────────────────┴──────────────────┐
                                        ▼                                     ▼
                                 ┌────────────┐                        ┌────────────┐
                                 │   SOL 6    │                        │   SONNET   │
                                 │ (Codex)    │                        └────────────┘
                                 └────────────┘
```

- **Implementação simples** → Claude **Sonnet** implementa direto.
- **Precisa planejar** → Claude **Opus** escreve um plano e decide se é **feature complexa** (→ Codex **Sol 6**) ou **mais simples** (→ **Sonnet**).

Se a API da TypeSafe estiver indisponível (sem chave, `429`/`529`/`5xx`), o Claudex usa um roteador heurístico local — o fluxo nunca trava.

---

## Recursos

- **App desktop** (Electron) com **seletor nativo de pasta**, além do modo navegador.
- **Projetos**: registre qualquer pasta que seja repositório git; cada projeto tem sua própria conversa contínua.
- **Sessões contínuas**: respostas seguintes retomam o mesmo `session_id` (Claude) ou `thread_id` (Codex).
- **Worktrees git isolados** — os agentes não tocam sua árvore de trabalho.
- **Revisão manual**: barra **Aplicar** / **Descartar** com o diff do que foi alterado.
- **Contas e chaves na interface**: conectar/desconectar Claude e Codex, colar chaves de API, ver conta/plano.
- **Local-first e privado**: sem telemetria; credenciais e chaves ficam na sua máquina.
- **CLI + dashboard** para execuções não interativas.
- **Tema claro/escuro** e **interface PT/EN**.

---

## Requisitos

- **Node.js 22+** e **git** no `PATH`
- Assinatura **Claude Pro/Max** *ou* `ANTHROPIC_API_KEY`
- Assinatura **ChatGPT Plus/Pro** *ou* `OPENAI_API_KEY` (para o caminho Codex)
- Chave da **TypeSafe (Jev)** — opcional; sem ela, usa o roteador heurístico local
  (obtenha em https://console.typesafe.ai/keys)

O Claudex usa os **SDKs oficiais** para autenticação — nunca extrai tokens OAuth para uso em ferramentas de terceiros:

- Claude: `@anthropic-ai/claude-agent-sdk` (lê `~/.claude/.credentials.json`)
- Codex: `@openai/codex-sdk` (lê `~/.codex/auth.json`)

---

## Instalação (a partir do código)

```bash
git clone https://github.com/DiegoHerreraDaSilva/claudex.git
cd claudex
npm install
npm run build
```

> A pasta escolhida precisa ser um repositório git. Se ainda não for:
> ```bash
> cd /caminho/do/seu/projeto
> git init && git commit --allow-empty -m "init"
> ```

---

## Executar

**App desktop (janela Electron):**

```bash
npm run app
```

**Modo navegador (mesmo backend, servido localmente):**

```bash
npm run app:web
# abra http://localhost:8080
```

No Windows você pode criar um atalho na Área de Trabalho apontando para `npm run app`.

---

## Conectar suas contas e chaves

No app, clique em **configurações** e use os botões conectar/desconectar ou os campos de chave. O que você salvar vai para o `.env` da sua máquina (que está no `.gitignore`).

| Provedor | Conectar com assinatura | Ou usar chave de API |
| --- | --- | --- |
| **Claude** | **Conectar** roda `claude auth login` (abre o navegador para entrar com Claude Pro/Max) | cole `ANTHROPIC_API_KEY` |
| **Codex** | **Conectar** roda `codex login` → *Sign in with ChatGPT* | cole `OPENAI_API_KEY` |
| **Jev / TypeSafe** | — | cole `TYPESAFE_API_KEY` (https://console.typesafe.ai/keys) |

**Desconectar** roda o logout correspondente (`claude auth logout` / `codex logout`) e remove as credenciais salvas.

> **Importante:** se `ANTHROPIC_API_KEY` estiver definida, o SDK da Anthropic a usa e **ignora sua assinatura** (billing por token). Remova-a para usar Pro/Max. O app avisa quando ela existe. O mesmo vale para `OPENAI_API_KEY` vs. o login ChatGPT.

Você também pode configurar tudo pela CLI, copiando `.env.example` para `.env`.

---

## Usando o app

1. **Novo projeto** → **escolher pasta** (seletor nativo no desktop; navegador de pastas embutido no modo web). Pastas que são repositórios git aparecem marcadas com `git`.
2. Descreva a tarefa e **enviar**. Você verá a decisão do Jev (ex.: `precisa planejar → claude:opus`, depois `feature complexa → gpt-6-sol`), o plano e as ferramentas do agente ao vivo.
3. Revise o **diff** à direita. **Aplicar** faz o merge da branch do projeto na sua branch; **Descartar** joga fora as alterações.

### Retomar sessões

- Execuções do Claude retornam um `session_id` → retomado na sua próxima mensagem no mesmo projeto.
- Execuções do Codex retornam um `thread_id` → retomado do mesmo jeito.
- Os identificadores aparecem na aba **sessão**.

---

## Configuração (`.env`)

```dotenv
# As credenciais das assinaturas são lidas pelos SDKs:
#   Claude: ~/.claude/.credentials.json  (criado por `claude auth login`)
#   Codex:  ~/.codex/auth.json           (criado por `codex login`)
# NÃO defina ANTHROPIC_API_KEY se quiser usar a assinatura Claude.

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

```bash
claudex run "<descrição>"   # fluxo completo: roteia, executa em worktrees, revisa, faz merge
claudex app                 # servidor do app de chat (modo navegador)
claudex dashboard           # dashboard de frota WS + HTTP (funciona ocioso)
claudex status              # imprime o snapshot da frota
claudex worktrees           # lista worktrees ativos
claudex clean               # remove worktrees e branches órfãs
```

Opções de `run`: `--subtasks <json>`, `--cleanup`, `--dry-run`, `--no-server`.

Testes de fumaça: `npm run smoke:jev`, `npm run smoke:worktree`, `SMOKE_AGENTS=1 npm run smoke:agents`.

---

## Segurança e privacidade

- Tudo roda **localmente**. Nada é enviado a lugar algum além dos provedores de modelo e da TypeSafe, usando *suas* credenciais.
- `.env`, `~/.claude/` e `~/.codex/` **nunca** são commitados; o `.env` está no `.gitignore`.
- Os agentes rodam em **worktrees git isolados**; mudanças só chegam à sua branch quando você clica em **Aplicar**.

---

## Licença

[MIT](LICENSE) © Diego Herrera
