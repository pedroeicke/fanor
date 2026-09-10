-- =============================================================================
-- Banco FICTÍCIO que imita o Sisgeco 5, para testar o leitor sem a loja.
--
-- Os nomes de tabela são palpite informado: VentaCab e Articulo são reais
-- (aparecem em VentaAdelanto.sql e SQLQuery1.sql da pasta do Sisgeco); os
-- demais seguem o mesmo padrão. As COLUNAS não são palpite — são as dos grids
-- das telas (Usuarios/*.ini). Quando o banco real chegar, o que muda é o
-- nome de tabela em src/queries.mjs, nada mais.
--
-- Rode com: npm run seed  (cria o banco, as tabelas e os dados)
-- =============================================================================

if db_id('Fanor') is null create database Fanor;
go
use Fanor;
go

if object_id('dbo.Familia')   is not null drop table dbo.Familia;
if object_id('dbo.GuiaDet')   is not null drop table dbo.GuiaDet;
if object_id('dbo.GuiaCab')   is not null drop table dbo.GuiaCab;
if object_id('dbo.VentaPago') is not null drop table dbo.VentaPago;
if object_id('dbo.VentaDet')  is not null drop table dbo.VentaDet;
if object_id('dbo.VentaCab')  is not null drop table dbo.VentaCab;
if object_id('dbo.ContratoDet') is not null drop table dbo.ContratoDet;
if object_id('dbo.ContratoCab') is not null drop table dbo.ContratoCab;
if object_id('dbo.Articulo')  is not null drop table dbo.Articulo;
if object_id('dbo.Almacen')   is not null drop table dbo.Almacen;
if object_id('dbo.Vendedor')  is not null drop table dbo.Vendedor;
if object_id('dbo.ProvClie')  is not null drop table dbo.ProvClie;
go

create table dbo.Familia (codigo nvarchar(4) primary key, des nvarchar(60));

-- FArticulo
create table dbo.Articulo (
  codigo nvarchar(10) primary key, des nvarchar(80), codfamilia nvarchar(4), codsubfamilia nvarchar(4),
  tipo nvarchar(2), codunidad nvarchar(3), usalote bit default 0, usaserie bit default 0,
  precio1 decimal(10,2), precio2 decimal(10,2), moneda nvarchar(3) default 'S', IGV bit default 1,
  stockM decimal(12,3), sunat nvarchar(2), codigosunat nvarchar(10), imagen nvarchar(200), detalle nvarchar(500),
  ts rowversion
);

create table dbo.Almacen  (codigo nvarchar(2) primary key, des nvarchar(40));
create table dbo.Vendedor (codigo nvarchar(4) primary key, des nvarchar(60));

-- FProvClie
create table dbo.ProvClie (
  codigo nvarchar(8) primary key, tipo nvarchar(1), des nvarchar(120), descomercial nvarchar(120),
  ruc nvarchar(11), tipodocide nvarchar(1), numdocide nvarchar(15), email nvarchar(80),
  direccion nvarchar(160), distrito nvarchar(60), codubigeo nvarchar(6), fono nvarchar(30)
);

-- FGuia: cabeçalho de TODO movimento de estoque. `numero` é o Nº Interno,
-- correlativo único entre entradas (I004) e saídas por venda (S003).
create table dbo.GuiaCab (
  numero int primary key, codalmacen nvarchar(2), numguia nvarchar(20), fecha datetime, fechadesp datetime,
  codtipomov nvarchar(4), codprovclie nvarchar(8), codsucursal nvarchar(4), codformapago nvarchar(2),
  codvendedor nvarchar(4), moneda nvarchar(3), TC decimal(8,3), numpedido nvarchar(20), numdocref nvarchar(30),
  observacion nvarchar(200), totalitem int, totalunidad decimal(12,3), totalneto decimal(12,2), numensamble nvarchar(20)
);

-- FGuiaDetI
create table dbo.GuiaDet (
  numero int not null references dbo.GuiaCab(numero), linea int not null,
  codarticulo nvarchar(10), des nvarchar(80), numlote nvarchar(12), fechaven datetime, numserie nvarchar(15),
  codunidad nvarchar(3), cantidad decimal(12,3), valor decimal(12,2), dcto1 decimal(6,2), dcto2 decimal(6,2),
  codcc nvarchar(4), total decimal(12,2), Detalle nvarchar(200), comvta nvarchar(2), numcomvta nvarchar(20),
  primary key (numero, linea)
);

-- FVenta (VentaCab é nome real)
create table dbo.VentaCab (
  numero nvarchar(6) primary key, codtipodoc nvarchar(2), numdoc nvarchar(20), fecha datetime, fechaven datetime,
  codprovclie nvarchar(8), codsucursal nvarchar(4), codformapago nvarchar(2), codvendedor nvarchar(4),
  moneda nvarchar(3), TC decimal(8,3), numpedido nvarchar(20), numdocref nvarchar(30), observacion nvarchar(200),
  numvoucher nvarchar(20), totalitem int, totalunidad decimal(12,3), totalneto decimal(12,2), totalinafecto decimal(12,2),
  totalIGV decimal(12,2), total decimal(12,2), totaldcto decimal(12,2), pagado bit
);

-- FVentaDetGF
create table dbo.VentaDet (
  numero nvarchar(6) not null references dbo.VentaCab(numero), linea int not null,
  codarticulo nvarchar(10), des nvarchar(80), numlote nvarchar(12), fechaven datetime, numserie nvarchar(15),
  codunidad nvarchar(3), cantidad decimal(12,3), valor decimal(12,2), dcto1 decimal(6,2), dcto2 decimal(6,2),
  igv decimal(12,2), total decimal(12,2), codcc nvarchar(4), Detalle nvarchar(200), numguia int,
  primary key (numero, linea)
);

-- FVentaPago
create table dbo.VentaPago (
  numero nvarchar(6) not null references dbo.VentaCab(numero), linea int not null,
  codtipopago nvarchar(2), fecha datetime, moneda nvarchar(3), monto decimal(12,2), monedapago nvarchar(3),
  montopago decimal(12,2), vueltol decimal(12,2), banco nvarchar(20), numdoc nvarchar(30), numvoucher nvarchar(20),
  primary key (numero, linea)
);

-- FContrato / FContratoDet
create table dbo.ContratoCab (
  numero int primary key, fecha datetime, codprovclie nvarchar(8), moneda nvarchar(3), TC decimal(8,3),
  fechaentrega datetime, horaentrega nvarchar(5), lugarentrega nvarchar(160), observacion nvarchar(300),
  totalitem int, totalunidad decimal(12,3), totalneto decimal(12,2), totalIGV decimal(12,2), total decimal(12,2),
  cerrado bit default 0, facturafinal nvarchar(20)
);
create table dbo.ContratoDet (
  numero int not null references dbo.ContratoCab(numero), linea int not null,
  codarticulo nvarchar(10), des nvarchar(80), codunidad nvarchar(3), cantidad decimal(12,3), valor decimal(12,2),
  igv decimal(12,2), total decimal(12,2), codtipotorta nvarchar(4), codsabor nvarchar(4), coddecoradora nvarchar(4),
  primary key (numero, linea)
);
go

-- Dados de referência (dos documentos reais da loja)
insert into dbo.Familia values ('T','TORTAS'),('PS','PASTELERIA'),('G','GALLETAS'),('V','VELAS'),('E','EMPANADAS'),('K','KEKES');
insert into dbo.Almacen values ('1','PERU FANOR'),('2','EE.UU. FANOR');
insert into dbo.Vendedor values ('0000','Oficina'),('0001','VENDEDORA 1'),('0002','VENDEDORA 2');
insert into dbo.ProvClie (codigo,tipo,des,ruc,tipodocide,numdocide) values
  ('00620','C','VENTAS AL PUBLICO EN GENERAL',null,'0','00000000001'),
  ('20454','P','DELICIAS DE FANOR S.A.C.','20454554834','6','20454554834');
go
