/**
 * app.js
 * ===========================================================================
 * Controle de SLA de Pedidos - UNISO
 * ---------------------------------------------------------------------------
 * Aplicativo web para acompanhamento operacional de prazos (SLA) de pedidos,
 * com sincronização em tempo real via Cloud Firestore.
 *
 * Este arquivo está organizado nas seguintes seções:
 *   1. Configuração centralizada das faixas de SLA
 *   2. Estado global da aplicação
 *   3. Utilitários de data (cálculo em dias úteis)
 *   4. Cálculo e classificação de SLA
 *   5. Integração com o Firebase (Authentication + Firestore)
 *   6. Operações de CRUD dos pedidos
 *   7. Renderização de interface (dashboard, painel, tabela, histórico, SVG)
 *   8. Modais (novo/editar pedido e detalhamento de grupo)
 *   9. Filtros, busca e eventos de interface
 *  10. Tema claro/escuro (dark mode) e modo celular (visualização manual)
 *  11. Dados de demonstração (opcional, não executado automaticamente)
 *  12. Inicialização da aplicação
 * ===========================================================================
 */

/**
 * IMPORTANTE: o Firebase (firebase-config.js e o SDK do Firestore, carregado
 * do CDN gstatic.com) é importado de forma DINÂMICA dentro de
 * carregarFirebaseEIniciar() (seção 5), em vez de um "import" estático no
 * topo do arquivo. Isso é proposital: um "import" estático que falha (rede
 * bloqueada, firewall corporativo, extensão de bloqueio de anúncios, erro
 * nas credenciais) impede a execução de TODO o resto do app.js - inclusive
 * funções que não têm nada a ver com o Firebase, como o dark mode, o modo
 * celular e a validação dos formulários. Com o import dinâmico, uma falha
 * ali é capturada e tratada (mostra o indicador vermelho no cabeçalho e uma
 * mensagem de erro), enquanto o restante da interface continua funcionando
 * normalmente.
 */
let db, auth, signInAnonymously, onAuthStateChanged;
let collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, serverTimestamp, query, orderBy, writeBatch;
let colecaoPedidos, colecaoColaboradores;

const NOME_COLECAO = 'pedidos';
const NOME_COLECAO_COLABORADORES = 'colaboradores';

/* =========================================================================
   1. CONFIGURAÇÃO CENTRALIZADA DAS FAIXAS DE SLA
   -------------------------------------------------------------------------
   Todos os limites de classificação visual do SLA ficam concentrados aqui
   para facilitar alterações futuras sem precisar alterar a lógica do
   restante do sistema. Todas as contagens de dias são em DIAS ÚTEIS
   (segunda a sexta-feira), sem considerar feriados.
   ========================================================================= */
const CONFIG_SLA = {
  // Regras de classificação (em dias úteis restantes até o vencimento)
  diasRestantesAmarelo: 3,        // exatamente 3 dias úteis restantes = amarelo
  diasRestantesVermelhoMin: 1,    // 1 ou 2 dias úteis restantes = vermelho
  diasRestantesVermelhoMax: 2,
  diasAtrasoMarromMax: 4,         // do 1º ao 4º dia útil de atraso = marrom
  diasAtrasoRoxoMin: 5,           // a partir do 5º dia útil de atraso = roxo

  // Cores e rótulos usados nos badges, cartões e no painel consolidado
  cores: {
    verde: { bg: '#e3f4e8', texto: '#1e7d34', label: 'No prazo' },
    amarelo: { bg: '#fff6d9', texto: '#8a6100', label: 'Atenção' },
    vermelho: { bg: '#fbe4e4', texto: '#c11e1e', label: 'Crítico' },
    'vence-hoje': { bg: '#fbe4e4', texto: '#c11e1e', label: 'Vence hoje' },
    marrom: { bg: '#efe1d5', texto: '#7a4a24', label: 'Atrasado' },
    roxo: { bg: '#ecdff5', texto: '#6a1b9a', label: 'Atrasado' },
    finalizado: { bg: '#eceff1', texto: '#546e7a', label: 'Finalizado' }
  }
};

/* =========================================================================
   1-B. CONFIGURAÇÃO DO STATUS DE SEPARAÇÃO (operacional, independente do SLA)
   -------------------------------------------------------------------------
   Controla o fluxo físico de separação do pedido (registrado pelo operador
   através do botão "Registro de Separação"), sem nenhuma relação com a
   Situação (prazo do SLA) nem com o checkbox "Concluir" definidos acima.
   ========================================================================= */
const CONFIG_SEPARACAO = {
  'a-separar': { cor: 'var(--cor-perigo)', label: 'A Separar' },
  'em-separacao': { cor: 'var(--cor-alerta)', label: 'Em Separação' },
  separado: { cor: 'var(--cor-sucesso)', label: 'Separado' }
};

/* =========================================================================
   1-C. CONFIGURAÇÃO DO STATUS DE ORGANIZAÇÃO (operacional, independente do
   SLA e da Separação)
   -------------------------------------------------------------------------
   Controla a etapa seguinte à separação: a conferência e organização do
   pedido para despacho, feita por outra pessoa (a "organizadora"),
   registrada através do mesmo painel "Registro de Separação" (que passa a
   ter uma segunda seção, "Organização"). Estruturalmente idêntica a
   CONFIG_SEPARACAO, mas mantida em um objeto separado porque representa uma
   etapa física distinta, com seu próprio operador e seus próprios horários.
   ========================================================================= */
const CONFIG_ORGANIZACAO = {
  'a-organizar': { cor: 'var(--cor-perigo)', label: 'A Organizar' },
  'em-organizacao': { cor: 'var(--cor-alerta)', label: 'Em Organização' },
  organizado: { cor: 'var(--cor-sucesso)', label: 'Organizado' }
};

/* =========================================================================
   2. ESTADO GLOBAL DA APLICAÇÃO
   ========================================================================= */
const estado = {
  pedidos: [],               // cache local dos pedidos sincronizados do Firestore
  colaboradores: [],         // cache local dos colaboradores (separadores/organizadores) cadastrados
  agrupamentoHistorico: 'recebimento',
  filtros: {
    texto: '',
    status: '',
    recebIni: '',
    recebFim: '',
    vencIni: '',
    vencFim: ''
  }
};

/* =========================================================================
   3. UTILITÁRIOS DE DATA (CÁLCULO EM DIAS ÚTEIS)
   ========================================================================= */

// Verifica se uma data (objeto Date) cai em dia útil (segunda a sexta).
function ehDiaUtil(data) {
  const diaSemana = data.getDay(); // 0 = domingo, 6 = sábado
  return diaSemana !== 0 && diaSemana !== 6;
}

// Converte uma string 'yyyy-mm-dd' em um objeto Date à meia-noite local.
function parseDataLocal(stringISO) {
  const [ano, mes, dia] = stringISO.split('-').map(Number);
  return new Date(ano, mes - 1, dia);
}

