import type { Translation } from "../types";
import type en from "./en";

export default {
  "holdMenu.deleteTopic": "Excluir tópico",
  "holdMenu.deleteLesson": "Excluir aula",
  "holdMenu.deleteConversation": "Excluir conversa",
  "holdMenu.removeFromTopic": "Remover do tópico",
  "holdMenu.deleteArticle": "Excluir artigo",
  "holdMenu.deleteBook": "Excluir livro",
  "holdMenu.removeFromSaved": "Remover dos salvos",
  "holdMenu.deleteAside": "Excluir aparte",

  "holdMenu.confirmDeleteFileTitle": "Excluir “{title}”?",
  "holdMenu.confirmDeleteBookDescription":
    "Excluir este livro e tudo relacionado a ele, em todos os dispositivos? Suas notas pessoais continuam salvas.",
  "holdMenu.confirmDeleteArticleDescription":
    "Excluir este artigo e tudo relacionado a ele, em todos os dispositivos? Suas notas pessoais continuam salvas.",
  "holdMenu.delete": "Excluir",
  "holdMenu.confirmRemoveTitle": "Remover “{title}”?",
  "holdMenu.removeOthers": "Continua em {names}",
  "holdMenu.removeNoOthers": "Outro lugar ainda o lista, então ele continua",
  "holdMenu.removeBookDescription": "Este tópico perde o livro. {where}, com a posição de leitura e as marcações.",
  "holdMenu.removeArticleDescription": "Este tópico perde o artigo. {where}, com a posição de leitura e as marcações.",
  "holdMenu.remove": "Remover",
  "holdMenu.confirmConversationTitle": "Excluir esta conversa?",
  "holdMenu.confirmLessonDescription":
    "A aula é excluída, com seus apartes, em todos os dispositivos. O artigo continua, e a próxima aula começa do início.",
  "holdMenu.confirmConversationDescription":
    "Tudo o que foi dito sobre este livro é excluído, em todos os dispositivos. O livro, suas marcações e a posição de leitura continuam.",
  "holdMenu.confirmRemoveSavedDescription":
    "Ele sai dos salvos em todos os dispositivos. O resumo de onde veio não é alterado.",
  "holdMenu.confirmDeleteAsideDescription": "O aparte é excluído, com sua linha na aula. A aula em si continua.",

  "holdMenu.doneDeleted": "“{title}” excluído",
  "holdMenu.doneRemovedFromTopic": "Removido de {topicName}",
  "holdMenu.doneLessonDeleted": "Aula excluída",
  "holdMenu.doneConversationDeleted": "Conversa excluída",
  "holdMenu.doneRemovedFromSaved": "Removido dos salvos",
  "holdMenu.doneAsideDeleted": "Aparte excluído",

  "holdMenu.failedTopic": "Não foi possível excluir o tópico.",
  "holdMenu.failedFile": "Não foi possível excluir.",
  "holdMenu.failedRemoveFromTopic": "Não foi possível remover deste tópico.",
  "holdMenu.failedConversation": "Não foi possível excluir a conversa.",
  "holdMenu.failedRemoveSaved": "Não foi possível remover dos salvos.",

  "savedList.back": "Hoje",
  "savedList.count": { one: "{count} artigo salvo", other: "{count} artigos salvos" },
  "savedList.empty": "Ainda nada salvo.",
  "savedList.summaryOnly": "só resumo",

  "home.today": "Hoje",
  "home.briefingLabel": "O resumo de hoje",
  "home.mealsLabel": "Refeições",
  "home.mealsBlurb": "Os cafés da manhã, almoços e jantares desta semana, e o que comprar.",
  "home.open": "Abrir →",
  "home.savedLabel": "Salvos",
  "home.savedBlurb": "Artigos que você salvou, para ler quando quiser.",
  "home.savedCount": { one: "{count} artigo", other: "{count} artigos" },
  "home.savedEmpty": "Ainda nada salvo. Salve um artigo do resumo e ele vai esperar aqui.",
  "home.libraryLabel": "Biblioteca",
  "home.continueReading": "Continuar lendo · {topicName}",
  "home.libraryBlurb": "Seus tópicos, e os livros arquivados neles.",
  "home.allTopics": "Todos os tópicos",

  "newTopic.title": "Novo tópico",
  "newTopic.fieldLabel": "Nome do tópico",
  "newTopic.cancel": "Cancelar",
  "newTopic.create": "Criar",

  "shelf.libraryLabel": "Biblioteca",
  "shelf.backHome": "Início",
  "shelf.topicCount": { one: "{count} tópico", other: "{count} tópicos" },
  "shelf.newTopic": "Novo tópico",
  "shelf.noTopicsYet": "Ainda não há tópicos.",
  "shelf.created": "“{name}” criado",
  "shelf.createFailed": "Não foi possível criar o tópico.",
  "shelf.importing": "Importando…",
  "shelf.importEpub": "Importar EPUB",
  "shelf.nothingFiled": "Ainda nada arquivado aqui.",
  "shelf.lessonBadge": "Aula",
  "shelf.downloadFailed": "Não foi possível baixar este livro",
  "shelf.importFailed": "Não foi possível importar este livro",

  "shelfList.notConfigured": "Esta versão não tem uma conta do Google configurada, então não pode baixar o livro",
  "shelfList.signInToDownload": "Entre na sua conta em Ajustes para baixar este livro",
  "shelfList.notImported": "O desktop ainda não importou este arquivo, então não há nada para buscar",
  "shelfList.notFiledYet": "Este livro ainda não terminou de sincronizar com este dispositivo",
  "shelfList.downloading": "Baixando…",
  "shelfList.notImportedShort": "Não importado",
  "shelfList.inCloud": "Na nuvem",
  "shelfList.notSyncedYet": "Ainda não sincronizado",
  "shelfList.lessonNotStarted": "Não iniciada",
  "shelfList.lessonOn": "Em {title}",
  "shelfList.lessonInProgress": "Em uma aula",

  "reader.rendering": "Renderizando…",
  "reader.openFailed": "Não foi possível abrir este livro.",
  "reader.drawFailed": "Não foi possível desenhar este livro.",
  "reader.deleteMarkTitle": "Excluir esta marcação?",
  "reader.deleteMarkDescription":
    "A marcação desaparece, junto com a conversa aberta a partir dela. Isso não pode ser desfeito.",
  "reader.deleteMarkButton": "Excluir esta marcação",
  "reader.delete": "Excluir",

  "readerBar.backToShelf": "Voltar à estante",
  "readerBar.outline": "Sumário",
  "readerBar.display": "Exibição",
  "readerBar.learnThisBook": "Aprender este livro com a IA",
  "readerBar.dotWriting": " (uma resposta está sendo escrita)",
  "readerBar.dotUnseen": " (nova resposta)",

  "readerGate.aiPenNotOnPhone":
    "A caneta de IA ainda não chegou ao celular — Aprender este livro com a IA está na barra superior",

  "displaySheet.title": "Exibição",
  "displaySheet.size": "Tamanho",
  "displaySheet.smallerText": "Texto menor",
  "displaySheet.largerText": "Texto maior",
  "displaySheet.lineSpacing": "Espaçamento entre linhas",
  "displaySheet.margins": "Margens",
  "displaySheet.turnPages": "Virar páginas",
  "displaySheet.paper": "Papel",

  "outlineSheet.title": "Sumário",
  "outlineSheet.done": "Concluído",

  "lessonBar.backToShelf": "Voltar à estante",
  "lessonBar.chapters": "Capítulos",
  "lessonBar.openIn": "Abrir em…",

  "lessonIntro.title": "Este abre como uma aula",
  "lessonIntro.body1":
    "No celular, um PDF não é folheado página por página. Ele abre como uma aula: eu te guio pelo artigo em texto, citando-o com os números de página conforme avançamos.",
  "lessonIntro.body2":
    "Para ver as páginas em si — as figuras, as tabelas, a diagramação —, passe o arquivo para outro app com Abrir em…, ou leia no iPad.",
  "lessonIntro.body3": "Isso é dito só uma vez. Da próxima vez, este cartão vai direto para a aula.",
  "lessonIntro.start": "Começar a aula",
  "lessonIntro.openIn": "Abrir em…",

  "chapterSheet.title": "Capítulos",
  "chapterSheet.empty": "Este dispositivo ainda não tem a lista de capítulos deste artigo.",
  "chapterSheet.now": "Agora",

  "lessonView.chipDontFollowLabel": "Não entendi",
  "lessonView.chipDontFollowText": "Não entendi.",
  "lessonView.chipSkipLabel": "Pular",
  "lessonView.chipSkipText": "Pule esta parte.",
  "lessonView.continuingFrom": "Continuando de: {title}",
  "lessonView.now": "Agora: {title}",
  "lessonView.nowWithPage": "Agora: {title} · p.{page}",

  "bookLesson.backToPage": "Voltar à página",
  "bookLesson.retry": "Tentar de novo",
  "bookLesson.ariaLabel": "Aula",
  "bookLesson.placeholder": "Peça para eu te ensinar uma parte deste livro…",

  "lesson.backToLesson": "Voltar à aula",
  "lesson.aside": "Aparte",
  "lesson.placeholder": "Pergunte sobre o artigo…",
  "lesson.askAboutThis": "Perguntar sobre isso",

  "lessonCall.noProvider": "Configure um provedor em Ajustes e este artigo poderá ser ensinado.",
  "lessonCall.noThread": "A conversa deste artigo não pôde ser lida neste dispositivo.",
  "lessonCall.openFailed": "Não foi possível abrir este artigo.",

  "bookLessonHook.imageLimitHint": {
    one: "Você pode anexar até {count} imagem.",
    other: "Você pode anexar até {count} imagens.",
  },
  "bookLessonHook.threadsUnreadable": "As conversas com a IA salvas não puderam ser carregadas",

  "pullToAsk.releaseToAsk": "Solte para perguntar",

  "lessonStatus.downloading": "Baixando…",
  "lessonStatus.reading": "Lendo o artigo…",
  "lessonStatus.failedDownload": "Não foi possível baixar este artigo.",
  "lessonStatus.failedUnreadable": "Não foi possível ler este PDF.",
  "lessonStatus.failedNoText": "Este PDF é uma digitalização sem camada de texto, então não há nada para ensinar.",

  "lessonOpening.text":
    "Primeiro me dê o esqueleto deste artigo — quantas partes ele tem e o que cada uma trata, em uma só tela. Estou lendo no celular e não tenho as páginas na minha frente, então, para uma figura ou tabela, apenas diga o nome e a página; pode me contar o que diz a legenda. Depois, não me pergunte, me leve direto para a primeira parada.",
  "lessonOpening.takeMeToChapterTitle": "Me leve a {title}.",
  "lessonOpening.takeMeToPage": "Me leve à página {page}.",
  "lessonOpening.takeMeToChapterNumber": "Me leve ao capítulo {number}.",

  "displaySheet.lineTight": "Compacto",
  "displaySheet.lineStandard": "Padrão",
  "displaySheet.lineLoose": "Amplo",
  "displaySheet.marginsNarrow": "Estreitas",
  "displaySheet.marginsWide": "Largas",
  "displaySheet.paperWhite": "Branco",
  "displaySheet.paperPaper": "Papel",
  "displaySheet.paperGreen": "Verde",
  "displaySheet.paperDark": "Escuro",
} satisfies Translation<typeof en>;
