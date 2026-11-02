/**
 * Controle Financeiro: backup automático no Google Drive, 2 vezes por semana (Entrega 5.7; semanal desde 26/10/2026,
 * segunda e quinta desde 31/10/2026, para o Supabase nunca ficar 1 semana sem acesso).
 * Roda no Google Apps Script da conta de Rafael, na nuvem do Google. Não depende do notebook.
 *
 * O que faz, toda segunda-feira e toda quinta-feira (entre 8h e 9h, horário de Brasília):
 *   1. Entra no Supabase com o e-mail e a senha guardados nas Propriedades do script.
 *   2. Lê todas as tabelas do app (a RLS só devolve os dados do próprio usuário).
 *   3. Monta o JSON no mesmo formato do botão "Baixar backup" do app (dá para restaurar no app).
 *   4. Grava o arquivo na pasta do Drive informada e confere o tamanho gravado.
 *   5. Marca no app a data do último backup.
 *   6. O primeiro backup de cada mês é o "mensal": só nele vai o e-mail de OK. Se falhar, o e-mail vai sempre.
 *   7. Organiza a pasta: guarda os mensais dos últimos 24 meses e os 16 backups mais recentes (cerca de 8 semanas);
 *      os mais antigos vão para a lixeira do Drive (recuperáveis por 30 dias).
 *
 * Configuração (uma vez): Configurações do projeto > Propriedades do script:
 *   EMAIL     e-mail de login do app
 *   SENHA     senha de login do app (fica só nesta conta Google; nunca vai para o GitHub)
 *   PASTA_ID  id da pasta do Drive (o trecho final do endereço da pasta)
 *   TOTP_CHAVE chave de configuração do Google Authenticator (mostrada pelo app ao ativar a
 *              verificação em duas etapas). Com ela o script gera o código de 6 dígitos sozinho.
 * Depois rode uma vez "testarAgora" e uma vez "instalarAgendamento".
 */

const SUPABASE_URL = "https://vktqyguhdgawstlbvwkh.supabase.co";
// Chave pública por definição (publishable). Quem protege os dados é o login + RLS.
const SUPABASE_CHAVE_PUBLICA = "sb_publishable_lAcGjKk6Kn5Yo445pHIUVQ_PykVdfSQ";
const FUSO = "America/Sao_Paulo";

// Tabela do banco -> coleção do app, com os nomes dos campos (banco -> app)
const TABELAS = [
  { tabela: "categorias", colecao: "categorias", chave: "id", ordem: "id",
    campos: { tipo: "tipo", nome: "nome", cor: "cor", ordem: "ordem", ativa: "ativa" } },
  { tabela: "cartoes", colecao: "cartoes", chave: "id", ordem: "id",
    campos: { nome: "nome", dia_melhor_compra: "diaMelhorCompra", dia_vencimento: "diaVencimento", ordem: "ordem", ativo: "ativo" } },
  { tabela: "contas_fixas", colecao: "contasFixas", chave: "id", ordem: "id",
    campos: { descricao: "descricao", categoria_id: "categoriaId", forma_pagamento: "formaPagamento", cartao_id: "cartaoId",
      dia_vencimento: "diaVencimento", valor_estimado_centavos: "valorEstimadoCentavos", ativa: "ativa",
      tipo: "tipo", reembolso_de: "reembolsoDe" } },
  { tabela: "orcamentos", colecao: "orcamentos", chave: "categoria_id", ordem: "categoria_id",
    campos: { valor_planejado_centavos: "valorPlanejadoCentavos" } },
  { tabela: "geracoes", colecao: "geracoes", chave: "mes", ordem: "mes",
    campos: { contas: "contas", atualizado_em: "atualizadoEm" } },
  { tabela: "config", colecao: "config", chave: null, ordem: "user_id",
    campos: { fixas_desde: "fixasDesde", ultimo_backup_baixado: "ultimoBackupBaixado", versao_esquema: "versaoEsquema", criado_em: "criadoEm" } },
  { tabela: "lancamentos", colecao: "lancamentos", chave: "id", ordem: "id",
    campos: { tipo: "tipo", descricao: "descricao", valor_centavos: "valorCentavos", data: "data", competencia: "competencia",
      categoria_id: "categoriaId", forma_pagamento: "formaPagamento", cartao_id: "cartaoId", status: "status", parcela: "parcela",
      grupo_parcela: "grupoParcela", conta_fixa_id: "contaFixaId", reembolso: "reembolso", reembolso_quem: "reembolsoQuem",
      reembolso_de: "reembolsoDe", observacao: "observacao", origem: "origem", versao_esquema: "versaoEsquema",
      criado_em: "criadoEm", atualizado_em: "atualizadoEm" } }
];

