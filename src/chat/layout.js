/** Two splitters resize the three panels; sizes persist locally between app launches. */
export function setupLayout() {
  const root = document.documentElement;
  const form = document.getElementById("request-form");
  const workspace = document.querySelector(".workspace");
  const specs = [
    {
      id: "input-resizer",
      key: "direct-input-height",
      property: "--request-height",
      vertical: true,
      current: () => form.getBoundingClientRect().height,
      min: 150,
      max: () => Math.max(150, Math.min(500, window.innerHeight - 350)),
    },
    {
      id: "projects-resizer",
      key: "direct-projects-width",
      property: "--projects-width",
      vertical: false,
      current: () => document.querySelector(".projects-panel").getBoundingClientRect().width,
      min: 140,
      max: () => Math.max(140, Math.min(480, workspace.clientWidth - 360)),
    },
  ];
  for (const spec of specs) {
    const handle = document.getElementById(spec.id);
    handle.title =
      "Arraste para redimensionar. Duplo clique restaura o tamanho padrão. As setas também ajustam.";
    const apply = (value) => {
      const size = Math.round(Math.max(spec.min, Math.min(spec.max(), value)));
      root.style.setProperty(spec.property, `${size}px`);
      localStorage.setItem(spec.key, String(size));
      handle.setAttribute("aria-valuemin", String(spec.min));
      handle.setAttribute("aria-valuemax", String(Math.round(spec.max())));
      handle.setAttribute("aria-valuenow", String(size));
    };
    const saved = Number(localStorage.getItem(spec.key));
    if (saved) apply(saved);
    else {
      handle.setAttribute("aria-valuemin", String(spec.min));
      handle.setAttribute("aria-valuemax", String(Math.round(spec.max())));
      handle.setAttribute("aria-valuenow", String(Math.round(spec.current())));
    }
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const start = spec.vertical ? event.clientY : event.clientX;
      const initial = spec.current();
      handle.classList.add("dragging");
      const move = (e) => apply(initial + (spec.vertical ? e.clientY : e.clientX) - start);
      const finish = () => {
        handle.classList.remove("dragging");
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("lostpointercapture", finish);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("lostpointercapture", finish);
    });
    handle.addEventListener("keydown", (event) => {
      const decrease = spec.vertical ? "ArrowUp" : "ArrowLeft";
      const increase = spec.vertical ? "ArrowDown" : "ArrowRight";
      if (event.key === decrease || event.key === increase) {
        event.preventDefault();
        apply(spec.current() + (event.key === increase ? 10 : -10));
      }
    });
    handle.addEventListener("dblclick", () => {
      root.style.removeProperty(spec.property);
      localStorage.removeItem(spec.key);
    });
    window.addEventListener("resize", () => {
      const value = Number(localStorage.getItem(spec.key));
      if (value) apply(value);
    });
  }
}
