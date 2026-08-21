# Zenguy Mobile — Diseño de la app iOS (Expo) en `apps/app`

**Fecha:** 2026-08-21
**Estado:** decisiones tomadas de forma autónoma por encargo del usuario ("toma tú el resto de decisiones"); implementación en `main`
**Alcance:** app nativa iOS (Expo SDK 57 + expo-router) con paridad funcional con `apps/frontend`, seguridad como prioridad

---

## 1. Objetivo

Muchos usuarios prefieren operar Zenguy desde el móvil. La app ofrece, en iOS, todo lo que hoy
hace la aplicación web (`apps/frontend`): autenticación, onboarding, overview, browser tests y
runs con evidencia, uptime, incidentes, canales de notificación, secretos, miembros, plan y uso,
ajustes del workspace y páginas legales — sobre la misma API (`apps/api`) y con el mismo modelo
de permisos por rol.

### No-goals de V1

- Android (solo iOS; la base Expo lo permite más adelante).
- Notificaciones push (no existe infraestructura de dispositivos en el API; V2).
- Checkout de Paddle dentro de la app (el lanzamiento es gratuito; además las reglas de App
  Store prohíben cobrar suscripciones digitales fuera de IAP). La app muestra plan y uso; la
  gestión de pago, cuando exista, se hace desde la web.
- Universal links (`https://app.zenguy.com/...`) abriendo la app: requiere publicar un fichero
  AASA en `app.zenguy.com`; queda documentado, no configurado. El esquema `zenguy://` sí funciona.
- Detección de jailbreak, certificate pinning (frágil tras Cloudflare; documentado).
- Live view SSE: se sustituye por polling autenticado del run mientras está activo.

## 2. Decisiones

| Decisión | Elección | Motivo |
| --- | --- | --- |
| Framework | Expo SDK 57, React Native 0.86, React 19.2, TypeScript strict | Última versión estable; `expo-router` da navegación por ficheros con URLs iguales a la web |
| Ubicación | `apps/app` como proyecto pnpm **independiente** (excluido del workspace, `node-linker=hoisted`, lockfile propio) | Metro/RN funcionan mejor con `node_modules` hoisted; no altera el lockfile ni `node_modules` del monorepo que usan otras sesiones y CI |
| Navegación | Tabs: Overview · Tests · Uptime · Incidents · More; stack por tab con cabeceras nativas | Patrón iOS estándar; "More" agrupa Notifications, Secrets, Members, Plan & Usage, Settings, Account |
| Estado remoto | `@tanstack/react-query` con las mismas query keys que la web | Reutiliza la lógica de invalidación ya validada |
| Formularios | `react-hook-form` + `zod` (mismos esquemas que la web) | Misma validación cliente |
| Estilos | `StyleSheet` + tokens de tema (sin NativeWind) | Cero dependencias nativas extra; fuente del sistema (SF) |
| Iconos | `@expo/vector-icons` (Feather/Ionicons) | Sin `react-native-svg`; aspecto cercano a lucide |
| Imágenes | `expo-image` | Caché y descodificación eficientes para screenshots firmados |
| Sesión | Access token solo en memoria; refresh token en Keychain (`expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`) | Nada sensible en disco plano; no migra a otros dispositivos ni a backups |
| Auth API | Modo "cliente nativo" opt-in (`X-Zenguy-Client: native`) en `/api/auth/*` | Evita depender del cookie jar de iOS; el flujo web con cookie HttpOnly no cambia |
| Bloqueo de app | Face ID / Touch ID / código opcional al volver a primer plano | Protección extra en dispositivo compartido |
| Pantalla de privacidad | Overlay al pasar a segundo plano | El conmutador de apps no muestra datos del workspace |
| Tests | `jest-expo` + `@testing-library/react-native` | Lógica pura y cliente API con cobertura; pantallas clave con pruebas de render |
| Release | `eas.json` (development / preview / production) | TestFlight cuando el usuario decida; no se ejecuta EAS en esta entrega |

## 3. Arquitectura

```
apps/app/
├── app/                      # rutas expo-router (ver §6)
├── src/
│   ├── api/                  # clientes por recurso + types (portados de apps/frontend/src/api)
│   ├── lib/                  # api.ts (fetch+bearer+refresh), auth-token, secure-storage, config,
│   │                         # errors, format, permissions, links
│   ├── contexts/             # AuthContext, WorkspaceContext, ToastContext, AppLockContext
│   ├── components/           # componentes de dominio (StatusBadge, UsageMeter, RunStatusPanel…)
│   ├── ui/                   # kit de primitivas (Screen, Card, Button, Input, Field, Badge…)
│   ├── theme/                # tokens: colores, espaciado, tipografía, radios
│   └── hooks/
├── assets/                   # icono, splash
├── app.config.ts, eas.json, babel.config.js, metro.config.js, jest.config.js, tsconfig.json
└── README.md
```

