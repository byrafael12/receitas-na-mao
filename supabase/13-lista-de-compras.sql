-- =====================================================================
-- Receitas na mão · Script 13: lista de compras (versão 22)
-- Rodar no SQL Editor DEPOIS do script 12 (pode rodar mais de uma vez).
--
-- Cada linha é um ingrediente que entrou na lista: vindo de uma receita
-- (com a porção escolhida) ou digitado à mão. O app junta os iguais na
-- tela; aqui fica cada um separado, para dar para tirar uma receita da
-- lista sem mexer no resto.
--
-- Segurança: igual às receitas. Só o titular lê e grava, e só a lista
-- dele. Contas de leitura (amigos e família) não veem nem alteram.
-- Uma receita só entra na lista do próprio dono (chave composta), e
-- excluir a receita tira os itens dela da lista.
--
-- Para desfazer (rollback):
--   drop table if exists public.lista_compras;
--   drop function if exists privado.limite_lista_compras();
-- =====================================================================

create table if not exists public.lista_compras (
  id             uuid primary key default gen_random_uuid(),
  dono_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  receita_id     uuid,
  receita_titulo text check (char_length(receita_titulo) <= 200),
  fator          numeric(8,3) check (fator > 0 and fator <= 20),
  nome           text not null check (char_length(btrim(nome)) between 1 and 200),
  quantidade     numeric(12,3) check (quantidade > 0 and quantidade < 1000000),
  unidade        text check (char_length(unidade) <= 30),
  marcado        boolean not null default false,
  criado_em      timestamptz not null default now(),
  foreign key (receita_id, dono_id) references public.receitas (id, dono_id) on delete cascade
);
create index if not exists lista_compras_dono on public.lista_compras (dono_id);
create index if not exists lista_compras_receita on public.lista_compras (receita_id);

-- Limite de 1.000 itens por pessoa (protege contra erro em laço).
create schema if not exists privado;
create or replace function privado.limite_lista_compras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.lista_compras where dono_id = new.dono_id) >= 1000 then
    raise exception 'A lista de compras chegou a 1.000 itens. Limpe os marcados ou a lista.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function privado.limite_lista_compras() from public, anon, authenticated;
drop trigger if exists lista_compras_limite on public.lista_compras;
create trigger lista_compras_limite before insert on public.lista_compras
  for each row execute function privado.limite_lista_compras();

alter table public.lista_compras enable row level security;
alter table public.lista_compras force row level security;
revoke all on public.lista_compras from anon, public, authenticated;
grant select, insert, delete on public.lista_compras to authenticated;
grant update (marcado) on public.lista_compras to authenticated;  -- só marcar e desmarcar

drop policy if exists "lista_compras: titular le" on public.lista_compras;
drop policy if exists "lista_compras: titular inclui" on public.lista_compras;
drop policy if exists "lista_compras: titular marca" on public.lista_compras;
drop policy if exists "lista_compras: titular apaga" on public.lista_compras;
create policy "lista_compras: titular le" on public.lista_compras
  for select to authenticated using (dono_id = (select auth.uid()) and (select public.eh_titular()));
create policy "lista_compras: titular inclui" on public.lista_compras
  for insert to authenticated with check (dono_id = (select auth.uid()) and (select public.eh_titular()));
create policy "lista_compras: titular marca" on public.lista_compras
  for update to authenticated
  using (dono_id = (select auth.uid()) and (select public.eh_titular()))
  with check (dono_id = (select auth.uid()) and (select public.eh_titular()));
create policy "lista_compras: titular apaga" on public.lista_compras
  for delete to authenticated using (dono_id = (select auth.uid()) and (select public.eh_titular()));

-- Conferência: deve mostrar lista_compras | true | true
select relname as tabela, relrowsecurity as rls, relforcerowsecurity as rls_forcada
from pg_class where oid = 'public.lista_compras'::regclass;