// Converte um objeto Date em string 'yyyy-mm-dd'.
function formatarISO(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

// Converte uma string 'yyyy-mm-dd' em 'dd/mm/aaaa' para exibição.
function formatarBR(stringISO) {
  if (!stringISO) return '-';
  const [ano, mes, dia] = stringISO.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Converte um Timestamp do Firebase (ou Date/ISO) em 'dd/mm/aaaa hh:mm'.
function formatarDataHoraBR(timestamp) {
  if (!timestamp) return '-';
  const data = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return data.toLocaleString('pt-BR');
}

// Igual a formatarDataHoraBR, mas fixando o fuso horário de Brasília
// (America/Sao_Paulo), independentemente do fuso configurado no computador
// de quem estiver vendo a tela. Usada nos registros de separação, para que
// o tempo medido entre operadores de computadores diferentes seja sempre
// comparável na mesma referência de horário.
function formatarDataHoraBrasilia(timestamp) {
  if (!timestamp) return '-';
  const data = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return data.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Converte um Timestamp (ou Date/ISO) em uma string 'yyyy-mm-ddThh:mm' —
 * formato aceito pelo input <input type="datetime-local"> — representando
 * o horário de BRASÍLIA daquele instante (e não o fuso do navegador de
 * quem está vendo a tela). Usada para pré-preencher os campos de correção
 * manual dos registros de separação/organização no modal "Editar Pedido".
 */
function timestampParaDatetimeLocalBrasilia(timestamp) {
  if (!timestamp) return '';
  const data = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(data);
  const obter = (tipo) => partes.find((parte) => parte.type === tipo)?.value || '00';
  return `${obter('year')}-${obter('month')}-${obter('day')}T${obter('hour')}:${obter('minute')}`;
}

/**
 * Caminho inverso de timestampParaDatetimeLocalBrasilia: recebe o valor de
 * um <input type="datetime-local"> ('yyyy-mm-ddThh:mm') e retorna um objeto
 * Date representando esse horário de parede em BRASÍLIA (America/Sao_Paulo,
 * UTC-03:00 fixo - o Brasil aboliu o horário de verão em 2019), não o fuso
 * do navegador de quem está editando. Retorna null para valor vazio.
 */
function datetimeLocalBrasiliaParaData(valor) {
  if (!valor) return null;
  return new Date(`${valor}:00-03:00`);
}

// Deriva o Status de Separação a partir da presença das datas de início e
// fim, usado ao salvar uma correção manual no modal "Editar Pedido" (para
// manter o badge sempre consistente com os horários efetivamente salvos).
function derivarStatusSeparacao(dataHoraInicio, dataHoraFim) {
  if (dataHoraFim) return 'separado';
  if (dataHoraInicio) return 'em-separacao';
  return 'a-separar';
}

// Equivalente a derivarStatusSeparacao, para o Status de Organização.
function derivarStatusOrganizacao(dataHoraInicio, dataHoraFim) {
  if (dataHoraFim) return 'organizado';
  if (dataHoraInicio) return 'em-organizacao';
  return 'a-organizar';
}

// Retorna a data de hoje no formato 'yyyy-mm-dd' (fuso horário local).
function hojeISO() {
  return formatarISO(new Date());
}

// Converte um Timestamp do Firebase em string 'yyyy-mm-dd' (ou null).
function timestampParaISO(timestamp) {
  if (!timestamp) return null;
  const data = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return formatarISO(data);
}

/**
 * Soma (ou subtrai, se o valor for negativo) uma quantidade de dias úteis
 * a partir de uma data inicial. O dia inicial NÃO é contado como um dos
 * dias do prazo - a contagem começa a partir do próximo dia.
 * Usada tanto para calcular vencimentos quanto para gerar dados de teste.
 */
function somarDiasUteis(stringISOInicial, quantidadeDiasUteis) {
  const quantidade = Math.trunc(quantidadeDiasUteis);
  const direcao = quantidade >= 0 ? 1 : -1;
  let restante = Math.abs(quantidade);
  const cursor = parseDataLocal(stringISOInicial);
  while (restante > 0) {
    cursor.setDate(cursor.getDate() + direcao);
    if (ehDiaUtil(cursor)) {
      restante--;
    }
  }
  return formatarISO(cursor);
}

/**
 * Calcula a diferença em DIAS ÚTEIS entre duas datas (strings 'yyyy-mm-dd').
 * Retorna um número positivo se dataFinal for depois de dataInicial,
 * negativo se for antes, e 0 se forem iguais.
 */
function diferencaEmDiasUteis(dataInicialISO, dataFinalISO) {
  if (dataInicialISO === dataFinalISO) return 0;
  const sinal = dataFinalISO > dataInicialISO ? 1 : -1;
  const cursor = parseDataLocal(dataInicialISO);
  const alvoISO = dataFinalISO;
  let contagem = 0;
  while (formatarISO(cursor) !== alvoISO) {
    cursor.setDate(cursor.getDate() + sinal);
    if (ehDiaUtil(cursor)) {
      contagem += sinal;
    }
  }
  return contagem;
}

/* =========================================================================
   4. CÁLCULO E CLASSIFICAÇÃO DE SLA
   ========================================================================= */

// Calcula a data de vencimento a partir da data de recebimento + SLA (dias úteis).
function calcularDataVencimento(dataRecebimentoISO, slaDias) {
  return somarDiasUteis(dataRecebimentoISO, Number(slaDias));
}

/**
 * Classifica um pedido de acordo com a configuração central de SLA.
 * Retorna um objeto com: chave, label, bg, texto, diasRestantes (e
 * diasAtraso quando aplicável). Pedidos finalizados sempre retornam a
 * chave 'finalizado'.
 */
function classificarPedido(pedido) {
  if (pedido.status === 'finalizado') {
    return { chave: 'finalizado', diasRestantes: null, ...CONFIG_SLA.cores.finalizado };
  }

  const diasRestantes = diferencaEmDiasUteis(hojeISO(), pedido.dataVencimento);

  if (diasRestantes > CONFIG_SLA.diasRestantesAmarelo) {
    return { chave: 'verde', diasRestantes, ...CONFIG_SLA.cores.verde };
  }
  if (diasRestantes === CONFIG_SLA.diasRestantesAmarelo) {
    return { chave: 'amarelo', diasRestantes, ...CONFIG_SLA.cores.amarelo };
  }
  if (diasRestantes >= CONFIG_SLA.diasRestantesVermelhoMin && diasRestantes <= CONFIG_SLA.diasRestantesVermelhoMax) {
    return { chave: 'vermelho', diasRestantes, ...CONFIG_SLA.cores.vermelho };
  }
  if (diasRestantes === 0) {
    return { chave: 'vence-hoje', diasRestantes, ...CONFIG_SLA.cores['vence-hoje'] };
  }

  // diasRestantes < 0: pedido em atraso
  const diasAtraso = Math.abs(diasRestantes);
  if (diasAtraso <= CONFIG_SLA.diasAtrasoMarromMax) {
    return { chave: 'marrom', diasRestantes, diasAtraso, ...CONFIG_SLA.cores.marrom };
  }
  return { chave: 'roxo', diasRestantes, diasAtraso, ...CONFIG_SLA.cores.roxo };
}

/**
 * Calcula o resultado da finalização de um pedido: se foi concluído
 * antecipadamente, no prazo ou com atraso, e a diferença em dias úteis.
 */
function calcularResultadoFinalizacao(pedido, dataFinalizacaoISO) {
  const diferenca = diferencaEmDiasUteis(pedido.dataVencimento, dataFinalizacaoISO);
  let resultadoSLA;
  if (diferenca > 0) resultadoSLA = 'atrasado';
  else if (diferenca < 0) resultadoSLA = 'antecipado';
  else resultadoSLA = 'no_prazo';
  return { resultadoSLA, diasDiferencaFinalizacao: Math.abs(diferenca) };
}

// Ordem de criticidade usada para ordenar a lista de pedidos.
function ordemCriticidade(classificacao) {
  const mapa = {
    roxo: 0,
    marrom: 1,
    'vence-hoje': 2,
    vermelho: 3,
    amarelo: 4,
    verde: 5,
    finalizado: 6
  };
  return mapa[classificacao.chave] ?? 9;
}

// Texto exibido no badge de situação de cada pedido.
function textoSituacao(pedido, classificacao) {
  if (pedido.status === 'finalizado') {
    if (pedido.resultadoSLA === 'antecipado') return `FINALIZADO (Antecipado ${pedido.diasDiferencaFinalizacao}d)`;
    if (pedido.resultadoSLA === 'atrasado') return `FINALIZADO (Atrasado ${pedido.diasDiferencaFinalizacao}d)`;
    return 'FINALIZADO (No prazo)';
  }
  if (classificacao.chave === 'vence-hoje') return 'VENCE HOJE';
  if (classificacao.chave === 'marrom' || classificacao.chave === 'roxo') {
    return `PEDIDO ATRASADO (${classificacao.diasAtraso}d)`;
  }
  if (classificacao.diasRestantes === 1) return 'Vence em 1 dia';
  return `Vence em ${classificacao.diasRestantes} dias`;
}

/* =========================================================================
   5. INTEGRAÇÃO COM O FIREBASE (AUTHENTICATION + FIRESTORE)
   -------------------------------------------------------------------------
   Usa autenticação anônima apenas para autorizar o acesso ao Firestore
   (não existe tela de login nem identificação de usuário no app).
   ========================================================================= */

// Carrega o Firebase (config + SDKs de Authentication e Firestore) usando
// import() DINÂMICO, e só então inicia a autenticação anônima e a escuta em
// tempo real. Qualquer falha nesta função - rede bloqueada, firewall
// corporativo, CDN inacessível, config inválida - é capturada aqui e não
// afeta o resto da interface (dark mode, modo celular, formulário), que já
// foi inicializada antes desta função ser chamada (ver seção 12).
async function carregarFirebaseEIniciar() {
  atualizarIndicadorSincronizacao('conectando');

  try {
    const [configModule, appModule, authModule, firestoreModule] = await Promise.all([
      import('./firebase-config.js'),
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js')
    ]);

    db = configModule.db;
    auth = configModule.auth;
    signInAnonymously = authModule.signInAnonymously;
    onAuthStateChanged = authModule.onAuthStateChanged;

    collection = firestoreModule.collection;
    addDoc = firestoreModule.addDoc;
    updateDoc = firestoreModule.updateDoc;
    deleteDoc = firestoreModule.deleteDoc;
    doc = firestoreModule.doc;
    onSnapshot = firestoreModule.onSnapshot;
    serverTimestamp = firestoreModule.serverTimestamp;
    query = firestoreModule.query;
    orderBy = firestoreModule.orderBy;
    writeBatch = firestoreModule.writeBatch;

    colecaoPedidos = collection(db, NOME_COLECAO);
    colecaoColaboradores = collection(db, NOME_COLECAO_COLABORADORES);

    iniciarAutenticacaoEDados();
  } catch (erro) {
    const mensagem =
      'Não foi possível carregar o Firebase. Verifique sua conexão de rede (o site precisa ' +
      'acessar www.gstatic.com e googleapis.com - firewalls corporativos, bloqueadores de ' +
      'anúncios ou redes restritas podem impedir isso) e se o arquivo firebase-config.js foi ' +
      'enviado ao repositório. Detalhe: ' + erro.message;
    exibirStatusConexao(mensagem, true);
    atualizarIndicadorSincronizacao('erro', 'Não foi possível carregar o Firebase');
  }
}

function iniciarAutenticacaoEDados() {
  onAuthStateChanged(auth, (usuario) => {
    if (usuario) {
      escutarPedidosEmTempoReal();
      escutarColaboradoresEmTempoReal();
    }
  });

  signInAnonymously(auth).catch((erro) => {
    const mensagem =
      'Falha na autenticação. Verifique se o método de login "Anônimo" está ativado em ' +
      'Authentication > Sign-in method no console do Firebase. Detalhe: ' + erro.message;
    exibirStatusConexao(mensagem, true);
    atualizarIndicadorSincronizacao('erro', 'Não conectado (autenticação)');
  });
}

function escutarPedidosEmTempoReal() {
  const consulta = query(colecaoPedidos, orderBy('dataVencimento', 'asc'));
  onSnapshot(
    consulta,
    (snapshot) => {
      estado.pedidos = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      renderizarTudo();
      ocultarStatusConexao();
      atualizarIndicadorSincronizacao('ok');
    },
    (erro) => {
      const mensagem =
        'Erro ao sincronizar dados em tempo real. Verifique se as regras de firestore.rules ' +
        'foram publicadas no console do Firebase (aba Regras). Detalhe: ' + erro.message;
      exibirStatusConexao(mensagem, true);
      atualizarIndicadorSincronizacao('erro', 'Erro de permissão/regras');
    }
  );
}

// Sincroniza em tempo real a coleção "colaboradores" (separadores e
// organizadores cadastrados). Alimenta as listas suspensas de nome usadas no
// Registro de Separação/Organização e na correção manual do "Editar
// Pedido", além da própria tela "Colaboradores". Independente da coleção de
// pedidos - uma falha aqui não impede a sincronização dos pedidos, e
// vice-versa.
function escutarColaboradoresEmTempoReal() {
  const consulta = query(colecaoColaboradores, orderBy('nome', 'asc'));
  onSnapshot(
    consulta,
    (snapshot) => {
      estado.colaboradores = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      popularTodosSelectsOperador();
      renderizarTelaColaboradores();
    },
    (erro) => {
      const mensagem =
        'Erro ao sincronizar a lista de colaboradores. Verifique se as regras de firestore.rules ' +
        'incluem a coleção "colaboradores". Detalhe: ' + erro.message;
      exibirStatusConexao(mensagem, true);
    }
  );
}

// Atualiza a "bolinha" de status no cabeçalho: cinza (conectando), verde
// (sincronizado em tempo real) ou vermelho (erro, com a causa mais provável).
function atualizarIndicadorSincronizacao(estadoConexao, mensagemErro) {
  const indicador = document.getElementById('indicadorSincronizacao');
  const texto = document.getElementById('textoSincronizacao');
  if (!indicador || !texto) return;

  indicador.classList.remove('ok', 'erro', 'conectando');
  indicador.classList.add(estadoConexao);

  if (estadoConexao === 'ok') {
    texto.textContent = 'Sincronizado em tempo real';
  } else if (estadoConexao === 'erro') {
    texto.textContent = mensagemErro || 'Erro de sincronização';
  } else {
    texto.textContent = 'Conectando...';
  }
}

/* =========================================================================
   6. OPERAÇÕES DE CRUD DOS PEDIDOS
   ========================================================================= */

async function salvarPedido(dadosFormulario, idExistente) {
  const dataVencimento = calcularDataVencimento(dadosFormulario.dataRecebimentoEstoque, dadosFormulario.slaDias);

  const dados = {
    numeroPedido: String(dadosFormulario.numeroPedido).trim(),
    cliente: String(dadosFormulario.cliente).trim(),
    dataPedido: dadosFormulario.dataPedido,
    dataRecebimentoEstoque: dadosFormulario.dataRecebimentoEstoque,
    slaDias: Number(dadosFormulario.slaDias),
    dataVencimento,
    // Quantidade de ITENS do pedido - informada no cadastro e editável
    // enquanto o pedido estiver aberto, igual aos demais campos acima. NÃO É
    // a quantidade de caixas (ver quantidadeCaixas, abaixo): itens é o que
    // se sabe no momento do lançamento do pedido; a quantidade de caixas só
    // é conhecida depois de fechadas, ao finalizar a Organização - a
    // separação busca os produtos e embala, a identificação final de caixas
    // é feita na Organização (item 32 do README).
    quantidadeItens: Number(dadosFormulario.quantidadeItens),
    observacao: String(dadosFormulario.observacao || '').trim()
  };

  if (idExistente) {
    // Edição manual (correção) dos registros de Separação/Organização e,
    // quando necessário, da finalização automática do pedido - campos
    // opcionais, montados em configurarModais() apenas para o formulário
    // de EDIÇÃO (o formulário inline de novo pedido nunca os envia).
    if (dadosFormulario.registroSeparacao) Object.assign(dados, dadosFormulario.registroSeparacao);
    if (dadosFormulario.registroOrganizacao) Object.assign(dados, dadosFormulario.registroOrganizacao);
    if (dadosFormulario.finalizacao) Object.assign(dados, dadosFormulario.finalizacao);
    await updateDoc(doc(db, NOME_COLECAO, idExistente), dados);

    // Integração com o sistema de logística (item 33 do README) - GAP
    // encontrado e corrigido nesta rodada (item 35): até aqui, o aviso à
    // logística só disparava quando o pedido era finalizado pelo fluxo
    // normal (modal "⏱️" ou atalho "Atribuição" - ver
    // finalizarOrganizacaoPedido). Mas um pedido TAMBÉM pode ser finalizado
    // por aqui - corrigindo em "Editar Pedido" os registros de Separação e
    // Organização até as duas etapas ficarem completas (`dados.finalizacao`
    // só é montado, logo acima no código que chama salvarPedido, quando
    // essa correção leva o pedido de "aberto" para "finalizado" agora) -
    // e esse caminho nunca chamava notificarSistemaLogistica. Resultado
    // prático: um pedido corrigido/finalizado via edição não avisava a
    // logística, mesmo aparecendo como "Finalizado" no painel - podendo
    // ser exatamente o que aconteceu no teste do pedido 8837.
    if (dadosFormulario.finalizacao && dadosFormulario.finalizacao.status === 'finalizado') {
      notificarSistemaLogistica(dados.numeroPedido, dados.cliente, Number(dados.quantidadeCaixas));
    }
  } else {
    await addDoc(colecaoPedidos, {
      ...dados,
      status: 'aberto',
      criadoEm: serverTimestamp(),
      finalizadoEm: null,
      resultadoSLA: null,
      diasDiferencaFinalizacao: null,
      // Status de separação (operacional): todo pedido novo começa "a separar".
      statusSeparacao: 'a-separar',
      operadorInicioSeparacao: null,
      dataHoraInicioSeparacao: null,
      operadorFimSeparacao: null,
      dataHoraFimSeparacao: null,
      // Status de organização (operacional): etapa seguinte à separação
      // (conferência e organização para despacho), feita por outra pessoa.
      statusOrganizacao: 'a-organizar',
      operadorInicioOrganizacao: null,
      dataHoraInicioOrganizacao: null,
      operadorFimOrganizacao: null,
      dataHoraFimOrganizacao: null,
      // Peso aferido da carga (kg), informado na balança no momento de
      // finalizar a Organização (ver finalizarOrganizacaoPedido). Fica nulo
      // até lá; pedidos criados antes desta atualização também ficam nulos
      // e são tratados como "não informado" em todos os cálculos/telas.
      pesoCargaKg: null,
      // Quantidade de CAIXAS (fechada/final), informada apenas ao finalizar
      // a Organização - diferente de quantidadeItens (acima), que é
      // informada no cadastro do pedido. Fica nula até lá (item 32 do
      // README).
      quantidadeCaixas: null,
      // Cubagem (cm) da maior caixa/volume do pedido e o peso cubado (kg)
      // calculado a partir dela, informados junto com o peso ao finalizar a
      // Organização (ver calcularPesoCubado e item 31 do README). Ficam
      // nulos até lá.
      alturaCm: null,
      larguraCm: null,
      comprimentoCm: null,
      pesoCubadoKg: null,
      // Dados de referência trazidos pela importação em lote via planilha
      // (item 33 do README) - ficam nulos em pedidos lançados manualmente
      // por este formulário, que não tem campos para eles.
      idExterno: null,
      parceiroCodigo: null,
      modalidade: null,
      nomeRepresentante: null,
      // Data/hora completa da coluna "Cadastro" da planilha importada (item
      // 33 do README), exibida como sub-linha abaixo do Cliente no Painel
      // Consolidado. Fica nula em pedidos lançados manualmente.
      cadastroPlanilha: null
    });
  }
}

// Peso cubado (kg) a partir das dimensões (cm) da maior caixa/volume do
// pedido - NÃO multiplica pela quantidade de caixas (ver item 31 do
// README): mede-se apenas 1 volume, o maior, como referência de cubagem.
// Fator usado: 300 kg/m³, padrão de transporte rodoviário de cargas no
// Brasil (NTC&Logística/ANTT). Fórmula: peso cubado = Altura × Largura ×
// Comprimento (em metros) × 300. Retorna null se alguma dimensão estiver
// ausente ou inválida.
const FATOR_CUBAGEM_KG_M3 = 300;

function calcularPesoCubado(alturaCm, larguraCm, comprimentoCm) {
  const altura = Number(alturaCm);
  const largura = Number(larguraCm);
  const comprimento = Number(comprimentoCm);
  if (!altura || !largura || !comprimento || altura <= 0 || largura <= 0 || comprimento <= 0) {
    return null;
  }
  const volumeM3 = (altura / 100) * (largura / 100) * (comprimento / 100);
  const pesoCubado = volumeM3 * FATOR_CUBAGEM_KG_M3;
  return Math.round(pesoCubado * 100) / 100;
}

// Localiza um pedido pelo número (comparação sem diferenciar maiúsculas ou
// espaços nas pontas), usado pelo painel de Registro de Separação.
function buscarPedidoPorNumero(numero) {
  const alvo = String(numero).trim().toLowerCase();
  return estado.pedidos.find((pedido) => String(pedido.numeroPedido).trim().toLowerCase() === alvo) || null;
}

/* -------------------------------------------------------------------------
   Importação em lote de pedidos via planilha (.xls/.xlsx) - item 33 do
   README.
   As colunas da planilha são lidas pelo NOME do cabeçalho de cada uma (não
   pela posição/ordem em que aparecem no arquivo), normalizado (sem
   acentos, minúsculo, espaços únicos) para tolerar pequenas variações de
   grafia entre arquivos. Depois de lida, a planilha fica em memória numa
   prévia editável (ver configurarImportacaoPedidos, seção 9) - nada é
   gravado no Firestore até o operador confirmar em "Enviar".
   ------------------------------------------------------------------------- */

// Mapa "cabeçalho normalizado da planilha" -> campo do pedido no sistema.
// Cobre a grafia correta esperada e a variação "quantidade de iitens" (erro
// de digitação presente no arquivo-modelo enviado pelo Roberto) - ambas
// mapeiam para o mesmo campo, quantidadeItens.
const MAPA_CABECALHOS_IMPORTACAO = {
  'numero do pedido': 'numeroPedido',
  'id': 'idExterno',
  'parceiro - codigo': 'parceiroCodigo',
  'parceiro - razao social': 'cliente',
  'cadastro': 'cadastro', // tratado em separado: gera dataPedido + cadastroPlanilha
  'transportadora (nota fiscal)': 'modalidade',
  'nome do representante': 'nomeRepresentante',
  'quantidade de itens': 'quantidadeItens',
  'quantidade de iitens': 'quantidadeItens',
  'dias': 'slaDias',
  // Coluna acrescentada pelo Roberto ao arquivo-modelo (antes a "Data de
  // Recebimento no Estoque" não vinha na planilha e era sempre lançada à
  // mão na prévia - ver mapearLinhaPlanilha). Quando esta coluna existir no
  // arquivo, o valor já vem preenchido na prévia (e continua editável, para
  // o caso de o arquivo não ter a coluna ou o valor precisar de ajuste).
  'rec. estoque': 'dataRecebimentoEstoque'
};

// Remove acentos e reduz espaços/maiúsculas, para comparar cabeçalhos de
// planilha de forma tolerante a pequenas diferenças de grafia/formatação.
function normalizarCabecalho(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// Converte o valor de uma célula em string 'yyyy-mm-dd' (ou null). Aceita
// um objeto Date (a planilha é lida com cellDates:true, então uma célula
// com formatação de data chega assim) ou texto em 'yyyy-mm-dd'/'dd/mm/aaaa'.
function celulaParaDataISO(valor) {
  if (!valor) return null;
  if (valor instanceof Date && !isNaN(valor)) return formatarISO(valor);
  const texto = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  const partesBR = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (partesBR) {
    let [, dia, mes, ano] = partesBR;
    if (ano.length === 2) ano = `20${ano}`;
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }
  return null;
}

// Igual a celulaParaDataISO, mas preservando hora:minuto quando disponíveis
// ('yyyy-mm-ddTHH:mm'), usada no campo "Cadastro" (exibido como sub-linha
// sob o Cliente no Painel Consolidado - ver criarCelulaCliente).
function celulaParaDataHoraISO(valor) {
  if (!valor) return null;
  if (valor instanceof Date && !isNaN(valor)) {
    const dataISO = formatarISO(valor);
    const hora = String(valor.getHours()).padStart(2, '0');
    const minuto = String(valor.getMinutes()).padStart(2, '0');
    return `${dataISO}T${hora}:${minuto}`;
  }
  return celulaParaDataISO(valor); // sem hora disponível no valor - só a data
}

let proximoIdLinhaImportacao = 1;

// Lê o arquivo de planilha escolhido (.xls/.xlsx) e devolve a lista de
// pedidos reconhecidos, já mapeados para os campos do sistema - pronta para
// a prévia editável. Lança erro (mensagem amigável) se não encontrar a
// coluna "Número do pedido", obrigatória para identificar cada pedido.
async function lerPlanilhaPedidos(arquivo) {
  if (typeof XLSX === 'undefined') {
    throw new Error(
      'Não foi possível carregar a biblioteca de leitura de planilhas (verifique a conexão ' +
      'com a internet e recarregue a página).'
    );
  }

  const bytes = await arquivo.arrayBuffer();
  const livro = XLSX.read(bytes, { type: 'array', cellDates: true });
  const planilha = livro.Sheets[livro.SheetNames[0]];
  const linhasBrutas = XLSX.utils.sheet_to_json(planilha, { defval: '' });

  if (linhasBrutas.length === 0) {
    throw new Error('A planilha não tem nenhuma linha de dados.');
  }

  const cabecalhosOriginais = Object.keys(linhasBrutas[0]);
  const temColunaNumeroPedido = cabecalhosOriginais.some(
    (cabecalho) => MAPA_CABECALHOS_IMPORTACAO[normalizarCabecalho(cabecalho)] === 'numeroPedido'
  );
  if (!temColunaNumeroPedido) {
    throw new Error(
      'Não encontrei a coluna "Número do pedido" na planilha. Verifique se o arquivo tem essa ' +
      'coluna (pode estar em qualquer posição, mas o nome precisa existir).'
    );
  }

  return linhasBrutas.map((linhaBruta, indice) => mapearLinhaPlanilha(linhaBruta, indice));
}

// Mapeia uma linha bruta da planilha (objeto "cabeçalho original" -> valor)
// para um item da prévia de importação, reconhecendo cada coluna pelo nome
// (MAPA_CABECALHOS_IMPORTACAO), não pela posição.
function mapearLinhaPlanilha(linhaBruta, indice) {
  const item = {
    _linhaId: proximoIdLinhaImportacao++,
    _linhaPlanilha: indice + 2, // +2: a linha 1 da planilha é o cabeçalho
    numeroPedido: '',
    cliente: '',
    idExterno: '',
    parceiroCodigo: '',
    modalidade: '',
    nomeRepresentante: '',
    quantidadeItens: '',
    slaDias: '',
    dataPedido: '',
    cadastroPlanilha: null,
    // "Data de Recebimento no Estoque": fica em branco por padrão, para o
    // operador lançar manualmente na prévia (caso do arquivo sem a coluna
    // "Rec. Estoque", ou pedido cujo prazo varia e precisa de ajuste). Se a
    // planilha tiver a coluna "Rec. Estoque", o valor é preenchido abaixo
    // (ver MAPA_CABECALHOS_IMPORTACAO) e continua editável na prévia.
    dataRecebimentoEstoque: '',
    // Marcação da caixa "Excluir" na prévia: true quando o operador decide
    // não enviar esta linha específica (ex.: pedido duplicado ou incompleto
    // que ele quer pular sem precisar cancelar o lote inteiro). Linhas
    // marcadas ficam fora da validação de pendências/duplicados e fora do
    // que é de fato gravado em confirmarImportacaoPedidos.
    _excluido: false
  };

  Object.entries(linhaBruta).forEach(([cabecalhoOriginal, valor]) => {
    const campo = MAPA_CABECALHOS_IMPORTACAO[normalizarCabecalho(cabecalhoOriginal)];
    if (!campo) return;

    if (campo === 'cadastro') {
      item.dataPedido = celulaParaDataISO(valor) || item.dataPedido;
      item.cadastroPlanilha = celulaParaDataHoraISO(valor);
    } else if (campo === 'dataRecebimentoEstoque') {
      // A coluna "Rec. Estoque" chega como célula de data (cellDates:true
      // na leitura do XLSX) ou, dependendo da origem do arquivo, como texto
      // 'dd/mm/aaaa' - celulaParaDataISO trata os dois casos. Se vier vazia
      // ou não reconhecida, mantém '' (fica para o operador lançar à mão).
      item.dataRecebimentoEstoque = celulaParaDataISO(valor) || '';
    } else if (campo === 'quantidadeItens' || campo === 'slaDias') {
      item[campo] = valor === '' ? '' : Number(valor);
    } else {
      item[campo] = String(valor).trim();
    }
  });

  return item;
}

// Valida uma linha da prévia de importação (já com os eventuais ajustes do
// operador). Retorna a lista de problemas encontrados (vazia se estiver
// tudo certo).
function validarLinhaImportacao(item) {
  const problemas = [];
  if (!item.numeroPedido) problemas.push('Número do pedido em branco');
  if (!item.cliente) problemas.push('Cliente em branco');
  if (!item.dataPedido) problemas.push('Data do pedido em branco');
  if (!item.dataRecebimentoEstoque) problemas.push('Data de recebimento no estoque em branco');
  if (!item.slaDias || Number(item.slaDias) <= 0) problemas.push('SLA (dias) inválido');
  if (!item.quantidadeItens || Number(item.quantidadeItens) <= 0) problemas.push('Quantidade de itens inválida');
  return problemas;
}

// Verifica duplicidade de "Número do pedido": dentro do próprio arquivo
// (duas linhas com o mesmo número) e contra pedidos já existentes no
// Firestore (estado.pedidos). Por decisão explícita do solicitante (item 33
// do README), qualquer duplicidade BLOQUEIA A IMPORTAÇÃO INTEIRA - nada é
// gravado até o arquivo ser corrigido e reenviado.
function listarDuplicadosImportacao(itens) {
  const contagem = new Map();
  itens.forEach((item) => {
    const chave = String(item.numeroPedido).trim().toLowerCase();
    if (!chave) return;
    contagem.set(chave, (contagem.get(chave) || 0) + 1);
  });

  const duplicados = new Set();
  itens.forEach((item) => {
    const chave = String(item.numeroPedido).trim().toLowerCase();
    if (!chave) return;
    if (contagem.get(chave) > 1 || buscarPedidoPorNumero(item.numeroPedido)) {
      duplicados.add(item.numeroPedido);
    }
  });

  return Array.from(duplicados);
}

// Grava todos os pedidos da prévia de importação no Firestore, em lotes
// (writeBatch) de até 450 operações por vez - a API do Firestore limita
// cada lote a 500 operações; a margem evita passar do limite por engano com
// arquivos muito grandes. Assume que a lista já passou pela validação de
// campos obrigatórios (validarLinhaImportacao) e de duplicados
// (listarDuplicadosImportacao) sem nenhum problema - quem chama esta função
// é responsável por checar isso antes.
async function confirmarImportacaoPedidos(itens) {
  const TAMANHO_LOTE = 450;
  for (let inicio = 0; inicio < itens.length; inicio += TAMANHO_LOTE) {
    const grupo = itens.slice(inicio, inicio + TAMANHO_LOTE);
    const lote = writeBatch(db);
    grupo.forEach((item) => {
      const dataVencimento = calcularDataVencimento(item.dataRecebimentoEstoque, item.slaDias);
      lote.set(doc(colecaoPedidos), {
        numeroPedido: String(item.numeroPedido).trim(),
        cliente: String(item.cliente).trim(),
        dataPedido: item.dataPedido,
        dataRecebimentoEstoque: item.dataRecebimentoEstoque,
        slaDias: Number(item.slaDias),
        dataVencimento,
        quantidadeItens: Number(item.quantidadeItens),
        observacao: '',
        status: 'aberto',
        criadoEm: serverTimestamp(),
        finalizadoEm: null,
        resultadoSLA: null,
        diasDiferencaFinalizacao: null,
        statusSeparacao: 'a-separar',
        operadorInicioSeparacao: null,
        dataHoraInicioSeparacao: null,
        operadorFimSeparacao: null,
        dataHoraFimSeparacao: null,
        statusOrganizacao: 'a-organizar',
        operadorInicioOrganizacao: null,
        dataHoraInicioOrganizacao: null,
        operadorFimOrganizacao: null,
        dataHoraFimOrganizacao: null,
        pesoCargaKg: null,
        quantidadeCaixas: null,
        alturaCm: null,
        larguraCm: null,
        comprimentoCm: null,
        pesoCubadoKg: null,
        // Dados de referência trazidos pela planilha (item 33 do README).
        idExterno: item.idExterno || null,
        parceiroCodigo: item.parceiroCodigo || null,
        modalidade: item.modalidade || null,
        nomeRepresentante: item.nomeRepresentante || null,
        cadastroPlanilha: item.cadastroPlanilha || null
      });
    });
    await lote.commit();
  }
}

/* -------------------------------------------------------------------------
   CRUD de Colaboradores (separadores/organizadores cadastrados)
   ---------------------------------------------------------------------------
   Substitui o antigo campo de texto livre do nome do operador por uma lista
   suspensa alimentada por esta coleção, para eliminar erros de digitação que
   faziam um nome "sumir" do cálculo do Tempo Médio por Operador (ex.:
   "Jaqueline" digitado como "Jaquelini" vira, para o sistema, outra pessoa).
   Um colaborador NUNCA é excluído automaticamente por edição/desativação:
   pedidos já registrados guardam o nome como texto simples (sem vínculo por
   ID), então renomear, desativar ou excluir um colaborador aqui não altera
   pedidos já lançados - apenas afeta as opções oferecidas dali em diante.
   ------------------------------------------------------------------------- */

// Localiza um colaborador pelo nome (comparação sem diferenciar maiúsculas
// ou espaços nas pontas), usado para impedir cadastro duplicado.
function buscarColaboradorPorNome(nome) {
  const alvo = String(nome).trim().toLowerCase();
  return estado.colaboradores.find((colaborador) => String(colaborador.nome).trim().toLowerCase() === alvo) || null;
}

async function adicionarColaborador(nome) {
  await addDoc(colecaoColaboradores, {
    nome: String(nome).trim(),
    ativo: true,
    criadoEm: serverTimestamp()
  });
}

async function editarNomeColaborador(colaborador, novoNome) {
  await updateDoc(doc(db, NOME_COLECAO_COLABORADORES, colaborador.id), { nome: String(novoNome).trim() });
}

async function alternarAtivoColaborador(colaborador) {
  await updateDoc(doc(db, NOME_COLECAO_COLABORADORES, colaborador.id), { ativo: !colaborador.ativo });
}

async function excluirColaborador(colaborador) {
  await deleteDoc(doc(db, NOME_COLECAO_COLABORADORES, colaborador.id));
}

// Varre os pedidos já lançados em busca de nomes de separador/organizador
// (nos 4 campos de operador) que ainda não estejam cadastrados, e os
// cadastra automaticamente - forma rápida de popular a lista pela primeira
// vez a partir do histórico existente, sem digitar cada nome manualmente.
// Nomes que só diferem em maiúsculas/minúsculas são tratados como o mesmo
// colaborador (mantém a primeira grafia encontrada).
async function importarColaboradoresDosPedidos() {
  const nomesEncontrados = new Set();
  estado.pedidos.forEach((pedido) => {
    [
      pedido.operadorInicioSeparacao,
      pedido.operadorFimSeparacao,
      pedido.operadorInicioOrganizacao,
      pedido.operadorFimOrganizacao
    ].forEach((nome) => {
      if (nome && String(nome).trim()) nomesEncontrados.add(String(nome).trim());
    });
  });

  const vistos = new Set();
  const paraImportar = [];
  [...nomesEncontrados].forEach((nome) => {
    const chave = nome.toLowerCase();
    if (vistos.has(chave)) return;
    vistos.add(chave);
    if (!buscarColaboradorPorNome(nome)) paraImportar.push(nome);
  });

  for (const nome of paraImportar) {
    await adicionarColaborador(nome);
  }

  return { importados: paraImportar.length, jaExistiam: nomesEncontrados.size - paraImportar.length };
}

// Preenche (ou reconstrói) uma lista suspensa de operador com os
// colaboradores ATIVOS, em ordem alfabética. `valorParaSelecionar`, quando
// informado (mesmo que string vazia), define o valor selecionado após
// preencher; quando omitido, preserva o valor atualmente selecionado no
// campo (útil ao repopular por causa de uma alteração na lista de
// colaboradores enquanto um modal já está aberto).
//
// Caso o valor a selecionar não corresponda a nenhum colaborador ativo (ex.:
// nome de um registro histórico cujo colaborador foi desativado/excluído, ou
// lançado antes deste recurso existir), ele é incluído mesmo assim como uma
// opção extra rotulada "(não cadastrado)" - para nunca apagar silenciosamente
// um nome já salvo em um pedido.
function popularSelectOperador(idSelect, rotuloVazio, valorParaSelecionar) {
  const select = document.getElementById(idSelect);
  if (!select) return;

  const valorAlvo = valorParaSelecionar !== undefined ? valorParaSelecionar : select.value;

  select.innerHTML = '';

  const optVazia = document.createElement('option');
  optVazia.value = '';
  optVazia.textContent = rotuloVazio;
  select.appendChild(optVazia);

  const ativos = estado.colaboradores
    .filter((colaborador) => colaborador.ativo)
    .slice()
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const valorAlvoNormalizado = String(valorAlvo).trim().toLowerCase();
  const existeEntreOsAtivos = ativos.some((c) => c.nome.trim().toLowerCase() === valorAlvoNormalizado);
  if (valorAlvo && !existeEntreOsAtivos) {
    const optHistorico = document.createElement('option');
    optHistorico.value = valorAlvo;
    optHistorico.textContent = `${valorAlvo} (não cadastrado)`;
    select.appendChild(optHistorico);
  }

  ativos.forEach((colaborador) => {
    const opt = document.createElement('option');
    opt.value = colaborador.nome;
    opt.textContent = colaborador.nome;
    select.appendChild(opt);
  });

  select.value = valorAlvo;
}

// Repopula todas as listas suspensas de operador com o estado atual de
// colaboradores, preservando o que já estiver selecionado em cada uma
// (chamado sempre que a coleção "colaboradores" é sincronizada).
function popularTodosSelectsOperador() {
  popularSelectOperador('campoSeparacaoOperador', 'Selecione seu nome...');
  popularSelectOperador('campoOrganizacaoOperador', 'Selecione seu nome...');
  popularSelectOperador('campoEditarOperadorInicioSeparacao', '(nenhum)');
  popularSelectOperador('campoEditarOperadorFimSeparacao', '(nenhum)');
  popularSelectOperador('campoEditarOperadorInicioOrganizacao', '(nenhum)');
  popularSelectOperador('campoEditarOperadorFimOrganizacao', '(nenhum)');
}

async function iniciarSeparacaoPedido(pedido, nomeOperador) {
  await updateDoc(doc(db, NOME_COLECAO, pedido.id), {
    statusSeparacao: 'em-separacao',
    operadorInicioSeparacao: nomeOperador,
    dataHoraInicioSeparacao: serverTimestamp()
  });
}

async function finalizarSeparacaoPedido(pedido, nomeOperador) {
  await updateDoc(doc(db, NOME_COLECAO, pedido.id), {
    statusSeparacao: 'separado',
    operadorFimSeparacao: nomeOperador,
    dataHoraFimSeparacao: serverTimestamp()
  });
}

async function iniciarOrganizacaoPedido(pedido, nomeOperador) {
  await updateDoc(doc(db, NOME_COLECAO, pedido.id), {
    statusOrganizacao: 'em-organizacao',
    operadorInicioOrganizacao: nomeOperador,
    dataHoraInicioOrganizacao: serverTimestamp()
  });
}

// Registra a finalização da organização e, quando a separação já estiver
// concluída (pré-requisito para a organização ter começado), finaliza o
// pedido automaticamente - sem precisar do "ticar" manual que existia
// antes. A lógica de resultado do SLA (calcularResultadoFinalizacao) não
// muda: continua comparando a data de hoje com o vencimento.
// pesoCargaKg: peso aferido na balança da carga já separada e organizada,
// informado neste exato momento (tanto pelo modal ⏱️ quanto pelo atalho da
// coluna "Atribuição" - ambos chamam esta mesma função, ver item 30 do
// README). Obrigatório nos dois caminhos; validado antes de chegar aqui.
// quantidadeCaixas: quantidade FECHADA de caixas (contagem final, depois de
// embaladas), também informada neste momento nos dois caminhos (item 32 do
// README) - diferente de quantidadeItens, informada no cadastro do pedido.
// alturaCm/larguraCm/comprimentoCm: dimensões (cm) da maior caixa/volume do
// pedido, também informadas neste momento nos dois caminhos (item 31 do
// README); pesoCubadoKg é calculado automaticamente a partir delas (sem
// multiplicar pela quantidade de caixas - ver item 31).
async function finalizarOrganizacaoPedido(pedido, nomeOperador, pesoCargaKg, quantidadeCaixas, alturaCm, larguraCm, comprimentoCm) {
  await updateDoc(doc(db, NOME_COLECAO, pedido.id), {
    statusOrganizacao: 'organizado',
    operadorFimOrganizacao: nomeOperador,
    dataHoraFimOrganizacao: serverTimestamp(),
    pesoCargaKg: Number(pesoCargaKg),
    quantidadeCaixas: Number(quantidadeCaixas),
    alturaCm: Number(alturaCm),
    larguraCm: Number(larguraCm),
    comprimentoCm: Number(comprimentoCm),
    pesoCubadoKg: calcularPesoCubado(alturaCm, larguraCm, comprimentoCm)
  });

  if (pedido.statusSeparacao === 'separado' && pedido.status !== 'finalizado') {
    await finalizarPedido(pedido);
    // Integração com o sistema de logística (item 33 do README): dispara só
    // quando o pedido é finalizado de fato (baixa completa), nunca ao apenas
    // finalizar a Organização de um pedido cuja Separação ainda não tenha
    // acabado (esse "if" acima é exatamente a mesma condição que decide se
    // finalizarPedido() roda).
    notificarSistemaLogistica(pedido.numeroPedido, pedido.cliente, Number(quantidadeCaixas));
  }
}

// URL do sistema de logística (Google Apps Script) que recebe os pedidos
// finalizados para dar andamento à retirada/coleta. Fornecida pelo
// solicitante (item 33 do README).
const URL_INTEGRACAO_LOGISTICA = 'https://script.google.com/macros/s/AKfycbwLCgBPAmL6tYwhVHOKBBgA-ZyBzRduAMVeXJ3ERzstW6naRVg-QuviBByxG6k_8vOC/exec?m=logistica';

/**
 * Notifica o sistema de logística externo de que um pedido foi finalizado
 * (baixa completa), para que ele siga para retirada/coleta. Dispara em
 * segundo plano (nunca aguardado por quem chama) e NUNCA impede nem atrasa
 * a finalização do pedido no Firestore, que já aconteceu antes desta função
 * ser chamada - se o envio falhar, o pedido continua finalizado normalmente
 * aqui, só o aviso à logística é que não chegou.
 *
 * Envia por GET (parâmetros na própria URL, no padrão que o endpoint já usa
 * com "?m=logistica") os campos pedidos pelo solicitante: "Pedido",
 * "CLIENTE", "CAIXAS" e "SOLICITAÇÃO" (a data da baixa), sempre com
 * "status"="Pendente". Usa `mode: 'no-cors'` porque o endpoint é um Apps
 * Script de terceiro cuja configuração de CORS não controlamos - isso evita
 * que o navegador bloqueie o envio, mas tem a contrapartida de que só
 * conseguimos detectar falha de REDE (sem internet, domínio inacessível);
 * uma eventual rejeição do lado do Apps Script (ex.: erro no script) não
 * aparece aqui, fica só registrada do lado de lá. Por isso a forma
 * confiável de confirmar que a integração está funcionando é conferir
 * diretamente no sistema de logística após finalizar um pedido de teste.
 */
function notificarSistemaLogistica(numeroPedido, cliente, quantidadeCaixasFechadas) {
  const parametros = new URLSearchParams({
    Pedido: numeroPedido,
    CLIENTE: cliente,
    CAIXAS: String(quantidadeCaixasFechadas),
    SOLICITAÇÃO: formatarBR(hojeISO()),
    status: 'Pendente'
  });
  const url = `${URL_INTEGRACAO_LOGISTICA}&${parametros.toString()}`;

  fetch(url, { method: 'GET', mode: 'no-cors' }).catch((erro) => {
    console.warn(
      `Não foi possível notificar o sistema de logística para o pedido ${numeroPedido} ` +
      `(o pedido continua finalizado normalmente aqui - só o aviso à logística falhou):`,
      erro
    );
  });
}

async function finalizarPedido(pedido) {
  const hoje = hojeISO();
  const { resultadoSLA, diasDiferencaFinalizacao } = calcularResultadoFinalizacao(pedido, hoje);
  await updateDoc(doc(db, NOME_COLECAO, pedido.id), {
    status: 'finalizado',
    finalizadoEm: serverTimestamp(),
    resultadoSLA,
    diasDiferencaFinalizacao
  });
}

async function reabrirPedido(pedido) {
  await updateDoc(doc(db, NOME_COLECAO, pedido.id), {
    status: 'aberto',
    finalizadoEm: null,
    resultadoSLA: null,
    diasDiferencaFinalizacao: null
  });
}

async function excluirPedido(id) {
  await deleteDoc(doc(db, NOME_COLECAO, id));
}

/* =========================================================================
   7. RENDERIZAÇÃO DE INTERFACE
   ========================================================================= */

// Escapa caracteres especiais de HTML antes de interpolar texto vindo de
// dados (ex.: campos trazidos pela importação em lote de planilha, item 33
// do README) dentro de um template de innerHTML, evitando que o conteúdo
// seja interpretado como marcação.
function escaparHTML(texto) {
  const div = document.createElement('div');
  div.textContent = String(texto);
  return div.innerHTML;
}

// Ponto único de atualização: recalcula classificações e redesenha tudo.
function renderizarTudo() {
  const pedidosClassificados = estado.pedidos.map((pedido) => ({
    ...pedido,
    _classificacao: classificarPedido(pedido)
  }));

  renderizarDashboard(pedidosClassificados);
  renderizarPainelConsolidado(pedidosClassificados);
  renderizarTabelaPedidos(pedidosClassificados);
  renderizarHistorico();
  renderizarFaixaAeroporto(pedidosClassificados);
  renderizarPainelTempos();
}

function renderizarDashboard(lista) {
  const abertos = lista.filter((p) => p.status === 'aberto');
  const noPrazo = abertos.filter((p) => ['verde', 'amarelo'].includes(p._classificacao.chave)).length;
  const venceHoje = abertos.filter((p) => p._classificacao.chave === 'vence-hoje').length;
  const atrasados = abertos.filter((p) => ['marrom', 'roxo'].includes(p._classificacao.chave)).length;

  const hoje = hojeISO();
  const finalizadosHoje = lista.filter(
    (p) => p.status === 'finalizado' && timestampParaISO(p.finalizadoEm) === hoje
  ).length;

  const totalPedidos = lista.length;
  const totalFinalizados = lista.filter((p) => p.status === 'finalizado').length;
  const taxaConclusao = totalPedidos > 0 ? Math.round((totalFinalizados / totalPedidos) * 100) : 0;

  document.getElementById('indTotalAberto').textContent = abertos.length;
  document.getElementById('indNoPrazo').textContent = noPrazo;
  document.getElementById('indVenceHoje').textContent = venceHoje;
  document.getElementById('indAtrasados').textContent = atrasados;
  document.getElementById('indFinalizadosHoje').textContent = finalizadosHoje;
  document.getElementById('indTaxaConclusao').textContent = `${taxaConclusao}%`;
}

function renderizarPainelConsolidado(lista) {
  const abertos = lista.filter((p) => p.status === 'aberto');
  const grupos = new Map();

  abertos.forEach((pedido) => {
    const classificacao = pedido._classificacao;
    let chaveGrupo;
    let label;
    let ordem;

    let corClasse;
    if (classificacao.diasRestantes < 0) {
      // O grupo "atrasados" reúne marrom + roxo; usa a cor mais crítica (roxo).
      chaveGrupo = 'atrasados';
      label = 'PEDIDOS ATRASADOS';
      ordem = -2;
      corClasse = 'roxo';
    } else if (classificacao.diasRestantes === 0) {
      chaveGrupo = 'vence-hoje';
      label = 'VENCE HOJE';
      ordem = -1;
      corClasse = 'vence-hoje';
    } else {
      chaveGrupo = `dias-${classificacao.diasRestantes}`;
      label = `${classificacao.diasRestantes} DIA${classificacao.diasRestantes > 1 ? 'S' : ''}`;
      ordem = classificacao.diasRestantes;
      corClasse = classificacao.chave;
    }

    if (!grupos.has(chaveGrupo)) {
      grupos.set(chaveGrupo, { label, ordem, corClasse, pedidos: [] });
    }
    grupos.get(chaveGrupo).pedidos.push(pedido);
  });

  const listaGrupos = Array.from(grupos.values()).sort((a, b) => a.ordem - b.ordem);
  const container = document.getElementById('gruposConsolidados');
  container.innerHTML = '';

  if (listaGrupos.length === 0) {
    container.innerHTML = '<p class="mensagem-vazia">Nenhum pedido em aberto no momento.</p>';
    return;
  }

  listaGrupos.forEach((grupo) => {
    const cores = CONFIG_SLA.cores[grupo.corClasse] || {};
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'grupo-consolidado';
    botao.style.backgroundColor = cores.bg || '';
    botao.style.color = cores.texto || '';
    botao.innerHTML = `<span class="grupo-quantidade">${grupo.pedidos.length}</span><span class="grupo-label">${grupo.label}</span>`;
    botao.addEventListener('click', () => abrirModalGrupo(grupo.label, grupo.pedidos));
    container.appendChild(botao);
  });
}

function pedidoPassaFiltros(pedido) {
  const filtros = estado.filtros;

  if (filtros.status && pedido.status !== filtros.status) return false;

  if (filtros.texto) {
    const alvo = filtros.texto.trim().toLowerCase();
    // Inclui ID e Parceiro - Código (trazidos pela importação em lote, item 33
    // do README) na busca, mesmo eles não sendo exibidos na tabela - assim,
    // ao procurar pelo ID ou pelo código do parceiro, o pedido do cliente
    // correspondente é encontrado normalmente.
    const textoPedido = `${pedido.numeroPedido} ${pedido.cliente} ${pedido.idExterno || ''} ${pedido.parceiroCodigo || ''}`.toLowerCase();
    if (!textoPedido.includes(alvo)) return false;
  }

  if (filtros.recebIni && pedido.dataRecebimentoEstoque < filtros.recebIni) return false;
  if (filtros.recebFim && pedido.dataRecebimentoEstoque > filtros.recebFim) return false;
  if (filtros.vencIni && pedido.dataVencimento < filtros.vencIni) return false;
  if (filtros.vencFim && pedido.dataVencimento > filtros.vencFim) return false;

  return true;
}

function renderizarTabelaPedidos(lista) {
  const filtrados = lista.filter(pedidoPassaFiltros);

  filtrados.sort((a, b) => {
    const ordemA = ordemCriticidade(a._classificacao);
    const ordemB = ordemCriticidade(b._classificacao);
    if (ordemA !== ordemB) return ordemA - ordemB;
    const diasA = a._classificacao.diasRestantes ?? 0;
    const diasB = b._classificacao.diasRestantes ?? 0;
    return diasA - diasB;
  });

  // Mantém as duas representações (tabela e cartões) sempre atualizadas;
  // qual delas fica visível é decidido puramente pelo CSS, conforme o
  // "modo celular" (ver seção 10 e o atributo data-visualizacao).
  const corpo = document.getElementById('corpoTabelaPedidos');
  corpo.innerHTML = '';
  filtrados.forEach((pedido) => corpo.appendChild(criarLinhaPedido(pedido)));

  const containerCards = document.getElementById('listaCardsPedidos');
  containerCards.innerHTML = '';
  filtrados.forEach((pedido) => containerCards.appendChild(criarCardPedido(pedido)));

  document.getElementById('contadorListaPedidos').textContent = `(${filtrados.length})`;
  document.getElementById('mensagemListaVazia').hidden = filtrados.length > 0;
}

// Cria o <span> de badge de situação, reaproveitado pela tabela e pelo cartão.
function criarBadgeSituacao(pedido, classificacao) {
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.style.backgroundColor = classificacao.bg;
  badge.style.color = classificacao.texto;
  badge.title = classificacao.label;
  badge.textContent = textoSituacao(pedido, classificacao);
  return badge;
}

// Cria o indicador de Status de Separação (bolinha colorida + rótulo),
// reaproveitado pela tabela e pelo cartão. Independente da Situação (SLA).
function criarBadgeStatusSeparacao(pedido) {
  const chave = pedido.statusSeparacao || 'a-separar';
  const info = CONFIG_SEPARACAO[chave] || CONFIG_SEPARACAO['a-separar'];

  const span = document.createElement('span');
  span.className = 'status-separacao';
  span.title = info.label;

  const bolinha = document.createElement('span');
  bolinha.className = 'status-separacao-bolinha';
  bolinha.style.backgroundColor = info.cor;
  span.appendChild(bolinha);

  span.appendChild(document.createTextNode(info.label));
  return span;
}

// Nome do operador a exibir: quem iniciou (enquanto em separação) ou quem
// finalizou (quando já separado). Vazio enquanto o pedido ainda não foi
// atribuído a ninguém ("a separar").
function obterOperadorAtual(pedido) {
  if (pedido.statusSeparacao === 'separado') return pedido.operadorFimSeparacao || '-';
  if (pedido.statusSeparacao === 'em-separacao') return pedido.operadorInicioSeparacao || '-';
  return '-';
}

// Cria o indicador de Status de Organização (bolinha colorida + rótulo),
// reaproveitado pela tabela e pelo cartão. Independente da Situação (SLA) e
// do Status de Separação acima; mesma estrutura visual, a partir de
// CONFIG_ORGANIZACAO.
function criarBadgeStatusOrganizacao(pedido) {
  const chave = pedido.statusOrganizacao || 'a-organizar';
  const info = CONFIG_ORGANIZACAO[chave] || CONFIG_ORGANIZACAO['a-organizar'];

  const span = document.createElement('span');
  span.className = 'status-separacao';
  span.title = info.label;

  const bolinha = document.createElement('span');
  bolinha.className = 'status-separacao-bolinha';
  bolinha.style.backgroundColor = info.cor;
  span.appendChild(bolinha);

  span.appendChild(document.createTextNode(info.label));
  return span;
}

// Nome do operador de organização a exibir: mesmo critério de
// obterOperadorAtual, aplicado à etapa de organização.
function obterOperadorOrganizacaoAtual(pedido) {
  if (pedido.statusOrganizacao === 'organizado') return pedido.operadorFimOrganizacao || '-';
  if (pedido.statusOrganizacao === 'em-organizacao') return pedido.operadorInicioOrganizacao || '-';
  return '-';
}

// Indicador de status (bolinha colorida + rótulo) para Ativo/Inativo na tela
// Colaboradores - mesma estrutura visual usada pelo Status de Separação/
// Organização (criarBadgeStatusSeparacao/Organizacao), sem depender de
// CONFIG_SLA nem das outras duas configurações.
function criarIndicadorAtivoColaborador(ativo) {
  const span = document.createElement('span');
  span.className = 'status-separacao';
  span.title = ativo ? 'Ativo' : 'Inativo';

  const bolinha = document.createElement('span');
  bolinha.className = 'status-separacao-bolinha';
  bolinha.style.backgroundColor = ativo ? 'var(--cor-sucesso)' : 'var(--cor-texto-secundario)';
  span.appendChild(bolinha);

  span.appendChild(document.createTextNode(ativo ? 'Ativo' : 'Inativo'));
  return span;
}

// Renderiza a tabela da tela "Colaboradores" a partir de estado.colaboradores.
// Chamada sempre que a coleção é sincronizada (ver escutarColaboradoresEmTempoReal).
function renderizarTelaColaboradores() {
  const corpo = document.getElementById('corpoTabelaColaboradores');
  if (!corpo) return; // tela pode não estar presente (defensivo)

  const contador = document.getElementById('contadorColaboradores');
  const vazia = document.getElementById('mensagemColaboradoresVazia');

  const lista = estado.colaboradores.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  contador.textContent = `(${lista.length})`;
  vazia.hidden = lista.length > 0;
  corpo.innerHTML = '';

  lista.forEach((colaborador) => {
    const tr = document.createElement('tr');

    const tdNome = document.createElement('td');
    tdNome.textContent = colaborador.nome;
    tr.appendChild(tdNome);

    const tdStatus = document.createElement('td');
    tdStatus.appendChild(criarIndicadorAtivoColaborador(colaborador.ativo));
    tr.appendChild(tdStatus);

    const tdAcoes = document.createElement('td');
    tdAcoes.className = 'col-acoes';

    const btnEditar = document.createElement('button');
    btnEditar.type = 'button';
    btnEditar.className = 'btn btn-link';
    btnEditar.textContent = 'Editar';
    btnEditar.addEventListener('click', async () => {
      const novoNome = prompt('Novo nome para este colaborador:', colaborador.nome);
      if (novoNome === null) return; // cancelado
      const nomeTratado = novoNome.trim();
      if (!nomeTratado || nomeTratado === colaborador.nome) return;
      const existente = buscarColaboradorPorNome(nomeTratado);
      if (existente && existente.id !== colaborador.id) {
        alert(`Já existe um colaborador cadastrado como "${existente.nome}".`);
        return;
      }
      try {
        await editarNomeColaborador(colaborador, nomeTratado);
      } catch (erro) {
        alert('Erro ao editar colaborador: ' + erro.message);
      }
    });
    tdAcoes.appendChild(btnEditar);

    const btnAlternar = document.createElement('button');
    btnAlternar.type = 'button';
    btnAlternar.className = 'btn btn-link';
    btnAlternar.textContent = colaborador.ativo ? 'Desativar' : 'Reativar';
    btnAlternar.addEventListener('click', async () => {
      try {
        await alternarAtivoColaborador(colaborador);
      } catch (erro) {
        alert('Erro ao alterar status do colaborador: ' + erro.message);
      }
    });
    tdAcoes.appendChild(btnAlternar);

    const btnExcluir = document.createElement('button');
    btnExcluir.type = 'button';
    btnExcluir.className = 'btn btn-link btn-link-perigo';
    btnExcluir.textContent = 'Excluir';
    btnExcluir.addEventListener('click', async () => {
      if (!confirm(`Confirma excluir "${colaborador.nome}" da lista de colaboradores? Pedidos já registrados com este nome NÃO serão alterados.`)) return;
      try {
        await excluirColaborador(colaborador);
      } catch (erro) {
        alert('Erro ao excluir colaborador: ' + erro.message);
      }
    });
    tdAcoes.appendChild(btnExcluir);

    tr.appendChild(tdAcoes);
    corpo.appendChild(tr);
  });
}

// Cria os botões Editar/Excluir (e Reabrir, quando finalizado) dentro de um
// container, reaproveitado pela tabela e pelo cartão. A finalização deixou
// de ser manual (ver finalizarOrganizacaoPedido); "Reabrir" é a forma de
// corrigir um pedido finalizado por engano, devolvendo-o para "aberto" sem
// alterar os registros de separação/organização já feitos.
function criarBotoesAcoes(pedido, container) {
  const btnEditar = document.createElement('button');
  btnEditar.type = 'button';
  btnEditar.className = 'btn btn-link';
  btnEditar.textContent = 'Editar';
  btnEditar.disabled = pedido.status === 'finalizado';
  btnEditar.title = pedido.status === 'finalizado' ? 'Pedidos finalizados não podem ser editados' : 'Editar pedido';
  btnEditar.addEventListener('click', () => abrirModalEdicaoPedido(pedido));
  container.appendChild(btnEditar);

  if (pedido.status === 'finalizado') {
    const btnReabrir = document.createElement('button');
    btnReabrir.type = 'button';
    btnReabrir.className = 'btn btn-link';
    btnReabrir.textContent = 'Reabrir';
    btnReabrir.title = 'Reabrir pedido (volta para "aberto"; não altera os registros de separação/organização já feitos)';
    btnReabrir.addEventListener('click', () => {
      if (confirm(`Confirma reabrir o pedido ${pedido.numeroPedido}? Ele voltará para "aberto".`)) {
        reabrirPedido(pedido).catch((erro) => alert('Erro ao reabrir pedido: ' + erro.message));
      }
    });
    container.appendChild(btnReabrir);
  }

  const btnExcluir = document.createElement('button');
  btnExcluir.type = 'button';
  btnExcluir.className = 'btn btn-link btn-link-perigo';
  btnExcluir.textContent = 'Excluir';
  btnExcluir.addEventListener('click', () => {
    if (confirm(`Confirma a exclusão do pedido ${pedido.numeroPedido}? Esta ação não pode ser desfeita.`)) {
      excluirPedido(pedido.id).catch((erro) => alert('Erro ao excluir pedido: ' + erro.message));
    }
  });
  container.appendChild(btnExcluir);
}

// Determina a próxima fase/ação pendente do atalho de "Atribuição" (coluna
// da tabela/cartão de pedidos): qual das quatro etapas do fluxo de
// Separação + Organização ainda falta fazer neste pedido. Retorna null
// quando não há mais nada pendente por aqui (pedido já finalizado - a
// finalização automática de finalizarOrganizacaoPedido já cobre esse caso).
function obterEstadoAtribuicao(pedido) {
  if (pedido.status === 'finalizado') return null;
  if (pedido.statusSeparacao !== 'separado') {
    return { fase: 'separacao', acao: pedido.statusSeparacao === 'em-separacao' ? 'finalizar' : 'atribuir' };
  }
  if (pedido.statusOrganizacao !== 'organizado') {
    return { fase: 'organizacao', acao: pedido.statusOrganizacao === 'em-organizacao' ? 'finalizar' : 'atribuir' };
  }
  return null;
}

const ROTULOS_BOTAO_ATRIBUICAO = {
  'separacao-atribuir': 'Atribuir Separação',
  'separacao-finalizar': 'Finalizar Separação',
  'organizacao-atribuir': 'Atribuir Organização',
  'organizacao-finalizar': 'Finalizar Organização'
};

// Cria o botão (ou o texto "Concluído") da coluna/linha "Atribuição",
// reaproveitado pela tabela e pelo cartão. É um atalho para o mesmo fluxo
// do painel "Registro de Separação e Organização" (⏱️, que continua
// existindo sem nenhuma alteração): aqui o pedido já vem identificado (sem
// precisar digitar o número) e o nome é escolhido em uma lista suspensa,
// pelo modal #modalAtribuicaoFase (ver abrirModalAtribuicaoFase).
function criarBotaoAtribuicao(pedido) {
  const estadoAtribuicao = obterEstadoAtribuicao(pedido);

  if (!estadoAtribuicao) {
    const span = document.createElement('span');
    span.className = 'atribuicao-concluida';
    span.textContent = '✓ Concluído';
    return span;
  }

  const { fase, acao } = estadoAtribuicao;
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'btn btn-link';
  botao.textContent = ROTULOS_BOTAO_ATRIBUICAO[`${fase}-${acao}`];
  botao.addEventListener('click', () => abrirModalAtribuicaoFase(pedido, fase, acao));
  return botao;
}

// Monta a célula "Cliente" da tabela do Painel Consolidado. Além do nome do
// cliente, mostra em sub-linhas discretas: a Data de Recebimento no Estoque
// (só a data, acima do nome), o Representante e a data/hora de Cadastro na
// planilha de origem (quando o pedido veio de uma importação em lote - item
// 33 do README) e, por fim, a Modalidade (sem rótulo, só o valor trazido da
// planilha). Consolidar essas colunas dentro de Cliente e de Nº Pedido
// (ver criarLinhaPedido) foi pedido explícito do solicitante (item 35 do
// README): reduzir o número de colunas da tabela para evitar que o
// operador precise rolar a barra horizontal no dia a dia. Pedidos lançados
// manualmente não têm Representante/Cadastro/Modalidade e a célula mostra
// só Recebimento + nome do cliente, como antes das importações em lote.
function criarCelulaCliente(pedido) {
  const td = document.createElement('td');
  td.className = 'col-cliente';

  const spanRecebimento = document.createElement('span');
  spanRecebimento.className = 'cliente-sublinha';
  spanRecebimento.textContent = `Receb.: ${formatarBR(pedido.dataRecebimentoEstoque)}`;
  td.appendChild(spanRecebimento);

  const spanCliente = document.createElement('span');
  spanCliente.className = 'cliente-nome';
  spanCliente.textContent = pedido.cliente;
  td.appendChild(spanCliente);

  if (pedido.nomeRepresentante) {
    const spanRepresentante = document.createElement('span');
    spanRepresentante.className = 'cliente-sublinha';
    spanRepresentante.textContent = `Repr.: ${pedido.nomeRepresentante}`;
    td.appendChild(spanRepresentante);
  }

  if (pedido.cadastroPlanilha) {
    const spanCadastro = document.createElement('span');
    spanCadastro.className = 'cliente-sublinha';
    spanCadastro.textContent = `Cadastro: ${formatarDataHoraBR(pedido.cadastroPlanilha)}`;
    td.appendChild(spanCadastro);
  }

  if (pedido.modalidade) {
    const spanModalidade = document.createElement('span');
    spanModalidade.className = 'cliente-sublinha';
    spanModalidade.textContent = pedido.modalidade;
    td.appendChild(spanModalidade);
  }

  return td;
}

function criarLinhaPedido(pedido) {
  const classificacao = pedido._classificacao;
  const tr = document.createElement('tr');
  tr.title =
    `Criado em: ${formatarDataHoraBR(pedido.criadoEm)}` +
    (pedido.finalizadoEm ? ` • Finalizado em: ${formatarDataHoraBR(pedido.finalizadoEm)}` : '') +
    (pedido.dataHoraInicioSeparacao
      ? ` • Separação iniciada por ${pedido.operadorInicioSeparacao} em ${formatarDataHoraBrasilia(pedido.dataHoraInicioSeparacao)} (horário de Brasília)`
      : '') +
    (pedido.dataHoraFimSeparacao
      ? ` • Separação finalizada por ${pedido.operadorFimSeparacao} em ${formatarDataHoraBrasilia(pedido.dataHoraFimSeparacao)} (horário de Brasília)`
      : '') +
    (pedido.dataHoraInicioOrganizacao
      ? ` • Organização iniciada por ${pedido.operadorInicioOrganizacao} em ${formatarDataHoraBrasilia(pedido.dataHoraInicioOrganizacao)} (horário de Brasília)`
      : '') +
    (pedido.dataHoraFimOrganizacao
      ? ` • Organização finalizada por ${pedido.operadorFimOrganizacao} em ${formatarDataHoraBrasilia(pedido.dataHoraFimOrganizacao)} (horário de Brasília)`
      : '');

  // Célula "Nº Pedido": consolida também a Observação (sub-linha acima, só
  // quando houver - "se tiver", por pedido do solicitante) e o SLA
  // (sub-linha abaixo, sem o rótulo "SLA" - só "N dias") - colunas que
  // existiam separadas até o item 34 e foram agrupadas aqui no item 35 do
  // README, para reduzir o número de colunas da tabela.
  const tdNumero = document.createElement('td');
  tdNumero.className = 'col-numero';
  if (pedido.observacao) {
    const spanObs = document.createElement('span');
    spanObs.className = 'numero-sublinha';
    spanObs.textContent = pedido.observacao;
    spanObs.title = pedido.observacao; // texto completo ao passar o mouse, se for truncado na coluna estreita
    tdNumero.appendChild(spanObs);
  }
  const spanNumero = document.createElement('span');
  spanNumero.className = 'numero-valor';
  spanNumero.textContent = pedido.numeroPedido;
  tdNumero.appendChild(spanNumero);
  const spanSla = document.createElement('span');
  spanSla.className = 'numero-sublinha';
  spanSla.textContent = `${pedido.slaDias} dias`;
  tdNumero.appendChild(spanSla);
  tr.appendChild(tdNumero);

  tr.appendChild(criarCelulaCliente(pedido));

  const celulasData = [formatarBR(pedido.dataPedido), formatarBR(pedido.dataVencimento)];
  celulasData.forEach((valor) => {
    const td = document.createElement('td');
    td.textContent = valor;
    tr.appendChild(td);
  });

  const tdSituacao = document.createElement('td');
  tdSituacao.appendChild(criarBadgeSituacao(pedido, classificacao));
  tr.appendChild(tdSituacao);

  const tdStatus = document.createElement('td');
  tdStatus.appendChild(criarBadgeStatusSeparacao(pedido));
  tr.appendChild(tdStatus);

  const tdOperador = document.createElement('td');
  tdOperador.className = 'col-operador';
  tdOperador.textContent = obterOperadorAtual(pedido);
  tr.appendChild(tdOperador);

  const tdOrganizacao = document.createElement('td');
  tdOrganizacao.appendChild(criarBadgeStatusOrganizacao(pedido));
  const nomeOrganizadorLinha = obterOperadorOrganizacaoAtual(pedido);
  if (nomeOrganizadorLinha !== '-') {
    const spanOrganizador = document.createElement('span');
    spanOrganizador.className = 'organizador-nome';
    spanOrganizador.textContent = nomeOrganizadorLinha;
    tdOrganizacao.appendChild(spanOrganizador);
  }
  tr.appendChild(tdOrganizacao);

  const tdAtribuicao = document.createElement('td');
  tdAtribuicao.className = 'col-atribuicao';
  tdAtribuicao.appendChild(criarBotaoAtribuicao(pedido));
  tr.appendChild(tdAtribuicao);

  const tdAcoes = document.createElement('td');
  tdAcoes.className = 'col-acoes';
  criarBotoesAcoes(pedido, tdAcoes);
  tr.appendChild(tdAcoes);

  return tr;
}

// Versão em cartão da mesma linha de pedido, usada no "modo celular".
function criarCardPedido(pedido) {
  const classificacao = pedido._classificacao;
  const card = document.createElement('div');
  card.className = 'card-pedido';
  card.title =
    `Criado em: ${formatarDataHoraBR(pedido.criadoEm)}` +
    (pedido.finalizadoEm ? ` • Finalizado em: ${formatarDataHoraBR(pedido.finalizadoEm)}` : '');

  const topo = document.createElement('div');
  topo.className = 'card-pedido-topo';
  const numero = document.createElement('span');
  numero.textContent = `Nº ${pedido.numeroPedido}`;
  topo.appendChild(numero);
  topo.appendChild(criarBadgeSituacao(pedido, classificacao));
  card.appendChild(topo);

  const cliente = document.createElement('div');
  cliente.className = 'card-pedido-cliente';
  cliente.textContent = pedido.cliente;
  card.appendChild(cliente);

  // Sub-linhas com dados trazidos pela importação em lote (item 33 do
  // README) - ausentes em pedidos lançados manualmente.
  if (pedido.nomeRepresentante) {
    const representante = document.createElement('div');
    representante.className = 'card-pedido-sublinha';
    representante.textContent = `Repr.: ${pedido.nomeRepresentante}`;
    card.appendChild(representante);
  }
  if (pedido.cadastroPlanilha) {
    const cadastro = document.createElement('div');
    cadastro.className = 'card-pedido-sublinha';
    cadastro.textContent = `Cadastro: ${formatarDataHoraBR(pedido.cadastroPlanilha)}`;
    card.appendChild(cadastro);
  }

  const linhaStatusSeparacao = document.createElement('div');
  linhaStatusSeparacao.className = 'card-pedido-status-separacao';
  linhaStatusSeparacao.appendChild(criarBadgeStatusSeparacao(pedido));
  const nomeOperador = obterOperadorAtual(pedido);
  if (nomeOperador !== '-') {
    const operadorSpan = document.createElement('span');
    operadorSpan.className = 'card-pedido-operador';
    operadorSpan.textContent = nomeOperador;
    linhaStatusSeparacao.appendChild(operadorSpan);
  }
  card.appendChild(linhaStatusSeparacao);

  const linhaStatusOrganizacao = document.createElement('div');
  linhaStatusOrganizacao.className = 'card-pedido-status-separacao';
  linhaStatusOrganizacao.appendChild(criarBadgeStatusOrganizacao(pedido));
  const nomeOperadorOrganizacao = obterOperadorOrganizacaoAtual(pedido);
  if (nomeOperadorOrganizacao !== '-') {
    const operadorOrgSpan = document.createElement('span');
    operadorOrgSpan.className = 'card-pedido-operador';
    operadorOrgSpan.textContent = nomeOperadorOrganizacao;
    linhaStatusOrganizacao.appendChild(operadorOrgSpan);
  }
  card.appendChild(linhaStatusOrganizacao);

  const grid = document.createElement('div');
  grid.className = 'card-pedido-grid';
  grid.innerHTML = `
    <span>Pedido: ${formatarBR(pedido.dataPedido)}</span>
    <span>Recebimento: ${formatarBR(pedido.dataRecebimentoEstoque)}</span>
    <span>SLA: ${pedido.slaDias} dias úteis</span>
    <span>Vencimento: ${formatarBR(pedido.dataVencimento)}</span>
    ${pedido.modalidade ? `<span>Modalidade: ${escaparHTML(pedido.modalidade)}</span>` : ''}
  `;
  card.appendChild(grid);

  if (pedido.observacao) {
    const obs = document.createElement('div');
    obs.className = 'card-pedido-obs';
    obs.textContent = pedido.observacao;
    card.appendChild(obs);
  }

  const rodape = document.createElement('div');
  rodape.className = 'card-pedido-rodape';

  const linhaAtribuicao = document.createElement('div');
  linhaAtribuicao.className = 'card-pedido-atribuicao';
  linhaAtribuicao.appendChild(criarBotaoAtribuicao(pedido));
  rodape.appendChild(linhaAtribuicao);

  const acoes = document.createElement('div');
  acoes.className = 'card-pedido-acoes';
  criarBotoesAcoes(pedido, acoes);
  rodape.appendChild(acoes);

  card.appendChild(rodape);

  return card;
}

/* -------------------------------------------------------------------------
   Histórico operacional + gráfico de barras empilhadas em SVG puro
   ------------------------------------------------------------------------- */

// Retorna a data (yyyy-mm-dd) usada para agrupar um pedido, conforme o
// tipo de agrupamento selecionado.
function obterDataBucket(pedido, tipoAgrupamento) {
  if (tipoAgrupamento === 'vencimento') return pedido.dataVencimento || null;
  if (tipoAgrupamento === 'finalizacao') return timestampParaISO(pedido.finalizadoEm);
  return pedido.dataRecebimentoEstoque || null; // padrão: recebimento
}

/**
 * Calcula o histórico dos últimos N dias para o agrupamento selecionado.
 * Cada linha representa uma data e agrega os pedidos cujo campo de data
 * correspondente ao agrupamento caia naquele dia:
 *   - recebidos: total de pedidos do grupo (volume do dia)
 *   - finalizados: quantos, dentro do grupo, já estão concluídos
 *   - pendentes: quantos, dentro do grupo, ainda estão em aberto
 *   - atrasados: dentre os pendentes, quantos estão atualmente atrasados
 *   - percentualConclusao: finalizados / total do grupo
 */
function calcularHistorico(tipoAgrupamento, diasJanela = 14) {
  const hoje = parseDataLocal(hojeISO());
  const datasJanela = [];
  for (let i = diasJanela - 1; i >= 0; i--) {
    const data = new Date(hoje);
    data.setDate(data.getDate() - i);
    datasJanela.push(formatarISO(data));
  }

  return datasJanela.map((data) => {
    const grupo = estado.pedidos.filter((pedido) => obterDataBucket(pedido, tipoAgrupamento) === data);
    const finalizados = grupo.filter((pedido) => pedido.status === 'finalizado').length;
    const pendentes = grupo.filter((pedido) => pedido.status === 'aberto').length;
    const atrasados = grupo.filter(
      (pedido) => pedido.status === 'aberto' && diferencaEmDiasUteis(hojeISO(), pedido.dataVencimento) < 0
    ).length;
    const total = grupo.length;
    const percentualConclusao = total > 0 ? Math.round((finalizados / total) * 100) : 0;

    return { data, recebidos: total, finalizados, pendentes, atrasados, percentualConclusao };
  });
}

function renderizarHistorico() {
  const dados = calcularHistorico(estado.agrupamentoHistorico, 14);

  const corpo = document.getElementById('corpoTabelaHistorico');
  corpo.innerHTML = '';
  dados.forEach((linha) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatarBR(linha.data)}</td>
      <td>${linha.recebidos}</td>
      <td>${linha.finalizados}</td>
      <td>${linha.pendentes}</td>
      <td>${linha.atrasados}</td>
      <td>${linha.percentualConclusao}%</td>
    `;
    corpo.appendChild(tr);
  });

  renderizarGraficoSvg(dados);
}

// Lê o valor atual de uma variável CSS (para o gráfico acompanhar o tema).
function obterCorCss(nomeVariavel) {
  const valor = getComputedStyle(document.documentElement).getPropertyValue(nomeVariavel);
  return valor ? valor.trim() : '#999999';
}

function renderizarGraficoSvg(dados) {
  const container = document.getElementById('graficoHistoricoSvgContainer');
  container.innerHTML = '';

  const svgNS = 'http://www.w3.org/2000/svg';
  const larguraBarra = 22;
  const alturaTotal = 240;
  const margemInferior = 34;
  const margemSuperior = 10;
  const alturaUtil = alturaTotal - margemInferior - margemSuperior;
  const larguraTotal = Math.max(620, dados.length * 44);
  const espacamento = (larguraTotal - dados.length * larguraBarra) / (dados.length + 1);

  const maiorTotal = Math.max(1, ...dados.map((linha) => linha.recebidos));

  const corFinalizado = obterCorCss('--cor-grafico-finalizado');
  const corPendente = obterCorCss('--cor-grafico-pendente');
  const corAtrasado = obterCorCss('--cor-grafico-atrasado');

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${larguraTotal} ${alturaTotal}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', alturaTotal);
  svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');

  dados.forEach((linha, indice) => {
    const pendentesNoPrazo = Math.max(0, linha.pendentes - linha.atrasados);
    const segmentos = [
      { valor: linha.finalizados, cor: corFinalizado, rotulo: 'Finalizados' },
      { valor: pendentesNoPrazo, cor: corPendente, rotulo: 'Pendentes' },
      { valor: linha.atrasados, cor: corAtrasado, rotulo: 'Atrasados' }
    ];

    const x = espacamento + indice * (larguraBarra + espacamento);
    let yAcumulado = alturaTotal - margemInferior;

    segmentos.forEach((segmento) => {
      const alturaSegmento = (segmento.valor / maiorTotal) * alturaUtil;
      if (alturaSegmento > 0) {
        const rect = document.createElementNS(svgNS, 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', yAcumulado - alturaSegmento);
        rect.setAttribute('width', larguraBarra);
        rect.setAttribute('height', alturaSegmento);
        rect.setAttribute('fill', segmento.cor);
        rect.setAttribute('rx', '2');
        const titulo = document.createElementNS(svgNS, 'title');
        titulo.textContent = `${formatarBR(linha.data)} · ${segmento.rotulo}: ${segmento.valor}`;
        rect.appendChild(titulo);
        svg.appendChild(rect);
      }
      yAcumulado -= alturaSegmento;
    });

    const rotuloEixo = document.createElementNS(svgNS, 'text');
    rotuloEixo.setAttribute('x', x + larguraBarra / 2);
    rotuloEixo.setAttribute('y', alturaTotal - margemInferior + 16);
    rotuloEixo.setAttribute('text-anchor', 'middle');
    rotuloEixo.setAttribute('class', 'grafico-rotulo-eixo');
    rotuloEixo.textContent = formatarBR(linha.data).slice(0, 5);
    svg.appendChild(rotuloEixo);
  });

  container.appendChild(svg);

  const legenda = document.createElement('div');
  legenda.className = 'grafico-legenda';
  legenda.innerHTML = `
    <span><i class="legenda-cor" style="background:${corFinalizado}"></i>Finalizados</span>
    <span><i class="legenda-cor" style="background:${corPendente}"></i>Pendentes</span>
    <span><i class="legenda-cor" style="background:${corAtrasado}"></i>Atrasados</span>
  `;
  container.appendChild(legenda);
}

/* -------------------------------------------------------------------------
   Faixa fixa estilo painel de aeroporto
   ------------------------------------------------------------------------- */
function renderizarFaixaAeroporto(lista) {
  const abertos = lista.filter((pedido) => pedido.status === 'aberto');
  const atrasados = abertos.filter((pedido) => ['marrom', 'roxo'].includes(pedido._classificacao.chave)).length;
  const venceHoje = abertos.filter((pedido) => pedido._classificacao.chave === 'vence-hoje').length;

  const contagemPorDia = {};
  abertos.forEach((pedido) => {
    const dias = pedido._classificacao.diasRestantes;
    if (dias > 0) {
      contagemPorDia[dias] = (contagemPorDia[dias] || 0) + 1;
    }
  });

  const partes = [];
  partes.push(`${atrasados} PEDIDO${atrasados !== 1 ? 'S' : ''} ATRASADO${atrasados !== 1 ? 'S' : ''}`);
  partes.push(`${venceHoje} VENCE${venceHoje !== 1 ? 'M' : ''} HOJE`);

  Object.keys(contagemPorDia)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach((dias) => {
      const quantidade = contagemPorDia[dias];
      partes.push(`${quantidade} VENCE${quantidade !== 1 ? 'M' : ''} EM ${dias} DIA${dias > 1 ? 'S' : ''}`);
    });

  const texto = partes.join('   |   ');

  montarTrilhoFaixaAeroporto(texto);

  // Cor geral do rodapé: azul enquanto houver pedidos em aberto (fila com
  // trabalho pendente), verde quando não houver nenhum pedido em aberto.
  const rodape = document.getElementById('faixaAeroporto');
  if (rodape) {
    rodape.classList.remove('pendencias', 'verde');
    rodape.classList.add(abertos.length > 0 ? 'pendencias' : 'verde');
  }
}

// Preenche a faixa de rolagem com UMA única cópia do texto por vez: ela
// entra pela borda direita da tela, atravessa e sai pela esquerda, com um
// intervalo vazio até reaparecer - como um letreiro tradicional de painel
// de aeroporto (sem várias cópias repetidas lado a lado). A velocidade é
// fixada em pixels por segundo, então a rolagem sempre parece igualmente
// rápida, independentemente do tamanho do texto.
const VELOCIDADE_ROLAGEM_PX_POR_SEGUNDO = 80;

function montarTrilhoFaixaAeroporto(texto) {
  const trilho = document.getElementById('trilhoFaixaAeroporto');
  const rodape = document.getElementById('faixaAeroporto');
  if (!trilho || !rodape) return;

  trilho.innerHTML = '';
  const bloco = document.createElement('div');
  bloco.className = 'faixa-aeroporto-conteudo';
  bloco.textContent = texto;
  trilho.appendChild(bloco);

  const larguraJanela = rodape.clientWidth || window.innerWidth || 1200;
  const larguraTexto = bloco.offsetWidth;

  // Posição inicial: totalmente fora da tela, à direita (a uma distância
  // igual à largura da própria tela). Posição final: totalmente fora da
  // tela, à esquerda (recuada pela largura do próprio texto).
  trilho.style.setProperty('--x-inicial-faixa-aeroporto', `${larguraJanela}px`);
  trilho.style.setProperty('--x-final-faixa-aeroporto', `${-larguraTexto}px`);

  const distanciaTotalPercorrida = larguraJanela + larguraTexto;
  const duracaoSegundos = Math.max(8, distanciaTotalPercorrida / VELOCIDADE_ROLAGEM_PX_POR_SEGUNDO);
  trilho.style.setProperty('--duracao-faixa-aeroporto', `${duracaoSegundos}s`);
}

/* -------------------------------------------------------------------------
   Painel de Tempos: métricas de separação e organização
   -------------------------------------------------------------------------
   Tudo calculado no cliente a partir de estado.pedidos (a mesma coleção do
   Firestore já usada pelo resto do app) - não é necessário nenhum banco ou
   coleção adicional. "Concluída" aqui significa pedido com as duas etapas
   completas (statusSeparacao = 'separado' e statusOrganizacao =
   'organizado'), o que hoje corresponde exatamente a pedido.status ===
   'finalizado', já que a finalização passou a ser automática.
   ------------------------------------------------------------------------- */

// Converte um Timestamp do Firebase (ou Date/ISO) em milissegundos (epoch), ou null.
function timestampParaMs(timestamp) {
  if (!timestamp) return null;
  const data = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return data.getTime();
}

// Formata uma duração em milissegundos como "Xh Ymin" (ou só "Ymin" se < 1h).
function formatarDuracao(ms) {
  if (ms == null || Number.isNaN(ms) || ms < 0) return '-';
  const totalMinutos = Math.round(ms / 60000);
  if (totalMinutos < 1) return '< 1min';
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  return horas > 0 ? `${horas}h ${minutos}min` : `${minutos}min`;
}

// Duração (ms) da etapa de separação de um pedido, ou null se incompleta.
function duracaoSeparacaoMs(pedido) {
  const inicio = timestampParaMs(pedido.dataHoraInicioSeparacao);
  const fim = timestampParaMs(pedido.dataHoraFimSeparacao);
  return inicio == null || fim == null ? null : fim - inicio;
}

// Duração (ms) da etapa de organização de um pedido, ou null se incompleta.
function duracaoOrganizacaoMs(pedido) {
  const inicio = timestampParaMs(pedido.dataHoraInicioOrganizacao);
  const fim = timestampParaMs(pedido.dataHoraFimOrganizacao);
  return inicio == null || fim == null ? null : fim - inicio;
}

// Duração total (ms) = separação + organização, ou null se qualquer uma das
// duas etapas ainda não estiver completa.
function duracaoTotalMs(pedido) {
  const separacao = duracaoSeparacaoMs(pedido);
  const organizacao = duracaoOrganizacaoMs(pedido);
  return separacao == null || organizacao == null ? null : separacao + organizacao;
}

/**
 * Agrupa, por operador, o tempo médio de uma etapa (separação ou
 * organização) e o percentual de participação no volume total de pedidos
 * com aquela etapa concluída. O tempo é atribuído a quem REGISTROU O FIM da
 * etapa (operadorFimSeparacao / operadorFimOrganizacao) - premissa adotada
 * porque, na prática, o mesmo operador normalmente inicia e finaliza a
 * própria etapa de um pedido.
 *
 * Também soma, para os mesmos pedidos (etapa concluída por aquele
 * operador): o total de caixas (quantidadeCaixas) e - quando `somarPeso` é
 * true (usado só para a Organização, onde o peso e a cubagem são de fato
 * registrados) - o peso total aferido (pesoCargaKg) e o peso cubado total
 * (pesoCubadoKg, somando o peso cubado de cada pedido - item 31 do README).
 * Pedidos sem quantidadeCaixas/pesoCargaKg/pesoCubadoKg (cadastrados antes
 * desta atualização, ou cuja Organização ainda não foi finalizada) são
 * ignorados nessas somas, sem gerar erro.
 *
 * Desde o item 32 do README, quantidadeCaixas passou a significar a
 * quantidade FECHADA de caixas, informada apenas ao finalizar a
 * Organização (não mais a quantidade lançada no cadastro do pedido, que
 * agora é o campo separado quantidadeItens). Por isso "caixas" aparece
 * tanto na lista de Separação quanto na de Organização deste painel, mas
 * só é contabilizado - em qualquer uma das duas listas - depois que a
 * Organização daquele pedido for finalizada; pedidos ainda em separação
 * ou em organização aparecem com 0 caixas até lá.
 */
function calcularTemposPorOperador(lista, campoOperadorFim, funcaoDuracao, somarPeso = false) {
  const registros = lista
    .map((pedido) => ({
      operador: pedido[campoOperadorFim],
      duracao: funcaoDuracao(pedido),
      caixas: pedido.quantidadeCaixas,
      peso: pedido.pesoCargaKg,
      pesoCubado: pedido.pesoCubadoKg
    }))
    .filter((registro) => registro.operador && registro.duracao != null);

  const totalRegistros = registros.length;
  const porOperador = new Map();
  registros.forEach(({ operador, duracao, caixas, peso, pesoCubado }) => {
    if (!porOperador.has(operador)) {
      porOperador.set(operador, { somaMs: 0, contagem: 0, somaCaixas: 0, somaPeso: 0, temPeso: false, somaPesoCubado: 0, temPesoCubado: false });
    }
    const acumulado = porOperador.get(operador);
    acumulado.somaMs += duracao;
    acumulado.contagem += 1;
    if (typeof caixas === 'number' && !Number.isNaN(caixas)) acumulado.somaCaixas += caixas;
    if (somarPeso && typeof peso === 'number' && !Number.isNaN(peso)) {
      acumulado.somaPeso += peso;
      acumulado.temPeso = true;
    }
    if (somarPeso && typeof pesoCubado === 'number' && !Number.isNaN(pesoCubado)) {
      acumulado.somaPesoCubado += pesoCubado;
      acumulado.temPesoCubado = true;
    }
  });

  return Array.from(porOperador.entries())
    .map(([operador, { somaMs, contagem, somaCaixas, somaPeso, temPeso, somaPesoCubado, temPesoCubado }]) => ({
      operador,
      tempoMedioMs: somaMs / contagem,
      quantidade: contagem,
      percentual: totalRegistros > 0 ? Math.round((contagem / totalRegistros) * 100) : 0,
      totalCaixas: somaCaixas,
      totalPesoKg: temPeso ? somaPeso : null,
      totalPesoCubadoKg: temPesoCubado ? somaPesoCubado : null
    }))
    .sort((a, b) => b.quantidade - a.quantidade);
}

// Formata um peso em kg para exibição (1 casa decimal, separador brasileiro).
function formatarPesoKg(valorKg) {
  if (valorKg == null) return '-';
  return `${valorKg.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })} kg`;
}

function renderizarListaTemposOperador(idLista, idMensagemVazia, dados) {
  const lista = document.getElementById(idLista);
  const mensagemVazia = document.getElementById(idMensagemVazia);
  if (!lista) return;
  lista.innerHTML = '';

  if (dados.length === 0) {
    if (mensagemVazia) mensagemVazia.hidden = false;
    return;
  }
  if (mensagemVazia) mensagemVazia.hidden = true;

  dados.forEach((item) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="tempo-operador-linha-principal">
        <span class="tempo-operador-nome">${item.operador}</span>
        <span class="tempo-operador-metricas">
          <span>${formatarDuracao(item.tempoMedioMs)}</span>
          <span>${item.percentual}%</span>
        </span>
      </div>
      <div class="tempo-operador-linha-extra">
        <span>${item.totalCaixas} cx</span>
        ${item.totalPesoKg != null ? `<span>${formatarPesoKg(item.totalPesoKg)}</span>` : ''}
        ${item.totalPesoCubadoKg != null ? `<span>${formatarPesoKg(item.totalPesoCubadoKg)} cubado</span>` : ''}
      </div>
    `;
    lista.appendChild(li);
  });
}

