# .htpasswd Generator

Create and verify .htpasswd files with bcrypt, APR1-MD5 or SHA-1 – including ready-made Apache and nginx config, nothing is transmitted.

Try it online: https://skriptbox.com/en/tools/htpasswd-generator · Deutsch: https://skriptbox.com/de/tools/htpasswd-generator

This branch contains only the source code of this tool from [skriptbox.com](https://skriptbox.com). Every tool has its own branch,
see [main](https://github.com/Radma99/skriptbox.com) for the list. Everything runs in the browser, no data is sent to a server.

## Files

- `assets/tools/htpasswd-generator/bcrypt.js`
- `assets/tools/htpasswd-generator/digest.js`
- `assets/tools/htpasswd-generator/htpasswd-generator.scss`
- `assets/tools/htpasswd-generator/htpasswd.js`
- `assets/tools/htpasswd-generator/index.js`
- `assets/tools/htpasswd-generator/pi.js`
- `assets/tools/htpasswd-generator/worker.js`
- `templates/tools/htpasswd-generator.html.twig`: markup (Twig), extends the site layout `layout/tool.html.twig`
- `templates/macros/_form.html.twig`: form field macros used by the template
- `assets/tools/shared/`: small helpers shared by several tools

The texts are not part of this repository; the template uses translation keys such as `hp.headline`.

## Using the code

The JavaScript is plain ES modules without dependencies. On skriptbox.com it is bundled with Webpack Encore (entry
`htpasswd-generator` → `./assets/tools/htpasswd-generator/index.js`), the styles use Bootstrap 5.3 and the site's CSS variables
(`--sb-brand`, `--sb-surface`, `--sb-muted`). To reuse a tool elsewhere, take the logic module(s) as they are and adapt
the template and styles to your page.

## License

GNU General Public License v3.0 or later, see [LICENSE](LICENSE).
