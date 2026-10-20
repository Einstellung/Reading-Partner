// Handwritten GraphQL answers in the shape x.com's web page receives them
// (public field names; twitter-web-exporter, MIT, was read for the shape). No
// byte of these came from X.

export interface TweetOpts {
  id: string;
  handle?: string;
  name?: string;
  text?: string;
  /** A long post: `note_tweet` holds this whole text, `legacy.full_text` its first 275 characters and an ellipsis. */
  note?: string;
  urls?: { tco: string; url: string; display?: string; inNote?: boolean }[];
  card?: string;
  media?: boolean;
  /** An X Article; `preview` is `preview_text`, "A preview." when not given, left out when null. */
  article?: { id: string; title: string; preview?: string | null };
  quoted?: Record<string, unknown>;
  retweeted?: Record<string, unknown>;
  replyTo?: { id: string; handle: string };
  counts?: { likes?: number; reposts?: number; replies?: number; quotes?: number; bookmarks?: number; views?: string };
  /** Put the user's names under `core` (the newer shape) instead of `legacy`. */
  coreNames?: boolean;
  createdAt?: string;
}

/** One post as `tweet_results.result`. */
export function tweet(o: TweetOpts): Record<string, unknown> {
  const handle = o.handle ?? "someone";
  const name = o.name ?? "Some One";
  const urls = o.urls ?? [];
  const shortText = o.note ? `${Array.from(o.note).slice(0, 275).join("")}…` : (o.text ?? "");
  const legacyUrls = urls.filter((u) => !u.inNote).map((u) => ({ url: u.tco, expanded_url: u.url, display_url: u.display ?? u.url.replace(/^https?:\/\//, "") }));
  const user = {
    __typename: "User",
    rest_id: "42",
    ...(o.coreNames ? { core: { screen_name: handle, name } } : {}),
    legacy: o.coreNames ? { followers_count: 10 } : { screen_name: handle, name, followers_count: 10 },
  };
  const legacy: Record<string, unknown> = {
    created_at: o.createdAt ?? "Wed Oct 14 01:58:00 +0000 2026",
    full_text: shortText,
    display_text_range: [0, Array.from(shortText).length],
    entities: { urls: legacyUrls, hashtags: [], user_mentions: [], ...(o.media ? { media: [{ type: "photo" }] } : {}) },
    ...(o.media ? { extended_entities: { media: [{ type: "photo", media_url_https: "https://pbs.twimg.com/media/a.jpg" }] } } : {}),
    favorite_count: o.counts?.likes ?? 5,
    retweet_count: o.counts?.reposts ?? 2,
    reply_count: o.counts?.replies ?? 1,
    quote_count: o.counts?.quotes ?? 0,
    bookmark_count: o.counts?.bookmarks ?? 3,
    is_quote_status: !!o.quoted,
    id_str: o.id,
    ...(o.quoted ? { quoted_status_id_str: (o.quoted as { rest_id: string }).rest_id } : {}),
    ...(o.retweeted ? { retweeted_status_result: { result: o.retweeted } } : {}),
    ...(o.replyTo ? { in_reply_to_status_id_str: o.replyTo.id, in_reply_to_screen_name: o.replyTo.handle } : {}),
  };
  return {
    __typename: "Tweet",
    rest_id: o.id,
    core: { user_results: { result: user } },
    views: { count: o.counts?.views ?? "900", state: "EnabledWithCount" },
    legacy,
    ...(o.note
      ? {
          note_tweet: {
            is_expandable: true,
            note_tweet_results: {
              result: {
                id: "Tm90ZVR3ZWV0OjE=",
                text: o.note,
                entity_set: { urls: urls.filter((u) => u.inNote).map((u) => ({ url: u.tco, expanded_url: u.url, display_url: u.display ?? u.url })) },
              },
            },
          },
        }
      : {}),
    ...(o.card ? { card: { rest_id: o.card, legacy: { name: "summary_large_image", url: o.card, binding_values: [] } } } : {}),
    ...(o.article ? {
          article: {
            article_results: {
              result: {
                rest_id: o.article.id,
                title: o.article.title,
                ...(o.article.preview === null ? {} : { preview_text: o.article.preview ?? "A preview." }),
              },
            },
          },
        } : {}),
    ...(o.quoted ? { quoted_status_result: { result: o.quoted } } : {}),
  };
}

/** A timeline entry holding one post; `wrap` puts it in a TweetWithVisibilityResults. */
export function entry(result: Record<string, unknown>, wrap = false): Record<string, unknown> {
  return {
    entryId: `tweet-${result.rest_id}`,
    sortIndex: String(result.rest_id),
    content: {
      entryType: "TimelineTimelineItem",
      __typename: "TimelineTimelineItem",
      itemContent: {
        itemType: "TimelineTweet",
        __typename: "TimelineTweet",
        tweet_results: { result: wrap ? { __typename: "TweetWithVisibilityResults", tweet: { ...result, __typename: undefined } } : result },
        tweetDisplayType: "Tweet",
      },
    },
  };
}

/** A SearchTimeline answer with these entries and the two cursors. */
export function searchTimeline(entries: Record<string, unknown>[]): Record<string, unknown> {
  return {
    data: {
      search_by_raw_query: {
        search_timeline: {
          timeline: {
            instructions: [
              {
                type: "TimelineAddEntries",
                entries: [
                  ...entries,
                  { entryId: "cursor-top-1", content: { entryType: "TimelineTimelineCursor", value: "DAADDAAB", cursorType: "Top" } },
                  { entryId: "cursor-bottom-0", content: { entryType: "TimelineTimelineCursor", value: "DAADDAAC", cursorType: "Bottom" } },
                ],
              },
            ],
          },
        },
      },
    },
  };
}

/** A TweetDetail answer: the focal post and a reply under it. */
export function tweetDetail(focal: Record<string, unknown>, reply?: Record<string, unknown>): Record<string, unknown> {
  return {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [
          {
            type: "TimelineAddEntries",
            entries: [
              entry(focal),
              ...(reply
                ? [{ entryId: `conversationthread-${reply.rest_id}`, content: { entryType: "TimelineTimelineModule", items: [{ entryId: "x", item: { itemContent: { itemType: "TimelineTweet", tweet_results: { result: reply } } } }] } }]
                : []),
            ],
          },
        ],
      },
    },
  };
}
