// Injected into the hidden webview once a page has loaded, and again on every
// settle poll. Returns one JSON string (the completion value of the script, the
// only thing webkit_web_view_run_javascript hands back), shaped like the Readout
// struct in policy.rs.
//
// The body is read paragraph by paragraph, not container by container. Taking
// the text of the whole `<article>` looked right and was not: measured on
// Bloomberg 2026-08-11, an article element also holds the recommendation strip,
// and one of the three test articles came back with five promoted headlines
// ("The Secret Ingredient Farmers Add to Their Dairy Cows' Diets…") sitting in
// the middle of the prose. `article p` has the same problem, because those
// headlines are paragraphs too. What separates them is the site's own body
// marker — on Bloomberg `[data-component="paragraph"]` — so the selector list
// below is ordered body-marker first and generic `p` last, and the first
// selector that adds up to a real body wins.
//
// The container scan is still here, but only for what it is good for: telling a
// bot wall from an article. The wall has no article container at all (measured:
// 0 characters) while carrying 467 characters of "click the box below" in its
// paragraphs, so `containerChars` is the field policy.rs's block check reads.
//
// Nothing here decides anything: no captcha verdict, no "is this good enough".
// Those are Rust's, in policy.rs, where they are testable.
(function () {
  var MIN_BODY = 200;
  var MAX_TEXT = 200000;
  var MAX_HTML = 400000;
  var BODY_HEAD = 4000;

  // [selector, minimum characters a node must have to count as a paragraph].
  // A site that marks its own body paragraphs needs no minimum — the marker is
  // the filter. The generic tail does: without it every nav label, caption and
  // cookie-banner fragment joins the article.
  var PARAGRAPHS = [
    ['[data-component="paragraph"]', 0],
    ['[itemprop="articleBody"] p', 0],
    ['[data-component-name="body"] p', 0],
    [".article-body__content p", 0],
    ["div.body-copy p", 0],
    ["section[data-body] p", 0],
    ["article p", 40],
    ["main p", 40],
    ["p", 40],
  ];

  // Containers, for the bot-wall signal (and as a last resort for a site that
  // puts its prose in something other than paragraphs).
  var CONTAINERS = [
    "article",
    '[itemprop="articleBody"]',
    '[data-component-name="body"]',
    ".article-body__content",
    "div.body-copy",
    "section[data-body]",
    "main",
  ];

  // An inline "Read More: <other headline>" line is the site promoting itself
  // mid-article, not a sentence of this article (measured: paragraph 4 of one
  // test article, paragraph 10 of another). Dropped, and counted, so the loss is
  // visible rather than silent.
  var PROMO = /^read\s+more\s*:/i;
  var PROMO_MAX = 200;

  // Labels that mean "you are not signed in". Read off the rendered text of
  // links and buttons, so a collapsed menu's hidden copy does not count.
  var SIGN_IN = ["sign in", "log in", "login", "sign in / register", "subscribe / sign in"];

  function textOf(node) {
    return ((node && node.innerText) || "").trim();
  }

  function cut(s, n) {
    return s.length > n ? s.slice(0, n) : s;
  }

  try {
    var body = document.body;
    var bodyText = textOf(body);

    // The longest container match. Only its length is load bearing; the markup
    // is a fallback body.
    var container = null;
    var containerSelector = "";
    for (var i = 0; i < CONTAINERS.length; i++) {
      var longest = null;
      try {
        var nodes = document.querySelectorAll(CONTAINERS[i]);
        for (var j = 0; j < nodes.length; j++) {
          if (!longest || textOf(nodes[j]).length > textOf(longest).length) longest = nodes[j];
        }
      } catch (e) {
        continue;
      }
      if (!longest) continue;
      if (!container || textOf(longest).length > textOf(container).length) {
        container = longest;
        containerSelector = CONTAINERS[i];
      }
    }
    var containerChars = container ? textOf(container).length : 0;

    // The body: the first paragraph selector that adds up to a real article.
    var text = "";
    var html = "";
    var selector = "";
    var promosDropped = 0;
    for (var k = 0; k < PARAGRAPHS.length; k++) {
      var sel = PARAGRAPHS[k][0];
      var min = PARAGRAPHS[k][1];
      var found;
      try {
        found = document.querySelectorAll(sel);
      } catch (e) {
        continue;
      }
      var texts = [];
      var markup = [];
      var dropped = 0;
      for (var m = 0; m < found.length; m++) {
        var t = textOf(found[m]);
        if (t.length <= min) continue;
        if (t.length <= PROMO_MAX && PROMO.test(t)) {
          dropped++;
          continue;
        }
        texts.push(t);
        markup.push(found[m].outerHTML || "");
      }
      var joined = texts.join("\n\n");
      if (joined.length >= MIN_BODY) {
        text = joined;
        html = markup.join("\n");
        selector = sel;
        promosDropped = dropped;
        break;
      }
    }

    // No paragraphs worth the name: fall back to the container's own text.
    if (!text && container) {
      text = textOf(container);
      html = container.outerHTML || "";
      selector = containerSelector;
    }

    var ld = [];
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var n = 0; n < scripts.length; n++) {
      var raw = scripts[n].textContent || "";
      if (raw.length && raw.length < 200000) ld.push(raw);
    }

    // Whether the page still offers a way to sign in. textContent first because
    // it costs nothing; innerText only on the few short candidates, because it
    // is the one that ignores what is not actually on screen.
    var seesSignIn = false;
    var clickable = document.querySelectorAll("a,button,[role=button]");
    for (var q = 0; q < clickable.length && !seesSignIn; q++) {
      var raw2 = (clickable[q].textContent || "").trim();
      if (!raw2.length || raw2.length > 40) continue;
      var label = textOf(clickable[q]).toLowerCase().replace(/\s+/g, " ");
      if (SIGN_IN.indexOf(label) >= 0) seesSignIn = true;
    }

    return JSON.stringify({
      title: document.title || "",
      url: location.href,
      text: cut(text, MAX_TEXT),
      html: cut(html, MAX_HTML),
      containerChars: containerChars,
      selector: selector,
      promosDropped: promosDropped,
      seesSignIn: seesSignIn,
      bodyHead: cut(bodyText, BODY_HEAD),
      ldJson: ld,
    });
  } catch (err) {
    return JSON.stringify({
      title: (document && document.title) || "",
      url: location.href,
      text: "",
      html: "",
      containerChars: 0,
      selector: "",
      promosDropped: 0,
      seesSignIn: false,
      bodyHead: "extractor error: " + (err && err.message ? err.message : String(err)),
      ldJson: [],
    });
  }
})();
