// Server-rendered metadata is available to link crawlers without JavaScript or a login.
const origin = 'https://www.lutapelacomunidade.com.br';
const siteName = 'Luta pela Comunidade';
const description = 'Jiu-jítsu gratuito para crianças e adolescentes em Petrópolis. Esporte, educação e oportunidade.';
const image = `${origin}/social-preview-v1.png`;
const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decode = value => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function withSocialPreview(html, pathname) {
  const privatePage = /^\/(administracao|portal|professor|psicologia|assistencia-social)(\/|$)/.test(pathname);
  const canonicalPath = pathname.replace(/index\.html$/, '');
  const canonical = origin + (canonicalPath.startsWith('/') && !canonicalPath.startsWith('//') ? canonicalPath : '/');
  const title = privatePage ? `${siteName} — Área da equipe` : decode(html.match(/<title>([^<]*)<\/title>/i)?.[1] || siteName);
  const pageDescription = privatePage ? 'Acesso da equipe ao projeto Luta pela Comunidade.' : decode(html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] || description);
  const tags = [
    `<link rel="canonical" href="${escape(canonical)}">`,
    ...Object.entries({
      'og:type': 'website', 'og:site_name': siteName, 'og:locale': 'pt_BR',
      'og:title': title, 'og:description': pageDescription, 'og:url': canonical,
      'og:image': image, 'og:image:secure_url': image, 'og:image:type': 'image/png',
      'og:image:width': '1734', 'og:image:height': '907',
      'og:image:alt': 'Luta pela Comunidade — Jiu-jitsu. Esporte, educação e oportunidade. Petrópolis, RJ.'
    }).map(([property, content]) => `<meta property="${property}" content="${escape(content)}">`),
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escape(title)}">`,
    `<meta name="twitter:description" content="${escape(pageDescription)}">`,
    `<meta name="twitter:image" content="${image}">`
  ].join('\n');
  return html.replace(/<\/head>/i, `${tags}\n</head>`);
}
