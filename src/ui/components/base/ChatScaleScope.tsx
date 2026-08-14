// The subtree the chat scale applies to. It publishes `--chat-scale` and takes
// the two gestures that change it; the content under it only ever reads the
// variable, so a surface that is not wrapped is 1x by the variable's default and
// needs no branch of its own.

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { accumulateWheel, shiftChatScale, stepChatScale } from './chat-scale';
import { currentChatScale, setChatScale, useChatScale } from './useChatScale';

// Ctrl/Cmd with the zoom keys, bound once however many scopes are mounted: two
// listeners would take two steps per press. The count also survives the
// mount/cleanup/mount an effect gets in development.
let keyHosts = 0;

function onZoomKey(e: KeyboardEvent): void {
	if (!e.ctrlKey && !e.metaKey) return;
	if (e.key === '=' || e.key === '+') {
		e.preventDefault();
		setChatScale(stepChatScale(currentChatScale(), 1));
	} else if (e.key === '-' || e.key === '_') {
		e.preventDefault();
		setChatScale(stepChatScale(currentChatScale(), -1));
	} else if (e.key === '0') {
		e.preventDefault();
		setChatScale(1);
	}
}

function bindZoomKeys(): () => void {
	if (keyHosts === 0) window.addEventListener('keydown', onZoomKey);
	keyHosts += 1;
	return () => {
		keyHosts -= 1;
		if (keyHosts === 0) window.removeEventListener('keydown', onZoomKey);
	};
}

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
		// Listened for directly, not through onWheel: React's wheel handler is
		// passive, where preventDefault does nothing and the browser zooms the
		// whole app instead of the column.
		const onWheel = (e: WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			const { acc, steps } = accumulateWheel(wheelAcc.current, e.deltaY);
			wheelAcc.current = acc;
			if (steps !== 0) setChatScale(shiftChatScale(currentChatScale(), steps));
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	}, []);

	useEffect(bindZoomKeys, []);

	return (
		<div ref={hostRef} className={className} style={{ '--chat-scale': String(scale) } as CSSProperties}>
			{children}
		</div>
	);
}
