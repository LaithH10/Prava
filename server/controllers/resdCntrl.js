import asyncHandler from "express-async-handler";
import { prisma } from "../config/prismaConfig.js";
import { escapeRegex } from "../utils/regex.js";
import {
  HttpError,
  isUniqueViolation,
  parseWith,
  requireObjectId,
} from "../utils/validation.js";
import {
  createResidencySchema,
  listResidenciesQuery,
  updateResidencySchema,
} from "../validation/schemas.js";

const duplicateAddress = () =>
  new HttpError(409, "You already have a listing at this address", "DUPLICATE_ADDRESS");

// 404 unless the listing exists and belongs to `user`.
const findOwnListing = async (id, user) => {
  const residency = await prisma.residency.findFirst({ where: { id, ownerId: user.id } });
  if (!residency) throw new HttpError(404, "Residency not found", "NOT_FOUND");
  return residency;
};

// Closes every pending visit request on a listing. Called after archiving;
// together with the re-check in createVisitRequest this guarantees that no
// PENDING request remains on an archived listing, whatever the timing.
export const closePendingRequests = (residencyId) =>
  prisma.visitRequest.updateMany({
    where: { residencyId, status: "PENDING" },
    data: { status: "CLOSED", closedAt: new Date() },
  });

// Requires auth + verified email (see routes). The owner is always the caller.
export const createResidency = asyncHandler(async (req, res) => {
  const data = parseWith(createResidencySchema, req.body);
  try {
    const residency = await prisma.residency.create({
      data: { ...data, owner: { connect: { id: req.user.id } } },
    });
    res.status(201).send({ message: "Residency created successfully!", residency });
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicateAddress();
    throw err;
  }
});

// Public list of ACTIVE listings, newest first, with search and cursor pagination.
export const getAllResidencies = asyncHandler(async (req, res) => {
  const { q, city, country, minPrice, maxPrice, cursor, limit } = parseWith(
    listResidenciesQuery,
    req.query
  );
  // User input is escaped: Prisma passes `contains` to MongoDB $regex unescaped.
  const insensitive = (value) => ({ contains: escapeRegex(value), mode: "insensitive" });
  const where = {
    status: "ACTIVE",
    ...(q && { OR: [{ title: insensitive(q) }, { city: insensitive(q) }, { country: insensitive(q) }] }),
    ...(city && { city: insensitive(city) }),
    ...(country && { country: insensitive(country) }),
    ...((minPrice !== undefined || maxPrice !== undefined) && {
      price: {
        ...(minPrice !== undefined && { gte: minPrice }),
        ...(maxPrice !== undefined && { lte: maxPrice }),
      },
    }),
  };

  const rows = await prisma.residency.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });
  const items = rows.slice(0, limit);
  res.send({ items, nextCursor: rows.length > limit ? items[items.length - 1].id : null });
});

// Public detail. An archived listing is visible to its owner only (others get 404).
export const getResidency = asyncHandler(async (req, res) => {
  const id = requireObjectId(req.params.id, "residency id");
  const residency = await prisma.residency.findUnique({ where: { id } });
  const visible =
    residency && (residency.status === "ACTIVE" || residency.ownerId === req.user?.id);
  if (!visible) throw new HttpError(404, "Residency not found", "NOT_FOUND");
  res.send(residency);
});

// Owner only. Updates allowed fields; anything else in the body is ignored.
export const updateResidency = asyncHandler(async (req, res) => {
  const id = requireObjectId(req.params.id, "residency id");
  const data = parseWith(updateResidencySchema, req.body);
  await findOwnListing(id, req.user);
  try {
    const residency = await prisma.residency.update({ where: { id }, data });
    res.send({ message: "Residency updated", residency });
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicateAddress();
    throw err;
  }
});

// Owner only. Idempotent; also closes all pending visit requests.
export const archiveResidency = asyncHandler(async (req, res) => {
  const id = requireObjectId(req.params.id, "residency id");
  await findOwnListing(id, req.user);
  await prisma.residency.updateMany({
    where: { id, status: "ACTIVE" },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });
  // Always runs, even if the listing was already archived, to catch any request
  // created concurrently with an earlier archive.
  await closePendingRequests(id);
  const residency = await prisma.residency.findUnique({ where: { id } });
  res.send({ message: "Residency archived", residency });
});

// Owner only. Idempotent. Closed visit requests stay closed.
export const restoreResidency = asyncHandler(async (req, res) => {
  const id = requireObjectId(req.params.id, "residency id");
  await findOwnListing(id, req.user);
  await prisma.residency.updateMany({
    where: { id, status: "ARCHIVED" },
    data: { status: "ACTIVE", archivedAt: null },
  });
  const residency = await prisma.residency.findUnique({ where: { id } });
  res.send({ message: "Residency restored", residency });
});
