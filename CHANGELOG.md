# Histórico de versões

## Versão 22 (11/11/2026): lista de compras e unidades padrão

- **Lista de compras (IMP-008)**: na receita, **🛒 Lista de compras** põe os ingredientes na lista na porção escolhida (8 porções de uma receita de 4 = tudo em dobro). Pôr de novo pergunta e troca, sem duplicar. O ícone 🛒 no topo mostra quantos itens faltam.
  - Na tela da lista, ingredientes iguais de receitas diferentes são somados: 400 g + 1 kg de açúcar = 1,4 kg; 500 ml + 1 l de leite = 1,5 l; "ovos" + "Ovos grandes" = 8 un; "cebolas picadas" junta com "cebola". Cada item mostra de quais receitas veio.
  - Tocar risca (vai para o fim). **Adicionar** aceita item digitado ("2 kg arroz", "papel toalha"). **Compartilhar** e **Copiar texto** mandam só o que falta comprar, com as receitas. **Apagar marcados**, **✕** em cada receita (tira só os itens dela) e **Limpar lista**.
  - Sem internet: dá para consultar e riscar. A marcação fica no aparelho e vai para o Supabase quando a conexão volta.
  - Só para o titular; contas de leitura não veem.
- **Unidades padrão (IMP-011, auditoria AUD-010)**: lista de 27 unidades (g, kg, ml, l, xícara (chá), colher (sopa), colher (sobremesa), colher (chá), copo, pitada, un, dente, gomo, fatia, folha, ramo, maço, lata, caixa, pacote, vidro, sachê, tablete, barra, rolo, pedaço, punhado).
  - A IA recebe a lista, e a função corrige o que vier fora dela: "colheres de sopa", "colher sopa" e "cs" viram "colher (sopa)"; "unidades" vira "un"; "a gosto" fica sem unidade. Unidade fora da lista vai para o nome ("1 bisnaga de maionese").
  - No formulário, o campo Unidade sugere a lista, e ao salvar o sinônimo vira a forma padrão. Unidade escrita fora da lista é aceita como está.
  - Receitas antigas não mudam sozinhas: só quando você edita e salva. A lista de compras padroniza na hora de somar.
- **Script 13** (tabela `lista_compras`) e **Deploy** da função `importar-receita`.
- Testes locais: versão 22 48 de 48, SQL 13 26 de 26, função da IA 90 de 90 (8 novos de unidades). Regressão: versão 21 17 de 17, versão 20 36 de 36, versão 19 49 de 49, versão 18 54 de 54, versão 17 39 de 39, extensão 27 de 27, importação 47 de 47, cadastro 25 de 25, lista 32 de 32, sem internet 17 de 17, compartilhar 21 de 21, cozinha 21 de 21, versão 13 31 de 31, backup 22 de 22, login 7 de 7, áudio 7 de 7.

## Versão 21 (11/11/2026): fotos no backup automático do Drive

- **Fotos no backup automático (IMP-005, auditoria de 10/11)**: além do JSON das receitas, cada rodada de segunda e quinta copia para a subpasta **fotos** (Backups > Receitas na mão) só as fotos novas: capas e fotos dos passos. Foto já copiada não é baixada de novo; foto que saiu do app continua no Drive (nada é apagado ali). Se a rodada passar de 4 minutos, o resto fica para a próxima.
- **Função nova `fotos-backup` (Edge Function)** e **script 12** (`backup_fotos`): o Apps Script pede links de 5 minutos para baixar as fotos. A função só responde com a chave de backup certa e só para fotos em uso. O Apps Script continua sem nenhuma chave secreta.
- **Restaurar com fotos do Drive**: a função `montarRestauracaoComFotos` (rodar à mão no Apps Script, só quando precisar) junta o backup mais recente com as fotos em arquivos **restaurar-com-fotos-...-parte-N-de-M.json** (até 20 MB cada), na subpasta **restauracao**. Cada parte leva um grupo de receitas completo e é restaurada em Ajustes > Restaurar, uma de cada vez, em qualquer ordem. O app não mudou a restauração: só o texto de ajuda.
- **E-mails**: falha nas fotos avisa sempre ("backup salvo, FOTOS com problema"), mesmo com o JSON salvo. O resumo informa fotos em uso, copiadas, pendentes e com falha.
- App: versão 21 só com textos de Ajustes > Backup. Sem mudança na função da IA.
- Testes locais: Apps Script 44 de 44 (Apps Script falso + função real em Deno), função fotos-backup 24 de 24, SQL 12 14 de 14, restauração das partes pelo app 17 de 17; regressão: versão 20 36 de 36, versão 19 49 de 49, versão 18 54 de 54, versão 17 39 de 39, extensão 27 de 27, importação 47 de 47, cadastro 25 de 25, lista 32 de 32, sem internet 17 de 17, compartilhar 21 de 21, cozinha 21 de 21, versão 13 31 de 31, backup 22 de 22, login 7 de 7, áudio 7 de 7.

