# shellcheck shell=bash
# Linked from workspace tmux-zsign.sh / sm.sh — requires ROOT (zsign workspace).

seat_mesh_zsign_root() {
  if [[ -z "${ROOT:-}" ]]; then
    echo "seat-mesh: ROOT not set (internal)" >&2
    return 1
  fi
  printf '%s\n' "$ROOT"
}

seat_mesh_cli_js() {
  local root
  root="$(seat_mesh_zsign_root)"
  printf '%s/seat-mesh/packages/cli/dist/main.js\n' "$root"
}

seat_mesh_profile_dir() {
  local root
  root="$(seat_mesh_zsign_root)"
  printf '%s/seat-mesh/profiles/zsign\n' "$root"
}

seat_mesh_repo() {
  local root
  root="$(seat_mesh_zsign_root)"
  printf '%s/seat-mesh\n' "$root"
}

seat_mesh_built() {
  [[ -f "$(seat_mesh_cli_js)" ]] && [[ -d "$(seat_mesh_repo)/node_modules" ]]
}

# Auto npm install + build on cold start when dist/ or node_modules missing.
seat_mesh_ensure_built() {
  local root repo cli pkg
  root="$(seat_mesh_zsign_root)"
  repo="$(seat_mesh_repo)"
  cli="$(seat_mesh_cli_js)"
  pkg="$repo/package.json"

  local needs=0
  if [[ ! -f "$cli" ]]; then
    needs=1
  fi
  if [[ ! -d "$repo/node_modules" ]]; then
    needs=1
  fi
  if [[ -f "$pkg" && -f "$cli" && "$pkg" -nt "$cli" ]]; then
    needs=1
  fi

  if [[ "$needs" -eq 0 ]]; then
    return 0
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "seat-mesh: npm not found (need Node/npm for cold start build)" >&2
    return 1
  fi

  echo "seat-mesh: cold start — npm install + build in $repo ..." >&2
  if ! (cd "$repo" && npm install && npm run build); then
    echo "seat-mesh: build failed" >&2
    return 1
  fi
}

# Scrape live tmux panes -> tmux-main-agents.json (was: ./tmux-zsign.sh auto).
seat_mesh_run_save() {
  local root
  root="$(seat_mesh_zsign_root)"
  exec "$root/tmux-zsign.sh" save "$@"
}

seat_mesh_exec() {
  local root profile cli
  root="$(seat_mesh_zsign_root)"
  profile="$(seat_mesh_profile_dir)"
  cli="$(seat_mesh_cli_js)"

  if [[ "${1:-}" == "save" ]]; then
    shift || true
    seat_mesh_run_save "$@"
    return
  fi

  if [[ "${1:-}" == "whoami" || "${1:-}" == "where" ]]; then
    if [[ "${1:-}" == "where" ]]; then
      echo "note: where is deprecated — use ./sm.sh whoami" >&2
    fi
    shift || true
    seat_mesh_ensure_built || return 1
    exec node "$cli" --profile "$profile" whoami "$@"
  fi

  if [[ ! -f "$profile/mesh.config.yaml" ]]; then
    echo "seat-mesh: missing profile $profile/mesh.config.yaml" >&2
    return 1
  fi

  seat_mesh_ensure_built || return 1

  # Default: bring local stack up (./dc.sh up via sm stack).
  if [[ $# -eq 0 ]] || { [[ $# -eq 1 ]] && [[ "${1:-}" == "up" ]]; }; then
    set -- stack up
  fi

  exec node "$cli" --profile "$profile" "$@"
}

# Map tmux-zsign command -> seat-mesh. Return 0 if handled (exec does not return).
seat_mesh_link_dispatch() {
  local cmd="${1:-}"
  shift || true

  case "$cmd" in
    seat-mesh|sm)
      seat_mesh_exec "$@"
      ;;
    index)
      seat_mesh_exec index "$@"
      ;;
    save)
      seat_mesh_run_save "$@"
      ;;
    whoami|where)
      seat_mesh_exec "$cmd" "$@"
      ;;
    room|contract|chat|stack|dc)
      seat_mesh_exec "$cmd" "$@"
      ;;
    *)
      return 1
      ;;
  esac
}
