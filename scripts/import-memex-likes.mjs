#!/usr/bin/env node
// One-off migration: import a legacy "memex" favorited_tweets export (NDJSON) as
// birdclaw likes. Standalone — uses only Node built-ins (node:sqlite) and writes
// directly to ~/.birdclaw/birdclaw.sqlite. Not wired into the CLI.
//
// Usage:
//   node --experimental-sqlite scripts/import-memex-likes.mjs <ndjson> [options]
// Options:
//   --account <handle>   Target account (default: primary / acct_primary)
//   --db <path>          Override DB path (default: $BIRDCLAW_HOME|~/.birdclaw/birdclaw.sqlite)
//   --source <name>      tweet_collections.source tag (default: memex)
//   --limit <n>          Only process the first n lines (testing)
//   --batch <n>          Rows per transaction (default: 1000)
//   --json               Print the summary as JSON
//
// Each NDJSON line is: { tweet_id, tweet_json (full v1.1 tweet object), username,
// tweet_user_id, liked_at, favorite_deleted, favorite_deleted_at }.

import { DatabaseSync } from "node:sqlite";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Normalizers — copied verbatim from birdclaw so entities_json / media_json are
// byte-identical to what the app produces (src/lib/archive-import.ts,
// src/lib/url-safety.ts, src/lib/x-profile.ts).
// ---------------------------------------------------------------------------
function safeHttpUrl(value) {
	if (!value) return null;
	try {
		const parsed = new URL(value);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
		return parsed.toString();
	} catch {
		return null;
	}
}

function parseTwitterDate(value) {
	if (typeof value !== "string" || value.length === 0) {
		return new Date(0).toISOString();
	}
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime())
		? new Date(0).toISOString()
		: parsed.toISOString();
}

