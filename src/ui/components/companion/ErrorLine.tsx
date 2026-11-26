// What a call that died says. One line, above the body, and the body behind it
// is back at rest — a broken call cannot be resumed, and starting again is a
// fresh one (docs/33).
//
// It lives beside the corner because the corner is the way into a session
// (CompanionCorner.tsx).
//
// Rendering only. The sentence itself is orbErrorLine in ui/components/orb.

export function ErrorLine({ line }: { line: string }) {
	return (
		<p
			role="status"
			className="pointer-events-none m-0 max-w-[16rem] rounded-lg border border-border-soft bg-popover px-3 py-1.5 text-[13px] leading-snug text-muted-foreground shadow-sm"
		>
			{line}
		</p>
	);
}
