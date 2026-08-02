/**
 * Two passphrases, two roles. `owner` can do everything; `view` can read
 * everything and change nothing.
 *
 * Server-only — it reads the passphrases from the environment. The cookie is
 * still the whole session model; this just says which of the two it matched.
 */
export type Role = "owner" | "view" | null;

export function roleOf(cookie: string | undefined): Role {
  if (!cookie) return null;
  // A blank env var must never authenticate anyone. Missing APP_VIEW_PASSPHRASE
  // simply means view-only sharing isn't switched on.
  if (process.env.APP_PASSPHRASE && cookie === process.env.APP_PASSPHRASE) {
    return "owner";
  }
  if (process.env.APP_VIEW_PASSPHRASE && cookie === process.env.APP_VIEW_PASSPHRASE) {
    return "view";
  }
  return null;
}
