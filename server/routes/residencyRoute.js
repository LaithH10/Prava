import express from "express";
import {
  archiveResidency,
  createResidency,
  getAllResidencies,
  getResidency,
  restoreResidency,
  updateResidency,
} from "../controllers/resdCntrl.js";
import { findOptionalUser, loadUser, requireVerifiedEmail } from "../middleware/auth.js";

// Listing and detail stay public (detail also recognises the owner, for archived
// listings); creating needs a verified login; changes are owner-only.
export const createResidencyRoute = (requireAuth, optionalAuth) => {
  const router = express.Router();

  router.post("/create", requireAuth, requireVerifiedEmail, loadUser, createResidency);
  router.get("/allresd", getAllResidencies);
  router.get("/:id", optionalAuth, findOptionalUser, getResidency);
  router.patch("/:id", requireAuth, loadUser, updateResidency);
  router.post("/:id/archive", requireAuth, loadUser, archiveResidency);
  router.post("/:id/restore", requireAuth, loadUser, restoreResidency);
  return router;
};
