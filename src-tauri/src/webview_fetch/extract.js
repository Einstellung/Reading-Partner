// Injected into the hidden webview once a page has loaded, and again on every
// settle poll. Returns one JSON string (the completion value of the script, the
// only thing webkit_web_view_run_javascript hands back), shaped like the Readout
// struct in policy.rs.
//
// The selector list and the <p> merge are the ones the 2026-08-11 WebKitGTK
// spike ran against Bloomberg: `<article>` is what actually holds the body there
// (measured 968-1392 characters of preview text against 0 on the bot wall), the
// rest are the containers other paywalled sites were seen to use, and the <p>
// merge is the last resort for a page with no container at all. Order matters:
// the first selector that yields a real body wins, so `main` (which on a
// Bloomberg article also swallows the nav and the ticker strip) is only reached
// when nothing better matched.
//
// Nothing here decides anything: no captcha verdict, no "is this good enough".
// Those are Rust's, in policy.rs, where they are testable.
(function () {
  var MIN_BODY = 200;
  var MAX_TEXT = 200000;
  var MAX_HTML = 400000;
  var BODY_HEAD = 4000;
  var SELECTORS = [
    "article",
    '[itemprop="articleBody"]',
    '[data-component-name="body"]',
    ".article-body__content",
    '[data-component="paragraph"]',
    "div.body-copy",
    "section[data-body]",
    "main",
  ];

  function textOf(node) {
    return ((node && node.innerText) || "").trim();
  }

  function cut(s, n) {
    return s.length > n ? s.slice(0, n) : s;
  }

  try {
    var body = document.body;
    var bodyText = textOf(body);

    // Longest match per selector, in selector order.
    var best = null;
    var bestSelector = "";
    var fallback = null;
    var fallbackSelector = "";
    for (var i = 0; i < SELECTORS.length; i++) {
      var selector = SELECTORS[i];
      var longest = null;
      try {
        var nodes = document.querySelectorAll(selector);
        for (var j = 0; j < nodes.length; j++) {
          if (!longest || textOf(nodes[j]).length > textOf(longest).length) longest = nodes[j];
        }
      } catch (e) {
        continue;
      }
      if (!longest) continue;
      var length = textOf(longest).length;
      if (!fallback || length > textOf(fallback).length) {
        fallback = longest;
        fallbackSelector = selector;
      }
      if (length >= MIN_BODY) {
        best = longest;
        bestSelector = selector;
        break;
      }
    }
    if (!best && fallback) {
      best = fallback;
      bestSelector = fallbackSelector;
    }

    var text = textOf(best);
    var html = best ? best.outerHTML || "" : "";
    // Reported separately from `text` because the bot-wall check depends on it:
    // PerimeterX's page has no article container at all (measured: 0) but does
    // have four paragraphs of "you are not a robot" wording, which the <p> merge
    // below happily turns into 467 characters of "article". Only the container
    // length tells the two apart.
    var containerChars = text.length;

    // No container worth the name: merge the paragraphs. The 40-character floor
    // drops nav labels, captions and cookie-banner fragments.
    if (text.length < MIN_BODY) {
      var paragraphs = [];
      var ps = document.querySelectorAll("p");
      for (var k = 0; k < ps.length; k++) {
        var t = textOf(ps[k]);
        if (t.length > 40) paragraphs.push(t);
      }
      var merged = paragraphs.join("\n\n");
      if (merged.length > text.length) {
        text = merged;
        html = "";
        bestSelector = "p-merge";
      }
    }

    var ld = [];
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var m = 0; m < scripts.length; m++) {
      var raw = scripts[m].textContent || "";
      if (raw.length && raw.length < 200000) ld.push(raw);
    }

    return JSON.stringify({
      title: document.title || "",
      url: location.href,
      text: cut(text, MAX_TEXT),
      html: cut(html, MAX_HTML),
      containerChars: containerChars,
      selector: bestSelector,
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
      bodyHead: "extractor error: " + (err && err.message ? err.message : String(err)),
      ldJson: [],
    });
  }
})();
