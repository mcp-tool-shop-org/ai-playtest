// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://mcp-tool-shop-org.github.io',
  base: '/ai-playtest',
  integrations: [
    starlight({
      title: 'ai-playtest',
      description: 'Family-diverse AI playtesting for turn-based games. Model players drive; an author-off jury judges; the report says how much they saw.',
      disable404Route: true,
      logo: {
        src: './src/assets/logo.png',
        alt: 'ai-playtest',
        href: '/ai-playtest/',
        replacesTitle: false,
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/mcp-tool-shop-org/ai-playtest' },
      ],
      sidebar: [
        {
          label: 'Handbook',
          items: [{ autogenerate: { directory: 'handbook' } }],
        },
      ],
      customCss: ['./src/styles/starlight-custom.css'],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
