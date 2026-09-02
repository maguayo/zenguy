# Tareas pendientes para superar App Review en iOS

Auditoría realizada el **1 de septiembre de 2026** sobre `apps/app`, el estado
remoto de EAS/TestFlight y las reglas vigentes de Apple. El objetivo de esta
lista es preparar la primera publicación pública; no basta con que una build
esté disponible en TestFlight.

Estado actual relevante:

- La implementación de fuente está en `0.2.2` y ha superado la validación local.
  Ese commit de preparación no es por sí mismo una candidata publicable: el
  proceso exige primero un despliegue de producción verde y después una build
  EAS nueva, firmada y vinculada al mismo commit.
- La última build EAS iOS, verificada de nuevo el 1 de septiembre de 2026, es
  `0.2.1 (4)` (`24b874a6-b9ef-4590-a0dd-3067c157451c`). Finalizó correctamente,
  y su submission `5b7eade9-da52-4085-aace-f6a44b2d598b` permanece `VALID` e
  `IN_BETA_TESTING` según EAS; App Store Connect la muestra como **Ready to
  Submit** en TestFlight. No representa este código y **no debe enviarse** a App
  Review.
- App Store Connect se auditó con una sesión autenticada. La versión pública
  sigue siendo `0.2.0`, build `3`, con estado **Rejected**. La submission
  `cb0ae8b7-769b-485a-93a6-1e9846e6c298` fue rechazada por **Guideline 2.1 —
  Information Needed / App Completeness**. Apple pide un vídeo en dispositivo
  físico y respuestas explícitas sobre dispositivos/OS, función y audiencia,
  acceso demo, servicios externos, regiones y regulación/derechos. No se ha
  guardado ningún cambio, respondido a Apple ni enviado otra build.
- La build Release de producción se ha compilado con Xcode 26.6, instalado de
  cero y abierto correctamente en un iPhone 17 Pro Max simulado con iOS 26.5.
  Antes de autenticar solo muestra login de cuenta existente y contraseña
  olvidada; no hay registro, alta de workspace ni compra.
- En Node `22.23.2` pasan `verify:release-config`, typecheck, lint, las 59 suites
  móviles (233 pruebas), las 43 pruebas de las herramientas de release, export
  iOS y los 21/21 controles de `expo-doctor`.
  También pasan 164 archivos/1.228 pruebas unitarias y 74/435 de integración
  de API, 13 controles de transporte de secretos, 87/394 de frontend y las 23
  pruebas del website con sus 38 páginas estáticas. La pasada completa del
  monorepo (`pnpm -r typecheck`, `pnpm -r test` y `pnpm -r build`) también está
  verde, incluido admin (21 archivos/109 pruebas) y landing; el único aviso es
  el tamaño de un chunk de admin, sin fallo de compilación.
- El artefacto instalado es `com.zenguy.app` `0.2.2 (1)`, usa
  `https://api.zenguy.com`, APNs de producción y el dominio asociado esperado.
  No registra ningún URL scheme invocable; el esquema interno de Expo solo
  permanece en su manifiesto lógico para que el router pueda arrancar. La
  Release final se recompiló con Xcode 26.6 tras una instalación congelada,
  arrancó de cero en iOS 26.5 y mostró únicamente cuenta existente, login,
  recuperación, Terms y Privacy. El bundle no contiene copy visible de alta,
  workspace, compra, checkout, pricing o billing.
- El mismo código se archivó para dispositivo iOS genérico con Xcode 26.6 y el
  preflight automatizado validó el binario arm64 `0.2.2 (1)`, su identidad,
  runtime/firma OTA, ausencia de URL schemes, las 11 categorías de datos y 12
  privacy manifests. La primera pasada descubrió razones de FileSystem que no
  se agregaban desde el CocoaPod estático; ahora el manifest de aplicación
  incluye y verifica la unión completa. Este archivo local no está firmado y
  no sustituye la candidata final ni el Privacy Report de Xcode.
- EAS conserva la sesión Owner de `@maguayo/zenguy`, Push Key y App Store
  Connect API Key. El certificado de distribución y provisioning profile están
  activos hasta el 25 de julio de 2027. El entorno EAS `production` no contiene
  variables remotas; el único valor público de build está fijado en `eas.json`.
