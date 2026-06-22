export type NativeHandle = bigint | null;

export interface NativeChromeWindow {
  hwnd: bigint;
  pid: number;
  title: string;
}

export interface LoadedWindowIcons {
  small: bigint;
  big: bigint;
}

export interface WindowsNativeAdapter {
  enumerateChromeWindows(): NativeChromeWindow[];
  getIcon(hwnd: bigint, size: 'small' | 'big'): NativeHandle;
  setIcon(hwnd: bigint, size: 'small' | 'big', icon: NativeHandle): boolean;
  setTitle(hwnd: bigint, title: string): boolean;
  loadIcons(path: string): LoadedWindowIcons;
  destroyIcon(icon: bigint): void;
}

export async function createKoffiWindowsAdapter(): Promise<WindowsNativeAdapter> {
  const { default: koffi } = await import('koffi');
  const user32 = koffi.load('user32.dll');

  const HANDLE = koffi.pointer('HANDLE', koffi.opaque());
  const HWND = koffi.alias('HWND', HANDLE);
  const HICON = koffi.alias('HICON', HANDLE);
  const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(HWND hwnd, intptr_t lParam)');

  const EnumWindows = user32.func('__stdcall', 'EnumWindows', 'bool', [koffi.pointer(EnumWindowsProc), 'intptr_t']);
  const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(HWND hwnd, _Out_ uint32_t *pid)');
  const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(HWND hwnd)');
  const GetWindow = user32.func('HWND __stdcall GetWindow(HWND hwnd, uint32_t command)');
  const GetClassNameW = user32.func('int __stdcall GetClassNameW(HWND hwnd, _Out_ char16_t *className, int maxCount)');
  const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(HWND hwnd, _Out_ char16_t *text, int maxCount)');
  const LoadImageW = user32.func('HANDLE __stdcall LoadImageW(HANDLE instance, str16 name, uint32_t type, int width, int height, uint32_t flags)');
  const DestroyIcon = user32.func('bool __stdcall DestroyIcon(HICON icon)');
  const SendIconMessage = user32.func('__stdcall', 'SendMessageTimeoutW', 'uintptr_t', [
    HWND, 'uint32_t', 'uintptr_t', HICON, 'uint32_t', 'uint32_t', koffi.out(koffi.pointer('uintptr_t')),
  ]);
  const SendIntegerMessage = user32.func('__stdcall', 'SendMessageTimeoutW', 'uintptr_t', [
    HWND, 'uint32_t', 'uintptr_t', 'intptr_t', 'uint32_t', 'uint32_t', koffi.out(koffi.pointer('uintptr_t')),
  ]);
  const SendTextMessage = user32.func('__stdcall', 'SendMessageTimeoutW', 'uintptr_t', [
    HWND, 'uint32_t', 'uintptr_t', 'str16', 'uint32_t', 'uint32_t', koffi.out(koffi.pointer('uintptr_t')),
  ]);

  const WM_GETICON = 0x007f;
  const WM_SETICON = 0x0080;
  const WM_SETTEXT = 0x000c;
  const ICON_SMALL = 0;
  const ICON_BIG = 1;
  const GW_OWNER = 4;
  const IMAGE_ICON = 1;
  const LR_LOADFROMFILE = 0x0010;
  const SMTO_BLOCK = 0x0001;
  const SMTO_ABORTIFHUNG = 0x0002;
  const SEND_FLAGS = SMTO_BLOCK | SMTO_ABORTIFHUNG;
  const SEND_TIMEOUT_MS = 100;

  function readText(fn: (...args: any[]) => number, hwnd: bigint): string {
    const buffer = Buffer.alloc(1024 * 2);
    const length = fn(hwnd, buffer, 1024);
    return length > 0 ? buffer.toString('utf16le', 0, length * 2) : '';
  }

  function sendResult(call: (...args: any[]) => unknown, ...args: unknown[]): { ok: boolean; result: NativeHandle } {
    const result: unknown[] = [null];
    const ok = call(...args, SEND_FLAGS, SEND_TIMEOUT_MS, result);
    const value = result[0];
    return { ok: Boolean(ok), result: typeof value === 'bigint' ? value : value ? BigInt(value as number) : null };
  }

  return {
    enumerateChromeWindows(): NativeChromeWindow[] {
      const windows: NativeChromeWindow[] = [];
      EnumWindows((rawHwnd: bigint) => {
        try {
          if (!IsWindowVisible(rawHwnd) || GetWindow(rawHwnd, GW_OWNER)) return true;
          if (readText(GetClassNameW, rawHwnd) !== 'Chrome_WidgetWin_1') return true;
          const pidOut: unknown[] = [null];
          GetWindowThreadProcessId(rawHwnd, pidOut);
          const pid = Number(pidOut[0] ?? 0);
          if (pid > 0) windows.push({ hwnd: rawHwnd, pid, title: readText(GetWindowTextW, rawHwnd) });
        } catch {
          // The window may disappear while EnumWindows is running.
        }
        return true;
      }, 0);
      return windows;
    },

    getIcon(hwnd, size) {
      return sendResult(
        SendIntegerMessage,
        hwnd,
        WM_GETICON,
        size === 'small' ? ICON_SMALL : ICON_BIG,
        0,
      ).result;
    },

    setIcon(hwnd, size, icon) {
      return sendResult(
        SendIconMessage,
        hwnd,
        WM_SETICON,
        size === 'small' ? ICON_SMALL : ICON_BIG,
        icon,
      ).ok;
    },

    setTitle(hwnd, title) {
      return sendResult(SendTextMessage, hwnd, WM_SETTEXT, 0, title).ok;
    },

    loadIcons(path) {
      const small = LoadImageW(null, path, IMAGE_ICON, 16, 16, LR_LOADFROMFILE) as bigint | null;
      const big = LoadImageW(null, path, IMAGE_ICON, 32, 32, LR_LOADFROMFILE) as bigint | null;
      if (!small || !big) {
        if (small) DestroyIcon(small);
        if (big) DestroyIcon(big);
        throw new Error(`LoadImageW failed for ${path}`);
      }
      return { small, big };
    },

    destroyIcon(icon) {
      DestroyIcon(icon);
    },
  };
}
