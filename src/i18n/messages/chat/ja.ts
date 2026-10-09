import type { Translation } from "../types";
import type en from "./en";

export default {
  "phase.thinking": "考え中",

  "composer.removeImage": "画像を削除",
  "composer.switchToKeyboard": "キーボードに切り替え",
  "composer.switchToVoice": "音声に切り替え",
  "composer.stop": "停止",
  "composer.send": "送信",
  "call.reply": "返信…",

  "dispatch.noRecord": "この端末には記録がありません。",
  "dispatch.backWithAnswer": "答えを持って戻りました。",
  "dispatch.stoppedBeforeFinished": "終わる前に止まりました。",
  "dispatch.stoppedNoReason": "理由を告げずに止まりました。",
  "dispatch.stillOut": " — まだ戻っていません",
  "dispatch.needsDecision": " — あなたの判断が必要です",
  "dispatch.backSeeBelow": "戻りました — 下を見る",

  "list.copy": "コピー",
  "list.copied": "コピーしました",
  "list.attachment": "添付",
  "list.toolFailed": "失敗",
  "list.jumpToLatest": "最新へ移動",

  "toolLabel.readingPage": "{page} ページを読んでいます",
  "toolLabel.readingPages": "{from}–{to} ページを読んでいます",
  "toolLabel.readingThePages": "ページを読んでいます",

  "conversations.searchingFor": "「{query}」で過去の会話を検索しています",
  "conversations.searching": "過去の会話を検索しています",
  "conversations.readingBack": "過去の会話を読み返しています",

  "delegate.handingToKind": "{kind} のワーカーに任せています",
  "delegate.handingOver": "ワーカーに任せています",
  "delegate.sentOffWork": "{kind} の作業を送り出しました",

  "places.goingTo": "{place} へ移動しています",
  "places.goingSomewhere": "アプリ内を移動しています",
  "places.wentSomewhere": "移動しました",

  "statements.writingSelf": "あなたが自分について言ったことを書き留めています",
  "statements.wroteKind": "{kind} を書き留めました",
  "statements.rewroteKind": "{kind} を書き直しました",

  "filing.proposingUnder": "{topic} に入れることを提案しています",
  "filing.proposingWhere": "どこに入れるか提案しています",
  "filing.proposedWhere": "入れ先を提案しました",

  "observations.searchingFor": "「{query}」で観察記録を検索しています",
  "observations.searching": "観察記録を検索しています",
  "observations.reading": "観察記録を読んでいます",
  "observations.dropping": "観察記録を削除しています",
  "observations.writing": "観察記録を書き留めています",
  "observations.updating": "観察記録を更新しています",
  "observations.wroteReceipt": "観察記録を書き留めました",
  "observations.addedEvidence": "観察記録に根拠を追加しました",
  "observations.droppedReceipt": "観察記録を削除しました",
  "observations.updatedReceipt": "観察記録を更新しました",

  "papers.searchingFor": "「{query}」で文献を検索しています",
  "papers.searching": "文献を検索しています",
  "papers.lookingUpFor": "「{paper}」を調べています",
  "papers.lookingUp": "論文を調べています",
  "papers.walkingCitationsFor": "「{paper}」の引用をたどっています",
  "papers.walkingCitations": "引用をたどっています",

  "figures.lookingAtId": "図 {id} を見ています",
  "figures.lookingAt": "図を見ています",

  "prep.searchingBookFor": "「{query}」で本の中を検索しています",
  "prep.searchingBook": "本の中を検索しています",
  "prep.readingNote": "論文のノートを読んでいます",
  "prep.searchingPaperFor": "「{query}」で論文を検索しています",
  "prep.searchingPaper": "論文を検索しています",
  "prep.takingInHost": "{host} を取り込んでいます",
  "prep.takingInPage": "ページを取り込んでいます",

  "saved.lookingThroughFor": "「{query}」で保存した記事を探しています",
  "saved.lookingThrough": "保存した記事を見ています",
  "saved.savingArticle": "記事を保存しています",
  "saved.addedToPrepList": "予習リストに記事を追加しました",
  "saved.keptArticles": "保存した記事",

  "call.preparing": "準備中…",
  "call.preparingProgress": "準備中 {done}/{total}",
  "call.pageRange": "p.{first}-{last}",
  "call.page": "p.{page}",
  "call.pageBadge": "p.{page}",
  "call.clearFocus": "章の絞り込みを解除",
  "call.backToReading": "読書に戻る",
  "call.deleteConversation": "会話を削除",
  "call.deleteTitle": "この会話を削除しますか？",
  "call.deleteDescription": "会話と、それを開いたマークが削除されます。この操作は取り消せません。",
} satisfies Translation<typeof en>;
