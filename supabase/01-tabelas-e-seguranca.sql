-- =====================================================================
-- Receitas na mão · Script 01: tabelas, regras de segurança e imagens
-- Rodar UMA vez no SQL Editor do Supabase (projeto receitas-na-mao).
--
-- O que este script faz:
--   1. Cria as 7 tabelas do app.
--   2. Liga e FORÇA o RLS (Row Level Security) em todas: cada linha só
--      pode ser lida ou alterada pelo dono (o usuário logado).
--   3. Tira todo acesso do papel "anon" (quem não está logado).
--   4. Cria a função salvar_receita, que grava receita, ingredientes,
--      passos e etiquetas numa única operação (tudo ou nada).
--   5. Cria a pasta privada de imagens "capas" e as regras de acesso.
--
-- Termos:
--   RLS    = regra do banco que decide quem vê cada linha.
--   anon   = papel usado por quem não fez login.
--   authenticated = papel usado por quem fez login.
--   auth.uid() = identificador (UID) do usuário logado.
-- =====================================================================

-- Extensão para busca sem acento (usada na Entrega 4).
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------

create table public.categorias (
  id         uuid primary key default gen_random_uuid(),
  dono_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome       text not null check (char_length(btrim(nome)) between 1 and 40),
  ordem      int  not null default 0,
  ativa      boolean not null default true,
  criada_em  timestamptz not null default now(),
  unique (id, dono_id)
);
create unique index categorias_dono_nome on public.categorias (dono_id, lower(nome));

create table public.receitas (
  id                uuid primary key default gen_random_uuid(),
  dono_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titulo            text not null check (char_length(btrim(titulo)) between 1 and 200),
  categoria_id      uuid,
  porcoes           numeric(6,2) check (porcoes > 0 and porcoes <= 1000),
  tempo_preparo_min int check (tempo_preparo_min between 0 and 10000),
  tempo_total_min   int check (tempo_total_min between 0 and 10000),
  imagem_caminho    text check (char_length(imagem_caminho) <= 200),
  fonte_url         text check (fonte_url is null or (fonte_url ~* '^https?://' and char_length(fonte_url) <= 2000)),
  fonte_autor       text check (char_length(fonte_autor) <= 120),
  fonte_tipo        text not null default 'manual'
                    check (fonte_tipo in ('manual','site','legenda','print','video','rede')),
  favorita          boolean not null default false,
  criada_em         timestamptz not null default now(),
  atualizada_em     timestamptz not null default now(),
  unique (id, dono_id),
  -- A categoria precisa ser do mesmo dono. "restrict" impede apagar
  -- uma categoria em uso (regra: nunca apagar receitas junto).
  foreign key (categoria_id, dono_id) references public.categorias (id, dono_id) on delete restrict
);
create index receitas_dono_atualizada on public.receitas (dono_id, atualizada_em desc);

create table public.ingredientes (
  id             uuid primary key default gen_random_uuid(),
  receita_id     uuid not null,
  dono_id        uuid not null default auth.uid(),
  ordem          int  not null,
  grupo          text check (char_length(grupo) <= 60),
  quantidade     numeric(10,3) check (quantidade > 0),
  unidade        text check (char_length(unidade) <= 30),
  nome           text not null check (char_length(btrim(nome)) between 1 and 200),
  observacao     text check (char_length(observacao) <= 200),
  texto_original text check (char_length(texto_original) <= 300),
  foreign key (receita_id, dono_id) references public.receitas (id, dono_id) on delete cascade
);
create index ingredientes_receita on public.ingredientes (receita_id, ordem);

create table public.passos (
  id         uuid primary key default gen_random_uuid(),
  receita_id uuid not null,
  dono_id    uuid not null default auth.uid(),
  ordem      int  not null,
  texto      text not null check (char_length(btrim(texto)) between 1 and 2000),
  foreign key (receita_id, dono_id) references public.receitas (id, dono_id) on delete cascade
);
create index passos_receita on public.passos (receita_id, ordem);

