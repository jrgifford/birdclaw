import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchQueryEnvelope } from "#/lib/api-client";
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

export function AccountSwitcher() {
	const [accounts, setAccounts] = useState<AccountRecord[]>([]);
	const [open, setOpen] = useState(false);
	const switcherRef = useRef<HTMLDivElement>(null);
	const selectedAccountId = useSelectedAccountId(accounts);
	const selectedAccount = useMemo(
		() => accounts.find((account) => account.id === selectedAccountId),
		[accounts, selectedAccountId],
	);

	useEffect(() => {
		let active = true;
		fetchQueryEnvelope()
			.then((meta) => {
				if (active) setAccounts(meta.accounts);
			})
			.catch(() => {
				if (active) setAccounts([]);
			});
		return () => {
			active = false;
		};
	}, []);

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

	if (accounts.length < 2 || !selectedAccount) return null;

	return (
		<div ref={switcherRef} className="relative px-1 min-[1100px]:px-2">
			<button
				type="button"
				aria-expanded={open}
				aria-haspopup="listbox"
				aria-label={`Active account: ${accountLabel(selectedAccount)}`}
				className={cx(
					"group flex h-11 w-full items-center justify-center gap-2 rounded-full border border-transparent bg-transparent px-1.5 text-left text-[var(--ink)] transition-[background,border-color,box-shadow] duration-150 hover:bg-[var(--bg-hover)] focus-visible:border-[color:color-mix(in_srgb,var(--accent)_55%,var(--line))] focus-visible:bg-[var(--bg-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--accent)_28%,transparent)] min-[1100px]:justify-start min-[1100px]:px-2",
					open &&
						"border-[color:color-mix(in_srgb,var(--accent)_45%,var(--line))] bg-[var(--bg-active)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_20%,transparent)]",
				)}
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
				<ChevronDown
					className={cx(
						"hidden size-4 shrink-0 text-[var(--ink-soft)] transition-transform duration-150 min-[1100px]:block",
						open && "rotate-180",
					)}
					strokeWidth={2.2}
					aria-hidden="true"
				/>
			</button>
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
