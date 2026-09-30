# Fase 6 — GitHub e CI

Entrega local da integração GitHub/PR/CI na branch `codex/phase6-devops`, baseada na fase 5. Sem alteração de versão, release ou dependências. Browser QA como ferramenta para as aplicações das missões permanece pendente da escolha entre Electron oculto e Playwright, conforme a seção 6.2 do plano. O smoke da interface do Claudex usa a infraestrutura Electron já existente.

## Fluxo de PR

No Mission Center, uma missão pronta exibe **preparar PR**. A prévia informa repositório, branch, base e hash revisado, com título/descrição editáveis e opção de rascunho habilitada por padrão. **Publicar branch e abrir PR** envia exatamente esse commit ao GitHub.

O backend exige status ready, revisão aprovada, ausência de verificações falhas/em andamento, alterações na missão, worktree gerenciado, branch e base correspondentes à projeção e HEAD igual ao revisado. Alterações pendentes ou uma prévia de outro commit retornam 409. A publicação repete essa validação após uma eventual aprovação no modo assistido.

Manual bloqueia publicação e consulta externa de CI. Assistido pede aprovação pontual para cada ação de rede. Autônomo permite a ação. A operação mantém o bloqueio do projeto enquanto aguarda decisão ou executa o CLI, impedindo troca de modo, remoção e execução concorrente de outra missão. Cancelamento de pedidos pendentes por resolução negativa e timeout segue o broker da fase 5; publicação iniciada não oferece cancelamento pela interface.

O adaptador usa `gh` e processos sem shell para argumentos de usuário. Título e descrição nunca entram em uma linha de shell; a descrição é gravada em um diretório temporário e passada por `--body-file`, preservando quebras de linha. O diretório é removido ao concluir. Ver [criação de PR no CLI](https://cli.github.com/manual/gh_pr_create).

A publicação usa HTTPS para o repositório GitHub identificado e o helper `gh auth git-credential` somente nessa invocação Git, sem alterar configuração global. O refspec aponta para o hash revisado. Não usa force push. Remotes de leitura e push precisam identificar o mesmo repositório. Esta entrega aceita `github.com` via HTTPS ou SSH, sem credenciais embutidas na URL; GitHub Enterprise e PRs entre forks não estão implementados.

Antes de criar, consulta PR aberto da mesma branch/base e do mesmo repositório. Um PR existente é reutilizado; publicar um commit novo atualiza sua branch, preservando título e descrição do PR existente. A interface informa esse comportamento. Respostas incertas de criação provocam nova consulta; a próxima tentativa também consulta antes de criar. Falhas de autenticação não publicam a branch. Uma publicação pode concluir o push e falhar ao abrir o PR, por exemplo se a base não existir no GitHub; tentar novamente reaproveita o commit já enviado.

Eventos `github:publishing`, `github:pull-request`, `github:checks` e `github:failed` passam pelo registro de MissionService. PR/repositório/checks aparecem na projeção persistida. Uma nova execução mantém a associação ao PR e limpa o snapshot antigo do CI.

## CI

**Consultar CI** chama `gh pr checks --json`, sem iniciar um polling permanente. Os estados são passou, falhou, pendente, ignorado ou sem checks. Checks cancelados contam como falha; um conjunto inteiramente ignorado não é apresentado como aprovado. Falha de consulta mostra erro e não cria um resultado verde. A interface indica a data da consulta e compara o commit remoto com o revisado. O adaptador lê o HEAD do PR antes e depois dos checks; mudança durante a consulta exige nova consulta.

Nomes e metadados retornados pelo CLI são tratados como dados. JSON é validado com Zod; links aceitam HTTPS sem credenciais e o URL do PR deve apontar para o repositório esperado. Ver [checks e código de saída 8 para pendências](https://cli.github.com/manual/gh_pr_checks).

## API

| Método | Rota                           | Contrato                                                                        |
| ------ | ------------------------------ | ------------------------------------------------------------------------------- |
| GET    | `/api/missions/:id/pr/preview` | `{ repo, branch, baseBranch, expectedHead, title, body, draft, authenticated }` |
| POST   | `/api/missions/:id/pr`         | `{ expectedHead, title, body, draft }`; PR confirmado ou reutilizado            |
| GET    | `/api/missions/:id/checks`     | `{ pullRequest, checks, status, headMatchesReview, checkedAt }`                 |

Corpos JSON limitados a 32 KB; título até 120 caracteres e descrição até 20.000. Rotas verificam host loopback e origem. Erros do adaptador incluem `code` e `error`, com 403 para política, 404 para missão/PR inexistente, 409 para conflito de estado, 503 para falta de autenticação e 502 para falha de integração. Erros de validação de corpo retornam 400.

A prévia é local: consulta os remotes Git e o estado de autenticação do CLI, sem publicar ou consultar PRs no GitHub. A falta de login desabilita a publicação e explica como preparar novamente após autenticar.

## Validação e pendências

- Build/typecheck, lint sem avisos e sintaxe dos módulos frontend passaram.
- Suíte completa: 71 testes em 19 arquivos, com `npm test -- --maxWorkers=2 --minWorkers=1 --testTimeout=15000`.
- Após a revisão final da validação de JSON, nove testes direcionados do adaptador e da projeção passaram.

Testes do adaptador simulam GitHub na fronteira de processos. Cobrem URLs de remote, credenciais embutidas, reuso de PR, fork diferente, corpo com quebras de linha, autenticação, push recusado, resposta incerta de criação, CI pendente/falho/ignorado/ausente/indisponível, links inseguros e mudança de commit durante consulta. Integração com Git e EventStore cobre worktree revisado, snapshot persistido, bloqueio manual, aprovação assistida, projeto ocupado e erro 409 após alterações.

O smoke `scripts/phase6-ui-check.mjs` carrega os assets reais em Electron oculto com API GitHub simulada: prévia, edição de título/descrição, publicação, CI, mismatch de commit, login ausente, escaping, modo manual, PT/EN, claro/escuro e larguras 320/768/1440. Capturas em `.claudex/qa/phase6/`. Nenhum PR externo foi criado nesses testes.

Na máquina de desenvolvimento, `gh auth status` retornou **sem login**, inclusive fora do ambiente restrito. A validação com um PR real e CI remoto fica pendente de `gh auth login`. O aplicativo já apresenta essa condição na prévia. A pipeline existente continua fazendo typecheck, lint, build e testes no GitHub Actions.

A fase 6 ainda não é marcada como concluída: falta a decisão e a implementação do Browser QA para aplicações das missões, além da validação autenticada com GitHub real.