- GitHub ya protege de forma activa e inmutable las etiquetas `ios-v*` e
  `ios-ota-v*` mediante el ruleset remoto `Immutable iOS release tags`
  (`22004384`): permite crearlas, pero no moverlas ni borrarlas y no tiene
  bypass. Los entornos `ios-production-release` e `ios-production-ota` ya
  existen y cada uno admite exclusivamente su patrón de tag (`ios-v*` o
  `ios-ota-v*`); ambos están aún sin secretos. El repositorio solo tiene un
  colaborador, por lo que falta añadir un segundo usuario o equipo con acceso
  de lectura antes de poder exigir una aprobación realmente independiente y
  bloquear la autoaprobación.
- `https://api.zenguy.com/api/health`, `/api/app/version` y el AASA público
  responden `200`, pero el health remoto aún sirve el envelope anterior y no
  identifica `environment=production` ni `runnerDispatch=queue`. El AASA
  publicado aún incluye las rutas retiradas `/verify-email` y `/grants/*`; la
  fuente local ya contiene únicamente reset, invitaciones y rutas autenticadas
  de workspace. `https://zenguy.com/support/`
  y `/privacy-choices/` todavía responden `404`; `/privacy/` responde `200`,
  pero sigue sirviendo el texto anterior sin el consentimiento actual de
  OpenAI, la eliminación completa ni Privacy Choices. Todo ello requiere
  desplegar el frontend/website corregido antes de presentar la candidata.
- App Store Connect ya tiene una sesión autenticada y se ha usado solo para una
  auditoría de lectura. Cloudflare no tiene una sesión/token disponible en este
  entorno. Por eso todavía no se han desplegado las migraciones, las páginas
  públicas ni una candidata; los cambios representativos en Apple siguen sin
  guardarse y requieren autorización en el momento de hacerlos.

## P0 — bloqueos confirmados

- [x] **Convertir iOS en una app complementaria solo para cuentas ya
  existentes (regla 3.1.3(f)).**

  Cerrado en código y validado en una instalación limpia de Release. Se han
  eliminado del cliente iOS las pantallas, llamadas, CTA y rutas de registro,
  verificación de alta, creación de workspace, grants, complimentary y billing.
  Los enlaces de adquisición fallan cerrados y una cuenta sin acceso llega a
  un estado neutral. El alta web y sus endpoints compartidos se conservan.
  Un contrato adicional recorre todos los fuentes productivos de `app/` y
  `src/` antes de cada release: impide restaurar rutas o módulos de alta,
  copy positivo de adquisición, navegación oculta, llamadas a endpoints de
  registro/creación de workspace o URLs externas de precios y compra. Cuatro
  pruebas de regresión y el guard de seguridad protegen este gate.

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

- [x] **Añadir eliminación completa de la cuenta dentro de la app
  (regla 5.1.1(v)).**

  Implementado localmente con UI en Account, reautenticación, doble
  confirmación, endpoint autenticado, revocación/purga/anonimización, migración
  `0054_account_deletion.sql` y pruebas de UI/API. Falta desplegarlo y probarlo
  contra staging/producción en la tarea de despliegue de este mismo P0.

  La política de borrado ya clasifica las 31 referencias directas a una cuenta
  del esquema D1 y los cinco contenedores indirectos. El borrado revoca y rota
  tokens, elimina OAuth/aceptaciones/push/intents, anonimiza invitaciones,
  auditoría, actividad, ejecuciones y consentimiento, invalida grants y limpia
  cuotas/rate limits. Una prueba contra el esquema migrado completo falla si una
  migración añade otra referencia sin decisión explícita de borrado.

  La auditoría inicial solo permitía cerrar sesión o eliminar un workspace. La
  acción añadida en `Account` inicia y confirma el borrado de la cuenta completa
  sin escribir a soporte.

  Debe incluir endpoint autenticado, reautenticación/confirmación, revocación de
  sesiones y push tokens, tratamiento de invitaciones y membresías, y una
  decisión explícita para workspaces y suscripciones que el usuario posea
  (transferir o eliminar/cancelar). Borrar o anonimizar los datos asociados
  salvo los registros fiscales, antifraude o de seguridad que deban conservarse,
  explicando plazo y motivo. Añadir pruebas de API y UI, incluido un usuario con
  varios workspaces y un usuario que no sea owner.

