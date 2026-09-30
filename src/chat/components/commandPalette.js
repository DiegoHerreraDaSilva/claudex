import { clear, el } from "../lib/dom.js";

let container;
let input;
let listEl;
let commands = [];
let filtered = [];
let active = 0;

export function initPalette() {
  container = document.getElementById("palette");
  input = document.getElementById("palette-input");
  listEl = document.getElementById("palette-list");
  input.addEventListener("input", () => {
    active = 0;
    applyFilter();
  });
  input.addEventListener("keydown", onKey);
  container.addEventListener("mousedown", (event) => {
    if (event.target === container) closePalette();
  });
}

export function openPalette(commandList) {
  if (!container) return;
  commands = commandList.filter(Boolean);
  active = 0;
  input.value = "";
  applyFilter();
  container.classList.remove("hidden");
  input.focus();
}

export function closePalette() {
  container?.classList.add("hidden");
}

export function paletteOpen() {
  return Boolean(container && !container.classList.contains("hidden"));
}

function applyFilter() {
  const query = input.value.trim().toLowerCase();
  filtered = query
    ? commands.filter((command) => command.label.toLowerCase().includes(query))
    : commands;
  if (active >= filtered.length) active = Math.max(0, filtered.length - 1);
  render();
}

function render() {
  clear(listEl);
  if (filtered.length === 0) {
    listEl.appendChild(el("div", { class: "palette-empty", text: "—" }));
    return;
  }
  filtered.forEach((command, index) => {
    const row = el("div", {
      class: `palette-row${index === active ? " active" : ""}`,
      onclick: () => run(index),
      onmouseenter: () => {
        active = index;
        render();
      },
    });
    row.append(
      el("span", { class: "palette-label", text: command.label }),
      command.hint ? el("span", { class: "palette-hint", text: command.hint }) : el("span"),
    );
    listEl.appendChild(row);
  });
}

function run(index) {
  const command = filtered[index];
  if (!command) return;
  closePalette();
  command.run();
}

function onKey(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closePalette();
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    active = Math.min(active + 1, filtered.length - 1);
    render();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    active = Math.max(active - 1, 0);
    render();
  } else if (event.key === "Enter") {
    event.preventDefault();
    run(active);
  }
}
