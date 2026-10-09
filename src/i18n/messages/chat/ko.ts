import type { Translation } from "../types";
import type en from "./en";

export default {
  "phase.thinking": "생각 중",

  "composer.removeImage": "이미지 제거",
  "composer.switchToKeyboard": "키보드로 전환",
  "composer.switchToVoice": "음성으로 전환",
  "composer.stop": "중지",
  "composer.send": "보내기",
  "call.reply": "답장…",

  "dispatch.noRecord": "이 기기에는 기록이 없습니다.",
  "dispatch.backWithAnswer": "답을 가지고 돌아왔습니다.",
  "dispatch.stoppedBeforeFinished": "끝나기 전에 멈췄습니다.",
  "dispatch.stoppedNoReason": "이유를 말하지 않고 멈췄습니다.",
  "dispatch.stillOut": " — 아직 돌아오지 않음",
  "dispatch.needsDecision": " — 당신의 판단이 필요함",
  "dispatch.backSeeBelow": "돌아왔습니다 — 아래 참조",

  "list.copy": "복사",
  "list.copied": "복사됨",
  "list.attachment": "첨부",
  "list.toolFailed": "실패",
  "list.jumpToLatest": "최신으로 이동",

  "toolLabel.readingPage": "{page}쪽을 읽는 중",
  "toolLabel.readingPages": "{from}–{to}쪽을 읽는 중",
  "toolLabel.readingThePages": "페이지를 읽는 중",

  "conversations.searchingFor": "“{query}”로 이전 대화를 검색하는 중",
  "conversations.searching": "이전 대화를 검색하는 중",
  "conversations.readingBack": "이전 대화를 다시 읽는 중",

  "delegate.handingToKind": "{kind} 작업자에게 맡기는 중",
  "delegate.handingOver": "작업자에게 맡기는 중",
  "delegate.sentOffWork": "{kind} 작업을 넘겼습니다",

  "places.goingTo": "{place}(으)로 이동하는 중",
  "places.goingSomewhere": "앱 안에서 이동하는 중",
  "places.wentSomewhere": "이동했습니다",

  "statements.writingSelf": "당신이 자신에 대해 한 말을 적는 중",
  "statements.wroteKind": "{kind}을(를) 적었습니다",
  "statements.rewroteKind": "{kind}을(를) 다시 썼습니다",

  "filing.proposingUnder": "{topic} 아래에 두는 것을 제안하는 중",
  "filing.proposingWhere": "어디에 둘지 제안하는 중",
  "filing.proposedWhere": "둘 곳을 제안했습니다",

  "observations.searchingFor": "“{query}”로 관찰 기록을 검색하는 중",
  "observations.searching": "관찰 기록을 검색하는 중",
  "observations.reading": "관찰 기록을 읽는 중",
  "observations.dropping": "관찰 기록을 삭제하는 중",
  "observations.writing": "관찰 기록을 적는 중",
  "observations.updating": "관찰 기록을 업데이트하는 중",
  "observations.wroteReceipt": "관찰 기록을 적었습니다",
  "observations.addedEvidence": "관찰 기록에 근거를 추가했습니다",
  "observations.droppedReceipt": "관찰 기록을 삭제했습니다",
  "observations.updatedReceipt": "관찰 기록을 업데이트했습니다",

  "papers.searchingFor": "“{query}”로 문헌을 검색하는 중",
  "papers.searching": "문헌을 검색하는 중",
  "papers.lookingUpFor": "“{paper}”을(를) 찾아보는 중",
  "papers.lookingUp": "논문을 찾아보는 중",
  "papers.walkingCitationsFor": "“{paper}”의 인용을 따라가는 중",
  "papers.walkingCitations": "인용을 따라가는 중",

  "figures.lookingAtId": "그림 {id}을(를) 보는 중",
  "figures.lookingAt": "그림을 보는 중",

  "prep.searchingBookFor": "“{query}”로 책 속을 검색하는 중",
  "prep.searchingBook": "책 속을 검색하는 중",
  "prep.readingNote": "논문 노트를 읽는 중",
  "prep.searchingPaperFor": "“{query}”로 논문을 검색하는 중",
  "prep.searchingPaper": "논문을 검색하는 중",
  "prep.takingInHost": "{host}을(를) 가져오는 중",
  "prep.takingInPage": "페이지를 가져오는 중",

  "saved.lookingThroughFor": "“{query}”로 저장한 글을 찾는 중",
  "saved.lookingThrough": "저장한 글을 보는 중",
  "saved.savingArticle": "글을 저장하는 중",
  "saved.addedToPrepList": "예습 목록에 글을 추가했습니다",
  "saved.keptArticles": "저장한 글",

  "call.preparing": "준비 중…",
  "call.preparingProgress": "준비 중 {done}/{total}",
  "call.pageRange": "p.{first}-{last}",
  "call.page": "p.{page}",
  "call.pageBadge": "p.{page}",
  "call.clearFocus": "챕터 초점 해제",
  "call.backToReading": "읽기로 돌아가기",
  "call.deleteConversation": "대화 삭제",
  "call.deleteTitle": "이 대화를 삭제할까요?",
  "call.deleteDescription": "대화와 함께 대화를 연 표시도 삭제됩니다. 이 작업은 되돌릴 수 없습니다.",
} satisfies Translation<typeof en>;
