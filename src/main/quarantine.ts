import { execFile } from 'child_process';

type ExecFile = typeof execFile;

export async function clearQuarantine(
  binaryAppPath: string,
  platform: NodeJS.Platform = process.platform,
  exec: ExecFile = execFile,
): Promise<void> {
  if (platform !== 'darwin') return;
  await new Promise<void>((resolve) => {
    exec('xattr', ['-cr', binaryAppPath], () => resolve());
  });
}
