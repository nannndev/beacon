import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Beacon',
  description: 'Modern API Workspace for Collections, Testing & Load Testing',
  base: '/docs/',
  cleanUrls: true,
  lastUpdated: true,

  // Intentional links the build shouldn't fail on: local dev URLs used in
  // instructions, and a pointer to a backend source file outside docs/.
  ignoreDeadLinks: [
    /^https?:\/\/localhost/,
    './../../core/tester.py',
  ],

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }]
  ],

  themeConfig: {
    logo: '/logo.png',

    search: {
      provider: 'local'
    },

    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Features', link: '/features/folders' },
      { text: 'Desktop', link: '/desktop' },
      { text: 'Changelog', link: '/changelog' },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/introduction' },
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Installation', link: '/installation' },
        ]
      },
      {
        text: 'Core Concepts',
        items: [
          { text: 'Projects & Environments', link: '/concepts/projects' },
          { text: 'Folders & Organization', link: '/features/folders' },
          { text: 'Variables & Templating', link: '/features/variables' },
        ]
      },
      {
        text: 'Features',
        items: [
          { text: 'Postman Import', link: '/features/postman-import' },
          { text: 'Live Monitoring & Load Testing', link: '/features/monitoring' },
          { text: 'Rate Limit Testing', link: '/features/rate-limit' },
          { text: 'Chained Auth (Extractors)', link: '/features/chaining' },
        ]
      },
      {
        text: 'Desktop',
        items: [
          { text: 'Desktop App', link: '/desktop' },
          { text: 'Building from Source', link: '/desktop/build' },
        ]
      },
      {
        text: 'Reference',
        items: [
          { text: 'MCP Server', link: '/mcp' },
          { text: 'Deployment & Server Spec', link: '/deployment' },
          { text: 'Changelog', link: '/changelog' },
          { text: 'Development', link: '/development' },
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/nannndev/beacon' }
    ],

    editLink: {
      pattern: 'https://github.com/nannndev/beacon/edit/main/docs/:path'
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Beacon Contributors'
    }
  }
})