create table public.etiquetas (
  id        uuid primary key default gen_random_uuid(),
  dono_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome      text not null check (char_length(btrim(nome)) between 1 and 40),
  criada_em timestamptz not null default now(),
  unique (id, dono_id)
);
create unique index etiquetas_dono_nome on public.etiquetas (dono_id, lower(nome));

create table public.receita_etiquetas (
  receita_id  uuid not null,
  etiqueta_id uuid not null,
  dono_id     uuid not null default auth.uid(),
  primary key (receita_id, etiqueta_id),
  foreign key (receita_id, dono_id)  references public.receitas  (id, dono_id) on delete cascade,
  foreign key (etiqueta_id, dono_id) references public.etiquetas (id, dono_id) on delete cascade
);

create table public.importacoes (
  id             uuid primary key default gen_random_uuid(),
  dono_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  receita_id     uuid references public.receitas(id) on delete set null,
  tipo_entrada   text not null check (tipo_entrada in ('site','legenda','print','video','rede')),
  duracao_ms     int  check (duracao_ms >= 0),
  modelo_ia      text check (char_length(modelo_ia) <= 80),
  tokens_entrada int  check (tokens_entrada >= 0),
  tokens_saida   int  check (tokens_saida >= 0),
  sucesso        boolean not null default false,
  erro           text check (char_length(erro) <= 1000),
  criada_em      timestamptz not null default now()
);

-- Atualiza "atualizada_em" sozinho a cada alteração da receita.
create or replace function public.marcar_atualizacao()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizada_em := now();
  return new;
end $$;

create trigger receitas_atualizada
  before update on public.receitas
  for each row execute function public.marcar_atualizacao();

