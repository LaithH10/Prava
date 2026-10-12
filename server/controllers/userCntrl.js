import asyncHandler from "express-async-handler";
import { prisma } from "../config/prismaConfig.js";
import { HttpError, requireFound, requireObjectId } from "../utils/validation.js";

// All handlers here run after requireAuth + loadUser, so req.user is the caller.
// Identity never comes from the request body.

// Fields of the caller's own profile that are safe to return.
const profileOf = (user) => ({
  id: user.id,
  email: user.email,
  emailVerified: user.emailVerified,
  name: user.name,
  image: user.image,
});

// The only profile fields a user may set themselves.
const readProfileUpdate = (body) => {
  const update = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.length > 100) {
      throw new HttpError(400, "Name must be text of at most 100 characters");
    }
    update.name = body.name.trim();
  }
  if (body.image !== undefined) {
    if (typeof body.image !== "string" || !/^https:\/\/\S{1,500}$/.test(body.image)) {
      throw new HttpError(400, "Image must be an https URL");
    }
    update.image = body.image;
  }
  return update;
};

const requireResidency = async (id) =>
  requireFound(
    await prisma.residency.findUnique({ where: { id }, select: { id: true } }),
    "Residency not found"
  );

// Returns the caller's profile (created by loadUser) and applies name/image if sent.
export const createUser = asyncHandler(async (req, res) => {
  const update = readProfileUpdate(req.body ?? {});
  const user = Object.keys(update).length
    ? await prisma.user.update({ where: { id: req.user.id }, data: update })
    : req.user;
  res.send({ message: "User registered successfully!", user: profileOf(user) });
});

//function to book a visit to a resd
export const bookVisit = asyncHandler(async (req, res) => {
  const id = requireObjectId(req.params.id, "residency id");
  const { date } = req.body ?? {};
  if (typeof date !== "string" || Number.isNaN(Date.parse(date))) {
    throw new HttpError(400, "A valid date is required");
  }
  await requireResidency(id);

  if (req.user.bookedVisits.some((visit) => visit.id === id)) {
    throw new HttpError(400, "This residency is already booked by you");
  }

  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      bookedVisits: { push: { id, date } },
    },
  });
  res.send("Your visit is booked successfully");
});

// the caller's bookings
export const getAllBookings = asyncHandler(async (req, res) => {
  res.status(200).send({ bookedVisits: req.user.bookedVisits });
});

//function to cancel the booking
export const cancelBooking = asyncHandler(async (req, res) => {
  const id = requireObjectId(req.params.id, "residency id");

  const bookedVisits = [...req.user.bookedVisits];
  const index = bookedVisits.findIndex((visit) => visit.id === id);
  if (index === -1) {
    throw new HttpError(404, "Booking not found");
  }

  bookedVisits.splice(index, 1);
  await prisma.user.update({
    where: { id: req.user.id },
    data: { bookedVisits },
  });

  res.send("Booking cancelled successfully");
});

//function to add a resd in favourite list of a user
export const toFav = asyncHandler(async (req, res) => {
  const rid = requireObjectId(req.params.rid, "residency id");
  const favourites = req.user.favResidenciesID;

  if (favourites.includes(rid)) {
    const updateUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        favResidenciesID: {
          set: favourites.filter((id) => id !== rid),
        },
      },
    });

    res.send({ message: "Removed from favourites", favResidenciesID: updateUser.favResidenciesID });
  } else {
    await requireResidency(rid);
    const updateUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        favResidenciesID: {
          push: rid,
        },
      },
    });
    res.send({ message: "Updated favourites", favResidenciesID: updateUser.favResidenciesID });
  }
});

// the caller's favourites
export const getAllFavourites = asyncHandler(async (req, res) => {
  res.status(200).send({ favResidenciesID: req.user.favResidenciesID });
});
