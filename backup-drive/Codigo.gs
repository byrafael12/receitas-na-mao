/* =====================================================================
   Receitas na mão · Backup automático no Google Drive (Apps Script)

   O que faz, toda segunda e quinta entre 8h e 9h:
     1. Chama a função backup_receitas do Supabase (só leitura). Isso
        também conta como atividade e impede a pausa do projeto.
     2. Grava backup-receitas-AAAA-MM-DD.json na pasta do Drive.
     3. Rodízio: guarda os 8 backups mais recentes e o primeiro de cada
        mês dos últimos 24 meses; o resto vai para a lixeira do Drive.
     4. Versão 21: copia para a subpasta "fotos" só as fotos novas
        (capas e passos), pela Edge Function fotos-backup. Fotos já
        copiadas não são baixadas de novo e nunca são apagadas daqui.
     5. E-mail de OK só no primeiro backup de cada mês; falha sempre avisa
        (inclusive se o JSON foi salvo mas as fotos falharam).

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
     montarRestauracaoComFotos  só se precisar restaurar: junta o backup
                          mais recente com as fotos da subpasta "fotos" em
                          arquivos que o app aceita (Ajustes > Restaurar),
                          na subpasta "restauracao"
   ===================================================================== */

const PREFIXO = 'backup-receitas-';
const RECENTES_MANTIDOS = 8;
const MESES_MANTIDOS = 24;
const PASTA_FOTOS = 'fotos';
const PASTA_RESTAURACAO = 'restauracao';
const FOTOS_POR_PEDIDO = 25;
const FOTO_MAX_BYTES = 300 * 1024;          // fotos do app têm até 150 KB
const TEMPO_MAX_FOTOS_MS = 4 * 60 * 1000;   // Apps Script para em 6 min; o resto fica para a próxima
const PARTE_MAX_BYTES = 20 * 1024 * 1024;   // cada arquivo de restauração (o app aceita até 60 MB)

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
  let fotos, erroFotos = null;
  try { fotos = copiarFotosNovas_(c, r.dados, pasta); }
  catch (e) { erroFotos = e.message; }
  return {
    nome: nome,
    resumo: nome + ': ' + r.dados.receitas.length + ' receitas, ' +
      r.dados.ingredientes.length + ' ingredientes, ' + r.dados.passos.length + ' passos, ' +
      tamanho + ' bytes. Arquivos antigos para a lixeira: ' + removidos + '.\n' +
      (erroFotos ? 'FOTOS FALHARAM: ' + erroFotos
        : 'Fotos: ' + fotos.emUso + ' em uso, ' + fotos.copiadas + ' copiadas agora, ' +
          fotos.pendentes + ' para a próxima rodada, ' + fotos.falhas.length + ' com falha' +
          (fotos.falhas.length ? ' (' + fotos.falhas.slice(0, 5).join('; ') + ')' : '') + '.'),
    erroFotos: erroFotos || (fotos.falhas.length ? fotos.falhas.length + ' foto(s) com falha' : null),
    pasta: pasta
  };
}

// ---------------------------------------------------------------------
// Fotos (versão 21)
// ---------------------------------------------------------------------

/** Nome do arquivo no Drive = caminho no Supabase codificado (reversível). */
function nomeDaFoto_(caminho) { return encodeURIComponent(caminho); }
function caminhoDaFoto_(nome) { try { return decodeURIComponent(nome); } catch (e) { return null; } }

function subpasta_(pasta, nome) {
  const it = pasta.getFoldersByName(nome);
  return it.hasNext() ? it.next() : pasta.createFolder(nome);
}

/** Caminhos das fotos em uso, tirados do próprio backup (capas e passos). */
function caminhosDasFotos_(dados) {
  const s = {};
  for (const r of dados.receitas || []) if (r && r.imagem_caminho) s[r.imagem_caminho] = true;
  for (const p of dados.passos || []) if (p && p.imagem_caminho) s[p.imagem_caminho] = true;
  return Object.keys(s).sort();
}

function fotosNoDrive_(pastaFotos) {
  const ja = {};
  const it = pastaFotos.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const caminho = caminhoDaFoto_(f.getName());
    if (caminho) ja[caminho] = f;
  }
  return ja;
}

