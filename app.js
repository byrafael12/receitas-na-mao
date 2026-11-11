/* =====================================================================
   Receitas na mão · app.js
   Login Google, cadastro manual e importação com IA (legenda, prints,
   vídeo e link), lista com busca, receita, edição e exclusão.
   Versão 10: cópia das receitas e fotos no aparelho (IndexedDB) e
   service worker, para ler sem internet.

   REGRA DE SEGURANÇA (XSS): todo texto de receita é colocado na tela
   com textContent (via a função el), NUNCA com innerHTML. Assim, se um
   texto tiver "<script>", ele aparece escrito, sem executar.
   ===================================================================== */

'use strict';

// Bloqueio de iframe: o app não pode ser exibido dentro de outro site.
if (window.top !== window.self) {
  document.documentElement.textContent = '';
  throw new Error('Exibição em iframe bloqueada');
}

// ---------------------------------------------------------------------
// Configuração (valores PÚBLICOS por definição; a chave secreta nunca
// entra no código).
// ---------------------------------------------------------------------
const VERSAO = '20';
const SUPABASE_URL = 'https://dmvjlirobozpmkusnnez.supabase.co';
const SUPABASE_CHAVE_PUBLICA = 'sb_publishable_MpRgJ6E0Ghhi-CcFsymGKA_l6IrlYa5';
const PASTA_IMAGENS = 'capas';
const LIMITE_IMAGEM = 150 * 1024; // 150 KB
const LIMITE_FOTO_PASSO = 80 * 1024; // 80 KB (versão 17: foto de cada passo, menor que a capa)
const MAX_FOTOS_PASSOS = 30;
const CATEGORIAS_INICIAIS = ['Massas', 'Carne de rês', 'Frango', 'Frutos do mar', 'Japonês e Chinês', 'Salgados',
  'Lanches', 'Sobremesas', 'Molhos', 'Acompanhamentos', 'Bebidas e Drinks', 'Outras'];

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_CHAVE_PUBLICA, {
  auth: {
    persistSession: true,      // mantém o login entre aberturas do app
    autoRefreshToken: true,    // renova o crachá (token) sozinho
    detectSessionInUrl: true,  // lê o retorno do login Google
    // Versão 15 (segurança, achado S1): PKCE. O Google devolve só um código
    // de uso único (?code=...), trocado pela sessão com um segredo guardado
    // neste aparelho; o crachá de acesso não passa mais pelo endereço nem
    // fica no histórico. Para voltar ao modo antigo: flowType: 'implicit'.
    flowType: 'pkce'
  }
});

const estado = {
  usuario: null,
  categorias: [],
  etiquetas: [],
  urlsAssinadas: new Map(), // caminho da imagem -> { url, expira }
  importacao: null,         // receitas lidas pela IA aguardando revisão
  busca: '',                // texto da busca da tela inicial (mantido ao voltar)
  colecao: null,            // cópia de todas as receitas (também guardada no aparelho)
  semConexao: false,        // true = mostrando a cópia, sem falar com o Supabase
  semSessao: false,         // true = sessão vencida; mostra a cópia e pede login
  titular: true,            // false = conta só de leitura (amigos e família, script 09)
  urlsLocais: new Map(),    // caminho da imagem -> endereço blob: da foto guardada
  rolagem: {},              // versão 18/19: posição de cada lista (tela inicial e cada categoria), para voltar ao mesmo lugar
  ultimaLista: '#/',        // versão 19: para onde "← Voltar" da receita leva
  buscaLista: null,         // versão 19: { chave, texto } da busca da tela aberta
  formulario: null          // versão 18: formulário aberto { sujo, ehRevisao, guardar, hash }
};

const app = document.getElementById('app');
const topo = document.getElementById('topo');

// ---------------------------------------------------------------------
// Utilidades de tela
// ---------------------------------------------------------------------

/** Cria um elemento com segurança. Texto entra sempre como texto puro. */
function el(tag, props, ...filhos) {
  const n = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props || {})) {
    if (valor === undefined || valor === null || valor === false) continue;
    if (chave === 'class') n.className = valor;
    else if (chave === 'text') n.textContent = valor;
    else if (chave.startsWith('on')) n.addEventListener(chave.slice(2), valor);
    else if (chave === 'value') n.value = valor;
    else if (chave === 'href') n.setAttribute('href', linkSeguro(valor) || '#');
    else n.setAttribute(chave, valor === true ? '' : String(valor));
  }
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false) continue;
    n.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return n;
}

/** Aceita só links internos (#/...) ou http/https. Bloqueia javascript: e afins. */
function linkSeguro(url) {
  const texto = String(url || '').trim();
  if (texto.startsWith('#/')) return texto;
  try {
    const u = new URL(texto);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
  } catch { return null; }
}

// Versão 18: a posição da lista é guardada enquanto ela está na tela e
// devolvida ao voltar de uma receita (o navegador não cuida disso sozinho,
// porque as telas são trocadas pelo próprio app).
let listaNaTela = false;
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.addEventListener('scroll', () => { if (listaNaTela) estado.rolagem[listaNaTela] = window.scrollY; }, { passive: true });

function mostrar(...filhos) {
  listaNaTela = false;
  estado.formulario = null; // saiu do formulário (ver "Trabalho não salvo")
  app.replaceChildren(...filhos.filter(f => f !== null && f !== undefined && f !== false));
  window.scrollTo(0, 0);
}

function mensagem(texto, classe = 'aviso') {
  mostrar(el('p', { class: classe, text: texto }));
}

function formatarNumero(n) {
  if (n === null || n === undefined || n === '') return '';
  return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

/** Quantidade em linguagem de cozinha: 0,5 vira "1/2", 1,5 vira "1 1/2",
 *  0,333 vira "1/3". Valores que não são frações comuns ficam com vírgula. */
const FRACOES = [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 8], [3, 8], [5, 8], [7, 8]];
function formatarQuantidade(n) {
  if (n === null || n === undefined || n === '') return '';
  const v = Number(n);
  const inteiro = Math.floor(v + 1e-9), resto = v - inteiro;
  if (resto < 0.01) return String(inteiro);
  const f = FRACOES.find(([a, b]) => Math.abs(resto - a / b) < 0.01);
  if (!f) return formatarNumero(v);
  return (inteiro ? `${inteiro} ` : '') + `${f[0]}/${f[1]}`;
}

/** Quantidade recalculada (porções): arredonda para medida de cozinha.
 *  10 ou mais vira número inteiro (333,3 g -> 333); abaixo disso, a fração
 *  comum mais próxima (1/2, 1/3, 1/4, 1/8; erro até 6%), ou uma casa decimal. */
function formatarEscalada(n) {
  if (n === null || n === undefined) return '';
  const v = Number(n);
  if (v >= 10) return formatarNumero(Math.round(v));
  let melhor = null;
  for (const d of [1, 2, 3, 4, 8]) { // metades, terços, quartos e oitavos
    const c = Math.round(v * d) / d;
    const erro = c > 0 ? Math.abs(c - v) / v : 1;
    if (erro <= 0.06 && (!melhor || erro < melhor.erro - 1e-9)) melhor = { c, erro };
  }
  if (melhor) return formatarQuantidade(melhor.c);
  return formatarNumero(Math.round(v * 10) / 10);
}

const FRACOES_UNICODE = { '½': ' 1/2', '⅓': ' 1/3', '⅔': ' 2/3', '¼': ' 1/4', '¾': ' 3/4', '⅛': ' 1/8', '⅜': ' 3/8', '⅝': ' 5/8', '⅞': ' 7/8' };

/** Converte "1/2", "1 1/2", "1 e 1/2", "½", "0,5" ou "2" em número. Vazio vira null. */
function lerQuantidade(texto) {
  const t = String(texto || '').replace(/[½⅓⅔¼¾⅛⅜⅝⅞]/g, c => FRACOES_UNICODE[c])
    .replace(/\s+e\s+/i, ' ').trim().replace(',', '.');
  if (!t) return null;
  const misto = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (misto) return Number(misto[1]) + Number(misto[2]) / Number(misto[3]);
  const fracao = t.match(/^(\d+)\/(\d+)$/);
  if (fracao) return Number(fracao[1]) / Number(fracao[2]);
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

function lerInteiro(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

function minutosTexto(min) {
  if (min === null || min === undefined) return null;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function erroAmigavel(e) {
  const t = (e && (e.message || e.error_description)) || String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(t)) return 'Sem conexão com a internet. Tente de novo.';
  if (/JWT|session|sessão/i.test(t)) return 'Sua sessão expirou. Entre de novo.';
  return t;
}

// ---------------------------------------------------------------------
// Imagens: compressão no aparelho e links temporários (assinados)
// ---------------------------------------------------------------------

async function carregarImagem(arquivo) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(arquivo); } catch { /* tenta o outro jeito */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui abrir a imagem')); };
    img.src = url;
  });
}

/** Reduz a foto até caber no limite (JPEG): capa até 150 KB; foto de passo até 80 KB. */
async function comprimirImagem(arquivo, limite = LIMITE_IMAGEM, ladoInicial = 1280) {
  const img = await carregarImagem(arquivo);
  const larguraOriginal = img.width, alturaOriginal = img.height;
  let lado = ladoInicial, qualidade = 0.82;
  const canvas = document.createElement('canvas');
  for (let tentativa = 0; tentativa < 15; tentativa++) {
    const escala = Math.min(1, lado / Math.max(larguraOriginal, alturaOriginal));
    canvas.width = Math.round(larguraOriginal * escala);
    canvas.height = Math.round(alturaOriginal * escala);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', qualidade));
    if (blob && blob.size <= limite) return blob;
    if (qualidade > 0.6) qualidade -= 0.08;
    else lado = Math.round(lado * 0.85);
  }
  throw new Error(`Não consegui reduzir a imagem para ${Math.round(limite / 1024)} KB.`);
}

/** Gera links temporários (1 hora) para imagens da pasta privada. */
async function urlsDasImagens(caminhos) {
  // 1º: fotos guardadas no aparelho (funcionam sem internet e não gastam tráfego)
  const mapaLocal = {};
  for (const c of new Set(caminhos.filter(Boolean))) {
    if (!estado.urlsLocais.has(c)) {
      const blob = await lerLocal('capas', c);
      if (blob) estado.urlsLocais.set(c, URL.createObjectURL(blob));
    }
    if (estado.urlsLocais.has(c)) mapaLocal[c] = estado.urlsLocais.get(c);
  }
  caminhos = caminhos.filter(c => c && !mapaLocal[c]);
  if (!caminhos.length || estado.semConexao) return mapaLocal;
  const agora = Date.now();
  const faltam = [...new Set(caminhos.filter(Boolean))]
    .filter(c => !(estado.urlsAssinadas.get(c)?.expira > agora + 60000));
  if (faltam.length) {
    const { data, error } = await sb.storage.from(PASTA_IMAGENS).createSignedUrls(faltam, 3600);
    if (!error) {
      for (const item of data || []) {
        if (item.signedUrl) estado.urlsAssinadas.set(item.path, { url: item.signedUrl, expira: agora + 3600000 });
      }
    }
  }
  const mapa = { ...mapaLocal };
  for (const c of caminhos) if (c && estado.urlsAssinadas.has(c)) mapa[c] = estado.urlsAssinadas.get(c).url;
  return mapa;
}

function elementoCapa(url, texto) {
  if (url) return el('img', { class: 'capa', src: url, alt: texto || '', loading: 'lazy' });
  return el('div', { class: 'capa capa-vazia', 'aria-hidden': 'true', text: '🍽' });
}

// ---------------------------------------------------------------------
// Cópia no aparelho (versão 10): IndexedDB, o banco do próprio navegador.
// "dados" guarda a coleção inteira (receitas, ingredientes, passos,
// categorias, etiquetas); "capas" guarda as fotos. Se o navegador não
// permitir, o app segue funcionando só com internet.
// ---------------------------------------------------------------------
let bancoLocal = null;
function abrirBancoLocal() {
  if (!bancoLocal) {
    bancoLocal = new Promise((ok, falha) => {
      if (!('indexedDB' in window)) return falha(new Error('Sem IndexedDB'));
      const pedido = indexedDB.open('receitas-na-mao', 1);
      pedido.onupgradeneeded = () => {
        pedido.result.createObjectStore('dados');
        pedido.result.createObjectStore('capas');
      };
      pedido.onsuccess = () => ok(pedido.result);
      pedido.onerror = () => falha(pedido.error);
    }).catch(e => { bancoLocal = null; throw e; });
  }
  return bancoLocal;
}
async function operacaoLocal(loja, modo, acao) {
  try {
    const db = await abrirBancoLocal();
    return await new Promise((ok, falha) => {
      const t = db.transaction(loja, modo);
      const pedido = acao(t.objectStore(loja));
      t.oncomplete = () => ok(pedido?.result);
      t.onerror = () => falha(t.error);
      t.onabort = () => falha(t.error);
    });
  } catch {
    return undefined; // sem cópia local: o app continua só com internet
  }
}
const lerLocal = (loja, chave) => operacaoLocal(loja, 'readonly', l => l.get(chave));
const gravarLocal = (loja, chave, valor) => operacaoLocal(loja, 'readwrite', l => l.put(valor, chave));
const apagarLocal = (loja, chave) => operacaoLocal(loja, 'readwrite', l => l.delete(chave));
const chavesLocal = async (loja) => (await operacaoLocal(loja, 'readonly', l => l.getAllKeys())) || [];
async function limparCopiaLocal() {
  await operacaoLocal('dados', 'readwrite', l => l.clear());
  await operacaoLocal('capas', 'readwrite', l => l.clear());
  for (const u of estado.urlsLocais.values()) URL.revokeObjectURL(u);
  estado.urlsLocais.clear();
  estado.colecao = null;
}

/** Lê todas as linhas de uma tabela em blocos de 1.000 (o Supabase devolve no máximo 1.000 por consulta). */
async function lerTabelaInteira(tabela, campos, ordens = ['id']) {
  const BLOCO = 1000, todas = [];
  for (let de = 0; ; de += BLOCO) {
    let consulta = sb.from(tabela).select(campos);
    for (const o of ordens) consulta = consulta.order(o);
    const { data, error } = await consulta.range(de, de + BLOCO - 1);
    if (error) throw error;
    todas.push(...data);
    if (data.length < BLOCO) return todas;
  }
}

/** Usa a coleção (categorias e etiquetas) nas telas. */
function aplicarColecao(c) {
  estado.colecao = c;
  estado.categorias = ordenarCategorias(c.categorias);
  estado.etiquetas = c.etiquetas;
}

/** Baixa tudo do Supabase, guarda no aparelho e depois baixa as fotos que faltam. */
let pedidoColecao = 0;         // só a leitura mais nova é aplicada (evita cópia velha por cima da nova)
let ultimaSincronizacao = 0;   // hora da última leitura completa com sucesso
async function atualizarColecao() {
  const meuPedido = ++pedidoColecao;
  const [receitas, ingredientes, passos, categorias, etiquetas, receitaEtiquetas] = await Promise.all([
    lerTabelaInteira('receitas', '*'),
    lerTabelaInteira('ingredientes', '*'),
    lerTabelaInteira('passos', '*'),
    lerTabelaInteira('categorias', 'id, nome, ordem, ativa'),
    lerTabelaInteira('etiquetas', 'id, nome'),
    lerTabelaInteira('receita_etiquetas', 'receita_id, etiqueta_id', ['receita_id', 'etiqueta_id'])
  ]);
  receitas.sort((a, b) => String(b.atualizada_em || '').localeCompare(String(a.atualizada_em || '')));
  const porOrdem = (a, b) => String(a.receita_id).localeCompare(String(b.receita_id)) || a.ordem - b.ordem;
  const colecao = {
    usuario_id: estado.usuario.id, email: estado.usuario.email || '', salva_em: new Date().toISOString(), titular: estado.titular,
    receitas, ingredientes: ingredientes.sort(porOrdem), passos: passos.sort(porOrdem),
    categorias, etiquetas, receita_etiquetas: receitaEtiquetas
  };
  estado.semConexao = false;
  ultimaSincronizacao = Date.now();
  // Outra leitura começou depois desta (ex.: salvou uma receita no meio): a mais nova decide.
  if (meuPedido !== pedidoColecao) return estado.colecao || colecao;
  aplicarColecao(colecao);
  await gravarLocal('dados', 'colecao', colecao);
  baixarCapas(colecao); // em segundo plano
  mostrarFaixa();
  return colecao;
}

// ---------------------------------------------------------------------
// Versão 18: abrir pela cópia do aparelho e sincronizar por trás.
// Com a cópia guardada, a tela aparece na hora; a leitura do Supabase
// corre em segundo plano e só redesenha se algo mudou de verdade.
// ---------------------------------------------------------------------
function assinaturaDaColecao() {
  const c = estado.colecao;
  if (!c) return '';
  return JSON.stringify([estado.titular, c.receitas.map(r => [r.id, r.atualizada_em, r.favorita, r.categoria_id]),
    c.categorias.map(x => [x.id, x.nome, x.ativa]), c.ingredientes.length, c.passos.length, c.receita_etiquetas.length]);
}
function assinaturaDaReceita(id) {
  const c = estado.colecao;
  if (!c) return '';
  return JSON.stringify([c.receitas.find(r => r.id === id), c.ingredientes.filter(i => i.receita_id === id), c.passos.filter(p => p.receita_id === id),
    c.receita_etiquetas.filter(x => x.receita_id === id)]);
}
const ROTAS_DE_EDICAO = /^#\/(nova|manual|editar|revisar|categorias)/;

function mostrarSincronizando(ligado) {
  let aviso = document.getElementById('sincronizando');
  if (!ligado) { aviso?.remove(); return; }
  if (!aviso) topo.querySelector('.marca')?.after(el('span', { id: 'sincronizando', class: 'sincronizando', role: 'status', text: 'Atualizando…' }));
}

