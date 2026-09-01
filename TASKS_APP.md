# Tareas pendientes para superar App Review en iOS

Auditoría realizada el **1 de septiembre de 2026** sobre `apps/app`, el estado
remoto de EAS/TestFlight y las reglas vigentes de Apple. El objetivo de esta
lista es preparar la primera publicación pública; no basta con que una build
esté disponible en TestFlight.

Estado actual relevante:

- El código está en la versión `0.2.2`, pero la última build de TestFlight es
  `0.2.1 (4)`. Esa build es válida y está en testing interno, pero no representa
  el código actual ni debe enviarse a App Review.
- App Store Connect todavía no muestra una versión pública.
- `pnpm verify:release-config`, typecheck, lint, 262 tests y el bundle iOS pasan.
- `expo-doctor` pasa 19 de 21 controles, por lo que la release todavía no está
  verde.

## P0 — bloqueos confirmados

- [ ] **Convertir iOS en una app complementaria solo para cuentas ya
  existentes (regla 3.1.3(f)).**

  Decisión cerrada de producto: la app iOS no permitirá registrarse, crear una
  cuenta o un workspace, activar o reactivar una suscripción ni gestionar
  pagos. Solo permitirá iniciar sesión a personas cuya cuenta y acceso ya
  existan. La venta y el alta pueden seguir existiendo en la web, pero no deben
  formar parte del binario ni del recorrido de iOS.

  Retirar o bloquear en iOS:

  - la pantalla `apps/app/app/(auth)/sign-up.tsx`, su entrada en el stack y el
    enlace **Sign up** del login;
  - cualquier llamada, componente, texto o prueba de registro que quede
    exclusivamente en el cliente móvil;
  - la salida hacia registro desde `apps/app/app/invitations/accept.tsx`: una
    invitación solo podrá aceptarse tras iniciar sesión con una cuenta ya
    existente;
  - `apps/app/app/onboarding/workspace.tsx`, el botón **Create workspace** y las
    redirecciones automáticas desde `WorkspaceContext` e `index.tsx`;
  - `apps/app/app/w/[wsId]/setup/billing.tsx`, **Set up subscription**, precios
    y las instrucciones o enlaces para comprar, pagar, cancelar o gestionar
    Stripe en `app.zenguy.com`;
  - rutas profundas, notificaciones o estados de error que puedan reabrir una
    pantalla de registro, creación de workspace o compra aunque el enlace
    visible se haya eliminado.

  Una cuenta existente sin workspace, acceso o suscripción válida debe ver un
  estado neutral que explique que no tiene acceso y permita cerrar sesión o
  contactar con su organización; no debe mostrar precios, una URL, un enlace ni
  instrucciones para adquirirlo. `Plan & Usage` solo puede conservarse como
  información de solo lectura si no contiene llamadas a comprar o gestionar el
  pago fuera de la app.

  No borrar por accidente el alta web ni sus endpoints compartidos: el alcance
  de esta tarea es que el cliente iOS no exponga ni invoque esos flujos.

  Criterio de cierre: en una instalación limpia, antes de autenticar, solo se
  ofrecen login, contraseña olvidada y páginas legales; no hay enlace ni ruta
  funcional de registro, creación de workspace o billing; una cuenta activa
  puede usar la app y una cuenta sin acceso queda en el estado neutral.
  Descripción, screenshots y Review Notes indican que Zenguy para iOS es una
  app complementaria gratuita que requiere una cuenta preexistente y que no
  permite compras ni dirige a comprarlas fuera de la app.

- [ ] **Añadir eliminación completa de la cuenta dentro de la app
  (regla 5.1.1(v)).**

  Ahora solo se puede cerrar sesión o eliminar un workspace. Implementar una
  acción fácil de encontrar en `Account` que permita iniciar y confirmar el
  borrado de la cuenta completa sin escribir a soporte.

  Debe incluir endpoint autenticado, reautenticación/confirmación, revocación de
  sesiones y push tokens, tratamiento de invitaciones y membresías, y una
  decisión explícita para workspaces y suscripciones que el usuario posea
  (transferir o eliminar/cancelar). Borrar o anonimizar los datos asociados
  salvo los registros fiscales, antifraude o de seguridad que deban conservarse,
  explicando plazo y motivo. Añadir pruebas de API y UI, incluido un usuario con
  varios workspaces y un usuario que no sea owner.

- [ ] **Obtener permiso explícito antes de compartir datos con IA de terceros,
  o eliminar ese intercambio.**

  El runner primario usa un modelo local, pero el fallback puede enviar a
  OpenAI instrucciones y estado de las páginas. La aceptación genérica de la
  política al registrarse en la web no demuestra el permiso explícito que exige
  la regla 5.1.2(i).

  Antes de la primera ejecución que pueda usar el fallback, explicar en una
  pantalla propia qué proveedor recibe qué categorías de datos y con qué fin;
  usar una acción afirmativa no premarcada; guardar versión, fecha y actor en el
  servidor; exigirla también a cuentas existentes; y ofrecer retirada del
  permiso. El backend debe impedir el envío cuando no exista permiso, no solo
  la UI. La alternativa más simple es desactivar el fallback remoto y garantizar
  que producción nunca envía el contenido a una IA externa. Mantener la promesa
  ya existente de no enviar secretos y cubrir ambos caminos con pruebas.

