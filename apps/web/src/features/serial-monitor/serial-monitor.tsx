import { useLayoutEffect, useRef, useState } from "react";
import { ArrowDownToLine, Send, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { sendSerial } from "@/features/simulation/simulation-actions";
import { IconButton } from "@/features/workspace/icon-button";
import { t } from "@/i18n/t";
import { ACTIVE_PHASES, useSimulationStore } from "@/stores/simulation-store";

import { isLineEnding, LINE_ENDINGS, type LineEnding } from "./line-endings";

/** Расстояние до низа, при котором вывод считается «прокрученным до конца», px. */
const STICK_THRESHOLD_PX = 8;

/**
 * Монитор порта (UART0, Serial): вывод скетча дописывается в конец и прокручивается
 * автоматически, пока пользователь не прокрутил вверх; ввод отправляется на RX с выбранным
 * окончанием строки.
 */
export function SerialMonitor() {
  const text = useSimulationStore((state) => state.serialText);
  const active = useSimulationStore((state) => ACTIVE_PHASES.has(state.phase));
  const clear = useSimulationStore((state) => state.clearSerial);
  const outputRef = useRef<HTMLPreElement>(null);
  const [stick, setStick] = useState(true);
  const [input, setInput] = useState("");
  const [ending, setEnding] = useState<LineEnding>("lf");
  const [sending, setSending] = useState(false);

  useLayoutEffect(() => {
    const output = outputRef.current;
    if (output !== null && stick) output.scrollTop = output.scrollHeight;
  }, [text, stick]);

  const onScroll = () => {
    const output = outputRef.current;
    if (output === null) return;
    setStick(output.scrollHeight - output.scrollTop - output.clientHeight <= STICK_THRESHOLD_PX);
  };

  const onSubmit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const data = input + LINE_ENDINGS[ending].suffix;
    if (data === "" || sending) return;
    setSending(true);
    void sendSerial(data).then((sent) => {
      setSending(false);
      if (sent) setInput("");
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b px-3 text-xs text-muted-foreground">
        <span>{t("serial.port")}</span>
        <div className="flex items-center gap-1">
          {!stick && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                setStick(true);
              }}
            >
              <ArrowDownToLine aria-hidden="true" />
              {t("serial.scrollToEnd")}
            </Button>
          )}
          <IconButton
            label={t("serial.clear")}
            disabled={text === ""}
            onClick={() => {
              clear();
              setStick(true);
            }}
          >
            <Trash2 aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      <pre
        ref={outputRef}
        onScroll={onScroll}
        tabIndex={0}
        aria-label={t("serial.output")}
        aria-live="off"
        data-testid="serial-output"
        className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[13px] whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {text === "" ? <span className="text-muted-foreground">{t("serial.empty")}</span> : text}
      </pre>
      <form onSubmit={onSubmit} className="flex shrink-0 items-center gap-2 border-t px-2 py-1.5">
        <input
          type="text"
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
          }}
          disabled={!active}
          placeholder={active ? t("serial.input.placeholder") : t("serial.input.inactive")}
          aria-label={t("serial.input.label")}
          className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
        />
        <select
          value={ending}
          onChange={(event) => {
            if (isLineEnding(event.target.value)) setEnding(event.target.value);
          }}
          aria-label={t("serial.lineEnding.label")}
          className="h-7 rounded-md border bg-background px-1 text-xs"
        >
          {(Object.keys(LINE_ENDINGS) as LineEnding[]).map((value) => (
            <option key={value} value={value}>
              {t(LINE_ENDINGS[value].label)}
            </option>
          ))}
        </select>
        <Button type="submit" size="xs" variant="outline" disabled={!active || sending || (input === "" && ending === "none")}>
          <Send aria-hidden="true" />
          {t("serial.send")}
        </Button>
      </form>
    </div>
  );
}
