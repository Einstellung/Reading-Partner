import type { Translation } from "../types";
import type en from "./en";

export default {
  title: "Réglages",
  done: "OK",
  "tab.account": "Compte",
  "tab.features": "Fonctions",
  "tab.optional": "Facultatif",
  connected: "Connecté",
  save: "Enregistrer",
  signOut: "Se déconnecter",
  apiKey: "Clé API",

  "thinking.off": "Désactivé",
  "thinking.low": "Faible",
  "thinking.medium": "Moyen",
  "thinking.high": "Élevé",

  "account.providers": "Fournisseurs",
  "account.signInWith": "Se connecter avec {name}",
  "account.defaultConversation": "Conversation par défaut",
  "account.connectFirst": "Connectez un fournisseur ci-dessus pour choisir une valeur par défaut.",
  "account.provider": "Fournisseur",
  "account.model": "Modèle",
  "account.select": "Choisir…",
  "account.contextHint":
    "Le nombre à côté de chaque modèle est sa fenêtre de contexte. Cette app y place un livre entier ; avec une fenêtre plus petite, la réponse retire du contenu pour tenir et indique ce qu'elle a retiré.",
  "account.everydayModel": "Modèle du quotidien",
  "account.sameAsChat": "Comme pour le chat",
  "account.everydayHint":
    "Les tâches de routine tournent ici plutôt que sur le modèle ci-dessus : les repas et le briefing de la nuit. Personne ne les attend, donc un modèle moins cher ne vous coûte rien ; c'est l'app qui décide quelles tâches en relèvent, pas ce réglage. Il utilise le fournisseur ci-dessus.",
  "account.briefing": "Briefing",
  "account.screening": "Tri",
  "account.analysis": "Analyse",
  "account.briefingHint":
    "Le briefing est préparé la nuit à partir de toutes les sources, que vous le lisiez ou non. Le tri lit les titres du jour pour décider quels articles valent la peine d'être récupérés : c'est l'étape à garder basse. L'analyse lit ceux qui ont passé le tri.",
  "account.thinking": "Réflexion",
  "account.chat": "Chat",
  "account.lessonPrep": "Préparation des cours",
  "account.thinkingHint":
    "Les modèles adaptatifs décident à chaque question combien réfléchir réellement ; plus élevé = plus approfondi mais plus lent.",
  "account.sync": "Synchronisation",

  "oauth.signInFailed": "Échec de la connexion",
  "oauth.openFailed": "Impossible d'ouvrir la page de connexion",
  "oauth.invalidCode": "Code non valide",
  "oauth.pasteHintDevice":
    "Après vous être connecté, copiez la barre d'adresse (l'URL localhost qui ne se charge pas) et collez-la ici.",
  "oauth.pasteHintCode": "Collez le code affiché après avoir autorisé l'accès.",
  "oauth.opening": "Ouverture de la page de connexion…",
  "oauth.completeInBrowser": "Terminez l'autorisation dans votre navigateur…",
  "oauth.withCode": "Se connecter avec un code",
  "oauth.pastePlaceholder": "Collez le code ou l'URL de connexion",
  "oauth.submit": "Valider",
  "oauth.signsOutOthers": "Se connecter ici déconnecte les autres fournisseurs.",
  "oauth.requestingCode": "Demande d'un code de connexion…",
  "oauth.openPage": "Ouvrir la page de connexion",
  "oauth.enterCode": "Saisissez ce code sur {url}. En attente de l'autorisation…",
  "oauth.cancel": "Annuler",
  "oauth.pasteInstead": "Coller plutôt l'URL de connexion",
  "oauth.tryAgain": "Réessayer",

  "key.replace": "Remplacer la clé API",
  "key.signsOutOthers": "Enregistrer une clé ici déconnecte les autres fournisseurs.",

  "sync.drive": "Google Drive",
  "sync.never": "Jamais",
  "sync.justNow": "À l'instant",
  "sync.minutesAgo": { one: "Il y a {count} minute", other: "Il y a {count} minutes" },
  "sync.failed": "La synchronisation a échoué",
  "sync.notConfigured": "Le client Google n'est pas configuré.",
  "sync.signIn": "Se connecter avec Google",
  "sync.signedOutNote":
    "Tout ce qui date d'après la dernière synchronisation n'existe que sur cet appareil. Reconnectez-vous pour reprendre ; rien de local n'est perdu.",
  "sync.pitch": "Synchronisez la progression de lecture, les annotations et les livres avec votre propre Google Drive.",
  "sync.completeInBrowser": "Terminez la connexion dans votre navigateur…",
  "sync.lastSync": "Dernière synchronisation : {time}",
  "sync.auto": "Synchroniser automatiquement",
  "sync.running": "Synchronisation…",
  "sync.now": "Synchroniser",

  "features.general": "Général",
  "features.language": "Langue",
  "features.languageAuto": "Auto (app : système, IA : votre langue)",
  "features.languageHint":
    "La langue de l'app et de tout ce qu'écrit l'IA : réponses du chat, notes et briefing d'actualités. En mode auto, l'app s'affiche dans la langue du système et l'IA répond dans la langue dans laquelle vous écrivez. La transcription vocale suit toujours la langue parlée.",
  "features.paper": "Fond papier",
  "features.paperHint":
    "Remplace le blanc derrière toute l'app (chats, étagères, barres latérales, cette fenêtre et les pages d'un livre) par une couleur de papier crème. Il n'y a qu'une teinte, sans niveau plus sombre ; ce n'est pas un mode sombre. Le choix reste sur cet appareil.",
  "features.reading": "Lecture",
  "features.fingerDraw": "Dessiner au doigt",
  "features.fingerDrawHint":
    "Désactivé, le doigt ne fait que déplacer la page et c'est le stylet qui annote, quel que soit l'outil choisi. Activez-le sur un appareil sans stylet, où le doigt doit pouvoir surligner et dessiner. Le verrou de navigation du lecteur reste prioritaire sur les deux. La présence d'un stylet dépend de l'appareil, ce réglage reste donc sur celui-ci.",
  "features.briefing": "Briefing",
  "features.collect": "Collecter vos sources sur cet ordinateur",
  "features.collectHint":
    "Chaque source est consultée selon son propre calendrier et ce qu'elle publie est conservé jusqu'à la préparation du briefing du jour. Désactivé, cette machine arrête toute collecte et un autre collecteur, si vous en avez un, prend le relais.",
  "features.thisComputer": "Cet ordinateur",
  "features.role": "Cette machine est un",
  "features.roleCollector": "Collecteur — lit les sources ici",
  "features.roleReader": "Lecteur — lit ce qu'une autre machine a collecté",
  "features.roleHint":
    "Un collecteur lit vos sites suivis toute la journée et publie le briefing pour vos autres appareils ; un lecteur affiche ce qu'un collecteur a publié et ne récupère jamais rien d'un site lui-même. Les téléphones et tablettes sont toujours lecteurs. Si deux machines collectent, celle qui tourne depuis le plus longtemps fait le travail.",
  "features.autostart": "Ouvrir Reading Partner au démarrage de cet ordinateur",
  "features.autostartHint":
    "Désactivé par défaut. Activez-le sur la machine qui doit collecter vos sources toute la journée : avec l'icône de la barre système, le briefing se prépare que vous ayez ouvert l'app ou non. Ce réglage appartient à cet ordinateur et n'est pas transmis à vos autres appareils.",

  "optional.intro":
    "Des clés pour des services externes, toutes facultatives. Les deux clés vocales sont conservées avec les identifiants de cet appareil et ne sont jamais synchronisées : chaque appareil a besoin des siennes.",
  "optional.meals": "Repas",
  "optional.mealsHint":
    "Planifiez les petits-déjeuners, déjeuners et dîners de la semaine, tenez la liste de courses, signalez quand vous avez mangé autre chose.",
  "optional.lessonPrep": "Préparation des cours",
  "optional.s2Key": "Clé API Semantic Scholar",
  "optional.s2Placeholder": "Facultatif",
  "optional.s2Hint":
    "Une clé gratuite de semanticscholar.org évite les limites de débit partagées qui bloquent la récupération des articles.",
  "optional.voiceInput": "Saisie vocale",
  "optional.voiceOutput": "Sortie vocale",
  "optional.dictationLanguage": "Langue de dictée",
  "optional.dictationHint":
    "La langue que l'iPhone écoute quand vous maintenez la barre et parlez. La parole est transcrite sur le téléphone et n'est jamais envoyée. Parler une autre langue ne donne pas une transcription approximative mais une transcription fausse et convaincante : choisissez la langue que vous parlez vraiment.",
  "optional.speechKey": "Clé API de synthèse vocale",
  "optional.speechKeyReplace": "Remplacer la clé API de synthèse vocale",
  "optional.speechHint":
    "Une clé Xiaomi MiMo, pour la voix qui lit les réponses à voix haute. Sans elle, l'app reste muette et tout le reste fonctionne comme maintenant.",
  "optional.sttKey": "Clé API de transcription",
  "optional.sttKeyReplace": "Remplacer la clé API de transcription",
  "optional.model": "Modèle",
  "optional.baseUrl": "URL de base",
  "optional.sttHint":
    "Maintenez le micro dans la zone de chat pour parler. L'offre SenseVoice de SiliconFlow est gratuite et sa clé API fonctionne telle quelle ; tout service de transcription compatible OpenAI convient aussi.",
  "features.showMarks": "Afficher les marques dans la lecture sur téléphone",
  "features.showMarksHint": "Les surlignages et les soulignements de l’IA sont dessinés sur la page. Désactivé, la page reste nette : les marques restent dans le livre et dans la liste Marques, et en enregistrer une nouvelle réactive l’option. Le même interrupteur se trouve dans le panneau Affichage du lecteur et ne vaut que pour ce téléphone.",
} satisfies Translation<typeof en>;