- [ ] **Alinear política, App Privacy y privacy manifest con el flujo real de
  datos.**

  El README propone declarar solo nombre, email y diagnósticos, pero la app
  también registra aperturas y visitas a pantallas/recursos, identificadores de
  cuenta/workspace, push token y modelo de dispositivo, configuración de tests,
  URLs, instrucciones, capturas/evidencias, destinos de notificación y datos de
  suscripción. Hacer un inventario único de dato, finalidad, vinculación con la
  identidad, retención y terceros.

  Con ese inventario:

  - completar y publicar las respuestas de **App Privacy** en App Store Connect;
  - revisar al menos Contact Info, Identifiers, User Content, Usage Data,
    Purchases y Diagnostics, marcando solo lo que realmente corresponda;
  - usar `https://zenguy.com/privacy/` como URL canónica y añadir una URL pública
    de opciones de privacidad/borrado;
  - convertir “the full policy is at zenguy.com/privacy” dentro de la app en un
    enlace pulsable o mostrar la política completa, incluyendo retención,
    borrado, retirada de consentimiento y el detalle de OpenAI;
  - archivar la build final con Xcode 26, generar el Privacy Report y reconciliar
    sus resultados con `PrivacyInfo.xcprivacy` y las respuestas de App Store
    Connect, sin warnings de APIs de razón obligatoria.

- [ ] **Dejar verde y reproducible la herramienta de release.**

  `expo-doctor` detecta 16 dependencias por debajo del patch recomendado de SDK
  57 y rechaza que `eas-cli` esté en las dependencias del proyecto. Además,
  `eas.json` exige exactamente EAS CLI `22.0.0`, mientras que la versión vigente
  auditada es `23.2.0`; los comandos con la CLI actual fallan antes de consultar
  el proyecto.

  Ejecutar `expo install --fix`, revisar el lockfile y las notas de cambio,
  retirar `eas-cli` de `devDependencies` y fijar una versión auditada de EAS CLI
  en CI/operación mediante `pnpm dlx eas-cli@<versión>`, manteniendo
  `eas.json.cli.version` compatible con esa misma versión. Actualizar workflows
  y README. Validar con Node `22.23.2`, no con el Node 26 usado en esta auditoría.

  Criterio de cierre: `pnpm install --frozen-lockfile`, `expo install --check`,
  `expo-doctor`, `verify:release-config`, typecheck, lint, tests y export iOS
  terminan correctamente en CI, sin exclusiones añadidas solo para ocultar los
  dos fallos actuales.

## P1 — candidata y ficha de App Store

- [ ] **Crear una candidata nueva desde un commit limpio posterior a todos los
  P0.**

  Incrementar deliberadamente la versión pública, mantener el build number
  remoto por encima de `4`, construir con el perfil `production`, Xcode 26 y
  credenciales congeladas, y enviar a TestFlight. Confirmar que el runtime real
  usa el fingerprint actual. No publicar una OTA desde un worktree sucio: el
  canal `production` todavía conserva como última OTA una actualización antigua
  del runtime `0.2.0` marcada como dirty.

  Criterio de cierre: EAS Build y EAS Submission están en estado terminal
  satisfactorio; Apple muestra el binario como `VALID` y `IN_BETA_TESTING`; la
  versión, build, commit, fingerprint y API `https://api.zenguy.com` coinciden.

- [ ] **Preparar una cuenta estable y completa para App Review.**

  Crear previamente en producción una cuenta exclusiva de revisión, verificada,
  sin 2FA ni caducidad durante el review, con un workspace y acceso activos sin
  depender de un checkout durante la revisión, y con datos ficticios útiles:
  overview, test y ejecución con evidencia, monitor, incidente, canal y
  miembros. No reutilizar datos personales ni secretos reales. Guardar usuario
  y contraseña únicamente en App Store Connect.

  Probar que dos sesiones de revisión no invalidan la cuenta y mantener el
  backend, runner y recursos de ejemplo disponibles durante todo el proceso.

- [ ] **Ejecutar un smoke test de la build exacta de TestFlight en un iPhone
  físico.**

  Cubrir instalación limpia, login, las cuatro áreas principales y More,
  refresco de sesión, cierre de sesión, foreground/background, bloqueo
  biométrico, permiso y recepción de push, universal links de verificación,
  reset, invitación y navegación desde push, un test seguro contra un dominio
  controlado, arranque en frío con EAS Update y redes lenta/sin conexión. Probar
  también el borrado de una cuenta desechable. Registrar modelo, iOS, versión y
  build probados.

