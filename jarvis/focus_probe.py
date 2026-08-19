import time

import psutil
import win32api
import win32con
import win32gui
import win32process


def find_whatsapp():
    matches = []

    def callback(hwnd, _):
        try:
            if not win32gui.IsWindowVisible(hwnd):
                return

            _, pid = win32process.GetWindowThreadProcessId(hwnd)

            if psutil.Process(pid).name().casefold() == "whatsapp.root.exe":
                matches.append(hwnd)

        except Exception:
            pass

    win32gui.EnumWindows(callback, None)

    return matches[0] if matches else None


hwnd = find_whatsapp()

if not hwnd:
    print("WHATSAPP_NOT_FOUND")
    raise SystemExit


print("TARGET HWND:", hwnd)

win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)

# Small ALT press. No message/click is performed.
win32api.keybd_event(
    win32con.VK_MENU,
    0,
    0,
    0,
)

win32api.keybd_event(
    win32con.VK_MENU,
    0,
    win32con.KEYEVENTF_KEYUP,
    0,
)

time.sleep(0.05)

result = win32gui.SetForegroundWindow(hwnd)

time.sleep(0.3)

fg = win32gui.GetForegroundWindow()
_, pid = win32process.GetWindowThreadProcessId(fg)

print("SET RESULT:", result)
print("TARGET == FOREGROUND:", hwnd == fg)
print("FOREGROUND TITLE:", win32gui.GetWindowText(fg))
print("FOREGROUND PROCESS:", psutil.Process(pid).name())
