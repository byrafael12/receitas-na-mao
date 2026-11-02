// =====================================================================
// Receitas na mão · service-worker.js (versão 10: funcionar sem internet)
//
// Guarda os arquivos do app (página, código, estilos, ícones) no aparelho.
// Estratégia "rede primeiro": com internet, sempre busca a versão nova e
// atualiza a cópia; sem internet (ou rede lenta, mais de 4 s), usa a cópia.
// As receitas e fotos NÃO passam por aqui: o app guarda essa cópia no
// IndexedDB (ver "Cópia no aparelho" no app.js).
// Só atua dentro de /receitas-na-mao/ e só mexe nos caches "receitas-app-"
// (o Controle Financeiro, no mesmo endereço github.io, não é afetado).
// =====================================================================

const CACHE = 'receitas-app-10';
const ARQUIVOS = [
  './', 'index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'lib/supabase.js',
  'icones/icone-192.png', 'icones/icone-512.png', 'icones/apple-touch-icon.png'
];
const ESPERA_REDE_MS = 4000;

self.addEventListener('install', (evento) => {
  evento.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Um arquivo que falhar não impede os outros.
    await Promise.all(ARQUIVOS.map(a => cache.add(new Request(a, { cache: 'no-cache' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    for (const nome of await caches.keys()) {
      if (nome.startsWith('receitas-app-') && nome !== CACHE) await caches.delete(nome);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  // Só os arquivos do próprio app; Supabase e outros sites seguem direto.
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  evento.respondWith(redePrimeiro(pedido));
});

async function redePrimeiro(pedido) {
  const cache = await caches.open(CACHE);
  const daRede = fetch(pedido, { cache: 'no-cache' }).then(async (resposta) => {
    if (resposta.ok && resposta.type === 'basic') await cache.put(pedido, resposta.clone());
    return resposta;
  });
  daRede.catch(() => {}); // se a cópia já respondeu, a falha da rede não importa
  try {
    return await Promise.race([
      daRede,
      new Promise((_, falhar) => setTimeout(() => falhar(new Error('rede lenta')), ESPERA_REDE_MS))
    ]);
  } catch {
    const guardado = await cache.match(pedido, { ignoreSearch: true })
      || (pedido.mode === 'navigate' ? await cache.match('index.html') : undefined);
    if (guardado) return guardado;
    return daRede; // nada guardado: espera a rede mesmo (ou mostra o erro dela)
  }
}
