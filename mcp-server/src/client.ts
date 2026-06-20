import { config } from "./config.js";
import { getAccessToken } from "./auth.js";

export type ApiResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string };

/** Authenticated request against the platform REST API. */
export async function apiRequest(method: string, path: string, body?: unknown): Promise<ApiResult> {
  let token: string;
  try {
    token = await getAccessToken();
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  }

  const url = `${config.baseUrl}${path}`;
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    let data: unknown = text ? text : null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        // non-JSON body — keep raw text
      }
    }

    if (!res.ok) {
      const b = typeof data === "string" ? data : data == null ? "" : JSON.stringify(data);
      return { ok: false, status: res.status, error: b || res.statusText || "request failed" };
    }
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: `Request to ${url} failed: ${(e as Error).message}` };
  }
}

export const apiGet = (path: string) => apiRequest("GET", path);