let sincronizando = null;
/** Lê papel (titular ou leitura) e a coleção sem travar a tela. "inicial": abertura do app. */
function sincronizarPorTras(inicial = false) {
  if (sincronizando) return sincronizando;
  const antes = assinaturaDaColecao();
  const idAberto = location.hash.startsWith('#/receita/') ? location.hash.split('/')[2] : null;
  const receitaAntes = idAberto ? assinaturaDaReceita(idAberto) : '';
  const titularAntes = estado.titular;
  const avisar = setTimeout(() => mostrarSincronizando(true), 1500);
  sincronizando = (async () => {
    try {
      await comLimite((async () => {
        const papel = await sb.rpc('eh_titular');
        if (papel.error && /Failed to fetch|NetworkError|Load failed/i.test(papel.error.message || '')) throw papel.error;
        if (!papel.error) estado.titular = papel.data !== false;
        if (!estado.colecao?.categorias?.length) await carregarCategorias(); // 1º acesso: cria as categorias
        await atualizarColecao();
      })(), 20000);
      mostrarFaixa();
      // Redesenha só o que mudou, e nunca por cima de um formulário.
      const rota = location.hash;
      if (estado.titular !== titularAntes) rotear();
      else if (ROTAS_DE_EDICAO.test(rota)) { /* não mexe */ }
      else if (rota.startsWith('#/receita/')) { if (idAberto && rota.split('/')[2] === idAberto && assinaturaDaReceita(idAberto) !== receitaAntes) rotear(); }
      else if (/^#(\/(categoria\/[\w-]+)?)?$/.test(rota) && assinaturaDaColecao() !== antes) rotear();
    } catch {
      // Abertura sem resposta, ou aparelho sem rede: segue com a cópia e avisa.
      if (inicial || !navigator.onLine) { estado.semConexao = true; mostrarFaixa(); }
    } finally {
      clearTimeout(avisar);
      mostrarSincronizando(false);
      sincronizando = null;
    }
  })();
  return sincronizando;
}

/** Voltou ao app (do segundo plano): busca novidades, no máximo a cada 5 minutos. */
function voltouAoApp() {
  if (document.visibilityState !== 'visible' || !estado.usuario || estado.semSessao || !estado.colecao) return;
  if (ROTAS_DE_EDICAO.test(location.hash)) return; // nunca durante edição, revisão ou importação
  if (estado.semConexao) { tentarReconectar(); return; }
  if (Date.now() - ultimaSincronizacao < 5 * 60 * 1000) return;
  sincronizarPorTras(false);
}
document.addEventListener('visibilitychange', voltouAoApp);
window.addEventListener('pageshow', (ev) => { if (ev.persisted) voltouAoApp(); });

/** Todas as fotos em uso: capas e fotos dos passos (versão 17). */
function caminhosDaColecao(c) {
  return new Set([...c.receitas.map(r => r.imagem_caminho), ...(c.passos || []).map(p => p.imagem_caminho)].filter(Boolean));
}

let baixandoCapas = null;
/** Guarda no aparelho as fotos que ainda não estão lá e apaga as que não são mais usadas. */
function baixarCapas(colecao) {
  if (baixandoCapas) return baixandoCapas;
  baixandoCapas = (async () => {
    const usadas = caminhosDaColecao(colecao);
    const guardadas = new Set(await chavesLocal('capas'));
    for (const c of guardadas) {
      if (!usadas.has(c)) {
        await apagarLocal('capas', c);
        if (estado.urlsLocais.has(c)) { URL.revokeObjectURL(estado.urlsLocais.get(c)); estado.urlsLocais.delete(c); }
      }
    }
    const faltam = [...usadas].filter(c => !guardadas.has(c));
    for (let i = 0; i < faltam.length; i += 4) {
      await Promise.all(faltam.slice(i, i + 4).map(async (c) => {
        try {
          const { data, error } = await sb.storage.from(PASTA_IMAGENS).download(c);
          if (!error && data) await gravarLocal('capas', c, data);
        } catch { /* tenta de novo na próxima abertura */ }
      }));
    }
  })().finally(() => { baixandoCapas = null; });
  return baixandoCapas;
}

/** Espera uma tarefa por no máximo "ms" milissegundos. */
function comLimite(promessa, ms) {
  return Promise.race([promessa, new Promise((_, falha) => setTimeout(() => falha(new Error('Sem conexão com a internet.')), ms))]);
}

function dataHoraCurta(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------

/** Ordem alfabética (sem ligar para acentos), com Outras sempre por último. */
function ordenarCategorias(lista) {
  return lista.slice().sort((a, b) =>
    (a.nome === 'Outras') - (b.nome === 'Outras') || a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
}

async function carregarCategorias() {
  let { data, error } = await sb.from('categorias').select('id, nome, ordem, ativa').order('ordem');
  if (error) throw error;
  if (!data.length && estado.titular) {
    // Primeiro acesso: cria a lista inicial de categorias.
    const linhas = CATEGORIAS_INICIAIS.map((nome, i) => ({ nome, ordem: i + 1 }));
    const r = await sb.from('categorias').insert(linhas).select('id, nome, ordem, ativa').order('ordem');
    if (r.error) throw r.error;
    data = r.data;
  }
  estado.categorias = ordenarCategorias(data);
}

async function carregarEtiquetas() {
  if (estado.colecao) { estado.etiquetas = estado.colecao.etiquetas; return; }
  const { data, error } = await sb.from('etiquetas').select('id, nome').order('nome');
  if (error) throw error;
  estado.etiquetas = data;
}

function nomeCategoria(id) {
  return estado.categorias.find(c => c.id === id)?.nome || null;
}

async function buscarReceitaCompleta(id) {
  if (estado.colecao) {
    let c = estado.colecao;
    let r = c.receitas.find(x => x.id === id);
    // Receita nova de outro aparelho: atualiza a cópia uma vez antes de desistir.
    if (!r && !estado.semConexao) { try { c = await atualizarColecao(); r = c.receitas.find(x => x.id === id); } catch { /* segue */ } }
    if (!r) return null;
    const nomeEtiqueta = new Map(c.etiquetas.map(e => [e.id, e.nome]));
    return {
      ...r,
      ingredientes: c.ingredientes.filter(i => i.receita_id === id).sort((a, b) => a.ordem - b.ordem),
      passos: c.passos.filter(p => p.receita_id === id).sort((a, b) => a.ordem - b.ordem),
      etiquetas: c.receita_etiquetas.filter(x => x.receita_id === id).map(x => nomeEtiqueta.get(x.etiqueta_id)).filter(Boolean)
    };
  }
  const [r, ing, pas, ret] = await Promise.all([
    sb.from('receitas').select('*').eq('id', id).maybeSingle(),
    sb.from('ingredientes').select('*').eq('receita_id', id).order('ordem'),
    sb.from('passos').select('*').eq('receita_id', id).order('ordem'),
    sb.from('receita_etiquetas').select('etiqueta_id').eq('receita_id', id)
  ]);
  for (const x of [r, ing, pas, ret]) if (x.error) throw x.error;
  if (!r.data) return null;
  await carregarEtiquetas();
  const nomes = ret.data.map(x => estado.etiquetas.find(e => e.id === x.etiqueta_id)?.nome).filter(Boolean);
  return { ...r.data, ingredientes: ing.data, passos: pas.data, etiquetas: nomes };
}

// ---------------------------------------------------------------------
// Telas
// ---------------------------------------------------------------------

function telaLogin(erro) {
  topo.hidden = true;
  mostrar(el('section', { class: 'login' },
    el('h1', { text: 'Receitas na mão' }),
    el('p', { text: 'Suas receitas, organizadas.' }),
    erro ? el('p', { class: 'erro', text: erro }) : null,
    el('button', {
      class: 'botao principal', type: 'button',
      onclick: async (ev) => {
        ev.currentTarget.disabled = true;
        const { error } = await sb.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: location.origin + location.pathname }
        });
        if (error) telaLogin(erroAmigavel(error));
      }
    }, 'Entrar com Google')
  ));
}

// Preferências deste aparelho (visão e categoria escolhidas). Se o
// navegador não deixar guardar, o app funciona igual, só não lembra.
function lerPreferencia(chave, padrao) {
  try { return localStorage.getItem('receitas.' + chave) || padrao; } catch { return padrao; }
}
function gravarPreferencia(chave, valor) {
  try { localStorage.setItem('receitas.' + chave, valor); } catch { /* sem armazenamento */ }
}

// ---------------------------------------------------------------------
// Favoritas (versão 13). Titular: gravada na receita (vale em todos os
// aparelhos). Conta só de leitura: guardada só neste aparelho.
// ---------------------------------------------------------------------
function chaveFavoritasLocais() { return `favoritas-${estado.usuario?.id || ''}`; }
function favoritasLocais() {
  try { return new Set(JSON.parse(localStorage.getItem(chaveFavoritasLocais()) || '[]')); } catch { return new Set(); }
}
function ehFavorita(r) {
  return estado.titular ? !!r.favorita : favoritasLocais().has(r.id);
}
/** Marca ou desmarca. Devolve o novo estado, ou null se não deu. */
async function alternarFavorita(r) {
  const nova = !ehFavorita(r);
  if (!estado.titular) {
    const f = favoritasLocais();
    if (nova) f.add(r.id); else f.delete(r.id);
    try { localStorage.setItem(chaveFavoritasLocais(), JSON.stringify([...f])); } catch { return null; }
    return nova;
  }
  if (estado.semConexao) { alert('Sem internet: para marcar favorita, conecte-se.'); return null; }
  const { error } = await sb.from('receitas').update({ favorita: nova }).eq('id', r.id);
  if (error) { alert(erroAmigavel(error)); return null; }
  r.favorita = nova;
  pedidoColecao++; // uma leitura que começou antes desta mudança não pode desfazê-la
  const naCopia = estado.colecao?.receitas.find(x => x.id === r.id);
  if (naCopia) { naCopia.favorita = nova; await gravarLocal('dados', 'colecao', estado.colecao); }
  return nova;
}

/** Texto sem acento e em minúsculas, para a busca ("Pão" vira "pao"). */
function normalizar(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// ---------------------------------------------------------------------
// Versão 19: tela inicial por categorias. Um quadro por categoria, com a
// foto da receita mais recente e a quantidade; "Todas" e "★ Favoritas"
// também viram quadros. Tocar abre a lista daquela categoria
// (#/categoria/<id>). A busca da tela inicial procura em todas.
// ---------------------------------------------------------------------
const FILTROS_ESPECIAIS = { todas: 'Todas', favoritas: '★ Favoritas', sem: 'Sem categoria' };
function nomeDoFiltro(filtro) {
  return FILTROS_ESPECIAIS[filtro] || nomeCategoria(filtro) || 'Categoria';
}
function noFiltro(r, filtro) {
  if (filtro === 'todas') return true;
  if (filtro === 'favoritas') return ehFavorita(r);
  if (filtro === 'sem') return !r.categoria_id;
  return r.categoria_id === filtro;
}
/** Onde voltar da receita: a última lista vista (tela inicial ou uma categoria). */
function hashDaUltimaLista() {
  return /^#\/(categoria\/[\w-]+)?$/.test(estado.ultimaLista || '') ? estado.ultimaLista : '#/';
}

async function telaLista(filtro = null) {
  const buscaTinhaFoco = document.activeElement?.classList?.contains('busca');
  if (!estado.colecao) {
    mensagem('Carregando receitas…');
    try { await atualizarColecao(); } catch (e) { return mensagem(erroAmigavel(e), 'erro'); }
  }
  const c = estado.colecao;
  const data = c.receitas;
  const inicio = !filtro; // tela inicial (quadros) ou lista de uma categoria
  if (filtro && !FILTROS_ESPECIAIS[filtro] && !estado.categorias.some(x => x.id === filtro)) { location.hash = '#/'; return; }

  // Texto de busca de cada receita: nome, ingredientes, etiquetas, utensílios e autor.
  const textoBusca = new Map(data.map(r => [r.id, [r.titulo, ...(r.utensilios || []), r.fonte_autor]]));
  for (const i of c.ingredientes) textoBusca.get(i.receita_id)?.push(i.nome);
  const nomeEtiqueta = new Map(c.etiquetas.map(e => [e.id, e.nome]));
  for (const x of c.receita_etiquetas) textoBusca.get(x.receita_id)?.push(nomeEtiqueta.get(x.etiqueta_id));
  for (const [id, partes] of textoBusca) textoBusca.set(id, normalizar(partes.filter(Boolean).join(' | ')));

  const urls = await urlsDasImagens(data.map(r => r.imagem_caminho));
  const titulo = el('h1');
  const cabecalho = el('div', { class: 'cabecalho-lista' },
    titulo,
    estado.titular ? el('a', { class: 'botao principal', href: '#/nova' }, '+ Nova') : null);

  if (!data.length && inicio) {
    titulo.textContent = 'Minhas receitas';
    return mostrar(cabecalho, avisoRevisaoPendente(), el('p', { class: 'aviso', text: estado.titular
      ? 'Nenhuma receita ainda. Toque em "+ Nova" para cadastrar a primeira.'
      : 'Ainda não há receitas compartilhadas com você. Peça ao dono do app para incluir o seu e-mail.' }));
  }

  // A busca da tela inicial e a de cada categoria são separadas.
  const chaveBusca = inicio ? 'inicio' : filtro;
  if (estado.buscaLista?.chave !== chaveBusca) estado.buscaLista = { chave: chaveBusca, texto: inicio ? (estado.busca || '') : '' };
  let visao = lerPreferencia('visao', 'grade');
  const campoBusca = el('input', {
    type: 'search', class: 'busca', value: estado.buscaLista.texto, maxlength: 100, enterkeyhint: 'search',
    placeholder: inicio ? 'Buscar em todas: nome, ingrediente, etiqueta…' : `Buscar em ${nomeDoFiltro(filtro).replace('★ ', '')}…`,
    'aria-label': 'Buscar receitas'
  });
  campoBusca.addEventListener('input', () => {
    estado.buscaLista.texto = campoBusca.value;
    if (inicio) estado.busca = campoBusca.value;
    desenhar();
  });

  const botoesVisao = el('div', { class: 'alternar-visao', role: 'group', 'aria-label': 'Visão' });
  const area = el('div');

  // Versão 20 (IMP-009): ordenar (lembrado) e filtrar por etiquetas (vale enquanto o app está aberto).
  const etiquetasDe = new Map(data.map(r => [r.id, new Set()]));
  for (const x of c.receita_etiquetas) { const n = nomeEtiqueta.get(x.etiqueta_id); if (n) etiquetasDe.get(x.receita_id)?.add(n); }
  let ordem = lerPreferencia('ordem', 'recentes');
  if (!['recentes', 'az', 'tempo'].includes(ordem)) ordem = 'recentes';
  estado.etiquetasEscolhidas = estado.etiquetasEscolhidas || {};
  const escolhidas = new Set(estado.etiquetasEscolhidas[chaveBusca] || []);
  const seletorOrdem = el('select', { class: 'seletor-ordem', 'aria-label': 'Ordenar receitas' },
    el('option', { value: 'recentes', text: 'Mais recentes', selected: ordem === 'recentes' }),
    el('option', { value: 'az', text: 'A a Z', selected: ordem === 'az' }),
    el('option', { value: 'tempo', text: 'Menor tempo', selected: ordem === 'tempo' }));
  seletorOrdem.addEventListener('change', () => { ordem = seletorOrdem.value; gravarPreferencia('ordem', ordem); desenhar(); });
  const barraEtiquetas = el('div', { class: 'filtro-etiquetas', role: 'group', 'aria-label': 'Filtrar por etiqueta' });
  const controles = el('div', { class: 'controles-lista' }, el('label', { class: 'rotulo-ordem' }, el('span', { text: 'Ordenar' }), seletorOrdem), botoesVisao);
  function ordenar(lista) {
    if (ordem === 'az') return [...lista].sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR', { sensitivity: 'base' }));
    if (ordem === 'tempo') {
      const tempo = r => r.tempo_preparo_min ?? r.tempo_total_min ?? Infinity; // sem tempo vai para o fim
      return [...lista].sort((a, b) => tempo(a) - tempo(b));
    }
    return lista; // a coleção já vem da mais recente para a mais antiga
  }

  function itemGrade(r) {
    return el('a', { class: 'cartao', href: `#/receita/${r.id}` },
      elementoCapa(urls[r.imagem_caminho], ''),
      ehFavorita(r) ? el('span', { class: 'selo-favorita', 'aria-label': 'Favorita', text: '★' }) : null,
      el('div', { class: 'cartao-texto' }, el('div', { class: 'cartao-titulo', text: r.titulo })));
  }
  function itemLista(r) {
    const info = [nomeCategoria(r.categoria_id), minutosTexto(r.tempo_preparo_min),
      r.porcoes ? `${formatarNumero(r.porcoes)} porç.` : null].filter(Boolean).join(' · ');
    return el('a', { class: 'item-lista', href: `#/receita/${r.id}` },
      elementoCapa(urls[r.imagem_caminho], ''),
      el('div', { class: 'item-texto' },
        el('div', { class: 'cartao-titulo', text: (ehFavorita(r) ? '★ ' : '') + r.titulo }),
        info ? el('div', { class: 'cartao-info', text: info }) : null));
  }

  /** Quadros da tela inicial: Todas, Favoritas (se houver), categorias e "Sem categoria" (se houver). */
  function quadros() {
    const lista = [{ id: 'todas' }];
    if (data.some(ehFavorita)) lista.push({ id: 'favoritas' });
    // Só as categorias com receitas, em ordem alfabética (Outras por último).
    const usadas = new Set(data.map(r => r.categoria_id));
    for (const cat of estado.categorias) if (usadas.has(cat.id)) lista.push({ id: cat.id });
    if (usadas.has(null) || usadas.has(undefined)) lista.push({ id: 'sem' });
    // Versão 20 (pedido de Rafael): categoria vazia fica oculta; aparece com a 1ª receita.
    return el('div', { class: 'quadros' }, lista.map(({ id }) => {
      const delas = data.filter(r => noFiltro(r, id)); // já vêm da mais recente para a mais antiga
      const comFoto = delas.find(r => r.imagem_caminho && urls[r.imagem_caminho]);
      const nome = nomeDoFiltro(id);
      const qtd = delas.length;
      return el('a', { class: 'quadro' + (qtd ? '' : ' vazio') + (comFoto ? '' : ' sem-foto') + (id === 'todas' || id === 'favoritas' ? ' especial' : ''),
        href: `#/categoria/${id}`, 'aria-label': `${nome}: ${qtd} ${qtd === 1 ? 'receita' : 'receitas'}` },
        comFoto ? el('img', { class: 'quadro-foto', src: urls[comFoto.imagem_caminho], alt: '', loading: 'lazy' })
          : el('div', { class: 'quadro-foto quadro-sem-foto', 'aria-hidden': 'true', text: id === 'favoritas' ? '★' : '🍽' }),
        el('div', { class: 'quadro-texto', 'aria-hidden': 'true' },
          el('span', { class: 'quadro-nome', text: nome }),
          el('span', { class: 'quadro-qtd', text: `${qtd} ${qtd === 1 ? 'receita' : 'receitas'}` })));
    }));
  }

  function desenhar() {
    // Busca: todas as palavras digitadas precisam aparecer (em qualquer campo).
    const palavras = normalizar(estado.buscaLista.texto).split(/\s+/).filter(Boolean);
    const daTela = inicio ? data : data.filter(r => noFiltro(r, filtro));
    let visiveis = palavras.length ? daTela.filter(r => palavras.every(p => textoBusca.get(r.id).includes(p))) : daTela;

    if (inicio && !palavras.length) {
      titulo.textContent = `Minhas receitas (${data.length})`;
      controles.hidden = true; barraEtiquetas.hidden = true;
      area.replaceChildren(quadros());
      return;
    }
    controles.hidden = false;
    // Etiquetas das receitas desta tela (busca já aplicada): todas as escolhidas precisam estar na receita.
    const disponiveis = [...new Set(visiveis.flatMap(r => [...etiquetasDe.get(r.id)]).concat([...escolhidas]))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    barraEtiquetas.hidden = !disponiveis.length;
    barraEtiquetas.replaceChildren(...[...disponiveis.map(n => el('button', {
      class: 'etiqueta-filtro' + (escolhidas.has(n) ? ' ativa' : ''), type: 'button', 'aria-pressed': escolhidas.has(n) ? 'true' : 'false',
      onclick: () => { if (escolhidas.has(n)) escolhidas.delete(n); else escolhidas.add(n); estado.etiquetasEscolhidas[chaveBusca] = [...escolhidas]; desenhar(); }
    }, n)), escolhidas.size ? el('button', { class: 'etiqueta-filtro limpar', type: 'button',
      onclick: () => { escolhidas.clear(); estado.etiquetasEscolhidas[chaveBusca] = []; desenhar(); } }, '✕ Limpar') : null].filter(Boolean));
    visiveis = ordenar(visiveis.filter(r => [...escolhidas].every(n => etiquetasDe.get(r.id).has(n))));
    titulo.textContent = inicio ? `Encontradas (${visiveis.length})`
      : `${nomeDoFiltro(filtro)} (${visiveis.length})`;
    botoesVisao.replaceChildren(
      el('button', { class: 'botao pequeno' + (visao === 'grade' ? ' selecionado' : ''), type: 'button', 'aria-pressed': visao === 'grade' ? 'true' : 'false',
        onclick: () => { visao = 'grade'; gravarPreferencia('visao', visao); desenhar(); } }, '▦ Grade'),
      el('button', { class: 'botao pequeno' + (visao === 'lista' ? ' selecionado' : ''), type: 'button', 'aria-pressed': visao === 'lista' ? 'true' : 'false',
        onclick: () => { visao = 'lista'; gravarPreferencia('visao', visao); desenhar(); } }, '☰ Lista'));
    if (!visiveis.length) {
      area.replaceChildren(el('p', { class: 'aviso', text: palavras.length
        ? `Nenhuma receita com "${estado.buscaLista.texto.trim()}"${inicio ? '' : ' nesta categoria'}${escolhidas.size ? ' e as etiquetas escolhidas' : ''}.`
        : escolhidas.size ? 'Nenhuma receita com todas as etiquetas escolhidas.' : 'Nenhuma receita nesta categoria.' }));
    } else {
      area.replaceChildren(visao === 'lista'
        ? el('div', { class: 'lista' }, visiveis.map(itemLista))
        : el('div', { class: 'grade' }, visiveis.map(itemGrade)));
    }
  }

  const chaveRolagem = location.hash || '#/';
  const posicao = estado.rolagem[chaveRolagem] || 0;
  mostrar(
    inicio ? null : el('p', {}, el('a', { href: '#/' }, '← Categorias')),
    cabecalho, avisoRevisaoPendente(), campoBusca, controles, barraEtiquetas, area);
  desenhar();
  // Volta ao ponto em que esta tela estava (versão 18; uma posição por tela na versão 19).
  window.scrollTo(0, posicao);
  estado.rolagem[chaveRolagem] = posicao;
  estado.ultimaLista = chaveRolagem;
  listaNaTela = chaveRolagem;
  if (buscaTinhaFoco) campoBusca.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------
// Vídeo original dentro da receita (versão 17). Só YouTube, Instagram e
// TikTok, pelo player oficial de cada um. O player só carrega quando você
// toca em "Ver vídeo" (antes disso, nada é pedido ao Google ou à Meta).
// O vídeo não fica guardado no app: precisa de internet e do post no ar.
// ---------------------------------------------------------------------
function videoIncorporavel(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  const id = (v) => (v && /^[\w-]{6,20}$/.test(v)) ? v : null;
  if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const curto = u.pathname.match(/^\/shorts\/([\w-]+)/);
    const v = id(host === 'youtu.be' ? u.pathname.split('/')[1]
      : u.searchParams.get('v') || (curto || u.pathname.match(/^\/(?:embed|live)\/([\w-]+)/))?.[1]);
    return v ? { origem: 'YouTube', vertical: !!curto, src: `https://www.youtube-nocookie.com/embed/${v}?rel=0&playsinline=1` } : null;
  }
  if (host === 'instagram.com' || host === 'instagr.am') {
    const m = u.pathname.match(/^\/(?:[\w.]+\/)?(?:p|reels?|tv)\/([\w-]+)/);
    return m && id(m[1]) ? { origem: 'Instagram', vertical: true, alto: true, src: `https://www.instagram.com/p/${m[1]}/embed/` } : null;
  }
  if (host === 'tiktok.com') {
    const m = u.pathname.match(/\/video\/(\d{8,25})/);
    return m ? { origem: 'TikTok', vertical: true, alto: true, src: `https://www.tiktok.com/embed/v2/${m[1]}` } : null;
  }
  return null;
}

function blocoVideo(fonteUrl) {
  const video = videoIncorporavel(fonteUrl);
  if (!video) return null;
  const area = el('div', { class: 'area-video' });
  const botao = el('button', { class: 'botao', type: 'button', 'aria-expanded': 'false' }, `▶ Ver vídeo (${video.origem})`);
  botao.addEventListener('click', () => {
    if (area.firstChild) { area.replaceChildren(); botao.textContent = `▶ Ver vídeo (${video.origem})`; botao.setAttribute('aria-expanded', 'false'); return; }
    if (estado.semConexao || !navigator.onLine) { area.replaceChildren(el('p', { class: 'status erro', text: 'O vídeo precisa de internet.' })); return; }
    const quadro = el('iframe', {
      class: 'video' + (video.vertical ? ' vertical' : '') + (video.alto ? ' alto' : ''),
      src: video.src, title: `Vídeo da receita (${video.origem})`, loading: 'lazy',
      allow: 'encrypted-media; picture-in-picture; fullscreen', allowfullscreen: '',
      // O app não manda o endereço para outros sites (meta referrer), mas o
      // player do YouTube exige saber de qual site vem (erro 153 sem isso):
      // vai só a origem (byrafael12.github.io), nunca a página.
      referrerpolicy: 'strict-origin-when-cross-origin',
      sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox'
    });
    area.replaceChildren(...[quadro,
      video.origem === 'YouTube' ? null : el('p', { class: 'ajuda', text: 'Se o vídeo não aparecer, o autor não permite assistir fora do ' + video.origem + ': use "abrir original" no fim da receita.' })].filter(Boolean));
    botao.textContent = '✕ Fechar vídeo';
    botao.setAttribute('aria-expanded', 'true');
  });
  return el('div', { class: 'bloco-video' }, botao, area);
}

async function telaReceita(id) {
  mensagem('Carregando…');
  let r;
  try { r = await buscarReceitaCompleta(id); } catch (e) { return mensagem(erroAmigavel(e), 'erro'); }
  if (!r) return mensagem('Receita não encontrada.', 'erro');
  const urls = await urlsDasImagens([r.imagem_caminho, ...r.passos.map(p => p.imagem_caminho)]);

  const resumo = [
    nomeCategoria(r.categoria_id),
    r.tempo_preparo_min != null ? `Preparo: ${minutosTexto(r.tempo_preparo_min)}` : null,
    r.tempo_total_min != null ? `Total: ${minutosTexto(r.tempo_total_min)}` : null
  ].filter(Boolean);

  // Porções (versão 12): muda só a visualização, não altera a receita salva.
  // Com porções cadastradas, o seletor mostra porções; sem elas, multiplica (1x, 2x...).
  const base = Number(r.porcoes) > 0 ? Number(r.porcoes) : null;
  let atual = base || 1;
  const fator = () => atual / (base || 1);
  const valorPorcoes = el('button', { class: 'porcoes-valor', type: 'button', 'aria-live': 'polite',
    title: 'Toque para digitar', 'aria-label': base ? 'Porções: toque para digitar' : 'Receita: toque para digitar' });
  const campoPorcoes = el('input', { class: 'porcoes-campo', type: 'text', inputmode: 'decimal', enterkeyhint: 'done',
    maxlength: 8, hidden: true, 'aria-label': base ? 'Quantas porções?' : 'Multiplicar a receita por' });
  const minimo = () => (base || 1) / 4, maximo = () => (base || 1) * 20;
  valorPorcoes.addEventListener('click', () => {
    campoPorcoes.value = formatarNumero(atual);
    valorPorcoes.hidden = true; campoPorcoes.hidden = false;
    campoPorcoes.focus(); campoPorcoes.select();
  });
  let cancelarDigitacao = false;
  function aplicarDigitado() {
    if (campoPorcoes.hidden) return;
    const v = lerQuantidade(campoPorcoes.value.replace(/x$/i, ''));
    campoPorcoes.hidden = true; valorPorcoes.hidden = false;
    if (cancelarDigitacao) { cancelarDigitacao = false; return; }
    if (v === null || Number.isNaN(v)) { avisoPorcoes.textContent = 'Use um número, ex.: 30, 2,5 ou 1/2.'; return; }
    atual = Math.min(maximo(), Math.max(minimo(), Math.round(v * 1000) / 1000));
    desenharIngredientes();
    if (v > maximo() || v < minimo()) avisoPorcoes.textContent = `Ajustado para ${formatarNumero(atual)} (limite de 1/4 a 20 vezes a receita).`;
  }
  campoPorcoes.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); aplicarDigitado(); }
    if (ev.key === 'Escape') { cancelarDigitacao = true; aplicarDigitado(); }
  });
  campoPorcoes.addEventListener('blur', aplicarDigitado);
  const avisoPorcoes = el('span', { class: 'porcoes-aviso' });
  const botaoMenos = el('button', { class: 'botao pequeno', type: 'button', 'aria-label': base ? 'Menos porções' : 'Diminuir receita' }, '−');
  const botaoMais = el('button', { class: 'botao pequeno', type: 'button', 'aria-label': base ? 'Mais porções' : 'Aumentar receita' }, '+');
  const botaoOriginal = el('button', { class: 'botao pequeno', type: 'button', hidden: true }, 'Original');
  const passo = () => (base && base % 1 === 0) ? 1 : (base ? base / 2 : 0.5);
  botaoMenos.addEventListener('click', () => {
    // valor digitado fora do passo (ex.: 2,5): desce para o inteiro abaixo
    const alvo = Math.abs(atual / passo() - Math.round(atual / passo())) > 1e-9 ? Math.floor(atual / passo()) * passo() : atual - passo();
    if (alvo >= passo() - 1e-9) { atual = Math.round(alvo * 1000) / 1000; desenharIngredientes(); }
  });
  botaoMais.addEventListener('click', () => {
    const alvo = Math.abs(atual / passo() - Math.round(atual / passo())) > 1e-9 ? Math.ceil(atual / passo()) * passo() : atual + passo();
    if (alvo <= maximo() + 1e-9) { atual = Math.round(alvo * 1000) / 1000; desenharIngredientes(); }
  });
  botaoOriginal.addEventListener('click', () => { atual = base || 1; desenharIngredientes(); });
  const seletorPorcoes = el('div', { class: 'porcoes' },
    el('span', { class: 'porcoes-rotulo', text: base ? 'Porções' : 'Receita' }),
    botaoMenos, valorPorcoes, campoPorcoes, botaoMais, botaoOriginal, avisoPorcoes);

  // Ingredientes agrupados (massa, recheio...) na ordem salva. Toque risca o item.
  const listaIng = el('ul', { class: 'ingredientes' });
  function desenharIngredientes() {
    const f = fator();
    valorPorcoes.textContent = base ? formatarNumero(atual) : `${formatarNumero(atual)}x`;
    botaoOriginal.hidden = Math.abs(f - 1) < 1e-9;
    avisoPorcoes.textContent = Math.abs(f - 1) < 1e-9 ? '' : 'quantidades recalculadas; "a gosto" não muda';
    const riscados = new Set([...listaIng.querySelectorAll('li.feito')].map(li => li.dataset.n));
    listaIng.replaceChildren();
    let grupoAtual = null;
    r.ingredientes.forEach((i, n) => {
      if ((i.grupo || null) !== grupoAtual) {
        grupoAtual = i.grupo || null;
        if (grupoAtual) listaIng.append(el('li', { class: 'grupo-titulo', text: grupoAtual }));
      }
      const q = i.quantidade !== null && i.quantidade !== undefined
        ? (Math.abs(f - 1) < 1e-9 ? formatarQuantidade(i.quantidade) : formatarEscalada(i.quantidade * f)) : null;
      const qtd = [q, i.unidade].filter(Boolean).join(' ');
      listaIng.append(el('li', { class: 'marcavel' + (riscados.has(String(n)) ? ' feito' : ''), 'data-n': n, onclick: (ev) => ev.currentTarget.classList.toggle('feito') },
        qtd ? el('span', { class: 'quantidade', text: qtd + ' ' }) : null,
        i.nome,
        i.observacao ? ` (${i.observacao})` : null));
    });
  }
  desenharIngredientes();

  // Favorita (versão 13)
  const botaoFavorita = el('button', { class: 'botao pequeno', type: 'button' });
  const desenharFavorita = () => {
    const f = ehFavorita(r);
    botaoFavorita.textContent = f ? '★ Favorita' : '☆ Favoritar';
    botaoFavorita.setAttribute('aria-pressed', f ? 'true' : 'false');
    botaoFavorita.classList.toggle('selecionado', f);
  };
  botaoFavorita.addEventListener('click', async () => {
    botaoFavorita.disabled = true;
    await alternarFavorita(r);
    botaoFavorita.disabled = false;
    desenharFavorita();
  });
  desenharFavorita();

  // Tela acesa (versão 12): Screen Wake Lock, quando o navegador permite.
  const botaoTela = 'wakeLock' in navigator
    ? el('button', { class: 'botao pequeno', type: 'button', 'aria-pressed': 'false', onclick: () => alternarTelaAcesa(botaoTela) }, '☀ Manter tela acesa')
    : null;

  const link = linkSeguro(r.fonte_url);
  const fonte = (link || r.fonte_autor) ? el('p', { class: 'fonte' }, 'Fonte: ',
    r.fonte_autor ? r.fonte_autor + ' ' : null,
    link ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, 'abrir original') : null) : null;

  mostrar(el('article', { class: 'receita' },
    el('p', {}, el('a', { href: hashDaUltimaLista() }, '← Voltar')),
    urls[r.imagem_caminho] ? elementoCapa(urls[r.imagem_caminho], r.titulo) : null,
    el('h1', { text: r.titulo }),
    resumo.length ? el('div', { class: 'resumo' }, resumo.map(t => el('span', { text: t }))) : null,
    r.etiquetas.length ? el('div', { class: 'etiquetas' }, r.etiquetas.map(t => el('span', { class: 'etiqueta', text: t }))) : null,
    el('div', { class: 'acoes acoes-topo' },
      r.passos.length ? el('a', { class: 'botao pequeno principal', href: `#/cozinha/${r.id}`,
        onclick: () => { estado.fatorCozinha = { id: r.id, fator: fator() }; } }, '👩‍🍳 Modo cozinha') : null,
      botaoFavorita, botaoTela),
    el('h2', { text: 'Ingredientes' }),
    r.ingredientes.some(i => i.quantidade !== null && i.quantidade !== undefined) ? seletorPorcoes : null,
    r.ingredientes.length ? listaIng : el('p', { class: 'aviso', text: 'Sem ingredientes.' }),
    (r.utensilios || []).length ? el('h2', { text: 'Utensílios' }) : null,
    (r.utensilios || []).length ? el('ul', { class: 'utensilios' }, r.utensilios.map(u => el('li', { text: u }))) : null,
    el('h2', { text: 'Modo de preparo' }),
    blocoVideo(r.fonte_url),
    r.passos.length ? passosAgrupados(r.passos, urls, { receitaId: r.id, receita: r.titulo }) : el('p', { class: 'aviso', text: 'Sem passos.' }),
    r.observacoes ? el('h2', { text: 'Observações' }) : null,
    r.observacoes ? el('p', { class: 'observacoes', text: r.observacoes }) : null,
    fonte,
    el('div', { class: 'acoes' },
      el('button', { class: 'botao', type: 'button', onclick: () => compartilharReceita(r, fator()) }, 'Compartilhar'),
      el('button', { class: 'botao', type: 'button', onclick: (ev) => copiarReceita(r, ev.currentTarget, fator()) }, 'Copiar texto'),
      estado.titular ? el('a', { class: 'botao', href: `#/editar/${r.id}` }, 'Editar') : null,
      estado.titular ? el('button', { class: 'botao perigo', type: 'button', onclick: () => excluirReceita(r) }, 'Excluir') : null)
  ));
}

