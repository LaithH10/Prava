import express from "express";
import { createUser, getListingVisitRequests, getMyListings } from "../controllers/userCntrl.js";
import { addFavourite, getFavourites, removeFavourite } from "../controllers/favouriteCntrl.js";
import {
  cancelVisitRequest,
  createVisitRequest,
  getMyVisitRequests,
} from "../controllers/visitRequestCntrl.js";
import { loadUser, requireVerifiedEmail } from "../middleware/auth.js";

// Every user route requires a valid token and acts on the caller only.
// requireVerifiedEmail checks token claims, so it runs before loadUser touches the database.
export const createUserRoute = (requireAuth) => {
  const router = express.Router();
  router.use(requireAuth);

  router.post("/register", loadUser, createUser);

  router.get("/listings", loadUser, getMyListings);
  router.get("/listings/:id/visit-requests", loadUser, getListingVisitRequests);

  router.get("/favourites", loadUser, getFavourites);
  router.put("/favourites/:residencyId", loadUser, addFavourite);
  router.delete("/favourites/:residencyId", loadUser, removeFavourite);

  router.get("/visit-requests", loadUser, getMyVisitRequests);
  router.post("/visit-requests", requireVerifiedEmail, loadUser, createVisitRequest);
  router.post("/visit-requests/:id/cancel", loadUser, cancelVisitRequest);
  return router;
};
