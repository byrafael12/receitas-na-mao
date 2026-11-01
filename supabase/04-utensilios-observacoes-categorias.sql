-- =====================================================================
-- Receitas na mão · Script 04: utensílios, observações e categorias novas
-- Rodar no SQL Editor depois dos scripts 01, 02 e 03 (01/11/2026).
--
-- O que muda:
--   1. Receita ganha "utensilios" (lista: frigideira, refratário, forma...)
--      e "observacoes" (texto livre no fim da receita).
--   2. A função salvar_receita passa a gravar esses dois campos.
--   3. Categorias novas: Frango, Frutos do mar, Japonês e Chinês, e a
--      ordem da lista é refeita (Outras sempre por último).
-- O backup (script 02) já inclui os campos novos sozinho.
-- =====================================================================

alter table public.receitas
  add column if not exists utensilios  text[] not null default '{}',
  add column if not exists observacoes text;

alter table public.receitas
  add constraint receitas_utensilios_limite check (cardinality(utensilios) <= 30),
  add constraint receitas_observacoes_limite check (char_length(observacoes) <= 3000);

-- Função salvar_receita atualizada (mesma lógica do script 01 + campos novos).
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

-- Categorias novas para cada usuário existente (só você) e nova ordem.
insert into public.categorias (dono_id, nome, ordem)
select u.id, n.nome, 0
from auth.users u
cross join (values ('Frango'), ('Frutos do mar'), ('Japonês'), ('Chinês')) as n(nome)
on conflict (dono_id, lower(nome)) do nothing;

update public.categorias c
set ordem = o.ordem
from (values ('Massas', 1), ('Carnes', 2), ('Frango', 3), ('Frutos do mar', 4),
             ('Japonês', 5), ('Chinês', 6), ('Salgados', 7), ('Lanches', 8),
             ('Sobremesas', 9), ('Molhos', 10), ('Acompanhamentos', 11), ('Outras', 12)) as o(nome, ordem)
where c.nome = o.nome;

-- Conferência: 12 categorias na ordem nova e as 2 colunas novas.
select nome, ordem from public.categorias order by ordem;
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'receitas' and column_name in ('utensilios', 'observacoes');
