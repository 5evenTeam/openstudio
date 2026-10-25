# Permissions

OpenStudio supports three levels:

- `read-only`
- `scripts-only`
- `full-edit`

## Ordering

`read-only` < `scripts-only` < `full-edit`

## Runtime control

```text
openstudio_set_permission_level(level)
```

## Defaults

- Environment: `OPENSTUDIO_PERMISSIONS`
- Default: `scripts-only`