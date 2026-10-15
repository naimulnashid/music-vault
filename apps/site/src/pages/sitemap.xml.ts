import type { APIRoute } from 'astro';

/** The site is one page, so its sitemap is one URL. */
export const GET: APIRoute = ({ site }) => {
  const home = new URL('/', site).href;
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `  <url><loc>${home}</loc></url>\n` +
    '</urlset>\n';
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
