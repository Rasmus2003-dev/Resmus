import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserPlus, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../contexts/AuthContext';

const BANNER_DISMISS_KEY = 'resmus_account_banner_dismissed';

export function AccountBanner() {
  const { user, loading } = useAuth();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(BANNER_DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  const dismiss = () => {
    try {
      localStorage.setItem(BANNER_DISMISS_KEY, '1');
      setDismissed(true);
    } catch {}
  };

  if (loading || user || dismissed) return null;

  return (
    <div className="flex-none bg-gradient-to-r from-sky-500 to-indigo-600 text-white px-4 py-2.5 flex items-center justify-between gap-3 shadow-lg">
      <div className="flex items-center gap-2 min-w-0">
        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/20 shrink-0">
          <FontAwesomeIcon icon={faUserPlus} className="text-sm" />
        </span>
        <p className="text-sm font-semibold truncate">
          Skapa ett konto för mer funktionalitet! Sparade favoriter, inställningar och mer.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          to="/settings"
          className="px-3 py-1.5 rounded-lg bg-white text-sky-600 font-bold text-sm hover:bg-sky-50 transition-colors"
        >
          Skapa konto
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Stäng"
        >
          <FontAwesomeIcon icon={faXmark} className="text-sm" />
        </button>
      </div>
    </div>
  );
}
