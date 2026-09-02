-- =============================================================================
-- Dados de referência: categorias, zonas, faixas horárias e parâmetros.
--
-- Produtos NÃO entram aqui — eles vêm por importação (npm run db:seed), porque
-- a lista definitiva ainda depende do CSV da Joseka.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ocasiões — como a pessoa realmente procura uma torta
-- -----------------------------------------------------------------------------
insert into categories (slug, name, kind, headline, blurb, sort_order) values
  ('cumpleanos', 'Cumpleaños', 'ocasion', 'Tortas de cumpleaños',
   'Clásicos que nunca fallan, con mensaje personalizado incluido.', 1),
  ('infantil', 'Infantiles', 'ocasion', 'Tortas infantiles',
   'Temáticas y colores que a los chicos les encantan.', 2),
  ('romance', 'Aniversarios', 'ocasion', 'Tortas para aniversarios',
   'Diseños elegantes para celebrar a dos.', 3),
  ('quince', 'Quinceañeras', 'ocasion', 'Tortas de 15 años',
   'La torta que se recuerda toda la vida.', 4),
  ('boda', 'Bodas', 'ocasion', 'Tortas de boda',
   'Diseños de varios pisos, decorados a mano.', 5),
  ('bautizo', 'Bautizos', 'ocasion', 'Tortas de bautizo',
   'Delicadas y en tonos suaves, para el día del bautizo.', 6),
  ('graduacion', 'Graduaciones', 'ocasion', 'Tortas de graduación',
   'Para cerrar la etapa con algo dulce.', 7),
  ('para-compartir', 'Para compartir', 'ocasion', 'Tortas para grupos grandes',
   'Desde 20 hasta 35 porciones, para oficinas y reuniones familiares.', 8),
  ('personalizadas', 'Personalizadas', 'ocasion', 'Tortas personalizadas',
   'Tu foto y tu diseño impresos en calidad fotográfica comestible.', 9),
  ('fechas-especiales', 'Fechas especiales', 'ocasion', 'Fechas especiales',
   'Navidad, Día de la Madre, Día del Padre y más.', 10)
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------
-- Tipos — classificação de produção, usada só como filtro secundário
-- -----------------------------------------------------------------------------
insert into categories (slug, name, kind, sort_order) values
  ('redondas', 'Redondas', 'tipo', 1),
  ('rectangulares', 'Rectangulares', 'tipo', 2),
  ('altezas', 'Altezas', 'tipo', 3),
  ('semi-frios', 'Semi-fríos', 'tipo', 4),
  ('fototortas', 'FotoTortas', 'tipo', 5),
  ('fototopper', 'FotoTopper', 'tipo', 6),
  ('corazones', 'Corazones', 'tipo', 7),
  ('tres-sabores', 'Tortas 3 sabores', 'tipo', 8)
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------
-- Faixas de entrega
--
-- A partir das 10h, conforme confirmado com a operação. O horário de
-- atendimento é 9h–20h de segunda a sábado e 8h–18h no domingo, por isso a
-- última faixa não existe aos domingos.
-- -----------------------------------------------------------------------------
insert into delivery_slots (slug, label, start_hour, end_hour, weekdays, sort_order) values
  ('10-13', '10:00 a.m. – 1:00 p.m.', 10, 13, '{0,1,2,3,4,5,6}', 1),
  ('13-16', '1:00 p.m. – 4:00 p.m.',  13, 16, '{0,1,2,3,4,5,6}', 2),
  ('16-18', '4:00 p.m. – 6:00 p.m.',  16, 18, '{0,1,2,3,4,5,6}', 3),
  ('18-20', '6:00 p.m. – 8:00 p.m.',  18, 20, '{1,2,3,4,5,6}',   4)
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------
-- Parâmetros comerciais da entrega
--
-- fee_per_km em zero mantém o comportamento por zona enquanto a fórmula por
-- distância não é confirmada. Assim que vier, é atualizar esta linha.
-- -----------------------------------------------------------------------------
insert into delivery_settings (id, free_delivery_from, base_fee, fee_per_km, max_distance_km)
values (true, 150, 12, 0, 25)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Zonas de entrega
--
-- ⚠️ PENDENTE DE CONFIRMAÇÃO: esta lista é de Lima, seguindo os mockups. A loja
-- atual entrega em Arequipa. Confirmar a praça antes de publicar e trocar as
-- linhas abaixo.
-- -----------------------------------------------------------------------------
insert into delivery_zones (slug, name, coverage, fee, sort_order) values
  ('miraflores',              'Miraflores',              'principal', 12,  1),
  ('san-isidro',              'San Isidro',              'principal', 12,  2),
  ('surquillo',               'Surquillo',               'principal', 12,  3),
  ('san-borja',               'San Borja',               'principal', 12,  4),
  ('santiago-de-surco',       'Santiago de Surco',       'principal', 12,  5),
  ('barranco',                'Barranco',                'principal', 12,  6),
  ('lince',                   'Lince',                   'principal', 12,  7),
  ('jesus-maria',             'Jesús María',             'principal', 12,  8),
  ('magdalena-del-mar',       'Magdalena del Mar',       'principal', 12,  9),
  ('pueblo-libre',            'Pueblo Libre',            'principal', 12, 10),
  ('san-miguel',              'San Miguel',              'principal', 12, 11),
  ('la-molina',               'La Molina',               'extendida', 18, 12),
  ('la-victoria',             'La Victoria',             'extendida', 18, 13),
  ('cercado-de-lima',         'Cercado de Lima',         'extendida', 18, 14),
  ('rimac',                   'Rímac',                   'extendida', 18, 15),
  ('brena',                   'Breña',                   'extendida', 18, 16),
  ('chorrillos',              'Chorrillos',              'extendida', 18, 17),
  ('santa-anita',             'Santa Anita',             'extendida', 18, 18),
  ('ate',                     'Ate',                     'extendida', 18, 19),
  ('san-juan-de-lurigancho',  'San Juan de Lurigancho',  'extendida', 18, 20),
  ('independencia',           'Independencia',           'extendida', 18, 21),
  ('los-olivos',              'Los Olivos',              'extendida', 18, 22),
  ('san-martin-de-porres',    'San Martín de Porres',    'extendida', 18, 23),
  ('comas',                   'Comas',                   'extendida', 18, 24)
on conflict (slug) do nothing;
