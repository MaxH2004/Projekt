/** Server-side settings of the interface. */
export const config = {
  /** Base URL of the API, reached from the web server only. */
  apiUrl: (process.env.API_URL ?? "http://127.0.0.1:3001").replace(/\/$/, ""),
  /** Session cookie only over HTTPS unless explicitly switched off for local development. */
  cookieSecure: process.env.COOKIE_SECURE !== "false",
};
