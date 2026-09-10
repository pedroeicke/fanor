/* ============================================================================
   Tortas Fanor — preparar o SQL Server do Sisgeco para o leitor

   O QUE ESTE SCRIPT FAZ
     1. Cria um login que só LÊ. Ele não pode gravar, apagar nem alterar nada.
     2. Mostra a lista de tabelas e colunas do banco, para eu ajustar as
        consultas do leitor sem precisar de outra sessão de TeamViewer.

   O QUE ELE NÃO FAZ
     Não cria tabela, não cria gatilho, não altera nada do Sisgeco. As únicas
     escritas são no cadastro de usuários do servidor — nada toca os dados.

   COMO RODAR
     Abra o SQL Server Management Studio (SSMS) conectado como administrador,
     abra este arquivo, TROQUE A SENHA na linha marcada e aperte Executar (F5).

   Se o banco não se chamar "Fanor", troque o nome nas três linhas com USE.
   ========================================================================= */

/* ---------- TROQUE ESTA SENHA antes de executar ---------- */
DECLARE @senha nvarchar(100) = N'TROQUE_ESTA_SENHA_123';
/* --------------------------------------------------------- */

USE master;
GO

/* 1. Login só de leitura ---------------------------------------------------
   CHECK_POLICY OFF evita que a política de senha do Windows force troca
   periódica: é uma conta de serviço, ninguém digita essa senha. */
DECLARE @senha nvarchar(100) = N'TROQUE_ESTA_SENHA_123';
IF NOT EXISTS (SELECT 1 FROM sys.sql_logins WHERE name = 'fanor_lectura')
  EXEC('CREATE LOGIN fanor_lectura WITH PASSWORD = ''' + @senha + ''', CHECK_POLICY = OFF, DEFAULT_DATABASE = [Fanor]');
GO

USE Fanor;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'fanor_lectura')
  CREATE USER fanor_lectura FOR LOGIN fanor_lectura;
GO

/* Só leitura. Nada de db_datawriter, nada de db_owner. */
ALTER ROLE db_datareader ADD MEMBER fanor_lectura;
GO

/* Prova de que ficou só leitura: os dois valores têm de ser 1 e 0. */
SELECT
  'Confere as permissões' AS [--- 1 ---],
  IS_ROLEMEMBER('db_datareader', 'fanor_lectura') AS le_dados,
  ISNULL(IS_ROLEMEMBER('db_datawriter', 'fanor_lectura'), 0) AS escreve_dados,
  ISNULL(IS_ROLEMEMBER('db_owner', 'fanor_lectura'), 0) AS e_dono;
GO

/* 2. Dados do servidor ---------------------------------------------------- */
SELECT
  'Versão do servidor' AS [--- 2 ---],
  SERVERPROPERTY('Edition')        AS edicao,
  SERVERPROPERTY('ProductVersion') AS versao,
  SERVERPROPERTY('InstanceName')   AS instancia,
  @@SERVERNAME                     AS nome_servidor,
  DB_NAME()                        AS banco;
GO

/* 3. Porta TCP em uso ----------------------------------------------------- */
SELECT 'Porta TCP' AS [--- 3 ---], local_tcp_port AS porta
FROM sys.dm_exec_connections WHERE session_id = @@SPID;
GO

/* 4. Tabelas do banco, com tamanho ---------------------------------------
   É o que me diz onde ficam as vendas, as guias e os artigos. */
SELECT TOP 60
  'Tabelas' AS [--- 4 ---],
  s.name AS esquema, t.name AS tabela, p.rows AS linhas
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
ORDER BY p.rows DESC;
GO

/* 5. Colunas das tabelas que interessam -----------------------------------
   Procura pelas colunas que eu já conheço das telas do Sisgeco (numero,
   codarticulo, numserie, numlote…) e mostra em que tabela elas moram. */
SELECT
  'Colunas' AS [--- 5 ---],
  t.name AS tabela, c.name AS coluna, ty.name AS tipo, c.max_length AS tamanho
FROM sys.columns c
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE c.name IN (
  'numero','linea','codarticulo','numserie','numlote','fechaven','cantidad',
  'codalmacen','codtipomov','numguia','numdocref','codvendedor','codprovclie',
  'codtipodoc','numdoc','codfamilia','usaserie','usalote','precio1',
  'codtipotorta','codsabor','coddecoradora','fechaentrega'
)
ORDER BY t.name, c.column_id;
GO

/* 6. Amostra dos movimentos mais recentes ---------------------------------
   Só para eu ver o formato real. Se a tabela tiver outro nome, este bloco
   dá erro — pode ignorar, o resto do script já rodou. */
BEGIN TRY
  SELECT TOP 5 'Amostra de movimentos' AS [--- 6 ---], * FROM dbo.GuiaCab ORDER BY numero DESC;
END TRY
BEGIN CATCH
  SELECT 'Amostra de movimentos' AS [--- 6 ---], 'Tabela dbo.GuiaCab não existe com esse nome — normal, o passo 4 resolve' AS aviso;
END CATCH
GO
