import psutil
import win32gui
import win32process

from pywinauto import Desktop


def find_whatsapp_window():
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


hwnd = find_whatsapp_window()

if not hwnd:
    print("WHATSAPP_NOT_FOUND")
    raise SystemExit


window = Desktop(
    backend="uia"
).window(handle=hwnd)

window_rect = window.rectangle()

print("WINDOW RECT:", window_rect)
print()


candidates = window.descendants(
    title="Send",
    control_type="Button",
)

print("TOTAL SEND CANDIDATES:", len(candidates))
print()


useful = []

for index, button in enumerate(candidates):
    try:
        rect = button.rectangle()

        visible = button.is_visible()
        enabled = button.is_enabled()

        width = rect.right - rect.left
        height = rect.bottom - rect.top

        if not visible:
            continue

        if not enabled:
            continue

        if width <= 0 or height <= 0:
            continue

        # Must physically lie inside the current WhatsApp window.
        if not (
            rect.left >= window_rect.left
            and rect.top >= window_rect.top
            and rect.right <= window_rect.right
            and rect.bottom <= window_rect.bottom
        ):
            continue

        useful.append(button)

        print(
            f"CANDIDATE {index}: "
            f"RECT={rect} "
            f"VISIBLE={visible} "
            f"ENABLED={enabled} "
            f"AUTO_ID={button.element_info.automation_id!r}"
        )

    except Exception:
        continue


print()
print("USEFUL CANDIDATES:", len(useful))
print("PROBE_FINISHED_NO_CLICK")
