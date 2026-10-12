import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import { userRoute } from "./routes/userRoute.js";
import { residencyRoute } from "./routes/residencyRoute.js";
dotenv.config();

const app = express();

const PORT = process.env.PORT || 8000;

// Only the frontend origins listed in CORS_ORIGIN may call the API.
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim());

app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: allowedOrigins }));

app.use("/api/user", userRoute);
app.use("/api/residency", residencyRoute);

// Return errors as JSON and keep stack traces out of responses.
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ message: status === 500 ? "Something went wrong" : err.message });
});

app.listen(PORT, () => {
  console.log(`server is running on port ${PORT}`);
});