// ---------------------------------------------------------------------
// Tela acesa durante o preparo (versão 12)
// O navegador solta o bloqueio quando o app vai para segundo plano; ao
// voltar, pedimos de novo. Ao sair da receita, a tela volta ao normal.
// ---------------------------------------------------------------------
let telaAcesa = null;          // bloqueio ativo (WakeLockSentinel)
let querTelaAcesa = false;     // o usuário ligou na receita aberta
let botaoTelaAtual = null;

function mostrarEstadoTela() {
  if (!botaoTelaAtual) return;
  const ligada = !!telaAcesa && !telaAcesa.released;
  botaoTelaAtual.textContent = ligada ? '☀ Tela acesa ✓' : '☀ Manter tela acesa';
  botaoTelaAtual.setAttribute('aria-pressed', ligada ? 'true' : 'false');
  botaoTelaAtual.classList.toggle('selecionado', ligada);
}
async function pedirTelaAcesa() {
  try {
    telaAcesa = await navigator.wakeLock.request('screen');
    telaAcesa.addEventListener('release', mostrarEstadoTela);
  } catch {
    telaAcesa = null;
    if (botaoTelaAtual) botaoTelaAtual.textContent = '☀ Não deu (bateria fraca?)';
  }
  mostrarEstadoTela();
}
async function alternarTelaAcesa(botao) {
  botaoTelaAtual = botao;
  if (telaAcesa && !telaAcesa.released) { querTelaAcesa = false; await telaAcesa.release(); telaAcesa = null; mostrarEstadoTela(); return; }
  querTelaAcesa = true;
  await pedirTelaAcesa();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && querTelaAcesa && (!telaAcesa || telaAcesa.released)) pedirTelaAcesa();
});
window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#/receita/') && !location.hash.startsWith('#/cozinha/')) {
    querTelaAcesa = false; botaoTelaAtual = null;
    if (telaAcesa && !telaAcesa.released) telaAcesa.release().catch(() => {});
    telaAcesa = null;
  }
});

// ---------------------------------------------------------------------
// Versão 19: timers. Tempos escritos nos passos ("40 minutos", "1 h 30",
// "meia hora", "20 a 25 min") viram botões "⏱". Os timers continuam em
// todas as telas, sobrevivem a recarregar e tocam um alarme no fim.
// Limite do iPhone: com o app em segundo plano o som não toca; ao voltar,
// o aviso aparece na hora (o tempo é contado pelo relógio, não pelo app).
// ---------------------------------------------------------------------
const PADRAO_TEMPO = new RegExp([
  '(\\d+)\\s*(?:h|hr|hrs|horas?)\\s*(?:e\\s*)?(\\d{1,2})\\s*(?:min|minutos?)?(?![\\w])',          // 1 h 30 / 1h30min / 1 hora e 30 minutos
  '(\\d+(?:[.,]\\d+)?)\\s*(?:a|-|–|ou)\\s*\\d+(?:[.,]\\d+)?\\s*(min|minutos?|h|hrs?|horas?|seg|segundos?)(?![\\w])', // 20 a 25 minutos
  '(meia)\\s+hora',
  '(\\d+(?:[.,]\\d+)?|uma?|dois|duas|tr[eê]s|cinco|dez|quinze|vinte|trinta|quarenta)\\s*(min|minutos?|h|hrs?|horas?|seg|segundos?)(?![\\w])'
].join('|'), 'gi');
const NUMEROS_ESCRITOS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, 'três': 3, cinco: 5, dez: 10, quinze: 15, vinte: 20, trinta: 30, quarenta: 40 };
function emSegundos(n, unidade) {
  const v = NUMEROS_ESCRITOS[String(n).toLowerCase()] ?? Number(String(n).replace(',', '.'));
  const u = unidade.toLowerCase();
  return Math.round(v * (u.startsWith('h') ? 3600 : u.startsWith('s') ? 1 : 60));
}
function textoDuracao(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), seg = s % 60;
  if (h) return m ? `${h} h ${m} min` : `${h} h`;
  if (m) return seg ? `${m} min ${seg} s` : `${m} min`;
  return `${seg} s`;
}
/** Tempos encontrados no texto de um passo, sem repetir. */
function temposNoTexto(texto) {
  const achados = [];
  for (const m of String(texto || '').matchAll(PADRAO_TEMPO)) {
    let s = null;
    if (m[1] !== undefined) s = Number(m[1]) * 3600 + Number(m[2]) * 60;
    else if (m[3] !== undefined) s = emSegundos(m[3], m[4]);
    else if (m[5] !== undefined) s = 30 * 60;
    else if (m[6] !== undefined) s = emSegundos(m[6], m[7]);
    if (s && s >= 5 && s <= 24 * 3600 && !achados.includes(s)) achados.push(s);
  }
  return achados.slice(0, 3);
}
/** Botões de timer de um passo. "info": { receitaId, receita, passo (número), grupo, texto }.
 *  Versão 20 (aceite da 19): o timer guarda de qual passo é; o botão do passo mostra o tempo correndo. */
function botoesTimer(texto, info) {
  if (!info) return null;
  const tempos = temposNoTexto(texto);
  if (!tempos.length) return null;
  const botoes = el('span', { class: 'timers-passo' }, tempos.map(s => el('button', {
    class: 'timer-botao', type: 'button', 'data-chave': `${info.receitaId}|${info.passo}|${s}`, 'data-duracao': textoDuracao(s),
    'aria-label': `Iniciar timer de ${textoDuracao(s)} do passo ${info.passo}`,
    onclick: (ev) => {
      ev.stopPropagation();
      if (ev.currentTarget.classList.contains('rodando')) return; // já está correndo: não duplica
      iniciarTimer(s, { ...info, texto });
    }
  }, `⏱ ${textoDuracao(s)}`)));
  queueMicrotask(atualizarBotoesTimer);
  return botoes;
}
const chaveTimer = (x) => `${x.receitaId}|${x.passo}|${x.total}`;
/** Botões dos passos com timer correndo mostram o tempo que falta. */
function atualizarBotoesTimer() {
  for (const b of document.querySelectorAll('.timer-botao[data-chave]')) {
    const x = timers.find(y => y.receitaId && chaveTimer(y) === b.dataset.chave);
    const s = x ? restante(x) : null;
    const texto = !x ? `⏱ ${b.dataset.duracao}` : (s === 0 && x.pausadoRestante == null ? '⏱ Pronto!' : `⏱ ${relogio(s)}${x.pausadoRestante != null ? ' (pausado)' : ''}`);
    if (b.textContent !== texto) b.textContent = texto;
    b.classList.toggle('rodando', !!x);
    b.setAttribute('aria-label', x ? `Timer do passo ${x.passo} correndo: ${texto.slice(2)}` : `Iniciar timer de ${b.dataset.duracao}`);
  }
}

const CHAVE_TIMERS = 'receitas.timers';
let timers = [];
try { timers = JSON.parse(localStorage.getItem(CHAVE_TIMERS) || '[]').filter(x => x && Number.isFinite(x.fim) && typeof x.rotulo === 'string'); } catch { timers = []; }
let painelTimers = null, relogioTimers = null, somAlarme = null, contextoSom = null;
function gravarTimers() { try { localStorage.setItem(CHAVE_TIMERS, JSON.stringify(timers)); } catch { /* sem armazenamento */ } }
function restante(x) { return x.pausadoRestante != null ? x.pausadoRestante : Math.max(0, Math.round((x.fim - Date.now()) / 1000)); }
function relogio(s) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), seg = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(seg).padStart(2, '0'); }

/** Som do alarme (o iPhone só libera o som depois de um toque: ele é preparado ao iniciar o timer). */
function prepararSom() {
  try {
    const Contexto = window.AudioContext || window.webkitAudioContext;
    if (!Contexto) return;
    contextoSom = contextoSom || new Contexto();
    if (contextoSom.state === 'suspended') contextoSom.resume();
  } catch { contextoSom = null; }
}
function bipe() {
  if (!contextoSom) return;
  try {
    const agora = contextoSom.currentTime;
    for (const atraso of [0, 0.25, 0.5]) {
      const osc = contextoSom.createOscillator(), volume = contextoSom.createGain();
      osc.frequency.value = 880; volume.gain.value = 0.25;
      osc.connect(volume); volume.connect(contextoSom.destination);
      osc.start(agora + atraso); osc.stop(agora + atraso + 0.15);
    }
  } catch { /* sem som */ }
}
function tocarAlarme() {
  if (somAlarme) return;
  let vezes = 0;
  bipe(); navigator.vibrate?.([300, 150, 300]);
  somAlarme = setInterval(() => { bipe(); if (++vezes >= 30) pararAlarme(); }, 2000); // até 1 minuto
}
function pararAlarme() { clearInterval(somAlarme); somAlarme = null; document.title = 'Receitas na mão'; }

