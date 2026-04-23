#!/bin/bash

# Uploads YouTube cookies exported by export-youtube-cookies.py to each encoder host,
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

BASTION_HOST=login.toolforge.org
COOKIE_FILE="/tmp/youtube-cookies.txt"
REMOTE_PATH="/srv/v2c/cookies.txt"

username=$1

if [ ! -f "$COOKIE_FILE" ]; then
    echo "Error: Cookie file not found at '$COOKIE_FILE'" >&2
    echo "Run export-youtube-cookies.py first to generate it." >&2
    exit 1
elif [ -z "$username" ]; then
    echo "Error: username is not set." >&2
    echo "Usage: upload-cookies.sh <username>" >&2
    exit 1
fi

worker_count=$(echo "$encoder_hosts" | wc -l)
success_count=0

while read -r encoder_host; do
    echo "Uploading cookies to '$encoder_host'..."

    # Copy the cookie over to the encoder.
    scp -o ProxyJump="$username@$BASTION_HOST" \
        "$COOKIE_FILE" "$username@$encoder_host:$COOKIE_FILE" >/dev/null

    if [ $? -ne 0 ]; then
        echo "Failed to upload cookies to '$encoder_host'" >&2
        continue
    fi

    # Move the cookie to the correct desintation and fix permissions. We have
    # to do this since `scp` cannot directly write to /srv/v2c due to the LDAP
    # user not having permission without 'sudo'.
    ssh -n -o ProxyJump="$username@$BASTION_HOST" \
        "$username@$encoder_host" \
        "sudo mv $COOKIE_FILE $REMOTE_PATH && sudo chown tools.video2commons:tools.video2commons $REMOTE_PATH && sudo chmod 644 $REMOTE_PATH"

    if [ $? -ne 0 ]; then
        echo "Failed to install cookies on '$encoder_host'" >&2
        continue
    fi

    echo "Cookies uploaded to '$encoder_host'"
    success_count=$((success_count + 1))
done <<< "$encoder_hosts"

echo "Done. Uploaded to ($success_count/$worker_count) workers"

if [ "$success_count" -ne "$worker_count" ]; then
    echo "Some uploads failed. Cookie file kept at '$COOKIE_FILE' for retry." >&2
    exit 1
fi

rm "$COOKIE_FILE"
echo "Cleaned up '$COOKIE_FILE'"
