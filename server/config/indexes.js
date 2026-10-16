// The partial unique index that allows at most one PENDING visit request per
// requester and listing. Prisma can't declare partial indexes, so it is created and
// verified here (used by scripts/db-setup.js and checked by the test suite).

export const VISIT_REQUEST_COLLECTION = "VisitRequest";

export const PENDING_INDEX = {
  name: "visit_request_one_pending",
  key: { requesterId: 1, residencyId: 1 },
  unique: true,
  partialFilterExpression: { status: "PENDING" },
};

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Throws unless `indexes` (a listIndexes result) contains PENDING_INDEX with exactly
// the expected key, uniqueness and partial filter.
export const verifyPendingIndex = (indexes) => {
  const found = (indexes || []).find((i) => i.name === PENDING_INDEX.name);
  if (!found) {
    throw new Error(
      `Missing index "${PENDING_INDEX.name}" on ${VISIT_REQUEST_COLLECTION}. ` +
        "Run the guarded setup (yarn db:setup:dev / db:setup:test)."
    );
  }
  const problems = [];
  if (!sameJson(found.key, PENDING_INDEX.key)) problems.push("key");
  if (found.unique !== true) problems.push("unique");
  if (!sameJson(found.partialFilterExpression, PENDING_INDEX.partialFilterExpression)) {
    problems.push("partialFilterExpression");
  }
  if (problems.length) {
    throw new Error(`Index "${PENDING_INDEX.name}" has wrong options: ${problems.join(", ")}`);
  }
  return found;
};

export const listVisitRequestIndexes = async (prisma) => {
  const res = await prisma.$runCommandRaw({ listIndexes: VISIT_REQUEST_COLLECTION });
  return res.cursor.firstBatch;
};

export const createPendingIndex = (prisma) =>
  prisma.$runCommandRaw({ createIndexes: VISIT_REQUEST_COLLECTION, indexes: [PENDING_INDEX] });
