-- =====================================================================
-- Receitas na mão · Script 12: fotos no backup automático (versão 21)
-- Rodar no SQL Editor DEPOIS do script 11.
--
-- Por que existe: o backup automático (Apps Script) só levava os
-- textos. As fotos ficam na pasta privada "capas", que o Apps Script
-- não consegue ler sem login. A função nova "fotos-backup" (Edge
-- Function) busca as fotos para ele, mas só depois de perguntar a esta
-- função se a chave de backup está certa.
--
-- O que esta função faz:
--   - confere a chave de backup (o mesmo hash do script 02);
--   - devolve só a LISTA de caminhos das fotos em uso (capas e passos);
--   - não altera nada e não devolve foto nenhuma.
-- Assim a Edge Function só entrega fotos que estão nesta lista.
--
-- Para desfazer (rollback):
--   drop function if exists public.backup_fotos(text);
-- =====================================================================

create or replace function public.backup_fotos(chave text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  select hash into v_hash from privado.chave_backup where id = 1;

  if v_hash is null
     or chave is null
     or char_length(chave) < 40
     or encode(pg_catalog.sha256(convert_to(chave, 'UTF8')), 'hex') <> v_hash then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'app', 'receitas-na-mao',
    'caminhos', (
      select coalesce(jsonb_agg(c order by c), '[]')
      from (
        select imagem_caminho as c from public.receitas where nullif(btrim(imagem_caminho), '') is not null
        union
        select imagem_caminho from public.passos where nullif(btrim(imagem_caminho), '') is not null
      ) t
    )
  );
end $$;

-- Mesmo acesso da backup_receitas: só o papel anon (chave pública).
revoke all on function public.backup_fotos(text) from public, authenticated;
grant execute on function public.backup_fotos(text) to anon;

-- Conferência: deve mostrar 1 linha, security definer = true.
select proname as funcao, prosecdef as security_definer
from pg_proc where proname = 'backup_fotos' and pronamespace = 'public'::regnamespace;
