# Sites Worker

Contains the minimal static-hosting Worker. `index.js` returns existing assets and
falls back to the SPA entry point only for missing HTML navigation requests.

Do not add product APIs or persistent app behavior here; the desktop host owns
those concerns.
