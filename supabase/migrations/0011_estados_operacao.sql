-- =============================================================================
-- Tortas Fanor — estados novos da torta no fluxo taller → loja
--
-- Arquivo separado de propósito: `alter type … add value` não pode ter o valor
-- novo usado na mesma transação em que foi criado. A 0012 usa estes valores em
-- índice e em função; rodando as duas juntas no editor do Supabase, a 0012
-- quebraria. Aplicar esta primeiro, sozinha.
-- =============================================================================

-- Saiu do taller e ainda não foi conferida na loja. Não aparece na vitrine:
-- "até a vendedora dar o recebido, não sobe" (reunião de 11/09/2026).
alter type cake_unit_status add value if not exists 'in_transit';

-- Estava na guia de despacho e não chegou. Volta ao taller para esclarecer.
alter type cake_unit_status add value if not exists 'missing';

-- Voltou ao taller (venceu na vitrine). Lá decidem: redecorar ou descartar.
alter type cake_unit_status add value if not exists 'returned';
