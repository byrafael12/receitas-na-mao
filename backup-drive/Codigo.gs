/* =====================================================================
   Receitas na mão · Backup automático no Google Drive (Apps Script)

   O que faz, toda segunda e quinta entre 8h e 9h:
     1. Chama a função backup_receitas do Supabase (só leitura). Isso
        também conta como atividade e impede a pausa do projeto.
     2. Grava backup-receitas-AAAA-MM-DD.json na pasta do Drive.
     3. Rodízio: guarda os 8 backups mais recentes e o primeiro de cada
        mês dos últimos 24 meses; o resto vai para a lixeira do Drive.
     4. E-mail de OK só no primeiro backup de cada mês; falha sempre avisa.

   Propriedades do script (Configurações do projeto > Propriedades do script):
     SUPABASE_URL      https://dmvjlirobozpmkusnnez.supabase.co
     CHAVE_PUBLICA     sb_publishable_... (a mesma do app, pública)
     PASTA_ID          ID da pasta Backups > Receitas na mão no Drive
     CHAVE_BACKUP      criada pela função configurarChave (NUNCA copiar
                       para o GitHub nem para conversas)

   Funções para rodar à mão (menu de seleção + botão Executar):
     configurarChave      1x: cria a chave e mostra o SQL do hash
     testarAgora          faz um backup e manda e-mail com o resultado
     instalarAgendamento  1x: cria os acionadores de segunda e quinta
   ===================================================================== */

const PREFIXO = 'backup-receitas-';
const RECENTES_MANTIDOS = 8;
const MESES_MANTIDOS = 24;

function props_() {
  const p = PropertiesService.getScriptProperties();
  const valores = {
    url: p.getProperty('SUPABASE_URL'),
    chavePublica: p.getProperty('CHAVE_PUBLICA'),
    pastaId: p.getProperty('PASTA_ID'),
    chaveBackup: p.getProperty('CHAVE_BACKUP')
  };
  for (const [nome, valor] of Object.entries(valores)) {
    if (!valor) throw new Error('Propriedade do script faltando: ' + nome);
  }
  return valores;
}

/** Cria a chave de backup (64 caracteres aleatórios) e mostra o SQL
 *  com o HASH dela para rodar no SQL Editor. A chave em si não aparece. */
function configurarChave() {
  const p = PropertiesService.getScriptProperties();
  const chave = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  p.setProperty('CHAVE_BACKUP', chave);
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, chave, Utilities.Charset.UTF_8);
  const hash = bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  Logger.log('Chave criada e guardada nas Propriedades do script.');
  Logger.log('Cole e rode no SQL Editor do Supabase:');
  Logger.log("insert into privado.chave_backup (id, hash) values (1, '" + hash + "') " +
             "on conflict (id) do update set hash = excluded.hash, criada_em = now();");
}

function buscarDados_(c) {
  const resposta = UrlFetchApp.fetch(c.url + '/rest/v1/rpc/backup_receitas', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: c.chavePublica },
    payload: JSON.stringify({ chave: c.chaveBackup }),
    muteHttpExceptions: true
  });
  const codigo = resposta.getResponseCode();
  const texto = resposta.getContentText();
  if (codigo !== 200) throw new Error('Supabase respondeu ' + codigo + ': ' + texto.slice(0, 300));
  const dados = JSON.parse(texto);
  if (!dados || dados.app !== 'receitas-na-mao' || !Array.isArray(dados.receitas)) {
    throw new Error('Resposta do Supabase em formato inesperado');
  }
  return { dados: dados, texto: texto };
}

function dataHoje_() {
  return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
}

/** Faz o backup. Devolve um resumo em texto. */
function executarBackup_() {
  const c = props_();
  const r = buscarDados_(c);
  const pasta = DriveApp.getFolderById(c.pastaId);
  const nome = PREFIXO + dataHoje_() + '.json';

  // Se já existe backup com o mesmo nome hoje, substitui.
  const iguais = pasta.getFilesByName(nome);
  while (iguais.hasNext()) iguais.next().setTrashed(true);

  const arquivo = pasta.createFile(nome, r.texto, MimeType.PLAIN_TEXT);
  const tamanho = arquivo.getSize();
  if (tamanho !== Utilities.newBlob(r.texto).getBytes().length) {
    throw new Error('Tamanho do arquivo gravado não confere');
  }
  const removidos = aplicarRodizio_(pasta);
  return {
    nome: nome,
    resumo: nome + ': ' + r.dados.receitas.length + ' receitas, ' +
      r.dados.ingredientes.length + ' ingredientes, ' + r.dados.passos.length + ' passos, ' +
      tamanho + ' bytes. Arquivos antigos para a lixeira: ' + removidos + '.',
    pasta: pasta
  };
}

/** Rodízio: mantém os 8 mais recentes e o primeiro de cada mês (24 meses). */
function aplicarRodizio_(pasta) {
  const arquivos = [];
  const it = pasta.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const m = f.getName().match(/^backup-receitas-(\d{4})-(\d{2})-(\d{2})\.json$/);
    if (m) arquivos.push({ f: f, data: m[1] + m[2] + m[3], mes: m[1] + m[2] });
  }
  arquivos.sort((a, b) => b.data.localeCompare(a.data)); // mais novo primeiro
  const manter = new Set(arquivos.slice(0, RECENTES_MANTIDOS).map(a => a.f.getId()));
  const primeiroDoMes = {};
  for (const a of arquivos) primeiroDoMes[a.mes] = a; // fica o mais antigo de cada mês
  const meses = Object.keys(primeiroDoMes).sort().reverse().slice(0, MESES_MANTIDOS);
  for (const mes of meses) manter.add(primeiroDoMes[mes].f.getId());
  let removidos = 0;
  for (const a of arquivos) {
    if (!manter.has(a.f.getId())) { a.f.setTrashed(true); removidos++; }
  }
  return removidos;
}

function primeiroDoMes_(pasta, nomeAtual) {
  const mes = nomeAtual.slice(PREFIXO.length, PREFIXO.length + 7); // AAAA-MM
  const it = pasta.getFiles();
  while (it.hasNext()) {
    const n = it.next().getName();
    if (n !== nomeAtual && n.indexOf(PREFIXO + mes) === 0) return false;
  }
  return true;
}

/** Chamada pelos acionadores de segunda e quinta. */
function backupAgendado() {
  try {
    const r = executarBackup_();
    if (primeiroDoMes_(r.pasta, r.nome)) {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
        'Receitas na mão: backup do mês OK', r.resumo);
    }
  } catch (e) {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
      'Receitas na mão: backup FALHOU', 'Erro: ' + e.message + '\n\nAbra o Apps Script "Backup Receitas na mão" e rode testarAgora.');
    throw e;
  }
}

/** Teste manual: faz o backup e sempre manda e-mail com o resultado. */
function testarAgora() {
  try {
    const r = executarBackup_();
    Logger.log(r.resumo);
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Receitas na mão: teste de backup OK', r.resumo);
  } catch (e) {
    Logger.log('FALHOU: ' + e.message);
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Receitas na mão: teste de backup FALHOU', 'Erro: ' + e.message);
    throw e;
  }
}

/** Cria os acionadores de segunda e quinta, 8h a 9h. Pode rodar de novo
 *  sem duplicar: apaga os antigos antes. */
function instalarAgendamento() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'backupAgendado') ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger('backupAgendado').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  ScriptApp.newTrigger('backupAgendado').timeBased().onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(8).create();
  Logger.log('Acionadores: ' + ScriptApp.getProjectTriggers().length + ' (devem ser 2: segunda e quinta, 8h a 9h).');
}
