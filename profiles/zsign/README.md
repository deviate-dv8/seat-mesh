# zsign profile

Consumer profile for the zsign workspace. **seat-mesh core does not depend on this.**

| Path | Purpose |
|------|---------|
| `mesh.config.yaml` | Workspace root, chat rooms, stack `./dc.sh`, 6-worker layout target |
| `roles/` | Role index YAML for whoami |

**zsign workspace entry:**

```bash
./sm.sh help
./sm.sh whoami
./sm.sh stack up    # passthrough to ./dc.sh only
```

**Tmux harness (zsign-local, not seat-mesh):** `./tmux-zsign.sh`
