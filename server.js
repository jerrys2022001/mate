const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const KB_DATA_PATH = path.join(DATA_DIR, "mate-kb.json");
const USERS_DATA_PATH = path.join(DATA_DIR, "mate-users.json");
const SESSIONS_DATA_PATH = path.join(DATA_DIR, "mate-sessions.json");
const NOTE_CACHE_DIR = path.join(DATA_DIR, "mate-kb-notes");
const FILE_CACHE_DIR = path.join(DATA_DIR, "mate-kb-files");
const DEFAULT_PORT = 4317;
const JSON_LIMIT_BYTES = 1024 * 1024;
const MULTIPART_LIMIT_BYTES = 20 * 1024 * 1024;
const SESSION_COOKIE_NAME = "mate_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 120000;
const PASSWORD_KEY_LENGTH = 32;
const STATIC_ROUTES = {
  "/": "index.html",
  "/index.html": "index.html",
  "/chat": "chat.html",
  "/chat.html": "chat.html",
  "/knowledge-base": "knowledge-base.html",
  "/knowledge-base.html": "knowledge-base.html",
  "/quiz": "quiz.html",
  "/quiz.html": "quiz.html",
  "/directory.html": "directory.html",
  "/featured.html": "featured.html",
  "/prompt-library.html": "prompt-library.html",
  "/rankings.html": "rankings.html",
  "/tool.html": "tool.html",
  "/usecases.html": "usecases.html"
};

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp"
};

loadDotEnv(path.join(ROOT_DIR, ".env"));

const kbSeedDocuments = [
  {
    id: "rubric",
    name: "IELTS Writing Band Descriptors.pdf",
    type: "Scoring rubric",
    status: "Indexed and ready",
    summary: "Official scoring criteria for task response, coherence, lexical resource, and grammar.",
    sourceText: "Band descriptors for exam writing evaluation.",
    tags: ["exam", "ielts", "rubric", "starter"]
  },
  {
    id: "emails",
    name: "Business Email Tone Guide.docx",
    type: "Style guide",
    status: "Synced to KB",
    summary: "Approved phrasing patterns for client updates, scheduling, escalation, and follow-up emails.",
    sourceText: "Use concise, polite, business-friendly language with a clear next step.",
    tags: ["business", "email", "tone", "starter"]
  },
  {
    id: "essay-bank",
    name: "Top Essays Collection.docx",
    type: "Reference essays",
    status: "Chunked into examples",
    summary: "High-quality introductions, body paragraphs, and conclusion structures for common writing prompts.",
    sourceText: "Examples of strong introductions, body logic, and conclusions.",
    tags: ["essay", "examples", "writing", "starter"]
  }
];

const deepTutorConfig = createDeepTutorConfig();
let kbDocuments = loadKbDocuments();
let userRecords = loadUserRecords();
let sessionRecords = loadSessionRecords();
const mockChatSessions = new Map();
const MOCK_CHAT_HISTORY_LIMIT = 12;

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^"(.*)"$/, "$1");

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  });
}

function ensureDataDirectory() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(NOTE_CACHE_DIR, { recursive: true });
  fs.mkdirSync(FILE_CACHE_DIR, { recursive: true });
}

function loadJsonArray(filePath, seedValue) {
  ensureDataDirectory();

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(seedValue, null, 2));
    return seedValue.slice();
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    // Fall through to the seed value.
  }

  fs.writeFileSync(filePath, JSON.stringify(seedValue, null, 2));
  return seedValue.slice();
}

function loadKbDocuments() {
  return loadJsonArray(KB_DATA_PATH, kbSeedDocuments);
}

function saveKbDocuments() {
  ensureDataDirectory();
  fs.writeFileSync(KB_DATA_PATH, JSON.stringify(kbDocuments, null, 2));
}

function loadUserRecords() {
  return loadJsonArray(USERS_DATA_PATH, []);
}

function saveUserRecords() {
  ensureDataDirectory();
  fs.writeFileSync(USERS_DATA_PATH, JSON.stringify(userRecords, null, 2));
}

function loadSessionRecords() {
  const sessions = loadJsonArray(SESSIONS_DATA_PATH, []);
  const now = Date.now();
  const activeSessions = sessions.filter((session) => {
    return session && session.expiresAt && new Date(session.expiresAt).getTime() > now;
  });

  if (activeSessions.length !== sessions.length) {
    fs.writeFileSync(SESSIONS_DATA_PATH, JSON.stringify(activeSessions, null, 2));
  }

  return activeSessions;
}

function saveSessionRecords() {
  ensureDataDirectory();
  fs.writeFileSync(SESSIONS_DATA_PATH, JSON.stringify(sessionRecords, null, 2));
}

function getPort() {
  const portIndex = process.argv.indexOf("--port");
  if (portIndex !== -1 && process.argv[portIndex + 1]) {
    return Number(process.argv[portIndex + 1]);
  }

  return Number(process.env.PORT || DEFAULT_PORT);
}

function sendJson(res, statusCode, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, Object.assign({
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8"
  }, extraHeaders || {}));
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end(text);
}

function parseJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > JSON_LIMIT_BYTES) {
        reject(new Error("Request body too large"));
      }
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON payload"));
      }
    });

    req.on("error", reject);
  });
}

function parseBufferBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;
    let settled = false;

    function fail(error) {
      if (!settled) {
        settled = true;
        reject(error);
      }
    }

    req.on("data", (chunk) => {
      if (settled) {
        return;
      }

      totalLength += chunk.length;
      if (totalLength > limitBytes) {
        settled = true;
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });

    req.on("error", fail);
  });
}

async function parseMultipart(req) {
  const contentType = String(req.headers["content-type"] || "");
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);

  if (!boundaryMatch) {
    throw new Error("Missing multipart boundary.");
  }

  const boundary = boundaryMatch[1].trim().replace(/^"|"$/g, "");
  const rawBuffer = await parseBufferBody(req, MULTIPART_LIMIT_BYTES);
  const raw = rawBuffer.toString("latin1");
  const parts = raw.split(`--${boundary}`).slice(1, -1);
  const fields = {};
  const files = [];

  parts.forEach((part) => {
    const normalizedPart = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    if (!normalizedPart || normalizedPart === "--") {
      return;
    }

    const headerEndIndex = normalizedPart.indexOf("\r\n\r\n");
    if (headerEndIndex === -1) {
      return;
    }

    const headerText = normalizedPart.slice(0, headerEndIndex);
    const bodyText = normalizedPart.slice(headerEndIndex + 4);
    const headers = headerText.split("\r\n");
    const disposition = headers.find((header) => /^content-disposition:/i.test(header));

    if (!disposition) {
      return;
    }

    const nameMatch = disposition.match(/name="([^"]+)"/i);
    if (!nameMatch) {
      return;
    }

    const fieldName = nameMatch[1];
    const fileNameMatch = disposition.match(/filename="([^"]*)"/i);
    const contentTypeHeader = headers.find((header) => /^content-type:/i.test(header));
    const mimeType = contentTypeHeader ? contentTypeHeader.split(":")[1].trim() : "application/octet-stream";

    if (fileNameMatch && fileNameMatch[1]) {
      files.push({
        fieldName,
        originalName: fileNameMatch[1],
        mimeType,
        buffer: Buffer.from(bodyText, "latin1"),
        size: Buffer.byteLength(bodyText, "latin1")
      });
      return;
    }

    fields[fieldName] = bodyText;
  });

  return {
    fields,
    files
  };
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  if (!raw) {
    return {};
  }

  return raw.split(";").reduce((cookies, pair) => {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex === -1) {
      return cookies;
    }

    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();

    if (key) {
      cookies[key] = decodeURIComponent(value);
    }

    return cookies;
  }, {});
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function buildInitials(name, email) {
  const source = String(name || "").trim() || normalizeEmail(email).split("@")[0] || "mate";
  const words = source.split(/\s+/).filter(Boolean).slice(0, 2);

  if (!words.length) {
    return "MT";
  }

  return words.map((word) => word.slice(0, 1).toUpperCase()).join("");
}

function sanitizeUserRecord(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    goal: user.goal || "English learning",
    initials: buildInitials(user.name, user.email),
    preferredKbName: getKnowledgeBaseNameForUser(user),
    createdAt: user.createdAt
  };
}

