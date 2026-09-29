import type { Translation } from "../types";
import type en from "./en";

// Brazilian Portuguese wording.
export default {
  title: "Ajustes",
  done: "OK",
  "tab.account": "Conta",
  "tab.features": "Recursos",
  "tab.optional": "Opcional",
  connected: "Conectado",
  save: "Salvar",
  signOut: "Sair",
  apiKey: "Chave de API",

  "thinking.off": "Desativado",
  "thinking.low": "Baixo",
  "thinking.medium": "Médio",
  "thinking.high": "Alto",

  "account.providers": "Provedores",
  "account.signInWith": "Entrar com {name}",
  "account.defaultConversation": "Conversa padrão",
  "account.connectFirst": "Conecte um provedor acima para escolher um padrão.",
  "account.provider": "Provedor",
  "account.model": "Modelo",
  "account.select": "Selecionar…",
  "account.contextHint":
    "O número ao lado de cada modelo é a janela de contexto dele. Este app coloca um livro inteiro nela; numa janela menor, a resposta corta material para caber e diz o que cortou.",
  "account.everydayModel": "Modelo do dia a dia",
  "account.sameAsChat": "Igual ao chat",
  "account.everydayHint":
    "O trabalho de rotina roda aqui em vez de no modelo acima: as refeições e o resumo noturno. Ninguém está esperando por ele, então um modelo mais barato não custa nada a você; quais tarefas pertencem a ele é o app que decide, não este ajuste. Ele usa o provedor acima.",
  "account.briefing": "Resumo de notícias",
  "account.screening": "Triagem",
  "account.analysis": "Análise",
  "account.briefingHint":
    "O resumo é montado durante a noite a partir de todas as fontes, você lendo ou não. A triagem lê as manchetes do dia para decidir quais artigos vale a pena buscar, por isso é a etapa para manter baixa; a análise lê os que passaram.",
  "account.thinking": "Raciocínio",
  "account.chat": "Chat",
  "account.lessonPrep": "Preparação de aulas",
  "account.thinkingHint":
    "Modelos adaptativos decidem a cada pergunta quanto raciocinar de fato; mais alto = mais profundo, porém mais lento.",
  "account.sync": "Sincronização",

  "oauth.signInFailed": "Falha ao entrar",
  "oauth.openFailed": "Não foi possível abrir a página de login",
  "oauth.invalidCode": "Código inválido",
  "oauth.pasteHintDevice":
    "Depois de entrar, copie a barra de endereço (a URL localhost que não carrega) e cole aqui.",
  "oauth.pasteHintCode": "Cole o código exibido depois de aprovar o acesso.",
  "oauth.opening": "Abrindo a página de login…",
  "oauth.completeInBrowser": "Conclua a autorização no navegador…",
  "oauth.withCode": "Entrar com um código",
  "oauth.pastePlaceholder": "Cole o código ou a URL de login",
  "oauth.submit": "Enviar",
  "oauth.signsOutOthers": "Entrar aqui desconecta os outros provedores.",
  "oauth.requestingCode": "Solicitando um código de login…",
  "oauth.openPage": "Abrir página de login",
  "oauth.enterCode": "Digite este código em {url}. Aguardando autorização…",
  "oauth.cancel": "Cancelar",
  "oauth.pasteInstead": "Colar a URL de login",
  "oauth.tryAgain": "Tentar novamente",

  "key.replace": "Substituir chave de API",
  "key.signsOutOthers": "Salvar uma chave aqui desconecta os outros provedores.",

  "sync.drive": "Google Drive",
  "sync.never": "Nunca",
  "sync.justNow": "Agora mesmo",
  "sync.minutesAgo": { one: "Há {count} minuto", other: "Há {count} minutos" },
  "sync.failed": "Falha na sincronização",
  "sync.notConfigured": "O cliente do Google não está configurado.",
  "sync.signIn": "Entrar com o Google",
  "sync.signedOutNote":
    "Tudo desde a última sincronização está só neste dispositivo. Entre novamente para retomar; nada local é perdido.",
  "sync.pitch": "Sincronize o progresso de leitura, as marcações e os livros com o seu próprio Google Drive.",
  "sync.completeInBrowser": "Conclua o login no navegador…",
  "sync.lastSync": "Última sincronização: {time}",
  "sync.auto": "Sincronizar automaticamente",
  "sync.running": "Sincronizando…",
  "sync.now": "Sincronizar agora",

  "features.general": "Geral",
  "features.language": "Idioma",
  "features.languageAuto": "Automático (app: sistema; IA: seu idioma)",
  "features.languageHint":
    "O idioma do app e de tudo o que a IA escreve: respostas do chat, notas e o resumo de notícias. No automático, o app usa o idioma do sistema e a IA responde no idioma em que você escreve. A transcrição de voz sempre segue o que você fala.",
  "features.paper": "Fundo de papel",
  "features.paperHint":
    "Troca o branco por trás de todo o app (chats, estantes, barras laterais, esta janela e as páginas dos livros) por uma cor de papel off-white. Há um só tom e nenhum mais escuro; não é um modo escuro. A escolha fica neste dispositivo.",
  "features.reading": "Leitura",
  "features.fingerDraw": "Desenhar com o dedo",
  "features.fingerDrawHint":
    "Desativado, o dedo só move a página e a caneta faz as marcações, seja qual for a ferramenta escolhida. Ative num dispositivo sem caneta, onde o dedo precisa poder destacar e desenhar. O bloqueio de navegação do leitor continua tendo prioridade sobre os dois. Ter ou não caneta é uma característica do dispositivo, então este ajuste fica nele.",
  "features.briefing": "Resumo de notícias",
  "features.collect": "Coletar das suas fontes neste computador",
  "features.collectHint":
    "Cada fonte é verificada no seu próprio horário e o que ela publicou fica guardado até o resumo do dia ser montado. Desativado, esta máquina para de coletar por completo e outro coletor, se você tiver, assume.",
  "features.thisComputer": "Este computador",
  "features.role": "Esta máquina é um",
  "features.roleCollector": "Coletor — lê as fontes aqui",
  "features.roleReader": "Leitor — lê o que outra máquina coletou",
  "features.roleHint":
    "Um coletor lê os sites que você assina o dia todo e publica o resumo para os seus outros dispositivos; um leitor mostra o que um coletor publicou e nunca busca nada de um site por conta própria. Celulares e tablets são sempre leitores. Se duas máquinas coletam, trabalha a que está ligada há mais tempo.",
  "features.autostart": "Abrir o Reading Partner quando este computador iniciar",
  "features.autostartHint":
    "Desativado por padrão. Ative na máquina que você quer que colete suas fontes o dia todo: junto com o ícone da bandeja, o resumo é montado quer você abra o app ou não. Este ajuste pertence a este computador e não vai para os seus outros dispositivos.",

  "optional.intro":
    "Chaves para serviços externos, todas opcionais. As duas chaves de voz ficam com as credenciais deste dispositivo e nunca são sincronizadas, então cada dispositivo precisa das suas.",
  "optional.meals": "Refeições",
  "optional.mealsHint":
    "Planeje os cafés da manhã, almoços e jantares da semana, mantenha a lista de compras e avise quando comer outra coisa.",
  "optional.lessonPrep": "Preparação de aulas",
  "optional.s2Key": "Chave de API do Semantic Scholar",
  "optional.s2Placeholder": "Opcional",
  "optional.s2Hint":
    "Uma chave gratuita do semanticscholar.org evita os limites de uso compartilhados que travam a busca de artigos.",
  "optional.voiceInput": "Entrada de voz",
  "optional.voiceOutput": "Saída de voz",
  "optional.dictationLanguage": "Idioma do ditado",
  "optional.dictationHint":
    "O idioma que o iPhone escuta quando você segura a barra e fala. A fala é transcrita no celular e nunca é enviada. Falar outro idioma não gera uma transcrição imprecisa, e sim uma errada que parece certa, então escolha o idioma que você realmente fala.",
  "optional.speechKey": "Chave de API de voz",
  "optional.speechKeyReplace": "Substituir chave de API de voz",
  "optional.speechHint":
    "Uma chave do Xiaomi MiMo, para a voz que lê as respostas em voz alta. Sem ela o app fica em silêncio e todo o resto funciona como agora.",
  "optional.sttKey": "Chave de API de STT",
  "optional.sttKeyReplace": "Substituir chave de API de STT",
  "optional.model": "Modelo",
  "optional.baseUrl": "URL base",
  "optional.sttHint":
    "Segure o microfone na caixa de chat para falar. O plano SenseVoice da SiliconFlow é gratuito e a chave de API funciona direto; qualquer serviço de transcrição compatível com OpenAI também serve.",
} satisfies Translation<typeof en>;
