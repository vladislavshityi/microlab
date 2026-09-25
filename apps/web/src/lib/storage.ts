/**
 * Безопасный доступ к localStorage для пользовательских настроек интерфейса
 * (тема, размеры панелей).
 *
 * Хранилище может быть недоступно (приватный режим, запрет cookies, превышение квоты):
 * в этом случае чтение возвращает null, а запись молча игнорируется — интерфейс
 * работает со значениями по умолчанию.
 */

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Настройка не сохранится между сессиями, но текущая работа не прерывается.
  }
}

/** Разбирает JSON без исключений; некорректная строка превращается в undefined. */
export function parseJson(value: string | null): unknown {
  if (value === null) {
    return undefined;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