/**
 * Calcula o histórico diário de tempos (últimos N dias, agrupado pela Data
 * do Pedido - o mesmo critério usado em "Dias registrados" no indicador
 * geral). Para cada dia:
 *   - total: pedidos lançados naquele dia
 *   - concluidas: quantos, dentre esses, já foram finalizados (separação +
 *     organização completas)
 *   - pendentes: total - concluidas
 *   - status: selo resumindo o andamento do dia (Concluído / Em andamento /
 *     Pendente / "-" quando não há pedidos naquele dia)
 *   - tempoMedioMs: tempo médio total (separação + organização) dos
 *     pedidos concluídos daquele dia
 *   - percentualEfetuado: concluidas ÷ total do dia
 */
function calcularHistoricoTempos(diasJanela = 14) {
  const hoje = parseDataLocal(hojeISO());
  const datasJanela = [];
  for (let i = diasJanela - 1; i >= 0; i--) {
    const data = new Date(hoje);
    data.setDate(data.getDate() - i);
    datasJanela.push(formatarISO(data));
  }

  return datasJanela.map((data) => {
    const grupo = estado.pedidos.filter((pedido) => pedido.dataPedido === data);
    const total = grupo.length;
    const concluidos = grupo.filter((pedido) => pedido.status === 'finalizado');
    const concluidas = concluidos.length;
    const pendentes = total - concluidas;

    let status;
    if (total === 0) status = '-';
    else if (pendentes === 0) status = 'Concluído';
    else if (concluidas > 0) status = 'Em andamento';
    else status = 'Pendente';

    const duracoes = concluidos.map(duracaoTotalMs).filter((valor) => valor != null);
    const tempoMedioMs = duracoes.length > 0 ? duracoes.reduce((soma, valor) => soma + valor, 0) / duracoes.length : null;
    const percentualEfetuado = total > 0 ? Math.round((concluidas / total) * 100) : null;

    return { data, total, pendentes, status, concluidas, tempoMedioMs, percentualEfetuado };
  });
}