-- ---------------------------------------------------------------------
-- 2. Segurança: RLS ligada e forçada, uma regra por operação
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['categorias','receitas','ingredientes','passos',
                           'etiquetas','receita_etiquetas','importacoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format($p$create policy "%1$s: dono le" on public.%1$I
      for select to authenticated using (dono_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "%1$s: dono cria" on public.%1$I
      for insert to authenticated with check (dono_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "%1$s: dono altera" on public.%1$I
      for update to authenticated using (dono_id = (select auth.uid()))
      with check (dono_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "%1$s: dono apaga" on public.%1$I
      for delete to authenticated using (dono_id = (select auth.uid()))$p$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Função salvar_receita: grava tudo de uma vez (tudo ou nada)
--    "security invoker" = roda com as permissões de quem chama,
--    então as regras RLS continuam valendo.
-- ---------------------------------------------------------------------

create or replace function public.salvar_receita(dados jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_id      uuid;
  v_imagem  text := nullif(btrim(dados->>'imagem_caminho'), '');
  v_url     text := nullif(btrim(dados->>'fonte_url'), '');
  v_nome    text;
begin
  if v_uid is null then
    raise exception 'Login necessário';
  end if;

  v_id := coalesce(nullif(dados->>'id', '')::uuid, gen_random_uuid());

  -- A imagem só pode estar na pasta do próprio usuário.
  if v_imagem is not null and v_imagem not like v_uid::text || '/%' then
    raise exception 'Caminho de imagem inválido';
  end if;
  -- Link da fonte só http ou https (proteção contra javascript:).
  if v_url is not null and v_url !~* '^https?://' then
    raise exception 'Link da fonte inválido';
  end if;
  if jsonb_array_length(coalesce(dados->'ingredientes', '[]')) > 100
     or jsonb_array_length(coalesce(dados->'passos', '[]')) > 60
     or jsonb_array_length(coalesce(dados->'etiquetas', '[]')) > 15 then
    raise exception 'Receita grande demais';
  end if;

  insert into public.receitas as r
    (id, dono_id, titulo, categoria_id, porcoes, tempo_preparo_min, tempo_total_min,
     imagem_caminho, fonte_url, fonte_autor, fonte_tipo, favorita)
  values
    (v_id, v_uid,
     btrim(dados->>'titulo'),
     nullif(dados->>'categoria_id', '')::uuid,
     nullif(dados->>'porcoes', '')::numeric,
     nullif(dados->>'tempo_preparo_min', '')::int,
     nullif(dados->>'tempo_total_min', '')::int,
     v_imagem, v_url,
     nullif(btrim(dados->>'fonte_autor'), ''),
     coalesce(nullif(dados->>'fonte_tipo', ''), 'manual'),
     coalesce((dados->>'favorita')::boolean, false))
  on conflict (id) do update set
     titulo            = excluded.titulo,
     categoria_id      = excluded.categoria_id,
     porcoes           = excluded.porcoes,
     tempo_preparo_min = excluded.tempo_preparo_min,
     tempo_total_min   = excluded.tempo_total_min,
     imagem_caminho    = excluded.imagem_caminho,
     fonte_url         = excluded.fonte_url,
     fonte_autor       = excluded.fonte_autor,
     favorita          = excluded.favorita
  where r.dono_id = v_uid;

  if not found then
    raise exception 'Receita não encontrada';
  end if;

  -- Ingredientes e passos: substitui a lista inteira pela nova.
  delete from public.ingredientes where receita_id = v_id;
  insert into public.ingredientes
    (receita_id, dono_id, ordem, grupo, quantidade, unidade, nome, observacao, texto_original)
  select v_id, v_uid, i.ord::int,
         nullif(btrim(i.v->>'grupo'), ''),
         nullif(i.v->>'quantidade', '')::numeric,
         nullif(btrim(i.v->>'unidade'), ''),
         btrim(i.v->>'nome'),
         nullif(btrim(i.v->>'observacao'), ''),
         nullif(btrim(i.v->>'texto_original'), '')
  from jsonb_array_elements(coalesce(dados->'ingredientes', '[]')) with ordinality as i(v, ord);

  delete from public.passos where receita_id = v_id;
  insert into public.passos (receita_id, dono_id, ordem, texto)
  select v_id, v_uid, p.ord::int, btrim(p.v #>> '{}')
  from jsonb_array_elements(coalesce(dados->'passos', '[]')) with ordinality as p(v, ord);

  -- Etiquetas: cria as que ainda não existem e liga à receita.
  delete from public.receita_etiquetas where receita_id = v_id;
  for v_nome in
    select distinct btrim(e.v #>> '{}')
    from jsonb_array_elements(coalesce(dados->'etiquetas', '[]')) as e(v)
    where btrim(e.v #>> '{}') <> ''
  loop
    insert into public.etiquetas (dono_id, nome) values (v_uid, v_nome)
    on conflict (dono_id, lower(nome)) do nothing;
    insert into public.receita_etiquetas (receita_id, etiqueta_id, dono_id)
    select v_id, e.id, v_uid from public.etiquetas e
    where e.dono_id = v_uid and lower(e.nome) = lower(v_nome)
    on conflict do nothing;
  end loop;

  return v_id;
end $$;

revoke all on function public.salvar_receita(jsonb) from public, anon;
grant execute on function public.salvar_receita(jsonb) to authenticated;

revoke all on function public.marcar_atualizacao() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Imagens: pasta privada "capas", até 200 KB por arquivo, só JPEG
--    ou WebP. Cada usuário só mexe na pasta com o próprio UID.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('capas', 'capas', false, 204800, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "capas: dono le" on storage.objects
  for select to authenticated
  using (bucket_id = 'capas' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "capas: dono envia" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'capas' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "capas: dono substitui" on storage.objects
  for update to authenticated
  using (bucket_id = 'capas' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'capas' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "capas: dono apaga" on storage.objects
  for delete to authenticated
  using (bucket_id = 'capas' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Conferência rápida (deve listar as 7 tabelas com rls = true e force = true):
select relname as tabela, relrowsecurity as rls, relforcerowsecurity as force
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relname;
