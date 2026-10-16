// Request validation (zod). Messages are user-facing and shown next to form fields.
import { z } from "zod";
import { checkRequestedDay } from "../utils/dates.js";
import { isObjectId } from "../utils/validation.js";

const text = (label, min, max) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

const count = (label) =>
  z
    .number({ error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(0, `${label} can't be negative`)
    .max(50, `${label} must be at most 50`);

export const httpsImageUrl = z
  .string({ error: "Image URL is required" })
  .trim()
  .max(500, "Image URL must be at most 500 characters")
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Image URL must be a valid https:// address");

export const residencyFields = {
  title: text("Title", 3, 100),
  description: text("Description", 10, 2000),
  price: z
    .number({ error: "Price must be a number" })
    .int("Price must be a whole number of euros")
    .min(1, "Price must be at least €1")
    .max(100_000_000, "Price must be at most €100,000,000"),
  address: text("Address", 3, 200),
  city: text("City", 2, 100),
  country: text("Country", 2, 100),
  image: httpsImageUrl,
  facilities: z.strictObject(
    { bedrooms: count("Bedrooms"), bathrooms: count("Bathrooms"), parkings: count("Parking") },
    { error: "Facilities must include bedrooms, bathrooms and parking" }
  ),
};

// Unknown keys (e.g. ownerId, status, userEmail) are stripped, never applied.
export const createResidencySchema = z.object(residencyFields);

export const updateResidencySchema = z
  .object(residencyFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Send at least one field to update");

const optionalTrimmed = (max) => z.string().trim().min(1).max(max).optional();

export const listResidenciesQuery = z.object({
  q: optionalTrimmed(100),
  city: optionalTrimmed(100),
  country: optionalTrimmed(100),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  cursor: z.string().refine(isObjectId, "Invalid cursor").optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

export const listingStatusQuery = z.object({
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

export const visitRequestStatusQuery = z.object({
  status: z.enum(["PENDING", "CANCELLED", "EXPIRED", "CLOSED"]).optional(),
});

export const createVisitRequestSchema = z.object({
  residencyId: z.string({ error: "Property is required" }).refine(isObjectId, "Invalid property"),
  requestedDate: z
    .string({ error: "Date is required" })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD")
    .superRefine((day, ctx) => {
      const problem = checkRequestedDay(day);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
});

export const profileSchema = z.object({
  name: z.string().trim().max(100, "Name must be at most 100 characters").optional(),
  image: httpsImageUrl.optional(),
});
