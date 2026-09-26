import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";

import { AppErrorBoundary } from "@/components/app-error-boundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppRoutes } from "@/features/auth/app-routes";
import { useGlobalShortcuts } from "@/hooks/use-global-shortcuts";
import { useThemeSync } from "@/hooks/use-theme-sync";

export function App({ queryClient }: { queryClient: QueryClient }) {
  useThemeSync();
  useGlobalShortcuts();

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={400}>
          <AppRoutes />
        </TooltipProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
