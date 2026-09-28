import type { Translation } from "../types";
import type en from "./en";

export default {
  "phase.thinking": "Pensando",

  "composer.removeImage": "Quitar imagen",
  "composer.switchToKeyboard": "Cambiar al teclado",
  "composer.switchToVoice": "Cambiar a voz",
  "composer.stop": "Detener",
  "composer.send": "Enviar",

  "dispatch.noRecord": "No hay registro de esto en este dispositivo.",
  "dispatch.backWithAnswer": "Ha vuelto con una respuesta.",
  "dispatch.stoppedBeforeFinished": "Se detuvo antes de terminar.",
  "dispatch.stoppedNoReason": "Se detuvo sin decir por qué.",
  "dispatch.stillOut": " — todavía en curso",
  "dispatch.needsDecision": " — necesita tu decisión",
  "dispatch.backSeeBelow": "De vuelta — ver más abajo",

  "list.copy": "Copiar",
  "list.copied": "Copiado",
  "list.attachment": "adjunto",
  "list.toolFailed": "falló",

  "toolLabel.readingPage": "Leyendo la página {page}",
  "toolLabel.readingPages": "Leyendo las páginas {from}–{to}",
  "toolLabel.readingThePages": "Leyendo las páginas",

  "conversations.searchingFor": "Buscando en conversaciones anteriores “{query}”",
  "conversations.searching": "Buscando en conversaciones anteriores",
  "conversations.readingBack": "Releyendo una conversación",

  "delegate.handingToKind": "Encargando esto a un trabajador de {kind}",
  "delegate.handingOver": "Encargando esto a un trabajador",
  "delegate.sentOffWork": "Encargo de {kind} enviado",

  "places.goingTo": "Yendo a {place}",
  "places.goingSomewhere": "Moviéndose dentro de la app",
  "places.wentSomewhere": "Se movió",

  "statements.writingSelf": "Anotando lo que dijiste sobre ti",
  "statements.wroteKind": "Se anotó un {kind}",
  "statements.rewroteKind": "Se reescribió un {kind}",

  "filing.proposingUnder": "Proponiendo incluir esto en {topic}",
  "filing.proposingWhere": "Proponiendo dónde va esto",
  "filing.proposedWhere": "Se propuso dónde va esto",

  "observations.searchingFor": "Buscando en sus observaciones “{query}”",
  "observations.searching": "Buscando en sus observaciones",
  "observations.reading": "Leyendo una observación",
  "observations.dropping": "Eliminando una observación",
  "observations.writing": "Anotando una observación",
  "observations.updating": "Actualizando una observación",
  "observations.wroteReceipt": "Se anotó una observación",
  "observations.addedEvidence": "Se añadió evidencia a una observación",
  "observations.droppedReceipt": "Se eliminó una observación",
  "observations.updatedReceipt": "Se actualizó una observación",

  "papers.searchingFor": "Buscando en la literatura “{query}”",
  "papers.searching": "Buscando en la literatura",
  "papers.lookingUpFor": "Buscando “{paper}”",
  "papers.lookingUp": "Buscando un artículo",
  "papers.walkingCitationsFor": "Recorriendo las citas de “{paper}”",
  "papers.walkingCitations": "Recorriendo las citas",

  "figures.lookingAtId": "Mirando la figura {id}",
  "figures.lookingAt": "Mirando una figura",

  "prep.searchingBookFor": "Buscando en el libro “{query}”",
  "prep.searchingBook": "Buscando en el libro",
  "prep.readingNote": "Leyendo la nota de un artículo",
  "prep.searchingPaperFor": "Buscando en el artículo “{query}”",
  "prep.searchingPaper": "Buscando en el artículo",
  "prep.takingInHost": "Incorporando {host}",
  "prep.takingInPage": "Incorporando una página",

  "saved.lookingThroughFor": "Buscando en lo que guardaste “{query}”",
  "saved.lookingThrough": "Revisando lo que guardaste",
  "saved.savingArticle": "Guardando el artículo",
  "saved.addedToPrepList": "Se añadió un artículo a la lista de lectura previa",
  "saved.keptArticles": "Artículos guardados",
} satisfies Translation<typeof en>;
