import type { Translation } from "../types";
import type en from "./en";

export default {
  title: "설정",
  done: "완료",
  "tab.account": "계정",
  "tab.features": "기능",
  "tab.optional": "선택 사항",
  connected: "연결됨",
  save: "저장",
  signOut: "로그아웃",
  apiKey: "API 키",

  "thinking.off": "끔",
  "thinking.low": "낮음",
  "thinking.medium": "중간",
  "thinking.high": "높음",

  "account.providers": "제공업체",
  "account.signInWith": "{name}(으)로 로그인",
  "account.defaultConversation": "기본 대화",
  "account.connectFirst": "기본값을 선택하려면 먼저 위에서 제공업체를 연결하세요.",
  "account.provider": "제공업체",
  "account.model": "모델",
  "account.select": "선택…",
  "account.contextHint":
    "각 모델 옆의 숫자는 컨텍스트 창 크기입니다. 이 앱은 책 한 권을 통째로 넣습니다. 창이 작으면 답변이 자료를 줄여 맞추고 무엇을 뺐는지 알려 줍니다.",
  "account.everydayModel": "일상 작업 모델",
  "account.sameAsChat": "채팅과 동일",
  "account.everydayHint":
    "일상적인 작업은 위의 모델 대신 여기서 실행됩니다: 식단과 야간 브리핑입니다. 아무도 기다리지 않는 작업이라 더 저렴한 모델을 써도 손해가 없습니다. 어떤 작업이 여기에 속하는지는 앱이 정합니다. 제공업체는 위와 같은 것을 사용합니다.",
  "account.briefing": "브리핑",
  "account.screening": "선별",
  "account.analysis": "분석",
  "account.briefingHint":
    "브리핑은 읽든 안 읽든 모든 소스에서 밤사이 만들어집니다. 선별은 그날의 헤드라인을 읽고 가져올 기사를 정하는 단계라 낮게 두는 것이 좋고, 분석은 통과한 기사를 읽습니다.",
  "account.thinking": "사고",
  "account.chat": "채팅",
  "account.lessonPrep": "수업 준비",
  "account.thinkingHint": "적응형 모델은 질문마다 실제로 얼마나 생각할지 정합니다. 높을수록 깊지만 느립니다.",
  "account.sync": "동기화",

  "oauth.signInFailed": "로그인하지 못했습니다",
  "oauth.openFailed": "로그인 페이지를 열 수 없습니다",
  "oauth.invalidCode": "잘못된 코드입니다",
  "oauth.pasteHintDevice":
    "로그인한 후 주소 표시줄(로드되지 않는 localhost URL)을 복사해 여기에 붙여 넣으세요.",
  "oauth.pasteHintCode": "접근을 승인한 후 표시되는 코드를 붙여 넣으세요.",
  "oauth.opening": "로그인 페이지를 여는 중…",
  "oauth.completeInBrowser": "브라우저에서 인증을 완료하세요…",
  "oauth.withCode": "코드로 로그인",
  "oauth.pastePlaceholder": "로그인 코드 또는 URL 붙여 넣기",
  "oauth.submit": "제출",
  "oauth.signsOutOthers": "여기서 로그인하면 다른 제공업체에서 로그아웃됩니다.",
  "oauth.requestingCode": "로그인 코드를 요청하는 중…",
  "oauth.openPage": "로그인 페이지 열기",
  "oauth.enterCode": "{url}에서 이 코드를 입력하세요. 인증을 기다리는 중…",
  "oauth.cancel": "취소",
  "oauth.pasteInstead": "대신 로그인 URL 붙여 넣기",
  "oauth.tryAgain": "다시 시도",

  "key.replace": "API 키 교체",
  "key.signsOutOthers": "여기서 키를 저장하면 다른 제공업체에서 로그아웃됩니다.",

  "sync.drive": "Google 드라이브",
  "sync.never": "없음",
  "sync.justNow": "방금",
  "sync.minutesAgo": { other: "{count}분 전" },
  "sync.failed": "동기화 작업에 실패했습니다",
  "sync.notConfigured": "Google 클라이언트가 설정되지 않았습니다.",
  "sync.signIn": "Google로 로그인",
  "sync.signedOutNote":
    "마지막 동기화 이후의 내용은 이 기기에만 있습니다. 다시 로그인하면 동기화가 재개되며, 로컬 데이터는 사라지지 않습니다.",
  "sync.pitch": "읽기 진행 상황, 표시, 책을 내 Google 드라이브에 동기화합니다.",
  "sync.completeInBrowser": "브라우저에서 로그인을 완료하세요…",
  "sync.lastSync": "마지막 동기화: {time}",
  "sync.auto": "자동으로 동기화",
  "sync.running": "동기화 중…",
  "sync.now": "지금 동기화",

  "features.general": "일반",
  "features.language": "언어",
  "features.languageAuto": "자동(화면은 시스템, AI는 사용자에 맞춤)",
  "features.languageHint":
    "앱의 표시 언어이자 AI가 쓰는 모든 글의 언어입니다: 채팅 답변, 노트, 뉴스 브리핑. 자동이면 앱은 시스템 언어로 표시되고 AI는 사용자가 쓴 언어로 답합니다. 음성 받아쓰기는 항상 말한 언어를 따릅니다.",
  "features.paper": "종이 배경",
  "features.paperHint":
    "앱 전체의 흰 바탕(채팅, 책장, 사이드바, 이 창, 책 페이지)을 미색 종이 색으로 바꿉니다. 색은 한 가지뿐이고 더 어두운 단계는 없습니다. 다크 모드가 아닙니다. 이 선택은 이 기기에만 저장됩니다.",
  "features.reading": "읽기",
  "features.fingerDraw": "손가락으로 그리기",
  "features.fingerDrawHint":
    "끄면 어떤 도구를 선택했든 손가락은 페이지만 움직이고 표시는 스타일러스로 합니다. 스타일러스가 없는 기기에서는 켜서 손가락으로도 하이라이트하고 그릴 수 있게 하세요. 리더의 탐색 잠금은 여전히 둘 다보다 우선합니다. 스타일러스 유무는 기기의 속성이므로 이 설정은 이 기기에만 저장됩니다.",
  "features.lumen": "Lumen 표시",
  "features.lumenHint":
    "Lumen은 리더를 포함한 모든 화면의 모서리에 있습니다. 끄면 모서리가 비고, 사이드바, 휴대폰 홈 화면, 리더의 더 보기 메뉴에 있는 Lumen 버튼으로 다시 불러올 수 있습니다. 이 설정은 이 기기에만 저장됩니다.",
  "features.briefing": "브리핑",
  "features.collect": "이 컴퓨터에서 소스 수집",
  "features.collectHint":
    "각 소스는 자체 일정에 따라 확인되고, 게시된 내용은 그날의 브리핑이 만들어질 때까지 보관됩니다. 끄면 이 컴퓨터는 수집을 완전히 멈추고, 다른 수집 기기가 있다면 그 기기가 이어받습니다.",
  "features.thisComputer": "이 컴퓨터",
  "features.role": "이 컴퓨터의 역할",
  "features.roleCollector": "수집 — 여기서 소스를 읽음",
  "features.roleReader": "읽기 — 다른 컴퓨터가 수집한 것을 읽음",
  "features.roleHint":
    "수집 기기는 구독한 사이트를 하루 종일 읽고 다른 기기를 위해 브리핑을 게시합니다. 읽기 기기는 수집 기기가 게시한 것을 보여 줄 뿐 사이트에서 직접 가져오지 않습니다. 휴대폰과 태블릿은 항상 읽기 기기입니다. 두 컴퓨터가 수집하면 가장 오래 실행 중인 쪽이 작업합니다.",
  "features.autostart": "컴퓨터가 시작될 때 Reading Partner 실행",
  "features.autostartHint":
    "기본값은 끔입니다. 하루 종일 소스를 수집할 컴퓨터에서 켜세요. 트레이와 함께라면 앱을 열었든 안 열었든 브리핑이 만들어집니다. 이 설정은 이 컴퓨터에 속하며 다른 기기로 옮겨지지 않습니다.",

  "optional.intro":
    "외부 서비스용 키이며 모두 선택 사항입니다. 두 음성 키는 이 기기의 자격 증명과 함께 보관되고 동기화되지 않으므로 기기마다 따로 설정해야 합니다.",
  "optional.meals": "식단",
  "optional.mealsHint": "일주일의 아침, 점심, 저녁을 계획하고 장보기 목록을 관리하며, 다른 것을 먹었을 때 알려 줄 수 있습니다.",
  "optional.lessonPrep": "수업 준비",
  "optional.s2Key": "Semantic Scholar API 키",
  "optional.s2Placeholder": "선택 사항",
  "optional.s2Hint": "semanticscholar.org의 무료 키를 쓰면 논문 가져오기를 멈추게 하는 공용 요청 한도를 피할 수 있습니다.",
  "optional.voiceInput": "음성 입력",
  "optional.voiceOutput": "음성 출력",
  "optional.dictationLanguage": "받아쓰기 언어",
  "optional.dictationHint":
    "바를 누른 채 말할 때 iPhone이 알아듣는 언어입니다. 음성은 휴대폰에서 받아쓰며 업로드되지 않습니다. 다른 언어로 말하면 거친 받아쓰기가 아니라 그럴듯하게 틀린 문장이 나오므로, 실제로 말하는 언어로 설정하세요.",
  "optional.speechKey": "음성 API 키",
  "optional.speechKeyReplace": "음성 API 키 교체",
  "optional.speechHint":
    "답변을 소리 내어 읽어 주는 음성을 위한 Xiaomi MiMo 키입니다. 없으면 앱은 소리를 내지 않을 뿐 나머지는 지금처럼 작동합니다.",
  "optional.sttKey": "음성 인식 API 키",
  "optional.sttKeyReplace": "음성 인식 API 키 교체",
  "optional.model": "모델",
  "optional.baseUrl": "기본 URL",
  "optional.sttHint":
    "채팅 입력란의 마이크를 누른 채 말하세요. SiliconFlow의 SenseVoice 요금제는 무료이며 API 키를 바로 쓸 수 있습니다. OpenAI 호환 받아쓰기 엔드포인트라면 무엇이든 됩니다.",
} satisfies Translation<typeof en>;
