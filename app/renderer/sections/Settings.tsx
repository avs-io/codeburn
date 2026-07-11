import { Hint } from '../components/Hint'
import { CliErrorText, cliErrorDisplay } from '../components/CliErrorPanel'
import { Panel } from '../components/Panel'
import { usePolled } from '../hooks/usePolled'
import { formatUsd } from '../lib/format'
import { codeburn } from '../lib/ipc'
import type { CliError, CombinedUsage, DeviceScanResult, Identity, Period } from '../lib/types'

const RAIL_ITEMS = ['General', 'Providers', 'Model aliases', 'Plans', 'Devices', 'Export', 'Privacy & data'] as const

function periodLabel(period: Period): string {
  if (period === 'today') return 'today'
  if (period === 'week') return 'last 7 days'
  if (period === 'month') return 'this month'
  if (period === '30days') return 'last 30 days'
  return 'all time'
}

function shortFingerprint(fingerprint: string): string {
  const parts = fingerprint.split(':').filter(Boolean)
  if (parts.length < 3) return fingerprint
  return `${parts[0]}:${parts[1]}:…:${parts[parts.length - 1]}`
}

export function Settings({ period, refreshToken = 0 }: { period: Period; refreshToken?: number }) {
  const identity = usePolled<Identity>(() => codeburn.getIdentity(), [refreshToken])
  const scan = usePolled<DeviceScanResult>(() => codeburn.getDevicesScan(), [refreshToken])
  const devices = usePolled<CombinedUsage>(() => codeburn.getDevices(period), [period, refreshToken])

  return (
    <>
      <div className="bar">
        <div className="t">Settings</div>
      </div>
      <div className="body" style={{ flexDirection: 'row', gap: 14 }}>
        <nav className="rail">
          {RAIL_ITEMS.map(item => (
            <div key={item} className={item === 'Devices' ? 'ni on' : 'ni'}>
              {item}
            </div>
          ))}
        </nav>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ThisDevicePanel identity={identity} />
          <DiscoveredPanel scan={scan} />
          <PairedPanel devices={devices} period={period} />
        </div>
      </div>
      <Hint
        items={[
          { k: '⌘1-7', label: 'Navigate' },
          { k: '⌘R', label: 'Refresh' },
        ]}
        right="pairing uses mutual TLS · approve-style, no PIN"
      />
    </>
  )
}

function ThisDevicePanel({ identity }: { identity: ReturnType<typeof usePolled<Identity>> }) {
  return (
    <Panel title="This device">
      {identity.data ? (
        <div className="li">
          <div className="lx">
            <b>{identity.data.name}</b>
            <span>Visible on the local network as {identity.data.name}.local</span>
            <span>{identity.data.fingerprint}</span>
          </div>
          <span className="btn btn-s" aria-disabled="true">
            Visibility: on
          </span>
        </div>
      ) : identity.error ? (
        <SettingsErrorText error={identity.error} />
      ) : (
        <p style={{ color: 'var(--t3)', margin: 0, fontSize: 12 }}>Reading this device identity…</p>
      )}
    </Panel>
  )
}

function DiscoveredPanel({ scan }: { scan: ReturnType<typeof usePolled<DeviceScanResult>> }) {
  const found = scan.data?.found.filter(device => !device.paired) ?? []

  return (
    <Panel title="Discovered nearby" right={scan.loading ? 'listening…' : undefined}>
      {!scan.data && scan.error ? (
        <SettingsErrorText error={scan.error} />
      ) : !scan.data ? (
        <p style={{ color: 'var(--t3)', margin: 0, fontSize: 12 }}>listening…</p>
      ) : found.length === 0 ? (
        <p style={{ color: 'var(--t3)', margin: 0, fontSize: 12 }}>No nearby devices found.</p>
      ) : (
        found.map(device => (
          <div className="li" key={`${device.host}:${device.port}:${device.fingerprint}`}>
            <div className="lx">
              <b>{device.name}</b>
              <span className="hot">wants to pair · fingerprint {shortFingerprint(device.fingerprint)}</span>
            </div>
            <span className="btn btn-p" aria-disabled="true">
              Approve
            </span>
          </div>
        ))
      )}
    </Panel>
  )
}

function PairedPanel({ devices, period }: { devices: ReturnType<typeof usePolled<CombinedUsage>>; period: Period }) {
  const paired = devices.data?.perDevice.filter(device => !device.local) ?? []
  const deviceScope = devices.data ? `· ${devices.data.combined.deviceCount} devices` : '· paired devices'

  return (
    <Panel title="Paired">
      {!devices.data && devices.error ? (
        <SettingsErrorText error={devices.error} />
      ) : !devices.data ? (
        <p style={{ color: 'var(--t3)', margin: 0, fontSize: 12 }}>Loading paired devices…</p>
      ) : paired.length === 0 ? (
        <p style={{ color: 'var(--t3)', margin: 0, fontSize: 12 }}>No paired devices yet.</p>
      ) : (
        paired.map(device => (
          <div className="li" key={device.id}>
            <div className="lx">
              <b>{device.name}</b>
              <span>
                {device.sessions.toLocaleString('en-US')} sessions · {formatUsd(device.cost)} {periodLabel(period)}
              </span>
            </div>
            <span className="btn btn-s" aria-disabled="true">
              Pull now
            </span>
          </div>
        ))
      )}
      <div className="li">
        <div className="lx">
          <b>Combine usage from paired devices</b>
          <span>scope captions gain “{deviceScope}” when on</span>
        </div>
        <span className="tglon" aria-disabled="true" />
      </div>
    </Panel>
  )
}

function SettingsErrorText({ error }: { error: CliError }) {
  if (error.kind === 'not-found') {
    const display = cliErrorDisplay(error)
    return <p style={{ color: 'var(--t3)', margin: 0, fontSize: 12 }}>{display.title}</p>
  }
  return <CliErrorText error={error} />
}
