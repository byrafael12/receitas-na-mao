-- =====================================================================
-- Receitas na mão · Script 09: compartilhar só para visualizar (02/11/2026)
-- Rodar no SQL Editor ANTES de cadastrar qualquer amigo (pode rodar mais
-- de uma vez).
--
-- O que muda:
--   1. "Titular": quem existe hoje no Supabase (só você) vira titular. Só o
--      titular pode criar, alterar e apagar receitas, fotos, categorias,
--      etiquetas e importações. A regra fica no banco (RLS), não só na tela.
--   2. "Leitores": e-mails que o titular autoriza em Ajustes. Eles só LEEM
--      as receitas, ingredientes, passos, categorias, etiquetas e fotos do
--      titular. Não veem o registro de importações.
--   3. Tirar um e-mail da lista corta o acesso na próxima abertura do app
--      com internet (a cópia do aparelho do amigo é substituída).
-- =====================================================================

create schema if not exists privado;

-- 1. Titulares (fica no esquema privado: o app não lê nem altera esta tabela)
create table if not exists privado.titulares (
  usuario_id uuid primary key references auth.users (id) on delete cascade
);
insert into privado.titulares (usuario_id)
select id from auth.users
on conflict do nothing;

create or replace function public.eh_titular()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from privado.titulares t where t.usuario_id = (select auth.uid()));
$$;
revoke all on function public.eh_titular() from public, anon;
grant execute on function public.eh_titular() to authenticated;

-- 2. Leitores: e-mails autorizados por cada titular
create table if not exists public.leitores (
  dono_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  email     text not null check (email = lower(btrim(email)) and char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  criado_em timestamptz not null default now(),
  primary key (dono_id, email)
);
alter table public.leitores enable row level security;
alter table public.leitores force row level security;
revoke all on public.leitores from anon, public;
grant select, insert, delete on public.leitores to authenticated;
drop policy if exists "leitores: titular le" on public.leitores;
drop policy if exists "leitores: titular inclui" on public.leitores;
drop policy if exists "leitores: titular remove" on public.leitores;
create policy "leitores: titular le" on public.leitores
  for select to authenticated using (dono_id = (select auth.uid()) and (select public.eh_titular()));
create policy "leitores: titular inclui" on public.leitores
  for insert to authenticated with check (dono_id = (select auth.uid()) and (select public.eh_titular()));
create policy "leitores: titular remove" on public.leitores
  for delete to authenticated using (dono_id = (select auth.uid()) and (select public.eh_titular()));

-- Donos cujas receitas o usuário logado pode ver: ele mesmo e quem
-- autorizou o e-mail dele (e-mail do login Google, vindo do crachá/JWT).
create or replace function public.donos_visiveis()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select array_append(
    coalesce(array_agg(l.dono_id) filter (where l.dono_id is not null), '{}'),
    (select auth.uid()))
  from public.leitores l
  where l.email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    and (select auth.uid()) is not null;
$$;
revoke all on function public.donos_visiveis() from public, anon;
grant execute on function public.donos_visiveis() to authenticated;

-- 3. Leitura para leitores; gravação só para o titular
do $$
declare
  t text;
begin
  foreach t in array array['categorias','receitas','ingredientes','passos','etiquetas','receita_etiquetas'] loop
    execute format('drop policy if exists "%1$s: leitor le" on public.%1$I', t);
    execute format($p$create policy "%1$s: leitor le" on public.%1$I
      for select to authenticated using (dono_id = any ((select public.donos_visiveis())::uuid[]))$p$, t);
  end loop;
  foreach t in array array['categorias','receitas','ingredientes','passos','etiquetas','receita_etiquetas','importacoes'] loop
    execute format($p$alter policy "%1$s: dono cria" on public.%1$I
      with check (dono_id = (select auth.uid()) and (select public.eh_titular()))$p$, t);
    execute format($p$alter policy "%1$s: dono altera" on public.%1$I
      using (dono_id = (select auth.uid()) and (select public.eh_titular()))
      with check (dono_id = (select auth.uid()) and (select public.eh_titular()))$p$, t);
    execute format($p$alter policy "%1$s: dono apaga" on public.%1$I
      using (dono_id = (select auth.uid()) and (select public.eh_titular()))$p$, t);
  end loop;
end $$;

-- Fotos (pasta privada "capas"): leitor vê; só o titular envia, troca e apaga
drop policy if exists "capas: leitor le" on storage.objects;
create policy "capas: leitor le" on storage.objects
  for select to authenticated
  using (bucket_id = 'capas' and (storage.foldername(name))[1] = any ((select public.donos_visiveis())::text[]));
alter policy "capas: dono envia" on storage.objects
  with check (bucket_id = 'capas' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.eh_titular()));
alter policy "capas: dono substitui" on storage.objects
  using (bucket_id = 'capas' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.eh_titular()))
  with check (bucket_id = 'capas' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.eh_titular()));
alter policy "capas: dono apaga" on storage.objects
  using (bucket_id = 'capas' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.eh_titular()));

-- Conferência: deve mostrar 1 titular (você) e 0 leitores.
select (select count(*) from privado.titulares) as titulares,
       (select count(*) from public.leitores) as leitores;
