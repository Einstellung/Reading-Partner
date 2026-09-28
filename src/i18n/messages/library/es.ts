import type { Translation } from "../types";
import type en from "./en";

const es: Translation<typeof en> = {
  "count.books": { one: "{count} libro", other: "{count} libros" },
  "count.articles": { one: "{count} artículo", other: "{count} artículos" },
  "count.topics": { one: "{count} tema", other: "{count} temas" },
  "count.files": { one: "{count} archivo", other: "{count} archivos" },
  "count.marks": { one: "{count} marca", other: "{count} marcas" },
  "count.observations": { one: "{count} observación", other: "{count} observaciones" },
  "count.messages": { one: "{count} mensaje", other: "{count} mensajes" },
  "count.conflictCopies": { one: "{count} copia en conflicto", other: "{count} copias en conflicto" },
  "count.booksAndArticles": "{books} y {articles}",

  "time.today": "hoy",
  "time.yesterday": "ayer",
  "time.daysAgo": { one: "hace {count} día", other: "hace {count} días" },
  "time.weeksAgo": { one: "hace {count} semana", other: "hace {count} semanas" },
  "time.monthsAgo": { one: "hace {count} mes", other: "hace {count} meses" },
  "time.yearsAgo": { one: "hace {count} año", other: "hace {count} años" },

  "header.lastRead": "última lectura {when}",

  "shelf.readPercent": "Leído {percent}%",
  "shelf.page": "Página {page}",
  "shelf.notOpened": "Sin abrir todavía",
  "shelf.noFiles": "Sin archivos",

  "deleteTitle": "¿Eliminar “{name}”?",
  "deleteFailed": "No se pudo eliminar “{name}”",

  "card.actionsFor": "Acciones para {name}",
  "card.remove": "Quitar",
  "card.rename": "Renombrar",
  "card.delete": "Eliminar",
  "card.retell": "Recontar este libro…",

  "topics.eyebrow": "Tus temas",
  "topics.title": "Temas",
  "topics.blurb": "Un tema es una pregunta y los libros que lees para responderla.",
  "topics.newTopicButton": "+ Nuevo tema",
  "topics.emptyTitle": "El estante todavía está vacío",
  "topics.emptyBlurb":
    "Un tema es una pregunta y los libros que lees para responderla. Define primero la pregunta; los PDF se añaden después.",
  "topics.emptyAction": "Nuevo tema",
  "topics.createTitle": "Nuevo tema",
  "topics.createConfirm": "Crear",
  "topics.placeholder": "p. ej. qué hace rápidos a los JIT",
  "topics.renameTitle": "Renombrar tema",
  "topics.renameDescription": "Solo cambia el nombre. La lista de lectura sigue igual.",
  "topics.renameConfirm": "Guardar",

  "materials.emptyTitle": "Este tema todavía no tiene libros",
  "materials.emptyBlurb": "Añade los libros que quieras leer para este tema. Se leen donde están; no se copian ni se mueven.",
  "materials.addBook": "Añadir libro",
  "materials.savedArticlesHeading": "Artículos guardados",
  "materials.removeArticleTitle": "¿Quitar “{title}”?",
  "materials.removeArticleDescription":
    "El artículo se quita de tus artículos guardados. Volver a guardarlo desde un resumen lo trae de vuelta.",
  "materials.removeArticleAction": "Quitar",
  "materials.deleteBookTitle": "¿Eliminar “{title}”?",
  "materials.removeBookTitle": "¿Quitar “{title}”?",
  "materials.deleteBookDescription": "¿Eliminar este libro y todo lo relacionado con él? Tus notas sobre ti mismo se conservan.",
  "materials.removeBookDescription":
    "El tema pierde el libro. El archivo se queda en el disco, y también su posición de lectura y sus marcas: si lo vuelves a añadir, las recupera.",
  "materials.deleteBookAction": "Eliminar",
  "materials.removeBookAction": "Quitar",

  "screen.backToTopics": "‹ Todos los temas",
  "screen.addBook": "+ Añadir libro",
  "screen.backToTopicLabel": "Volver al tema",
  "screen.removeFileFailed": "No se pudo quitar el libro de este tema",
  "screen.deleteBookFailed": "No se pudo eliminar el libro",
  "screen.removeArticleFailed": "No se pudo quitar el artículo",

  "topicDelete.onlyCaption": "Solo en este tema",
  "topicDelete.description":
    "El tema desaparece, en todos los dispositivos, junto con los recuentos, charlas y ensayos hechos en él.",
  "topicDelete.articlesMoveNote": "Los artículos guardados aquí pasan a Interesante.",
  "topicDelete.sharedOneBook": "Un libro también está archivado en otro tema y permanecerá allí.",
  "topicDelete.sharedOneArticle": "Un artículo también está archivado en otro tema y permanecerá allí.",
  "topicDelete.sharedMany": "{tally} también están archivados en otros temas y permanecerán allí.",
  "topicDelete.checkOneBook": "Eliminar también este libro",
  "topicDelete.checkOneArticle": "Eliminar también este artículo",
  "topicDelete.checkMany": "Eliminar también estos {tally}",
  "topicDelete.action": "Eliminar",
  "topicDelete.actionOneBook": "Eliminar tema y libro",
  "topicDelete.actionOneArticle": "Eliminar tema y artículo",
  "topicDelete.actionAll": { one: "Eliminar tema y el {count} elemento", other: "Eliminar tema y los {count} elementos" },
  "topicDelete.doneNone": "Se eliminó “{name}”",
  "topicDelete.doneOne": "Se eliminó “{name}” y {tally}",
  "topicDelete.doneMany": "Se eliminó “{name}”, {tally}",
  "topicDelete.kindArticle": "Artículo",

  "rehearsal.goneError": "Ese ensayo ya no está",
  "rehearsal.noTalkError": "Esa charla no tiene nada que ensayar",
  "rehearsal.openFailed": "No se pudo abrir el ensayo",
  "rehearsal.emptyBlurb":
    "Todavía no hay nada que ensayar aquí. Una charla aparece aquí en cuanto un recuento la organiza, y cada pasada sobre ella se guarda, para que la siguiente tenga algo con que compararse.",
  "rehearsal.howItWent": "Cómo fue",
  "rehearsal.rehearseButton": "Ensayar",
  "rehearsal.deleteMenuItem": "Eliminar este ensayo",
  "rehearsal.deleteDescription":
    "Cada pasada de esta charla desaparece con él. La charla en sí se queda donde está, y puedes volver a ensayarla desde el recuento.",

  "retell.startFailed": "No se pudo iniciar el recuento",
  "retell.emptyBlurb":
    "Todavía no hay recuentos. Un recuento es algo que preparas para contar a partir de lo que has leído aquí: lo repasas capítulo a capítulo con la IA, y el resultado es el esquema del recuento.",
  "retell.newRetellButton": "Nuevo recuento",
  "retell.deleteMenuItem": "Eliminar este recuento",
  "retell.deleteDescription":
    "El recuento desaparece, junto con el esquema que fijaste y todos los ensayos de su charla. Los libros, sus marcas y sus notas quedan intactos.",
  "retell.pickDescription":
    "Un recuento se prepara repasando lo que has leído, capítulo a capítulo, y fijando qué aporta. Elige de qué trata.",
  "retell.noCandidates": "Todavía no hay nada que recontar: abre primero un libro en este tema.",
  "retell.cancel": "Cancelar",
  "retell.start": "Empezar",

  "loading": "Cargando…",

  "observations.heading": "Observaciones de la IA",
  "observations.lastDistilled": "Última destilación {date}",
  "observations.noDistillation": "Todavía no se ha hecho ninguna destilación.",
  "observations.empty": "Todavía no se ha observado nada. Las observaciones se destilan al terminar una conversación.",
  "observations.footer": "Las observaciones las mantiene la IA. Si alguna no es correcta, dilo en una conversación.",
  "observations.aboutYou": "Sobre ti",
  "observations.lastSupported": "último respaldo {date}",
  "observations.fromEvidence": "de {evidence}",
  "observations.updated": "actualizado {date}",
  "observations.evidenceLabel": "Evidencia:",
  "observations.evidenceAnnotation": "anotación {id}",
  "observations.evidenceMessage": "mensaje {id}",
  "observations.conflictNotice":
    "{copies} de la sincronización. Dos dispositivos cambiaron la misma observación; la versión perdedora se guarda junto a ella.",
  "observations.conflictUnreadable": "(esta copia no se pudo leer; abre el archivo para verla)",
  "observations.typeReadingPosition": "posición de lectura",
  "observations.typeStuckPoint": "punto atascado",
  "observations.typeCannotExplain": "no puede explicarlo",
  "observations.typeCanExplain": "puede explicarlo",
  "observations.typeUnderstoodConcept": "concepto entendido",
  "observations.typeBelief": "creencia",
  "observations.typeCorrection": "corrección",

  "statement.youSaid": "Tú dijiste",
  "statement.concluded": "Se concluyó",
  "statement.evidenceBoth": "{observations}, {messages}",
  "statement.kindProfile": "perfil",
  "statement.kindConcern": "inquietud",

  "section.navLabel": "Tema",
  "section.materials": "Materiales",
  "section.retell": "Recuento",
  "section.rehearsal": "Ensayo",
  "section.observations": "Observaciones de la IA",

  "savedArticle.backDefault": "Tema",
  "savedArticle.summaryOnlyNote": "Nunca se obtuvo el texto completo de este artículo. Lo que sigue es solo un resumen.",
  "savedArticle.noBody": "No se guardó ningún cuerpo con este artículo.",
};

export default es;
