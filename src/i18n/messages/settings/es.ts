import type { Translation } from "../types";
import type en from "./en";

export default {
  title: "Ajustes",
  done: "Listo",
  "tab.account": "Cuenta",
  "tab.features": "Funciones",
  "tab.optional": "Opcional",
  connected: "Conectado",
  save: "Guardar",
  signOut: "Cerrar sesión",
  apiKey: "Clave de API",

  "thinking.off": "Desactivado",
  "thinking.low": "Bajo",
  "thinking.medium": "Medio",
  "thinking.high": "Alto",

  "account.providers": "Proveedores",
  "account.signInWith": "Iniciar sesión con {name}",
  "account.defaultConversation": "Conversación predeterminada",
  "account.connectFirst": "Conecta un proveedor arriba para elegir uno predeterminado.",
  "account.provider": "Proveedor",
  "account.model": "Modelo",
  "account.select": "Seleccionar…",
  "account.contextHint":
    "El número junto a cada modelo es su ventana de contexto. Esta app mete un libro entero en ella; con una ventana más pequeña, la respuesta recorta material para que quepa y dice qué ha recortado.",
  "account.everydayModel": "Modelo para tareas rutinarias",
  "account.sameAsChat": "Igual que el chat",
  "account.everydayHint":
    "El trabajo rutinario se ejecuta aquí en lugar de en el modelo de arriba: las comidas y el resumen nocturno. Nadie lo está esperando, así que un modelo más barato no te cuesta nada; qué tareas le corresponden lo decide la app, no este ajuste. Usa el proveedor de arriba.",
  "account.briefing": "Resumen de noticias",
  "account.screening": "Filtrado",
  "account.analysis": "Análisis",
  "account.briefingHint":
    "El resumen se prepara por la noche a partir de todas las fuentes, lo leas o no. El filtrado lee los titulares del día para decidir qué artículos merece la pena descargar, así que conviene mantenerlo bajo; el análisis lee los que pasan.",
  "account.thinking": "Razonamiento",
  "account.chat": "Chat",
  "account.lessonPrep": "Preparación de clases",
  "account.thinkingHint":
    "Los modelos adaptativos deciden en cada pregunta cuánto razonar de verdad; más alto = más profundo pero más lento.",
  "account.sync": "Sincronización",

  "oauth.signInFailed": "No se pudo iniciar sesión",
  "oauth.openFailed": "No se pudo abrir la página de inicio de sesión",
  "oauth.invalidCode": "Código no válido",
  "oauth.pasteHintDevice":
    "Después de iniciar sesión, copia la barra de direcciones (la URL de localhost que no carga) y pégala aquí.",
  "oauth.pasteHintCode": "Pega el código que aparece después de aprobar el acceso.",
  "oauth.opening": "Abriendo la página de inicio de sesión…",
  "oauth.completeInBrowser": "Completa la autorización en tu navegador…",
  "oauth.withCode": "Iniciar sesión con un código",
  "oauth.pastePlaceholder": "Pega el código o la URL de inicio de sesión",
  "oauth.submit": "Enviar",
  "oauth.signsOutOthers": "Iniciar sesión aquí cierra la sesión de los demás proveedores.",
  "oauth.requestingCode": "Solicitando un código de inicio de sesión…",
  "oauth.openPage": "Abrir página de inicio de sesión",
  "oauth.enterCode": "Introduce este código en {url}. Esperando la autorización…",
  "oauth.cancel": "Cancelar",
  "oauth.pasteInstead": "Pegar la URL de inicio de sesión",
  "oauth.tryAgain": "Reintentar",

  "key.replace": "Reemplazar clave de API",
  "key.signsOutOthers": "Guardar una clave aquí cierra la sesión de los demás proveedores.",

  "sync.drive": "Google Drive",
  "sync.never": "Nunca",
  "sync.justNow": "Ahora mismo",
  "sync.minutesAgo": { one: "Hace {count} minuto", other: "Hace {count} minutos" },
  "sync.failed": "Error en la sincronización",
  "sync.notConfigured": "El cliente de Google no está configurado.",
  "sync.signIn": "Iniciar sesión con Google",
  "sync.signedOutNote":
    "Todo lo que ha cambiado desde la última sincronización está solo en este dispositivo. Vuelve a iniciar sesión para reanudarla; no se pierde nada local.",
  "sync.pitch": "Sincroniza el progreso de lectura, las marcas y los libros con tu propio Google Drive.",
  "sync.completeInBrowser": "Completa el inicio de sesión en tu navegador…",
  "sync.lastSync": "Última sincronización: {time}",
  "sync.auto": "Sincronizar automáticamente",
  "sync.running": "Sincronizando…",
  "sync.now": "Sincronizar ahora",

  "features.general": "General",
  "features.language": "Idioma",
  "features.languageAuto": "Automático (app: sistema; IA: tu idioma)",
  "features.languageHint":
    "El idioma de la app y de todo lo que escribe la IA: respuestas del chat, notas y el resumen de noticias. En automático, la app usa el idioma del sistema y la IA responde en el idioma en que escribes. La transcripción de voz siempre sigue lo que dices.",
  "features.paper": "Fondo de papel",
  "features.paperHint":
    "Convierte el blanco de toda la app (chats, estanterías, barras laterales, este cuadro de diálogo y las páginas de los libros) en un color de papel hueso. Hay un solo tono y ninguno más oscuro; no es un modo oscuro. La elección se guarda solo en este dispositivo.",
  "features.reading": "Lectura",
  "features.fingerDraw": "Dibujar con el dedo",
  "features.fingerDrawHint":
    "Desactivado, el dedo solo mueve la página y el lápiz hace las marcas, sea cual sea la herramienta elegida. Actívalo en un dispositivo sin lápiz, donde el dedo tiene que poder resaltar y dibujar. El bloqueo de navegación del lector sigue teniendo prioridad sobre ambos. Tener lápiz o no es propio de cada dispositivo, así que este ajuste se queda en él.",
  "features.lumen": "Mostrar a Lumen",
  "features.lumenHint":
    "Lumen está en la esquina de cada pantalla, también en el lector. Desactivado, la esquina queda vacía; el botón de Lumen en la barra lateral, en la pantalla de inicio del móvil y en el menú Más del lector lo trae de vuelta. La elección se queda en este dispositivo.",
  "features.briefing": "Resumen de noticias",
  "features.collect": "Recopilar de tus fuentes en este ordenador",
  "features.collectHint":
    "Cada fuente se consulta según su propio horario y lo que publica se guarda hasta que se prepara el resumen del día. Desactivado, este equipo deja de recopilar por completo y otro recopilador, si lo tienes, toma el relevo.",
  "features.thisComputer": "Este ordenador",
  "features.role": "Este equipo es un",
  "features.roleCollector": "Recopilador: lee las fuentes aquí",
  "features.roleReader": "Lector: lee lo que recopiló otro equipo",
  "features.roleHint":
    "Un recopilador lee tus sitios suscritos todo el día y publica el resumen para tus otros dispositivos; un lector muestra lo que publicó un recopilador y nunca descarga nada de un sitio por su cuenta. Los teléfonos y las tabletas son siempre lectores. Si dos equipos recopilan, trabaja el que lleva más tiempo en marcha.",
  "features.autostart": "Abrir Reading Partner al iniciar este ordenador",
  "features.autostartHint":
    "Desactivado de forma predeterminada. Actívalo en el equipo que quieras que recopile tus fuentes todo el día: junto con el icono de la bandeja, el resumen se prepara tanto si abres la app como si no. Este ajuste es de este ordenador y no pasa a tus otros dispositivos.",

  "optional.intro":
    "Claves para servicios externos, todas opcionales. Las dos claves de voz se guardan con las credenciales de este dispositivo y nunca se sincronizan, así que cada dispositivo necesita las suyas.",
  "optional.meals": "Comidas",
  "optional.mealsHint":
    "Planifica los desayunos, almuerzos y cenas de la semana, lleva la lista de la compra y avisa cuando hayas comido otra cosa.",
  "optional.lessonPrep": "Preparación de clases",
  "optional.s2Key": "Clave de API de Semantic Scholar",
  "optional.s2Placeholder": "Opcional",
  "optional.s2Hint":
    "Una clave gratuita de semanticscholar.org evita los límites de uso compartidos que atascan la descarga de artículos.",
  "optional.voiceInput": "Entrada de voz",
  "optional.voiceOutput": "Salida de voz",
  "optional.dictationLanguage": "Idioma del dictado",
  "optional.dictationHint":
    "El idioma que escucha el iPhone cuando mantienes pulsada la barra y hablas. La voz se transcribe en el teléfono y nunca se sube. Hablar en otro idioma no da una transcripción aproximada, sino una equivocada que parece correcta, así que elige el idioma que de verdad hablas.",
  "optional.speechKey": "Clave de API de voz",
  "optional.speechKeyReplace": "Reemplazar clave de API de voz",
  "optional.speechHint":
    "Una clave de Xiaomi MiMo, para la voz que lee las respuestas en voz alta. Sin ella la app no habla y todo lo demás funciona igual que ahora.",
  "optional.sttKey": "Clave de API de STT",
  "optional.sttKeyReplace": "Reemplazar clave de API de STT",
  "optional.model": "Modelo",
  "optional.baseUrl": "URL base",
  "optional.sttHint":
    "Mantén pulsado el micrófono en el cuadro de chat para hablar. El plan SenseVoice de SiliconFlow es gratuito y su clave de API funciona sin más; también sirve cualquier servicio de transcripción compatible con OpenAI.",
} satisfies Translation<typeof en>;
