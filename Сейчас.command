#!/bin/zsh
set -eu
cd -- "${0:A:h}"
if ! command -v python3 >/dev/null 2>&1; then
  print 'Для запуска нужен Python 3: https://www.python.org/downloads/'
  read '?Нажмите Enter, чтобы закрыть окно.'
  exit 1
fi
exec python3 start.py
