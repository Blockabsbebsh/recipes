/**
 * Whether to show the loading screen while the household is being checked.
 *
 * Signed out, and before auth has answered at all, is decided before this.
 *
 * The loading screen is for a cold start, not for every time the app is
 * looked at again. Supabase hands out a new session object whenever it
 * revalidates the token — which it does when the phone brings the app back to
 * the foreground — and the household check keyed off that object, so coming
 * back from the shop for two seconds blanked the whole page and re-queried
 * over the network. On iOS that loading screen stayed up for a second and a
 * half, during which the page is 62px tall and the scroll had nowhere to go.
 *
 * A check that is only confirming what we already know is a background
 * matter. Show the loading screen when there is genuinely nothing to show.
 */
export function showsSetupSplash({ setupChecked, hasHousehold }) {
  return !setupChecked && !hasHousehold
}

/**
 * Whether to say the kitchen could not be reached, rather than offering to
 * make a new one.
 *
 * "No household" and "we could not find out" look identical once the check has
 * finished: both leave the app holding null. With the network down, the
 * membership read fails, the check finishes empty, and a household of two who
 * have been cooking from this app for months are shown `Sukurkite savo
 * virtuvę` — an invitation to create a second household on top of the one they
 * already have. Accepting it would leave them with two memberships and the app
 * picking between them arbitrarily.
 *
 * So a failed check is its own answer. Only a check that actually completed
 * and found nothing is allowed to offer the setup screen.
 */
export function showsUnreachable({ setupChecked, hasHousehold, setupFailed }) {
  return setupChecked && !hasHousehold && setupFailed
}
