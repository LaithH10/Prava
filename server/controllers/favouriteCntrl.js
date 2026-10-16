import asyncHandler from "express-async-handler";
import { prisma } from "../config/prismaConfig.js";
import { HttpError, isUniqueViolation, requireObjectId } from "../utils/validation.js";

// The caller's favourites; archived listings are hidden (the favourite is kept and
// reappears if the listing is restored).
export const getFavourites = asyncHandler(async (req, res) => {
  const favourites = await prisma.favourite.findMany({
    where: { userId: req.user.id, residency: { is: { status: "ACTIVE" } } },
    orderBy: { createdAt: "desc" },
    include: { residency: true },
  });
  res.send({ items: favourites.map((f) => ({ residencyId: f.residencyId, residency: f.residency })) });
});

// Idempotent add: 201 when created, 200 when it already existed.
export const addFavourite = asyncHandler(async (req, res) => {
  const residencyId = requireObjectId(req.params.residencyId, "residency id");
  const residency = await prisma.residency.findUnique({ where: { id: residencyId } });
  if (residency && residency.ownerId === req.user.id) {
    throw new HttpError(403, "You can't favourite your own listing", "OWN_LISTING");
  }
  if (!residency || residency.status !== "ACTIVE") {
    throw new HttpError(404, "Residency not found", "NOT_FOUND");
  }
  try {
    await prisma.favourite.create({ data: { userId: req.user.id, residencyId } });
    res.status(201).send({ message: "Added to favourites", residencyId });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    res.send({ message: "Already in favourites", residencyId });
  }
});

// Idempotent remove: 200 whether or not it existed.
export const removeFavourite = asyncHandler(async (req, res) => {
  const residencyId = requireObjectId(req.params.residencyId, "residency id");
  await prisma.favourite.deleteMany({ where: { userId: req.user.id, residencyId } });
  res.send({ message: "Removed from favourites", residencyId });
});