- **Origen del API:** `EXPO_PUBLIC_API_ORIGIN` (inyectado en build). Por defecto:
  desarrollo → `http://127.0.0.1:8787` (Wrangler local); `preview` → `https://api-staging.zenguy.com`;
  `production` → `https://api.zenguy.com`. En builds no-dev la app rechaza orígenes que no sean
  `https:`.
- La app **no contiene secretos**: solo el origen del API.
- Integración en el monorepo: `pnpm-workspace.yaml` excluye `apps/app`; el `package.json` raíz
  añade scripts `app:*` que delegan en `apps/app`.

## 4. Seguridad (prioridad)

Modelo de amenaza: dispositivo perdido/robado o compartido, backups, red hostil, enlaces
maliciosos, fugas por capturas del sistema.

1. **Transporte.** Solo HTTPS en builds no-dev (ATS por defecto, `NSAllowsArbitraryLoads=false`;
   `NSAllowsLocalNetworking` solo para Wrangler local en desarrollo).
2. **Credenciales.** Access token (JWT 30 min) solo en memoria. Refresh token (30 días, rotado en
   cada uso, con detección de reutilización en el servidor) en Keychain con
   `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. La caché de react-query vive solo en memoria; no se persiste
   nada del workspace en disco. El único dato no sensible persistido (último workspace, ajustes
   de bloqueo) también va a SecureStore.
3. **Ciclo de sesión.** Al arrancar: leer refresh → `POST /api/auth/refresh` → nuevo par. 401 en
   cualquier petición → un único refresh y reintento; si el refresh falla → borrar Keychain y
   volver a sign-in. Sign-out → `POST /api/auth/logout` con el refresh token (revocación
   servidor) y borrado local aunque la red falle.
4. **Bloqueo de app (opcional).** `expo-local-authentication`: al volver a primer plano tras
   un umbral configurable (inmediato / 1 min / 5 min) se exige Face ID / Touch ID / código.
   Hasta autenticar, el contenido queda cubierto. Ajuste en *Account*.
5. **Pantalla de privacidad.** Overlay opaco mientras `AppState` no sea `active`.
6. **Deep links.** Solo se aceptan los parámetros esperados (`token`), validados contra
   `^[A-Za-z0-9_-]{1,512}$`; nunca se navega a URLs externas tomadas de un enlace.
7. **Entradas.** Validación zod idéntica a la web; campos de contraseña con `secureTextEntry`,
   `textContentType` para gestores de contraseñas; `autoCorrect` desactivado en credenciales.
8. **Sin terceros.** Ningún SDK de analítica/crash reporting ni Paddle en la app.
9. **Logs.** No se registran tokens ni cuerpos de petición; `console.*` se elimina en producción
   (`babel-plugin-transform-remove-console`).
10. **Evidencia.** Screenshots vía URLs firmadas del API (TTL 10 min), igual que la web; se
    renderizan con `expo-image` con caché en memoria/disco del sistema (dato ya expirable).
11. **Cumplimiento App Store.** `ITSAppUsesNonExemptEncryption=false` (solo TLS estándar),
    textos de uso de Face ID, política de privacidad enlazada.

## 5. Cambio en `apps/api`: modo cliente nativo

Solo `src/http/routes/auth.ts` (+ `auth_routes.itest.ts`). Sin migraciones ni cambios en `app.ts`.

- Detección: cabecera `X-Zenguy-Client: native` (exacta, case-insensitive en el nombre).
  Un navegador de otro origen no puede enviarla: no está en `allowHeaders` del CORS, así que el
  preflight la bloquea. El SPA propio no la usa.
- `POST /api/auth/login` (nativo): respuesta `{ data: { user, accessToken, expiresIn,
  refreshToken, refreshExpiresIn } }` y **sin** `Set-Cookie`.
- `POST /api/auth/refresh` (nativo): body JSON `{ refreshToken }` (validado: string 1–512).
  Misma rotación/revocación que la cookie; respuesta como en login; sin `Set-Cookie` ni en
  éxito ni en error.
- `POST /api/auth/logout` (nativo): body JSON opcional `{ refreshToken }`; revoca y responde 204
  sin `Set-Cookie`.
- Flujo con cookie: byte a byte igual que hoy (los tests existentes siguen pasando).

## 6. Navegación y pantallas

Rutas (`app/`), con URL idéntica a la web para que `zenguy://` y futuros universal links
apunten al mismo sitio:

