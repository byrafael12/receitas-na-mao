-- =====================================================================
-- Receitas na mão · Script 05: ajuste das categorias (01/11/2026)
-- Rodar no SQL Editor DEPOIS do script 04.
--
-- O que muda (pedido de Rafael):
--   1. "Carnes" passa a se chamar "Carne de rês".
--   2. "Japonês" e "Chinês" viram UMA categoria: "Japonês e Chinês".
--      Receitas que estavam em qualquer uma das duas vão para a nova.
--   3. Nova ordem, Outras por último (11 categorias).
-- Pode rodar mais de uma vez sem estragar nada.
-- =====================================================================

-- 1. Carnes -> Carne de rês
update public.categorias c
set nome = 'Carne de rês'
where lower(c.nome) = 'carnes'
  and not exists (select 1 from public.categorias d
                  where d.dono_id = c.dono_id and lower(d.nome) = lower('Carne de rês'));

-- 2. Cria "Japonês e Chinês" para cada usuário (se ainda não existe)
insert into public.categorias (dono_id, nome, ordem)
select u.id, 'Japonês e Chinês', 0 from auth.users u
on conflict (dono_id, lower(nome)) do nothing;

--    Move as receitas de "Japonês" e "Chinês" para a categoria nova
update public.receitas r
set categoria_id = nova.id
from public.categorias velha
join public.categorias nova
  on nova.dono_id = velha.dono_id and lower(nova.nome) = lower('Japonês e Chinês')
where r.categoria_id = velha.id
  and lower(velha.nome) in (lower('Japonês'), lower('Chinês'));

--    Apaga as duas antigas (já sem receitas)
delete from public.categorias
where lower(nome) in (lower('Japonês'), lower('Chinês'));

-- 3. Nova ordem
update public.categorias c
set ordem = o.ordem
from (values ('Massas', 1), ('Carne de rês', 2), ('Frango', 3), ('Frutos do mar', 4),
             ('Japonês e Chinês', 5), ('Salgados', 6), ('Lanches', 7), ('Sobremesas', 8),
             ('Molhos', 9), ('Acompanhamentos', 10), ('Outras', 11)) as o(nome, ordem)
where c.nome = o.nome;

-- Conferência: 11 categorias, de Massas (1) a Outras (11)
select nome, ordem from public.categorias order by ordem;
