// Server-specific IDs shared across the bot. Keep them here so every module
// agrees on the same channels and roles.
export const GREETING_CHANNEL_ID = "1563620140749430894";
export const TICKET_CATEGORY_ID = "1563686662402220043";
export const ACCESS_ROLE_ID = "1563677636654407841";
export const STAFF_ROLE_ID = "1563617838944751698";

// Inactivity notices: how long the ticket owner has to reply, and when they
// get a reminder before the deadline.
export const INACTIVITY_DAYS = 14;
export const INACTIVITY_REMINDER_DAYS = 3;

// Custom IDs of the bot's buttons and forms.
export const TICKET_ONBOARDING_BUTTON_ID = "wildcard:ticket-onboarding";
export const LEGACY_ONBOARDING_BUTTON_ID = "wildcard:start-onboarding";
export const ONBOARDING_MODAL_ID = "wildcard:onboarding-form";
export const EMBED_MODAL_PREFIX = "wildcard:embed:";
