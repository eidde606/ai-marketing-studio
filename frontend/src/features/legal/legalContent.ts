import type { LegalPage } from "./pagePaths";

type Language = "en" | "es";
type PolicySection = { heading: string; body: string };
type PolicyCopy = { title: string; intro: string; sections: PolicySection[] };

type PolicyPage = Exclude<LegalPage, "contact">;

export const policyCopy: Record<
  PolicyPage,
  Record<Language, PolicyCopy>
> = {
  privacy: {
    en: {
      title: "Privacy Policy",
      intro:
        "This draft describes information handled by AI Marketing Studio, operated by Nazbort Tech LLC. It is not effective until the operational details are confirmed and the policy is approved.",
      sections: [
        {
          heading: "Information about accounts",
          body: "Authentication is provided through Supabase. The application receives an account identifier and may use your email address and profile name supplied by the authentication provider. It stores application account mappings and your interface, conversation, and content-language preferences.",
        },
        {
          heading: "Business workspaces and content",
          body: "To provide the service, the application processes workspace names and marketing details, membership and role information, campaigns, drafts, approval decisions, publishing destinations, and usage records. The information available to a member depends on that member's workspace permissions.",
        },
        {
          heading: "Connected social platforms",
          body: "If you connect Facebook, Instagram, or TikTok, the application processes the authorized account and Page identifiers, granted permissions, connection status, and publishing or analytics results needed for the features you request. Social access tokens are encrypted by the application before they are stored. Disconnecting a workspace connection removes its stored credential from this application; revoking the separate grant in the platform account may require an additional action there.",
        },
        {
          heading: "AI and media services",
          body: "When you request an AI feature, the relevant prompt, draft, business context, or selected media may be sent to OpenAI for text, image, or analytics processing. When you request video generation, selected script and asset information may be sent to HeyGen. Marketing media is stored in a business-scoped Supabase Storage path and is accessed through temporary signed URLs. The provider's own terms and privacy practices also apply.",
        },
        {
          heading: "Subscriptions and payments",
          body: "When billing is enabled, Checkout and subscription management use Stripe-hosted pages. The application stores Stripe customer, subscription, price, status, and billing-period identifiers; payment card details are handled by Stripe's hosted payment flow. The current backend accepts Stripe test-mode credentials only, so live paid billing has not been verified.",
        },
        {
          heading: "Cookies, local storage, and analytics",
          body: "The frontend uses browser storage for authentication sessions and language or navigation preferences. No advertising or analytics-pixel integration was found in the application source reviewed for this draft. Hosting-provider cookies and production browser-storage settings still need to be checked before approval.",
        },
        {
          heading: "How information is used and shared",
          body: "Information is used to authenticate accounts, operate tenant workspaces, provide requested content and analytics features, process billing, deliver support, protect the service, and meet legal obligations. Information is sent to a connected platform or service provider only as needed for a feature or action you initiate, and may be disclosed when legally required.",
        },
        {
          heading: "Security and retention",
          body: "The application uses tenant-scoped authorization, server-side access controls, private media paths, and application-layer encryption for stored social tokens. These measures are not a certification or guarantee. Exact retention periods, database and backup deletion schedules, provider retention settings, and production hosting safeguards have not yet been confirmed and must be documented before this policy is effective.",
        },
        {
          heading: "Privacy choices and deletion",
          body: "You may request access, correction, export, or deletion by using the Contact & Support form and choosing Privacy and data deletion. We must verify identity and authority before acting. Some financial, security, or legally required records may need to be retained. Deleting information here does not remove content already published to a third-party platform.",
        },
        {
          heading: "Contact and updates",
          body: "Privacy questions can be submitted through the Contact & Support page. The support destination and operational response process must be configured by Nazbort Tech LLC before public launch. Policy updates and effective dates require owner and legal review.",
        },
      ],
    },
    es: {
      title: "Política de Privacidad",
      intro:
        "Este borrador describe la información que maneja AI Marketing Studio, operado por Nazbort Tech LLC. No estará vigente hasta confirmar los detalles operativos y aprobar la política.",
      sections: [
        {
          heading: "Información de la cuenta",
          body: "La autenticación se realiza mediante Supabase. La aplicación recibe un identificador de cuenta y puede utilizar el correo electrónico y nombre de perfil proporcionados por el proveedor de autenticación. Guarda las asociaciones de cuentas de la aplicación y tus preferencias de idioma de interfaz, conversación y contenido.",
        },
        {
          heading: "Espacios de trabajo y contenido",
          body: "Para prestar el servicio, la aplicación procesa nombres y datos de marketing de los espacios, membresías y roles, campañas, borradores, decisiones de aprobación, destinos de publicación y registros de uso. La información disponible depende de los permisos de cada miembro.",
        },
        {
          heading: "Plataformas sociales conectadas",
          body: "Al conectar Facebook, Instagram o TikTok, la aplicación procesa los identificadores autorizados de cuentas y páginas, permisos otorgados, estado de conexión y resultados de publicación o análisis necesarios para las funciones solicitadas. Los tokens sociales se cifran en la aplicación antes de guardarse. Desconectar una integración elimina su credencial almacenada en esta aplicación; revocar el permiso general en la cuenta de la plataforma puede requerir una acción adicional allí.",
        },
        {
          heading: "Servicios de inteligencia artificial y medios",
          body: "Cuando solicitas una función de inteligencia artificial, el mensaje, borrador, contexto comercial o medio seleccionado pertinente puede enviarse a OpenAI para procesar texto, imágenes o análisis. Al solicitar la generación de video, el guion y los datos de recursos seleccionados pueden enviarse a HeyGen. Los medios se guardan en una ruta de Supabase Storage asociada al negocio y se acceden mediante enlaces temporales firmados. También se aplican las condiciones y prácticas de privacidad de cada proveedor.",
        },
        {
          heading: "Suscripciones y pagos",
          body: "Cuando la facturación está habilitada, Checkout y la administración de suscripciones utilizan páginas alojadas por Stripe. La aplicación guarda identificadores de cliente, suscripción, precio, estado y período de facturación de Stripe; los datos de tarjetas se procesan en el flujo de pago alojado por Stripe. El backend actual solo acepta credenciales de prueba de Stripe, por lo que la facturación real no está verificada.",
        },
        {
          heading: "Cookies, almacenamiento local y análisis",
          body: "La interfaz utiliza almacenamiento del navegador para sesiones de autenticación y preferencias de idioma o navegación. En el código de la aplicación revisado para este borrador no se encontró una integración de píxeles publicitarios o analíticos. Aún se deben verificar las cookies del proveedor de alojamiento y la configuración del navegador en producción.",
        },
        {
          heading: "Uso e intercambio de información",
          body: "La información se utiliza para autenticar cuentas, operar espacios de trabajo aislados, ofrecer las funciones solicitadas de contenido y análisis, procesar pagos, brindar soporte, proteger el servicio y cumplir obligaciones legales. Solo se envía a plataformas conectadas o proveedores cuando es necesario para una función o acción que inicias, y puede divulgarse cuando la ley lo exija.",
        },
        {
          heading: "Seguridad y conservación",
          body: "La aplicación utiliza autorización por espacio de trabajo, controles de acceso del servidor, rutas privadas para medios y cifrado de los tokens sociales almacenados. Estas medidas no constituyen una certificación ni una garantía. Aún se deben confirmar y documentar los períodos exactos de conservación, eliminación de bases de datos y copias de seguridad, retención de proveedores y controles del alojamiento de producción.",
        },
        {
          heading: "Opciones de privacidad y eliminación",
          body: "Puedes solicitar acceso, corrección, exportación o eliminación mediante el formulario de Contacto y soporte, seleccionando Privacidad y eliminación de datos. Debemos verificar tu identidad y autoridad antes de actuar. Algunos registros financieros, de seguridad o legalmente obligatorios podrían conservarse. La eliminación aquí no quita contenido publicado en una plataforma externa.",
        },
        {
          heading: "Contacto y actualizaciones",
          body: "Puedes enviar preguntas de privacidad desde la página de Contacto y soporte. Nazbort Tech LLC debe configurar el destinatario y proceso de atención antes del lanzamiento público. Las actualizaciones y fechas de vigencia requieren revisión del propietario y asesoría legal.",
        },
      ],
    },
  },
  terms: {
    en: {
      title: "Terms of Service",
      intro:
        "These draft terms describe proposed rules for AI Marketing Studio, operated by Nazbort Tech LLC. They are not effective terms; final business details and legal review are still required.",
      sections: [
        {
          heading: "Accounts and workspace responsibilities",
          body: "Provide accurate account information, protect your login credentials, and promptly report suspected unauthorized access. Workspace owners and administrators are responsible for managing members, connected accounts, and permissions. You may use only workspaces for which you have authorization.",
        },
        {
          heading: "Acceptable use",
          body: "Do not use the service for unlawful activity, fraud, spam, deceptive advertising, unauthorized access, infringement of another person's rights, or conduct that violates a connected platform's rules. Do not attempt to bypass tenant permissions, usage limits, or security controls.",
        },
        {
          heading: "Customer content and intellectual property",
          body: "You remain responsible for the content and materials you provide, including ensuring you have the rights and permissions needed to use them. The service must process submitted material to provide the features you request. The scope of any license, ownership of AI outputs, and handling of third-party intellectual property require final legal review before these terms become effective.",
        },
        {
          heading: "AI-generated content and human approval",
          body: "AI-generated text, images, analysis, and media can be inaccurate, incomplete, or unsuitable. You must review and approve content before it is published. A generated draft is not approval, and connecting a social account does not authorize an unrequested publication. Nazbort Tech LLC does not guarantee a specific audience, engagement, revenue, or marketing result.",
        },
        {
          heading: "Third-party integrations",
          body: "Facebook, Instagram, TikTok, OpenAI, HeyGen, Supabase, and Stripe are separate services with their own terms, availability, and privacy practices. You authorize integrations through those providers and remain responsible for complying with their rules. They may change permissions or features without notice.",
        },
        {
          heading: "Subscriptions, cancellation, and refunds",
          body: "Subscription price and renewal frequency must be shown before checkout. All subscription payments are non-refundable, except where required by applicable law. You may cancel to prevent future renewals; cancellation is complete only after Stripe confirms it. Continued access through the paid period depends on end-of-period cancellation being enabled and confirmed by Stripe and the account remaining in good standing. The current implementation is restricted to Stripe test mode; live billing and portal settings have not been verified.",
        },
        {
          heading: "Availability, suspension, and termination",
          body: "The service may be interrupted for maintenance, security, or third-party failures. The grounds and process for suspending or terminating an account, and the handling of customer data afterward, must be finalized by the owner and legal counsel. Subscription cancellation does not automatically delete an account or workspace.",
        },
        {
          heading: "Legal review required",
          body: "Governing law, dispute resolution, warranties, liability limits, indemnities, eligibility, and the final intellectual-property license are unresolved draft provisions. No governing jurisdiction or legal compliance certification is claimed here.",
        },
      ],
    },
    es: {
      title: "Términos del Servicio",
      intro:
        "Estos términos preliminares describen reglas propuestas para AI Marketing Studio, operado por Nazbort Tech LLC. No están vigentes; faltan datos comerciales definitivos y revisión legal.",
      sections: [
        {
          heading: "Cuentas y responsabilidades del espacio",
          body: "Proporciona información correcta, protege tus credenciales e informa si sospechas de un acceso no autorizado. Los propietarios y administradores deben gestionar miembros, cuentas conectadas y permisos. Solo puedes usar espacios para los que tengas autorización.",
        },
        {
          heading: "Uso aceptable",
          body: "No utilices el servicio para actividades ilegales, fraude, spam, publicidad engañosa, acceso no autorizado, infracción de derechos ajenos ni conductas que incumplan las reglas de una plataforma conectada. No intentes evadir permisos, límites de uso o controles de seguridad.",
        },
        {
          heading: "Contenido del cliente y propiedad intelectual",
          body: "Sigues siendo responsable del contenido y materiales que proporcionas, incluidos los derechos y permisos necesarios. El servicio debe procesar el material enviado para ofrecer las funciones solicitadas. El alcance de cualquier licencia, la titularidad de resultados de IA y el tratamiento de propiedad intelectual de terceros requieren revisión legal antes de que estos términos entren en vigor.",
        },
        {
          heading: "Contenido de IA y aprobación humana",
          body: "Los textos, imágenes, análisis y medios generados por IA pueden ser inexactos, incompletos o inadecuados. Debes revisar y aprobar el contenido antes de publicarlo. Generar un borrador no equivale a aprobarlo y conectar una cuenta social no autoriza publicaciones no solicitadas. Nazbort Tech LLC no garantiza alcance, interacción, ingresos ni resultados de marketing específicos.",
        },
        {
          heading: "Integraciones de terceros",
          body: "Facebook, Instagram, TikTok, OpenAI, HeyGen, Supabase y Stripe son servicios independientes con sus propias condiciones, disponibilidad y prácticas de privacidad. Autorizas las integraciones mediante esos proveedores y debes cumplir sus reglas. Pueden cambiar permisos o funciones sin previo aviso.",
        },
        {
          heading: "Suscripciones, cancelación y reembolsos",
          body: "El precio y la frecuencia de renovación deben mostrarse antes del pago. Todos los pagos de suscripción no son reembolsables, excepto cuando la ley aplicable lo exija. Puedes cancelar para evitar renovaciones futuras; la cancelación solo se completa cuando Stripe la confirma. El acceso hasta el final del período depende de que Stripe permita y confirme una cancelación al cierre del período y de que la cuenta esté al día. La implementación actual está limitada al modo de prueba de Stripe; no se han verificado la facturación real ni las opciones del portal.",
        },
        {
          heading: "Disponibilidad, suspensión y terminación",
          body: "El servicio puede interrumpirse por mantenimiento, seguridad o fallas de terceros. El propietario y asesor legal deben definir los motivos y procesos para suspender o terminar cuentas y el tratamiento posterior de los datos. Cancelar una suscripción no elimina automáticamente una cuenta o espacio.",
        },
        {
          heading: "Revisión legal requerida",
          body: "La legislación aplicable, resolución de disputas, garantías, límites de responsabilidad, indemnizaciones, elegibilidad y licencia definitiva de propiedad intelectual son disposiciones preliminares sin resolver. Aquí no se afirma una jurisdicción ni una certificación de cumplimiento.",
        },
      ],
    },
  },
  subscriptions: {
    en: {
      title: "Subscription & Cancellation Policy",
      intro:
        "This draft states the approved no-voluntary-refund business policy. Payment-provider settings and legal exceptions must be reviewed before this page is treated as an effective policy.",
      sections: [
        {
          heading: "Charges and renewal",
          body: "The checkout page must show the plan, price, billing frequency, and renewal terms before payment. The current application connects to Stripe Checkout and its Customer Portal, but its backend accepts test-mode Stripe credentials only. Live subscription purchase is therefore not operationally verified.",
        },
        {
          heading: "No-refund policy",
          body: "All subscription payments are non-refundable, except where required by applicable law. This includes payments already processed, unused time after cancellation, unused features or services, and non-use of the platform. This policy does not limit rights that cannot be waived under applicable law.",
        },
        {
          heading: "Cancel future renewals",
          body: "Customers can open Billing and choose Manage subscription to enter the Stripe Customer Portal when the provider portal is available. The portal must be configured to allow customers to cancel. A request is not complete until Stripe confirms the cancellation and the updated status is reflected in AI Marketing Studio. The exact portal configuration is external to this codebase and still needs owner verification.",
        },
        {
          heading: "Access after a confirmed cancellation",
          body: "When Stripe confirms cancellation at the end of the current paid period and the account remains in good standing, the application can retain active subscription access until the recorded period end. If Stripe reports an immediate cancellation, payment failure, or another status change, access follows the confirmed provider status and application rules. Verify the Stripe portal is configured for end-of-period cancellation before promising this outcome.",
        },
        {
          heading: "Cancellation is not account deletion",
          body: "Canceling a subscription stops future renewals when confirmed by Stripe; it does not automatically delete a personal account, business workspace, content, or social integrations. Submit a separate request through Contact & Support to ask about data deletion.",
        },
        {
          heading: "Legal exceptions and policy review",
          body: "Refunds or other remedies will be provided when required by applicable law. The governing jurisdiction, required consumer disclosures, tax handling, and final cancellation configuration must be reviewed by the owner and legal counsel before publication.",
        },
      ],
    },
    es: {
      title: "Política de Suscripciones y Cancelación",
      intro:
        "Este borrador expresa la política comercial aprobada de no ofrecer reembolsos voluntarios. La configuración de pagos y las excepciones legales deben revisarse antes de considerarla vigente.",
      sections: [
        {
          heading: "Cargos y renovación",
          body: "La página de pago debe mostrar el plan, precio, frecuencia y renovación antes del cobro. La aplicación se conecta a Stripe Checkout y al Portal de clientes, pero el backend solo acepta credenciales de prueba de Stripe. Por ello, la compra real de suscripciones no está verificada.",
        },
        {
          heading: "Política de no reembolso",
          body: "Todos los pagos de suscripción no son reembolsables, excepto cuando la ley aplicable lo exija. Esto incluye pagos procesados, tiempo no utilizado tras cancelar, funciones o servicios no utilizados y la falta de uso de la plataforma. Esta política no limita derechos irrenunciables según la ley aplicable.",
        },
        {
          heading: "Cancelar renovaciones futuras",
          body: "Cuando el portal del proveedor esté disponible, los clientes pueden abrir Facturación y seleccionar Administrar suscripción para ingresar al Portal de clientes de Stripe. El portal debe configurarse para permitir cancelar. La solicitud no se completa hasta que Stripe la confirme y el estado actualizado aparezca en AI Marketing Studio. La configuración exacta del portal es externa a este código y aún debe verificarla el propietario.",
        },
        {
          heading: "Acceso tras una cancelación confirmada",
          body: "Cuando Stripe confirma una cancelación al final del período pagado y la cuenta sigue al día, la aplicación puede conservar el acceso de suscripción hasta el fin del período registrado. Si Stripe informa una cancelación inmediata, falta de pago u otro cambio, el acceso sigue el estado confirmado y las reglas de la aplicación. Verifica que el portal de Stripe esté configurado para cancelar al final del período antes de prometerlo.",
        },
        {
          heading: "Cancelar no elimina la cuenta",
          body: "Una cancelación confirmada por Stripe detiene renovaciones futuras, pero no elimina automáticamente la cuenta personal, el espacio comercial, el contenido ni las integraciones sociales. Envía una solicitud separada por Contacto y soporte para consultar sobre eliminación de datos.",
        },
        {
          heading: "Excepciones legales y revisión",
          body: "Se proporcionarán reembolsos u otras soluciones cuando la ley aplicable lo exija. El propietario y asesor legal deben revisar la jurisdicción, avisos al consumidor, impuestos y configuración final de cancelación antes de publicar.",
        },
      ],
    },
  },
  "data-deletion": {
    en: {
      title: "Account & Data Deletion",
      intro:
        "Use this page to request review of personal-account or business-workspace deletion. Requests are handled manually; this page does not trigger an automatic or irreversible deletion.",
      sections: [
        {
          heading: "Request personal account deletion",
          body: "Use Contact & Support and select Privacy and data deletion. Submit the request from the email address associated with the account where possible. Do not include passwords, access tokens, or payment-card details.",
        },
        {
          heading: "Request business workspace deletion",
          body: "Identify the business workspace and confirm that you are its owner or otherwise authorized to request deletion. Workspaces may contain information belonging to other members; the operator must verify authority and consider their access before taking action.",
        },
        {
          heading: "What a review may cover",
          body: "A request may cover application account information, workspace details, members, campaigns, drafts, media stored in Supabase Storage, analytics records, and encrypted social credentials. The application has no automated account- or business-deletion workflow; an authorized operator must review and process each request.",
        },
        {
          heading: "Social integrations and published content",
          body: "Stored Facebook, Instagram, or TikTok credentials can be disconnected from the relevant workspace through its authorized settings. Removing a stored credential here does not necessarily revoke the app grant at the social provider. Content already published on an external platform may remain there and must be removed separately through that platform.",
        },
        {
          heading: "Subscriptions and records that may remain",
          body: "Subscription cancellation and deletion are separate. If the workspace has an active Stripe subscription, cancel future renewal through the Stripe Customer Portal first and wait for provider confirmation. Some billing, fraud-prevention, security, or legally required records may be retained. Exact retention periods and backup deletion timelines have not been established in this codebase.",
        },
        {
          heading: "Verification and completion",
          body: "The operator must verify account ownership, business authority, active work, and any legal retention requirement before deletion. We do not promise a processing deadline until the applicable legal requirements and operational process are confirmed. We will need to report any information that cannot be removed and why.",
        },
        {
          heading: "Meta Developer Dashboard URL",
          body: "The intended public instructions URL is https://studio.nazborttech.com/data-deletion. It must be deployed and verified publicly before it is entered in Meta Developer Dashboard. No automated Meta deletion callback is implemented; configure an instructions URL only where Meta permits it, and obtain owner approval before adding any callback that could trigger data changes.",
        },
      ],
    },
    es: {
      title: "Eliminación de Cuenta y Datos",
      intro:
        "Utiliza esta página para solicitar la revisión de eliminación de una cuenta personal o espacio comercial. Las solicitudes se procesan manualmente; esta página no inicia una eliminación automática o irreversible.",
      sections: [
        {
          heading: "Solicitar eliminación de cuenta personal",
          body: "Usa Contacto y soporte y selecciona Privacidad y eliminación de datos. Si es posible, envía la solicitud desde el correo asociado a la cuenta. No incluyas contraseñas, tokens ni datos de tarjetas.",
        },
        {
          heading: "Solicitar eliminación de un espacio comercial",
          body: "Identifica el espacio comercial y confirma que eres su propietario o que tienes autorización para solicitar la eliminación. Los espacios pueden contener información de otros miembros; el operador debe verificar la autoridad y considerar su acceso antes de actuar.",
        },
        {
          heading: "Qué puede incluir la revisión",
          body: "La solicitud puede incluir datos de cuenta, espacio comercial, miembros, campañas, borradores, medios guardados en Supabase Storage, análisis y credenciales sociales cifradas. La aplicación no tiene un flujo automático para eliminar cuentas o negocios; un operador autorizado debe revisar y procesar cada solicitud.",
        },
        {
          heading: "Integraciones sociales y publicaciones",
          body: "Las credenciales almacenadas de Facebook, Instagram o TikTok pueden desconectarse del espacio correspondiente desde sus ajustes autorizados. Eliminar una credencial aquí no necesariamente revoca el permiso general en la plataforma social. El contenido ya publicado en una plataforma externa puede permanecer allí y debe eliminarse por separado desde esa plataforma.",
        },
        {
          heading: "Suscripciones y registros que podrían conservarse",
          body: "Cancelar una suscripción y eliminar datos son acciones distintas. Si hay una suscripción activa de Stripe, cancela la renovación futura desde el Portal de clientes de Stripe y espera la confirmación del proveedor. Algunos registros financieros, de prevención de fraude, seguridad u obligaciones legales podrían conservarse. El código no define períodos exactos ni plazos de eliminación de copias de seguridad.",
        },
        {
          heading: "Verificación y finalización",
          body: "Antes de eliminar, el operador debe verificar la titularidad de la cuenta, autoridad sobre el negocio, operaciones activas y obligaciones legales de conservación. No prometemos un plazo hasta confirmar los requisitos y el proceso operativo. Informaremos qué datos no se puedan eliminar y por qué.",
        },
        {
          heading: "URL del Panel de Meta",
          body: "La URL pública prevista para estas instrucciones es https://studio.nazborttech.com/data-deletion. Debe desplegarse y verificarse públicamente antes de ingresarla en el Panel de Meta. No hay un callback automático de eliminación de Meta; configura una URL de instrucciones solo si Meta la admite y solicita aprobación del propietario antes de añadir callbacks que puedan cambiar datos.",
        },
      ],
    },
  },
};