function renderizarPainelTempos() {
  const elTotal = document.getElementById('tempoIndTotal');
  if (!elTotal) return; // painel ainda não presente no DOM (defensivo)

  const total = estado.pedidos.length;
  const concluidas = estado.pedidos.filter((pedido) => pedido.status === 'finalizado').length;
  const pendentes = total - concluidas;
  const taxaConclusao = total > 0 ? Math.round((concluidas / total) * 100) : 0;
  const diasRegistrados = new Set(estado.pedidos.map((pedido) => pedido.dataPedido).filter(Boolean)).size;

  elTotal.textContent = total;
  document.getElementById('tempoIndPendentes').textContent = pendentes;
  document.getElementById('tempoIndConcluidas').textContent = concluidas;
  document.getElementById('tempoIndDiasRegistrados').textContent = diasRegistrados;
  document.getElementById('tempoIndTaxaConclusao').textContent = `${taxaConclusao}%`;

  const temposSeparacao = calcularTemposPorOperador(estado.pedidos, 'operadorFimSeparacao', duracaoSeparacaoMs);
  const temposOrganizacao = calcularTemposPorOperador(estado.pedidos, 'operadorFimOrganizacao', duracaoOrganizacaoMs, true);
  renderizarListaTemposOperador('listaTemposSeparacao', 'mensagemVaziaTemposSeparacao', temposSeparacao);
  renderizarListaTemposOperador('listaTemposOrganizacao', 'mensagemVaziaTemposOrganizacao', temposOrganizacao);

  const historico = calcularHistoricoTempos(14);
  const corpo = document.getElementById('corpoTabelaHistoricoTempos');
  corpo.innerHTML = '';
  historico.forEach((linha) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatarBR(linha.data)}</td>
      <td>${linha.total}</td>
      <td>${linha.pendentes}</td>
      <td>${linha.status}</td>
      <td>${linha.concluidas}</td>
      <td>${linha.tempoMedioMs != null ? formatarDuracao(linha.tempoMedioMs) : '-'}</td>
      <td>${linha.percentualEfetuado != null ? linha.percentualEfetuado + '%' : '-'}</td>
    `;
    corpo.appendChild(tr);
  });
}

/* =========================================================================
   8. MODAIS
   ========================================================================= */

// Abre o modal exclusivamente para EDITAR um pedido existente. A criação de
// novos pedidos é feita pelo formulário inline em "Adicionar Novo Pedido"
// (ver função configurarFormularioInlineNovoPedido), sem modal.
function abrirModalEdicaoPedido(pedido) {
  const form = document.getElementById('formPedido');
  form.reset();
  document.getElementById('erroFormPedido').hidden = true;

  document.getElementById('campoPedidoId').value = pedido.id;
  document.getElementById('campoNumeroPedido').value = pedido.numeroPedido;
  document.getElementById('campoCliente').value = pedido.cliente;
  document.getElementById('campoDataPedido').value = pedido.dataPedido;
  document.getElementById('campoDataRecebimento').value = pedido.dataRecebimentoEstoque;
  document.getElementById('campoSlaDias').value = pedido.slaDias;
  // Pedidos cadastrados antes do item 32 (README) têm o dado antigo gravado
  // no campo quantidadeCaixas (que, à época, significava a mesma coisa que
  // quantidadeItens agora) - usa-o como fallback só para não perder o
  // histórico já digitado. Pedidos sem nenhum dos dois ficam em branco e,
  // como o campo é obrigatório, a pessoa precisa preencher ao salvar.
  document.getElementById('campoQuantidadeItens').value = pedido.quantidadeItens != null
    ? pedido.quantidadeItens
    : (pedido.quantidadeCaixas || '');
  document.getElementById('campoObservacao').value = pedido.observacao || '';

  // Correção manual dos registros de Separação e Organização (nome do
  // operador e data/hora de início e fim, sempre exibidos no horário de
  // Brasília - ver timestampParaDatetimeLocalBrasilia).
  popularSelectOperador('campoEditarOperadorInicioSeparacao', '(nenhum)', pedido.operadorInicioSeparacao || '');
  document.getElementById('campoEditarDataHoraInicioSeparacao').value = timestampParaDatetimeLocalBrasilia(pedido.dataHoraInicioSeparacao);
  popularSelectOperador('campoEditarOperadorFimSeparacao', '(nenhum)', pedido.operadorFimSeparacao || '');
  document.getElementById('campoEditarDataHoraFimSeparacao').value = timestampParaDatetimeLocalBrasilia(pedido.dataHoraFimSeparacao);

  popularSelectOperador('campoEditarOperadorInicioOrganizacao', '(nenhum)', pedido.operadorInicioOrganizacao || '');
  document.getElementById('campoEditarDataHoraInicioOrganizacao').value = timestampParaDatetimeLocalBrasilia(pedido.dataHoraInicioOrganizacao);
  popularSelectOperador('campoEditarOperadorFimOrganizacao', '(nenhum)', pedido.operadorFimOrganizacao || '');
  document.getElementById('campoEditarDataHoraFimOrganizacao').value = timestampParaDatetimeLocalBrasilia(pedido.dataHoraFimOrganizacao);
  document.getElementById('campoEditarPesoCargaKg').value = pedido.pesoCargaKg != null ? pedido.pesoCargaKg : '';
  // quantidadeCaixas aqui é sempre a quantidade FECHADA, informada só ao
  // finalizar a Organização (item 32) - diferente do fallback usado acima
  // para quantidadeItens, pois pedidos anteriores ao item 32 nunca tiveram
  // esse dado com esse significado.
  document.getElementById('campoEditarQuantidadeCaixas').value = pedido.quantidadeCaixas != null ? pedido.quantidadeCaixas : '';
  document.getElementById('campoEditarAlturaCm').value = pedido.alturaCm != null ? pedido.alturaCm : '';
  document.getElementById('campoEditarLarguraCm').value = pedido.larguraCm != null ? pedido.larguraCm : '';
  document.getElementById('campoEditarComprimentoCm').value = pedido.comprimentoCm != null ? pedido.comprimentoCm : '';
  document.getElementById('previewPesoCubadoEditar').textContent = pedido.pesoCubadoKg != null ? formatarPesoKg(pedido.pesoCubadoKg) : '—';

  // Dados trazidos pela importação em lote via planilha (item 33 do
  // README) - a seção só aparece quando o pedido tem pelo menos um desses
  // campos preenchido, ou seja, quando veio de uma importação; pedidos
  // lançados manualmente não mostram essa seção.
  const temDadosImportacao = Boolean(
    pedido.idExterno || pedido.parceiroCodigo || pedido.modalidade || pedido.nomeRepresentante
  );
  document.getElementById('secaoDadosImportacao').hidden = !temDadosImportacao;
  if (temDadosImportacao) {
    document.getElementById('valorEditarIdExterno').textContent = pedido.idExterno || '–';
    document.getElementById('valorEditarParceiroCodigo').textContent = pedido.parceiroCodigo || '–';
    document.getElementById('valorEditarModalidade').textContent = pedido.modalidade || '–';
    document.getElementById('valorEditarNomeRepresentante').textContent = pedido.nomeRepresentante || '–';
  }

  atualizarPreviewVencimento('campoDataRecebimento', 'campoSlaDias', 'previewVencimento');
  document.getElementById('modalPedido').hidden = false;
  document.getElementById('campoNumeroPedido').focus();
}

function fecharModalPedido() {
  document.getElementById('modalPedido').hidden = true;
}

// Atualiza o texto de preview do vencimento calculado. Recebe os IDs dos
// campos porque é reaproveitada tanto pelo modal de edição quanto pelo
// formulário inline de criação de pedidos.
function atualizarPreviewVencimento(idCampoRecebimento, idCampoSla, idPreview) {
  const recebimento = document.getElementById(idCampoRecebimento).value;
  const sla = Number(document.getElementById(idCampoSla).value);
  const preview = document.getElementById(idPreview);
  if (recebimento && sla > 0) {
    preview.textContent = formatarBR(calcularDataVencimento(recebimento, sla));
  } else {
    preview.textContent = '–';
  }
}

function abrirModalGrupo(titulo, pedidos) {
  document.getElementById('modalGrupoTitulo').textContent = titulo;
  const lista = document.getElementById('listaModalGrupo');
  lista.innerHTML = '';

  pedidos
    .slice()
    .sort((a, b) => (a._classificacao.diasRestantes ?? 0) - (b._classificacao.diasRestantes ?? 0))
    .forEach((pedido) => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${pedido.numeroPedido}</strong> — ${pedido.cliente}
        <span class="lista-modal-venc">Vencimento: ${formatarBR(pedido.dataVencimento)}</span>`;
      lista.appendChild(li);
    });

  document.getElementById('modalGrupo').hidden = false;
}

