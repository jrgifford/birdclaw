// Run with: node --experimental-sqlite --test scripts/import-memex-likes.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { importMemexLikes } from "./import-memex-likes.mjs";

// Minimal subset of birdclaw's schema (src/lib/db.ts) needed by the importer.
const SCHEMA = `
	create table if not exists accounts (
		id text primary key, name text, handle text unique, external_user_id text,
		transport text, is_default integer not null default 0, created_at text
	);
	create table if not exists profiles (
		id text primary key, handle text not null unique, display_name text not null,
		bio text not null, followers_count integer not null default 0,
		following_count integer not null default 0, public_metrics_json text not null default '{}',
		avatar_hue integer not null default 0, avatar_url text, location text, url text,
		verified_type text, entities_json text not null default '{}',
		raw_json text not null default '{}', created_at text not null
	);
	create table if not exists tweets (
		id text primary key, author_profile_id text not null,
		text text not null, created_at text not null,
		is_replied integer not null default 0, reply_to_id text,
		like_count integer not null default 0, media_count integer not null default 0,
		entities_json text not null default '{}', media_json text not null default '[]',
		quoted_tweet_id text
	);
	create table if not exists tweet_collections (
		account_id text not null, tweet_id text not null, kind text not null,
		collected_at text, source text not null, raw_json text not null default '{}',
		updated_at text not null, primary key (account_id, tweet_id, kind)
	);
	create virtual table if not exists tweets_fts using fts5(tweet_id unindexed, text);
`;

function freshDb() {
	const db = new DatabaseSync(":memory:");
	db.exec(SCHEMA);
	db.exec(
		"insert into accounts (id, name, handle, external_user_id, transport, is_default, created_at) " +
			"values ('acct_primary', 'jrg', '@jrgifford', '49710326', 'xurl', 1, '2024-01-01T00:00:00.000Z')",
	);
	return db;
}

function fixtureFile(lines) {
	const file = path.join(os.tmpdir(), `memex-fixture-${process.pid}-${lines.length}.ndjson`);
	writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
	return file;
}

const tweetA = {
	tweet_id: 111,
	username: "alice",
	tweet_user_id: 900,
	liked_at: "2019-03-03 21:40:58.837071",
	favorite_deleted: true,
	tweet_json: {
		id: 111,
		id_str: "111",
		full_text: "hello world from alice #rust",
		created_at: "Wed Mar 03 21:40:58 +0000 2019",
		favorite_count: 5,
		user: { id: 900, id_str: "900", screen_name: "alice", name: "Alice", description: "bio" },
		entities: { hashtags: [{ text: "rust", indices: [23, 28] }], urls: [] },
		extended_entities: {
			media: [
				{
					media_url_https: "https://pbs.twimg.com/media/a.jpg",
					type: "photo",
					url: "https://t.co/aaa",
					expanded_url: "https://twitter.com/alice/status/111/photo/1",
					indices: [29, 52],
					sizes: { large: { w: 1200, h: 800 } },
				},
			],
		},
	},
};

const tweetB = {
	tweet_id: 222,
	username: "bob",
	tweet_user_id: 901,
	liked_at: "2020-01-01 00:00:00",
	favorite_deleted: null,
	tweet_json: {
		id: 222,
		id_str: "222",
		full_text: "uniquezebraword in this tweet",
		created_at: "Wed Jan 01 00:00:00 +0000 2020",
		favorite_count: 0,
		user: { id: 901, id_str: "901", screen_name: "bob", name: "Bob" },
	},
};

// Same handle "alice" as tweetA's author but a different user id -> handle collision.
const tweetC = {
	tweet_id: 333,
	username: "alice",
	tweet_user_id: 902,
	liked_at: "2018-05-05 00:00:00",
	tweet_json: {
		id: 333,
		id_str: "333",
		full_text: "older alice account tweet",
		created_at: "Sat May 05 00:00:00 +0000 2018",
		user: { id: 902, id_str: "902", screen_name: "alice", name: "Alice Two" },
	},
};

