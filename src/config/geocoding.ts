// Single source of truth for the reverse-geocoding provider this app uses.
// Never hardcode the Nominatim URL or its usage-policy requirements anywhere
// else — import from here.

export const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

// Nominatim's usage policy requires a descriptive User-Agent identifying the
// application (https://operations.osmfoundation.org/policies/nominatim/).
// Browsers refuse to let JS set a custom User-Agent header, so this is only
// ever sent from the backend proxy (server/lib.ts), never straight from the
// browser.
export const NOMINATIM_USER_AGENT = 'u-flow-warehouse-ops/1.0 (internal warehouse delivery-zone lookup)';

// Nominatim's policy caps free usage at 1 request/second per IP. The backend
// throttles outbound calls to this; the frontend batch runner paces its own
// dispatches at the same interval so a page with many uncached coordinates
// doesn't fire a burst of requests the backend then has to queue up anyway.
export const GEOCODE_MIN_INTERVAL_MS = 1000;
