// Errors with an HTTP status; the error handler in app.js turns them into JSON responses.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Throws 400 unless id is a valid MongoDB ObjectId.
export const requireObjectId = (id, label = "id") => {
  if (typeof id !== "string" || !OBJECT_ID.test(id)) {
    throw new HttpError(400, `Invalid ${label}`);
  }
  return id;
};

// Throws 400 unless email is a plausible email address.
export const requireEmail = (email) => {
  if (typeof email !== "string" || !EMAIL.test(email)) {
    throw new HttpError(400, "A valid email is required");
  }
  return email;
};

// Throws 404 when a lookup returned nothing.
export const requireFound = (record, message) => {
  if (!record) {
    throw new HttpError(404, message);
  }
  return record;
};
