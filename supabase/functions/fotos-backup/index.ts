/* =====================================================================
   Receitas na mão · Edge Function "fotos-backup" (versão 21)

   Usada só pelo backup automático (Apps Script). Entrega links
   temporários (5 minutos) para baixar as fotos da pasta privada "capas".

   Segurança:
   - Não tem login de usuário: quem chama é o Apps Script. Por isso o
     "Verify JWT" desta função fica DESLIGADO e a própria função confere
     a chave de backup, perguntando à função backup_fotos do banco
     (script 12). Chave errada: 403, nada é entregue.
   - Só gera link para fotos que a backup_fotos listou (capas e passos
     em uso). Pedir qualquer outro caminho é ignorado.
   - A chave secreta do Supabase é lida das variáveis que o próprio
     Supabase coloca na função. Ela nunca sai daqui e não está no código.
   - Só aceita POST, sem CORS: não é para ser chamada por navegador.

   Pedido:   POST { "chave": "...", "caminhos": ["uid/a.jpg", ...] }  (até 50)
   Resposta: { "links": { "uid/a.jpg": "https://..." }, "ignorados": [...] }
   ===================================================================== */
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const PASTA = 'capas';
const MAX_POR_PEDIDO = 50;
const VALIDADE_S = 300;

function resposta(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function chaveDoAmbiente(nomeNova: string, nomeAntiga: string): string {
  try {
    const chaves = JSON.parse(Deno.env.get(nomeNova) || '{}');
    const valor = chaves.default || Object.values(chaves)[0];
    if (typeof valor === 'string' && valor) return valor;
  } catch { /* usa a antiga */ }
  return Deno.env.get(nomeAntiga) || '';
}

const caminhoValido = (c: unknown): c is string =>
  typeof c === 'string' && c.length > 0 && c.length <= 300 && !c.includes('..') && !c.startsWith('/');

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return resposta(405, { erro: 'Use POST' });
  const tamanho = Number(req.headers.get('content-length') || '0');
  if (tamanho > 64 * 1024) return resposta(413, { erro: 'Pedido grande demais' });

  let corpo: { chave?: unknown; caminhos?: unknown };
  try { corpo = await req.json(); } catch { return resposta(400, { erro: 'JSON inválido' }); }
  const chave = corpo?.chave;
  const pedidos = corpo?.caminhos;
  if (typeof chave !== 'string' || chave.length < 40 || chave.length > 200) return resposta(403, { erro: 'Acesso negado' });
  if (!Array.isArray(pedidos) || pedidos.length === 0) return resposta(400, { erro: 'Informe os caminhos' });
  if (pedidos.length > MAX_POR_PEDIDO) return resposta(400, { erro: `Máximo de ${MAX_POR_PEDIDO} caminhos por pedido` });

  const url = Deno.env.get('SUPABASE_URL')!;
  // 1. Confere a chave no banco (com a chave pública, igual ao Apps Script).
  const publico = createClient(url, chaveDoAmbiente('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: lista, error: erroLista } = await publico.rpc('backup_fotos', { chave });
  if (erroLista) {
    const negado = erroLista.code === '42501' || /negado/i.test(erroLista.message || '');
    console.log('backup_fotos falhou:', erroLista.code, negado ? '(chave)' : erroLista.message);
    return resposta(negado ? 403 : 502, { erro: negado ? 'Acesso negado' : 'Falha ao consultar o banco' });
  }
  const emUso = new Set<string>(Array.isArray(lista?.caminhos) ? lista.caminhos : []);

  const pedidosUnicos = [...new Set(pedidos)];
  const aceitos = pedidosUnicos.filter(c => caminhoValido(c) && emUso.has(c)) as string[];
  const ignorados = pedidosUnicos.filter(c => !aceitos.includes(c as string));
  if (!aceitos.length) return resposta(200, { links: {}, ignorados });

  // 2. Links temporários com a chave secreta (só aqui dentro).
  const secreto = createClient(url, chaveDoAmbiente('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: assinados, error: erroLinks } = await secreto.storage.from(PASTA).createSignedUrls(aceitos, VALIDADE_S);
  if (erroLinks) {
    console.log('createSignedUrls falhou:', erroLinks.message);
    return resposta(502, { erro: 'Falha ao gerar os links' });
  }
  const links: Record<string, string> = {};
  for (const a of assinados || []) {
    if (a?.path && a.signedUrl && !a.error) links[a.path] = a.signedUrl;
    else if (a?.path) ignorados.push(a.path);
  }
  console.log(`fotos-backup: ${Object.keys(links).length} link(s), ${ignorados.length} ignorado(s)`);
  return resposta(200, { links, ignorados });
});