function hashPassword(password, salt) {
  const safeSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(
    String(password || ""),
    safeSalt,
    PASSWORD_ITERATIONS,
    PASSWORD_KEY_LENGTH,
    "sha256"
  ).toString("hex");

  return {
    algorithm: "pbkdf2-sha256",
    iterations: PASSWORD_ITERATIONS,
    salt: safeSalt,
    hash
  };
}

function verifyPassword(password, passwordRecord) {
  if (!passwordRecord || !passwordRecord.salt || !passwordRecord.hash) {
    return false;
  }

  const derived = crypto.pbkdf2Sync(
    String(password || ""),
    passwordRecord.salt,
    Number(passwordRecord.iterations || PASSWORD_ITERATIONS),
    PASSWORD_KEY_LENGTH,
    "sha256"
  );
  const expected = Buffer.from(passwordRecord.hash, "hex");

  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

function serializeCookie(name, value, options) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge != null) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }

  if (options.path) {
    parts.push(`Path=${options.path}`);
  }

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  return parts.join("; ");
}

function createSessionCookie(token) {
  return serializeCookie(SESSION_COOKIE_NAME, token, {
    maxAge: SESSION_TTL_MS / 1000,
    path: "/",
    httpOnly: true,
    sameSite: "Lax"
  });
}

function clearSessionCookie() {
  return serializeCookie(SESSION_COOKIE_NAME, "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "Lax"
  });
}

function pruneExpiredSessions() {
  const now = Date.now();
  const activeSessions = sessionRecords.filter((session) => {
    return session && session.expiresAt && new Date(session.expiresAt).getTime() > now;
  });

  if (activeSessions.length !== sessionRecords.length) {
    sessionRecords = activeSessions;
    saveSessionRecords();
  }
}

function createSession(userId) {
  pruneExpiredSessions();

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);
  const session = {
    token: crypto.randomBytes(24).toString("base64url"),
    userId,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };

  sessionRecords = [session].concat(sessionRecords);
  saveSessionRecords();
  return session;
}

function removeSession(token) {
  if (!token) {
    return;
  }

  const nextSessions = sessionRecords.filter((session) => session.token !== token);
  if (nextSessions.length !== sessionRecords.length) {
    sessionRecords = nextSessions;
    saveSessionRecords();
  }
}

function getAuthContext(req) {
  pruneExpiredSessions();
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];

  if (!token) {
    return {
      authenticated: false,
      token: "",
      session: null,
      user: null
    };
  }

  const session = sessionRecords.find((item) => item.token === token);
  if (!session) {
    return {
      authenticated: false,
      token,
      session: null,
      user: null
    };
  }

  const user = userRecords.find((item) => item.id === session.userId);
  if (!user) {
    removeSession(token);
    return {
      authenticated: false,
      token,
      session: null,
      user: null
    };
  }

  return {
    authenticated: true,
    token,
    session,
    user
  };
}

function getKnowledgeBaseNameForUser(user) {
  const base = sanitizeFileBase(deepTutorConfig.defaultKbName || "mate-english");
  if (!user || !user.id) {
    return base;
  }

  return `${base}-${sanitizeFileBase(String(user.id).slice(0, 8))}`;
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function resolveStaticFile(urlPath) {
  const mapped = STATIC_ROUTES[urlPath] || urlPath.replace(/^\/+/, "");
  const safeRelativePath = mapped || "index.html";
  const candidate = path.resolve(ROOT_DIR, safeRelativePath);

  if (!candidate.startsWith(ROOT_DIR)) {
    return null;
  }

  return candidate;
}

function normalizePath(value, fallback) {
  const resolved = String(value || fallback || "").trim();
  if (!resolved) {
    return "";
  }

  const withLeadingSlash = resolved.startsWith("/") ? resolved : `/${resolved}`;
  return withLeadingSlash.replace(/\/+$/, "") || "/";
}

function resolvePathTemplate(template, params) {
  return String(template).replace(/\{([a-z_]+)\}/gi, function (_, key) {
    const value = params[key];
    return encodeURIComponent(value == null ? "" : String(value));
  });
}

function createDeepTutorConfig() {
  const baseUrl = String(process.env.DEEPTUTOR_BASE_URL || "").trim().replace(/\/+$/, "");
  const apiPrefix = normalizePath(process.env.DEEPTUTOR_API_PREFIX, "/api/v1");

  return {
      baseUrl,
      apiPrefix,
      requestTimeoutMs: Number(process.env.DEEPTUTOR_REQUEST_TIMEOUT_MS || 180000),
    rootProbePath: normalizePath(process.env.DEEPTUTOR_ROOT_PROBE_PATH, "/"),
    chatWsPath: normalizePath(process.env.DEEPTUTOR_CHAT_WS_PATH, `${apiPrefix}/chat`),
    solveWsPath: normalizePath(process.env.DEEPTUTOR_SOLVE_WS_PATH, `${apiPrefix}/solve`),
    quizWsPath: normalizePath(process.env.DEEPTUTOR_QUIZ_WS_PATH, `${apiPrefix}/question/generate`),
    kbListPath: normalizePath(process.env.DEEPTUTOR_KB_LIST_PATH, `${apiPrefix}/knowledge/list`),
    kbDefaultPath: normalizePath(process.env.DEEPTUTOR_KB_DEFAULT_PATH, `${apiPrefix}/knowledge/default`),
    kbSetDefaultTemplate: String(process.env.DEEPTUTOR_KB_SET_DEFAULT_TEMPLATE || `${apiPrefix}/knowledge/default/{kb_name}`),
    kbCreatePath: normalizePath(process.env.DEEPTUTOR_KB_CREATE_PATH, `${apiPrefix}/knowledge/create`),
      kbUploadTemplate: String(process.env.DEEPTUTOR_KB_UPLOAD_TEMPLATE || `${apiPrefix}/knowledge/{kb_name}/upload`),
      defaultKbName: String(process.env.DEEPTUTOR_DEFAULT_KB_NAME || "mate-english").trim(),
      kbProvider: String(process.env.DEEPTUTOR_KB_PROVIDER || "").trim(),
      enableKbProxy: !/^false$/i.test(String(process.env.DEEPTUTOR_ENABLE_KB_PROXY || "true")),
      enableWebSearch: /^true$/i.test(String(process.env.DEEPTUTOR_ENABLE_WEB_SEARCH || "false")),
      enableRagByDefault: !/^false$/i.test(String(process.env.DEEPTUTOR_ENABLE_RAG || "true"))
    };
  }

function isDeepTutorConfigured() {
  return Boolean(deepTutorConfig.baseUrl);
}

function hasWebSocketClient() {
  return typeof WebSocket === "function";
}

  function canUseDeepTutorRealtime() {
    return isDeepTutorConfigured() && hasWebSocketClient();
  }

  function canUseDeepTutorKnowledgeBase() {
    return isDeepTutorConfigured() && deepTutorConfig.enableKbProxy;
  }

function buildDeepTutorHttpUrl(routePath) {
  return new URL(routePath, `${deepTutorConfig.baseUrl}/`).toString();
}

function buildDeepTutorWsUrl(routePath) {
  const httpUrl = new URL(routePath, `${deepTutorConfig.baseUrl}/`);
  httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  return httpUrl.toString();
}

function createTimeoutController(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);

  return {
    signal: controller.signal,
    cancel() {
      clearTimeout(timer);
    }
  };
}

async function fetchJson(url, options, timeoutMs) {
  const timeout = createTimeoutController(timeoutMs || deepTutorConfig.requestTimeoutMs);

  try {
    const response = await fetch(url, Object.assign({}, options, { signal: timeout.signal }));
    const text = await response.text();
    let data = {};

    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = { raw: text };
      }
    }

    if (!response.ok) {
      const detail = data.detail || data.message || data.raw || `HTTP ${response.status}`;
      throw new Error(detail);
    }

    return data;
  } finally {
    timeout.cancel();
  }
}

async function websocketPayloadToText(value) {
  if (typeof value === "string") {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString("utf8");
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("utf8");
  }

  if (value && typeof value.text === "function") {
    return value.text();
  }

  return String(value);
}

