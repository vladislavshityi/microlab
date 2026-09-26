/**
 * WebSocket для тестов: подключения не открываются, сообщения сервера подаются вызовом
 * {@link FakeWebSocket.emit}. Подключается глобально в setup.ts.
 */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closedByClient = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  static latest(): FakeWebSocket | undefined {
    return FakeWebSocket.instances.at(-1);
  }

  close(): void {
    this.closedByClient = true;
  }

  /** Сообщение от сервера. */
  emit(message: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) }));
  }

  /** Закрытие со стороны сервера. */
  serverClose(code: number): void {
    this.onclose?.(new CloseEvent("close", { code }));
  }
}
