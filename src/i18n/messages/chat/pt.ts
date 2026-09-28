import type { Translation } from "../types";
import type en from "./en";

export default {
  "phase.thinking": "Pensando",

  "composer.removeImage": "Remover imagem",
  "composer.switchToKeyboard": "Mudar para o teclado",
  "composer.switchToVoice": "Mudar para voz",
  "composer.stop": "Parar",
  "composer.send": "Enviar",

  "dispatch.noRecord": "Não há registro disso neste dispositivo.",
  "dispatch.backWithAnswer": "Voltou com uma resposta.",
  "dispatch.stoppedBeforeFinished": "Parou antes de terminar.",
  "dispatch.stoppedNoReason": "Parou sem dizer por quê.",
  "dispatch.stillOut": " — ainda em andamento",
  "dispatch.needsDecision": " — precisa da sua decisão",
  "dispatch.backSeeBelow": "De volta — ver abaixo",

  "list.copy": "Copiar",
  "list.copied": "Copiado",
  "list.attachment": "anexo",
  "list.toolFailed": "falhou",

  "toolLabel.readingPage": "Lendo a página {page}",
  "toolLabel.readingPages": "Lendo as páginas {from}–{to}",
  "toolLabel.readingThePages": "Lendo as páginas",

  "conversations.searchingFor": "Buscando “{query}” nas conversas anteriores",
  "conversations.searching": "Buscando nas conversas anteriores",
  "conversations.readingBack": "Relendo uma conversa",

  "delegate.handingToKind": "Passando isto para um trabalhador de {kind}",
  "delegate.handingOver": "Passando isto para um trabalhador",
  "delegate.sentOffWork": "Trabalho de {kind} enviado",

  "places.goingTo": "Indo para {place}",
  "places.goingSomewhere": "Movendo-se dentro do app",
  "places.wentSomewhere": "Foi para outro lugar",

  "statements.writingSelf": "Anotando o que você disse sobre si mesmo",
  "statements.wroteKind": "{kind} anotado",
  "statements.rewroteKind": "{kind} reescrito",

  "filing.proposingUnder": "Propondo colocar isto em {topic}",
  "filing.proposingWhere": "Propondo onde isto se encaixa",
  "filing.proposedWhere": "Proposta de onde isto se encaixa",

  "observations.searchingFor": "Buscando “{query}” nas observações",
  "observations.searching": "Buscando nas observações",
  "observations.reading": "Lendo uma observação",
  "observations.dropping": "Excluindo uma observação",
  "observations.writing": "Anotando uma observação",
  "observations.updating": "Atualizando uma observação",
  "observations.wroteReceipt": "Observação anotada",
  "observations.addedEvidence": "Evidência adicionada a uma observação",
  "observations.droppedReceipt": "Observação excluída",
  "observations.updatedReceipt": "Observação atualizada",

  "papers.searchingFor": "Buscando “{query}” na literatura",
  "papers.searching": "Buscando na literatura",
  "papers.lookingUpFor": "Procurando “{paper}”",
  "papers.lookingUp": "Procurando um artigo",
  "papers.walkingCitationsFor": "Percorrendo as citações de “{paper}”",
  "papers.walkingCitations": "Percorrendo as citações",

  "figures.lookingAtId": "Olhando a figura {id}",
  "figures.lookingAt": "Olhando uma figura",

  "prep.searchingBookFor": "Buscando “{query}” no livro",
  "prep.searchingBook": "Buscando no livro",
  "prep.readingNote": "Lendo a nota de um artigo",
  "prep.searchingPaperFor": "Buscando “{query}” no artigo",
  "prep.searchingPaper": "Buscando no artigo",
  "prep.takingInHost": "Importando {host}",
  "prep.takingInPage": "Importando uma página",

  "saved.lookingThroughFor": "Buscando “{query}” no que você salvou",
  "saved.lookingThrough": "Olhando o que você salvou",
  "saved.savingArticle": "Salvando o artigo",
  "saved.addedToPrepList": "Artigo adicionado à lista de preparo",
  "saved.keptArticles": "Artigos salvos",

  "call.preparing": "Preparando…",
  "call.preparingProgress": "Preparando {done}/{total}",
  "call.pageRange": "p. {first}-{last}",
  "call.page": "p. {page}",
  "call.pageBadge": "p. {page}",
  "call.clearFocus": "Remover foco do capítulo",
  "call.backToReading": "Voltar à leitura",
  "call.deleteConversation": "Apagar conversa",
  "call.deleteTitle": "Apagar esta conversa?",
  "call.deleteDescription": "A conversa será apagada, junto com a marcação a partir da qual foi aberta. Essa ação não pode ser desfeita.",
} satisfies Translation<typeof en>;
