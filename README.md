# receitas-na-mao

App pessoal de receitas em HTML, CSS e JavaScript, publicado no GitHub Pages, com dados no Supabase.

Endereço: https://byrafael12.github.io/receitas-na-mao/

## Estrutura

| Arquivo ou pasta | Para que serve |
| --- | --- |
| `index.html` | Página do app, com a política de segurança (CSP) |
| `app.js` | Lógica do app: login Google, lista, receita, formulário |
| `styles.css` | Aparência (tema claro e escuro automáticos) |
| `service-worker.js` | Guarda os arquivos do app no aparelho para abrir sem internet (versão 10) |
| `manifest.webmanifest` e `icones/` | Atalho na tela de início do iPhone |
| `lib/supabase.js` | Biblioteca supabase-js 2.119.0 servida pelo próprio site (sem CDN), licença MIT em `lib/LICENSE-supabase-js.txt` |
| `supabase/01-tabelas-e-seguranca.sql` | Tabelas, RLS forçada, função `salvar_receita`, pasta de imagens `capas` |
| `supabase/02-backup.sql` | Função de backup só de leitura, protegida por chave |
| `supabase/03-fechar-rls-auto-enable.sql` | Tira de anon e authenticated a execução da função `rls_auto_enable` |
| `supabase/04-utensilios-observacoes-categorias.sql` | Utensílios, observações e 4 categorias novas |
| `supabase/05-ajuste-categorias.sql` | Carne de rês; Japonês e Chinês numa só categoria; nova ordem |
| `supabase/06-importacao-ia.sql` | Tipo "combinado" nas importações e categoria Bebidas |
| `supabase/07-bebidas-e-drinks.sql` | "Bebidas" passa a "Bebidas e Drinks" |
| `supabase/08-grupos-no-preparo.sql` | Grupos (Massa, Recheio...) também no modo de preparo |
| `supabase/09-compartilhar-leitura.sql` | Titular grava; amigos e família autorizados (tabela `leitores`) só leem |
| `supabase/10-favoritas-e-categorias.sql` | Favorita não muda a data da receita; função `remover_categoria` (move receitas para Outras) |
| `supabase/11-foto-nos-passos.sql` | Foto em cada passo do preparo (`passos.imagem_caminho`), até 30 por receita, só na pasta do próprio usuário |
| `supabase/12-fotos-no-backup.sql` | Função `backup_fotos`: confere a chave de backup e lista as fotos em uso (versão 21) |
| `supabase/functions/importar-receita/index.ts` | Edge Function que lê o link (site, YouTube, TikTok, Instagram) e envia link, legenda, imagens e áudio ao Gemini, devolvendo a receita |
| `supabase/13-lista-de-compras.sql` | Tabela `lista_compras` (versão 22): só o titular lê e grava a própria lista; só marcar/desmarcar pode ser alterado; até 1.000 itens |
| `supabase/functions/fotos-backup/index.ts` | Edge Function do backup: links de 5 minutos para baixar só as fotos em uso, só com a chave de backup (versão 21) |
| `backup-drive/Codigo.gs` | Backup automático no Google Drive (Apps Script), segunda e quinta, com as fotos novas (versão 21) e montagem dos arquivos de restauração com fotos |

## Segurança

- O repositório é público e contém só código. Nenhuma chave secreta, senha, token ou dado de receita entra aqui.
- A chave `sb_publishable_` e o endereço do projeto Supabase são públicos por definição; o que protege os dados é o RLS: cada linha só é visível ao dono.
- Cadastro de novos usuários desligado no Supabase; login só com Google, app do Google em modo de teste (só os usuários de teste cadastrados conseguem entrar).
- Só o titular grava (RLS, script 09). Contas de amigos e família autorizadas em Ajustes só leem; a função da IA recusa essas contas.
- A chave do Gemini fica só no segredo `GEMINI_API_KEY` do Supabase; a função só aceita o endereço do app e usuário logado, com limite de 50 importações por dia (150 até 31/01/2027, para a migração do Instagram).
- Links importados: a função só baixa endereços públicos (http/https, portas padrão, nada de rede interna, conferido a cada redirecionamento), com limite de tamanho e de tempo.
- Lista de compras (versão 22): RLS forçada como nas receitas; contas de leitura não veem nem criam lista; uma receita só entra na lista do próprio dono (chave composta) e excluir a receita tira os itens dela. A lista não entra no backup (é temporária).
- Sem internet: a cópia das receitas fica só no aparelho de quem está logado (IndexedDB) e é apagada ao tocar em Sair.
- Todo texto de receita é exibido com `textContent`, nunca com `innerHTML` (proteção contra XSS). Links da fonte só `http` ou `https`.
- CSP permite scripts só do próprio site e conexões só com o Supabase; o app não abre dentro de iframe. Quadros (iframe) só dos players oficiais do YouTube (sem cookies), do Instagram e do TikTok, carregados só ao tocar em "Ver vídeo", isolados (sandbox) e recebendo só a origem do app (versão 17).
- Extensão do Chrome (versão 16, fica fora deste repositório, na pasta `extensao-chrome` do projeto): o app só aceita da extensão mensagens da própria página, com link do Instagram, legenda e foto conferidos.
- O backup usa uma função que só lê e só responde a uma chave própria (guardada nas Propriedades do Apps Script); o banco guarda apenas o hash dela. O Apps Script não tem nenhuma chave secreta do Supabase.
- Fotos no backup (versão 21): a função `fotos-backup` não tem login de usuário (Verify JWT desligado), por isso ela mesma confere a chave de backup no banco antes de tudo. Só gera links temporários (5 minutos) para fotos em uso. A chave secreta que gera os links é colocada pelo próprio Supabase dentro da função e não está no código nem no Apps Script.

## Versão

Ver `CHANGELOG.md`.
