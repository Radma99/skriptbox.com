# JWT Debugger

Decode JSON Web Tokens, verify signatures (HMAC, RSA, ECDSA, EdDSA) and create your own tokens – nothing is transmitted.

Try it online: https://skriptbox.com/en/tools/jwt-debugger · Deutsch: https://skriptbox.com/de/tools/jwt-debugger

This branch contains only the source code of this tool from [skriptbox.com](https://skriptbox.com). Every tool has its own branch,
see [main](https://github.com/Radma99/skriptbox.com) for the list. Everything runs in the browser, no data is sent to a server.

## Files

- `assets/tools/jwt-debugger/der.js`
- `assets/tools/jwt-debugger/encoding.js`
- `assets/tools/jwt-debugger/index.js`
- `assets/tools/jwt-debugger/jwt-debugger.scss`
- `assets/tools/jwt-debugger/jwt.js`
- `templates/tools/jwt-debugger.html.twig`: markup (Twig), extends the site layout `layout/tool.html.twig`
- `templates/macros/_form.html.twig`: form field macros used by the template
- `assets/tools/shared/`: small helpers shared by several tools

The texts are not part of this repository; the template uses translation keys such as `jwt.headline`.

## Using the code

The JavaScript is plain ES modules without dependencies. On skriptbox.com it is bundled with Webpack Encore (entry
`jwt-debugger` → `./assets/tools/jwt-debugger/index.js`), the styles use Bootstrap 5.3 and the site's CSS variables
(`--sb-brand`, `--sb-surface`, `--sb-muted`). To reuse a tool elsewhere, take the logic module(s) as they are and adapt
the template and styles to your page.

## License

GNU General Public License v3.0 or later, see [LICENSE](LICENSE).
