# YouTube Cookie Exporter

This directory contains scripts to assist with exporting cookies from YouTube.
You need to have access to the video2commons project in Toolforge and have SSH
configured to use these scripts.

## Setup

There are two scripts, the exporter `export-youtube-cookies.py` and the
uploader `upload-cookies.sh`. You need Bash and Python to run these. On Windows,
use WSL. To run the Python script you must setup a venv and install the
dependencies defined in `requirements.txt`.

```sh
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Exporting Cookies

With the dependencies installed you can now run the `export-youtube-cookies.py`
script. This script will launch a browser window that you can use to log in to
the Google/YouTube account that you want to export cookies for.

With your venv activated, run the script like so:

```sh
./export-youtube-cookies.py
```

The cookies will be exported to `/tmp/youtube-cookies.txt`.

## Uploading Cookies

With the cookies exported into a temporary directory they can now be uploaded
with `upload-cookies.sh`.  This script uploads the cookies to each of the
encoder instances on CloudVPS. Ensure that all instances are running before
doing this step.

When calling `upload-cookies.sh` you must provide your Toolforge username.

```sh
./upload-cookies.sh <username>
```

If any cookies fail to upload due to network issues or instances being offline,
the cookies stored in `/tmp` will not be deleted, and the script can be run
again. If successful for all encoders, the cookies stored in `/tmp` will be
deleted.
