const DEFAULT_PRODUCTION_API_URL = "https://api.fuckxter.site";

const configuredApiUrl = import.meta.env.PUBLIC_FUCKXTER_API_URL?.trim();

export const FUCKXTER_API_URL = (
  configuredApiUrl || DEFAULT_PRODUCTION_API_URL
).replace(/\/+$/, "");
