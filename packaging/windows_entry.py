"""Frozen Windows GUI entrypoint."""

from multiprocessing import freeze_support

from jarvis.dashboard import main


if __name__ == "__main__":
    freeze_support()
    main()
