// Shared chat pieces for the call UI (CallBubble, AICallPanel). Tailwind-only.
// No preflight in this project, so box-sizing and control resets are explicit.

import { useEffect, useRef, useState } from 'react';
import type { ThreadMessage } from './types';

export function MessageList({ messages, className = '' }: { messages: ThreadMessage[]; className?: string }) {
	const endRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		endRef.current?.scrollIntoView({ block: 'end' });
	}, [messages.length]);

	return (
		<div className={'flex flex-col gap-2 overflow-y-auto ' + className}>
			{messages.map((m, i) => (
				<div key={i} className={'flex ' + (m.role === 'user' ? 'justify-end' : 'justify-start')}>
					<div
						className={
							'box-border max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-[13px] leading-snug ' +
							(m.role === 'user'
								? 'bg-blue-600 text-white rounded-br-sm'
								: 'bg-black/[0.05] text-neutral-800 rounded-bl-sm dark:bg-white/10 dark:text-neutral-100')
						}
					>
						{m.text}
					</div>
				</div>
			))}
			<div ref={endRef} />
		</div>
	);
}

export function Composer({ onSend, placeholder }: { onSend(text: string): void; placeholder: string }) {
	const [value, setValue] = useState('');
	function send() {
		const text = value.trim();
		if (!text) return;
		onSend(text);
		setValue('');
	}
	return (
		<input
			className="box-border w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-[13px] text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-blue-500 dark:border-white/15 dark:bg-neutral-800 dark:text-neutral-100"
			placeholder={placeholder}
			value={value}
			onChange={(e) => setValue(e.target.value)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					send();
				}
			}}
		/>
	);
}
