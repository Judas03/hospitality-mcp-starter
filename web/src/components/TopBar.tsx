import { PROVIDER_TYPES, type ProviderType } from '../contract/types';
import { speechAvailable } from '../hooks/useSpeech';
import type { ClientMode, ConnectionState } from '../mcp/types';
import { IconSpeaker, ProviderIcon } from './icons';

const PROVIDER_LABELS: Record<ProviderType, string> = { restaurant: 'Restaurant', salon: 'Salon', hotel: 'Hotel' };

interface TopBarProps {
  provider: ProviderType;
  onProvider(provider: ProviderType): void;
  locked: boolean;
  connection: ConnectionState;
  /** The live server's MCP address, or null in demo mode. */
  endpoint: string | null;
  /** Null hides the switch, e.g. while recording the scripted demo. */
  onSwitchMode: ((mode: ClientMode) => void) | null;
  readAloud: boolean;
  onReadAloud(on: boolean): void;
}

export function TopBar({
  provider,
  onProvider,
  locked,
  connection,
  endpoint,
  onSwitchMode,
  readAloud,
  onReadAloud,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <div>
          <h1>Hospitality Assistant</h1>
          <p>Restaurants · Salons · Hotels</p>
        </div>
      </div>
      <ProviderSwitch value={provider} onChange={onProvider} disabled={locked} />
      <div className="topbar-end">
        {speechAvailable && (
          <button
            type="button"
            className="btn ghost toggle"
            aria-pressed={readAloud}
            onClick={() => onReadAloud(!readAloud)}
          >
            <IconSpeaker />
            Read replies aloud
          </button>
        )}
        <ConnectionStatus connection={connection} endpoint={endpoint} />
        {onSwitchMode && (
          <button
            type="button"
            className="btn ghost small"
            onClick={() => onSwitchMode(connection.mode === 'demo' ? 'live' : 'demo')}
          >
            {connection.mode === 'demo' ? 'Use live server' : 'Use demo data'}
          </button>
        )}
      </div>
    </header>
  );
}

export function ProviderSwitch({
  value,
  onChange,
  disabled,
}: {
  value: ProviderType;
  onChange(provider: ProviderType): void;
  disabled: boolean;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label="What to book">
      {PROVIDER_TYPES.map((provider) => (
        <button
          key={provider}
          type="button"
          role="radio"
          aria-checked={value === provider}
          disabled={disabled}
          onClick={() => onChange(provider)}
        >
          <ProviderIcon provider={provider} />
          {PROVIDER_LABELS[provider]}
        </button>
      ))}
    </div>
  );
}

export function ConnectionStatus({ connection, endpoint }: { connection: ConnectionState; endpoint: string | null }) {
  if (connection.status === 'connecting') {
    return (
      <span className="connection" data-tone="pending" role="status" title={endpoint ?? undefined}>
        <span className="dot" aria-hidden="true" /> Connecting…
      </span>
    );
  }
  if (connection.status === 'error') {
    return (
      <span className="connection" data-tone="error" role="status" title={connection.message}>
        <span className="dot" aria-hidden="true" /> Server unreachable
      </span>
    );
  }
  if (connection.mode === 'demo') {
    return (
      <span
        className="connection"
        data-tone="demo"
        role="status"
        title="Answers come from sample data in this browser tab, not from the MCP server."
      >
        <span className="dot" aria-hidden="true" /> Demo data
      </span>
    );
  }
  return (
    <span className="connection" data-tone="live" role="status" title={endpoint ?? undefined}>
      <span className="dot" aria-hidden="true" /> Live server · MCP {connection.info?.protocolVersion}
    </span>
  );
}
