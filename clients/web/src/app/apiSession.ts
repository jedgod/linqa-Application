export function getApiBaseUrl(): string {
  return import.meta.env.VITE_LINQA_API_URL ?? "http://127.0.0.1:8088";
}

export function getAccessToken(): string {
  return sessionStorage.getItem("linqa.access.token") ?? "";
}