| Ruta | Pantalla | Comportamiento (espejo de la web) |
| --- | --- | --- |
| `/` | RootResolver | signedOut → sign-in; sin workspaces → onboarding; si no, último workspace (SecureStore) |
| `/(auth)/sign-in` | Sign in | email+password; errores `INVALID_CREDENTIALS`/`RATE_LIMITED` inline |
| `/(auth)/sign-up` | Sign up | name/email/password/confirm; → check-email |
| `/(auth)/check-email` | Check inbox | reenvío con cuenta atrás |
| `/(auth)/forgot-password`, `/(auth)/reset-password` | Recuperación | token por deep link o pegado manual |
| `/verify-email` | Verificación | token por deep link; si falta, formulario de reenvío |
| `/verify-pending` | Pendiente de verificar | poll `/me` cada 10 s; reenviar; sign out |
| `/invitations/[token]` | Invitación | público: muestra; si no hay sesión → sign-in con `next`; acepta y entra al workspace |
| `/grants/[token]`, `/complimentary` | Acceso complimentary | solo emisores (`canIssueComplimentaryGrants`) |
| `/privacy`, `/terms` | Legal | contenido estático portado |
| `/onboarding/workspace` | Crear workspace | nombre + timezone (buscador) |
| `/w/[wsId]/setup/billing` | Activación | modo free: activa y entra; modo paddle: "gestiona desde la web" |
| `/w/[wsId]/overview` | Overview | uso, tests, uptime, actividad (refetch 30 s) |
| `/w/[wsId]/tests`, `/tests/new`, `/tests/[id]`, `/tests/[id]/edit` | Browser tests | lista+acciones, formulario con "Test it" (validate draft + RunStatusPanel), detalle con runs paginados y filtro |
| `/w/[wsId]/runs/[runId]` | Run | progreso en vivo (polling 2 s), detalles, intents con steps/screenshots (visor), consola/red/URLs, informe (share sheet) |
| `/w/[wsId]/uptime`, `/uptime/new`, `/uptime/[id]`, `/uptime/[id]/edit` | Uptime | lista, formulario completo (headers, body, condiciones, test request), detalle con stats, gráfica 24 h, checks, incidentes |
| `/w/[wsId]/incidents`, `/incidents/[id]` | Incidentes | filtros estado/tipo, detalle con timeline y entregas |
| `/w/[wsId]/more` | Más | menú: Notifications, Secrets, Members, Plan & Usage, Workspace Settings, Account; cambio de workspace |
| `/w/[wsId]/notifications` | Canales | tarjetas, crear/editar (EMAIL/SMS/WHATSAPP/CALL/SLACK/DISCORD), test, activar/desactivar, entregas |
| `/w/[wsId]/secrets` | Secretos | lista (nunca valor), crear, reemplazar valor, editar dominios, borrar |
| `/w/[wsId]/members` | Miembros | lista, invitar, cambiar rol, quitar, invitaciones pendientes/revocar |
| `/w/[wsId]/billing` | Plan & Usage | plan (free/complimentary/paddle), uso, facturas si existen; sin acciones de pago |
| `/w/[wsId]/settings` | Ajustes | general (nombre, timezone), audit log paginado, danger zone (transferir, borrar con confirmación por nombre) |
| `/w/[wsId]/account` | Cuenta | usuario, bloqueo de app, sign out, legal |

Permisos: `can(role, action)` portado tal cual; cada acción/botón se oculta o deshabilita igual
que en la web. Errores 403/402 → toast y, en 402, redirección a `setup/billing`.

## 7. Capa de datos

- `src/lib/api.ts`: `fetch` con `Authorization: Bearer`, cabecera nativa, manejo de
  `{ data, nextCursor }` y `{ error }`, un solo refresh concurrente, reintento tras 401,
  `apiGetText` para informes/exports (texto) y `apiPostText` para import.
- Descargas: informe Markdown y export YAML/JSON se escriben en el directorio caché
  (`expo-file-system`) y se entregan con `expo-sharing`; import vía `expo-document-picker`.
- Run en vivo: `refetchInterval` 2 s mientras `QUEUED/RUNNING` (sin SSE).
- Timezone del workspace para fechas (`Intl` con Hermes).

## 8. UI y diseño

Tokens iguales a la web (zinc + índigo `#4f46e5`; ok/danger/warn/info solo para estado).
Fuente del sistema. Listas con separadores, tarjetas con borde `zinc-200`, controles de 44 pt,
safe areas, `KeyboardAvoidingView` en formularios, pull-to-refresh en listas, estados
vacíos/error/cargando equivalentes a la web, `ActionSheet` nativo para menús "…" y confirmaciones
con `Alert` nativo (destructivas en rojo).

## 9. Verificación

- `pnpm typecheck`, `pnpm test` (jest) y `pnpm lint` (expo lint) en `apps/app`.
- API: typecheck + unit + integration con los tests nuevos de modo nativo.
- Build nativa: `expo prebuild` + compilación para simulador iPhone; smoke con el API local
  (`wrangler dev` + seed): sign-in, overview, tests, run, uptime, incidentes, more.

## 10. Release (guía, no ejecutado)

`eas.json` con perfiles; pasos en `apps/app/README.md`: `eas build -p ios --profile preview`,
TestFlight, App Review (privacy policy URL, Face ID usage string). Bundle id `com.zenguy.app`.

## 11. Riesgos y pendientes

- Un peer está construyendo "Alerts" (canales/email por defecto) en paralelo; la app porta el
  contrato actual de `main` y deberá actualizarse cuando ese contrato se estabilice.
- Universal links y push requieren trabajo en servidor/infra (AASA, tabla de dispositivos).
