# Zenguy — Alertas: email por defecto y SMS/llamadas de pago (diseño)

Fecha: 2026-08-21 · Estado: implementado en `main` (commit "Add Alerts: default email channel and pay-as-you-go SMS & calls") para revisión; ver también `docs/alerts-paid-channels.md`.

## 1. Problema

Hoy cualquier workspace puede crear canales SMS y de llamada sin coste. Con el
número USA de Twilio (`+1 850 493 6489`) cada SMS a Europa cuesta $0.05–$0.20 y
cada llamada a un móvil europeo entre $0.04 y $0.66 el minuto según el país y
el origen no‑EEE. Un monitor inestable con varios canales telefónicos puede
generar decenas de euros al día que pagaríamos nosotros. Además un workspace
nuevo no tiene ningún canal, así que un test recién creado no avisa a nadie.

## 2. Decisiones

1. **El email es el canal por defecto y siempre gratis.** Al crear un workspace
   se crea automáticamente un canal `EMAIL` ("Workspace email") con el correo
   del propietario, marcado como *default*. Los formularios de nuevo test y
   nuevo monitor preseleccionan los canales marcados como default. Slack y
   Discord siguen siendo gratis.
2. **SMS, llamadas (y WhatsApp cuando vuelva) son un add‑on de pago por uso**
   que se cobra de un **crédito prepago** del workspace. Sin crédito no se
   envía nada: nunca puede haber saldo negativo ni deuda.
3. **Precios por destino con margen sobre Twilio.** Tabla por país para
   USA/Canadá y toda Europa (UE‑27 + Reino Unido, Suiza, Noruega, Islandia) y una
   tarifa plana para el resto del mundo. Fórmula: `precio = max(mínimo,
   ceil(coste_Twilio_USD × 2,0))` en céntimos de euro, asumiendo de forma
   conservadora 1 USD ≈ 1 EUR. Mínimos: €0,05 por SMS y €0,20 por llamada.
   Resto del mundo: €0,40 por SMS y €0,80 por llamada.
4. **Cada alerta cuesta exactamente una unidad.** Los SMS se recortan a un
   segmento (160 caracteres GSM‑7 / 70 UCS‑2) y las llamadas se limitan a 55 s
   con `TimeLimit` (Twilio factura por minuto empezado), así el precio mostrado
   es el precio real.
5. **Protecciones contra el "irse de madre":** dedupe existente (un aviso de
   fallo y uno de recuperación por incidente y canal), tope diario configurable
   de alertas de pago por workspace (20 por defecto, 1–200), pausa automática
   sin crédito, aviso por email al owner cuando el crédito baja de €2 o se omite
   una alerta por falta de saldo (una sola vez hasta la siguiente recarga).
6. **Nueva sección "Alerts"** en el menú (sustituye a "Notifications"):
   pestañas **Channels** y **SMS & calls**. `/notifications` redirige a
   `/alerts`.
7. **Recargas vía Paddle** (pago único, packs de €10). Mientras Paddle no esté
   configurado (lanzamiento gratuito actual), la pantalla muestra precios y
   explica que las recargas abrirán pronto; el interruptor de SMS & calls queda
   deshabilitado. En staging (Paddle Sandbox) el flujo completo es probable.

## 3. Experiencia de usuario

### 3.1 Navegación

`Alerts` (icono campana) → `/w/:id/alerts` (Channels) y
`/w/:id/alerts/sms-calls` (SMS & calls). El enlace "Manage channels" de los
formularios apunta a `/alerts`.

### 3.2 Pestaña Channels

- Lista de canales como hasta ahora, con dos novedades por tarjeta:
  - Badge **Default** y acción "Use as default / Remove from defaults".
  - Para SMS/llamada/WhatsApp: línea "España · €0,18 per SMS" y, si procede,
    badge **Paused** con motivo ("SMS & calls are off" / "No alert credit").