- [ ] **Crear la ficha comercial completa en App Store Connect.**

  Verificar o completar nombre, subtítulo, descripción, keywords, categoría,
  copyright, URL canónica de privacidad, URL de soporte, precio `Free`, regiones
  y método de publicación manual. Crear `https://zenguy.com/support/` con ayuda,
  contacto funcional e instrucciones de cuenta/borrado; una home genérica o un
  `mailto:` no son una buena URL de soporte. La descripción debe indicar con
  claridad que la app requiere una cuenta Zenguy preexistente, sin convertirlo
  en una llamada a registrarse o comprar en la web.

  Responder el cuestionario de edad actualizado en 2026 de acuerdo con el
  contenido real, incluido que los tests pueden mostrar contenido de sitios
  configurados por el cliente. Revisar derechos sobre icono, fuentes y material
  mostrado.

- [ ] **Producir y subir screenshots de App Store con datos ficticios.**

  Subir entre 1 y 10 capturas válidas de iPhone, usando el tamaño de mayor
  resolución requerido por App Store Connect para que Apple escale el resto.
  Mostrar la app en uso —por ejemplo overview, tests/evidencia, uptime e
  incidentes— y no solo login o splash. No incluir nombres, emails, URLs o
  secretos reales, ni precios o instrucciones de compra. No hacen falta
  capturas de iPad mientras `supportsTablet` siga en `false`.

- [ ] **Redactar un paquete de App Review que elimine ambigüedades.**

  Incluir contacto accesible, credenciales demo, pasos cortos para revisar cada
  función y explicar expresamente el encaje en 3.1.3(f): es una app
  complementaria gratuita para usuarios con una cuenta ya existente, y no
  permite crear cuentas, comprar ni muestra llamadas a comprar fuera de iOS.
  Añadir la explicación del procesamiento con IA y su consentimiento, de que
  los tests se ejecutan en un navegador remoto contra sistemas autorizados, y
  de que push, Face ID y enlaces universales son opcionales. Explicar cualquier
  función difícil de provocar y adjuntar un vídeo corto si el runner o una
  notificación dependen de tiempo externo.

- [ ] **Revalidar los controles remotos justo antes del envío.**

  Confirmar en el equipo `HT84Q65URB` que siguen activos los acuerdos de Apple y
  el estado de trader DSA, que no hay contratos o información fiscal pendientes,
  y que EAS conserva certificado de distribución, provisioning profile, APNs
  key y App Store Connect API key válidos. Verificar que el grupo interno usa
  solo la autodistribución de Apple y que no se ha añadido también `groups` a
  `eas.json`.

- [ ] **Seleccionar la candidata correcta y enviarla a revisión.**

  Asociar la build validada, confirmar export compliance, privacidad, edad,
  disponibilidad y release manual; después usar “Add for Review” y “Submit for
  Review”. No enviar la build actual `0.2.1 (4)`. Monitorizar App Store Connect y
  responder a App Review hasta llegar a un estado terminal.

## P2 — después de la aprobación

- [ ] **Publicar manualmente y configurar el enlace definitivo de App Store.**

  Cuando exista la URL pública, guardar `IOS_APP_STORE_URL` en producción,
  comprobar `GET /api/app/version` y probar el flujo “Update required”. No subir
  `MIN_APP_VERSION` antes de que ese enlace funcione y la nueva versión esté
  disponible en los storefronts elegidos.

- [ ] **Cerrar la release con observabilidad y soporte.**

  Vigilar crashes, login, runner, API, notificaciones y mensajes de review las
  primeras 48 horas; conservar IDs/URLs de build y submission; documentar la
  versión publicada, el responsable de credenciales y las próximas fechas de
  renovación.

## Ya comprobado — no repetir salvo que cambie la configuración

- Bundle ID `com.zenguy.app`, Team ID, EAS project ID y `ascAppId` coinciden.
- El perfil production usa HTTPS, canal `production`, auto-increment y una
  imagen de Xcode 26.6, que supera el requisito de SDK vigente desde abril de
  2026.
- El icono es PNG RGB de 1024 × 1024 sin canal alfa.
- El AASA responde `200`, sin redirección, como `application/json` y contiene
  `HT84Q65URB.com.zenguy.app` con las rutas esperadas.
- Las URLs canónicas `https://zenguy.com/privacy/` y
  `https://zenguy.com/terms/` responden `200` por HTTPS.
- No hace falta Sign in with Apple mientras la app use únicamente el sistema
  propio de email y contraseña. Reevaluar si se añade Google u otro login
  social.
- No hace falta crear otra ficha de App Store ni otro certificado solo para
  corregir estos puntos; las submissions existentes demuestran que la cadena de
  firma y subida funciona.

## Referencias de Apple

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/)
- [Upload app previews and screenshots](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots)
- [Upcoming requirements](https://developer.apple.com/news/upcoming-requirements/)
