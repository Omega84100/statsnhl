// Same proxy as the Cloudflare Worker, for hosting on Netlify instead.
import { handleApi } from '../../src/nhl-proxy.js';

export default async (request) => handleApi(request, { env: { ODDS_API_KEY: Netlify.env.get("ODDS_API_KEY") } });

export const config = { path: ["/api/nhl/*", "/api/img/*", "/api/odds/*"] };
