> Documento histórico da versão anterior. O fluxo atual está descrito em README.pt-BR.md e SPEC-simplification.md.

# Fase 3 — Verificação e revisão de missões

Implementada em 30/09/2026. O fluxo do app agora passa por implementação → verificação → revisão → pronto para aplicar.

## Comportamento

Depois de implementar, o Claudex registra o diff e executa os checks disponíveis no worktree:

| Check | Detecção / execução |
| --- | --- |
| Tipos | `npm run typecheck`; sem esse script, usa o TypeScript já instalado no worktree quando há `tsconfig.json` |
| Build | `npm run build` |
| Testes | `npm run test`; reconhece a contagem de testes aprovados nas saídas de Vitest/Jest |
| Lint | `npm run lint` |
| Segurança | `npm audit --json` quando existe um lockfile npm |

Scripts ausentes e stacks não suportadas aparecem como **não executados**. Dependências não são instaladas pelo verificador. Um `package.json` inválido aparece como falha. A auditoria de segurança indisponível, inclusive por rede ou timeout, aparece como não executada; vulnerabilidades relatadas aparecem como falha.

A saída capturada é limitada a 512 KB por comando. Os checks usam o timeout de agente configurado; a auditoria tem limite de 60 segundos. Interromper uma missão encerra o processo e seus descendentes e fecha o check corrente como cancelado/não executado.

O diff é recalculado depois dos checks para incluir alterações que eles tenham produzido. Claude Opus revisa o diff contra a tarefa/plano com ferramentas de leitura e resposta JSON validada. O parecer é combinado com Jev quando a decisão Jev está disponível. A indisponibilidade do Jev mantém a revisão Claude; a indisponibilidade ou resposta inválida do Claude **não aprova** a missão.

Se checks ou revisão reprovarem, o implementador recebe os diagnósticos e faz **uma tentativa automática de correção**, mantendo sua sessão. O pipeline inteiro é repetido. Uma falha persistente deixa as alterações no worktree e bloqueia Aplicar. O botão **corrigir automaticamente** inicia outra mensagem na mesma conversa, com a tarefa original e os diagnósticos, repetindo o pipeline.

## Interface

O Mission Center mostra:

- Etapa real da missão e execuções de agentes, incluindo revisão e correção.
- Checks com status, duração e saída expansível.
- Achados de revisão com severidade e arquivo/linha quando disponíveis.
- Resultado com arquivos, linhas adicionadas/removidas, testes, checks não executados, custo estimado e duração.
- Revisar alterações / Aplicar / Descartar. Aplicar só fica disponível para uma missão pronta.

O painel de diff também pode ser aberto em telas menores. Os novos controles e estados têm traduções PT/EN e usam os tokens existentes.

## Persistência e API

`missions/<conversationId>/events.jsonl` continua sendo o log de eventos. Uma projeção atômica em `mission.json` mantém o resultado do último turno, com revisão, checks, execuções de agentes, uso/custo, arquivos e hash do commit revisado. O log histórico é preservado; os resultados da missão são reiniciados a cada nova mensagem.

`GET /api/missions/:id/summary` retorna `MissionSummary`; retorna 404 para uma missão inexistente. IDs são resolvidos pelas conversas cadastradas antes do acesso ao armazenamento. Os resumos também são transmitidos por WS como `mission:summary`, com uma revisão incremental para evitar sobrescrita por respostas HTTP antigas.

Aplicar exige resultado aprovado nas conversas novas e verifica se a branch ainda aponta para o commit revisado. Conversas anteriores à fase 3 mantêm o comportamento legado até uma nova execução. `Conversation.validationRequired` é um campo opcional, sem mudança do schema existente.

## Organização

- `infrastructure/process.ts`: execução, cancelamento e saída limitada.
- `application/verificationService.ts`: detecção de checks e resultados.
- `application/reviewService.ts`: revisão estruturada e combinação Claude/Jev.
- `application/missionValidation.ts`: ciclo de validação e correção limitada.
- `domain/missionSummary.ts`: contrato e projeção dos eventos.
- `infrastructure/persistence/eventStore.ts`: persistência serializada do log e da projeção.
- `chat/components/missionResults.js`: checks, revisão e resultado da missão.

## Validação

`npm run build`, `npm run lint` e `npm test` verificam a base. No Windows, é possível limitar a concorrência da suíte com `npm test -- --maxWorkers=4 --minWorkers=1`.

`node node_modules/electron/cli.js scripts/phase3-ui-check.mjs` executa um teste visual com fixtures locais, sem agentes reais. Verifica aprovação/reprovação, bloqueio de Aplicar, checks, temas, PT/EN, larguras 320/768/1024/1440, diff em tela pequena, escape de texto e o envio da correção. Salva capturas em `.claudex/qa/phase3/`.

O smoke existente também foi executado contra o servidor real: passou sem erros de console, com o aviso de CSP preexistente do Electron em desenvolvimento. O teste visual com fixtures não apresentou avisos.

Os testes de integração usam Git, worktrees, HTTP e merge reais em diretórios temporários; os agentes são simulados. Chamadas aos provedores reais não fazem parte dessa validação automatizada.

Referências: [execução de processos no Node.js](https://nodejs.org/api/child_process.html) e [auditoria npm](https://docs.npmjs.com/cli/v10/commands/npm-audit/).

## Próxima etapa

Fase 4: inteligência de repositório, busca, memória de projeto, terminal, checkpoints, Git workspace e histórico. A CLI ainda usa o orquestrador legado; a unificação continua pendente.
