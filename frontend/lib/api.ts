/**
 * Typed API client. Every backend call goes through this module.
 *
 * Auth model: the backend issues a short-lived access token (15 min) and a
 * longer-lived refresh token (7 days). We attach the access token to each
 * request; on a 401 we transparently call /auth/refresh/ once and retry. If the
 * refresh also fails, tokens are cleared and a `docuchat:logout` event is fired
 * so the UI can send the user to /login.
 *
 * Tokens live in localStorage: simple and fine for a portfolio app. The more
 * hardened alternative is httpOnly cookies, which keeps tokens away from JS.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

const ACCESS_KEY = "docuchat.access";
const REFRESH_KEY = "docuchat.refresh";
export const LOGOUT_EVENT = "docuchat:logout";

// ---------- Types (mirror the DRF serializers) ----------

export interface User {
  id: number;
  email: string;
  full_name: string;
  date_joined: string;
}

export type WorkspaceRole = "owner" | "member";

export interface Workspace {
  id: number;
  name: string;
  owner: number;
  role: WorkspaceRole | null;
  created_at: string;
}

export type DocumentStatus = "uploaded" | "processing" | "ready" | "failed";
export type DocumentFileType = "pdf" | "docx" | "txt" | "xlsx" | "csv";

export interface DocumentItem {
  id: number;
  workspace: number;
  title: string;
  file_type: DocumentFileType;
  file_size: number;
  status: DocumentStatus;
  error_message: string;
  page_count: number | null;
  uploaded_by: number | null;
  uploaded_by_email: string | null;
  created_at: string;
}

export interface Citation {
  index: number;
  document_id: number;
  chunk_id: number;
  title: string;
  /** Missing on citations saved before spreadsheets were supported (all were pages). */
  file_type?: DocumentFileType;
  /** Page number, or sheet number for .xlsx. */
  page: number;
}

/** The passage behind a citation (GET /chunks/{id}/). */
export interface SourceChunk {
  id: number;
  document_id: number;
  document_title: string;
  page_number: number;
  chunk_index: number;
  content: string;
}

export interface Conversation {
  id: number;
  workspace: number;
  title: string;
  /** Documents this chat searches; empty = every ready document in the workspace. */
  document_ids: number[];
  created_at: string;
  updated_at: string;
}

export type MessageRole = "user" | "assistant";

export interface Message {
  id: number;
  role: MessageRole;
  content: string;
  citations: Citation[];
  tokens_used: number;
  created_at: string;
}

/** Callbacks for the /ask/ event stream, in the order the server sends them. */
export interface AskHandlers {
  onSources?: (sources: Citation[]) => void;
  onToken?: (text: string) => void;
  onDone?: (message: Message) => void;
  onError?: (detail: string) => void;
}

interface TokenPair {
  access: string;
  refresh: string;
}

/** DRF error bodies are either {detail: "..."} or {field: ["msg", ...]}. */
export type ApiErrorBody = Record<string, unknown>;

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody | null,
  ) {
    super(formatErrorBody(body) ?? `Request failed (${status})`);
    this.name = "ApiError";
  }

  /** Error messages for one field, e.g. `fieldErrors("email")`. */
  fieldErrors(field: string): string[] {
    const value = this.body?.[field];
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === "string") return [value];
    return [];
  }
}

function formatErrorBody(body: ApiErrorBody | null): string | null {
  if (!body) return null;
  if (typeof body.detail === "string") return body.detail;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    const messages = Array.isArray(value) ? value.map(String) : [String(value)];
    const label = key === "non_field_errors" ? "" : `${key}: `;
    parts.push(`${label}${messages.join(" ")}`);
  }
  return parts.length ? parts.join("\n") : null;
}

// ---------- Token storage ----------