test("imports likes with profiles, tweets, fts, and collections", async () => {
	const db = freshDb();
	const file = fixtureFile([tweetA, tweetB]);
	try {
		const r = await importMemexLikes(db, file, {});
		assert.equal(r.total, 2);
		assert.equal(r.tweets, 2);
		assert.equal(r.likes, 2);
		assert.equal(r.profiles, 2);
		assert.equal(r.accountId, "acct_primary");

		// tweet row: canonical (no account/kind/liked columns), media + entities mapped
		const t = db.prepare("select * from tweets where id = '111'").get();
		assert.equal(t.author_profile_id, "profile_user_900");
		assert.equal(t.media_count, 1);
		const media = JSON.parse(t.media_json);
		assert.equal(media.length, 1);
		assert.equal(media[0].type, "image"); // photo -> image
		assert.equal(media[0].width, 1200);
		const entities = JSON.parse(t.entities_json);
		assert.equal(entities.hashtags[0].tag, "rust");

		// profile built from v1.1 user
		const p = db.prepare("select * from profiles where id = 'profile_user_900'").get();
		assert.equal(p.handle, "alice");
		assert.equal(p.display_name, "Alice");

		// collection edge tagged source=memex with the original like time
		const c = db
			.prepare("select * from tweet_collections where tweet_id = '111' and kind = 'likes'")
			.get();
		assert.equal(c.source, "memex");
		assert.equal(c.account_id, "acct_primary");
		assert.equal(c.collected_at, new Date("2019-03-03 21:40:58.837071").toISOString());

		// raw_json is birdclaw's native v2 like shape
		const raw = JSON.parse(c.raw_json);
		assert.equal(raw.id, "111");
		assert.equal(raw.author_id, "900");
		assert.equal(raw.text, "hello world from alice #rust");
		assert.equal(raw.public_metrics.like_count, 5);
		assert.deepEqual(raw.edit_history_tweet_ids, ["111"]);
		assert.equal(raw.entities.hashtags[0].tag, "rust");

		// FTS searchable
		const hit = db
			.prepare("select tweet_id from tweets_fts where text match 'uniquezebraword'")
			.get();
		assert.equal(hit.tweet_id, "222");
	} finally {
		db.close();
		rmSync(file, { force: true });
	}
});

test("is idempotent on re-import", async () => {
	const db = freshDb();
	const file = fixtureFile([tweetA, tweetB]);
	try {
		await importMemexLikes(db, file, {});
		await importMemexLikes(db, file, {});
		assert.equal(db.prepare("select count(*) c from tweets").get().c, 2);
		assert.equal(db.prepare("select count(*) c from tweet_collections").get().c, 2);
		assert.equal(db.prepare("select count(*) c from tweets_fts").get().c, 2);
		assert.equal(db.prepare("select count(*) c from profiles").get().c, 2);
	} finally {
		db.close();
		rmSync(file, { force: true });
	}
});

test("keeps earliest collected_at and preserves existing non-memex source", async () => {
	const db = freshDb();
	// Pre-existing like from another source, with a LATER collected_at.
	db.exec(
		"insert into tweet_collections (account_id, tweet_id, kind, collected_at, source, raw_json, updated_at) " +
			"values ('acct_primary', '222', 'likes', '2021-06-01T00:00:00.000Z', 'xurl', '{\"x\":1}', '2021-06-01T00:00:00.000Z')",
	);
	const file = fixtureFile([tweetB]);
	try {
		await importMemexLikes(db, file, {});
		const c = db
			.prepare("select * from tweet_collections where tweet_id = '222' and kind = 'likes'")
			.get();
		// memex like time (2020) is earlier -> wins
		assert.equal(c.collected_at, new Date("2020-01-01 00:00:00").toISOString());
		// provenance preserved
		assert.equal(c.source, "xurl");
		assert.equal(c.raw_json, '{"x":1}');
		// the tweet itself is now present/enriched
		assert.ok(db.prepare("select 1 from tweets where id = '222'").get());
	} finally {
		db.close();
		rmSync(file, { force: true });
	}
});

test("collections-only mode rewrites like edges without touching tweets/profiles", async () => {
	const db = freshDb();
	const file = fixtureFile([tweetA, tweetB]);
	try {
		await importMemexLikes(db, file, {}); // full
		const tweetsBefore = db.prepare("select count(*) c from tweets").get().c;
		const profilesBefore = db.prepare("select count(*) c from profiles").get().c;
		db.exec("delete from tweet_collections where source = 'memex'");
		const r = await importMemexLikes(db, file, { collectionsOnly: true });
		assert.equal(r.likes, 2);
		assert.equal(r.tweets, 0); // no tweet writes in collections-only
		assert.equal(r.profiles, 0); // no profile writes
		assert.equal(db.prepare("select count(*) c from tweets").get().c, tweetsBefore);
		assert.equal(db.prepare("select count(*) c from profiles").get().c, profilesBefore);
		// like edges restored with v2 raw_json
		const c = db.prepare("select * from tweet_collections where tweet_id = '111'").get();
		assert.equal(c.source, "memex");
		assert.equal(JSON.parse(c.raw_json).author_id, "900");
	} finally {
		db.close();
		rmSync(file, { force: true });
	}
});

test("handles handle collisions without crashing", async () => {
	const db = freshDb();
	const file = fixtureFile([tweetA, tweetC]); // both screen_name 'alice', different ids
	try {
		const r = await importMemexLikes(db, file, {});
		assert.equal(r.tweets, 2);
		assert.equal(r.handleCollisions, 1);
		// both author profiles exist under distinct ids
		assert.ok(db.prepare("select 1 from profiles where id = 'profile_user_900'").get());
		const collided = db.prepare("select * from profiles where id = 'profile_user_902'").get();
		assert.ok(collided);
		assert.notEqual(collided.handle, "alice"); // de-duped handle
		// the collided tweet still references its own author profile
		assert.equal(
			db.prepare("select author_profile_id from tweets where id = '333'").get().author_profile_id,
			"profile_user_902",
		);
	} finally {
		db.close();
		rmSync(file, { force: true });
	}
});
