"""Serve the bundled application only on this computer."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser


def main():
    handler = partial(SimpleHTTPRequestHandler, directory=str(Path(__file__).parent / "dist"))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", 4173), handler)
    except OSError as error:
        print(f"Не удалось запустить сервер: {error}")
        print("Если приложение уже запущено, откройте http://127.0.0.1:4173")
        return 1
    print("Сейчас: http://127.0.0.1:4173 — для остановки нажмите Ctrl+C")
    webbrowser.open("http://127.0.0.1:4173")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
