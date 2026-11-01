-- =====================================================================
-- Receitas na mão · Script 06: importação com IA (Entrega 2) e Bebidas
-- Rodar no SQL Editor depois dos scripts 01 a 05 (01/11/2026).
--
-- O que muda:
--   1. O registro de importações passa a aceitar o tipo "combinado"
--      (vídeo + legenda ou print na mesma importação) e guarda quantas
--      receitas a IA encontrou e quais entradas foram usadas.
--   2. Categoria "Bebidas" (pedido de Rafael), antes de Outras.
-- Pode rodar mais de uma vez sem estragar nada.
-- =====================================================================

alter table public.importacoes drop constraint if exists importacoes_tipo_entrada_check;
alter table public.importacoes
  add constraint importacoes_tipo_entrada_check
  check (tipo_entrada in ('site', 'legenda', 'print', 'video', 'rede', 'combinado'));

alter table public.importacoes
  add column if not exists receitas_encontradas int check (receitas_encontradas >= 0),
  add column if not exists entradas text check (char_length(entradas) <= 100);

-- Bebidas para cada usuário existente, e Outras sempre por último.
insert into public.categorias (dono_id, nome, ordem)
select u.id, 'Bebidas', 11 from auth.users u
on conflict (dono_id, lower(nome)) do nothing;

update public.categorias set ordem = 11 where nome = 'Bebidas';
update public.categorias set ordem = 12 where nome = 'Outras';

-- Conferência: 12 categorias, Bebidas (11) e Outras (12).
select nome, ordem from public.categorias order by ordem;
