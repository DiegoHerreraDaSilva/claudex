import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveAttachments, attachmentContext } from "../src/application/attachments.js";
it("stores attachments under app data with generated paths and detects real image content", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claudex-attachments-"));
  try {
    const files = await saveAttachments(dir, "project", [
      { name: "../../evil.txt", data: Buffer.from("reference").toString("base64") },
      {
        name: "photo.txt",
        mimeType: "text/plain",
        data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64"),
      },
    ]);
    expect(files[0].path.startsWith(path.join(dir, "attachments", "project") + path.sep)).toBe(
      true,
    );
    expect(path.basename(files[0].path)).not.toContain("evil");
    expect(await readFile(files[0].path, "utf8")).toBe("reference");
    expect(files[1].mimeType).toBe("image/png");
    expect(files[1].path.endsWith(".png")).toBe(true);
    expect(attachmentContext(files)).toContain("somente leitura");
    await expect(
      saveAttachments(dir, "project", [
        {
          name: "fake.png",
          mimeType: "image/png",
          data: Buffer.from("not an image").toString("base64"),
        },
      ]),
    ).rejects.toThrow("Imagem inválida");
    await expect(saveAttachments(dir, "project", [{ name: "bad", data: "%%%" }])).rejects.toThrow(
      "dados inválidos",
    );
    await expect(
      saveAttachments(dir, "project", Array(9).fill({ name: "x", data: "" })),
    ).rejects.toThrow("8 arquivos");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
