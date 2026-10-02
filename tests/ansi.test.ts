import { expect, it } from "vitest";
import { ansiSegments } from "../src/chat/ansi.js";

it("turns terminal escape codes into safe styled text and removes cursor and OSC controls", () => {
  const segments = ansiSegments(
    "\x1b[32m\x1b[1mVITE\x1b[22m\x1b[39m ready\x1b[2K\x1b]0;title\x07\n<script>literal</script>",
  );
  expect(segments.map((s) => s.text).join("")).toBe("VITE ready\n<script>literal</script>");
  expect(segments[0]).toMatchObject({ text: "VITE", classes: ["ansi-green", "ansi-bold"] });
  expect(segments.at(-1)?.classes).toEqual([]);
});

it("resets styles and handles progress carriage returns", () => {
  expect(ansiSegments("\x1b[36mURL\x1b[0m normal").map((s) => s.classes)).toEqual([
    ["ansi-cyan"],
    [],
  ]);
  expect(
    ansiSegments("old\rnew\n")
      .map((s) => s.text)
      .join(""),
  ).toBe("new\n");
});
