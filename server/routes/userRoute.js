import express from "express";
import {
  bookVisit,
  cancelBooking,
  createUser,
  getAllBookings,
  getAllFavourites,
  toFav,
} from "../controllers/userCntrl.js";
import { loadUser, requireVerifiedEmail } from "../middleware/auth.js";

// Every user route requires a valid token and acts on the caller only.
// requireVerifiedEmail checks token claims, so it runs before loadUser touches the database.
export const createUserRoute = (requireAuth) => {
  const router = express.Router();
  router.use(requireAuth);

  router.post("/register", loadUser, createUser);
  router.post("/bookVisit/:id", requireVerifiedEmail, loadUser, bookVisit);
  router.get("/bookings", loadUser, getAllBookings);
  router.post("/removeBooking/:id", loadUser, cancelBooking);
  router.post("/toFav/:rid", loadUser, toFav);
  router.get("/favourites", loadUser, getAllFavourites);
  return router;
};
