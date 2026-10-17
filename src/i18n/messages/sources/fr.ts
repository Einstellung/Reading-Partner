import type { Translation } from "../types";
import type en from "./en";

export default {
  collectorSignedIn: "Connecté sur {device}",
  collectorNeedsSignIn: "Connexion requise sur {device}",
  signInNote:
    "Se connecter ouvre la propre page du site dans une fenêtre. Fermez-la une fois terminé — votre mot de passe n'atteint jamais cette app, seul le cookie du site reste.",
  checkTitle: "Charge le site en arrière-plan pour voir s'il demande encore de se connecter",
  check: "Vérifier",
  signOut: "Se déconnecter",
  signIn: "Se connecter",
  "account.benefitX": "Les recherches thématiques lisent la recherche de X avec votre compte.",
  "account.benefitBloomberg": "Les articles Bloomberg en entier dans la synthèse, au lieu de l'aperçu d'environ 500 caractères.",
  "account.usedBy": "Utilisé par {names}",
  "account.signInOnCollector": "Connectez-vous sur l'ordinateur qui collecte vos sources",

  "session.notChecked": "Non vérifié",
  "session.couldNotTell": "Impossible à déterminer",
  "session.signedIn": "Connecté",
  "session.notSignedIn": "Non connecté",
  "session.expired": "Session expirée",
  "session.workSigningIn": "Terminez dans la fenêtre de connexion, puis fermez-la",
  "session.workConfirming": "Confirmation de la connexion…",
  "session.workChecking": "Vérification du site…",
  "session.workSigningOut": "Déconnexion…",

  "pipe.apiFullArticles": "API avec articles complets",
  "pipe.apiHeadlinesOnly": "API, titres seulement",
  "pipe.articleList": "Liste d'articles, récupère chaque page",
  "pipe.liveUpdates": "Mises à jour en direct",
  "pipe.indexQuery": "Requête d'index ({provider})",
  "pipe.fullTextInFeed": "Texte intégral dans le flux",
  "pipe.fullTextInFeedPaywalled": "Texte intégral dans le flux (certains payants)",
  "pipe.feedFetchesPage": "Titres du flux, récupère chaque page",
  "pipe.feedOpensWindow": "Titres du flux, ouvre chaque article dans une fenêtre de navigateur",
  "pipe.headlinesOnlyBrowser": "Titres seulement, s'ouvre dans le navigateur",

  "tool.theSite": "le site",
  "tool.probingSite": "Analyse de {input}",
  "tool.fetchingWebviewArticles": {
    one: "Récupération de {count} article via une fenêtre de navigateur en arrière-plan — plusieurs dizaines de secondes",
    other:
      "Récupération de {count} articles via une fenêtre de navigateur en arrière-plan — plusieurs dizaines de secondes",
  },
  "tool.fetchingArticles": {
    one: "Récupération de {count} article pour le test",
    other: "Récupération de {count} articles pour le test",
  },
  "tool.addingSource": "Ajout de la source",
  "tool.trialReceiptLabel": "Source testée",
  "tool.trialReceiptSummary": "{name} ({pipe})",
  "tool.addReceiptLabel": "Source ajoutée",

  "tasking.label": "Recherche en cours",
  "tasking.searchingCablesFor": "Recherche dans les dépêches pour « {query} »",
  "tasking.searchingCables": "Recherche dans les dépêches",
  "tasking.readingCable": "Lecture d'une dépêche",
  "tasking.readingPictureFor": "Lecture de la situation de {lab}",
  "tasking.readingPicture": "Lecture de la situation",

  "readPage.thePage": "la page",
  "readPage.reading": "Lecture de {url}",
  "webSearch.searching": "Recherche sur le web : {query}",

  "plugins.daysPositiveInteger": "days doit être un entier positif",
  "plugins.daysMustBeAtMost": "days doit être au maximum {max}",

  "plugins.github.modeMustBe": 'mode doit être "trending" ou "search"',
  "plugins.github.languageMustBeString": "language doit être une chaîne de caractères",
  "plugins.github.fieldAppliesToSearchOnly": "{field} ne s'applique qu'au mode search",
  "plugins.github.periodMustBe": 'period doit être "day", "week" ou "month"',
  "plugins.github.periodTrendingOnly": "period ne s'applique qu'au mode trending",
  "plugins.github.topicsMustBeStrings": "topics doit être une liste de chaînes",
  "plugins.github.minStarsMustBeNonNegative": "minStars doit être un entier non négatif",
  "plugins.github.notTrendingQuery": "ce n'est pas une requête trending",
  "plugins.github.notSearchQuery": "ce n'est pas une requête search",
  "plugins.github.httpError": "HTTP {status} depuis {url}",
  "plugins.github.httpErrorRateLimited": "HTTP {status} depuis {url} (quota de requêtes épuisé)",
  "plugins.github.ossUnavailable": "Les données trending d'OSS Insight sont indisponibles",
  "plugins.github.ossUnavailableSince": "Les données trending d'OSS Insight sont indisponibles depuis {since}",
  "plugins.github.ossUnavailableReason": "Les données trending d'OSS Insight sont indisponibles : {reason}",
  "plugins.github.ossUnavailableSinceReason":
    "Les données trending d'OSS Insight sont indisponibles depuis {since} : {reason}",

  "plugins.s2.termsRequired": "terms est obligatoire (une chaîne ou une liste de chaînes)",
  "plugins.s2.daysMustBePositiveNumber": "days doit être un nombre positif",
  "plugins.s2.minCitationsMustBeNonNegative": "minCitations doit être un nombre non négatif",
  "plugins.s2.fieldsOfStudyMustBeStrings": "fieldsOfStudy doit être une liste de chaînes",

  "plugins.arxiv.unknownCategory": "catégorie arXiv inconnue « {category} » (attendu par ex. cs.RO)",
  "plugins.arxiv.termsNoSearchableWords": "terms ne contient aucun mot cherchable",
  "plugins.arxiv.needsCategoriesOrTerms": "la requête nécessite categories ou terms",

  "plugins.huggingface.kindMustBeOneOf": "kind doit être l'un de : {kinds}",
  "plugins.huggingface.daysPapersOnly": "days ne s'applique qu'aux papers",
  "plugins.huggingface.fieldAppliesToModelsDatasetsOnly": "{field} ne s'applique qu'aux models et datasets",
  "plugins.huggingface.fieldMustBeNonEmptyString": "{field} doit être une chaîne non vide",
  "plugins.huggingface.tagsMustBeNonEmptyStrings": "tags doit être une liste de chaînes non vides",
  "plugins.huggingface.sortMustBeOneOf": "sort doit être l'un de : {sorts}",
  "plugins.huggingface.includeConversionsModelsOnly": "includeConversions ne s'applique qu'aux models",
  "plugins.huggingface.includeConversionsMustBeBoolean": "includeConversions doit être un booléen",
  "plugins.huggingface.nonJson": "Hugging Face a renvoyé du contenu non JSON depuis {url}",
  "plugins.huggingface.unexpectedShape": "Hugging Face a renvoyé une structure inattendue depuis {url}",

  "window.today": "aujourd'hui",
  "window.lastDays": { one: "{count} dernier jour", other: "{count} derniers jours" },
} satisfies Translation<typeof en>;
