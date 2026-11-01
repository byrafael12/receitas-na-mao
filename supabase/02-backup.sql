-- =====================================================================
-- Receitas na mão · Script 02: função de backup só de leitura
-- Rodar no SQL Editor DEPOIS do script 01.
--
-- Por que existe: o backup automático (Google Apps Script) precisa ler
-- as receitas sem fazer login, porque o app só entra pelo Google.
-- Em vez de dar ao script a chave secreta (service_role), que tem
-- acesso total ao banco, esta função:
--   - só LÊ dados (não altera nada);
--   - só responde a quem enviar a chave de backup correta;
--   - guarda apenas o "hash" da chave (uma impressão digital dela),
--     nunca a chave em si. A chave fica só nas Propriedades do script.
--
-- A chave é gerada pelo próprio Apps Script (função configurarChave),
-- que mostra o comando para gravar o hash. Ver o passo a passo.
-- =====================================================================

-- Esquema privado: não é exposto pela API do Supabase.
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;

create table if not exists privado.chave_backup (
  id        int primary key default 1 check (id = 1),  -- só existe 1 linha
  hash      text not null check (hash ~ '^[0-9a-f]{64}$'),
  criada_em timestamptz not null default now()
);
revoke all on privado.chave_backup from public, anon, authenticated;

-- Registro de cada backup feito; útil para conferência.
create table if not exists privado.backup_execucoes (
  id        bigint generated always as identity primary key,
  feito_em  timestamptz not null default now(),
  ok        boolean not null
);
revoke all on privado.backup_execucoes from public, anon, authenticated;

-- "security definer" = roda com as permissões do dono da função, por
-- isso consegue ler todas as tabelas. Por isso mesmo, ela confere a
-- chave antes de qualquer leitura e só devolve dados, sem alterar nada.
create or replace function public.backup_receitas(chave text)
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

  insert into privado.backup_execucoes (ok) values (true);

  return jsonb_build_object(
    'app', 'receitas-na-mao',
    'versao_backup', 1,
    'gerado_em', now(),
    'categorias',        (select coalesce(jsonb_agg(to_jsonb(t) order by t.ordem, t.nome), '[]') from public.categorias t),
    'receitas',          (select coalesce(jsonb_agg(to_jsonb(t) order by t.criada_em), '[]') from public.receitas t),
    'ingredientes',      (select coalesce(jsonb_agg(to_jsonb(t) order by t.receita_id, t.ordem), '[]') from public.ingredientes t),
    'passos',            (select coalesce(jsonb_agg(to_jsonb(t) order by t.receita_id, t.ordem), '[]') from public.passos t),
    'etiquetas',         (select coalesce(jsonb_agg(to_jsonb(t) order by t.nome), '[]') from public.etiquetas t),
    'receita_etiquetas', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.receita_etiquetas t),
    'importacoes',       (select coalesce(jsonb_agg(to_jsonb(t) order by t.criada_em), '[]') from public.importacoes t)
  );
end $$;

-- Só o papel anon (a chave pública usada pelo Apps Script) pode chamar.
revoke all on function public.backup_receitas(text) from public, authenticated;
grant execute on function public.backup_receitas(text) to anon;

-- Conferência: a função só enxerga as receitas se o dono dela (postgres)
-- puder passar por cima do RLS. Deve mostrar bypassrls = true.
select rolname, rolbypassrls as bypassrls from pg_roles where rolname = 'postgres';