- Modal de alta: los tipos SMS y Phone call llevan la etiqueta "Pay as you
  go". Si el add‑on está apagado, al elegirlos se muestra un aviso con enlace a
  SMS & calls en vez del formulario. Al teclear el número se consulta
  `GET …/alerts/quote` y se muestra "Spain · €0,18 per SMS" bajo el campo.
- Selector de canales en tests y monitores: preselección de defaults al crear,
  precio por alerta junto a los canales de pago y marca "Paused" cuando no
  pueden enviar.

### 3.3 Pestaña SMS & calls

Tarjetas, de arriba abajo:

1. **Status** — interruptor On/Off (owners y admins). Texto: "When off, SMS and
   call channels are paused and nothing is charged." Si no hay recargas
   disponibles: interruptor deshabilitado + "Top‑ups aren't available yet…".
2. **Credit** — saldo grande ("€4,82 available"), "Top up" (solo owner) que
   abre el overlay de Paddle con 1–10 packs de €10, contador "3 of 20 paid
   alerts in the last 24 h" y aviso de saldo bajo.
3. **Protections** — tope diario editable y tres bullets (una alerta por
   incidente; sin crédito se pausan solo los canales de pago; llamada ≤ 1 min,
   SMS = 1 segmento).
4. **Pricing** — tabla Destination / SMS / Call agrupada: United States &
   Canada · Europe (una fila por país) · Everywhere else. Los países con
   canales configurados se resaltan ("Your channels · 2").
5. **History** — libro mayor: fecha, descripción, importe, saldo.

Los miembros (rol MEMBER) ven Status (solo lectura), Pricing y Protections,
pero no saldo ni historial (coherente con "Ver consumo y billing: Member No").

### 3.4 Estados de entrega