- [x] **Obtener permiso explícito antes de compartir datos con IA de terceros,
  o eliminar ese intercambio.**

  Implementado localmente: consentimiento separado, afirmativo y desactivado
  por defecto; versión/fecha/actor persistidos; retirada disponible; bloqueo en
  backend sin consentimiento vigente; secretos reducidos a placeholders; y
  migración `0055_remote_ai_consent.sql`. Falta el despliegue remoto.

  El runner primario usa un modelo local, pero el fallback puede enviar a
  OpenAI instrucciones y estado de las páginas. Por eso la aceptación genérica
  de la política al registrarse en la web se ha sustituido en este flujo por el
  permiso explícito que exige la regla 5.1.2(i).

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

  Progreso local:

  - [x] Inventario de datos, finalidad, vinculación, retención y terceros en
    `docs/ios-app-privacy-inventory.md`.
  - [x] Fuente estructurada `apps/app/app-privacy.config.json`: sus once
    respuestas exactas alimentan el manifest nativo y tres pruebas más los
    verificadores de fuente/config/archive impiden que diverja del inventario.
    No se presenta como payload: el OpenAPI oficial de Apple del 15 de julio de
    2026 solo expone las URLs y mantiene el cuestionario como declaración en el
    portal.
  - [x] Manifest de privacidad con tracking desactivado y las 11 categorías
    reconciliadas con la implementación.
  - [x] Política dentro de la app y fuentes de las páginas públicas de Privacy,
    Support y Privacy Choices.
  - [x] Contrato único y probado para Support, Privacy Choices, Privacy y AASA:
    valida tanto las fuentes como el resultado recién construido y el contenido
    remoto, e impide reintroducir rutas de alta como `/signup` en Universal
    Links.
  - [x] Gate previo al despliegue: el workflow de seguridad construye el
    frontend, prueba y construye el website y verifica los HTML, AASA y
    `_headers` exactos antes de que `production.yml` pueda acceder a secretos,
    ejecutar migraciones o desplegar la API.
  - [x] Gate posterior al despliegue: `production.yml` espera de forma acotada
    la propagación de Pages y exige que las páginas, el AASA y la API públicos
    cumplan el mismo contrato antes de declarar satisfactorio el despliegue.
    Cuatro pruebas cubren éxito, propagación transitoria, agotamiento y límites
    de la espera; una quinta rechaza un API que no identifique producción con
    `RUNNER_DISPATCH=container` (el único ejecutor real: Cloudflare Containers,
    con el consentimiento de IA remota exigido en el claim `cf`); el guard de
    seguridad impide retirar este paso.
  - [x] Preflight de archivo genérico iOS: el verificador inspecciona la app
    empaquetada, detectó la agregación incompleta de Expo FileSystem y ahora
    exige la unión exacta de razones, categorías de datos y manifests de SDK.
  - [ ] Desplegar las páginas y comprobar las tres URLs públicas.
  - [ ] Completar App Privacy en App Store Connect con el inventario versionado.
    La declaración publicada en el portal aún usa
    `https://app.zenguy.com/privacy/`, no tiene Privacy Choices y declara solo
    Device ID, Email Address, User ID y Name; debe sustituirse por las once
    categorías y URLs canónicas auditadas, y volver a publicarse.
  - [ ] Archivar la candidata final firmada, ejecutar `verify:ios-archive` sin
    `--allow-unsigned` y reconciliar el Privacy Report de Xcode sin warnings de
    APIs de razón obligatoria.
  - La pantalla Account ya obtiene del binario nativo la versión pública y el
    build remoto de EAS, en lugar de depender solo de la configuración Expo.
    Esto permite identificar con precisión la instalación usada en smoke tests
    y screenshots.
  - El paquete fuente de App Store tiene un verificador reproducible que alinea
    la versión, límites de texto, URLs, promesas de cuenta preexistente,
    placeholders de Review, nombres demo, plantilla de smoke test y checksums
    del contenido. También protege la plantilla no sensible del registro final
    de candidata. Los workflows de release y OTA lo ejecutan antes de tocar
    credenciales.
  - El workflow de release también falla antes de acceder al token EAS si
    Support, Privacy Choices, Privacy, el AASA o la API de producción no
    responden con el contrato publicado. Actualmente ese gate falla de forma
    intencionada por los dos `404`, el AASA remoto obsoleto y la política pública
    antigua.

  El inventario inicial proponía declarar solo nombre, email y diagnósticos,
  pero la app también registra aperturas y visitas a pantallas/recursos,
  identificadores de
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

