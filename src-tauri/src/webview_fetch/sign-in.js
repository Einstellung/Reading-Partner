// Injected into the visible sign-in window every few seconds while the user is
// in it, and nowhere else. Returns one JSON string shaped like the SignInProbe
// struct in session.rs, which is where the deciding happens: this only reports.
//
// Deliberately not extract.js. That one joins every paragraph on the page, its
// markup and every ld+json block, which is the wrong thing to run repeatedly
// against a page somebody is typing into. This reads the labels of links and
// buttons, the length of the rendered text and where the page is — never a form
// field, never a value, nothing the user has entered.
//
// The labels are the same list extract.js reads for `seesSignIn`, because the
// question is the same one: does the site still offer a way to sign in. Kept in
// step by hand; a label added there and not here costs a title change, not a
// wrong one.
(function () {
  var SIGN_IN = ["sign in", "log in", "login", "sign in / register", "subscribe / sign in"];

  function textOf(node) {
    return ((node && node.innerText) || "").trim();
  }

  try {
    // textContent first because it costs nothing; innerText only on the few
    // short candidates, because it is the one that ignores what is not actually
    // on screen (a collapsed menu's hidden copy is not an offer to sign in).
    var seesSignIn = false;
    var clickable = document.querySelectorAll("a,button,[role=button]");
    for (var i = 0; i < clickable.length && !seesSignIn; i++) {
      var raw = (clickable[i].textContent || "").trim();
      if (!raw.length || raw.length > 40) continue;
      var label = textOf(clickable[i]).toLowerCase().replace(/\s+/g, " ");
      if (SIGN_IN.indexOf(label) >= 0) seesSignIn = true;
    }
    return JSON.stringify({
      host: location.hostname || "",
      // Which page this is, so the login page itself can be left out of the
      // judging: it is a form, and a form has no sign-in control to lose.
      path: location.pathname || "/",
      seesSignIn: seesSignIn,
      // How much text is rendered. Two jobs: a page too thin to be a page of
      // the site is not read at all, and a length that has stopped changing is
      // what says the page has finished drawing — the site's own header, the
      // thing that carries the sign-in control, arrives seconds after the first
      // paint (measured; docs/pitfall/116).
      chars: ((document.body && document.body.innerText) || "").length,
    });
  } catch (err) {
    // Nothing was read, so nothing is claimed: an empty page on no host is the
    // shape session.rs throws away.
    return JSON.stringify({ host: "", path: "/", seesSignIn: false, chars: 0 });
  }
})();
