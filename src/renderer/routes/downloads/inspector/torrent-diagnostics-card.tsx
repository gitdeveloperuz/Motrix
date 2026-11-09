import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { useTaskPeers } from '@renderer/hooks/use-task-peers'
import type { DownloadTask } from '@shared/types/task'
import { TaskStatus } from '@shared/types/task'
import { useEffect, useState } from 'react'
import { diagnoseTorrentStall } from '@shared/lib/torrent-stall-diagnosis'

const ACTIVE_STATUSES = new Set<TaskStatus>([
  TaskStatus.FetchingMetadata,
  TaskStatus.Downloading,
  TaskStatus.Paused,
  TaskStatus.Error,
])

export function TorrentDiagnosticsCard({ task }: { task: DownloadTask }) {
  const active = ACTIVE_STATUSES.has(task.status)
  const { peers } = useTaskPeers(task.id, active)
  const peerDownloadSpeed = peers.reduce((sum, peer) => sum + peer.downSpeed, 0)
  const observedSpeed = Math.max(task.downloadSpeed, peerDownloadSpeed)
  const [zeroSince, setZeroSince] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setZeroSince(Date.now())
    setNow(Date.now())
  }, [task.id])

  useEffect(() => {
    if (observedSpeed > 0) {
      setZeroSince(Date.now())
      return
    }
    const interval = window.setInterval(() => setNow(Date.now()), 2_000)
    return () => window.clearInterval(interval)
  }, [observedSpeed])

  useEffect(() => {
    if (observedSpeed > 0) setZeroSince(Date.now())
  }, [observedSpeed])

  if (!active) return null

  const phase =
    task.status === TaskStatus.Paused
      ? 'paused'
      : task.status === TaskStatus.Error
        ? 'error'
        : task.status === TaskStatus.FetchingMetadata
          ? 'metadata'
          : 'downloading'

  const diagnosis = diagnoseTorrentStall({
    phase,
    connectedPeers: task.bt?.peers ?? peers.length,
    knownPeers: task.bt?.peersInSwarm,
    seeders: task.bt?.seedsInSwarm,
    downloadSpeed: observedSpeed,
    elapsedMs: Math.max(0, now - task.createdAt),
    silenceMs: observedSpeed > 0 ? 0 : Math.max(0, now - zeroSince),
  })

  const title = {
    paused: 'Download is paused',
    'engine-error': 'Torrent engine reported an error',
    'metadata-not-found': 'Magnet metadata is taking too long',
    'waiting-for-sources': 'Waiting for peers or seeders',
    'peers-not-sending': 'Peers connected, but no data is arriving',
    'tracker-connectivity': 'No tracker is responding',
    'slow-swarm': 'The swarm is not providing data yet',
    'no-stall': 'Connecting to the torrent swarm',
  }[diagnosis.code]
  const explanation = {
    paused: 'No data is expected while this task is paused.',
    'engine-error': task.errorMessage || 'The download engine reported an error.',
    'metadata-not-found': 'A magnet link must retrieve metadata before its files can start downloading.',
    'waiting-for-sources': 'There are currently no useful peers connected to provide the requested pieces.',
    'peers-not-sending': `${diagnosis.explanation} This can happen when connected peers do not have the pieces you need or are not uploading.`,
    'tracker-connectivity': diagnosis.explanation,
    'slow-swarm': diagnosis.explanation,
    'no-stall': 'The client is discovering peers. Torrent connections and speeds can take time to appear.',
  }[diagnosis.code]

  return (
    <Alert
      variant={diagnosis.severity === 'warning' ? 'destructive' : 'default'}
      className="mb-3"
      data-testid="torrent-diagnostics"
    >
      <div className="min-w-0">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="mt-1">
          {explanation}
          {diagnosis.code === 'peers-not-sending' && (
            <span className="mt-1 block">
              {task.bt?.peers ?? peers.length} connected · {task.bt?.seedsInSwarm ?? 0} seeders reported
            </span>
          )}
          {diagnosis.actions.length > 0 && (
            <ul className="mt-2 list-disc ps-4">
              {diagnosis.actions.slice(0, 3).map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          )}
        </AlertDescription>
      </div>
    </Alert>
  )
}
