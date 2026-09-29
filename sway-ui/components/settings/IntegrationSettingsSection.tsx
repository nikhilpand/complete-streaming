'use client';

import React, { useState } from 'react';
import { useIntegrationSettings } from '@/store/useIntegrationSettings';
import { Radio, MessageSquare, Check, Key } from 'lucide-react';
import { cn } from '@/lib/utils';

export function IntegrationSettingsSection() {
  const {
    lastFmEnabled,
    lastFmUsername,
    lastFmSessionKey,
    setLastFmEnabled,
    setLastFmCredentials,
    listenBrainzEnabled,
    listenBrainzToken,
    setListenBrainzEnabled,
    setListenBrainzToken,
    discordRpcEnabled,
    setDiscordRpcEnabled,
  } = useIntegrationSettings();

  const [lastFmUser, setLastFmUser] = useState(lastFmUsername);
  const [lastFmKey, setLastFmKey] = useState(lastFmSessionKey);
  const [savedLastFm, setSavedLastFm] = useState(false);

  const [lbToken, setLbToken] = useState(listenBrainzToken);
  const [savedLb, setSavedLb] = useState(false);

  const handleSaveLastFm = () => {
    setLastFmCredentials(lastFmUser.trim(), lastFmKey.trim());
    setSavedLastFm(true);
    setTimeout(() => setSavedLastFm(false), 2000);
  };

  const handleSaveLb = () => {
    setListenBrainzToken(lbToken.trim());
    setSavedLb(true);
    setTimeout(() => setSavedLb(false), 2000);
  };

  return (
    <div className="space-y-6 pt-4 border-t border-white/10">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-white flex items-center gap-2">
          <Radio className="w-4 h-4 text-[--art-primary]" />
          Scrobbling & Integrations
        </h2>
        <p className="text-xs text-white/50">Last.fm, ListenBrainz, and Discord Rich Presence</p>
      </div>

      {/* 1. Last.fm */}
      <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-red-600 flex items-center justify-center text-[10px] font-bold text-white">
              L
            </span>
            <div>
              <label className="text-xs font-medium text-white/90 block">Last.fm Scrobbler</label>
              <span className="text-[11px] text-white/50">Submit scrobbles at 50% song completion</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLastFmEnabled(!lastFmEnabled)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-semibold transition-colors',
              lastFmEnabled ? 'bg-red-500/20 text-red-300 border border-red-500/40' : 'bg-white/10 text-white/50'
            )}
          >
            {lastFmEnabled ? 'Active' : 'Disabled'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <div>
            <label className="text-[10px] text-white/60 block mb-1">Username</label>
            <input
              type="text"
              placeholder="Last.fm username"
              value={lastFmUser}
              onChange={(e) => setLastFmUser(e.target.value)}
              className="w-full px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/60 block mb-1">Session Key / API Token</label>
            <input
              type="password"
              placeholder="Session key"
              value={lastFmKey}
              onChange={(e) => setLastFmKey(e.target.value)}
              className="w-full px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSaveLastFm}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            {savedLastFm ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Key className="w-3.5 h-3.5" />}
            {savedLastFm ? 'Saved!' : 'Save Credentials'}
          </button>
        </div>
      </div>

      {/* 2. ListenBrainz */}
      <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-orange-600 flex items-center justify-center text-[10px] font-bold text-white">
              LB
            </span>
            <div>
              <label className="text-xs font-medium text-white/90 block">ListenBrainz</label>
              <span className="text-[11px] text-white/50">Open-source music logging by MetaBrainz</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setListenBrainzEnabled(!listenBrainzEnabled)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-semibold transition-colors',
              listenBrainzEnabled ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40' : 'bg-white/10 text-white/50'
            )}
          >
            {listenBrainzEnabled ? 'Active' : 'Disabled'}
          </button>
        </div>

        <div className="pt-1">
          <label className="text-[10px] text-white/60 block mb-1">User Token</label>
          <div className="flex gap-2">
            <input
              type="password"
              placeholder="ListenBrainz User Token"
              value={lbToken}
              onChange={(e) => setLbToken(e.target.value)}
              className="flex-1 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
            />
            <button
              type="button"
              onClick={handleSaveLb}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              {savedLb ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Key className="w-3.5 h-3.5" />}
              {savedLb ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* 3. Discord Rich Presence */}
      <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-indigo-400" />
          <div>
            <label className="text-xs font-medium text-white/90 block">Discord Rich Presence</label>
            <span className="text-[11px] text-white/50">Display current track and artwork on Discord profile</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDiscordRpcEnabled(!discordRpcEnabled)}
          className={cn(
            'px-3 py-1 rounded-full text-xs font-semibold transition-colors',
            discordRpcEnabled ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40' : 'bg-white/10 text-white/50'
          )}
        >
          {discordRpcEnabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>
    </div>
  );
}
