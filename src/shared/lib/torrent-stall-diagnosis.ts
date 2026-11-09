export type TorrentStallPhase = 'metadata' | 'downloading' | 'paused' | 'error'

export interface TorrentDiagnosticsSnapshot {
  phase: TorrentStallPhase
  /** Number of currently connected peers. */
  connectedPeers: number
  /** Number of peers reported by the swarm, when known. */
  knownPeers?: number | null
  /** Number of known seeders, when known. */
  seeders?: number | null
  /** Current payload download rate in bytes per second. */
  downloadSpeed: number
  /** Age of the task in milliseconds. */
  elapsedMs: number
  /** Age of the last received payload byte, or null if none was received. */
  silenceMs?: number | null
  /** Number of trackers that most recently responded successfully. */
  healthyTrackers?: number | null
  /** Number of trackers known to be unreachable. */
  failedTrackers?: number | null
  dhtEnabled?: boolean
  pexEnabled?: boolean
}

export type TorrentDiagnosisCode =
  | 'paused'
  | 'engine-error'
  | 'metadata-not-found'
  | 'waiting-for-sources'
  | 'peers-not-sending'
  | 'tracker-connectivity'
  | 'slow-swarm'
  | 'no-stall'

export interface TorrentDiagnosis {
  code: TorrentDiagnosisCode
  title: string
  explanation: string
  actions: string[]
  severity: 'info' | 'warning' | 'success'
}

const nonNegative = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0

/**
 * Converts the engine's current torrent counters into user-facing guidance.
 * This is deliberately advisory: peer and tracker counters are observations,
 * not proof that a remote peer will upload data.
 */
export function diagnoseTorrentStall(
  snapshot: TorrentDiagnosticsSnapshot
): TorrentDiagnosis {
  const peers = nonNegative(snapshot.connectedPeers)
  const speed = nonNegative(snapshot.downloadSpeed)
  const elapsed = nonNegative(snapshot.elapsedMs)
  const silence = nonNegative(snapshot.silenceMs)
  const healthy = nonNegative(snapshot.healthyTrackers)
  const failed = nonNegative(snapshot.failedTrackers)
  const knownPeers = snapshot.knownPeers == null
    ? null
    : nonNegative(snapshot.knownPeers)
  const seeders = snapshot.seeders == null
    ? null
    : nonNegative(snapshot.seeders)

  if (snapshot.phase === 'paused') {
    return {
      code: 'paused',
      title: 'Download is paused',
      explanation: 'The torrent is not expected to receive data while it is paused.',
      actions: ['Resume the torrent to continue downloading.'],
      severity: 'info',
    }
  }

  if (snapshot.phase === 'error') {
    return {
      code: 'engine-error',
      title: 'Torrent engine reported an error',
      explanation: 'The engine has marked this task as failed; peer counts alone cannot explain the failure.',
      actions: ['Open the task error details and resolve the reported storage, permission, or network issue.'],
      severity: 'warning',
    }
  }

  if (snapshot.phase === 'metadata') {
    if (elapsed < 30_000) {
      return {
        code: 'no-stall',
        title: 'Finding torrent metadata',
        explanation: 'Magnet links need to retrieve metadata before the file list and payload can download.',
        actions: ['Give the magnet a little time to discover metadata.'],
        severity: 'info',
      }
    }
    return {
      code: 'metadata-not-found',
      title: 'Magnet metadata is taking too long',
      explanation: 'The swarm has not supplied the metadata needed to start the download.',
      actions: [
        'Check that the magnet link is complete and has a valid info hash.',
        'Try adding a tracker list or a different source for this torrent.',
        'Keep the task active while peers are being discovered.',
      ],
      severity: 'warning',
    }
  }

  if (speed > 0) {
    return {
      code: 'no-stall',
      title: 'Torrent is receiving data',
      explanation: 'Payload data is arriving, even if the current speed is low.',
      actions: ['Leave the task running; torrent speeds can fluctuate as peers exchange pieces.'],
      severity: 'success',
    }
  }

  if (peers > 0 && silence >= 30_000) {
    return {
      code: 'peers-not-sending',
      title: 'Peers connected, but no data is arriving',
      explanation: `${peers} peer(s) are connected, but no payload bytes have arrived recently. A connection does not guarantee that a peer has the pieces you need or is uploading them.`,
      actions: [
        'Keep the torrent running briefly; peers may be negotiating or exchanging pieces.',
        'Check whether the swarm has seeders and whether the selected files are available.',
        'If the speed stays at zero, try a healthier torrent or add working trackers.',
      ],
      severity: 'warning',
    }
  }

  if (failed > 0 && healthy === 0) {
    return {
      code: 'tracker-connectivity',
      title: 'No tracker is responding',
      explanation: `${failed} tracker(s) are currently reported unreachable and none are known to be healthy.`,
      actions: [
        'Check your internet connection and VPN or firewall rules.',
        'Add or update trackers, then allow time for a new announce.',
        'DHT and peer exchange can still discover peers when enabled and supported by the torrent.',
      ],
      severity: 'warning',
    }
  }

  if (peers === 0 && knownPeers === 0 && seeders === 0) {
    return {
      code: 'waiting-for-sources',
      title: 'No useful peers are available',
      explanation: 'The current swarm report shows no peers or seeders to provide the requested data.',
      actions: [
        'Check the info hash and confirm that this torrent is still being shared.',
        'Add working trackers and enable DHT or peer exchange when appropriate.',
        'Try another source if the swarm remains empty.',
      ],
      severity: 'warning',
    }
  }

  if (peers === 0 && elapsed >= 30_000) {
    return {
      code: 'waiting-for-sources',
      title: 'Waiting for peers',
      explanation: 'No peer is currently connected, so the client has nobody to request pieces from.',
      actions: [
        'Check tracker health and your network or firewall settings.',
        ...(snapshot.dhtEnabled === false
          ? ['Enable DHT for public torrents when supported.']
          : []),
        ...(snapshot.pexEnabled === false
          ? ['Enable peer exchange when supported by this torrent.']
          : []),
        'Allow another announce cycle, or try a different torrent source.',
      ],
      severity: 'warning',
    }
  }

  if (elapsed < 30_000) {
    return {
      code: 'no-stall',
      title: 'Connecting to the swarm',
      explanation: 'The torrent has only recently started and may still be discovering peers.',
      actions: ['Wait for peer discovery and the next tracker announce.'],
      severity: 'info',
    }
  }

  return {
    code: 'slow-swarm',
    title: 'The swarm is not providing data yet',
    explanation: 'There is not enough information to identify a single cause. Tracker responses do not guarantee that peers have the pieces you need.',
    actions: [
      'Check tracker health and the number of seeders.',
      'Confirm that the selected files are available in the swarm.',
      'Try another source if the download remains at zero.',
    ],
    severity: 'warning',
  }
}
