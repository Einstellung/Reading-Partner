import type { Translation } from "../types";
import type en from "./en";

// Brazilian Portuguese wording.
export default {
  "toast.cantOpenDownloading": "Não foi possível abrir — o download pode não ter terminado.",
  "toast.cantOpenFile": "Não foi possível abrir este arquivo — ele pode ter sido movido ou excluído.",
  "toast.cantReadFile": "Não foi possível ler este arquivo — ele pode ter sido movido ou excluído.",
  "toast.asideGone": "Essa conversa paralela não existe mais.",
  "toast.conversationsUnloadable": "Não foi possível carregar as conversas de IA salvas",
  "toast.cantShareFile": "Não foi possível enviar este arquivo para outro app.",

  "call.askAboutThisTitle": "Perguntar sobre isto",
  "call.askAboutThisPlaceholder": "Perguntar sobre isto…",
  "call.teachPlaceholder": "Peça para eu explicar uma parte deste livro…",
  "call.thisBookFallback": "Este livro",
  "call.configurePrompt": "Conecte um provedor em Ajustes para começar a conversar.",
  "call.openSettings": "Abrir Ajustes",
  "call.retry": "Tentar novamente",

  "action.dismiss": "Dispensar",
  "action.cancel": "Cancelar",
  "action.delete": "Excluir",

  "savedArticle.backLabel": "Salvos",

  "nav.settings": "Ajustes",
  "nav.settingsNeedsAttention": "Ajustes — a sincronização precisa de atenção",
  "sidebar.sections": "Seções",
  "sidebar.expand": "Expandir barra lateral",
  "sidebar.collapse": "Recolher barra lateral",
  "sidebar.updating": "Atualizando…",
  "sidebar.restartToUpdate": "Reiniciar para atualizar",

  "lumen.show": "Mostrar Lumen",
  "lumen.hide": "Ocultar Lumen",
  "lumen.needsDecision": "Precisa de uma decisão",

  "box.bookFallback": "Um livro",
  "box.originBookPage": "{book} · p. {page}",
  "box.originDoor": "Na porta · {date}",
  "box.originBriefing": "Resumo · {date}",
  "box.originMeals": "Refeições",
  "box.label": "A caixa",
  "box.waiting": { one: "A caixa, {count} pendente", other: "A caixa, {count} pendentes" },
  "box.empty": "Não há nada na caixa.",
  "box.notReadable": "Isso está dentro de um livro. Abra no iPad ou no computador.",

  "figure.label": "Fig. {id} · p.{page}",
  "figure.number": "Fig. {id}",
  "figure.pageSuffix": "· p.{page}",
  "figure.notFound": "Não há figura {id} neste documento.",
  "figure.loading": "Carregando figura…",
  "figure.notRendered": "Não foi possível exibir esta figura.",
  "figure.rendering": "Gerando a figura…",

  "peer.desktopMac": "seu Mac",
  "peer.desktopWindows": "seu PC com Windows",
  "peer.desktopLinux": "seu computador com Linux",
  "peer.desktopFallback": "seu computador",
  "peer.notice": "{name} ainda está na {version}. Abra o Reading Partner lá para atualizar para {target}.",

  "sync.credentialsMissing":
    "A sincronização automática está ativada, mas este dispositivo está desconectado do Google — nada está sincronizando.",
  "sync.engineStopped":
    "A sincronização automática está ativada, mas o mecanismo de sincronização não está em execução.",
  "sync.neverSynced": "Este dispositivo ainda não concluiu nenhuma sincronização.",
  "sync.neverSyncedWithError":
    "Este dispositivo ainda não concluiu nenhuma sincronização. Último erro: {error}",
  "sync.stalled": "Nenhuma sincronização foi concluída há mais de um dia.",
  "sync.stalledWithError": "Nenhuma sincronização foi concluída há mais de um dia. Último erro: {error}",
  "sync.lastFailed": "A última sincronização falhou: {error}",

  "auth.notConfigured": "O cliente do Google não está configurado",
  "auth.tokenRequestFailed": "A solicitação de token do Google falhou (HTTP {status}): {text}",
  "auth.redirectCaptureFailed": "O login do Google não conseguiu capturar o redirecionamento: {error}",
  "auth.signInTimedOut": "O login do Google expirou aguardando o redirecionamento",
  "auth.authorizationError": "Erro de autorização do Google: {error}",
  "auth.noRefreshToken":
    "O Google não retornou um token de atualização; tente remover o app em myaccount.google.com e fazer login novamente.",

  "image.noCanvasContext": "Não foi possível processar a imagem (sem contexto de canvas).",
  "image.tooLarge": "A imagem continua grande demais após a compressão ({mb} MB, máximo de 5 MB).",
  "image.decodeFailed": "Não foi possível decodificar a imagem.",

  "nav.today": "Hoje",
  "nav.briefing": "Resumo",
  "nav.meals": "Refeições",
  "nav.topics": "Tópicos",
} satisfies Translation<typeof en>;
