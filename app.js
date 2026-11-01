/* =====================================================================
   Receitas na mão · app.js
   Versão 3 (Entrega 1): login Google, cadastro manual de receita com
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
const VERSAO = '3';
const SUPABASE_URL = 'https://dmvjlirobozpmkusnnez.supabase.co';
const SUPABASE_CHAVE_PUBLICA = 'sb_publishable_MpRgJ6E0Ghhi-CcFsymGKA_l6IrlYa5';
const PASTA_IMAGENS = 'capas';
const LIMITE_IMAGEM = 150 * 1024; // 150 KB
const CATEGORIAS_INICIAIS = ['Massas', 'Carne de rês', 'Frango', 'Frutos do mar', 'Japonês e Chinês', 'Salgados',
  'Lanches', 'Sobremesas', 'Molhos', 'Acompanhamentos', 'Outras'];

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
  urlsAssinadas: new Map() // caminho da imagem -> { url, expira }
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

/** Converte "1/2", "1 1/2", "0,5" ou "2" em número. Vazio vira null. */
function lerQuantidade(texto) {
  const t = String(texto || '').trim().replace(',', '.');
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
  estado.categorias = data;
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

async function telaLista() {
  mensagem('Carregando receitas…');
  const { data, error } = await sb.from('receitas')
    .select('id, titulo, porcoes, tempo_preparo_min, imagem_caminho, categoria_id')
    .order('atualizada_em', { ascending: false });
  if (error) return mensagem(erroAmigavel(error), 'erro');

  const urls = await urlsDasImagens(data.map(r => r.imagem_caminho));
  const cabecalho = el('div', { class: 'cabecalho-lista' },
    el('h1', { text: `Minhas receitas (${data.length})` }),
    el('a', { class: 'botao principal', href: '#/nova' }, '+ Nova'));

  if (!data.length) {
    return mostrar(cabecalho, el('p', { class: 'aviso', text: 'Nenhuma receita ainda. Toque em "+ Nova" para cadastrar a primeira.' }));
  }

  const grade = el('div', { class: 'grade' }, data.map(r => {
    const info = [nomeCategoria(r.categoria_id), minutosTexto(r.tempo_preparo_min),
      r.porcoes ? `${formatarNumero(r.porcoes)} porç.` : null].filter(Boolean).join(' · ');
    return el('a', { class: 'cartao', href: `#/receita/${r.id}` },
      elementoCapa(urls[r.imagem_caminho], ''),
      el('div', { class: 'cartao-texto' },
        el('div', { class: 'cartao-titulo', text: r.titulo }),
        info ? el('div', { class: 'cartao-info', text: info }) : null));
  }));
  mostrar(cabecalho, grade);
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
    const qtd = [i.quantidade !== null ? formatarNumero(i.quantidade) : null, i.unidade].filter(Boolean).join(' ');
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
    r.passos.length ? el('ol', { class: 'passos' }, r.passos.map(p => el('li', { text: p.texto })))
      : el('p', { class: 'aviso', text: 'Sem passos.' }),
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

async function telaFormulario(id) {
  mensagem('Carregando…');
  let r = null;
  if (id) {
    try { r = await buscarReceitaCompleta(id); } catch (e) { return mensagem(erroAmigavel(e), 'erro'); }
    if (!r) return mensagem('Receita não encontrada.', 'erro');
  }
  const idReceita = r ? r.id : crypto.randomUUID();
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
  entradaFoto.addEventListener('change', async () => {
    const arquivo = entradaFoto.files[0];
    if (!arquivo) return;
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
  });
  botaoRemoverFoto.addEventListener('click', () => {
    fotoNova = null; removerFoto = true; entradaFoto.value = ''; statusFoto.textContent = '';
    desenharPrevia();
  });

  // Ingredientes: linhas de ingrediente e de grupo (ex.: "Recheio").
  const listaIngredientes = el('div');
  function linhaIngrediente(i = {}) {
    const linha = el('div', { class: 'linha-ingrediente', 'data-tipo': 'ing' },
      el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Qtd', 'aria-label': 'Quantidade',
        value: i.quantidade !== null && i.quantidade !== undefined ? formatarNumero(i.quantidade) : '' }),
      el('input', { type: 'text', placeholder: 'Unid.', maxlength: 30, 'aria-label': 'Unidade', value: i.unidade || '' }),
      el('input', { type: 'text', placeholder: 'Ingrediente', maxlength: 200, 'aria-label': 'Ingrediente', value: i.nome || '' }),
      el('button', { class: 'botao remover', type: 'button', 'aria-label': 'Remover ingrediente', onclick: () => linha.remove() }, '×'));
    return linha;
  }
  function linhaGrupo(nome = '') {
    const linha = el('div', { class: 'linha-grupo', 'data-tipo': 'grupo' },
      el('input', { type: 'text', placeholder: 'Nome do grupo (ex.: Recheio)', maxlength: 60, 'aria-label': 'Grupo', value: nome }),
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

  // Passos numerados
  const listaPassos = el('div');
  function renumerar() {
    [...listaPassos.children].forEach((l, i) => { l.querySelector('.numero-passo').textContent = `${i + 1}.`; });
  }
  function linhaPasso(texto = '') {
    const linha = el('div', { class: 'linha-passo' },
      el('span', { class: 'numero-passo' }),
      el('textarea', { maxlength: 2000, 'aria-label': 'Passo', placeholder: 'Descreva o passo' }, texto),
      el('button', { class: 'botao remover', type: 'button', 'aria-label': 'Remover passo', onclick: () => { linha.remove(); renumerar(); } }, '×'));
    return linha;
  }
  for (const p of r?.passos || []) listaPassos.append(linhaPasso(p.texto));
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
      ingredientes.push({ grupo: grupoAtual, quantidade: qtd, unidade: campos[1].value.trim(), nome });
    }
    const passos = [...listaPassos.querySelectorAll('textarea')].map(t => t.value.trim()).filter(Boolean);
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
      location.hash = `#/receita/${idReceita}`;
    } catch (e) {
      status.className = 'status erro';
      status.textContent = 'Não salvou: ' + erroAmigavel(e);
      botaoSalvar.disabled = false;
    }
  });

  mostrar(el('section', {},
    el('p', {}, el('a', { href: r ? `#/receita/${r.id}` : '#/' }, '← Cancelar')),
    el('h1', { text: r ? 'Editar receita' : 'Nova receita' }),
    el('div', { class: 'campo' }, el('span', { text: 'Foto' }), previa, el('div', { class: 'acoes' }, entradaFoto, botaoRemoverFoto), statusFoto),
    campo('Título', titulo),
    campo('Categoria', categoria),
    campo('Etiquetas', etiquetas, 'separadas por vírgula'),
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
      el('button', { class: 'botao pequeno', type: 'button', onclick: () => { listaPassos.append(linhaPasso()); renumerar(); } }, '+ Passo')),
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
    if (partes[0] === 'nova') return await telaFormulario(null);
    if (partes[0] === 'ajustes') return telaAjustes();
    return await telaLista();
  } catch (e) {
    mensagem(erroAmigavel(e), 'erro');
  }
}

async function iniciar() {
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
