-- =====================================================================
-- Receitas na mão · Script 08: grupos no modo de preparo (02/11/2026)
-- Rodar no SQL Editor (pode rodar mais de uma vez).
--
-- O que muda:
--   1. Cada passo ganha "grupo" (ex.: Massa, Recheio, Cobertura), como já
--      existe nos ingredientes. Passos antigos ficam sem grupo.
--   2. A função salvar_receita passa a gravar o grupo do passo. Ela aceita
--      os dois formatos (texto simples ou com grupo), então o app antigo
--      continua salvando enquanto a versão nova não chega ao aparelho.
-- O backup (script 02) já inclui a coluna nova sozinho.
-- =====================================================================

alter table public.passos add column if not exists grupo text;

alter table public.passos drop constraint if exists passos_grupo_limite;
alter table public.passos
  add constraint passos_grupo_limite check (char_length(grupo) <= 60);

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
  v_utens   text[];
  v_obs     text := nullif(btrim(dados->>'observacoes'), '');
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
  -- Utensílios: lista de nomes curtos, sem repetir, na ordem digitada.
  select coalesce(array_agg(x.nome order by x.ord), '{}') into v_utens
  from (
    select btrim(u.v #>> '{}') as nome, min(u.ord) as ord
    from jsonb_array_elements(coalesce(dados->'utensilios', '[]')) with ordinality as u(v, ord)
    where btrim(u.v #>> '{}') <> ''
    group by btrim(u.v #>> '{}')
  ) x;
  if cardinality(v_utens) > 30 then
    raise exception 'Utensílios demais (máximo 30)';
  end if;
  if exists (select 1 from unnest(v_utens) n where char_length(n) > 60) then
    raise exception 'Cada utensílio pode ter até 60 letras';
  end if;
  if char_length(v_obs) > 3000 then
    raise exception 'Observações muito longas (máximo 3000 letras)';
  end if;
  if jsonb_array_length(coalesce(dados->'ingredientes', '[]')) > 100
     or jsonb_array_length(coalesce(dados->'passos', '[]')) > 60
     or jsonb_array_length(coalesce(dados->'etiquetas', '[]')) > 15 then
    raise exception 'Receita grande demais';
  end if;

  insert into public.receitas as r
    (id, dono_id, titulo, categoria_id, porcoes, tempo_preparo_min, tempo_total_min,
     imagem_caminho, fonte_url, fonte_autor, fonte_tipo, favorita, utensilios, observacoes)
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
     coalesce((dados->>'favorita')::boolean, false),
     v_utens, v_obs)
  on conflict (id) do update set
     titulo            = excluded.titulo,
     categoria_id      = excluded.categoria_id,
     porcoes           = excluded.porcoes,
     tempo_preparo_min = excluded.tempo_preparo_min,
     tempo_total_min   = excluded.tempo_total_min,
     imagem_caminho    = excluded.imagem_caminho,
     fonte_url         = excluded.fonte_url,
     fonte_autor       = excluded.fonte_autor,
     favorita          = excluded.favorita,
     utensilios        = excluded.utensilios,
     observacoes       = excluded.observacoes
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
  -- Cada passo pode vir como texto (versões antigas do app) ou como
  -- {"grupo": "Recheio", "texto": "..."} (desde a versão 9.2).
  insert into public.passos (receita_id, dono_id, ordem, grupo, texto)
  select v_id, v_uid, p.ord::int,
         case when jsonb_typeof(p.v) = 'object' then nullif(btrim(p.v->>'grupo'), '') end,
         btrim(case when jsonb_typeof(p.v) = 'object' then p.v->>'texto' else p.v #>> '{}' end)
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

-- Conferência: deve mostrar a coluna "grupo" (text).
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'passos' and column_name = 'grupo';