## Versão 20 (11/11/2026): categorias vazias ocultas, ordenar e filtrar por etiqueta

- **Categorias vazias ocultas (IMP-016, pedido de Rafael)**: a tela inicial mostra só Todas, ★ Favoritas (se houver), as categorias com receitas e Sem categoria (se houver). A categoria aparece sozinha quando recebe a 1ª receita. Em Ajustes > Editar categorias continuam todas.
- **Ordenar (IMP-009)**: na lista de cada categoria e na busca da tela inicial, **Ordenar**: Mais recentes, A a Z (sem ligar para acento) ou Menor tempo (receitas sem tempo vão para o fim). A escolha fica lembrada.
- **Filtrar por etiqueta (IMP-009)**: abaixo da busca, as etiquetas das receitas da tela viram botões. Tocar filtra; com duas ou mais, só as receitas que têm todas; **✕ Limpar** tira o filtro. Funciona junto com a busca, vale para cada categoria e continua ao voltar da receita.
- **Biblioteca do Supabase 2.119.0 (IMP-012)** no app (`lib/supabase.js`), 0 vulnerabilidades. A função da IA continua na 2.118.0 (não precisa de novo Deploy).
- **Timers dizem de qual passo são (ajuste do aceite da versão 19, pedido de Rafael)**: cada timer do painel mostra **Passo N · grupo** (ex.: "Passo 2 · Molho") e o começo do texto do passo; com timers de receitas diferentes, também o nome da receita. O botão ⏱ do passo mostra o tempo que falta enquanto o timer corre (e não cria outro se tocado de novo). Painel mais compacto ("+1" no lugar de "+1 min") e limitado a 38% da tela, com rolagem quando há muitos timers.
- **Limpeza (IMP-013)**: saiu do app o trecho que desligava o `sw.js` do incidente de 01/11 (apagado em 09/11).
- Sem SQL e sem mudança na função da IA.
- Testes locais: versão 20 36 de 36, versão 19 49 de 49, versão 18 54 de 54, extensão 27 de 27, importação 47 de 47, cadastro 25 de 25, lista 32 de 32, sem internet 17 de 17, compartilhar 21 de 21, cozinha 21 de 21, versão 13 31 de 31, backup 22 de 22, login 7 de 7, versão 17 39 de 39, áudio 7 de 7.

## Versão 19 (10/11/2026): tela inicial por categorias, modo cozinha e timers

- **Tela inicial por categorias (IMP-015, pedido de Rafael)**: um quadro por categoria, com a foto da receita mais recente e a quantidade ("11 receitas"). Primeiro **Todas** e **★ Favoritas** (só quando há favoritas), depois as categorias com receitas (A a Z), **Sem categoria** (se houver) e, no fim, as vazias. Saiu a barra de abas. A busca da tela inicial procura em todas e mostra as receitas encontradas; limpando, voltam os quadros. Tocar num quadro abre a lista da categoria (com busca só dentro dela, grade/lista e "← Categorias"). "← Voltar" da receita leva à categoria de onde você veio, no mesmo lugar.
- **Modo cozinha (IMP-006)**: botão **👩‍🍳 Modo cozinha** na receita. Um passo por vez, letra grande, nome do grupo (Massa, Recheio), foto do passo e barra de progresso. **← Anterior / Próximo →** (grandes, sempre visíveis), deslizar o dedo para o lado ou setas do teclado. **Ingredientes** abre a lista com a porção escolhida na receita. Tela acesa enquanto estiver no modo cozinha. **✕ Sair** guarda o passo; **Concluir ✓** no último volta à receita.
- **Timers (IMP-007)**: tempos escritos nos passos ("40 minutos", "1 h 30", "meia hora", "20 a 25 minutos", "10 segundos") viram botões **⏱**. O timer aparece num painel no pé da tela, continua em todas as telas e depois de recarregar, com **Pausar**, **+1 min** e **✕**. No fim: "Pronto!", alarme sonoro por até 1 minuto (vibra no Android), título da aba "⏰ Pronto!" e **Parar**. Limite do iPhone: com o app em segundo plano o som não toca; ao voltar, o aviso aparece na hora.
- Impressão sem timers e sem o botão do modo cozinha.
- Sem SQL e sem mudança na função da IA.
- Testes locais: versão 19 49 de 49, versão 18 54 de 54, extensão 27 de 27, importação 47 de 47, cadastro 25 de 25, lista 32 de 32, sem internet 17 de 17, compartilhar 21 de 21, cozinha 21 de 21, versão 13 31 de 31, backup 22 de 22, login 7 de 7, versão 17 39 de 39, áudio 7 de 7.

