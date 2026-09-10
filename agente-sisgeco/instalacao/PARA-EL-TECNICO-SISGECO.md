# Solicitud al soporte técnico de Sisgeco — Tortas Fanor

Estamos integrando la tienda web de **Tortas Fanor** con el sistema Sisgeco.
Para eso, necesitamos **leer** (nunca escribir) los movimientos de inventario
del sistema. Pedimos su ayuda con dos cosas rápidas en el servidor.

**Servidor:** `SRV00Y` — SQL Server 2014 Express
**Base de datos:** `Fanor`

Nada de esto modifica datos, tablas ni configuración del Sisgeco. Es solo
lectura.

---

## 1. Crear un usuario de SOLO LECTURA

En SQL Server Management Studio, conectado como administrador (`sa` o una
cuenta sysadmin), abrir una consulta nueva y ejecutar:

```sql
-- Login de solo lectura para la integración web de Tortas Fanor.
-- Cambie la contraseña por una de su preferencia.
CREATE LOGIN fanor_lectura
  WITH PASSWORD = 'Fanor#Lectura2026', CHECK_POLICY = OFF;

USE [Fanor];
CREATE USER fanor_lectura FOR LOGIN fanor_lectura;
ALTER ROLE db_datareader ADD MEMBER fanor_lectura;
```

Este usuario pertenece **solo** al rol `db_datareader`: puede leer, no puede
insertar, actualizar, borrar ni alterar nada. No toca el funcionamiento del
Sisgeco de ninguna manera.

Para confirmar que quedó bien (debe devolver `1` y `0`):

```sql
SELECT
  IS_ROLEMEMBER('db_datareader', 'fanor_lectura')            AS lee,
  ISNULL(IS_ROLEMEMBER('db_datawriter', 'fanor_lectura'), 0) AS escribe;
```

---

## 2. Habilitar TCP/IP y confirmar el puerto

La integración se conecta por TCP. En instalaciones Express suele venir
desactivado.

1. Abrir **SQL Server Configuration Manager**.
2. **Configuración de red de SQL Server → Protocolos de SQLEXPRESS** (o el
   nombre de la instancia).
3. Si **TCP/IP** está *Deshabilitado*, habilitarlo (clic derecho → Habilitar).
4. Doble clic en **TCP/IP → pestaña Direcciones IP → IPAll**: fijar
   **Puerto TCP = 1433** y dejar vacío *Puertos TCP dinámicos*.
5. Reiniciar el servicio **SQL Server (la instancia correspondiente)**.

---

## Lo que necesitamos de vuelta

- Confirmación de que el usuario `fanor_lectura` fue creado.
- La **contraseña** que le asignaron (por un canal privado).
- El **puerto TCP** (1433 si siguieron el paso anterior).

Con eso terminamos la integración sin volver a pedir acceso al servidor.
Muchas gracias.

---

<!-- Nota para Pedro (no enviar al técnico):
     Servidor SRV00Y, SQL 2014 Express, base Fanor. La contraseña del login
     "sisgeco" está compilada dentro de msiscont.exe — no es recuperable de
     archivos. La cuenta de Windows (luis.correa) es admin del Windows pero
     sysadmin=0 en SQL. Plan B (single-user mode) queda como último recurso,
     solo fuera de horario: reinicia el SQL y cae la contabilidad de las dos
     empresas del servidor (Fanor y Pilmilar). -->
