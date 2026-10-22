#!/bin/bash
# First boot of a CRM server (Amazon Linux 2023, arm64): Docker, swap, data volume, deploy and backup units.
set -euxo pipefail

dnf install -y docker
systemctl enable --now docker

# 2 GB swap so the small server copes with memory peaks.
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
swapon -a || true

mkdir -p /opt/crm /var/lib/crm
echo "${primary}" > /opt/crm/primary

%{ if data_volume_id != "" ~}
# Separate EBS volume for PostgreSQL data, so replacing the server never touches the database.
DEV="/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${replace(data_volume_id, "-", "")}"
for i in $(seq 1 60); do [ -e "$DEV" ] && break; sleep 5; done
blkid "$DEV" || mkfs.xfs "$DEV"
grep -q '/var/lib/crm ' /etc/fstab || echo "$DEV /var/lib/crm xfs defaults,nofail 0 2" >> /etc/fstab
mount -a
%{ endif ~}

cat > /opt/crm/deploy.sh <<'DEPLOY'
${deploy_script}
DEPLOY
chmod 700 /opt/crm/deploy.sh

cat > /etc/systemd/system/crm.service <<'UNIT'
[Unit]
Description=Start CRM containers
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/opt/crm/deploy.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT

%{ if data_volume_id != "" ~}
# Nightly PostgreSQL dump to S3 (kept ${backup_days} days by the bucket lifecycle), on top of daily volume snapshots.
cat > /opt/crm/backup.sh <<'BACKUP'
#!/bin/bash
set -euo pipefail
BUCKET="$(aws ssm get-parameter --region ${region} --with-decryption --name /crm/${environment}/deploy/BACKUP_BUCKET --query Parameter.Value --output text)"
docker exec postgres pg_dump -U postgres -Fc crm | aws s3 cp - "s3://$BUCKET/postgres/crm-$(date -u +%Y-%m-%dT%H%M).dump" --region ${region}
BACKUP
chmod 700 /opt/crm/backup.sh
cat > /etc/systemd/system/crm-backup.service <<'UNIT'
[Unit]
Description=Back up the CRM database to S3
[Service]
Type=oneshot
ExecStart=/opt/crm/backup.sh
UNIT
cat > /etc/systemd/system/crm-backup.timer <<'UNIT'
[Unit]
Description=Nightly CRM database backup
[Timer]
OnCalendar=*-*-* 22:00:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl enable crm-backup.timer
%{ endif ~}

systemctl daemon-reload
systemctl enable crm.service
# Images may not exist yet on the very first boot; the release pipeline runs deploy.sh again after pushing them.
systemctl start crm.service || echo "first deploy did not complete; it runs again on the next release"
