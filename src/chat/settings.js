import { api } from "./api.js";
const $ = (id) => document.getElementById(id);
// Keep settings usable when the currently running backend predates the effort catalog.
const defaultEffortLevels = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"],
};
let effortLevels = defaultEffortLevels;
const effortLabels = {
  minimal: "Mínimo",
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  xhigh: "Muito alto",
  max: "Máximo",
  ultra: "Ultra",
  persistent: "Persistente",
};
function updateEffort(role, value = $(`${role}-effort`).value) {
  const select = $(`${role}-effort`);
  const levels = effortLevels[$(`${role}-provider`).value] ?? [];
  select.replaceChildren(new Option("Padrão do modelo", ""));
  for (const level of levels) select.add(new Option(`${effortLabels[level]} (${level})`, level));
  select.value = levels.includes(value) ? value : "";
}
async function accounts() {
  const data = await api("/api/credentials");
  effortLevels = Object.fromEntries(
    Object.entries(defaultEffortLevels).map(([provider, fallback]) => {
      const reported = data.effortLevels?.[provider];
      return [
        provider,
        Array.isArray(reported) &&
        reported.length &&
        reported.every((level) => typeof level === "string")
          ? reported
          : fallback,
      ];
    }),
  );
  $("accounts").replaceChildren();
  for (const provider of ["claude", "codex"]) {
    const status = data[provider],
      row = document.createElement("div");
    row.className = "account-row";
    const heading = document.createElement("div");
    heading.className = "account-heading";
    const title = document.createElement("strong");
    title.textContent = provider === "claude" ? "Claude" : "Codex";
    heading.append(title);
    const buttons = document.createElement("div");
    buttons.className = "account-buttons";
    for (const [action, label] of [
      ["login", "Conectar"],
      ["logout", "Desconectar"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", async () => {
        button.disabled = true;
        $("account-output").textContent = "Aguarde. Conclua o login no navegador se ele abrir.";
        try {
          const result = await api("/api/accounts", "POST", { provider, action });
          $("account-output").textContent = result.message;
          await accounts();
        } catch (error) {
          $("account-output").textContent = error.message;
        } finally {
          button.disabled = false;
        }
      });
      buttons.append(button);
    }
    heading.append(buttons);
    row.append(heading);
    const info = document.createElement("p");
    info.className = "muted";
    info.textContent =
      status.mode === "none"
        ? "Não conectado"
        : `${status.mode === "apiKey" ? "Chave de API" : "Assinatura"}${status.account ? ` · ${status.account}` : ""}`;
    row.append(info);
    if (status.mode === "apiKey") {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.textContent = "Remover chave de API";
      clear.addEventListener("click", async () => {
        try {
          await api("/api/settings", "POST", {
            values: { [provider === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"]: "" },
          });
          await accounts();
        } catch (error) {
          $("settings-status").textContent = error.message;
        }
      });
      row.append(clear);
    }
    $("accounts").append(row);
  }
  for (const [role, key, fallback] of [
    ["simple", "simpleModel", "claude"],
    ["complex", "complexModel", "codex"],
    ["planner", "plannerModel", "claude"],
  ]) {
    const configured =
      data[key] || (role === "complex" ? "gpt-6-sol" : role === "planner" ? "opus" : "sonnet");
    const separator = configured.indexOf(":");
    $(`${role}-provider`).value = separator < 0 ? fallback : configured.slice(0, separator);
    $(`${role}-model`).value = separator < 0 ? configured : configured.slice(separator + 1);
    updateEffort(role, data[`${role}Effort`] || "");
  }
  $("jev-key").placeholder = data.typesafe?.configured
    ? "Chave configurada · Cole outra para substituir"
    : "Cole a chave de console.typesafe.ai";
}
export function setupSettings() {
  for (const role of ["simple", "complex", "planner"])
    $(`${role}-provider`).addEventListener("change", () => updateEffort(role));
  $("settings-open").addEventListener("click", () => {
    $("settings-dialog").showModal();
    void accounts().catch((error) => {
      $("settings-status").textContent = error.message;
    });
  });
  $("settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = {};
    for (const input of $("settings-form").querySelectorAll("input[name]"))
      if (input.value.trim()) values[input.name] = input.value.trim();
    for (const role of ["simple", "complex", "planner"]) {
      const input = $(`${role}-model`);
      values[input.name] = `${$(`${role}-provider`).value}:${input.value.trim()}`;
      const effort = $(`${role}-effort`);
      values[effort.name] = effort.value;
    }
    try {
      await api("/api/settings", "POST", { values });
      $("settings-form").reset();
      $("settings-status").textContent = "Ajustes salvos. Serão usados nos próximos pedidos.";
      await accounts();
    } catch (error) {
      $("settings-status").textContent = error.message;
    }
  });
}
