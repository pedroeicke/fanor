# Preparar o PC da loja — guia para a sessão de TeamViewer

Objetivo da sessão: criar um usuário **só de leitura** no SQL Server do
Sisgeco e trazer o mapa das tabelas. Sem isso o leitor não sai do teste.

**Tempo:** 10 a 15 minutos. **Risco:** nenhum dado do Sisgeco é alterado.

> Aproveite a mesma sessão para os dois passos. Se sair só com o usuário
> criado, vai precisar de outra sessão para descobrir os nomes das tabelas.

---

## Antes de começar

Peça ao Joseka:

- que o **Sisgeco esteja fechado** na máquina (não é obrigatório, mas evita
  susto se algum diálogo aparecer);
- a senha de **administrador do Windows** dessa máquina, caso algum passo
  peça elevação;
- que ninguém esteja no meio de uma venda naquele instante.

---

## Passo 1 — Achar o SQL Server

No PC da loja, tecla **Windows** e digite `SQL Server Management Studio`.

**Se abrir:** ótimo, siga para o passo 2.

**Se não abrir**, procure por `SQL Server Configuration Manager`. Se também
não houver, o SSMS não está instalado — nesse caso baixe em
`aka.ms/ssmsfullsetup` (uns 15 min de instalação) ou use o passo 1-B.

### Passo 1-B — sem SSMS, pelo PowerShell

Abra o PowerShell **como administrador** e rode:

```powershell
Get-Service | Where-Object { $_.Name -like 'MSSQL*' } | Select-Object Name, Status
```

Anote o nome da instância. Depois use `sqlcmd`:

```powershell
sqlcmd -S .\SQLEXPRESS -E -i "C:\caminho\1-criar-usuario-e-mapear.sql" -o "C:\fanor-mapa.txt"
```

Troque `.\SQLEXPRESS` pelo nome que apareceu. O resultado sai em
`C:\fanor-mapa.txt` — é esse arquivo que eu preciso.

---

## Passo 2 — Conectar no SSMS

Na janela de conexão:

| Campo | O que pôr |
|---|---|
| Server type | Database Engine |
| Server name | `.` ou `.\SQLEXPRESS` (tente os dois) |
| Authentication | **Windows Authentication** |

Se der erro de conexão, no Server name tente também `localhost`,
`(local)\SQLEXPRESS` ou o nome do PC.

Ao conectar, expanda **Databases** na lateral esquerda e **confirme que
existe um banco chamado `Fanor`**. Se tiver outro nome, anote — vai precisar
trocar no script.

---

## Passo 3 — Rodar o script

1. **File → Open → File** e abra `1-criar-usuario-e-mapear.sql`.
2. Na linha marcada, **troque `TROQUE_ESTA_SENHA_123`** por uma senha de
   verdade. Ela aparece **duas vezes** no arquivo — troque nas duas, iguais.
   Use algo simples de digitar e sem acento, por exemplo `Fanor#Lectura2026`.
3. Se o banco não se chamar `Fanor`, troque nas linhas `USE Fanor;`.
4. Aperte **Execute** (ou F5).

Vai aparecer uma sequência de resultados na parte de baixo. **O primeiro é o
que importa:**

```
le_dados = 1     escreve_dados = 0     e_dono = 0
```

Se `escreve_dados` ou `e_dono` vierem `1`, pare e me chame — algo saiu
errado.

---

## Passo 4 — Salvar os resultados

Ainda no SSMS, com os resultados na tela:

1. Clique com o botão direito em qualquer grade de resultado.
2. **Save Results As…** → salve como `fanor-mapa.csv`.

Repita para cada uma das grades (são 6). Ou, mais rápido:

1. Menu **Query → Results To → Results to File** (Ctrl+Shift+F).
2. Rode o script de novo (F5) — ele pergunta onde salvar. Salve como
   `fanor-mapa.txt`.

**É esse arquivo que você me manda.** Com ele eu ajusto o leitor sem precisar
de outra sessão.

---

## Passo 5 — Ligar o TCP/IP

O leitor conversa com o banco por TCP. Em instalação Express costuma vir
desligado.

1. Abra o **SQL Server Configuration Manager**.
   (Se não achar no menu: tecla Windows → digite `SQLServerManager16.msc`;
   se não abrir, tente `15`, `14`, `13` ou `11` no lugar do `16`.)
2. Lateral esquerda: **SQL Server Network Configuration → Protocols for
   SQLEXPRESS** (ou o nome da instância).
3. Se **TCP/IP** estiver `Disabled`, clique com o botão direito → **Enable**.
4. Clique duas vezes em **TCP/IP** → aba **IP Addresses** → role até o fim,
   em **IPAll**:
   - se **TCP Port** estiver vazio, anote o valor de **TCP Dynamic Ports**;
   - ou escreva `1433` em **TCP Port** e apague o **TCP Dynamic Ports**
     (deixa a porta fixa, é melhor para o serviço).
5. **Anote a porta.**
6. Lateral esquerda: **SQL Server Services** → botão direito no serviço
   **SQL Server (SQLEXPRESS)** → **Restart**.

> O restart derruba o Sisgeco por uns 10 segundos. Avise antes. Se a loja
> estiver em movimento, deixe este passo para o fim do expediente — o resto
> do guia já pode ser feito.

---

## Passo 6 — Permitir login por senha

O Sisgeco costuma entrar por conta do Windows. O leitor entra por usuário e
senha, e isso precisa estar habilitado.

No SSMS: botão direito no **nome do servidor** (topo da lateral esquerda) →
**Properties** → **Security** → marque **SQL Server and Windows
Authentication mode** → OK.

Se você precisou mudar essa opção, o serviço precisa de **Restart** de novo
(passo 5.6).

---

## Passo 7 — Testar

De volta ao SSMS: **Connect → Database Engine**, e desta vez:

| Campo | O que pôr |
|---|---|
| Authentication | **SQL Server Authentication** |
| Login | `fanor_lectura` |
| Password | a senha que você definiu |

Conectou? Abra uma nova consulta e rode:

```sql
USE Fanor;
SELECT TOP 5 * FROM sys.tables;          -- deve funcionar
CREATE TABLE teste_permissao (id int);   -- deve DAR ERRO
```

O segundo comando **tem que falhar** com "permission denied". Se ele
funcionar, o usuário está com permissão demais — me chame.

---

## O que me mandar no fim

1. O arquivo **`fanor-mapa.txt`** (ou os CSVs) do passo 4.
2. **Nome do servidor/instância** — ex.: `SERVIDOR-LOJA\SQLEXPRESS`.
3. **Porta TCP** anotada no passo 5.
4. **Nome do banco**, se não for `Fanor`.
5. A **senha** que você definiu — por um canal separado desta conversa.

Com isso eu ajusto as consultas, testo aqui e volto com o leitor pronto para
instalar como serviço.

---

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| "Login failed for user" ao testar | Passo 6 não foi feito, ou faltou o Restart |
| Não acha o Configuration Manager | Tecla Windows → `SQLServerManager16.msc` (troque o número) |
| Banco não se chama `Fanor` | Troque nas linhas `USE` do script e me avise o nome |
| Script dá erro no bloco 6 | Normal — as tabelas têm outro nome. O bloco 4 já resolveu |
| Não deixa criar login | A conta do Windows não é sysadmin. Peça a conta de administrador |
| SSMS não existe e não quer instalar | Use o passo 1-B com `sqlcmd` |

**Nada neste guia altera dados do Sisgeco.** Se em algum momento algo pedir
para modificar tabela, apagar ou converter, pare — não faz parte.
