import asyncHandler from "express-async-handler";
import { prisma } from "../config/prismaConfig.js";
import {
  HttpError,
  requireEmail,
  requireFound,
  requireObjectId,
} from "../utils/validation.js";

export const createResidency = asyncHandler(async (req, res) => {
  const {
    title,
    description,
    price,
    address,
    country,
    city,
    facilities,
    image,
    userEmail,
  } = req.body;
  requireEmail(userEmail);

  try {
    const residency = await prisma.residency.create({
      data: {
        title,
        description,
        price,
        address,
        country,
        city,
        facilities,
        image,
        owner: { connect: { email: userEmail } },
      },
    });

    res.send({ message: "Residency created successfully!", residency });
  } catch (err) {
    // P2002: unique constraint (same address for this owner)
    if (err.code === "P2002") {
      throw new HttpError(409, "A residency with this address already exists");
    }
    // P2025: the owner to connect to doesn't exist
    if (err.code === "P2025") {
      throw new HttpError(404, "Owner not found");
    }
    // Prisma validation errors (missing or wrongly typed fields)
    if (err.name === "PrismaClientValidationError") {
      throw new HttpError(400, "Invalid residency data");
    }
    throw err;
  }
});

// function to get all the residencies
export const getAllResidencies = asyncHandler(async (req, res) => {
  const residencies = await prisma.residency.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });

  res.send(residencies);
});

//function to get a specific residency
export const getResidency = asyncHandler(async (req, res) => {
  const id = requireObjectId(req.params.id, "residency id");

  const residency = await prisma.residency.findUnique({
    where: { id },
  });
  res.send(requireFound(residency, "Residency not found"));
});
