# Controle Financeiro

App pessoal de controle financeiro de Rafael de Freitas: receitas, despesas, cartões de crédito, compras parceladas, contas fixas, reembolsos e dashboard mensal.

## Como roda hoje (Entrega 5, a partir de out/2026)

- O app é um único arquivo, `index.html` (HTML, CSS e JavaScript, sem framework), publicado no GitHub Pages.
- Banco de dados e login no [Supabase](https://supabase.com/docs) (PostgreSQL, região São Paulo, plano Free), com a biblioteca oficial `@supabase/supabase-js` 2.118.0 (desde a versão 32), servida pelo próprio site, em `lib/`.
- Login por e-mail e senha + verificação em duas etapas (TOTP, Google Authenticator), com um único usuário; o cadastro de novas contas está desligado no painel.
- Cada tabela tem Row Level Security (RLS) forçada: cada pessoa logada só lê e grava as próprias linhas; sem login não há acesso.
- A chave do Supabase no código é a publishable, feita para ficar em código público. A secret key e a senha do banco nunca entram no repositório.
- Gráficos desenhados pelo próprio app em SVG (desde a versão 22). O Chart.js foi removido do repositório em 28/10/2026.
- Backup automático no Google Drive toda segunda e quinta-feira por Google Apps Script (`backup-drive/Codigo.gs`; o primeiro do mês avisa por e-mail); e-mail, senha e chave do autenticador ficam só nas Propriedades do script.
- Scripts do banco na pasta `supabase/` (rodados no SQL Editor do Supabase, em ordem).

## O que NÃO está neste repositório

- Nenhum dado financeiro: os lançamentos ficam no Supabase, protegidos por login e RLS, e os backups (JSON) ficam fora do GitHub.
- Nenhuma senha, token ou chave secreta (só a chave publishable, que é pública por definição).

## Sem internet (Entrega 6, 26/10/2026)

- `sw.js` (service worker) guarda os arquivos do app no aparelho; `manifest.webmanifest` e os ícones permitem o atalho na tela de início.
- Os dados lidos ficam numa cópia no aparelho (IndexedDB); sem internet, o app mostra essa cópia e avisa a data.
- Sem internet só é possível **criar** lançamentos: eles ficam numa fila "aguardando envio" e sobem sozinhos quando a conexão volta (mesmo código, sem duplicar). Editar, excluir, backup, exportação e restauração exigem conexão.
- Sair apaga a cópia e a fila do aparelho (e não deixa sair com lançamentos aguardando envio).

## Segurança (revisão OWASP Top 10, 25/10/2026)

| Risco OWASP | O que o app faz |
| --- | --- |
| A01 Controle de acesso | RLS forçada em todas as tabelas: cada usuário só vê as próprias linhas; sem login não há acesso; política restritiva exige `aal2` (senha + código) |
| A02 Falhas criptográficas | HTTPS em tudo (GitHub Pages e Supabase); senhas guardadas pelo Supabase Auth, nunca no app |
| A03 Injeção | Todo texto do banco é escapado antes de ir para a tela; CSP só executa o script do próprio app (hash) e as bibliotecas de `lib/`; o banco valida tipos e formatos |
| A04 Design inseguro | Valores em centavos inteiros; restrições no banco (tipo, status, competência, tamanhos) |
| A05 Configuração | Cadastro de novos usuários e login anônimo desligados; exposição automática de tabelas desligada; bloqueio do app dentro de iframe |
| A06 Componentes vulneráveis | Versões fixas e arquivos servidos pelo próprio site (sem CDN) |
| A07 Autenticação | Senha forte (8+ com número, maiúscula, minúscula e símbolo), verificação em duas etapas, recuperação de senha por e-mail sem revelar se a conta existe |
| A08 Integridade | Bibliotecas copiadas do pacote oficial do npm para `lib/`; nenhum script de terceiros carregado em tempo de execução |
| A09 Registro e monitoramento | Mensagens de erro sem detalhes técnicos para o usuário; logs do Supabase no painel; e-mail mensal de OK ou FALHOU do backup |
| A10 SSRF | Não se aplica (o app não faz pedidos do servidor para endereços informados pelo usuário) |

## Organização do código (`index.html`)

1. Configuração (formas de pagamento, paleta, categorias iniciais)
2. Regras de cálculo, sem tela: centavos, competência pela fatura do cartão, parcelas, totais, reembolsos
3. Acesso ao banco: camada `Banco` que traduz as coleções do app para as tabelas do Supabase (`lancamentos`, `categorias`, `cartoes`, `contas_fixas`, `orcamentos`, `geracoes`, `backups`, `config`)
4. Telas: Início, Lançamentos, Análise, Planejar (faturas, contas fixas e cartões), Ajustes, formulário (desde a versão 20); Início com livre para gastar e contas fixas editadas numa folha (desde a versão 21); Análise com filtros e gráficos em SVG, sem Chart.js (desde a versão 22); lançamento rápido, tabela no notebook, parcelas em andamento e sugestão de valor médio (desde a versão 23)
5. Gráficos e gestão: orçamento por média de 6 meses, comprometido futuro, backup JSON, exportação CSV, importação
6. Tema claro/escuro e botão + arrastável
7. Inicialização e login

## Regras principais

- Valores sempre em centavos inteiros (R$ 159,90 = 15990).
- Cartão: fechamento no dia anterior ao melhor dia de compra; a compra conta no mês em que a fatura vence.
- Parcelado (compra nova lançada no app): o total é dividido em centavos e a sobra fica na 1ª parcela.
- Parcela vinda da planilha (compra em andamento): cada parcela restante é cobrada pelo valor cheio, uma por fatura, sem redividir.
- Contas fixas nascem como previstas (valor médio) e só viram pagas com valor e data confirmados.
- Histórico de jan a set/2026 conta pelo mês da compra; de out/2026 em diante, pela fatura (outubro é mês de transição).

## Entrega 5 (em andamento)

Supabase (banco e login), hospedagem no GitHub Pages, migração dos dados pelo backup JSON, backup mensal automático no Google Drive e revisão de segurança seguindo a [OWASP Top 10](https://owasp.org/www-project-top-ten/).
