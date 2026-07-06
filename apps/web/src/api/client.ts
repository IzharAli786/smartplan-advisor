/** Thin fetch wrapper. Same-origin in dev via the Vite proxy, so the httpOnly session
 * cookie is sent automatically with credentials: "include". */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function handle(res: Response): Promise<unknown> {
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const message = isJson && body && typeof body === "object" ? (body as { error?: string }).error : String(body);
    const code = isJson && body && typeof body === "object" ? (body as { code?: string }).code : undefined;
    throw new ApiError(res.status, message ?? `Request failed (${res.status})`, code);
  }
  return body;
}

/** Build fetch init, only sending a JSON content-type when there's actually a body.
 * (Sending application/json with an empty body makes Fastify's JSON parser 500.) */
function jsonInit(method: string, body?: unknown): RequestInit {
  if (body === undefined) return { method, credentials: "include" };
  return {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const api = {
  get: <T>(path: string) => fetch(path, { credentials: "include" }).then(handle) as Promise<T>,
  post: <T>(path: string, body?: unknown) => fetch(path, jsonInit("POST", body)).then(handle) as Promise<T>,
  put: <T>(path: string, body?: unknown) => fetch(path, jsonInit("PUT", body)).then(handle) as Promise<T>,
  patch: <T>(path: string, body?: unknown) => fetch(path, jsonInit("PATCH", body)).then(handle) as Promise<T>,
  upload: <T>(path: string, form: FormData) =>
    fetch(path, { method: "POST", credentials: "include", body: form }).then(handle) as Promise<T>,
  delete: <T>(path: string) =>
    fetch(path, { method: "DELETE", credentials: "include" }).then(handle) as Promise<T>,
};