## Versão 18 (10/11/2026): pronto para 200+ receitas (auditoria de 10/11)

- **Abre na hora (IMP-001)**: com a cópia no aparelho, a lista aparece na hora e a leitura do Supabase corre por trás. Se demorar mais de 1,5 s, aparece "Atualizando…" discreto ao lado do nome do app. Só redesenha se algo mudou de verdade, e nunca por cima de um formulário. Sem resposta da rede, mostra a faixa "Sem internet" como antes. Com rede de 4G simulada (0,3 s por consulta), abrir caiu de 2,6 s para 1,3 s; com rede travada, de 6,4 s para 0,4 s.
- **Volta ao mesmo lugar da lista (IMP-002)**: abrir uma receita e voltar (gesto ou "← Voltar") devolve a lista à mesma posição, em grade e em lista, com busca e aba mantidas.
- **Trabalho não salvo (IMP-003)**:
  - Edição e cadastro manual: sair com alteração pergunta "Sair sem salvar?"; sem alteração, não pergunta. Vale para "← Cancelar", gesto Voltar e fechar a aba.
  - Revisão da IA: tudo o que foi lido e corrigido (texto, quantidades, passos, fotos dos passos e capa) fica guardado no aparelho até Salvar ou Descartar. Sobrevive a Voltar/Avançar, a recarregar e ao iPhone fechar o app em segundo plano. A lista e a tela Nova mostram "Revisão em andamento" com **Continuar revisão** e **Descartar**. Ler outra receita com revisão pendente pergunta antes. Sair da conta apaga o rascunho.
  - Extensão do Chrome: com revisão pendente, o post chega preenchido, mas não é lido sozinho.
- **Atualiza ao voltar ao app (IMP-004)**: voltar do segundo plano depois de 5 minutos ou mais busca novidades (ex.: receita salva no notebook aparece no iPhone sem fechar o app). Nunca durante cadastro, edição, revisão ou importação.
- **Acabamentos (IMP-010)**: contraste do contador da aba ativa; rótulo no campo de foto; botões, abas, "← Voltar" e o nome do app com pelo menos 44 px de toque; "Minhas receitas (300)" e "+ Nova" numa linha só; impressão da receita sem barras e botões, em fundo branco.
- Sem SQL e sem mudança na função da IA ou no service worker.
- Testes locais: versão 18 54 de 54, extensão 27 de 27, importação 47 de 47, cadastro 25 de 25, lista 30 de 30, sem internet 17 de 17, compartilhar 21 de 21, cozinha 21 de 21, versão 13 31 de 31, backup 22 de 22, login 7 de 7, versão 17 39 de 39, áudio 7 de 7.

## Versão 17 (07/11/2026): foto em cada passo e vídeo na receita

