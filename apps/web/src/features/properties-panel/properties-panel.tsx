import { t } from "@/i18n/t";

/** Свойства выбранного объекта. Выбирать пока нечего — пустое состояние. */
export function PropertiesPanel() {
  return <p className="px-3 py-3 text-[13px] text-muted-foreground">{t("properties.empty")}</p>;
}
