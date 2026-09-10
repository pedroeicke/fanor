# Recuperar o controle do SQL Server — Tortas Fanor (SRV00Y)

O fornecedor do Sisgeco sumiu e ninguém tem a senha de administrador do SQL
Server. Como a conta do Windows é administradora da máquina, dá para recuperar
o controle pelo procedimento oficial da Microsoft (modo usuário único).

Ao final você terá:
- **`fanor_admin`** — um administrador do SQL que é do Joseka. Nunca mais
  ficará trancado.
- **`fanor_lectura`** — um usuário SÓ DE LEITURA para a integração da web.

**Instância:** `MSSQLSERVER` (a padrão, SQL Server 2014, onde está a base Fanor).
NÃO mexer na `SQLEXPRESS` (é a 2022, não tem os dados vivos).

---

## ANTES DE COMEÇAR — obrigatório

- [ ] Nenhum caixa vendendo. O SQL vai parar 2 a 4 minutos (Fanor **e** Pilmilar).
- [ ] Joseka de acordo e a Pilmilar avisada.
- [ ] Todos os Sisgeco fechados neste momento.

Se qualquer item falhar, **pare** e faça noutra hora.

> Nada é alterado até o passo 4. Se travar antes disso, o passo "SE DER ERRADO"
> devolve tudo como estava.

---

## Passo 1 — Abrir o Prompt de Comando como administrador

Tecla Windows → digite `cmd` → clique com o botão direito em **Símbolo do
sistema** → **Executar como administrador**.

> Use o `cmd`, NÃO o PowerShell — evita problema com as aspas do `/m"SQLCMD"`.

---

## Passo 2 — Parar o SQL Server

```
net stop MSSQLSERVER
```

Se ele perguntar sobre serviços dependentes, confirme com `S`. Espere a
mensagem "se detuvo correctamente" / "foi parado com êxito".

---

## Passo 3 — Subir em modo usuário único (só o sqlcmd entra)

```
net start MSSQLSERVER /m"SQLCMD"
```

O `/m"SQLCMD"` deixa passar só o programa `sqlcmd`. Assim nenhum caixa toma a
única conexão disponível. Espere "se inició correctamente".

---

## Passo 4 — Entrar e criar os usuários

```
sqlcmd -S . -E
```

Vai aparecer o prompt `1>`. Como a máquina está em modo usuário único, o
administrador do Windows entra como administrador total do SQL. Cole os
blocos abaixo — **um de cada vez**, apertando ENTER após o `GO`.

**Administrador permanente do Joseka** (troque a senha por uma que só ele saiba):

```
CREATE LOGIN fanor_admin WITH PASSWORD = 'Joseka#Admin2026', CHECK_POLICY = OFF;
EXEC sp_addsrvrolemember 'fanor_admin', 'sysadmin';
GO
```

**Usuário só de leitura para a web:**

```
CREATE LOGIN fanor_lectura WITH PASSWORD = 'Fanor#Lectura2026', CHECK_POLICY = OFF;
GO
USE Fanor;
CREATE USER fanor_lectura FOR LOGIN fanor_lectura;
ALTER ROLE db_datareader ADD MEMBER fanor_lectura;
GO
```

**Conferir (deve mostrar um número de tabelas):**

```
SELECT COUNT(*) AS tablas FROM sys.tables;
GO
```

Sair do sqlcmd:

```
EXIT
```

---

## Passo 5 — Voltar o SQL ao normal

```
net stop MSSQLSERVER
net start MSSQLSERVER
```

Espere "se inició correctamente". **Pronto — os caixas voltam a funcionar.**

---

## Passo 6 — Testar de fora (sem modo especial)

```
sqlcmd -S . -U fanor_lectura -P Fanor#Lectura2026 -d Fanor -Q "SELECT COUNT(*) AS tablas FROM sys.tables"
```

Deve mostrar o número de tabelas. E confirmar que ele NÃO grava (tem que dar erro):

```
sqlcmd -S . -U fanor_lectura -P Fanor#Lectura2026 -d Fanor -Q "CREATE TABLE zztest(i int)"
```

Se o primeiro mostrar o número e o segundo der "permiso denegado", **deu certo**.

---

## Passo 7 — Habilitar TCP/IP (para a web conectar)

1. Tecla Windows → `SQLServerManager12.msc` (a 12 é a do 2014). Enter.
2. **Configuración de red de SQL Server → Protocolos de MSSQLSERVER**.
3. Se **TCP/IP** estiver desabilitado, botão direito → **Habilitar**.
4. Duplo clique em **TCP/IP → aba Direcciones IP → IPAll**: em **Puerto TCP**
   escreva `1433` e deixe **Puertos TCP dinámicos** vazio.
5. Reinicie uma última vez: `net stop MSSQLSERVER` e `net start MSSQLSERVER`.

---

## SE DER ERRADO (a qualquer momento)

O SQL não voltou, ou algo travou? Rode:

```
net stop MSSQLSERVER
net start MSSQLSERVER
```

Isso sobe o SQL no modo **normal**, como estava antes. Nada foi perdido — os
`CREATE` só criam usuários novos; não tocam em nenhum dado da Fanor nem da
Pilmilar.

Se `net start MSSQLSERVER` disser que já está rodando, está tudo certo.

---

## O que me mandar no fim

- Confirmação de que o passo 6 funcionou (número de tabelas + o erro no segundo).
- A **porta** que ficou no passo 7 (1433).
- A senha do `fanor_lectura` (se você trocou a que está aqui).

Com isso eu ajusto o leitor aos nomes reais das tabelas e coloco a vitrine no ar.

> Guarde a senha do `fanor_admin` em lugar seguro. É a chave-mestra do banco do
> Joseka daqui pra frente — troque a senha de exemplo por uma que só ele saiba.