- **Foto em cada passo**: no formulário, cada passo tem **📷 Foto do passo** (ou **Trocar foto** e **Sem foto**). Na revisão da IA, a lista mostra os prints e os quadros do vídeo enviados, e **Do aparelho…**; na edição, abre direto as fotos do aparelho. A foto é reduzida para até 80 KB e aparece abaixo do passo na receita (tocar risca o passo, como o texto). Até 30 fotos por receita.
- **IA sugere as fotos**: ao importar com prints ou vídeo, a IA indica qual imagem mostra cada passo (a massa no ponto, a calda engrossando); cada imagem vai para no máximo um passo; na dúvida, nenhuma. Você confere e troca na revisão.
- **Ver vídeo**: receita com fonte do YouTube, Instagram ou TikTok ganha o botão **▶ Ver vídeo** no modo de preparo, com o player oficial dentro do app (YouTube sem cookies). Nada é carregado antes do toque. Precisa de internet; se o autor não permitir assistir fora do Instagram/TikTok, use "abrir original".
- Fotos dos passos ficam na cópia do aparelho (funcionam sem internet), entram no backup com fotos e voltam na restauração; excluir a receita apaga capa e fotos dos passos; foto trocada ou removida é apagada do armazenamento; se o salvamento falhar, as fotos enviadas naquela tentativa são apagadas.
- Correções: Ajustes > "Atualizar cópia agora" não volta mais para Ajustes se você saiu da tela antes de terminar, e o botão volta a funcionar depois de um erro.
- Script `supabase/11-foto-nos-passos.sql`. Função da IA atualizada (foto sugerida por passo).
- Testes locais: versão 17 39 de 39, banco 12 de 12 (script 11) e scripts 08 a 10 com o 11, função 82 de 82, extensão 26 de 26, importação 47 de 47, cadastro 25 de 25, lista 30 de 30, sem internet 17 de 17, compartilhar 21 de 21, cozinha 21 de 21, versão 13 31 de 31, backup 22 de 22, login 7 de 7, áudio 7 de 7, service worker 5 de 5.

## Versão 16 (07/11/2026): receitas salvas no Instagram

- **Extensão do Chrome** (pasta `extensao-chrome` do projeto, fora deste repositório): botão **🍳 Enviar para Receitas** nos posts e reels do instagram.com. Lê o post na tela do próprio usuário (legenda, autor e foto) e abre ou reaproveita a aba do app na **Nova receita**, que já manda ler com a IA. Um clique, um post; sem robô.
- **Colar a legenda** (sem extensão, também no iPhone): com legenda, prints ou vídeo, o link do Instagram ou Facebook vai só como fonte; a função da IA não tenta mais abrir o post (era bloqueada) e o aviso "Link não lido" some.
- **Receita repetida**: ao colar ou receber um link já importado (mesmo post do Instagram, mesmo vídeo do YouTube ou mesmo endereço), o app avisa com link para a receita existente; pela extensão, não chama a IA.
- Reel sem legenda: o app preenche link, autor e foto e pede o vídeo ou prints.
- Função da IA: limite de **150 importações por dia até 31/01/2027**; volta sozinho a 50 em 01/02/2027.
- Sem SQL.
- Testes locais: extensão 26 de 26, função 80 de 80, importação 47 de 47, cadastro 25 de 25, lista 30 de 30, sem internet 17 de 17, compartilhar 21 de 21, cozinha 21 de 21, versão 13 31 de 31, backup 22 de 22, login 7 de 7, service worker 5 de 5.

## Versão 15 (02/11/2026), Entrega 4: correções da avaliação de segurança

- **S1, login PKCE**: o Google devolve só um código de uso único (`?code=`), trocado pela sessão com um segredo guardado no aparelho. O crachá de acesso não passa mais pelo endereço nem fica no histórico do navegador. Se a troca falhar (ex.: o login abriu numa janela separada no iPhone), o app mostra "O login não terminou neste aparelho" em vez de travar. Para voltar ao modo antigo: em `app.js`, trocar `flowType: 'pkce'` por `flowType: 'implicit'`.
- **S2, limite real de tamanho**: a função da IA conta os bytes do pedido; acima de 18 MB recusa (413), mesmo sem o cabeçalho Content-Length.
- **S3, mensagens curtas**: erros da IA aparecem na tela com mensagem curta; o detalhe técnico fica só no registro da importação e nos logs da função.
- Sem SQL.
- Testes locais: login 7 de 7, função 80 de 80, backup 22 de 22, versão 13 31 de 31, cozinha 21 de 21, compartilhar 21 de 21, sem internet 17 de 17, importação 47 de 47, cadastro 25 de 25, lista 30 de 30.

## Versão 14 (02/11/2026), Entrega 4: baixar e restaurar backup

- **Baixar backup** (Ajustes > Backup): arquivo com receitas, ingredientes, passos, categorias e etiquetas, no mesmo formato do backup automático do Drive; opção **Incluir as fotos**. No iPhone abre o compartilhamento (Salvar em Arquivos); no computador, vai para Downloads. Funciona também sem internet (usa a cópia do aparelho).
- **Restaurar**: aceita o arquivo do app e o do Drive. Mostra antes quantas receitas voltam e quantas já existem, e pede confirmação. **Só acrescenta o que falta**: nada é apagado nem substituído; restaurar de novo não duplica.
- Na restauração: mesmo código da receita; categorias reaproveitadas pelo nome (as que faltam são recriadas); foto original reaproveitada se ainda existir, senão reenviada a partir do backup (se tiver fotos); só entram dados da sua conta; antes de comparar, o app atualiza a cópia (receita nova de outro aparelho nunca é regravada).
- Só o titular vê a seção Backup. Restaurar precisa de internet.
- Sem SQL e sem mudança na função da IA.
- Testes locais: backup 22 de 22, versão 13 31 de 31, cozinha 21 de 21, compartilhar 21 de 21, sem internet 17 de 17, importação 47 de 47, cadastro 25 de 25, lista 30 de 30.

