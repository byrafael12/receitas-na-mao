# Histórico de versões

## Versão 9 (01/11/2026), Entrega 3: importar por link

- **Campo Link** no topo da tela Nova receita. Pode ir sozinho ou junto com legenda, prints e vídeo.
- **Site de receita**: a função baixa a página e lê os dados estruturados da receita (padrão schema.org/Recipe: ingredientes, preparo com seções, tempos, rendimento, autor e foto). Sem esses dados, lê o texto principal da página e avisa para conferir.
- **YouTube** (vídeo comum, Shorts, youtu.be): o Gemini assiste o vídeo pelo link oficial; título e canal vêm do oEmbed do YouTube e a miniatura vira opção de capa. Vídeo privado, não listado ou com restrição não funciona.
- **TikTok**: lê a legenda pelo oEmbed oficial do TikTok (o vídeo não vem).
- **Instagram e Facebook**: tentativa pelo resumo público da página; quando bloqueado (o mais comum), o app orienta copiar a legenda e salvar o vídeo.
- Foto do site ou miniatura do vídeo entra como opção de capa, já escolhida quando a IA não indicar outra. Autor e link da fonte preenchidos; receita salva como fonte "site" ou "rede".
- Segurança (SSRF): só http/https, portas padrão, sem endereço interno (rede local, nuvem, IPv6 local), conferência a cada redirecionamento (até 4), página até 2 MB, imagem até 3 MB, 10 s por download.
- Se o link falhar e houver legenda, prints ou vídeo, a receita é lida do resto, com aviso.
- Sem script SQL (os tipos "site" e "rede" já existiam).
- Testes locais: função 73 de 73 (36 da Entrega 2 + 37 de links e segurança), importação 38 de 38, cadastro 25 de 25, lista 30 de 30, áudio 7 de 7.

## Versão 8 (01/11/2026): busca e grade com 4 por linha

- **Busca na tela inicial**: procura no nome, nos ingredientes, nas etiquetas, nos utensílios e no autor da receita, sem diferenciar acento nem maiúscula ("mucarela" acha "muçarela"). Com várias palavras, todas precisam aparecer ("molho lasanha"). Funciona junto com a aba de categoria; as abas mostram quantas receitas cada uma tem no resultado. O texto da busca continua ao voltar de uma receita.
- **Grade com 4 receitas por linha no celular** (5 no tablet, 6 no notebook), capa quadrada, título menor em até 2 linhas.
- Ingredientes e etiquetas são lidos em blocos de 1.000 linhas (limite por consulta do Supabase), para a busca não perder nada quando a coleção crescer.
- Sem script SQL nesta versão.
- Testes locais: lista e busca 30 de 30, cadastro 25 de 25, importação 30 de 30, áudio 7 de 7.

## Versão 7 (01/11/2026), Entrega 2: IA mais resistente e ajustes pedidos

- **IA sobrecarregada (erro 503)**: a função espera 3 s e tenta de novo; se continuar, usa o modelo reserva `gemini-3.5-flash-lite` (também com cota gratuita) e tenta mais uma vez. Também vale para falta de cota (429). Tempo total limitado a 125 s. Mensagem clara se tudo falhar; o modelo usado fica em `importacoes.modelo_ia`.
- **Frações**: quantidades aparecem como 1/2, 1 1/2, 1/3, 3/4 (na receita e no formulário); o formulário aceita 1/2, 1 1/2, "1 e 1/2", ½ e 0,5.
- **Categorias em ordem alfabética** (sem ligar para acentos), com Outras sempre por último, nas abas e na seleção.
- **"Bebidas" passa a "Bebidas e Drinks"**: script `supabase/07-bebidas-e-drinks.sql`.
- **Lista mais compacta**: miniatura de 52 px, espaçamento e letras menores.
- Testes locais: importação 30 de 30, função 36 de 36, cadastro 25 de 25, lista 12 de 12, áudio 7 de 7.

## Versão 6 (01/11/2026), Entrega 2: áudio do vídeo no iPhone

- No 1º teste real no iPhone, o navegador não decodificou o áudio do vídeo e a IA leu só as imagens (faltaram quantidades ditas em voz alta).
- O app agora **copia a trilha de áudio AAC direto do arquivo MP4/MOV**, sem decodificar o som: lê o cabeçalho do vídeo (caixa `moov`), localiza os pedaços de áudio e monta um arquivo `.aac`. Funciona em qualquer navegador e gera metade do tamanho (mousse 2:59: 1,46 MB, antes 2,86 MB). Se o vídeo não tiver áudio AAC, tenta o método antigo (WAV); se nada der, avisa.
- Edge Function aceita `audio/aac` além de `audio/wav`.
- Testes locais: extração AAC 7 de 7 (MP4 do Instagram, MOV, cabeçalho no início e no fim, mono 22 kHz, vídeo sem áudio), áudio idêntico byte a byte ao extraído pelo ffmpeg; importação 29 de 29; função 33 de 33; interface 25 de 25; lista 12 de 12.

## Versão 5 (01/11/2026), Entrega 2: importação com IA

- **+ Nova** abre a importação: legenda, prints (até 10) e vídeo (até 5 minutos), em qualquer combinação. O aparelho reduz as imagens, tira até 30 quadros e o áudio do vídeo (mono 8 kHz); o vídeo nunca é enviado.
- Edge Function `importar-receita`: login obrigatório, só aceita o endereço do app, limite de 50 importações por dia, chama o Gemini (`gemini-3.1-flash-lite`) com formato fixo de resposta, limpa e corta a resposta, registra cada importação em `importacoes`.
- Tela de **Revisão**: campos preenchidos pela IA, aviso do que ela não encontrou com certeza, escolha da capa entre as imagens e quadros, "Descartar". Post com várias receitas: uma revisão por receita.
- Cadastro manual continua em **Nova receita > Cadastro manual**.
- Categoria **Bebidas**. Script `supabase/06-importacao-ia.sql`.
- CSP: `media-src blob:` (leitura do vídeo no aparelho).
- Correção (01/11/2026, após o 1º teste real: Gemini respondeu 400 "invalid argument"): a função tenta, em ordem, `responseJsonSchema`, `responseSchema`, JSON livre e, por último, JSON livre sem o áudio; o motivo de cada recusa vai para os logs da função e o formato que funcionou fica em `importacoes.modelo_ia`. Sem `temperature` (padrão do modelo). Testes da função: 31 de 31.
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
