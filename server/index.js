import dotenv from "dotenv";
import { createApp } from "./app.js";
dotenv.config();

const PORT = process.env.PORT || 8000;

createApp().listen(PORT, () => {
  console.log(`server is running on port ${PORT}`);
});
