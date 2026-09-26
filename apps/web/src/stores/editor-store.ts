import { create } from "zustand";

/**
 * Минимальный каркас скетча: обязательные функции setup() и loop() без обращения
 * к какому-либо оборудованию.
 */
const DEFAULT_SKETCH = "void setup() {\n}\n\nvoid loop() {\n}\n";

interface EditorState {
  /** Текст скетча открытого проекта. */
  code: string;
  /**
   * Номер загруженного документа: растёт при каждой замене текста извне (открытие
   * проекта). Редактор кода по нему заменяет содержимое и сбрасывает свою историю правок.
   */
  documentVersion: number;
  /** Запрос перейти к позиции в редакторе (щелчок по диагностике); seq — номер запроса. */
  reveal: { line: number; column: number; seq: number } | null;
  /** Код только для просмотра (редактор без правок). */
  readOnly: boolean;
  setCode: (code: string) => void;
  loadCode: (code: string) => void;
  revealPosition: (line: number, column: number) => void;
}

export const useEditorStore = create<EditorState>()((set) => ({
  code: DEFAULT_SKETCH,
  documentVersion: 0,
  reveal: null,
  readOnly: false,
  setCode: (code) => {
    set((state) => (state.readOnly ? state : { code }));
  },
  loadCode: (code) => {
    set((state) => ({ code, documentVersion: state.documentVersion + 1 }));
  },
  revealPosition: (line, column) => {
    set((state) => ({ reveal: { line, column, seq: (state.reveal?.seq ?? 0) + 1 } }));
  },
}));
