// Receitas na mão · sw.js "desligador" (02/11/2026)
//
// Em 01/11/2026 o service worker do app Controle Financeiro foi enviado
// por engano para este repositório e ficou instalado nos aparelhos,
// mostrando o outro app no lugar deste. Este arquivo o substitui: quando
// o navegador busca a atualização, ele se instala, apaga só o que foi
// guardado para /receitas-na-mao/, se desliga e recarrega a página.
// O Receitas na mão não usa service worker (a leitura offline fica para a
// Entrega 4). Pode apagar este arquivo do repositório em dezembro/2026.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    try {
      for (const nome of await caches.keys()) {
        const cache = await caches.open(nome);
        for (const pedido of await cache.keys()) {
          if (new URL(pedido.url).pathname.startsWith('/receitas-na-mao/')) await cache.delete(pedido);
        }
      }
    } catch { /* segue para desligar mesmo assim */ }
    await self.registration.unregister();
    const janelas = await self.clients.matchAll({ type: 'window' });
    for (const janela of janelas) {
      try { await janela.navigate(janela.url); } catch { /* o usuário recarrega */ }
    }
  })());
});
