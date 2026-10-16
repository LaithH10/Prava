import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { createUserRoute } from "./routes/userRoute.js";
import { createResidencyRoute } from "./routes/residencyRoute.js";
import { createOptionalAuth, createRequireAuth } from "./middleware/auth.js";
import { DEFAULT_RATE_LIMITS, createRateLimits } from "./middleware/rateLimit.js";
import { DEFAULT_CODES } from "./utils/validation.js";

// Builds the Express app without starting a server, so tests can use it too.
// `options.rateLimits` overrides the per-minute limits (used by tests).
export const createApp = (options = {}) => {
  const app = express();

  // Only the frontend origins listed in CORS_ORIGIN may call the API.
  const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim());

  app.use(helmet());
  app.use(cors({ origin: allowedOrigins }));
  app.use(createRateLimits(options.rateLimits ?? DEFAULT_RATE_LIMITS));
  app.use(express.json({ limit: "20kb" }));
  app.use(cookieParser());

  const requireAuth = createRequireAuth();
  const optionalAuth = createOptionalAuth(requireAuth);
  app.use("/api/user", createUserRoute(requireAuth));
  app.use("/api/residency", createResidencyRoute(requireAuth, optionalAuth));

  app.use((req, res) => {
    res.status(404).json({ message: "Not found", code: "NOT_FOUND" });
  });

  // Return errors as { message, code, fields? } and keep stack traces out of responses.
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);

    let message = err.message;
    let code = err.code && typeof err.code === "string" && !/^P\d{4}$/.test(err.code)
      ? err.code
      : DEFAULT_CODES[status] ?? DEFAULT_CODES[500];

    if (status >= 500) {
      message = "Something went wrong";
      code = "INTERNAL";
    } else if (err.type === "entity.parse.failed") {
      message = "Invalid JSON body";
      code = "VALIDATION_ERROR";
    } else if (err.type === "entity.too.large") {
      message = "Request body is too large";
      code = "PAYLOAD_TOO_LARGE";
    } else if (status === 401) {
      // Token errors from express-oauth2-jwt-bearer carry their own codes.
      code = "UNAUTHENTICATED";
    }

    res.status(status).json({ message, code, ...(err.extra ?? {}) });
  });

  return app;
};
