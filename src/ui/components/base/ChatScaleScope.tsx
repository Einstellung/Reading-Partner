// The subtree the chat scale applies to: it publishes `--chat-scale` and takes
// the two gestures that change it. Content under it only reads the variable, so
// a surface that is not wrapped is 1x by the variable's default.

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { accumulateWheel, CHAT_SCALE_DEFAULT, shiftChatScale, stepChatScale } from './chat-scale';
import { bindZoomKeys } from './chat-scale-keys';
import { currentChatScale, setChatScale, useChatScale } from './useChatScale';

export default function ChatScaleScope({
	children,
	className = '',
}: {
	children: ReactNode;
	className?: string;
}) {
	const scale = useChatScale();
	const hostRef = useRef<HTMLDivElement>(null);
	const wheelAcc = useRef(0);

	useEffect(() => {
		const el = hostRef.current;
		if (!el) return;
		// Listened for directly: React's onWheel is passive, where preventDefault
		// does nothing and the browser zooms the whole app instead of this column.
		const onWheel = (e: WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			const { acc, steps } = accumulateWheel(wheelAcc.current, e.deltaY, e.deltaMode);
			wheelAcc.current = acc;
			if (steps !== 0) setChatScale(shiftChatScale(currentChatScale(), steps));
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	}, []);

	useEffect(
		() =>
			bindZoomKeys(window, (action) => {
				if (action === 'reset') setChatScale(CHAT_SCALE_DEFAULT);
				else setChatScale(stepChatScale(currentChatScale(), action === 'in' ? 1 : -1));
			}),
		[],
	);

	return (
		<div ref={hostRef} className={className} style={{ '--chat-scale': String(scale) } as CSSProperties}>
			{children}
		</div>
	);
}
