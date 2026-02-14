import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const posts = await getCollection('blog');
  const published = posts
    .filter(p => p.data.status === 'published')
    .sort((a, b) => {
      const dateA = a.data.date ? new Date(a.data.date).getTime() : 0;
      const dateB = b.data.date ? new Date(b.data.date).getTime() : 0;
      return dateB - dateA;
    });

  return rss({
    title: 'Charu Veluthoor',
    description: 'Random thoughts on life, travel, running, and everything in between.',
    site: context.site,
    items: published.map(post => ({
      title: post.data.title,
      pubDate: post.data.date ? new Date(post.data.date) : new Date(),
      description: post.data.excerpt || '',
      link: `/blog/${post.id}/`,
    })),
  });
}
