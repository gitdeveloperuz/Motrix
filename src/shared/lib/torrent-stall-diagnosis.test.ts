import { describe, expect, it } from 'vitest'
import { diagnoseTorrentStall } from './torrent-stall-diagnosis'

const base = {
  phase: 'downloading' as const,
  connectedPeers: 0,
  downloadSpeed: 0,
  elapsedMs: 120_000,
}

describe('diagnoseTorrentStall', () => {
  it('does not call a paused task stalled', () => {
    expect(diagnoseTorrentStall({ ...base, phase: 'paused' }).code).toBe('paused')
  })

  it('explains that connected peers may not be uploading pieces', () => {
    const result = diagnoseTorrentStall({
      ...base,
      connectedPeers: 6,
      silenceMs: 90_000,
    })
    expect(result.code).toBe('peers-not-sending')
    expect(result.explanation).toContain('does not guarantee')
    expect(result.actions.length).toBeGreaterThan(1)
  })

  it('distinguishes magnet metadata discovery from payload downloading', () => {
    expect(
      diagnoseTorrentStall({ ...base, phase: 'metadata' }).code
    ).toBe('metadata-not-found')
  })

  it('reports tracker connectivity only when all known trackers failed', () => {
    expect(
      diagnoseTorrentStall({
        ...base,
        failedTrackers: 4,
        healthyTrackers: 0,
      }).code
    ).toBe('tracker-connectivity')
    expect(
      diagnoseTorrentStall({
        ...base,
        failedTrackers: 4,
        healthyTrackers: 1,
      }).code
    ).toBe('waiting-for-sources')
  })

  it('suggests DHT and peer exchange only when disabled', () => {
    const result = diagnoseTorrentStall({
      ...base,
      dhtEnabled: false,
      pexEnabled: false,
    })
    expect(result.actions.join(' ')).toContain('Enable DHT')
    expect(result.actions.join(' ')).toContain('Enable peer exchange')
  })

  it('recognizes active downloads and sanitizes invalid counters', () => {
    expect(
      diagnoseTorrentStall({
        ...base,
        connectedPeers: Number.NaN,
        downloadSpeed: 128,
      }).code
    ).toBe('no-stall')
  })
})
