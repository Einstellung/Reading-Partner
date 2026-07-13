// Shared chat pieces for the call UI (CallBubble, CallView). Tailwind-only.
// No preflight in this project, so box-sizing and control resets are explicit.

import { useEffect, useRef, useState } from 'react';
import { IconSend } from './icons';
import type { ThreadMessage } from './types';

export function MessageList({
	messages,
	size = 'sm',
	className = '',
}: {
	messages: ThreadMessage[];
	size?: 'sm' | 'lg';
	className?: string;
}) {
	const endRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		endRef.current?.scrollIntoView({ block: 'end' });
	}, [messages.length]);

	const bubble =
		size === 'lg'
			? 'max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed'
			: 'max-w-[80%] rounded-2xl px-3 py-1.5 text-[13px] leading-snug';

	return (
		<div className={'flex flex-col ' + (size === 'lg' ? 'gap-3 ' : 'gap-2 ') + 'overflow-y-auto ' + className}>
			{messages.map((m, i) => (
				<div key={i} className={'flex ' + (m.role === 'user' ? 'justify-end' : 'justify-start')}>
					<div
						className={
							'box-border whitespace-pre-wrap ' + bubble + ' ' +
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

export function Composer({
	onSend,
	placeholder,
	pill = false,
}: {
	onSend(text: string): void;
	placeholder: string;
	pill?: boolean;
}) {
	const [value, setValue] = useState('');
	function send() {
		const text = value.trim();
		if (!text) return;
		onSend(text);
		setValue('');
	}
	function onKeyDown(e: React.KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}

	if (pill) {
		return (
			<div className="box-border flex items-center gap-2 rounded-full border border-black/10 bg-white py-2 pl-5 pr-2 shadow-sm dark:border-white/15 dark:bg-neutral-800">
				<input
					className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
					placeholder={placeholder}
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={onKeyDown}
				/>
				<button
					type="button"
					aria-label="Send"
					onClick={send}
					disabled={!value.trim()}
					className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white disabled:opacity-40"
				>
					<IconSend size={17} />
				</button>
			</div>
		);
	}

	return (
		<input
			className="box-border w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-[13px] text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-blue-500 dark:border-white/15 dark:bg-neutral-800 dark:text-neutral-100"
			placeholder={placeholder}
			value={value}
			onChange={(e) => setValue(e.target.value)}
			onKeyDown={onKeyDown}
		/>
	);
}
