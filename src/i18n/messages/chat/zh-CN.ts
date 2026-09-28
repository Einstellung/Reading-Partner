import type { Translation } from "../types";
import type en from "./en";

export default {
  "phase.thinking": "思考中",

  "composer.removeImage": "移除图片",
  "composer.switchToKeyboard": "切换到键盘",
  "composer.switchToVoice": "切换到语音",
  "composer.stop": "停止",
  "composer.send": "发送",

  "dispatch.noRecord": "这台设备上没有它的记录。",
  "dispatch.backWithAnswer": "已经带着答案回来了。",
  "dispatch.stoppedBeforeFinished": "还没完成就停下了。",
  "dispatch.stoppedNoReason": "停下了，但没说为什么。",
  "dispatch.stillOut": " — 还没回来",
  "dispatch.needsDecision": " — 需要你来定",
  "dispatch.backSeeBelow": "已回来 — 见下方",

  "list.copy": "复制",
  "list.copied": "已复制",
  "list.attachment": "附件",
  "list.toolFailed": "失败",

  "toolLabel.readingPage": "正在读第 {page} 页",
  "toolLabel.readingPages": "正在读第 {from}–{to} 页",
  "toolLabel.readingThePages": "正在读页面",

  "conversations.searchingFor": "正在以“{query}”搜索以前的对话",
  "conversations.searching": "正在搜索以前的对话",
  "conversations.readingBack": "正在读取一段对话",

  "delegate.handingToKind": "正在交给一个{kind}工作者",
  "delegate.handingOver": "正在把这件事交出去",
  "delegate.sentOffWork": "已交出{kind}工作",

  "places.goingTo": "正在前往{place}",
  "places.goingSomewhere": "正在应用内移动",
  "places.wentSomewhere": "已经去过了",

  "statements.writingSelf": "正在记下你对自己说的话",
  "statements.wroteKind": "记下了一条{kind}",
  "statements.rewroteKind": "重写了一条{kind}",

  "filing.proposingUnder": "正在提议归入{topic}",
  "filing.proposingWhere": "正在提议归属",
  "filing.proposedWhere": "已提议归属",

  "observations.searchingFor": "正在以“{query}”搜索它的观察记录",
  "observations.searching": "正在搜索它的观察记录",
  "observations.reading": "正在读取一条观察记录",
  "observations.dropping": "正在删除一条观察记录",
  "observations.writing": "正在记下一条观察记录",
  "observations.updating": "正在更新一条观察记录",
  "observations.wroteReceipt": "记下了一条观察记录",
  "observations.addedEvidence": "为一条观察记录添加了依据",
  "observations.droppedReceipt": "删除了一条观察记录",
  "observations.updatedReceipt": "更新了一条观察记录",

  "papers.searchingFor": "正在以“{query}”搜索文献",
  "papers.searching": "正在搜索文献",
  "papers.lookingUpFor": "正在查找“{paper}”",
  "papers.lookingUp": "正在查找一篇论文",
  "papers.walkingCitationsFor": "正在追溯“{paper}”的引用",
  "papers.walkingCitations": "正在追溯引用",

  "figures.lookingAtId": "正在查看图 {id}",
  "figures.lookingAt": "正在查看一张图",

  "prep.searchingBookFor": "正在以“{query}”搜索这本书",
  "prep.searchingBook": "正在搜索这本书",
  "prep.readingNote": "正在读取一篇论文的笔记",
  "prep.searchingPaperFor": "正在以“{query}”搜索这篇论文",
  "prep.searchingPaper": "正在搜索这篇论文",
  "prep.takingInHost": "正在收录 {host}",
  "prep.takingInPage": "正在收录一个网页",

  "saved.lookingThroughFor": "正在以“{query}”查找你收藏的内容",
  "saved.lookingThrough": "正在查看你收藏的内容",
  "saved.savingArticle": "正在保存这篇文章",
  "saved.addedToPrepList": "已将一篇文章加入预读列表",
  "saved.keptArticles": "收藏的文章",
} satisfies Translation<typeof en>;
