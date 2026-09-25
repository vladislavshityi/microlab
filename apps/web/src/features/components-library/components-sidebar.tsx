import { t } from "@/i18n/t";

/**
 * Библиотека компонентов. Определений компонентов ещё нет, поэтому показывается
 * честное пустое состояние без поиска и категорий.
 */
export function ComponentsSidebar() {
  return <p className="px-3 py-3 text-[13px] text-muted-foreground">{t("components.empty")}</p>;
}
