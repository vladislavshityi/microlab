// Словарь русского UI (основной язык интерфейса; UI готов к i18n).
// Phase 0: без i18n-библиотеки; ключи имеют вид `area.entity.state`, плейсхолдеры — `{name}`.
// В Phase 0 нет числовых форм множественного числа (для них нужен Intl.PluralRules вместе
// с i18n-библиотекой в Phase 1).
/** Локаль BCP 47 для Intl-форматирования (даты, время, числа) русского UI. */
export const RU_LOCALE = "ru-RU";

export const ru = {
  "app.name": "MicroLab",
  "app.documentTitle": "{page} — MicroLab",

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
