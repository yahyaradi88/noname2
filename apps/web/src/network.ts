import { io, type Socket } from "socket.io-client";
import type {
  ClientEvents,
  ServerEvents,
} from "../../../packages/shared/types.js";
export const socket: Socket<ServerEvents, ClientEvents> = io({
  autoConnect: false,
  withCredentials: true,
  transports: ["websocket"],
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});
export async function connect() {
  const result = await fetch("/api/session", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!result.ok)
    throw new Error("Could not connect. Please try again shortly.");
  socket.connect();
}
