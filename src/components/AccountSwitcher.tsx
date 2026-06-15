import { Check, ChevronDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchQueryEnvelope } from "#/lib/api-client";
import { queryKeys } from "#/lib/query-client";
import type { AccountRecord } from "#/lib/types";
import { cx } from "#/lib/ui";
import { AvatarChip } from "./AvatarChip";
import { setStoredAccountId, useSelectedAccountId } from "./account-selection";

function hueForAccount(account: AccountRecord) {
	let hash = 0;
	const value = account.handle || account.name || account.id;
	for (const character of value) {
		hash = (hash * 31 + character.charCodeAt(0)) % 360;
	}
	return hash;
}

function accountLabel(account: AccountRecord) {
	return account.handle || account.name || account.id;
}

function avatarName(account: AccountRecord) {
	return account.name || account.handle || account.id;
}

export function AccountSwitcher({ action }: { action?: ReactNode } = {}) {
	const [open, setOpen] = useState(false);
	const switcherRef = useRef<HTMLDivElement>(null);
	const statusQuery = useQuery({
		queryKey: queryKeys.status,
		queryFn: ({ signal }) => fetchQueryEnvelope({ signal }),
	});
	const accounts = statusQuery.data?.accounts ?? [];
	const selectedAccountId = useSelectedAccountId(accounts);
	const selectedAccount = useMemo(
		() => accounts.find((account) => account.id === selectedAccountId),
		[accounts, selectedAccountId],
	);

	useEffect(() => {
		if (!open) return;

		const closeOnOutside = (event: PointerEvent) => {
			if (!switcherRef.current?.contains(event.target as Node)) {
				setOpen(false);
			}
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		window.addEventListener("pointerdown", closeOnOutside);
		window.addEventListener("keydown", closeOnEscape);
		return () => {
			window.removeEventListener("pointerdown", closeOnOutside);
			window.removeEventListener("keydown", closeOnEscape);
		};
	}, [open]);

	if (accounts.length < 2 || !selectedAccount) {
		return action ? (
			<div className="flex justify-center px-1 min-[1100px]:justify-start min-[1100px]:px-2">
				{action}
			</div>
		) : null;
	}

	return (
		<div ref={switcherRef} className="relative px-1 min-[1100px]:px-2">
			<div
				className={cx(
					"group grid w-full justify-items-center gap-2 text-[var(--ink)] min-[1100px]:flex min-[1100px]:h-11 min-[1100px]:items-center min-[1100px]:justify-start min-[1100px]:gap-1 min-[1100px]:rounded-full min-[1100px]:border min-[1100px]:border-transparent min-[1100px]:bg-transparent min-[1100px]:p-0.5 min-[1100px]:transition-[background,border-color,box-shadow] min-[1100px]:duration-150 min-[1100px]:hover:bg-[var(--bg-hover)]",
					open &&
						"min-[1100px]:border-[color:color-mix(in_srgb,var(--accent)_45%,var(--line))] min-[1100px]:bg-[var(--bg-active)] min-[1100px]:shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_20%,transparent)]",
				)}
			>
				<button
					type="button"
					aria-expanded={open}
					aria-haspopup="listbox"
					aria-label={`Active account: ${accountLabel(selectedAccount)}`}
					className="flex size-11 min-w-0 flex-none items-center justify-center gap-2 rounded-full px-1 py-1 text-left transition-colors duration-150 hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--accent)_28%,transparent)] min-[1100px]:h-auto min-[1100px]:w-auto min-[1100px]:flex-1 min-[1100px]:justify-start min-[1100px]:hover:bg-transparent"
					onClick={() => setOpen((value) => !value)}
				>
					<AvatarChip
						avatarUrl={selectedAccount.avatarUrl}
						hue={selectedAccount.avatarHue ?? hueForAccount(selectedAccount)}
						name={avatarName(selectedAccount)}
						profileId={selectedAccount.profileId}
						size="small"
					/>
					<span className="hidden min-w-0 flex-1 flex-col leading-tight min-[1100px]:flex">
						<span className="truncate text-[14px] font-bold">
							{accountLabel(selectedAccount)}
						</span>
						<span className="truncate text-[11px] font-medium text-[var(--ink-soft)]">
							active account
						</span>
					</span>
				</button>
				{action ? (
					<div className="order-first shrink-0 min-[1100px]:order-none">
						{action}
					</div>
				) : null}
				<button
					type="button"
					aria-expanded={open}
					aria-haspopup="listbox"
					aria-label="Switch account"
					className="hidden size-8 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--ink)] focus-visible:bg-[var(--bg-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--accent)_28%,transparent)] min-[1100px]:inline-flex"
					onClick={() => setOpen((value) => !value)}
				>
					<ChevronDown
						className={cx(
							"size-4 transition-transform duration-150",
							open && "rotate-180",
						)}
						strokeWidth={2.2}
						aria-hidden="true"
					/>
				</button>
			</div>
			{open ? (
				<div
					role="listbox"
					aria-label="Active account"
					className="absolute bottom-[calc(100%+8px)] left-1 z-50 w-[228px] overflow-hidden rounded-2xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--bg)_96%,black_4%)] py-1.5 shadow-[0_18px_48px_rgba(0,0,0,.28)] backdrop-blur min-[1100px]:left-2"
				>
					{accounts.map((account) => {
						const selected = account.id === selectedAccount.id;
						return (
							<button
								key={account.id}
								type="button"
								role="option"
								aria-selected={selected}
								className={cx(
									"flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-150 hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-active)] focus-visible:outline-none",
									selected && "bg-[var(--accent-soft)]",
								)}
								onClick={() => {
									setStoredAccountId(account.id);
									setOpen(false);
								}}
							>
								<AvatarChip
									avatarUrl={account.avatarUrl}
									hue={account.avatarHue ?? hueForAccount(account)}
									name={avatarName(account)}
									profileId={account.profileId}
									size="small"
								/>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-[14px] font-bold text-[var(--ink)]">
										{accountLabel(account)}
									</span>
									<span className="block truncate text-[12px] text-[var(--ink-soft)]">
										{account.name || account.id}
									</span>
								</span>
								{selected ? (
									<Check
										className="size-4 shrink-0 text-[var(--accent)]"
										strokeWidth={2.4}
										aria-hidden="true"
									/>
								) : null}
							</button>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