## Versão 13 (02/11/2026), Entrega 4: favoritas, categorias e porção digitada

- **Porção digitada** (sugestão de Rafael): toque no número de porções e digite (30, 2,5 ou 1 1/2); Enter ou tocar fora confirma, Esc cancela. Limite de 1/4 a 20 vezes a receita, com aviso se ajustar. O + e o − continuam.
- **Favoritas**: botão **☆ Favoritar / ★ Favorita** na receita; aba **★ Favoritas** na lista (logo depois de Todas, só quando há favoritas); estrela no cartão (grade) e antes do título (lista). Marcar favorita não muda a ordem da lista. Conta só de leitura marca favoritas só no próprio aparelho.
- **Categorias editáveis**: Ajustes > **Editar categorias**: renomear (tocando no nome), criar e remover. Remover não apaga receitas: elas vão para "Outras", de uma vez, sem mudar a ordem da lista. "Outras" não pode ser renomeada nem removida. Nome repetido é recusado. Limite de 40 categorias.
- Script `supabase/10-favoritas-e-categorias.sql`: favorita e mudança de categoria em lote não alteram a data da receita; função `remover_categoria`.
- Testes locais: banco 14 de 14 (script 10) e 26 de 26 (script 09 com o 10), versão 13 31 de 31, cozinha 21 de 21, compartilhar 21 de 21, sem internet 17 de 17, importação 47 de 47, cadastro 25 de 25, lista 30 de 30.

## Versão 12 (02/11/2026), Entrega 4: na cozinha

- **Porções com recálculo**: na receita, seletor **Porções − 4 +** acima dos ingredientes. As quantidades mudam na hora (4 para 8 dobra; "a gosto" não muda), com arredondamento de cozinha: 10 ou mais vira número inteiro (750 g), abaixo disso a fração mais próxima (1/2, 1/3, 3/4, 1/8). **Original** volta ao cadastrado. Só muda a visualização; a receita salva continua igual. Receita sem porções cadastradas: multiplicador (1x, 1,5x, 2x...).
- **Compartilhar e Copiar texto** levam as quantidades da porção escolhida.
- **Manter tela acesa**: botão na receita (☀) que impede a tela de apagar enquanto você cozinha. Volta a valer quando o app retorna do segundo plano e desliga ao sair da receita. Só aparece se o navegador tiver suporte.
- **Riscar itens**: toque num ingrediente ou passo para riscar o que já foi feito; toque de novo para desfazer.
- Correção: tempo vazio não aparece mais como "null".
- Sem SQL, sem mudança na função da IA e no service worker.
- Testes locais: cozinha 21 de 21, compartilhar 21 de 21, sem internet 17 de 17, importação 47 de 47, cadastro 25 de 25, lista 30 de 30.

## Versão 11 (02/11/2026), Entrega 4: compartilhar com amigos e família

- **Compartilhar receita** (opção A): botões **Compartilhar** e **Copiar texto** na receita. O texto sai pronto para o WhatsApp (título em negrito, porções e tempos, ingredientes e preparo com grupos, utensílios, observações, fonte com link). No iPhone e no Windows abre o compartilhamento do aparelho; sem ele, abre o WhatsApp. Funciona também sem internet.
- **Contas só de leitura** (opção B): em Ajustes, **Quem pode ver as receitas**: o titular autoriza e remove e-mails. Quem entra com um e-mail autorizado vê, busca, compartilha e usa sem internet, mas não vê "+ Nova", Editar e Excluir; as telas de importar, cadastrar e editar mostram "Conta só de leitura". Tirar o e-mail corta o acesso na próxima abertura com internet.
- A regra fica no banco (script `supabase/09-compartilhar-leitura.sql`): só o titular grava (receitas, fotos, categorias, etiquetas, importações); leitores autorizados só leem; leitores não veem importações nem a lista de e-mails. A função da IA recusa contas de leitura (403).
- Ajustes: "1 receita" no singular; campo de e-mail com o mesmo estilo dos outros.
- Testes locais: banco 26 de 26, função 77 de 77, compartilhar e leitura 21 de 21, sem internet 17 de 17, importação 47 de 47, cadastro 25 de 25, lista 30 de 30, service worker do incidente 5 de 5.

