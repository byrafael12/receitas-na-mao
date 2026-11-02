/* =====================================================================
   Receitas na mão · app.js
   Versão 5 (Entrega 2): login Google, cadastro manual de receita com
   foto, utensílios e observações, lista, detalhe, edição e exclusão.

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
const VERSAO = '9.2';
const SUPABASE_URL = 'https://dmvjlirobozpmkusnnez.supabase.co';
const SUPABASE_CHAVE_PUBLICA = 'sb_publishable_MpRgJ6E0Ghhi-CcFsymGKA_l6IrlYa5';
const PASTA_IMAGENS = 'capas';
const LIMITE_IMAGEM = 150 * 1024; // 150 KB
const CATEGORIAS_INICIAIS = ['Massas', 'Carne de rês', 'Frango', 'Frutos do mar', 'Japonês e Chinês', 'Salgados',
  'Lanches', 'Sobremesas', 'Molhos', 'Acompanhamentos', 'Bebidas e Drinks', 'Outras'];

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_CHAVE_PUBLICA, {
  auth: {
    persistSession: true,      // mantém o login entre aberturas do app
    autoRefreshToken: true,    // renova o crachá (token) sozinho
    detectSessionInUrl: true,  // lê o retorno do login Google
    flowType: 'implicit'
  }
});

const estado = {
  usuario: null,
  categorias: [],
  etiquetas: [],
  urlsAssinadas: new Map(), // caminho da imagem -> { url, expira }
  importacao: null,         // receitas lidas pela IA aguardando revisão
  busca: ''                 // texto da busca da tela inicial (mantido ao voltar)
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

function mostrar(...filhos) {
  app.replaceChildren(...filhos);
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

/** Reduz a foto até caber em 150 KB (JPEG). */
async function comprimirImagem(arquivo) {
  const img = await carregarImagem(arquivo);
  const larguraOriginal = img.width, alturaOriginal = img.height;
  let lado = 1280, qualidade = 0.82;
  const canvas = document.createElement('canvas');
  for (let tentativa = 0; tentativa < 15; tentativa++) {
    const escala = Math.min(1, lado / Math.max(larguraOriginal, alturaOriginal));
    canvas.width = Math.round(larguraOriginal * escala);
    canvas.height = Math.round(alturaOriginal * escala);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', qualidade));
    if (blob && blob.size <= LIMITE_IMAGEM) return blob;
    if (qualidade > 0.6) qualidade -= 0.08;
    else lado = Math.round(lado * 0.85);
  }
  throw new Error('Não consegui reduzir a imagem para 150 KB.');
}

/** Gera links temporários (1 hora) para imagens da pasta privada. */
async function urlsDasImagens(caminhos) {
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
  const mapa = {};
  for (const c of caminhos) if (c && estado.urlsAssinadas.has(c)) mapa[c] = estado.urlsAssinadas.get(c).url;
  return mapa;
}

function elementoCapa(url, texto) {
  if (url) return el('img', { class: 'capa', src: url, alt: texto || '', loading: 'lazy' });
  return el('div', { class: 'capa capa-vazia', 'aria-hidden': 'true', text: '🍽' });
}

// ---------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------

