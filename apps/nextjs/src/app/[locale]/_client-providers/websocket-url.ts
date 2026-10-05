interface WebsocketUrlOptions {
  location?: Pick<Location, "protocol" | "hostname" | "port">;
  development: boolean;
  localSourceMode: boolean;
}

export const getWebsocketUrl = ({ location, development, localSourceMode }: WebsocketUrlOptions) => {
  const protocol = location?.protocol === "https:" ? "wss" : "ws";
  if (!location) return `${protocol}://localhost:3001/websockets`;

  // Direct source startup binds both services to loopback. Retain the current
  // hostname so session cookies also authenticate the WebSocket connection.
  if (localSourceMode && (location.hostname === "127.0.0.1" || location.hostname === "localhost")) {
    return `${protocol}://${location.hostname}:3001/websockets`;
  }
  if (development) return `${protocol}://localhost:3001/websockets`;

  // Upstream container/remote hosting expects its same-origin reverse proxy.
  const port = location.port ? `:${location.port}` : "";
  return `${protocol}://${location.hostname}${port}/websockets`;
};
