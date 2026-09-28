import type { Translation } from "../types";
import type en from "./en";

// Brazilian Portuguese wording.
export default {
  "retell.materialsCount": { one: "{count} material", other: "{count} materiais" },
  "retell.noMaterials": "(sem materiais)",
  "retell.materialsJoin": "e",
  "retell.backToTopic": "Voltar ao tópico",
  "retell.renameTitle": "Renomear esta recontagem",
  "retell.renameDescription": "Só o nome muda. O roteiro e a conversa continuam como estão.",
  "retell.save": "Salvar",
  "retell.fallbackName": "Recontagem",
  "retell.rehearse": "Ensaiar",
  "retell.loading": "Carregando a recontagem…",
  "retell.composerPlaceholder": "Conte com suas próprias palavras…",
  "retell.backToRetell": "Voltar à recontagem",
  "retell.notReadable": "Não foi possível ler esta recontagem.",
  "retell.needProvider": "Configure um provedor em {settings} para começar a recontagem.",
  "retell.untitledDefault": "Recontagem sem título",
  "retell.namePlusMore": "{title} e mais {count}",

  "rehearsal.startingTitle": "Iniciando este ensaio…",
  "rehearsal.loadingTitle": "Procurando o roteiro desta palestra…",
  "rehearsal.emptyTitle":
    "Esta palestra ainda não tem conteúdo. Organize-a primeiro no fim da recontagem.",
  "rehearsal.readyTitle": "Fazer a palestra do começo",
  "rehearsal.openingNote": "Abrindo o texto…",
  "rehearsal.outlineMissing": "O roteiro desta palestra não está neste dispositivo.",
  "rehearsal.outlineReadError": "Não foi possível ler o roteiro",
  "rehearsal.elapsedTitle": "Há quanto tempo este ensaio está acontecendo",
  "rehearsal.starting": "Iniciando…",
  "rehearsal.start": "Iniciar o ensaio",
  "rehearsal.end": "Encerrar o ensaio",
  "rehearsal.noSegments":
    "Esta palestra ainda não tem conteúdo. Organize-a no fim da recontagem e depois ensaie.",

  "coach.fallbackName": "A palestra",
  "coach.subtitle": "Como foi esse ensaio",
  "coach.pendingNotice": "Recebendo do reconhecedor a última parte do que você disse…",
  "coach.loading": "Abrindo a palestra…",
  "coach.composerPlaceholder": "Pergunte como foi o ensaio, ou diga o que quer mudar…",
  "coach.needProvider": "Configure um provedor em {settings} para eu poder dizer como foi esse ensaio.",

  "talk.untitledDefault": "Palestra sem título",
  "talk.untitledSegment": "Bloco sem título",

  "tools.setSpine": "Definindo o fio condutor da palestra",
  "tools.setSpineDone": "Fio condutor da palestra definido",
  "tools.writeSegment": "Escrevendo um bloco da palestra",
  "tools.rewroteSegment": "Um bloco da palestra foi reescrito",
  "tools.addedSegment": "Um bloco foi adicionado à palestra",
  "tools.moveSegment": "Movendo um bloco da palestra",
  "tools.movedSegment": "Um bloco da palestra foi movido",
  "tools.removeSegment": "Removendo um bloco da palestra",
  "tools.droppedSegment": "Um bloco da palestra foi removido",
  "tools.readTalkOutline": "Lendo o roteiro da palestra",
  "tools.settlingChapter": "Definindo um capítulo",
  "tools.settlingChapterNum": "Definindo o capítulo {chapter}",
  "tools.keptChapter": "Um capítulo foi mantido",
  "tools.cutChapter": "Um capítulo foi descartado",
  "tools.readingChapterNote": "Lendo a nota de um capítulo",
  "tools.readingChapterNoteNum": "Lendo a nota do capítulo {chapter}",
  "tools.readRetellOutline": "Lendo o roteiro da recontagem",

  "budget.prepNotesTrimmed":
    "parte das minhas notas sobre os artigos de referência ficou de fora para abrir espaço",
  "budget.marksTrimmed":
    "aqui suas marcações foram encurtadas para caber; peça para eu trazer as de um capítulo por inteiro que eu leio de novo",
  "budget.historyTrimmedRetell": "o início desta conversa ficou de fora para abrir espaço",
  "budget.passesTrimmed": "ensaios anteriores desta palestra ficaram de fora para abrir espaço",

  "rows.retellNotYet": "De uma recontagem · ainda sem ensaio",
  "rows.retellCount": {
    one: "De uma recontagem · {count} ensaio",
    other: "De uma recontagem · {count} ensaios",
  },
  "rows.broughtInNotYet": "Criada à parte · ainda sem ensaio",
  "rows.broughtInCount": {
    one: "Criada à parte · {count} ensaio",
    other: "Criada à parte · {count} ensaios",
  },
} satisfies Translation<typeof en>;