function iniciarTimer(segundos, info) {
  prepararSom();
  const i = typeof info === 'string' ? { rotulo: info } : info;
  timers.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    receitaId: i.receitaId || null, receita: String(i.receita || '').slice(0, 80), passo: i.passo || null, grupo: i.grupo ? String(i.grupo).slice(0, 40) : null,
    trecho: String(i.texto || '').slice(0, 90),
    rotulo: (i.rotulo || `${i.receita}, passo ${i.passo}`).slice(0, 120),
    total: segundos, fim: Date.now() + segundos * 1000, pausadoRestante: null, avisado: false });
  gravarTimers();
  desenharTimers();
}
function desenharTimers() {
  if (!painelTimers) {
    painelTimers = el('section', { class: 'painel-timers', 'aria-label': 'Timers' });
    document.body.append(painelTimers);
  }
  if (!timers.length) { atualizarBotoesTimer(); painelTimers.hidden = true; painelTimers.replaceChildren(); clearInterval(relogioTimers); relogioTimers = null; pararAlarme(); document.body.style.paddingBottom = ''; document.documentElement.style.removeProperty('--altura-timers'); return; }
  painelTimers.hidden = false;
  let algumTocando = false;
  const variasReceitas = new Set(timers.map(x => x.receita || x.rotulo)).size > 1;
  painelTimers.replaceChildren(...timers.map(x => {
    const s = restante(x);
    const acabou = s === 0 && x.pausadoRestante == null;
    if (acabou) { algumTocando = true; if (!x.avisado) { x.avisado = true; gravarTimers(); } }
    return el('div', { class: 'timer' + (acabou ? ' acabou' : ''), role: acabou ? 'alert' : null },
      el('div', { class: 'timer-texto', title: x.trecho ? `${x.receita}, passo ${x.passo}: ${x.trecho}` : x.rotulo },
        el('span', { class: 'timer-linha' },
          el('span', { class: 'timer-relogio', text: acabou ? 'Pronto!' : relogio(s) }),
          x.passo ? el('span', { class: 'timer-passo', text: `Passo ${x.passo}${x.grupo ? ' · ' + x.grupo : ''}` }) : null),
        el('span', { class: 'timer-rotulo', text: x.trecho
          ? (variasReceitas ? `${x.receita}: ${x.trecho}` : x.trecho)
          : x.rotulo })),
      acabou ? null : el('button', { class: 'botao pequeno', type: 'button', 'aria-label': x.pausadoRestante != null ? 'Continuar timer' : 'Pausar timer',
        onclick: () => { if (x.pausadoRestante != null) { x.fim = Date.now() + x.pausadoRestante * 1000; x.pausadoRestante = null; } else x.pausadoRestante = restante(x); gravarTimers(); desenharTimers(); } },
        x.pausadoRestante != null ? '▶ Seguir' : 'Pausar'),
      acabou ? null : el('button', { class: 'botao pequeno', type: 'button', 'aria-label': 'Mais 1 minuto',
        onclick: () => { if (x.pausadoRestante != null) x.pausadoRestante += 60; else x.fim += 60000; gravarTimers(); desenharTimers(); } }, '+1'),
      el('button', { class: 'botao pequeno' + (acabou ? ' principal' : ''), type: 'button', 'aria-label': acabou ? 'Parar alarme' : 'Cancelar timer',
        onclick: () => { timers = timers.filter(y => y !== x); gravarTimers(); if (!timers.some(y => restante(y) === 0 && y.pausadoRestante == null)) pararAlarme(); desenharTimers(); } },
        acabou ? 'Parar' : '✕'));
  }));
  if (algumTocando) { tocarAlarme(); document.title = '⏰ Pronto! · Receitas na mão'; }
  // O painel não cobre o fim da tela nem os botões do modo cozinha.
  document.documentElement.style.setProperty('--altura-timers', `${painelTimers.offsetHeight + 8}px`);
  document.body.style.paddingBottom = `calc(${painelTimers.offsetHeight + 8}px + env(safe-area-inset-bottom))`;
  atualizarBotoesTimer();
  if (!relogioTimers) relogioTimers = setInterval(desenharTimers, 1000);
}
if (timers.length) desenharTimers();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && timers.length) desenharTimers(); });

// ---------------------------------------------------------------------
// Versão 19: modo cozinha. Um passo por vez, em letra grande, com a foto
// do passo, os timers e os ingredientes à mão. A tela fica acesa.
// Anterior/Próximo pelos botões, deslizando o dedo ou pelas setas do teclado.
// ---------------------------------------------------------------------
let telaAcesaPelaCozinha = false;
let cozinhaAberta = null; // { ir(delta) }
async function telaCozinha(id) {
  mensagem('Carregando…');
  let r;
  try { r = await buscarReceitaCompleta(id); } catch (e) { return mensagem(erroAmigavel(e), 'erro'); }
  if (!r || !r.passos.length) { location.hash = r ? `#/receita/${id}` : '#/'; return; }
  const urls = await urlsDasImagens(r.passos.map(p => p.imagem_caminho));
  const fator = estado.fatorCozinha?.id === id ? estado.fatorCozinha.fator : 1;
  estado.passoCozinha = estado.passoCozinha?.id === id ? estado.passoCozinha : { id, n: 0 };
  const total = r.passos.length;

  const progresso = el('div', { class: 'cozinha-progresso', role: 'status' });
  const barra = el('div', { class: 'cozinha-barra' }, el('span'));
  const grupo = el('div', { class: 'cozinha-grupo' });
  const texto = el('p', { class: 'cozinha-texto' });
  const timersDoPasso = el('div', { class: 'cozinha-timers' });
  const foto = el('div', { class: 'cozinha-foto' });
  const anterior = el('button', { class: 'botao', type: 'button' }, '← Anterior');
  const proximo = el('button', { class: 'botao principal', type: 'button' }, 'Próximo →');

  const listaIng = el('ul', { class: 'ingredientes cozinha-ingredientes' }, r.ingredientes.map(i => {
    const q = i.quantidade != null ? (Math.abs(fator - 1) < 1e-9 ? formatarQuantidade(i.quantidade) : formatarEscalada(i.quantidade * fator)) : null;
    const qtd = [q, i.unidade].filter(Boolean).join(' ');
    return el('li', { class: 'marcavel', onclick: (ev) => ev.currentTarget.classList.toggle('feito') },
      i.grupo ? el('small', { class: 'cozinha-ing-grupo', text: i.grupo + ': ' }) : null,
      qtd ? el('span', { class: 'quantidade', text: qtd + ' ' }) : null, i.nome, i.observacao ? ` (${i.observacao})` : null);
  }));
  const painelIng = el('div', { class: 'cozinha-painel-ing', hidden: true },
    el('h2', { text: Math.abs(fator - 1) < 1e-9 ? 'Ingredientes' : `Ingredientes (${formatarNumero(fator)}x)` }), listaIng);
  const botaoIng = el('button', { class: 'botao pequeno', type: 'button', 'aria-expanded': 'false' }, 'Ingredientes');
  botaoIng.addEventListener('click', () => {
    painelIng.hidden = !painelIng.hidden;
    botaoIng.setAttribute('aria-expanded', painelIng.hidden ? 'false' : 'true');
    botaoIng.textContent = painelIng.hidden ? 'Ingredientes' : 'Voltar ao passo';
  });

  function desenhar() {
    const n = estado.passoCozinha.n = Math.min(total - 1, Math.max(0, estado.passoCozinha.n));
    const p = r.passos[n];
    progresso.textContent = `Passo ${n + 1} de ${total}`;
    barra.firstChild.style.width = `${Math.round(((n + 1) / total) * 100)}%`;
    grupo.textContent = p.grupo || '';
    grupo.hidden = !p.grupo;
    texto.textContent = p.texto;
    timersDoPasso.replaceChildren(botoesTimer(p.texto, { receitaId: r.id, receita: r.titulo, passo: n + 1, grupo: p.grupo }) || '');
    const url = p.imagem_caminho ? urls[p.imagem_caminho] : null;
    foto.replaceChildren(url ? el('img', { src: url, alt: `Foto do passo ${n + 1}` }) : '');
    foto.hidden = !url;
    anterior.disabled = n === 0;
    proximo.textContent = n === total - 1 ? 'Concluir ✓' : 'Próximo →';
    if (!painelIng.hidden) botaoIng.click();
    window.scrollTo(0, 0);
  }
  const ir = (delta) => {
    if (delta > 0 && estado.passoCozinha.n === total - 1) { estado.passoCozinha = null; location.hash = `#/receita/${id}`; return; }
    estado.passoCozinha.n += delta; desenhar();
  };
  anterior.addEventListener('click', () => ir(-1));
  proximo.addEventListener('click', () => ir(1));

  const secao = el('section', { class: 'cozinha', 'aria-label': `Modo cozinha: ${r.titulo}` },
    el('div', { class: 'cozinha-topo' },
      el('a', { class: 'botao pequeno', href: `#/receita/${id}` }, '✕ Sair'),
      el('h1', { class: 'cozinha-titulo', text: r.titulo }),
      botaoIng),
    barra, progresso, grupo, texto, timersDoPasso, foto, painelIng,
    el('div', { class: 'cozinha-navegacao' }, anterior, proximo));
  // Deslizar o dedo para o lado troca de passo.
  let toque = null;
  secao.addEventListener('touchstart', (ev) => { toque = ev.touches.length === 1 ? { x: ev.touches[0].clientX, y: ev.touches[0].clientY } : null; }, { passive: true });
  secao.addEventListener('touchend', (ev) => {
    if (!toque || !painelIng.hidden) return;
    const dx = ev.changedTouches[0].clientX - toque.x, dy = ev.changedTouches[0].clientY - toque.y;
    toque = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) { if (dx < 0) ir(1); else if (estado.passoCozinha.n > 0) ir(-1); }
  }, { passive: true });

  mostrar(secao);
  desenhar();
  cozinhaAberta = { ir };
  // Tela acesa enquanto cozinha (se o aparelho permitir).
  if ('wakeLock' in navigator && (!telaAcesa || telaAcesa.released)) { querTelaAcesa = true; telaAcesaPelaCozinha = true; pedirTelaAcesa(); }
}
document.addEventListener('keydown', (ev) => {
  if (!cozinhaAberta || !location.hash.startsWith('#/cozinha/') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
  if (ev.key === 'ArrowRight') { ev.preventDefault(); cozinhaAberta.ir(1); }
  if (ev.key === 'ArrowLeft') { ev.preventDefault(); cozinhaAberta.ir(-1); }
});
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#/cozinha/')) return;
  cozinhaAberta = null;
  if (telaAcesaPelaCozinha) {
    telaAcesaPelaCozinha = false; querTelaAcesa = false;
    if (telaAcesa && !telaAcesa.released) telaAcesa.release().catch(() => {});
    telaAcesa = null;
  }
});

// ---------------------------------------------------------------------
// Compartilhar uma receita (versão 11): texto pronto para WhatsApp
// ---------------------------------------------------------------------

/** Receita em texto simples (negrito no padrão do WhatsApp: *texto*). */
function textoDaReceita(r, fator = 1) {
  const escalado = Math.abs(fator - 1) > 1e-9;
  const linhas = [`*${r.titulo}*`];
  const resumo = [r.porcoes ? `${formatarNumero(Math.round(r.porcoes * fator * 1000) / 1000)} porções` : (escalado ? `Receita ${formatarNumero(fator)}x` : null),
    r.tempo_preparo_min ? `Preparo: ${minutosTexto(r.tempo_preparo_min)}` : null,
    r.tempo_total_min ? `Total: ${minutosTexto(r.tempo_total_min)}` : null].filter(Boolean).join(' · ');
  if (resumo) linhas.push(resumo);
  if (r.ingredientes.length) {
    linhas.push('', '*Ingredientes*');
    let grupo = null;
    for (const i of r.ingredientes) {
      if ((i.grupo || null) !== grupo) { grupo = i.grupo || null; if (grupo) linhas.push(`_${grupo}_`); }
      const temQtd = i.quantidade !== null && i.quantidade !== undefined;
      const qtd = [temQtd ? (escalado ? formatarEscalada(i.quantidade * fator) : formatarQuantidade(i.quantidade)) : null, i.unidade].filter(Boolean).join(' ');
      linhas.push(`• ${qtd ? qtd + ' ' : ''}${i.nome}${i.observacao ? ` (${i.observacao})` : ''}`);
    }
  }
  if ((r.utensilios || []).length) linhas.push('', '*Utensílios*', r.utensilios.join(', '));
  if (r.passos.length) {
    linhas.push('', '*Modo de preparo*');
    let grupo = null;
    r.passos.forEach((p, n) => {
      if ((p.grupo || null) !== grupo) { grupo = p.grupo || null; if (grupo) linhas.push(`_${grupo}_`); }
      linhas.push(`${n + 1}. ${p.texto}`);
    });
  }
  if (r.observacoes) linhas.push('', '*Observações*', r.observacoes);
  const link = linkSeguro(r.fonte_url);
  if (link || r.fonte_autor) linhas.push('', `Fonte: ${[r.fonte_autor, link].filter(Boolean).join(' · ')}`);
  linhas.push('', 'Enviada pelo app Receitas na mão');
  return linhas.join('\n');
}

