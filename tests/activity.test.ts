import { expect, it } from "vitest";
import { visibleEvents } from "../src/chat/activity.js";
it("shows an SDK response only once while preserving different progress and repeated requests", () => {
  const events = [
    { kind: "user", text: "oi" },
    { kind: "assistant", text: "Olá" },
    { kind: "tool", text: "Read" },
    { kind: "result", text: "Olá" },
    { kind: "user", text: "oi de novo" },
    { kind: "assistant", text: "Verificando" },
    { kind: "result", text: "Olá" },
  ];
  expect(visibleEvents(events).map((e) => e.text)).toEqual([
    "oi",
    "Read",
    "Olá",
    "oi de novo",
    "Verificando",
    "Olá",
  ]);
});