function pedirLinks_(c, caminhos) {
  const resposta = UrlFetchApp.fetch(c.url + '/functions/v1/fotos-backup', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: c.chavePublica },
    payload: JSON.stringify({ chave: c.chaveBackup, caminhos: caminhos }),
    muteHttpExceptions: true
  });
  const codigo = resposta.getResponseCode();
  if (codigo !== 200) {
    throw new Error('fotos-backup respondeu ' + codigo + ': ' + resposta.getContentText().slice(0, 200) +
      (codigo === 401 ? ' (desligue o Verify JWT da função fotos-backup)' : '') +
      (codigo === 404 ? ' (a função fotos-backup foi publicada?)' : ''));
  }
  const dados = JSON.parse(resposta.getContentText());
  return dados && dados.links ? dados.links : {};
}

/** Copia para a subpasta "fotos" só as fotos que ainda não estão lá. */
function copiarFotosNovas_(c, dados, pasta) {
  const inicio = Date.now();
  const pastaFotos = subpasta_(pasta, PASTA_FOTOS);
  const emUso = caminhosDasFotos_(dados);
  const ja = fotosNoDrive_(pastaFotos);
  const faltam = emUso.filter(x => !ja[x]);
  let copiadas = 0;
  const falhas = [];
  let i = 0;
  for (; i < faltam.length; i += FOTOS_POR_PEDIDO) {
    if (Date.now() - inicio > TEMPO_MAX_FOTOS_MS) break;
    const lote = faltam.slice(i, i + FOTOS_POR_PEDIDO);
    const links = pedirLinks_(c, lote);
    const comLink = lote.filter(x => links[x]);
    for (const x of lote) if (!links[x]) falhas.push(x + ': sem link');
    const respostas = UrlFetchApp.fetchAll(comLink.map(x => ({ url: links[x], muteHttpExceptions: true })));
    respostas.forEach((resp, k) => {
      const caminho = comLink[k];
      const blob = resp.getBlob();
      const tipo = String(blob.getContentType() || '').split(';')[0].trim();
      const bytes = blob.getBytes().length;
      if (resp.getResponseCode() !== 200) { falhas.push(caminho + ': HTTP ' + resp.getResponseCode()); return; }
      if (tipo !== 'image/jpeg' && tipo !== 'image/webp') { falhas.push(caminho + ': tipo ' + tipo); return; }
      if (!bytes || bytes > FOTO_MAX_BYTES) { falhas.push(caminho + ': tamanho ' + bytes); return; }
      pastaFotos.createFile(blob.setName(nomeDaFoto_(caminho)));
      copiadas++;
    });
  }
  return { emUso: emUso.length, copiadas: copiadas, pendentes: Math.max(0, faltam.length - i), falhas: falhas };
}

// ---------------------------------------------------------------------
// Restauração com fotos (só quando precisar)
// ---------------------------------------------------------------------

/** Junta o backup mais recente com as fotos do Drive, em partes que o
 *  app aceita em Ajustes > Restaurar. Cada parte leva um grupo de
 *  receitas com tudo delas (ingredientes, passos, etiquetas e fotos).
 *  Restaure as partes uma de cada vez, em qualquer ordem. */