/** Abre o compartilhamento do aparelho (WhatsApp, e-mail...); sem ele, abre o WhatsApp. */
async function compartilharReceita(r, fator = 1) {
  const texto = textoDaReceita(r, fator);
  if (navigator.share) {
    try { await navigator.share({ title: r.titulo, text: texto }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; /* sem suporte: segue para o WhatsApp */ }
  }
  window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank', 'noopener');
}

async function copiarReceita(r, botao, fator = 1) {
  try {
    await navigator.clipboard.writeText(textoDaReceita(r, fator));
    botao.textContent = 'Copiado ✓';
  } catch {
    botao.textContent = 'Não consegui copiar';
  }
  setTimeout(() => { botao.textContent = 'Copiar texto'; }, 2500);
}

async function excluirReceita(r) {
  if (estado.semConexao) return alert('Sem internet: para excluir, conecte-se.');
  if (!confirm(`Excluir "${r.titulo}"? Não dá para desfazer.`)) return;
  const { error } = await sb.from('receitas').delete().eq('id', r.id);
  if (error) return alert(erroAmigavel(error));
  const fotos = [r.imagem_caminho, ...(r.passos || []).map(p => p.imagem_caminho)].filter(Boolean);
  if (fotos.length) await sb.storage.from(PASTA_IMAGENS).remove(fotos);
  try { await atualizarColecao(); } catch { estado.colecao = null; }
  location.hash = '#/';
}

// ---------------------------------------------------------------------
// Formulário de receita (nova ou edição)
// ---------------------------------------------------------------------

/**
 * Formulário de receita. Três usos:
 *  - nova receita manual: telaFormulario(null)
 *  - edição: telaFormulario(id)
 *  - revisão do que a IA leu: telaFormulario(null, revisao), onde revisao traz
 *    { dados, candidatos: [{ blob, url }], capaIndice, aviso, duvidosos,
 *      posicao, total, aoSalvar(id), aoDescartar() }
 */
async function telaFormulario(id, revisao = null) {
  mensagem('Carregando…');
  let r = revisao ? revisao.dados : null;
  if (id) {
    try { r = await buscarReceitaCompleta(id); } catch (e) { return mensagem(erroAmigavel(e), 'erro'); }
    if (!r) return mensagem('Receita não encontrada.', 'erro');
  }
  const idReceita = r?.id || crypto.randomUUID();
  let fotoNova = null;          // Blob comprimido
  let removerFoto = false;
  let urlPrevia = null;
  let aoMudar = () => {};       // versão 18: avisa que o formulário mudou (definida no fim)

  const campo = (rotulo, entrada, ajuda) =>
    el('label', { class: 'campo' }, el('span', {}, rotulo, ajuda ? el('small', { text: ' ' + ajuda }) : null), entrada);

  const titulo = el('input', { type: 'text', maxlength: 200, required: true, value: r?.titulo || '' });
  const categoria = el('select', {},
    el('option', { value: '', text: 'Sem categoria' }),
    estado.categorias.filter(c => c.ativa || c.id === r?.categoria_id)
      .map(c => el('option', { value: c.id, text: c.nome, selected: c.id === r?.categoria_id })));
  const etiquetas = el('input', { type: 'text', maxlength: 400, value: (r?.etiquetas || []).join(', '), placeholder: 'Airfryer, Rápida' });
  // (os campos "_texto" vêm do rascunho da revisão: o que estava digitado, mesmo se inválido)
  const porcoes = el('input', { type: 'text', inputmode: 'decimal', value: r?.porcoes_texto ?? (r?.porcoes ? formatarNumero(r.porcoes) : '') });
  const tempoPreparo = el('input', { type: 'text', inputmode: 'numeric', value: r?.tempo_preparo_texto ?? r?.tempo_preparo_min ?? '' });
  const tempoTotal = el('input', { type: 'text', inputmode: 'numeric', value: r?.tempo_total_texto ?? r?.tempo_total_min ?? '' });
  const fonteUrl = el('input', { type: 'url', maxlength: 2000, value: r?.fonte_url || '', placeholder: 'https://' });
  const fonteAutor = el('input', { type: 'text', maxlength: 120, value: r?.fonte_autor || '', placeholder: '@perfil ou nome' });

  // Foto
  const previa = el('div', { class: 'foto-previa' });
  const entradaFoto = el('input', { type: 'file', accept: 'image/*', 'aria-label': 'Foto da receita (capa)' });
  const botaoRemoverFoto = el('button', { class: 'botao pequeno', type: 'button' }, 'Remover foto');
  const statusFoto = el('div', { class: 'status' });
  async function desenharPrevia() {
    let url = null;
    if (fotoNova) url = urlPrevia;
    else if (r?.imagem_caminho && !removerFoto) url = (await urlsDasImagens([r.imagem_caminho]))[r.imagem_caminho];
    previa.replaceChildren(url ? el('img', { src: url, alt: 'Prévia da foto' }) : el('span', { class: 'aviso', text: 'Sem foto' }));
    botaoRemoverFoto.hidden = !url;
  }
  async function usarFoto(arquivo) {
    statusFoto.textContent = 'Reduzindo a foto…';
    try {
      fotoNova = await comprimirImagem(arquivo);
      if (urlPrevia) URL.revokeObjectURL(urlPrevia);
      urlPrevia = URL.createObjectURL(fotoNova);
      removerFoto = false;
      statusFoto.textContent = `Foto pronta: ${Math.round(fotoNova.size / 1024)} KB`;
    } catch (e) {
      fotoNova = null;
      statusFoto.textContent = erroAmigavel(e);
    }
    desenharPrevia();
    aoMudar();
  }
  entradaFoto.addEventListener('change', () => { if (entradaFoto.files[0]) usarFoto(entradaFoto.files[0]); });

  // Revisão: miniaturas das imagens e quadros do vídeo para escolher a capa.
  const escolhaCapa = el('div', { class: 'candidatos' });
  const capaGuardada = revisao?.capaGuardada; // rascunho: capa já escolhida (ou removida) antes de sair
  if (capaGuardada?.blob instanceof Blob) {
    fotoNova = capaGuardada.blob;
    urlPrevia = URL.createObjectURL(fotoNova);
    statusFoto.textContent = `Foto pronta: ${Math.round(fotoNova.size / 1024)} KB`;
  } else if (capaGuardada?.removida) {
    removerFoto = true;
  }
  if (revisao?.candidatos?.length) {
    revisao.candidatos.forEach((c, i) => {
      escolhaCapa.append(el('button', {
        class: 'candidato', type: 'button', 'aria-label': `Usar imagem ${i + 1} como capa`,
        onclick: (ev) => {
          escolhaCapa.querySelectorAll('.candidato').forEach(b => b.classList.remove('escolhido'));
          ev.currentTarget.classList.add('escolhido');
          usarFoto(c.blob);
        }
      }, el('img', { src: c.url, alt: '' })));
    });
    if (!capaGuardada?.blob && !capaGuardada?.removida) {
      const inicial = Number.isInteger(revisao.capaIndice) ? revisao.capaIndice : 0;
      const botaoInicial = escolhaCapa.children[Math.min(inicial, revisao.candidatos.length - 1)];
      botaoInicial.classList.add('escolhido');
      usarFoto(revisao.candidatos[Math.min(inicial, revisao.candidatos.length - 1)].blob);
    }
  }
  botaoRemoverFoto.addEventListener('click', () => {
    fotoNova = null; removerFoto = true; entradaFoto.value = ''; statusFoto.textContent = '';
    escolhaCapa.querySelectorAll('.candidato').forEach(b => b.classList.remove('escolhido'));
    desenharPrevia();
    aoMudar();
  });

  // Ingredientes: linhas de ingrediente e de grupo (ex.: "Recheio").
  const listaIngredientes = el('div');
  function linhaIngrediente(i = {}) {
    const linha = el('div', { class: 'linha-ingrediente', 'data-tipo': 'ing', 'data-original': i.texto_original || null },
      el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Qtd', 'aria-label': 'Quantidade',
        value: i.quantidade_texto ?? (i.quantidade !== null && i.quantidade !== undefined ? formatarQuantidade(i.quantidade) : '') }),
      el('input', { type: 'text', placeholder: 'Unid.', maxlength: 30, 'aria-label': 'Unidade', value: i.unidade || '' }),
      el('input', { type: 'text', placeholder: 'Ingrediente', maxlength: 200, 'aria-label': 'Ingrediente', value: i.nome || '' }),
      el('button', { class: 'botao remover', type: 'button', 'aria-label': 'Remover ingrediente', onclick: () => linha.remove() }, '×'));
    return linha;
  }
  function linhaGrupo(nome = '') {
    const linha = el('div', { class: 'linha-grupo com-mover', 'data-tipo': 'grupo' },
      el('input', { type: 'text', placeholder: 'Nome do grupo (ex.: Recheio)', maxlength: 60, 'aria-label': 'Grupo', value: nome }),
      ...botoesMover(() => linha),
      el('button', { class: 'botao remover', type: 'button', 'aria-label': 'Remover grupo', onclick: () => linha.remove() }, '×'));
    return linha;
  }
  let grupo = null;
  for (const i of r?.ingredientes || []) {
    if ((i.grupo || null) !== grupo) { grupo = i.grupo || null; if (grupo) listaIngredientes.append(linhaGrupo(grupo)); }
    listaIngredientes.append(linhaIngrediente(i));
  }
  if (!r?.ingredientes?.length) listaIngredientes.append(linhaIngrediente(), linhaIngrediente(), linhaIngrediente());

  // Utensílios: um por linha (frigideira, refratário, forma...)
  const listaUtensilios = el('div');
  function linhaUtensilio(nome = '') {
    const linha = el('div', { class: 'linha-grupo' },
      el('input', { type: 'text', placeholder: 'Ex.: frigideira', maxlength: 60, 'aria-label': 'Utensílio', value: nome }),
      el('button', { class: 'botao remover', type: 'button', 'aria-label': 'Remover utensílio', onclick: () => linha.remove() }, '×'));
    return linha;
  }
  for (const u of r?.utensilios || []) listaUtensilios.append(linhaUtensilio(u));
  if (!r?.utensilios?.length) listaUtensilios.append(linhaUtensilio());

  const observacoes = el('textarea', { maxlength: 3000, 'aria-label': 'Observações', placeholder: 'Dicas, variações, como guardar...' }, r?.observacoes || '');

  // Passos numerados, com grupos opcionais (ex.: Massa, Recheio, Cobertura).
  // A numeração segue corrida entre os grupos.
  const listaPassos = el('div');
  function renumerar() {
    [...listaPassos.querySelectorAll('.numero-passo')].forEach((n, i) => { n.textContent = `${i + 1}.`; });
  }
  // Foto do passo (versão 17): quadro do vídeo, print (na revisão) ou foto do aparelho.
  // linha._foto = { caminho } (já salva), { blob } (nova) ou null.
  const candidatosPasso = revisao?.candidatos || [];
  function controleFotoPasso(linha, inicial) {
    linha._foto = inicial || null;
    const miniatura = el('div', { class: 'foto-passo-mini', hidden: true });
    const entrada = el('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': 'Foto do passo do aparelho' });
    const escolha = el('div', { class: 'candidatos candidatos-passo', hidden: true });
    const botaoFoto = el('button', { class: 'botao pequeno', type: 'button' });
    const botaoTirar = el('button', { class: 'botao pequeno', type: 'button', hidden: true }, 'Sem foto');
    async function desenhar() {
      let url = null;
      if (linha._foto?.blob) { linha._foto.url ||= URL.createObjectURL(linha._foto.blob); url = linha._foto.url; }
      else if (linha._foto?.caminho) url = (await urlsDasImagens([linha._foto.caminho]))[linha._foto.caminho] || null;
      miniatura.replaceChildren(url ? el('img', { src: url, alt: 'Foto do passo' }) : '');
      miniatura.hidden = !url;
      botaoFoto.textContent = url ? '📷 Trocar foto' : '📷 Foto do passo';
      botaoTirar.hidden = !url;
    }
    const usar = (foto) => { linha._foto = foto; escolha.hidden = true; desenhar(); aoMudar(); };
    // A lista de imagens só é montada quando aberta (vídeo com 30 quadros x muitos passos).
    function montarEscolha() {
      if (escolha.childElementCount) return;
      candidatosPasso.forEach((c, i) => escolha.append(el('button', { class: 'candidato', type: 'button',
        'aria-label': `Usar imagem ${i + 1} neste passo`, onclick: () => usar({ blob: c.blob }) }, el('img', { src: c.url, alt: '' }))));
      escolha.append(el('button', { class: 'botao pequeno', type: 'button', onclick: () => entrada.click() }, 'Do aparelho…'));
    }
    botaoFoto.addEventListener('click', () => {
      if (!candidatosPasso.length) return entrada.click();
      montarEscolha();
      escolha.hidden = !escolha.hidden;
    });
    entrada.addEventListener('change', () => { if (entrada.files[0]) usar({ blob: entrada.files[0] }); entrada.value = ''; });
    botaoTirar.addEventListener('click', () => usar(null));
    desenhar();
    return el('div', { class: 'controle-foto-passo' }, miniatura, el('div', { class: 'acoes' }, botaoFoto, botaoTirar, entrada), escolha);
  }
  function linhaPasso(texto = '', foto = null) {
    const linha = el('div', { class: 'linha-passo', 'data-tipo': 'passo' });
    linha.append(
      el('span', { class: 'numero-passo' }),
      el('textarea', { maxlength: 2000, 'aria-label': 'Passo', placeholder: 'Descreva o passo' }, texto),
      el('button', { class: 'botao remover', type: 'button', 'aria-label': 'Remover passo', onclick: () => { linha.remove(); renumerar(); } }, '×'),
      controleFotoPasso(linha, foto));
    return linha;
  }
  function linhaGrupoPasso(nome = '') {
    const linha = el('div', { class: 'linha-grupo com-mover', 'data-tipo': 'grupo' },
      el('input', { type: 'text', placeholder: 'Nome do grupo (ex.: Recheio)', maxlength: 60, 'aria-label': 'Grupo do preparo', value: nome }),
      ...botoesMover(() => linha),
      el('button', { class: 'botao remover', type: 'button', 'aria-label': 'Remover grupo do preparo', onclick: () => linha.remove() }, '×'));
    return linha;
  }
  let grupoPasso = null;
  for (const p of r?.passos || []) {
    if ((p.grupo || null) !== grupoPasso) { grupoPasso = p.grupo || null; if (grupoPasso) listaPassos.append(linhaGrupoPasso(grupoPasso)); }
    listaPassos.append(linhaPasso(p.texto, p.imagem_caminho ? { caminho: p.imagem_caminho } : (p.foto || null)));
  }
  if (!r?.passos?.length) listaPassos.append(linhaPasso(), linhaPasso());
  renumerar();

  let tempoRascunho = null;
  /** O que está na tela agora, sem validar (para o rascunho da revisão). */
  function rascunhoDoFormulario() {
    const ingredientes = [];
    let g = null;
    for (const linha of listaIngredientes.children) {
      const c = linha.querySelectorAll('input');
      if (linha.dataset.tipo === 'grupo') { g = c[0].value.trim() || null; continue; }
      const qt = c[0].value.trim();
      if (!c[2].value.trim() && !qt && !c[1].value.trim()) continue;
      const q = lerQuantidade(qt);
      ingredientes.push({ grupo: g, quantidade: Number.isNaN(q) ? null : q, quantidade_texto: qt, unidade: c[1].value, nome: c[2].value,
        texto_original: linha.dataset.original || null });
    }
    const passos = [];
    let gp = null;
    for (const linha of listaPassos.children) {
      if (linha.dataset.tipo === 'grupo') { gp = linha.querySelector('input').value.trim() || null; continue; }
      const texto = linha.querySelector('textarea').value;
      const nCandidato = linha._foto?.blob ? candidatosPasso.findIndex(c => c.blob === linha._foto.blob) : -1;
      const foto = nCandidato >= 0 ? { candidato: nCandidato }
        : linha._foto?.blob ? { blob: linha._foto.blob } : linha._foto?.caminho ? { caminho: linha._foto.caminho } : null;
      if (texto.trim() || foto) passos.push({ grupo: gp, texto, foto });
    }
    return {
      dados: {
        titulo: titulo.value, categoria_id: categoria.value || null,
        etiquetas: etiquetas.value.split(',').map(x => x.trim()).filter(Boolean),
        porcoes_texto: porcoes.value, tempo_preparo_texto: tempoPreparo.value, tempo_total_texto: tempoTotal.value,
        ingredientes, passos,
        utensilios: [...listaUtensilios.querySelectorAll('input')].map(i => i.value).filter(x => x.trim()),
        observacoes: observacoes.value, fonte_url: fonteUrl.value, fonte_autor: fonteAutor.value, fonte_tipo: r?.fonte_tipo || 'manual'
      },
      capa: { blob: fotoNova || null, removida: removerFoto }
    };
  }

  const status = el('div', { class: 'status', role: 'status' });
  const botaoSalvar = el('button', { class: 'botao principal', type: 'button' }, 'Salvar');

  botaoSalvar.addEventListener('click', async () => {
    status.className = 'status';
    // Monta e valida os dados
    const erros = [];
    if (!titulo.value.trim()) erros.push('Informe o título.');
    const vPorcoes = lerQuantidade(porcoes.value);
    if (Number.isNaN(vPorcoes)) erros.push('Porções: use um número, ex.: 4.');
    const vPreparo = lerInteiro(tempoPreparo.value), vTotal = lerInteiro(tempoTotal.value);
    if (Number.isNaN(vPreparo) || Number.isNaN(vTotal)) erros.push('Tempos: use minutos inteiros, ex.: 45.');
    const url = fonteUrl.value.trim();
    if (url && !linkSeguro(url)) erros.push('Link da fonte: use um endereço começando com https://');

    const ingredientes = [];
    let grupoAtual = null;
    for (const linha of listaIngredientes.children) {
      const campos = linha.querySelectorAll('input');
      if (linha.dataset.tipo === 'grupo') { grupoAtual = campos[0].value.trim() || null; continue; }
      const nome = campos[2].value.trim();
      const qtdTexto = campos[0].value.trim();
      if (!nome && !qtdTexto && !campos[1].value.trim()) continue; // linha vazia
      if (!nome) { erros.push('Há ingrediente sem nome.'); continue; }
      const qtd = lerQuantidade(qtdTexto);
      if (Number.isNaN(qtd)) { erros.push(`Quantidade inválida em "${nome}". Use 2, 0,5 ou 1/2.`); continue; }
      ingredientes.push({ grupo: grupoAtual, quantidade: qtd, unidade: campos[1].value.trim(), nome,
        texto_original: linha.dataset.original || null });
    }
    const passos = [];
    let grupoDoPasso = null;
    for (const linha of listaPassos.children) {
      if (linha.dataset.tipo === 'grupo') { grupoDoPasso = linha.querySelector('input').value.trim() || null; continue; }
      const texto = linha.querySelector('textarea').value.trim();
      if (texto) passos.push({ grupo: grupoDoPasso, texto, foto: linha._foto || null });
    }
    if (passos.length > 60) erros.push('Máximo de 60 passos.');
    if (passos.filter(p => p.foto).length > MAX_FOTOS_PASSOS) erros.push(`Máximo de ${MAX_FOTOS_PASSOS} fotos nos passos.`);
    const utensilios = [...listaUtensilios.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
    if (utensilios.length > 30) erros.push('Máximo de 30 utensílios.');
    const listaEtiquetas = etiquetas.value.split(',').map(t => t.trim()).filter(Boolean).slice(0, 15);
    if (listaEtiquetas.some(t => t.length > 40)) erros.push('Cada etiqueta pode ter até 40 letras.');

    if (erros.length) { status.className = 'status erro'; status.textContent = erros.join(' '); return; }

    botaoSalvar.disabled = true;
    const enviadas = []; // fotos enviadas agora: apagadas se o salvamento falhar
    try {
      let caminhoImagem = removerFoto ? null : (r?.imagem_caminho || null);
      const caminhoAntigo = r?.imagem_caminho || null;
      if (fotoNova) {
        status.textContent = 'Enviando a foto…';
        caminhoImagem = `${estado.usuario.id}/${idReceita}-${Date.now()}.jpg`;
        const envio = await sb.storage.from(PASTA_IMAGENS).upload(caminhoImagem, fotoNova, { contentType: 'image/jpeg', upsert: false });
        if (envio.error) throw envio.error;
        enviadas.push(caminhoImagem);
      }
      // Fotos dos passos: reduz e envia só as novas; as já salvas seguem com o mesmo caminho.
      const novasDosPassos = passos.filter(p => p.foto?.blob);
      for (const [n, p] of novasDosPassos.entries()) {
        status.textContent = `Enviando fotos dos passos: ${n + 1} de ${novasDosPassos.length}…`;
        const blob = await comprimirImagem(p.foto.blob, LIMITE_FOTO_PASSO, 720);
        const caminho = `${estado.usuario.id}/passos/${idReceita}-${Date.now()}-${n + 1}.jpg`;
        const envio = await sb.storage.from(PASTA_IMAGENS).upload(caminho, blob, { contentType: 'image/jpeg', upsert: false });
        if (envio.error) throw envio.error;
        enviadas.push(caminho);
        p.foto = { caminho };
      }
      const passosSalvos = passos.map(p => ({ grupo: p.grupo, texto: p.texto, imagem_caminho: p.foto?.caminho || null }));
      status.textContent = 'Salvando…';
      const { error } = await sb.rpc('salvar_receita', {
        dados: {
          id: idReceita,
          titulo: titulo.value.trim(),
          categoria_id: categoria.value || null,
          porcoes: vPorcoes, tempo_preparo_min: vPreparo, tempo_total_min: vTotal,
          imagem_caminho: caminhoImagem,
          fonte_url: url || null,
          fonte_autor: fonteAutor.value.trim() || null,
          fonte_tipo: r?.fonte_tipo || 'manual',
          favorita: r?.favorita || false,
          ingredientes, passos: passosSalvos, etiquetas: listaEtiquetas,
          utensilios, observacoes: observacoes.value.trim() || null
        }
      });
      if (error) throw error;
      enviadas.length = 0;
      // Fotos antigas substituídas ou removidas (capa e passos): apaga do armazenamento.
      const usadasAgora = new Set([caminhoImagem, ...passosSalvos.map(p => p.imagem_caminho)].filter(Boolean));
      const antigas = [caminhoAntigo, ...(r?.passos || []).map(p => p.imagem_caminho)].filter(c => c && !usadasAgora.has(c));
      if (antigas.length) await sb.storage.from(PASTA_IMAGENS).remove(antigas);
      document.querySelectorAll('.linha-passo').forEach(l => { if (l._foto?.url) URL.revokeObjectURL(l._foto.url); });
      if (urlPrevia) URL.revokeObjectURL(urlPrevia);
      status.textContent = 'Atualizando a cópia no aparelho…';
      try { await atualizarColecao(); } catch { estado.colecao = null; /* a lista baixa de novo */ }
      clearTimeout(tempoRascunho);
      estado.formulario = null; // salvo: sair não pergunta nem guarda rascunho
      if (revisao) revisao.aoSalvar(idReceita);
      else location.hash = `#/receita/${idReceita}`;
    } catch (e) {
      if (enviadas.length) { try { await sb.storage.from(PASTA_IMAGENS).remove(enviadas); } catch { /* fica órfã, sem dano */ } }
      // As fotos dos passos continuam na tela: é só tocar em Salvar de novo.
      status.className = 'status erro';
      status.textContent = 'Não salvou: ' + erroAmigavel(e);
      botaoSalvar.disabled = false;
    }
  });

  const avisosIA = revisao ? el('div', { class: 'caixa-aviso' },
    el('strong', { text: 'Leitura da IA: confira antes de salvar.' }),
    revisao.aviso ? el('p', { text: revisao.aviso }) : null,
    revisao.duvidosos?.length ? el('p', {}, 'Não encontrei com certeza: ', revisao.duvidosos.join('; ') + '.') : null,
    el('div', { class: 'acoes' },
      el('button', { class: 'botao pequeno perigo', type: 'button', onclick: () => { clearTimeout(tempoRascunho); estado.formulario = null; revisao.aoDescartar(); } },
        revisao.total > 1 ? 'Descartar esta receita' : 'Descartar'))) : null;

  mostrar(el('section', {},
    el('p', {}, el('a', { href: revisao ? '#/nova' : (r?.id ? `#/receita/${r.id}` : '#/') }, revisao ? '← Nova importação' : '← Cancelar')),
    el('h1', { text: revisao ? `Revisar receita${revisao.total > 1 ? ` (${revisao.posicao} de ${revisao.total})` : ''}` : (r ? 'Editar receita' : 'Nova receita') }),
    avisosIA,
    el('div', { class: 'campo' }, el('span', { text: 'Foto' }),
      revisao?.candidatos?.length ? el('small', { class: 'ajuda', text: 'Toque numa imagem para escolher a capa.' }) : null,
      revisao?.candidatos?.length ? escolhaCapa : null,
      previa, el('div', { class: 'acoes' }, entradaFoto, botaoRemoverFoto), statusFoto),
    campo('Título', titulo),
    campo('Categoria', categoria, revisao ? 'sugerida pela IA' : null),
    campo('Etiquetas', etiquetas, revisao ? 'sugeridas pela IA, separadas por vírgula' : 'separadas por vírgula'),
    el('div', { class: 'linha-campos' },
      campo('Porções', porcoes), campo('Preparo', tempoPreparo, 'min'), campo('Total', tempoTotal, 'min')),
    el('h2', { text: 'Ingredientes' }),
    listaIngredientes,
    el('div', { class: 'acoes' },
      el('button', { class: 'botao pequeno', type: 'button', onclick: () => listaIngredientes.append(linhaIngrediente()) }, '+ Ingrediente'),
      el('button', { class: 'botao pequeno', type: 'button', onclick: () => listaIngredientes.append(linhaGrupo()) }, '+ Grupo')),
    el('h2', { text: 'Utensílios' }),
    listaUtensilios,
    el('div', { class: 'acoes' },
      el('button', { class: 'botao pequeno', type: 'button', onclick: () => listaUtensilios.append(linhaUtensilio()) }, '+ Utensílio')),
    el('h2', { text: 'Modo de preparo' }),
    listaPassos,
    el('div', { class: 'acoes' },
      el('button', { class: 'botao pequeno', type: 'button', onclick: () => { listaPassos.append(linhaPasso()); renumerar(); } }, '+ Passo'),
      el('button', { class: 'botao pequeno', type: 'button', onclick: () => listaPassos.append(linhaGrupoPasso()) }, '+ Grupo')),
    el('h2', { text: 'Observações' }),
    observacoes,
    el('h2', { text: 'Fonte' }),
    campo('Link', fonteUrl),
    campo('Autor', fonteAutor),
    el('div', { class: 'acoes' }, botaoSalvar),
    status
  ));
  desenharPrevia();

  // Versão 18: acompanha as mudanças do formulário.
  const meu = {
    hash: location.hash, sujo: false, ehRevisao: !!revisao?.guardar,
    guardar: () => { if (estado.formulario === meu && revisao?.guardar) revisao.guardar(rascunhoDoFormulario()); }
  };
  estado.formulario = meu;
  aoMudar = () => {
    if (estado.formulario !== meu) return;
    if (!meu.ehRevisao) { meu.sujo = true; return; }
    clearTimeout(tempoRascunho);
    tempoRascunho = setTimeout(meu.guardar, 800); // guarda o rascunho pouco depois da última mudança
  };
  const secao = app.firstElementChild;
  secao.addEventListener('input', aoMudar);
  secao.addEventListener('change', aoMudar);
  const observador = new MutationObserver(aoMudar); // linhas incluídas, removidas ou movidas
  for (const lista of [listaIngredientes, listaUtensilios, listaPassos]) observador.observe(lista, { childList: true });
}

// ---------------------------------------------------------------------
// Importação com IA (Entrega 2): legenda, prints e vídeo, juntos ou não.
// O aparelho prepara tudo (reduz imagens, tira quadros e áudio do vídeo)
// e a Edge Function "importar-receita" conversa com a IA.
// O vídeo em si nunca sai do aparelho.
// ---------------------------------------------------------------------
const LIMITE_VIDEO_S = 300;      // 5 minutos (decisão de 01/11/2026)
const MAX_PRINTS = 10;
const TAXA_AUDIO = 8000;         // 8 kHz mono: suficiente para fala

function blobParaBase64(blob) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).split(',')[1]);
    leitor.onerror = () => reject(new Error('Não consegui ler o arquivo'));
    leitor.readAsDataURL(blob);
  });
}

/** Reduz uma imagem para enviar à IA (lado maior até ladoMax, JPEG). */
async function reduzirImagem(fonte, ladoMax, qualidade) {
  const img = fonte instanceof Blob ? await carregarImagem(fonte) : fonte;
  const largura = img.videoWidth || img.width, altura = img.videoHeight || img.height;
  const escala = Math.min(1, ladoMax / Math.max(largura, altura));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(largura * escala);
  canvas.height = Math.round(altura * escala);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', qualidade));
  if (!blob) throw new Error('Não consegui preparar a imagem');
  return blob;
}

function esperarEvento(alvo, evento, msTempo, mensagemErro) {
  return new Promise((resolve, reject) => {
    const tempo = setTimeout(() => { limpar(); reject(new Error(mensagemErro)); }, msTempo);
    const ok = () => { limpar(); resolve(); };
    const falha = () => { limpar(); reject(new Error(mensagemErro)); };
    function limpar() { clearTimeout(tempo); alvo.removeEventListener(evento, ok); alvo.removeEventListener('error', falha); }
    alvo.addEventListener(evento, ok, { once: true });
    alvo.addEventListener('error', falha, { once: true });
  });
}

/** Lê a duração e tira quadros do vídeo (até 30, espalhados). */
/** Passos em blocos por grupo (Massa, Recheio...), com numeração corrida e foto do passo (versão 17). */
function passosAgrupados(passos, urls = {}, rotuloTimer = null) {
  const blocos = [];
  for (const p of passos) {
    const g = p.grupo || null;
    if (!blocos.length || blocos.at(-1).grupo !== g) blocos.push({ grupo: g, itens: [] });
    blocos.at(-1).itens.push(p);
  }
  let numero = 1;
  return el('div', {}, blocos.map(b => {
    const lista = el('ol', { class: 'passos', start: numero }, b.itens.map(p => {
      const url = p.imagem_caminho ? urls[p.imagem_caminho] : null;
      return el('li', { class: 'marcavel', onclick: (ev) => ev.currentTarget.classList.toggle('feito') },
        el('span', { class: 'texto-passo', text: p.texto }),
        botoesTimer(p.texto, rotuloTimer ? { ...rotuloTimer, passo: numero + b.itens.indexOf(p), grupo: p.grupo } : null),
        url ? el('img', { class: 'foto-passo', src: url, alt: `Foto do passo: ${p.texto.slice(0, 80)}`, loading: 'lazy' }) : null);
    }));
    numero += b.itens.length;
    return el('div', {}, b.grupo ? el('div', { class: 'grupo-titulo', text: b.grupo }) : null, lista);
  }));
}

/** Setas para subir ou descer uma linha (usadas nos grupos: os itens abaixo do grupo passam a ser dele). */
function botoesMover(linha) {
  return [
    el('button', { class: 'botao remover', type: 'button', 'aria-label': 'Subir grupo', title: 'Subir',
      onclick: () => { const l = linha(); if (l.previousElementSibling) l.previousElementSibling.before(l); } }, '↑'),
    el('button', { class: 'botao remover', type: 'button', 'aria-label': 'Descer grupo', title: 'Descer',
      onclick: () => { const l = linha(); if (l.nextElementSibling) l.nextElementSibling.after(l); } }, '↓')
  ];
}

