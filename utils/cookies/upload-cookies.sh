#!/bin/bash

# Uploads YouTube cookies exported by export-youtube.py to each encoder host,
# then cleans up the local cookie file from /tmp.

encoder_hosts=$(cat <<EOF
encoding01.video.eqiad1.wikimedia.cloud
encoding02.video.eqiad1.wikimedia.cloud
encoding03.video.eqiad1.wikimedia.cloud
encoding04.video.eqiad1.wikimedia.cloud
encoding05.video.eqiad1.wikimedia.cloud
encoding06.video.eqiad1.wikimedia.cloud
EOF
)

bastion_host=login.toolforge.org
cookie_file="/tmp/youtube-cookies.txt"
remote_path="/srv/v2c/cookies.txt"

if [ ! -f "$cookie_file" ]; then
    echo "Error: Cookie file not found at '$cookie_file'" >&2
    echo "Run export-youtube.py first to generate it." >&2
    exit 1
elif [ -z "$V2C_USERNAME" ]; then
    echo "Error: V2C_USERNAME environment variable is not set" >&2
    exit 1
fi

worker_count=$(echo "$encoder_hosts" | wc -l)
success_count=0

while read -r encoder_host; do
    echo "Uploading cookies to '$encoder_host'..."

    # Copy the cookie over to the encoder.
    scp -o ProxyJump="$V2C_USERNAME@$bastion_host" \
        "$cookie_file" "$V2C_USERNAME@$encoder_host:$cookie_file" >/dev/null

    if [ $? -ne 0 ]; then
        echo "Failed to upload cookies to '$encoder_host'" >&2
        continue
    fi

    # Move the cookie to the correct desintation and fix permissions. We have
    # to do this since `scp` cannot directly write to /srv/v2c due to the LDAP
    # user not having permission without 'sudo'.
    ssh -n -o ProxyJump="$V2C_USERNAME@$bastion_host" \
        "$V2C_USERNAME@$encoder_host" \
        "sudo mv $cookie_file $remote_path && sudo chown tools.video2commons:tools.video2commons $remote_path && sudo chmod 644 $remote_path"

    if [ $? -ne 0 ]; then
        echo "Failed to install cookies on '$encoder_host'" >&2
        continue
    fi

    echo "Cookies uploaded to '$encoder_host'"
    success_count=$((success_count + 1))
done <<< "$encoder_hosts"

echo "Done. Uploaded to ($success_count/$worker_count) workers"

if [ "$success_count" -ne "$worker_count" ]; then
    echo "Some uploads failed. Cookie file kept at '$cookie_file' for retry." >&2
    exit 1
fi

rm "$cookie_file"
echo "Cleaned up '$cookie_file'"
