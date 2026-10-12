import express from "express";
import {
  createResidency,
  getAllResidencies,
  getResidency,
} from "../controllers/resdCntrl.js";
import { loadUser, requireVerifiedEmail } from "../middleware/auth.js";

// Listing and detail stay public; creating a property needs a verified login.
export const createResidencyRoute = (requireAuth) => {
  const router = express.Router();

  router.post("/create", requireAuth, requireVerifiedEmail, loadUser, createResidency);
  router.get("/allresd", getAllResidencies);
  router.get("/:id", getResidency);
  return router;
};
