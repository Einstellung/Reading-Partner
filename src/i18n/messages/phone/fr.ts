import type { Translation } from "../types";
import type en from "./en";

export default {
  "holdMenu.deleteTopic": "Supprimer le sujet",
  "holdMenu.deleteLesson": "Supprimer la leçon",
  "holdMenu.deleteConversation": "Supprimer la conversation",
  "holdMenu.removeFromTopic": "Retirer du sujet",
  "holdMenu.deleteArticle": "Supprimer l'article",
  "holdMenu.deleteBook": "Supprimer le livre",
  "holdMenu.removeFromSaved": "Retirer des éléments enregistrés",
  "holdMenu.deleteAside": "Supprimer l'aparté",

  "holdMenu.confirmDeleteFileTitle": "Supprimer « {title} » ?",
  "holdMenu.confirmDeleteBookDescription":
    "Supprimer ce livre et tout ce qui s'y rapporte, sur tous les appareils ? Vos notes personnelles sont conservées.",
  "holdMenu.confirmDeleteArticleDescription":
    "Supprimer cet article et tout ce qui s'y rapporte, sur tous les appareils ? Vos notes personnelles sont conservées.",
  "holdMenu.delete": "Supprimer",
  "holdMenu.confirmRemoveTitle": "Retirer « {title} » ?",
  "holdMenu.removeOthers": "Reste dans {names}",
  "holdMenu.removeNoOthers": "Autre chose le liste encore, donc il reste",
  "holdMenu.removeBookDescription": "Ce sujet perd le livre. {where}, avec sa position de lecture et ses annotations.",
  "holdMenu.removeArticleDescription":
    "Ce sujet perd l'article. {where}, avec sa position de lecture et ses annotations.",
  "holdMenu.remove": "Retirer",
  "holdMenu.confirmConversationTitle": "Supprimer cette conversation ?",
  "holdMenu.confirmLessonDescription":
    "La leçon disparaît, avec ses apartés, sur tous les appareils. L'article reste, et la prochaine leçon repart du début.",
  "holdMenu.confirmConversationDescription":
    "Tout ce qui a été dit à propos de ce livre disparaît, sur tous les appareils. Le livre, ses annotations et sa position de lecture restent.",
  "holdMenu.confirmRemoveSavedDescription":
    "Il disparaît des éléments enregistrés sur tous les appareils. Le résumé dont il vient n'est pas modifié.",
  "holdMenu.confirmDeleteAsideDescription":
    "L'aparté disparaît, avec sa ligne dans la leçon. La leçon elle-même reste.",

  "holdMenu.doneDeleted": "« {title} » supprimé",
  "holdMenu.doneRemovedFromTopic": "Retiré de {topicName}",
  "holdMenu.doneLessonDeleted": "Leçon supprimée",
  "holdMenu.doneConversationDeleted": "Conversation supprimée",
  "holdMenu.doneRemovedFromSaved": "Retiré des éléments enregistrés",
  "holdMenu.doneAsideDeleted": "Aparté supprimé",

  "holdMenu.failedTopic": "Le sujet n'a pas pu être supprimé.",
  "holdMenu.failedFile": "Impossible de le supprimer.",
  "holdMenu.failedRemoveFromTopic": "Impossible de le retirer de ce sujet.",
  "holdMenu.failedConversation": "La conversation n'a pas pu être supprimée.",
  "holdMenu.failedRemoveSaved": "Impossible de le retirer des éléments enregistrés.",

  "savedList.back": "Aujourd'hui",
  "savedList.count": { one: "{count} article enregistré", other: "{count} articles enregistrés" },
  "savedList.empty": "Rien d'enregistré pour l'instant.",
  "savedList.summaryOnly": "résumé seulement",

  "home.today": "Aujourd'hui",
  "home.briefingLabel": "Le résumé du jour",
  "home.mealsLabel": "Repas",
  "home.mealsBlurb": "Les petits-déjeuners, déjeuners et dîners de la semaine, et ce qu'il faut acheter.",
  "home.open": "Ouvrir →",
  "home.savedLabel": "Enregistrés",
  "home.savedBlurb": "Les articles que vous avez enregistrés, à lire quand vous voulez.",
  "home.savedCount": { one: "{count} article", other: "{count} articles" },
  "home.savedEmpty": "Rien d'enregistré pour l'instant. Enregistrez un article du résumé, il vous attendra ici.",
  "home.libraryLabel": "Bibliothèque",
  "home.continueReading": "Continuer la lecture · {topicName}",
  "home.libraryBlurb": "Vos sujets, et les livres classés sous chacun d'eux.",
  "home.allTopics": "Tous les sujets",

  "newTopic.title": "Nouveau sujet",
  "newTopic.fieldLabel": "Nom du sujet",
  "newTopic.cancel": "Annuler",
  "newTopic.create": "Créer",

  "shelf.libraryLabel": "Bibliothèque",
  "shelf.backHome": "Accueil",
  "shelf.topicCount": { one: "{count} sujet", other: "{count} sujets" },
  "shelf.newTopic": "Nouveau sujet",
  "shelf.noTopicsYet": "Pas encore de sujet.",
  "shelf.created": "« {name} » créé",
  "shelf.createFailed": "Le sujet n'a pas pu être créé.",
  "shelf.importing": "Importation…",
  "shelf.importEpub": "Importer un EPUB",
  "shelf.nothingFiled": "Rien de classé ici pour l'instant.",
  "shelf.lessonBadge": "Leçon",
  "shelf.downloadFailed": "Ce livre n'a pas pu être téléchargé",
  "shelf.importFailed": "Ce livre n'a pas pu être importé",

  "shelfList.notConfigured":
    "Cette version n'a pas de compte Google configuré, elle ne peut donc pas télécharger le livre",
  "shelfList.signInToDownload": "Connectez-vous à votre compte dans Réglages pour télécharger ce livre",
  "shelfList.notImported": "Le bureau n'a pas encore importé ce fichier, il n'y a donc rien à récupérer",
  "shelfList.notFiledYet": "Ce livre n'a pas encore fini de se synchroniser sur cet appareil",
  "shelfList.downloading": "Téléchargement…",
  "shelfList.notImportedShort": "Non importé",
  "shelfList.inCloud": "Dans le cloud",
  "shelfList.notSyncedYet": "Pas encore synchronisé",
  "shelfList.lessonNotStarted": "Pas lancée",
  "shelfList.lessonOn": "À {title}",
  "shelfList.lessonInProgress": "En cours",

  "reader.rendering": "Affichage…",
  "reader.openFailed": "Ce livre n'a pas pu être ouvert.",
  "reader.drawFailed": "Ce livre n'a pas pu être affiché.",
  "reader.deleteMarkTitle": "Supprimer cette annotation ?",
  "reader.deleteMarkDescription":
    "L'annotation disparaît, ainsi que la conversation ouverte depuis elle. Cette action est irréversible.",
  "reader.deleteMarkButton": "Supprimer cette annotation",
  "reader.delete": "Supprimer",

  "readerBar.backToShelf": "Retour à l'étagère",
  "readerBar.outline": "Table des matières",
  "readerBar.display": "Affichage",
  "readerBar.learnThisBook": "Apprendre ce livre avec l'IA",
  "readerBar.dotWriting": " (une réponse est en cours de rédaction)",
  "readerBar.dotUnseen": " (nouvelle réponse)",

  "readerGate.aiPenNotOnPhone":
    "Le stylo IA n'est pas encore disponible sur le téléphone — Apprendre ce livre avec l'IA se trouve dans la barre du haut",

  "displaySheet.title": "Affichage",
  "displaySheet.size": "Taille",
  "displaySheet.smallerText": "Texte plus petit",
  "displaySheet.largerText": "Texte plus grand",
  "displaySheet.lineSpacing": "Interligne",
  "displaySheet.margins": "Marges",
  "displaySheet.turnPages": "Tourner les pages",
  "displaySheet.paper": "Papier",

  "outlineSheet.title": "Table des matières",
  "outlineSheet.done": "OK",

  "lessonBar.backToShelf": "Retour à l'étagère",
  "lessonBar.chapters": "Chapitres",
  "lessonBar.openIn": "Ouvrir dans…",

  "lessonIntro.title": "Celui-ci s'ouvre comme une leçon",
  "lessonIntro.body1":
    "Sur le téléphone, un PDF ne se feuillette pas page par page. Il s'ouvre comme une leçon : je vous guide dans l'article en texte, en le citant avec les numéros de page au fil de la lecture.",
  "lessonIntro.body2":
    "Pour voir les pages elles-mêmes — les figures, les tableaux, la mise en page — transmettez le fichier à une autre appli avec Ouvrir dans…, ou lisez-le sur l'iPad.",
  "lessonIntro.body3": "Ce message ne s'affiche qu'une fois. La prochaine fois, cette carte ouvrira directement la leçon.",
  "lessonIntro.start": "Commencer la leçon",
  "lessonIntro.openIn": "Ouvrir dans…",

  "chapterSheet.title": "Chapitres",
  "chapterSheet.empty": "Cet appareil n'a pas encore la liste des chapitres de cet article.",
  "chapterSheet.now": "En cours",

  "lessonView.chipDontFollowLabel": "Je ne suis pas",
  "lessonView.chipDontFollowText": "Je ne suis pas.",
  "lessonView.chipSkipLabel": "Passer",
  "lessonView.chipSkipText": "Passe celui-ci.",
  "lessonView.continuingFrom": "Reprise à : {title}",
  "lessonView.now": "En cours : {title}",
  "lessonView.nowWithPage": "En cours : {title} · p.{page}",

  "bookLesson.backToPage": "Retour à la page",
  "bookLesson.retry": "Réessayer",
  "bookLesson.ariaLabel": "Leçon",
  "bookLesson.placeholder": "Demandez-moi de vous enseigner une partie de ce livre…",

  "lesson.backToLesson": "Retour à la leçon",
  "lesson.aside": "Aparté",
  "lesson.placeholder": "Posez une question sur l'article…",
  "lesson.askAboutThis": "Poser une question là-dessus",

  "lessonCall.noProvider": "Configurez un fournisseur dans Réglages et je pourrai vous enseigner cet article.",
  "lessonCall.noThread": "La conversation de cet article n'a pas pu être lue sur cet appareil.",
  "lessonCall.openFailed": "Cet article n'a pas pu être ouvert.",

  "bookLessonHook.imageLimitHint": {
    one: "Vous pouvez joindre jusqu'à {count} image.",
    other: "Vous pouvez joindre jusqu'à {count} images.",
  },
  "bookLessonHook.threadsUnreadable": "Les conversations IA enregistrées n'ont pas pu être chargées",

  "pullToAsk.releaseToAsk": "Relâchez pour poser une question",

  "lessonStatus.downloading": "Téléchargement…",
  "lessonStatus.reading": "Lecture de l'article…",
  "lessonStatus.failedDownload": "Cet article n'a pas pu être téléchargé.",
  "lessonStatus.failedUnreadable": "Ce PDF n'a pas pu être lu.",
  "lessonStatus.failedNoText": "Ce PDF est un scan sans couche de texte, il n'y a donc rien à enseigner.",

  "lessonOpening.text":
    "Donnez-moi d'abord le squelette de cet article — combien de parties il comporte et ce que fait chacune, en un seul écran. Je lis sur mon téléphone et je n'ai pas les pages sous les yeux, donc pour une figure ou un tableau, contentez-vous de le nommer et de me donner sa page ; vous pouvez me dire ce que dit la légende. Ensuite, ne me demandez rien, emmenez-moi directement au premier arrêt.",
  "lessonOpening.takeMeToChapterTitle": "Emmène-moi à {title}.",
  "lessonOpening.takeMeToPage": "Emmène-moi à la page {page}.",
  "lessonOpening.takeMeToChapterNumber": "Emmène-moi au chapitre {number}.",

  "displaySheet.lineTight": "Serré",
  "displaySheet.lineStandard": "Standard",
  "displaySheet.lineLoose": "Large",
  "displaySheet.marginsNarrow": "Étroites",
  "displaySheet.marginsWide": "Larges",
  "displaySheet.paperWhite": "Blanc",
  "displaySheet.paperPaper": "Papier",
  "displaySheet.paperGreen": "Vert",
  "displaySheet.paperDark": "Sombre",
} satisfies Translation<typeof en>;
