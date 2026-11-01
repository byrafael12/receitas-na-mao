# receitas-na-mao

App pessoal de receitas em HTML, CSS e JavaScript, publicado no GitHub Pages, com dados no Supabase.

Endereço: https://byrafael12.github.io/receitas-na-mao/

## Estrutura

| Arquivo ou pasta | Para que serve |
| --- | --- |
| `index.html` | Página do app, com a política de segurança (CSP) |
| `app.js` | Lógica do app: login Google, lista, receita, formulário |
| `styles.css` | Aparência (tema claro e escuro automáticos) |
| `manifest.webmanifest` e `icones/` | Atalho na tela de início do iPhone |
| `lib/supabase.js` | Biblioteca supabase-js 2.118.0 servida pelo próprio site (sem CDN), licença MIT em `lib/LICENSE-supabase-js.txt` |
| `supabase/01-tabelas-e-seguranca.sql` | Tabelas, RLS forçada, função `salvar_receita`, pasta de imagens `capas` |
| `supabase/02-backup.sql` | Função de backup só de leitura, protegida por chave |
| `supabase/03-fechar-rls-auto-enable.sql` | Tira de anon e authenticated a execução da função `rls_auto_enable` |
| `supabase/04-utensilios-observacoes-categorias.sql` | Utensílios, observações e 4 categorias novas |
| `supabase/05-ajuste-categorias.sql` | Carne de rês; Japonês e Chinês numa só categoria; nova ordem |
| `supabase/06-importacao-ia.sql` | Tipo "combinado" nas importações e categoria Bebidas |
| `supabase/07-bebidas-e-drinks.sql` | "Bebidas" passa a "Bebidas e Drinks" |
| `supabase/functions/importar-receita/index.ts` | Edge Function que envia legenda, imagens e áudio ao Gemini e devolve a receita |
| `backup-drive/Codigo.gs` | Backup automático no Google Drive (Apps Script), segunda e quinta |

## Segurança

- O repositório é público e contém só código. Nenhuma chave secreta, senha, token ou dado de receita entra aqui.
- A chave `sb_publishable_` e o endereço do projeto Supabase são públicos por definição; o que protege os dados é o RLS: cada linha só é visível ao dono.
- Cadastro de novos usuários desligado no Supabase; login só com Google, app do Google em modo de teste com um único usuário autorizado.
- A chave do Gemini fica só no segredo `GEMINI_API_KEY` do Supabase; a função só aceita o endereço do app e usuário logado, com limite de 50 importações por dia.
- Todo texto de receita é exibido com `textContent`, nunca com `innerHTML` (proteção contra XSS). Links da fonte só `http` ou `https`.
- CSP permite scripts só do próprio site e conexões só com o Supabase; o app não abre dentro de iframe.
- O backup usa uma função que só lê e só responde a uma chave própria (guardada nas Propriedades do Apps Script); o banco guarda apenas o hash dela. A chave `service_role` não é usada.

## Versão

Ver `CHANGELOG.md`.
