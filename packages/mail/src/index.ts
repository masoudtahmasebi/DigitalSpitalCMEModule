/**
 * Certificate delivery over SMTP (P8-03).
 *
 * A package rather than part of `apps/api` for the same reason `@ds/eiv-client`
 * is: it implements a capability contract from `@ds/plugin-api` and imports
 * nothing from the API, which is what makes "the delivery channel is
 * replaceable" a property rather than a claim.
 */

export { SmtpDeliveryChannel, classify, SMTP_KEYS } from "./smtp.js";