function asRecord(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function toInt(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function toFiniteNumber(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : undefined;
}

function archiveHttpUrl(value) {
	return safeHttpUrl(typeof value === "string" ? value : String(value ?? ""));
}

function randomAvatarHue(input) {
	return input.split("").reduce((sum, c) => sum + c.charCodeAt(0), 0) % 360;
}

function getTweetMediaCount(tweet) {
	const entities = asRecord(tweet.entities);
	const extendedEntities = asRecord(tweet.extended_entities);
	const entitiesMedia = asArray(entities?.media);
	const extendedMedia = asArray(extendedEntities?.media);
	return Math.max(entitiesMedia.length, extendedMedia.length);
}

function extractTweetEntities(tweet) {
	const entities = asRecord(tweet.entities);
	const urlEntries = [
		...asArray(entities?.urls),
		...asArray(entities?.media),
	];
	const seenUrls = new Set();
	const urls = urlEntries
		.map((entry) => ({
			url: archiveHttpUrl(entry.url) ?? "",
			expandedUrl:
				archiveHttpUrl(entry.expanded_url ?? entry.expandedUrl ?? entry.url) ?? "",
			displayUrl: String(
				entry.display_url ?? entry.displayUrl ?? entry.expanded_url ?? entry.url ?? "",
			),
			start: Number(asArray(entry.indices)[0] ?? 0),
			end: Number(asArray(entry.indices)[1] ?? 0),
			title: typeof entry.title === "string" ? entry.title : undefined,
			description: typeof entry.description === "string" ? entry.description : null,
			imageUrl:
				archiveHttpUrl(
					entry.image_url ??
						entry.imageUrl ??
						entry.thumbnail_url ??
						entry.media_url_https ??
						entry.media_url,
				) ?? undefined,
			siteName:
				typeof entry.site_name === "string"
					? entry.site_name
					: typeof entry.siteName === "string"
						? entry.siteName
						: undefined,
		}))
		.filter((entry) => entry.url.length > 0 || entry.expandedUrl.length > 0)
		.filter((entry) => {
			const key = `${entry.start}:${entry.end}:${entry.url}:${entry.expandedUrl}`;
			if (seenUrls.has(key)) return false;
			seenUrls.add(key);
			return true;
		});
	const mentions = asArray(entities?.user_mentions)
		.map((entry) => ({
			username: String(entry.screen_name ?? ""),
			id: String(entry.id_str ?? entry.id ?? ""),
			start: Number(asArray(entry.indices)[0] ?? 0),
			end: Number(asArray(entry.indices)[1] ?? 0),
		}))
		.filter((entry) => entry.username.length > 0);
	const hashtags = asArray(entities?.hashtags)
		.map((entry) => ({
			tag: String(entry.text ?? ""),
			start: Number(asArray(entry.indices)[0] ?? 0),
			end: Number(asArray(entry.indices)[1] ?? 0),
		}))
		.filter((entry) => entry.tag.length > 0);

	return {
		...(urls.length > 0 ? { urls } : {}),
		...(mentions.length > 0 ? { mentions } : {}),
		...(hashtags.length > 0 ? { hashtags } : {}),
	};
}

function archiveMediaType(value) {
	const type = String(value ?? "image");
	return type === "photo"
		? "image"
		: type === "video" || type === "animated_gif"
			? type === "animated_gif"
				? "gif"
				: "video"
			: "unknown";
}

function archiveMediaSize(entry) {
	const sizes = asRecord(entry.sizes);
	const large = asRecord(sizes?.large);
	const largeWidth = toFiniteNumber(large?.w ?? large?.width);
	const largeHeight = toFiniteNumber(large?.h ?? large?.height);
	if (largeWidth !== undefined && largeHeight !== undefined) {
		return { width: largeWidth, height: largeHeight };
	}
	return Object.values(sizes ?? {})
		.map((size) => asRecord(size))
		.map((size) => ({
			width: toFiniteNumber(size?.w ?? size?.width),
			height: toFiniteNumber(size?.h ?? size?.height),
		}))
		.filter((size) => size.width !== undefined && size.height !== undefined)
		.sort((left, right) => right.width * right.height - left.width * left.height)[0];
}

function archiveMp4Variants(entry) {
	const videoInfo = asRecord(entry.video_info);
	return asArray(videoInfo?.variants)
		.filter(
			(variant) =>
				variant.content_type === "video/mp4" && typeof variant.url === "string",
		)
		.map((variant) => {
			const bitRate = toFiniteNumber(variant.bitrate ?? variant.bit_rate);
			return {
				url: String(variant.url),
				contentType: String(variant.content_type),
				...(bitRate !== undefined ? { bitRate } : {}),
			};
		})
		.sort((left, right) => Number(right.bitRate ?? 0) - Number(left.bitRate ?? 0));
}

function extractTweetMedia(tweet) {
	const extendedEntities = asRecord(tweet.extended_entities);
	const entities = asRecord(tweet.entities);
	const sourceMedia = [
		...asArray(extendedEntities?.media),
		...asArray(entities?.media),
	];
	const seen = new Set();
	return sourceMedia
		.map((entry) => {
			const url =
				archiveHttpUrl(entry.media_url_https ?? entry.media_url ?? entry.url) ?? "";
			const thumbnailUrl =
				archiveHttpUrl(entry.media_url_https ?? entry.media_url ?? url) ?? url;
			const videoInfo = asRecord(entry.video_info);
			const durationMs = toFiniteNumber(videoInfo?.duration_millis);
			const variants = archiveMp4Variants(entry);
			return {
				url,
				type: archiveMediaType(entry.type),
				altText: typeof entry.ext_alt_text === "string" ? entry.ext_alt_text : undefined,
				thumbnailUrl,
				...archiveMediaSize(entry),
				...(durationMs !== undefined ? { durationMs } : {}),
				...(variants.length > 0 ? { variants } : {}),
			};
		})
		.filter((entry) => {
			if (!entry.url || seen.has(entry.url)) return false;
			seen.add(entry.url);
			return true;
		});
}

// ---------------------------------------------------------------------------
// Build the like-edge raw_json in birdclaw's native format — the Twitter API v2
// tweet object (matches what xurl/bird likes store), synthesized from the legacy
// v1.1 object so memex likes are indistinguishable in shape from native ones.
// ---------------------------------------------------------------------------
function buildV2Entities(tweet) {
	const e = asRecord(tweet.entities) ?? {};
	const out = {};
	const hashtags = asArray(e.hashtags)
		.map((h) => ({
			start: Number(asArray(h.indices)[0] ?? 0),
			end: Number(asArray(h.indices)[1] ?? 0),
			tag: String(h.text ?? ""),
		}))
		.filter((h) => h.tag.length > 0);
	if (hashtags.length) out.hashtags = hashtags;
	const mentions = asArray(e.user_mentions)
		.map((m) => ({
			start: Number(asArray(m.indices)[0] ?? 0),
			end: Number(asArray(m.indices)[1] ?? 0),
			username: String(m.screen_name ?? ""),
			id: String(m.id_str ?? m.id ?? ""),
		}))
		.filter((m) => m.username.length > 0);
	if (mentions.length) out.mentions = mentions;
	const urls = asArray(e.urls)
		.map((u) => ({
			start: Number(asArray(u.indices)[0] ?? 0),
			end: Number(asArray(u.indices)[1] ?? 0),
			url: String(u.url ?? ""),
			expanded_url: String(u.expanded_url ?? ""),
			display_url: String(u.display_url ?? ""),
		}))
		.filter((u) => u.url.length > 0 || u.expanded_url.length > 0);
	if (urls.length) out.urls = urls;
	return out;
}

function buildLikeRawJson(tweet) {
	const t = asRecord(tweet) ?? {};
	const u = asRecord(t.user) ?? {};
	const id = String(t.id_str ?? t.id ?? "");
	const out = {
		id,
		text: String(t.full_text ?? t.text ?? ""),
		created_at: parseTwitterDate(t.created_at),
		author_id: String(u.id_str ?? u.id ?? ""),
		conversation_id: String(t.in_reply_to_status_id_str ?? id),
		edit_history_tweet_ids: [id],
		public_metrics: {
			retweet_count: toInt(t.retweet_count),
			reply_count: toInt(t.reply_count),
			like_count: toInt(t.favorite_count),
			quote_count: toInt(t.quote_count),
		},
	};
	const refs = [];
	if (t.in_reply_to_status_id_str) {
		refs.push({ type: "replied_to", id: String(t.in_reply_to_status_id_str) });
	}
	if (t.quoted_status_id_str) {
		refs.push({ type: "quoted", id: String(t.quoted_status_id_str) });
	}
	if (refs.length) out.referenced_tweets = refs;
	const entities = buildV2Entities(t);
	if (Object.keys(entities).length) out.entities = entities;
	return JSON.stringify(out);
}

// ---------------------------------------------------------------------------
// Build a birdclaw profile row from a v1.1 user object.
// ---------------------------------------------------------------------------
function buildProfile(user, fallbackHandle, fallbackExternalId) {
	const u = asRecord(user) ?? {};
	const externalId = String(u.id_str ?? u.id ?? fallbackExternalId ?? "");
	const id = `profile_user_${externalId}`;
	const handle = String(u.screen_name ?? fallbackHandle ?? externalId ?? "").trim();
	const displayName = String(u.name ?? handle ?? "");
	const bio = String(u.description ?? "");
	const followers = toInt(u.followers_count);
	const following = toInt(u.friends_count);
	const publicMetricsJson = JSON.stringify({
		followers_count: followers,
		following_count: following,
		tweet_count: toInt(u.statuses_count),
		listed_count: toInt(u.listed_count),
	});
	const avatarUrl = archiveHttpUrl(u.profile_image_url_https ?? u.profile_image_url) ?? null;
	const location = typeof u.location === "string" && u.location.length > 0 ? u.location : null;
	const urlEntities = asRecord(asRecord(u.entities)?.url);
	const expandedUrl = asArray(urlEntities?.urls)[0]?.expanded_url;
	const url = archiveHttpUrl(expandedUrl ?? u.url) ?? null;
	const verifiedType = u.verified === true ? "Legacy" : null;
	const createdAt = parseTwitterDate(u.created_at);
	return {
		id,
		handle,
		displayName,
		bio,
		followers,
		following,
		publicMetricsJson,
		avatarHue: randomAvatarHue(handle || id),
		avatarUrl,
		location,
		url,
		verifiedType,
		entitiesJson: "{}",
		rawJson: JSON.stringify(u),
		createdAt,
	};
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
	const opts = {
		file: undefined,
		account: undefined,
		db: undefined,
		source: "memex",
		limit: Infinity,
		batch: 1000,
		json: false,
		collectionsOnly: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--account") opts.account = argv[++i];
		else if (arg === "--db") opts.db = argv[++i];
		else if (arg === "--source") opts.source = argv[++i];
		else if (arg === "--limit") opts.limit = Number(argv[++i]);
		else if (arg === "--batch") opts.batch = Number(argv[++i]);
		else if (arg === "--json") opts.json = true;
		else if (arg === "--collections-only") opts.collectionsOnly = true;
		else if (!arg.startsWith("--") && opts.file === undefined) opts.file = arg;
	}
	return opts;
}

function resolveDbPath(override) {
	if (override) return override;
	const root = process.env.BIRDCLAW_HOME?.trim() || path.join(os.homedir(), ".birdclaw");
	return path.join(root, "birdclaw.sqlite");
}

function resolveAccountId(db, account) {
	if (!account) {
		const primary = db
			.prepare("select id from accounts where is_default = 1 order by created_at limit 1")
			.get();
		return primary?.id ?? "acct_primary";
	}
	const normalized = account.startsWith("@") ? account.slice(1) : account;
	const row = db
		.prepare(
			"select id from accounts where id = ? or handle = ? or handle = ? limit 1",
		)
		.get(account, normalized, `@${normalized}`);
	if (!row) {
		throw new Error(`No account matching "${account}" found in ${db.location ?? "database"}`);
	}
	return row.id;
}

// ---------------------------------------------------------------------------
// Core import — exported for the test harness.
// ---------------------------------------------------------------------------
export async function importMemexLikes(db, filePath, options = {}) {
	const source = options.source ?? "memex";
	const batchSize = options.batch ?? 1000;
	const limit = options.limit ?? Infinity;
	const accountId = resolveAccountId(db, options.account);
	const collectionsOnly = options.collectionsOnly ?? false;

	// birdclaw 0.8.5 `tweets` is normalized: no account_id/kind/liked/bookmarked.
	// A like is represented solely by a tweet_collections row (kind='likes').
	const selectProfile = db.prepare("select 1 from profiles where id = ?");
	// Insert authors only when absent — never downgrade an existing (possibly
	// live-hydrated) profile with stale archive data.
	const insertProfileNew = db.prepare(`
		insert into profiles (
			id, handle, display_name, bio, followers_count, following_count,
			public_metrics_json, avatar_hue, avatar_url, location, url, verified_type,
			entities_json, raw_json, created_at
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);
	// Fallback when a different profile id already owns this handle (UNIQUE): give
	// our id a de-duped handle so the tweet can still reference it.
	const insertProfileStub = db.prepare(`
		insert into profiles (
			id, handle, display_name, bio, avatar_hue, raw_json, created_at
		) values (?, ?, ?, ?, ?, ?, ?)
	`);
	// Mirror of birdclaw 0.8.5's tweets upsert (dist/cli/birdclaw.js) — enriches
	// without downgrading.
	const insertTweet = db.prepare(`
		insert into tweets (
			id, author_profile_id, text, created_at, is_replied, reply_to_id,
			like_count, media_count, entities_json, media_json, quoted_tweet_id
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		on conflict(id) do update set
			author_profile_id = coalesce(nullif(excluded.author_profile_id, ''), tweets.author_profile_id),
			text = coalesce(nullif(excluded.text, ''), tweets.text),
			created_at = min(tweets.created_at, excluded.created_at),
			is_replied = max(tweets.is_replied, excluded.is_replied),
			reply_to_id = coalesce(excluded.reply_to_id, tweets.reply_to_id),
			like_count = max(tweets.like_count, excluded.like_count),
			media_count = max(tweets.media_count, excluded.media_count),
			entities_json = case when excluded.entities_json not in ('', '{}', 'null') then excluded.entities_json else tweets.entities_json end,
			media_json = case when excluded.media_json not in ('', '[]', 'null') then excluded.media_json else tweets.media_json end,
			quoted_tweet_id = coalesce(excluded.quoted_tweet_id, tweets.quoted_tweet_id)
	`);
	const deleteTweetFts = db.prepare("delete from tweets_fts where tweet_id = ?");
	const insertTweetFts = db.prepare("insert into tweets_fts (tweet_id, text) values (?, ?)");
	const selectTweetFtsText = db.prepare("select text from tweets where id = ?");
	// collected_at keeps the earliest like time; source/raw_json on a pre-existing
	// non-memex row are left untouched (preserve bird/xurl/archive provenance).
	const insertCollection = db.prepare(`
		insert into tweet_collections (
			account_id, tweet_id, kind, collected_at, source, raw_json, updated_at
		) values (?, ?, 'likes', ?, ?, ?, ?)
		on conflict(account_id, tweet_id, kind) do update set
			collected_at = case
				when tweet_collections.collected_at is null then excluded.collected_at
				when excluded.collected_at is null then tweet_collections.collected_at
				else min(tweet_collections.collected_at, excluded.collected_at)
			end,
			updated_at = max(tweet_collections.updated_at, excluded.updated_at)
	`);

	const stats = {
		total: 0,
		tweets: 0,
		likes: 0,
		profiles: 0,
		handleCollisions: 0,
		skipped: 0,
	};
	const ensuredProfiles = new Set();
	const nowIso = new Date().toISOString();

	function ensureProfile(user, fallbackHandle, fallbackExternalId) {
		const profile = buildProfile(user, fallbackHandle, fallbackExternalId);
		if (ensuredProfiles.has(profile.id)) return profile.id;
		ensuredProfiles.add(profile.id);
		if (selectProfile.get(profile.id)) return profile.id; // exists — leave it untouched
		try {
			insertProfileNew.run(
				profile.id,
				profile.handle,
				profile.displayName,
				profile.bio,
				profile.followers,
				profile.following,
				profile.publicMetricsJson,
				profile.avatarHue,
				profile.avatarUrl,
				profile.location,
				profile.url,
				profile.verifiedType,
				profile.entitiesJson,
				profile.rawJson,
				profile.createdAt,
			);
			stats.profiles += 1;
		} catch {
			// handle is UNIQUE — another profile id already owns it. Guarantee our
			// id row exists with a de-duped handle so the tweet can reference it.
			const externalId = profile.id.replace(/^profile_user_/, "");
			const uniqueHandle = `${profile.handle || externalId}~${externalId}`;
			try {
				insertProfileStub.run(
					profile.id,
					uniqueHandle,
					profile.displayName || profile.handle || externalId,
					profile.bio,
					profile.avatarHue,
					profile.rawJson,
					profile.createdAt,
				);
				stats.profiles += 1;
			} catch {
				// extremely unlikely (both id and de-duped handle taken) — skip
			}
			stats.handleCollisions += 1;
		}
		return profile.id;
	}

	const rl = createInterface({
		input: createReadStream(filePath, { encoding: "utf8" }),
		crlfDelay: Infinity,
	});

	let inBatch = 0;
	db.exec("begin");
	try {
		for await (const line of rl) {
			if (stats.total >= limit) break;
			const trimmed = line.trim();
			if (!trimmed) continue;
			stats.total += 1;
			try {
				const row = JSON.parse(trimmed);
				const tweetJson = asRecord(row.tweet_json);
				if (!tweetJson) {
					stats.skipped += 1;
					continue;
				}
				const tweetId = String(row.tweet_id ?? tweetJson.id_str ?? tweetJson.id ?? "");
				if (!tweetId) {
					stats.skipped += 1;
					continue;
				}
				if (!collectionsOnly) {
					const authorProfileId = ensureProfile(
						tweetJson.user,
						row.username,
						row.tweet_user_id,
					);

					const text = String(tweetJson.full_text ?? tweetJson.text ?? "");
					const createdAt = parseTwitterDate(tweetJson.created_at);
					const replyToId = tweetJson.in_reply_to_status_id_str
						? String(tweetJson.in_reply_to_status_id_str)
						: null;
					const quotedTweetId = tweetJson.quoted_status_id_str
						? String(tweetJson.quoted_status_id_str)
						: null;
					const entitiesJson = JSON.stringify(extractTweetEntities(tweetJson));
					const mediaJson = JSON.stringify(extractTweetMedia(tweetJson));
					const mediaCount = getTweetMediaCount(tweetJson);

					insertTweet.run(
						tweetId,
						authorProfileId,
						text,
						createdAt,
						0,
						replyToId,
						toInt(tweetJson.favorite_count),
						mediaCount,
						entitiesJson,
						mediaJson,
						quotedTweetId,
					);
					stats.tweets += 1;

					const ftsText = selectTweetFtsText.get(tweetId)?.text ?? text;
					deleteTweetFts.run(tweetId);
					insertTweetFts.run(tweetId, ftsText);
				}

				// raw_json mirrors birdclaw's native like format (Twitter API v2
				// tweet object) so memex likes match xurl/bird in shape.
				insertCollection.run(
					accountId,
					tweetId,
					parseTwitterDate(row.liked_at),
					source,
					buildLikeRawJson(tweetJson),
					nowIso,
				);
				stats.likes += 1;
			} catch (error) {
				stats.skipped += 1;
				if (process.env.MEMEX_DEBUG) {
					console.error(`line ${stats.total}: ${error.message}`);
				}
			}

			if (++inBatch >= batchSize) {
				db.exec("commit");
				db.exec("begin");
				inBatch = 0;
			}
		}
		db.exec("commit");
	} catch (error) {
		try {
			db.exec("rollback");
		} catch {}
		throw error;
	}

	return { ...stats, accountId, source };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------
async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (!opts.file) {
		console.error(
			"usage: node --experimental-sqlite scripts/import-memex-likes.mjs <ndjson> [--account <handle>] [--db <path>] [--source memex] [--limit n] [--batch 1000] [--json]",
		);
		process.exit(1);
	}
	const dbPath = resolveDbPath(opts.db);
	const db = new DatabaseSync(dbPath);
	db.exec("pragma journal_mode = wal");
	db.exec("pragma synchronous = normal");
	db.exec("pragma busy_timeout = 15000");
	try {
		const result = await importMemexLikes(db, opts.file, opts);
		if (opts.json) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			console.log(
				`imported from ${opts.file} into ${dbPath}\n` +
					`  account:          ${result.accountId}\n` +
					`  source:           ${result.source}\n` +
					`  lines read:       ${result.total}\n` +
					`  tweets upserted:  ${result.tweets}\n` +
					`  likes upserted:   ${result.likes}\n` +
					`  profiles ensured: ${result.profiles}\n` +
					`  handle collisions:${result.handleCollisions}\n` +
					`  skipped:          ${result.skipped}`,
			);
		}
	} finally {
		db.close();
	}
}

// Only run main() when invoked directly (not when imported by the test).
const invokedDirectly =
	process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
