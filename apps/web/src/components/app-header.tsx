import { t } from "@/i18n/t";

export function AppHeader() {
  return (
    <header className="flex h-12 items-center border-b px-4">
      <span className="text-sm font-semibold">{t("app.name")}</span>
    </header>
  );
}
