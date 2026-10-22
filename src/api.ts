export async function api(path: string, options: RequestInit = {}) {
  const response = await fetch("/api" + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401 || body.code === "ACCOUNT_CHANGED")
      window.dispatchEvent(new Event("beadgrid-session-invalid"));
    throw Error(body.error || "请求失败");
  }
  return body;
}
