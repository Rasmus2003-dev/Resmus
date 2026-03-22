import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCog, faMoon, faSun, faDesktop, faMobileAlt, faInfoCircle, faPalette, faServer, faCodeBranch, faHistory, faCheck, faDownload, faClock, faUserPlus, faSignInAlt, faSignOutAlt } from '@fortawesome/free-solid-svg-icons';
import { Provider } from '../types';
import { useTheme } from './ThemeContext';
import { useAuth } from '../contexts/AuthContext';

interface SettingsViewProps {
  deferredPrompt: any;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ deferredPrompt }) => {
  const { theme, setTheme } = useTheme();
  const { user, signInWithEmail, signUpWithEmail, signOut } = useAuth();
  const [accountEmail, setAccountEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountMode, setAccountMode] = useState<'signin' | 'signup'>('signup');
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountSuccess, setAccountSuccess] = useState<string | null>(null);

  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccountError(null);
    setAccountSuccess(null);
    const { error } = accountMode === 'signup'
      ? await signUpWithEmail(accountEmail, accountPassword)
      : await signInWithEmail(accountEmail, accountPassword);
    if (error) {
      setAccountError(error.message);
      return;
    }
    if (accountMode === 'signup') setAccountSuccess('Kontrollera din e-post för att bekräfta kontot.');
    else setAccountSuccess('Inloggad.');
  };

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        // Accepted
      }
      (window as any).deferredPrompt = null;
    }
  };

  const [provider, setProvider] = useState<Provider>(() => {
    return (localStorage.getItem('resmus_storage_provider') as Provider) || Provider.VASTTRAFIK;
  });

  const [_, setUpdateTrigger] = useState(0);
  const forceUpdate = () => setUpdateTrigger(prev => prev + 1);

  const updateProvider = (newProvider: Provider) => {
    if (newProvider === provider) return;
    setProvider(newProvider);
    localStorage.setItem('resmus_storage_provider', newProvider);
    window.dispatchEvent(new Event('storage'));
  };

  const updateTheme = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
  };

  const [versionInfo, setVersionInfo] = useState<{ version: string, message: string, timestamp: string } | null>(null);

  useEffect(() => {
    fetch('./version.json')
      .then(res => res.json())
      .then(data => setVersionInfo(data))
      .catch(e => console.error("Could not load version info", e));
  }, []);

  const ProviderCard = ({ id, label, color, sub, iconLabel }: { id: Provider, label: string, color: string, sub: string, iconLabel: string }) => {
    const isActive = provider === id;

    return (
      <button
        onClick={() => updateProvider(id)}
        className={`relative overflow-hidden rounded-2xl p-4 text-left transition-all duration-300 border-2 ${isActive
            ? 'border-transparent shadow-lg transform scale-[1.02]'
            : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-sm'
          }`}
        style={isActive ? { backgroundColor: color } : {}}
      >
        {/* Background Pattern for Active */}
        {isActive && (
          <div className="absolute -right-4 -bottom-4 opacity-10 text-9xl font-black leading-none select-none text-white disabled-click">
            {iconLabel}
          </div>
        )}

        <div className="relative z-10 flex flex-col h-full justify-between">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-black mb-3 ${isActive ? 'bg-white/20 text-white backdrop-blur-sm shadow-inner' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
            }`}>
            {iconLabel}
          </div>

          <div>
            <div className={`font-black text-lg leading-none mb-1 ${isActive ? 'text-white' : 'text-slate-800 dark:text-white'}`}>{label}</div>
            <div className={`text-xs font-medium ${isActive ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>{sub}</div>
          </div>

          {isActive && (
            <div className="absolute top-4 right-4 text-white drop-shadow-sm">
              <FontAwesomeIcon icon={faCheck} className="text-xl" />
            </div>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="h-full bg-slate-50/50 dark:bg-slate-950 overflow-y-auto scroll-smooth">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8 pb-32">

        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Inställningar</h1>
            <p className="text-slate-500 dark:text-slate-400 font-medium text-sm mt-1">Anpassa Resmus efter dina behov</p>
          </div>
          <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 flex items-center justify-center">
            <FontAwesomeIcon icon={faCog} className="text-xl animate-slow-spin-hover" />
          </div>
        </div>

        {/* Konto (Supabase) */}
        <section className="animate-in slide-in-from-bottom-4 fade-in duration-500">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 ml-1">Konto</h2>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-sm">
            {user ? (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-bold text-slate-800 dark:text-white">Inloggad</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{user.email || user.id}</p>
                </div>
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  <FontAwesomeIcon icon={faSignOutAlt} /> Logga ut
                </button>
              </div>
            ) : (
              <form onSubmit={handleAccountSubmit} className="space-y-4">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {accountMode === 'signin' ? 'Logga in med ditt konto.' : 'Skapa konto för att spara favoriter och använda kartan.'}
                </p>
                <div className="space-y-2">
                  <input
                    type="email"
                    placeholder="E-post"
                    value={accountEmail}
                    onChange={e => { setAccountEmail(e.target.value); setAccountError(null); }}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-sky-500 focus:border-transparent text-sm"
                    required
                  />
                  <input
                    type="password"
                    placeholder="Lösenord (minst 6 tecken)"
                    value={accountPassword}
                    onChange={e => { setAccountPassword(e.target.value); setAccountError(null); }}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-sky-500 focus:border-transparent text-sm"
                    required
                    minLength={6}
                  />
                </div>
                {accountError && <p className="text-sm text-red-600 dark:text-red-400">{accountError}</p>}
                {accountSuccess && <p className="text-sm text-green-600 dark:text-green-400">{accountSuccess}</p>}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-sky-500 text-white font-bold text-sm hover:bg-sky-600 transition-colors shadow-sm"
                  >
                    <FontAwesomeIcon icon={accountMode === 'signup' ? faUserPlus : faSignInAlt} className="text-xs" />
                    {accountMode === 'signup' ? 'Skapa konto' : 'Logga in'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAccountMode(m => m === 'signup' ? 'signin' : 'signup'); setAccountError(null); setAccountSuccess(null); }}
                    className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-semibold text-sm hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    {accountMode === 'signup' ? 'Logga in' : 'Skapa konto'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>

        {/* Provider Section */}
        <section className="animate-in slide-in-from-bottom-4 fade-in duration-500">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 ml-1">Välj Trafikleverantör</h2>
          <div className="grid grid-cols-2 lg:grid-cols-2 gap-4">
            <ProviderCard id={Provider.VASTTRAFIK} label="Västtrafik" sub="Västra Götaland" color="#0095eb" iconLabel="VT" />
            <ProviderCard id={Provider.SL} label="SL" sub="Stockholm" color="#0078bf" iconLabel="SL" />
            <ProviderCard id={Provider.RESROBOT} label="Resrobot" sub="Hela Sverige" color="#8cc63f" iconLabel="RR" />
            <ProviderCard id={Provider.TRAFIKVERKET} label="Trafikverket" sub="Tåg (som trafikleverantör)" color="#d2232a" iconLabel="TrV" />
          </div>
        </section>

        {/* Appearance & Time Grid */}
        <section className="animate-in slide-in-from-bottom-4 fade-in duration-500 delay-100">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Theme Widget */}
            <div>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 ml-1">Utseende</h2>
              <div className="bg-white dark:bg-slate-900 rounded-2xl p-1.5 shadow-sm border border-slate-200/50 dark:border-slate-800 flex relative">
                {[
                  { key: 'light', label: 'Ljust', icon: faSun },
                  { key: 'dark', label: 'Mörkt', icon: faMoon },
                  { key: 'system', label: 'Auto', icon: faDesktop }
                ].map(({ key, label, icon }) => (
                  <button
                    key={key}
                    onClick={() => updateTheme(key as any)}
                    className={`flex-1 py-12 rounded-xl flex flex-col items-center justify-center gap-3 transition-all duration-300 relative z-10 ${theme === key
                        ? 'bg-white dark:bg-slate-800 shadow-md scale-[1.02] ring-1 ring-black/5 dark:ring-white/10'
                        : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                  >
                    <FontAwesomeIcon icon={icon} className={`text-2xl ${theme === key ? 'text-indigo-500 scale-110' : ''} transition-transform`} />
                    <span className={`text-xs font-bold ${theme === key ? 'text-slate-900 dark:text-white' : ''}`}>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Time Span Widget */}
            <div>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 ml-1">Tidsintervall</h2>
              <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-sm border border-slate-200/50 dark:border-slate-800 h-full flex flex-col justify-center">
                <div className="flex items-center gap-3 mb-4 text-slate-500">
                  <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    <FontAwesomeIcon icon={faClock} />
                  </div>
                  <span className="text-xs font-medium">Hur många timmar framåt?</span>
                </div>
                <div className="flex justify-between gap-2 bg-slate-100 dark:bg-slate-950/50 p-1 rounded-xl">
                  {[1, 4, 8, 24].map(h => {
                    const currentSpan = parseInt(localStorage.getItem('resmus_time_span') || '240', 10);
                    const isSelected = currentSpan === h * 60;
                    return (
                      <button
                        key={h}
                        onClick={() => {
                          localStorage.setItem('resmus_time_span', (h * 60).toString());
                          window.dispatchEvent(new Event('storage'));
                          forceUpdate();
                        }}
                        className={`flex-1 py-3 rounded-lg text-sm font-black transition-all duration-200 ${isSelected
                            ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/30'
                            : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                          }`}
                      >
                        {h}h
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* App & About */}
        <section className="space-y-4 animate-in slide-in-from-bottom-4 fade-in duration-500 delay-200">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-0 ml-1">Om Appen</h2>

          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-slate-200/50 dark:border-slate-800 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">

            {/* Install Row */}
            <div className="p-5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 flex items-center justify-center">
                  <FontAwesomeIcon icon={faMobileAlt} />
                </div>
                <div>
                  <div className="font-bold text-slate-800 dark:text-white">Installera Appen</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">För en bättre upplevelse</div>
                </div>
              </div>
              {deferredPrompt ? (
                <button onClick={handleInstall} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm shadow-blue-500/20 transition-all active:scale-95">
                  Installera
                </button>
              ) : (
                <div className="text-xs font-bold text-green-500 bg-green-50 dark:bg-green-900/20 px-3 py-1 rounded-full border border-green-100 dark:border-green-900/30">
                  Installerad
                </div>
              )}
            </div>

            {/* Updates Row */}
            <div className="p-5 flex items-start gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
              <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 flex items-center justify-center shrink-0">
                <FontAwesomeIcon icon={faCodeBranch} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-slate-800 dark:text-white">Version 2026.2.0 (Beta)</div>
                  {versionInfo && <div className="text-[10px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">{new Date(versionInfo.timestamp).toLocaleDateString()}</div>}
                </div>
                {versionInfo && (
                  <div className="bg-slate-50 dark:bg-slate-950/50 p-3 rounded-xl mt-3 text-xs text-slate-600 dark:text-slate-400 leading-relaxed border border-slate-100 dark:border-slate-800">
                    <span className="font-bold block mb-1 text-slate-700 dark:text-slate-300">Senaste ändring:</span>
                    "{versionInfo.message}"
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-50 dark:bg-slate-950/50 p-4 text-center">
              <p className="text-[10px] text-slate-400 font-medium">
                Resmus är byggd med ❤️ &nbsp;•&nbsp; Datan kommer från Trafiklab
              </p>
            </div>

          </div>
        </section>

      </div>
    </div>
  );
};