import { describe, expect, it } from "vitest";

import { RU_LOCALE, ru } from "./ru";
import { locale, t } from "./t";

describe("t", () => {
  it("returns the Russian text for a key", () => {
    expect(t("health.page.title")).toBe("Состояние системы");
  });

  it("substitutes placeholders", () => {
    expect(t("health.meta.errorCode", { code: "DATABASE_UNAVAILABLE" })).toBe(
      "Код: DATABASE_UNAVAILABLE",
    );
    expect(t("app.documentTitle", { page: "Состояние системы" })).toBe(
      "Состояние системы — MicroLab",
    );
  });

  it("rejects unknown keys and missing params at compile time", () => {
    // @ts-expect-error — неизвестный ключ
    t("health.unknown.key");
    // @ts-expect-error — не передан обязательный параметр {code}
    t("health.meta.errorCode");
    // @ts-expect-error — ключ без плейсхолдеров не принимает параметров
    t("health.page.title", { extra: "x" });
    expect(true).toBe(true);
  });

  it("exposes the Intl locale of the UI language", () => {
    expect(locale).toBe(RU_LOCALE);
    expect(new Intl.DateTimeFormat(locale).resolvedOptions().locale).toBe("ru-RU");
  });

  it("contains the required health texts verbatim", () => {
    expect(ru["health.summary.databaseDown.title"]).toBe("БД недоступна");
    expect(ru["health.summary.backendUnreachable.title"]).toBe("Backend недоступен");
  });
});