function fecharModalGrupo() {
  document.getElementById('modalGrupo').hidden = true;
}

// Alerta exibido assim que "Finalizar Organização" é concluída com sucesso
// - pelo modal ⏱️ ou pelo atalho "Atribuição" - quando a quantidade de
// caixas FECHADAS informada é maior que 15 (item 33 do README). É só um
// aviso: a finalização em si já aconteceu no Firestore antes deste alerta
// aparecer, então fechá-lo não desfaz nem repete nada.
function exibirAlertaCaixasSeNecessario(numeroPedido, quantidadeCaixas) {
  if (!(Number(quantidadeCaixas) > 15)) return;
  document.getElementById('textoAlertaCaixas').textContent =
    `O pedido ${numeroPedido} foi finalizado com ${quantidadeCaixas} caixas. ` +
    `Por se tratar de um pedido de maior volume, priorize a atenção na retirada/coleta.`;
  document.getElementById('modalAlertaCaixas').hidden = false;
}

function fecharModalAlertaCaixas() {
  document.getElementById('modalAlertaCaixas').hidden = true;
}

/* =========================================================================
   9. FILTROS, BUSCA E EVENTOS DE INTERFACE
   ========================================================================= */

function configurarModais() {
  document.getElementById('btnFecharModalPedido').addEventListener('click', fecharModalPedido);
  document.getElementById('btnCancelarPedido').addEventListener('click', fecharModalPedido);
  document.getElementById('modalPedido').addEventListener('click', (evento) => {
    if (evento.target.id === 'modalPedido') fecharModalPedido();
  });

  document.getElementById('btnFecharModalGrupo').addEventListener('click', fecharModalGrupo);
  document.getElementById('modalGrupo').addEventListener('click', (evento) => {
    if (evento.target.id === 'modalGrupo') fecharModalGrupo();
  });

  document.getElementById('btnFecharModalAlertaCaixas').addEventListener('click', fecharModalAlertaCaixas);
  document.getElementById('btnOkAlertaCaixas').addEventListener('click', fecharModalAlertaCaixas);
  document.getElementById('modalAlertaCaixas').addEventListener('click', (evento) => {
    if (evento.target.id === 'modalAlertaCaixas') fecharModalAlertaCaixas();
  });

  document.getElementById('campoDataRecebimento').addEventListener('input', () =>
    atualizarPreviewVencimento('campoDataRecebimento', 'campoSlaDias', 'previewVencimento')
  );
  document.getElementById('campoSlaDias').addEventListener('input', () =>
    atualizarPreviewVencimento('campoDataRecebimento', 'campoSlaDias', 'previewVencimento')
  );

  // Prévia ao vivo do peso cubado na correção manual de Organização
  // (Editar Pedido), conforme altura/largura/comprimento são digitados.
  ['campoEditarAlturaCm', 'campoEditarLarguraCm', 'campoEditarComprimentoCm'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      const altura = document.getElementById('campoEditarAlturaCm').value;
      const largura = document.getElementById('campoEditarLarguraCm').value;
      const comprimento = document.getElementById('campoEditarComprimentoCm').value;
      const pesoCubado = calcularPesoCubado(altura, largura, comprimento);
      document.getElementById('previewPesoCubadoEditar').textContent = pesoCubado != null ? formatarPesoKg(pesoCubado) : '—';
    });
  });

  // Formulário do modal: usado exclusivamente para EDITAR um pedido existente.
  document.getElementById('formPedido').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const erro = document.getElementById('erroFormPedido');
    erro.hidden = true;

    const dados = {
      numeroPedido: document.getElementById('campoNumeroPedido').value,
      cliente: document.getElementById('campoCliente').value,
      dataPedido: document.getElementById('campoDataPedido').value,
      dataRecebimentoEstoque: document.getElementById('campoDataRecebimento').value,
      slaDias: document.getElementById('campoSlaDias').value,
      quantidadeItens: document.getElementById('campoQuantidadeItens').value,
      observacao: document.getElementById('campoObservacao').value
    };

    const invalido =
      !dados.numeroPedido.trim() ||
      !dados.cliente.trim() ||
      !dados.dataPedido ||
      !dados.dataRecebimentoEstoque ||
      !dados.slaDias ||
      Number(dados.slaDias) <= 0 ||
      !dados.quantidadeItens ||
      Number(dados.quantidadeItens) <= 0;

    if (invalido) {
      erro.textContent = 'Preencha todos os campos obrigatórios (marcados com *) com valores válidos.';
      erro.hidden = false;
      return;
    }

    const idExistente = document.getElementById('campoPedidoId').value || null;

    // Bloqueia número de pedido duplicado: não pode coincidir com o de OUTRO
    // pedido já cadastrado (o próprio pedido, sem alteração do número, é
    // permitido). Comparação sem diferenciar maiúsculas/espaços nas pontas,
    // igual à usada em buscarPedidoPorNumero().
    const pedidoComMesmoNumero = buscarPedidoPorNumero(dados.numeroPedido);
    if (pedidoComMesmoNumero && pedidoComMesmoNumero.id !== idExistente) {
      erro.textContent = `Já existe um pedido cadastrado com o número "${dados.numeroPedido.trim()}" (cliente: ${pedidoComMesmoNumero.cliente}). Verifique se não é duplicidade antes de salvar.`;
      erro.hidden = false;
      return;
    }

    // --- Correção manual dos registros de Separação e Organização ---
    // Lê nome + data/hora (interpretada em horário de Brasília) de cada uma
    // das 4 marcações (início/fim de cada etapa). Nome e data/hora de uma
    // mesma marcação devem ser preenchidos juntos (ou os dois vazios, para
    // remover aquele registro).
    function lerMarcacao(idCampoOperador, idCampoData, rotulo) {
      const nome = document.getElementById(idCampoOperador).value.trim();
      const valorData = document.getElementById(idCampoData).value;
      if (!nome && !valorData) return { nome: null, data: null };
      if (!nome || !valorData) {
        throw new Error(`Preencha o nome do operador e a data/hora de ${rotulo}, ou deixe os dois em branco.`);
      }
      return { nome, data: datetimeLocalBrasiliaParaData(valorData) };
    }

    let inicioSep, fimSep, inicioOrg, fimOrg;
    try {
      inicioSep = lerMarcacao('campoEditarOperadorInicioSeparacao', 'campoEditarDataHoraInicioSeparacao', 'início da separação');
      fimSep = lerMarcacao('campoEditarOperadorFimSeparacao', 'campoEditarDataHoraFimSeparacao', 'fim da separação');
      inicioOrg = lerMarcacao('campoEditarOperadorInicioOrganizacao', 'campoEditarDataHoraInicioOrganizacao', 'início da organização');
      fimOrg = lerMarcacao('campoEditarOperadorFimOrganizacao', 'campoEditarDataHoraFimOrganizacao', 'fim da organização');
    } catch (erroValidacao) {
      erro.textContent = erroValidacao.message;
      erro.hidden = false;
      return;
    }

    if (fimSep.data && inicioSep.data && fimSep.data < inicioSep.data) {
      erro.textContent = 'O fim da separação não pode ser antes do início da separação.';
      erro.hidden = false;
      return;
    }
    if (fimOrg.data && inicioOrg.data && fimOrg.data < inicioOrg.data) {
      erro.textContent = 'O fim da organização não pode ser antes do início da organização.';
      erro.hidden = false;
      return;
    }

    dados.registroSeparacao = {
      operadorInicioSeparacao: inicioSep.nome,
      dataHoraInicioSeparacao: inicioSep.data,
      operadorFimSeparacao: fimSep.nome,
      dataHoraFimSeparacao: fimSep.data,
      statusSeparacao: derivarStatusSeparacao(inicioSep.data, fimSep.data)
    };
    // Peso da carga (kg) e cubagem (altura/largura/comprimento, cm, da
    // maior caixa/volume): correção manual opcional, independente das
    // marcações acima. Deixar em branco remove o valor (volta a "não
    // informado"), igual ao padrão já usado para as demais correções. O
    // peso cubado só é recalculado quando as 3 dimensões estão preenchidas;
    // se faltar alguma, fica null (mesmo padrão do peso).
    const valorPesoCorrecao = document.getElementById('campoEditarPesoCargaKg').value;
    const valorQtdCaixasCorrecao = document.getElementById('campoEditarQuantidadeCaixas').value;
    const valorAlturaCorrecao = document.getElementById('campoEditarAlturaCm').value;
    const valorLarguraCorrecao = document.getElementById('campoEditarLarguraCm').value;
    const valorComprimentoCorrecao = document.getElementById('campoEditarComprimentoCm').value;
    dados.registroOrganizacao = {
      operadorInicioOrganizacao: inicioOrg.nome,
      dataHoraInicioOrganizacao: inicioOrg.data,
      operadorFimOrganizacao: fimOrg.nome,
      dataHoraFimOrganizacao: fimOrg.data,
      statusOrganizacao: derivarStatusOrganizacao(inicioOrg.data, fimOrg.data),
      pesoCargaKg: valorPesoCorrecao === '' ? null : Number(valorPesoCorrecao),
      quantidadeCaixas: valorQtdCaixasCorrecao === '' ? null : Number(valorQtdCaixasCorrecao),
      alturaCm: valorAlturaCorrecao === '' ? null : Number(valorAlturaCorrecao),
      larguraCm: valorLarguraCorrecao === '' ? null : Number(valorLarguraCorrecao),
      comprimentoCm: valorComprimentoCorrecao === '' ? null : Number(valorComprimentoCorrecao),
      pesoCubadoKg: calcularPesoCubado(valorAlturaCorrecao, valorLarguraCorrecao, valorComprimentoCorrecao)
    };

    // Reflete a correção na finalização automática do pedido: se as duas
    // etapas ficaram completas, finaliza (ou reajusta o resultado do SLA,
    // usando a data efetiva da correção); se deixaram de estar completas
    // (ex.: apagaram um horário por engano), reabre o pedido. Mantém tudo
    // consistente com a mesma regra usada em finalizarOrganizacaoPedido().
    if (idExistente) {
      const pedidoAtual = estado.pedidos.find((p) => p.id === idExistente);
      const ambasEtapasCompletas =
        dados.registroSeparacao.statusSeparacao === 'separado' &&
        dados.registroOrganizacao.statusOrganizacao === 'organizado';

      if (pedidoAtual && ambasEtapasCompletas && pedidoAtual.status !== 'finalizado') {
        const dataFinalizacao = new Date(Math.max(fimSep.data.getTime(), fimOrg.data.getTime()));
        const { resultadoSLA, diasDiferencaFinalizacao } = calcularResultadoFinalizacao(
          { dataVencimento: pedidoAtual.dataVencimento },
          formatarISO(dataFinalizacao)
        );
        dados.finalizacao = { status: 'finalizado', finalizadoEm: dataFinalizacao, resultadoSLA, diasDiferencaFinalizacao };
      } else if (pedidoAtual && !ambasEtapasCompletas && pedidoAtual.status === 'finalizado') {
        dados.finalizacao = { status: 'aberto', finalizadoEm: null, resultadoSLA: null, diasDiferencaFinalizacao: null };
      }
    }

    try {
      await salvarPedido(dados, idExistente);
      fecharModalPedido();
    } catch (erroSalvar) {
      erro.textContent = 'Erro ao salvar pedido: ' + erroSalvar.message;
      erro.hidden = false;
    }
  });
}

