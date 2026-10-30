# Controle de SLA de Pedidos — UNISO

Aplicativo web para acompanhamento operacional de prazos (SLA) de pedidos, com
sincronização em tempo real entre usuários via Firebase (Authentication +
Cloud Firestore). Construído em HTML5, CSS3 e JavaScript puro (sem
frameworks e sem etapa de build).

## Estrutura de arquivos

| Arquivo             | Função                                                              |
|----------------------|----------------------------------------------------------------------|
| `index.html`         | Estrutura da página (dashboard, painel, tabela, histórico, modais)   |
| `styles.css`         | Layout, tema claro/escuro e identidade visual                       |
| `app.js`             | Toda a lógica: cálculo de SLA, CRUD, renderização e eventos          |
| `firebase-config.js` | Inicialização do Firebase (credenciais do projeto)                  |
| `firestore.rules`    | Regras de segurança do Cloud Firestore                              |
| `README.md`          | Este documento                                                      |

## 1. Configuração do Firebase (obrigatória antes do primeiro uso)

O projeto Firebase **"Controle de SLA de Pedidos"** já existe (plano Spark).
Faltam três passos no console (https://console.firebase.google.com):

### 1.1. Criar o app Web e obter as credenciais ✅ Concluído
O app Web já foi cadastrado no projeto e `firebase-config.js` já está
preenchido com as credenciais reais (`apiKey`, `authDomain`, `projectId`,
`storageBucket`, `messagingSenderId`, `appId`).

> A `apiKey` de um app Web do Firebase não é um segredo — ela é enviada ao
> navegador de qualquer visitante por design do próprio Google. A proteção
> real dos dados está nas regras do Firestore (seção 1.3). Como camada
> extra, especialmente se o repositório for público no GitHub, é possível
> restringir essa chave por domínio em **Google Cloud Console → APIs e
> serviços → Credenciais → [selecione a chave] → Restrições de aplicativo
> → Sites da Web**.

### 1.2. Ativar a autenticação anônima
1. Menu **Authentication** → aba **Sign-in method**.
2. Ative o provedor **Anônimo**.
   > Não há tela de login nem cadastro de usuários no app — a autenticação
   > anônima serve apenas para autorizar o acesso ao Firestore, conforme
   > decidido com o solicitante (sem necessidade de perfis de acesso).

### 1.3. Criar o Firestore e publicar as regras
1. Menu **Firestore Database** → **Criar banco de dados** → modo produção.
2. Na aba **Regras**, cole o conteúdo de `firestore.rules` e publique.
   (Ou publique via Firebase CLI: `firebase deploy --only firestore:rules`.)

## 2. Modelo de dados (coleção `pedidos`)

Cada documento representa um pedido:

| Campo                        | Tipo               | Observação                                             |
|-------------------------------|--------------------|---------------------------------------------------------|
| `id` (ID do documento)         | string (auto)      | Identificador único gerado pelo Firestore                |
| `numeroPedido`                 | string             | Número do pedido informado pelo usuário                  |
| `cliente`                      | string             | Nome do cliente                                          |
| `dataPedido`                   | string `yyyy-mm-dd`| Data do pedido                                           |
| `dataRecebimentoEstoque`       | string `yyyy-mm-dd`| Data de recebimento no estoque. Lançada manualmente no cadastro/prévia de importação, ou lida diretamente da coluna "Rec. Estoque" da planilha quando ela existir no arquivo (item 34) — de qualquer forma, continua editável na prévia antes de enviar |
| `slaDias`                      | number             | Prazo de SLA em **dias úteis**                            |
| `dataVencimento`               | string `yyyy-mm-dd`| Calculada automaticamente (recebimento + SLA em dias úteis) |
| `quantidadeItens`              | number             | Quantidade de itens informada no **cadastro do pedido** (obrigatório) — a separação busca os produtos/embalagens com base nela. Até o item 31, este dado ficava no campo `quantidadeCaixas` (ver nota sobre o item 32 abaixo); renomeado para não se confundir com a contagem final de caixas abaixo |
| `quantidadeCaixas`             | number \| `null`   | Quantidade **final de caixas já fechadas**, informada apenas ao **finalizar a Organização** (2ª etapa) — distinta de `quantidadeItens` acima, pois só depois de organizar/embalar é que se sabe em quantas caixas o pedido ficou fechado (item 32). `null` até a Organização ser finalizada |
| `observacao`                   | string             | Texto livre                                              |
| `status`                       | `"aberto"` \| `"finalizado"` | Único estado controlado (sem "em análise"/"cancelado") |
| `criadoEm`                     | Timestamp (servidor)| Data/hora de criação                                     |
| `finalizadoEm`                 | Timestamp (servidor) ou `null` | Data/hora de finalização                     |
| `resultadoSLA`                 | `"antecipado"` \| `"no_prazo"` \| `"atrasado"` \| `null` | Calculado na finalização |
| `diasDiferencaFinalizacao`     | number \| `null`   | Diferença em dias úteis entre vencimento e finalização    |
| `statusSeparacao`              | `"a-separar"` \| `"em-separacao"` \| `"separado"` | Fluxo operacional de separação física, **independente** do SLA e do `status` acima |
| `operadorInicioSeparacao`      | string \| `null`   | Nome digitado pelo operador ao iniciar a separação          |
| `dataHoraInicioSeparacao`      | Timestamp (servidor) ou `null` | Data/hora de início da separação                |
| `operadorFimSeparacao`         | string \| `null`   | Nome digitado pelo operador ao finalizar a separação         |
| `dataHoraFimSeparacao`         | Timestamp (servidor) ou `null` | Data/hora de fim da separação                    |
| `statusOrganizacao`            | `"a-organizar"` \| `"em-organizacao"` \| `"organizado"` | Fluxo operacional de conferência/organização para despacho (2ª etapa, após a separação), **independente** do SLA e do `statusSeparacao` acima |
| `operadorInicioOrganizacao`    | string \| `null`   | Nome digitado pelo operador ao iniciar a organização         |
| `dataHoraInicioOrganizacao`    | Timestamp (servidor) ou `null` | Data/hora de início da organização               |
| `operadorFimOrganizacao`       | string \| `null`   | Nome digitado pelo operador ao finalizar a organização        |
| `dataHoraFimOrganizacao`       | Timestamp (servidor) ou `null` | Data/hora de fim da organização                   |
| `pesoCargaKg`                  | number \| `null`   | Peso **total** aferido na balança (kg) de todas as caixas do pedido, informado apenas no momento de **finalizar a Organização** (2ª etapa). `null` até lá |
| `alturaCm`                     | number \| `null`   | Altura (cm) da maior caixa/volume do pedido — mede-se só 1, não cada caixa (item 31). Informado junto com o peso, só ao finalizar a Organização |
| `larguraCm`                    | number \| `null`   | Largura (cm) da maior caixa/volume do pedido (mesmas condições de `alturaCm`) |
| `comprimentoCm`                | number \| `null`   | Comprimento (cm) da maior caixa/volume do pedido (mesmas condições de `alturaCm`) |
| `pesoCubadoKg`                 | number \| `null`   | Peso cubado (kg), calculado automaticamente = Altura × Largura × Comprimento (m) × 300 (fator rodoviário Brasil). Nunca digitado diretamente — sempre recalculado a partir das 3 dimensões acima |
| `idExterno`                    | string \| `null`   | Coluna "ID" da planilha de importação em lote (item 33) — campo de referência livre, usado na busca do Painel Consolidado. `null` em pedidos lançados manualmente |
| `parceiroCodigo`                | string \| `null`   | Coluna "Parceiro - Código" da planilha (item 33) — **oculto** nas telas (não aparece em nenhuma coluna/sub-linha), mas localizável pela busca do Painel Consolidado. `null` em pedidos lançados manualmente |
| `modalidade`                   | string \| `null`   | Coluna "Transportadora (nota fiscal)" da planilha (item 33), exibida na tabela/cartão do Painel Consolidado sob o título "Modalidade". `null` em pedidos lançados manualmente |
| `nomeRepresentante`            | string \| `null`   | Coluna "Nome do representante" da planilha (item 33), exibida como sub-linha sob o Cliente no Painel Consolidado. `null` em pedidos lançados manualmente |
| `cadastroPlanilha`             | string `yyyy-mm-ddTHH:mm` \| `null` | Data/hora completa da coluna "Cadastro" da planilha (item 33) — a parte só da data também alimenta `dataPedido` no momento da importação. Exibida como sub-linha sob o Cliente. `null` em pedidos lançados manualmente |

> Os cinco campos acima (`idExterno`, `parceiroCodigo`, `modalidade`,
> `nomeRepresentante`, `cadastroPlanilha`) só existem em pedidos trazidos
> pela **importação em lote via planilha** (item 33, seção 3) — pedidos
> lançados manualmente pelo formulário "Adicionar Novo Pedido" sempre os
> gravam como `null`. Em "Editar Pedido", a seção "Dados da importação" só
> aparece quando pelo menos um desses campos estiver preenchido.

> Nenhum valor de "dias restantes"/"dias de atraso" é armazenado — tudo é
> calculado dinamicamente a cada renderização, comparando com a data atual.
> O mesmo vale para as métricas do Painel de Tempos (tempo médio por
> operador, histórico diário): tudo é calculado no cliente a partir desta
> mesma coleção `pedidos`, sem nenhuma coleção ou banco adicional.

> Pedidos criados antes desta atualização não têm os campos de separação
> nem de organização gravados no Firestore. O app trata essa ausência como
> `"a-separar"` / `"a-organizar"` automaticamente (nenhuma migração de
> dados é necessária).

> Pedidos criados antes do item 30 (seção 3) também não têm `quantidadeCaixas`
> nem `pesoCargaKg` gravados. O campo de caixas aparece em branco ao editar
> esses pedidos antigos e passa a ser obrigatório salvar com ele preenchido
> a partir da primeira edição; o peso simplesmente fica fora das somas do
> Painel de Tempos e das colunas de volumetria/peso do Excel até que o
> pedido seja finalizado (ou reaberto e finalizado de novo) com o peso
> informado. Nenhuma migração de dados é necessária.

> Pelo mesmo motivo, pedidos finalizados antes do item 31 (seção 3) não têm
> `alturaCm`/`larguraCm`/`comprimentoCm`/`pesoCubadoKg` gravados — ficam de
> fora das somas de peso cubado do Painel de Tempos e da coluna "Peso
> Cubado (kg)" do Excel até que alguém informe as dimensões (pela correção
> manual em "Editar Pedido", já que o pedido já está finalizado e não passa
> de novo pela tela de finalização). Nenhuma migração de dados é necessária.

> **Sobre a renomeação do item 32:** pedidos cadastrados **antes** do item 32
> têm a quantidade do cadastro gravada no campo `quantidadeCaixas` (nome
> antigo do que hoje é `quantidadeItens`). Ao abrir um desses pedidos em
> "Editar Pedido", o campo "Quantidade de Itens\*" usa esse valor antigo como
> aproveitamento automático (`quantidadeItens ?? quantidadeCaixas`), só para
> não aparecer em branco — não há perda de dado nem migração necessária. Essa
> mesma aproximação, porém, não é feita no sentido contrário: o campo
> "Quantidade de Caixas (fechada)" de Editar Pedido lê somente o valor atual
> de `quantidadeCaixas`, então, para esses pedidos antigos, ele só mostra
> algo se a Organização já tiver sido finalizada **depois** da entrada em
> vigor do item 32 (antes disso, era o mesmo campo usado para a quantidade do
> cadastro — por isso não é reaproveitado automaticamente como quantidade
> fechada). Na prática, isso não afetou nenhum pedido real: antes desta
> atualização, o campo `quantidadeCaixas` nunca chegou a ser preenchido em
> produção (confirmado pelo Painel de Tempos, que mostrava "0 cx" para todos
> os colaboradores).

## 2b. Modelo de dados (coleção `colaboradores`)

Cada documento representa um separador ou organizador cadastrado (a coleção
é única para os dois papéis — o mesmo cadastro alimenta as listas suspensas
de Separação e de Organização):

