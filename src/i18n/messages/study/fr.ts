import type { Translation } from "../types";
import type en from "./en";

export default {
  "retell.materialsCount": { one: "{count} document", other: "{count} documents" },
  "retell.noMaterials": "(aucun document)",
  "retell.materialsJoin": "et",
  "retell.backToTopic": "Retour au sujet",
  "retell.renameTitle": "Renommer ce résumé",
  "retell.renameDescription": "Seul le nom change. Le plan et la conversation restent tels quels.",
  "retell.save": "Enregistrer",
  "retell.fallbackName": "Résumé",
  "retell.rehearse": "Répéter",
  "retell.loading": "Chargement du résumé…",
  "retell.composerPlaceholder": "Racontez-le avec vos propres mots…",
  "retell.backToRetell": "Retour au résumé",
  "retell.notReadable": "Ce résumé n'a pas pu être lu.",
  "retell.needProvider": "Configurez un fournisseur dans {settings} pour commencer le résumé.",
  "retell.untitledDefault": "Résumé sans titre",
  "retell.namePlusMore": "{title} +{count}",

  "rehearsal.startingTitle": "Démarrage de cette répétition…",
  "rehearsal.loadingTitle": "Recherche du plan de cet exposé…",
  "rehearsal.emptyTitle":
    "Cet exposé n'a encore aucun contenu. Organisez-le d'abord à la fin du résumé.",
  "rehearsal.readyTitle": "Faire l'exposé depuis le début",
  "rehearsal.openingNote": "Ouverture du texte…",
  "rehearsal.outlineMissing": "Le plan de cet exposé n'est pas sur cet appareil.",
  "rehearsal.outlineReadError": "Impossible de lire le plan",
  "rehearsal.elapsedTitle": "Depuis combien de temps dure cette répétition",
  "rehearsal.starting": "Démarrage…",
  "rehearsal.start": "Démarrer la répétition",
  "rehearsal.end": "Terminer la répétition",
  "rehearsal.noSegments":
    "Cet exposé n'a encore aucun contenu. Organisez-le à la fin du résumé, puis répétez-le.",

  "coach.fallbackName": "L'exposé",
  "coach.subtitle": "Comment s'est passée cette répétition",
  "coach.pendingNotice": "Récupération auprès du moteur de reconnaissance de vos derniers mots…",
  "coach.loading": "Ouverture de l'exposé…",
  "coach.composerPlaceholder": "Demandez comment s'est passée la répétition, ou dites ce qui doit changer…",
  "coach.needProvider":
    "Configurez un fournisseur dans {settings} pour que je puisse vous dire comment s'est passée la répétition.",

  "talk.untitledDefault": "Exposé sans titre",
  "talk.untitledSegment": "Bloc sans titre",

  "tools.setSpine": "Définition du fil conducteur de l'exposé",
  "tools.setSpineDone": "Fil conducteur de l'exposé défini",
  "tools.writeSegment": "Rédaction d'un bloc de l'exposé",
  "tools.rewroteSegment": "Un bloc de l'exposé a été réécrit",
  "tools.addedSegment": "Un bloc a été ajouté à l'exposé",
  "tools.moveSegment": "Déplacement d'un bloc de l'exposé",
  "tools.movedSegment": "Un bloc de l'exposé a été déplacé",
  "tools.removeSegment": "Suppression d'un bloc de l'exposé",
  "tools.droppedSegment": "Un bloc de l'exposé a été supprimé",
  "tools.readTalkOutline": "Lecture du plan de l'exposé",
  "tools.settlingChapter": "Décision sur un chapitre",
  "tools.settlingChapterNum": "Décision sur le chapitre {chapter}",
  "tools.keptChapter": "Un chapitre a été conservé",
  "tools.cutChapter": "Un chapitre a été écarté",
  "tools.readingChapterNote": "Lecture de la note d'un chapitre",
  "tools.readingChapterNoteNum": "Lecture de la note du chapitre {chapter}",
  "tools.readRetellOutline": "Lecture du plan du résumé",

  "budget.prepNotesTrimmed":
    "certaines de mes notes sur les articles de référence ont été laissées de côté pour faire de la place",
  "budget.marksTrimmed":
    "vos surlignages sont raccourcis ici pour tenir ; demandez-moi de vous ramener celles d'un chapitre en entier et je les relirai",
  "budget.historyTrimmedRetell": "le début de cette conversation a été laissé de côté pour faire de la place",
  "budget.passesTrimmed": "des répétitions précédentes de cet exposé ont été laissées de côté pour faire de la place",

  "rows.retellNotYet": "Issu d'un résumé · pas encore répété",
  "rows.retellCount": {
    one: "Issu d'un résumé · {count} répétition",
    other: "Issu d'un résumé · {count} répétitions",
  },
  "rows.broughtInNotYet": "Créé à part · pas encore répété",
  "rows.broughtInCount": {
    one: "Créé à part · {count} répétition",
    other: "Créé à part · {count} répétitions",
  },
} satisfies Translation<typeof en>;