const PADRAO_ARQUIVO = /^backup-controle-financeiro-(\d{4}-\d{2})-(\d{2})\.json$/;
const MENSAIS_GUARDADOS = 24;
const SEMANAIS_GUARDADOS = 16; // 2 por semana = cerca de 8 semanas

/** Agendado: roda toda segunda-feira e toda quinta-feira. */
function backupSemanal() {
  const props = PropertiesService.getScriptProperties();
  const email = props.getProperty("EMAIL");
  try {
    const pasta = DriveApp.getFolderById(props.getProperty("PASTA_ID"));
    const mesAtual = Utilities.formatDate(new Date(), FUSO, "yyyy-MM");
    const ehMensal = !listarBackups(pasta).some(function (b) { return b.mes === mesAtual; });
    const resumo = fazerBackup(props);
    const limpeza = organizarPasta(pasta);
    if (ehMensal) {
      MailApp.sendEmail(email, "Backup mensal do Controle Financeiro: OK (" + resumo.arquivo + ")",
        "Backup mensal salvo no Google Drive. Os outros backups continuam toda segunda e quinta-feira, sem e-mail.\n\n" +
        "Arquivo: " + resumo.arquivo + "\nTamanho: " + resumo.tamanho + " bytes\n" +
        "Lançamentos: " + resumo.lancamentos + "\nCategorias: " + resumo.categorias + " · Cartões: " + resumo.cartoes +
        " · Contas fixas: " + resumo.fixas + "\nArquivos antigos enviados para a lixeira: " + limpeza +
        "\n\nLink da pasta: " + resumo.linkPasta);
    }
  } catch (erro) {
    MailApp.sendEmail(email, "Backup do Controle Financeiro: FALHOU",
      "O backup automático de hoje não foi feito.\n\nMotivo: " + erro.message +
      "\n\nFaça pelo app: Ajustes > Baixar backup completo (JSON), e me mostre esta mensagem.");
    throw erro;
  }
}

/** Mantido para o agendamento antigo (dia 1) não falhar enquanto não for trocado. */
function backupMensal() { backupSemanal(); }

// Backups desta pasta criados por este script (pelo nome), do mais novo para o mais antigo
function listarBackups(pasta) {
  const lista = [];
  const arquivos = pasta.getFiles();
  while (arquivos.hasNext()) {
    const f = arquivos.next();
    const m = PADRAO_ARQUIVO.exec(f.getName());
    if (m) lista.push({ arquivo: f, mes: m[1], data: m[1] + "-" + m[2], criado: f.getDateCreated().getTime() });
  }
  return lista.sort(function (a, b) { return b.data.localeCompare(a.data) || b.criado - a.criado; });
}

// Mensal = o primeiro backup de cada mês. Fica: mensais dos últimos 24 meses + os 16 backups mais recentes.
function organizarPasta(pasta) {
  const lista = listarBackups(pasta);
  const primeiroDoMes = {};
  for (let i = lista.length - 1; i >= 0; i--) if (!primeiroDoMes[lista[i].mes]) primeiroDoMes[lista[i].mes] = lista[i];
  const meses = Object.keys(primeiroDoMes).sort().reverse().slice(0, MENSAIS_GUARDADOS);
  const manter = new Set(lista.slice(0, SEMANAIS_GUARDADOS).concat(meses.map(function (m) { return primeiroDoMes[m]; })));
  let enviados = 0;
  for (const b of lista) {
    if (!manter.has(b)) { b.arquivo.setTrashed(true); enviados++; }
  }
  return enviados;
}

/** Para testar na hora, pelo botão Executar. */
function testarAgora() {
  const resumo = fazerBackup(PropertiesService.getScriptProperties());
  Logger.log("OK: " + JSON.stringify(resumo));
}

