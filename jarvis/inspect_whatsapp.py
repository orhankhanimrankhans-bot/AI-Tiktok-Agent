from pywinauto import Desktop


def main():
    desktop = Desktop(backend="uia")

    whatsapp_windows = []

    for window in desktop.windows():
        try:
            title = window.window_text().strip()

            if "whatsapp" in title.casefold():
                whatsapp_windows.append(window)

        except Exception:
            continue

    if not whatsapp_windows:
        print("NO_WHATSAPP_WINDOW")
        return

    window = whatsapp_windows[0]

    print("=" * 70)
    print("WHATSAPP WINDOW FOUND")
    print("TITLE:", window.window_text())
    print("HANDLE:", window.handle)
    print("=" * 70)

    print()
    print("BUTTON / EDIT CONTROLS")
    print()

    count = 0

    for control in window.descendants():
        try:
            info = control.element_info

            control_type = (
                getattr(info, "control_type", "") or ""
            )

            name = (
                getattr(info, "name", "") or ""
            ).strip()

            automation_id = (
                getattr(info, "automation_id", "") or ""
            ).strip()

            # We mainly care about message input + buttons.
            if control_type not in {
                "Button",
                "Edit",
                "Document",
            }:
                continue

            count += 1

            print(
                f"{count:03d} | "
                f"TYPE={control_type!r} | "
                f"NAME={name!r} | "
                f"AUTO_ID={automation_id!r}"
            )

        except Exception:
            continue

    print()
    print("TOTAL:", count)


if __name__ == "__main__":
    main()
