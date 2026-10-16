import { rateLimit } from "express-rate-limit";

// Limits per client IP per minute. Writes (non-GET) are limited more strictly
// than reads. Values can be overridden (tests use this).
export const DEFAULT_RATE_LIMITS = { writesPerMinute: 30, readsPerMinute: 300 };

const limiter = (limit) =>
  rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({
        message: "Too many requests. Please wait a minute and try again.",
        code: "RATE_LIMITED",
      }),
  });

export const createRateLimits = ({ writesPerMinute, readsPerMinute } = DEFAULT_RATE_LIMITS) => {
  const writes = limiter(writesPerMinute);
  const reads = limiter(readsPerMinute);
  return (req, res, next) =>
    ["GET", "HEAD", "OPTIONS"].includes(req.method) ? reads(req, res, next) : writes(req, res, next);
};
