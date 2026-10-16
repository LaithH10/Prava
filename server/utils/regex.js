// Prisma's `contains` / `startsWith` on MongoDB pass the value to $regex WITHOUT
// escaping (verified against prava_test: contains("a.c") matched "abc", and "("
// crashed the query). Every user-supplied string must go through this first.
export const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
