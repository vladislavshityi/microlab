import { RU_LOCALE, ru } from "./ru";

/** Активная локаль UI для Intl API. Пока есть только русский. */
export const locale: string = RU_LOCALE;

export type TranslationKey = keyof typeof ru;

/** Имена плейсхолдеров в template literal type, например "Код: {code}" → "code". */
type Placeholders<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

type ParamsFor<K extends TranslationKey> = [Placeholders<(typeof ru)[K]>] extends [never]
  ? []
  : [params: Record<Placeholders<(typeof ru)[K]>, string>];

/** Ключи без плейсхолдеров — их можно хранить в данных и рендерить через `t(key)`. */
export type PlainTranslationKey = {
  [K in TranslationKey]: [Placeholders<(typeof ru)[K]>] extends [never] ? K : never;
}[TranslationKey];

/**
 * Типизированный поиск перевода (без i18n-библиотеки).
 * Ключи и обязательные параметры `{placeholder}` проверяются на этапе компиляции.
 */
export function t<K extends TranslationKey>(key: K, ...args: ParamsFor<K>): string {
  const template: string = ru[key];
  const params: Readonly<Record<string, string>> | undefined = args[0];
  if (params === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}
