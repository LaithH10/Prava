import { auth } from "express-oauth2-jwt-bearer";
import { prisma } from "../config/prismaConfig.js";
import { HttpError } from "../utils/validation.js";

// Custom claims added to the access token by the Auth0 post-login Action.
export const EMAIL_CLAIM = "https://prava/email";
export const EMAIL_VERIFIED_CLAIM = "https://prava/email_verified";

// Reads Auth0 settings from env. AUTH0_ISSUER and AUTH0_JWKS_URI override the
// values derived from AUTH0_DOMAIN; tests use them to point at a local JWKS.
const authConfig = () => {
  const { AUTH0_DOMAIN, AUTH0_AUDIENCE } = process.env;
  const issuer =
    process.env.AUTH0_ISSUER || (AUTH0_DOMAIN && `https://${AUTH0_DOMAIN}/`);
  const jwksUri =
    process.env.AUTH0_JWKS_URI || (issuer && `${issuer}.well-known/jwks.json`);

  if (!issuer || !jwksUri || !AUTH0_AUDIENCE) {
    throw new Error("Set AUTH0_DOMAIN and AUTH0_AUDIENCE (see server/.env.example)");
  }
  return { issuer, jwksUri, audience: AUTH0_AUDIENCE };
};

// Verifies the bearer token: RS256 signature against the JWKS, issuer, audience
// and expiry. Any failure responds 401.
export const createRequireAuth = () =>
  auth({ ...authConfig(), tokenSigningAlg: "RS256" });

// A request without an Authorization header passes through anonymously; one with
// a header must carry a valid token (401 otherwise). The library's own
// `authRequired: false` would silently ignore invalid tokens, so it isn't used.
export const createOptionalAuth = (requireAuth) => (req, res, next) =>
  req.headers.authorization ? requireAuth(req, res, next) : next();

// 403 unless the token says the user's email is verified. Runs on claims only.
export const requireVerifiedEmail = (req, res, next) => {
  if (req.auth?.payload?.[EMAIL_VERIFIED_CLAIM] !== true) {
    return next(
      new HttpError(403, "Please verify your email address first", "EMAIL_NOT_VERIFIED")
    );
  }
  next();
};

// For optional-auth routes: sets req.user to the existing user for a valid token,
// or leaves it undefined. Never creates users.
export const findOptionalUser = async (req, res, next) => {
  try {
    const authId = req.auth?.payload?.sub;
    if (typeof authId === "string" && authId) {
      req.user = (await prisma.user.findUnique({ where: { authId } })) ?? undefined;
    }
    next();
  } catch (err) {
    next(err);
  }
};

// Finds or creates the caller's User from the token's `sub` and keeps the
// token-derived email fields current. Sets req.user. Never reads the request body.
export const loadUser = async (req, res, next) => {
  try {
    const { payload } = req.auth;
    const authId = payload.sub;
    if (typeof authId !== "string" || !authId) {
      throw new HttpError(401, "Token has no subject", "UNAUTHENTICATED");
    }
    const email =
      typeof payload[EMAIL_CLAIM] === "string" ? payload[EMAIL_CLAIM] : null;
    const emailVerified = payload[EMAIL_VERIFIED_CLAIM] === true;

    let user = await prisma.user.findUnique({ where: { authId } });
    if (!user) {
      try {
        user = await prisma.user.create({ data: { authId, email, emailVerified } });
      } catch (err) {
        // P2002: a parallel request created the same user first
        if (err.code !== "P2002") throw err;
        user = await prisma.user.findUnique({ where: { authId } });
      }
    } else if (user.email !== email || user.emailVerified !== emailVerified) {
      user = await prisma.user.update({
        where: { authId },
        data: { email, emailVerified },
      });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};