- [x] **Dejar verde y reproducible la herramienta de release.**

  Dependencias de Expo SDK 57 corregidas, React Native actualizado a `0.86.3`,
  EAS CLI fijada en `23.2.0` fuera de las dependencias del proyecto y workflows
  alineados con Node `22.23.2`. El auditor global se actualizó para exigir que
  registro, verificación, grants y billing sigan fuera de iOS sin afectar a la
  web. `ajv` queda forzado a la rama corregida y el parser CommonJS transitivo
  de Expo lleva un parche lineal sellado, probado y con excepción caducable;
  las dos excepciones antiguas de `image-size` se eliminaron al desaparecer esa
  dependencia. Los controles locales están verdes; el workflow remoto se
  ejecutará al consolidar el commit limpio de la candidata.

  La última alineación oficial de Expo publicó el mismo 1 de septiembre veinte
  paquetes de SDK 57. Para no desactivar globalmente la política de antigüedad,
  `apps/app/pnpm-workspace.yaml` enumera temporalmente solo esas veinte
  coordenadas con versión exacta. El guard de repositorio rechaza cualquier
  ampliación y también bloquea las etiquetas `ios-v*`/`ios-ota-v*` mientras el
  bloque siga presente. Debe eliminarse completo cuando las veinte versiones
  superen 24 horas y antes de etiquetar o construir la candidata.

  La auditoría inicial detectó 16 dependencias por debajo del patch recomendado
  de SDK 57 y también rechazaba que `eas-cli` estuviera en las dependencias del
  proyecto. Además, `eas.json` exigía exactamente EAS CLI `22.0.0`, mientras que
  la versión vigente auditada es `23.2.0`; los comandos con la CLI actual
  fallaban antes de consultar el proyecto.

  Ejecutar `expo install --fix`, revisar el lockfile y las notas de cambio,
  retirar `eas-cli` de `devDependencies` y fijar una versión auditada de EAS CLI
  en CI/operación mediante `pnpm dlx eas-cli@<versión>`, manteniendo
  `eas.json.cli.version` compatible con esa misma versión. Actualizar workflows
  y README. Validar con Node `22.23.2`, no con el Node 26 usado en esta auditoría.

  Criterio de cierre: `pnpm install --frozen-lockfile`, `expo install --check`,
  `pnpm run doctor`, `verify:release-config`, typecheck, lint, tests y export iOS
  terminan correctamente en CI, sin exclusiones añadidas solo para ocultar los
  dos fallos actuales.

- [ ] **Desplegar y verificar los prerrequisitos server-side de la candidata.**

  La fuente y el artefacto local ya están cerrados: el contrato compartido
  comprueba las tres páginas públicas, el AASA de solo cuentas existentes y sus
  cabeceras; CI los vuelve a construir y validar antes del despliegue y, al
  terminar, reintenta el contrato público hasta 20 veces con pausas de 15
  segundos para cubrir la propagación asíncrona de Pages sin aceptar un estado
  obsoleto. Sigue pendiente publicar esos artefactos mediante los proyectos
  Git-connected de Cloudflare Pages y desplegar las migraciones/API con
  credenciales gestionadas.

  Autenticar Wrangler de forma interactiva o mediante un token gestionado, sin
  copiar credenciales al chat. Ejecutar primero preflight y migraciones `0054`
  y `0055` en staging, desplegar API y web, probar login existente, eliminación,
  consentimiento/revocación y páginas legales; después repetir el despliegue
  controlado en producción. Confirmar también que el AASA público ya no contiene
  `/verify-email` ni `/grants/*`, que `support/` y `privacy-choices/` responden
  `200`, que `privacy/` contiene el consentimiento de OpenAI, el borrado y las
  opciones vigentes, que `RUNNER_DISPATCH=container` y que los secretos requeridos
  siguen presentes. No construir la candidata contra una API que todavía no
  exponga estos contratos. Criterio mínimo automatizado: después del despliegue,
  `pnpm --dir apps/app verify:app-store-remotes` debe terminar en verde.

## P1 — candidata y ficha de App Store

