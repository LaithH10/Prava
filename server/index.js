import dotenv from "dotenv";
import { createApp } from "./app.js";
import { appDatabaseGuard } from "./config/databaseGuard.js";
dotenv.config();

const refusal = appDatabaseGuard(process.env.DATABASE_URL);
if (refusal) {
  console.error(refusal);
  process.exit(1);
}

const PORT = process.env.PORT || 8000;

createApp().listen(PORT, () => {
  console.log(`server is running on port ${PORT}`);
});
