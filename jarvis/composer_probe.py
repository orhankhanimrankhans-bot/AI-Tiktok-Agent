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

print("WINDOW:", window_rect)
print()


for control_type in ("Edit", "Document"):
    print(f"--- {control_type} ---")

    try:
        controls = window.descendants(
            control_type=control_type
        )
    except Exception as exc:
        print("SEARCH ERROR:", exc)
        continue

    for index, control in enumerate(controls):
        try:
            rect = control.rectangle()

            if not control.is_visible():
                continue

            if rect.width() <= 0 or rect.height() <= 0:
                continue

            # Composer should be near bottom of WhatsApp.
            bottom_zone = (
                window_rect.top
                + int(window_rect.height() * 0.65)
            )

            if rect.top < bottom_zone:
                continue

            name = control.element_info.name or ""
            auto_id = control.element_info.automation_id or ""

            try:
                text = control.window_text()
            except Exception:
                text = ""

            try:
                value = control.get_value()
            except Exception:
                value = "<NO_GET_VALUE>"

            print(
                f"{index}: "
                f"RECT={rect} | "
                f"NAME={name!r} | "
                f"TEXT={text!r} | "
                f"VALUE={value!r} | "
                f"AUTO_ID={auto_id!r}"
            )

        except Exception:
            continue

    print()


print("PROBE_FINISHED_NO_ACTION")
