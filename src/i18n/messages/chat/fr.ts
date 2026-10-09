import type { Translation } from "../types";
import type en from "./en";

export default {
  "phase.thinking": "Réflexion en cours",

  "composer.removeImage": "Supprimer l’image",
  "composer.switchToKeyboard": "Revenir au clavier",
  "composer.switchToVoice": "Passer en vocal",
  "composer.stop": "Arrêter",
  "composer.send": "Envoyer",
  "call.reply": "Répondre…",

  "dispatch.noRecord": "Aucune trace de cela sur cet appareil.",
  "dispatch.backWithAnswer": "De retour avec une réponse.",
  "dispatch.stoppedBeforeFinished": "S’est arrêté avant la fin.",
  "dispatch.stoppedNoReason": "S’est arrêté sans dire pourquoi.",
  "dispatch.stillOut": " — toujours en cours",
  "dispatch.needsDecision": " — attend votre décision",
  "dispatch.backSeeBelow": "De retour — voir ci-dessous",

  "list.copy": "Copier",
  "list.copied": "Copié",
  "list.attachment": "pièce jointe",
  "list.toolFailed": "échec",
  "list.jumpToLatest": "Aller au plus récent",

  "toolLabel.readingPage": "Lecture de la page {page}",
  "toolLabel.readingPages": "Lecture des pages {from} à {to}",
  "toolLabel.readingThePages": "Lecture des pages",

  "conversations.searchingFor": "Recherche « {query} » dans les conversations passées",
  "conversations.searching": "Recherche dans les conversations passées",
  "conversations.readingBack": "Relecture d’une conversation",

  "delegate.handingToKind": "Confié à un agent {kind}",
  "delegate.handingOver": "Confié à un agent",
  "delegate.sentOffWork": "Travail {kind} envoyé",

  "places.goingTo": "Direction {place}",
  "places.goingSomewhere": "Déplacement dans l’app",
  "places.wentSomewhere": "Déplacement effectué",

  "statements.writingSelf": "Note de ce que vous avez dit sur vous-même",
  "statements.wroteKind": "{kind} noté",
  "statements.rewroteKind": "{kind} réécrit",

  "filing.proposingUnder": "Proposition de classer ceci sous {topic}",
  "filing.proposingWhere": "Proposition d’un classement",
  "filing.proposedWhere": "Classement proposé",

  "observations.searchingFor": "Recherche « {query} » dans ses observations",
  "observations.searching": "Recherche dans ses observations",
  "observations.reading": "Lecture d’une observation",
  "observations.dropping": "Suppression d’une observation",
  "observations.writing": "Enregistrement d’une observation",
  "observations.updating": "Mise à jour d’une observation",
  "observations.wroteReceipt": "Observation enregistrée",
  "observations.addedEvidence": "Preuve ajoutée à une observation",
  "observations.droppedReceipt": "Observation supprimée",
  "observations.updatedReceipt": "Observation mise à jour",

  "papers.searchingFor": "Recherche « {query} » dans la littérature",
  "papers.searching": "Recherche dans la littérature",
  "papers.lookingUpFor": "Recherche de « {paper} »",
  "papers.lookingUp": "Recherche d’un article",
  "papers.walkingCitationsFor": "Parcours des citations de « {paper} »",
  "papers.walkingCitations": "Parcours des citations",

  "figures.lookingAtId": "Consultation de la figure {id}",
  "figures.lookingAt": "Consultation d’une figure",

  "prep.searchingBookFor": "Recherche « {query} » dans le livre",
  "prep.searchingBook": "Recherche dans le livre",
  "prep.readingNote": "Lecture de la note sur un article",
  "prep.searchingPaperFor": "Recherche « {query} » dans l’article",
  "prep.searchingPaper": "Recherche dans l’article",
  "prep.takingInHost": "Récupération de {host}",
  "prep.takingInPage": "Récupération d’une page",

  "saved.lookingThroughFor": "Recherche « {query} » dans vos éléments enregistrés",
  "saved.lookingThrough": "Consultation de vos éléments enregistrés",
  "saved.savingArticle": "Enregistrement de l’article",
  "saved.addedToPrepList": "Article ajouté à la liste de préparation",
  "saved.keptArticles": "Articles enregistrés",

  "call.preparing": "Préparation…",
  "call.preparingProgress": "Préparation {done}/{total}",
  "call.pageRange": "p. {first}-{last}",
  "call.page": "p. {page}",
  "call.pageBadge": "p. {page}",
  "call.clearFocus": "Retirer le focus du chapitre",
  "call.backToReading": "Revenir à la lecture",
  "call.deleteConversation": "Supprimer la conversation",
  "call.deleteTitle": "Supprimer cette conversation ?",
  "call.deleteDescription": "La conversation sera supprimée, ainsi que la marque depuis laquelle elle a été ouverte. Cette action est irréversible.",
} satisfies Translation<typeof en>;
