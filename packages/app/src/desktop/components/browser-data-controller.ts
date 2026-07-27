export type ClearBrowserDataResult = "cancelled" | "cleared";

export async function clearDesktopBrowserData(input: {
  confirm(): Promise<boolean>;
  clearProfile?: (legacyBrowserIds: string[]) => Promise<void>;
  browserIds: string[];
}): Promise<ClearBrowserDataResult> {
  if (!(await input.confirm())) {
    return "cancelled";
  }
  if (!input.clearProfile) {
    throw new Error("Electron browser profile bridge is unavailable");
  }
  await input.clearProfile(input.browserIds);
  return "cleared";
}
