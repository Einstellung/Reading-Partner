import type { Translation } from "../types";
import type en from "./en";

export default {
  "toast.cantOpenDownloading": "Impossible d'ouvrir — le téléchargement n'est peut-être pas terminé.",
  "toast.cantOpenFile": "Impossible d'ouvrir ce fichier — il a peut-être été déplacé ou supprimé.",
  "toast.cantReadFile": "Impossible de lire ce fichier — il a peut-être été déplacé ou supprimé.",
  "toast.asideGone": "Cette conversation annexe n'existe plus.",
  "toast.conversationsUnloadable": "Les conversations IA enregistrées n'ont pas pu être chargées",
  "toast.cantShareFile": "Ce fichier n'a pas pu être transmis à une autre app.",

  "call.askAboutThisTitle": "Poser une question à ce sujet",
  "call.askAboutThisPlaceholder": "Poser une question à ce sujet…",
  "call.teachPlaceholder": "Demandez-moi de vous expliquer une partie de ce livre…",
  "call.thisBookFallback": "Ce livre",
  "call.configurePrompt": "Connectez un fournisseur dans Réglages pour commencer à discuter.",
  "call.openSettings": "Ouvrir Réglages",
  "call.retry": "Réessayer",

  "action.dismiss": "Ignorer",
  "action.cancel": "Annuler",
  "action.delete": "Supprimer",

  "savedArticle.backLabel": "Enregistré",

  "nav.settings": "Réglages",
  "nav.settingsNeedsAttention": "Réglages — la synchronisation nécessite votre attention",
  "sidebar.sections": "Sections",
  "sidebar.expand": "Développer la barre latérale",
  "sidebar.collapse": "Réduire la barre latérale",
  "sidebar.updating": "Mise à jour…",
  "sidebar.restartToUpdate": "Redémarrer pour mettre à jour",

  "lumen.show": "Afficher Lumen",
  "lumen.hide": "Masquer Lumen",
  "lumen.needsDecision": "Décision à prendre",

  "box.bookFallback": "Un livre",
  "box.originBookPage": "{book} · p. {page}",
  "box.originDoor": "À la porte · {date}",
  "box.originBriefing": "Synthèse · {date}",
  "box.originMeals": "Repas",
  "box.label": "La boîte",
  "box.waiting": { one: "La boîte, {count} en attente", other: "La boîte, {count} en attente" },
  "box.empty": "Rien dans la boîte.",
  "box.notReadable": "Ceci se trouve dans un livre. Ouvrez-le sur l'iPad ou sur le bureau.",

  "figure.label": "Fig. {id} · p.{page}",
  "figure.number": "Fig. {id}",
  "figure.pageSuffix": "· p.{page}",
  "figure.notFound": "Aucune figure {id} dans ce document.",
  "figure.loading": "Chargement de la figure…",
  "figure.notRendered": "Cette figure n'a pas pu être affichée.",
  "figure.rendering": "Génération de la figure…",

  "peer.desktopMac": "votre Mac",
  "peer.desktopWindows": "votre PC Windows",
  "peer.desktopLinux": "votre ordinateur Linux",
  "peer.desktopFallback": "votre ordinateur",
  "peer.notice": "{name} en est encore à {version}. Ouvrez Reading Partner là-bas pour passer à {target}.",

  "sync.credentialsMissing":
    "La synchronisation automatique est activée, mais cet appareil est déconnecté de Google — rien ne se synchronise.",
  "sync.engineStopped":
    "La synchronisation automatique est activée, mais le moteur de synchronisation ne fonctionne pas.",
  "sync.neverSynced": "Cet appareil n'a encore jamais terminé de synchronisation.",
  "sync.neverSyncedWithError":
    "Cet appareil n'a encore jamais terminé de synchronisation. Dernière erreur : {error}",
  "sync.stalled": "Aucune synchronisation n'a réussi depuis plus d'un jour.",
  "sync.stalledWithError": "Aucune synchronisation n'a réussi depuis plus d'un jour. Dernière erreur : {error}",
  "sync.lastFailed": "Échec de la dernière synchronisation : {error}",

  "auth.notConfigured": "Le client Google n'est pas configuré",
  "auth.tokenRequestFailed": "La demande de jeton Google a échoué (HTTP {status}) : {text}",
  "auth.redirectCaptureFailed": "La connexion Google n'a pas pu capturer la redirection : {error}",
  "auth.signInTimedOut": "La connexion Google a expiré en attendant la redirection",
  "auth.authorizationError": "Erreur d'autorisation Google : {error}",
  "auth.noRefreshToken":
    "Google n'a pas renvoyé de jeton d'actualisation ; essayez de retirer l'app sur myaccount.google.com puis de vous reconnecter.",

  "image.noCanvasContext": "Impossible de traiter l'image (pas de contexte canvas).",
  "image.tooLarge": "L'image reste trop volumineuse après compression ({mb} Mo, maximum 5 Mo).",
  "image.decodeFailed": "Impossible de décoder l'image.",
} satisfies Translation<typeof en>;
