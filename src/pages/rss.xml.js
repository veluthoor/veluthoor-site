import rss from '@astrojs/rss';
import { getCollection, render } from 'astro:content';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';

// Make root-relative URLs (e.g. /images/foo.jpg, /blog/bar/) absolute so they
// resolve inside email clients and feed readers, which have no site origin.
function absolutize(html, siteOrigin) {
  return html
    .replace(/(<(?:img|source)[^>]+src=["'])\/(?!\/)/gi, `$1${siteOrigin}/`)
    .replace(/(<a[^>]+href=["'])\/(?!\/)/gi, `$1${siteOrigin}/`);
}

export async function GET(context) {
  const siteOrigin = context.site.origin; // https://veluthoor.com

  const posts = await getCollection('blog');
  const published = posts
    .filter(p => p.data.status === 'published')
    .sort((a, b) => {
      const dateA = a.data.date ? new Date(a.data.date).getTime() : 0;
      const dateB = b.data.date ? new Date(b.data.date).getTime() : 0;
      return dateB - dateA;
    });

  const container = await AstroContainer.create();

  const items = await Promise.all(
    published.map(async post => {
      const { Content } = await render(post);
      let content = await container.renderToString(Content);

      // Lead with the feature image so it appears at the top of the email.
      if (post.data.feature_image) {
        const img = `<img src="${siteOrigin}${post.data.feature_image}" alt="${post.data.title}" style="max-width:100%;height:auto;border-radius:4px;margin-bottom:1.5rem;" />`;
        content = img + content;
      }

      return {
        title: post.data.title,
        pubDate: post.data.date ? new Date(post.data.date) : new Date(),
        description: post.data.excerpt || '',
        link: `/blog/${post.id}/`,
        content: absolutize(content, siteOrigin),
      };
    })
  );

  return rss({
    title: 'Charu Veluthoor',
    description: 'Random thoughts on life, travel, running, and everything in between.',
    site: context.site,
    items,
  });
}
