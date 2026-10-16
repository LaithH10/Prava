// Errors with an HTTP status and a stable code; the error handler in app.js turns
// them into { message, code, fields? } JSON responses.
export class HttpError extends Error {
  constructor(status, message, code, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// Default codes per status, used when an error carries no code of its own.
export const DEFAULT_CODES = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  429: "RATE_LIMITED",
  500: "INTERNAL",
};

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export const isObjectId = (id) => typeof id === "string" && OBJECT_ID.test(id);

// Throws 400 unless id is a valid MongoDB ObjectId.
export const requireObjectId = (id, label = "id") => {
  if (!isObjectId(id)) {
    throw new HttpError(400, `Invalid ${label}`, "VALIDATION_ERROR");
  }
  return id;
};

// Throws 404 when a lookup returned nothing.
export const requireFound = (record, message = "Not found") => {
  if (!record) {
    throw new HttpError(404, message, "NOT_FOUND");
  }
  return record;
};

// Parses `data` with a zod schema; throws 400 VALIDATION_ERROR with per-field messages.
export const parseWith = (schema, data) => {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  throw new HttpError(400, "Please check the highlighted fields", "VALIDATION_ERROR", { fields });
};

// Prisma "unique constraint failed", also raised for the raw partial index.
export const isUniqueViolation = (err) => err?.code === "P2002";
