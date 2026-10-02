> Documento histórico da versão anterior. O fluxo atual está descrito em README.pt-BR.md e SPEC-simplification.md.

# Fase 6 — GitHub, CI e Browser QA

Integração GitHub/PR/CI e Browser QA na branch `codex/phase6-devops`, baseada na fase 5. A escolha foi resolvida com Playwright para Google Chrome ou Microsoft Edge, conforme a preferência do usuário. `playwright-core` é dependência de runtime; não baixa navegadores. Usa os navegadores instalados, sem perfil pessoal ou login do usuário. Sem alteração de versão ou release. O smoke da interface do Claudex continua usando Electron.

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

## Validação

- Suíte completa após Browser QA: 79 testes em 21 arquivos, com `npm test -- --maxWorkers=2 --minWorkers=1 --testTimeout=15000`; dois testes adicionais de contratos HTTP passaram em execução direcionada. Total atual: 81 testes em 22 arquivos.
- Build/typecheck, lint sem avisos, sintaxe frontend, smoke da interface e dez cenários reais de Chrome/Edge passaram; nenhuma requisição chegou à origem bloqueada.

Testes do adaptador simulam GitHub na fronteira de processos. Cobrem URLs de remote, credenciais embutidas, reuso de PR, fork diferente, corpo com quebras de linha, autenticação, push recusado, resposta incerta de criação, CI pendente/falho/ignorado/ausente/indisponível, links inseguros e mudança de commit durante consulta. Integração com Git e EventStore cobre worktree revisado, snapshot persistido, bloqueio manual, aprovação assistida, projeto ocupado e erro 409 após alterações.

O smoke `scripts/phase6-ui-check.mjs` carrega os assets reais em Electron oculto com API GitHub simulada: prévia, edição de título/descrição, publicação, CI, mismatch de commit, login ausente, escaping, modo manual, PT/EN, claro/escuro e larguras 320/768/1440. Capturas em `.claudex/qa/phase6/`. Nenhum PR externo foi criado nesses testes.

A validação autenticada foi concluída após autorização explícita do usuário para publicar no repositório público. O adaptador real publicou o commit `3aa7f1d`, abriu a [PR #1 em rascunho](https://github.com/DiegoHerreraDaSilva/claudex/pull/1), confirmou que o HEAD corresponde ao enviado e reaproveitou a mesma PR em uma segunda chamada. Depois retornou CI `passed` e `headMatchesReview: true`. O [CI do commit de implementação](https://github.com/DiegoHerreraDaSilva/claudex/actions/runs/36745165224) passou no GitHub, incluindo 81 testes em 22 arquivos. Essa validação externa usou o adaptador; as regras da missão/API foram verificadas separadamente com fixtures Git/EventStore.

A PR reúne as fases 3–6 desde a base `4e83c40` em `main`. O remote `origin` foi configurado para `https://github.com/DiegoHerreraDaSilva/claudex.git`. Não houve merge, release ou alteração de versão. A alteração anterior dos dois campos de versão em `package-lock.json` permanece somente no working tree e não foi publicada. A fase 6 está concluída no escopo descrito neste documento.

## Browser QA

No Mission Center, **testar no navegador** abre um formulário com URL local e seleção Google Chrome/Microsoft Edge. O usuário inicia o servidor da aplicação da missão pelo terminal; esta ferramenta não inicia servidores automaticamente. Aceita apenas HTTP(S) em `localhost`, `127.0.0.1` ou `[::1]`, sem credenciais na URL.

É uma verificação de carregamento: abre uma página em perfil isolado com viewport 1440×900, aguarda o carregamento e uma janela de observação de um segundo, registra erros de console/JavaScript, requisições falhas, HTTP ≥400, página vazia e diálogos inesperados. Captura a viewport em PNG. Não verifica cliques, fluxos completos, acessibilidade, responsividade ou erros que surjam após a janela de observação. Ver [navegadores Chrome/Edge suportados pelo Playwright](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge).

Requisições HTTP e WebSocket ficam limitadas à origem escolhida; recursos inline data/blob são permitidos. Service workers e downloads são bloqueados. Redirecionamentos HTTP são bloqueados antes de segui-los, mesmo locais: informe a URL final da aplicação. Recursos de CDN/outra porta produzem falha explícita, sem autorização automática de acesso externo. Popups são fechados. Há limite de 80 mensagens de 1.500 caracteres, timeout de lançamento de 15 segundos e prazo de execução de 30 segundos depois do lançamento. O navegador sempre é fechado ao concluir.

Manual bloqueia o teste; assistido/autônomo permitem a ação `tests` para esta verificação local isolada. A operação mantém o bloqueio do projeto. Exige missão pronta ou com falha, worktree gerenciado limpo, branch correspondente e HEAD igual ao informado. Repete essas validações após autorização e após o teste; mudanças invalidam o resultado. URL e página são informadas pelo usuário: o resultado não prova que o servidor foi iniciado com o código daquele worktree.

Eventos `browser:checked` persistem uma verificação `browser`, com commit, duração, saída e URL da captura. Uma repetição substitui o resultado anterior; uma nova execução da missão limpa as verificações. O estado do ciclo de implementação permanece separado desse check posterior. Aplicar alterações e preparar/publicar PR ficam bloqueados quando alguma verificação falha ou está em andamento. Uma repetição bem-sucedida libera esse bloqueio, desde que as demais verificações e a revisão continuem aprovadas.

- `POST /api/missions/:id/browser-qa`: `{ url, channel: "chrome" | "msedge", expectedHead }`; retorna a verificação. Falta de navegador/servidor vira resultado falho, não sucesso ou skip.
- `GET /api/missions/:id/browser-qa/:runId/screenshot`: PNG do resultado atual daquela missão; 404 para resultado antigo, inexistente ou identificador inválido. Origem/host loopback seguem a proteção das demais rotas.
- Capturas persistem em `<dataDir>/browser-qa/<runId>/page.png`, fora do worktree. Não há exclusão automática das capturas antigas nesta entrega.

Testes específicos cobrem URLs, isolamento, bloqueio manual, commit divergente, worktree sujo, mudança durante o teste, persistência/substituição e erro de navegador. `scripts/browser-qa-check.mjs` usa Chrome e Edge reais contra fixtures locais, cobrindo página válida, JavaScript com erro, HTTP 500, recurso de outra origem e redirecionamento; confirma que a origem bloqueada não recebe requisição. Relatório e capturas em `.claudex/qa/browser/`. O smoke da interface também cobre o formulário, envio do commit, seleção do Edge, captura, escaping e bloqueio manual.
