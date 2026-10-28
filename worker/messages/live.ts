interface DurableObjectState {
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): WebSocket[];
}

interface MessageSignal {
  type: "message";
  from: string;
}

declare const WebSocketPair: new () => {
  0: WebSocket;
  1: WebSocket;
};

export class DirectMessageHub {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/publish" && request.method === "POST") {
      const signal = (await request.json()) as MessageSignal;
      if (signal.type !== "message" || typeof signal.from !== "string") {
        return new Response("Invalid message signal", { status: 400 });
      }
      const payload = JSON.stringify(signal);
      for (const socket of this.state.getWebSockets()) {
        try {
          socket.send(payload);
        } catch {
          socket.close(1011, "Push failed");
        }
      }
      return new Response(null, { status: 204 });
    }

    if (
      url.pathname !== "/connect" ||
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
    ) {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    return new Response(null, {
      status: 101,
      webSocket: pair[0],
    } as ResponseInit);
  }
}
