let socket = null;
let handler = () => {};
const outbox = [];

export function initSocket(onMessage) {
  handler = onMessage;
  connect();
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}`);
  socket.onopen = () => {
    while (outbox.length > 0) {
      const next = outbox.shift();
      socket.send(next);
    }
  };
  socket.onmessage = (event) => {
    try {
      handler(JSON.parse(event.data));
    } catch {
      /* ignore malformed frames */
    }
  };
  socket.onclose = () => setTimeout(connect, 1500);
  socket.onerror = () => {
    /* the close handler reconnects */
  };
}

export function send(payload) {
  const encoded = JSON.stringify(payload);
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(encoded);
  else outbox.push(encoded);
}

export function isConnected() {
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}
