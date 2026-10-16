// The production database. Local development and tests must never use it.
export const APP_DATABASE = "LystedRealEtstate";

// Returns an error message when the URL points at the app database without
// ALLOW_APP_DATABASE=1 (set only for the approved production deployment).
export const appDatabaseGuard = (databaseUrl, env = process.env) => {
  let dbName;
  try {
    dbName = new URL(databaseUrl).pathname.slice(1);
  } catch {
    return "DATABASE_URL is missing or not a valid connection string";
  }
  if (dbName === APP_DATABASE && env.ALLOW_APP_DATABASE !== "1") {
    return `Refusing to start against the app database "${APP_DATABASE}". ` +
      "Use prava_dev locally, or set ALLOW_APP_DATABASE=1 for the approved deployment.";
  }
  return null;
};
