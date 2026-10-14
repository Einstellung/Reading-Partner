// A result the reader asked to see during a call (docs/companion/136 "落盒":
// show), opened above the box. The call goes on underneath it.

import { useT } from "../../../i18n";
import { Button } from "../ui/button";
import type { FrontCard } from "../../../soul/voice/front/cascade";

export function CallResultCard({ card, onClose }: { card: FrontCard; onClose: () => void }) {
	const t = useT();
	return (
		<div className="pointer-events-auto flex max-h-[50vh] w-[min(28rem,calc(100vw-2rem))] flex-col gap-2 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-lg">
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs text-muted-foreground">#{card.number}</span>
				<Button variant="ghost" size="sm" onClick={onClose}>
					{t("shell.lumen.callCardClose")}
				</Button>
			</div>
			<div className="overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">{card.text}</div>
		</div>
	);
}
