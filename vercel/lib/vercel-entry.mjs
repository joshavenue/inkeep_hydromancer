import { createPreviewProxy } from './preview-proxy.mjs';

// Environment is read only by the server function, never by the static build.
// No cookie/session cache: each invocation uses only this visitor's cookie.
export default {
  fetch(request) {
    return createPreviewProxy({
      PREVIEW_UPSTREAM_ROOT: process.env.PREVIEW_UPSTREAM_ROOT,
      PREVIEW_INVITE_TOKEN: process.env.PREVIEW_INVITE_TOKEN,
      PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN,
      APP_ID: process.env.APP_ID,
    })(request);
  },
};
