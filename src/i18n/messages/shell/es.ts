import type { Translation } from "../types";
import type en from "./en";

export default {
  "toast.cantOpenDownloading": "No se puede abrir — puede que la descarga no haya terminado.",
  "toast.cantOpenFile": "No se puede abrir este archivo — puede que se haya movido o eliminado.",
  "toast.cantReadFile": "No se puede leer este archivo — puede que se haya movido o eliminado.",
  "toast.asideGone": "Esa conversación paralela ya no existe.",
  "toast.conversationsUnloadable": "No se pudieron cargar las conversaciones de IA guardadas",
  "toast.cantShareFile": "No se pudo enviar este archivo a otra app.",

  "call.askAboutThisTitle": "Pregunta sobre esto",
  "call.askAboutThisPlaceholder": "Pregunta sobre esto…",
  "call.teachPlaceholder": "Pídeme que te enseñe parte de este libro…",
  "call.thisBookFallback": "Este libro",
  "call.configurePrompt": "Conecta un proveedor en Ajustes para empezar a chatear.",
  "call.openSettings": "Abrir Ajustes",
  "call.retry": "Reintentar",

  "action.dismiss": "Descartar",
  "action.cancel": "Cancelar",
  "action.delete": "Eliminar",

  "savedArticle.backLabel": "Guardado",

  "nav.settings": "Ajustes",
  "nav.settingsNeedsAttention": "Ajustes — la sincronización necesita atención",
  "sidebar.sections": "Secciones",
  "sidebar.expand": "Expandir barra lateral",
  "sidebar.collapse": "Contraer barra lateral",
  "sidebar.updating": "Actualizando…",
  "sidebar.restartToUpdate": "Reiniciar para actualizar",

  "lumen.show": "Mostrar Lumen",
  "lumen.hide": "Ocultar Lumen",
  "lumen.needsDecision": "Necesita una decisión",
  "lumen.holdForMenu": "Mantén pulsado para el menú de Lumen",
  "lumen.menuVoice": "Voz",
  "lumen.menuType": "Escribir",

  // Typing to Lumen: the day's conversation at the door (lumen/DoorChat.tsx).
  "door.title": "Lumen",
  "door.close": "Cerrar",
  "door.empty": "¿Qué tienes en mente?",
  "door.placeholder": "Escribe a Lumen…",
  "door.failed": "No se pudo iniciar esta respuesta.",

  "box.bookFallback": "Un libro",
  "box.originBookPage": "{book} · p. {page}",
  "box.originDoor": "En la puerta · {date}",
  "box.originBriefing": "Resumen · {date}",
  "box.originMeals": "Comidas",
  "box.label": "La bandeja",
  "box.waiting": { one: "La bandeja, {count} pendiente", other: "La bandeja, {count} pendientes" },
  "box.empty": "No hay nada en la bandeja.",
  "box.notReadable": "Esto está dentro de un libro. Ábrelo en el iPad o en el escritorio.",

  "figure.label": "Fig. {id} · p.{page}",
  "figure.number": "Fig. {id}",
  "figure.pageSuffix": "· p.{page}",
  "figure.notFound": "No hay ninguna figura {id} en este documento.",
  "figure.loading": "Cargando figura…",
  "figure.notRendered": "No se pudo mostrar esta figura.",
  "figure.rendering": "Generando la figura…",

  "peer.desktopMac": "el Mac",
  "peer.desktopWindows": "el PC con Windows",
  "peer.desktopLinux": "el equipo con Linux",
  "peer.desktopFallback": "el equipo",
  "peer.notice": "Tu {name} sigue en {version}. Abre Reading Partner allí para actualizar a {target}.",

  "sync.credentialsMissing":
    "La sincronización automática está activada, pero este dispositivo cerró sesión en Google — no se está sincronizando nada.",
  "sync.engineStopped":
    "La sincronización automática está activada, pero el motor de sincronización no se está ejecutando.",
  "sync.neverSynced": "Este dispositivo aún no ha completado ninguna sincronización.",
  "sync.neverSyncedWithError":
    "Este dispositivo aún no ha completado ninguna sincronización. Último error: {error}",
  "sync.stalled": "Ninguna sincronización se ha completado en más de un día.",
  "sync.stalledWithError": "Ninguna sincronización se ha completado en más de un día. Último error: {error}",
  "sync.lastFailed": "La última sincronización falló: {error}",

  "auth.notConfigured": "El cliente de Google no está configurado",
  "auth.tokenRequestFailed": "La solicitud de token de Google falló (HTTP {status}): {text}",
  "auth.redirectCaptureFailed": "El inicio de sesión de Google no pudo capturar la redirección: {error}",
  "auth.signInTimedOut": "El inicio de sesión de Google agotó el tiempo de espera de la redirección",
  "auth.authorizationError": "Error de autorización de Google: {error}",
  "auth.noRefreshToken":
    "Google no devolvió un token de actualización; prueba a quitar la app en myaccount.google.com y a iniciar sesión de nuevo.",

  "image.noCanvasContext": "No se pudo procesar la imagen (sin contexto de canvas).",
  "image.tooLarge": "La imagen sigue siendo muy grande tras comprimirla ({mb} MB, máximo 5 MB).",
  "image.decodeFailed": "No se pudo decodificar la imagen.",

  "nav.today": "Hoy",
  "nav.briefing": "Resumen",
  "nav.meals": "Comidas",
  "nav.topics": "Temas",
} satisfies Translation<typeof en>;