## Versão 10 (02/11/2026), Entrega 4: funcionar sem internet

- **Cópia de todas as receitas e fotos no aparelho** (IndexedDB, o banco do próprio navegador). O app atualiza a cópia sempre que abre com internet, depois de salvar ou excluir, e pelo botão **Atualizar cópia agora** em Ajustes.
- **Service worker** (`service-worker.js`): guarda os arquivos do app. Com internet, busca sempre a versão nova (rede primeiro); sem internet ou com rede lenta (mais de 4 s), usa a cópia. Só mexe nos caches "receitas-app-" (o Controle Financeiro, no mesmo endereço, não é afetado).
- **Sem internet**: lista, busca, abas e receitas (com fotos) funcionam. Faixa no topo: "Sem internet: mostrando a cópia de dd/mm, hh:mm". Importar, cadastrar e editar mostram "Precisa de internet"; excluir avisa. Quando a internet volta, a faixa some e a cópia é atualizada sozinha.
- **Sessão vencida sem internet**: as receitas continuam visíveis, com botão **Entrar** para quando houver conexão.
- **Sair apaga a cópia** deste aparelho. Login de outra conta no mesmo aparelho também apaga a cópia anterior.
- Fotos passam a vir da cópia do aparelho também com internet (mais rápido e menos tráfego no Supabase).
- Leitura das tabelas em blocos de 1.000 com ordem única por id (antes, a busca ordenava só por receita, o que podia repetir ou pular linhas a partir de 1.000).
- O `sw.js` do incidente de 01/11, se ainda estiver ativo em algum aparelho, é trocado pelo `service-worker.js`.
- Sem SQL e sem mudança na função da IA.
- Testes locais: sem internet 17 de 17, troca do service worker do incidente 5 de 5, importação 47 de 47, cadastro 25 de 25, lista 30 de 30.

## Versão 9.2 (02/11/2026), ajustes pedidos no teste da Entrega 3

- **Grupos no modo de preparo**: botão **+ Grupo** também no preparo (ex.: Massa, Recheio, Cobertura), como já existia nos ingredientes. A numeração dos passos segue corrida entre os grupos (1, 2, 3...). Na tela da receita, cada grupo aparece com seu título.
- **Setas ↑ ↓ nos grupos** (preparo e ingredientes): o grupo novo entra no fim e sobe até o ponto certo; os itens abaixo dele passam a ser do grupo. Assim dá para agrupar receitas já cadastradas sem redigitar.
- A IA passa a devolver o grupo de cada passo (sites com preparo em seções, vídeos e legendas que separam massa e recheio).
- **Botão Cancelar** na importação: interrompe o preparo do vídeo e das imagens ou a espera pela IA. Nada é salvo. Obs.: se o pedido já chegou ao Supabase, a função termina sozinha e conta no limite de 50 por dia.
- Script `supabase/08-grupos-no-preparo.sql`: coluna `grupo` nos passos (até 60 letras) e `salvar_receita` aceitando passo com grupo (o formato antigo continua aceito).
- Testes locais: banco 5 de 5, função 75 de 75, importação 47 de 47, cadastro 25 de 25, lista 30 de 30.

## Versão 9.1 (02/11/2026): correção de arquivos do Controle Financeiro enviados por engano

- Em 01/11/2026 o commit "Versão 36: receitas previstas" (do Controle Financeiro) foi enviado a este repositório: trocou o `index.html` e instalou o `sw.js` (service worker) do outro app, que passou a abrir no lugar do Receitas na mão.
- `index.html` do Receitas na mão restaurado.
- `sw.js` substituído por um "desligador": apaga só o que foi guardado para /receitas-na-mao/, se desliga e recarrega. Pode ser apagado a partir de 09/11/2026 (iPhone e notebook já corrigidos em 02/11).
- `app.js` desliga qualquer service worker no endereço /receitas-na-mao/ ao abrir (não mexe no do Controle Financeiro).
- `05-contas-fixas-receitas.sql` e `Codigo.gs` da raiz apagados (eram do Controle Financeiro).

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