| Campo      | Tipo                  | Observação                                                        |
|------------|-----------------------|---------------------------------------------------------------------|
| `id` (ID do documento) | string (auto) | Identificador único gerado pelo Firestore                         |
| `nome`     | string                | Nome do colaborador, exibido nas listas suspensas                  |
| `ativo`    | boolean               | `true` = aparece nas listas suspensas; `false` = "Desativado" (continua na tela Colaboradores, mas não pode ser selecionado em novos registros) |
| `criadoEm` | Timestamp (servidor)  | Data/hora do cadastro                                              |

> Não há vínculo (ID de referência) entre um documento de `colaboradores` e
> os pedidos em que aquele nome foi usado — os pedidos armazenam o nome como
> texto simples, exatamente como antes (ver item 27 na seção 3). Isso é
> proposital: mantém o histórico de pedidos intacto mesmo que um
> colaborador seja renomeado, desativado ou excluído depois.

## 3. Premissas assumidas (definidas em conjunto com o solicitante)

Estas decisões foram confirmadas durante o levantamento de requisitos e
podem ser ajustadas depois, se necessário:

1. **Sem tela de login e sem identificação de usuário.** Não há campos de
   "usuário criador" nem "usuário responsável pela finalização" — apenas
   datas/horas de criação e finalização. A autenticação anônima do Firebase
   é usada apenas como mecanismo técnico invisível para proteger o Firestore.
2. **Sem perfis/níveis de acesso.** Qualquer sessão autenticada (anônima)
   tem as mesmas permissões de leitura e escrita.
3. **Apenas dois status:** `aberto` e `finalizado` (sem "em análise" ou
   "cancelado").
4. **Sem campo/filtro de forma de pagamento** (removido do escopo original).
5. **Todos os prazos são contados em dias úteis** (segunda a sexta-feira),
   **sem considerar feriados**. Isso vale tanto para o cálculo da data de
   vencimento quanto para a contagem de dias restantes/atrasados. Caso a
   UNISO utilize um calendário de feriados, a função `ehDiaUtil()` em
   `app.js` pode ser estendida para consultá-lo.
6. **A data de recebimento não conta como um dos dias do prazo** — a
   contagem começa no dia útil seguinte ao recebimento.
7. **Cores de atraso:** marrom do 1º ao 4º dia útil de atraso; roxo a
   partir do 5º dia útil de atraso (configurável em `CONFIG_SLA`, no topo
   de `app.js`).
8. **Edição de pedidos** é permitida apenas enquanto o pedido está `aberto`
   (pedidos finalizados ficam com o histórico travado, preservando a
   rastreabilidade do resultado do SLA já calculado).
9. **Histórico operacional:** o campo "Agrupar por" define qual data
   (recebimento, vencimento ou finalização) determina o dia de cada linha;
   os pedidos daquele dia são então contados como finalizados/pendentes/
   atrasados/percentual de conclusão. A janela exibida é de 14 dias.
10. **Filtros de data** (recebimento e vencimento) foram implementados como
    intervalos (data inicial/final), permitindo tanto uma data específica
    quanto um período.
11. **Duas telas** (adicionado nesta atualização): o app foi dividido em
    "Painel Operacional" (tela inicial: Painel Consolidado por Prazo, busca/
    filtros e Adicionar Pedido) e "Painel Consolidado" (indicadores, tabela
    de pedidos e histórico/gráfico), acessada pelo botão 📊 no cabeçalho. Os
    filtros de busca ficam na tela operacional e continuam válidos ao
    navegar para a tabela na outra tela (o estado dos filtros é
    compartilhado entre as duas telas).
12. **Status de Separação** (adicionado nesta atualização) é um fluxo
    totalmente independente da Situação (SLA) e do checkbox "Concluir":
    acompanha apenas o processo físico de separação do pedido, registrado
    pelo operador através do botão ⏱️ "Registro de Separação" no cabeçalho.
13. **Identificação do operador por texto livre**, sem cadastro nem login —
    coerente com a decisão de não ter perfis de usuário no app (item 1).
    Nomes digitados de forma diferente (ex.: "João" vs. "joao silva") serão
    tratados como pessoas diferentes em uma futura análise de tempo médio
    por operador.
14. **Horário de Brasília fixo** nos registros de separação
    (`America/Sao_Paulo`), independentemente do fuso configurado no
    computador de quem estiver usando o app — para que o tempo entre
    operadores de máquinas diferentes seja sempre comparável.
15. **Segunda etapa: Organização** (adicionada nesta atualização). Após a
    separação, o pedido passa por uma etapa de conferência e organização
    para despacho, feita por outra pessoa (a "organizadora"), registrada no
    mesmo modal "Registro de Separação e Organização" (botão ⏱️), em uma
    2ª seção própria ("Iniciar Organização"/"Finalizar Organização"), com
    número do pedido e nome digitados de forma independente da seção de
    Separação. **A organização só pode ser iniciada depois que a separação
    do mesmo pedido estiver finalizada** — é essa a premissa adotada para
    "Iniciar Organização" (o sistema bloqueia com uma mensagem de erro caso
    contrário), coerente com o fluxo físico descrito (organiza-se depois de
    separar).
16. **Finalização automática.** O checkbox manual "Concluir" foi removido.
    Quando a Organização é finalizada e a Separação do mesmo pedido já está
    concluída, o pedido é finalizado automaticamente — sem nenhuma ação
    manual — usando a mesma lógica de cálculo de resultado do SLA que já
    existia (comparação entre a data de hoje e o vencimento). Para corrigir
    uma finalização indevida, o botão **Reabrir** (na coluna Ações, visível
    apenas em pedidos finalizados) devolve o pedido para "aberto" sem
    alterar os registros de separação/organização já feitos.
17. **Painel de Tempos** (novo, 4º botão no cabeçalho, ícone ⏳): painel com
    métricas de separação e organização, tudo calculado no cliente a partir
    da mesma coleção `pedidos` (nenhum banco adicional é necessário).
    Definições adotadas:
    - **Total / Pendentes / Concluídas / Taxa de conclusão:** contagem de
      todos os pedidos da coleção; "Concluídas" = pedidos com `status`
      `finalizado` (as duas etapas completas, já que a finalização é
      automática); "Pendentes" = Total − Concluídas.
    - **Dias registrados:** quantidade de datas distintas em `dataPedido`
      entre todos os pedidos.
    - **Tempo médio por operador:** calculado separadamente para Separação
      e para Organização (não somado), atribuído a quem **finalizou** o
      registro daquela etapa (`operadorFimSeparacao` / `operadorFimOrganizacao`)
      — premissa adotada porque, na prática, o mesmo operador normalmente
      inicia e finaliza a própria etapa. O percentual ao lado indica a
      participação do operador no volume total de pedidos com aquela etapa
      concluída (não é uma comparação de velocidade).
    - **Histórico diário** (últimos 14 dias, agrupado pela Data do Pedido):
      Status é um selo resumo do dia ("Concluído" = 100% finalizado,
      "Em andamento" = parcialmente finalizado, "Pendente" = nada
      finalizado ainda, "-" = nenhum pedido registrado naquele dia); Tempo
      médio é a soma de separação + organização dos pedidos concluídos
      daquele dia; "% efetuado no dia" = Concluídas do dia ÷ Total
      registrado no dia.
18. **Busca e filtros duplicados** (adicionado nesta atualização): a mesma
    seção de busca/filtros do Painel Operacional também aparece no Painel
    Consolidado, entre os indicadores e a lista de pedidos, para facilitar
    a busca sem precisar trocar de tela. Os dois conjuntos de campos
    compartilham o mesmo estado de filtros e ficam sempre sincronizados
    entre si.
19. **Tabela de pedidos justificada** (adicionado nesta atualização): as
    colunas têm largura proporcional fixa (via `<colgroup>`), preenchendo
    sempre 100% da largura do quadro, sem exigir barra de rolagem
    horizontal em telas de desktop comuns. Textos mais longos (como o
    badge "FINALIZADO (Antecipado Xd)") quebram em duas linhas dentro da
    própria célula em vez de vazar para a coluna vizinha.
20. **Relatório de tempo médio de separação por operador:** implementado
    nesta atualização, dentro do novo Painel de Tempos (ver item 17) — a
    premissa anterior (fora do escopo) foi superada por este pedido.
21. **Nome do organizador na tabela** (ajuste): a coluna "Organização" agora
    mostra o badge de status e, logo abaixo, o nome de quem iniciou/
    finalizou a organização (mesmo critério de `obterOperadorAtual`,
    aplicado à etapa de organização) — sem criar uma coluna extra.
22. **Botão "Painel Operacional" (🏠) no cabeçalho** (ajuste): antes, a tela
    inicial só era alcançada pelos botões "Voltar"; agora há um botão
    próprio no cabeçalho, assim como os demais painéis (Consolidado,
    Registro de Separação/Organização, Tempos), totalizando 6 botões:
    🏠 Painel Operacional, 📊 Painel Consolidado, ⏱️ Registro de Separação e
    Organização, ⏳ Painel de Tempos, 📱 modo celular, 🌙 tema.
23. **Cabeçalhos da tabela sem corte** (ajuste): títulos de uma palavra só
    (ex.: "Recebimento", "Vencimento"), mais largos que sua coluna, agora
    quebram em duas linhas dentro da própria célula (fonte reduzida de
    0.76rem para 0.7rem) em vez de vazar visualmente para a coluna vizinha.
24. **Correção manual dos registros de Separação e Organização, pelo modal
    "Editar Pedido"** (adicionado nesta atualização): além dos campos já
    existentes, o modal de edição agora tem duas seções — "Separação
    (correção manual)" e "Organização (correção manual)" — com o nome do
    operador e a data/hora de início e fim de cada etapa, para o caso de
    alguém errar ao registrar pelo painel "Registro de Separação e
    Organização" (⏱️). Regras adotadas:
    - Nome e data/hora de uma mesma marcação (ex.: "início da separação")
      devem ser preenchidos juntos, ou os dois deixados em branco para
      remover aquele registro; o fim de uma etapa não pode ser anterior ao
      seu início.
    - As datas/horas são sempre interpretadas em **horário de Brasília**
      (`America/Sao_Paulo`, UTC-03:00 fixo — o Brasil aboliu o horário de
      verão em 2019), **independentemente do fuso do computador de quem
      está editando** — mesma premissa já usada nos registros automáticos
      (item 14).
    - O Status (badge) de Separação/Organização é recalculado
      automaticamente a partir de quais datas ficaram preenchidas (com
      fim = etapa concluída; só início = em andamento; nenhuma = não
      iniciada).
    - A finalização automática do pedido (item 16) é reavaliada a cada
      correção: se as duas etapas ficarem completas, o pedido é finalizado
      (usando a data efetiva da correção para calcular o resultado do
      SLA, não a data da edição); se deixarem de estar completas (ex.:
      apagaram um horário por engano), o pedido é reaberto automaticamente.
    - Como pedidos finalizados não podem ser editados (regra já existente),
      para corrigir um pedido já finalizado é preciso primeiro clicar em
      **Reabrir** (coluna Ações) e, em seguida, em **Editar**.
25. **Busca e filtros somente no Painel Consolidado** (ajuste — supera o item
    18): a seção de busca/filtros foi removida do Painel Operacional, que
    passou a conter apenas o Painel Consolidado por Prazo e o formulário
    "Adicionar Novo Pedido". A busca/filtros permanece exclusivamente no
    Painel Consolidado, junto com a lista de pedidos. O estado dos filtros
    (`estado.filtros`) e a lógica de sincronização em `app.js` foram
    mantidos preparados para reintroduzir um segundo conjunto de campos no
    futuro, caso necessário.
