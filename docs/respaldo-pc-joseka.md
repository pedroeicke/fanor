# Respaldo diario en la PC de Joseka

Cada día, a las **03:30 (hora de Lima)**, el sistema guarda una copia de todas
sus tablas —productos, tortas, ventas, encomiendas, clientes, pedidos web,
reclamos, leads— en un archivo comprimido privado en la nube. Allí se
conserva **30 días**.

Esta guía instala en la PC de Joseka un pequeño programa que, una vez al día,
**descarga el último respaldo** a una carpeta local y guarda los **60 más
recientes**. Así siempre hay una copia fuera de la nube, en manos del dueño.

**Tiempo:** unos 15 minutos. **Riesgo:** ninguno; el programa solo lee y
descarga, no cambia nada en el sistema.

> **Qué NO trae el respaldo:** contraseñas ni cuentas de acceso al panel, y
> tampoco las fotos (esas viven en el almacenamiento de imágenes).

---

## Antes de empezar

Necesitas:

- La PC con **Windows 10 u 11** e internet.
- El **token de descarga de respaldos**. Lo entrega el técnico (Pedro) en
  persona o por un canal privado. **No lo escribas en este documento, ni lo
  mandes por el grupo de WhatsApp:** quien tenga el token puede descargar la
  base de datos completa, con los datos de los clientes.
- La dirección del sitio: `https://tortasfanor.com`.

---

## Paso 1 — Instalar Node.js

Node.js es el programa que ejecuta el descargador.

1. Abre **https://nodejs.org** y descarga la versión **LTS** (el botón
   grande de la izquierda).
2. Ejecuta el instalador y acepta las opciones por defecto (**Next** hasta
   **Finish**).
3. Comprueba que quedó instalado. Tecla **Windows**, escribe `PowerShell` y
   ábrelo. Ejecuta:

   ```powershell
   node -v
   ```

   Debe mostrar algo como `v22.x.x` (cualquier número desde 18 sirve). Si dice
   que no reconoce `node`, cierra PowerShell, ábrelo de nuevo y repite; si
   sigue igual, reinicia la PC.

---

## Paso 2 — Poner el descargador en su carpeta

1. Crea la carpeta **`C:\FanorRespaldo`**.
2. Copia ahí el archivo **`descargar-respaldo.mjs`** (está en la carpeta
   `scripts` del proyecto; Pedro lo entrega junto con el token).

Los respaldos se guardarán en **`C:\FanorRespaldo\respaldos`**. El programa
crea esa carpeta solo.

> Si la PC tiene un segundo disco (`D:`) o una carpeta sincronizada con
> OneDrive o Google Drive, es mejor usarla: así hay otra copia más si el disco
> principal falla. Solo cambia la ruta en los pasos 3, 4 y 5.

---

## Paso 3 — Guardar el token en Windows

El token no se escribe en la tarea programada (quedaría visible en su
configuración). Se guarda como **variable de entorno** del usuario.

En PowerShell, ejecuta (reemplaza `PEGA_AQUI_EL_TOKEN` por el token que te
dieron, entre las comillas):

```powershell
setx RESPALDO_TOKEN "PEGA_AQUI_EL_TOKEN"
```

Debe responder `CORRECTO: se guardó el valor especificado.`

**Importante:** después de este paso, **cierra sesión en Windows y vuelve a
entrar** (o reinicia la PC). Las tareas programadas solo ven la variable
nueva después de eso.

---

## Paso 4 — Probar a mano

Abre **una ventana nueva** de PowerShell y ejecuta:

```powershell
node C:\FanorRespaldo\descargar-respaldo.mjs --url https://tortasfanor.com --pasta C:\FanorRespaldo\respaldos
```

Si todo está bien, verás algo así:

