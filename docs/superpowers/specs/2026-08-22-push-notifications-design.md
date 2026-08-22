# Zenguy — Push notifications por defecto (diseño)

Fecha: 2026-08-22 · Estado: aprobado por Marcos; API + web en esta sesión, app
iOS en la sesión móvil (`apps/app`).

## 1. Objetivo

Con la app iOS recién construida, las alertas deben llegar también por push,
gratis y por defecto, igual que el email. Nadie debería tener que editar sus
tests o monitores para empezar a recibirlas.

## 2. Decisiones

1. **Dispositivos por usuario.** La app registra su Expo push token en
   `user_push_devices` (un token = un dispositivo; reasignable al usuario que
   inicia sesión). Un interruptor por dispositivo permite pausarlo.
2. **Canal `PUSH` ("Mobile push")**, tipo gratuito, a **todos los miembros del
   workspace** con la app y permiso concedido. Configuración fija
   `{ recipients: "WORKSPACE_MEMBERS" }`; como máximo un canal push por
   workspace.
3. **Creación perezosa y por defecto.** El canal se crea la primera vez que un
   miembro del workspace registra un dispositivo (inmediato al registrar; el
   cron horario cubre altas posteriores de miembros). Se marca `isDefault` y se
   **adjunta a todos los tests y monitores existentes** del workspace, una
   sola vez. Marcador `workspace_alert_settings.default_push_channel_created_at`
   evita recrearlo si se borra.
4. **Envío con Expo Push Service** (`https://exp.host/--/api/v2/push/send`,
   lotes de 100, sin coste, sin certificados en Zenguy): título y primera
   línea del mensaje actual, `data.url` con deep link `zenguy://…` al
   incidente, sonido por defecto, prioridad alta. Los tokens que Expo devuelve
   como `DeviceNotRegistered` se desactivan automáticamente. Variable opcional
   `EXPO_PUSH_ACCESS_TOKEN` (seguridad reforzada de Expo).
5. **Sin dispositivos = entrega fallida legible** ("No mobile devices are
   registered") — solo puede ocurrir si todos cierran sesión después de que el
   canal exista.

## 3. API

| Método | Ruta | Notas |
|---|---|---|
| GET | `/api/me/push-devices` | dispositivos del usuario |
| PUT | `/api/me/push-devices` `{ token, platform: "ios"\|"android", deviceName?, appVersion? }` | idempotente por token; reasigna al usuario actual; reactiva; crea canales push por defecto en sus workspaces |
| PATCH | `/api/me/push-devices/:id` `{ enabled }` | pausa/reanuda el dispositivo |
| DELETE | `/api/me/push-devices/:id` | al cerrar sesión |

`PushDevice = { id, platform, deviceName, appVersion, enabled, tokenSuffix,
lastSeenAt, createdAt }`. Token válido: `ExponentPushToken[…]` o
`ExpoPushToken[…]`.

Canales: `type: "PUSH"` se añade a `ChannelType`; `configPreview` es
`{ recipients: "WORKSPACE_MEMBERS" }`; `ChannelOutput.reach = { devices,
members } | null` (solo PUSH). `POST /channels` acepta `type: "PUSH"` con esa
config y rechaza un segundo canal push (`VALIDATION_ERROR`, campo `type`).

Payload push: `{ to, title, body, data: { url, workspaceId, incidentId?,
deliveryId, eventType }, sound: "default", priority: "high" }`.

## 4. Datos (`0020_push_devices.sql`)

- `user_push_devices(id, user_id, token UNIQUE, platform, device_name,
  app_version, enabled, disabled_reason, last_seen_at, created_at, updated_at)`.
- `workspace_alert_settings.default_push_channel_created_at`.
- `notification_channels` se recrea para ampliar el `CHECK` de `type` con
  `'PUSH'` (SQLite no permite alterar CHECK); se copian filas e índice.

## 5. Backend

- `domain/push/{types,repo}.ts`, `infrastructure/db/push_device_repo.ts`.
- `application/push/register_push_device.ts`, `list_push_devices.ts`,
  `update_push_device.ts`, `remove_push_device.ts`,
  `ensure_default_push_channel.ts` (+ backfill horario).
- `infrastructure/notify/expo_push.ts` (cliente HTTP con lotes y tickets) y
  `ChannelSender.send` recibe `workspaceId` para resolver los tokens.
- `http/routes/push_devices.ts` bajo `/api/me`.
- Repos de tests y monitores: `addChannelToAll(workspaceId, channelId)`.

## 6. Web

Tipo "Mobile push" en Alerts → Channels: icono de móvil, badge Free, objetivo
"All workspace members with the Zenguy app" y alcance "3 devices · 2
members"; alta manual posible (sin campos) si no existe. Copy de la pestaña
SMS & calls: email, Slack, Discord y push son gratis.

## 7. App iOS (sesión móvil)

- `expo-notifications` + plugin; `projectId` de EAS (prerrequisito: `eas init`
  con la cuenta Expo de Marcos; APNs lo gestiona EAS en el primer build; solo
  iPhone físico).
- Tras iniciar sesión y tener workspace: pantalla suave "Get alerts on this
  iPhone" → permiso del sistema → `PUT /api/me/push-devices`; re-registro en
  cada arranque y al cambiar el token; `DELETE` al cerrar sesión; interruptor
  en Cuenta → Notifications; tocar la notificación abre `data.url`.

## 8. Pruebas

Unit: formato de token, registro idempotente/reasignación, creación perezosa
del canal + adjuntado, sender Expo (lotes, `DeviceNotRegistered`), plantilla
push. Integration: repo D1 (token único, listados por workspace), rutas
`/api/me/push-devices` (RBAC propietario del dispositivo), canal PUSH en rutas
de canales, matriz RBAC, migración (canales existentes intactos).
