export async function getProjects() {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error(`projects ${res.status}`);
  return res.json();
}

export async function getProject(projectId) {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
  if (!res.ok) return null;
  return res.json();
}

export async function createProject(name, rootPath) {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, rootPath }),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export async function validatePath(rootPath) {
  const res = await fetch("/api/validate-path", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rootPath }),
  });
  return res.json();
}

export async function listDirectory(target) {
  const res = await fetch(`/api/fs/list?path=${encodeURIComponent(target ?? "")}`);
  return res.json();
}

export async function getCredentials() {
  const res = await fetch("/api/credentials");
  return res.json();
}

export async function getUsage() {
  const res = await fetch("/api/usage");
  return res.json();
}

export async function getMissionEvents(missionId) {
  const res = await fetch(`/api/missions/${encodeURIComponent(missionId)}/events`);
  if (!res.ok) return [];
  return res.json();
}

export async function previewMission(text) {
  const res = await fetch("/api/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function getMissionSummary(missionId) {
  const res = await fetch(`/api/missions/${encodeURIComponent(missionId)}/summary`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`mission summary ${res.status}`);
  return res.json();
}
export async function request(url, method = "GET", body) {
  const response = await fetch(url, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `${response.status}`);
  return data;
}
