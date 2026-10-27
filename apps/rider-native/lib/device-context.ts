/**
 * Device context sent with the heartbeat (every ~30 s while online) and with
 * background location batches — only while the rider is online / on a
 * delivery, as disclosed on the location disclosure screen and in the
 * "Location and device info while online" help article.
 *
 * Exactly these fields, nothing else: phone model, OS name/version, app
 * version/build, network type (Wi-Fi / mobile data + 2G–5G when the OS
 * reports it), battery level and whether it is charging. Never IMEI or other
 * hardware IDs, never the list of installed/running apps, never call state.
 * The server validates this shape strictly and drops anything extra.
 */
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Battery from 'expo-battery';
import * as Device from 'expo-device';
import NetInfo from '@react-native-community/netinfo';

export interface DeviceContext {
  model?: string;
  osName?: string;
  osVersion?: string;
  appVersion?: string;
  appBuild?: string;
  network?: 'WIFI' | 'CELLULAR' | 'ETHERNET' | 'NONE' | 'OTHER' | 'UNKNOWN';
  cellGen?: '2g' | '3g' | '4g' | '5g';
  battery?: number;
  charging?: boolean;
}

const READ_TIMEOUT_MS = 1500;

const clip = (s: string | null | undefined, max: number) => {
  const t = (s ?? '').trim();
  return t ? t.slice(0, max) : undefined;
};

function staticContext(): DeviceContext {
  const maker = Device.manufacturer ?? '';
  const name = Device.modelName ?? '';
  // "samsung SM-A515F"; a model name that already starts with the maker stays as is.
  const model = maker && !name.toLowerCase().startsWith(maker.toLowerCase()) ? `${maker} ${name}` : name || maker;
  return {
    model: clip(model, 80),
    osName: clip(Device.osName ?? Platform.OS, 24),
    osVersion: clip(Device.osVersion ?? String(Platform.Version), 24),
    appVersion: clip(Application.nativeApplicationVersion, 32),
    appBuild: clip(Application.nativeBuildVersion, 32),
  };
}

function withTimeout<T>(p: Promise<T>): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), READ_TIMEOUT_MS))]).catch(
    () => undefined
  );
}

const NETWORK: Record<string, DeviceContext['network']> = {
  wifi: 'WIFI',
  cellular: 'CELLULAR',
  ethernet: 'ETHERNET',
  none: 'NONE',
  unknown: 'UNKNOWN',
};

/** Read the current device context. Never throws; missing values are omitted. */
export async function readDeviceContext(): Promise<DeviceContext> {
  const ctx: DeviceContext = staticContext();
  const [net, level, state] = await Promise.all([
    withTimeout(NetInfo.fetch()),
    withTimeout(Battery.getBatteryLevelAsync()),
    withTimeout(Battery.getBatteryStateAsync()),
  ]);
  if (net) {
    ctx.network = net.isConnected === false ? 'NONE' : NETWORK[net.type] ?? 'OTHER';
    if (net.type === 'cellular' && net.details?.cellularGeneration) ctx.cellGen = net.details.cellularGeneration;
  }
  // -1 = unknown (simulators / unsupported devices).
  if (typeof level === 'number' && level >= 0) ctx.battery = Math.round(level * 100);
  if (state !== undefined && state !== Battery.BatteryState.UNKNOWN) {
    ctx.charging = state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
  }
  for (const k of Object.keys(ctx) as (keyof DeviceContext)[]) if (ctx[k] === undefined) delete ctx[k];
  return ctx;
}
