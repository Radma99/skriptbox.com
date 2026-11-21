# Base64 Encoder & Decoder

Encode and decode text and files as Base64 – UTF-8, base64url and data URIs for CSS and HTML, with validation and preview. No upload.

Try it online: https://skriptbox.com/en/tools/base64-encoder · Deutsch: https://skriptbox.com/de/tools/base64-encoder

This branch contains only the source code of this tool from [skriptbox.com](https://skriptbox.com). Every tool has its own branch,
see [main](https://github.com/Radma99/skriptbox.com) for the list. Everything runs in the browser, no data is sent to a server.

## Files

- `assets/tools/base64-encoder/base64-encoder.scss`
- `assets/tools/base64-encoder/base64.js`
- `assets/tools/base64-encoder/index.js`
- `templates/tools/base64-encoder.html.twig`: markup (Twig), extends the site layout `layout/tool.html.twig`
- `templates/macros/_form.html.twig`: form field macros used by the template
- `assets/tools/shared/`: small helpers shared by several tools

The texts are not part of this repository; the template uses translation keys such as `b64.headline`.

## Using the code

The JavaScript is plain ES modules without dependencies. On skriptbox.com it is bundled with Webpack Encore (entry
`base64-encoder` → `./assets/tools/base64-encoder/index.js`), the styles use Bootstrap 5.3 and the site's CSS variables
(`--sb-brand`, `--sb-surface`, `--sb-muted`). To reuse a tool elsewhere, take the logic module(s) as they are and adapt
the template and styles to your page.

## License

GNU General Public License v3.0 or later, see [LICENSE](LICENSE).
