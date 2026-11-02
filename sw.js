/* Controle Financeiro: service worker (Entrega 6; versão 24).
   Guarda no aparelho os arquivos do app para ele abrir mesmo sem internet.
   - Página (index.html): busca na internet primeiro (para receber versões novas) e usa a cópia se não houver rede.
   - Bibliotecas, ícones e manifesto: usa a cópia guardada e atualiza em segundo plano.
   - Dados do Supabase NÃO passam por aqui (outro endereço): ficam no IndexedDB, cuidados pelo próprio app.
   Ao publicar uma versão nova, troque VERSAO para o aparelho baixar tudo de novo. */
const VERSAO = "cf-v36";
const ARQUIVOS = ["./", "./index.html", "./lib/supabase.js", "./manifest.webmanifest",
  "./icone-192.png", "./icone-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", evento => {
  evento.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", evento => {
  evento.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(nomes.filter(n => n !== VERSAO).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", evento => {
  const pedido = evento.request;
  if (pedido.method !== "GET") return;
  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return; // Supabase e outros: direto pela rede

  const ehPagina = pedido.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("/index.html");
  if (ehPagina) {
    // Rede primeiro; sem rede, a última página guardada
    evento.respondWith(
      fetch(pedido)
        .then(resposta => {
          if (resposta.ok) { const copia = resposta.clone(); caches.open(VERSAO).then(c => c.put("./index.html", copia)); }
          return resposta;
        })
        .catch(() => caches.match("./index.html").then(r => r || caches.match("./")))
    );
    return;
  }
  // Arquivos fixos: cópia guardada primeiro, rede como reserva
  evento.respondWith(
    caches.match(pedido).then(guardado => guardado || fetch(pedido).then(resposta => {
      if (resposta.ok) { const copia = resposta.clone(); caches.open(VERSAO).then(c => c.put(pedido, copia)); }
      return resposta;
    }))
  );
});
