const MAX_FILE = 8 * 1024 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;
export function setupAttachments(changed, notice) {
  const input = document.getElementById("request");
  const picker = document.getElementById("attachment-picker");
  const list = document.getElementById("attachment-list");
  const form = document.getElementById("request-form");
  let files = [],
    pending = 0;
  function render() {
    list.replaceChildren();
    list.hidden = !files.length;
    for (const file of files) {
      const chip = document.createElement("div");
      chip.className = "attachment-chip";
      if (
        ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.mimeType) &&
        file.data
      ) {
        const image = document.createElement("img");
        image.src = `data:${file.mimeType};base64,${file.data}`;
        image.alt = file.name;
        chip.append(image);
      }
      const info = document.createElement("span");
      info.textContent = `${file.name} · ${file.data === undefined ? "Lendo…" : `${Math.max(1, Math.ceil(file.size / 1024))} KB`}`;
      info.title = file.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remover anexo ${file.name}`);
      remove.addEventListener("click", () => {
        files = files.filter((f) => f.id !== file.id);
        render();
        changed();
      });
      chip.append(info, remove);
      list.append(chip);
    }
  }
  async function add(incoming) {
    for (const source of incoming) {
      if (files.length >= 8) {
        notice("Anexe no máximo 8 arquivos por pedido.");
        break;
      }
      if (source.size > MAX_FILE) {
        notice(`O arquivo ${source.name} excede 8 MB.`);
        continue;
      }
      if (files.reduce((sum, file) => sum + file.size, 0) + source.size > MAX_TOTAL) {
        notice("Os anexos podem somar no máximo 20 MB.");
        continue;
      }
      if (
        source.type.startsWith("image/") &&
        !["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].includes(
          source.type,
        )
      ) {
        notice("Use imagens PNG, JPEG, GIF ou WebP. SVG é anexado como arquivo.");
        continue;
      }
      const file = {
        id: crypto.randomUUID(),
        name: source.name || "imagem-colada.png",
        size: source.size,
        mimeType: source.type || "application/octet-stream",
        data: undefined,
      };
      files.push(file);
      pending++;
      render();
      changed();
      try {
        file.data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
          reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`));
          reader.readAsDataURL(source);
        });
      } catch (error) {
        files = files.filter((f) => f.id !== file.id);
        notice(error.message);
      } finally {
        pending--;
        render();
        changed();
      }
    }
  }
  document.getElementById("attach").addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => {
    void add([...picker.files]);
    picker.value = "";
  });
  input.addEventListener("paste", (event) => {
    const incoming = [...(event.clipboardData?.files || [])];
    if (incoming.length) {
      event.preventDefault();
      void add(incoming);
    }
  });
  form.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("Files")) {
      event.preventDefault();
      form.classList.add("drag-over");
    }
  });
  form.addEventListener("dragleave", (event) => {
    if (!form.contains(event.relatedTarget)) form.classList.remove("drag-over");
  });
  form.addEventListener("drop", (event) => {
    form.classList.remove("drag-over");
    if (event.dataTransfer?.files.length) {
      event.preventDefault();
      void add([...event.dataTransfer.files]);
    }
  });
  return {
    get pending() {
      return pending > 0;
    },
    snapshot: () => files.filter((file) => file.data !== undefined).map((file) => ({ ...file })),
    clear(sent) {
      const ids = new Set(sent.map((file) => file.id));
      files = files.filter((file) => !ids.has(file.id));
      render();
      changed();
    },
  };
}
