import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { useThemeSync } from "@/hooks/use-theme-sync";
import { THEME_STORAGE_KEY } from "@/lib/theme";

import { ThemeMenu } from "./theme-menu";

function Harness() {
  useThemeSync();
  return <ThemeMenu />;
}

function renderMenu() {
  return render(
    <TooltipProvider>
      <Harness />
    </TooltipProvider>,
  );
}

async function choose(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /^Тема оформления/ }));
  await user.click(await screen.findByRole("menuitemradio", { name }));
}

/** Подменяет системную настройку темы; возвращает функцию её изменения. */
function mockSystemScheme(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query.includes("dark") && dark;
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  return (nextDark: boolean) => {
    dark = nextDark;
    listeners.forEach((listener) => {
      listener();
    });
  };
}

describe("ThemeMenu", () => {
  it("switches the .dark class on <html> and persists the choice", async () => {
    mockSystemScheme(false);
    renderMenu();
    expect(screen.getByRole("button", { name: "Тема оформления: Системная" })).toBeInTheDocument();

    await choose("Тёмная");
    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByRole("button", { name: "Тема оформления: Тёмная" })).toBeInTheDocument();

    await choose("Светлая");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("follows the system setting in system mode", async () => {
    const setSystemDark = mockSystemScheme(true);
    renderMenu();
    await choose("Системная");
    expect(document.documentElement).toHaveClass("dark");

    setSystemDark(false);
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("keeps working when localStorage is unavailable", async () => {
    mockSystemScheme(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    renderMenu();
    await choose("Тёмная");
    expect(document.documentElement).toHaveClass("dark");
  });
});