- [ ] **Crear una candidata nueva desde un commit limpio posterior a todos los
  P0.**

  La versión pública ya se incrementó de `0.2.1` a `0.2.2` y la etiqueta
  inmutable `ios-v0.2.2` sigue libre. Mantener el build number remoto por encima
  de `4`, construir con el perfil `production`, Xcode 26 y credenciales
  congeladas, y enviar a TestFlight. Confirmar que el runtime real usa el
  fingerprint actual. No publicar una OTA desde un worktree sucio: el canal
  `production` todavía conserva como última OTA una actualización antigua del
  runtime `0.2.0` marcada como dirty.

  Criterio de cierre: EAS Build y EAS Submission están en estado terminal
  satisfactorio; Apple muestra el binario como `VALID` y `IN_BETA_TESTING`; la
  versión, build, commit, fingerprint y API `https://api.zenguy.com` coinciden.
  El workflow exige antes un `production.yml` satisfactorio para ese SHA exacto,
  y la fila de versión en Account debe mostrar ese mismo número de build nativo.
  La plantilla y el verificador del registro final ya exigen esos valores y que
  `ios-v0.2.2` apunte al commit exacto; falta poder rellenarlos con la candidata
  real.

- [ ] **Preparar una cuenta estable y completa para App Review.**

  Progreso local: `docs/app-store/review-account.md` fija un contrato seguro y
  `pnpm --dir apps/app verify:app-review-account` lo valida contra producción
  sin imprimir credenciales ni modificar datos. Rechaza las identidades y
  contraseñas conocidas del seed local, prueba dos sesiones independientes,
  comprueba los tres nombres demo, evidencia, historial, timeline, canales,
  miembros y consentimiento de IA apagado, y revoca ambas sesiones al terminar.
  Falta crear y poblar la cuenta real después del despliegue.

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

  La plantilla ya exige IDs/URLs de EAS completos, fingerprint, API y el estado
  exacto `VALID / IN_BETA_TESTING`. El contrato automatizado solo acepta un PASS
  con las 42 comprobaciones PASS marcadas, ninguna tarea pendiente salvo la fila
  FAIL y coincidencia total con el registro de candidata. Falta ejecutarlo en el
  dispositivo y conservar su hash.

  Cubrir instalación limpia, login, las cuatro áreas principales y More,
  refresco de sesión, cierre de sesión, foreground/background, bloqueo
  biométrico, permiso y recepción de push, universal links de reset e
  invitación, navegación desde push, un test seguro contra un dominio
  controlado, arranque en frío con EAS Update y redes lenta/sin conexión. Probar
  también el borrado de una cuenta desechable. Registrar modelo, iOS, versión y
  build probados, comprobando esos dos últimos valores en Account contra EAS y
  App Store Connect.