async function quadrosDoVideo(arquivo, aoProgredir) {
  const url = URL.createObjectURL(arquivo);
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
  video.src = url;
  try {
    await esperarEvento(video, 'loadeddata', 20000, 'Não consegui abrir o vídeo neste aparelho.');
    const duracao = video.duration;
    if (!Number.isFinite(duracao) || duracao <= 0) throw new Error('Não consegui ler a duração do vídeo.');
    if (duracao > LIMITE_VIDEO_S + 0.5) {
      throw new Error(`O vídeo tem ${Math.floor(duracao / 60)} min ${Math.round(duracao % 60)} s. O limite é de 5 minutos.`);
    }
    const intervalo = Math.max(4, Math.round(duracao / 30));
    const quadros = [];
    for (let t = Math.min(1, duracao / 2); t < duracao && quadros.length < 30; t += intervalo) {
      video.currentTime = t;
      await esperarEvento(video, 'seeked', 8000, 'Não consegui tirar imagens do vídeo.');
      quadros.push(await reduzirImagem(video, 720, 0.7));
      aoProgredir?.(`Tirando imagens do vídeo: ${quadros.length}`);
    }
    return { duracao, intervalo, quadros };
  } finally {
    video.removeAttribute('src'); video.load();
    URL.revokeObjectURL(url);
  }
}

/** Extrai o áudio do vídeo em mono 8 kHz e devolve um arquivo WAV. */
async function audioDoVideo(arquivo, duracao) {
  const Contexto = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Contexto) throw new Error('Este navegador não extrai áudio.');
  const dados = await arquivo.arrayBuffer();
  const ctx = new Contexto(1, Math.ceil(TAXA_AUDIO * (duracao + 1)), TAXA_AUDIO);
  const buffer = await new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(dados, resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
  // Junta os canais em um (mono)
  const n = buffer.length, canais = buffer.numberOfChannels;
  const mono = new Float32Array(n);
  for (let c = 0; c < canais; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / canais;
  }
  // Monta o WAV (PCM 16 bits)
  const taxa = buffer.sampleRate;
  const wav = new DataView(new ArrayBuffer(44 + n * 2));
  const escrever = (pos, txt) => { for (let i = 0; i < txt.length; i++) wav.setUint8(pos + i, txt.charCodeAt(i)); };
  escrever(0, 'RIFF'); wav.setUint32(4, 36 + n * 2, true); escrever(8, 'WAVE');
  escrever(12, 'fmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
  wav.setUint32(24, taxa, true); wav.setUint32(28, taxa * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
  escrever(36, 'data'); wav.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, mono[i]));
    wav.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  // Áudio todo em silêncio (vídeo sem som): não vale enviar.
  let pico = 0;
  for (let i = 0; i < n; i += 50) pico = Math.max(pico, Math.abs(mono[i]));
  return { wav: new Blob([wav], { type: 'audio/wav' }), silencioso: pico < 0.01 };
}

/* Extrai a trilha de áudio AAC de um vídeo MP4/MOV sem decodificar o som:
   lê a "tabela de conteúdo" do arquivo (caixa moov), localiza cada pedaço de
   áudio e monta um arquivo .aac (formato ADTS). Funciona no iPhone, onde o
   navegador não decodifica áudio de dentro de vídeo. */
const MAX_AUDIO_AAC = 6_500_000; // ~5 min a 160 kbps

async function lerFatia(arquivo, inicio, tamanho) {
  return new DataView(await arquivo.slice(inicio, inicio + tamanho).arrayBuffer());
}

function caixas(dv, inicio, fim) {
  const lista = [];
  let pos = inicio;
  while (pos + 8 <= fim) {
    let tam = dv.getUint32(pos);
    const tipo = String.fromCharCode(dv.getUint8(pos + 4), dv.getUint8(pos + 5), dv.getUint8(pos + 6), dv.getUint8(pos + 7));
    let cab = 8;
    if (tam === 1) { tam = Number(dv.getBigUint64(pos + 8)); cab = 16; }
    else if (tam === 0) tam = fim - pos;
    if (tam < cab || pos + tam > fim) break;
    lista.push({ tipo, ini: pos + cab, fim: pos + tam });
    pos += tam;
  }
  return lista;
}
const filha = (dv, caixa, tipo) => caixas(dv, caixa.ini, caixa.fim).find(c => c.tipo === tipo);

async function acharMoov(arquivo) {
  let pos = 0;
  while (pos + 8 <= arquivo.size) {
    const dv = await lerFatia(arquivo, pos, 16);
    let tam = dv.getUint32(0);
    const tipo = String.fromCharCode(dv.getUint8(4), dv.getUint8(5), dv.getUint8(6), dv.getUint8(7));
    if (tam === 1) tam = Number(dv.getBigUint64(8));
    else if (tam === 0) tam = arquivo.size - pos;
    if (tam < 8) break;
    if (tipo === 'moov') {
      if (tam > 50_000_000) throw new Error('Cabeçalho do vídeo grande demais');
      return lerFatia(arquivo, pos, tam);
    }
    pos += tam;
  }
  throw new Error('Vídeo sem cabeçalho MP4');
}

function tamanhoDescritor(dv, pos) {
  let tam = 0, n = 0, b;
  do { b = dv.getUint8(pos + n); tam = (tam << 7) | (b & 0x7f); n++; } while (b & 0x80 && n < 4);
  return { tam, n };
}

/** Lê a configuração AAC (tipo, taxa, canais) de dentro da caixa esds. */
function configuracaoAac(dv, ini, fim) {
  // procura a caixa esds dentro da entrada de áudio (pode estar dentro de "wave")
  for (let p = ini; p + 8 < fim; p++) {
    if (dv.getUint32(p + 4) !== 0x65736473) continue; // 'esds'
    let q = p + 12; // tamanho + tipo + versão/flags
    const lim = p + dv.getUint32(p);
    while (q < lim) {
      const tag = dv.getUint8(q);
      const { tam, n } = tamanhoDescritor(dv, q + 1);
      const corpo = q + 1 + n;
      if (tag === 0x03) { // ES_Descriptor
        const flags = dv.getUint8(corpo + 2);
        q = corpo + 3 + (flags & 0x80 ? 2 : 0) + (flags & 0x40 ? 1 + dv.getUint8(corpo + 3) : 0) + (flags & 0x20 ? 2 : 0);
      } else if (tag === 0x04) { // DecoderConfigDescriptor
        if (dv.getUint8(corpo) !== 0x40) throw new Error('O áudio do vídeo não é AAC');
        q = corpo + 13;
      } else if (tag === 0x05) { // AudioSpecificConfig
        const b0 = dv.getUint8(corpo), b1 = dv.getUint8(corpo + 1);
        let tipo = b0 >> 3;
        const freq = ((b0 & 7) << 1) | (b1 >> 7);
        const canais = (b1 >> 3) & 0xf;
        if (tipo === 5 || tipo === 29) tipo = 2; // HE-AAC: o ADTS leva a camada básica
        if (freq > 12 || tipo < 1 || tipo > 4 || canais < 1 || canais > 7) throw new Error('Formato de áudio não suportado');
        return { perfil: tipo - 1, freq, canais };
      } else {
        q = corpo + tam;
      }
    }
  }
  throw new Error('Configuração de áudio não encontrada');
}

async function audioAacDoVideo(arquivo) {
  const moov = await acharMoov(arquivo);
  const raiz = { ini: 8, fim: moov.byteLength };
  for (const trak of caixas(moov, raiz.ini, raiz.fim).filter(c => c.tipo === 'trak')) {
    const mdia = filha(moov, trak, 'mdia'); if (!mdia) continue;
    const hdlr = filha(moov, mdia, 'hdlr');
    if (!hdlr || moov.getUint32(hdlr.ini + 8) !== 0x736f756e) continue; // 'soun'
    const minf = filha(moov, mdia, 'minf');
    const stbl = minf && filha(moov, minf, 'stbl');
    if (!stbl) continue;
    const stsd = filha(moov, stbl, 'stsd'), stsz = filha(moov, stbl, 'stsz'), stsc = filha(moov, stbl, 'stsc');
    const stco = filha(moov, stbl, 'stco') || filha(moov, stbl, 'co64');
    if (!stsd || !stsz || !stsc || !stco) continue;
    const entrada = caixas(moov, stsd.ini + 8, stsd.fim)[0];
    if (!entrada || entrada.tipo !== 'mp4a') throw new Error('O áudio do vídeo não é AAC');
    const cfg = configuracaoAac(moov, entrada.ini, entrada.fim);

    // Tamanho de cada pedaço (amostra) de áudio
    const tamFixo = moov.getUint32(stsz.ini + 4), qtd = moov.getUint32(stsz.ini + 8);
    const tamanhos = new Array(qtd);
    for (let i = 0; i < qtd; i++) tamanhos[i] = tamFixo || moov.getUint32(stsz.ini + 12 + i * 4);
    // Onde começa cada bloco (chunk) e quantas amostras ele tem
    const is64 = stco.tipo === 'co64', nBlocos = moov.getUint32(stco.ini + 4);
    const inicioBloco = i => is64 ? Number(moov.getBigUint64(stco.ini + 8 + i * 8)) : moov.getUint32(stco.ini + 8 + i * 4);
    const nRegras = moov.getUint32(stsc.ini + 4);
    const regras = Array.from({ length: nRegras }, (_, i) => ({
      primeiro: moov.getUint32(stsc.ini + 8 + i * 12), amostras: moov.getUint32(stsc.ini + 12 + i * 12)
    }));
    const total = tamanhos.reduce((a, b) => a + b, 0) + qtd * 7;
    if (total > MAX_AUDIO_AAC) throw new Error('Áudio grande demais');
    const saida = new Uint8Array(total);
    let escrita = 0, amostra = 0;
    for (let b = 0; b < nBlocos && amostra < qtd; b++) {
      let r = regras.length - 1;
      while (r > 0 && regras[r].primeiro > b + 1) r--;
      const n = Math.min(regras[r].amostras, qtd - amostra);
      let bytesBloco = 0;
      for (let k = 0; k < n; k++) bytesBloco += tamanhos[amostra + k];
      const dados = new Uint8Array(await arquivo.slice(inicioBloco(b), inicioBloco(b) + bytesBloco).arrayBuffer());
      let p = 0;
      for (let k = 0; k < n; k++, amostra++) {
        const tam = tamanhos[amostra], len = tam + 7;
        saida.set([0xff, 0xf1, (cfg.perfil << 6) | (cfg.freq << 2) | (cfg.canais >> 2),
          ((cfg.canais & 3) << 6) | (len >> 11), (len >> 3) & 0xff, ((len & 7) << 5) | 0x1f, 0xfc], escrita);
        saida.set(dados.subarray(p, p + tam), escrita + 7);
        escrita += len; p += tam;
      }
    }
    return new Blob([saida.subarray(0, escrita)], { type: 'audio/aac' });
  }
  throw new Error('O vídeo não tem trilha de áudio');
}

/** Base64 (vindo da função) para arquivo de imagem no aparelho. */
function base64ParaBlob(dados, mime) {
  const bin = atob(dados);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// ---------------------------------------------------------------------
// Versão 16: receitas salvas no Instagram. Duas formas, uma por vez:
//  - colar a legenda (e o link) aqui;
//  - botão "Enviar para Receitas" da extensão do Chrome (pasta
//    extensao-chrome do projeto), que lê o post na tela do próprio Rafael
//    e entrega legenda, link, autor e foto a esta tela.
// O Instagram não deixa a função da IA abrir o post (bloqueia servidores),
// então com legenda ou imagens o link do Instagram vira só a fonte.
// ---------------------------------------------------------------------
const MENSAGEM_EXTENSAO = 'receitas-na-mao/';

/** Instagram e Facebook: o servidor não consegue abrir o post. */
function redeSemLeitura(url) {
  try { return /(^|\.)(instagram\.com|instagr\.am|facebook\.com|fb\.watch)$/i.test(new URL(url).hostname); } catch { return false; }
}

/** Identidade do link para achar receita repetida (código do post, vídeo ou endereço). */
function chaveDoLink(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
    if (/^(instagram\.com|instagr\.am)$/.test(host)) {
      const m = u.pathname.match(/\/(?:p|reels?|tv)\/([\w-]+)/);
      if (m) return 'ig:' + m[1];
    }
    if (host === 'youtu.be') return 'yt:' + u.pathname.split('/')[1];
    if (/(^|\.)youtube\.com$/.test(host)) {
      const id = u.searchParams.get('v') || u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]+)/)?.[1];
      if (id) return 'yt:' + id;
    }
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|igsh|si$)/i.test(k)) u.searchParams.delete(k);
    return host + u.pathname.replace(/\/+$/, '') + (u.searchParams.toString() ? '?' + u.searchParams : '');
  } catch { return null; }
}

function receitaComMesmoLink(url) {
  const chave = chaveDoLink(url);
  if (!chave) return null;
  return (estado.colecao?.receitas || []).find(r => r.fonte_url && chaveDoLink(r.fonte_url) === chave) || null;
}

/** Confere o que a extensão mandou (nunca confiar no formato). */
function postValido(d) {
  if (!d || typeof d !== 'object') return null;
  const link = typeof d.link === 'string' ? linkSeguro(d.link) : null;
  if (!link || !redeSemLeitura(link)) return null;
  const legenda = typeof d.legenda === 'string' ? d.legenda.slice(0, 20000) : '';
  const autor = typeof d.autor === 'string' && /^@?[\w.]{1,40}$/.test(d.autor) ? '@' + d.autor.replace(/^@/, '') : null;
  let imagem = null;
  const i = d.imagem;
  if (i && /^image\/(jpeg|png|webp)$/.test(i.mime) && typeof i.dados === 'string' && i.dados.length < 7_000_000) {
    try { imagem = new File([base64ParaBlob(i.dados, i.mime)], 'post-instagram.' + i.mime.split('/')[1], { type: i.mime }); } catch { /* sem a foto */ }
  }
  return { link, legenda, autor, imagem };
}

/** Pede à extensão o post guardado. Sem a extensão (iPhone, outro navegador), nada acontece. */
function pedirPostDaExtensao(aoReceber) {
  const ouvir = (ev) => {
    if (ev.source !== window || ev.origin !== location.origin || ev.data?.tipo !== MENSAGEM_EXTENSAO + 'post') return;
    window.removeEventListener('message', ouvir);
    const p = postValido(ev.data.dados);
    if (p) aoReceber(p);
  };
  window.addEventListener('message', ouvir);
  setTimeout(() => window.removeEventListener('message', ouvir), 5000);
  window.postMessage({ tipo: MENSAGEM_EXTENSAO + 'pedir-post' }, location.origin);
}

// A extensão avisa quando há post novo com o app já aberto: vai para a Nova receita,
// sem sair de uma revisão ou edição em andamento.
window.addEventListener('message', (ev) => {
  if (ev.source !== window || ev.origin !== location.origin || ev.data?.tipo !== MENSAGEM_EXTENSAO + 'post-disponivel') return;
  if (!estado.usuario || !estado.titular) return;
  if (/^#\/(revisar|editar|manual)/.test(location.hash)) return;
  if (location.hash === '#/nova') telaImportar(); else location.hash = '#/nova';
});

function telaImportar() {
  const legenda = el('textarea', { maxlength: 20000, 'aria-label': 'Legenda ou texto da receita',
    placeholder: 'Cole aqui a legenda do post ou o texto da receita (opcional)' });
  const entradaImagens = el('input', { type: 'file', accept: 'image/*', multiple: true, 'aria-label': 'Prints ou fotos' });
  const entradaVideo = el('input', { type: 'file', accept: 'video/*', 'aria-label': 'Vídeo' });
  const link = el('input', { type: 'url', maxlength: 2000, inputmode: 'url', autocomplete: 'off',
    placeholder: 'https:// site de receita, YouTube, Instagram ou TikTok', 'aria-label': 'Link da receita' });
  const avisoRepetida = el('p', { class: 'aviso-repetida', role: 'status', hidden: true });
  const conferirRepetida = () => {
    const valor = link.value.trim();
    const r = linkSeguro(valor) ? receitaComMesmoLink(valor) : null;
    avisoRepetida.hidden = !r;
    if (r) avisoRepetida.replaceChildren('Você já tem esta receita: ', el('a', { href: `#/receita/${r.id}`, text: r.titulo }), '. Se ler de novo, vai criar outra.');
    return r;
  };
  link.addEventListener('input', conferirRepetida);
  let autorExtensao = null;
  const resumo = el('p', { class: 'ajuda' });
  const status = el('div', { class: 'status', role: 'status' });
  const botao = el('button', { class: 'botao principal', type: 'button' }, 'Ler receita com IA');
  const botaoCancelar = el('button', { class: 'botao perigo', type: 'button', hidden: true }, 'Cancelar');
  let controle = null;      // interrompe o envio à IA
  let cancelado = false;    // interrompe o preparo do vídeo e das imagens
  const CANCELADO = 'Leitura cancelada. Nada foi salvo.';
  const conferirCancelado = () => { if (cancelado) throw new Error(CANCELADO); };
  botaoCancelar.addEventListener('click', () => {
    cancelado = true;
    controle?.abort();
    botaoCancelar.disabled = true;
    botaoCancelar.textContent = 'Cancelando…';
  });

  const atualizarResumo = () => {
    const partes = [];
    if (link.value.trim()) partes.push('link');
    if (legenda.value.trim()) partes.push('legenda');
    if (entradaImagens.files.length) partes.push(`${entradaImagens.files.length} imagem(ns)`);
    if (entradaVideo.files.length) partes.push('1 vídeo');
    resumo.textContent = partes.length ? 'Vai enviar: ' + partes.join(' + ') + '.' : 'Use uma ou mais opções. Site ou YouTube: só o link basta. Instagram: link + legenda (e o vídeo, se a receita for falada).';
  };
  [link, legenda, entradaImagens, entradaVideo].forEach(e => e.addEventListener('input', atualizarResumo));
  entradaImagens.addEventListener('change', atualizarResumo);
  entradaVideo.addEventListener('change', atualizarResumo);
  atualizarResumo();

  botao.addEventListener('click', async () => {
    status.className = 'status';
    if (revisaoPendente() && !confirm('Há uma revisão em andamento. Ler outra receita agora descarta a anterior. Continuar?')) return;
    const texto = legenda.value.trim();
    const imagens = [...entradaImagens.files].slice(0, MAX_PRINTS);
    const video = entradaVideo.files[0] || null;
    const linkFonte = link.value.trim();
    if (!texto && !imagens.length && !video && !linkFonte) { status.className = 'status erro'; status.textContent = 'Cole um link ou a legenda, ou escolha imagens ou um vídeo.'; return; }
    if (linkFonte && !linkSeguro(linkFonte)) { status.className = 'status erro'; status.textContent = 'Link: copie o endereço completo, começando com https://'; return; }
    if (entradaImagens.files.length > MAX_PRINTS) { status.textContent = `Usando só as ${MAX_PRINTS} primeiras imagens.`; }
    // Instagram/Facebook com legenda, prints ou vídeo: o link vai só como fonte (o servidor seria bloqueado).
    const linkSoFonte = !!linkFonte && redeSemLeitura(linkFonte) && !!(texto || imagens.length || video);

    botao.disabled = true;
    cancelado = false;
    controle = new AbortController();
    botaoCancelar.hidden = false; botaoCancelar.disabled = false; botaoCancelar.textContent = 'Cancelar';
    const inicio = Date.now();
    const relogio = setInterval(() => { botao.textContent = `Lendo… ${Math.round((Date.now() - inicio) / 1000)} s`; }, 1000);
    const avisos = [];
    try {
      const corpo = { texto, link: (linkFonte && !linkSoFonte) ? linkFonte : undefined, imagens: [], quadros: [], categorias: estado.categorias.filter(c => c.ativa).map(c => c.nome) };
      const candidatos = [];
      for (const [i, f] of imagens.entries()) {
        conferirCancelado();
        status.textContent = `Preparando imagem ${i + 1} de ${imagens.length}…`;
        const b = await reduzirImagem(f, 1280, 0.8);
        corpo.imagens.push({ mime: 'image/jpeg', dados: await blobParaBase64(b) });
        candidatos.push({ blob: f, url: URL.createObjectURL(b), doLink: f.name.startsWith('post-instagram.') });
      }
      if (video) {
        status.textContent = 'Abrindo o vídeo…';
        const v = await quadrosDoVideo(video, t => { conferirCancelado(); status.textContent = t; });
        corpo.intervalo_quadros_s = v.intervalo;
        for (const q of v.quadros) {
          corpo.quadros.push({ mime: 'image/jpeg', dados: await blobParaBase64(q) });
          candidatos.push({ blob: q, url: URL.createObjectURL(q) });
        }
        conferirCancelado();
        status.textContent = 'Separando o áudio do vídeo…';
        // 1º: copia o áudio AAC direto do arquivo (funciona no iPhone).
        // 2º: se não der, decodifica e gera WAV (funciona no Chrome do Windows).
        try {
          const aac = await audioAacDoVideo(video);
          corpo.audio = { mime: 'audio/aac', dados: await blobParaBase64(aac) };
        } catch (erroAac) {
          try {
            const a = await audioDoVideo(video, v.duracao);
            if (a.silencioso) avisos.push('O vídeo não tem fala; a IA usou só as imagens.');
            else corpo.audio = { mime: 'audio/wav', dados: await blobParaBase64(a.wav) };
          } catch {
            avisos.push(/não tem trilha/.test(erroAac.message) ? 'O vídeo não tem áudio; a IA usou só as imagens.'
              : 'Não consegui ler o áudio do vídeo neste aparelho; a IA usou só as imagens.');
          }
        }
      }
      conferirCancelado();
      status.textContent = (linkFonte && !linkSoFonte) ? 'Abrindo o link e lendo a receita com a IA…' : 'A IA está lendo a receita…';
      const { data } = await sb.auth.getSession();
      if (!data.session) throw new Error('Sua sessão expirou. Entre de novo.');
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/importar-receita`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}`, apikey: SUPABASE_CHAVE_PUBLICA },
        body: JSON.stringify(corpo),
        signal: controle.signal
      });
      const json = await resp.json().catch(() => ({}));
      conferirCancelado();
      if (!resp.ok) throw new Error(json.erro || `Erro ${resp.status} na importação.`);
      if (!json.receitas?.length) throw new Error(json.aviso || 'A IA não encontrou receita nesse conteúdo.');

      // Foto do site ou miniatura do vídeo: entra por último entre as opções de capa.
      const imagemLink = json.link?.imagem;
      if (imagemLink && /^image\/(jpeg|png|webp)$/.test(imagemLink.mime) && typeof imagemLink.dados === 'string') {
        try {
          const b = base64ParaBlob(imagemLink.dados, imagemLink.mime);
          candidatos.push({ blob: b, url: URL.createObjectURL(b), doLink: true });
        } catch { /* sem a foto do link */ }
      }

      await descartarRevisao(); // a leitura nova substitui uma revisão antiga, se havia
      estado.importacao = {
        receitas: json.receitas, candidatos, link: linkSeguro(json.link?.url || linkFonte) || null, importacaoId: json.importacao_id,
        fonteTipo: json.link ? json.link.tipo : linkSoFonte ? 'rede' : (video ? 'video' : (imagens.length ? 'print' : 'legenda')),
        autorLink: json.link?.autor || autorExtensao || null,
        aviso: [json.aviso, ...avisos].filter(Boolean).join(' '),
        prints: imagens.length, indice: 0, ultimaSalva: null
      };
      await guardarRascunho(); // versão 18: a leitura da IA não se perde se o app fechar
      location.hash = '#/revisar';
    } catch (e) {
      status.className = cancelado ? 'status' : 'status erro';
      status.textContent = cancelado ? CANCELADO : erroAmigavel(e);
    } finally {
      clearInterval(relogio);
      controle = null;
      botao.disabled = false;
      botao.textContent = 'Ler receita com IA';
      botaoCancelar.hidden = true;
    }
  });

  mostrar(el('section', {},
    el('p', {}, el('a', { href: '#/' }, '← Voltar')),
    el('h1', { text: 'Nova receita' }),
    avisoRevisaoPendente(),
    el('p', { class: 'ajuda' }, 'A IA lê o link, a legenda, os prints e o vídeo e monta a receita para você revisar. ',
      el('a', { href: '#/manual' }, 'Prefere digitar? Cadastro manual')),
    el('label', { class: 'campo' }, el('span', {}, 'Link ', el('small', { text: 'site de receita e YouTube funcionam sozinhos; no Instagram, cole também a legenda' })), link, avisoRepetida),
    el('label', { class: 'campo' }, el('span', { text: 'Legenda ou texto' }), legenda),
    el('label', { class: 'campo' }, el('span', {}, 'Prints ou fotos ', el('small', { text: `até ${MAX_PRINTS}` })), entradaImagens),
    el('label', { class: 'campo' }, el('span', {}, 'Vídeo ', el('small', { text: 'até 5 minutos; o vídeo não é enviado, só imagens e áudio' })), entradaVideo),
    resumo,
    el('div', { class: 'acoes' }, botao, botaoCancelar),
    status
  ));

  // Post enviado pela extensão do Chrome: preenche e, com legenda, já manda ler.
  pedirPostDaExtensao((p) => {
    if (!link.isConnected) return;
    link.value = p.link;
    legenda.value = p.legenda;
    autorExtensao = p.autor;
    if (p.imagem) { const dt = new DataTransfer(); dt.items.add(p.imagem); entradaImagens.files = dt.files; }
    atualizarResumo();
    if (revisaoPendente()) {
      status.className = 'status erro';
      status.textContent = 'Post recebido do Instagram. Termine ou descarte a revisão em andamento (acima) e toque em "Ler receita com IA".';
    } else if (conferirRepetida()) {
      status.className = 'status erro';
      status.textContent = 'Post recebido do Instagram, mas você já tem esta receita (veja acima). Para ler de novo, toque em "Ler receita com IA".';
    } else if (p.legenda.trim().length >= 40) {
      status.className = 'status';
      status.textContent = 'Post recebido do Instagram.';
      botao.click();
    } else {
      status.className = 'status erro';
      status.textContent = 'Post recebido, mas quase sem legenda (a receita deve estar falada no vídeo). Baixe o vídeo e escolha em "Vídeo", ou mande prints.';
    }
  });
}

