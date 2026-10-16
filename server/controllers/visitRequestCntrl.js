import asyncHandler from "express-async-handler";
import { prisma } from "../config/prismaConfig.js";
import { dayToDate, startOfToday } from "../utils/dates.js";
import {
  HttpError,
  isUniqueViolation,
  parseWith,
  requireObjectId,
} from "../utils/validation.js";
import { createVisitRequestSchema, visitRequestStatusQuery } from "../validation/schemas.js";

// A visit request is a request to visit, not a confirmed appointment.
// Status rules (docs/milestone-3-plan.md, section 4.2/4.3):
//   PENDING -> CANCELLED (requester), EXPIRED (date passed), CLOSED (listing archived).
// Every transition is a conditional update on status: "PENDING", so concurrent
// transitions can't both apply. Final statuses never change.

// Marks pending requests whose date has passed as EXPIRED (lazy expiry on read/write).
export const expireStaleRequests = (where) =>
  prisma.visitRequest.updateMany({
    where: { ...where, status: "PENDING", requestedDate: { lt: startOfToday() } },
    data: { status: "EXPIRED", closedAt: new Date() },
  });

const summaryOf = (residency) =>
  residency.status === "ACTIVE"
    ? {
        id: residency.id,
        title: residency.title,
        image: residency.image,
        city: residency.city,
        country: residency.country,
        available: true,
      }
    : // Archived listings: title only, no link details.
      { title: residency.title, available: false };

const toResponse = (request, residency) => ({
  id: request.id,
  residencyId: request.residencyId,
  requestedDate: request.requestedDate,
  status: request.status,
  createdAt: request.createdAt,
  closedAt: request.closedAt,
  ...(residency && { residency: summaryOf(residency) }),
});

// The caller's visit requests, statuses current.
export const getMyVisitRequests = asyncHandler(async (req, res) => {
  const { status } = parseWith(visitRequestStatusQuery, req.query);
  await expireStaleRequests({ requesterId: req.user.id });
  const requests = await prisma.visitRequest.findMany({
    where: { requesterId: req.user.id, ...(status && { status }) },
    orderBy: [{ requestedDate: "asc" }, { createdAt: "asc" }],
    include: { residency: true },
  });
  res.send({ items: requests.map((r) => toResponse(r, r.residency)) });
});

export const createVisitRequest = asyncHandler(async (req, res) => {
  const { residencyId, requestedDate } = parseWith(createVisitRequestSchema, req.body);
  const requesterId = req.user.id;

  const residency = await prisma.residency.findUnique({ where: { id: residencyId } });
  if (!residency) throw new HttpError(404, "Residency not found", "NOT_FOUND");
  if (residency.ownerId === requesterId) {
    throw new HttpError(403, "You can't request a visit to your own listing", "OWN_LISTING");
  }
  if (residency.status !== "ACTIVE") {
    throw new HttpError(404, "Residency not found", "NOT_FOUND");
  }

  // A past-dated pending request must not block a new one.
  await expireStaleRequests({ requesterId, residencyId });

  let created;
  try {
    created = await prisma.visitRequest.create({
      data: { requesterId, residencyId, requestedDate: dayToDate(requestedDate) },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await prisma.visitRequest.findFirst({
      where: { requesterId, residencyId, status: "PENDING" },
      select: { id: true },
    });
    throw new HttpError(
      409,
      "You already have a pending visit request for this property",
      "DUPLICATE_REQUEST",
      { existingRequestId: existing?.id ?? null }
    );
  }

  // Archive race guard: if the listing was archived after the check above, close
  // the new request. archiveResidency closes pending requests after archiving, so
  // either way no PENDING request survives on an archived listing.
  const after = await prisma.residency.findUnique({
    where: { id: residencyId },
    select: { status: true },
  });
  if (after?.status !== "ACTIVE") {
    await prisma.visitRequest.updateMany({
      where: { id: created.id, status: "PENDING" },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    throw new HttpError(409, "This listing is no longer available", "LISTING_UNAVAILABLE");
  }

  res.status(201).send({
    message: "Visit request sent. This is a request, not a confirmed appointment.",
    visitRequest: toResponse(created, residency),
  });
});

export const cancelVisitRequest = asyncHandler(async (req, res) => {
  const id = requireObjectId(req.params.id, "visit request id");
  const requesterId = req.user.id;

  await expireStaleRequests({ requesterId });
  await prisma.visitRequest.updateMany({
    where: { id, requesterId, status: "PENDING" },
    data: { status: "CANCELLED", closedAt: new Date() },
  });

  const request = await prisma.visitRequest.findFirst({
    where: { id, requesterId },
    include: { residency: true },
  });
  if (!request) throw new HttpError(404, "Visit request not found", "NOT_FOUND");
  if (request.status !== "CANCELLED") {
    throw new HttpError(409, "Only pending visit requests can be cancelled", "REQUEST_NOT_PENDING");
  }
  // 200 also when it was already cancelled (idempotent).
  res.send({ message: "Visit request cancelled", visitRequest: toResponse(request, request.residency) });
});
