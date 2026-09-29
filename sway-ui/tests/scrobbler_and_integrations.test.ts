import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { useIntegrationSettings } from '../store/useIntegrationSettings';
import { scrobbleTrack } from '../lib/scrobbler';
import type { Song } from '../lib/api/types';

describe('Sprint 9: Scrobbler & External Integrations', () => {
  test('useIntegrationSettings manages Last.fm, ListenBrainz, and Discord RPC credentials', () => {
    const store = useIntegrationSettings.getState();

    // Last.fm
    assert.equal(store.lastFmEnabled, false);
    store.setLastFmCredentials('sway_user', 'sk_test_session_12345');
    assert.equal(useIntegrationSettings.getState().lastFmUsername, 'sway_user');
    assert.equal(useIntegrationSettings.getState().lastFmSessionKey, 'sk_test_session_12345');
    assert.equal(useIntegrationSettings.getState().lastFmEnabled, true);

    // ListenBrainz
    assert.equal(store.listenBrainzEnabled, false);
    store.setListenBrainzToken('lb_user_token_abc');
    assert.equal(useIntegrationSettings.getState().listenBrainzToken, 'lb_user_token_abc');
    assert.equal(useIntegrationSettings.getState().listenBrainzEnabled, true);

    // Discord RPC
    assert.equal(store.discordRpcEnabled, false);
    store.setDiscordRpcEnabled(true);
    assert.equal(useIntegrationSettings.getState().discordRpcEnabled, true);
  });

  test('scrobbleTrack handles missing or empty song safely without throwing', async () => {
    // Should not throw on null or undefined song
    await assert.doesNotReject(async () => {
      await scrobbleTrack(null as unknown as Song, 0);
    });

    const mockSong: Song = {
      id: 'song_test_1',
      title: 'Kesariya',
      artists: [{ id: 'a1', name: 'Arijit Singh', role: 'primary' }],
      provider: 'saavn',
      provider_id: '123',
      type: 'song',
      has_media: true,
    };

    await assert.doesNotReject(async () => {
      await scrobbleTrack(mockSong, Math.floor(Date.now() / 1000));
    });
  });
});