/**
 * Alterna entre as três telas do app: "Painel Operacional" (tela inicial:
 * Painel Consolidado por Prazo, busca e Adicionar Pedido), "Painel
 * Consolidado" (indicadores, tabela de pedidos e histórico/gráfico,
 * acessada pelo botão 📊) e "Painel de Tempos" (métricas de separação e
 * organização, acessada pelo botão ⏳). Apenas uma fica visível por vez;
 * clicar de novo no botão da tela ativa (ou em "Voltar") volta para o
 * Painel Operacional.
 */
function configurarNavegacaoTelas() {
  const telaOperacional = document.getElementById('telaOperacional');
  const botaoOperacional = document.getElementById('btnPainelOperacional');

  const telas = {
    consolidado: document.getElementById('telaPainelConsolidado'),
    tempos: document.getElementById('telaPainelTempos'),
    colaboradores: document.getElementById('telaColaboradores')
  };
  const botoesAbrir = {
    consolidado: document.getElementById('btnPainelConsolidado'),
    tempos: document.getElementById('btnPainelTempos'),
    colaboradores: document.getElementById('btnColaboradores')
  };
  const titulosBotao = {
    consolidado: 'Painel Consolidado (indicadores, pedidos e histórico)',
    tempos: 'Painel de Tempos (separação e organização)',
    colaboradores: 'Colaboradores (separadores e organizadores cadastrados)'
  };

  function mostrarOperacional() {
    Object.values(telas).forEach((tela) => { if (tela) tela.hidden = true; });
    telaOperacional.hidden = false;
    Object.entries(botoesAbrir).forEach(([chave, botao]) => {
      if (!botao) return;
      botao.setAttribute('aria-pressed', 'false');
      botao.title = titulosBotao[chave];
    });
    if (botaoOperacional) botaoOperacional.setAttribute('aria-pressed', 'true');
  }

  function mostrarTela(chave) {
    telaOperacional.hidden = true;
    Object.entries(telas).forEach(([k, tela]) => { if (tela) tela.hidden = k !== chave; });
    Object.entries(botoesAbrir).forEach(([k, botao]) => {
      if (!botao) return;
      botao.setAttribute('aria-pressed', String(k === chave));
      botao.title = k === chave ? 'Voltar ao Painel Operacional' : titulosBotao[k];
    });
    if (botaoOperacional) botaoOperacional.setAttribute('aria-pressed', 'false');
  }

  if (botaoOperacional) botaoOperacional.addEventListener('click', mostrarOperacional);

  if (botoesAbrir.consolidado) {
    botoesAbrir.consolidado.addEventListener('click', () => {
      if (!telas.consolidado.hidden) mostrarOperacional();
      else mostrarTela('consolidado');
    });
  }

  if (botoesAbrir.tempos) {
    botoesAbrir.tempos.addEventListener('click', () => {
      if (!telas.tempos.hidden) mostrarOperacional();
      else mostrarTela('tempos');
    });
  }

  if (botoesAbrir.colaboradores) {
    botoesAbrir.colaboradores.addEventListener('click', () => {
      if (!telas.colaboradores.hidden) mostrarOperacional();
      else mostrarTela('colaboradores');
    });
  }

  const botaoVoltarConsolidado = document.getElementById('btnVoltarOperacional');
  if (botaoVoltarConsolidado) botaoVoltarConsolidado.addEventListener('click', mostrarOperacional);

  const botaoVoltarTempos = document.getElementById('btnVoltarOperacionalTempos');
  if (botaoVoltarTempos) botaoVoltarTempos.addEventListener('click', mostrarOperacional);

  const botaoVoltarColaboradores = document.getElementById('btnVoltarOperacionalColaboradores');
  if (botaoVoltarColaboradores) botaoVoltarColaboradores.addEventListener('click', mostrarOperacional);
}

/**
 * Modal "Registro de Separação e Organização", com duas seções
 * independentes:
 *   1. Separação - o operador informa o número do pedido e o próprio nome,
 *      e escolhe iniciar ou finalizar a separação física do pedido.
 *   2. Organização - feito por outra pessoa (a organizadora), nos mesmos
 *      moldes, mas só pode ser iniciada depois que a separação do mesmo
 *      pedido estiver finalizada. Ao finalizar a organização, se a
 *      separação já estiver concluída, o pedido é finalizado
 *      automaticamente (ver finalizarOrganizacaoPedido).
 * A data/hora de cada registro é gravada pelo servidor (serverTimestamp) e
 * exibida sempre no horário de Brasília, independentemente do relógio do
 * operador. Esses status são totalmente independentes da Situação (SLA).
 */
function configurarModalSeparacao() {
  const modal = document.getElementById('modalSeparacao');

  const campoNumeroSep = document.getElementById('campoSeparacaoNumeroPedido');
  const campoOperadorSep = document.getElementById('campoSeparacaoOperador');
  const erroSep = document.getElementById('erroFormSeparacao');
  const sucessoSep = document.getElementById('sucessoFormSeparacao');

  const campoNumeroOrg = document.getElementById('campoOrganizacaoNumeroPedido');
  const campoOperadorOrg = document.getElementById('campoOrganizacaoOperador');
  const erroOrg = document.getElementById('erroFormOrganizacao');
  const sucessoOrg = document.getElementById('sucessoFormOrganizacao');

  function abrirModal() {
    document.getElementById('formRegistroSeparacao').reset();
    document.getElementById('formRegistroOrganizacao').reset();
    popularSelectOperador('campoSeparacaoOperador', 'Selecione seu nome...', '');
    popularSelectOperador('campoOrganizacaoOperador', 'Selecione seu nome...', '');
    erroSep.hidden = true;
    sucessoSep.hidden = true;
    erroOrg.hidden = true;
    sucessoOrg.hidden = true;
    modal.hidden = false;
    campoNumeroSep.focus();
  }

  function fecharModal() {
    modal.hidden = true;
  }

  document.getElementById('btnRegistroSeparacao').addEventListener('click', abrirModal);
  document.getElementById('btnFecharModalSeparacao').addEventListener('click', fecharModal);
  modal.addEventListener('click', (evento) => {
    if (evento.target.id === 'modalSeparacao') fecharModal();
  });

  // Lê e valida os campos de uma das duas seções (separação ou
  // organização); retorna o pedido encontrado e o nome do operador, ou
  // null (já exibindo a mensagem de erro no elemento indicado) se algo
  // estiver inválido. Reaproveitada pelas duas seções.
  function lerELocalizarPedido(campoNumero, campoOperador, elementoErro, elementoSucesso) {
    elementoErro.hidden = true;
    elementoSucesso.hidden = true;

    const numero = campoNumero.value.trim();
    const nome = campoOperador.value.trim();

    if (!numero || !nome) {
      elementoErro.textContent = 'Informe o número do pedido e o nome do operador.';
      elementoErro.hidden = false;
      return null;
    }

    const pedido = buscarPedidoPorNumero(numero);
    if (!pedido) {
      elementoErro.textContent = `Nenhum pedido encontrado com o número "${numero}".`;
      elementoErro.hidden = false;
      return null;
    }

    return { pedido, nome };
  }

  /* --- Seção 1: Separação --- */

  document.getElementById('btnIniciarSeparacao').addEventListener('click', async () => {
    const dados = lerELocalizarPedido(campoNumeroSep, campoOperadorSep, erroSep, sucessoSep);
    if (!dados) return;
    const { pedido, nome } = dados;

    if (pedido.statusSeparacao === 'em-separacao') {
      erroSep.textContent = `O pedido ${pedido.numeroPedido} já está em separação, iniciada por ${pedido.operadorInicioSeparacao}.`;
      erroSep.hidden = false;
      return;
    }
    if (pedido.statusSeparacao === 'separado') {
      erroSep.textContent = `O pedido ${pedido.numeroPedido} já foi separado por ${pedido.operadorFimSeparacao}.`;
      erroSep.hidden = false;
      return;
    }

    try {
      await iniciarSeparacaoPedido(pedido, nome);
      sucessoSep.textContent = `Separação do pedido ${pedido.numeroPedido} iniciada por ${nome}.`;
      sucessoSep.hidden = false;
      campoNumeroSep.value = '';
      campoNumeroSep.focus();
    } catch (erroSalvar) {
      erroSep.textContent = 'Erro ao registrar início da separação: ' + erroSalvar.message;
      erroSep.hidden = false;
    }
  });

  document.getElementById('btnFinalizarSeparacao').addEventListener('click', async () => {
    const dados = lerELocalizarPedido(campoNumeroSep, campoOperadorSep, erroSep, sucessoSep);
    if (!dados) return;
    const { pedido, nome } = dados;

    if (pedido.statusSeparacao === 'a-separar' || !pedido.statusSeparacao) {
      erroSep.textContent = `O pedido ${pedido.numeroPedido} ainda não teve a separação iniciada.`;
      erroSep.hidden = false;
      return;
    }
    if (pedido.statusSeparacao === 'separado') {
      erroSep.textContent = `O pedido ${pedido.numeroPedido} já foi separado por ${pedido.operadorFimSeparacao}.`;
      erroSep.hidden = false;
      return;
    }

    try {
      await finalizarSeparacaoPedido(pedido, nome);
      sucessoSep.textContent = `Separação do pedido ${pedido.numeroPedido} finalizada por ${nome}.`;
      sucessoSep.hidden = false;
      campoNumeroSep.value = '';
      campoNumeroSep.focus();
    } catch (erroSalvar) {
      erroSep.textContent = 'Erro ao registrar finalização da separação: ' + erroSalvar.message;
      erroSep.hidden = false;
    }
  });

  /* --- Seção 2: Organização --- */

  document.getElementById('btnIniciarOrganizacao').addEventListener('click', async () => {
    const dados = lerELocalizarPedido(campoNumeroOrg, campoOperadorOrg, erroOrg, sucessoOrg);
    if (!dados) return;
    const { pedido, nome } = dados;

    if (pedido.statusSeparacao !== 'separado') {
      erroOrg.textContent = `O pedido ${pedido.numeroPedido} ainda não teve a separação finalizada. Finalize a separação antes de iniciar a organização.`;
      erroOrg.hidden = false;
      return;
    }
    if (pedido.statusOrganizacao === 'em-organizacao') {
      erroOrg.textContent = `O pedido ${pedido.numeroPedido} já está em organização, iniciada por ${pedido.operadorInicioOrganizacao}.`;
      erroOrg.hidden = false;
      return;
    }
    if (pedido.statusOrganizacao === 'organizado') {
      erroOrg.textContent = `O pedido ${pedido.numeroPedido} já foi organizado por ${pedido.operadorFimOrganizacao}.`;
      erroOrg.hidden = false;
      return;
    }

    try {
      await iniciarOrganizacaoPedido(pedido, nome);
      sucessoOrg.textContent = `Organização do pedido ${pedido.numeroPedido} iniciada por ${nome}.`;
      sucessoOrg.hidden = false;
      campoNumeroOrg.value = '';
      campoNumeroOrg.focus();
    } catch (erroSalvar) {
      erroOrg.textContent = 'Erro ao registrar início da organização: ' + erroSalvar.message;
      erroOrg.hidden = false;
    }
  });

  document.getElementById('btnFinalizarOrganizacao').addEventListener('click', async () => {
    const dados = lerELocalizarPedido(campoNumeroOrg, campoOperadorOrg, erroOrg, sucessoOrg);
    if (!dados) return;
    const { pedido, nome } = dados;

    if (pedido.statusOrganizacao === 'a-organizar' || !pedido.statusOrganizacao) {
      erroOrg.textContent = `O pedido ${pedido.numeroPedido} ainda não teve a organização iniciada.`;
      erroOrg.hidden = false;
      return;
    }
    if (pedido.statusOrganizacao === 'organizado') {
      erroOrg.textContent = `O pedido ${pedido.numeroPedido} já foi organizado por ${pedido.operadorFimOrganizacao}.`;
      erroOrg.hidden = false;
      return;
    }

    // Peso aferido da carga (kg), Quantidade de Caixas (fechada) e cubagem
    // (altura/largura/comprimento, cm, da maior caixa/volume): obrigatórios
    // só para finalizar (não para iniciar a organização) - ver itens 30, 31
    // e 32 do README.
    const campoPesoOrg = document.getElementById('campoOrganizacaoPesoKg');
    const campoQtdCaixasOrg = document.getElementById('campoOrganizacaoQuantidadeCaixas');
    const campoAlturaOrg = document.getElementById('campoOrganizacaoAlturaCm');
    const campoLarguraOrg = document.getElementById('campoOrganizacaoLarguraCm');
    const campoComprimentoOrg = document.getElementById('campoOrganizacaoComprimentoCm');
    const pesoOrg = campoPesoOrg.value;
    if (!pesoOrg || Number(pesoOrg) <= 0) {
      erroOrg.textContent = 'Informe o peso aferido da carga (kg) na balança antes de finalizar a organização.';
      erroOrg.hidden = false;
      return;
    }
    if (!campoQtdCaixasOrg.value || Number(campoQtdCaixasOrg.value) <= 0) {
      erroOrg.textContent = 'Informe a quantidade de caixas (já fechadas) antes de finalizar a organização.';
      erroOrg.hidden = false;
      return;
    }
    if (!campoAlturaOrg.value || !campoLarguraOrg.value || !campoComprimentoOrg.value
      || Number(campoAlturaOrg.value) <= 0 || Number(campoLarguraOrg.value) <= 0 || Number(campoComprimentoOrg.value) <= 0) {
      erroOrg.textContent = 'Informe a altura, largura e comprimento (cm) da maior caixa/volume antes de finalizar a organização.';
      erroOrg.hidden = false;
      return;
    }

    try {
      await finalizarOrganizacaoPedido(pedido, nome, pesoOrg, campoQtdCaixasOrg.value, campoAlturaOrg.value, campoLarguraOrg.value, campoComprimentoOrg.value);
      sucessoOrg.textContent = pedido.statusSeparacao === 'separado'
        ? `Organização do pedido ${pedido.numeroPedido} finalizada por ${nome}. Pedido concluído automaticamente.`
        : `Organização do pedido ${pedido.numeroPedido} finalizada por ${nome}.`;
      sucessoOrg.hidden = false;
      // Alerta de pedido de grande volume (>15 caixas fechadas - item 33 do
      // README). Precisa ler campoQtdCaixasOrg.value ANTES de limpá-lo nas
      // linhas abaixo.
      exibirAlertaCaixasSeNecessario(pedido.numeroPedido, campoQtdCaixasOrg.value);
      campoNumeroOrg.value = '';
      campoPesoOrg.value = '';
      campoQtdCaixasOrg.value = '';
      campoAlturaOrg.value = '';
      campoLarguraOrg.value = '';
      campoComprimentoOrg.value = '';
      document.getElementById('previewPesoCubadoOrganizacao').textContent = '—';
      campoNumeroOrg.focus();
    } catch (erroSalvar) {
      erroOrg.textContent = 'Erro ao registrar finalização da organização: ' + erroSalvar.message;
      erroOrg.hidden = false;
    }
  });

  // Prévia ao vivo do peso cubado conforme altura/largura/comprimento são
  // digitados (puramente informativo; a validação de obrigatoriedade
  // acontece só ao clicar em "Finalizar Organização", acima).
  const previewCubadoOrg = document.getElementById('previewPesoCubadoOrganizacao');
  ['campoOrganizacaoAlturaCm', 'campoOrganizacaoLarguraCm', 'campoOrganizacaoComprimentoCm'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      const altura = document.getElementById('campoOrganizacaoAlturaCm').value;
      const largura = document.getElementById('campoOrganizacaoLarguraCm').value;
      const comprimento = document.getElementById('campoOrganizacaoComprimentoCm').value;
      const pesoCubado = calcularPesoCubado(altura, largura, comprimento);
      previewCubadoOrg.textContent = pesoCubado != null ? formatarPesoKg(pesoCubado) : '—';
    });
  });
}

/**
 * Modal de atalho "Atribuir/Finalizar Separação ou Organização", aberto pela
 * coluna "Atribuição" da tabela/cartão de pedidos (ver criarBotaoAtribuicao).
 * Faz exatamente o mesmo que o modal "Registro de Separação e Organização"
 * (⏱️, configurarModalSeparacao acima, que continua existindo sem nenhuma
 * alteração) - iniciarSeparacaoPedido/finalizarSeparacaoPedido/
 * iniciarOrganizacaoPedido/finalizarOrganizacaoPedido, com a mesma marcação
 * automática de data/hora do servidor - só que já com o pedido identificado
 * e o nome escolhido em uma lista suspensa (com opção de cadastrar um novo
 * colaborador sem sair daqui), em vez de digitar o número do pedido.
 */
const VALOR_CADASTRAR_NOVO_COLABORADOR = '__cadastrar_novo__';

// Guarda apenas o NÚMERO do pedido (não o objeto), para sempre reler o dado
// mais atual de estado.pedidos no momento da confirmação - o pedido pode ter
// sido alterado (por outra pessoa, em outra aba) entre a abertura do modal
// e o clique em "Atribuir"/"Finalizar e dar baixa".
let numeroPedidoAtribuicaoAtual = null;
let faseAtribuicaoAtual = null;
let acaoAtribuicaoAtual = null;

// Popula o select do modal de Atribuição com os colaboradores ativos (mesma
// base de popularSelectOperador) e acrescenta, ao final, a opção
// "+ Cadastrar novo colaborador" - exclusiva deste modal.
function popularSelectAtribuicaoColaborador(valorParaSelecionar) {
  popularSelectOperador('campoAtribuicaoColaborador', 'Selecione...', valorParaSelecionar);
  const select = document.getElementById('campoAtribuicaoColaborador');
  const optCadastrar = document.createElement('option');
  optCadastrar.value = VALOR_CADASTRAR_NOVO_COLABORADOR;
  optCadastrar.textContent = '+ Cadastrar novo colaborador';
  select.appendChild(optCadastrar);
  select.value = valorParaSelecionar || '';
}

