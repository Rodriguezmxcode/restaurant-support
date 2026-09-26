# OpsVista — App Store metadata draft

Status: draft for App Store Connect. This file does not create an App Store listing and contains no signing credentials. Validate every URL and the review account before submission.

## App record

| Field | Draft value | Release check |
|---|---|---|
| Platform | iOS and iPadOS | Confirm both device families remain enabled in the signed build. |
| App name | OpsVista | Confirm name availability in App Store Connect. |
| Bundle ID | `com.opsvista.mobile` | Must exactly match the Apple identifier and signed build. |
| SKU | `opsvista-ios-001` | Internal identifier; confirm before creating the record because it cannot be changed later. |
| Primary language | Spanish (Mexico) | Add English (U.S.) localization below. |
| Primary category | Business | Confirm in App Store Connect. |
| Secondary category | Productivity | Optional; confirm before submission. |
| Price | Free | Access is limited to users invited by a participating organization; there is no in-app checkout. |
| Version | 0.2.0 | App Store version and build number must match the uploaded build. |
| Copyright | Pending legal entity name | Do not publish a personal or company name until ownership is confirmed. |

## Spanish (Mexico)

**Name — 30 characters maximum**

OpsVista

**Subtitle — 30 characters maximum**

Operación bajo control

**Promotional text — 170 characters maximum**

Ventas, labor, alertas y responsabilidades de tus restaurantes en una experiencia móvil clara para actuar con tu equipo desde cualquier lugar.

**Description — 4,000 characters maximum**

OpsVista reúne la información operativa esencial de tus restaurantes para que puedas detectar problemas, asignar responsables y dar seguimiento desde iPhone o iPad.

Consulta las ventas y el costo de labor del día por restaurante. Revisa alertas y acciones ordenadas por prioridad, filtra por ubicación y encuentra rápidamente una tarea o responsable. Las actualizaciones y los estados parciales te ayudan a distinguir entre un dato pendiente, una fuente no disponible y un valor real de cero.

Con Action Center puedes consultar responsabilidades, aceptar asignaciones y comenzar su seguimiento. Las notificaciones opcionales te llevan directamente a la acción correspondiente para responder con mayor rapidez.

OpsVista está diseñada para usuarios autorizados de organizaciones participantes. Se requiere una cuenta de trabajo proporcionada por el administrador de la organización. La app no ofrece compras, registro público ni creación de cuentas.

Funciones de esta versión:

- Resumen de ventas y labor del día.
- Vista consolidada y filtros por restaurante.
- Alertas y acciones ordenadas por prioridad.
- Responsabilidades asignadas y seguimiento de estado.
- Notificaciones opcionales de acciones.
- Información de última actualización y errores parciales.

Algunas funciones dependen de las integraciones y permisos habilitados para cada organización.

**Keywords — 100 characters maximum, comma-separated**

restaurantes,operaciones,ventas,labor,alertas,tareas,gerentes,productividad

## English (U.S.)

**Name — 30 characters maximum**

OpsVista

**Subtitle — 30 characters maximum**

Restaurant operations

**Promotional text — 170 characters maximum**

Sales, labor, alerts, and restaurant responsibilities in one clear mobile workspace built to help your team take action from anywhere.

**Description — 4,000 characters maximum**

OpsVista brings essential restaurant operations into one mobile workspace so authorized teams can identify issues, assign responsibility, and follow through from iPhone or iPad.

Review today's sales and labor cost by restaurant. Browse alerts and actions ordered by priority, filter by location, and quickly find a task or owner. Refresh information and partial-error states help distinguish pending data, an unavailable source, and a genuine zero.

Action Center lets you review responsibilities, accept assignments, and begin follow-up. Optional notifications can open the related action directly so teams can respond sooner.

OpsVista is available to authorized users of participating organizations. A work account provided by the organization's administrator is required. The app does not offer public registration, account creation, or in-app purchases.

Features in this version:

- Daily sales and labor overview.
- Consolidated and restaurant-filtered views.
- Alerts and actions ordered by priority.
- Assigned responsibilities and status tracking.
- Optional action notifications.
- Last-updated information and partial-error states.

Some features depend on the integrations and permissions enabled for each organization.

**Keywords — 100 characters maximum, comma-separated**

restaurant,operations,sales,labor,alerts,tasks,managers,productivity

## URLs and contact fields

| Field | Candidate | Status before submission |
|---|---|---|
| Marketing URL | `https://getopsvista.com` | Verify the final public page loads and accurately represents this mobile release. |
| Privacy Policy URL | Pending | A public, stable HTTPS page is required. It must describe the data actually collected by the app and its services. |
| Support URL | Pending | A public, stable HTTPS page with a working support contact is required. |
| Support email | Pending | Confirm a monitored company inbox. |

Do not use a Vercel preview URL for the App Store record. Replace the pending values only after the final public pages are live.

## App Review information

**Contact:** Pending name, monitored email, and phone number.

**Demo account:** Pending dedicated review credentials. Do not store the password in this repository; enter it directly in App Store Connect.

**Review notes draft**

OpsVista is an organization-managed restaurant operations app. Public account creation is not available. Please use the review account supplied in App Store Connect. The account should include access to fictional or non-sensitive test locations and sample operational data.

The first mobile release includes the home performance overview, Action Center, assigned responsibilities, notifications, and account view. It does not include the web product's Price Watch, inventory, liquor, bonus, Reviews, Corporate Office, evidence upload, or purchasing modules.

Push notifications are optional. To test them, allow notifications on a physical device and use the test action assigned to the review account. Reviewers must be able to evaluate the core app even if notification permission is denied.

The backend must remain available throughout review. Before submission, verify that the review account can sign in from a clean installation and that all visible locations contain non-sensitive test data.

## Age rating and content declarations

Expected rating: 4+, assuming the final build contains only the operational features documented above and no unrestricted web access, user-generated public content, gambling, alcohol sales, or other age-rated material. Complete Apple's current age-rating questionnaire from the actual submitted build; this draft is not the questionnaire.

## Asset and localization checklist

- [x] 1024 × 1024 opaque app icon prepared and referenced by `app.json`.
- [x] iPhone and iPad remain enabled through `ios.supportsTablet: true`.
- [ ] Install a signed build and confirm the icon on both iPhone and iPad.
- [ ] Capture screenshots from the submitted build, not from the HTML prototype.
- [ ] Prepare all screenshot sets requested by App Store Connect for iPhone and iPad.
- [ ] Verify Spanish and English text against the final build.
- [ ] Publish and verify the Privacy Policy URL.
- [ ] Publish and verify the Support URL and support email.
- [ ] Confirm copyright owner, category, price, SKU, and App Store name availability.
- [ ] Create a dedicated review account with safe test data.
- [ ] Complete App Privacy and age-rating forms from the final data flows and binary.

## Source references

- Apple, App information: https://developer.apple.com/help/app-store-connect/reference/app-information/
- Apple, platform version information: https://developer.apple.com/help/app-store-connect/reference/platform-version-information/
- Apple, screenshot specifications: https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/
- Apple, app privacy: https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/
- Apple, app review information: https://developer.apple.com/help/app-store-connect/reference/app-review-information/