- [ ] **Crear la ficha comercial completa en App Store Connect.**

  El copy en inglés de EE. UU., las categorías propuestas, las URLs, la
  distribución y las respuestas razonadas del age rating están preparados en
  `docs/app-store/metadata-en-US.md`. La fuente estructurada
  `apps/app/app-age-rating.config.json` fija las 24 respuestas del cuestionario
  actualizado, el resultado por contenido `4+` y el override obligatorio a
  `18+` porque los Términos exigen esa edad mínima; cuatro pruebas y el
  verificador del paquete impiden que diverja de la tabla o de los dos textos
  legales. El subconjunto no sensible compatible con
  EAS Metadata está además en `apps/app/store.config.json` y pasa
  `metadata:lint` sin avisos; no contiene credenciales, App Privacy ni respuestas
  de edad. Un perfil separado `app-review-metadata` añade contacto, credenciales
  y notas solo en memoria desde ocho variables inyectadas por el gestor de
  contraseñas; las borra del proceso EAS al leerlas, rechaza fixtures locales y
  valida también el nombre del vídeo y la lista de dispositivos. Está cubierto
  por cuatro pruebas. El objeto completo devuelve `[]` al validarlo
  localmente con el esquema y las reglas incluidos en EAS CLI `23.2.0`; el lint
  conectado con los valores reales queda para la ceremonia de release. El
  perfil `production` continúa reservado al binario y no puede arrastrar esos
  datos. Licencias, checksums y el sign-off de derechos están inventariados en
  `docs/app-store/content-rights.md`. Falta la confirmación del titular y guardar
  los campos en la ficha real después del login y de que las URLs sean públicas;
  el conjunto final y ordenado de territory IDs debe quedar además en el registro
  verificable de la release.

  La auditoría autenticada del portal confirma que la ficha real aún es la del
  binario rechazado y no coincide con esta fuente: el subtítulo es `Browser
  tests & uptime alerts`, la categoría secundaria es Productivity, Support
  apunta a la home, la descripción y las Review Notes invitan a registrarse,
  verificar el email y crear un workspace, y conserva ocho screenshots de la
  build antigua. **Content Rights** afirma que la app no accede a contenido de
  terceros, aunque puede mostrar contenido web autorizado por el cliente; debe
  declararse el acceso autorizado descrito en `content-rights.md`. No reutilizar
  esos textos ni capturas para `0.2.2`.

  Verificar o completar nombre, subtítulo, descripción, keywords, categoría,
  copyright, URL canónica de privacidad, URL de soporte, precio `Free`, regiones
  y método de publicación manual. Crear `https://zenguy.com/support/` con ayuda,
  contacto funcional e instrucciones de cuenta/borrado; una home genérica o un
  `mailto:` no son una buena URL de soporte. La descripción debe indicar con
  claridad que la app requiere una cuenta Zenguy preexistente, sin convertirlo
  en una llamada a registrarse o comprar en la web.

  Introducir en App Store Connect las 24 respuestas estructuradas y seleccionar
  **Override to Higher Age Rating: 18+**. Confirmar que el portal calcula `4+`
  antes del override y muestra `18+` después, y que **Made for Kids** queda en
  **Not Applicable**. La respuesta de User-Generated Content es **No** porque
  Apple la define por distribución amplia: la configuración y evidencia de
  Zenguy solo se comparte dentro de workspaces privados con control de acceso.
  Los tests pueden mostrar contenido de sitios configurados por el cliente;
  usar datos controlados para Review y reauditar si cambia ese modelo. Revisar
  también derechos sobre icono, fuentes y material mostrado. La auditoría ya
  confirmó que las 24 respuestas y Made for Kids coinciden con la fuente, pero
  el override aún no está seleccionado y el portal sigue mostrando `4+`; falta
  guardar el `18+`.

- [ ] **Producir y subir screenshots de App Store con datos ficticios.**

  El set, captions, reglas de datos y QA están definidos en
  `docs/app-store/screenshots-en-US.md`; la resolución objetivo 1320 × 2868 ya
  se validó en el simulador. Ya existe un flujo Maestro sin credenciales
  embebidas para capturar las cinco vistas y un preparador que rechaza fuentes
  ausentes o duplicadas, verifica dimensiones/RGB/alfa, convierte a JPEG y
  registra versión, build, commit, IDs de EAS y SHA-256. Se ha probado la
  mecánica con fixtures, no con datos finales. Faltan una cuenta/workspace demo
  no personal, ejecutar el flujo sobre la candidata exacta, revisar manualmente
  cada imagen al 100%, verificar sus bytes junto con el manifest y subir el set
  aprobado. El registro final ya exige el SHA-256 exacto de ese manifest.

  Subir entre 1 y 10 capturas válidas de iPhone, usando el tamaño de mayor
  resolución requerido por App Store Connect para que Apple escale el resto.
  Mostrar la app en uso —por ejemplo overview, tests/evidencia, uptime e
  incidentes— y no solo login o splash. No incluir nombres, emails, URLs o
  secretos reales, ni precios o instrucciones de compra. No hacen falta
  capturas de iPad mientras `supportsTablet` siga en `false`.

- [ ] **Redactar un paquete de App Review que elimine ambigüedades.**

  Hay dos fuentes listas para completar:
  `docs/app-store/review-notes-en-US.md` y
  `docs/app-store/review-response-guideline-2.1.md`. Los placeholders quedan
  deliberadamente en el repositorio y el perfil dinámico obtiene contacto,
  credenciales, nombre del vídeo y dispositivos reales del gestor de
  contraseñas sin persistirlos. La segunda plantilla identifica y responde los
  siete puntos exactos del rechazo, exige 13 sign-offs y se enlaza por SHA-256
  con la candidata. No se puede cerrar hasta crear y validar la cuenta real,
  capturar el vídeo físico, comprobar los nombres demo y guardar/adjuntar los
  mismos valores en App Store Connect.

  Incluir contacto accesible, credenciales demo, pasos cortos para revisar cada
  función y explicar expresamente el encaje en 3.1.3(f): es una app
  complementaria gratuita para usuarios con una cuenta ya existente, y no
  permite crear cuentas, comprar ni muestra llamadas a comprar fuera de iOS.
  Añadir la explicación del procesamiento con IA y su consentimiento, de que
  los tests se ejecutan en un navegador remoto contra sistemas autorizados, y
  de que push, Face ID y enlaces universales son opcionales. Explicar cualquier
  función difícil de provocar. El vídeo ya no es opcional: Apple exige una
  grabación en iPhone físico desde cold launch que muestre login de cuenta
  existente, flujo principal, permisos aplicables y eliminación completa con
  una cuenta desechable, sin borrar la cuenta compartida ni exponer secretos.

