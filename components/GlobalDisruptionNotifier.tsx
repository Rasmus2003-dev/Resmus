import React, { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBell, faBellSlash } from '@fortawesome/free-solid-svg-icons';
import { TransitService } from '../services/transitService';

export const GlobalDisruptionNotifier: React.FC = () => {
    const [enabled, setEnabled] = useState(false);
    const enabledRef = useRef(false); // Always up-to-date inside async callbacks
    const seenIdsRef = useRef<Set<string>>(new Set());
    const isFirstLoad = useRef(true);

    // Keep ref in sync with state
    useEffect(() => {
        enabledRef.current = enabled;
    }, [enabled]);

    useEffect(() => {
        // Restore pref on mount
        const saved = localStorage.getItem('resmus_global_disruptions_enabled');
        if (saved === 'true' && Notification.permission === 'granted') {
            setEnabled(true);
            enabledRef.current = true;
        }

        try {
            const savedIds = localStorage.getItem('resmus_seen_disruptions');
            if (savedIds) {
                const parsed = JSON.parse(savedIds);
                if (Array.isArray(parsed)) {
                    parsed.forEach((id: string) => seenIdsRef.current.add(id));
                }
            }
        } catch (_) { }

        const fetchSituations = async () => {
            try {
                const tvData = await TransitService.getVasttrafikDisruptions();

                if (!isFirstLoad.current && enabledRef.current) {
                    const newDisps = tvData.filter((d) => {
                        return d.situationNumber && !seenIdsRef.current.has(d.situationNumber);
                    });

                    if (newDisps.length > 0) {
                        const latest = newDisps[0];
                        if (Notification.permission === 'granted') {
                            try {
                                new Notification(`Ny Västtrafik-störning: ${latest.title}`, {
                                    body: latest.description?.slice(0, 150) || '',
                                    icon: '/favicon.png',
                                    tag: latest.situationNumber
                                });
                            } catch (_) { }
                        }
                    }
                }

                // Mark all as seen
                tvData.forEach((d) => {
                    if (d.situationNumber) seenIdsRef.current.add(d.situationNumber);
                });
                localStorage.setItem('resmus_seen_disruptions', JSON.stringify(
                    Array.from(seenIdsRef.current).slice(-150)
                ));
            } catch (_) { }

            isFirstLoad.current = false;
        };

        fetchSituations();
        const interval = setInterval(fetchSituations, 60_000);
        return () => clearInterval(interval);
    }, []); // Only run once on mount

    const toggle = async () => {
        if (!enabled) {
            const perm = await Notification.requestPermission();
            if (perm === 'granted') {
                setEnabled(true);
                localStorage.setItem('resmus_global_disruptions_enabled', 'true');
                try {
                    new Notification('Notiser aktiverade', {
                        body: 'Du får nu pushnotiser om nya Västtrafik-störningar.',
                        icon: '/favicon.png'
                    });
                } catch (_) { }
            } else {
                alert('Notiser blockerades av webbläsaren. Gå till inställningar och tillåt notiser för den här sidan.');
            }
        } else {
            setEnabled(false);
            localStorage.setItem('resmus_global_disruptions_enabled', 'false');
        }
    };

    return (
        <button
            id="disruption-notifier-btn"
            onClick={toggle}
            title={enabled ? 'Stäng av störningsnotiser' : 'Aktivera störningsnotiser från Västtrafik'}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all duration-300 border text-xs font-bold
                ${enabled
                    ? 'bg-sky-500 text-white border-sky-600 shadow-md shadow-sky-500/25 hover:bg-sky-600'
                    : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-sky-300 hover:text-sky-600 dark:hover:text-sky-400'
                }`}
        >
            <FontAwesomeIcon
                icon={enabled ? faBell : faBellSlash}
                className={enabled ? 'animate-wiggle' : ''}
            />
            <span className="hidden sm:inline">
                {enabled ? 'Notiser PÅ' : 'Notiser'}
            </span>
        </button>
    );
};
