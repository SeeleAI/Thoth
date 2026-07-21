export function isPlatform(platform: NodeJS.Platform): boolean {
  return process.platform === platform;
}