```
[2026-09-14 09:00:01] Consultando el último respaldo en https://tortasfanor.com…
[2026-09-14 09:00:02] Descargando fanor-respaldo-20260914-033000.json.gz (2.3 MB)…
[2026-09-14 09:00:05] Listo: C:\FanorRespaldo\respaldos\fanor-respaldo-20260914-033000.json.gz (2.3 MB).
[2026-09-14 09:00:05] En la carpeta hay 1 respaldo(s).
```

Si lo ejecutas otra vez el mismo día, dirá **"Ya estaba descargado… Nada que
hacer."** — es normal: no descarga dos veces el mismo archivo.

Si aparece un `ERROR`, mira la tabla de [problemas frecuentes](#problemas-frecuentes).

---

## Paso 5 — Programar la descarga diaria

Se crea una tarea en el **Programador de tareas** de Windows que corre todos
los días a las **09:00**. Si a esa hora la PC está apagada, la tarea corre
**apenas se encienda y entres a Windows** con tu usuario.

A esa hora se abre por unos segundos una ventana negra: es el descargador
trabajando. Es normal; no hace falta cerrarla, se cierra sola.

En PowerShell, copia y pega **todo el bloque** de una vez y presiona Enter:

```powershell
$accion = New-ScheduledTaskAction -Execute "C:\Program Files\nodejs\node.exe" -Argument '"C:\FanorRespaldo\descargar-respaldo.mjs" --url https://tortasfanor.com --pasta "C:\FanorRespaldo\respaldos"' -WorkingDirectory "C:\FanorRespaldo"
$horario = New-ScheduledTaskTrigger -Daily -At 09:00
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskPath "\Tortas Fanor\" -TaskName "Descargar respaldo" -Action $accion -Trigger $horario -Settings $ajustes -Description "Descarga el respaldo diario de Tortas Fanor a C:\FanorRespaldo\respaldos"
```

Debe mostrar una tabla con `Descargar respaldo` y estado `Ready` (o `Listo`).

> Si Node.js se instaló en otra ruta, averígua cuál con `where.exe node` y
> reemplaza `C:\Program Files\nodejs\node.exe` en la primera línea.

**Probar la tarea sin esperar a mañana:**

```powershell
Start-ScheduledTask -TaskPath "\Tortas Fanor\" -TaskName "Descargar respaldo"
```

Espera unos segundos y revisa el resultado:

```powershell
Get-ScheduledTaskInfo -TaskPath "\Tortas Fanor\" -TaskName "Descargar respaldo" | Select-Object LastRunTime, LastTaskResult
```

`LastTaskResult` igual a **0** significa que salió bien. Cualquier otro número
indica un problema: abre el registro (siguiente sección) para ver el motivo.

La tarea también se ve con la interfaz: tecla **Windows** → `Programador de
tareas` → carpeta **Tortas Fanor** en la columna izquierda.

---

## Dónde quedan los archivos

En **`C:\FanorRespaldo\respaldos`**:

| Archivo | Qué es |
|---|---|
| `fanor-respaldo-AAAAMMDD-HHMMSS.json.gz` | Un respaldo. La fecha y la hora son las de Lima en que se generó. |
| `descargas.log` | Registro de cada ejecución: qué descargó, cuándo y los errores. Se abre con el Bloc de notas. |

Se conservan los **60 respaldos más recientes**; los más antiguos se borran
solos. Un archivo terminado en `.part` es una descarga que se interrumpió: se
borra sola en la próxima ejecución.

---

## Cómo abrir un respaldo

El archivo `.json.gz` es texto (JSON) comprimido.

1. Instala **7-Zip** desde **https://www.7-zip.org** (gratuito).
2. Clic derecho sobre el respaldo → **7-Zip** → **Extraer aquí**. Aparece un
   archivo `.json` con el mismo nombre.
3. Ábrelo con **Firefox** (arrastra el archivo a la ventana: muestra las
   tablas ordenadas y plegables) o con **Visual Studio Code**. El Bloc de notas
   también sirve, pero con archivos grandes se pone lento.

Estructura del archivo:

```json
{
  "generated_at": "2026-09-14T08:30:00.000Z",
  "time_zone": "America/Lima",
  "tables": {
    "stores": [ { "id": "…", "name": "Tortas Fanor — Calle Perú", … } ],
    "products": [ … ],
    …
  },
  "row_counts": { "stores": 2, "products": 423, … },
  "skipped_tables": []
}
```

`generated_at` está en hora UTC (Lima = UTC − 5). Cada tabla es una lista de
filas, con los mismos nombres de columna del sistema. Las principales:

| Tabla | Contenido |
|---|---|
| `products`, `product_families` | Productos y familias (códigos del Sisgeco: T26, PS12…) |
| `stores`, `sellers` | Tiendas y vendedoras |
| `customers`, `customer_notes` | Clientes y notas |
| `cake_units`, `cake_events` | Cada torta (serie, sabor, estado) y su historial |
| `dispatches`, `production_orders` | Despachos del taller y pedidos de tienda |
| `sales`, `sale_lines`, `sale_payments` | Ventas, su detalle y cómo se pagaron |
| `contracts`, `contract_lines` | Encomiendas |
| `orders`, `order_items` | Pedidos de la tienda web |
| `complaints` | Libro de Reclamaciones |
| `leads`, `lead_events` | Leads y su seguimiento |

---

## Restaurar

Restaurar es trabajo del técnico, no se hace desde esta PC. Para quien lo
haga:

- Las tablas están en el archivo **en orden de dependencia**: insertarlas en
  ese orden respeta las claves foráneas (tienda antes que producto, venta antes
  que su detalle).
- Insertar con la clave de servicio (sin RLS), en lotes, preservando los `id`.
- Dos tablas se apuntan a sí mismas: `cake_units.origin_unit_id` (torta
  redecorada) y `fiscal_documents.adjusts_id` (nota de crédito). Insertar
  primero con esa columna vacía y completarla en una segunda pasada.
- Después de insertar, ajustar las secuencias (`number` de ventas,
  encomiendas, despachos; series de torta `cake_serial_seq` y
  `cake_serial_seq_g`) al mayor valor restaurado, para que la numeración no
  repita.
- Las cuentas de acceso al panel (`admins` y usuarios de Supabase) no están en
  el respaldo: se vuelven a crear.

---

## Problemas frecuentes

| Mensaje en `descargas.log` | Qué hacer |
|---|---|
| `Falta el token (--token o RESPALDO_TOKEN)` | Repite el paso 3 y **cierra sesión en Windows**. |
| `el token no es válido` | El token cambió o se copió mal. Pide el token vigente y repite el paso 3. |
| `no se pudo conectar … ¿Hay internet?` | La PC no tenía internet a esa hora. Se reintenta al día siguiente; puedes ejecutar la tarea a mano. |
| `todavía no hay ningún respaldo terminado` | El respaldo de la nube no se está generando. Avisar al técnico. |
| `la descarga de respaldos no está configurada` | Falta configurar el token en el sitio. Avisar al técnico. |
| `El archivo llegó incompleto` / `está dañado` | Internet cortada a mitad. Se reintenta solo en la próxima ejecución. |
| `LastTaskResult` = 2 | Falta un dato de configuración (token, dirección o carpeta). Ver el log. |
| `LastTaskResult` = 2147942402 y no hay `descargas.log` | Windows no encontró `node.exe`. Averigua la ruta con `where.exe node` y vuelve a registrar la tarea (paso 5) con esa ruta; antes bórrala con `Unregister-ScheduledTask -TaskPath "\Tortas Fanor\" -TaskName "Descargar respaldo" -Confirm:$false`. |

**Si pierdes la PC o crees que alguien vio el token:** avisa al técnico para
que genere un token nuevo en el sitio. El anterior deja de funcionar al
instante; solo hay que repetir el paso 3 con el nuevo.

Para ver el estado de los respaldos en la nube, entra al panel:
**Gestión → Respaldos**.
