# Fase 5 — Autonomia

Entrega local em 30/09/2026 na branch `codex/phase5-autonomy`, baseada na fase 4. Sem novas dependências ou alteração de versão.

## Modos por conversa

| Modo      | Comportamento                                                                                                                                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual    | Claude Sonnet analisa com Read/Glob/Grep. Não cria worktree, commit, checkpoint ou execução de verificação. A missão termina como `analysed`, sem habilitar Apply. Terminal, Apply, Discard e Restore ficam bloqueados. |
| Assistido | Edição dentro do worktree, testes/build/lint/typecheck e operações Git da missão são permitidos. Instalação, rede, exclusão, acesso externo e comandos não reconhecidos exigem aprovação individual.                    |
| Autônomo  | Mantém o fluxo de implementação, verificação, revisão e aplicação. Ações disponíveis são autorizadas. Missões complexas continuam usando Codex.                                                                         |

O seletor está no Workspace e os três modos estão na paleta de comandos. Settings mostra a matriz. O modo padrão é `autonomous`, inclusive na migração de conversas existentes. A troca exige projeto ocioso, persiste antes de responder e limpa IDs retomáveis de Claude/Codex. Ela não remove alterações já existentes. Excluir uma conversa ou projeto e editar memórias continuam sendo ações explícitas de gerenciamento do usuário, separadas da política de execução do agente.

## Permissões e decisões de SDK

`PermissionBroker` compartilha a política entre MissionService, terminal e Orchestrator legado. Claude recebe ferramentas disponíveis, allowlist/denylist, `settingSources: []`, callback `canUseTool` e hook `PreToolUse`. O hook verifica cada ação antes da autorização do SDK; usar apenas `allowedTools` com bypass não garante essa verificação. Planners e reviewers têm política manual, independentemente da autonomia da implementação. Ver [permissões oficiais do Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/permissions).

O SDK TypeScript Codex instalado fornece sandbox e política de aprovação, mas não expõe callback de aprovação por ação. Os modos restritos usam Claude; implementações complexas assistidas também usam Sonnet após o plano Opus. Para um futuro cliente Codex com aprovação interativa, a integração apropriada é o App Server. Ver [SDK Codex](https://learn.chatgpt.com/docs/codex-sdk) e [App Server](https://learn.chatgpt.com/docs/app-server).

O mapeamento Codex é explícito: manual `read-only`, assistido `workspace-write`, autônomo `danger-full-access`; `approvalPolicy: never`, rede e busca web habilitadas somente no autônomo. A aplicação só envia missões autônomas ao Codex. O autônomo passa a solicitar `danger-full-access`, conforme o plano da fase; antes o wrapper usava `workspace-write`. Isso amplia o acesso solicitado ao SDK nesse modo. O wrapper genérico mantém seu fallback anterior para chamadas sem política explícita.

Comandos compostos, interpretadores, opções de execução e comandos não reconhecidos vão para aprovação no assistido. Alguns comandos literais de leitura e scripts npm/pnpm/yarn de teste/build/lint/typecheck são reconhecidos. A classificação não infere todos os efeitos transitivos: um script de teste pode executar código arbitrário do projeto. A política controla ferramentas e ações solicitadas; não oferece isolamento universal de processos do sistema operacional. Caminhos de ferramentas de arquivo são canonicalizados; acessos externos e a metadados `.git`, `.claude`, `.codex` exigem aprovação no assistido e são negados no manual.

Pedidos têm UUID, prazo de 90 segundos e limite de 16 pendências. Aprovação vale uma vez; repetição cria novo pedido. Negação, timeout ou cancelamento bloqueiam a ação. Nenhuma aprovação é persistida ou reutilizada após reinício. O diálogo usa `dialog` nativo, foco inicial em negar, Escape para negar e comando via texto. A reconexão WebSocket substitui a lista pendente. Eventos `mission:permission` registram pedidos, bloqueios e decisões.

CLI: `claudex run "tarefa" --autonomy manual|assisted|autonomous`. O padrão é autônomo. O legado também usa o broker; no assistido, ações fora da allowlist são negadas, pois o CLI ainda não tem prompt de aprovação. O modo manual não persiste tarefas dentro do repositório.

## API

| Método | Rota                                                       | Corpo / resposta                                       |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------ |
| PUT    | `/api/projects/:id/conversations/:conversationId/autonomy` | `{ mode }`; 409 se ocupado                             |
| GET    | `/api/permissions`                                         | pedidos pendentes                                      |
| POST   | `/api/permissions/:id`                                     | `{ approved: boolean }`; 404 se resolvido ou expirado  |
| POST   | `/api/projects/:id/terminal`                               | `{ command, conversationId?, contextConversationId? }` |

`conversationId` seleciona o worktree e sua política. No escopo projeto, `contextConversationId` seleciona a conversa que fornece a política; sem ele, usa a conversa ativa. Stop cancela também uma aprovação de terminal pendente. As rotas validam host loopback, origem e corpos JSON limitados a 32 KB.

WebSocket: `permissions { data }` na conexão e `permission:notice { notice }` para criação/resolução. O bloqueio de operação por projeto permanece ativo enquanto o terminal aguarda aprovação, impedindo troca de modo ou início de outra missão.

## Migração reversível

Schema 3 adiciona `Conversation.autonomy`. Antes de migrar, o registro grava o conteúdo exato anterior em `projects.schema-<versão>.backup.json`, sem sobrescrever backup existente. Dados inválidos ou schema futuro causam erro em vez de serem silenciosamente substituídos.

Para voltar: encerre o Claudex, preserve separadamente o `projects.json` atual e copie o backup correspondente para `projects.json` no diretório de dados. Execute a versão anterior do aplicativo. Novas conversas e mudanças posteriores à migração não estão no backup.

## Validação

- Build TypeScript, lint sem avisos e sintaxe dos módulos frontend passaram.
- Suíte completa: 63 testes em 18 arquivos com `npm test -- --maxWorkers=2 --minWorkers=1 --testTimeout=15000`.
- Depois da revisão final, nove testes direcionados passaram, incluindo um teste adicional de falha na checagem de permissão. Total de casos definidos na suíte: 64.
- A concorrência menor e o limite de 15 segundos evitam timeouts de I/O observados no Windows; os testes de integração Git mantêm limites próprios de 90/120 segundos.

Testes cobrem matriz, hooks, aprovações individuais, cancelamento/timeout, migração e preservação de dados inválidos, opções reais enviadas aos SDKs e os três modos no legado. Integração com Git/HTTP verifica que análise manual mantém HEAD/status e não cria worktree/checkpoints; terminal assistido exige decisão, não reutiliza aprovação e impede troca de modo durante pendência. Agentes são substituídos por fixtures, sem chamadas pagas.

`node node_modules/electron/cli.js scripts/phase5-ui-check.mjs` verifica a interface real: seletor, paleta, matriz, aprovação/negação, resolução, foco, escaping, PT/EN, temas claro/escuro e larguras 320/768/1440. Capturas em `.claudex/qa/phase5/`.

Próxima etapa prevista: fase 6 — GitHub/PR/CI e Browser QA, com escolha de ferramenta de QA ainda pendente no plano.
