/**
 * What this costs and where to buy it — in one place.
 *
 * The price is now quoted in three surfaces (the settings pane, the upsell
 * inside the invoice preview, and the README). Three literals would drift the
 * first time the price moved, and a plugin that quotes two different prices to
 * the same person has a credibility problem rather than a copy problem.
 */

/** The one-time price, as it is written for a human. */
export const PREMIUM_PRICE = "$29";

/** The whole offer in one line. Used verbatim wherever the sale is asked for. */
export const PREMIUM_TERMS = "$29 one-time, offline key, no account, no subscription.";

/**
 * Checkout. Also the default for `settings.purchaseUrl`, which is what the
 * UI actually links to, so a user who edits it is still honoured.
 */
export const PURCHASE_URL = "https://buymeacoffee.com/vaultspotlight/e/560212";
