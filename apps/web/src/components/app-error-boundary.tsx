import { Component, type ErrorInfo, type ReactNode } from "react";
import { CircleX } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n/t";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Корневой error boundary: ошибка рендеринга никогда не оставляет белый экран.
 * Сама ошибка пользователю не показывается; она выводится в консоль для разработчиков.
 */
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Unhandled render error", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <main className="mx-auto w-full max-w-xl px-4 pt-12 pb-12">
        <Alert variant="error" role="alert">
          <CircleX aria-hidden="true" />
          <AlertTitle>{t("app.error.title")}</AlertTitle>
          <AlertDescription>
            <p>{t("app.error.description")}</p>
          </AlertDescription>
        </Alert>
        <Button
          type="button"
          className="mt-4"
          onClick={() => {
            window.location.reload();
          }}
        >
          {t("app.error.reload")}
        </Button>
      </main>
    );
  }
}
