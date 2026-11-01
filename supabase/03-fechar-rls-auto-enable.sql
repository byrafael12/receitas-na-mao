-- =====================================================================
-- Receitas na mão · Script 03: fechar a função rls_auto_enable
-- Rodar no SQL Editor depois dos scripts 01 e 02.
--
-- Por que: a opção "RLS automático" da criação do projeto cria a função
-- public.rls_auto_enable(), que o Security Advisor apontou como
-- executável por quem não está logado (anon) e por usuários logados.
-- Ela só deve ser usada pelo próprio Supabase. Mesma correção feita no
-- Controle Financeiro (script 04 de lá).
-- =====================================================================

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- Conferência: anon e authenticated devem aparecer com "false".
select r.rolname as papel,
       has_function_privilege(r.rolname, 'public.rls_auto_enable()', 'execute') as pode_executar
from pg_roles r
where r.rolname in ('anon', 'authenticated')
  and to_regprocedure('public.rls_auto_enable()') is not null;
