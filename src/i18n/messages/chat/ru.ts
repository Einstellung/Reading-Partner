import type { Translation } from "../types";
import type en from "./en";

export default {
  "phase.thinking": "Обдумывает",

  "composer.removeImage": "Удалить изображение",
  "composer.switchToKeyboard": "Переключиться на клавиатуру",
  "composer.switchToVoice": "Переключиться на голос",
  "composer.stop": "Стоп",
  "composer.send": "Отправить",
  "call.reply": "Ответить…",

  "dispatch.noRecord": "На этом устройстве нет об этом записи.",
  "dispatch.backWithAnswer": "Вернулся с ответом.",
  "dispatch.stoppedBeforeFinished": "Остановился, не закончив.",
  "dispatch.stoppedNoReason": "Остановился, не объяснив почему.",
  "dispatch.stillOut": " — всё ещё выполняется",
  "dispatch.needsDecision": " — нужно ваше решение",
  "dispatch.backSeeBelow": "Готово — смотрите ниже",

  "list.copy": "Копировать",
  "list.copied": "Скопировано",
  "list.attachment": "вложение",
  "list.toolFailed": "ошибка",
  "list.jumpToLatest": "К последнему",

  "toolLabel.readingPage": "Читает страницу {page}",
  "toolLabel.readingPages": "Читает страницы {from}–{to}",
  "toolLabel.readingThePages": "Читает страницы",

  "conversations.searchingFor": "Ищет «{query}» в прошлых разговорах",
  "conversations.searching": "Ищет в прошлых разговорах",
  "conversations.readingBack": "Перечитывает разговор",

  "delegate.handingToKind": "Передаёт задачу работнику «{kind}»",
  "delegate.handingOver": "Передаёт задачу работнику",
  "delegate.sentOffWork": "Задача «{kind}» отправлена",

  "places.goingTo": "Переходит в {place}",
  "places.goingSomewhere": "Перемещается по приложению",
  "places.wentSomewhere": "Переместился",

  "statements.writingSelf": "Записывает, что вы сказали о себе",
  "statements.wroteKind": "Записано: {kind}",
  "statements.rewroteKind": "Переписано: {kind}",

  "filing.proposingUnder": "Предлагает отнести это к «{topic}»",
  "filing.proposingWhere": "Предлагает, куда это отнести",
  "filing.proposedWhere": "Предложено, куда это отнести",

  "observations.searchingFor": "Ищет «{query}» в своих наблюдениях",
  "observations.searching": "Ищет в своих наблюдениях",
  "observations.reading": "Читает наблюдение",
  "observations.dropping": "Удаляет наблюдение",
  "observations.writing": "Записывает наблюдение",
  "observations.updating": "Обновляет наблюдение",
  "observations.wroteReceipt": "Наблюдение записано",
  "observations.addedEvidence": "К наблюдению добавлено подтверждение",
  "observations.droppedReceipt": "Наблюдение удалено",
  "observations.updatedReceipt": "Наблюдение обновлено",

  "papers.searchingFor": "Ищет «{query}» в научной литературе",
  "papers.searching": "Ищет в научной литературе",
  "papers.lookingUpFor": "Ищет «{paper}»",
  "papers.lookingUp": "Ищет статью",
  "papers.walkingCitationsFor": "Просматривает ссылки на «{paper}»",
  "papers.walkingCitations": "Просматривает ссылки",

  "figures.lookingAtId": "Смотрит на рисунок {id}",
  "figures.lookingAt": "Смотрит на рисунок",

  "prep.searchingBookFor": "Ищет «{query}» в книге",
  "prep.searchingBook": "Ищет в книге",
  "prep.readingNote": "Читает заметку к статье",
  "prep.searchingPaperFor": "Ищет «{query}» в статье",
  "prep.searchingPaper": "Ищет в статье",
  "prep.takingInHost": "Загружает {host}",
  "prep.takingInPage": "Загружает страницу",

  "saved.lookingThroughFor": "Ищет «{query}» среди сохранённого",
  "saved.lookingThrough": "Просматривает сохранённое",
  "saved.savingArticle": "Сохраняет статью",
  "saved.addedToPrepList": "Статья добавлена в список для подготовки",
  "saved.keptArticles": "Сохранённые статьи",

  "call.preparing": "Подготовка…",
  "call.preparingProgress": "Подготовка {done}/{total}",
  "call.pageRange": "с. {first}-{last}",
  "call.page": "с. {page}",
  "call.pageBadge": "с. {page}",
  "call.clearFocus": "Снять фокус с главы",
  "call.backToReading": "Вернуться к чтению",
  "call.deleteConversation": "Удалить разговор",
  "call.deleteTitle": "Удалить этот разговор?",
  "call.deleteDescription": "Разговор будет удалён вместе с пометкой, из которой он был открыт. Это действие нельзя отменить.",
} satisfies Translation<typeof en>;
