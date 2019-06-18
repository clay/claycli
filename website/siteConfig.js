// See https://docusaurus.io/docs/site-config for all the possible
// site configuration options.

const repoUrl = 'https://github.com/clay/claycli',
  projectName = process.env.PROJECT_NAME || 'claycli';

// List of projects/orgs using your project for the users page.
const users = [
  {},
];

const siteConfig = {
  title: 'Clay CLI', // Title for your website.
  tagline: 'A CLI tool for Clay',
  url: 'https://clay.github.io/', // Your website URL
  baseUrl: '/claycli/', // Base URL for your project */
  // Used for publishing and more
  projectName,
  organizationName: 'Clay',

  // For no header links in the top nav bar -> headerLinks: [],
  headerLinks: [
    { href: repoUrl, label: 'GitHub'},
  ],

  // If you have users set above, you add it here:
  users,

  /* path to images for header/footer */
  headerIcon: '',
  footerIcon: '',
  favicon: '',

  /* Colors for website */
  colors: {
    primaryColor: '#607d8b',
    secondaryColor: '#1976d2',
  },

  // This copyright info is used in /core/Footer.js and blog RSS/Atom feeds.
  copyright: `Copyright © ${new Date().getFullYear()} New York Media`,

  highlight: {
    // Highlight.js theme to use for syntax highlighting in code blocks.
    theme: 'default',
  },

  // Add custom scripts here that would be placed in <script> tags.
  scripts: ['https://buttons.github.io/buttons.js'],

  // On page navigation for the current documentation page.
  onPageNav: 'separate',
  // No .html extensions for paths.
  cleanUrl: true,

  docsSideNavCollapsible: true,

  // Open Graph and Twitter card images.
  ogImage: 'img/logo.svg',
  twitterImage: 'img/logo.svg',
  algolia: {
    apiKey: process.env.ALGOLIA_API_KEY,
    indexName: 'claycli',
    algoliaOptions: {} // Optional, if provided by Algolia
  }
};

module.exports = siteConfig;
