-- Controle Financeiro, versão 35: contas fixas de receita (receitas previstas).
-- Acrescenta duas colunas em contas_fixas: tipo (despesa ou receita) e reembolso_de (vigor, paola ou vazio).
-- As contas que já existem ficam como despesa. Não apaga nem altera nenhum dado.
-- Rodar uma vez no Supabase, ANTES de publicar a versão 35: SQL Editor > New query > colar tudo > Run.
-- Pode rodar de novo sem problema (não duplica nada).

alter table public.contas_fixas add column if not exists tipo text not null default 'despesa';
alter table public.contas_fixas add column if not exists reembolso_de text;

alter table public.contas_fixas drop constraint if exists contas_fixas_tipo_check;
alter table public.contas_fixas add constraint contas_fixas_tipo_check check (tipo in ('despesa', 'receita'));
alter table public.contas_fixas drop constraint if exists contas_fixas_reembolso_de_check;
alter table public.contas_fixas add constraint contas_fixas_reembolso_de_check
  check (reembolso_de is null or (tipo = 'receita' and reembolso_de in ('vigor', 'paola')));

-- Conferência: todas as contas atuais devem aparecer como despesa, sem reembolso
select tipo, coalesce(reembolso_de, '-') as reembolso_de, count(*) as contas
from public.contas_fixas group by 1, 2 order by 1, 2;