export const tokens = {
  get access(): string | null {
    return typeof window === "undefined" ? null : localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    return typeof window === "undefined" ? null : localStorage.getItem(REFRESH_KEY);
  },
  set(pair: Partial<TokenPair>): void {
    if (pair.access) localStorage.setItem(ACCESS_KEY, pair.access);
    if (pair.refresh) localStorage.setItem(REFRESH_KEY, pair.refresh);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

// ---------- Refresh handling ----------

// If several requests 401 at once, they all await the same refresh call
// instead of each firing their own (which would race and waste requests).
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refresh = tokens.refresh;
  if (!refresh) return false;
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
      });
      if (!res.ok) return false;
      tokens.set((await res.json()) as Partial<TokenPair>);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function forceLogout(): void {
  tokens.clear();
  window.dispatchEvent(new Event(LOGOUT_EVENT));
}

// ---------- Core request helpers ----------

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  json?: unknown;
  formData?: FormData;
  auth?: boolean;
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text.slice(0, 200) };
  }
}

async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const { method = "GET", json, formData, auth = true } = opts;
  const headers: Record<string, string> = {};
  if (json !== undefined) headers["Content-Type"] = "application/json";
  if (auth && tokens.access) headers.Authorization = `Bearer ${tokens.access}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: formData ?? (json !== undefined ? JSON.stringify(json) : undefined),
    });
  } catch {
    throw new ApiError(0, { detail: "Can't reach the server. Is the backend running?" });
  }

  if (res.status === 401 && auth && !retried) {
    if (await refreshAccessToken()) return request<T>(path, opts, true);
    forceLogout();
  }

  const body = await parseBody(res);
  if (!res.ok) throw new ApiError(res.status, (body as ApiErrorBody | null) ?? null);
  return body as T;
}

export type ExportFormat = "docx" | "md";

/** A downloaded file: its contents and the name the server suggests. */
export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

/** Pull the file name out of Content-Disposition (prefers the UTF-8 `filename*`). */
function filenameFrom(header: string | null, fallback: string): string {
  const star = header?.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1]);
  const plain = header?.match(/filename="([^"]+)"/i);
  return plain?.[1] ?? fallback;
}

/** GET a binary file with the same auth + refresh-once handling as `request`. */
async function requestFile(path: string, fallbackName: string, retried = false): Promise<DownloadedFile> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
    });
  } catch {
    throw new ApiError(0, { detail: "Can't reach the server. Is the backend running?" });
  }
  if (res.status === 401 && !retried) {
    if (await refreshAccessToken()) return requestFile(path, fallbackName, true);
    forceLogout();
  }
  if (!res.ok) throw new ApiError(res.status, (await parseBody(res)) as ApiErrorBody | null);
  return {
    blob: await res.blob(),
    filename: filenameFrom(res.headers.get("Content-Disposition"), fallbackName),
  };
}

/** Hand a downloaded file to the browser's normal "save" flow. */
export function saveFile({ blob, filename }: DownloadedFile): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Multipart upload via XMLHttpRequest, because fetch() has no upload-progress
 * events. Applies the same refresh-and-retry-once logic as `request`.
 */
function uploadWithProgress<T>(
  path: string,
  formData: FormData,
  onProgress?: (fraction: number) => void,
  retried = false,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}${path}`);
    if (tokens.access) xhr.setRequestHeader("Authorization", `Bearer ${tokens.access}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () =>
      reject(new ApiError(0, { detail: "Upload failed: can't reach the server." }));
    xhr.onload = async () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = { detail: xhr.responseText.slice(0, 200) };
      }
      if (xhr.status === 401 && !retried) {
        if (await refreshAccessToken()) {
          uploadWithProgress<T>(path, formData, onProgress, true).then(resolve, reject);
          return;
        }
        forceLogout();
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new ApiError(xhr.status, body as ApiErrorBody | null));
    };
    xhr.send(formData);
  });
}

/**
 * POST a question and consume the Server-Sent Events response.
 *
 * The browser's EventSource can only do GET and can't set an Authorization
 * header, so we use fetch() and parse the SSE frames from the body stream
 * ourselves: frames are separated by a blank line, each has "event:" and
 * "data:" (JSON) lines.
 */
async function askStream(
  conversationId: number,
  question: string,
  handlers: AskHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const send = () =>
    fetch(`${API_URL}/conversations/${conversationId}/ask/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {}),
      },
      body: JSON.stringify({ question }),
      signal,
    });

  let res: Response;
  try {
    res = await send();
    if (res.status === 401) {
      if (!(await refreshAccessToken())) {
        forceLogout();
        throw new ApiError(401, { detail: "Your session expired. Please log in again." });
      }
      res = await send();
    }
  } catch (err) {
    if (err instanceof ApiError || (err instanceof DOMException && err.name === "AbortError")) {
      throw err;
    }
    throw new ApiError(0, { detail: "Can't reach the server. Is the backend running?" });
  }

  if (!res.ok || !res.body) {
    throw new ApiError(res.status, (await parseBody(res)) as ApiErrorBody | null);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (frame: string) => {
    let event = "message";
    let data = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    const payload = JSON.parse(data) as Record<string, unknown>;
    if (event === "sources") handlers.onSources?.(payload.sources as Citation[]);
    else if (event === "token") handlers.onToken?.(payload.text as string);
    else if (event === "done") handlers.onDone?.(payload.message as Message);
    else if (event === "error") handlers.onError?.(payload.detail as string);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      dispatch(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
  }
  if (buffer.trim()) dispatch(buffer);
}

// ---------- Endpoints ----------

export const api = {
  // Auth
  async login(email: string, password: string): Promise<void> {
    const pair = await request<TokenPair>("/auth/login/", {
      method: "POST",
      json: { email, password },
      auth: false,
    });
    tokens.set(pair);
  },
  register(email: string, password: string, fullName: string): Promise<User> {
    return request<User>("/auth/register/", {
      method: "POST",
      json: { email, password, full_name: fullName },
      auth: false,
    });
  },
  me(): Promise<User> {
    return request<User>("/auth/me/");
  },
  logout(): void {
    tokens.clear();
  },

  // Workspaces
  listWorkspaces(): Promise<Workspace[]> {
    return request<Workspace[]>("/workspaces/");
  },
  createWorkspace(name: string): Promise<Workspace> {
    return request<Workspace>("/workspaces/", { method: "POST", json: { name } });
  },

  // Documents
  listDocuments(workspaceId: number): Promise<DocumentItem[]> {
    return request<DocumentItem[]>(`/workspaces/${workspaceId}/documents/`);
  },
  uploadDocument(
    workspaceId: number,
    file: File,
    onProgress?: (fraction: number) => void,
  ): Promise<DocumentItem> {
    const form = new FormData();
    form.append("file", file);
    return uploadWithProgress<DocumentItem>(
      `/workspaces/${workspaceId}/documents/`,
      form,
      onProgress,
    );
  },
  getChunk(id: number): Promise<SourceChunk> {
    return request<SourceChunk>(`/chunks/${id}/`);
  },
  getDocument(id: number): Promise<DocumentItem> {
    return request<DocumentItem>(`/documents/${id}/`);
  },
  deleteDocument(id: number): Promise<null> {
    return request<null>(`/documents/${id}/`, { method: "DELETE" });
  },

  // Chat
  listConversations(workspaceId: number): Promise<Conversation[]> {
    return request<Conversation[]>(`/workspaces/${workspaceId}/conversations/`);
  },
  createConversation(workspaceId: number, documentIds: number[] = []): Promise<Conversation> {
    return request<Conversation>(`/workspaces/${workspaceId}/conversations/`, {
      method: "POST",
      json: { document_ids: documentIds },
    });
  },
  updateConversation(
    id: number,
    patch: { title?: string; document_ids?: number[] },
  ): Promise<Conversation> {
    return request<Conversation>(`/conversations/${id}/`, { method: "PATCH", json: patch });
  },
  deleteConversation(id: number): Promise<null> {
    return request<null>(`/conversations/${id}/`, { method: "DELETE" });
  },
  listMessages(conversationId: number): Promise<Message[]> {
    return request<Message[]>(`/conversations/${conversationId}/messages/`);
  },
  ask: askStream,
  /** One assistant answer as a Word or Markdown file. */
  exportAnswer(messageId: number, format: ExportFormat): Promise<DownloadedFile> {
    return requestFile(`/messages/${messageId}/export/${format}/`, `DocuChat answer.${format}`);
  },
};
