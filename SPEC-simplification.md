# Claudex: sessões diretas em pastas

Esta base é complementada por [SPEC-collaboration.md](SPEC-collaboration.md): uma equipe coordenada pode executar vários agentes na mesma pasta, com memória compartilhada e modelos configuráveis.

## Objetivo e contrato

Substituir o produto baseado em missões por uma tela de pedidos e sessões. O desenho enviado é a referência: pedido no topo, projetos à esquerda, abas de sessões e atividade no centro.

Cada projeto mantém uma sessão por modelo. Cada envio retoma o contexto da sessão escolhida por Jev; uma sessão só é criada no primeiro uso daquele modelo no projeto. Os identificadores dos SDKs são persistidos para retomar após reiniciar o aplicativo, inclusive quando a execução anterior falhou ou foi interrompida depois de criar o contexto. Jev classifica o pedido e escolhe Sonnet para mudanças simples, Codex para implementação complexa ou Opus para raciocínio arquitetural. Sem Jev disponível, a heurística existente escolhe e a interface informa isso. O modelo escolhido executa o pedido inteiro diretamente na pasta selecionada, sem Git, worktree, branch, revisão, aplicação, tarefa ou agendamento.

Pastas são validadas como diretórios existentes e normalizadas com realpath. Uma execução por pasta, inclusive aliases e pastas sobrepostas; projetos diferentes podem executar em paralelo. Parar cancela o agente, sem desfazer arquivos já editados. Cada sessão guarda pedido, modelo, status e atividade; reiniciar o app marca execuções antigas como interrompidas, sem relançar.

## Módulos e ordem

1. `sessions`: projetos, persistência, roteamento, execução e cancelamento; depende apenas dos SDKs, configuração e Jev.
2. `server`: HTTP local e WebSocket com validação de host/origem, entrada limitada e erros consistentes; depende de sessions.
3. `workspace`: interface em HTML/CSS/JS, seletor de pastas e configurações de contas; depende de server.

Os SDKs oficiais, contas e modelos existentes continuam. Atividade mostra mensagens públicas e uso de ferramentas fornecidos pelos SDKs. Histórico antigo fica preservado no disco; somente os registros de pastas são importados para o novo armazenamento.

## API

Atualização: as sessões abertas recebem os nomes Planner/Simple/Complex + modelo. DELETE /api/sessions/:id fecha a sessão, cancela sua equipe se necessário e preserva histórico e memória do projeto; novas escolhas daquele modelo criam outra sessão. POST /api/sessions/:id/compact gera um resumo pelo modelo atual em modo somente leitura, sem delegação. Só após sucesso o identificador do provedor é substituído por continuidade via resumo; a aba, histórico e memória são mantidos. Falhas preservam contexto anterior. Ocupação e limite vêm do SDK quando disponíveis, com estimativas explicitamente identificadas; consumo acumulado não é ocupação. Divisórias ajustam input/chat e projetos/chat, com tamanhos persistidos localmente.

GET /api/projects lista projetos e sessões resumidas; POST adiciona { rootPath, name? }; DELETE /api/projects/:id remove o registro, sem excluir arquivos, e recusa projetos em execução.
POST /api/projects/:id/sessions recebe { text }, aguarda a escolha de Jev, responde 202 com a sessão existente ou recém-criada e inicia execução; GET /api/projects inclui o roteamento pendente com identificador cancelável; GET /api/sessions/:id retorna atividade; POST /api/sessions/:id/stop cancela.
GET /api/credentials e POST /api/settings mantêm configuração; POST /api/accounts gerencia login/logout. GET /api/fs/list fornece navegação de pastas no modo web. WebSocket só transmite atualizações, sem comandos.

## Implementação e estilo

Electron, TypeScript strict, SDKs existentes, Zod nas entradas. Serviços em src/application, HTTP em src/server, interface em src/chat. Sem dependências novas. Exemplo: `const folder = await realpath(input.rootPath);`.

## Verificação

`npm run typecheck`, `npm run lint`, `npm run build`, `npm test -- --maxWorkers=2 --minWorkers=1`. Testes com diretórios temporários sem .git e agentes simulados na fronteira do SDK: roteamento, reutilização de contexto por modelo e projeto, escrita direta, concorrência, cancelamento, reinício e contratos HTTP. Smoke real de navegador: seleção de pasta, envio, abas, persistência do texto, erros, cancelamento, configurações e larguras 320/768/1440.

## Limites

Não publicar, fazer merge nem criar release nesta alteração. Preservar dados antigos. Remover os fluxos e testes exclusivos das funcionalidades aposentadas. Testes dos SDKs e roteamento serão mantidos/adaptados ao novo contrato. Edição direta é autorizada pelo pedido do usuário e ocorre sem botão Aplicar.
