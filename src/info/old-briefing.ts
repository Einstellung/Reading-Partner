// The old daily briefing's user interface (docs/35, docs/info/93): the day's
// Briefing page and its articles, the Today and phone home cards that lead there,
// the sidebar item, the briefing's chat cards and the companion tools that make
// them (generate_briefing, the lab and add-source tools), and the settings that
// only it reads.
//
// Off since 2026-10-22: the shelf of briefs (topic searches and studies) is the
// info side's document now. Nothing of the old chain is deleted — the collect,
// screen and analysis code, its files, the five-minute tick and the collector
// election all stay as they are — so turning this back on brings the whole
// surface back. Tests that cover the old surface force it on.
//
// A leaf: it imports nothing, so every directory that gates on it can.
export const OLD_BRIEFING_UI_ENABLED = false;
