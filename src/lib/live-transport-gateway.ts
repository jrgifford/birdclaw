import { Effect } from "effect";
import {
	getAuthenticatedBirdAccountEffect,
	listBookmarkedTweetsViaBirdEffect,
	listHomeTimelineViaBirdEffect,
	listLikedTweetsViaBirdEffect,
	listMentionsViaBirdEffect,
	searchTweetsViaBirdEffect,
} from "./bird";
import {
	listBookmarkedTweetsViaXurl,
	listHomeTimelineViaXurlEffect,
	listLikedTweetsViaXurl,
	listMentionsViaXurl,
	lookupUsersByHandles,
	searchRecentTweetsEffect,
} from "./xurl";

export interface BirdReadTransport {
	getAuthenticatedAccount: typeof getAuthenticatedBirdAccountEffect;
	listBookmarks: typeof listBookmarkedTweetsViaBirdEffect;
	listHomeTimeline: typeof listHomeTimelineViaBirdEffect;
	listLikes: typeof listLikedTweetsViaBirdEffect;
	listMentions: typeof listMentionsViaBirdEffect;
	searchTweets: typeof searchTweetsViaBirdEffect;
}

export interface XurlReadTransport {
	listBookmarks(
		...args: Parameters<typeof listBookmarkedTweetsViaXurl>
	): Effect.Effect<
		Awaited<ReturnType<typeof listBookmarkedTweetsViaXurl>>,
		Error
	>;
	listHomeTimeline: typeof listHomeTimelineViaXurlEffect;
	listLikes(
		...args: Parameters<typeof listLikedTweetsViaXurl>
	): Effect.Effect<Awaited<ReturnType<typeof listLikedTweetsViaXurl>>, Error>;
	listMentions(
		...args: Parameters<typeof listMentionsViaXurl>
	): Effect.Effect<Awaited<ReturnType<typeof listMentionsViaXurl>>, Error>;
	lookupUsersByHandles(
		...args: Parameters<typeof lookupUsersByHandles>
	): Effect.Effect<Awaited<ReturnType<typeof lookupUsersByHandles>>, Error>;
	searchRecentTweets: typeof searchRecentTweetsEffect;
}

export interface LiveTransportGateway {
	bird: BirdReadTransport;
	xurl: XurlReadTransport;
}

function fromPromise<T>(run: () => PromiseLike<T>): Effect.Effect<T, Error> {
	return Effect.tryPromise({
		try: run,
		catch: (error) =>
			error instanceof Error ? error : new Error(String(error)),
	});
}

export const liveTransportGateway: LiveTransportGateway = {
	bird: {
		getAuthenticatedAccount: () => getAuthenticatedBirdAccountEffect(),
		listBookmarks: (options) => listBookmarkedTweetsViaBirdEffect(options),
		listHomeTimeline: (options) => listHomeTimelineViaBirdEffect(options),
		listLikes: (options) => listLikedTweetsViaBirdEffect(options),
		listMentions: (options) => listMentionsViaBirdEffect(options),
		searchTweets: (query, options) => searchTweetsViaBirdEffect(query, options),
	},
	xurl: {
		listBookmarks: (...args) =>
			fromPromise(() => listBookmarkedTweetsViaXurl(...args)),
		listHomeTimeline: (options) => listHomeTimelineViaXurlEffect(options),
		listLikes: (...args) => fromPromise(() => listLikedTweetsViaXurl(...args)),
		listMentions: (...args) => fromPromise(() => listMentionsViaXurl(...args)),
		lookupUsersByHandles: (...args) =>
			fromPromise(() => lookupUsersByHandles(...args)),
		searchRecentTweets: (query, options) =>
			searchRecentTweetsEffect(query, options),
	},
};