- [ ] **Consolidar el expediente verificable de la candidata y de App Review.**

  - [x] Plantilla sin secretos en
    `docs/app-store/release-record.template.json`.
  - [x] Contrato con ocho pruebas y comando
    `pnpm --dir apps/app verify:app-store-release-record`.
  - [x] Validación estricta de app/equipo/proyecto, versión/build/commit/tag,
    fingerprint, API, IDs y URLs canónicas de EAS, estados
    EAS/Apple/TestFlight, grupo, release manual, storefronts ordenados,
    clasificación calculada `4+` y override/display `18+`, metadatos de
    credenciales, trece sign-offs y ciclo `REVIEW_READY` → `SUBMITTED` →
    `APPROVED` → `RELEASED`. El verificador obtiene la versión pública y la
    fuente estructurada de edad directamente del commit candidato, no del
    checkout desde el que se ejecuta después.
  - [x] Integridad byte a byte del manifest y los cinco JPEG, del smoke test,
    de la respuesta Guideline 2.1, del MOV/MP4 físico y del PDF de Privacy
    Report mediante SHA-256. El verificador exige vídeo de 1–500 MB, contenedor
    MOV/MP4, identidad exacta, lista de dispositivos, duración y 13 checks
    completados.
  - [ ] Copiar y rellenar la plantilla con la candidata real, ejecutar el
    verificador con el Privacy Report de Xcode reconciliado, el smoke PASS y las
    capturas aprobadas, la respuesta y el vídeo físico adjunto; conservar
    snapshots separados para cada cambio de estado. Nunca incluir contraseñas,
    tokens, claves privadas, email o teléfono de Review.

- [ ] **Revalidar los controles remotos justo antes del envío.**

  EAS ya está revalidado en modo lectura y App Store Connect se auditó en una
  sesión autenticada. Queda una sesión gestionada de Cloudflare y habrá que
  repetir la comprobación de Apple en la ceremonia de envío. No compartir
  contraseñas, códigos 2FA ni tokens en el repositorio o en el chat.

  En el equipo `HT84Q65URB`, Free Apps Agreement está activo hasta el 15 de
  julio de 2027 y el estado de trader DSA está activo. Paid Apps Agreement figura
  `New`; no bloquea esta app mientras siga siendo gratuita y sin IAP, pero debe
  revisarse antes de monetizar. Reconfirmar estos estados justo antes del envío
  y que EAS conserva certificado de distribución, provisioning profile, APNs
  key y App Store Connect API key válidos. Verificar que el grupo interno usa
  solo la autodistribución de Apple y que no se ha añadido también `groups` a
  `eas.json`.
  Registrar solo los identificadores no secretos, caducidades, responsable y
  fecha de esta revisión en el expediente final; no exportar credenciales.

  Estado GitHub comprobado el 1 de septiembre de 2026:

  - [x] Ruleset activo y sin bypass para impedir actualización o borrado de
    `ios-v*` e `ios-ota-v*`.
  - [x] Crear `ios-production-release` e `ios-production-ota` y restringir cada
    entorno exclusivamente a su propia familia de tags. No contienen secretos
    mientras no exista la revisión independiente.
  - [ ] Añadir a otro usuario o equipo con al menos acceso de lectura; el único
    colaborador actual es quien inicia las releases y no puede actuar como
    revisor independiente.
  - [ ] Exigir ese revisor en ambos entornos, activar **Prevent self-review** y
    desactivar el bypass de admins.
  - [ ] Guardar solo `EXPO_IOS_RELEASE_TOKEN` en el primer entorno y solo
    `EXPO_IOS_OTA_TOKEN` + `EAS_UPDATE_PRIVATE_KEY_PEM` en el segundo.
  - [ ] Proteger `main` y exigir revisión independiente para cambios en
    workflows, configuración de firma y certificados, una vez exista el
    segundo colaborador; actualmente `main` no tiene protección.

