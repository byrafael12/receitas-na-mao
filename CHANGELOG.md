# Histórico de versões

## Versão 5 (01/11/2026), Entrega 2: importação com IA

- **+ Nova** abre a importação: legenda, prints (até 10) e vídeo (até 5 minutos), em qualquer combinação. O aparelho reduz as imagens, tira até 30 quadros e o áudio do vídeo (mono 8 kHz); o vídeo nunca é enviado.
- Edge Function `importar-receita`: login obrigatório, só aceita o endereço do app, limite de 50 importações por dia, chama o Gemini (`gemini-3.1-flash-lite`) com formato fixo de resposta, limpa e corta a resposta, registra cada importação em `importacoes`.
- Tela de **Revisão**: campos preenchidos pela IA, aviso do que ela não encontrou com certeza, escolha da capa entre as imagens e quadros, "Descartar". Post com várias receitas: uma revisão por receita.
- Cadastro manual continua em **Nova receita > Cadastro manual**.
- Categoria **Bebidas**. Script `supabase/06-importacao-ia.sql`.
- CSP: `media-src blob:` (leitura do vídeo no aparelho).
- Testes locais: importação 29 de 29 (arquivos reais), função da IA 29 de 29, interface 25 de 25, lista 12 de 12.

## Versão 4 (01/11/2026), Entrega 1

- Abas de categoria na tela inicial: "Todas" + só as categorias que têm receitas (e "Sem categoria", se houver), com a contagem; rolam para o lado.
- Visão em **Grade** (3 receitas por linha no celular, 4 no tablet, 5 no notebook; título em até 2 linhas) ou **Lista** (miniatura de 72 px à esquerda, título, categoria, tempo e porções).
- O app lembra, em cada aparelho, a última categoria e a visão escolhidas.
- Testes locais: lista e abas 12 de 12; interface 25 de 25.

## Versão 3 (01/11/2026), Entrega 1

- "Carnes" passa a se chamar "Carne de rês".
- "Japonês" e "Chinês" viram uma única categoria, "Japonês e Chinês" (receitas das duas são movidas para ela).
- 11 categorias, Outras por último. Script `supabase/05-ajuste-categorias.sql` (pode rodar mais de uma vez).
- Testes locais: script 05 rodado 2 vezes sem duplicar, receitas movidas corretamente; interface 25 de 25.

## Versão 2 (01/11/2026), Entrega 1

- Receita ganha **Utensílios** (lista: frigideira, refratário, forma...) e **Observações** (texto livre no fim da receita), no formulário e na tela da receita.
- Categorias novas: Frango, Frutos do mar, Japonês e Chinês; ordem refeita, Outras por último (12 no total).
- Script `supabase/04-utensilios-observacoes-categorias.sql`: colunas novas, limites (30 utensílios de até 60 letras, observações até 3.000 letras), `salvar_receita` atualizada e categorias novas para o usuário existente.
- Testes locais: banco 21 de 21 + 8 de 8 (campos novos); interface 25 de 25.

## Versão 1 (31/10/2026), Entrega 1

- Login só com Google, sessão que continua conectada.
- Cadastro manual de receita: foto (reduzida no aparelho até 150 KB), título, categoria, etiquetas, porções, tempos, ingredientes com quantidade e unidade separadas e grupos (ex.: Recheio), passos numerados, link e autor da fonte.
- Lista de receitas, tela da receita, edição e exclusão.
- 8 categorias iniciais criadas no primeiro acesso.
- Atalho na tela de início (manifesto e ícones).
- Banco: 7 tabelas com RLS ligada e forçada, anon sem acesso, função `salvar_receita` (tudo ou nada), pasta privada `capas`.
- Backup automático no Google Drive pelo Apps Script, segunda e quinta, com rodízio de 8 recentes e 24 mensais.
- Script `supabase/03-fechar-rls-auto-enable.sql` (01/11/2026): tira de anon e authenticated a execução da função `rls_auto_enable`, apontada pelo Security Advisor.
- Testes locais: banco 21 de 21; interface 21 de 22 (a falha é a imagem de exemplo, sem internet no ambiente de teste).
