export const THOTH_BROWSER_PROFILE_PARTITION = "persist:thoth-browser";
const LEGACY_BROWSER_ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\d{13,}-[0-9a-f]+)$/i;
const MAX_LEGACY_BROWSER_PROFILES = 1000;

const THOTH_BROWSER_STORAGE_TYPES = [
  "cookies",
  "filesystem",
  "indexdb",
  "localstorage",
  "serviceworkers",
  "cachestorage",
  "websql",
] as const;

interface BrowserProfileSession {
  clearStorageData(options: {
    storages: Array<(typeof THOTH_BROWSER_STORAGE_TYPES)[number]>;
  }): Promise<void>;
  clearCache(): Promise<void>;
  clearAuthCache(): Promise<void>;
}

interface BrowserProfileGuest {
  readonly id: number;
  isDestroyed(): boolean;
  reload(): void;
}

interface BrowserProfileWebContents extends BrowserProfileGuest {
  readonly session: object;
  getType(): string;
}

interface ListBrowserProfileGuestsInput {
  profileSession: object;
  webContents: BrowserProfileWebContents[];
}

interface ClearBrowserProfileInput {
  profileSessions: BrowserProfileSession[];
  listGuests(): BrowserProfileGuest[];
  onCleared?(): void;
  logReloadError(guestId: number, error: unknown): void;
}

interface ElectronSessions {
  fromPartition(partition: string): BrowserProfileSession;
}

export function getThothBrowserProfileSession(sessions: ElectronSessions): BrowserProfileSession {
  return sessions.fromPartition(THOTH_BROWSER_PROFILE_PARTITION);
}

export function readLegacyThothBrowserIds(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const browserIds = new Set<string>();
  for (const value of input) {
    if (typeof value === "string" && LEGACY_BROWSER_ID_PATTERN.test(value)) {
      browserIds.add(value);
      if (browserIds.size >= MAX_LEGACY_BROWSER_PROFILES) {
        break;
      }
    }
  }
  return [...browserIds];
}

export function getThothBrowserProfileSessions(
  sessions: ElectronSessions,
  legacyBrowserIds: string[],
): [BrowserProfileSession, ...BrowserProfileSession[]] {
  return [
    getThothBrowserProfileSession(sessions),
    // COMPAT(browserProfile): added in v0.1.108; remove after 2027-01-15.
    ...legacyBrowserIds.map((browserId) =>
      sessions.fromPartition(`${THOTH_BROWSER_PROFILE_PARTITION}-${browserId}`),
    ),
  ];
}

export function getLegacyThothBrowserProfileSession(
  sessions: ElectronSessions,
  browserId: string,
): BrowserProfileSession | null {
  const [legacyBrowserId] = readLegacyThothBrowserIds([browserId]);
  return legacyBrowserId
    ? sessions.fromPartition(`${THOTH_BROWSER_PROFILE_PARTITION}-${legacyBrowserId}`)
    : null;
}

export function listThothBrowserProfileGuests(
  input: ListBrowserProfileGuestsInput,
): BrowserProfileGuest[] {
  return input.webContents.filter(
    (contents) =>
      !contents.isDestroyed() &&
      (contents.getType() === "webview" || contents.getType() === "window") &&
      contents.session === input.profileSession,
  );
}

export async function clearThothBrowserProfile(input: ClearBrowserProfileInput): Promise<void> {
  await Promise.all(
    input.profileSessions.flatMap((profileSession) => [
      profileSession.clearStorageData({ storages: [...THOTH_BROWSER_STORAGE_TYPES] }),
      profileSession.clearCache(),
      profileSession.clearAuthCache(),
    ]),
  );

  input.onCleared?.();

  for (const guest of input.listGuests()) {
    if (guest.isDestroyed()) {
      continue;
    }
    try {
      guest.reload();
    } catch (error) {
      input.logReloadError(guest.id, error);
    }
  }
}