async function carregarCategorias() {
  let { data, error } = await sb.from('categorias').select('id, nome, ordem, ativa').order('ordem');
  if (error) throw error;
  if (!data.length) {
    // Primeiro acesso: cria a lista inicial de categorias.
    const linhas = CATEGORIAS_INICIAIS.map((nome, i) => ({ nome, ordem: i + 1 }));
    const r = await sb.from('categorias').insert(linhas).select('id, nome, ordem, ativa').order('ordem');
    if (r.error) throw r.error;
    data = r.data;
  }
  // Ordem alfabética (sem ligar para acentos), com Outras sempre por último.
  estado.categorias = data.slice().sort((a, b) =>
    (a.nome === 'Outras') - (b.nome === 'Outras') || a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
}

async function carregarEtiquetas() {
  const { data, error } = await sb.from('etiquetas').select('id, nome').order('nome');
  if (error) throw error;
  estado.etiquetas = data;
}

function nomeCategoria(id) {
  return estado.categorias.find(c => c.id === id)?.nome || null;
}

async function buscarReceitaCompleta(id) {
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

/** Lê todas as linhas de uma tabela em blocos de 1.000 (o Supabase devolve no máximo 1.000 por consulta). */
async function lerTudo(tabela, campos) {
  const BLOCO = 1000, todas = [];
  for (let de = 0; ; de += BLOCO) {
    const { data, error } = await sb.from(tabela).select(campos).order('receita_id').range(de, de + BLOCO - 1);
    if (error) return { data: null, error };
    todas.push(...data);
    if (data.length < BLOCO) return { data: todas, error: null };
  }
}

/** Texto sem acento e em minúsculas, para a busca ("Pão" vira "pao"). */
function normalizar(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

async function telaLista() {
  mensagem('Carregando receitas…');
  const [rec, ing, ret] = await Promise.all([
    sb.from('receitas')
      .select('id, titulo, porcoes, tempo_preparo_min, imagem_caminho, categoria_id, utensilios, fonte_autor')
      .order('atualizada_em', { ascending: false }),
    lerTudo('ingredientes', 'receita_id, nome'),
    lerTudo('receita_etiquetas', 'receita_id, etiqueta_id')
  ]);
  for (const x of [rec, ing, ret]) if (x.error) return mensagem(erroAmigavel(x.error), 'erro');
  const data = rec.data;
  try { await carregarEtiquetas(); } catch { /* busca segue sem etiquetas */ }

  // Texto de busca de cada receita: nome, ingredientes, etiquetas, utensílios e autor.
  const textoBusca = new Map(data.map(r => [r.id, [r.titulo, ...(r.utensilios || []), r.fonte_autor]]));
  for (const i of ing.data) textoBusca.get(i.receita_id)?.push(i.nome);
  const nomeEtiqueta = new Map(estado.etiquetas.map(e => [e.id, e.nome]));
  for (const x of ret.data) textoBusca.get(x.receita_id)?.push(nomeEtiqueta.get(x.etiqueta_id));
  for (const [id, partes] of textoBusca) textoBusca.set(id, normalizar(partes.filter(Boolean).join(' | ')));

  const urls = await urlsDasImagens(data.map(r => r.imagem_caminho));
  const titulo = el('h1');
  const cabecalho = el('div', { class: 'cabecalho-lista' },
    titulo,
    el('a', { class: 'botao principal', href: '#/nova' }, '+ Nova'));

  if (!data.length) {
    titulo.textContent = 'Minhas receitas';
    return mostrar(cabecalho, el('p', { class: 'aviso', text: 'Nenhuma receita ainda. Toque em "+ Nova" para cadastrar a primeira.' }));
  }

  let filtro = lerPreferencia('categoria', 'todas');
  let visao = lerPreferencia('visao', 'grade');
  const campoBusca = el('input', {
    type: 'search', class: 'busca', value: estado.busca || '', maxlength: 100, enterkeyhint: 'search',
    placeholder: 'Buscar por nome, ingrediente, etiqueta…', 'aria-label': 'Buscar receitas'
  });
  campoBusca.addEventListener('input', () => { estado.busca = campoBusca.value; desenhar(); });

  const barraAbas = el('div', { class: 'abas', role: 'tablist', 'aria-label': 'Categorias' });
  const botoesVisao = el('div', { class: 'alternar-visao', role: 'group', 'aria-label': 'Visão' });
  const area = el('div');

  function itemGrade(r) {
    return el('a', { class: 'cartao', href: `#/receita/${r.id}` },
      elementoCapa(urls[r.imagem_caminho], ''),
      el('div', { class: 'cartao-texto' }, el('div', { class: 'cartao-titulo', text: r.titulo })));
  }
  function itemLista(r) {
    const info = [nomeCategoria(r.categoria_id), minutosTexto(r.tempo_preparo_min),
      r.porcoes ? `${formatarNumero(r.porcoes)} porç.` : null].filter(Boolean).join(' · ');
    return el('a', { class: 'item-lista', href: `#/receita/${r.id}` },
      elementoCapa(urls[r.imagem_caminho], ''),
      el('div', { class: 'item-texto' },
        el('div', { class: 'cartao-titulo', text: r.titulo }),
        info ? el('div', { class: 'cartao-info', text: info }) : null));
  }

  function desenhar() {
    // 1) Busca: todas as palavras digitadas precisam aparecer (em qualquer campo).
    const palavras = normalizar(estado.busca).split(/\s+/).filter(Boolean);
    const achadas = palavras.length ? data.filter(r => palavras.every(p => textoBusca.get(r.id).includes(p))) : data;

    // 2) Abas: "Todas" + categorias com receitas no resultado, com a contagem.
    const contagem = new Map();
    for (const r of achadas) contagem.set(r.categoria_id || 'sem', (contagem.get(r.categoria_id || 'sem') || 0) + 1);
    const abas = [{ id: 'todas', nome: 'Todas', qtd: achadas.length }];
    for (const c of estado.categorias) {
      if (contagem.has(c.id) || c.id === filtro) abas.push({ id: c.id, nome: c.nome, qtd: contagem.get(c.id) || 0 });
    }
    if (contagem.has('sem') || filtro === 'sem') abas.push({ id: 'sem', nome: 'Sem categoria', qtd: contagem.get('sem') || 0 });
    if (!abas.some(a => a.id === filtro)) filtro = 'todas';

    // 3) Receitas visíveis: busca + aba escolhida
    const visiveis = achadas.filter(r => filtro === 'todas' || (r.categoria_id || 'sem') === filtro);
    const aba = abas.find(a => a.id === filtro);
    titulo.textContent = filtro === 'todas'
      ? (palavras.length ? `Encontradas (${visiveis.length})` : `Minhas receitas (${data.length})`)
      : `${aba.nome} (${visiveis.length})`;

    barraAbas.replaceChildren(...abas.map(a => el('button', {
      class: 'aba' + (a.id === filtro ? ' ativa' : ''), type: 'button', role: 'tab',
      'aria-selected': a.id === filtro ? 'true' : 'false',
      onclick: () => { filtro = a.id; gravarPreferencia('categoria', filtro); desenhar(); }
    }, `${a.nome} `, el('span', { class: 'aba-qtd', text: String(a.qtd) }))));
    botoesVisao.replaceChildren(
      el('button', { class: 'botao pequeno' + (visao === 'grade' ? ' selecionado' : ''), type: 'button', 'aria-pressed': visao === 'grade' ? 'true' : 'false',
        onclick: () => { visao = 'grade'; gravarPreferencia('visao', visao); desenhar(); } }, '▦ Grade'),
      el('button', { class: 'botao pequeno' + (visao === 'lista' ? ' selecionado' : ''), type: 'button', 'aria-pressed': visao === 'lista' ? 'true' : 'false',
        onclick: () => { visao = 'lista'; gravarPreferencia('visao', visao); desenhar(); } }, '☰ Lista'));
    if (!visiveis.length) {
      area.replaceChildren(el('p', { class: 'aviso', text: palavras.length
        ? `Nenhuma receita com "${estado.busca.trim()}"${filtro !== 'todas' ? ' nesta categoria' : ''}.`
        : 'Nenhuma receita nesta categoria.' }));
    } else {
      area.replaceChildren(visao === 'lista'
        ? el('div', { class: 'lista' }, visiveis.map(itemLista))
        : el('div', { class: 'grade' }, visiveis.map(itemGrade)));
    }
    barraAbas.querySelector('.ativa')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  mostrar(cabecalho, campoBusca, barraAbas, botoesVisao, area);
  desenhar();
}

async function telaReceita(id) {
  mensagem('Carregando…');
  let r;
  try { r = await buscarReceitaCompleta(id); } catch (e) { return mensagem(erroAmigavel(e), 'erro'); }
  if (!r) return mensagem('Receita não encontrada.', 'erro');
  const urls = await urlsDasImagens([r.imagem_caminho]);

  const resumo = [
    nomeCategoria(r.categoria_id),
    r.porcoes ? `${formatarNumero(r.porcoes)} porções` : null,
    r.tempo_preparo_min !== null ? `Preparo: ${minutosTexto(r.tempo_preparo_min)}` : null,
    r.tempo_total_min !== null ? `Total: ${minutosTexto(r.tempo_total_min)}` : null
  ].filter(Boolean);

  // Ingredientes agrupados (massa, recheio...) na ordem salva.
  const listaIng = el('ul', { class: 'ingredientes' });
  let grupoAtual = null;
  for (const i of r.ingredientes) {
    if ((i.grupo || null) !== grupoAtual) {
      grupoAtual = i.grupo || null;
      if (grupoAtual) listaIng.append(el('li', { class: 'grupo-titulo', text: grupoAtual }));
    }
    const qtd = [i.quantidade !== null ? formatarQuantidade(i.quantidade) : null, i.unidade].filter(Boolean).join(' ');
    listaIng.append(el('li', {},
      qtd ? el('span', { class: 'quantidade', text: qtd + ' ' }) : null,
      i.nome,
      i.observacao ? ` (${i.observacao})` : null));
  }

  const link = linkSeguro(r.fonte_url);
  const fonte = (link || r.fonte_autor) ? el('p', { class: 'fonte' }, 'Fonte: ',
    r.fonte_autor ? r.fonte_autor + ' ' : null,
    link ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, 'abrir original') : null) : null;

  mostrar(el('article', { class: 'receita' },
    el('p', {}, el('a', { href: '#/' }, '← Voltar')),
    urls[r.imagem_caminho] ? elementoCapa(urls[r.imagem_caminho], r.titulo) : null,
    el('h1', { text: r.titulo }),
    resumo.length ? el('div', { class: 'resumo' }, resumo.map(t => el('span', { text: t }))) : null,
    r.etiquetas.length ? el('div', { class: 'etiquetas' }, r.etiquetas.map(t => el('span', { class: 'etiqueta', text: t }))) : null,
    el('h2', { text: 'Ingredientes' }),
    r.ingredientes.length ? listaIng : el('p', { class: 'aviso', text: 'Sem ingredientes.' }),
    (r.utensilios || []).length ? el('h2', { text: 'Utensílios' }) : null,
    (r.utensilios || []).length ? el('ul', { class: 'utensilios' }, r.utensilios.map(u => el('li', { text: u }))) : null,
    el('h2', { text: 'Modo de preparo' }),
    r.passos.length ? passosAgrupados(r.passos) : el('p', { class: 'aviso', text: 'Sem passos.' }),
    r.observacoes ? el('h2', { text: 'Observações' }) : null,
    r.observacoes ? el('p', { class: 'observacoes', text: r.observacoes }) : null,
    fonte,
    el('div', { class: 'acoes' },
      el('a', { class: 'botao', href: `#/editar/${r.id}` }, 'Editar'),
      el('button', { class: 'botao perigo', type: 'button', onclick: () => excluirReceita(r) }, 'Excluir'))
  ));
}

async function excluirReceita(r) {
  if (!confirm(`Excluir "${r.titulo}"? Não dá para desfazer.`)) return;
  const { error } = await sb.from('receitas').delete().eq('id', r.id);
  if (error) return alert(erroAmigavel(error));
  if (r.imagem_caminho) await sb.storage.from(PASTA_IMAGENS).remove([r.imagem_caminho]);
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

  const campo = (rotulo, entrada, ajuda) =>
    el('label', { class: 'campo' }, el('span', {}, rotulo, ajuda ? el('small', { text: ' ' + ajuda }) : null), entrada);

  const titulo = el('input', { type: 'text', maxlength: 200, required: true, value: r?.titulo || '' });
  const categoria = el('select', {},
    el('option', { value: '', text: 'Sem categoria' }),
    estado.categorias.filter(c => c.ativa || c.id === r?.categoria_id)
      .map(c => el('option', { value: c.id, text: c.nome, selected: c.id === r?.categoria_id })));
  const etiquetas = el('input', { type: 'text', maxlength: 400, value: (r?.etiquetas || []).join(', '), placeholder: 'Airfryer, Rápida' });
  const porcoes = el('input', { type: 'text', inputmode: 'decimal', value: r?.porcoes ? formatarNumero(r.porcoes) : '' });
  const tempoPreparo = el('input', { type: 'text', inputmode: 'numeric', value: r?.tempo_preparo_min ?? '' });
  const tempoTotal = el('input', { type: 'text', inputmode: 'numeric', value: r?.tempo_total_min ?? '' });
  const fonteUrl = el('input', { type: 'url', maxlength: 2000, value: r?.fonte_url || '', placeholder: 'https://' });
  const fonteAutor = el('input', { type: 'text', maxlength: 120, value: r?.fonte_autor || '', placeholder: '@perfil ou nome' });

  // Foto
  const previa = el('div', { class: 'foto-previa' });
  const entradaFoto = el('input', { type: 'file', accept: 'image/*' });
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
  }
  entradaFoto.addEventListener('change', () => { if (entradaFoto.files[0]) usarFoto(entradaFoto.files[0]); });

  // Revisão: miniaturas das imagens e quadros do vídeo para escolher a capa.
  const escolhaCapa = el('div', { class: 'candidatos' });
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
    const inicial = Number.isInteger(revisao.capaIndice) ? revisao.capaIndice : 0;
    const botaoInicial = escolhaCapa.children[Math.min(inicial, revisao.candidatos.length - 1)];
    botaoInicial.classList.add('escolhido');
    usarFoto(revisao.candidatos[Math.min(inicial, revisao.candidatos.length - 1)].blob);
  }
  botaoRemoverFoto.addEventListener('click', () => {
    fotoNova = null; removerFoto = true; entradaFoto.value = ''; statusFoto.textContent = '';
    desenharPrevia();
  });

  // Ingredientes: linhas de ingrediente e de grupo (ex.: "Recheio").
  const listaIngredientes = el('div');
  function linhaIngrediente(i = {}) {
    const linha = el('div', { class: 'linha-ingrediente', 'data-tipo': 'ing', 'data-original': i.texto_original || null },
      el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Qtd', 'aria-label': 'Quantidade',
        value: i.quantidade !== null && i.quantidade !== undefined ? formatarQuantidade(i.quantidade) : '' }),
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
  function linhaPasso(texto = '') {
    const linha = el('div', { class: 'linha-passo', 'data-tipo': 'passo' },
      el('span', { class: 'numero-passo' }),
      el('textarea', { maxlength: 2000, 'aria-label': 'Passo', placeholder: 'Descreva o passo' }, texto),
      el('button', { class: 'botao remover', type: 'button', 'aria-label': 'Remover passo', onclick: () => { linha.remove(); renumerar(); } }, '×'));
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
    listaPassos.append(linhaPasso(p.texto));
  }
  if (!r?.passos?.length) listaPassos.append(linhaPasso(), linhaPasso());
  renumerar();

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
      if (texto) passos.push({ grupo: grupoDoPasso, texto });
    }
    if (passos.length > 60) erros.push('Máximo de 60 passos.');
    const utensilios = [...listaUtensilios.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
    if (utensilios.length > 30) erros.push('Máximo de 30 utensílios.');
    const listaEtiquetas = etiquetas.value.split(',').map(t => t.trim()).filter(Boolean).slice(0, 15);
    if (listaEtiquetas.some(t => t.length > 40)) erros.push('Cada etiqueta pode ter até 40 letras.');

    if (erros.length) { status.className = 'status erro'; status.textContent = erros.join(' '); return; }

    botaoSalvar.disabled = true;
    try {
      let caminhoImagem = removerFoto ? null : (r?.imagem_caminho || null);
      const caminhoAntigo = r?.imagem_caminho || null;
      if (fotoNova) {
        status.textContent = 'Enviando a foto…';
        caminhoImagem = `${estado.usuario.id}/${idReceita}-${Date.now()}.jpg`;
        const envio = await sb.storage.from(PASTA_IMAGENS).upload(caminhoImagem, fotoNova, { contentType: 'image/jpeg', upsert: false });
        if (envio.error) throw envio.error;
      }
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
          ingredientes, passos, etiquetas: listaEtiquetas,
          utensilios, observacoes: observacoes.value.trim() || null
        }
      });
      if (error) {
        if (fotoNova && caminhoImagem) await sb.storage.from(PASTA_IMAGENS).remove([caminhoImagem]);
        throw error;
      }
      // Foto antiga substituída ou removida: apaga do armazenamento.
      if (caminhoAntigo && caminhoAntigo !== caminhoImagem) await sb.storage.from(PASTA_IMAGENS).remove([caminhoAntigo]);
      if (urlPrevia) URL.revokeObjectURL(urlPrevia);
      if (revisao) revisao.aoSalvar(idReceita);
      else location.hash = `#/receita/${idReceita}`;
    } catch (e) {
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
      el('button', { class: 'botao pequeno perigo', type: 'button', onclick: () => revisao.aoDescartar() },
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
/** Passos em blocos por grupo (Massa, Recheio...), com numeração corrida. */
function passosAgrupados(passos) {
  const blocos = [];
  for (const p of passos) {
    const g = p.grupo || null;
    if (!blocos.length || blocos.at(-1).grupo !== g) blocos.push({ grupo: g, itens: [] });
    blocos.at(-1).itens.push(p.texto);
  }
  let numero = 1;
  return el('div', {}, blocos.map(b => {
    const lista = el('ol', { class: 'passos', start: numero }, b.itens.map(t => el('li', { text: t })));
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

function telaImportar() {
  const legenda = el('textarea', { maxlength: 20000, 'aria-label': 'Legenda ou texto da receita',
    placeholder: 'Cole aqui a legenda do post ou o texto da receita (opcional)' });
  const entradaImagens = el('input', { type: 'file', accept: 'image/*', multiple: true, 'aria-label': 'Prints ou fotos' });
  const entradaVideo = el('input', { type: 'file', accept: 'video/*', 'aria-label': 'Vídeo' });
  const link = el('input', { type: 'url', maxlength: 2000, inputmode: 'url', autocomplete: 'off',
    placeholder: 'https:// site de receita, YouTube, Instagram ou TikTok', 'aria-label': 'Link da receita' });
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
    resumo.textContent = partes.length ? 'Vai enviar: ' + partes.join(' + ') + '.' : 'Use uma ou mais opções. Site ou YouTube: só o link basta. Instagram: vídeo + legenda dá o melhor resultado.';
  };
  [link, legenda, entradaImagens, entradaVideo].forEach(e => e.addEventListener('input', atualizarResumo));
  entradaImagens.addEventListener('change', atualizarResumo);
  entradaVideo.addEventListener('change', atualizarResumo);
  atualizarResumo();

  botao.addEventListener('click', async () => {
    status.className = 'status';
    const texto = legenda.value.trim();
    const imagens = [...entradaImagens.files].slice(0, MAX_PRINTS);
    const video = entradaVideo.files[0] || null;
    const linkFonte = link.value.trim();
    if (!texto && !imagens.length && !video && !linkFonte) { status.className = 'status erro'; status.textContent = 'Cole um link ou a legenda, ou escolha imagens ou um vídeo.'; return; }
    if (linkFonte && !linkSeguro(linkFonte)) { status.className = 'status erro'; status.textContent = 'Link: copie o endereço completo, começando com https://'; return; }
    if (entradaImagens.files.length > MAX_PRINTS) { status.textContent = `Usando só as ${MAX_PRINTS} primeiras imagens.`; }

    botao.disabled = true;
    cancelado = false;
    controle = new AbortController();
    botaoCancelar.hidden = false; botaoCancelar.disabled = false; botaoCancelar.textContent = 'Cancelar';
    const inicio = Date.now();
    const relogio = setInterval(() => { botao.textContent = `Lendo… ${Math.round((Date.now() - inicio) / 1000)} s`; }, 1000);
    const avisos = [];
    try {
      const corpo = { texto, link: linkFonte || undefined, imagens: [], quadros: [], categorias: estado.categorias.filter(c => c.ativa).map(c => c.nome) };
      const candidatos = [];
      for (const [i, f] of imagens.entries()) {
        conferirCancelado();
        status.textContent = `Preparando imagem ${i + 1} de ${imagens.length}…`;
        const b = await reduzirImagem(f, 1280, 0.8);
        corpo.imagens.push({ mime: 'image/jpeg', dados: await blobParaBase64(b) });
        candidatos.push({ blob: f, url: URL.createObjectURL(b) });
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
      status.textContent = linkFonte ? 'Abrindo o link e lendo a receita com a IA…' : 'A IA está lendo a receita…';
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

      estado.importacao = {
        receitas: json.receitas, candidatos, link: linkSeguro(json.link?.url || linkFonte) || null, importacaoId: json.importacao_id,
        fonteTipo: json.link ? json.link.tipo : (video ? 'video' : (imagens.length ? 'print' : 'legenda')),
        autorLink: json.link?.autor || null,
        aviso: [json.aviso, ...avisos].filter(Boolean).join(' '),
        prints: imagens.length, indice: 0, ultimaSalva: null
      };
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
    el('p', { class: 'ajuda' }, 'A IA lê o link, a legenda, os prints e o vídeo e monta a receita para você revisar. ',
      el('a', { href: '#/manual' }, 'Prefere digitar? Cadastro manual')),
    el('label', { class: 'campo' }, el('span', {}, 'Link ', el('small', { text: 'site de receita e YouTube funcionam sozinhos; Instagram e TikTok, nem sempre' })), link),
    el('label', { class: 'campo' }, el('span', { text: 'Legenda ou texto' }), legenda),
    el('label', { class: 'campo' }, el('span', {}, 'Prints ou fotos ', el('small', { text: `até ${MAX_PRINTS}` })), entradaImagens),
    el('label', { class: 'campo' }, el('span', {}, 'Vídeo ', el('small', { text: 'até 5 minutos; o vídeo não é enviado, só imagens e áudio' })), entradaVideo),
    resumo,
    el('div', { class: 'acoes' }, botao, botaoCancelar),
    status
  ));
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
    if (imp.indice < imp.receitas.length) telaRevisao();
    else {
      imp.candidatos.forEach(c => URL.revokeObjectURL(c.url));
      estado.importacao = null;
      location.hash = imp.ultimaSalva ? `#/receita/${imp.ultimaSalva}` : '#/';
    }
  };
  await telaFormulario(null, {
    dados: {
      titulo: rec.titulo, categoria_id: catId, etiquetas: rec.etiquetas, porcoes: rec.porcoes,
      tempo_preparo_min: rec.tempo_preparo_min, tempo_total_min: rec.tempo_total_min,
      ingredientes: rec.ingredientes.map(i => ({ ...i, nome: i.observacao ? `${i.nome} (${i.observacao})` : i.nome })),
      passos: rec.passos.map(p => typeof p === 'string' ? { grupo: null, texto: p } : { grupo: p.grupo || null, texto: p.texto }), utensilios: rec.utensilios, observacoes: rec.observacoes,
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

function telaAjustes() {
  mostrar(el('section', {},
    el('p', {}, el('a', { href: '#/' }, '← Voltar')),
    el('h1', { text: 'Ajustes' }),
    el('ul', { class: 'lista-info' },
      el('li', {}, el('span', { text: 'Conta' }), el('span', { text: estado.usuario?.email || '' })),
      el('li', {}, el('span', { text: 'Versão do app' }), el('span', { text: VERSAO }))),
    el('div', { class: 'acoes' },
      el('button', {
        class: 'botao', type: 'button',
        onclick: async () => { await sb.auth.signOut(); estado.urlsAssinadas.clear(); location.hash = '#/'; }
      }, 'Sair'))
  ));
}

// ---------------------------------------------------------------------
// Navegação (rotas pelo trecho depois do # no endereço)
// ---------------------------------------------------------------------

async function rotear() {
  if (!estado.usuario) return telaLogin();
  topo.hidden = false;
  const rota = location.hash.replace(/^#/, '') || '/';
  const partes = rota.split('/').filter(Boolean);
  try {
    if (partes[0] === 'receita' && partes[1]) return await telaReceita(partes[1]);
    if (partes[0] === 'editar' && partes[1]) return await telaFormulario(partes[1]);
    if (partes[0] === 'nova') return telaImportar();
    if (partes[0] === 'manual') return await telaFormulario(null);
    if (partes[0] === 'revisar') return await telaRevisao();
    if (partes[0] === 'ajustes') return telaAjustes();
    return await telaLista();
  } catch (e) {
    mensagem(erroAmigavel(e), 'erro');
  }
}

/** Desliga service worker instalado por engano no endereço deste app
 *  (o do Controle Financeiro, em 01/11/2026). Não mexe no de outros apps. */
function desligarServiceWorkerIntruso() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistrations().then(registros => {
    for (const r of registros) {
      if (new URL(r.scope).pathname.startsWith('/receitas-na-mao/')) r.unregister();
    }
  }).catch(() => {});
}

async function iniciar() {
  desligarServiceWorkerIntruso();
  // Retorno do Google com erro (ex.: conta não autorizada).
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const erroLogin = params.get('error_description') || new URLSearchParams(location.search).get('error_description');

  const { data } = await sb.auth.getSession();
  if (location.hash.includes('access_token') || erroLogin) history.replaceState(null, '', location.pathname + '#/');
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);

  if (!data.session) {
    return telaLogin(erroLogin ? 'Não foi possível entrar com essa conta.' : null);
  }
  estado.usuario = data.session.user;
  try {
    await carregarCategorias();
  } catch (e) {
    return mensagem(erroAmigavel(e), 'erro');
  }
  window.addEventListener('hashchange', rotear);
  rotear();
}

sb.auth.onAuthStateChange((evento, sessao) => {
  if (evento === 'SIGNED_OUT') {
    estado.usuario = null;
    telaLogin();
  } else if (sessao) {
    estado.usuario = sessao.user;
  }
});

iniciar();