- [ ] **Seleccionar la candidata correcta y enviarla a revisión.**

  La auditoría de solo lectura confirma que el registro rechazado mantiene el
  campo **Version** habilitado (`0.2.0`), la build `3` se puede retirar y existe
  un botón **Update Review** habilitado. Por tanto, para esta primera versión no
  se debe crear otra ficha ni pulsar Add Platform: tras procesarse la candidata,
  cambiar ese campo a `0.2.2`, sustituir la build por la nueva `5+` y guardar la
  metadata. **Update Review** es la frontera de reenvío y no debe pulsarse hasta
  que el snapshot `REVIEW_READY`, el vídeo y los siete apartados estén cerrados.

  Asociar la build validada, confirmar export compliance, privacidad, edad,
  disponibilidad y release manual; después usar “Add for Review” y “Submit for
  Review”. No enviar la build actual `0.2.1 (4)`. Monitorizar App Store Connect y
  responder al hilo abierto de Guideline 2.1 con los siete apartados y el vídeo
  físico de la candidata hasta llegar a un estado terminal. La versión rechazada
  `0.2.0 (3)` no es evidencia de la nueva candidata. Antes de pulsar Submit debe
  pasar el snapshot `REVIEW_READY`; después conservar snapshots verificados
  `SUBMITTED` y `APPROVED` con timestamps cronológicos.

## P2 — después de la aprobación

- [ ] **Publicar manualmente y configurar el enlace definitivo de App Store.**

  Cuando exista la URL pública, guardar `IOS_APP_STORE_URL` en producción,
  comprobar `GET /api/app/version` y probar el flujo “Update required”. No subir
  `MIN_APP_VERSION` antes de que ese enlace funcione y la nueva versión esté
  disponible en los storefronts elegidos. Guardar entonces el snapshot
  `RELEASED` con estado `READY_FOR_DISTRIBUTION`, timestamps y la URL de App Store.

  Progreso local: la configuración y el gate remoto aceptan `null` antes de la
  publicación, pero cuando haya URL exigirán exactamente la ficha canónica de
  Zenguy (`id6804201911`), sin parámetros ni fragmentos; una URL de otra app
  bloquea el despliegue. Falta la publicación real y guardar el valor remoto.

- [ ] **Cerrar la release con observabilidad y soporte.**

  Vigilar crashes, login, runner, API, notificaciones y mensajes de review las
  primeras 48 horas; conservar IDs/URLs de build y submission; documentar la
  versión publicada, el responsable de credenciales y las próximas fechas de
  renovación. El expediente verificado conserva esos campos sin guardar ningún
  secreto.

  Progreso local: existe una plantilla de monitorización enlazada por SHA-256 al
  snapshot `RELEASED` y el comando
  `pnpm --dir apps/app verify:app-store-post-release`. Exige checkpoints dentro
  de las ventanas de release, H+24 y H+48 para crashes, login, runner, API,
  notificaciones, mensajes de App Review y soporte; cualquier degradación debe
  quedar cubierta por un incidente resuelto y H+48 debe cerrar en verde. También
  reconcilia IDs/URLs EAS, URL pública, responsables y revisión de renovación,
  y rechaza secretos/contactos. Cinco pruebas cubren el cierre sano, identidad
  o ventana incorrectas, incidencia sin evidencia, recuperación documentada y
  el CLI completo con ambos archivos enlazados. Falta ejecutar las 48 horas
  reales después de publicar.

## Ya comprobado — no repetir salvo que cambie la configuración

- Bundle ID `com.zenguy.app`, Team ID, EAS project ID y `ascAppId` coinciden.
- El perfil production usa HTTPS, canal `production`, auto-increment y una
  imagen de Xcode 26.6, que supera el requisito de SDK vigente desde abril de
  2026.
- El icono es PNG RGB de 1024 × 1024 sin canal alfa.
- El AASA responde `200`, sin redirección, como `application/json` y contiene
  `HT84Q65URB.com.zenguy.app`; la fuente local tiene las rutas esperadas, pero
  su copia pública sigue obsoleta hasta el próximo despliegue del frontend.
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
