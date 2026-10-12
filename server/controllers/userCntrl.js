import asyncHandler from "express-async-handler";
import { prisma } from "../config/prismaConfig.js";
import {
  HttpError,
  requireEmail,
  requireFound,
  requireObjectId,
} from "../utils/validation.js";

export const createUser = asyncHandler(async (req, res) => {
  // Only accept profile fields; bookings, favourites and owned residencies can't be set at sign-up.
  const { email, name, image } = req.body;
  requireEmail(email);

  const userExist = await prisma.user.findUnique({ where: { email: email } });
  if (!userExist) {
    const user = await prisma.user.create({ data: { email, name, image } });
    res.send({
      message: "User registered successfully!",
      user: user,
    });
  } else res.status(201).send({ message: "User already registered" });
});

//function to book a visit to a resd
export const bookVisit = asyncHandler(async (req, res) => {
  const { email, date } = req.body;
  requireEmail(email);
  const id = requireObjectId(req.params.id, "residency id");

  const user = requireFound(
    await prisma.user.findUnique({
      where: { email },
      select: { bookedVisits: true },
    }),
    "User not found"
  );

  if (user.bookedVisits.some((visit) => visit.id === id)) {
    throw new HttpError(400, "This residency is already booked by you");
  }

  await prisma.user.update({
    where: { email: email },
    data: {
      bookedVisits: { push: { id, date } },
    },
  });
  res.send("Your visit is booked successfully");
});

//functio to get all the booking of the user
export const getAllBookings = asyncHandler(async (req, res) => {
  const { email } = req.body;
  requireEmail(email);

  const bookings = await prisma.user.findUnique({
    where: { email },
    select: { bookedVisits: true },
  });
  res.status(200).send(requireFound(bookings, "User not found"));
});

//function to cancel the booking
export const cancelBooking = asyncHandler(async (req, res) => {
  const { email } = req.body;
  requireEmail(email);
  const id = requireObjectId(req.params.id, "residency id");

  const user = requireFound(
    await prisma.user.findUnique({
      where: { email: email },
      select: { bookedVisits: true },
    }),
    "User not found"
  );

  const index = user.bookedVisits.findIndex((visit) => visit.id === id);
  if (index === -1) {
    throw new HttpError(404, "Booking not found");
  }

  user.bookedVisits.splice(index, 1);
  await prisma.user.update({
    where: { email: email },
    data: {
      bookedVisits: user.bookedVisits,
    },
  });

  res.send("Booking cancelled successfully");
});

//function to add a resd in favourite list of a user
export const toFav = asyncHandler(async (req, res) => {
  const { email } = req.body;
  requireEmail(email);
  const rid = requireObjectId(req.params.rid, "residency id");

  const user = requireFound(
    await prisma.user.findUnique({
      where: { email },
    }),
    "User not found"
  );

  if (user.favResidenciesID.includes(rid)) {
    const updateUser = await prisma.user.update({
      where: { email },
      data: {
        favResidenciesID: {
          set: user.favResidenciesID.filter((id) => id !== rid),
        },
      },
    });

    res.send({ message: "Removed from favourites", user: updateUser });
  } else {
    const updateUser = await prisma.user.update({
      where: { email: email },
      data: {
        favResidenciesID: {
          push: rid,
        },
      },
    });
    res.send({ message: "Updated favourites", user: updateUser });
  }
});

// function to get all favourites
export const getAllFavourites = asyncHandler(async (req, res) => {
  const { email } = req.body;
  requireEmail(email);

  const favResd = await prisma.user.findUnique({
    where: { email },
    select: { favResidenciesID: true },
  });
  res.status(200).send(requireFound(favResd, "User not found"));
});
