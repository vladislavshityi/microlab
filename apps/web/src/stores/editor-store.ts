import { create } from "zustand";

/**
 * Минимальный каркас скетча: обязательные функции setup() и loop() без обращения
 * к какому-либо оборудованию.
 */
export const DEFAULT_SKETCH = "void setup() {\n}\n\nvoid loop() {\n}\n";

interface EditorState {
  /** Текст скетча открытого проекта. */
  code: string;
  /**
   * Номер загруженного документа: растёт при каждой замене текста извне (открытие
   * проекта). Редактор кода по нему заменяет содержимое и сбрасывает свою историю правок.
   */
  documentVersion: number;
  setCode: (code: string) => void;
  loadCode: (code: string) => void;
}

export const useEditorStore = create<EditorState>()((set) => ({
  code: DEFAULT_SKETCH,
  documentVersion: 0,
  setCode: (code) => {
    set({ code });
  },
  loadCode: (code) => {
    set((state) => ({ code, documentVersion: state.documentVersion + 1 }));
  },
}));
