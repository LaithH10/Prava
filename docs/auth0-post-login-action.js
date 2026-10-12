/**
 * Auth0 Action, trigger: Login / Post Login. Name: "Add Prava email claims".
 *
 * Adds the user's email and verification status to the ACCESS token, so the Prava
 * API can require a verified email for writes. Identity on the API side is always
 * the token's `sub`; these claims are profile data only.
 *
 * Paste this into Auth0 Dashboard → Actions → Library → Create Action → Build from
 * scratch, then Deploy, then add it to Actions → Triggers → post-login.
 */
exports.onExecutePostLogin = async (event, api) => {
  const namespace = "https://prava/";

  // Only for tokens issued to the Prava API.
  if (event.resource_server?.identifier !== "https://api.prava") return;

  api.accessToken.setCustomClaim(`${namespace}email`, event.user.email ?? null);
  api.accessToken.setCustomClaim(
    `${namespace}email_verified`,
    event.user.email_verified === true
  );
};