/** Mostra a receita lida pela IA no formulário, uma de cada vez. */
async function telaRevisao() {
  const imp = estado.importacao;
  if (!imp || imp.indice >= imp.receitas.length) { location.hash = '#/nova'; return; }
  const rec = imp.receitas[imp.indice];
  const catId = estado.categorias.find(c => c.nome === rec.categoria)?.id || null;
  // Capa sugerida: a imagem indicada pela IA; num post com várias receitas e
  // uma imagem por receita, a imagem de mesma posição.
  let capa = Number.isInteger(rec.indice_imagem_capa) ? rec.indice_imagem_capa - 1 : null;
  if (capa === null && imp.receitas.length > 1 && imp.prints >= imp.receitas.length) capa = imp.indice;
  // Sem sugestão da IA: usa a foto do site ou a miniatura do vídeo, se houver.
  if (capa === null) { const i = imp.candidatos.findIndex(c => c.doLink); if (i >= 0) capa = i; }
  const proxima = () => {
    imp.indice++;
    imp.formulario = null; // o rascunho era da receita que acabou de ser salva ou descartada
    if (imp.indice < imp.receitas.length) { guardarRascunho(); telaRevisao(); }
    else {
      imp.candidatos.forEach(c => URL.revokeObjectURL(c.url));
      estado.importacao = null;
      guardarRascunho(); // apaga o rascunho
      location.hash = imp.ultimaSalva ? `#/receita/${imp.ultimaSalva}` : '#/';
    }
  };
  await telaFormulario(null, {
    // Versão 18: se havia correções guardadas (rascunho), a revisão continua delas.
    capaGuardada: imp.formulario?.capa || null,
    guardar: (rascunho) => { if (estado.importacao === imp) { imp.formulario = rascunho; guardarFormularioDoRascunho(); } },
    dados: imp.formulario?.dados ? {
      ...imp.formulario.dados,
      // foto de passo escolhida entre as imagens enviadas: guardada pelo número, não pela imagem
      passos: imp.formulario.dados.passos.map(p => ({ ...p,
        foto: Number.isInteger(p.foto?.candidato) ? (imp.candidatos[p.foto.candidato] ? { blob: imp.candidatos[p.foto.candidato].blob } : null) : p.foto }))
    } : {
      titulo: rec.titulo, categoria_id: catId, etiquetas: rec.etiquetas, porcoes: rec.porcoes,
      tempo_preparo_min: rec.tempo_preparo_min, tempo_total_min: rec.tempo_total_min,
      ingredientes: rec.ingredientes.map(i => ({ ...i, nome: i.observacao ? `${i.nome} (${i.observacao})` : i.nome })),
      // Foto do passo sugerida pela IA (versão 17): o número da imagem enviada (prints, depois quadros do vídeo).
      passos: rec.passos.map(p => typeof p === 'string' ? { grupo: null, texto: p } : {
        grupo: p.grupo || null, texto: p.texto,
        foto: Number.isInteger(p.indice_imagem) && imp.candidatos[p.indice_imagem - 1] && !imp.candidatos[p.indice_imagem - 1].doLink
          ? { blob: imp.candidatos[p.indice_imagem - 1].blob } : null }), utensilios: rec.utensilios, observacoes: rec.observacoes,
      fonte_url: imp.link, fonte_autor: rec.autor || imp.autorLink, fonte_tipo: imp.fonteTipo
    },
    candidatos: imp.candidatos, capaIndice: capa,
    aviso: imp.indice === 0 ? imp.aviso : null, duvidosos: rec.campos_duvidosos,
    posicao: imp.indice + 1, total: imp.receitas.length,
    aoSalvar: async (idSalvo) => {
      if (imp.importacaoId && !imp.ultimaSalva) {
        await sb.from('importacoes').update({ receita_id: idSalvo }).eq('id', imp.importacaoId);
      }
      imp.ultimaSalva = idSalvo;
      proxima();
    },
    aoDescartar: proxima
  });
}

async function telaAjustes() {
  const c = estado.colecao;
  const fotos = (await chavesLocal('capas')).length;
  const plural = (n, palavra) => `${n} ${palavra}${n === 1 ? '' : 's'}`;
  const copia = el('span', { text: c ? `${plural(c.receitas.length, 'receita')}, ${plural(fotos, 'foto')}, atualizada em ${dataHoraCurta(c.salva_em)}` : 'ainda não feita' });
  const status = el('div', { class: 'status', role: 'status' });
  mostrar(el('section', {},
    el('p', {}, el('a', { href: '#/' }, '← Voltar')),
    el('h1', { text: 'Ajustes' }),
    el('ul', { class: 'lista-info' },
      el('li', {}, el('span', { text: 'Conta' }), el('span', { text: estado.usuario?.email || '' })),
      el('li', {}, el('span', { text: 'Versão do app' }), el('span', { text: VERSAO })),
      el('li', {}, el('span', { text: 'Cópia sem internet' }), copia),
      estado.titular ? null : el('li', {}, el('span', { text: 'Tipo de conta' }), el('span', { text: 'Só leitura (receitas compartilhadas com você)' }))),
    el('p', { class: 'ajuda', text: 'O app guarda todas as receitas e fotos neste aparelho e atualiza a cópia sempre que abre com internet. Sem internet dá para ver, buscar e abrir receitas; importar, salvar, editar e excluir precisam de conexão.' }),
    el('div', { class: 'acoes' },
      el('button', {
        class: 'botao', type: 'button', disabled: estado.semConexao,
        onclick: async (ev) => {
          const botao = ev.currentTarget; // depois de um await, ev.currentTarget já é null
          botao.disabled = true; status.textContent = 'Atualizando…';
          // Só redesenha os Ajustes se o usuário ainda estiver neles.
          try { await atualizarColecao(); await baixarCapas(estado.colecao); if (location.hash === '#/ajustes') telaAjustes(); }
          catch (e) { status.textContent = erroAmigavel(e); botao.disabled = false; }
        }
      }, 'Atualizar cópia agora'),
      el('button', {
        class: 'botao', type: 'button',
        onclick: async () => {
          await limparCopiaLocal();
          try { await sb.auth.signOut(); } catch { /* sem internet: a sessão local é apagada mesmo assim */ }
          estado.urlsAssinadas.clear(); estado.usuario = null; estado.semConexao = false; estado.semSessao = false;
          location.hash = '#/'; mostrarFaixa(); telaLogin();
        }
      }, 'Sair')),
    el('p', { class: 'ajuda', text: 'Sair apaga a cópia guardada neste aparelho.' }),
    status,
    estado.titular ? secaoBackup() : null,
    estado.titular ? el('div', {}, el('h2', { text: 'Categorias' }),
      el('a', { class: 'botao', href: '#/categorias' }, 'Editar categorias')) : null,
    estado.titular ? secaoLeitores() : null
  ));
}

// ---------------------------------------------------------------------
// Navegação (rotas pelo trecho depois do # no endereço)
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Versão 18: trabalho não salvo.
//  - Edição e cadastro manual: sair com mudanças pede confirmação.
//  - Revisão da IA: tudo o que foi lido e corrigido fica guardado no
//    aparelho (rascunho) até Salvar ou Descartar; sobrevive a Voltar,
//    a recarregar a página e ao iPhone fechar o app em segundo plano.
// ---------------------------------------------------------------------
const CHAVE_RASCUNHO = 'rascunho-importacao';
const VALIDADE_RASCUNHO_MS = 7 * 24 * 60 * 60 * 1000;

function revisaoPendente() {
  const imp = estado.importacao;
  return imp && imp.indice < imp.receitas.length ? imp : null;
}
const CHAVE_RASCUNHO_FORMULARIO = 'rascunho-formulario';
/** Guarda a leitura da IA (com as imagens). Chamada ao ler e ao passar para a próxima receita. */
async function guardarRascunho() {
  const imp = revisaoPendente();
  if (!imp || !estado.usuario) {
    await apagarLocal('dados', CHAVE_RASCUNHO);
    await apagarLocal('dados', CHAVE_RASCUNHO_FORMULARIO);
    return;
  }
  await gravarLocal('dados', CHAVE_RASCUNHO, {
    ...imp, formulario: null, candidatos: imp.candidatos.map(c => ({ blob: c.blob, doLink: !!c.doLink })),
    usuario_id: estado.usuario.id, guardado_em: Date.now()
  });
  await guardarFormularioDoRascunho();
}
/** Guarda só as correções digitadas (pequeno; as imagens grandes não são regravadas a cada mudança). */
function guardarFormularioDoRascunho() {
  const imp = revisaoPendente();
  if (!imp?.formulario) return apagarLocal('dados', CHAVE_RASCUNHO_FORMULARIO);
  return gravarLocal('dados', CHAVE_RASCUNHO_FORMULARIO, { indice: imp.indice, formulario: imp.formulario });
}
async function recuperarRascunho() {
  if (estado.importacao || !estado.titular || !estado.usuario) return;
  const r = await lerLocal('dados', CHAVE_RASCUNHO);
  if (!r) return;
  const valido = r.usuario_id === estado.usuario.id && Date.now() - r.guardado_em < VALIDADE_RASCUNHO_MS
    && Array.isArray(r.receitas) && Array.isArray(r.candidatos) && Number.isInteger(r.indice) && r.indice < r.receitas.length
    && r.candidatos.every(c => c && c.blob instanceof Blob);
  if (!valido) { await apagarLocal('dados', CHAVE_RASCUNHO); await apagarLocal('dados', CHAVE_RASCUNHO_FORMULARIO); return; }
  r.candidatos = r.candidatos.map(c => ({ ...c, url: URL.createObjectURL(c.blob) }));
  const f = await lerLocal('dados', CHAVE_RASCUNHO_FORMULARIO);
  r.formulario = f && f.indice === r.indice && f.formulario?.dados ? f.formulario : null;
  estado.importacao = r;
}
function descartarRevisao() {
  estado.importacao?.candidatos?.forEach(c => { try { URL.revokeObjectURL(c.url); } catch { /* já liberado */ } });
  estado.importacao = null;
  return guardarRascunho();
}
function avisoRevisaoPendente() {
  const imp = revisaoPendente();
  if (!imp || !estado.titular) return null;
  const faltam = imp.receitas.length - imp.indice;
  return el('div', { class: 'caixa-aviso revisao-pendente' },
    el('strong', { text: 'Revisão em andamento' }),
    el('p', { text: `${faltam === 1 ? 'Há 1 receita lida' : `Há ${faltam} receitas lidas`} pela IA e ainda não salva${faltam === 1 ? '' : 's'}: ${imp.receitas[imp.indice].titulo}.` }),
    el('div', { class: 'acoes' },
      el('a', { class: 'botao pequeno principal', href: '#/revisar' }, 'Continuar revisão'),
      el('button', { class: 'botao pequeno perigo', type: 'button', onclick: async () => {
        if (!confirm('Descartar a revisão em andamento? As receitas lidas e ainda não salvas serão perdidas.')) return;
        await descartarRevisao();
        rotear();
      } }, 'Descartar')));
}
window.addEventListener('beforeunload', (ev) => {
  const f = estado.formulario;
  if (f?.ehRevisao) f.guardar();
  else if (f?.sujo) { ev.preventDefault(); ev.returnValue = ''; }
});
// iPhone: ao ir para segundo plano o app pode ser fechado sem aviso; guarda a revisão antes.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && estado.formulario?.ehRevisao) estado.formulario.guardar(); });
window.addEventListener('pagehide', () => { if (estado.formulario?.ehRevisao) estado.formulario.guardar(); });

