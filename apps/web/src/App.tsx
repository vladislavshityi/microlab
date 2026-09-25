import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";

import { AppErrorBoundary } from "@/components/app-error-boundary";
import { AppHeader } from "@/components/app-header";
import { SystemStatusPage } from "@/features/system-status/system-status-page";

export function App({ queryClient }: { queryClient: QueryClient }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <AppHeader />
      <AppErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <SystemStatusPage />
        </QueryClientProvider>
      </AppErrorBoundary>
    </div>
  );
}
