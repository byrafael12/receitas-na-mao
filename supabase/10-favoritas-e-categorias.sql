-- =====================================================================
-- Receitas na mão · Script 10: favoritas e categorias editáveis (02/11/2026)
-- Rodar no SQL Editor (pode rodar mais de uma vez).
--
-- O que muda:
--   1. Marcar ou desmarcar favorita NÃO muda a data de atualização da
--      receita (senão ela pularia para o topo da lista).
--   2. Função remover_categoria: move as receitas da categoria para
--      "Outras" (sem mudar a data delas) e só então apaga a categoria,
--      tudo de uma vez. "Outras" não pode ser removida. Só o titular
--      consegue (regras do script 09 continuam valendo).
-- =====================================================================

create or replace function public.marcar_atualizacao()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('receitas.preservar_data', true), '') = '1'
     or ((to_jsonb(new) - 'favorita' - 'atualizada_em') = (to_jsonb(old) - 'favorita' - 'atualizada_em')
         and new.favorita is distinct from old.favorita) then
    new.atualizada_em := old.atualizada_em;   -- só favorita (ou mudança de categoria em lote)
  else
    new.atualizada_em := now();
  end if;
  return new;
end $$;

create or replace function public.remover_categoria(p_id uuid)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_nome   text;
  v_outras uuid;
  v_qtd    int;
begin
  if v_uid is null then
    raise exception 'Login necessário';
  end if;
  select nome into v_nome from public.categorias where id = p_id and dono_id = v_uid;
  if not found then
    raise exception 'Categoria não encontrada';
  end if;
  if lower(v_nome) = 'outras' then
    raise exception 'A categoria Outras não pode ser removida';
  end if;
  select id into v_outras from public.categorias where dono_id = v_uid and lower(nome) = 'outras';
  if v_outras is null then
    insert into public.categorias (nome, ordem) values ('Outras', 999) returning id into v_outras;
  end if;
  perform set_config('receitas.preservar_data', '1', true);
  update public.receitas set categoria_id = v_outras where dono_id = v_uid and categoria_id = p_id;
  get diagnostics v_qtd = row_count;
  perform set_config('receitas.preservar_data', '', true);
  delete from public.categorias where id = p_id and dono_id = v_uid;
  if not found then
    raise exception 'Sem permissão para remover a categoria';
  end if;
  return v_qtd;
end $$;
revoke all on function public.remover_categoria(uuid) from public, anon;
grant execute on function public.remover_categoria(uuid) to authenticated;

-- Conferência: deve mostrar as duas funções.
select proname from pg_proc where proname in ('marcar_atualizacao', 'remover_categoria') order by 1;
