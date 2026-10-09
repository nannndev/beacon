import sys

from app.core.scripting import maybe_run_worker

# Pre-request scripts run in child processes that re-launch this executable.
maybe_run_worker(sys.argv)

from app.cli import main


if __name__ == "__main__":
    raise SystemExit(main())
