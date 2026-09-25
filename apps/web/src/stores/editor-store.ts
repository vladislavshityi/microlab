import { create } from "zustand";

/**
 * Минимальный каркас скетча: обязательные функции setup() и loop() без обращения
 * к какому-либо оборудованию.
 */
export const DEFAULT_SKETCH = "void setup() {\n}\n\nvoid loop() {\n}\n";

interface EditorState {
  /** Текст скетча. Пока хранится только в памяти вкладки браузера. */
  code: string;
  setCode: (code: string) => void;
}

export const useEditorStore = create<EditorState>()((set) => ({
  code: DEFAULT_SKETCH,
  setCode: (code) => {
    set({ code });
  },
}));