function configurarModalAtribuicaoFase() {
  const modal = document.getElementById('modalAtribuicaoFase');
  const titulo = document.getElementById('modalAtribuicaoFaseTitulo');
  const campoNumero = document.getElementById('campoAtribuicaoNumeroPedido');
  const badgeFase = document.getElementById('badgeAtribuicaoFase');
  const rotuloColaborador = document.getElementById('rotuloAtribuicaoColaborador');
  const selectColaborador = document.getElementById('campoAtribuicaoColaborador');
  const pesoWrapper = document.getElementById('campoAtribuicaoPesoWrapper');
  const campoPeso = document.getElementById('campoAtribuicaoPesoKg');
  const qtdCaixasWrapper = document.getElementById('campoAtribuicaoQuantidadeCaixasWrapper');
  const campoQtdCaixas = document.getElementById('campoAtribuicaoQuantidadeCaixas');
  const alturaWrapper = document.getElementById('campoAtribuicaoAlturaWrapper');
  const campoAltura = document.getElementById('campoAtribuicaoAlturaCm');
  const larguraWrapper = document.getElementById('campoAtribuicaoLarguraWrapper');
  const campoLargura = document.getElementById('campoAtribuicaoLarguraCm');
  const comprimentoWrapper = document.getElementById('campoAtribuicaoComprimentoWrapper');
  const campoComprimento = document.getElementById('campoAtribuicaoComprimentoCm');
  const previewCubado = document.getElementById('previewPesoCubadoAtribuicao');
  const nota = document.getElementById('notaAtribuicaoFase');
  const erro = document.getElementById('erroModalAtribuicaoFase');
  const btnConfirmar = document.getElementById('btnConfirmarAtribuicaoFase');

  function fecharModal() {
    modal.hidden = true;
    numeroPedidoAtribuicaoAtual = null;
  }

  document.getElementById('btnFecharModalAtribuicaoFase').addEventListener('click', fecharModal);
  document.getElementById('btnCancelarAtribuicaoFase').addEventListener('click', fecharModal);
  modal.addEventListener('click', (evento) => {
    if (evento.target.id === 'modalAtribuicaoFase') fecharModal();
  });

  // Escolher "+ Cadastrar novo colaborador" pede o nome (mesmo padrão de
  // "Editar" na tela Colaboradores, via prompt()), cadastra e já seleciona
  // o nome recém-criado - sem precisar abrir a tela Colaboradores.
  selectColaborador.addEventListener('change', () => {
    if (selectColaborador.value !== VALOR_CADASTRAR_NOVO_COLABORADOR) return;

    const nomeNovo = prompt('Nome do novo colaborador:');
    const nomeTratado = (nomeNovo || '').trim();
    if (!nomeTratado) {
      popularSelectAtribuicaoColaborador('');
      return;
    }

    const existente = buscarColaboradorPorNome(nomeTratado);
    if (existente) {
      if (!existente.ativo) {
        alert(`"${existente.nome}" já está cadastrado, mas está inativo. Reative-o na tela Colaboradores antes de usá-lo aqui.`);
        popularSelectAtribuicaoColaborador('');
        return;
      }
      popularSelectAtribuicaoColaborador(existente.nome);
      return;
    }

    adicionarColaborador(nomeTratado)
      .then(() => popularSelectAtribuicaoColaborador(nomeTratado))
      .catch((erroSalvar) => {
        alert('Erro ao cadastrar colaborador: ' + erroSalvar.message);
        popularSelectAtribuicaoColaborador('');
      });
  });

  // Chamada por criarBotaoAtribuicao. `fase` é 'separacao' ou 'organizacao';
  // `acao` é 'atribuir' ou 'finalizar'.
  window.abrirModalAtribuicaoFase = function abrirModalAtribuicaoFase(pedido, fase, acao) {
    numeroPedidoAtribuicaoAtual = pedido.numeroPedido;
    faseAtribuicaoAtual = fase;
    acaoAtribuicaoAtual = acao;
    erro.hidden = true;

    campoNumero.value = pedido.numeroPedido;

    const ehSeparacao = fase === 'separacao';
    badgeFase.textContent = ehSeparacao ? '📦 Fase 1 de 2 — Separação' : '🔨 Fase 2 de 2 — Organização (na mesa)';
    badgeFase.className = 'badge-fase ' + (ehSeparacao ? 'badge-fase-separacao' : 'badge-fase-organizacao');

    // Peso aferido da carga, Quantidade de Caixas (fechada) e cubagem
    // (altura/largura/comprimento): só aparecem ao finalizar a Organização
    // (mesmos campos e mesma obrigatoriedade do modal ⏱️ - ver itens 30, 31
    // e 32 do README).
    const pedeOPeso = fase === 'organizacao' && acao === 'finalizar';
    pesoWrapper.hidden = !pedeOPeso;
    campoPeso.value = '';
    qtdCaixasWrapper.hidden = !pedeOPeso;
    campoQtdCaixas.value = '';
    alturaWrapper.hidden = !pedeOPeso;
    larguraWrapper.hidden = !pedeOPeso;
    comprimentoWrapper.hidden = !pedeOPeso;
    campoAltura.value = '';
    campoLargura.value = '';
    campoComprimento.value = '';
    previewCubado.hidden = !pedeOPeso;
    previewCubado.querySelector('strong').textContent = '—';

    if (acao === 'atribuir') {
      titulo.textContent = ehSeparacao ? 'Atribuir Separação' : 'Atribuir Organização';
      rotuloColaborador.textContent = ehSeparacao ? 'Colaborador da Separação' : 'Colaborador da Organização';
      selectColaborador.disabled = false;
      popularSelectAtribuicaoColaborador('');
      nota.textContent = '💡 O início desta fase é registrado automaticamente, com a data e a hora do sistema.';
      btnConfirmar.textContent = 'Atribuir';
    } else {
      titulo.textContent = ehSeparacao ? 'Finalizar Separação' : 'Finalizar Organização';
      rotuloColaborador.textContent = 'Colaborador Responsável';
      const nomeResponsavel = ehSeparacao ? pedido.operadorInicioSeparacao : pedido.operadorInicioOrganizacao;
      popularSelectAtribuicaoColaborador(nomeResponsavel || '');
      selectColaborador.disabled = true;
      nota.textContent = '💡 O fim desta fase é registrado automaticamente, com a data e a hora do sistema — o tempo é calculado a partir do início já registrado.';
      btnConfirmar.textContent = 'Finalizar e dar baixa';
    }

    modal.hidden = false;
  };

  // Prévia ao vivo do peso cubado conforme altura/largura/comprimento são
  // digitados (mesmo padrão do modal ⏱️, puramente informativo).
  [campoAltura, campoLargura, campoComprimento].forEach((campo) => {
    campo.addEventListener('input', () => {
      const pesoCubado = calcularPesoCubado(campoAltura.value, campoLargura.value, campoComprimento.value);
      previewCubado.querySelector('strong').textContent = pesoCubado != null ? formatarPesoKg(pesoCubado) : '—';
    });
  });

  btnConfirmar.addEventListener('click', async () => {
    if (!numeroPedidoAtribuicaoAtual) return;
    erro.hidden = true;

    // Relê o pedido a partir do estado atual (não do objeto capturado ao
    // abrir o modal), para nunca agir sobre um dado desatualizado.
    const pedidoAtual = buscarPedidoPorNumero(numeroPedidoAtribuicaoAtual);
    if (!pedidoAtual) {
      erro.textContent = 'Este pedido não foi encontrado (pode ter sido excluído). Feche esta janela e atualize a lista.';
      erro.hidden = false;
      return;
    }
    const estadoAtual = obterEstadoAtribuicao(pedidoAtual);
    if (!estadoAtual || estadoAtual.fase !== faseAtribuicaoAtual || estadoAtual.acao !== acaoAtribuicaoAtual) {
      erro.textContent = 'O status deste pedido já foi alterado (por outra pessoa ou em outra aba). Feche esta janela e tente novamente pela lista atualizada.';
      erro.hidden = false;
      return;
    }

    const nome = selectColaborador.value;
    if (acaoAtribuicaoAtual === 'atribuir' && (!nome || nome === VALOR_CADASTRAR_NOVO_COLABORADOR)) {
      erro.textContent = 'Selecione o nome do colaborador.';
      erro.hidden = false;
      return;
    }

    const finalizandoOrganizacao = faseAtribuicaoAtual === 'organizacao' && acaoAtribuicaoAtual === 'finalizar';
    if (finalizandoOrganizacao && (!campoPeso.value || Number(campoPeso.value) <= 0)) {
      erro.textContent = 'Informe o peso aferido da carga (kg) na balança antes de finalizar a organização.';
      erro.hidden = false;
      return;
    }
    if (finalizandoOrganizacao && (!campoQtdCaixas.value || Number(campoQtdCaixas.value) <= 0)) {
      erro.textContent = 'Informe a quantidade de caixas (já fechadas) antes de finalizar a organização.';
      erro.hidden = false;
      return;
    }
    if (finalizandoOrganizacao && (!campoAltura.value || !campoLargura.value || !campoComprimento.value
      || Number(campoAltura.value) <= 0 || Number(campoLargura.value) <= 0 || Number(campoComprimento.value) <= 0)) {
      erro.textContent = 'Informe a altura, largura e comprimento (cm) da maior caixa/volume antes de finalizar a organização.';
      erro.hidden = false;
      return;
    }

    try {
      if (faseAtribuicaoAtual === 'separacao' && acaoAtribuicaoAtual === 'atribuir') {
        await iniciarSeparacaoPedido(pedidoAtual, nome);
        exibirAvisoAtribuicao('Separação atribuída.');
      } else if (faseAtribuicaoAtual === 'separacao' && acaoAtribuicaoAtual === 'finalizar') {
        await finalizarSeparacaoPedido(pedidoAtual, nome);
        exibirAvisoAtribuicao('Separação finalizada.');
      } else if (faseAtribuicaoAtual === 'organizacao' && acaoAtribuicaoAtual === 'atribuir') {
        await iniciarOrganizacaoPedido(pedidoAtual, nome);
        exibirAvisoAtribuicao('Organização atribuída.');
      } else if (finalizandoOrganizacao) {
        await finalizarOrganizacaoPedido(pedidoAtual, nome, campoPeso.value, campoQtdCaixas.value, campoAltura.value, campoLargura.value, campoComprimento.value);
        exibirAvisoAtribuicao('Pedido finalizado e baixado.');
        // Alerta de pedido de grande volume (>15 caixas fechadas - item 33
        // do README), lido antes de fecharModal() limpar os campos.
        exibirAlertaCaixasSeNecessario(pedidoAtual.numeroPedido, campoQtdCaixas.value);
      }
      fecharModal();
    } catch (erroSalvar) {
      erro.textContent = 'Erro ao salvar: ' + erroSalvar.message;
      erro.hidden = false;
    }
  });

  document.getElementById('btnFecharAvisoAtribuicao').addEventListener('click', () => {
    clearTimeout(timeoutAvisoAtribuicao);
    document.getElementById('avisoAtribuicao').hidden = true;
  });
}

/**
 * Formulário "Adicionar Colaborador" (tela Colaboradores) e botão "Importar
 * nomes dos pedidos". Mesmo padrão do formulário inline de pedidos: sempre
 * visível, sem modal, limpa e devolve o foco ao campo após adicionar.
 */
function configurarFormularioColaboradores() {
  const form = document.getElementById('formNovoColaborador');
  if (!form) return; // tela pode não estar presente (defensivo)

  const erro = document.getElementById('erroFormColaborador');

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    erro.hidden = true;

    const campoNome = document.getElementById('campoNovoColaboradorNome');
    const nome = campoNome.value.trim();

    if (!nome) {
      erro.textContent = 'Informe o nome do colaborador.';
      erro.hidden = false;
      return;
    }

    const existente = buscarColaboradorPorNome(nome);
    if (existente) {
      erro.textContent = existente.ativo
        ? `Já existe um colaborador cadastrado com o nome "${existente.nome}".`
        : `Já existe um colaborador com o nome "${existente.nome}", mas está inativo. Reative-o na lista abaixo em vez de cadastrar novamente.`;
      erro.hidden = false;
      return;
    }

    try {
      await adicionarColaborador(nome);
      campoNome.value = '';
      campoNome.focus();
    } catch (erroSalvar) {
      erro.textContent = 'Erro ao adicionar colaborador: ' + erroSalvar.message;
      erro.hidden = false;
    }
  });

  const botaoImportar = document.getElementById('btnImportarColaboradores');
  const mensagemImportar = document.getElementById('mensagemImportarColaboradores');
  if (botaoImportar) {
    botaoImportar.addEventListener('click', async () => {
      botaoImportar.disabled = true;
      mensagemImportar.hidden = true;
      try {
        const resultado = await importarColaboradoresDosPedidos();
        mensagemImportar.textContent =
          resultado.importados > 0
            ? `${resultado.importados} nome(s) importado(s) com sucesso.` +
              (resultado.jaExistiam > 0 ? ` ${resultado.jaExistiam} já estavam cadastrados.` : '')
            : 'Nenhum nome novo encontrado - todos os nomes usados nos pedidos já estão cadastrados.';
        mensagemImportar.hidden = false;
      } catch (erroImportar) {
        mensagemImportar.textContent = 'Erro ao importar: ' + erroImportar.message;
        mensagemImportar.hidden = false;
      } finally {
        botaoImportar.disabled = false;
      }
    });
  }
}

/**
 * Formulário inline de criação de pedidos ("Adicionar Novo Pedido"), sempre
 * visível na página - sem modal. Após adicionar com sucesso, o formulário é
 * limpo e o foco volta ao primeiro campo, para permitir lançamentos
 * consecutivos rápidos.
 */
function configurarFormularioInlineNovoPedido() {
  document.getElementById('inlineDataPedido').value = hojeISO();

  document.getElementById('inlineDataRecebimento').addEventListener('input', () =>
    atualizarPreviewVencimento('inlineDataRecebimento', 'inlineSlaDias', 'previewVencimentoInline')
  );
  document.getElementById('inlineSlaDias').addEventListener('input', () =>
    atualizarPreviewVencimento('inlineDataRecebimento', 'inlineSlaDias', 'previewVencimentoInline')
  );

  document.getElementById('formNovoPedidoInline').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const erro = document.getElementById('erroFormInline');
    erro.hidden = true;

    const dados = {
      numeroPedido: document.getElementById('inlineNumeroPedido').value,
      cliente: document.getElementById('inlineCliente').value,
      dataPedido: document.getElementById('inlineDataPedido').value,
      dataRecebimentoEstoque: document.getElementById('inlineDataRecebimento').value,
      slaDias: document.getElementById('inlineSlaDias').value,
      quantidadeItens: document.getElementById('inlineQuantidadeItens').value,
      observacao: document.getElementById('inlineObservacao').value
    };

    const invalido =
      !dados.numeroPedido.trim() ||
      !dados.cliente.trim() ||
      !dados.dataPedido ||
      !dados.dataRecebimentoEstoque ||
      !dados.slaDias ||
      Number(dados.slaDias) <= 0 ||
      !dados.quantidadeItens ||
      Number(dados.quantidadeItens) <= 0;

    if (invalido) {
      erro.textContent = 'Preencha Nº Pedido, Cliente, Data do Pedido, Rec. Estoque, SLA e Quant. Itens com valores válidos.';
      erro.hidden = false;
      return;
    }

    // Bloqueia o lançamento se já existir um pedido com o mesmo número
    // (comparação sem diferenciar maiúsculas/espaços nas pontas).
    const pedidoComMesmoNumero = buscarPedidoPorNumero(dados.numeroPedido);
    if (pedidoComMesmoNumero) {
      erro.textContent = `Já existe um pedido cadastrado com o número "${dados.numeroPedido.trim()}" (cliente: ${pedidoComMesmoNumero.cliente}). Verifique se não é duplicidade antes de lançar.`;
      erro.hidden = false;
      return;
    }

    try {
      await salvarPedido(dados, null);
      // Limpa os campos para o próximo lançamento, mantendo a Data do
      // Pedido preenchida com hoje (o caso mais comum).
      document.getElementById('inlineNumeroPedido').value = '';
      document.getElementById('inlineCliente').value = '';
      document.getElementById('inlineDataPedido').value = hojeISO();
      document.getElementById('inlineDataRecebimento').value = '';
      document.getElementById('inlineSlaDias').value = '';
      document.getElementById('inlineQuantidadeItens').value = '';
      document.getElementById('inlineObservacao').value = '';
      atualizarPreviewVencimento('inlineDataRecebimento', 'inlineSlaDias', 'previewVencimentoInline');
      document.getElementById('inlineNumeroPedido').focus();
    } catch (erroSalvar) {
      erro.textContent = 'Erro ao adicionar pedido: ' + erroSalvar.message;
      erro.hidden = false;
    }
  });
}

/**
 * Busca e filtros ficam apenas no Painel Consolidado (campos com sufixo
 * "2" por razões históricas — chegaram a existir também no Painel
 * Operacional, hoje removidos de lá por decisão do usuário), entre os
 * indicadores e a lista de pedidos. A estrutura em "conjuntos" foi mantida
 * Monta o painel "Importar Pedidos em Lote (Planilha)" do Painel
 * Operacional (item 33 do README): leitura do arquivo .xls/.xlsx
 * escolhido, prévia editável (Data do Pedido, Rec. Estoque e SLA ficam
 * editáveis - os demais campos vêm fixos da planilha), bloqueio de envio
 * quando há pedido inválido ou duplicado, e gravação em lote ao confirmar.
 */
function configurarImportacaoPedidos() {
  const inputArquivo = document.getElementById('inputImportarPlanilha');
  const erro = document.getElementById('erroImportarPlanilha');
  const preview = document.getElementById('previewImportacaoPlanilha');
  const avisoDuplicados = document.getElementById('avisoDuplicadosImportacao');
  const corpoTabela = document.getElementById('corpoTabelaPreviewImportacao');
  const contador = document.getElementById('contadorPreviewImportacao');
  const contadorEnviar = document.getElementById('contadorEnviarImportacao');
  const sucesso = document.getElementById('sucessoImportacao');
  const btnEnviar = document.getElementById('btnEnviarImportacao');
  const btnCancelar = document.getElementById('btnCancelarImportacao');

  let itensImportacao = [];

  function limparPreview() {
    itensImportacao = [];
    preview.hidden = true;
    corpoTabela.innerHTML = '';
    avisoDuplicados.hidden = true;
  }

  // Célula com um <input> editável (Data do Pedido, Rec. Estoque ou SLA).
  // Cada alteração revalida só aquela linha (classe/tooltip) e reavalia o
  // botão "Enviar" - sem reconstruir a tabela inteira, para não perder o
  // foco do campo a cada tecla digitada.
  function criarCelulaEditavelImportacao(item, tr, campo, tipo) {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = tipo;
    if (tipo === 'number') input.min = '1';
    input.value = item[campo] != null ? item[campo] : '';
    input.className = 'input-preview-importacao';
    input.addEventListener('input', () => {
      item[campo] = input.value;
      const problemas = validarLinhaImportacao(item);
      tr.classList.toggle('linha-importacao-invalida', problemas.length > 0);
      tr.title = problemas.join(' • ');
      atualizarEstadoBotaoEnviar();
    });
    td.appendChild(input);
    return td;
  }

  function construirLinhaPreview(item) {
    const tr = document.createElement('tr');

    const tdNumero = document.createElement('td');
    tdNumero.textContent = item.numeroPedido || `(linha ${item._linhaPlanilha} sem número)`;
    tr.appendChild(tdNumero);

    const tdCliente = document.createElement('td');
    tdCliente.textContent = item.cliente || '-';
    tr.appendChild(tdCliente);

    tr.appendChild(criarCelulaEditavelImportacao(item, tr, 'dataPedido', 'date'));
    tr.appendChild(criarCelulaEditavelImportacao(item, tr, 'dataRecebimentoEstoque', 'date'));
    tr.appendChild(criarCelulaEditavelImportacao(item, tr, 'slaDias', 'number'));

    const tdQtd = document.createElement('td');
    tdQtd.textContent = item.quantidadeItens !== '' ? item.quantidadeItens : '-';
    tr.appendChild(tdQtd);

    const tdModalidade = document.createElement('td');
    tdModalidade.textContent = item.modalidade || '-';
    tr.appendChild(tdModalidade);

    const tdRepresentante = document.createElement('td');
    tdRepresentante.textContent = item.nomeRepresentante || '-';
    tr.appendChild(tdRepresentante);

    const tdId = document.createElement('td');
    tdId.textContent = item.idExterno || '-';
    tr.appendChild(tdId);

    // Caixa "Excluir": permite tirar esta linha específica do envio sem
    // cancelar o lote inteiro (ex.: um pedido que o colaborador não quer
    // subir, ou que está dando problema e ele prefere corrigir depois,
    // separado). A linha continua visível na prévia (só esmaecida), e fica
    // de fora tanto da validação de pendências/duplicados quanto do que é
    // de fato gravado ao clicar em "Enviar".
    const tdExcluir = document.createElement('td');
    tdExcluir.className = 'col-excluir-importacao';
    const checkboxExcluir = document.createElement('input');
    checkboxExcluir.type = 'checkbox';
    checkboxExcluir.checked = Boolean(item._excluido);
    checkboxExcluir.setAttribute(
      'aria-label',
      `Excluir o pedido ${item.numeroPedido || `da linha ${item._linhaPlanilha}`} desta importação`
    );
    checkboxExcluir.addEventListener('change', () => {
      item._excluido = checkboxExcluir.checked;
      tr.classList.toggle('linha-importacao-excluida', item._excluido);
      atualizarEstadoBotaoEnviar();
    });
    tdExcluir.appendChild(checkboxExcluir);
    tr.appendChild(tdExcluir);

    const problemas = validarLinhaImportacao(item);
    if (problemas.length > 0) {
      tr.classList.add('linha-importacao-invalida');
      tr.title = problemas.join(' • ');
    }
    if (item._excluido) {
      tr.classList.add('linha-importacao-excluida');
    }

    return tr;
  }

  // Reaproveita o mesmo parágrafo de aviso (id "avisoDuplicadosImportacao")
  // tanto para duplicidade quanto para campo obrigatório em branco - são os
  // dois motivos que desabilitam o "Enviar". Antes desta correção, um
  // campo em branco (ex.: Rec. Estoque) desabilitava o botão SEM nenhuma
  // mensagem visível (só um sublinhado sutil na linha + tooltip ao passar o
  // mouse), e o botão continuava com a mesma cor de "habilitado" - dava a
  // impressão de estar travado sem explicação. Agora, além do CSS de botão
  // desabilitado (.btn:disabled em styles.css), aparece sempre uma
  // mensagem dizendo exatamente o que falta preencher e em qual pedido.
  function atualizarEstadoBotaoEnviar() {
    // Linhas marcadas com "Excluir" ficam de fora da validação - excluir o
    // pedido problemático é exatamente a forma de desbloquear o envio do
    // restante do lote, sem precisar corrigir nem cancelar tudo.
    const itensAtivos = itensImportacao.filter((item) => !item._excluido);

    const duplicados = listarDuplicadosImportacao(itensAtivos);
    const pendencias = itensAtivos
      .map((item) => {
        const problemas = validarLinhaImportacao(item);
        if (problemas.length === 0) return null;
        const identificador = item.numeroPedido || `linha ${item._linhaPlanilha} da planilha`;
        return `${identificador} (${problemas.join(', ')})`;
      })
      .filter(Boolean);

    if (duplicados.length > 0) {
      avisoDuplicados.textContent =
        'Importação bloqueada: número(s) de pedido duplicado(s) (repetido no arquivo ou já ' +
        `existente no sistema) - ${duplicados.join(', ')}. Corrija e envie o arquivo novamente, ` +
        'ou marque "Excluir" na(s) linha(s) duplicada(s) para enviar só o restante.';
      avisoDuplicados.hidden = false;
    } else if (pendencias.length > 0) {
      avisoDuplicados.textContent =
        'Preencha os campos obrigatórios em branco antes de enviar (ou marque "Excluir" na linha) - ' +
        pendencias.join('; ') + '.';
      avisoDuplicados.hidden = false;
    } else if (itensAtivos.length === 0 && itensImportacao.length > 0) {
      avisoDuplicados.textContent =
        'Todos os pedidos desta prévia foram marcados para exclusão. Desmarque ao menos um para ' +
        'habilitar o envio.';
      avisoDuplicados.hidden = false;
    } else {
      avisoDuplicados.hidden = true;
    }

    contadorEnviar.textContent = String(itensAtivos.length);
    btnEnviar.disabled = duplicados.length > 0 || pendencias.length > 0 || itensAtivos.length === 0;
  }

  function exibirPreview() {
    corpoTabela.innerHTML = '';
    itensImportacao.forEach((item) => corpoTabela.appendChild(construirLinhaPreview(item)));
    contador.textContent = String(itensImportacao.length);
    preview.hidden = false;
    sucesso.hidden = true;
    atualizarEstadoBotaoEnviar();
  }

  inputArquivo.addEventListener('change', async () => {
    const arquivo = inputArquivo.files[0];
    erro.hidden = true;
    if (!arquivo) return;

    try {
      itensImportacao = await lerPlanilhaPedidos(arquivo);
      exibirPreview();
    } catch (erroLeitura) {
      limparPreview();
      inputArquivo.value = '';
      erro.textContent = 'Erro ao ler a planilha: ' + erroLeitura.message;
      erro.hidden = false;
    }
  });

  btnCancelar.addEventListener('click', () => {
    limparPreview();
    inputArquivo.value = '';
  });

  btnEnviar.addEventListener('click', async () => {
    btnEnviar.disabled = true;
    erro.hidden = true;
    const itensAtivos = itensImportacao.filter((item) => !item._excluido);
    const quantidadeExcluidos = itensImportacao.length - itensAtivos.length;
    try {
      await confirmarImportacaoPedidos(itensAtivos);
      sucesso.textContent = quantidadeExcluidos > 0
        ? `${itensAtivos.length} pedido(s) importado(s) com sucesso ` +
          `(${quantidadeExcluidos} marcado(s) como "Excluir" não foram enviados).`
        : `${itensAtivos.length} pedido(s) importado(s) com sucesso.`;
      sucesso.hidden = false;
      limparPreview();
      inputArquivo.value = '';
    } catch (erroEnvio) {
      erro.textContent = 'Erro ao gravar os pedidos importados: ' + erroEnvio.message;
      erro.hidden = false;
      atualizarEstadoBotaoEnviar();
    }
  });
}

function configurarFiltrosEBusca() {
  const conjuntosFiltros = [
    {
      busca: 'campoBusca2', status: 'filtroStatus2',
      recebIni: 'filtroRecebimentoInicio2', recebFim: 'filtroRecebimentoFim2',
      vencIni: 'filtroVencimentoInicio2', vencFim: 'filtroVencimentoFim2',
      limpar: 'btnLimparFiltros2'
    }
  ].filter((conjunto) => document.getElementById(conjunto.busca)); // ignora conjuntos ausentes no HTML

  function sincronizarCamposComEstado() {
    conjuntosFiltros.forEach((conjunto) => {
      document.getElementById(conjunto.busca).value = estado.filtros.texto;
      document.getElementById(conjunto.status).value = estado.filtros.status;
      document.getElementById(conjunto.recebIni).value = estado.filtros.recebIni;
      document.getElementById(conjunto.recebFim).value = estado.filtros.recebFim;
      document.getElementById(conjunto.vencIni).value = estado.filtros.vencIni;
      document.getElementById(conjunto.vencFim).value = estado.filtros.vencFim;
    });
  }

  conjuntosFiltros.forEach((conjunto) => {
    document.getElementById(conjunto.busca).addEventListener('input', (evento) => {
      estado.filtros.texto = evento.target.value;
      sincronizarCamposComEstado();
      renderizarTudo();
    });

    document.getElementById(conjunto.status).addEventListener('change', (evento) => {
      estado.filtros.status = evento.target.value;
      sincronizarCamposComEstado();
      renderizarTudo();
    });

    document.getElementById(conjunto.recebIni).addEventListener('change', (evento) => {
      estado.filtros.recebIni = evento.target.value;
      sincronizarCamposComEstado();
      renderizarTudo();
    });

    document.getElementById(conjunto.recebFim).addEventListener('change', (evento) => {
      estado.filtros.recebFim = evento.target.value;
      sincronizarCamposComEstado();
      renderizarTudo();
    });

    document.getElementById(conjunto.vencIni).addEventListener('change', (evento) => {
      estado.filtros.vencIni = evento.target.value;
      sincronizarCamposComEstado();
      renderizarTudo();
    });

    document.getElementById(conjunto.vencFim).addEventListener('change', (evento) => {
      estado.filtros.vencFim = evento.target.value;
      sincronizarCamposComEstado();
      renderizarTudo();
    });

    document.getElementById(conjunto.limpar).addEventListener('click', () => {
      estado.filtros = { texto: '', status: '', recebIni: '', recebFim: '', vencIni: '', vencFim: '' };
      sincronizarCamposComEstado();
      renderizarTudo();
    });
  });

  document.getElementById('agrupamentoHistorico').addEventListener('change', (evento) => {
    estado.agrupamentoHistorico = evento.target.value;
    renderizarHistorico();
  });
}