function fazerBackup(props) {
  const email = props.getProperty("EMAIL");
  const senha = props.getProperty("SENHA");
  const pastaId = props.getProperty("PASTA_ID");
  if (!email || !senha || !pastaId) throw new Error("Faltam EMAIL, SENHA ou PASTA_ID nas Propriedades do script.");

  const sessao = entrar(email, senha, props.getProperty("TOTP_CHAVE"));
  try {
    const colecoes = {};
    for (const t of TABELAS) colecoes[t.colecao] = lerTabela(sessao, t);
    if (!colecoes.lancamentos.length) throw new Error("O banco devolveu 0 lançamentos. Backup não gravado, para não guardar um arquivo vazio.");
    if (!colecoes.categorias.length) throw new Error("O banco devolveu 0 categorias. Backup não gravado.");
    conferirLancamentos(colecoes.lancamentos);

    const agora = new Date();
    const dados = { app: "controle-financeiro", versaoEsquema: 1, geradoEm: agora.toISOString(), origem: "backup-automatico-apps-script", colecoes: colecoes };
    const texto = JSON.stringify(dados, null, 1);
    const nome = "backup-controle-financeiro-" + Utilities.formatDate(agora, FUSO, "yyyy-MM-dd") + ".json";

    const pasta = DriveApp.getFolderById(pastaId);
    const arquivo = pasta.createFile(Utilities.newBlob(texto, "application/json", nome));
    const tamanhoGravado = arquivo.getSize();
    const tamanhoEsperado = Utilities.newBlob(texto).getBytes().length;
    if (tamanhoGravado !== tamanhoEsperado) throw new Error("Arquivo gravado com tamanho diferente (" + tamanhoGravado + " de " + tamanhoEsperado + " bytes).");

    marcarUltimoBackup(sessao, agora.toISOString());
    return {
      arquivo: nome, tamanho: tamanhoGravado, lancamentos: colecoes.lancamentos.length, categorias: colecoes.categorias.length,
      cartoes: colecoes.cartoes.length, fixas: colecoes.contasFixas.length, linkPasta: pasta.getUrl()
    };
  } finally {
    sair(sessao);
  }
}

function entrar(email, senha, chaveTotp) {
  const r = UrlFetchApp.fetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { apikey: SUPABASE_CHAVE_PUBLICA },
    payload: JSON.stringify({ email: email, password: senha })
  });
  if (r.getResponseCode() !== 200) {
    throw new Error("Login no Supabase falhou (código " + r.getResponseCode() + "). Confira EMAIL e SENHA nas Propriedades do script.");
  }
  const corpo = JSON.parse(r.getContentText());
  const sessao = { token: corpo.access_token, uid: corpo.user.id };
  // Verificação em duas etapas: sem ela o banco devolve as tabelas vazias
  const fator = (corpo.user.factors || []).find(function (f) { return f.factor_type === "totp" && f.status === "verified"; });
  if (!fator) return sessao;
  if (!chaveTotp) throw new Error("A verificação em duas etapas está ativa, mas falta a TOTP_CHAVE nas Propriedades do script.");
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const desafio = UrlFetchApp.fetch(SUPABASE_URL + "/auth/v1/factors/" + fator.id + "/challenge", {
      method: "post", contentType: "application/json", muteHttpExceptions: true, headers: cabecalhos(sessao), payload: "{}"
    });
    if (desafio.getResponseCode() !== 200) throw new Error("Não consegui iniciar a verificação em duas etapas (código " + desafio.getResponseCode() + ").");
    const v = UrlFetchApp.fetch(SUPABASE_URL + "/auth/v1/factors/" + fator.id + "/verify", {
      method: "post", contentType: "application/json", muteHttpExceptions: true, headers: cabecalhos(sessao),
      payload: JSON.stringify({ challenge_id: JSON.parse(desafio.getContentText()).id, code: gerarCodigoTotp(chaveTotp) })
    });
    if (v.getResponseCode() === 200) {
      const s2 = JSON.parse(v.getContentText());
      sessao.token = s2.access_token;
      return sessao;
    }
    Utilities.sleep(2000); // o código pode ter virado no meio do caminho: tenta mais uma vez com o novo
  }
  throw new Error("Código da verificação em duas etapas recusado. Confira a TOTP_CHAVE nas Propriedades do script.");
}

