import { Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n/t";
import { useProjectStore } from "@/stores/project-store";

/** Чужой проект открыт только для просмотра: понятное предупреждение и возврат к группам. */
export function ReadOnlyBanner() {
  const readOnly = useProjectStore((state) => state.readOnly);
  if (readOnly === null) return null;
  return (
    <div role="status" className="flex shrink-0 items-center gap-3 border-b bg-info-muted px-3 py-1.5 text-xs">
      <Eye aria-hidden="true" className="size-4 shrink-0 text-info" />
      <span className="min-w-0 flex-1 font-medium">{t("readOnly.banner", { name: readOnly.ownerName })}</span>
      <Button type="button" size="xs" variant="outline" onClick={() => { window.location.assign("/groups"); }}>
        {t("readOnly.back")}
      </Button>
    </div>
  );
}
