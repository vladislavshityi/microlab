import { useEffect } from "react";
import { Info, X } from "lucide-react";

import { SystemStatusIndicator } from "@/features/system-status/system-status-indicator";
import { t } from "@/i18n/t";
import { useUiStore } from "@/stores/ui-store";

import { IconButton } from "./icon-button";

/** Время показа уведомления в строке состояния. */
const NOTICE_TIMEOUT_MS = 4000;

function NoticeArea() {
  const notice = useUiStore((state) => state.notice);
  const dismissNotice = useUiStore((state) => state.dismissNotice);

  useEffect(() => {
    if (notice === null) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      dismissNotice(notice.id);
    }, NOTICE_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice, dismissNotice]);

  return (
    <div role="status" aria-live="polite" className="flex min-w-0 items-center gap-1">
      {notice !== null && (
        <>
          <Info aria-hidden="true" className="size-3.5 shrink-0 text-info" />
          <span className="truncate text-xs">{t(notice.message)}</span>
          <IconButton
            label={t("notice.dismiss")}
            onClick={() => {
              dismissNotice(notice.id);
            }}
          >
            <X aria-hidden="true" />
          </IconButton>
        </>
      )}
    </div>
  );
}

/** Строка состояния: доступность backend и короткие уведомления. */
export function StatusBar() {
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-4 border-t px-1">
      <SystemStatusIndicator />
      <NoticeArea />
    </footer>
  );
}
