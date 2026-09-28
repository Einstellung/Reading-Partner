import type { Translation } from "../types";
import type en from "./en";

export default {
  "retell.materialsCount": { one: "{count} material", other: "{count} materiales" },
  "retell.noMaterials": "(sin materiales)",
  "retell.materialsJoin": "y",
  "retell.backToTopic": "Volver al tema",
  "retell.renameTitle": "Cambiar el nombre de esta narración",
  "retell.renameDescription":
    "Solo cambia el nombre. El esquema y la conversación se quedan como están.",
  "retell.save": "Guardar",
  "retell.fallbackName": "Narración",
  "retell.rehearse": "Ensayar",
  "retell.loading": "Cargando la narración…",
  "retell.composerPlaceholder": "Cuéntalo con tus propias palabras…",
  "retell.backToRetell": "Volver a la narración",
  "retell.notReadable": "No se pudo leer esta narración.",
  "retell.needProvider": "Configura un proveedor en {settings} para empezar la narración.",
  "retell.untitledDefault": "Narración sin título",
  "retell.namePlusMore": "{title} y {count} más",

  "rehearsal.startingTitle": "Iniciando este ensayo…",
  "rehearsal.loadingTitle": "Buscando el esquema de esta charla…",
  "rehearsal.emptyTitle":
    "Esta charla todavía no tiene contenido. Organízala primero al final de la narración.",
  "rehearsal.readyTitle": "Dar la charla desde el principio",
  "rehearsal.openingNote": "Abriendo el guion…",
  "rehearsal.outlineMissing": "El esquema de esta charla no está en este dispositivo.",
  "rehearsal.outlineReadError": "No se pudo leer el esquema",
  "rehearsal.elapsedTitle": "Cuánto lleva este ensayo",
  "rehearsal.starting": "Iniciando…",
  "rehearsal.start": "Iniciar el ensayo",
  "rehearsal.end": "Terminar el ensayo",
  "rehearsal.noSegments":
    "Esta charla todavía no tiene contenido. Organízala al final de la narración y luego ensáyala.",

  "coach.fallbackName": "La charla",
  "coach.subtitle": "Cómo fue ese ensayo",
  "coach.pendingNotice": "Recibiendo del reconocedor lo último que dijiste…",
  "coach.loading": "Abriendo la charla…",
  "coach.composerPlaceholder": "Pregunta cómo fue el ensayo, o di qué quieres cambiar…",
  "coach.needProvider":
    "Configura un proveedor en {settings} para poder decirte cómo fue ese ensayo.",

  "talk.untitledDefault": "Charla sin título",
  "talk.untitledSegment": "Bloque sin título",

  "tools.setSpine": "Definiendo el eje de la charla",
  "tools.setSpineDone": "Se definió el eje de la charla",
  "tools.writeSegment": "Escribiendo un bloque de la charla",
  "tools.rewroteSegment": "Se reescribió un bloque de la charla",
  "tools.addedSegment": "Se añadió un bloque a la charla",
  "tools.moveSegment": "Moviendo un bloque de la charla",
  "tools.movedSegment": "Se movió un bloque de la charla",
  "tools.removeSegment": "Quitando un bloque de la charla",
  "tools.droppedSegment": "Se quitó un bloque de la charla",
  "tools.readTalkOutline": "Leyendo el esquema de la charla",
  "tools.settlingChapter": "Decidiendo un capítulo",
  "tools.settlingChapterNum": "Decidiendo el capítulo {chapter}",
  "tools.keptChapter": "Se conservó un capítulo",
  "tools.cutChapter": "Se descartó un capítulo",
  "tools.readingChapterNote": "Leyendo la nota de un capítulo",
  "tools.readingChapterNoteNum": "Leyendo la nota del capítulo {chapter}",
  "tools.readRetellOutline": "Leyendo el esquema de la narración",

  "budget.prepNotesTrimmed":
    "dejé fuera parte de mis notas sobre los artículos de referencia para hacer espacio",
  "budget.marksTrimmed":
    "aquí acorté tus marcas para que quepan; pídeme que te traiga las de un capítulo completas y las vuelvo a leer",
  "budget.historyTrimmedRetell": "dejé fuera parte de esta conversación para hacer espacio",
  "budget.passesTrimmed": "dejé fuera ensayos anteriores de esta charla para hacer espacio",

  "rows.retellNotYet": "Desde una narración · sin ensayar todavía",
  "rows.retellCount": {
    one: "Desde una narración · {count} ensayo",
    other: "Desde una narración · {count} ensayos",
  },
  "rows.broughtInNotYet": "Creada aparte · sin ensayar todavía",
  "rows.broughtInCount": {
    one: "Creada aparte · {count} ensayo",
    other: "Creada aparte · {count} ensayos",
  },
} satisfies Translation<typeof en>;