async function runWebSocketSession(url, initialMessage, onEvent) {
  if (typeof WebSocket !== "function") {
    throw new Error("This Node.js runtime does not provide a WebSocket client.");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let sawOpen = false;
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      finishReject(new Error(`WebSocket timed out for ${url}`));
    }, deepTutorConfig.requestTimeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.onopen = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.onclose = null;
    }

    function finishResolve(value) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      try {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      } catch (error) {
        // Ignore close errors on shutdown.
      }

      resolve(value);
    }

    function finishReject(error) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      try {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      } catch (closeError) {
        // Ignore close errors on shutdown.
      }

      reject(error);
    }

    socket.onerror = function () {
      finishReject(new Error(`WebSocket error for ${url}`));
    };

    socket.onopen = function () {
      sawOpen = true;
      socket.send(JSON.stringify(initialMessage));
    };

    socket.onmessage = function (event) {
      Promise.resolve()
        .then(async function () {
          const raw = await websocketPayloadToText(event.data);
          const payload = JSON.parse(raw);
          const result = await onEvent(payload, finishResolve);

          if (result !== undefined) {
            finishResolve(result);
          }
        })
        .catch(finishReject);
    };

    socket.onclose = function () {
      if (!settled) {
        finishReject(new Error(sawOpen ? `WebSocket closed before completion: ${url}` : `WebSocket failed to open: ${url}`));
      }
    };
  });
}

