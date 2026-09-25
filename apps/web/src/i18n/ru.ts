// Словарь русского UI (основной язык интерфейса; UI готов к i18n).
// Без i18n-библиотеки; ключи имеют вид `area.entity.state`, плейсхолдеры — `{name}`.
// Строк с числовыми формами множественного числа пока нет (для них понадобится
// Intl.PluralRules).
/** Локаль BCP 47 для Intl-форматирования (даты, время, числа) русского UI. */
export const RU_LOCALE = "ru-RU";

export const ru = {
  "app.name": "MicroLab",
  "app.documentTitle": "{page} — MicroLab",

  "workspace.project.untitled": "Проект без названия",
  "workspace.board.none": "Плата не выбрана",
  "workspace.skip.canvas": "Перейти к схеме",
  "workspace.skip.bottom": "Перейти к нижней панели",
  "workspace.narrowViewport": "Рабочее пространство рассчитано на экран шириной от 1024 px.",

  "workspace.region.components": "Компоненты",
  "workspace.region.canvas": "Схема",
  "workspace.region.properties": "Свойства",
  "workspace.region.bottom": "Нижняя панель",

  "workspace.panel.collapseComponents": "Свернуть панель компонентов",
  "workspace.panel.expandComponents": "Развернуть панель компонентов",
  "workspace.panel.collapseProperties": "Свернуть панель свойств",
  "workspace.panel.expandProperties": "Развернуть панель свойств",
  "workspace.panel.collapseBottom": "Свернуть нижнюю панель",
  "workspace.panel.expandBottom": "Развернуть нижнюю панель",

  "workspace.resize.components": "Изменить ширину панели компонентов",
  "workspace.resize.properties": "Изменить ширину панели свойств",
  "workspace.resize.bottom": "Изменить высоту нижней панели",

  "components.search.label": "Поиск компонентов",
  "components.search.placeholder": "Поиск…",
  "components.search.empty": "Ничего не найдено",
  "components.notice.placementUnavailable": "Добавление на схему появится в следующей версии.",
  "components.category.board": "Платы",
  "components.category.basic": "Базовые",
  "components.category.passive": "Пассивные",
  "components.category.output": "Вывод",
  "components.category.sensors": "Датчики",
  "components.category.displays": "Дисплеи",
  "properties.empty": "Ничего не выбрано",

  "canvas.empty": "Схема пуста. Компоненты появятся в следующей версии.",
  "canvas.controls.label": "Масштаб схемы",
  "canvas.controls.zoomIn": "Увеличить",
  "canvas.controls.zoomOut": "Уменьшить",
  "canvas.controls.fitView": "Показать схему целиком",

  "bottom.tabs.label": "Вкладки нижней панели",
  "bottom.tab.code": "Код",
  "bottom.tab.console": "Консоль",
  "bottom.tab.serial": "Монитор порта",
  "bottom.tab.problems": "Проблемы",
  "bottom.comingSoon": "Скоро",

  "console.empty": "Нет сообщений",
  "serial.comingSoon": "Монитор порта появится вместе с симуляцией.",
  "problems.comingSoon": "Список проблем появится вместе с проверкой схемы и компиляцией.",

  "editor.label": "Редактор кода скетча",
  "editor.loading": "Загрузка редактора…",
  "editor.tabFocusHint": "Tab вставляет отступ. {shortcut} — выход из редактора клавишей Tab.",

  "notice.saveUnavailable": "Сохранение появится в следующих версиях",
  "notice.runUnavailable": "Запуск появится в следующих версиях",
  "notice.dismiss": "Скрыть уведомление",

  "theme.menu.label": "Тема оформления",
  "theme.menu.trigger": "Тема оформления: {theme}",
  "theme.system": "Системная",
  "theme.light": "Светлая",
  "theme.dark": "Тёмная",

  "health.indicator.details": "Подробнее о состоянии системы",

  "health.page.title": "Состояние системы",
  "health.page.description": "Проверка доступности backend и базы данных.",

  "health.check.backend": "Backend",
  "health.check.database": "База данных",
  "health.check.version": "Версия API",

  "health.backend.ok": "Доступен",
  "health.backend.unreachable": "Недоступен",
  "health.backend.unexpected": "Ошибка ответа",

  "health.database.ok": "Доступна",
  "health.database.error": "Недоступна",
  "health.database.unknown": "Неизвестно",

  "health.version.unknown": "—",

  "health.summary.ok.title": "Все системы работают",
  "health.summary.ok.description": "Backend и база данных отвечают.",
  "health.summary.databaseDown.title": "БД недоступна",
  "health.summary.databaseDown.description":
    "Backend работает, но не может подключиться к базе данных. Убедитесь, что PostgreSQL запущен, и повторите проверку.",
  "health.summary.backendUnreachable.title": "Backend недоступен",
  "health.summary.backendUnreachable.description":
    "Не удалось получить ответ от сервера. Убедитесь, что API запущен, и повторите проверку.",
  "health.summary.unexpected.title": "Неожиданный ответ сервера",
  "health.summary.unexpected.description":
    "Сервер ответил в неизвестном формате. Возможно, версии frontend и backend не совпадают.",

  "health.action.retry": "Проверить снова",
  "health.action.checking": "Проверка…",

  "health.meta.lastChecked": "Проверено в {time}",
  "health.meta.errorCode": "Код: {code}",
  "health.meta.httpStatus": "HTTP {status}",
  "health.meta.requestId": "Request ID: {id}",

  "health.a11y.loading": "Проверка состояния системы",

  "app.error.title": "Не удалось отобразить страницу",
  "app.error.description": "Произошла ошибка интерфейса. Перезагрузите страницу.",
  "app.error.reload": "Перезагрузить страницу",
} as const satisfies Record<string, string>;
