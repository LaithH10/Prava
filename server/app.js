import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { createUserRoute } from "./routes/userRoute.js";
import { createResidencyRoute } from "./routes/residencyRoute.js";
import { createRequireAuth } from "./middleware/auth.js";

// Builds the Express app without starting a server, so tests can use it too.
export const createApp = () => {
  const app = express();

  // Only the frontend origins listed in CORS_ORIGIN may call the API.
  const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim());

  app.use(express.json());
  app.use(cookieParser());
  app.use(cors({ origin: allowedOrigins }));

  const requireAuth = createRequireAuth();
  app.use("/api/user", createUserRoute(requireAuth));
  app.use("/api/residency", createResidencyRoute(requireAuth));

  app.use((req, res) => {
    res.status(404).json({ message: "Not found" });
  });

  // Return errors as JSON and keep stack traces out of responses.
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    let message = err.message;
    if (status >= 500) message = "Something went wrong";
    else if (err.type === "entity.parse.failed") message = "Invalid JSON body";
    res.status(status).json({ message });
  });

  return app;
};
