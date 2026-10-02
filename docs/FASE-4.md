> Documento histórico da versão anterior. O fluxo atual está descrito em README.pt-BR.md e SPEC-simplification.md.

# Fase 4 — Inteligência do projeto

Entrega local em 30/09/2026, na branch `codex/phase4-intelligence`, baseada na fase 3. Sem alteração de versão ou dependências.

## Comportamento

- **Inteligência:** dependências do `package.json`, pontos de entrada, lista de arquivos e grafo de imports locais TS/JS. A busca por texto e símbolos retorna arquivo, linha, trecho e relevância léxica. A pontuação descreve correspondência textual, sem gerar uma resposta de IA.
- **Memória:** adicionar, editar e excluir arquitetura, decisões e convenções por projeto. Dados persistidos em `memory/<projectId>.json`, com gravação atômica e fila por projeto. Os prompts de planner, implementer e correção recebem um snapshot da memória; o evento `context:loaded` permite inspecionar os itens efetivamente incluídos.
- **Contexto:** pasta, branch, memória carregada e checkpoints da missão. Memórias editadas durante uma execução entram na próxima execução.
- **Terminal:** execução no projeto ou no worktree da conversa, com stdout/stderr por WebSocket, cancelamento da árvore de processos, limite de dois minutos e 256 KB. Usa PowerShell no Windows e `/bin/sh` nos demais sistemas. A interface mostra os comandos como texto, inclusive caracteres HTML.
- **Checkpoints:** commit e arquivo `checkpoints/<missionId>/<n>.json` após cada execução concluída de agente, incluindo planner e reviewer. Runs sem alterações podem gerar checkpoints com o mesmo commit. A restauração verifica a pasta gerenciada, o repositório Git compartilhado, a branch e a propriedade do checkpoint; reseta somente o worktree da missão, limpa arquivos não rastreados e encerra as sessões retomáveis dos agentes.
- **Git e histórico:** branches, worktrees, alterações no projeto e conversas com último estado da missão, duração e custo acumulado estimado.

Restauração, terminal, Apply, Discard e remoção usam um bloqueio por projeto. Missões não começam durante essas operações; operações não começam enquanto houver uma missão rodando no projeto. Alterações no worktree após a revisão impedem Apply. Se um comando do terminal muda uma missão pronta, sua aprovação é invalidada. Restaurar um checkpoint sempre exige nova execução, verificação e revisão; mudanças já aplicadas ao projeto original permanecem no projeto original.

## API

| Método | Rota | Conteúdo |
| --- | --- | --- |
| GET | `/api/projects/:id/intelligence` | arquivos, símbolos, dependências, entry points, grafo, indicador de limite |
| POST | `/api/repo/ask` | `{ projectId, query }`; até 40 trechos classificados |
| GET / POST | `/api/projects/:id/memory` | listar / adicionar `{ kind, text }` |
| PUT / DELETE | `/api/projects/:id/memory/:entryId` | editar `{ kind, text }` / excluir |
| GET | `/api/projects/:id/git` | branches, worktrees e status |
| GET | `/api/projects/:id/missions` | histórico das conversas |
| POST | `/api/projects/:id/terminal` | `{ command, conversationId? }`; resposta com resultado final |
| POST | `/api/projects/:id/terminal/stop` | cancelar o comando ativo |
| GET | `/api/missions/:id/checkpoints` | checkpoints persistidos |
| POST | `/api/missions/:id/restore` | `{ checkpointId }`; exige worktree ocioso |

WebSocket: `terminal:out { projectId, runId, stream, text?, result? }`. Memória e checkpoints também aparecem nos eventos da missão. Novas rotas validam projetos e conversas registrados, corpos JSON e origem HTTP; um corpo aceita no máximo 32 KB.

## Limites e decisões

O índice respeita o gitignore via `git ls-files`, exclui dependências, saídas de build, arquivos de credenciais conhecidos, arquivos binários e links externos. Limites: 2.000 arquivos de texto, 256 KB por arquivo e 8 MB por leitura. Em pastas sem Git, o walk também limita profundidade e diretórios. Esses filtros não substituem um detector universal de segredos.

O mapa usa parsing léxico de imports relativos; aliases, resolução por configuração e imports dinâmicos podem ficar incompletos. O SVG mostra até 36 módulos; a API contém o grafo do índice inteiro. Não foram adicionados embeddings nem execução de cobertura de testes.

Até 100 memórias por projeto e 4.000 caracteres por entrada. O prompt recebe até 16.000 caracteres em entradas completas. O evento inclui a quantidade omitida quando esse limite é atingido.

O serviço de terminal já recusa modo `manual`. A aplicação mantém o padrão atual `autonomous`; persistência, seletor de autonomia e permission broker pertencem à fase 5. Os comandos executam com as permissões do usuário.

O histórico usa uma conversa como identidade de missão e apresenta o último turno; os turnos anteriores permanecem no log de eventos e no chat. O custo é acumulado por conversa e estimado.

## Verificação

- `npm run typecheck`, `npm run build`, `npm run lint` e suíte Vitest.
- Testes de imports, símbolos, busca, exclusões, links externos, limites, memória concorrente e prompt limitado.
- Terminal com processo real: streaming, cancelamento, exclusão mútua e gate `manual`.
- Integração com Git/HTTP/WebSocket: checkpoints persistidos, memória no prompt, API de inteligência/Git/histórico, bloqueio de origem externa, terminal e restauração; agentes substituídos por fixtures, sem chamadas pagas.
- `node node_modules/electron/cli.js scripts/phase4-ui-check.mjs`: interface real em Electron oculto, PT/EN, dark/light, larguras 320/768/1024/1440, busca, memória, Git, histórico, checkpoints e terminal. Capturas em `.claudex/qa/phase4/`.
- O smoke anterior `scripts/phase3-ui-check.mjs` continua disponível, com fixtures das novas rotas.

Próxima etapa: fase 5 — persistir autonomia por conversa e substituir permissões fixas por um permission broker efetivo.