// Código de 6 dígitos (padrão TOTP, o mesmo do Google Authenticator): HMAC-SHA1 a cada 30 segundos
function gerarCodigoTotp(chave) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of String(chave).toUpperCase().replace(/[^A-Z2-7]/g, "")) bits += alfabeto.indexOf(ch).toString(2).padStart(5, "0");
  const chaveBytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) chaveBytes.push(paraByte(parseInt(bits.slice(i, i + 8), 2)));
  let contador = Math.floor(Date.now() / 30000);
  const mensagem = [];
  for (let i = 7; i >= 0; i--) { mensagem[i] = paraByte(contador % 256); contador = Math.floor(contador / 256); }
  const h = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, mensagem, chaveBytes).map(function (b) { return b & 255; });
  const o = h[19] & 15;
  const numero = ((h[o] & 127) * 16777216) + (h[o + 1] * 65536) + (h[o + 2] * 256) + h[o + 3];
  return String(numero % 1000000).padStart(6, "0");
}

function paraByte(n) { return n > 127 ? n - 256 : n; }

function sair(sessao) {
  try {
    UrlFetchApp.fetch(SUPABASE_URL + "/auth/v1/logout", {
      method: "post", muteHttpExceptions: true,
      headers: { apikey: SUPABASE_CHAVE_PUBLICA, Authorization: "Bearer " + sessao.token }
    });
  } catch (e) { /* sair é só limpeza */ }
}

function cabecalhos(sessao) {
  return { apikey: SUPABASE_CHAVE_PUBLICA, Authorization: "Bearer " + sessao.token };
}

// Lê a tabela inteira em páginas de 1000 (limite do Supabase por pedido)
function lerTabela(sessao, t) {
  const docs = [];
  for (let inicio = 0; ; inicio += 1000) {
    const url = SUPABASE_URL + "/rest/v1/" + t.tabela + "?select=*&order=" + t.ordem + ".asc&limit=1000&offset=" + inicio;
    const r = UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true, headers: cabecalhos(sessao) });
    if (r.getResponseCode() !== 200) throw new Error("Não consegui ler " + t.tabela + " (código " + r.getResponseCode() + ").");
    const linhas = JSON.parse(r.getContentText());
    for (const linha of linhas) {
      const doc = { id: t.chave ? linha[t.chave] : "geral" };
      for (const coluna in t.campos) if (coluna in linha) doc[t.campos[coluna]] = linha[coluna];
      docs.push(doc);
    }
    if (linhas.length < 1000) break;
  }
  return docs;
}

function conferirLancamentos(lancs) {
  const ids = {};
  for (const l of lancs) {
    if (ids[l.id]) throw new Error("Lançamento repetido no banco: " + l.id);
    ids[l.id] = true;
    if (!l.tipo || !l.descricao || typeof l.valorCentavos !== "number" || !l.data || !l.competencia || !l.categoriaId || !l.status) {
      throw new Error("Lançamento incompleto: " + l.id);
    }
  }
}

// Faz o app parar de mostrar o lembrete "backup deste mês ainda não foi baixado"
function marcarUltimoBackup(sessao, quando) {
  const r = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/config?user_id=eq." + sessao.uid, {
    method: "patch", contentType: "application/json", muteHttpExceptions: true,
    headers: Object.assign(cabecalhos(sessao), { Prefer: "return=minimal" }),
    payload: JSON.stringify({ ultimo_backup_baixado: quando })
  });
  if (r.getResponseCode() >= 300) Logger.log("Aviso: não consegui marcar a data do backup no app (código " + r.getResponseCode() + ").");
}

/** Rode uma vez: cria os agendamentos (toda segunda e quinta-feira, entre 8h e 9h de Brasília) e apaga os anteriores. Rodar de novo não duplica. */
function instalarAgendamento() {
  for (const g of ScriptApp.getProjectTriggers()) {
    if (["backupMensal", "backupSemanal"].indexOf(g.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(g);
  }
  ScriptApp.newTrigger("backupSemanal").timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).inTimezone(FUSO).create();
  ScriptApp.newTrigger("backupSemanal").timeBased().onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(8).inTimezone(FUSO).create();
  Logger.log("Agendamentos criados: toda segunda-feira e toda quinta-feira, entre 8h e 9h (horário de Brasília).");
}