26. **Bloqueio de número de pedido duplicado** (adicionado nesta atualização):
    tanto no formulário "Adicionar Novo Pedido" (Painel Operacional) quanto
    no modal "Editar Pedido", o número informado é comparado com os demais
    pedidos já cadastrados (`buscarPedidoPorNumero`, comparação sem
    diferenciar maiúsculas/minúsculas nem espaços nas pontas). Se já existir
    outro pedido com o mesmo número, o lançamento/salvamento é bloqueado e
    uma mensagem de erro identifica o cliente do pedido conflitante, para
    que o usuário confirme se não é duplicidade antes de prosseguir. Ao
    editar um pedido sem alterar o seu próprio número, a verificação não o
    bloqueia (ele não conflita consigo mesmo).
27. **Cadastro de Colaboradores (separadores e organizadores)** — adicionado
    nesta atualização, substitui a premissa 13 (identificação do operador
    por texto livre): agora existe uma nova coleção `colaboradores` no
    Firestore, com uma tela própria de cadastro (7º botão no cabeçalho, 👥
    "Colaboradores"), e os 6 campos de nome de operador do app (os 2 do
    modal "Registro de Separação e Organização" e os 4 de correção manual
    em "Editar Pedido") deixaram de ser texto livre e passaram a ser listas
    suspensas (`<select>`), alimentadas somente pelos colaboradores
    cadastrados e **ativos**. Isso elimina o problema relatado (nome digitado
    errado ou com uma letra diferente "sai" do cálculo de Tempo Médio por
    Operador), pois não é mais possível digitar um nome — apenas selecionar
    um já cadastrado.
    - **Regra da lista: somente cadastrados** (decisão confirmada com o
      solicitante) — não há opção de digitar um nome novo na hora do
      registro; o nome precisa ser cadastrado antes, na tela Colaboradores.
    - **Tela Colaboradores** (decisão confirmada com o solicitante: botão
      próprio no cabeçalho, não uma aba dentro de outra tela) permite:
      **Adicionar** (nome, com bloqueio de duplicidade sem diferenciar
      maiúsculas/minúsculas nem espaços nas pontas, mesmo padrão já usado
      para número de pedido — item 26); **Editar** (renomear um colaborador
      já cadastrado, com o mesmo bloqueio de duplicidade); **Desativar/
      Reativar** (o colaborador some das listas suspensas de novos
      registros, mas continua listado na tela Colaboradores marcado como
      "Inativo" — não é excluído); **Excluir** (remoção definitiva do
      cadastro, com confirmação).
    - **Nenhuma ação sobre um colaborador altera pedidos já registrados.**
      Assim como antes, o nome do operador continua sendo salvo como texto
      simples dentro do próprio pedido (sem vínculo/ID com o cadastro) — por
      isso desativar, renomear ou excluir um colaborador não muda o
      histórico já gravado, nem os cálculos do Painel de Tempos referentes a
      registros passados.
    - **Nomes já usados nos pedidos, antes desta atualização, continuam
      preservados.** Ao abrir "Editar Pedido" de um pedido antigo cujo nome
      de operador não corresponde a nenhum colaborador ativo (porque nunca
      foi cadastrado, ou foi desativado/excluído depois), esse nome aparece
      no topo da lista suspensa marcado como **"(não cadastrado)"**, em vez
      de ser apagado silenciosamente. Isso garante que abrir e salvar um
      pedido antigo nunca perde o nome que já estava registrado.
    - **Botão "Importar nomes dos pedidos"**, na própria tela Colaboradores:
      varre todos os pedidos já existentes, identifica os nomes de operador
      já usados (nos 4 campos de separação/organização) e cadastra
      automaticamente os que ainda não estão na lista de colaboradores —
      forma recomendada de popular o cadastro inicial a partir do histórico
      real, sem precisar redigitar cada nome manualmente.
    - **Busca por iniciais:** a lista suspensa é um `<select>` padrão do
      navegador, que já responde à digitação das iniciais (digitar "J", por
      exemplo, pula direto para o primeiro nome que começa com "J") — uma
      solução simples que atende ao pedido sem exigir um componente
      personalizado.
    - **Nova coleção no Firestore:** `colaboradores` (documento por
      colaborador, campos `nome`, `ativo` e `criadoEm`). **Importante:** as
      regras de segurança (`firestore.rules`) foram atualizadas para incluir
      essa coleção — é necessário publicar o arquivo atualizado no console
      do Firebase (ver seção 1.3), além de atualizar os 3 arquivos de sempre
      no GitHub Pages. Sem esse passo, a tela Colaboradores fica sem
      permissão de acesso ao Firestore.
28. **Coluna "Atribuição" no Painel Consolidado** (adicionado nesta
    atualização): atalho para atribuir/finalizar Separação e Organização
    direto na linha do pedido (tabela e cartão do modo celular), sem
    precisar abrir o painel "Registro de Separação e Organização" (⏱️) e
    digitar o número do pedido — que continua existindo exatamente como
    antes, sem nenhuma alteração, para quem preferir usá-lo. É apenas um
    caminho mais curto para o mesmo fluxo: usa as mesmas funções e a mesma
    marcação automática de data/hora do servidor (nenhum cálculo de SLA,
    tempo médio por operador ou finalização automática muda).
    - **Botão dinâmico**, um por pedido, que muda de rótulo conforme o
      andamento: "Atribuir Separação" → "Finalizar Separação" → "Atribuir
      Organização" → "Finalizar Organização"; quando o pedido é finalizado
      automaticamente (mesma regra do item 16), o botão dá lugar a um texto
      "✓ Concluído".
    - **Modal curto de atribuição/finalização**: mostra o número do pedido
      (somente leitura), um selo da fase atual ("📦 Fase 1 de 2 —
      Separação" ou "🔨 Fase 2 de 2 — Organização (na mesa)") e uma lista
      suspensa para escolher o colaborador (nos passos de "Atribuir") ou o
      nome do responsável já preenchido e bloqueado (nos passos de
      "Finalizar", já que quem finaliza normalmente é quem iniciou — mesma
      premissa do item 17). A lista suspensa tem, ao final, a opção
      "+ Cadastrar novo colaborador": escolhê-la pede o nome, cadastra e já
      seleciona o colaborador recém-criado, sem precisar sair para a tela
      Colaboradores.
    - **Cada ação exibe um aviso de confirmação** no topo do Painel
      Consolidado, que fecha sozinho após alguns segundos ou ao clicar no
      "✕": "Separação atribuída.", "Separação finalizada.", "Organização
      atribuída." e, ao finalizar a organização, "Pedido finalizado e
      baixado." (substituindo, nesse último caso, o aviso genérico de
      finalização — mensagem única, mais direta).
    - **Proteção contra dado desatualizado:** ao confirmar, o pedido é
      relido do estado mais atual (não do que estava na tela quando o modal
      foi aberto); se o status já tiver mudado nesse meio-tempo (ex.: outra
      pessoa atribuiu no mesmo instante, em outra aba), a ação é bloqueada
      com um aviso pedindo para tentar novamente pela lista atualizada, em
      vez de sobrescrever silenciosamente o que a outra pessoa já fez.
29. **Extração de dados em Excel** (adicionado nesta atualização): botão
    "📥 Extrair Dados (Excel)" na seção "Pedidos" do Painel Consolidado, ao
    lado do título. Gera um arquivo `.xlsx` inteiramente no navegador (não
    depende de nenhum servidor/backend nem grava nada no Firestore — é
    somente leitura), pronto para apresentação de resultados. Duas abas:
    - **"Resumo":** data/hora da extração, total de pedidos, pedidos em
      aberto, pedidos finalizados (baixados), taxa de conclusão, quantos
      finalizados foram antecipados/no prazo/atrasados, e o tempo médio por
      operador em cada etapa (Separação e Organização) — mesmos critérios
      de cálculo do Painel de Tempos (item 17).
    - **"Pedidos":** uma linha por pedido, com número, cliente, datas,
      SLA em dias úteis, situação atual (no prazo/vence hoje/atrasado ou,
      se finalizado, antecipado/no prazo/atrasado com a diferença em dias),
      status e operador de cada etapa (Separação e Organização), data/hora
      de início e fim de cada etapa (horário de Brasília), tempo de cada
      etapa e o tempo total, resultado do SLA na finalização e observação.
    - **Respeita a busca e os filtros já aplicados** no Painel Consolidado
      (mesmo critério de `pedidoPassaFiltros` usado pela tabela): a
      extração traz exatamente os pedidos exibidos na tela no momento do
      clique — por exemplo, filtrar por um período de vencimento antes de
      extrair gera uma planilha só daquele período. Para extrair todos os
      pedidos, basta limpar os filtros antes de clicar.
    - **Premissa adotada:** como o pedido não especificou um período fixo
      (mês, trimestre etc.), a extração foi ligada aos filtros de busca já
      existentes no painel, em vez de abrir uma nova tela de seleção de
      período — reaproveita um mecanismo que o usuário já conhece e evita
      duplicar a lógica de filtros. Se for necessário um recorte diferente
      (ex.: seleção de intervalo específico só para a extração, sem afetar
      o que é exibido na tela), é possível ajustar depois.
    - Requer a biblioteca gratuita SheetJS, carregada de um CDN público
      (`cdnjs.cloudflare.com`) declarado em `index.html`; se a rede/CDN
      estiver bloqueada no momento do clique, aparece um aviso explicando o
      problema em vez de travar a página, e o restante do app continua
      funcionando normalmente.

30. **Quantidade de Caixas (volumetria) e Peso da Carga aferido na
    finalização da Organização** (adicionado nesta atualização):
    - **Quantidade de Caixas:** novo campo obrigatório `Qtde. de Caixas` /
      `Quantidade de Caixas*`, posicionado antes do campo "Observação" tanto
      em "Adicionar Novo Pedido" (Painel Operacional) quanto em "Editar
      Pedido" (Painel Consolidado). Registra a volumetria de cada pedido em
      número de caixas, para medir o volume efetivamente separado/organizado
      por pedido. É validado como os demais campos obrigatórios (bloqueia o
      salvamento com mensagem de erro se estiver vazio ou menor/igual a
      zero).
    - **Peso da Carga (kg):** novo campo, pedido apenas no momento de
      **finalizar a 2ª etapa (Organização)** — nunca na Separação, e nunca
      ao apenas *iniciar* a Organização. Está disponível nos dois caminhos
      que finalizam a Organização, que compartilham a mesma lógica interna:
      - No modal "⏱️ Registro de Separação e Organização", na seção "2.
        Organização", o campo "Peso aferido da carga (kg)*" se torna
        obrigatório somente ao clicar em "Finalizar Organização" (iniciar a
        organização continua sem exigir peso).
      - Na coluna "Atribuição" do Painel Consolidado (item 28), o campo de
        peso aparece dinamicamente — oculto nas demais ações (Atribuir/
        Iniciar Separação, Atribuir/Iniciar Organização) e visível e
        obrigatório apenas na ação "Finalizar Organização".
      - **Atualizado pelo item 31 abaixo:** a cubagem (altura/largura/
        comprimento) passou a ser exigida junto com o peso neste mesmo
        momento — a frase acima ("por ora não é necessário cubar") descreve
        apenas o pedido original; o pedido de cubagem veio logo em seguida,
        na mesma sessão de trabalho.
      - O valor é gravado no Firestore (`pesoCargaKg`) para fins de
        indicadores, e também pode ser corrigido manualmente em "Editar
        Pedido", na seção "Organização (correção manual)".
    - **Painel de Tempos:** a lista "Tempo Médio por Operador" agora exibe,
      abaixo do tempo médio de cada colaborador, o total de caixas
      (`N cx`) somado a partir de todos os pedidos atribuídos àquele
      colaborador — nas duas listas (Separação e Organização) — e, apenas
      na lista de Organização, o peso total aferido (`X,X kg`), somando
      somente os pedidos que já têm peso registrado.
    - **Extração em Excel (item 29):** a aba "Pedidos" ganhou as colunas
      "Quantidade de Caixas" e "Peso da Carga (kg)"; a aba "Resumo" ganhou
      os indicadores "Total de caixas (volumetria)" e "Peso total aferido
      (kg)", e a linha de tempo médio por operador de cada etapa passou a
      mostrar também o total de caixas (e, na Organização, o peso total) ao
      lado do tempo médio.
    - **Premissa adotada:** como o pedido descreveu dois pontos de entrada
      para finalizar a Organização (o modal ⏱️ e a coluna "Atribuição"), o
      campo de peso foi habilitado nos **dois** caminhos — ambos chamam a
      mesma função de finalização, e a integridade dos indicadores depende
      de cobrir os dois. Se apenas um dos caminhos for de fato usado na
      operação do dia a dia, o outro simplesmente nunca aparecerá como
      pendência.
    - Pedidos antigos sem `quantidadeCaixas`/`pesoCargaKg` são tratados sem
      quebrar nada — ver nota na seção 2.