async function rotear() {
  const aberto = estado.formulario;
  if (aberto && aberto.hash !== location.hash) {
    if (aberto.ehRevisao) aberto.guardar();
    else if (aberto.sujo && !confirm('Sair sem salvar? As alterações desta receita serão perdidas.')) {
      history.replaceState(null, '', aberto.hash); // fica onde estava
      return;
    }
  }
  if (!estado.usuario) return telaLogin();
  topo.hidden = false;
  const rota = location.hash.replace(/^#/, '') || '/';
  const partes = rota.split('/').filter(Boolean);
  if (!estado.titular && ['nova', 'manual', 'editar', 'revisar', 'categorias'].includes(partes[0])) {
    return mostrar(el('section', {},
      el('p', {}, el('a', { href: '#/' }, '← Voltar')),
      el('h1', { text: 'Conta só de leitura' }),
      el('p', { class: 'aviso', text: 'Você pode ver, buscar e compartilhar as receitas. Cadastrar, importar e editar é só para o dono do app.' })));
  }
  if (estado.semConexao && ['nova', 'manual', 'editar', 'revisar', 'categorias'].includes(partes[0])) {
    return mostrar(el('section', {},
      el('p', {}, el('a', { href: '#/' }, '← Voltar')),
      el('h1', { text: 'Precisa de internet' }),
      el('p', { class: 'aviso', text: estado.semSessao
        ? 'Sua sessão venceu. Para importar, cadastrar ou editar receitas, entre de novo com internet.'
        : 'Sem internet agora. Para importar, cadastrar ou editar receitas, conecte-se. Ver e buscar receitas funciona normalmente.' })));
  }
  try {
    if (partes[0] === 'receita' && partes[1]) return await telaReceita(partes[1]);
    if (partes[0] === 'categoria' && partes[1]) return await telaLista(partes[1]);
    if (partes[0] === 'cozinha' && partes[1]) return await telaCozinha(partes[1]);
    if (partes[0] === 'editar' && partes[1]) return await telaFormulario(partes[1]);
    if (partes[0] === 'nova') return telaImportar();
    if (partes[0] === 'manual') return await telaFormulario(null);
    if (partes[0] === 'revisar') return await telaRevisao();
    if (partes[0] === 'ajustes') return telaAjustes();
    if (partes[0] === 'categorias') return await telaCategorias();
    return await telaLista(null);
  } catch (e) {
    mensagem(erroAmigavel(e), 'erro');
  }
}

// ---------------------------------------------------------------------
// Backup pelo app (versão 14). Mesmo formato do backup automático do
// Drive (versao_backup 1), com fotos opcionais. A restauração só
// ACRESCENTA o que falta: receitas que já existem ficam como estão e
// nada é apagado.
// ---------------------------------------------------------------------
const LIMITE_BACKUP = 60 * 1024 * 1024; // 60 MB

function blobParaDataUrl(blob) {
  return new Promise((ok, falha) => { const l = new FileReader(); l.onload = () => ok(l.result); l.onerror = () => falha(l.error); l.readAsDataURL(blob); });
}
function dataUrlParaBlob(url) {
  const m = /^data:(image\/(?:jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(url || ''));
  return m ? base64ParaBlob(m[2], m[1]) : null;
}
const hojeIso = () => new Date().toISOString().slice(0, 10);

async function exportarBackup(comFotos, aoProgredir) {
  if (!estado.semConexao) { try { await comLimite(atualizarColecao(), 15000); } catch { /* usa a cópia */ } }
  const c = estado.colecao;
  if (!c) throw new Error('Ainda não há cópia das receitas neste aparelho.');
  const fotos = {};
  if (comFotos) {
    if (!estado.semConexao) { aoProgredir?.('Conferindo as fotos…'); await baixarCapas(c); }
    const caminhos = [...caminhosDaColecao(c)];
    for (const [n, caminho] of caminhos.entries()) {
      aoProgredir?.(`Juntando fotos: ${n + 1} de ${caminhos.length}`);
      const blob = await lerLocal('capas', caminho);
      if (blob) fotos[caminho] = await blobParaDataUrl(blob);
    }
  }
  const dados = {
    app: 'receitas-na-mao', versao_backup: 1, origem: 'app', versao_app: VERSAO, gerado_em: new Date().toISOString(),
    categorias: c.categorias, receitas: c.receitas, ingredientes: c.ingredientes, passos: c.passos,
    etiquetas: c.etiquetas, receita_etiquetas: c.receita_etiquetas,
    ...(comFotos ? { fotos } : {})
  };
  const nome = `receitas-na-mao-backup-${hojeIso()}${comFotos ? '-com-fotos' : ''}.json`;
  const arquivo = new File([JSON.stringify(dados)], nome, { type: 'application/json' });
  // Celular: abre o compartilhamento (iPhone: "Salvar em Arquivos"). Computador: baixa.
  const celular = window.matchMedia?.('(pointer: coarse)').matches;
  if (celular && navigator.canShare?.({ files: [arquivo] })) {
    try { await navigator.share({ files: [arquivo], title: nome }); return { nome, receitas: c.receitas.length, fotos: Object.keys(fotos).length }; }
    catch (e) { if (e?.name === 'AbortError') return null; }
  }
  const url = URL.createObjectURL(arquivo);
  const a = el('a', { href: '#', download: nome });
  a.href = url; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { nome, receitas: c.receitas.length, fotos: Object.keys(fotos).length };
}

/** Lê e confere o arquivo; devolve o plano da restauração (sem gravar nada). */
async function planejarRestauracao(arquivo) {
  if (arquivo.size > LIMITE_BACKUP) throw new Error('Arquivo grande demais (máximo 60 MB).');
  let dados;
  try { dados = JSON.parse(await arquivo.text()); } catch { throw new Error('Esse arquivo não é um backup do Receitas na mão (não é JSON).'); }
  if (dados?.app !== 'receitas-na-mao' || !Array.isArray(dados.receitas)) throw new Error('Esse arquivo não é um backup do Receitas na mão.');
  // Cópia atualizada antes de comparar: uma receita nova de outro aparelho
  // nunca pode ser tratada como "faltando" (seria regravada por cima).
  await comLimite(atualizarColecao(), 20000);
  const meu = x => !x.dono_id || x.dono_id === estado.usuario.id;
  const lista = (k) => (Array.isArray(dados[k]) ? dados[k] : []).filter(x => x && typeof x === 'object' && meu(x));
  const receitas = lista('receitas').filter(r => typeof r.id === 'string' && typeof r.titulo === 'string');
  const existentes = new Set((estado.colecao?.receitas || []).map(r => r.id));
  const novas = receitas.filter(r => !existentes.has(r.id));
  return {
    dados, novas, jaExistem: receitas.length - novas.length, gerado: dados.gerado_em,
    categorias: lista('categorias'), ingredientes: lista('ingredientes'), passos: lista('passos'),
    etiquetas: lista('etiquetas'), receitaEtiquetas: lista('receita_etiquetas'),
    fotos: dados.fotos && typeof dados.fotos === 'object' ? dados.fotos : {}
  };
}

async function executarRestauracao(plano, aoProgredir) {
  const uid = estado.usuario.id;
  // Categorias pelo nome: usa a que existe; cria a que falta.
  const nomeCatArquivo = new Map(plano.categorias.map(c => [c.id, c.nome]));
  const porNome = new Map(estado.categorias.map(c => [c.nome.toLowerCase(), c.id]));
  for (const r of plano.novas) {
    const nome = nomeCatArquivo.get(r.categoria_id);
    if (nome && !porNome.has(nome.toLowerCase())) {
      const ordem = Math.max(0, ...estado.categorias.map(c => c.ordem || 0)) + 1;
      const { data, error } = await sb.from('categorias').insert({ nome, ordem }).select('id, nome, ordem, ativa').maybeSingle();
      if (error) throw error;
      estado.categorias.push(data); porNome.set(nome.toLowerCase(), data.id);
    }
  }
  const nomeEtiqueta = new Map(plano.etiquetas.map(e => [e.id, e.nome]));
  const porOrdem = (a, b) => (a.ordem || 0) - (b.ordem || 0);
  async function fotoRestaurada(original, caminhoNovo) {
    if (!original) return null;
    if (String(original).startsWith(`${uid}/`)) {
      const existe = await sb.storage.from(PASTA_IMAGENS).download(original);
      if (!existe.error && existe.data) return original;
    }
    const blob = plano.fotos[original] ? dataUrlParaBlob(plano.fotos[original]) : null;
    if (!blob || blob.size > LIMITE_IMAGEM * 1.1) return null;
    const envio = await sb.storage.from(PASTA_IMAGENS).upload(caminhoNovo, blob, { contentType: blob.type, upsert: false });
    return envio.error ? null : caminhoNovo;
  }
  let ok = 0; const falhas = [];
  for (const [n, r] of plano.novas.entries()) {
    aoProgredir?.(`Restaurando ${n + 1} de ${plano.novas.length}: ${r.titulo}`);
    try {
      // Fotos (capa e passos): a original, se ainda existe; senão, a do backup; senão, sem foto.
      const foto = await fotoRestaurada(r.imagem_caminho, `${uid}/${r.id}-${Date.now()}.jpg`);
      const passosDaReceita = plano.passos.filter(x => x.receita_id === r.id).sort(porOrdem);
      const passosRestaurados = [];
      for (const [k, x] of passosDaReceita.entries()) {
        passosRestaurados.push({ grupo: x.grupo || null, texto: x.texto,
          imagem_caminho: await fotoRestaurada(x.imagem_caminho, `${uid}/passos/${r.id}-${Date.now()}-${k + 1}.jpg`) });
      }
      const nomeCat = nomeCatArquivo.get(r.categoria_id);
      const { error } = await sb.rpc('salvar_receita', { dados: {
        id: r.id, titulo: r.titulo,
        categoria_id: nomeCat ? porNome.get(nomeCat.toLowerCase()) || null : null,
        porcoes: r.porcoes ?? null, tempo_preparo_min: r.tempo_preparo_min ?? null, tempo_total_min: r.tempo_total_min ?? null,
        imagem_caminho: foto, fonte_url: linkSeguro(r.fonte_url) || null, fonte_autor: r.fonte_autor || null,
        fonte_tipo: r.fonte_tipo || 'manual', favorita: !!r.favorita,
        utensilios: Array.isArray(r.utensilios) ? r.utensilios : [], observacoes: r.observacoes || null,
        ingredientes: plano.ingredientes.filter(i => i.receita_id === r.id).sort(porOrdem).map(i => ({
          grupo: i.grupo || null, quantidade: i.quantidade ?? null, unidade: i.unidade || null, nome: i.nome,
          observacao: i.observacao || null, texto_original: i.texto_original || null })),
        passos: passosRestaurados,
        etiquetas: plano.receitaEtiquetas.filter(x => x.receita_id === r.id).map(x => nomeEtiqueta.get(x.etiqueta_id)).filter(Boolean)
      } });
      if (error) throw error;
      ok++;
    } catch (e) {
      falhas.push(`${r.titulo}: ${erroAmigavel(e)}`);
    }
  }
  aoProgredir?.('Atualizando a cópia no aparelho…');
  try { await atualizarColecao(); } catch { estado.colecao = null; }
  return { ok, falhas };
}

/** Ajustes do titular: baixar e restaurar backup (versão 14). */
function secaoBackup() {
  const status = el('div', { class: 'status backup-status', role: 'status' });
  const comFotos = el('input', { type: 'checkbox', 'aria-label': 'Incluir as fotos' });
  const baixar = el('button', { class: 'botao', type: 'button' }, 'Baixar backup');
  baixar.addEventListener('click', async () => {
    baixar.disabled = true; status.className = 'status backup-status';
    try {
      const r = await exportarBackup(comFotos.checked, t => { status.textContent = t; });
      status.textContent = r ? `Backup pronto: ${r.nome} (${r.receitas} receitas${comFotos.checked ? `, ${r.fotos} fotos` : ''}).` : 'Cancelado.';
    } catch (e) { status.className = 'status erro backup-status'; status.textContent = erroAmigavel(e); }
    baixar.disabled = false;
  });
  const arquivo = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Arquivo de backup', disabled: estado.semConexao });
  const confirmar = el('div');
  arquivo.addEventListener('change', async () => {
    confirmar.replaceChildren(); status.className = 'status backup-status';
    const f = arquivo.files[0]; if (!f) return;
    let plano;
    try { plano = await planejarRestauracao(f); } catch (e) { status.className = 'status erro backup-status'; status.textContent = erroAmigavel(e); return; }
    const quando = plano.gerado ? ` de ${dataHoraCurta(plano.gerado)}` : '';
    if (!plano.novas.length) { status.textContent = `Backup${quando}: todas as ${plano.jaExistem} receitas já estão no app. Nada a restaurar.`; return; }
    status.textContent = `Backup${quando}: ${plano.novas.length} receita(s) para restaurar; ${plano.jaExistem} já estão no app e ficam como estão. Nada será apagado.`;
    const botao = el('button', { class: 'botao principal', type: 'button' }, `Restaurar ${plano.novas.length} receita(s)`);
    botao.addEventListener('click', async () => {
      botao.disabled = true; arquivo.disabled = true;
      try {
        const r = await executarRestauracao(plano, t => { status.textContent = t; });
        confirmar.replaceChildren();
        status.textContent = `${r.ok} receita(s) restaurada(s).` + (r.falhas.length ? ` Não restauradas: ${r.falhas.join('; ')}` : '');
        if (r.falhas.length) status.className = 'status erro backup-status';
      } catch (e) { status.className = 'status erro backup-status'; status.textContent = erroAmigavel(e); botao.disabled = false; }
      arquivo.disabled = false; arquivo.value = '';
    });
    confirmar.replaceChildren(el('div', { class: 'acoes' }, botao,
      el('button', { class: 'botao', type: 'button', onclick: () => { confirmar.replaceChildren(); arquivo.value = ''; status.textContent = 'Restauração cancelada.'; } }, 'Cancelar')));
  });
  return el('div', {},
    el('h2', { text: 'Backup' }),
    el('p', { class: 'ajuda', text: 'Além do backup automático no Drive (segunda e quinta), você pode baixar um arquivo agora. Com fotos, fica maior (cerca de 15 MB a cada 100 receitas).' }),
    el('label', { class: 'opcao' }, comFotos, ' Incluir as fotos'),
    el('div', { class: 'acoes' }, baixar),
    el('h3', { text: 'Restaurar' }),
    el('p', { class: 'ajuda', text: estado.semConexao ? 'Precisa de internet para restaurar.' : 'Escolha um backup baixado pelo app ou do Drive (Backups > Receitas na mão). Só volta o que estiver faltando: nada é apagado nem substituído.' }),
    arquivo, confirmar, status);
}

/** Categorias (versão 13, só o titular): criar, renomear e remover.
 *  Remover move as receitas para "Outras" (função remover_categoria, script 10). */
async function telaCategorias() {
  const status = el('div', { class: 'status', role: 'status' });
  const lista = el('div');
  const contagem = new Map();
  for (const r of estado.colecao?.receitas || []) contagem.set(r.categoria_id, (contagem.get(r.categoria_id) || 0) + 1);
  const recarregar = async (msg) => {
    try { await atualizarColecao(); } catch (e) { status.textContent = erroAmigavel(e); return; }
    await telaCategorias();
    if (msg) document.querySelector('.categorias-status').textContent = msg;
  };
  const erroCategoria = (e) => /duplicate|23505|categorias_dono_nome/.test(`${e.message} ${e.code}`)
    ? 'Já existe uma categoria com esse nome.' : erroAmigavel(e);
  for (const c of estado.categorias) {
    const outras = c.nome.toLowerCase() === 'outras';
    const nome = el('input', { type: 'text', maxlength: 40, value: c.nome, 'aria-label': `Nome da categoria ${c.nome}`, disabled: outras });
    const salvar = el('button', { class: 'botao pequeno', type: 'button', hidden: true }, 'Salvar');
    nome.addEventListener('input', () => { salvar.hidden = nome.value.trim() === c.nome; });
    salvar.addEventListener('click', async () => {
      const novo = nome.value.trim().replace(/\s+/g, ' ');
      if (!novo) { status.textContent = 'O nome não pode ficar vazio.'; return; }
      if (novo.toLowerCase() === 'outras') { status.textContent = 'O nome "Outras" é reservado.'; return; }
      salvar.disabled = true;
      const { error } = await sb.from('categorias').update({ nome: novo }).eq('id', c.id);
      if (error) { status.textContent = erroCategoria(error); salvar.disabled = false; return; }
      recarregar(`"${c.nome}" agora é "${novo}".`);
    });
    const qtd = contagem.get(c.id) || 0;
    const remover = outras ? null : el('button', { class: 'botao pequeno perigo', type: 'button', 'aria-label': `Remover ${c.nome}`,
      onclick: async () => {
        if (!confirm(qtd ? `Remover "${c.nome}"? As ${qtd} receita(s) dela vão para "Outras".` : `Remover "${c.nome}"?`)) return;
        const { data, error } = await sb.rpc('remover_categoria', { p_id: c.id });
        if (error) { status.textContent = /remover_categoria/.test(error.message || '') ? 'Rode o script 10 no Supabase.' : erroAmigavel(error); return; }
        if (lerPreferencia('categoria', 'todas') === c.id) gravarPreferencia('categoria', 'todas');
        recarregar(`"${c.nome}" removida${data ? `; ${data} receita(s) foram para "Outras"` : ''}.`);
      } }, 'Remover');
    lista.append(el('div', { class: 'linha-categoria' },
      nome, el('span', { class: 'categoria-qtd', text: String(qtd) }), salvar, remover));
  }
  const nova = el('input', { type: 'text', maxlength: 40, placeholder: 'Nova categoria (ex.: Fit)', 'aria-label': 'Nova categoria' });
  const adicionar = el('button', { class: 'botao', type: 'button' }, 'Adicionar');
  adicionar.addEventListener('click', async () => {
    const nome = nova.value.trim().replace(/\s+/g, ' ');
    if (!nome) { status.textContent = 'Digite o nome da categoria.'; return; }
    if (estado.categorias.length >= 40) { status.textContent = 'Limite de 40 categorias.'; return; }
    adicionar.disabled = true;
    const ordem = Math.max(0, ...estado.categorias.map(c => c.ordem || 0)) + 1;
    const { error } = await sb.from('categorias').insert({ nome, ordem });
    adicionar.disabled = false;
    if (error) { status.textContent = erroCategoria(error); return; }
    recarregar(`"${nome}" criada.`);
  });
  status.classList.add('categorias-status');
  mostrar(el('section', {},
    el('p', {}, el('a', { href: '#/ajustes' }, '← Ajustes')),
    el('h1', { text: 'Categorias' }),
    el('p', { class: 'ajuda', text: 'Renomeie tocando no nome. Remover não apaga receitas: elas vão para "Outras". O número ao lado é a quantidade de receitas.' }),
    lista,
    el('div', { class: 'linha-autorizar' }, nova, adicionar),
    status));
}

/** Ajustes do titular: e-mails de amigos e família que podem ver as receitas (versão 11). */
function secaoLeitores() {
  const lista = el('ul', { class: 'lista-info' });
  const email = el('input', { type: 'email', maxlength: 254, autocomplete: 'off', inputmode: 'email',
    placeholder: 'email@gmail.com', 'aria-label': 'E-mail de quem pode ver' });
  const status = el('div', { class: 'status', role: 'status' });
  const botao = el('button', { class: 'botao', type: 'button', disabled: estado.semConexao }, 'Autorizar');
  async function carregar() {
    if (estado.semConexao) { lista.replaceChildren(el('li', { text: 'Precisa de internet para ver ou mudar a lista.' })); return; }
    const { data, error } = await sb.from('leitores').select('email, criado_em').order('email');
    if (error) { lista.replaceChildren(el('li', { text: /leitores/.test(error.message || '') ? 'Rode o script 09 no Supabase para ativar.' : erroAmigavel(error) })); return; }
    if (!data.length) { lista.replaceChildren(el('li', { text: 'Ninguém ainda.' })); return; }
    lista.replaceChildren(...data.map(l => el('li', {},
      el('span', { text: l.email }),
      el('button', { class: 'botao pequeno perigo', type: 'button', 'aria-label': `Remover ${l.email}`,
        onclick: async () => {
          if (!confirm(`Tirar o acesso de ${l.email}?`)) return;
          const { error: e } = await sb.from('leitores').delete().eq('email', l.email);
          status.textContent = e ? erroAmigavel(e) : `${l.email} não vê mais as receitas.`;
          carregar();
        } }, 'Remover'))));
  }
  botao.addEventListener('click', async () => {
    const valor = email.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valor)) { status.textContent = 'Digite um e-mail válido.'; return; }
    if (valor === (estado.usuario?.email || '').toLowerCase()) { status.textContent = 'Esse é o seu e-mail.'; return; }
    botao.disabled = true;
    const { error } = await sb.from('leitores').insert({ email: valor });
    botao.disabled = false;
    if (error) { status.textContent = /duplicate|23505/.test(error.message + error.code) ? 'Esse e-mail já está na lista.' : erroAmigavel(error); return; }
    email.value = '';
    status.textContent = `${valor} autorizado. Falta cadastrar no Google Cloud e no Supabase (veja o roteiro).`;
    carregar();
  });
  carregar();
  return el('div', {},
    el('h2', { text: 'Quem pode ver as receitas' }),
    el('p', { class: 'ajuda', text: 'Amigos e família entram com a conta Google e só visualizam: não importam, não editam e não excluem. Tirar o e-mail corta o acesso.' }),
    lista,
    el('div', { class: 'linha-autorizar' }, email, botao),
    status);
}

/** Service worker (versão 10): guarda os arquivos do app para abrir sem internet.
 *  Antes, desliga o "sw.js" do incidente de 01/11/2026, se ainda estiver ativo. */
async function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    // (Versão 20: saiu a limpeza do sw.js "desligador" do incidente de 01/11, apagado em 09/11.)
    await navigator.serviceWorker.register('service-worker.js');
    navigator.storage?.persist?.().catch(() => {}); // pede ao navegador para não apagar a cópia
  } catch { /* o app funciona só com internet */ }
}

/** Faixa no topo quando o app está mostrando a cópia guardada. */
function mostrarFaixa() {
  let faixa = document.getElementById('faixa-offline');
  if (!estado.semConexao || !estado.colecao) { faixa?.remove(); return; }
  if (!faixa) { faixa = el('div', { id: 'faixa-offline', class: 'faixa-offline', role: 'status' }); topo.after(faixa); }
  faixa.replaceChildren(...[
    estado.semSessao ? 'Sessão vencida: mostrando a cópia deste aparelho. ' : `Sem internet: mostrando a cópia de ${dataHoraCurta(estado.colecao.salva_em)}. `,
    estado.semSessao ? el('button', { class: 'botao pequeno', type: 'button', onclick: () => { estado.semConexao = false; estado.semSessao = false; estado.usuario = null; mostrarFaixa(); telaLogin(); } }, 'Entrar') : null
  ].filter(Boolean));
}

/** Volta a falar com o Supabase quando a internet volta. */
async function tentarReconectar() {
  if (!estado.semConexao || estado.semSessao || !estado.usuario) return;
  try {
    await comLimite(atualizarColecao(), 15000);
    mostrarFaixa();
    if (/^#(\/(categoria\/[\w-]+)?)?$/.test(location.hash) || location.hash.startsWith('#/receita/')) rotear();
  } catch { /* continua com a cópia */ }
}

async function iniciar() {
  registrarServiceWorker();
  // Retorno do Google com erro (ex.: conta não autorizada).
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const erroLogin = params.get('error_description') || new URLSearchParams(location.search).get('error_description');

  const voltouComCodigo = new URLSearchParams(location.search).has('code');
  const local = await lerLocal('dados', 'colecao');
  let sessao = null;
  try { sessao = (await sb.auth.getSession()).data.session; } catch { /* sem internet para renovar */ }
  if (location.hash.includes('access_token') || erroLogin) history.replaceState(null, '', location.pathname + '#/');
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);

  window.addEventListener('hashchange', rotear);
  window.addEventListener('online', tentarReconectar);
  window.addEventListener('offline', () => { if (estado.colecao) { estado.semConexao = true; mostrarFaixa(); } });

  if (!sessao && voltouComCodigo && !erroLogin) {
    // O Google devolveu o código, mas a troca pela sessão não funcionou
    // (ex.: o login abriu numa janela que não enxerga o segredo deste aparelho).
    return telaLogin('O login não terminou neste aparelho. Toque em "Entrar com Google" de novo; se repetir, avise (versão 15, login PKCE).');
  }
  if (!sessao) {
    // Sem sessão (venceu sem internet): mostra a cópia, se houver; senão, login.
    if (local && !erroLogin) {
      estado.usuario = { id: local.usuario_id, email: local.email };
      estado.titular = local.titular !== false;
      aplicarColecao(local);
      estado.semConexao = true; estado.semSessao = true;
      mostrarFaixa();
      return rotear();
    }
    return telaLogin(erroLogin ? 'Não foi possível entrar com essa conta.' : null);
  }
  estado.usuario = sessao.user;
  const temCopia = !!(local && local.usuario_id === sessao.user.id);
  if (temCopia) { aplicarColecao(local); estado.titular = local.titular !== false; }
  else if (local) await limparCopiaLocal(); // cópia de outra conta: apaga

  if (temCopia) {
    // Versão 18: com a cópia no aparelho, mostra a tela na hora e sincroniza por trás.
    if (!navigator.onLine) estado.semConexao = true;
    await recuperarRascunho();
    mostrarFaixa();
    await rotear();           // primeiro a tela (da cópia)…
    sincronizarPorTras(true); // …depois a leitura do Supabase, sem disputar o processador
    return;
  }

  try {
    // Titular ou só leitura? Sem o script 09, a função não existe: segue como titular.
    const papel = await comLimite(sb.rpc('eh_titular'), local ? 6000 : 20000);
    if (!papel.error) estado.titular = papel.data !== false;
    await comLimite(carregarCategorias(), local ? 6000 : 20000); // cria as categorias no 1º acesso
    await comLimite(atualizarColecao(), local ? 8000 : 30000);
  } catch (e) {
    if (!estado.colecao) return mensagem(erroAmigavel(e), 'erro');
    estado.semConexao = true; // segue com a cópia guardada
  }
  await recuperarRascunho();
  mostrarFaixa();
  rotear();
}

sb.auth.onAuthStateChange((evento, sessao) => {
  if (evento === 'SIGNED_OUT') {
    if (estado.semSessao) return; // mostrando a cópia: o login fica para quando houver internet
    estado.usuario = null;
    telaLogin();
  } else if (sessao) {
    estado.usuario = sessao.user;
  }
});

iniciar();
