import express from "express";
import {
  bookVisit,
  cancelBooking,
  createUser,
  getAllBookings,
} from "../controllers/userCntrl.js";

const router = express.Router();

router.post("/register", createUser);
router.post("/bookVisit/:id", bookVisit);
router.post("/allBookings", getAllBookings);
router.post("/removeBooking/:id", cancelBooking);

export { router as userRoute };
