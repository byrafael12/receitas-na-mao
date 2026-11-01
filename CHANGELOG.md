# Histórico de versões

## Versão 1 (31/10/2026), Entrega 1

- Login só com Google, sessão que continua conectada.
- Cadastro manual de receita: foto (reduzida no aparelho até 150 KB), título, categoria, etiquetas, porções, tempos, ingredientes com quantidade e unidade separadas e grupos (ex.: Recheio), passos numerados, link e autor da fonte.
- Lista de receitas, tela da receita, edição e exclusão.
- 8 categorias iniciais criadas no primeiro acesso.
- Atalho na tela de início (manifesto e ícones).
- Banco: 7 tabelas com RLS ligada e forçada, anon sem acesso, função `salvar_receita` (tudo ou nada), pasta privada `capas`.
- Backup automático no Google Drive pelo Apps Script, segunda e quinta, com rodízio de 8 recentes e 24 mensais.
- Testes locais: banco 21 de 21; interface 21 de 22 (a falha é a imagem de exemplo, sem internet no ambiente de teste).
