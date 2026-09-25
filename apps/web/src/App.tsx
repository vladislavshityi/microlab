import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";

import { AppErrorBoundary } from "@/components/app-error-boundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Workspace } from "@/features/workspace/workspace";
import { useGlobalShortcuts } from "@/hooks/use-global-shortcuts";
import { useThemeSync } from "@/hooks/use-theme-sync";

export function App({ queryClient }: { queryClient: QueryClient }) {
  useThemeSync();
  useGlobalShortcuts();

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={400}>
          <Workspace />
        </TooltipProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
