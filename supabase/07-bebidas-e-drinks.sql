-- =====================================================================
-- Receitas na mão · Script 07: "Bebidas" passa a "Bebidas e Drinks"
-- Rodar no SQL Editor (01/11/2026). Receitas já ligadas à categoria
-- continuam ligadas: só o nome muda. Pode rodar mais de uma vez.
-- A ordem alfabética das categorias agora é feita pelo próprio app
-- (Outras sempre por último); a coluna "ordem" deixa de ser usada.
-- =====================================================================

update public.categorias c
set nome = 'Bebidas e Drinks'
where c.nome = 'Bebidas'
  and not exists (select 1 from public.categorias d
                  where d.dono_id = c.dono_id and lower(d.nome) = lower('Bebidas e Drinks'));

-- Conferência: deve aparecer "Bebidas e Drinks" e não "Bebidas".
select nome from public.categorias order by nome;