function truncate(text, maxLength) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trim()}...`;
}

function splitIntoParagraphs(text, limit) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    return [truncate(normalized, 320)];
  }

  return paragraphs.slice(0, limit || 3).map((paragraph) => truncate(paragraph, 320));
}

function sanitizeFileBase(value) {
  return String(value || "note")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "note";
}

function buildKnowledgeCards(query, documents) {
  const normalized = String(query || "").trim().toLowerCase();
  const cards = [
    {
      title: "Ground every answer in your own source material",
      meta: "Useful for rubrics, class notes, email guidelines, and saved essay examples."
    },
    {
      title: "Search across uploads before asking the model to write",
      meta: "Helps prevent generic output and keeps the tone aligned with your goals."
    },
    {
      title: "Reuse source-backed snippets in chat and quiz generation",
      meta: "Your KB becomes the memory layer behind essay feedback, solving, and practice sets."
    },
    {
      title: "Keep exam prep and business writing in one place",
      meta: "Use one knowledge system for school, work, and daily English improvement."
    }
  ];

  const documentCards = (documents || []).map((document) => {
    const sourceSnippet = truncate(document.sourceText || document.summary || "Saved in Mate knowledge base.", 160);
    const tagsText = Array.isArray(document.tags) && document.tags.length
      ? `Tags: ${document.tags.join(", ")}`
      : "";

    return {
      title: `${document.type}: ${document.name}`,
      meta: [document.summary || sourceSnippet, tagsText].filter(Boolean).join(" "),
      searchText: [
        document.type,
        document.name,
        document.summary,
        document.sourceText,
        Array.isArray(document.tags) ? document.tags.join(" ") : ""
      ].filter(Boolean).join(" ")
    };
  });

  return cards.concat(documentCards).filter((card) => {
    if (!normalized) {
      return true;
    }

    return `${card.title} ${card.meta} ${card.searchText || ""}`.toLowerCase().includes(normalized);
  });
}

function normalizeChatText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function containsCjk(value) {
  return /[\u3400-\u9fff]/.test(String(value || ""));
}

function buildChatExcerpt(value, maxLength) {
  const normalized = normalizeChatText(value);
  return normalized ? truncate(normalized, maxLength || 110) : "";
}

function looksLikeRealtimeUpgradeRequest(value) {
  const raw = String(value || "");
  const normalized = raw.toLowerCase();

  return (containsCjk(raw) && normalized.includes("ai") && (
    /\u4e0a\u6e38/.test(raw)
    || /\u5b9e\u65f6/.test(raw)
    || /\u6a21\u677f/.test(raw)
    || /\u56de\u590d/.test(raw)
  ))
    || normalized.includes("upstream")
    || normalized.includes("real-time")
    || normalized.includes("realtime")
    || normalized.includes("live ai")
    || normalized.includes("deeptutor")
    || normalized.includes("mock")
    || normalized.includes("proxy");
}

function looksLikeEmailRequest(value) {
  const raw = String(value || "");
  const normalized = raw.toLowerCase();

  return normalized.includes("email")
    || /\u90ae\u4ef6|\u5ba2\u6237|\u56de\u590d\u90ae\u4ef6|\u5546\u52a1\u90ae\u4ef6/.test(raw);
}

function looksLikeGrammarRequest(value) {
  const raw = String(value || "");
  const normalized = raw.toLowerCase();

  return normalized.includes("grammar")
    || normalized.includes("tense")
    || /\u8bed\u6cd5|\u65f6\u6001|\u51a0\u8bcd|\u5355\u590d\u6570|\u53e5\u6cd5/.test(raw);
}

function looksLikeUpgradeRequest(value) {
  const raw = String(value || "");
  const normalized = raw.toLowerCase();

  return normalized.includes("better")
    || normalized.includes("rewrite")
    || normalized.includes("polish")
    || /\u6da6\u8272|\u6539\u5199|\u5347\u7ea7\u8868\u8fbe|\u66f4\u81ea\u7136|\u66f4\u5b66\u672f|\u66f4\u5730\u9053/.test(raw);
}

function looksLikeLongPaste(value) {
  const normalized = normalizeChatText(value);
  const sentenceCount = normalized.split(/[.!?]/).filter(Boolean).length;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;

  return normalized.length >= 220 || sentenceCount >= 4 || wordCount >= 45 || (containsCjk(value) && normalized.length >= 120);
}

function getMockChatSession(sessionId) {
  const key = String(sessionId || `mock-${crypto.randomUUID()}`);
  const history = mockChatSessions.get(key) || [];

  if (!mockChatSessions.has(key)) {
    mockChatSessions.set(key, history);
  }

  return {
    sessionId: key,
    history
  };
}

function appendMockChatTurn(sessionId, role, content) {
  const session = getMockChatSession(sessionId);
  session.history.push({
    role,
    content: normalizeChatText(content),
    createdAt: new Date().toISOString()
  });

  if (session.history.length > MOCK_CHAT_HISTORY_LIMIT) {
    session.history.splice(0, session.history.length - MOCK_CHAT_HISTORY_LIMIT);
  }

  mockChatSessions.set(session.sessionId, session.history);
  return session;
}

function buildChatMock(payload) {
  const rawMessage = String(payload.message || "").trim();
  const scenario = String(payload.scenario || "essay");
  const excerpt = buildChatExcerpt(rawMessage, 120);
  const session = getMockChatSession(payload.sessionId);
  let assistantLines;
  let suggestions;
  let engineLabel = "Mate mock coach";

  if (isDeepTutorConfigured()) {
    engineLabel = hasWebSocketClient()
      ? "DeepTutor unavailable, using mock"
      : "Node runtime lacks WebSocket, using mock";
  }

  appendMockChatTurn(session.sessionId, "user", rawMessage);

  if (looksLikeRealtimeUpgradeRequest(rawMessage)) {
    assistantLines = [
      "This chat is still in BFF mock mode, so it is not connected to the upstream realtime AI yet.",
      "To switch over, DeepTutor must be reachable from DEEPTUTOR_BASE_URL and the current Node runtime must provide a WebSocket client.",
      "Once /api/health reports proxyEnabled as true, this surface will stop using template replies and start using realtime responses."
    ];
    suggestions = ["Check /api/health", "Start DeepTutor", "Add WebSocket client"];
  } else if (scenario === "email" || looksLikeEmailRequest(rawMessage)) {
    assistantLines = [
      `I can rewrite this message around: ${excerpt || "your email draft"}.`,
      "First pass: make the ask explicit, trim apology loops, and end with one clear next step.",
      "Next pass options: more polite, more concise, or more executive-friendly."
    ];
    suggestions = ["Add subject line", "Make it more concise", "Clarify next step"];
  } else if (scenario === "grammar" || looksLikeGrammarRequest(rawMessage)) {
    assistantLines = [
      `I would explain the grammar point inside: ${excerpt || "your sentence"}.`,
      "Then I would show the corrected version, explain why it changes, and add one extra example.",
      "If you want, I can turn the same point into a 3-question drill next."
    ];
    suggestions = ["Explain simply", "Show two examples", "Create mini practice"];
  } else if (scenario === "upgrade" || looksLikeUpgradeRequest(rawMessage)) {
    assistantLines = [
      `I can keep the meaning of ${excerpt || "your line"} and raise the tone.`,
      "The usual improvements are stronger verbs, tighter rhythm, and fewer flat filler words.",
      "Ask for academic, business, or natural spoken tone and I can steer the next pass."
    ];
    suggestions = ["Academic tone", "More concise", "More persuasive"];
  } else if (looksLikeLongPaste(rawMessage)) {
    assistantLines = [
      "You pasted a full passage, so I should work on the actual text instead of returning the generic template.",
      `The section I would focus on first is: ${excerpt || "the passage you pasted"}.`,
      "Next step options: summarise the claim, extract the structure, or rewrite it into a clearer academic paragraph."
    ];
    suggestions = ["Summarise the claim", "Extract the structure", "Rewrite directly"];
  } else {
    assistantLines = [
      `I can work directly on: ${excerpt || "your last message"}.`,
      "For an essay-style pass, I would tighten the position, make the paragraph logic more explicit, and cut repeated wording.",
      "If you want, the next turn can be a direct rewrite, a band-style diagnosis, or a Chinese explanation."
    ];
    suggestions = containsCjk(rawMessage)
      ? ["Rewrite", "Line-by-line feedback", "Chinese explanation"]
      : ["Improve thesis", "Fix grammar", "Upgrade vocabulary"];
  }

  appendMockChatTurn(session.sessionId, "assistant", assistantLines.join(" "));

  return {
    mode: "mock",
    backendLabel: "Mate BFF",
    routeLabel: "POST /api/chat",
    engineLabel,
    sessionId: session.sessionId,
    assistantLines,
    suggestions
  };
}

function buildDeepSolveMock(payload) {
  const prompt = String(payload.prompt || "");
  return {
    mode: "mock",
    backendLabel: "Mate BFF",
    routeLabel: "POST /api/deep-solve",
    outputTitle: "Model reasoning path",
    blocks: [
      {
        heading: "Prompt diagnosis",
        text: prompt
          ? "The learner's prompt is clear, but it still needs a narrower position and more explicit logic between claim and evidence."
          : "The draft needs a clearer thesis and a more direct explanation of how the evidence supports the main idea."
      },
      {
        heading: "Step-by-step improvement",
        text: "1. Narrow the main claim. 2. Make the cause-and-effect relationship explicit. 3. Use one example per paragraph and explain the link back to the thesis."
      },
      {
        heading: "Stronger thesis",
        text: "Although the issue has tradeoffs, the stronger position is the one that makes the main benefit concrete and easy to defend with examples."
      }
    ],
    scores: [
      { value: "3", label: "logic gaps found" },
      { value: "2", label: "rewrite options" },
      { value: "1", label: "clearer thesis" }
    ]
  };
}

function buildQuizMock(payload) {
  const requestedCount = Math.max(1, Number((payload && payload.count) || 5));
  const requestedDifficulty = String((payload && payload.difficulty) || "upper-intermediate");
  const requestedTopic = String((payload && (payload.topic || payload.prompt)) || "English writing practice");

  return {
    mode: "mock",
    backendLabel: "Mate BFF",
    routeLabel: "POST /api/quiz",
    outputTitle: "Generated practice set",
    blocks: [
      {
        heading: "Question mix",
        text: `${requestedCount} items generated around ${truncate(requestedTopic, 88)} with a mix of correction, rewrite, and explanation prompts.`
      },
      {
        heading: "Difficulty control",
        text: `The set is tuned for ${requestedDifficulty} learners and uses realistic work, exam, and campus scenarios so the practice feels relevant rather than generic.`
      },
      {
        heading: "Feedback design",
        text: "Each answer key includes the correct sentence, a short explanation, and one extension example."
      }
    ],
    scores: [
      { value: String(requestedCount), label: "questions created" },
      { value: requestedDifficulty, label: "difficulty" },
      { value: "100%", label: "explanation coverage" }
    ]
  };
}

async function probeDeepTutor() {
  if (!isDeepTutorConfigured()) {
    return {
      configured: false,
      reachable: false
    };
  }

  try {
    const payload = await fetchJson(buildDeepTutorHttpUrl(deepTutorConfig.rootProbePath), {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    return {
      configured: true,
      reachable: true,
      payload
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      error: error.message
    };
  }
}

function buildChatSuggestions(scenario) {
  if (scenario === "email") {
    return ["Add subject line", "Make it more concise", "Clarify next step"];
  }
  if (scenario === "grammar") {
    return ["Explain simply", "Show two examples", "Create mini practice"];
  }
  if (scenario === "upgrade") {
    return ["Academic tone", "More concise", "More persuasive"];
  }
  return ["Improve thesis", "Fix grammar", "Upgrade vocabulary"];
}

function buildChatScenarioPrompt(scenario, payload) {
  const goal = normalizeChatText(payload && payload.goal);

  const sharedRules = [
    "You are Mate, a practical English writing coach inside an English growth product.",
    "Do not answer as a generic STEM tutor, study assistant, or product greeter.",
    "Work on the learner's actual English writing task and deliver useful coaching, not meta promises.",
    "When possible, give direct edits, rewrites, or concrete language improvements instead of only describing what you could do.",
    "If the learner gives a short steering command like 'academic', 'more concise', or 'direct rewrite', apply it to the most recent draft or sentence already in the conversation.",
    "If the learner has not provided enough text to rewrite or diagnose, ask one concise clarifying question instead of giving filler."
  ];

  const scenarioRules = {
    essay: [
      "Focus on essay structure, thesis clarity, paragraph logic, grammar, and vocabulary upgrades.",
      "Default output should include a short diagnosis and a stronger rewrite when the learner pasted enough text."
    ],
    email: [
      "Focus on business email and client-facing writing.",
      "Prioritize tone control, clarity of request, concise wording, and a clear next step or CTA."
    ],
    grammar: [
      "Act like a patient grammar teacher.",
      "Explain the rule simply, show the corrected version, and add at least one extra example when helpful."
    ],
    upgrade: [
      "Focus on sentence rewrites, stronger wording, rhythm, and tone shifts.",
      "When useful, offer two or three upgraded versions with labels like academic, concise, or persuasive."
    ]
  };

  const resolvedScenario = scenarioRules[scenario] ? scenario : "essay";
  const promptLines = sharedRules.concat(scenarioRules[resolvedScenario]);

  if (goal) {
    promptLines.push(`Current product goal: ${goal}.`);
  }

  return promptLines.join(" ");
}

function buildChatScenarioPrimerHistory(scenario, payload) {
  const systemInstruction = buildChatScenarioPrompt(scenario, payload);

  return [
    {
      role: "user",
      content: `Product instruction for this conversation: ${systemInstruction}`
    },
    {
      role: "assistant",
      content: "Understood. I will answer as Mate, an English writing coach, and give direct, concrete help on the learner's writing."
    }
  ];
}

async function loadDeepTutorChatHistory(sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();

  if (!normalizedSessionId) {
    return [];
  }

  try {
    const payload = await fetchJson(
      buildDeepTutorHttpUrl(resolvePathTemplate(`${deepTutorConfig.apiPrefix}/chat/sessions/{session_id}`, {
        session_id: normalizedSessionId
      })),
      {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      }
    );

    if (!payload || !Array.isArray(payload.messages)) {
      return [];
    }

    return payload.messages
      .map(function (item) {
        return {
          role: item && item.role === "assistant" ? "assistant" : "user",
          content: normalizeChatText(item && item.content)
        };
      })
      .filter(function (item) {
        return item.content;
      });
  } catch (error) {
    return [];
  }
}

async function proxyChatToDeepTutor(payload, user) {
  const scenario = String(payload.scenario || "essay");
  const kbName = String(payload.kbName || getKnowledgeBaseNameForUser(user) || "").trim();
  const enableRag = payload.enableRag == null ? deepTutorConfig.enableRagByDefault && Boolean(kbName) : Boolean(payload.enableRag);
  const enableWebSearch = payload.enableWebSearch == null ? deepTutorConfig.enableWebSearch : Boolean(payload.enableWebSearch);
  const history = buildChatScenarioPrimerHistory(scenario, payload).concat(await loadDeepTutorChatHistory(payload.sessionId));
  const wsPayload = {
    message: String(payload.message || ""),
    session_id: payload.sessionId || null,
    history,
    kb_name: enableRag ? kbName : "",
    enable_rag: enableRag,
    enable_web_search: enableWebSearch
  };

  const collected = {
    sessionId: payload.sessionId || null,
    stream: "",
    result: "",
    sources: {
      rag: [],
      web: []
    }
  };

  const result = await runWebSocketSession(buildDeepTutorWsUrl(deepTutorConfig.chatWsPath), wsPayload, function (event) {
    if (event.type === "session") {
      collected.sessionId = event.session_id || collected.sessionId;
      return undefined;
    }

    if (event.type === "stream") {
      collected.stream += event.content || "";
      return undefined;
    }

    if (event.type === "sources") {
      collected.sources = {
        rag: Array.isArray(event.rag) ? event.rag : [],
        web: Array.isArray(event.web) ? event.web : []
      };
      return undefined;
    }

    if (event.type === "result") {
      collected.result = event.content || collected.stream;
      return {
        mode: "proxy",
        backendLabel: "Mate BFF",
        routeLabel: `WS ${deepTutorConfig.chatWsPath}`,
        engineLabel: "Mate writing coach",
        sessionId: collected.sessionId,
        sources: collected.sources,
        assistantLines: splitIntoParagraphs(collected.result || collected.stream, 3),
        suggestions: buildChatSuggestions(scenario)
      };
    }

    if (event.type === "error") {
      throw new Error(event.message || event.content || "DeepTutor chat failed");
    }

    return undefined;
  });

  if (!result.assistantLines.length) {
    result.assistantLines = ["DeepTutor completed the chat turn, but no answer text was returned."];
  }

  return result;
}

function buildSolveProxyResponse(resultEvent, payload) {
  const blocks = splitIntoParagraphs(resultEvent.final_answer, 3).map((paragraph, index) => ({
    heading: index === 0 ? "DeepTutor answer" : `Detail ${index}`,
    text: paragraph
  }));

  if (resultEvent.output_dir_name) {
    blocks.push({
      heading: "Artifacts",
      text: `DeepTutor generated artifacts in workspace folder ${resultEvent.output_dir_name}.`
    });
  }

  return {
    mode: "proxy",
    backendLabel: "Mate BFF",
    routeLabel: `WS ${deepTutorConfig.solveWsPath}`,
    outputTitle: "DeepTutor solve result",
    blocks: blocks.slice(0, 3),
    scores: [
      { value: resultEvent.session_id ? "1" : "0", label: "solve session" },
      { value: resultEvent.output_dir_name ? "1" : "0", label: "artifact folders" },
      { value: payload.kbName ? "KB" : "GEN", label: "context mode" }
    ]
  };
}

async function proxySolveToDeepTutor(payload, user) {
  const requestedKbName = String(payload.kbName || "").trim();
  const tools = Array.isArray(payload.tools)
    ? payload.tools
    : deepTutorConfig.enableRagByDefault && Boolean(requestedKbName || getKnowledgeBaseNameForUser(user))
      ? ["rag"]
      : undefined;
  const kbName = Array.isArray(tools) && tools.includes("rag")
    ? String(requestedKbName || getKnowledgeBaseNameForUser(user) || "").trim()
    : "";

  return runWebSocketSession(
    buildDeepTutorWsUrl(deepTutorConfig.solveWsPath),
    {
      question: String(payload.prompt || payload.question || ""),
      kb_name: kbName || undefined,
      tools,
      detailed_answer: Boolean(payload.detailedAnswer)
    },
    function (event) {
      if (event.type === "result") {
        return buildSolveProxyResponse(event, { kbName });
      }

      if (event.type === "error") {
        throw new Error(event.content || event.message || "DeepTutor solve failed");
      }

      return undefined;
    }
  );
}

function buildQuizProxyResponse(events, payload) {
  const batch = events.find((event) => event.type === "batch_summary") || {
    requested: payload.count || 5,
    completed: 0,
    failed: 0
  };
  const statusMessages = events
    .map((event) => event.content || event.message || "")
    .filter(Boolean)
    .slice(-4);

  const activitySummary = statusMessages.length
    ? statusMessages.join(" ")
    : "DeepTutor completed the official question-generation websocket flow.";

  return {
    mode: "proxy",
    backendLabel: "Mate BFF",
    routeLabel: `WS ${deepTutorConfig.quizWsPath}`,
    outputTitle: "DeepTutor quiz generation",
    blocks: [
      {
        heading: "Generation status",
        text: `Requested ${batch.requested || payload.count || 5} questions. Completed ${batch.completed || 0}. Failed ${batch.failed || 0}.`
      },
      {
        heading: "DeepTutor activity",
        text: truncate(activitySummary, 320)
      },
      {
        heading: "Next step",
        text: "Review the generated question batch inside DeepTutor and bring the strongest items back into Mate's practice flow."
      }
    ],
    scores: [
      { value: String(batch.requested || payload.count || 5), label: "requested" },
      { value: String(batch.completed || 0), label: "completed" },
      { value: String(batch.failed || 0), label: "failed" }
    ]
  };
}

async function proxyQuizToDeepTutor(payload, user) {
  const events = [];
  const requestedKbName = String(payload.kbName || "").trim();
  const enableRag = payload.enableRag == null
    ? deepTutorConfig.enableRagByDefault && Boolean(requestedKbName)
    : Boolean(payload.enableRag);
  const kbName = enableRag ? String(requestedKbName || getKnowledgeBaseNameForUser(user) || "").trim() : "";
  const count = Number(payload.count || 5);
  const requirement = {
    knowledge_point: String(payload.topic || payload.prompt || "English writing practice"),
    preference: String(payload.preference || "Targeted practice for English learning"),
    difficulty: String(payload.difficulty || "upper-intermediate"),
    question_type: String(payload.questionType || "mixed")
  };

    return runWebSocketSession(
      buildDeepTutorWsUrl(deepTutorConfig.quizWsPath),
      {
        requirement,
        kb_name: kbName || undefined,
        count
      },
      function (event) {
      events.push(event);

      if (event.type === "error") {
        throw new Error(event.content || "DeepTutor quiz generation failed");
      }

        if (event.type === "complete") {
          return buildQuizProxyResponse(events, { count, kbName });
        }

        return undefined;
    }
  );
}

async function fetchDeepTutorKnowledgeBaseList() {
  if (!canUseDeepTutorKnowledgeBase()) {
    return [];
  }

  const payload = await fetchJson(buildDeepTutorHttpUrl(deepTutorConfig.kbListPath), {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!Array.isArray(payload)) {
    return [];
  }

  return payload;
}

async function setDefaultKnowledgeBaseIfNeeded(kbName) {
  if (!kbName) {
    return;
  }

  try {
    await fetchJson(buildDeepTutorHttpUrl(resolvePathTemplate(deepTutorConfig.kbSetDefaultTemplate, { kb_name: kbName })), {
      method: "PUT",
      headers: {
        Accept: "application/json"
      }
    });
  } catch (error) {
    // Keep going if DeepTutor refuses the default-kb update.
  }
}

function buildKnowledgeNotePayload(payload) {
  const name = String(payload.name || "").trim();
  const type = String(payload.type || "Reference file").trim();
  const summary = String(payload.summary || "").trim();
  const sourceText = String(payload.sourceText || "").trim();
  const tags = Array.isArray(payload.tags)
    ? payload.tags
    : String(payload.tags || "")
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);

  return {
    name,
    type,
    summary,
    sourceText,
    tags: Array.from(new Set(tags)).slice(0, 6)
  };
}

function sanitizeUploadFileName(value) {
  const parsed = path.parse(String(value || "upload.txt").trim());
  const safeBase = sanitizeFileBase(parsed.name || "upload");
  const safeExt = String(parsed.ext || "").toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10);

  return `${safeBase || "upload"}${safeExt || ".txt"}`;
}

function inferKnowledgeTypeFromFile(fileName, mimeType) {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  const typeMap = {
    ".pdf": "PDF reference",
    ".doc": "Word document",
    ".docx": "Word document",
    ".txt": "Text note",
    ".md": "Markdown note",
    ".csv": "Spreadsheet data",
    ".ppt": "Presentation",
    ".pptx": "Presentation"
  };

  if (typeMap[ext]) {
    return typeMap[ext];
  }

  if (String(mimeType || "").startsWith("text/")) {
    return "Text note";
  }

  return "Uploaded file";
}

function formatFileSize(size) {
  const numericSize = Number(size || 0);

  if (numericSize >= 1024 * 1024) {
    return `${(numericSize / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (numericSize >= 1024) {
    return `${Math.max(1, Math.round(numericSize / 1024))} KB`;
  }

  return `${numericSize} B`;
}

function extractTextPreviewFromFile(file) {
  const ext = path.extname(String(file.originalName || "")).toLowerCase();
  const isTextLike = String(file.mimeType || "").startsWith("text/") || [".txt", ".md", ".csv", ".json"].includes(ext);

  if (!isTextLike) {
    return `Uploaded file ${file.originalName} is stored in Mate and ready for KB indexing.`;
  }

  return file.buffer.toString("utf8").replace(/\s+/g, " ").trim().slice(0, 1800) || `Uploaded file ${file.originalName}`;
}

function writeKnowledgeNoteFile(note, user) {
  ensureDataDirectory();
  const fileName = `${getKnowledgeBaseNameForUser(user)}-${Date.now()}-${sanitizeFileBase(note.name)}.txt`;
  const filePath = path.join(NOTE_CACHE_DIR, fileName);
  const fileContents = [
    `Title: ${note.name}`,
    `Type: ${note.type}`,
    `Summary: ${note.summary || "No summary provided."}`,
    "",
    note.sourceText
  ].join("\n");

  fs.writeFileSync(filePath, fileContents, "utf8");
  return {
    fileName,
    filePath,
    fileContents
  };
}

function writeUploadedKnowledgeFile(file, user) {
  ensureDataDirectory();
  const userDir = path.join(FILE_CACHE_DIR, sanitizeFileBase(user.id || "anonymous"));
  fs.mkdirSync(userDir, { recursive: true });

  const storedName = `${Date.now()}-${sanitizeUploadFileName(file.originalName)}`;
  const filePath = path.join(userDir, storedName);

  fs.writeFileSync(filePath, file.buffer);

  return {
    storedName,
    filePath,
    relativePath: path.relative(ROOT_DIR, filePath)
  };
}

function mapUpstreamKnowledgeBase(info) {
  const stats = info.statistics || {};
  const rawDocuments = Number(stats.raw_documents || 0);
  const ragReady = stats.rag_initialized ? "RAG ready" : "RAG pending";
  const progressMessage = info.progress && info.progress.message ? ` ${info.progress.message}` : "";

  return {
    id: `deeptutor:${info.name}`,
    name: info.name,
    type: "DeepTutor KB",
    status: info.status || (info.is_default ? "default" : "available"),
    summary: `${ragReady}; ${rawDocuments} raw documents.${progressMessage}`.trim()
  };
}

function isUserOwnedKnowledgeDocument(document, user) {
  return Boolean(document && user && document.userId && document.userId === user.id);
}

function deriveKnowledgeDocumentTags(document) {
  const tags = new Set(Array.isArray(document.tags) ? document.tags : []);
  const normalizedType = String(document.type || "").toLowerCase();
  const normalizedName = String(document.name || "").toLowerCase();
  const normalizedSummary = String(document.summary || "").toLowerCase();

  if (normalizedType.includes("rubric") || normalizedName.includes("ielts") || normalizedName.includes("toefl") || normalizedName.includes("sat")) {
    tags.add("exam");
  }

  if (normalizedType.includes("email") || normalizedSummary.includes("email") || normalizedName.includes("email")) {
    tags.add("business");
  }

  if (normalizedType.includes("grammar") || normalizedSummary.includes("grammar")) {
    tags.add("grammar");
  }

  if (normalizedType.includes("essay") || normalizedSummary.includes("essay")) {
    tags.add("writing");
  }

  if (document.storagePath || document.fileSize || document.mimeType) {
    tags.add("file");
  }

  if (normalizedType.includes("note") || normalizedType.includes("guide")) {
    tags.add("note");
  }

  return Array.from(tags).slice(0, 6);
}

function decorateKnowledgeDocument(document, user) {
  return Object.assign({}, document, {
    editable: isUserOwnedKnowledgeDocument(document, user),
    sourceOrigin: document.userId ? "personal" : document.id && String(document.id).startsWith("deeptutor:") ? "deeptutor" : "starter",
    tags: deriveKnowledgeDocumentTags(document)
  });
}

function getVisibleLocalKnowledgeDocuments(user) {
  const userId = user && user.id;
  return kbDocuments.filter((document) => !document.userId || document.userId === userId);
}

function mergeKnowledgeDocuments(localDocuments, upstreamKnowledgeBases) {
  const seen = new Set();
  const merged = [];

  localDocuments.concat(upstreamKnowledgeBases).forEach((document) => {
    const key = `${document.type}:${document.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(document);
    }
  });

  return merged;
}

async function uploadKnowledgeNoteToDeepTutor(note, user) {
  const noteFile = writeKnowledgeNoteFile(note, user);
  return uploadKnowledgeFilesToDeepTutor([
    {
      originalName: noteFile.fileName,
      mimeType: "text/plain",
      buffer: Buffer.from(noteFile.fileContents, "utf8")
    }
  ], user);
}

async function uploadKnowledgeFilesToDeepTutor(files, user) {
  const kbName = getKnowledgeBaseNameForUser(user);
  const list = await fetchDeepTutorKnowledgeBaseList();
  const alreadyExists = list.some((item) => item.name === kbName);
  const routePath = alreadyExists
    ? resolvePathTemplate(deepTutorConfig.kbUploadTemplate, { kb_name: kbName })
    : deepTutorConfig.kbCreatePath;

  const form = new FormData();

  if (!alreadyExists) {
    form.append("name", kbName);
  }

  if (deepTutorConfig.kbProvider) {
    form.append("rag_provider", deepTutorConfig.kbProvider);
  }

  files.forEach((file) => {
    const blob = new Blob([file.buffer], {
      type: file.mimeType || "application/octet-stream"
    });
    form.append("files", blob, file.originalName);
  });

  const response = await fetchJson(buildDeepTutorHttpUrl(routePath), {
    method: "POST",
    body: form
  });

  await setDefaultKnowledgeBaseIfNeeded(kbName);

  return {
    kbName,
    taskId: response.task_id || "",
    action: alreadyExists ? "upload" : "create"
  };
}

function createLocalKbDocument(note, options) {
  return {
    id: `doc-${crypto.randomUUID()}`,
    name: note.name,
    type: note.type,
    status: options.status,
    summary: note.summary || "Uploaded into Mate KB",
    sourceText: note.sourceText,
    tags: Array.isArray(note.tags) ? note.tags.slice(0, 6) : [],
    createdAt: new Date().toISOString(),
    userId: options.userId || null,
    fileSize: options.fileSize || null,
    mimeType: options.mimeType || null,
    storagePath: options.storagePath || null,
    upstream: options.upstream || null
  };
}

function resolveStoredWorkspacePath(relativePath) {
  const safeRelativePath = String(relativePath || "").trim();
  if (!safeRelativePath) {
    return "";
  }

  const absolutePath = path.resolve(ROOT_DIR, safeRelativePath);
  if (!absolutePath.startsWith(ROOT_DIR)) {
    throw new Error("Invalid stored file path.");
  }

  return absolutePath;
}

function renameStoredKnowledgeFile(document, nextName) {
  if (!document.storagePath) {
    return document.storagePath || null;
  }

  const currentPath = resolveStoredWorkspacePath(document.storagePath);
  if (!currentPath || !fs.existsSync(currentPath)) {
    return document.storagePath;
  }

  const directoryPath = path.dirname(currentPath);
  if (!directoryPath.startsWith(FILE_CACHE_DIR)) {
    throw new Error("Stored file path is outside the KB cache.");
  }

  const currentExt = path.extname(document.name || path.basename(currentPath));
  const requestedExt = path.extname(nextName);
  const targetName = requestedExt ? nextName : `${nextName}${currentExt}`;
  const renamedFileName = `${Date.now()}-${sanitizeUploadFileName(targetName)}`;
  const nextPath = path.join(directoryPath, renamedFileName);

  fs.renameSync(currentPath, nextPath);
  return path.relative(ROOT_DIR, nextPath);
}

function normalizeKnowledgeDocumentName(document, nextName) {
  const requestedName = String(nextName || "").trim();
  const currentExt = path.extname(document.name || "");

  if (currentExt && !path.extname(requestedName)) {
    return `${requestedName}${currentExt}`;
  }

  return requestedName;
}

function deleteStoredKnowledgeFile(document) {
  if (!document.storagePath) {
    return;
  }

  const absolutePath = resolveStoredWorkspacePath(document.storagePath);
  if (!absolutePath || !absolutePath.startsWith(FILE_CACHE_DIR) || !fs.existsSync(absolutePath)) {
    return;
  }

  fs.unlinkSync(absolutePath);

  const directoryPath = path.dirname(absolutePath);
  try {
    if (directoryPath.startsWith(FILE_CACHE_DIR) && fs.readdirSync(directoryPath).length === 0) {
      fs.rmdirSync(directoryPath);
    }
  } catch (error) {
    // Ignore cleanup errors for empty per-user cache directories.
  }
}

async function listKnowledgeDocuments(user) {
  const localDocuments = getVisibleLocalKnowledgeDocuments(user);

  if (!canUseDeepTutorKnowledgeBase()) {
    return localDocuments.map((document) => decorateKnowledgeDocument(document, user));
  }

  try {
    const kbName = getKnowledgeBaseNameForUser(user);
    const upstream = await fetchDeepTutorKnowledgeBaseList();
    const scopedUpstream = upstream.filter((item) => item.name === kbName);
    return mergeKnowledgeDocuments(localDocuments, scopedUpstream.map(mapUpstreamKnowledgeBase)).map((document) => decorateKnowledgeDocument(document, user));
  } catch (error) {
    return localDocuments.map((document) => decorateKnowledgeDocument(document, user));
  }
}

async function createKnowledgeDocument(payload, user) {
  const note = buildKnowledgeNotePayload(payload);

  if (!note.name || !note.sourceText) {
    throw new Error("Both name and sourceText are required.");
  }

  if (!canUseDeepTutorKnowledgeBase()) {
    const localDocument = createLocalKbDocument(note, {
      status: "Saved to local KB store",
      userId: user.id
    });

    kbDocuments = [localDocument].concat(kbDocuments);
    saveKbDocuments();
    return {
      mode: "mock",
      documents: await listKnowledgeDocuments(user)
    };
  }

  try {
    const upstream = await uploadKnowledgeNoteToDeepTutor(note, user);
    const localDocument = createLocalKbDocument(note, {
      status: upstream.taskId ? `Queued in DeepTutor KB (${upstream.taskId})` : "Uploaded to DeepTutor KB",
      userId: user.id,
      upstream
    });

    kbDocuments = [localDocument].concat(kbDocuments);
    saveKbDocuments();

    return {
      mode: "proxy",
      documents: await listKnowledgeDocuments(user)
    };
  } catch (error) {
    const localDocument = createLocalKbDocument(note, {
      status: "DeepTutor upload failed, kept in local KB store",
      userId: user.id
    });

    kbDocuments = [localDocument].concat(kbDocuments);
    saveKbDocuments();

    return {
      mode: "mock",
      documents: await listKnowledgeDocuments(user),
      warning: error.message
    };
  }
}

async function createKnowledgeDocumentsFromFiles(files, user) {
  if (!Array.isArray(files) || !files.length) {
    throw new Error("Choose at least one file to upload.");
  }

  const preparedFiles = files
    .filter((file) => file && file.size > 0)
    .map((file) => {
      const storedFile = writeUploadedKnowledgeFile(file, user);
      return {
        file,
        storedFile,
        document: createLocalKbDocument(
          {
            name: file.originalName,
            type: inferKnowledgeTypeFromFile(file.originalName, file.mimeType),
            summary: `${inferKnowledgeTypeFromFile(file.originalName, file.mimeType)} uploaded from your device. ${formatFileSize(file.size)} ready for indexing.`,
            sourceText: extractTextPreviewFromFile(file)
          },
          {
            status: "Saved to local KB store",
            userId: user.id,
            fileSize: file.size,
            mimeType: file.mimeType,
            storagePath: storedFile.relativePath
          }
        )
      };
    });

  if (!preparedFiles.length) {
    throw new Error("Uploaded files were empty.");
  }

  if (!canUseDeepTutorKnowledgeBase()) {
    kbDocuments = preparedFiles.map((item) => item.document).concat(kbDocuments);
    saveKbDocuments();
    return {
      mode: "mock",
      uploadedCount: preparedFiles.length,
      documents: await listKnowledgeDocuments(user)
    };
  }

  try {
    const upstream = await uploadKnowledgeFilesToDeepTutor(preparedFiles.map((item) => item.file), user);
    kbDocuments = preparedFiles.map((item) => {
      item.document.status = upstream.taskId
        ? `Queued in DeepTutor KB (${upstream.taskId})`
        : "Uploaded to DeepTutor KB";
      item.document.upstream = upstream;
      return item.document;
    }).concat(kbDocuments);
    saveKbDocuments();

    return {
      mode: "proxy",
      uploadedCount: preparedFiles.length,
      documents: await listKnowledgeDocuments(user)
    };
  } catch (error) {
    kbDocuments = preparedFiles.map((item) => {
      item.document.status = "DeepTutor upload failed, kept in local KB store";
      return item.document;
    }).concat(kbDocuments);
    saveKbDocuments();

    return {
      mode: "mock",
      uploadedCount: preparedFiles.length,
      documents: await listKnowledgeDocuments(user),
      warning: error.message
    };
  }
}

function getKnowledgeDocumentForUser(documentId, user) {
  return kbDocuments.find((document) => document.id === documentId && document.userId === user.id) || null;
}

async function renameKnowledgeDocument(documentId, payload, user) {
  const document = getKnowledgeDocumentForUser(documentId, user);
  if (!document) {
    throw new Error("Document not found or not editable.");
  }

  const nextName = String(payload.name || "").trim();
  if (!nextName) {
    throw new Error("Please provide a new document name.");
  }

  const normalizedName = normalizeKnowledgeDocumentName(document, nextName);
  document.storagePath = renameStoredKnowledgeFile(document, normalizedName);
  document.name = normalizedName;
  document.updatedAt = new Date().toISOString();
  saveKbDocuments();

  return {
    ok: true,
    mode: canUseDeepTutorKnowledgeBase() ? "proxy" : "mock",
    documents: await listKnowledgeDocuments(user)
  };
}

async function deleteKnowledgeDocument(documentId, user) {
  const document = getKnowledgeDocumentForUser(documentId, user);
  if (!document) {
    throw new Error("Document not found or not editable.");
  }

  deleteStoredKnowledgeFile(document);
  kbDocuments = kbDocuments.filter((item) => item.id !== documentId);
  saveKbDocuments();

  return {
    ok: true,
    mode: canUseDeepTutorKnowledgeBase() ? "proxy" : "mock",
    documents: await listKnowledgeDocuments(user)
  };
}

async function searchKnowledgeCards(query, user) {
  const documents = await listKnowledgeDocuments(user);
  return {
    mode: canUseDeepTutorKnowledgeBase() ? "proxy" : "mock",
    cards: buildKnowledgeCards(query, documents)
  };
}

function buildAuthResponse(user) {
  return {
    ok: true,
    authenticated: true,
    user: sanitizeUserRecord(user)
  };
}

async function handleSignup(req, res) {
  const payload = await parseJson(req);
  const name = String(payload.name || "").trim();
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  const goal = String(payload.goal || "English learning").trim();

  if (!name) {
    sendJson(res, 400, {
      ok: false,
      error: "Please add your name."
    });
    return;
  }

  if (!validateEmail(email)) {
    sendJson(res, 400, {
      ok: false,
      error: "Please enter a valid email address."
    });
    return;
  }

  if (password.length < 8) {
    sendJson(res, 400, {
      ok: false,
      error: "Password must be at least 8 characters."
    });
    return;
  }

  if (userRecords.some((user) => user.email === email)) {
    sendJson(res, 409, {
      ok: false,
      error: "An account with that email already exists."
    });
    return;
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    goal,
    password: hashPassword(password),
    createdAt: new Date().toISOString()
  };

  userRecords = [user].concat(userRecords);
  saveUserRecords();

  const session = createSession(user.id);
  sendJson(res, 200, buildAuthResponse(user), {
    "Set-Cookie": createSessionCookie(session.token)
  });
}

async function handleLogin(req, res) {
  const payload = await parseJson(req);
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  const user = userRecords.find((item) => item.email === email);

  if (!user || !verifyPassword(password, user.password)) {
    sendJson(res, 401, {
      ok: false,
      error: "Email or password is incorrect."
    });
    return;
  }

  const session = createSession(user.id);
  sendJson(res, 200, buildAuthResponse(user), {
    "Set-Cookie": createSessionCookie(session.token)
  });
}

function handleLogout(req, res, authContext) {
  if (authContext && authContext.token) {
    removeSession(authContext.token);
  }

  sendJson(res, 200, {
    ok: true,
    authenticated: false
  }, {
    "Set-Cookie": clearSessionCookie()
  });
}

function handleSession(req, res, authContext) {
  if (!authContext.authenticated || !authContext.user) {
    sendJson(res, 200, {
      ok: true,
      authenticated: false
    }, authContext.token ? { "Set-Cookie": clearSessionCookie() } : undefined);
    return;
  }

  sendJson(res, 200, buildAuthResponse(authContext.user));
}

async function serveStatic(req, res, urlPath) {
  const filePath = resolveStaticFile(urlPath);

  if (!filePath) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const contents = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream"
    });
    res.end(contents);
  } catch (error) {
    sendText(res, 404, "Not found");
  }
}

async function handleApi(req, res, pathname) {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  const authContext = getAuthContext(req);

  if (pathname === "/api/health" && req.method === "GET") {
    const probe = await probeDeepTutor();
    const websocketClientAvailable = hasWebSocketClient();
    const realtimeProxyEnabled = probe.reachable && websocketClientAvailable;
    const kbProxyEnabled = probe.reachable && deepTutorConfig.enableKbProxy;

    sendJson(res, 200, {
      ok: true,
      mode: realtimeProxyEnabled ? "proxy" : "mock",
      proxyEnabled: realtimeProxyEnabled,
      configured: probe.configured,
      backendLabel: "Mate BFF",
      upstreamReachable: probe.reachable,
      websocketClientAvailable,
      defaultKbName: deepTutorConfig.defaultKbName,
      capabilities: ["chat", "deep-solve", "kb", "quiz"],
      protocol: "deeptutor-api",
      proxyCapabilities: {
        chat: realtimeProxyEnabled,
        deepSolve: realtimeProxyEnabled,
        quiz: realtimeProxyEnabled,
        kb: kbProxyEnabled
      },
      endpoints: {
        chat: deepTutorConfig.chatWsPath,
        deepSolve: deepTutorConfig.solveWsPath,
        quiz: deepTutorConfig.quizWsPath,
        kbList: deepTutorConfig.kbListPath,
        kbCreate: deepTutorConfig.kbCreatePath
      }
    });
    return;
  }

  if (pathname === "/api/auth/session" && req.method === "GET") {
    handleSession(req, res, authContext);
    return;
  }

  if (pathname === "/api/auth/signup" && req.method === "POST") {
    await handleSignup(req, res);
    return;
  }

  if (pathname === "/api/auth/login" && req.method === "POST") {
    await handleLogin(req, res);
    return;
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    handleLogout(req, res, authContext);
    return;
  }

  if (!authContext.authenticated || !authContext.user) {
    sendJson(res, 401, {
      ok: false,
      code: "AUTH_REQUIRED",
      error: "Authentication required."
    }, authContext.token ? { "Set-Cookie": clearSessionCookie() } : undefined);
    return;
  }

  if (pathname === "/api/chat" && req.method === "POST") {
    const payload = await parseJson(req);

    if (canUseDeepTutorRealtime()) {
      try {
        sendJson(res, 200, await proxyChatToDeepTutor(payload, authContext.user));
        return;
      } catch (error) {
        sendJson(res, 502, {
          ok: false,
          mode: "proxy-error",
          backendLabel: "Mate BFF",
          routeLabel: `WS ${deepTutorConfig.chatWsPath}`,
          engineLabel: "Mate writing coach",
          error: error.message || "DeepTutor chat failed."
        });
        return;
      }
    }

    sendJson(res, 503, {
      ok: false,
      mode: "unavailable",
      backendLabel: "Mate BFF",
      routeLabel: "POST /api/chat",
      engineLabel: "Mate writing coach",
      error: "Live chat is unavailable because DeepTutor realtime mode is not connected."
    });
    return;
  }

  if (pathname === "/api/deep-solve" && req.method === "POST") {
    const payload = await parseJson(req);

    if (canUseDeepTutorRealtime()) {
      try {
        sendJson(res, 200, await proxySolveToDeepTutor(payload, authContext.user));
        return;
      } catch (error) {
        sendJson(res, 200, buildDeepSolveMock(payload));
        return;
      }
    }

    sendJson(res, 200, buildDeepSolveMock(payload));
    return;
  }

  if (pathname === "/api/quiz" && req.method === "POST") {
    const payload = await parseJson(req);

    if (canUseDeepTutorRealtime()) {
      try {
        sendJson(res, 200, await proxyQuizToDeepTutor(payload, authContext.user));
        return;
      } catch (error) {
        sendJson(res, 200, buildQuizMock(payload));
        return;
      }
    }

    sendJson(res, 200, buildQuizMock(payload));
    return;
  }

  if (pathname === "/api/kb/documents" && req.method === "GET") {
    const documents = await listKnowledgeDocuments(authContext.user);
      sendJson(res, 200, {
        mode: canUseDeepTutorKnowledgeBase() ? "proxy" : "mock",
        documents
      });
    return;
  }

  if (pathname === "/api/kb/documents" && req.method === "POST") {
    try {
      const contentType = String(req.headers["content-type"] || "");

      if (contentType.includes("multipart/form-data")) {
        const multipart = await parseMultipart(req);
        sendJson(res, 200, await createKnowledgeDocumentsFromFiles(multipart.files, authContext.user));
        return;
      }

      const payload = await parseJson(req);
      sendJson(res, 200, await createKnowledgeDocument(payload, authContext.user));
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error.message
      });
    }
    return;
  }

  const kbDocumentMatch = pathname.match(/^\/api\/kb\/documents\/([^/]+)$/);
  if (kbDocumentMatch && req.method === "PUT") {
    try {
      const payload = await parseJson(req);
      sendJson(res, 200, await renameKnowledgeDocument(decodeURIComponent(kbDocumentMatch[1]), payload, authContext.user));
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error.message
      });
    }
    return;
  }

  if (kbDocumentMatch && req.method === "DELETE") {
    try {
      sendJson(res, 200, await deleteKnowledgeDocument(decodeURIComponent(kbDocumentMatch[1]), authContext.user));
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error.message
      });
    }
    return;
  }

  if (pathname === "/api/kb/search" && req.method === "POST") {
    const payload = await parseJson(req);
    sendJson(res, 200, await searchKnowledgeCards(payload.query, authContext.user));
    return;
  }

  sendJson(res, 404, {
    ok: false,
    error: "Endpoint not found"
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, "http://127.0.0.1");
    const pathname = parsedUrl.pathname;

    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message || "Unexpected server error"
    });
  }
});

const port = getPort();
server.listen(port, "127.0.0.1", () => {
  console.log(`Mate server running at http://127.0.0.1:${port}`);
});
