import { useEditorStore } from "@/stores/editor-store";

/** Замена редактора Monaco в тестах (jsdom не может его запустить). */
export default function CodeEditorMock() {
  const code = useEditorStore((state) => state.code);
  const setCode = useEditorStore((state) => state.setCode);
  return (
    <textarea
      aria-label="Редактор кода скетча"
      value={code}
      onChange={(event) => {
        setCode(event.target.value);
      }}
    />
  );
}
