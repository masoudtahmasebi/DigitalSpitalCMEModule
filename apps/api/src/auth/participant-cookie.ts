/**
 * The name of the portal's session cookie (P25-02).
 *
 * Its own file because two things need it and neither should import the other:
 * the **guard** reads it to find a credential, and the **controller** writes and
 * clears it. A guard importing a controller would invert ADR-0006's layering and
 * create a cycle; a second string literal would be a name that can drift, which
 * presents as "sign-in works and every subsequent request is a 401".
 */
export const PARTICIPANT_COOKIE = "ds_participant";
