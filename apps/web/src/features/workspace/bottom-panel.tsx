import { PanelBottomClose, PanelBottomOpen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeEditorPanel } from "@/features/code-editor/code-editor-panel";
import { countIssues } from "@/features/problems/issue-format";
import { ProblemCountsBadge, ProblemsPanel } from "@/features/problems/problems-panel";
import { useCircuitValidation } from "@/features/problems/use-circuit-validation";
import { t, type PlainTranslationKey } from "@/i18n/t";
import { BOTTOM_TABS, useUiStore, type BottomTab } from "@/stores/ui-store";

import { IconButton } from "./icon-button";

const TAB_LABEL: Record<BottomTab, PlainTranslationKey> = {
  code: "bottom.tab.code",
  console: "bottom.tab.console",
  serial: "bottom.tab.serial",
  problems: "bottom.tab.problems",
};

/** Вкладки, функциональность которых ещё не реализована. */
const COMING_SOON: ReadonlySet<BottomTab> = new Set(["serial"]);

function isBottomTab(value: string): value is BottomTab {
  return BOTTOM_TABS.some((tab) => tab === value);
}

interface BottomPanelProps {
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
}

/** Нижняя панель: код, консоль, монитор порта, проблемы. */
export function BottomPanel({ collapsed, onCollapse, onExpand }: BottomPanelProps) {
  const tab = useUiStore((state) => state.bottomTab);
  const setBottomTab = useUiStore((state) => state.setBottomTab);
  // Проверка схемы идёт независимо от активной вкладки: счётчики видны на вкладке всегда.
  const validation = useCircuitValidation();
  const counts = countIssues(validation.data?.issues ?? []);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (isBottomTab(value)) {
          setBottomTab(value);
        }
      }}
      className="h-full min-h-0 gap-0"
    >
      <div className="flex h-8 shrink-0 items-center justify-between border-b pr-1">
        <TabsList variant="line" aria-label={t("bottom.tabs.label")} className="h-8 gap-0 p-0">
          {BOTTOM_TABS.map((value) => (
            <TabsTrigger
              key={value}
              value={value}
              onClick={collapsed ? onExpand : undefined}
              className="h-8 flex-none rounded-none px-3 text-xs text-muted-foreground after:bottom-0 data-[state=active]:text-foreground"
            >
              {t(TAB_LABEL[value])}
              {value === "problems" && <ProblemCountsBadge counts={counts} />}
              {COMING_SOON.has(value) && (
                <Badge variant="outline" className="px-1 py-0 text-[11px] font-normal text-muted-foreground">
                  {t("bottom.comingSoon")}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {collapsed ? (
          <IconButton label={t("workspace.panel.expandBottom")} onClick={onExpand}>
            <PanelBottomOpen aria-hidden="true" />
          </IconButton>
        ) : (
          <IconButton label={t("workspace.panel.collapseBottom")} onClick={onCollapse}>
            <PanelBottomClose aria-hidden="true" />
          </IconButton>
        )}
      </div>
      {/* Редактор не размонтируется при переключении вкладок: сохраняются история
          отмены, курсор и прокрутка. */}
      <TabsContent value="code" forceMount className="min-h-0 data-[state=inactive]:hidden">
        <CodeEditorPanel />
      </TabsContent>
      <TabsContent value="console" className="min-h-0 overflow-auto">
        <p className="px-3 py-2 font-mono text-[13px] text-muted-foreground">{t("console.empty")}</p>
      </TabsContent>
      <TabsContent value="serial" className="min-h-0 overflow-auto">
        <p className="px-3 py-2 text-[13px] text-muted-foreground">{t("serial.comingSoon")}</p>
      </TabsContent>
      <TabsContent value="problems" className="min-h-0 overflow-auto">
        <ProblemsPanel
          data={validation.data}
          error={validation.error}
          isFetching={validation.isFetching}
          onRetry={() => {
            void validation.refetch();
          }}
        />
      </TabsContent>
    </Tabs>
  );
}
