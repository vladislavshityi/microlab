import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppErrorBoundary } from "./app-error-boundary";

function Boom(): never {
  throw new Error("render failure with internal details");
}

describe("AppErrorBoundary", () => {
  it("shows a fallback instead of a white screen and hides the error text", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось отобразить страницу");
    expect(screen.getByRole("button", { name: "Перезагрузить страницу" })).toBeInTheDocument();
    expect(screen.queryByText(/internal details/)).not.toBeInTheDocument();
  });
});
