# Grafana dashboards

Dashboard JSON dropped in this directory is provisioned automatically at
startup by `../provisioning/dashboards/dashboards.yml`, which watches
`/var/lib/grafana/dashboards` inside the container.

The directory is mounted read-only, so dashboards edited in the Grafana UI
are not written back here. To keep a dashboard, export it (Share, Export,
"Export for sharing externally") and commit the JSON.

This directory needs to exist even when empty. Without it the file provider
cannot stat its path and logs an error on every scan interval.