31. **Cubagem da carga e cálculo automático do peso cubado** (adicionado
    nesta atualização, em sequência ao item 30):
    - **Altura, Largura e Comprimento (cm):** três novos campos, exigidos
      exatamente no mesmo momento e nos mesmos dois caminhos que o Peso da
      Carga (item 30) — ao "Finalizar Organização", tanto no modal "⏱️
      Registro de Separação e Organização" quanto na coluna "Atribuição".
      Também podem ser corrigidos manualmente em "Editar Pedido", na seção
      "Organização (correção manual)".
    - **Mede-se apenas 1 volume — o maior** caixa/volume do pedido — e não
      cada caixa individualmente, nem multiplicado pela Quantidade de
      Caixas (item 30). O Peso da Carga continua sendo o peso **total** de
      todas as caixas declaradas no pedido; a cubagem é só uma referência
      dimensional de uma caixa/volume representativa.
    - **Peso cubado (kg):** calculado automaticamente a partir das três
      dimensões, com o fator padrão de transporte rodoviário de cargas no
      Brasil (NTC&Logística/ANTT): **peso cubado = Altura × Largura ×
      Comprimento (em metros) × 300**. Uma prévia do valor calculado
      aparece ao vivo, abaixo dos campos, conforme as dimensões são
      digitadas (nos dois caminhos e também na correção manual) — antes
      mesmo de finalizar/salvar.
    - Gravado no Firestore como `alturaCm`, `larguraCm`, `comprimentoCm` e
      `pesoCubadoKg` (este último sempre recalculado a partir dos três
      primeiros, nunca digitado diretamente).
    - **Painel de Tempos:** a lista "Tempo Médio por Operador" (Organização)
      passou a exibir também o peso cubado total somado por colaborador
      (`X,X kg cubado`), ao lado do peso real já existente.
    - **Extração em Excel:** a aba "Pedidos" ganhou as colunas "Altura
      (cm)", "Largura (cm)", "Comprimento (cm)" e "Peso Cubado (kg)"; a aba
      "Resumo" ganhou o indicador "Peso cubado total (kg)", e a linha de
      tempo médio por operador da Organização passou a mostrar também o
      peso cubado total ao lado do peso real.
    - **Premissa adotada (fator de cubagem):** como o segmento de atuação
      (transporte/logística rodoviária) não foi informado com um fator
      específico de contrato, foi adotado o fator padrão do mercado
      rodoviário brasileiro — 300 kg/m³ — confirmado com o solicitante antes
      da implementação. Se a transportadora usada tiver um fator contratual
      diferente (ex.: aéreo, 166,67 kg/m³, ou outro valor específico), o
      fator está isolado em uma única constante no código
      (`FATOR_CUBAGEM_KG_M3`, em `app.js`), fácil de ajustar sem tocar no
      resto da lógica.
    - Pedidos antigos sem cubagem registrada são tratados sem quebrar nada,
      mesmo padrão do Peso da Carga (ver nota na seção 2).

32. **Separação entre Quantidade de Itens (cadastro) e Quantidade de Caixas
    fechada (Organização)** (adicionado nesta atualização, em sequência aos
    itens 30 e 31):
    - **Motivação:** o campo único "Quantidade de Caixas" criado no item 30
      era lançado no **cadastro** do pedido, antes de a separação e a
      organização acontecerem. Na prática, porém, a separação apenas busca
      os produtos/embalagens — é só na **Organização** (ao fechar as caixas
      para despacho) que a quantidade final de caixas é conhecida de fato.
      Por isso o campo foi dividido em dois, cada um no momento certo do
      processo:
      - **Quantidade de Itens** (`quantidadeItens`): o campo antigo,
        renomeado — continua sendo informado no **cadastro do pedido**
        (rótulo "Quant. Itens" em "Adicionar Novo Pedido", "Quantidade de
        Itens\*" em "Editar Pedido"), obrigatório, com a mesma validação de
        antes.
      - **Quantidade de Caixas** (`quantidadeCaixas`): campo **novo**,
        reaproveitando o nome antigo do campo do item 30, mas agora com um
        significado mais preciso — a quantidade **final de caixas já
        fechadas**, informada apenas ao **Finalizar a Organização**, nos
        mesmos dois caminhos do Peso da Carga e da cubagem (itens 30 e 31):
        o modal "⏱️ Registro de Separação e Organização" (campo
        "Quantidade de Caixas\*", ao lado do peso) e a coluna "Atribuição"
        (campo "Quantidade de Caixas (fechada)", visível e obrigatório só na
        ação "Finalizar Organização"). Também pode ser corrigido
        manualmente em "Editar Pedido", na seção "Organização (correção
        manual)".
    - **Peso cubado não é multiplicado pela Quantidade de Caixas:** decisão
      explícita do solicitante — o cálculo do peso cubado (item 31) continua
      sendo o de **uma única caixa/volume** representativa (a maior do
      pedido), sem multiplicar pela quantidade de caixas fechadas. O Peso da
      Carga (kg) continua sendo o peso total informado diretamente na
      balança.
    - **Painel de Tempos:** a lista "Tempo Médio por Operador" continua
      exibindo o total de caixas (`N cx`) nas duas listas (Separação e
      Organização) — só a origem do dado mudou: antes vinha da quantidade
      lançada no cadastro, agora vem da quantidade fechada informada ao
      finalizar a Organização. Consequência prática: o total de caixas só
      aparece depois que a Organização daquele pedido for finalizada (antes
      disso, o pedido entra nas somas com 0 caixas, tanto na lista de
      Separação quanto na de Organização) — diferente de antes, quando a
      quantidade já vinha disponível desde o cadastro.
    - **Extração em Excel:** a aba "Pedidos" ganhou a coluna "Quantidade de
      Itens" (próxima a SLA/Vencimento, onde ficava a coluna antiga) e
      renomeou a coluna de caixas para "Quantidade de Caixas (fechada)"
      (reposicionada perto de Peso da Carga/Altura/Largura/Comprimento/Peso
      Cubado, já que agora é um dado da Organização); a aba "Resumo" ganhou
      o indicador "Total de itens cadastrados (lançamento do pedido)" e
      renomeou o indicador antigo para "Total de caixas fechadas
      (volumetria - Organização)".
    - **Compatibilidade com pedidos antigos:** ver nota detalhada na seção 2
      (abaixo da tabela de campos). Em resumo: a exibição de "Quantidade de
      Itens" em "Editar Pedido" aproveita automaticamente o valor antigo
      gravado em `quantidadeCaixas` quando `quantidadeItens` não existir,
      só para não aparecer em branco — sem necessidade de migração de dados.
      Essa reaproveitamento não se aplica ao campo de correção de
      "Quantidade de Caixas (fechada)" pelo motivo explicado naquela nota.

