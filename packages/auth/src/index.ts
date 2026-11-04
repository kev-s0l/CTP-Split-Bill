// Re-exports the auth/identity layer: the organizer dev stub (currentUserId from
// headers; replaced with real auth in Week 8) and the phone-session cookie (ADR-0015).
export { currentUserId } from "./current-user";
export {
  PHONE_SESSION_COOKIE, phoneSessionToken, phoneSessionCookie, clearedPhoneSessionCookie, clientIp,
} from "./phone-session";
