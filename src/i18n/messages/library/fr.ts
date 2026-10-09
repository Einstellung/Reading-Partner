import type { Translation } from "../types";
import type en from "./en";

const fr: Translation<typeof en> = {
  "count.books": { one: "{count} livre", other: "{count} livres" },
  "count.articles": { one: "{count} article", other: "{count} articles" },
  "count.topics": { one: "{count} sujet", other: "{count} sujets" },
  "count.files": { one: "{count} fichier", other: "{count} fichiers" },
  "count.marks": { one: "{count} repère", other: "{count} repères" },
  "count.observations": { one: "{count} observation", other: "{count} observations" },
  "count.messages": { one: "{count} message", other: "{count} messages" },
  "count.conflictCopies": { one: "{count} copie en conflit", other: "{count} copies en conflit" },
  "count.booksAndArticles": "{books} et {articles}",

  "time.today": "aujourd’hui",
  "time.yesterday": "hier",
  "time.daysAgo": { one: "il y a {count} jour", other: "il y a {count} jours" },
  "time.weeksAgo": { one: "il y a {count} semaine", other: "il y a {count} semaines" },
  "time.monthsAgo": { one: "il y a {count} mois", other: "il y a {count} mois" },
  "time.yearsAgo": { one: "il y a {count} an", other: "il y a {count} ans" },

  "header.lastRead": "dernière lecture {when}",

  "shelf.readPercent": "Lu à {percent} %",
  "shelf.page": "Page {page}",
  "shelf.notOpened": "Pas encore ouvert",
  "shelf.noFiles": "Aucun fichier",

  "deleteTitle": "Supprimer « {name} » ?",
  "deleteFailed": "Impossible de supprimer « {name} »",

  "card.actionsFor": "Actions pour {name}",
  "card.remove": "Retirer",
  "card.rename": "Renommer",
  "card.delete": "Supprimer",
  "card.retell": "Reformuler ce livre…",
  "move.action": "Déplacer vers…",
  "move.title": "Déplacer vers",
  "move.here": "Ici",
  "move.done": "Déplacé vers « {topic} »",
  "move.failed": "Impossible de le déplacer.",

  "topics.eyebrow": "Vos sujets",
  "topics.title": "Sujets",
  "topics.blurb": "Un sujet, c’est une question et les livres que vous lisez pour y répondre.",
  "topics.newTopicButton": "+ Nouveau sujet",
  "topics.emptyTitle": "L’étagère est encore vide",
  "topics.emptyBlurb":
    "Un sujet, c’est une question et les livres que vous lisez pour y répondre. Définissez d’abord la question ; les PDF s’ajoutent ensuite.",
  "topics.emptyAction": "Nouveau sujet",
  "topics.createTitle": "Nouveau sujet",
  "topics.createConfirm": "Créer",
  "topics.placeholder": "p. ex. pourquoi les JIT sont rapides",
  "topics.renameTitle": "Renommer le sujet",
  "topics.renameDescription": "Seul le nom change. La liste de lecture reste la même.",
  "topics.renameConfirm": "Enregistrer",

  "materials.emptyTitle": "Ce sujet n’a encore aucun livre",
  "materials.emptyBlurb":
    "Ajoutez les livres que vous voulez lire pour cette question. Ils sont lus là où ils se trouvent ; rien n’est copié ni déplacé.",
  "materials.addBook": "Ajouter un livre",
  "materials.savedArticlesHeading": "Articles enregistrés",
  "materials.removeArticleTitle": "Retirer « {title} » ?",
  "materials.removeArticleDescription":
    "L’article quitte vos articles enregistrés. L’enregistrer à nouveau depuis un résumé le fait revenir.",
  "materials.removeArticleAction": "Retirer",
  "materials.deleteBookTitle": "Supprimer « {title} » ?",
  "materials.deleteBookDescription": "Supprimer ce livre et tout ce qui s’y rapporte ? Vos notes sur vous-même sont conservées.",
  "materials.deleteArticleDescription":
    "Supprimer cet article et tout ce qui s'y rapporte, sur tous les appareils ? Vos notes personnelles sont conservées.",
  "materials.deleteBookAction": "Supprimer",

  "screen.backToTopics": "‹ Tous les sujets",
  "screen.addBook": "+ Ajouter un livre",
  "screen.backToTopicLabel": "Retour au sujet",
  "screen.deleteBookFailed": "Impossible de supprimer le livre",
  "screen.removeArticleFailed": "Impossible de retirer l’article",

  "topicDelete.onlyCaption": "Seulement dans ce sujet",
  "topicDelete.description":
    "Le sujet disparaît, sur tous les appareils, avec les reformulations, les exposés et les répétitions qui y ont été faits.",
  "topicDelete.articlesMoveNote": "Les articles enregistrés ici passent dans À lire.",
  "topicDelete.sharedOneBook": "Un livre est aussi classé dans un autre sujet et y restera.",
  "topicDelete.sharedOneArticle": "Un article est aussi classé dans un autre sujet et y restera.",
  "topicDelete.sharedMany": "{tally} sont aussi classés dans d’autres sujets et y resteront.",
  "topicDelete.checkOneBook": "Supprimer aussi ce livre",
  "topicDelete.checkOneArticle": "Supprimer aussi cet article",
  "topicDelete.checkMany": "Supprimer aussi ces {tally}",
  "topicDelete.action": "Supprimer",
  "topicDelete.actionOneBook": "Supprimer le sujet et le livre",
  "topicDelete.actionOneArticle": "Supprimer le sujet et l’article",
  "topicDelete.actionAll": {
    one: "Supprimer le sujet et son {count} élément",
    other: "Supprimer le sujet et ses {count} éléments",
  },
  "topicDelete.doneNone": "« {name} » supprimé",
  "topicDelete.doneOne": "« {name} » et {tally} supprimés",
  "topicDelete.doneMany": "« {name} », {tally} supprimés",
  "topicDelete.kindArticle": "Article",

  "rehearsal.goneError": "Cette répétition n’existe plus",
  "rehearsal.noTalkError": "Cet exposé n’a rien à répéter",
  "rehearsal.openFailed": "Impossible d’ouvrir la répétition",
  "rehearsal.emptyBlurb":
    "Rien à répéter ici pour l’instant. Un exposé apparaît ici dès qu’une reformulation l’a préparé, et chaque passage y est conservé pour servir de repère au suivant.",
  "rehearsal.howItWent": "Comment ça s’est passé",
  "rehearsal.rehearseButton": "Répéter",
  "rehearsal.deleteMenuItem": "Supprimer cette répétition",
  "rehearsal.deleteDescription":
    "Tous les passages sur cet exposé disparaissent avec elle. L’exposé lui-même reste où il est, et vous pouvez le répéter à nouveau depuis la reformulation.",

  "retell.startFailed": "Impossible de démarrer la reformulation",
  "retell.emptyBlurb":
    "Pas encore de reformulation. Une reformulation, c’est ce que vous préparez à raconter à partir de ce que vous avez lu ici — vous le parcourez chapitre par chapitre avec l’IA, et le plan de l’exposé en résulte.",
  "retell.newRetellButton": "Nouvelle reformulation",
  "retell.deleteMenuItem": "Supprimer cette reformulation",
  "retell.deleteDescription":
    "La reformulation disparaît, avec le plan que vous avez arrêté et toutes les répétitions de son exposé. Les livres, leurs repères et leurs notes restent intacts.",
  "retell.pickDescription":
    "Une reformulation se prépare en parcourant ce que vous avez lu, chapitre par chapitre, en déterminant ce qu’il apporte. Choisissez son sujet.",
  "retell.noCandidates": "Rien à reformuler pour l’instant — ouvrez d’abord un livre dans ce sujet.",
  "retell.cancel": "Annuler",
  "retell.start": "Démarrer",

  "loading": "Chargement…",

  "observations.heading": "Observations de l’IA",
  "observations.lastDistilled": "Dernière distillation {date}",
  "observations.noDistillation": "Aucune distillation n’a encore eu lieu.",
  "observations.empty": "Rien observé pour l’instant. Les observations sont distillées à la fin d’une conversation.",
  "observations.footer": "Les observations sont maintenues par l’IA. Si l’une d’elles est fausse, dites-le dans une conversation.",
  "observations.aboutYou": "À propos de vous",
  "observations.lastSupported": "dernier appui {date}",
  "observations.fromEvidence": "d’après {evidence}",
  "observations.updated": "mis à jour {date}",
  "observations.evidenceLabel": "Preuves :",
  "observations.evidenceAnnotation": "annotation {id}",
  "observations.evidenceMessage": "message {id}",
  "observations.conflictNotice":
    "{copies} issues de la synchronisation. Deux appareils ont modifié la même observation ; la version perdante est conservée à côté.",
  "observations.conflictUnreadable": "(cette copie n’a pas pu être lue ; ouvrez le fichier pour la voir)",
  "observations.typeReadingPosition": "position de lecture",
  "observations.typeStuckPoint": "point de blocage",
  "observations.typeCannotExplain": "ne sait pas expliquer",
  "observations.typeCanExplain": "sait expliquer",
  "observations.typeUnderstoodConcept": "concept compris",
  "observations.typeBelief": "opinion",
  "observations.typeCorrection": "correction",

  "statement.youSaid": "Vous avez dit",
  "statement.concluded": "Conclu",
  "statement.evidenceBoth": "{observations}, {messages}",
  "statement.kindProfile": "profil",
  "statement.kindConcern": "préoccupation",

  "section.navLabel": "Sujet",
  "section.materials": "Documents",
  "section.retell": "Reformulation",
  "section.rehearsal": "Répétition",
  "section.observations": "Observations de l’IA",

  "savedArticle.backDefault": "Sujet",
  "savedArticle.summaryOnlyNote": "Le texte intégral de cet article n’a jamais été récupéré. Ce qui suit n’est qu’un résumé.",
  "savedArticle.noBody": "Aucun contenu n’a été enregistré avec cet article.",
};

export default fr;
