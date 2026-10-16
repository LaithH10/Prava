import asyncHandler from "express-async-handler";
import { prisma } from "../config/prismaConfig.js";
import { HttpError, parseWith, requireObjectId } from "../utils/validation.js";
import { listingStatusQuery, profileSchema } from "../validation/schemas.js";
import { expireStaleRequests } from "./visitRequestCntrl.js";

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

// Returns the caller's profile (created by loadUser) and applies name/image if sent.
export const createUser = asyncHandler(async (req, res) => {
  const update = parseWith(profileSchema, req.body);
  const user = Object.keys(update).length
    ? await prisma.user.update({ where: { id: req.user.id }, data: update })
    : req.user;
  res.send({ message: "User registered successfully!", user: profileOf(user) });
});

// The caller's own listings (optionally by status) with pending visit-request counts.
export const getMyListings = asyncHandler(async (req, res) => {
  const { status } = parseWith(listingStatusQuery, req.query);
  const listings = await prisma.residency.findMany({
    where: { ownerId: req.user.id, ...(status && { status }) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      _count: { select: { visitRequests: { where: { status: "PENDING" } } } },
    },
  });
  res.send({
    items: listings.map(({ _count, ...listing }) => ({
      ...listing,
      pendingVisitRequests: _count.visitRequests,
    })),
  });
});

// Owner only: visit requests for one listing. Shows the requester's name and the
// requested date only (no email or other personal data).
export const getListingVisitRequests = asyncHandler(async (req, res) => {
  const id = requireObjectId(req.params.id, "residency id");
  const listing = await prisma.residency.findFirst({ where: { id, ownerId: req.user.id } });
  if (!listing) throw new HttpError(404, "Residency not found", "NOT_FOUND");

  await expireStaleRequests({ residencyId: id });
  const requests = await prisma.visitRequest.findMany({
    where: { residencyId: id },
    orderBy: [{ requestedDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      requestedDate: true,
      status: true,
      createdAt: true,
      requester: { select: { name: true } },
    },
  });
  res.send({
    items: requests.map(({ requester, ...request }) => ({
      ...request,
      requesterName: requester?.name || "Prava user",
    })),
  });
});