function exibirStatusConexao(mensagem, erro) {
  const el = document.getElementById('statusConexao');
  el.textContent = mensagem;
  el.hidden = false;
  el.className = 'status-conexao' + (erro ? ' status-conexao-erro' : '');
}

function ocultarStatusConexao() {
  document.getElementById('statusConexao').hidden = true;
}

// Aviso de confirmação exibido no topo do Painel Consolidado a cada
// Atribuir/Finalizar Separação ou Organização feito pela coluna
// "Atribuição" (ver modalAtribuicaoFase). Fecha ao clicar no X ou
// automaticamente após alguns segundos.
let timeoutAvisoAtribuicao = null;
function exibirAvisoAtribuicao(mensagem) {
  const aviso = document.getElementById('avisoAtribuicao');
  document.getElementById('textoAvisoAtribuicao').textContent = mensagem;
  aviso.hidden = false;
  clearTimeout(timeoutAvisoAtribuicao);
  timeoutAvisoAtribuicao = setTimeout(() => { aviso.hidden = true; }, 6000);
}

/* =========================================================================
   10. TEMA CLARO/ESCURO (DARK MODE)
   ========================================================================= */
const CHAVE_TEMA = 'uniso_sla_tema';

function aplicarTema(tema) {
  document.documentElement.setAttribute('data-tema', tema);
  const botao = document.getElementById('btnDarkMode');
  if (botao) botao.textContent = tema === 'escuro' ? '☀️' : '🌙';
  // Recalcula o gráfico SVG para usar as cores corretas do novo tema.
  if (estado.pedidos.length >= 0) renderizarHistorico();
}

function inicializarTema() {
  let temaSalvo = null;
  try {
    temaSalvo = localStorage.getItem(CHAVE_TEMA);
  } catch (erro) {
    // Armazenamento local indisponível (ex.: navegação privada); ignora e segue com o padrão do sistema.
  }

  if (temaSalvo === 'claro' || temaSalvo === 'escuro') {
    aplicarTema(temaSalvo);
  } else {
    const prefereEscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
    aplicarTema(prefereEscuro ? 'escuro' : 'claro');
  }

  document.getElementById('btnDarkMode').addEventListener('click', () => {
    const atual = document.documentElement.getAttribute('data-tema');
    const novo = atual === 'escuro' ? 'claro' : 'escuro';
    aplicarTema(novo);
    try {
      localStorage.setItem(CHAVE_TEMA, novo);
    } catch (erro) {
      // Armazenamento local indisponível; a preferência não será persistida nesta sessão.
    }
  });
}

/* =========================================================================
   10-B. MODO CELULAR (alternância manual de visualização)
   -------------------------------------------------------------------------
   Botão independente do dark mode: força o layout compacto (e troca a
   tabela de pedidos por cartões empilhados) mesmo em uma tela grande,
   através do atributo data-visualizacao no elemento <html> (ver seção 15
   de styles.css). Diferente da responsividade automática (que já se
   adapta sozinha ao tamanho real da tela), este botão é uma escolha
   manual do usuário, persistida no navegador.
   ========================================================================= */
const CHAVE_VISUALIZACAO = 'uniso_sla_visualizacao';

function aplicarModoVisualizacao(modo) {
  document.documentElement.setAttribute('data-visualizacao', modo);
  const botao = document.getElementById('btnModoCelular');
  if (botao) {
    botao.textContent = modo === 'celular' ? '🖥️' : '📱';
    botao.title = modo === 'celular' ? 'Voltar para o modo desktop' : 'Alternar para modo celular';
    botao.setAttribute('aria-label', botao.title);
  }
}

function inicializarModoVisualizacao() {
  let modoSalvo = null;
  try {
    modoSalvo = localStorage.getItem(CHAVE_VISUALIZACAO);
  } catch (erro) {
    // Armazenamento local indisponível; assume o padrão (desktop).
  }

  aplicarModoVisualizacao(modoSalvo === 'celular' ? 'celular' : 'desktop');

  document.getElementById('btnModoCelular').addEventListener('click', () => {
    const atual = document.documentElement.getAttribute('data-visualizacao');
    const novo = atual === 'celular' ? 'desktop' : 'celular';
    aplicarModoVisualizacao(novo);
    try {
      localStorage.setItem(CHAVE_VISUALIZACAO, novo);
    } catch (erro) {
      // Armazenamento local indisponível; a preferência não será persistida nesta sessão.
    }
  });
}

/* =========================================================================
   10-B. EXTRAÇÃO DE DADOS (EXCEL)
   -------------------------------------------------------------------------
   Botão "📥 Extrair Dados (Excel)" na seção "Pedidos" do Painel
   Consolidado. Gera um arquivo .xlsx inteiramente no navegador (biblioteca
   SheetJS, carregada via CDN em index.html) com os MESMOS pedidos
   exibidos na tabela/cartões no momento do clique — ou seja, respeita a
   busca e os filtros já aplicados (mesma lista que passa por
   pedidoPassaFiltros, mesma ordenação por criticidade). Não depende de
   nenhum backend nem grava nada no Firestore; é somente leitura.

   O arquivo tem duas abas:
   - "Pedidos": uma linha por pedido, com situação de SLA, os registros de
     Separação e Organização (operador, início, fim, duração de cada
     etapa) e o resultado da finalização (antecipado/no prazo/atrasado).
   - "Resumo": indicadores gerais (mesmos critérios do Painel de Tempos:
     total, finalizados, em aberto, taxa de conclusão) e o tempo médio por
     operador em cada etapa, calculados sobre a mesma lista exportada.
   ========================================================================= */

// Situação (SLA) em texto simples para a planilha - mesma lógica de
// textoSituacao(), mas sem caixa alta forçada nem o rótulo do badge, para
// ficar mais natural em uma coluna de relatório.
function situacaoParaPlanilha(pedido, classificacao) {
  if (pedido.status === 'finalizado') {
    if (pedido.resultadoSLA === 'antecipado') return `Finalizado - Antecipado (${pedido.diasDiferencaFinalizacao}d)`;
    if (pedido.resultadoSLA === 'atrasado') return `Finalizado - Atrasado (${pedido.diasDiferencaFinalizacao}d)`;
    return 'Finalizado - No prazo';
  }
  if (classificacao.chave === 'vence-hoje') return 'Vence hoje';
  if (classificacao.chave === 'marrom' || classificacao.chave === 'roxo') {
    return `Atrasado (${classificacao.diasAtraso}d)`;
  }
  if (classificacao.diasRestantes === 1) return 'Vence em 1 dia';
  return `Vence em ${classificacao.diasRestantes} dias`;
}

// Duração em milissegundos formatada como texto de planilha (ex.: "2h 15min"),
// reaproveitando formatarDuracao(); célula vazia quando a etapa não está completa.
function duracaoParaPlanilha(ms) {
  return ms == null ? '' : formatarDuracao(ms);
}

// Monta a lista de pedidos a exportar: os mesmos pedidos e a mesma ordem
// já exibidos na tela (classificação de SLA recalculada + filtros de
// busca/status/data atualmente aplicados no Painel Consolidado).
function obterPedidosParaExportacao() {
  const classificados = estado.pedidos.map((pedido) => ({ ...pedido, _classificacao: classificarPedido(pedido) }));
  const filtrados = classificados.filter(pedidoPassaFiltros);
  filtrados.sort((a, b) => {
    const ordemA = ordemCriticidade(a._classificacao);
    const ordemB = ordemCriticidade(b._classificacao);
    if (ordemA !== ordemB) return ordemA - ordemB;
    const diasA = a._classificacao.diasRestantes ?? 0;
    const diasB = b._classificacao.diasRestantes ?? 0;
    return diasA - diasB;
  });
  return filtrados;
}

function montarLinhasPlanilhaPedidos(lista) {
  return lista.map((pedido) => ({
    'Nº Pedido': pedido.numeroPedido,
    Cliente: pedido.cliente,
    'Data Pedido': formatarBR(pedido.dataPedido),
    'Data Recebimento': formatarBR(pedido.dataRecebimentoEstoque),
    'SLA (dias úteis)': pedido.slaDias,
    'Data Vencimento': formatarBR(pedido.dataVencimento),
    'Quantidade de Itens': pedido.quantidadeItens != null ? pedido.quantidadeItens : '',
    Situação: situacaoParaPlanilha(pedido, pedido._classificacao),
    'Status do Pedido': pedido.status === 'finalizado' ? 'Finalizado' : 'Aberto',
    'Resultado do SLA': pedido.status === 'finalizado'
      ? { antecipado: 'Antecipado', no_prazo: 'No prazo', atrasado: 'Atrasado' }[pedido.resultadoSLA] || '-'
      : '-',
    'Dias de Diferença (Finalização)': pedido.status === 'finalizado' && pedido.diasDiferencaFinalizacao != null
      ? pedido.diasDiferencaFinalizacao
      : '',
    'Data/Hora Finalização': pedido.status === 'finalizado' ? formatarDataHoraBrasilia(pedido.finalizadoEm) : '',
    'Status Separação': (CONFIG_SEPARACAO[pedido.statusSeparacao || 'a-separar'] || {}).label || '',
    'Operador Separação': obterOperadorAtual(pedido) === '-' ? '' : obterOperadorAtual(pedido),
    'Início Separação': formatarDataHoraBrasilia(pedido.dataHoraInicioSeparacao),
    'Fim Separação': formatarDataHoraBrasilia(pedido.dataHoraFimSeparacao),
    'Tempo de Separação': duracaoParaPlanilha(duracaoSeparacaoMs(pedido)),
    'Status Organização': (CONFIG_ORGANIZACAO[pedido.statusOrganizacao || 'a-organizar'] || {}).label || '',
    'Operador Organização': obterOperadorOrganizacaoAtual(pedido) === '-' ? '' : obterOperadorOrganizacaoAtual(pedido),
    'Início Organização': formatarDataHoraBrasilia(pedido.dataHoraInicioOrganizacao),
    'Fim Organização': formatarDataHoraBrasilia(pedido.dataHoraFimOrganizacao),
    'Tempo de Organização': duracaoParaPlanilha(duracaoOrganizacaoMs(pedido)),
    'Tempo Total (Separação + Organização)': duracaoParaPlanilha(duracaoTotalMs(pedido)),
    'Peso da Carga (kg)': pedido.pesoCargaKg != null ? pedido.pesoCargaKg : '',
    'Quantidade de Caixas (fechada)': pedido.quantidadeCaixas != null ? pedido.quantidadeCaixas : '',
    'Altura (cm)': pedido.alturaCm != null ? pedido.alturaCm : '',
    'Largura (cm)': pedido.larguraCm != null ? pedido.larguraCm : '',
    'Comprimento (cm)': pedido.comprimentoCm != null ? pedido.comprimentoCm : '',
    'Peso Cubado (kg)': pedido.pesoCubadoKg != null ? pedido.pesoCubadoKg : '',
    Observação: pedido.observacao || '',
    // Dados de referência trazidos pela importação em lote via planilha
    // (item 33 do README) - ficam em branco em pedidos lançados manualmente.
    ID: pedido.idExterno || '',
    'Parceiro - Código': pedido.parceiroCodigo || '',
    Modalidade: pedido.modalidade || '',
    Representante: pedido.nomeRepresentante || '',
    'Cadastro (planilha de origem)': pedido.cadastroPlanilha
      ? formatarDataHoraBR(pedido.cadastroPlanilha)
      : ''
  }));
}

function montarLinhasPlanilhaResumo(lista) {
  const total = lista.length;
  const finalizados = lista.filter((p) => p.status === 'finalizado');
  const emAberto = total - finalizados.length;
  const taxaConclusao = total > 0 ? Math.round((finalizados.length / total) * 100) : 0;
  const antecipados = finalizados.filter((p) => p.resultadoSLA === 'antecipado').length;
  const noPrazo = finalizados.filter((p) => p.resultadoSLA === 'no_prazo').length;
  const atrasados = finalizados.filter((p) => p.resultadoSLA === 'atrasado').length;

  // Volumetria (itens no cadastro + caixas fechadas na Organização), peso e
  // peso cubado: somados só sobre pedidos com o dado informado (pedidos sem
  // quantidadeItens/quantidadeCaixas/pesoCargaKg/pesoCubadoKg - seja por
  // serem antigos, seja por a etapa correspondente ainda não ter sido
  // finalizada - são ignorados nessa soma em vez de contar como zero).
  const totalItens = lista.reduce((soma, p) => soma + (typeof p.quantidadeItens === 'number' ? p.quantidadeItens : 0), 0);
  const totalCaixas = lista.reduce((soma, p) => soma + (typeof p.quantidadeCaixas === 'number' ? p.quantidadeCaixas : 0), 0);
  const pedidosComPeso = lista.filter((p) => typeof p.pesoCargaKg === 'number');
  const totalPesoKg = pedidosComPeso.reduce((soma, p) => soma + p.pesoCargaKg, 0);
  const pedidosComPesoCubado = lista.filter((p) => typeof p.pesoCubadoKg === 'number');
  const totalPesoCubadoKg = pedidosComPesoCubado.reduce((soma, p) => soma + p.pesoCubadoKg, 0);

  const linhas = [
    { Indicador: 'Data de extração', Valor: formatarDataHoraBrasilia(new Date()) },
    { Indicador: 'Total de pedidos (nesta extração)', Valor: total },
    { Indicador: 'Pedidos em aberto', Valor: emAberto },
    { Indicador: 'Pedidos finalizados (baixados)', Valor: finalizados.length },
    { Indicador: 'Taxa de conclusão', Valor: `${taxaConclusao}%` },
    { Indicador: '— Dos finalizados: antecipados', Valor: antecipados },
    { Indicador: '— Dos finalizados: no prazo', Valor: noPrazo },
    { Indicador: '— Dos finalizados: atrasados', Valor: atrasados },
    { Indicador: '', Valor: '' },
    { Indicador: 'Total de itens cadastrados (lançamento do pedido)', Valor: totalItens },
    { Indicador: 'Total de caixas fechadas (volumetria - Organização)', Valor: totalCaixas },
    {
      Indicador: 'Peso total aferido (kg)',
      Valor: pedidosComPeso.length > 0 ? formatarPesoKg(totalPesoKg) : '- (nenhum pedido com peso registrado)'
    },
    {
      Indicador: 'Peso cubado total (kg)',
      Valor: pedidosComPesoCubado.length > 0 ? formatarPesoKg(totalPesoCubadoKg) : '- (nenhum pedido com cubagem registrada)'
    },
    { Indicador: '', Valor: '' },
    { Indicador: 'Tempo médio por operador — Separação', Valor: '' }
  ];

  calcularTemposPorOperador(lista, 'operadorFimSeparacao', duracaoSeparacaoMs).forEach((item) => {
    linhas.push({
      Indicador: `   ${item.operador}`,
      Valor: `${formatarDuracao(item.tempoMedioMs)} (${item.quantidade} pedidos, ${item.percentual}%) — ${item.totalCaixas} cx`
    });
  });

  linhas.push({ Indicador: '', Valor: '' });
  linhas.push({ Indicador: 'Tempo médio por operador — Organização', Valor: '' });
  calcularTemposPorOperador(lista, 'operadorFimOrganizacao', duracaoOrganizacaoMs, true).forEach((item) => {
    const sufixoPeso = item.totalPesoKg != null ? `, ${formatarPesoKg(item.totalPesoKg)}` : '';
    const sufixoPesoCubado = item.totalPesoCubadoKg != null ? `, ${formatarPesoKg(item.totalPesoCubadoKg)} cubado` : '';
    linhas.push({
      Indicador: `   ${item.operador}`,
      Valor: `${formatarDuracao(item.tempoMedioMs)} (${item.quantidade} pedidos, ${item.percentual}%) — ${item.totalCaixas} cx${sufixoPeso}${sufixoPesoCubado}`
    });
  });

  return linhas;
}

function exportarDadosParaExcel() {
  const erroEl = document.getElementById('erroExtrairExcel');
  if (typeof XLSX === 'undefined') {
    if (erroEl) {
      erroEl.textContent = 'Não foi possível carregar a biblioteca de geração do Excel (verifique a conexão com a internet e recarregue a página).';
      erroEl.hidden = false;
    }
    return;
  }
  if (erroEl) erroEl.hidden = true;

  const lista = obterPedidosParaExportacao();
  if (lista.length === 0) {
    if (erroEl) {
      erroEl.textContent = 'Nenhum pedido para exportar com a busca/filtros atuais.';
      erroEl.hidden = false;
    }
    return;
  }

  const planilhaPedidos = XLSX.utils.json_to_sheet(montarLinhasPlanilhaPedidos(lista));
  const planilhaResumo = XLSX.utils.json_to_sheet(montarLinhasPlanilhaResumo(lista), { skipHeader: true });

  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, planilhaResumo, 'Resumo');
  XLSX.utils.book_append_sheet(livro, planilhaPedidos, 'Pedidos');

  const agora = new Date();
  const carimbo = `${formatarISO(agora)}_${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}`;
  XLSX.writeFile(livro, `pedidos-sla-uniso_${carimbo}.xlsx`);
}

function configurarExtracaoExcel() {
  const botao = document.getElementById('btnExtrairExcel');
  if (!botao) return;
  botao.addEventListener('click', exportarDadosParaExcel);
}

// Barra de rolagem horizontal "espelho" logo acima da tabela de Pedidos
// (item 34 do README) - a tabela pode ficar mais larga que a tela (mais
// colunas, títulos sem quebra - ver item 34), e a barra de rolagem de
// verdade (do .tabela-wrapper) só aparece depois da ÚLTIMA linha da
// tabela - com poucos pedidos ela fica logo ali embaixo, mas com centenas
// de pedidos (ex.: 615) ela fica fora da tela, exigindo rolar a página
// inteira primeiro só para conseguir rolar a tabela para o lado. Esta
// barra "espelho" fica fixa logo abaixo do texto explicativo, sempre
// visível, e é sincronizada nos dois sentidos com a barra de verdade.
function configurarRolagemSuperiorTabelaPedidos() {
  const espelho = document.getElementById('rolagemSuperiorPedidos');
  const espelhoInterno = document.getElementById('rolagemSuperiorPedidosInterno');
  const wrapper = document.getElementById('tabelaPedidosWrapper');
  const tabela = document.getElementById('tabelaPedidos');
  if (!espelho || !espelhoInterno || !wrapper || !tabela) return;

  // Mantém a largura do "espelho" igual à largura real da tabela - reage a
  // qualquer mudança (redimensionar a janela, troca de modo celular/desktop
  // etc.) via ResizeObserver, em vez de calcular só uma vez na inicialização.
  function atualizarLargura() {
    espelhoInterno.style.width = `${tabela.scrollWidth}px`;
  }
  atualizarLargura();

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(atualizarLargura).observe(tabela);
  } else {
    // Navegador sem ResizeObserver (raro): ao menos reage ao redimensionar
    // a janela, para não deixar a barra com uma largura desatualizada.
    window.addEventListener('resize', atualizarLargura);
  }

  // Sincroniza a rolagem horizontal nos dois sentidos. A flag evita loop
  // infinito: ao ajustarmos o scrollLeft de um dos dois a partir do outro,
  // o evento 'scroll' que isso dispara é ignorado nesse instante.
  let sincronizando = false;
  espelho.addEventListener('scroll', () => {
    if (sincronizando) return;
    sincronizando = true;
    wrapper.scrollLeft = espelho.scrollLeft;
    sincronizando = false;
  });
  wrapper.addEventListener('scroll', () => {
    if (sincronizando) return;
    sincronizando = true;
    espelho.scrollLeft = wrapper.scrollLeft;
    sincronizando = false;
  });
}

/* =========================================================================
   11. DADOS DE DEMONSTRAÇÃO (opcional, não executado automaticamente)
   -------------------------------------------------------------------------
   Esta função NÃO é chamada em lugar nenhum do carregamento automático do
   sistema. Ela existe apenas para facilitar testes/demonstrações e pode
   ser removida deste arquivo sem qualquer impacto no funcionamento do app.

   Para usar: com o app aberto no navegador (F12 > Console), execute:
     carregarPedidosDemonstracao()
   Os pedidos criados ficam marcados com "DEMO-" no número do pedido para
   facilitar a exclusão manual posterior.
   ========================================================================= */
async function carregarPedidosDemonstracao() {
  const hoje = hojeISO();
  const exemplos = [
    {
      numeroPedido: 'DEMO-001',
      cliente: 'Cliente Exemplo A',
      dataPedido: hoje,
      dataRecebimentoEstoque: hoje,
      slaDias: 5,
      observacao: 'Pedido de demonstração (dentro do prazo).'
    },
    {
      numeroPedido: 'DEMO-002',
      cliente: 'Cliente Exemplo B',
      dataPedido: hoje,
      dataRecebimentoEstoque: somarDiasUteis(hoje, -6),
      slaDias: 5,
      observacao: 'Pedido de demonstração (atrasado).'
    },
    {
      numeroPedido: 'DEMO-003',
      cliente: 'Cliente Exemplo C',
      dataPedido: hoje,
      dataRecebimentoEstoque: somarDiasUteis(hoje, -4),
      slaDias: 4,
      observacao: 'Pedido de demonstração (vence hoje).'
    }
  ];

  for (const exemplo of exemplos) {
    await salvarPedido(exemplo, null);
  }
  console.info('Pedidos de demonstração criados com sucesso. Exclua-os antes de usar o sistema em produção.');
}
window.carregarPedidosDemonstracao = carregarPedidosDemonstracao;

/* =========================================================================
   12. INICIALIZAÇÃO DA APLICAÇÃO
   -------------------------------------------------------------------------
   A configuração de interface (tema, modo celular, formulário, filtros e a
   primeira renderização) é executada de forma incondicional e SÍNCRONA,
   antes de qualquer tentativa de carregar o Firebase. Assim, mesmo que o
   carregamento do Firebase falhe (rede bloqueada, firewall, config
   inválida), o dark mode, o modo celular e a validação do formulário
   continuam funcionando normalmente. O carregamento do Firebase é feito
   por último, de forma assíncrona e isolada, em carregarFirebaseEIniciar().
   ========================================================================= */
inicializarTema();
inicializarModoVisualizacao();
configurarNavegacaoTelas();
configurarModais();
configurarModalSeparacao();
configurarModalAtribuicaoFase();
configurarFormularioInlineNovoPedido();
configurarFormularioColaboradores();
configurarFiltrosEBusca();
configurarImportacaoPedidos();
configurarExtracaoExcel();
configurarRolagemSuperiorTabelaPedidos();
renderizarTudo();
carregarFirebaseEIniciar();