function montarRestauracaoComFotos() {
  const c = props_();
  const pasta = DriveApp.getFolderById(c.pastaId);
  const ultimo = ultimoBackup_(pasta);
  if (!ultimo) throw new Error('Nenhum backup-receitas-*.json na pasta.');
  const dados = JSON.parse(ultimo.getBlob().getDataAsString('UTF-8'));
  const ja = fotosNoDrive_(subpasta_(pasta, PASTA_FOTOS));
  const destino = subpasta_(pasta, PASTA_RESTAURACAO);
  const partes = dividirEmPartes_(dados, ja);
  const data = ultimo.getName().slice(PREFIXO.length, PREFIXO.length + 10);
  const nomes = [];
  let semFoto = 0;
  partes.forEach((parte, k) => {
    semFoto += parte.semFoto;
    const nome = 'restaurar-com-fotos-' + data + '-parte-' + (k + 1) + '-de-' + partes.length + '.json';
    const iguais = destino.getFilesByName(nome);
    while (iguais.hasNext()) iguais.next().setTrashed(true);
    destino.createFile(nome, JSON.stringify(parte.dados), MimeType.PLAIN_TEXT);
    nomes.push(nome + ' (' + parte.dados.receitas.length + ' receitas, ' + Object.keys(parte.dados.fotos).length + ' fotos)');
  });
  const resumo = 'Base: ' + ultimo.getName() + '\nPasta: ' + PASTA_RESTAURACAO + '\n' + nomes.join('\n') +
    (semFoto ? '\nFotos que ainda não estavam no Drive: ' + semFoto + ' (essas receitas voltam sem a foto, se a original não existir mais).' : '');
  Logger.log(resumo);
  return resumo;
}

function ultimoBackup_(pasta) {
  let melhor = null, melhorData = '';
  const it = pasta.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const m = f.getName().match(/^backup-receitas-(\d{4}-\d{2}-\d{2})\.json$/);
    if (m && m[1] > melhorData) { melhor = f; melhorData = m[1]; }
  }
  return melhor;
}

function fotoComoDataUrl_(arquivo) {
  const blob = arquivo.getBlob();
  const tipo = String(blob.getContentType() || '').split(';')[0].trim() === 'image/webp' ? 'image/webp' : 'image/jpeg';
  return 'data:' + tipo + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/** Divide as receitas em grupos de até PARTE_MAX_BYTES (estimativa). */
function dividirEmPartes_(dados, fotosDrive) {
  const porReceita = k => (dados[k] || []).reduce((m, x) => { (m[x.receita_id] = m[x.receita_id] || []).push(x); return m; }, {});
  const ingredientes = porReceita('ingredientes'), passos = porReceita('passos'), rotulos = porReceita('receita_etiquetas');
  const base = () => ({
    app: 'receitas-na-mao', versao_backup: 1, origem: 'drive-com-fotos', gerado_em: dados.gerado_em,
    categorias: dados.categorias || [], etiquetas: dados.etiquetas || [],
    receitas: [], ingredientes: [], passos: [], receita_etiquetas: [], fotos: {}
  });
  const partes = [];
  let atual = { dados: base(), bytes: 0, semFoto: 0 };
  for (const r of dados.receitas || []) {
    const ps = passos[r.id] || [];
    const caminhos = [r.imagem_caminho].concat(ps.map(p => p.imagem_caminho)).filter(Boolean);
    const fotos = {}; let semFoto = 0;
    for (const x of caminhos) {
      if (fotosDrive[x]) fotos[x] = fotoComoDataUrl_(fotosDrive[x]); else semFoto++;
    }
    const bloco = { r: r, i: ingredientes[r.id] || [], p: ps, e: rotulos[r.id] || [], f: fotos };
    const bytes = JSON.stringify(bloco).length;
    if (atual.dados.receitas.length && atual.bytes + bytes > PARTE_MAX_BYTES) {
      partes.push(atual); atual = { dados: base(), bytes: 0, semFoto: 0 };
    }
    const d = atual.dados;
    d.receitas.push(r);
    Array.prototype.push.apply(d.ingredientes, bloco.i);
    Array.prototype.push.apply(d.passos, bloco.p);
    Array.prototype.push.apply(d.receita_etiquetas, bloco.e);
    Object.assign(d.fotos, fotos);
    atual.bytes += bytes; atual.semFoto += semFoto;
  }
  if (atual.dados.receitas.length || !partes.length) partes.push(atual);
  return partes;
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
    if (r.erroFotos) {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
        'Receitas na mão: backup salvo, FOTOS com problema', r.resumo +
        '\n\nO JSON das receitas foi salvo. Abra o Apps Script "Backup Receitas na mão" e rode testarAgora.');
    } else if (primeiroDoMes_(r.pasta, r.nome)) {
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
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
      'Receitas na mão: teste de backup ' + (r.erroFotos ? 'com problema nas FOTOS' : 'OK'), r.resumo);
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
