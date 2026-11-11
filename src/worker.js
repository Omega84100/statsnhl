import { handleApi } from './nhl-proxy.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, { cache: caches.default, env });
    }
    return env.ASSETS.fetch(request);
  },
};