33. **Importação em lote de pedidos via planilha, novos campos de
    referência, alerta de grande volume e integração com o sistema de
    logística** (adicionado nesta atualização):
    - **Importação em lote (.xls/.xlsx):** novo painel "Importar Pedidos em
      Lote (Planilha)" no Painel Operacional, abaixo de "Adicionar Novo
      Pedido". As colunas são lidas pelo **nome do cabeçalho** de cada
      uma — podem vir em **qualquer ordem** no arquivo — e não pela
      posição, conforme pedido explícito do solicitante. Mapeamento:
      | Coluna da planilha | Campo do pedido |
      |---|---|
      | Número do pedido | `numeroPedido` |
      | ID | `idExterno` |
      | Parceiro - Código | `parceiroCodigo` |
      | Parceiro - Razão Social | `cliente` |
      | Cadastro | `dataPedido` (parte da data) + `cadastroPlanilha` (data e hora completas) |
      | Transportadora (nota fiscal) | `modalidade` (exibido no painel como "Modalidade") |
      | Nome do representante | `nomeRepresentante` |
      | Quantidade de Itens (aceita também a grafia com erro de digitação "Quantidade de Iitens", como veio no arquivo-modelo original) | `quantidadeItens` |
      | DIAS | `slaDias` |
      Na época desta importação (item 33), a coluna "Data de Recebimento no
      Estoque" não existia na planilha-modelo — por decisão do solicitante
      ("esse será lançado manualmente pelo operador... terá pedidos que
      poderão ter prazos menores e outros padrões"), ficava em branco e era
      preenchida à mão na prévia. **Atualizado no item 34** abaixo: o
      solicitante acrescentou a coluna "Rec. Estoque" ao arquivo-modelo, e
      agora ela é lida automaticamente quando presente (continua editável
      na prévia, para arquivos sem essa coluna ou ajuste pontual). A Data do
      Pedido e o SLA seguem pré-preenchidos a partir da planilha, mas
      editáveis, pelo mesmo motivo.
    - **Prévia editável antes de efetivar:** depois de carregado o
      arquivo, aparece uma prévia com todos os pedidos lidos, com botões
      "Cancelar" (descarta tudo, nada é gravado) e "Enviar" (grava todos de
      uma vez no Firestore, via `writeBatch`, em lotes de até 450 operações
      por chamada). Data do Pedido, Rec. Estoque e SLA (dias) são editáveis
      diretamente na prévia; os demais campos vêm fixos da planilha (para
      corrigi-los, é preciso ajustar o arquivo de origem e reimportar).
    - **Correção pós-entrega (botão "Enviar" sem feedback visual):** o
      solicitante reportou que o botão "Enviar" parecia clicável mas não
      fazia nada quando havia campo obrigatório em branco (ex.: Rec.
      Estoque) — causa raiz: faltava CSS para botão desabilitado (um botão
      com `disabled` tinha a mesma aparência de um habilitado) e não havia
      nenhuma mensagem explicando o motivo do bloqueio (só duplicidade
      mostrava aviso). Corrigido: regra `.btn:disabled` em `styles.css`
      (válida para qualquer botão do sistema, não só este) e o mesmo
      parágrafo de aviso agora também lista, campo a campo e pedido a
      pedido, o que falta preencher quando o motivo do bloqueio não é
      duplicidade.
    - **Duplicidade bloqueia a importação inteira:** decisão explícita do
      solicitante ("Bloquear a importação inteira"). Se qualquer "Número
      do pedido" do arquivo já existir no Firestore, **ou** se duas linhas
      do próprio arquivo tiverem o mesmo número, a importação é bloqueada
      por completo — o botão "Enviar" fica desabilitado e a lista de
      números duplicados é exibida — até o arquivo ser corrigido e
      reenviado. Nenhum pedido é gravado parcialmente nesse caso.
    - **Novos campos exibidos no Painel Consolidado:** nova coluna
      "Modalidade" na tabela (ao lado de Cliente) e sub-linhas discretas
      sob o nome do Cliente com o Representante e a data/hora de
      "Cadastro" (mesmo padrão na versão em cartão do "modo celular"). O
      "ID" e o "Parceiro - Código" não aparecem em nenhuma coluna/sub-linha
      (o segundo propositalmente oculto, por pedido do solicitante), mas
      **ambos são localizáveis pela busca** do Painel Consolidado — buscar
      por um ID ou código de parceiro encontra o pedido correspondente.
      Em "Editar Pedido", uma seção somente-leitura "Dados da importação"
      mostra os quatro campos (ID, Parceiro - Código, Modalidade,
      Representante) apenas para pedidos que vieram de uma importação —
      pedidos lançados manualmente não mostram essa seção.
    - **Alerta de pedido de grande volume (> 15 caixas):** por decisão
      explícita do solicitante (opção recomendada), um pop-up de alerta
      (título e texto em vermelho) aparece assim que "Finalizar
      Organização" é concluído com sucesso — nos dois pontos de entrada
      (modal "⏱️ Registro de Separação e Organização" e atalho
      "Atribuição") — sempre que a quantidade de caixas **fechadas**
      informada for maior que 15. É só um aviso de prioridade: a
      finalização em si já aconteceu antes do alerta aparecer, então
      fechá-lo ("Entendi") não desfaz nem repete nada.
    - **Integração com o sistema de logística (webhook):** ao finalizar um
      pedido **por completo** (quando a Organização é finalizada com a
      Separação já concluída — o mesmo ponto em que `finalizarPedido` já
      era chamado), o app dispara, em segundo plano e sem bloquear a
      finalização, uma chamada `GET` para a URL informada pelo
      solicitante (`...script.google.com/.../exec?m=logistica`), com os
      parâmetros `Pedido` (número do pedido), `CLIENTE`, `CAIXAS`
      (quantidade de caixas fechadas), `SOLICITAÇÃO` (data da baixa, no
      formato dd/mm/aaaa) e `status` fixo em `Pendente`. Decisões de
      design assumidas (não detalhadas pelo solicitante): a chamada usa
      `fetch(..., { mode: 'no-cors' })`, porque o endpoint é um Google Apps
      Script de terceiro cuja configuração de CORS o app não controla —
      isso evita que o navegador bloqueie o envio, mas, em contrapartida,
      só é possível detectar falha de **rede** (sem internet, domínio
      inacessível); uma eventual rejeição do lado do Apps Script não chega
      ao app, e uma falha de envio é só registrada no console do navegador
      (`console.warn`), sem exibir erro bloqueante para o operador — a
      finalização do pedido no Firestore nunca é desfeita por causa disso.
      **Esta chamada real nunca foi disparada contra a URL de produção
      informada pelo solicitante durante o desenvolvimento** — os testes
      automatizados (seção 8) interceptam e simulam esse endpoint; a
      confirmação de que a integração está de fato funcionando deve ser
      feita finalizando um pedido de teste e conferindo a chegada no
      sistema de logística.
    - **"Maquiagem" minimalista/profissional:** por pedido do solicitante,
      o alinhamento dos títulos da tabela do Painel Consolidado foi
      ajustado (cabeçalhos que quebram em mais de uma linha, por haver
      mais colunas agora, ficam com entrelinha mais compacta e alinhados
      pela base) — o restante da identidade visual (seção 4) não foi
      alterado nesta atualização; qualquer redesign mais amplo da
      aparência fica para uma próxima rodada, caso o solicitante queira
      detalhar o que entende por "maquiagem".

34. **Coluna "Rec. Estoque" na importação, exclusão de linha individual na
    prévia e correção de alinhamento do Painel Consolidado** (adicionado
    nesta atualização):
    - **Coluna "Rec. Estoque" lida da planilha:** o solicitante acrescentou
      esta coluna ao arquivo-modelo (posicionada depois de "ID" no arquivo
      dele). Quando presente, o valor é lido automaticamente e mapeado para
      `dataRecebimentoEstoque`, pré-preenchendo o campo na prévia (igual já
      acontecia com Data do Pedido e SLA) — e continua editável ali, para
      arquivos sem essa coluna ou quando o valor precisar de ajuste. Aceita
      célula de data (igual a "Cadastro") ou texto `dd/mm/aaaa`/`aaaa-mm-dd`.
    - **Caixa "Excluir" em cada linha da prévia de importação:** nova
      coluna "Excluir" (depois de "ID", por pedido do solicitante) com uma
      caixa de seleção em cada linha. Por decisão explícita do solicitante
      ("não ter que retirar tudo por causa de um item"), marcar essa caixa
      tira **apenas aquela linha** do envio, sem precisar cancelar a
      importação inteira: a linha fica visualmente esmaecida/tachada (mas
      pode ser desmarcada), e passa a ficar de fora tanto da validação de
      campos obrigatórios/duplicidade quanto do que é de fato gravado ao
      clicar em "Enviar". Isso inclui destravar o botão "Enviar" quando a
      linha excluída era justamente a causa do bloqueio (ex.: marcar
      "Excluir" numa das duas linhas com "Número do pedido" duplicado
      libera o envio do restante do lote). A mensagem de sucesso informa
      quantos pedidos foram importados e quantos ficaram de fora por terem
      sido marcados como "Excluir".
    - **Alinhamento e quebra de texto no Painel Consolidado:** por pedido
      do solicitante ("corrija os textos justificando e deixando
      centralizados... sem quebras"), os títulos da tabela do Painel
      Consolidado (ex.: "Recebimento", "Vencimento", "Organização") não
      quebram mais no meio da palavra — a causa raiz era a tabela em
      `table-layout: fixed` com colunas definidas só em percentual, que
      ficavam estreitas demais para o título caber em uma linha depois que
      mais colunas foram adicionadas (itens 32 e 33). A correção dá à
      tabela uma largura mínima real (`min-width`), garantindo espaço
      suficiente para cada título em uma linha só; em telas mais estreitas
      que essa largura mínima, quem rola é a barra horizontal do quadro da
      tabela (`.tabela-wrapper`, já existente), em vez do título quebrar ou
      o conteúdo ficar espremido. Título e dado de cada coluna também
      passam a ficar centralizados entre si — exceto Cliente e Observação
      (texto livre/variável, mantidos à esquerda para facilitar a leitura) e
      Ações (mantida à direita, padrão já usado para botões). O título da
      coluna "SLA (dias úteis)" foi encurtado para "SLA (dias)" (mesmo texto
      já usado na prévia de importação) para caber confortavelmente em uma
      linha só. Esta correção é específica da tabela do Painel Consolidado
      (`#tabelaPedidos`) — as demais tabelas do sistema (Histórico,
      Colaboradores etc.) não foram alteradas, pois não apresentavam o
      mesmo problema.
    - **Barra de rolagem horizontal "espelho" acima da tabela:** consequência
      direta da largura mínima acrescentada no ponto anterior — com mais
      pedidos na lista, a barra de rolagem horizontal de verdade
      (`.tabela-wrapper`) só aparece depois da **última linha** da tabela,
      o que ficava longe da tela com muitos pedidos (ex.: 615), exigindo
      rolar a página toda só para conseguir rolar a tabela para o lado. Por
      pedido do solicitante, foi acrescentada uma segunda barra de rolagem,
      só visual (sem conteúdo nela), fixa logo abaixo do texto explicativo
      da seção "Pedidos" — sempre visível, independente da quantidade de
      linhas. As duas barras ficam sincronizadas nos dois sentidos: rolar
      uma rola a outra junto (`configurarRolagemSuperiorTabelaPedidos` em
      `app.js`).

35. **Correção de um gap real na integração com o sistema de logística e
    layout compacto do Painel Consolidado** (adicionado nesta atualização):
    - **Gap encontrado e corrigido — pedido finalizado por "Editar Pedido"
      não avisava a logística:** investigando por que um pedido de teste do
      solicitante não apareceu no sistema de logística, foi encontrado um
      caminho do sistema que também finaliza um pedido (`status:
      'finalizado'`) sem nunca ter passado pela função que dispara o aviso
      (`notificarSistemaLogistica`, item 33): corrigir manualmente em
      "Editar Pedido" os registros de Separação e Organização até as duas
      etapas ficarem completas finaliza o pedido automaticamente (mesma
      regra do fluxo normal), mas esse caminho específico nunca chamava o
      webhook. **Corrigido:** `salvarPedido` (`app.js`) agora dispara o
      aviso também quando a finalização acontece por essa correção manual —
      o pedido de teste do solicitante que não apareceu no outro sistema
      pode ter sido finalizado exatamente por este caminho, ainda sem a
      correção. Verificado com um teste automatizado dedicado (ver seção 8)
      que finaliza um pedido só por "Editar Pedido" (sem usar o modal "⏱️"
      nem o atalho "Atribuição") e confirma que o webhook é chamado, com os
      parâmetros corretos.
    - **Checklist do que falta para a integração funcionar de ponta a
      ponta** (o que está do nosso lado já está pronto e testado; o que
      falta depende do ambiente do solicitante, fora do alcance direto
      desta sessão de desenvolvimento):
      1. ✅ O app dispara a chamada corretamente em todo caminho que
         finaliza um pedido (modal, atalho de Atribuição e, a partir desta
         correção, edição manual) — confirmado pelos testes automatizados.
      2. ⚠️ **O arquivo `app.js` publicado precisa ser exatamente o mais
         recente**, sem truncar nem misturar versões — já identificado
         durante esta sessão que havia divergência entre o que estava
         publicado e o que foi entregue; recomendado reenviar os 3 arquivos
         (`app.js`, `index.html`, `styles.css`) de uma vez só a cada
         atualização, nunca só um dos três.
      3. ⚠️ **A implantação ("Deploy") do Google Apps Script precisa estar
         configurada para aceitar a chamada**: acesso "Qualquer pessoa"
         (Anyone), e a versão implantada (não só salva no editor) precisa
         ser a mais recente — um Apps Script editado mas não reimplantado
         continua respondendo com o código ANTIGO.
      4. ⚠️ **A função `doGet(e)` do Apps Script precisa ler exatamente os
         nomes de parâmetro enviados** — `Pedido`, `CLIENTE`, `CAIXAS`,
         `SOLICITAÇÃO` e `status` (maiúsculas/acentos importam) — e gravá-
         los nas colunas certas da planilha/painel de logística. Como o
         envio usa `mode: 'no-cors'` (decisão de design do item 33, pela
         falta de controle sobre o CORS de um Apps Script de terceiro), o
         navegador NUNCA informa se o Apps Script aceitou ou rejeitou os
         dados — só se a rede estava disponível.
      5. ⚠️ **Validação fim a fim só é possível no ambiente real do
         solicitante** — este ambiente de desenvolvimento não tem acesso de
         rede a `script.google.com` (bloqueio do proxy do ambiente,
         confirmado nesta sessão), então a chamada real nunca pôde ser
         testada contra a URL de produção informada. O protocolo de teste
         recomendado: abrir as Ferramentas do Desenvolvedor do navegador
         (F12) → aba "Rede"/"Network" → finalizar um pedido de teste →⁣
         confirmar que uma chamada para `script.google.com` aparece na
         lista (mesmo com resposta "opaca", por causa do `no-cors`, ela
         aparece como tentativa); depois, no editor do Apps Script, abrir
         "Execuções"/"Executions" e confirmar que a chamada chegou e não
         deu erro do lado de lá. Se a chamada aparece no navegador mas NÃO
         aparece nas Execuções do Apps Script, o problema está na
         implantação (pontos 3/4 acima); se nem aparece no navegador, o
         problema está no arquivo publicado (ponto 2 acima).
    - **Layout compacto do Painel Consolidado — menos colunas, sem precisar
      rolar:** por pedido do solicitante (o layout anterior, mesmo com os
      ajustes dos itens 33/34, ainda exigia rolar a barra horizontal no dia
      a dia, atrasando o fluxo do operador), as colunas "Modalidade",
      "Recebimento", "SLA (dias)" e "Observação" deixaram de existir como
      colunas próprias da tabela — a tabela caiu de 14 para **10 colunas**.
      O conteúdo não foi removido, só reorganizado em sub-linhas dentro de
      duas colunas já existentes:
      - **Nº Pedido:** Observação acima do número (só quando houver — "se
        tiver", por pedido explícito do solicitante) e SLA abaixo, sem
        rótulo (ex.: "5 dias").
      - **Cliente:** Data de Recebimento no Estoque acima do nome (só a
        data, rótulo curto "Receb.:"), seguida do nome do cliente, das
        sub-linhas já existentes de Representante/Cadastro (item 33, quando
        o pedido veio de importação em lote) e, por fim, a Modalidade, sem
        nenhum rótulo — só o texto trazido da planilha.
      A largura mínima da tabela caiu de 1680px para **1240px**, reduzindo
      bastante a necessidade de rolagem horizontal na maioria dos monitores
      (a barra de rolagem e a barra "espelho" acima dela, do ponto
      anterior, continuam existindo como reforço para telas mais estreitas
      ou com zoom do navegador maior, mas tendem a não ser acionadas no uso
      normal). A extração em Excel **não foi alterada** — continua trazendo
      Modalidade, Recebimento, SLA e Observação como colunas próprias da
      planilha exportada, já que ali o espaço não é limitado como na tela.
    - **Decisões de design assumidas** (não detalhadas pelo solicitante):
      rótulo curto "Receb.:" para a Data de Recebimento no Estoque (o
      solicitante pediu "somente a data", sem especificar se um rótulo
      curto deveria acompanhar — mantido por consistência com os já
      existentes "Repr.:"/"Cadastro:" na mesma coluna); SLA mostrado como
      "N dias" (em vez do número isolado), para não ficar ambíguo logo
      abaixo do número do pedido, já que o pedido do solicitante foi só não
      repetir o rótulo/título da coluna ("SLA"), não omitir a unidade.

36. **Cabeçalho fixo ao rolar, tabela mais compacta, alinhamento do título
    "Cliente"/"Ações" e esclarecimento sobre o pedido 8837** (adicionado
    nesta atualização):
    - **Cabeçalho da tabela de Pedidos agora fica fixo ("congela") ao
      rolar:** por pedido do solicitante ("quando o operador... descer a
      tela para visualizar outros pedidos, os títulos acompanham junto"),
      os títulos da tabela (Nº Pedido, Cliente, Status etc.) permanecem
      visíveis no topo enquanto o operador rola a lista para ver pedidos
      mais abaixo. **Causa raiz investigada:** o `thead th` já tinha
      `position: sticky; top: 0` há bastante tempo no código, mas isso nunca
      funcionava de fato — o quadro da tabela (`.tabela-wrapper`) definia só
      `overflow-x: auto` (sem `overflow-y` explícito), e pela especificação
      de CSS isso faz o navegador considerar o eixo vertical também como
      rolável, só que sem altura própria limitada; na prática, quem rolava
      era a PÁGINA inteira, levando a tabela — cabeçalho incluso — junto, em
      vez do cabeçalho "prender" no topo. **Correção:** o quadro específico
      da tabela de Pedidos (`#tabelaPedidosWrapper` — só ele, não as demais
      tabelas do painel, que não têm esse volume de linhas) passou a ter uma
      altura máxima de verdade (`65vh`, com um piso mínimo de `320px` para
      não ficar pequeno demais em telas baixas) com rolagem vertical própria
      — como "congelar painéis" numa planilha. Agora o cabeçalho realmente
      permanece fixo enquanto o conteúdo rola por baixo dele, dentro dessa
      área. A barra de rolagem horizontal (e a barra "espelho" acima dela,
      item 34) continuam funcionando normalmente, sem alteração.
    - **Tabela mais compacta, para reduzir a necessidade de rolagem
      horizontal:** por pedido do solicitante ("a barra aparece por
      pouco... ajustando os títulos mais próximos para caber todos sem
      precisar da barra"), o espaçamento interno de cada célula (cabeçalho e
      dado) foi reduzido, liberando espaço que permitiu baixar a largura
      mínima da tabela de **1240px para ~1180px**, sem voltar a cortar ou
      quebrar nenhum título. Testado numa janela de 1366px de largura (uma
      resolução comum de monitor de escritório): a tabela passou a caber
      inteira, sem precisar de rolagem horizontal. **Limitação honesta:** não
      foi possível testar na tela real do solicitante — em monitores ou
      zooms mais estreitos que isso, a barra de rolagem (e sua "espelho")
      continuam existindo como reforço, exatamente como antes; a mudança
      reduz a chance/tamanho da rolagem, mas não garante eliminá-la em toda
      e qualquer tela.
    - **Título "Cliente" e "Ações" alinhados com o dado da própria coluna:**
      o solicitante apontou que o título "Cliente" ficava centralizado
      enquanto o nome do cliente abaixo dele ficava alinhado à esquerda
      ("ficou desentralizado"). Corrigido: os títulos "Cliente" e "Ações"
      (`<th class="col-cliente">`/`<th class="col-acoes">`, novo em
      `index.html`) agora seguem o mesmo alinhamento do dado da coluna —
      "Cliente" à esquerda, "Ações" à direita — igual ao que já valia para
      as células do corpo da tabela desde o item 34. As demais colunas
      continuam centralizadas, sem alteração.
    - **Esclarecimento sobre o pedido 8837 (ainda sem aparecer no sistema de
      logística):** o solicitante reenviou os 4 arquivos atualizados
      (`app.js`, `index.html`, `styles.css`, `README.md`) e confirmou que o
      pedido 8837 continua sem aparecer no painel externo. **Isto é
      esperado, e não um novo problema:** o pedido 8837 foi finalizado ANTES
      da correção do gap do webhook (item 35) existir — ou seja, ele nunca
      chegou a disparar o aviso para a logística, e, por ser um fato já
      ocorrido no passado, não há como esse aviso "nascer" retroativamente
      depois que a correção entra em vigor. O teste válido para confirmar
      que a correção está funcionando é com um pedido **finalizado depois**
      de os arquivos corrigidos estarem realmente publicados — não com o
      8837. Recomenda-se: (1) confirmar que a implantação está com os
      arquivos mais recentes (ponto 2 do checklist do item 35); (2)
      finalizar um pedido de teste novo; (3) seguir o protocolo do item 35
      (F12 → Rede, depois Execuções do Apps Script) para confirmar, ponta a
      ponta, se a chamada chega e é aceita pelo Apps Script. Nenhum teste
      automatizado cobre esse ponto especificamente porque ele depende do
      ambiente de produção do solicitante, fora do alcance desta sessão.
    - **Decisão de design assumida** (não detalhada pelo solicitante):
      altura máxima do cabeçalho fixo em `65vh` (proporcional à tela, com
      piso de `320px`) — o pedido foi só "os títulos acompanham junto", sem
      especificar quantas linhas devem ficar visíveis por vez; este valor
      mostra uma quantidade razoável de pedidos por rolagem tanto em
      monitores grandes quanto em notebooks menores, mas pode ser ajustado
      facilmente (uma única regra CSS, `#tabelaPedidosWrapper`) caso o
      solicitante prefira mostrar mais ou menos linhas de uma vez.

Todas essas premissas estão comentadas diretamente no código-fonte
(`app.js`), próximo à lógica correspondente, para facilitar consultas
futuras.

## 4. Identidade visual

Como não foi fornecido o manual de marca oficial da UNISO, foi utilizada
uma paleta corporativa neutra (azul institucional, cinzas e branco) como
placeholder. As variáveis de cor estão centralizadas no topo de
`styles.css` (`:root`) e podem ser substituídas pelas cores oficiais a
qualquer momento, sem necessidade de alterar o restante do CSS.

## 5. Como testar localmente

Como o app usa módulos ES (`type="module"`), é necessário servir os
arquivos por HTTP (abrir o `index.html` diretamente com `file://` bloqueia
os imports em alguns navegadores). Duas opções simples:

```bash
# Opção 1 - usando Python (já vem instalado na maioria dos sistemas)
cd controle-sla-pedidos-uniso
python3 -m http.server 8080
# depois acesse http://localhost:8080

# Opção 2 - usando a extensão "Live Server" do VS Code
```

Após configurar as credenciais (seção 1), abra o navegador com o Console
(F12) visível para acompanhar eventuais mensagens de erro de conexão.

### Dados de demonstração (opcionais)

Não há dados fictícios carregados automaticamente. Para popular o sistema
com 3 pedidos de exemplo (úteis para validar visualmente o dashboard e as
cores de SLA), abra o Console do navegador com o app carregado e execute:

```js
carregarPedidosDemonstracao()
```

Os pedidos de teste são criados com o prefixo `DEMO-` no número do pedido
para facilitar a exclusão manual antes do uso em produção.

## 6. Publicação (GitHub Pages ou Firebase Hosting)

**GitHub Pages:**
1. Crie um repositório e envie os arquivos deste diretório (mantendo os
   nomes/estrutura).
2. Em Settings → Pages, selecione a branch e a pasta raiz.
3. Preencha `firebase-config.js` com as credenciais reais antes do commit
   (essas credenciais são públicas por natureza — a segurança real está
   nas regras do Firestore, não na ocultação dessas chaves).

**Firebase Hosting:**
```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # aponte o diretório público para esta pasta
firebase deploy
```

## 7. Manutenção e extensão

- **Alterar faixas de SLA (dias/cores):** edite o objeto `CONFIG_SLA` no
  início de `app.js`.
- **Alterar cores/rótulos do Status de Separação:** edite o objeto
  `CONFIG_SEPARACAO`, logo abaixo de `CONFIG_SLA` em `app.js`.
- **Alterar cores/rótulos do Status de Organização:** edite o objeto
  `CONFIG_ORGANIZACAO`, logo abaixo de `CONFIG_SEPARACAO` em `app.js`.
- **Alterar as métricas do Painel de Tempos:** as funções
  `calcularTemposPorOperador`, `calcularHistoricoTempos` e
  `renderizarPainelTempos` em `app.js` concentram todos os cálculos desse
  painel.
- **Alterar paleta de cores/tema:** edite as variáveis CSS em `:root` e nos
  blocos `[data-tema="escuro"]` de `styles.css`.
- **Considerar feriados no cálculo de dias úteis:** ajuste a função
  `ehDiaUtil()` em `app.js` para consultar uma lista de feriados.
- Todas as funções em `app.js` têm nomes descritivos em português e
  comentários explicando seu propósito, conforme solicitado.

## 8. Validação realizada

- Revisão manual da sintaxe de `index.html`, `styles.css`, `app.js` e
  `firestore.rules`, e checagem automática de sintaxe do JavaScript
  (`node --check`).
- Conferência lógica dos cálculos de dias úteis, vencimento e classificação
  de SLA com casos de teste manuais (datas de exemplo dentro do prazo, no
  limite e em atraso).
- Testes automatizados (Playwright, com o Firestore simulado) cobrindo:
  navegação entre as três telas, colunas Status/Operador/Organização na
  tabela e nos cartões (modo celular), fluxo completo de Registro de
  Separação (iniciar, tentar iniciar de novo, finalizar, pedido
  inexistente), fluxo completo de Organização (bloqueio antes da separação
  finalizada, iniciar, finalizar com finalização automática do pedido),
  botão "Reabrir" em pedidos finalizados, independência entre Status de
  Separação/Organização e Situação (SLA), Painel de Tempos (KPIs, tempo
  médio por operador com percentuais, histórico diário) validado contra
  dados conhecidos, sincronização dos dois conjuntos de filtros (Painel
  Operacional e Painel Consolidado), ausência de rolagem horizontal na
  tabela de pedidos, dark mode, modo celular, rolagem/cores do rodapé, e
  resiliência da interface quando o Firebase está inacessível (rede
  bloqueada).
- **Cadastro de Colaboradores (item 27):** testes automatizados (Playwright,
  Firestore simulado com múltiplas coleções) cobrindo: existência do botão e
  da tela; renderização da lista pré-cadastrada; adicionar colaborador;
  bloqueio de nome duplicado; lista suspensa mostrando somente colaboradores
  ativos, em ordem alfabética; registro de separação/organização escolhendo
  um nome da lista; desativar um colaborador (some da lista suspensa, mas
  continua "Inativo" na tela Colaboradores); edição de um pedido com um nome
  de operador não cadastrado, confirmando que ele aparece marcado
  "(não cadastrado)" e não é apagado; botão "Importar nomes dos pedidos"
  cadastrando corretamente um nome só usado em pedidos antigos; renomear e
  excluir um colaborador; e uma regressão confirmando que o bloqueio de
  número de pedido duplicado (item 26) continua funcionando. Também foi
  testado em separado o cenário de **lista de colaboradores ainda vazia**
  (primeiro uso após o deploy): mensagem de lista vazia exibida
  corretamente, lista suspensa mostrando apenas o texto de instrução sem
  travar, e abertura do modal "Editar Pedido" com os campos de operador em
  branco, sem erros. Em todos os casos, zero erros JavaScript não tratados.
- **Coluna "Atribuição" (item 28):** testes automatizados (Playwright)
  cobrindo o fluxo completo pela nova coluna: Atribuir Separação → Finalizar
  Separação → Atribuir Organização → Finalizar Organização, com o pedido
  sendo finalizado automaticamente ao final (badge "✓ Concluído" no lugar do
  botão); validação de campo obrigatório (não deixa confirmar sem escolher
  colaborador); modal de "Finalizar" mostrando o responsável já preenchido e
  bloqueado; cadastro de um novo colaborador direto pela opção "+ Cadastrar
  novo colaborador" dentro do modal, refletido corretamente na tela
  Colaboradores; conferência de que os avisos de confirmação mostram
  exatamente as mensagens esperadas em cada etapa e fecham ao clicar no "✕";
  e regressão confirmando que o modal "Registro de Separação e Organização"
  (⏱️) e o bloqueio de número de pedido duplicado continuam funcionando sem
  nenhuma alteração. Zero erros JavaScript não tratados.
  - Durante essa validação foi encontrado e corrigido um bug de CSS: como a
    classe `.aviso-atribuicao` já definia `display`, o atributo `hidden`
    (mesma especificidade) deixava de esconder visualmente o aviso apesar de
    a propriedade JavaScript estar correta — mesma armadilha que o app já
    neutraliza para os modais (`.modal-overlay[hidden]`). Corrigido com a
    mesma técnica: uma regra `.aviso-atribuicao[hidden] { display: none; }`.
- Durante essa validação foi encontrado e corrigido um bug pré-existente
  (não introduzido nesta atualização, mas exposto pelos novos testes
  visuais): no modo celular, o campo de busca ficava com ~220px de altura
  devido a uma regra CSS (`flex: 1 1 220px`) que passa a valer como altura
  quando o toolbar muda para layout em coluna nesse modo. Corrigido com uma
  regra específica (`flex-basis: auto`) para o modo celular.
- **Extração de dados em Excel (item 29):** testes automatizados
  (Playwright, com a biblioteca SheetJS simulada) cobrindo: geração do
  arquivo com nome no padrão esperado; conteúdo correto da aba "Pedidos"
  (situação de SLA, resultado da finalização, operadores, datas/horas e
  tempos de cada etapa calculados corretamente, célula vazia quando uma
  etapa ainda está incompleta); conteúdo correto da aba "Resumo" (total,
  finalizados, em aberto, antecipados, tempo médio por operador); a
  extração respeitando um filtro de busca aplicado (traz só o pedido
  filtrado); aviso de erro exibido corretamente quando o CDN da biblioteca
  está bloqueado (sem travar a página nem gerar erro JavaScript não
  tratado); e regressão confirmando que o fluxo da coluna "Atribuição"
  (item 28) continua funcionando sem alteração. Zero erros JavaScript não
  tratados em todos os cenários.
  - **Não testado nesta sessão:** o carregamento real da biblioteca a
    partir do CDN público (`cdnjs.cloudflare.com`), pois o ambiente de
    desenvolvimento não tem acesso a esse domínio específico — os testes
    acima substituem a biblioteca por uma versão simulada equivalente.
    Recomenda-se, após publicar os arquivos, clicar uma vez em "Extrair
    Dados (Excel)" no navegador real para confirmar que o download ocorre
    normalmente.
- **Quantidade de Caixas e Peso da Carga (item 30):** testes automatizados
  (Playwright, com o Firestore simulado) cobrindo: bloqueio ao tentar
  adicionar um novo pedido sem informar a Quantidade de Caixas e criação
  correta do pedido (com o valor persistido) após preenchê-la; pedido
  "legado" sem `quantidadeCaixas` abrindo em "Editar Pedido" com o campo em
  branco, bloqueio ao tentar salvar sem preenchê-lo e salvamento correto
  após preenchido; no modal "⏱️ Registro de Separação e Organização",
  bloqueio de "Finalizar Organização" sem informar o peso (com a mensagem
  de erro esperada) e gravação correta do peso, do status "organizado" e da
  finalização automática do pedido após informá-lo; na coluna "Atribuição",
  confirmação de que o campo de peso permanece oculto na ação "Atribuir
  Separação" e aparece apenas na ação "Finalizar Organização" (incluindo o
  bloqueio ao confirmar sem peso e a gravação correta ao informá-lo, com o
  aviso de confirmação exibindo o texto esperado); Painel de Tempos exibindo
  a soma correta de caixas por colaborador nas duas listas (Separação e
  Organização) e a soma correta de peso na lista de Organização; extração em
  Excel contendo as novas colunas "Quantidade de Caixas" e "Peso da Carga
  (kg)" na aba "Pedidos" com os valores corretos, e os novos indicadores
  "Total de caixas (volumetria)" e "Peso total aferido (kg)" na aba
  "Resumo"; e regressão confirmando que o bloqueio de número de pedido
  duplicado continua funcionando. Zero erros JavaScript não tratados em
  todos os cenários.
  - Durante a escrita dos testes foi identificado e corrigido um bug na
    navegação entre telas usada pelo próprio roteiro de teste (não um bug
    do app): os botões "📊 Painel Consolidado" e "⏳ Painel de Tempos"
    alternam entre a tela correspondente e o Painel Operacional — clicar
    de novo no botão da tela já ativa volta para o Painel Operacional em
    vez de manter a tela aberta. O roteiro de teste foi ajustado para não
    clicar duas vezes no mesmo botão de navegação quando a tela já estava
    aberta.
  - Proativamente, foi aplicada a mesma correção de CSS já usada para
    `.aviso-atribuicao[hidden]` (item 28) ao novo campo de peso dentro do
    modal de Atribuição: como `.atribuicao-corpo label` já define
    `display: flex`, foi adicionada a regra
    `.atribuicao-corpo label[hidden] { display: none; }` para garantir que
    o atributo `hidden` continue escondendo visualmente o campo — e os
    testes automatizados confirmaram que o campo de peso realmente fica
    oculto/visível conforme esperado.
- **Cubagem e peso cubado (item 31):** testes automatizados (Playwright,
  com o Firestore simulado) cobrindo: no modal "⏱️ Registro de Separação e
  Organização", bloqueio de "Finalizar Organização" quando o peso está
  preenchido mas a cubagem (altura/largura/comprimento) não está (mensagem
  de erro específica); prévia ao vivo do peso cubado calculando corretamente
  (0,5 × 0,4 × 0,6 m × 300 = 36 kg) conforme as dimensões são digitadas,
  antes mesmo de finalizar; gravação correta das 3 dimensões e do peso
  cubado calculado no Firestore ao finalizar, mantendo o peso real intacto;
  na coluna "Atribuição", os 3 campos de cubagem aparecendo apenas no passo
  "Finalizar Organização", com o mesmo bloqueio e a mesma prévia ao vivo
  (0,6 × 0,5 × 0,8 m × 300 = 72 kg), e gravação correta; em "Editar Pedido",
  exibição do peso cubado já gravado ao abrir, recálculo ao vivo da prévia
  ao corrigir as dimensões manualmente (1 × 1 × 1 m × 300 = 300 kg) e
  gravação correta da correção; Painel de Tempos somando corretamente o
  peso cubado total por colaborador na lista de Organização (testado com 3
  pedidos de um mesmo colaborador, soma = 36 + 72 + 300 = 408 kg); extração
  em Excel contendo as novas colunas "Altura (cm)", "Largura (cm)",
  "Comprimento (cm)" e "Peso Cubado (kg)" na aba "Pedidos" com os valores
  corretos, e o novo indicador "Peso cubado total (kg)" na aba "Resumo"; e
  regressão confirmando que a obrigatoriedade da Quantidade de Caixas (item
  30) continua funcionando. Zero erros JavaScript não tratados em todos os
  cenários.
  - Como a cubagem passou a ser obrigatória junto com o peso ao finalizar a
    Organização, os testes automatizados do item 30 (acima) foram
    atualizados para também preencher altura/largura/comprimento nos
    cenários de finalização — sem isso, eles passariam a ficar bloqueados
    pela nova validação. Reexecutados e confirmados passando normalmente
    após o ajuste.
- **Separação entre Quantidade de Itens e Quantidade de Caixas fechada
  (item 32):** testes automatizados (Playwright, com o Firestore simulado),
  28 verificações, cobrindo: rótulo "Quant. Itens" no cadastro inline e
  ausência do id antigo `#inlineQuantidadeCaixas`; rótulo "Quantidade de
  Itens\*" em "Editar Pedido" mostrando o valor cadastrado e ausência do id
  antigo `#campoQuantidadeCaixas`; no modal "⏱️ Registro de Separação e
  Organização", bloqueio de "Finalizar Organização" citando especificamente
  "quantidade de caixas" quando só o peso foi preenchido (distinto do
  bloqueio por peso); prévia do peso cubado confirmando que **não** é
  multiplicada pela quantidade de caixas fechada (18 kg para 1 caixa de
  0,5×0,4×0,3 m, mesmo informando 12 caixas fechadas); gravação correta de
  `quantidadeCaixas` (fechada = 12) distinta de `quantidadeItens` (cadastro
  = 10) no mesmo pedido; Painel de Tempos exibindo "12 cx" (a quantidade
  fechada) e não "10" (a de itens) nas listas de Separação **e**
  Organização; mesmo fluxo e mesmo bloqueio repetidos com sucesso pela
  coluna "Atribuição"; correção manual da Quantidade de Caixas em "Editar
  Pedido" (de 7 para 8) refletindo corretamente no Painel de Tempos (soma
  recalculada de 12+7 para 12+8 = 20 cx); pedido "legado" simulado (só com
  o campo antigo `quantidadeCaixas` = 99, sem nunca ter passado pelo item
  32) mostrando 99 em "Quantidade de Itens" via aproveitamento automático;
  e extração em Excel com a nova coluna "Quantidade de Itens", a coluna
  renomeada "Quantidade de Caixas (fechada)" e o novo indicador "Total de
  itens cadastrados (lançamento do pedido)" na aba "Resumo". Zero erros
  JavaScript não tratados em todos os cenários.
  - **Decisões confirmadas com o solicitante antes da implementação:** (1)
    o peso cubado não deveria ser multiplicado pela quantidade de caixas
    fechada ("não, manter como está hoje"); (2) tanto a lista de Separação
    quanto a de Organização do Painel de Tempos deveriam refletir a nova
    contagem fechada, informada só ao finalizar a Organização.
  - **Decisão técnica (não é uma pergunta de negócio, mas registrada por
    transparência):** o campo novo reaproveita o nome `quantidadeCaixas` já
    existente no Firestore (em vez de usar um nome totalmente novo), porque
    nenhum pedido em produção chegou a ter esse campo preenchido até agora
    (confirmado pelo Painel de Tempos, que mostrava "0 cx" para todos os
    colaboradores) — ou seja, não há dado real cujo significado seria
    reinterpretado. Isso evitou qualquer necessidade de migração de dados e
    manteve "de graça" a troca de origem do "N cx" no Painel de Tempos (que
    já lia esse mesmo nome de campo, sem precisar de nenhuma alteração de
    lógica).
- **Importação em lote, novos campos de referência, alerta de grande
  volume e webhook de logística (item 33):** testes automatizados
  (Playwright, com o Firestore simulado — incluindo `writeBatch` — e a
  biblioteca **real** do SheetJS, mesma versão exata da CDN, para ler
  arquivos `.xlsx` de verdade em vez de um mock), 54 verificações,
  cobrindo: leitura de uma planilha com colunas em ordem embaralhada e
  mapeamento correto de todos os campos pelo nome do cabeçalho (incluindo a
  variação com erro de digitação "Quantidade de Iitens"); prévia mostrando
  Data do Pedido e SLA pré-preenchidos a partir da planilha e Rec. Estoque
  em branco (exige preenchimento manual); botão "Enviar" desabilitado
  enquanto houver campo obrigatório em branco e habilitado depois de
  preenchido; gravação em lote bem-sucedida e os 3 pedidos aparecendo
  corretamente no Painel Consolidado (nova coluna "Modalidade", sub-linhas
  de Representante e Cadastro sob o Cliente); busca por "ID" e por
  "Parceiro - Código" (nenhum dos dois visível na tabela) encontrando o
  pedido correspondente; seção "Dados da importação" aparecendo em
  "Editar Pedido" só para pedidos importados (ausente num pedido lançado
  manualmente no mesmo teste); bloqueio da importação **inteira** com
  duplicidade **dentro do próprio arquivo** e também contra um "Número do
  pedido" **já existente** no sistema, em ambos os casos sem gravar nada
  (contagem de pedidos antes/depois idêntica) e com "Cancelar" descartando
  a prévia; alerta de pedido de grande volume aparecendo com mais de 15
  caixas fechadas, tanto pelo modal "⏱️" quanto pelo atalho "Atribuição"
  (citando o número do pedido e a quantidade no texto), e **não** aparecendo
  com 15 ou menos; chamada ao webhook de logística interceptada e simulada
  (nunca disparada contra a URL real) confirmando os parâmetros `Pedido`,
  `CLIENTE`, `CAIXAS` e `status=Pendente` corretos em dois pedidos
  diferentes; e extração em Excel incluindo as novas colunas "ID",
  "Parceiro - Código", "Modalidade" e "Representante" na aba "Pedidos" com
  os valores corretos. Zero erros JavaScript não tratados em todos os
  cenários (à parte do aviso esperado de rede ao tentar alcançar a URL real
  do webhook nos testes de regressão do item 32, que não mockam esse
  endpoint — inofensivo, pois a chamada é propositalmente "fire-and-forget"
  e não bloqueia nada).
  - Reexecutados os 28 testes automatizados do item 32 após estas
    alterações (regressão): todos continuam passando normalmente.
  - **Decisões confirmadas com o solicitante antes da implementação** (via
    perguntas de esclarecimento): (1) a coluna "Quantidade de Itens" da
    planilha-modelo é dado fictício de amostra, mapeada diretamente sem
    tratamento especial; (2) qualquer duplicidade de "Número do pedido"
    bloqueia a importação inteira, em vez de importar só os pedidos novos
    ou pedir para escolher linha a linha; (3) Data do Pedido, Data de
    Recebimento no Estoque e SLA ficam editáveis na prévia, lançados/
    ajustados manualmente pelo operador, pois nem todo pedido segue o
    prazo padrão; (4) o alerta de mais de 15 caixas aparece ao finalizar a
    Organização (opção recomendada, confirmada pelo solicitante).
  - **Decisões de design assumidas** (não detalhadas pelo solicitante, ver
    item 33 na seção 3): formato `GET` com `mode: 'no-cors'` para o
    webhook de logística; parâmetro `SOLICITAÇÃO` enviado no formato
    dd/mm/aaaa; falhas de rede do webhook registradas só em
    `console.warn`, sem bloquear a finalização do pedido.
- **Coluna "Rec. Estoque", exclusão de linha na importação e alinhamento
  do Painel Consolidado (item 34):** testes automatizados (Playwright, mesma
  infraestrutura dos itens 32/33), 37 verificações, cobrindo: planilha com a
  coluna "Rec. Estoque" preenchida numa linha e em branco na outra — a
  prévia vem com o campo pré-preenchido só na linha que tinha valor na
  planilha, continuando em branco (e bloqueando o "Enviar") na linha sem
  valor, até o preenchimento manual; planilha com duplicidade de "Número do
  pedido" em que marcar "Excluir" numa das duas linhas duplicadas remove o
  aviso de bloqueio e habilita o "Enviar" sem precisar cancelar o lote
  inteiro, com o contador do botão refletindo corretamente a quantidade
  ativa (excluindo a marcada); gravação confirmando que **só** a linha não
  marcada foi de fato enviada ao Firestore (a excluída não aparece no
  Painel Consolidado) e que a mensagem de sucesso informa quantas linhas
  ficaram de fora; e, na tabela do Painel Consolidado, os 14 títulos de
  coluna centralizados e sem quebra em mais de uma linha (verificado
  contando as "linhas visuais" do texto do título via `Range.getClientRects()`,
  não por captura de tela), alinhamento de cada coluna de dados conforme o
  esperado (maioria centralizada; Cliente e Observação à esquerda; Ações à
  direita) e o quadro da tabela preparado para rolagem horizontal quando a
  tabela excede a largura visível, em vez de espremer colunas. Zero erros
  JavaScript não tratados.
  - Reexecutados os 28 (item 32) + 54 (item 33) testes automatizados
    anteriores após estas alterações (regressão): todos continuam passando
    normalmente — nenhuma funcionalidade existente foi afetada.
  - **Barra de rolagem horizontal "espelho" acima da tabela** (ajuste
    solicitado logo após a entrega do item 34): verificado à parte, por
    script Playwright ad-hoc (não incorporado às 37 verificações formais
    acima): a largura do "espelho" acompanha exatamente a largura real da
    tabela, e a rolagem sincroniza corretamente nos dois sentidos — rolar o
    "espelho" move a barra de verdade, e vice-versa.
  - **Decisão confirmada com o solicitante antes da implementação:** a
    posição da coluna "Excluir" na prévia de importação é depois de "ID",
    conforme pedido explícito.
  - **Decisões de design assumidas** (não detalhadas pelo solicitante):
    marcar "Excluir" mantém a linha visível na prévia (esmaecida/tachada,
    podendo ser desmarcada) em vez de removê-la imediatamente da tela — dá
    mais segurança contra clique por engano do que uma exclusão definitiva
    sem confirmação; título da coluna "SLA (dias úteis)" encurtado para
    "SLA (dias)" no Painel Consolidado, para caber em uma linha só sem
    aumentar demais a largura mínima da tabela.
- **Correção do gap de integração com a logística e layout compacto (item
  35):** testes automatizados (Playwright), 18 verificações, cobrindo: a
  tabela do Painel Consolidado com exatamente 10 colunas, nos títulos e na
  ordem esperados, confirmando que Modalidade/Recebimento/SLA/Observação não
  existem mais como colunas próprias; sub-linha "Receb.:" com a data
  correta no topo da coluna Cliente; Modalidade aparecendo sem nenhum
  rótulo; SLA aparecendo como "N dias" junto ao Nº Pedido, sem a palavra
  "SLA"; largura mínima da tabela reduzida (1240px, era 1680px); Observação
  aparecendo como sub-linha só quando o pedido tiver uma (um pedido sem
  observação não mostra sub-linha vazia); e, o ponto mais importante desta
  rodada, um pedido cadastrado manualmente e levado a "Finalizado" **apenas
  pela correção manual em "Editar Pedido"** (preenchendo Separação e
  Organização até as duas etapas ficarem completas, sem passar pelo modal
  "⏱️" nem pelo atalho "Atribuição") **dispara corretamente o webhook de
  logística** — confirmado que a chamada é feita, com o número do pedido e
  a quantidade de caixas corretos. Zero erros JavaScript não tratados.
  - Reexecutados os 28 (item 32) + 53 (item 33, 1 checagem desatualizada
    pelo novo layout foi corrigida, sem perda de cobertura) + 33 (item 34)
    testes automatizados anteriores após estas alterações (regressão):
    todos continuam passando normalmente.
  - **Decisão confirmada com o solicitante antes da implementação:** a
    reorganização exata das sub-linhas (Observação e SLA em "Nº Pedido";
    Recebimento e Modalidade em "Cliente") seguiu as posições indicadas
    explicitamente pelo solicitante, por anotações numeradas numa captura
    de tela do painel.
  - **Decisão de design assumida** (não detalhada pelo solicitante): a
    correção do gap do webhook (ponto acima) foi implementada porque é
    consequência direta e necessária do objetivo que o próprio solicitante
    descreveu para esta integração ("um programa conversando com outro" de
    forma automática, sempre que um pedido for finalizado) — não faria
    sentido o aviso à logística depender de QUAL caminho finalizou o
    pedido. Caso o solicitante prefira que a correção manual em "Editar
    Pedido" NÃO dispare o webhook (por exemplo, se achar que esse caminho é
    usado só para consertar um erro de lançamento, não uma finalização "de
    verdade"), é só avisar para reverter esse ponto específico.
- **Cabeçalho fixo, tabela mais compacta e alinhamento do título "Cliente"/
  "Ações" (item 36):** testes automatizados (Playwright, janela de 1366px de
  largura — resolução comum de monitor de escritório), 18 verificações
  novas, cobrindo: largura mínima da tabela reduzida para ~1180px (era
  1240px); nenhum título de coluna cortado ou sobreposto com o espaçamento
  mais compacto; a tabela cabendo inteira, sem rolagem horizontal, nessa
  largura de janela; título "Cliente" e dado da coluna com o mesmo
  alinhamento à esquerda; título "Ações" e dado da coluna com o mesmo
  alinhamento à direita; o quadro da tabela de Pedidos com rolagem vertical
  própria depois de popular 40 pedidos (mais do que cabe na altura máxima
  configurada); e, o ponto mais importante desta rodada, a posição do
  cabeçalho (`thead th`) permanecendo exatamente igual (variação de 0px) na
  tela antes e depois de rolar 300px para baixo dentro da lista, com a
  primeira linha de pedidos confirmadamente passando por baixo do cabeçalho
  fixo. Zero erros JavaScript não tratados.
  - Reexecutados os 28 (item 32) + 53 (item 33) + 33 (item 34, 2 checagens
    de alinhamento do título atualizadas para refletir a nova regra de
    "Cliente"/"Ações" acompanharem o dado — comportamento intencional desta
    rodada, não uma regressão) + 18 (item 35) testes automatizados
    anteriores após estas alterações (regressão): todos continuam passando
    normalmente. A verificação ad-hoc da barra de rolagem "espelho" (item
    34) também foi reexecutada — na janela de 1366px usada nos testes
    automatizados a tabela não tem mais rolagem horizontal sobrando para
    testar a sincronização, então essa verificação específica passou a usar
    uma janela mais estreita (900px) só para continuar exercitando a
    rolagem; confirmado que a sincronização nos dois sentidos continua
    funcionando normalmente.
  - **Decisão confirmada com o solicitante antes da implementação:** a
    causa do pedido 8837 não aparecer no sistema de logística ("Está
    perfeito e corretíssimo... agora resta apenas subir") foi investigada e
    esclarecida diretamente no texto desta entrega (ver item 36 na seção
    3) — não é um novo problema de código, é esperado que pedidos
    finalizados antes da correção do item 35 nunca apareçam retroativamente.
  - **Decisão de design assumida** (não detalhada pelo solicitante, ver
    item 36 na seção 3): altura máxima do cabeçalho fixo em `65vh` (piso de
    `320px`), e a redução de ~60px no min-width da tabela (1240px → 1180px)
    acompanhada da redução proporcional de espaçamento interno das células,
    para não cortar nenhum texto. **Limitação honesta:** a eliminação
    completa da barra de rolagem horizontal depende da largura real da tela
    do solicitante, não testável neste ambiente — o que foi confirmado é
    que, numa resolução comum de monitor de escritório (1366px), a tabela
    passa a caber sem rolagem.
- **A integração real com o Firebase em produção não foi testada nesta
  sessão** (o ambiente de desenvolvimento não tem acesso à internet para
  isso) — os testes acima usam um Firestore simulado. Após publicar estes
  arquivos, recomenda-se validar no navegador real: sincronização em tempo
  real entre duas abas/computadores, o fluxo de Registro de Separação
  (iniciar em um computador, finalizar em outro) e, para o item 33 em
  particular, a chegada efetiva da notificação no sistema de logística ao
  finalizar um pedido de teste de verdade (nunca testado contra a URL
  real nesta sessão).
