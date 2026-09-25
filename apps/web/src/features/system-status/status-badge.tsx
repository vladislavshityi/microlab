import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { t } from "@/i18n/t";

import type { StatusCell, StatusTone } from "./health-view";
import { TONE_ICON } from "./status-icons";

const TONE_CLASS: Record<StatusTone, string> = {
  success: "border-success/40 bg-success-muted text-success",
  error: "border-error/40 bg-error-muted text-error",
  warning: "border-warning/40 bg-warning-muted text-warning",
  unknown: "border-border bg-muted text-muted-foreground",
};

/** Статус никогда не передаётся только цветом: иконка + текст (доступность). */
export function StatusBadge({ cell }: { cell: StatusCell }) {
  const Icon = TONE_ICON[cell.tone];
  return (
    <Badge variant="outline" data-tone={cell.tone} className={cn(TONE_CLASS[cell.tone])}>
      <Icon aria-hidden="true" />
      {t(cell.label)}
    </Badge>
  );
}
