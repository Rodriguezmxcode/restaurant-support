# OpsVista móvil — diseño y preparación para App Store

Revisión: 19 de septiembre de 2026. Base revisada: `restaurant-support`, rama `opsvista-migration-v1`, commit `5a735e9`. Esta entrega prepara el diseño y el código; no constituye una app publicada ni una compilación firmada por Apple.

## Lo que ya está preparado

- App nativa React Native / Expo 54 con identificador `com.opsvista.mobile` y proyecto EAS configurado.
- Nuevo diseño azul oscuro, indicadores verdes y azules, navegación de cinco pestañas, búsqueda, selector de restaurante y acciones ordenadas por prioridad.
- Inicio de sesión y llamadas al backend existente para ventas, labor, acciones, asignación y seguimiento. Su funcionamiento en un iPhone físico sigue pendiente de verificación.
- Estado de carga, errores parciales, última actualización y ausencia de datos diferenciados de ceros reales.
- Notificaciones solicitadas mediante una acción explícita del usuario. Apertura de acciones consultando el servidor y recuperación de la notificación que inició la app.
- Retirado el botón que decía enviar evidencia pero únicamente registraba un cambio de estado.
- Perfil de producción fijado a una imagen EAS con Xcode 26.0. Apple exige Xcode 26 / SDK iOS 26 o posterior desde el 28 de abril de 2026; Expo documenta una imagen compatible con SDK 54. Hay que confirmar la imagen y SDK efectivos en el siguiente build firmado. [Apple](https://developer.apple.com/news/upcoming-requirements/) · [Expo](https://docs.expo.dev/build-reference/infrastructure/)

El prototipo `design/OpsVista-Mobile.html` permite recorrer las cinco pantallas, filtrar restaurantes, buscar y probar dos estados de una acción. Sus datos son ficticios, no llama al backend y no es una captura del programa ejecutándose en iOS. El código nativo usa datos del servidor; no contiene esos datos de ejemplo.

## Lo que falta para publicar

| Área | Estado comprobado | Siguiente entrega o comprobación |
|---|---|---|
| Apple Developer | El correo aportado dice “Agreement signed: Apple Developer Agreement”. No acredita membresía pagada activa. | Confirmar Membership details y acceso a App Store Connect. |
| Registro de la app | Existe el identificador en el código. No se verificó una ficha en App Store Connect. | Crear o comprobar ficha, Team ID, Bundle ID, certificados, perfiles y permisos APNs. |
| Funciones y acceso | Hay endpoints y comprobaciones de permisos. La autorización del servidor aún restringe estos módulos operativos a la organización original mediante `hasLegacyWorkspace`. | Probar los roles de la organización original y habilitar/validar el acceso de restaurantes clientes si forman parte del lanzamiento. No basta con crearles una cuenta. |
| Sesión y privacidad | El cliente usa cookies con `credentials: include`. El registro push tiene POST, sin baja de dispositivo en el endpoint revisado. | Probar persistencia/expiración de sesión y añadir desvinculación del dispositivo al cerrar sesión o cambiar de usuario para evitar avisos de la cuenta anterior. |
| Evidencia | No existe captura ni carga móvil de fotos en este cliente. | Implementar permisos contextuales, carga autenticada, asociación a la tarea y confirmación del servidor antes de anunciar evidencia móvil. Puede excluirse del primer lanzamiento si la ficha lo refleja. |
| Privacidad y soporte | No hay enlaces a política de privacidad ni soporte dentro del cliente móvil revisado. | Publicar páginas reales, enlazarlas desde Cuenta e inicio de sesión y completar la declaración de datos/SDKs. |
| Recursos de tienda | El icono 1024 × 1024 ya está configurado y existe un borrador bilingüe de metadata. No hay capturas nativas de esta versión. | Validar el icono en un build firmado, confirmar los campos pendientes y preparar capturas reales de iPhone y iPad. |
| Pruebas y distribución | TypeScript, pruebas de lógica y exportación del bundle iOS verificables localmente. No equivalen a un archivo firmado. | Generar el build iOS, instalar por TestFlight, corregir incidencias y enviar a revisión. |

La cuota del Apple Developer Program es de **99 USD anuales**, con variaciones de moneda/precio por región. Apple distingue la firma del acuerdo, la compra y la confirmación de la membresía. [Inscripción y confirmación](https://developer.apple.com/help/account/membership/program-enrollment/)

## Privacidad y modelo comercial

La política debe estar accesible en la app y en la ficha. Apple pide una cuenta de revisión o modo de demostración completo y un backend disponible. El acceso empresarial a suscripciones previamente compradas puede encajar en 3.1.3(c); una app complementaria gratuita sin compras ni llamadas a comprar puede encajar en 3.1.3(f). Propuesta para OpsVista: acceso gratuito para usuarios de organizaciones suscritas, sin checkout ni enlaces de compra en la app. Es una propuesta sujeta al modelo final y a revisión de Apple. El login propio actual no obliga por sí solo a añadir Sign in with Apple. [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

La declaración App Privacy debe reflejar los datos realmente recogidos, incluidos los de terceros. Revisar nombre/correo e ID de usuario, información de dispositivo/token push, actividad operativa y, si se implementan, fotos. No declarar “sin datos recopilados” solo porque los datos residan en el servidor. [App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/)

Si se incorpora creación de cuentas en la app, incluso mediante un enlace de registro, debe permitirse iniciar su eliminación desde ella. Actualmente se usa una cuenta empresarial existente; hay que documentar ese flujo y la retención/eliminación de datos antes de finalizar la ficha. No añadir un botón de borrado sin un proceso real detrás. [Eliminación de cuentas](https://developer.apple.com/support/offering-account-deletion-in-your-app/)

La configuración actual también declara soporte de iPad. Por tanto, hay que verificar el diseño en iPad y preparar las capturas aplicables, o decidir formalmente un primer alcance solo para iPhone antes de enviar. Las capturas deben provenir de la versión que se revisa, no del prototipo HTML. [Especificaciones de capturas](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)

## Prueba de aceptación en TestFlight

1. Entrar con cuentas de dirección, manager y mantenimiento; comprobar permisos y aislamiento entre organizaciones/locaciones.
2. Verificar ventas y labor contra la web para el mismo día en Eastern Time; distinguir permisos insuficientes, fuente caída, datos vacíos y cero real.
3. Asignar, aceptar e iniciar una acción; comprobar el resultado en la web y su historial. Usar un entorno/cuentas de prueba.
4. Probar push con la app abierta, en segundo plano y cerrada; rechazar permisos; cerrar sesión y cambiar de usuario. No enviar alertas a empleados reales durante QA.
5. Probar conexión interrumpida, reintento, caducidad de sesión y retorno desde el segundo plano.
6. Verificar teclado, iPhone pequeño, tamaño de letra grande, VoiceOver, contraste, botones y áreas seguras; verificar iPad si se mantiene habilitado.
7. Validar política de privacidad/soporte, datos declarados, icono, firma, SDK, permisos y cuenta de revisión.

TestFlight permite distribuir builds de prueba; después debe seleccionarse el build y enviarse a App Review. La aprobación no puede garantizarse ni darse por completada con el diseño. [Envío de apps](https://developer.apple.com/app-store/submitting/)

## Alcance de esta primera versión

Inicio, indicadores de ventas/labor, Action Center, responsabilidades, notificaciones y cuenta. Price Watch, inventario/licores, bonos, Reviews, Corporate Office y los demás módulos web todavía requieren pantallas y pruebas nativas; no se anuncian como implementados aquí. Tampoco hay Face ID ni funcionamiento completo sin conexión.

## Evidencia técnica de esta entrega

- `npm run typecheck`: verificación de tipos.
- `npm test`: cálculo ponderado de labor, ceros/datos ausentes, filtros y prioridad/cierre de acciones; notificaciones de apertura y limpieza de listeners.
- `CI=1 npx expo export --platform ios --output-dir dist --max-workers 2`: exportación de JavaScript/Hermes, no compilación Xcode ni firma Apple.
- No se accedió a la cuenta Apple/Expo ni se envió un build a App Store Connect. La revisión visual nativa y las pruebas con el backend autenticado quedan para un dispositivo de prueba.
