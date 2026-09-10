import { execFile } from 'child_process';
import { promisify } from 'util';
import { binaryInfo } from 'cloakbrowser';

const exec = promisify(execFile);

export type EngineProblemKind =
  | 'not-installed'     // no binary at the path the package points to
  | 'unreadable'        // the binary is there but would not report its version
  | 'version-mismatch'  // the marker and the binary disagree
  | 'pin-unsatisfied';  // CLOAKBROWSER_VERSION asks for something else

export interface EngineProblem {
  kind: EngineProblemKind;
  message: string;
}

export interface EngineInfo {
  /**
   * The version the PACKAGE resolved for this platform. It is a marker — the
   * name of a directory and a download — not proof of what is inside it.
   */
  markerVersion: string;
  /** What the binary says when asked (`--version`). Null when it could not be asked. */
  binaryVersion: string | null;
  /**
   * The package's "latest across all platforms" field. On darwin this is a
   * version that has no macOS build at all, so it must never be shown as the
   * engine in use or compared against a locked identity.
   */
  bundledVersion: string;
  tier: string;
  platform: string;
  binaryPath: string;
  installed: boolean;
  /** A pin requested through CLOAKBROWSER_VERSION, if the user set one. */
  requestedVersion: string | null;
  /** True when the binary was asked and answered. False = we are trusting the
   *  marker, which is exactly what this module exists to stop doing. */
  verified: boolean;
  problems: EngineProblem[];
}

/**
 * Whether a problem must stop a launch.
 *
 * `unreadable` does not: a binary that will not answer `--version` may still be
 * the right one, and refusing every launch over an exec failure would be a
 * worse trade than proceeding with the fact recorded. It DOES stop a new
 * identity from being locked (see BrowserManager.launch) — you cannot baseline
 * an identity onto an engine you cannot name.
 */
export function isBlocking(problem: EngineProblem): boolean {
  return problem.kind !== 'unreadable';
}

/** What is actually running, as best as it can be established. */
export function runningVersion(info: EngineInfo): string {
  return info.binaryVersion ?? chromiumPartOf(info.markerVersion);
}

/**
 * Does the engine running now match the one an identity is locked to?
 *
 * Compared on the Chromium part alone: a locked identity stores the package
 * marker (`145.0.7632.109.2`) while the binary reports only the Chromium
 * version (`145.0.7632.109`). A string equality here would call every launch a
 * drift.
 */
export function engineMatchesLocked(lockedVersion: string, info: EngineInfo): boolean {
  return chromiumPartOf(lockedVersion) === runningVersion(info);
}

/**
 * The Chromium part of a CloakBrowser marker.
 *
 * A marker looks like `145.0.7632.109.2`: a four-component Chromium version plus
 * CloakBrowser's own patch revision. The binary reports only the Chromium part,
 * so the two can only be compared on that prefix.
 */
export function chromiumPartOf(marker: string): string {
  return marker.split('.').slice(0, 4).join('.');
}

/** Pull `145.0.7632.109` out of `Chromium 145.0.7632.109`. */
export function parseReportedVersion(output: string): string | null {
  const match = /(\d+\.\d+\.\d+\.\d+)/.exec(output);
  return match ? match[1] : null;
}

interface RawInfo {
  version: string;
  bundledVersion?: string;
  tier?: string;
  platform?: string;
  binaryPath: string;
  installed?: boolean;
}

/**
 * Compare what the package claims with what the binary reports.
 *
 * Pure so the comparison can be tested without a browser on disk. The reason it
 * exists at all: the app records `binaryInfo().version` as the engine a locked
 * identity is pinned to, but nothing verified that the file at `binaryPath` is
 * that version. Set CLOAKBROWSER_BINARY_PATH to any other build and the record
 * becomes fiction with no way to notice.
 */
export function describeEngine(
  raw: RawInfo,
  reportedVersion: string | null,
  requestedVersion: string | null = null,
): EngineInfo {
  const problems: EngineProblem[] = [];
  const installed = raw.installed !== false;

  if (!installed) {
    problems.push({
      kind: 'not-installed',
      message: `Không tìm thấy binary tại ${raw.binaryPath}. Không tự tải bản khác để thay thế.`,
    });
  } else if (reportedVersion === null) {
    problems.push({
      kind: 'unreadable',
      message: `Binary tại ${raw.binaryPath} không trả lời --version. Chưa xác minh được bản đang chạy.`,
    });
  } else {
    const expected = chromiumPartOf(raw.version);
    if (reportedVersion !== expected) {
      problems.push({
        kind: 'version-mismatch',
        message: `Package khai ${raw.version} (Chromium ${expected}) nhưng binary tự khai ${reportedVersion}. `
          + 'Identity đã khoá đang ghi theo con số của package, nên nó đang ghi sai.',
      });
    }
  }

  if (requestedVersion && requestedVersion !== raw.version) {
    problems.push({
      kind: 'pin-unsatisfied',
      message: `Đã yêu cầu ${requestedVersion} qua CLOAKBROWSER_VERSION nhưng đang dùng ${raw.version}.`,
    });
  }

  return {
    markerVersion: raw.version,
    binaryVersion: reportedVersion,
    bundledVersion: raw.bundledVersion ?? raw.version,
    tier: raw.tier ?? 'unknown',
    platform: raw.platform ?? process.platform,
    binaryPath: raw.binaryPath,
    installed,
    requestedVersion,
    verified: installed && reportedVersion !== null,
    problems,
  };
}

/** Ask the binary on disk what it is. Never throws — an unanswered question is
 *  itself a reportable state, not a crash. */
export async function readBinaryVersion(binaryPath: string): Promise<string | null> {
  try {
    const { stdout } = await exec(binaryPath, ['--version'], { timeout: 15_000 });
    return parseReportedVersion(stdout);
  } catch {
    return null;
  }
}

export async function readEngineInfo(): Promise<EngineInfo> {
  const raw = binaryInfo() as unknown as RawInfo;
  const reported = raw.installed === false ? null : await readBinaryVersion(raw.binaryPath);
  return describeEngine(raw, reported, process.env.CLOAKBROWSER_VERSION ?? null);
}
