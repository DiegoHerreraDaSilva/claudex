const colors = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];

/** Interpret common SGR styles; discard terminal control sequences, never HTML. */
export function ansiSegments(value) {
  const text = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.split("\r").at(-1))
    .join("\n");
  // eslint-disable-next-line no-control-regex
  const controls = /\x1b\][\s\S]*?(?:\x07|\x1b\\)|(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|\x1b[@-_]/g;
  const segments = [];
  let foreground = "",
    bold = false,
    dim = false,
    underline = false,
    offset = 0;
  const append = (part) => {
    if (!part) return;
    segments.push({
      text: part,
      classes: [
        foreground,
        bold && "ansi-bold",
        dim && "ansi-dim",
        underline && "ansi-underline",
      ].filter(Boolean),
    });
  };
  for (const match of text.matchAll(controls)) {
    append(text.slice(offset, match.index));
    const sequence = match[0];
    if (sequence.endsWith("m") && (sequence.startsWith("\x1b[") || sequence.startsWith("\x9b"))) {
      const codes = sequence
        .slice(sequence.startsWith("\x1b[") ? 2 : 1, -1)
        .split(";")
        .map(Number);
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        if (code === 0) {
          foreground = "";
          bold = false;
          dim = false;
          underline = false;
        }
        if (code === 1) bold = true;
        if (code === 2) dim = true;
        if (code === 4) underline = true;
        if (code === 22) {
          bold = false;
          dim = false;
        }
        if (code === 24) underline = false;
        if (code === 39) foreground = "";
        if (code >= 30 && code <= 37) foreground = `ansi-${colors[code - 30]}`;
        if (code >= 90 && code <= 97) foreground = `ansi-${colors[code - 90]}`;
        // Extended colors are ignored as a unit so their parameters cannot become SGR commands.
        if (code === 38 || code === 48) i += codes[i + 1] === 2 ? 4 : codes[i + 1] === 5 ? 2 : 0;
      }
    }
    offset = match.index + sequence.length;
  }
  append(text.slice(offset));
  return segments;
}

export function renderAnsi(container, text) {
  const nodes = ansiSegments(text).map((part) => {
    const span = document.createElement("span");
    span.textContent = part.text;
    span.className = part.classes.join(" ");
    return span;
  });
  container.replaceChildren(...nodes);
}
