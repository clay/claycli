'use strict';
const lib = require('./prefixes'),
  prefix = 'domain.com';

describe('prefixes', () => {
  describe('add', () => {
    it('handles url prefix', () => {
      return lib.add({
        '/_components/foo/instances/bar': { a: 'b' }
      }, `http://${prefix}`).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_components/foo/instances/bar': { a: 'b' }
        });
      });
    });

    it('adds prefix to _uris', () => {
      return lib.add({
        '/_uris/foo': '/_pages/bar'
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_uris/ZG9tYWluLmNvbS9mb28=': 'domain.com/_pages/bar'
        });
      });
    });

    it('adds prefix to root _uri', () => {
      return lib.add({
        '/_uris/': '/_pages/index'
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_uris/ZG9tYWluLmNvbS8=': 'domain.com/_pages/index'
        });
      });
    });

    it('adds prefix to key', () => {
      return lib.add({
        '/_components/foo/instances/bar': { a: 'b' }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_components/foo/instances/bar': { a: 'b' }
        });
      });
    });

    it('adds prefix to child components', () => {
      return lib.add({
        '/_components/foo/instances/bar': { a: { _ref: '/_components/bar/instances/baz', c: 'd' } }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_components/foo/instances/bar': { a: { _ref: 'domain.com/_components/bar/instances/baz', c: 'd' } }
        });
      });
    });

    it('adds prefix to pages', () => {
      return lib.add({
        '/_pages/abc': { main: ['/_components/foo/instances/bar'] }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_pages/abc': { main: ['domain.com/_components/foo/instances/bar'] }
        });
      });
    });

    it('adds prefix to layouts', () => {
      return lib.add({
        '/_layouts/foo/instances/bar': { a: 'b' }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_layouts/foo/instances/bar': { a: 'b' }
        });
      });
    });

    it('adds target hostname to page customUrl on import', async () => {
      // a page exported from any site has its hostname stripped, leaving a relative path
      // on import, the target hostname should be prepended to reconstruct the full url
      const exportedPage = { '/_pages/abc': { customUrl: '/some-article' } };
      const targetPrefix = `http://${prefix}`;

      const result = await lib.add(exportedPage, targetPrefix).toPromise(Promise);

      expect(result).toEqual({
        'domain.com/_pages/abc': { customUrl: 'http://domain.com/some-article' }
      });
    });

    it('adds target https hostname to page customUrl on import', async () => {
      const exportedPage = { '/_pages/abc': { customUrl: '/some-article' } };
      const targetPrefix = `https://${prefix}`;

      const result = await lib.add(exportedPage, targetPrefix).toPromise(Promise);

      expect(result).toEqual({
        'domain.com/_pages/abc': { customUrl: 'https://domain.com/some-article' }
      });
    });

    it('adds target hostname to page url on import', async () => {
      // a page exported from any site has its hostname stripped, leaving a relative path
      // on import, the target hostname should be prepended to reconstruct the full url
      const exportedPage = { '/_pages/abc': { url: '/some-article' } };
      const targetPrefix = `http://${prefix}`;

      const result = await lib.add(exportedPage, targetPrefix).toPromise(Promise);

      expect(result).toEqual({
        'domain.com/_pages/abc': { url: 'http://domain.com/some-article' }
      });
    });

    it('adds target https hostname to page url on import', async () => {
      const exportedPage = { '/_pages/abc': { url: '/some-article' } };
      const targetPrefix = `https://${prefix}`;

      const result = await lib.add(exportedPage, targetPrefix).toPromise(Promise);

      expect(result).toEqual({
        'domain.com/_pages/abc': { url: 'https://domain.com/some-article' }
      });
    });

    it('remaps both customUrl and url when both are present', async () => {
      const exportedPage = { '/_pages/abc': { customUrl: '/some-article', url: '/some-article' } };
      const targetPrefix = `http://${prefix}`;

      const result = await lib.add(exportedPage, targetPrefix).toPromise(Promise);

      expect(result).toEqual({
        'domain.com/_pages/abc': { customUrl: 'http://domain.com/some-article', url: 'http://domain.com/some-article' }
      });
    });

    it('replaces source hostname with target hostname when url already has a host', async () => {
      const exportedPage = { '/_pages/abc': { customUrl: 'http://source.com/some-article', url: 'http://source.com/some-article' } };
      const targetPrefix = `http://${prefix}`;

      const result = await lib.add(exportedPage, targetPrefix).toPromise(Promise);

      expect(result).toEqual({
        'domain.com/_pages/abc': { customUrl: 'http://domain.com/some-article', url: 'http://domain.com/some-article' }
      });
    });

    describe('absolute urls on the site', () => {
      // e.g. a bootstrap with https://domain.com/site/beauty links, imported to another environment of the site
      const targetPrefix = 'https://local.domain.com/site',
        componentKey = '/_components/nav/instances/a';

      it('moves them to the target origin, from another host of the same domain with a path inside the site', async () => {
        const component = { [componentKey]: {
          a: { url: 'https://domain.com/site/beauty' },
          b: { url: 'http://www.domain.com/site' },
          c: { url: 'https://domain.com/site?a=b' }
        } };

        const result = await lib.add(component, targetPrefix).toPromise(Promise);

        expect(result['local.domain.com/site/_components/nav/instances/a']).toEqual({
          a: { url: 'https://local.domain.com/site/beauty' },
          b: { url: 'https://local.domain.com/site' },
          c: { url: 'https://local.domain.com/site?a=b' }
        });
      });

      it('leaves other services and sites on the domain alone', async () => {
        const urls = { a: { url: 'https://pyxis.domain.com/v1/imgs/a.jpg' }, b: { url: 'https://domain.com/newsletters/' }, c: { url: 'https://domain.com/site-100/a' }, d: { url: 'https://other.com/site/beauty' } };

        const result = await lib.add({ [componentKey]: urls }, targetPrefix).toPromise(Promise);

        expect(result['local.domain.com/site/_components/nav/instances/a']).toEqual(urls);
      });

      it('moves the domain and its www for a site on the root of its host, but not its other hosts', async () => {
        const component = { [componentKey]: {
          apex: { url: 'https://domain.com/about' },
          www: { url: 'http://www.domain.com/about' },
          image: { url: 'https://pyxis.domain.com/v1/imgs/a.jpg' },
          mediakit: { url: 'http://mediakit.domain.com/' },
          elsewhere: { url: 'https://other.com/about' }
        } };

        const result = await lib.add(component, 'https://local.domain.com').toPromise(Promise);

        expect(result['local.domain.com/_components/nav/instances/a']).toEqual({
          apex: { url: 'https://local.domain.com/about' },
          www: { url: 'https://local.domain.com/about' },
          image: { url: 'https://pyxis.domain.com/v1/imgs/a.jpg' },
          mediakit: { url: 'http://mediakit.domain.com/' },
          elsewhere: { url: 'https://other.com/about' }
        });
      });

      it('keeps the query and fragment of a url on the root of the host, with no path before them', async () => {
        const component = { [componentKey]: {
            query: { url: 'https://domain.com?a=b' },
            fragment: { url: 'http://www.domain.com#top' },
            both: { url: 'https://domain.com?a=b#top' },
            other: { url: 'https://other.com?a=b' }
          } },
          page = { '/_pages/abc': { url: 'https://domain.com#top', customUrl: 'https://domain.com?a=b' } };

        const components = await lib.add(component, 'https://local.domain.com').toPromise(Promise),
          pages = await lib.add(page, 'https://local.domain.com').toPromise(Promise);

        expect(components['local.domain.com/_components/nav/instances/a']).toEqual({
          query: { url: 'https://local.domain.com?a=b' },
          fragment: { url: 'https://local.domain.com#top' },
          both: { url: 'https://local.domain.com?a=b#top' },
          other: { url: 'https://other.com?a=b' }
        });
        expect(pages['local.domain.com/_pages/abc']).toEqual({ url: 'https://local.domain.com#top', customUrl: 'https://local.domain.com?a=b' });
      });

      it('moves a site on a country domain, but not other sites on the suffix', async () => {
        const component = { [componentKey]: {
          apex: { url: 'https://example.co.uk/about' },
          www: { url: 'https://www.example.co.uk/about' },
          image: { url: 'https://pyxis.example.co.uk/a.jpg' },
          other: { url: 'https://merchant.co.uk/about' }
        } };

        const result = await lib.add(component, 'https://local.example.co.uk').toPromise(Promise);

        expect(result['local.example.co.uk/_components/nav/instances/a']).toEqual({
          apex: { url: 'https://local.example.co.uk/about' },
          www: { url: 'https://local.example.co.uk/about' },
          image: { url: 'https://pyxis.example.co.uk/a.jpg' },
          other: { url: 'https://merchant.co.uk/about' }
        });
      });

      it('ignores a trailing slash on the site prefix when telling what is on the site', async () => {
        const component = { [componentKey]: {
          mine: { url: 'https://domain.com/site/beauty' },
          lookalike: { url: 'https://domain.com/site-100/a' },
          sister: { url: 'https://domain.com/other/a' }
        } };

        const result = await lib.add(component, `${targetPrefix}/`).toPromise(Promise);

        expect(Object.values(result)[0]).toEqual({
          mine: { url: 'https://local.domain.com/site/beauty' },
          lookalike: { url: 'https://domain.com/site-100/a' },
          sister: { url: 'https://domain.com/other/a' }
        });
      });
    });

    describe('url fields that are not a path on the site', () => {
      const targetPrefix = 'https://domain.com/site';

      it('leaves absolute urls in components alone', async () => {
        const component = { '/_components/image/instances/a': {
          url: 'https://pyxis.nymag.com/v1/imgs/a.jpg',
          link: { url: 'https://www.amazon.com/dp/B000' },
          home: { url: 'https://domain.com/site/about' }
        } };

        const result = await lib.add(component, targetPrefix).toPromise(Promise);

        expect(result).toEqual({ 'domain.com/site/_components/image/instances/a': {
          url: 'https://pyxis.nymag.com/v1/imgs/a.jpg',
          link: { url: 'https://www.amazon.com/dp/B000' },
          home: { url: 'https://domain.com/site/about' }
        } });
      });

      it('only adds the site to paths on the site', async () => {
        const component = { '/_components/links/instances/a': {
          path: { url: '/about' },
          anchor: { url: '#top' },
          mail: { url: 'mailto:a@b.com' },
          cdn: { url: '//cdn.domain.com/a.jpg' },
          empty: { url: '' }
        } };

        const result = await lib.add(component, targetPrefix).toPromise(Promise);

        expect(result['domain.com/site/_components/links/instances/a']).toEqual({
          path: { url: 'https://domain.com/site/about' },
          anchor: { url: '#top' },
          mail: { url: 'mailto:a@b.com' },
          cdn: { url: '//cdn.domain.com/a.jpg' },
          empty: { url: '' }
        });
      });
    });

    it('does not mess up non-clay data', () => {
      return lib.add({
        '/_components/paragraph/instances/example': { text: 'Sanjay Srivastava <a href=\"http://pages.uoregon.edu/sanjay/bigfive.html#whatisit\" target=\"_blank\">explains on his website</a>, each' }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          'domain.com/_components/paragraph/instances/example': { text: 'Sanjay Srivastava <a href=\"http://pages.uoregon.edu/sanjay/bigfive.html#whatisit\" target=\"_blank\">explains on his website</a>, each' }
        });
      });
    });
  });

  describe('remove', () => {
    it('handles url prefix', () => {
      return lib.remove({
        'domain.com/_components/foo/instances/bar': { a: 'b' }
      }, `http://${prefix}`).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_components/foo/instances/bar': { a: 'b' }
        });
      });
    });

    it('removes prefix from key', () => {
      return lib.remove({
        'domain.com/_components/foo/instances/bar': { a: 'b' }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_components/foo/instances/bar': { a: 'b' }
        });
      });
    });

    it('removes prefix from _uris', () => {
      return lib.remove({
        'domain.com/_uris/ZG9tYWluLmNvbS9mb28=': 'domain.com/_pages/bar'
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_uris/foo': '/_pages/bar'
        });
      });
    });

    it('removes prefix from root _uri', () => {
      return lib.remove({
        'domain.com/_uris/ZG9tYWluLmNvbS8=': 'domain.com/_pages/index'
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_uris/': '/_pages/index'
        });
      });
    });

    it('removes prefix from child components', () => {
      return lib.remove({
        'domain.com/_components/foo/instances/bar': { a: { _ref: 'domain.com/_components/bar/instances/baz', c: 'd' } }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_components/foo/instances/bar': { a: { _ref: '/_components/bar/instances/baz', c: 'd' } }
        });
      });
    });

    it('removes prefix from pages', () => {
      return lib.remove({
        'domain.com/_pages/abc': { main: ['domain.com/_components/foo/instances/bar'] }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_pages/abc': { main: ['/_components/foo/instances/bar'] }
        });
      });
    });

    it('removes prefix from layouts', () => {
      return lib.remove({
        'domain.com/_layouts/foo/instances/bar': { a: 'b' }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_layouts/foo/instances/bar': { a: 'b' }
        });
      });
    });

    it('strips source hostname from page customUrl on export', async () => {
      // when exporting, the source hostname is removed from the page customUrl
      // leaving a relative path so it can be remapped on import to any target
      const sourcePage = { 'domain.com/_pages/abc': { customUrl: 'http://domain.com/some-article' } };
      const sourcePrefix = `http://${prefix}`;

      const result = await lib.remove(sourcePage, sourcePrefix).toPromise(Promise);

      expect(result).toEqual({
        '/_pages/abc': { customUrl: '/some-article' }
      });
    });

    it('strips source https hostname from page customUrl on export', async () => {
      const sourcePage = { 'domain.com/_pages/abc': { customUrl: 'https://domain.com/some-article' } };
      const sourcePrefix = `https://${prefix}`;

      const result = await lib.remove(sourcePage, sourcePrefix).toPromise(Promise);

      expect(result).toEqual({
        '/_pages/abc': { customUrl: '/some-article' }
      });
    });

    it('strips source hostname from page url on export', async () => {
      // when exporting, the source hostname is removed from the page url
      // leaving a relative path so it can be remapped on import to any target
      const sourcePage = { 'domain.com/_pages/abc': { url: 'http://domain.com/some-article' } };
      const sourcePrefix = `http://${prefix}`;

      const result = await lib.remove(sourcePage, sourcePrefix).toPromise(Promise);

      expect(result).toEqual({
        '/_pages/abc': { url: '/some-article' }
      });
    });

    it('strips source https hostname from page url on export', async () => {
      const sourcePage = { 'domain.com/_pages/abc': { url: 'https://domain.com/some-article' } };
      const sourcePrefix = `https://${prefix}`;

      const result = await lib.remove(sourcePage, sourcePrefix).toPromise(Promise);

      expect(result).toEqual({
        '/_pages/abc': { url: '/some-article' }
      });
    });

    it('strips both customUrl and url hostnames when both are present', async () => {
      const sourcePage = { 'domain.com/_pages/abc': { customUrl: 'http://domain.com/some-article', url: 'http://domain.com/some-article' } };
      const sourcePrefix = `http://${prefix}`;

      const result = await lib.remove(sourcePage, sourcePrefix).toPromise(Promise);

      expect(result).toEqual({
        '/_pages/abc': { customUrl: '/some-article', url: '/some-article' }
      });
    });

    describe('other hosts of a site under a path', () => {
      // e.g. nymag.com/strategist links in the data of stg.nymag.com/strategist
      const sitePrefix = 'https://stg.domain.com/site',
        componentKey = 'stg.domain.com/site/_components/nav/instances/a';

      it('relativizes urls on another host of the same domain with a path inside the site', async () => {
        const component = { [componentKey]: {
          a: { url: 'https://domain.com/site/gift-guides' },
          b: { url: 'http://www.domain.com/site' },
          c: { url: 'https://localhost.domain.com:3001/site/article/a.html' }
        } };

        const result = await lib.remove(component, sitePrefix).toPromise(Promise);

        expect(result).toEqual({ '/_components/nav/instances/a': {
          a: { url: '/gift-guides' },
          b: { url: '/' },
          c: { url: '/article/a.html' }
        } });
      });

      it('leaves other services and sites on the domain alone', async () => {
        const urls = {
          image: { url: 'https://pyxis-stg.domain.com/v1/imgs/a.jpg' },
          sister: { url: 'https://domain.com/other/page' },
          lookalike: { url: 'https://domain.com/site-100/a' },
          elsewhere: { url: 'https://other.com/site/gift-guides' }
        };

        const result = await lib.remove({ [componentKey]: urls }, sitePrefix).toPromise(Promise);

        expect(result).toEqual({ '/_components/nav/instances/a': urls });
      });

      it('relativizes the domain and its www for a site on the root of its host, but not its other hosts', async () => {
        const component = { 'stg.domain.com/_components/nav/instances/a': {
          apex: { url: 'https://domain.com/about' },
          www: { url: 'http://www.domain.com/about' },
          image: { url: 'https://pyxis.domain.com/v1/imgs/a.jpg' },
          mediakit: { url: 'http://mediakit.domain.com/' },
          elsewhere: { url: 'https://other.com/about' }
        } };

        const result = await lib.remove(component, 'https://stg.domain.com').toPromise(Promise);

        expect(result).toEqual({ '/_components/nav/instances/a': {
          apex: { url: '/about' },
          www: { url: '/about' },
          image: { url: 'https://pyxis.domain.com/v1/imgs/a.jpg' },
          mediakit: { url: 'http://mediakit.domain.com/' },
          elsewhere: { url: 'https://other.com/about' }
        } });
      });

      it('keeps the query and fragment of a url on the root of the host, with no path before them', async () => {
        const component = { 'stg.domain.com/_components/nav/instances/a': {
          query: { url: 'https://stg.domain.com?a=b' },
          fragment: { url: 'https://www.domain.com#top' },
          both: { url: 'http://domain.com?a=b#top' },
          other: { url: 'https://other.com?a=b' }
        } };

        const result = await lib.remove(component, 'https://stg.domain.com').toPromise(Promise);

        expect(result).toEqual({ '/_components/nav/instances/a': {
          query: { url: '/?a=b' },
          fragment: { url: '/#top' },
          both: { url: '/?a=b#top' },
          other: { url: 'https://other.com?a=b' }
        } });
      });

      it('moves a link on another host of the site when imported back', async () => {
        const exported = await lib.remove({ [componentKey]: { a: { url: 'https://domain.com/site/gift-guides' } } }, sitePrefix).toPromise(Promise),
          imported = await lib.add(exported, 'https://local.domain.com/site').toPromise(Promise);

        expect(imported).toEqual({ 'local.domain.com/site/_components/nav/instances/a': { a: { url: 'https://local.domain.com/site/gift-guides' } } });
      });
    });

    describe('urls on other hosts', () => {
      // external links, images and other sites are not the exported site's to move
      const sitePrefix = 'https://domain.com/site';

      it('leaves them alone in components', async () => {
        const component = { 'domain.com/site/_components/image/instances/a': {
          url: 'https://pyxis.nymag.com/v1/imgs/a.jpg',
          link: { url: 'http://www.amazon.com/dp/B000?tag=a' },
          mine: { url: 'https://domain.com/site/about' }
        } };

        const result = await lib.remove(component, sitePrefix).toPromise(Promise);

        expect(result).toEqual({ '/_components/image/instances/a': {
          url: 'https://pyxis.nymag.com/v1/imgs/a.jpg',
          link: { url: 'http://www.amazon.com/dp/B000?tag=a' },
          mine: { url: '/about' }
        } });
      });

      it('leaves them alone on pages', async () => {
        const page = { 'domain.com/site/_pages/abc': { url: 'https://other.com/site/foo.html' } };

        const result = await lib.remove(page, sitePrefix).toPromise(Promise);

        expect(result).toEqual({ '/_pages/abc': { url: 'https://other.com/site/foo.html' } });
      });

      it('leaves paths and values that are not links to a host alone', async () => {
        const urls = { path: { url: '/about' }, anchor: { url: '#top' }, mail: { url: 'mailto:a@b.com' }, cdn: { url: '//cdn.domain.com/a.jpg' }, empty: { url: '' } },
          result = await lib.remove({ 'domain.com/site/_components/links/instances/a': urls }, sitePrefix).toPromise(Promise);

        expect(result).toEqual({ '/_components/links/instances/a': urls });
      });

      it('compares hosts without caring about case or protocol', async () => {
        const page = { 'domain.com/site/_pages/abc': { url: 'http://DOMAIN.com/site/foo.html' } };

        const result = await lib.remove(page, sitePrefix).toPromise(Promise);

        expect(result).toEqual({ '/_pages/abc': { url: '/foo.html' } });
      });

      it('does not move them when imported back', async () => {
        const component = { 'domain.com/site/_components/image/instances/a': { url: 'https://pyxis.nymag.com/v1/imgs/a.jpg' } },
          exported = await lib.remove(component, sitePrefix).toPromise(Promise),
          imported = await lib.add(exported, 'https://other.com/site').toPromise(Promise);

        expect(imported).toEqual({ 'other.com/site/_components/image/instances/a': { url: 'https://pyxis.nymag.com/v1/imgs/a.jpg' } });
      });
    });

    describe('site with a path', () => {
      // e.g. https://nymag.com/strategist: the site's path belongs to the prefix, not to the page
      const sitePrefix = 'https://nymag.com/strategist',
        pageKey = 'nymag.com/strategist/_pages/abc';

      it('strips the site path from page url and customUrl on export', async () => {
        const sourcePage = { [pageKey]: { customUrl: `${sitePrefix}/article/the-strategist-100.html`, url: `${sitePrefix}/article/the-strategist-100.html` } };

        const result = await lib.remove(sourcePage, sitePrefix).toPromise(Promise);

        expect(result).toEqual({
          '/_pages/abc': { customUrl: '/article/the-strategist-100.html', url: '/article/the-strategist-100.html' }
        });
      });

      it('strips the site path from url fields nested in component data', async () => {
        // the strategist nav: any "url" key is rewritten, not only a page's
        const sourceComponent = { 'nymag.com/strategist/_components/categories-sub-navigation/instances/main': {
          categories: [{ url: `${sitePrefix}/gift-guides` }],
          trendingCategories: [{ url: `${sitePrefix}/article/the-strategist-100.html` }]
        } };

        const result = await lib.remove(sourceComponent, sitePrefix).toPromise(Promise);

        expect(result).toEqual({
          '/_components/categories-sub-navigation/instances/main': {
            categories: [{ url: '/gift-guides' }],
            trendingCategories: [{ url: '/article/the-strategist-100.html' }]
          }
        });
      });

      it('strips the site path from an http url when the prefix is https', async () => {
        const sourcePage = { [pageKey]: { url: 'http://nymag.com/strategist/article/the-strategist-100.html' } };

        const result = await lib.remove(sourcePage, sitePrefix).toPromise(Promise);

        expect(result).toEqual({
          '/_pages/abc': { url: '/article/the-strategist-100.html' }
        });
      });

      it('strips the site path when the prefix has no protocol', async () => {
        const sourcePage = { [pageKey]: { url: `${sitePrefix}/article/the-strategist-100.html` } };

        const result = await lib.remove(sourcePage, 'nymag.com/strategist').toPromise(Promise);

        expect(result).toEqual({
          '/_pages/abc': { url: '/article/the-strategist-100.html' }
        });
      });

      it('keeps the query string and fragment after the site path', async () => {
        const sourcePage = { [pageKey]: { url: `${sitePrefix}?a=b`, customUrl: `${sitePrefix}/article/foo.html#bar` } };

        const result = await lib.remove(sourcePage, sitePrefix).toPromise(Promise);

        expect(result).toEqual({
          '/_pages/abc': { url: '/?a=b', customUrl: '/article/foo.html#bar' }
        });
      });

      it('strips the site root url to /, which is the site itself and not no path', async () => {
        const sourcePage = { [pageKey]: { url: sitePrefix, customUrl: `${sitePrefix}/` } };

        const result = await lib.remove(sourcePage, sitePrefix).toPromise(Promise);

        expect(result).toEqual({
          '/_pages/abc': { url: '/', customUrl: '/' }
        });
      });

      it('leaves a lookalike path on the same host alone', async () => {
        const sourcePage = { [pageKey]: { url: 'https://nymag.com/strategist-100/foo.html' } };

        const result = await lib.remove(sourcePage, sitePrefix).toPromise(Promise);

        expect(result).toEqual({
          '/_pages/abc': { url: 'https://nymag.com/strategist-100/foo.html' }
        });
      });

      it('leaves sister sites and the network root on the same host alone', async () => {
        // /strategist/intelligencer/article/foo.html does not exist: a link to the sister site must not move into the site
        const urls = {
            sister: { url: 'https://nymag.com/intelligencer/article/foo.html' },
            http: { url: 'http://nymag.com/intelligencer/' },
            root: { url: 'https://nymag.com/' },
            bare: { url: 'https://nymag.com' }
          },
          result = await lib.remove({ 'nymag.com/strategist/_components/nav/instances/a': urls }, sitePrefix).toPromise(Promise);

        expect(result).toEqual({ '/_components/nav/instances/a': urls });
      });

      it('leaves sister sites on the same host alone on the staging host too', async () => {
        const urls = { sister: { url: 'https://stg.nymag.com/intelligencer/article/foo.html' } },
          result = await lib.remove({ 'stg.nymag.com/strategist/_components/nav/instances/a': urls }, 'https://stg.nymag.com/strategist').toPromise(Promise);

        expect(result).toEqual({ '/_components/nav/instances/a': urls });
      });

      it('leaves the url alone on a site without a path', async () => {
        const sourcePage = { 'domain.com/_pages/abc': { url: 'https://domain.com/strategist/foo.html' } };

        const result = await lib.remove(sourcePage, `https://${prefix}`).toPromise(Promise);

        expect(result).toEqual({
          '/_pages/abc': { url: '/strategist/foo.html' }
        });
      });
    });

    describe('sites on a country domain', () => {
      // co.uk and com.au sit one level lower: the domain is the name above the suffix, so other sites on the suffix are other sites
      it('leaves other sites on the suffix alone, for a site under a path', async () => {
        const urls = { a: { url: 'https://merchant.co.uk/blog/x' }, b: { url: 'http://other.com.au/blog/x' } },
          result = await lib.remove({ 'publisher.co.uk/blog/_components/nav/instances/a': urls }, 'https://publisher.co.uk/blog').toPromise(Promise);

        expect(result).toEqual({ '/_components/nav/instances/a': urls });
      });

      it('relativizes another host of a site under a path', async () => {
        const component = { 'stg.example.com.au/news/_components/nav/instances/a': {
            www: { url: 'https://www.example.com.au/news/a' },
            other: { url: 'https://example.net.au/news/a' }
          } },
          result = await lib.remove(component, 'https://stg.example.com.au/news').toPromise(Promise);

        expect(result).toEqual({ '/_components/nav/instances/a': {
          www: { url: '/a' },
          other: { url: 'https://example.net.au/news/a' }
        } });
      });

      it('relativizes the domain and its www for a site on the root of its host, but not its other hosts', async () => {
        const component = { 'local.example.co.uk/_components/nav/instances/a': {
            apex: { url: 'https://example.co.uk/about' },
            www: { url: 'https://www.example.co.uk/about' },
            image: { url: 'https://pyxis.example.co.uk/a.jpg' },
            other: { url: 'https://merchant.co.uk/about' }
          } },
          result = await lib.remove(component, 'https://local.example.co.uk').toPromise(Promise);

        expect(result).toEqual({ '/_components/nav/instances/a': {
          apex: { url: '/about' },
          www: { url: '/about' },
          image: { url: 'https://pyxis.example.co.uk/a.jpg' },
          other: { url: 'https://merchant.co.uk/about' }
        } });
      });
    });

    describe('sites on an ip address', () => {
      it('does not count another address as the same domain', async () => {
        const component = { '192.168.0.1/site/_components/nav/instances/a': {
            otherPort: { url: 'http://192.168.0.1:3002/site/x' },
            otherAddress: { url: 'http://10.0.0.1/site/x' }
          } },
          result = await lib.remove(component, 'http://192.168.0.1/site').toPromise(Promise);

        expect(result).toEqual({ '/_components/nav/instances/a': {
          otherPort: { url: '/x' },
          otherAddress: { url: 'http://10.0.0.1/site/x' }
        } });
      });
    });

    it('does not mess up non-clay data', () => {
      return lib.remove({
        'domain.com/_components/paragraph/instances/example': { text: 'Sanjay Srivastava <a href=\"http://pages.uoregon.edu/sanjay/bigfive.html#whatisit\" target=\"_blank\">explains on his website</a>, each' }
      }, prefix).toPromise(Promise).then((res) => {
        expect(res).toEqual({
          '/_components/paragraph/instances/example': { text: 'Sanjay Srivastava <a href=\"http://pages.uoregon.edu/sanjay/bigfive.html#whatisit\" target=\"_blank\">explains on his website</a>, each' }
        });
      });
    });
  });

  describe('remove then add', () => {
    // exporting a site and importing it back must give the same urls, wherever the site lives
    it('does not repeat the site path in page urls', async () => {
      const sitePrefix = 'https://nymag.com/strategist',
        page = { 'nymag.com/strategist/_pages/abc': { customUrl: `${sitePrefix}/article/the-strategist-100.html`, url: `${sitePrefix}/article/the-strategist-100.html` } },
        exported = await lib.remove(page, sitePrefix).toPromise(Promise),
        imported = await lib.add(exported, sitePrefix).toPromise(Promise);

      expect(imported).toEqual(page);
    });

    it('does not repeat the site path in component url fields', async () => {
      const sitePrefix = 'https://nymag.com/strategist',
        component = { 'nymag.com/strategist/_components/categories-sub-navigation/instances/main': {
          categories: [{ url: `${sitePrefix}/gift-guides` }],
          trendingCategories: [{ url: `${sitePrefix}/article/the-strategist-100.html` }]
        } },
        exported = await lib.remove(component, sitePrefix).toPromise(Promise),
        imported = await lib.add(exported, sitePrefix).toPromise(Promise);

      expect(imported).toEqual(component);
    });

    it('moves the page urls to another host with the same site path', async () => {
      const exported = await lib.remove({ 'nymag.com/strategist/_pages/abc': { url: 'https://nymag.com/strategist/article/foo.html' } }, 'https://nymag.com/strategist').toPromise(Promise),
        imported = await lib.add(exported, 'https://stg.nymag.com/strategist').toPromise(Promise);

      expect(imported).toEqual({
        'stg.nymag.com/strategist/_pages/abc': { url: 'https://stg.nymag.com/strategist/article/foo.html' }
      });
    });

    it('keeps a link to a sister site on the same host as it is, and moves the links to the site', async () => {
      const component = { 'nymag.com/strategist/_components/nav/instances/a': {
          sister: { url: 'https://nymag.com/intelligencer/article/foo.html' },
          network: { url: 'https://nymag.com/' },
          own: { url: 'https://nymag.com/strategist/gift-guides' }
        } },
        exported = await lib.remove(component, 'https://nymag.com/strategist').toPromise(Promise),
        imported = await lib.add(exported, 'https://branch.dev.nymag.com/strategist').toPromise(Promise);

      expect(imported).toEqual({ 'branch.dev.nymag.com/strategist/_components/nav/instances/a': {
        sister: { url: 'https://nymag.com/intelligencer/article/foo.html' },
        network: { url: 'https://nymag.com/' },
        own: { url: 'https://branch.dev.nymag.com/strategist/gift-guides' }
      } });
    });

    it('keeps the site root, with or without a query or fragment, on the site', async () => {
      const sitePrefix = 'https://nymag.com/strategist',
        component = { 'nymag.com/strategist/_components/nav/instances/a': {
          root: { url: sitePrefix },
          slash: { url: `${sitePrefix}/` },
          query: { url: `${sitePrefix}?a=b` },
          fragment: { url: `${sitePrefix}#top` }
        } },
        exported = await lib.remove(component, sitePrefix).toPromise(Promise),
        imported = await lib.add(exported, sitePrefix).toPromise(Promise);

      expect(imported).toEqual({ 'nymag.com/strategist/_components/nav/instances/a': {
        root: { url: `${sitePrefix}/` },
        slash: { url: `${sitePrefix}/` },
        query: { url: `${sitePrefix}/?a=b` },
        fragment: { url: `${sitePrefix}/#top` }
      } });
    });

    it('keeps the home link of a site on the root of its host', async () => {
      const exported = await lib.remove({ 'www.domain.com/_components/nav/instances/a': { home: { url: 'https://www.domain.com' } } }, 'https://www.domain.com').toPromise(Promise),
        imported = await lib.add(exported, 'https://local.domain.com').toPromise(Promise);

      expect(imported).toEqual({ 'local.domain.com/_components/nav/instances/a': { home: { url: 'https://local.domain.com/' } } });
    });

    it('keeps the query and fragment on the home link of a site on the root of its host', async () => {
      const component = { 'www.domain.com/_components/nav/instances/a': {
          query: { url: 'https://www.domain.com?a=b' },
          fragment: { url: 'https://www.domain.com#top' }
        } },
        exported = await lib.remove(component, 'https://www.domain.com').toPromise(Promise),
        imported = await lib.add(exported, 'https://local.domain.com').toPromise(Promise);

      expect(imported).toEqual({ 'local.domain.com/_components/nav/instances/a': {
        query: { url: 'https://local.domain.com/?a=b' },
        fragment: { url: 'https://local.domain.com/#top' }
      } });
    });
  });

  describe('getFromUrl', () => {
    it('throws error when not given an api route', () => {
      expect(() => lib.getFromUrl('domain.com/foo')).toThrow('Unable to find site prefix for domain.com/foo');
    });

    it('gets prefix for components', () => {
      expect(lib.getFromUrl('domain.com/_components/foo')).toBe('domain.com');
      expect(lib.getFromUrl('domain.com/somepath/_components/foo')).toBe('domain.com/somepath');
    });

    it('gets prefix for pages', () => {
      expect(lib.getFromUrl('domain.com/_pages/foo')).toBe('domain.com');
      expect(lib.getFromUrl('domain.com/somepath/_pages/foo')).toBe('domain.com/somepath');
    });

    it('gets prefix for layouts', () => {
      expect(lib.getFromUrl('domain.com/_layouts/foo')).toBe('domain.com');
      expect(lib.getFromUrl('domain.com/somepath/_layouts/foo')).toBe('domain.com/somepath');
    });

    it('gets prefix for users', () => {
      expect(lib.getFromUrl('domain.com/_users/foo')).toBe('domain.com');
      expect(lib.getFromUrl('domain.com/somepath/_users/foo')).toBe('domain.com/somepath');
    });

    it('gets prefix for uris', () => {
      expect(lib.getFromUrl('domain.com/_uris/foo')).toBe('domain.com');
      expect(lib.getFromUrl('domain.com/somepath/_uris/foo')).toBe('domain.com/somepath');
    });

    it('gets prefix for lists', () => {
      expect(lib.getFromUrl('domain.com/_lists/foo')).toBe('domain.com');
      expect(lib.getFromUrl('domain.com/somepath/_lists/foo')).toBe('domain.com/somepath');
    });
  });

  describe('uriToUrl', () => {
    it('converts component uri', () => {
      expect(lib.uriToUrl('http://domain.com', 'domain.com/_components/foo/instances/bar')).toBe('http://domain.com/_components/foo/instances/bar');
    });

    it('converts page uri', () => {
      expect(lib.uriToUrl('http://domain.com', 'domain.com/_pages/foo')).toBe('http://domain.com/_pages/foo');
    });

    it('converts layout uri', () => {
      expect(lib.uriToUrl('http://domain.com', 'domain.com/_layouts/foo/instances/bar')).toBe('http://domain.com/_layouts/foo/instances/bar');
    });
  });

  describe('urlToUri', () => {
    it('converts component uri', () => {
      expect(lib.urlToUri('http://domain.com/_components/foo/instances/bar')).toBe('domain.com/_components/foo/instances/bar');
    });

    it('converts page uri', () => {
      expect(lib.urlToUri('http://domain.com/_pages/foo/instances/bar')).toBe('domain.com/_pages/foo/instances/bar');
    });

    it('converts layout uri', () => {
      expect(lib.urlToUri('http://domain.com/_layouts/foo/instances/bar')).toBe('domain.com/_layouts/foo/instances/bar');
    });

    it('converts bare domain', () => {
      expect(lib.urlToUri('http://domain.com')).toBe('domain.com');
    });

    it('removes extensions from path', () => {
      expect(lib.urlToUri('http://domain.com/_components/foo.json')).toBe('domain.com/_components/foo');
    });
  });

  describe('getExt', () => {
    it('returns null if no prefix', () => {
      expect(lib.getExt('http://domain.com/_components/foo')).toBe(null);
    });

    it('returns extension', () => {
      expect(lib.getExt('http://domain.com/_components/foo.html')).toBe('.html');
    });
  });
});
