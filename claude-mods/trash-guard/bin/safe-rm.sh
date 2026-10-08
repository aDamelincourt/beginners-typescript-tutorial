# Sourced before a Bash command by the trash-guard mod.
# rm, rmdir and unlink become shell functions that move their targets to the
# system trash (freedesktop Trash on Linux, ~/.Trash on macOS) instead of
# deleting them, and append "original<TAB>destination" to $CLAUDE_TRASH_LOG.

__ct_move() {
  local src="$1" dir base abs trash files dest n info
  base=$(basename -- "$src")
  dir=$(cd -- "$(dirname -- "$src")" && pwd) || return 1
  abs="${dir%/}/$base"
  if [ "$(uname -s)" = Darwin ]; then
    trash="$HOME/.Trash"; files="$trash"
  else
    trash="${XDG_DATA_HOME:-$HOME/.local/share}/Trash"; files="$trash/files"
    mkdir -p "$trash/info" || return 1
  fi
  mkdir -p "$files" || return 1
  dest="$files/$base"; n=1
  while [ -e "$dest" ] || [ -L "$dest" ] || [ -e "$trash/info/${dest##*/}.trashinfo" ]; do
    n=$((n + 1)); dest="$files/$base.$n"
  done
  info=""
  if [ "$files" != "$trash" ]; then
    info="$trash/info/${dest##*/}.trashinfo"
    printf '[Trash Info]\nPath=%s\nDeletionDate=%s\n' "$abs" "$(date +%Y-%m-%dT%H:%M:%S)" > "$info" || return 1
  fi
  if mv -- "$src" "$dest"; then
    [ -n "$CLAUDE_TRASH_LOG" ] && printf '%s\t%s\n' "$abs" "$dest" >> "$CLAUDE_TRASH_LOG"
    return 0
  fi
  [ -n "$info" ] && command rm -f -- "$info"
  return 1
}

# __ct_remove <command> <path> <recursive> <force> <empty-dirs-ok>
__ct_remove() {
  local cmd="$1" p="$2"
  if [ ! -e "$p" ] && [ ! -L "$p" ]; then
    [ "$4" = 1 ] && return 0
    printf "%s: cannot remove '%s': No such file or directory\n" "$cmd" "$p" >&2
    return 1
  fi
  case "$(basename -- "$p")" in
    .|..|/) printf "%s: refusing to remove '%s'\n" "$cmd" "$p" >&2; return 1 ;;
  esac
  if [ -d "$p" ] && [ ! -L "$p" ] && [ "$3" = 0 ]; then
    if [ "$5" = 0 ]; then
      printf "%s: cannot remove '%s': Is a directory\n" "$cmd" "$p" >&2; return 1
    fi
    if [ -n "$(ls -A -- "$p")" ]; then
      printf "%s: failed to remove '%s': Directory not empty\n" "$cmd" "$p" >&2; return 1
    fi
  fi
  if [ "$cmd" = unlink ] && [ -d "$p" ] && [ ! -L "$p" ]; then
    printf "unlink: cannot unlink '%s': Is a directory\n" "$p" >&2; return 1
  fi
  __ct_move "$p" || { printf "%s: cannot move '%s' to the trash\n" "$cmd" "$p" >&2; return 1; }
}

rm() {
  local recursive=0 force=0 dirs=0 end=0 status=0 arg
  for arg in "$@"; do
    [ "$end" = 1 ] && break
    case "$arg" in
      --) end=1 ;;
      --recursive) recursive=1 ;;
      --force) force=1 ;;
      --dir) dirs=1 ;;
      --*) ;;
      -?*)
        case "$arg" in *[rR]*) recursive=1 ;; esac
        case "$arg" in *f*) force=1 ;; esac
        case "$arg" in *d*) dirs=1 ;; esac ;;
    esac
  done
  end=0
  for arg in "$@"; do
    if [ "$end" = 0 ]; then
      case "$arg" in --) end=1; continue ;; -?*) continue ;; esac
    fi
    __ct_remove rm "$arg" "$recursive" "$force" "$dirs" || status=1
  done
  return $status
}

rmdir() {
  local end=0 status=0 arg
  for arg in "$@"; do
    if [ "$end" = 0 ]; then
      case "$arg" in --) end=1; continue ;; -?*) continue ;; esac
    fi
    if [ -d "$arg" ] && [ ! -L "$arg" ]; then
      __ct_remove rmdir "$arg" 0 0 1 || status=1
    else
      printf "rmdir: failed to remove '%s': Not a directory\n" "$arg" >&2; status=1
    fi
  done
  return $status
}

unlink() {
  local arg
  for arg in "$@"; do
    case "$arg" in --) continue ;; esac
    __ct_remove unlink "$arg" 0 0 0
    return $?
  done
}
