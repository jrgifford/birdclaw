import { X } from "lucide-react";
import { useState } from "react";
import type { TweetMediaItem } from "#/lib/types";
import { cx, tweetMediaGridClass, tweetMediaTileClass } from "#/lib/ui";

export function TweetMediaGrid({ items }: { items: TweetMediaItem[] }) {
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	if (items.length === 0) {
		return null;
	}

	const visibleItems = items.slice(0, 4);
	const selectedItem =
		selectedIndex === null ? null : (visibleItems[selectedIndex] ?? null);
	const selectedVideoUrl =
		selectedItem?.type === "video" || selectedItem?.type === "gif"
			? (selectedItem.variants?.[0]?.url ?? playableVideoUrl(selectedItem.url))
			: null;
	const singleImage =
		visibleItems.length === 1 && visibleItems[0]?.type === "image"
			? visibleItems[0]
			: null;

	return (
		<>
			{singleImage ? (
				<button
					aria-label="Open tweet media 1"
					className={cx(
						"tweet-media-single mt-2 max-w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg-active)] p-0 text-left",
						singleImage.width && singleImage.height
							? "block"
							: "inline-block align-top",
					)}
					onClick={(event) => {
						event.stopPropagation();
						setSelectedIndex(0);
					}}
					style={singleImageStyle(singleImage)}
					type="button"
				>
					<img
						alt={singleImage.altText ?? "Tweet media 1"}
						className={cx(
							"tweet-media-image block max-h-[720px] max-w-full",
							singleImage.width && singleImage.height
								? "size-full object-cover"
								: "h-auto w-auto object-contain",
						)}
						height={singleImage.height}
						loading="lazy"
						src={singleImage.thumbnailUrl ?? singleImage.url}
						width={singleImage.width}
					/>
				</button>
			) : (
				<div className={tweetMediaGridClass(Math.min(items.length, 4))}>
					{visibleItems.map((item, index) => (
						<button
							key={item.url + String(index)}
							aria-label={`Open tweet media ${String(index + 1)}`}
							className={tweetMediaTileClass(index, Math.min(items.length, 4))}
							onClick={(event) => {
								event.stopPropagation();
								setSelectedIndex(index);
							}}
							style={
								visibleItems.length === 1 && item.width && item.height
									? {
											aspectRatio: `${String(item.width)} / ${String(item.height)}`,
										}
									: undefined
							}
							type="button"
						>
							{item.type === "image" ? (
								<img
									alt={item.altText ?? `Tweet media ${String(index + 1)}`}
									className="tweet-media-image block size-full object-contain"
									loading="lazy"
									src={item.thumbnailUrl ?? item.url}
								/>
							) : (
								<span className="tweet-media-fallback grid min-h-40 place-items-center font-semibold text-[var(--ink-soft)]">
									{item.type === "video"
										? "Video"
										: item.type === "gif"
											? "GIF"
											: "Media"}
								</span>
							)}
						</button>
					))}
				</div>
			)}
			{selectedItem ? (
				<div
					aria-modal="true"
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
					onClick={(event) => {
						event.stopPropagation();
						setSelectedIndex(null);
					}}
					role="dialog"
				>
					<button
						aria-label="Close media viewer"
						className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
						onClick={(event) => {
							event.stopPropagation();
							setSelectedIndex(null);
						}}
						type="button"
					>
						<X className="size-5" strokeWidth={1.8} />
					</button>
					{selectedItem.type === "image" ? (
						<img
							alt={selectedItem.altText ?? "Tweet media"}
							className="max-h-[92vh] max-w-[92vw] object-contain"
							onClick={(event) => event.stopPropagation()}
							src={selectedItem.url}
						/>
					) : selectedVideoUrl ? (
						<video
							autoPlay={selectedItem.type === "gif"}
							className="max-h-[92vh] max-w-[92vw]"
							controls
							loop={selectedItem.type === "gif"}
							muted={selectedItem.type === "gif"}
							onClick={(event) => event.stopPropagation()}
							playsInline
							poster={selectedItem.thumbnailUrl}
							src={selectedVideoUrl}
						/>
					) : (
						<div
							className="grid min-h-64 min-w-80 place-items-center gap-3 rounded-2xl border border-white/20 bg-black p-6 text-white"
							onClick={(event) => event.stopPropagation()}
						>
							<span>
								{selectedItem.type === "video"
									? "Video"
									: selectedItem.type === "gif"
										? "GIF"
										: "Media"}
							</span>
							<a
								className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20"
								href={selectedItem.url}
								rel="noreferrer"
								target="_blank"
							>
								Open media
							</a>
						</div>
					)}
				</div>
			) : null}
		</>
	);
}

function singleImageStyle(item: TweetMediaItem) {
	if (!item.width || !item.height) return undefined;
	const maxHeight = 720;
	const width = Math.min(
		item.width,
		Math.round((item.width / item.height) * maxHeight),
	);
	return {
		aspectRatio: `${String(item.width)} / ${String(item.height)}`,
		width: `${String(width)}px`,
	};
}

function playableVideoUrl(url: string) {
	try {
		const parsed = new URL(url);
		if (parsed.hostname === "video.twimg.com") return url;
		return /\.(?:mp4|m3u8)(?:$|[?#])/i.test(parsed.pathname) ? url : undefined;
	} catch {
		return /\.(?:mp4|m3u8)(?:$|[?#])/i.test(url) ? url : undefined;
	}
}