Una alerta de pago omitida queda registrada como entrega `FAILED` con motivo
legible ("Skipped: SMS & calls are off", "Skipped: not enough alert credit
(€0,18 needed, €0,05 left)", "Skipped: daily limit of 20 paid alerts reached").
El incidente muestra el evento `NOTIFICATION_FAILED` con ese texto. Las
entregas enviadas muestran su coste (€0,18) en el historial del canal y en la
tabla de entregas del incidente. Un banner global avisa cuando el add‑on está
activo, hay canales telefónicos habilitados y el crédito es cero.

### 3.5 Correos

- "Alert credit is running low" / "Alert credit is exhausted" al owner (una vez
  por ciclo de recarga), con enlace a SMS & calls.

## 4. Modelo de datos (migración `0019_alerts.sql`)

```sql
ALTER TABLE notification_channels ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_deliveries ADD COLUMN cost_cents INTEGER;
ALTER TABLE notification_deliveries ADD COLUMN destination_country TEXT;

CREATE TABLE workspace_alert_settings (
  workspace_id TEXT PRIMARY KEY,
  paid_channels_enabled INTEGER NOT NULL DEFAULT 0,
  daily_paid_alert_limit INTEGER NOT NULL DEFAULT 20,
  default_email_channel_created_at INTEGER,   -- marcador: el canal por defecto ya se creó una vez
  low_balance_notified_at INTEGER,            -- último aviso de saldo; se limpia al recargar
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE alert_credit_balances (
  workspace_id TEXT PRIMARY KEY,
  balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  last_entry_token TEXT,                      -- permite insertar el asiento de forma condicional en el mismo batch
  updated_at INTEGER NOT NULL
);

CREATE TABLE alert_credit_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('TOPUP','GRANT','CHARGE','REFUND','ADJUSTMENT')),
  amount_cents INTEGER NOT NULL,              -- con signo: cargos negativos
  balance_after_cents INTEGER NOT NULL,
  delivery_id TEXT,
  provider_transaction_id TEXT,
  description TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_alert_credit_entries_idempotency ON alert_credit_entries(idempotency_key);
CREATE INDEX idx_alert_credit_entries_ws_time ON alert_credit_entries(workspace_id, created_at DESC, id DESC);
CREATE INDEX idx_alert_credit_entries_delivery ON alert_credit_entries(delivery_id) WHERE delivery_id IS NOT NULL;
```

Cargo atómico (un `batch` D1 = una transacción):

1. `UPDATE alert_credit_balances SET balance_cents = balance_cents - ?, last_entry_token = ?, updated_at = ? WHERE workspace_id = ? AND balance_cents >= ?`
2. `INSERT INTO alert_credit_entries (…) SELECT … FROM alert_credit_balances WHERE workspace_id = ? AND last_entry_token = ?` — solo inserta si el UPDATE anterior se aplicó.

Si el asiento no existe tras el batch, no había saldo. Las recargas usan el
mismo patrón con `INSERT OR IGNORE` previo de la fila de saldo. La clave de
idempotencia es `charge:<deliveryId>`, `refund:<deliveryId>`,
`paddle_txn:<transactionId>`; un duplicado hace fallar el INSERT y el batch se
revierte entero.

## 5. Precios (`domain/alerts/pricing.ts`)

- Detección de país a partir de E.164 por prefijo más largo; el plan NANP
  (`+1`) se considera USA/Canadá salvo los códigos de área caribeños, que van a
  "resto del mundo".
- Tabla con el coste base Twilio (USD) por país y canal, fecha de captura
  (2026-08-21, páginas públicas de precios de Twilio, tarifa "International /
  Mobile numbers" para SMS y tarifa móvil con origen US/CA para voz) y los
  precios finales en céntimos de euro calculados con la fórmula de §2.3.
- Resultado de ejemplo: SMS USA/CA €0,05 · España €0,18 · Alemania €0,23 ·
  Francia €0,16 · Reino Unido €0,12 · Países Bajos €0,23. Llamadas: USA/CA y
  la mayoría de Europa €0,20; Polonia €0,45; Países Bajos €0,56; Grecia €1,00;
  Eslovenia €1,33 (origen USA no‑EEE). Resto del mundo €0,40 / €0,80.
- Nota operativa: un número de voz europeo (p. ej. español) reduciría 5–10× el
  coste de llamadas a NL/PL/GR/Bálticos (tarifas "From EEA"). Queda documentado
  como optimización futura en `docs/alerts-paid-channels.md`.

## 6. Backend

### 6.1 Módulos nuevos

- `domain/alerts/{types,repo,pricing,sms}.ts` — tipos, puertos, tarifas,
  recorte de SMS a un segmento.
- `infrastructure/db/alert_repo.ts` — `D1AlertRepo` (settings + crédito +
  backfill de workspaces sin canales).
- `application/alerts/`
  - `get_alerts_overview.ts` — settings, estado, crédito (según rol), precios,
    disponibilidad de recarga.
  - `update_alert_settings.ts` — on/off + tope diario, auditoría.
  - `quote_alert_price.ts` — precio para un número.
  - `list_credit_entries.ts` — historial paginado.
  - `start_credit_topup.ts` — valida Paddle y devuelve los datos del checkout.
  - `charge_paid_delivery.ts` — `charge()` / `refund()` idempotentes, tope
    diario, aviso de saldo bajo.
  - `ensure_default_email_channel.ts` — crea el canal email por defecto una
    vez por workspace; lo usan `CreateWorkspace` y el cron horario (backfill).
- `http/routes/alerts.ts` + `http/presenters/alerts.ts`.

### 6.2 Cambios

- `CreateChannel`/`UpdateChannel`: los tipos de pago exigen el add‑on activo;
  nuevo campo `isDefault`. `ChannelOutput` añade `isDefault`, `price` y
  `paused`.
- `SendQueuedNotification` y `TestChannel`: cobran antes de enviar, guardan
  `costCents`/`destinationCountry` en la entrega y reembolsan si el proveedor
  falla definitivamente. El cargo es idempotente por entrega, así los reintentos
  de cola no cobran dos veces.
- `HandlePaddleWebhook`: procesa `transaction.completed` con
  `custom_data.purpose = "alert_credit"` y el precio configurado
  (`PADDLE_ALERT_CREDIT_PRICE_ID`, opcional), acreditando `packs × €10`.
- `infrastructure/notify`: SMS recortado a un segmento sin URL; llamadas con
  `TimeLimit=55` y mensaje leído dos veces.
- `templates.ts`: enlace de las notificaciones de prueba a `/alerts`.
- `CreateWorkspace`: crea el canal email por defecto y la fila de settings.
- Hourly cron: backfill de canal por defecto para workspaces existentes sin
  canales (una sola vez, marcador en settings).
- Config: `PADDLE_ALERT_CREDIT_PRICE_ID` (opcional; si Paddle está activo y
  falta, las recargas se declaran no disponibles y se registra un log).
- Seed local/staging: settings activos, €5,00 de crédito de demo, canal email
  por defecto, costes en entregas SMS.

### 6.3 API

| Método | Ruta | Permiso | Notas |
|---|---|---|---|
| GET | `/api/workspaces/:id/alerts` | miembro | `credit` y `topUp` solo con `billing.view` |
| PATCH | `/api/workspaces/:id/alerts/settings` | `channels.manage` | `{ paidChannelsEnabled?, dailyPaidAlertLimit? }` |
| GET | `/api/workspaces/:id/alerts/quote?phoneNumber=` | miembro | `{ destination, smsCents, callCents }` |
| GET | `/api/workspaces/:id/alerts/credit/entries` | `billing.view` | paginado por cursor |
| POST | `/api/workspaces/:id/alerts/credit/topups` | `billing.manage` | `{ packs }` → datos del checkout; 503 sin Paddle |
| PATCH | `/api/workspaces/:id/channels/:channelId` | `channels.manage` | acepta `isDefault` |
| POST | `/api/webhooks/paddle` | público firmado | `transaction.completed` |

## 7. Frontend

- `Sidebar`: "Alerts" → `alerts`. `App.tsx`: rutas `alerts`, `alerts/sms-calls`
  y redirección `notifications → alerts`.
- `pages/alerts/AlertsTabs.tsx` (cabecera + pestañas), `pages/alerts/
  PaidAlertsPage.tsx` (SMS & calls), `api/alerts.ts`, tipos nuevos.
- `ChannelsPage`, `ChannelFormModal`, `ChannelPicker`, `DeliveriesDrawer`,
  `IncidentDetailPage`, `TestFormPage`, `MonitorFormPage`, `AppLayout` (banner),
  `BillingPage` (tarjeta resumen de crédito con enlace), `lib/paddle.ts`
  (checkout con cantidad y `custom_data`).
- Tests unitarios de las funciones puras (presentación de precios, estados de
  pausa, defaults, validación del formulario) siguiendo el patrón existente.

## 8. Pruebas

- Unit: pricing (detección de país, fórmula, segmentos SMS), charger (cobro
  idempotente, tope diario, reembolso, aviso saldo bajo), webhook top‑up,
  settings, default email channel, sender Twilio (`TimeLimit`, cuerpo SMS).
- Integration (`*.itest.ts`): repo D1 (cargo atómico, idempotencia), rutas
  alerts (RBAC, quote, settings, top‑up sin Paddle → 503), canales (gating de
  tipos de pago, `isDefault`), workspace (canal por defecto al crear), matriz
  RBAC ampliada.
- Frontend: `pnpm test` + `typecheck` + `build`.

## 9. Fuera de alcance (seguimientos sugeridos)

- Enlaces de crédito complementario (como los de suscripción) para regalar
  crédito a early adopters durante el lanzamiento gratuito.
- Número de voz europeo para abaratar llamadas intra‑UE.
- Verificación del número por código (OTP) además del consentimiento.
- Precio público de SMS/llamadas en la web de marketing (solo se ajusta el
  texto "all included").
