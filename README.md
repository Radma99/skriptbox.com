# Favicon Generator

Create favicons from a logo or a letter – with favicon.ico, SVG, Apple and Android icons and HTML code as a ZIP.

Try it online: https://skriptbox.com/en/tools/favicon-generator · Deutsch: https://skriptbox.com/de/tools/favicon-generator

This branch contains only the source code of this tool from [skriptbox.com](https://skriptbox.com). Every tool has its own branch,
see [main](https://github.com/Radma99/skriptbox.com) for the list. Everything runs in the browser, no data is sent to a server.

## Files

- `assets/tools/favicon-generator/favicon-generator.scss`
- `assets/tools/favicon-generator/ico.js`
- `assets/tools/favicon-generator/index.js`
- `assets/tools/favicon-generator/render.js`
- `templates/tools/favicon-generator.html.twig`: markup (Twig), extends the site layout `layout/tool.html.twig`
- `templates/macros/_form.html.twig`: form field macros used by the template
- `assets/tools/shared/`: small helpers shared by several tools

The texts are not part of this repository; the template uses translation keys such as `fg.headline`.

## Using the code

The JavaScript is plain ES modules without dependencies. On skriptbox.com it is bundled with Webpack Encore (entry
`favicon-generator` → `./assets/tools/favicon-generator/index.js`), the styles use Bootstrap 5.3 and the site's CSS variables
(`--sb-brand`, `--sb-surface`, `--sb-muted`). To reuse a tool elsewhere, take the logic module(s) as they are and adapt
the template and styles to your page.

## License

GNU General Public License v3.0 or later, see [LICENSE](LICENSE).
