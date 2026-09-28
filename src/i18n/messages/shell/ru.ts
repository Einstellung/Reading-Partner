import type { Translation } from "../types";
import type en from "./en";

export default {
  "toast.cantOpenDownloading": "Не удалось открыть — возможно, загрузка ещё не завершена.",
  "toast.cantOpenFile": "Не удалось открыть этот файл — возможно, он перемещён или удалён.",
  "toast.cantReadFile": "Не удалось прочитать этот файл — возможно, он перемещён или удалён.",
  "toast.asideGone": "Этого бокового разговора больше нет.",
  "toast.conversationsUnloadable": "Не удалось загрузить сохранённые разговоры с ИИ",
  "toast.cantShareFile": "Не удалось передать этот файл другому приложению.",

  "call.askAboutThisTitle": "Спросить об этом",
  "call.askAboutThisPlaceholder": "Спросить об этом…",
  "call.teachPlaceholder": "Попросите объяснить часть этой книги…",
  "call.thisBookFallback": "Эта книга",
  "call.configurePrompt": "Подключите провайдера в настройках, чтобы начать разговор.",
  "call.openSettings": "Открыть настройки",
  "call.retry": "Повторить",

  "action.dismiss": "Закрыть",
  "action.cancel": "Отмена",
  "action.delete": "Удалить",

  "savedArticle.backLabel": "Сохранённое",

  "nav.settings": "Настройки",
  "nav.settingsNeedsAttention": "Настройки — синхронизация требует внимания",
  "sidebar.sections": "Разделы",
  "sidebar.expand": "Развернуть боковую панель",
  "sidebar.collapse": "Свернуть боковую панель",
  "sidebar.updating": "Обновление…",
  "sidebar.restartToUpdate": "Перезапустить для обновления",

  "lumen.show": "Показать Lumen",
  "lumen.hide": "Скрыть Lumen",
  "lumen.needsDecision": "Требуется решение",

  "box.bookFallback": "Какая-то книга",
  "box.originBookPage": "{book} · с. {page}",
  "box.originDoor": "У двери · {date}",
  "box.originBriefing": "Сводка · {date}",
  "box.originMeals": "Питание",
  "box.label": "Ящик",
  "box.waiting": {
    one: "Ящик, {count} в ожидании",
    few: "Ящик, {count} в ожидании",
    many: "Ящик, {count} в ожидании",
    other: "Ящик, {count} в ожидании",
  },
  "box.empty": "В ящике пусто.",
  "box.notReadable": "Это внутри книги. Откройте её на iPad или на столе.",

  "figure.label": "Рис. {id} · с.{page}",
  "figure.number": "Рис. {id}",
  "figure.pageSuffix": "· с.{page}",
  "figure.notFound": "В этом документе нет рисунка {id}.",
  "figure.loading": "Загрузка рисунка…",
  "figure.notRendered": "Не удалось отобразить этот рисунок.",
  "figure.rendering": "Отрисовка рисунка…",

  "peer.desktopMac": "Mac",
  "peer.desktopWindows": "ПК с Windows",
  "peer.desktopLinux": "компьютер с Linux",
  "peer.desktopFallback": "компьютер",
  "peer.notice": "{name} всё ещё на {version}. Откройте там Reading Partner, чтобы обновить до {target}.",

  "sync.credentialsMissing":
    "Автосинхронизация включена, но на этом устройстве выполнен выход из Google — ничего не синхронизируется.",
  "sync.engineStopped": "Автосинхронизация включена, но движок синхронизации не запущен.",
  "sync.neverSynced": "На этом устройстве синхронизация ещё ни разу не завершалась.",
  "sync.neverSyncedWithError":
    "На этом устройстве синхронизация ещё ни разу не завершалась. Последняя ошибка: {error}",
  "sync.stalled": "Синхронизация не проходила успешно уже больше суток.",
  "sync.stalledWithError": "Синхронизация не проходила успешно уже больше суток. Последняя ошибка: {error}",
  "sync.lastFailed": "Последняя синхронизация не удалась: {error}",

  "auth.notConfigured": "Клиент Google не настроен",
  "auth.tokenRequestFailed": "Не удалось получить токен Google (HTTP {status}): {text}",
  "auth.redirectCaptureFailed": "Не удалось перехватить перенаправление при входе через Google: {error}",
  "auth.signInTimedOut": "Истекло время ожидания перенаправления при входе через Google",
  "auth.authorizationError": "Ошибка авторизации Google: {error}",
  "auth.noRefreshToken":
    "Google не вернул токен обновления; попробуйте удалить приложение на myaccount.google.com и войти снова.",

  "image.noCanvasContext": "Не удалось обработать изображение (нет контекста canvas).",
  "image.tooLarge": "Изображение всё ещё слишком большое после сжатия ({mb} МБ, максимум 5 МБ).",
  "image.decodeFailed": "Не удалось декодировать изображение.",

  "nav.today": "Сегодня",
  "nav.briefing": "Сводка",
  "nav.meals": "Питание",
  "nav.topics": "Темы",
} satisfies Translation<typeof en>;
